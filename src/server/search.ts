// ⌘K's search inside the services: what's typed goes to every search tool this page may use, all at once, and each
// answer is sent the moment it arrives, so a slow service never holds up a fast one. No model anywhere. The same doors
// as a command: only tools that look (`find` on a `read` tool), only what `assistant.access` leaves on, and every answer
// through the redactor. Answers are kept for a short while, so typing, deleting and retyping asks each service once.
import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import type { Config } from './config.ts';
import type { Instance, Tool } from './core.ts';
import { rank, toolAccess } from './run.ts';
import type { Card } from '../shared/cards.ts';
import { hitsOf, type Found } from '../shared/search.ts';

export interface SearchSite {
  config: Config; instances: Map<string, Instance>; meta: Map<string, { type: string; name: string }>; redact: (s: string) => string;
}
interface Finder { id: string; n: number; inst: string; name: string; source: string; icon?: string; t: Tool }

// Valet's own parts are never searched from here
const OWN = new Set(['config', 'valet', 'pins']);
export const MIN = 2, MAX = 80, WAIT = 4000, KEEP = 30_000, ROWS = 6;

/** Every search tool this page may use, in the config's order, the ones that search by likeness last. */
export function findersOf(site: SearchSite): Finder[] {
  const only = site.config.find;
  if (only === false) return [];
  const a = site.config.assistant, out: Finder[] = [];
  for (const [inst, i] of site.instances) {
    if (OWN.has(inst) || (Array.isArray(only) && !only.includes(inst))) continue;
    const tools = Object.entries(i.tools ?? {}).filter(([name, t]) => t.find && t.access === 'read' && (!a || toolAccess(a, inst, name) >= rank.read));
    const m = site.meta.get(inst);
    for (const [name, t] of tools) out.push({ id: `${inst}__${name}`, n: 0, inst, name, t, icon: m && `/api/icon/${m.type}`,
      source: tools.length > 1 ? `${m?.name ?? inst} · ${(t.label ?? name).replace(/^Searched (the )?/i, '')}` : m?.name ?? inst });
  }
  return [...out.filter(f => !f.t.nearest), ...out.filter(f => f.t.nearest)].map((f, n) => ({ ...f, n }));
}

// One answer per service and query, kept briefly and shared by anyone asking at the same moment. Keyed by the tool
// itself, so a config reload (new instances, new tools) starts clean and nothing outlives its site.
const kept = new WeakMap<Tool, Map<string, { at: number; found: Promise<Card | null> }>>();

async function ask(site: SearchSite, f: Finder, q: string, wait: number): Promise<Card | null> {
  // a tool with a `limit` is asked for a palette's worth; one without takes what it takes
  const input = f.t.input.safeParse({ [f.t.find!]: q, limit: ROWS });
  const args = input.success ? input.data : f.t.input.parse({ [f.t.find!]: q });
  // referenced, like the request waiting on it, and cleared as soon as the service answers
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([f.t.run(args), new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('timed out')), wait); })]);
    if (!out?.card || (out.data as { error?: unknown } | undefined)?.error) return null;
    const card = JSON.parse(site.redact(JSON.stringify(out.card))) as Card;
    return hitsOf(card, 1).length ? card : null;
  } finally { clearTimeout(timer); }
}

export function found(site: SearchSite, f: Finder, q: string, wait = WAIT, now = Date.now()): Promise<Card | null> {
  let mine = kept.get(f.t);
  if (!mine) kept.set(f.t, mine = new Map());
  const key = q.toLowerCase(), hit = mine.get(key);
  if (hit && now - hit.at < KEEP) return hit.found;
  if (mine.size >= 50) for (const [k, v] of mine) if (now - v.at >= KEEP) mine.delete(k);
  if (mine.size >= 50) mine.delete(mine.keys().next().value!);   // still full: the oldest goes
  // a service that couldn't be searched just now is asked again next time, not remembered as empty
  const entry = { at: now, found: ask(site, f, q, wait).catch(() => { if (mine.get(key) === entry) mine.delete(key); return null; }) };
  mine.set(key, entry);
  return entry.found;
}

export const queryOf = (raw: unknown) => (typeof raw === 'string' ? raw : '').trim().replace(/\s+/g, ' ').slice(0, MAX);

/** GET /api/search?q=…: one line of JSON per service as it answers (`card: null` when it found nothing). */
export function search(c: Context, site: SearchSite, wait = WAIT) {
  const q = queryOf(c.req.query('q')), finders = q.length < MIN ? [] : findersOf(site);
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  c.header('X-Accel-Buffering', 'no');
  return stream(c, async s => {
    let open = true;
    s.onAbort(() => { open = false; });
    await Promise.all(finders.map(async f => {
      const t = performance.now(), card = await found(site, f, q, wait);
      const line: Found = { id: f.id, n: f.n, source: f.source, icon: f.icon, card, ms: Math.round(performance.now() - t) };
      if (open) await s.write(`${JSON.stringify(line)}\n`).catch(() => { open = false; });
    }));
  });
}

