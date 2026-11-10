// Events out: what Valet notices, published so other systems (Home Assistant, Node-RED, an ntfy bridge) can react. Each
// event is one small JSON document with a `type` and the time; `events.targets` says where they go: a webhook (a JSON
// POST, signed if it has a secret) or an MQTT broker (mqtt.ts). Everything published passes the redactor first. Nothing
// here can hold up or break the page: sending happens off to the side, a target that fails is retried with a growing
// pause and logged once, and what waits for it is bounded. Connections belong to the live site and stop with it.
import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Mqtt, type Message } from './mqtt.ts';

export const EVENT_TYPES = ['service', 'activity', 'notice', 'backup', 'rule', 'hook', 'ask'] as const;
type Tone = 'good' | 'warn' | 'bad' | 'accent';
/** What's published, besides `at`. A second line is always `detail`. */
export type Out =
  | { type: 'service'; state: 'down' | 'up'; name: string; widget: string; detail?: string }
  | { type: 'activity'; state: 'start' | 'end'; widget: string; title: string; detail?: string }
  | { type: 'notice'; text: string; detail?: string; tone: Tone; source: string }
  | { type: 'backup'; state: 'problem' | 'recovered'; name: string; source: string; health: string; text: string; detail?: string }
  | { type: 'rule'; id: string; ok: boolean; text: string; detail?: string }
  | { type: 'hook'; name: string; text: string; detail?: string; tone: Tone }
  | { type: 'ask'; id: string; from: string; tool: string; title: string };

const On = z.array(z.enum(EVENT_TYPES)).min(1).optional();
export const EventTarget = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('webhook'),
    url: z.string().url().regex(/^https?:\/\//i, 'an http:// or https:// address'),   // where each event is POSTed as JSON
    headers: z.record(z.string(), z.string()).optional(),   // sent with each, e.g. { Authorization: "Bearer ${NODE_RED_TOKEN}" }; Content-Type and the signature are Valet's
    secret: z.string().min(16, 'at least 16 characters, from .env').optional(),   // signs each body: X-Valet-Signature: sha256=<HMAC-SHA256, hex>
    on: On,                                    // only these types, for this target
  }).strict(),
  z.object({
    type: z.literal('mqtt'),
    url: z.string().regex(/^mqtts?:\/\/[^\s/@]+\/?$/i, 'a broker, like mqtt://host:1883 or mqtts://host:8883'),   // mqtts:// is TLS, checked against the system's certificates
    username: z.string().optional(),
    password: z.string().optional(),           // ${MQTT_PASSWORD}, from .env
    topic: z.string().regex(/^[^\s+#/\u0000]+(\/[^\s+#/\u0000]+)*$/, 'a topic to publish under, like valet or home/valet').max(100).default('valet'),   // everything goes under it: valet/service/plex, valet/hook/sonarr, valet/status
    retain: z.boolean().default(true),         // the broker keeps the last state of each service, activity and backup, and whether Valet is online
    qos: z.union([z.literal(0), z.literal(1)]).default(0),   // 1: each message is acknowledged by the broker, and sent again if it wasn't
    clientId: z.string().regex(/^[\w-]{1,64}$/).optional(),   // default: valet- and a few random letters, new each start
    keepalive: z.number().int().min(10).max(3600).default(60),   // seconds
    on: On,                                    // only these types, for this target
  }).strict(),
]);
export const EventsConfig = z.object({
  on: On,                                      // which types go out (each target may narrow it); left out: all of them
  targets: z.array(EventTarget).max(8).default([]),   // where they go: webhooks and MQTT brokers, eight at most
}).strict();
export type EventsConfig = z.infer<typeof EventsConfig>;
type Target = EventsConfig['targets'][number];

export const QUEUE = 200, CLIP = 500, WAITS: [number, number] = [1000, 5 * 60_000];

/** A name as one level of a topic: letters and numbers of any language, everything else a dash. */
export const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unnamed';
/** Where an event goes under the target's topic, and whether the broker should keep it: a state is kept, a moment isn't. */
export function topicOf(e: Out): { topic: string; state: boolean } {
  switch (e.type) {
    case 'service': return { topic: `service/${slug(e.name)}`, state: true };
    case 'activity': return { topic: `activity/${slug(e.widget)}`, state: true };
    case 'backup': return { topic: `backup/${slug(e.name)}`, state: true };
    case 'rule': return { topic: `rule/${slug(e.id)}`, state: false };
    case 'hook': return { topic: `hook/${slug(e.name)}`, state: false };
    default: return { topic: e.type, state: false };
  }
}
export const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export interface Deps {
  redact: (s: string) => string;
  log?: (line: string) => void;
  send?: typeof fetch;
  /** how a retry waits: a test hands in its own, so it never sleeps */
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  mqtt?: { backoff?: [number, number] };
}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(done => {
  const t = setTimeout(done, ms); t.unref();
  signal.addEventListener('abort', () => { clearTimeout(t); done(); }, { once: true });
});

/** One webhook: bodies go in order, one at a time. A failure to reach it, a 429 or a 5xx is tried again after a pause
 *  that doubles; any other refusal means the receiver doesn't want that one, and it's let go. */
