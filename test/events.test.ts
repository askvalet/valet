// Events out: the documents Valet publishes, where each goes (a signed webhook, topics on a broker), what's filtered and
// redacted, and that a target that fails can't hold up or break anything. Made-up receivers on localhost; nothing sleeps:
// a retry's pause is handed in, and every step waits for the request or packet it's about.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer as http } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-events-'));
const { EventsConfig, Publisher, QUEUE, sign, slug, topicOf } = await import('../src/server/events.ts');
const { Decoder } = await import('../src/server/mqtt.ts');
const { Config, parseConfig } = await import('../src/server/config.ts');
const { buildSite } = await import('../src/server/site.ts');
const { sandbox } = await import('../src/server/sandbox.ts');
type Out = import('../src/server/events.ts').Out;

const arrivals = <T,>() => { const got: T[] = [], waiting: [number, () => void][] = []; return { got, add(x: T) { got.push(x); for (const [n, ok] of waiting) if (got.length >= n) ok(); }, until: (n: number) => new Promise<void>(ok => got.length >= n ? ok() : waiting.push([n, ok])) }; };
const SECRET = 'svc-key-93jf8s0q2', redact = (s: string) => s.replaceAll(SECRET, '•••');
const down: Out = { type: 'service', state: 'down', name: 'Plex', widget: 'svc.status', detail: `refused (key ${SECRET})` };
const AT = Date.UTC(2026, 10, 3, 9, 30);

test('the documents: type and time first, then the fields; long words cut, secrets taken out', async () => {
  const sent = arrivals<{ url: string; init: RequestInit }>();
  const p = new Publisher(EventsConfig.parse({ targets: [{ type: 'webhook', url: 'http://receiver.test/in' }] }), { redact, send: async (url, init) => { sent.add({ url: String(url), init: init! }); return new Response('ok'); } });
  p.start();
  p.emit(down, AT);
  p.emit({ type: 'notice', text: 'x'.repeat(2000), tone: 'accent', source: 'hooks.cron' }, AT);
  await sent.until(2);
  assert.equal(sent.got[0].init.body, `{"type":"service","at":"2026-11-03T09:30:00.000Z","state":"down","name":"Plex","widget":"svc.status","detail":"refused (key •••)"}`);
  assert.equal(JSON.parse(String(sent.got[1].init.body)).text.length, 500);
  const h = sent.got[0].init.headers as Record<string, string>;
  assert.deepEqual([h['Content-Type'], h['X-Valet-Event'], h['X-Valet-Signature']], ['application/json', 'service', undefined]);
  p.stop();
});

test('a webhook with a secret signs each body, so the receiver can check it came from Valet', async () => {
  const got = arrivals<{ body: string; headers: Record<string, unknown> }>();
  const s = http((q, r) => { let b = ''; q.on('data', d => { b += d; }); q.on('end', () => { r.end(); got.add({ body: b, headers: q.headers }); }); });
  await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok));
  const p = new Publisher(EventsConfig.parse({ targets: [{ type: 'webhook', url: `http://127.0.0.1:${(s.address() as any).port}/valet`, secret: 'shared-secret-0123456789', headers: { 'X-Home': 'yes', 'X-Valet-Signature': 'forged', 'Content-Type': 'text/html' } }] }), { redact });
  p.start();
  p.emit(down, AT);
  await got.until(1);
  const { body, headers } = got.got[0];
  // what a receiver does, in any language: HMAC-SHA256 of the raw body with the shared secret, compared with the header
  assert.equal(headers['x-valet-signature'], `sha256=${createHmac('sha256', 'shared-secret-0123456789').update(body).digest('hex')}`);
  assert.equal(headers['x-valet-signature'], sign('shared-secret-0123456789', body));
  assert.equal(headers['content-type'], 'application/json', 'a configured header can\'t change what the body is');
  assert.equal(headers['x-home'], 'yes'); assert.equal(headers['user-agent'], 'Valet');
  assert.ok(!body.includes(SECRET));
  p.stop(); s.close();
});

