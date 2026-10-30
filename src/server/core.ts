// The integration API. Built-in and community integrations are written against exactly this.
//
// An integration turns one block of config.yaml into:
//   widgets  cards for the homepage, refreshed on an interval while someone is looking
//   actions  things the homepage controls can do (toggle a light, pause a download)
//   tools    what the assistant may call; each is 'read', 'write' (adds something, e.g. saves a bookmark: runs without
//            asking) or 'control' (changes or removes something: asks the person first). Config decides which it gets.
// Everything runs on the server, so API keys and internal URLs never reach the browser.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { z } from 'zod';
import type { Card } from '../shared/cards.ts';

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
  /** The tool that reverses this one, given the same input: it adds Undo in the activity log. */
  undo?: string;
  /** For 'write' tools: input fields that must come word for word from the person's own latest message for the tool to
   *  run without asking (e.g. the link they pasted). Otherwise, say when a document or web page suggested it, it asks. */
  fromPerson?: string[];
  input: z.ZodType<A>;
  /** `data` goes to the model (keep it compact); `card` is what the person sees in chat. */
  run(args: A): Promise<{ data: unknown; card?: Card }>;
}

export interface Instance {
  widgets: Record<string, Widget>;
  actions?: Record<string, Action>;
  tools?: Record<string, Tool>;
  /** Serve an image (poster, camera snapshot) through Valet so the browser never needs the service's key.
   *  Cards point at it with ctx.image(ref); validate `ref` before fetching. */
  image?(ref: string): Promise<Response>;
}

export interface Context {
  id: string;                            // the instance's key in config.yaml, e.g. "downloads"
  /** fetch with a timeout and a readable error; returns parsed JSON unless `as: 'text'` */
  http<T = any>(url: string, init?: RequestInit & { timeout?: number; as?: 'json' | 'text' | 'response' }): Promise<T>;
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

export function makeContext(id: string): Context {
  return {
    id,
    async http(url, init = {}) {
      const { timeout = 8000, as = 'json', ...rest } = init;
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
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
