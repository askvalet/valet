// The integration API. Built-in and community integrations are written against exactly this.
//
// An integration turns one block of config.yaml into:
//   widgets  cards for the homepage, refreshed on an interval while someone is looking
//   actions  things the homepage controls can do (toggle a light, pause a download)
//   tools    what the assistant may call; each is 'read', 'write' (adds something, e.g. saves a bookmark) or 'control' (changes or removes
//            something). Anything but 'read' asks the person first. Config decides which it gets.
// Everything runs on the server, so API keys and internal URLs never reach the browser.
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

export function makeContext(id: string, format?: Partial<Format>): Context {
  return {
    id, format,
    async http(url, init = {}) {
      const { timeout = 8000, as = 'json', insecure, ...rest } = init;
      const res = insecure && url.startsWith('https:') ? await selfSigned(url, rest, timeout) : await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
      if (as === 'response') return res as any;
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      return (as === 'text' ? res.text() : res.json()) as any;
    },
    log: (...a) => console.log(`[${id}]`, ...a),
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
export const iconFor = (name: string) => `/api/icon/${name.toLowerCase().replace(/^homeassistant$/, 'home-assistant').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)}`;

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