test('a webhook that fails: tried again with a pause that doubles, logged once each way, in order, never blocking', async () => {
  const answers = [503, 503, 0, 200, 404, 200], calls = arrivals<string>(), logs: string[] = [], pauses: number[] = [];
  const send: typeof fetch = async (_, init) => { calls.add(String(init!.body)); const a = answers.shift()!; if (!a) throw new Error(`connect ECONNREFUSED (key ${SECRET})`); return new Response('', { status: a }); };
  const p = new Publisher(EventsConfig.parse({ targets: [{ type: 'webhook', url: 'http://receiver.test/in' }] }), { redact, send, log: l => logs.push(redact(l)), pause: async ms => { pauses.push(ms); } });
  p.start();
  const before = performance.now();
  for (const n of ['one', 'two', 'three']) p.emit({ type: 'hook', name: n, text: n, tone: 'accent' }, AT);
  assert.ok(performance.now() - before < 50, 'emit returns at once');
  await calls.until(6);
  // one: 503, 503, refused, then taken; two: 404, so the receiver doesn't want it and it's let go; three: taken
  assert.deepEqual(calls.got.map(b => JSON.parse(b).name), ['one', 'one', 'one', 'one', 'two', 'three']);
  assert.deepEqual(pauses, [1000, 2000, 4000]);
  assert.deepEqual(logs, ['events: webhook receiver.test answered 503; trying again until it takes them', 'events: webhook receiver.test answers again', 'events: webhook receiver.test answered 404']);
  p.stop();
});

test('while a webhook is down, at most a bounded queue waits, newest kept; stopping lets it all go', async () => {
  let release!: () => void;
  const stuck = new Promise<void>(ok => { release = ok; }), calls = arrivals<string>();
  const p = new Publisher(EventsConfig.parse({ targets: [{ type: 'webhook', url: 'http://receiver.test/in' }] }), { redact, send: async (_, init) => { calls.add(String(init!.body)); if (calls.got.length === 1) await stuck; return new Response(''); } });
  p.start();
  for (let i = 0; i < QUEUE + 50; i++) p.emit({ type: 'hook', name: String(i), text: '', tone: 'accent' }, AT);
  await calls.until(1);
  release();
  await calls.until(QUEUE + 1);
  await new Promise(r => setImmediate(r));
  const names = calls.got.map(b => JSON.parse(b).name);
  assert.equal(names[0], '0', 'the one on its way'); assert.equal(names.length, QUEUE + 1, 'and the queue\'s worth behind it');
  assert.equal(names.at(-1), String(QUEUE + 49)); assert.equal(names[1], '50', 'the oldest waiting were let go');
  p.stop();
  p.emit(down, AT);
  await new Promise(r => setImmediate(r));
  assert.equal(calls.got.length, QUEUE + 1, 'nothing after stop');
});

test('filters: `on` at the top, narrowed per target; nothing goes out before start or after stop', async () => {
  const a = arrivals<string>(), b = arrivals<string>();
  const to = (got: typeof a): typeof fetch => async (_, init) => { got.add(JSON.parse(String(init!.body)).type); return new Response(''); };
  const config = EventsConfig.parse({ on: ['service', 'hook'], targets: [{ type: 'webhook', url: 'http://a.test/' }, { type: 'webhook', url: 'http://b.test/', on: ['hook'] }] });
  const send: typeof fetch = (url, init) => (String(url).includes('a.test') ? to(a) : to(b))(url, init);
  const p = new Publisher(config, { redact, send });
  p.emit(down, AT);
  p.start();
  for (const e of [down, { type: 'notice', text: 'n', tone: 'accent', source: 'x' }, { type: 'hook', name: 'h', text: 'h', tone: 'good' }] as Out[]) p.emit(e, AT);
  await a.until(2); await b.until(1);
  p.stop(); p.emit(down, AT);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(a.got, ['service', 'hook']); assert.deepEqual(b.got, ['hook']);
  assert.equal(EventsConfig.safeParse({ on: ['everything'] }).success, false);
  assert.equal(EventsConfig.safeParse({ targets: [{ type: 'webhook', url: 'file:///etc/passwd' }] }).success, false);
  assert.equal(EventsConfig.safeParse({ targets: [{ type: 'webhook', url: 'http://x/', secret: 'short' }] }).success, false);
  for (const bad of ['http://broker:1883', 'mqtt://user:pw@broker', 'mqtt://broker/topic', 'mqtt://']) assert.equal(EventsConfig.safeParse({ targets: [{ type: 'mqtt', url: bad }] }).success, false, bad);
  for (const bad of ['a/+', 'a/#', '/valet', 'valet/', 'a//b', 'has space']) assert.equal(EventsConfig.safeParse({ targets: [{ type: 'mqtt', url: 'mqtt://b', topic: bad }] }).success, false, bad);
  assert.deepEqual(EventsConfig.parse({ targets: [{ type: 'mqtt', url: 'mqtts://broker.lan:8883' }] }).targets[0], { type: 'mqtt', url: 'mqtts://broker.lan:8883', topic: 'valet', retain: true, qos: 0, keepalive: 60 });
});