class Poster {
  private queue: { type: string; body: string }[] = [];
  private busy = false; private failed = false;
  private stopping = new AbortController();
  private t: Extract<Target, { type: 'webhook' }>;
  private d: Deps;
  constructor(t: Extract<Target, { type: 'webhook' }>, d: Deps) { this.t = t; this.d = d; }
  start() {}
  stop() { this.stopping.abort(); this.queue = []; }
  send(e: Out, body: string) {
    if (this.stopping.signal.aborted) return;
    this.queue.push({ type: e.type, body });
    if (this.queue.length > QUEUE) this.queue.shift();
    void this.pump();
  }
  private async post({ type, body }: { type: string; body: string }): Promise<'sent' | 'refused' | 'later'> {
    const said = (what: string) => { if (!this.failed) this.d.log?.(`events: webhook ${new URL(this.t.url).host} ${what}`); this.failed = true; };
    try {
      const r = await (this.d.send ?? fetch)(this.t.url, { method: 'POST', body, signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(10_000)]),
        headers: { 'User-Agent': 'Valet', ...this.t.headers, 'Content-Type': 'application/json', 'X-Valet-Event': type, ...(this.t.secret ? { 'X-Valet-Signature': sign(this.t.secret, body) } : {}) } });
      void r.body?.cancel().catch(() => {});
      if (r.ok) { if (this.failed) this.d.log?.(`events: webhook ${new URL(this.t.url).host} answers again`); this.failed = false; return 'sent'; }
      const again = r.status === 429 || r.status >= 500;
      said(`answered ${r.status}${again ? '; trying again until it takes them' : ''}`);
      return again ? 'later' : 'refused';
    } catch (e) {
      if (!this.stopping.signal.aborted) said(`can't be reached (${(e as Error).message}); trying again until it can`);
      return 'later';
    }
  }
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    let wait = WAITS[0];
    while (this.queue.length && !this.stopping.signal.aborted) {
      const next = this.queue[0], how = await this.post(next);
      if (how === 'later') { await (this.d.pause ?? sleep)(wait, this.stopping.signal); wait = Math.min(wait * 2, WAITS[1]); continue; }
      wait = WAITS[0];
      if (this.queue[0] === next) this.queue.shift();   // unless the queue filled meanwhile and already let it go
    }
    this.busy = false;
  }
}

/** One broker: every event under the target's topic, states retained, and `<topic>/status` saying online or offline
 *  (the broker says offline itself if Valet vanishes). */
class Broker {
  private client: Mqtt;
  private offline: Message;
  private t: Extract<Target, { type: 'mqtt' }>;
  constructor(t: Extract<Target, { type: 'mqtt' }>, d: Deps) {
    this.t = t;
    const status = (payload: string): Message => ({ topic: `${t.topic}/status`, payload, retain: t.retain });
    this.offline = status('offline');
    this.client = new Mqtt({ url: t.url, username: t.username, password: t.password, clientId: t.clientId ?? `valet-${randomBytes(4).toString('hex')}`, keepalive: t.keepalive,
      will: this.offline, hello: { ...status('online'), qos: t.qos }, queue: QUEUE, backoff: d.mqtt?.backoff, log: d.log && (line => d.log!(`events: ${line}`)) });
  }
  start() { this.client.start(); }
  stop() { this.client.stop(this.offline); }
  send(e: Out, body: string) {
    const { topic, state } = topicOf(e);
    this.client.publish({ topic: `${this.t.topic}/${topic}`, payload: body, qos: this.t.qos, retain: state && this.t.retain });
  }
}

export class Publisher {
  private targets: { on: Set<string>; to: Poster | Broker }[];
  private d: Deps;
  private live = false;
  constructor(config: EventsConfig | undefined, d: Deps) {
    this.d = d;
    this.targets = (config?.targets ?? []).map(t => ({ on: new Set<string>(t.on ?? config?.on ?? EVENT_TYPES), to: t.type === 'mqtt' ? new Broker(t, d) : new Poster(t, d) }));
  }
  /** Nothing connects until this: a config that's only being checked never reaches a broker. */
  start() { if (this.live) return; this.live = true; for (const t of this.targets) t.to.start(); }
  stop() { if (!this.live) return; this.live = false; for (const t of this.targets) t.to.stop(); }

  /** Publish one event to every target that takes its type. It returns at once and never throws. */
  emit(e: Out, at = Date.now()) {
    if (!this.live || !this.targets.some(t => t.on.has(e.type))) return;
    try {
      // long words from a service are cut, and every secret Valet knows is taken out, before anything leaves
      const { type, ...rest } = e;
      const body = this.d.redact(JSON.stringify({ type, at: new Date(at).toISOString(), ...rest }, (_, v) => typeof v === 'string' && v.length > CLIP ? `${v.slice(0, CLIP - 1)}…` : v));
      for (const t of this.targets) if (t.on.has(e.type)) t.to.send(e, body);
    } catch (err) { this.d.log?.(`events: ${(err as Error).message}`); }
  }
}
