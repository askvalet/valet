// The integration API. Built-in and community integrations are written against exactly this.
//
// An integration turns one block of config.yaml into:
//   widgets  cards for the homepage, refreshed on an interval while someone is looking
//   actions  things the homepage controls can do (toggle a light, pause a download)
//   tools    what the assistant may call; each is 'read' or 'control', and config decides which it gets
// Everything runs on the server, so API keys and internal URLs never reach the browser.
import type { z } from 'zod';
import type { Card } from '../shared/cards.ts';

export type Access = 'read' | 'control';

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
  input: z.ZodType<A>;
  /** `data` goes to the model (keep it compact); `card` is what the person sees in chat. */
  run(args: A): Promise<{ data: unknown; card?: Card }>;
}

export interface Instance {
  widgets: Record<string, Widget>;
  actions?: Record<string, Action>;
  tools?: Record<string, Tool>;
  /** Serve an image (poster, camera snapshot) through Atrium so the browser never needs the service's key.
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
  };
}

// Small formatting helpers integrations share, so numbers read the same everywhere.
export const fmt = {
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
