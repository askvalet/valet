// The integration API. Built-in and community integrations are written against exactly this.
//
// An integration turns one block of config.yaml into:
//   widgets  cards for the homepage, refreshed on an interval while someone is looking
//   actions  things the homepage controls can do (toggle a light, pause a download)
//   tools    what the assistant may call; each is 'read', 'write' (adds something, e.g. saves a bookmark) or 'control' (changes or removes
//            something). Anything but 'read' asks the person first. Config decides which it gets.
// Everything runs on the server, so API keys and internal URLs never reach the browser.
import { usedSecrets } from './config.ts';
import { redactor } from './security.ts';
import type { Format } from './config.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { z } from 'zod';
import type { RecapSlide, Card, Confirm } from '../shared/cards.ts';

export type Access = 'read' | 'write' | 'control';

export interface Widget {
  title: string;
  interval?: number;                     // ms between refreshes while visible (default 10 s)
  fetch(): Promise<Card>;
}

export interface Action<A = any> {
  description: string;
  input: z.ZodType<A>;
  run(args: A): Promise<unknown>;
}

export interface Tool<A = any> {
  description: string;                   // written for the model: what it returns and when to use it
  access: Access;
  /** What it did, for the person, past tense: "Searched documents". Shown on its chip in chat. */
  label?: string;
  /** A couple of natural next questions to offer after an answer that used it. */
  followUps?: string[];
  /** The input field that takes search words, if this tool searches: it then joins the assistant's search_everything. */
  find?: string;
  /** Its card stays current in the chat: the page re-runs it every few seconds while it's on screen. Only for cheap,
   *  look-only tools whose answer changes by itself. */
  live?: boolean;
  /** For tools that ask first: what's about to happen, as a person would say it. May look things up (never change them),
   *  and should show what the service says, not what the model typed. */
  confirm?(input: A): Confirm | Promise<Confirm>;
  /** The tool that reverses this one, given the same input: it adds Undo in the activity log. */
  undo?: string;
  input: z.ZodType<A>;
  /** `data` goes to the model (keep it compact); `card` is what the person sees in chat. */
  run(args: A): Promise<{ data: unknown; card?: Card }>;
}

export interface Instance {
  /** Someone just asked the assistant something; returns the widgets to refresh now. */
  onChat?(): string[] | void;
  widgets: Record<string, Widget>;
  /** An address its cards embed. The page's content security policy names it once this config is the live one. */
  frame?: string;
  actions?: Record<string, Action>;
  tools?: Record<string, Tool>;
  /** Serve an image (poster, camera snapshot) or a video through Valet so the browser never needs the service's key.
   *  Cards point at it with ctx.image(ref); validate `ref` before fetching. `range` is the browser's Range header, which
   *  a video needs answered on phones. `Cache-Control: no-store` on the response keeps a picture that changes out of the cache. */
  image?(ref: string, range?: string): Promise<Response> | Response;
  /** What this service can say about a stretch of time, for the year in review. Leave out anything it can't really know. */
  recap?(range: { year: number; from: number; to: number }): Promise<RecapSlide[]>;
}

export interface Context {
  id: string;                            // the instance's key in config.yaml, e.g. "downloads"
  format?: Partial<Format>;              // the config's `format:`, for a service that can answer in the right units
  /** fetch with a timeout and a readable error; returns parsed JSON unless `as: 'text'` */
  http<T = any>(url: string, init?: RequestInit & { timeout?: number; as?: 'json' | 'text' | 'response'; insecure?: boolean }): Promise<T>;
  log(...args: unknown[]): void;
  /** URL for a card image served by this instance's image() */
  image(ref: string): string;
  /** a file the person attached in chat (ids come from the message), for tools that file things away */
  upload(id: string): Promise<{ name: string; type: string; data: Buffer }>;
  /** For services that sign in and hand back a session (a cookie, a token). get() signs in once and reuses it; parallel
   *  callers share one sign-in; reset() after the service says the session expired. */
  session<T>(login: () => Promise<T>): { get(): Promise<T>; reset(): void };
}

export function session<T>(login: () => Promise<T>) {
  let value: Promise<T> | null = null;
  return {
    get() {
      value ??= login();
      value.catch(() => { value = null; });   // a failed sign-in is retried next time, not cached
      return value;
    },
    reset() { value = null; },
  };
}

export interface Integration<C = any> {
  type: string;                          // the `type:` value in config.yaml
  name: string;
  config: z.ZodType<C>;
  create(cfg: C, ctx: Context): Instance;
}

export const defineIntegration = <C>(i: Integration<C>) => i;

/** Proxmox, TrueNAS and many appliances ship a self-signed certificate. fetch can't accept one for a single request, so
 *  a service that opts in with `insecure: true` goes through node:https. Only that service, and only when asked. */
async function selfSigned(url: string, init: RequestInit, timeout: number) {
  const { request } = await import('node:https');
  const body = init.body == null ? undefined : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
  return new Promise<Response>((ok, no) => {
    const req = request(url, { method: init.method ?? 'GET', headers: init.headers as Record<string, string>, rejectUnauthorized: false, timeout }, res => {
      const parts: Buffer[] = [];
      res.on('data', d => parts.push(d));
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [v ?? []].flat()) headers.append(k, x);
        const status = res.statusCode ?? 502;
        ok(new Response(status === 204 || status === 304 ? null : Buffer.concat(parts), { status, headers }));
      });
    });
    req.on('error', no); req.on('timeout', () => req.destroy(new Error('timed out')));
    req.end(body);
  });
}