test('topics: a state per service, activity and backup, kept by the broker; moments are not', () => {
  assert.deepEqual(topicOf(down), { topic: 'service/plex', state: true });
  assert.deepEqual(topicOf({ type: 'activity', state: 'start', widget: 'downloads.active', title: 'x' }), { topic: 'activity/downloads-active', state: true });
  assert.deepEqual(topicOf({ type: 'backup', state: 'problem', name: 'Offsite copy', source: 'backrest', health: 'failed', text: 'x' }), { topic: 'backup/offsite-copy', state: true });
  assert.deepEqual(topicOf({ type: 'hook', name: 'sonarr', text: 'x', tone: 'good' }), { topic: 'hook/sonarr', state: false });
  assert.deepEqual(topicOf({ type: 'notice', text: 'x', tone: 'good', source: 'y' }), { topic: 'notice', state: false });
  assert.deepEqual(topicOf({ type: 'ask', id: 'a', from: 'MCP client', tool: 't', title: 'x' }), { topic: 'ask', state: false });
  // a name can't climb or branch the tree: no slashes, wildcards or NULs survive
  for (const [name, want] of [['Home Assistant', 'home-assistant'], ['a/../#/+', 'a'], ['Café Wi‑Fi', 'café-wi-fi'], ['', 'unnamed'], ['///', 'unnamed'], ['x\u0000y', 'x-y']]) assert.equal(slug(name), want, name);
  assert.equal(slug('y'.repeat(500)).length, 60);
});

