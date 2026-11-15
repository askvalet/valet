// Any JSON API as a card, from YAML alone: name a URL, say where the numbers are. The no-code way to add a service
// Valet doesn't know. Fields are a path into the response (`data.speed`, `items[0].name`, `$` for the whole thing),
// optionally through formats (`size|bytes`, `ratio|pct`, `started|ago`, `speed|round:1`). A string with braces is a
// template: "{used|bytes} of {total|bytes}". A field starting with `=` is an expression (expr.ts): `=mem / maxmem|pct`,
// and `{=…}` inside a template. Rows can be kept by `where` and ordered by `sort`. Instead of a `url`, `from` makes the
// card out of another widget's latest card, as Valet already has it. The website's api page has worked examples.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, fmt } from '../server/core.ts';
import { compile, isTrue } from '../server/expr.ts';
import type { Card, Summary } from '../shared/cards.ts';

/** `a.b[0].c`; `$` is the whole response. Only the data's own properties, never the prototype chain. */
export function pick(data: unknown, path: string): unknown {
  if (path === '$' || path === '') return data;
  let v: any = data;
  for (const k of path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (v == null || typeof v !== 'object' || !Object.hasOwn(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

// a timestamp: ISO text, or a number of seconds or milliseconds since 1970
const when = (v: unknown) => new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v as string);
const ago = (v: unknown) => fmt.ago(when(v));
const FORMATS: Record<string, (v: unknown, arg?: string) => unknown> = {
  bytes: v => fmt.bytes(Number(v)),
  rate: v => fmt.rate(Number(v)),
  duration: v => fmt.duration(Number(v)),         // seconds → "3h 12m"
  pct: v => fmt.pct(Number(v)),                   // 0..1 → "42%"
  round: (v, d = '0') => Number(Number(v).toFixed(Number(d))),
  divide: (v, n = '1') => Number(v) / Number(n),
  day: v => fmt.day(when(v)),
  time: v => fmt.time(when(v)),
  ago,
  upper: v => String(v).toUpperCase(),
  lower: v => String(v).toLowerCase(),
  count: v => Array.isArray(v) ? v.length : Object.keys(v ?? {}).length,
};
/** Split at the `|`s that start formats, leaving any inside quotes (an expression's text) alone. */
const pipes = (s: string) => {
  const out: string[] = []; let at = 0, quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === '|') { out.push(s.slice(at, i)); at = i + 1; }
  }
  return [...out, s.slice(at)].map(x => x.trim());
};
/** What a field's head reads before any formats: an expression after `=`, otherwise a path. */
const head = (src: string) => src.startsWith('=') ? compile(src.slice(1)) : (d: unknown) => pick(d, src);
const one = (expr: string, data: unknown) => {
  const [first, ...formats] = pipes(expr);
  let v = head(first)(data);
  for (const f of formats) {
    const [name, arg] = f.split(':');
    if (!Object.hasOwn(FORMATS, name)) throw new Error(`unknown format "${name}" (have: ${Object.keys(FORMATS).join(', ')})`);
    if (v == null) break;
    v = FORMATS[name](v, arg);
  }
  return v;
};
/** A path or `=expression` (keeps its type) or a template with {paths} or {=expressions} in it (always text). */
export function fill(field: string | undefined, data: unknown): any {
  if (field == null) return undefined;
  if (field.startsWith('=') || !field.includes('{')) return one(field, data) ?? undefined;
  return field.replace(/\{([^{}]+)\}/g, (_, e: string) => String(one(e.trim(), data) ?? '')).trim() || undefined;
}
/** The number a field stands for before it's formatted, for thresholds and meters; a template has none. */
const raw = (field: string, data: unknown) => field.startsWith('=') || !field.includes('{') ? head(pipes(field)[0])(data) : undefined;
const text = (field: string | undefined, data: unknown) => { const v = fill(field, data); return v == null ? undefined : String(v); };
/** Read every field once, so a mistake is a config problem at startup rather than a broken card later. */
function checkFields(v: unknown) {
  if (typeof v === 'string') {
    for (const part of v.startsWith('=') ? [v] : [...v.matchAll(/\{([^{}]+)\}/g)].map(m => m[1].trim())) {
      if (!part.startsWith('=')) continue;
      try { compile(pipes(part)[0].slice(1)); } catch (e) { throw new Error(`"${v}": ${(e as Error).message}`); }
    }
  } else if (Array.isArray(v)) v.forEach(checkFields);
  else if (v && typeof v === 'object') Object.values(v).forEach(checkFields);
}

// up, ok, healthy, running, online, active, true, 1, 200: anything else is down
const isUp = (v: unknown) => typeof v === 'string' ? /^(up|ok|okay|healthy|running|online|active|true|connected|success|1|2\d\d)$/i.test(v.trim()) : !!v && (typeof v !== 'number' || (v > 0 && v < 400));
// warn and bad are thresholds: above them is worse, or below them when warn > bad (say, free space)
const toneOf = (n: number, warn?: number, bad?: number) => {
  if (!Number.isFinite(n)) return undefined;
  const lower = warn != null && bad != null && warn > bad;
  const past = (t?: number) => t != null && (lower ? n <= t : n >= t);
  return past(bad) ? 'bad' as const : past(warn) ? 'warn' as const : warn != null || bad != null ? 'good' as const : undefined;
};

/** Which rows, in what order: `where` keeps a row when it's true, `sort` is a path or an expression, `-` first for
 *  the largest first. Rows without a value go last either way. */
function rowsOf(list: unknown[], o: { where?: string; sort?: string; limit: number }) {
  const keep = o.where ? compile(o.where.replace(/^=/, '')) : undefined;
  let out = keep ? list.filter(x => isTrue(keep(x))) : list;
  if (o.sort) {
    const s = o.sort.trim(), down = s.startsWith('-'), by = compile(s.replace(/^-/, '').replace(/^=/, ''));
    const keyed = out.map((x, i) => ({ x, i, k: by(x) }));
    const blank = (k: unknown) => k == null || k === '' || Number.isNaN(k);
    keyed.sort((a, b) => {
      if (blank(a.k) || blank(b.k)) return Number(blank(a.k)) - Number(blank(b.k)) || a.i - b.i;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
      return (down ? -c : c) || a.i - b.i;
    });
    out = keyed.map(k => k.x);
  }
  return { all: out.length, rows: out.slice(0, o.limit) };
}

const Stat = z.object({ label: z.string(), value: z.string(), unit: z.string().optional(), sub: z.string().optional(), max: z.number().optional(), warn: z.number().optional(), bad: z.number().optional() });
const Rows = z.object({ items: z.string().default('$'), limit: z.number().int().min(1).max(100).default(10), where: z.string().optional(), sort: z.string().optional() });
// a widget's key, `instance.widget`, as `layout` writes it
const WidgetKey = z.string().regex(/^[a-z0-9][a-z0-9_-]*\.[A-Za-z0-9_-]+$/i, 'a widget, as instance.widget (e.g. docker.containers)');

export default defineIntegration({
  type: 'api',
  name: 'Custom API',
  config: z.object({
    url: z.string().url().optional(),                          // where to fetch, or:
    from: WidgetKey.optional(),                                // another widget's latest card, e.g. docker.containers: no request, no keys
    method: z.enum(['GET', 'POST']).default('GET'),
    headers: z.record(z.string(), z.string()).default({}),     // ${SECRETS} go here (or in the url), never in the card
    body: z.unknown().optional(),                              // for POST: text, or anything else is sent as JSON
    every: Every.default(60_000),                              // how often to fetch: seconds, or 30s, 5m, 1h
    title: z.string().default('API'),
    icon: z.string().optional(),
    href: z.string().optional(),                               // where the card links to
    about: z.string().optional(),                              // tells the assistant what this is and when to use it
    // choose one way to show it:
    stats: z.array(Stat).optional(),                           // numbers: [{ label, value, unit, sub, max, warn, bad }]
    list: Rows.extend({ title: z.string(), subtitle: z.string().optional(), meta: z.string().optional(), image: z.string().optional(), href: z.string().optional(), pct: z.string().optional() }).optional(),
    rows: z.record(z.string(), z.string()).optional(),         // label → value, as a table
    status: Rows.extend({ name: z.string(), ok: z.string(), detail: z.string().optional(), href: z.string().optional(), group: z.string().optional() }).optional(),
    table: Rows.extend({ columns: z.record(z.string(), z.string()).refine(c => Object.keys(c).length > 0, 'name at least one column') }).optional(),   // heading → field
  }),
  create(cfg, ctx) {
    const sources = [cfg.url, cfg.from].filter(Boolean).length;
    if (sources !== 1) throw new Error(`say where the data comes from with exactly one of url or from (found ${sources})`);
    const shown = [cfg.stats, cfg.list, cfg.rows, cfg.status, cfg.table].filter(Boolean).length;
    if (shown !== 1) throw new Error(`say how to show it with exactly one of stats, list, rows, status or table (found ${shown})`);
    checkFields([cfg.stats, cfg.list, cfg.rows, cfg.status, cfg.table]);
    for (const r of [cfg.list, cfg.status, cfg.table]) for (const [k, src] of [['where', r?.where], ['sort', r?.sort?.trim().replace(/^-/, '')]] as const) {
      if (src) try { compile(src.replace(/^=/, '')); } catch (e) { throw new Error(`${k} "${src}": ${(e as Error).message}`); }
    }
    const base = { title: cfg.title, icon: cfg.icon, href: cfg.href };
    const array = (d: unknown, path: string) => {
      const v = pick(d, path);
      if (!Array.isArray(v)) throw new Error(`"${path}" isn't a list in ${cfg.from ? `${cfg.from}'s card` : 'the response'}`);
      return v as unknown[];
    };
    const load = async (): Promise<unknown> => {
      if (cfg.from) {
        // Valet hands over the card it already has: the source's own request, made with its own keys, and nothing new
        const c = await ctx.card?.(cfg.from);
        if (!c) throw new Error(`${cfg.from} has no card yet`);
        return c;
      }
      return ctx.http<any>(cfg.url!, { method: cfg.method, headers: { Accept: 'application/json', ...(cfg.body != null && typeof cfg.body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...cfg.headers },
        body: cfg.body == null ? undefined : typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body), timeout: 15_000 });
    };
    async function card(): Promise<Card> {
      const d = await load();
      if (cfg.stats) {
        const items = cfg.stats.map(s => {
          const shown = fill(s.value, d), r = raw(s.value, d), n = typeof r === 'number' ? r : r == null || r === '' ? NaN : Number(r);
          return { label: s.label, value: shown == null ? '–' : typeof shown === 'number' ? shown : String(shown), unit: s.unit, sub: text(s.sub, d), tone: toneOf(n, s.warn, s.bad), pct: s.max && Number.isFinite(n) ? Math.max(0, Math.min(1, n / s.max)) : undefined };
        });
        const summaries: Summary[] = items.slice(0, 4).map(i => ({ label: i.label, icon: cfg.icon, value: `${i.value}${i.unit ?? ''}`, sub: i.sub, tone: i.tone, pct: i.pct }));
        return { ...base, type: 'stats', items, summaries };
      }
      if (cfg.list) {
        const l = cfg.list, { all, rows } = rowsOf(array(d, l.items), l);
        const items = rows.map(x => ({ title: text(l.title, x) ?? '–', subtitle: text(l.subtitle, x), meta: text(l.meta, x), image: text(l.image, x), href: text(l.href, x), pct: l.pct ? Number(fill(l.pct, x)) : undefined }));
        return { ...base, type: 'list', items, empty: 'Nothing here', summary: { label: cfg.title, icon: cfg.icon, value: String(all) } };
      }
      if (cfg.status) {
        const s = cfg.status;
        const items = rowsOf(array(d, s.items), s).rows.map(x => ({ name: text(s.name, x) ?? '–', ok: isUp(fill(s.ok, x)), detail: text(s.detail, x), href: text(s.href, x), group: text(s.group, x) }));
        const down = items.filter(i => !i.ok).length;
        return { ...base, type: 'status', items, summary: { label: cfg.title, icon: cfg.icon, value: down ? `${down} down` : 'All up', sub: `${items.length} total`, tone: down ? 'bad' : 'good' } };
      }
      if (cfg.table) {
        const t = cfg.table, { all, rows } = rowsOf(array(d, t.items), t), cols = Object.entries(t.columns);
        const cell = (v: unknown) => v == null || v === '' ? '–' : typeof v === 'number' ? v : String(v);
        return { ...base, type: 'table', columns: cols.map(([k]) => k), rows: rows.map(x => cols.map(([, f]) => cell(fill(f, x)))), summary: { label: cfg.title, icon: cfg.icon, value: String(all) } };
      }
      return { ...base, type: 'kv', rows: Object.entries(cfg.rows!).map(([k, v]) => [k, text(v, d) ?? '–']) };
    }
    return {
      widgets: { data: { title: cfg.title, interval: cfg.every, from: cfg.from, fetch: card } },
      tools: {
        read: {
          label: `Checked ${cfg.title}`,
          description: `${cfg.about ?? `Current ${cfg.title} data from ${cfg.from ? `the ${cfg.from} card` : 'a custom API'}.`} Returns what the ${cfg.title} card shows.`,
          access: 'read', input: z.object({}),
          async run() {
            const c = await card();
            const data = c.type === 'stats' ? c.items.map(i => ({ [i.label]: `${i.value}${i.unit ?? ''}`, note: i.sub })) : c.type === 'kv' ? Object.fromEntries(c.rows)
              : c.type === 'table' ? c.rows.map(r => Object.fromEntries(c.columns.map((k, i) => [k, r[i]]))) : c.type === 'list' || c.type === 'status' ? c.items : null;
            return { data, card: c };
          },
        },
      },
    };
  },
});
