// What `ctx.lab()` hands an integration that draws the homelab itself (the network map): every other integration, where
// it answers and what its widgets last said. Only host and port leave here, never a path, a query, a user or a key, and an
// address that is itself a secret (url: ${PLEX_URL}) is left out, since the page would only see it blacked out.
import type { Address, Context, Instance, Peer } from './core.ts';
import { LOGO, reached } from './core.ts';
import type { Card, WidgetState } from '../shared/cards.ts';

const URL_KEY = /url$/i;
const MAX = 40;

/** Every url option in a parsed config, as host and port. `label` is the `name` beside it, else the key above it, so a
 *  list of machines or checks says which address is which. */
export function addressesOf(cfg: unknown, redact: (s: string) => string = s => s): Address[] {
  const out: Address[] = [];
  const walk = (v: unknown, path: string[], label?: string) => {
    if (out.length >= MAX || v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, String(i)])); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>, here = typeof o.name === 'string' ? o.name : label;
    for (const [k, x] of Object.entries(o)) {
      if (typeof x === 'string' && URL_KEY.test(k)) {
        const a = addressOf(x, redact);
        if (a) out.push({ ...a, field: [...path, k].join('.'), ...(here ? { label: here } : {}) });
      } else if (x && typeof x === 'object') walk(x, [...path, k], Array.isArray(o) ? undefined : k);
    }
  };
  walk(cfg, []);
  return out;
}

/** host and port from a URL, or nothing if it isn't one or names a secret. */
export function addressOf(url: string, redact: (s: string) => string = s => s): Omit<Address, 'field'> | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (!/^(https?|wss?|tcp|mqtts?):$/.test(u.protocol) || !u.hostname) return undefined;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // a url that is a secret, or has one in its host, comes back without the host once redacted
  if (redact(host) !== host || !redact(url).toLowerCase().includes(host)) return undefined;
  const port = u.port ? Number(u.port) : u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : u.protocol === 'http:' || u.protocol === 'ws:' ? 80 : undefined;
  return { host, ...(port ? { port } : {}) };
}

/** The hosts an integration with no url of its own was seen to call: a fixed API or two. One that reaches many (a feed
 *  reader) has no one place it lives, so it gets none. */
function seenBy(ctx: Context | undefined, redact: (s: string) => string): Address[] {
  const hosts = [...(ctx ? reached.get(ctx) ?? [] : [])];
  if (!hosts.length || hosts.length > 2) return [];
  return hosts.flatMap(h => {
    const at = h.lastIndexOf(':'), host = h.slice(0, at), port = Number(h.slice(at + 1));
    return redact(host) === host ? [{ host, port, field: '', seen: true }] : [];
  });
}

export interface LabParts {
  instances: Map<string, Instance>;
  meta: Map<string, { type: string; name: string; integration: object }>;
  configs: Map<string, unknown>;
  contexts: Map<string, Context>;
  redact: (s: string) => string;
  /** Set once the site is built: what the page's widgets last said, and which are on it. */
  hub?: { snapshot(): WidgetState[]; widget(key: string): unknown };
}

/** Everyone but `self` and Valet's own, as peers. Built fresh on each call, so it reads the hub as it is now. */
export function peersFor(parts: LabParts, self: string): Peer[] {
  const states = new Map((parts.hub?.snapshot() ?? []).map(s => [s.key, s]));
  const out: Peer[] = [];
  for (const [id, inst] of parts.instances) {
    if (id === self || ['valet', 'pins', 'config'].includes(id)) continue;
    const m = parts.meta.get(id);
    if (!m) continue;
    const fromConfig = addressesOf(parts.configs.get(id), parts.redact);
    out.push({
      id, type: m.type, name: m.name, icon: `/api/icon/${(m.integration as { def?: { logo?: string } }).def?.logo ?? LOGO[m.type] ?? m.type}`,
      addresses: fromConfig.length ? fromConfig : seenBy(parts.contexts.get(id), parts.redact),
      widgets: Object.entries(inst.widgets).map(([name, w]) => {
        const key = `${id}.${name}`, s = states.get(key), placed = !!parts.hub?.widget(key);
        return { name, title: w.title, placed, card: s?.card, error: s?.error, at: s?.at,
          read: async (): Promise<Card | undefined> => placed ? states.get(key)?.card : w.fetch() };
      }),
    });
  }
  return out;
}
