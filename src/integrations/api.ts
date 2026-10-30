// Any JSON API as a card, from YAML alone: name a URL, say where the numbers are. The no-code way to add a service
// Valet doesn't know. Fields are a path into the response (`data.speed`, `items[0].name`, `$` for the whole thing),
// optionally through formats (`size|bytes`, `ratio|pct`, `started|ago`, `speed|round:1`). A string with braces is a
// template: "{used|bytes} of {total|bytes}". docs/configuration.md has worked examples.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, fmt } from '../server/core.ts';
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
const ago = (v: unknown) => {
  const m = Math.max(0, Math.round((Date.now() - when(v).getTime()) / 60_000));
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
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
const one = (expr: string, data: unknown) => {
  const [path, ...formats] = expr.split('|').map(s => s.trim());
  let v = pick(data, path);
  for (const f of formats) {
    const [name, arg] = f.split(':');
    if (!Object.hasOwn(FORMATS, name)) throw new Error(`unknown format "${name}" (have: ${Object.keys(FORMATS).join(', ')})`);
    if (v == null) break;
    v = FORMATS[name](v, arg);
  }
  return v;
};
/** A path (keeps its type) or a template with {paths} in it (always text). */
export function fill(field: string | undefined, data: unknown): any {
  if (field == null) return undefined;
  if (!field.includes('{')) return one(field, data) ?? undefined;
  return field.replace(/\{([^{}]+)\}/g, (_, e: string) => String(one(e, data) ?? '')).trim() || undefined;
}
const text = (field: string | undefined, data: unknown) => { const v = fill(field, data); return v == null ? undefined : String(v); };

// up, ok, healthy, running, online, active, true, 1, 200: anything else is down
const isUp = (v: unknown) => typeof v === 'string' ? /^(up|ok|okay|healthy|running|online|active|true|connected|success|1|2\d\d)$/i.test(v.trim()) : !!v && (typeof v !== 'number' || (v > 0 && v < 400));
// warn and bad are thresholds: above them is worse, or below them when warn > bad (say, free space)
const toneOf = (n: number, warn?: number, bad?: number) => {
  if (!Number.isFinite(n)) return undefined;
  const lower = warn != null && bad != null && warn > bad;
  const past = (t?: number) => t != null && (lower ? n <= t : n >= t);
  return past(bad) ? 'bad' as const : past(warn) ? 'warn' as const : warn != null || bad != null ? 'good' as const : undefined;
};

const Stat = z.object({ label: z.string(), value: z.string(), unit: z.string().optional(), sub: z.string().optional(), max: z.number().optional(), warn: z.number().optional(), bad: z.number().optional() });
const Rows = z.object({ items: z.string().default('$'), limit: z.number().int().min(1).max(100).default(10) });

export default defineIntegration({
  type: 'api',
  name: 'Custom API',
  config: z.object({
    url: z.string().url(),
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
  }),
  create(cfg, ctx) {
    const shown = [cfg.stats, cfg.list, cfg.rows, cfg.status].filter(Boolean).length;
    if (shown !== 1) throw new Error(`say how to show it with exactly one of stats, list, rows or status (found ${shown})`);
    const base = { title: cfg.title, icon: cfg.icon, href: cfg.href };
    const array = (d: unknown, path: string) => {
      const v = pick(d, path);
      if (!Array.isArray(v)) throw new Error(`"${path}" isn't a list in the response`);
      return v as unknown[];
    };
    async function card(): Promise<Card> {
      const d = await ctx.http<any>(cfg.url, { method: cfg.method, headers: { Accept: 'application/json', ...(cfg.body != null && typeof cfg.body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...cfg.headers },
        body: cfg.body == null ? undefined : typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body), timeout: 15_000 });
      if (cfg.stats) {
        const items = cfg.stats.map(s => {
          const raw = fill(s.value, d), n = Number(typeof raw === 'number' ? raw : s.value.includes('{') ? NaN : pick(d, s.value.split('|')[0].trim()));
          return { label: s.label, value: raw == null ? '–' : typeof raw === 'number' ? raw : String(raw), unit: s.unit, sub: text(s.sub, d), tone: toneOf(n, s.warn, s.bad), pct: s.max && Number.isFinite(n) ? Math.max(0, Math.min(1, n / s.max)) : undefined };
        });
        const summaries: Summary[] = items.slice(0, 4).map(i => ({ label: i.label, icon: cfg.icon, value: `${i.value}${i.unit ?? ''}`, sub: i.sub, tone: i.tone, pct: i.pct }));
        return { ...base, type: 'stats', items, summaries };
      }
      if (cfg.list) {
        const l = cfg.list, list = array(d, l.items);
        const items = list.slice(0, l.limit).map(x => ({ title: text(l.title, x) ?? '–', subtitle: text(l.subtitle, x), meta: text(l.meta, x), image: text(l.image, x), href: text(l.href, x), pct: l.pct ? Number(fill(l.pct, x)) : undefined }));
        return { ...base, type: 'list', items, empty: 'Nothing here', summary: { label: cfg.title, icon: cfg.icon, value: String(list.length) } };
      }
      if (cfg.status) {
        const s = cfg.status;
        const items = array(d, s.items).slice(0, s.limit).map(x => ({ name: text(s.name, x) ?? '–', ok: isUp(fill(s.ok, x)), detail: text(s.detail, x), href: text(s.href, x), group: text(s.group, x) }));
        const down = items.filter(i => !i.ok).length;
        return { ...base, type: 'status', items, summary: { label: cfg.title, icon: cfg.icon, value: down ? `${down} down` : 'All up', sub: `${items.length} total`, tone: down ? 'bad' : 'good' } };
      }
      return { ...base, type: 'kv', rows: Object.entries(cfg.rows!).map(([k, v]) => [k, text(v, d) ?? '–']) };
    }
    return {
      widgets: { data: { title: cfg.title, interval: cfg.every, fetch: card } },
      tools: {
        read: {
          label: `Checked ${cfg.title}`,
          description: `${cfg.about ?? `Current ${cfg.title} data from a custom API.`} Returns what the ${cfg.title} card shows.`,
          access: 'read', input: z.object({}),
          async run() {
            const c = await card();
            const data = c.type === 'stats' ? c.items.map(i => ({ [i.label]: `${i.value}${i.unit ?? ''}`, note: i.sub })) : c.type === 'kv' ? Object.fromEntries(c.rows) : c.type === 'list' || c.type === 'status' ? c.items : null;
            return { data, card: c };
          },
        },
      },
    };
  },
});