/** A broker that welcomes, acknowledges, and keeps every PUBLISH it hears */
async function broker() {
  const pubs = arrivals<{ topic: string; payload: string; retain: boolean; qos: number }>(), conns = arrivals<Socket>(), connects: Buffer[] = [];
  const server = createServer(sock => {
    const d = new Decoder(2 ** 20); conns.add(sock); sock.on('error', () => {});
    sock.on('data', ch => { for (const p of d.push(ch as Buffer)) {
      if (p.type === 1) { connects.push(p.body); sock.write(Buffer.from([0x20, 2, 0, 0])); }
      if (p.type === 3) { const n = p.body.readUInt16BE(0), qos = (p.flags >> 1) & 3; if (qos) sock.write(Buffer.from([0x40, 2, p.body[2 + n], p.body[3 + n]])); pubs.add({ topic: p.body.subarray(2, 2 + n).toString(), payload: p.body.subarray(2 + n + (qos ? 2 : 0)).toString(), retain: !!(p.flags & 1), qos }); }
    } });
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  return { url: `mqtt://127.0.0.1:${(server.address() as any).port}`, pubs, conns, connects, close: () => { for (const s of conns.got) s.destroy(); server.close(); } };
}

test('to a broker: online, then each event under its topic, retained where it\'s a state, offline on the way out', async () => {
  const b = await broker();
  const p = new Publisher(EventsConfig.parse({ targets: [{ type: 'mqtt', url: b.url, topic: 'home/valet', username: 'valet', password: 'mqtt-pass-123', qos: 1 }] }), { redact });
  p.emit(down, AT);
  assert.equal(b.conns.got.length, 0, 'nothing connects until the site goes live');
  p.start();
  p.emit(down, AT);
  p.emit({ type: 'hook', name: 'Uptime Kuma', text: 'Plex is down', tone: 'bad' }, AT);
  await b.pubs.until(3);
  assert.deepEqual(b.pubs.got.map(x => [x.topic, x.retain, x.qos]), [['home/valet/status', true, 1], ['home/valet/service/plex', true, 1], ['home/valet/hook/uptime-kuma', false, 1]]);
  assert.equal(b.pubs.got[0].payload, 'online');
  assert.deepEqual(JSON.parse(b.pubs.got[1].payload), { type: 'service', at: '2026-11-03T09:30:00.000Z', state: 'down', name: 'Plex', widget: 'svc.status', detail: 'refused (key •••)' });
  // the will is set, so the broker says offline for Valet if it vanishes; a clean stop says it itself
  assert.match(b.connects[0].toString('latin1'), /home\/valet\/status.*offline.*valet.*mqtt-pass-123/s);
  p.stop();
  await b.pubs.until(4);
  assert.deepEqual([b.pubs.got[3].topic, b.pubs.got[3].payload, b.pubs.got[3].retain], ['home/valet/status', 'offline', true]);
  b.close();
});

const opts = { path: 'none', rebuild: async () => {} };
const stopAll = (s: Awaited<ReturnType<typeof buildSite>>) => { s.hub.dispose(); s.watches.stop(); s.rules.stop(); s.stopBackups(); s.stopReminders(); s.stopEvents(); };

test('a site: a service going down and an activity starting, by the same detection as live.notify, published; checks connect nothing', async () => {
  const b = await broker();
  const yaml = (topic: string) => JSON.stringify({ backups: false, notify: { webPush: { enabled: false } }, events: { targets: [{ type: 'mqtt', url: b.url, topic }] } });
  // checking a config, as `config check` does, builds no publisher and reaches no broker
  const { check } = await import('../src/server/site.ts');
  check(parseConfig(yaml('valet')), {});
  assert.equal(b.conns.got.length, 0);

  const site = await buildSite(parseConfig(yaml('valet')), {}, new Set(), opts);
  await b.pubs.until(1);
  const status = (ok: boolean) => ({ type: 'status', items: [{ name: 'Plex', ok }, { name: 'Sonarr', ok: true }] });
  site.instances.set('svc', { widgets: {} } as any);
  const change = (site.hub as any).onChange as (k: string, p: any, n: any) => void;
  change('svc.status', { card: status(true) }, { card: status(false) });
  change('svc.status', { card: status(false) }, { card: status(true) });
  change('dl.active', { card: { type: 'list', items: [] } }, { card: { type: 'list', items: [], activity: { title: 'Ubuntu ISO', icon: 'download' } } });
  await b.pubs.until(4);
  assert.deepEqual(b.pubs.got.slice(1).map(x => { const e = JSON.parse(x.payload); return [x.topic, x.retain, e.type, e.state, e.name ?? e.title]; }),
    [['valet/service/plex', true, 'service', 'down', 'Plex'], ['valet/service/plex', true, 'service', 'up', 'Plex'], ['valet/activity/dl-active', true, 'activity', 'start', 'Ubuntu ISO']]);

  // a reload with the same events keeps the connection; one that changes them closes the old one before the new connects
  const same = await buildSite(parseConfig(yaml('valet')), {}, new Set(), opts, site);
  stopAll(site);
  assert.equal(same.events, site.events); assert.equal(b.conns.got.length, 1);
  same.events.emit(down, AT);
  await b.pubs.until(5);
  const moved = await buildSite(parseConfig(yaml('house')), {}, new Set(), opts, same);
  stopAll(same);
  await b.pubs.until(7);
  assert.deepEqual(b.pubs.got.slice(5).map(x => [x.topic, x.payload]), [['valet/status', 'offline'], ['house/status', 'online']]);
  assert.equal(b.conns.got.length, 2);
  // stopping the live one says goodbye; stopping the old one again does nothing to the new
  stopAll(same);
  moved.events.emit(down, AT);
  await b.pubs.until(8);
  assert.equal(b.pubs.got[7].topic, 'house/service/plex');
  stopAll(moved);
  await b.pubs.until(9);
  assert.equal(b.pubs.got[8].payload, 'offline');
  b.close();
});

test('never in a sandbox: no publisher, no hooks a rule could wait on', async () => {
  const b = await broker();
  sandbox.on = true;
  try {
    const site = await buildSite(Config.parse({ backups: false, hooks: { cron: { token: 'hook-token-cron-0123456789abcdef0123' } }, events: { targets: [{ type: 'mqtt', url: b.url }] } }), {}, new Set(), opts);
    site.events.emit(down, AT);
    assert.deepEqual(site.rules.env.hooks(), []);
    stopAll(site);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(b.conns.got.length, 0);
  } finally { sandbox.on = false; b.close(); }
});