const redactLog = redactor(usedSecrets);
const MAX_BODY = 32 * 2 ** 20;
/** A reply as text, up to what any service has reason to send: past that it's refused rather than held in memory. */
export async function bounded(res: Response, max = MAX_BODY) {
  if (Number(res.headers.get('content-length') ?? 0) > max) { await res.body?.cancel(); throw new Error('the reply is too large'); }
  const reader = res.body?.getReader(), parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const r = await reader?.read();
    if (!r || r.done) break;
    size += r.value.length;
    if (size > max) { await reader!.cancel(); throw new Error('the reply is too large'); }
    parts.push(r.value);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** fetch, but keys stay with the service they belong to. fetch drops Authorization and cookies on a redirect to another
 *  origin and keeps every other header, which is where most services carry their key. */
export async function keptHome(url: string, init: RequestInit, hops = 5): Promise<Response> {
  if (init.redirect === 'manual') return fetch(url, init);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  const to = res.status >= 300 && res.status < 400 && res.headers.get('location');
  if (!to) return res;
  if (!hops) throw new Error('too many redirects');
  await res.body?.cancel();
  const from = new URL(url), next = new URL(to, url), home = next.origin === from.origin || (next.hostname === from.hostname && next.protocol === 'https:' && next.port === '');
  // 307 and 308 resend the body as it was: a login form or a token must not follow a redirect to someone else
  if (!home && (res.status === 307 || res.status === 308) && init.body != null) throw new Error(`${from.host} redirected a request with a body to ${next.host}; not followed`);
  const get = res.status === 303 || ((res.status === 301 || res.status === 302) && init.method && init.method !== 'GET' && init.method !== 'HEAD');
  return keptHome(next.href, { ...init, ...(get ? { method: 'GET', body: undefined } : {}), headers: home ? init.headers : { Accept: new Headers(init.headers).get('accept') ?? '*/*' } }, hops - 1);
}

export function makeContext(id: string, format?: Partial<Format>): Context {
  return {
    id, format,
    async http(url, init = {}) {
      const { timeout = 8000, as = 'json', insecure, ...rest } = init;
      const res = insecure && url.startsWith('https:') ? await selfSigned(url, rest, timeout) : await keptHome(url, { ...rest, signal: AbortSignal.timeout(timeout) });
      if (as === 'response') return res as any;
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      const text = await bounded(res);
      return (as === 'text' ? text : JSON.parse(text)) as any;
    },
    log: (...a) => console.log(`[${id}]`, ...a.map(x => typeof x === 'string' ? redactLog(x) : x)),
    image: ref => `/api/image/${encodeURIComponent(id)}?ref=${encodeURIComponent(ref)}`,
    upload: readUpload,
    session,
  };
}

// Files attached in chat: kept for a day under data/uploads, named <id>.<meta> and <id>.bin
export const UPLOAD_DIR = resolve(process.env.VALET_DATA ?? 'data', 'uploads');
export async function readUpload(fileId: string) {
  if (!/^[a-f0-9]{24}$/.test(fileId)) throw new Error('bad file id');
  const meta = JSON.parse(await readFile(resolve(UPLOAD_DIR, `${fileId}.json`), 'utf8').catch(() => { throw new Error('that file has expired; attach it again'); }));
  return { name: String(meta.name), type: String(meta.type), data: await readFile(resolve(UPLOAD_DIR, `${fileId}.bin`)) };
}

/** A service's icon from its name: "Uptime Kuma" → uptime-kuma. The server tries shorter forms when that's not an icon
 *  ("immich_postgres" finds immich), and a name with none shows no icon at all. */
/** Integration types whose logo goes by another name in dashboard-icons, or is its parent project's. */
export const LOGO: Record<string, string> = {
  homeassistant: 'home-assistant', pihole: 'pi-hole', uptimekuma: 'uptime-kuma', hackernews: 'hacker-news', apcups: 'apc',
  moonraker: 'klipper', sparkyfitness: 'sparky-fitness', swag: 'linuxserver-io', tandoor: 'tandoor-recipes',
  arr: 'sonarr', indexers: 'prowlarr', repository: 'github', releases: 'github',
};
export const iconFor = (name: string) => { const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64); return `/api/icon/${LOGO[slug.replace(/-/g, '')] ?? slug}`; };

// Small formatting helpers integrations share, so numbers read the same everywhere.
export const fmt = {
  /** "Oct 29, 2024" */
  day: (d?: string | number | Date) => d == null || d === '' ? undefined : new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }),
  /** "6:31 PM" */
  time: (d: string | number | Date) => new Date(d).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }),
  /** "Tonight", "Tomorrow", "Fri", "Nov 4" (and "Yesterday") */
  relativeDay(iso: string | number | Date) {
    const d = new Date(iso), today = new Date(new Date().toDateString()).getTime();
    const diff = Math.floor((new Date(d.toDateString()).getTime() - today) / 864e5);
    if (diff === -1) return 'Yesterday';
    if (diff === 0) return d.getHours() >= 17 ? 'Tonight' : 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en', { weekday: 'short' });
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  },
  bytes(n: number, d = 1) {
    if (!Number.isFinite(n)) return '–';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0;
    while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? d : 0)} ${u[i]}`;
  },
  rate: (bps: number) => `${fmt.bytes(bps)}/s`,
  /** short speed for tight spaces: "912 KB/s", "1.5 MB/s" */
  speed: (bps: number) => bps < 1024 ** 2 ? `${Math.round(bps / 1024)} KB/s` : `${fmt.bytes(bps, 1)}/s`,
  duration(s: number) {
    if (!Number.isFinite(s) || s < 0 || s > 8640000) return '∞';
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.round(s)}s`;
  },
  pct: (x: number) => `${Math.round(x * 100)}%`,
};
