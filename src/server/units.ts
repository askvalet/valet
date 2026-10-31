// `format.temperature` and `format.distance`: what services report, in the units you read. Integrations keep writing
// what they're given, and this turns every card they produce as it leaves them, so none of them need to know.
import type { Format } from './config.ts';
import type { Instance } from './core.ts';

type Units = Pick<Format, 'temperature' | 'distance'>;
const round = (n: number, like: string) => n.toFixed(Math.min(like.split('.')[1]?.length ?? 0, 2));
const CONVERT: Record<string, { from: string; to: string; go: (n: number) => number }> = {
  f: { from: '°C', to: '°F', go: c => c * 1.8 + 32 }, c: { from: '°F', to: '°C', go: f => (f - 32) / 1.8 },
  mi: { from: 'km', to: 'mi', go: k => k / 1.609344 }, km: { from: 'mi', to: 'km', go: m => m * 1.609344 },
};

function walk(v: unknown, rules: typeof CONVERT[string][]): unknown {
  if (typeof v === 'string') return rules.reduce((s, r) =>
    s.replace(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s?${r.from}(?![\\w/])`, 'g'), (_, n) => `${round(r.go(+n), n)}${r.from.startsWith('°') ? '' : ' '}${r.to}`), v);
  if (Array.isArray(v)) return v.map(x => walk(x, rules));
  if (v && typeof v === 'object') {
    // a number and its unit can sit apart: { value: 46, unit: "°C" }
    const o = v as Record<string, unknown>, r = rules.find(r => typeof o.unit === 'string' && o.unit.trim() === r.from);
    const out = Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x, rules)]));
    if (r && o.value != null && o.value !== '' && Number.isFinite(+o.value!)) { const n = round(r.go(+o.value!), String(o.value)); out.value = typeof o.value === 'number' ? +n : n; out.unit = (o.unit as string).replace(r.from, r.to); }
    return out;
  }
  return v;
}

/** The same instance, its widgets and tools answering in these units. With both on auto it's handed straight back. */
export function inUnits<I extends Instance>(inst: I, units: Units) {
  const rules = [CONVERT[units.temperature], CONVERT[units.distance]].filter(Boolean);
  if (!rules.length) return inst;
  for (const w of Object.values(inst.widgets)) { const fetch = w.fetch.bind(w); w.fetch = async () => walk(await fetch(), rules) as Awaited<ReturnType<typeof fetch>>; }
  for (const t of Object.values(inst.tools ?? {})) {
    const run = t.run.bind(t);
    t.run = async args => { const out = await run(args); return out.card ? { ...out, card: walk(out.card, rules) as typeof out.card } : out; };
  }
  return inst;
}
