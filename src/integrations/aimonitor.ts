// Local AI: GPU load, power, VRAM and temperature, which model is loaded, and today's requests, tokens and electricity
// cost, from any endpoint that answers in the shape below (askvalet.dev/integrations/aimonitor/ has it with an example,
// and examples/local-ai/ is a small server that answers it from nvidia-smi and Ollama). Only /api/live is needed;
// /api/history and /api/cost add the day's graphs and the cost, when they're there.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';

const n = z.preprocess(v => typeof v === 'string' && v.trim() !== '' ? Number(v) : v, z.number());   // "42" is fine too
export const Live = z.object({
  gpu: z.object({ util: n, power: n, temp: n, mem: n, mem_total: n }),            // %, W, °C, MiB, MiB
  model: z.object({ name: z.string(), swapping: z.string().nullish() }),         // what's loaded; what's loading, if anything
  running: z.array(z.object({ app: z.string().nullish() }).loose()).default([]),  // what's generating right now
  today: z.object({ requests: n, tokens: n, kwh: n.optional(), cost: n.optional() }),
  last_query: z.object({ app: z.string().nullish() }).loose().nullish(),
}).loose();
// history rows as [time, util, power, -, mem, temp] and [time, app, requests, tokens], or as objects with those names
const Row = (keys: string[]) => z.union([z.array(z.any()), z.record(z.string(), z.any())]).transform(r => Array.isArray(r) ? r : keys.map(k => r[k]));
export const History = z.object({
  gpu: z.array(Row(['at', 'util', 'power', '', 'mem', 'temp'])).default([]),
  requests: z.array(Row(['at', 'app', 'requests', 'tokens'])).default([]),
  totals: z.object({ avg_tok_s: n.optional(), prompt_tokens: n.optional() }).loose().default({}),
}).loose();
export const Cost = z.object({ days: z.array(z.object({ day: z.string(), cost: n.default(0), tokens: n.default(0), kwh: n.optional() }).loose()).default([]), month: n.default(0) }).loose();
/** The answer in Valet's shape, or an error that says which field isn't. */
const check = <T>(schema: z.ZodType<T>, data: unknown, path: string): T => {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const what = /received undefined/.test(i.message) ? 'is missing' : i.code === 'invalid_type' ? `should be a ${(i as { expected?: string }).expected ?? 'different type'}` : i.message.toLowerCase();
  throw new Error(`${path} isn't in Valet's Local AI format: ${i.path.join('.') || 'the answer'} ${what}. See askvalet.dev/integrations/aimonitor/`);
};

export default defineIntegration({
  type: 'aimonitor',
  name: 'Local AI',
  config: z.object({ url: z.string().url(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const hist = { util: [] as number[], power: [] as number[] };
    let day: { at: number; h?: z.infer<typeof History>; c?: z.infer<typeof Cost> } = { at: 0 };
    const push = (a: number[], v: number) => { a.push(Math.round(v)); if (a.length > 60) a.shift(); };
    async function live() {
      const j = check(Live, await ctx.http(`${base}/api/live`), '/api/live');
      push(hist.util, j.gpu.util); push(hist.power, j.gpu.power);
      return j;
    }
    const heat = (t: number) => t >= 85 ? 'bad' : t >= 75 ? 'warn' : 'neutral';

    const widgets = {
      // the day at a glance: cost, requests, tokens, power, memory and heat, each with its last 24 hours drawn behind it
      usage: {
        title: 'Local AI usage', interval: 5000, card: 'stats',
        async fetch() {
          // the live numbers every few seconds; the day's history and cost don't need asking for as often
          // both optional: without them the card shows today's numbers, without graphs or cost
          if (Date.now() - day.at > 60_000) day = { at: Date.now(), h: await ctx.http(`${base}/api/history`).then(x => check(History, x, '/api/history')).catch(() => undefined), c: await ctx.http(`${base}/api/cost`).then(x => check(Cost, x, '/api/cost')).catch(() => undefined) };
          const { h, c } = day, j = await live();
          const gpuRows = (h?.gpu ?? []) as number[][], buckets = gpuRows.map(r => r[0]);
          const per = (i: 2 | 3) => buckets.map(ts => ((h?.requests ?? []) as any[]).filter(r => r[0] === ts).reduce((s, r) => s + (Number(r[i]) || 0), 0));
          const col = (i: number) => gpuRows.map(r => r[i]).filter(v => v != null) as number[];
          const today = c?.days.at(-1) ?? { cost: j.today.cost ?? 0, tokens: j.today.tokens, kwh: j.today.kwh };
          const known = j.today.cost != null || !!c;
          const tok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
          return {
            type: 'stats', title: 'Local AI usage', icon: 'gpu', href: cfg.href, items: [],
            summaries: [
              ...(known ? [{ label: 'Electricity cost', icon: 'coins', color: '#5ee0a5', value: `${Math.round(today.cost * 100)}¢`, sub: c ? `today · ${Math.round(c.month * 100)}¢ this month` : 'today',
                detail: `${today.kwh?.toFixed(2) ?? '–'} kWh`, trend: c?.days.map(d => d.cost) }] : []),
              { label: 'Requests', icon: 'pulse', color: '#64d2ff', value: j.today.requests.toLocaleString(), sub: 'today',
                detail: h?.totals.avg_tok_s != null ? `${Math.round(h.totals.avg_tok_s)} tok/s avg` : undefined, trend: h ? per(2) : undefined },
              { label: 'Tokens', icon: 'text', color: '#bf9bff', value: tok(today.tokens), sub: 'generated today', detail: h?.totals.prompt_tokens != null ? `${tok(h.totals.prompt_tokens)} read` : undefined, trend: h ? per(3) : undefined },
              { label: 'Power', icon: 'gpu', color: '#ffb454', value: `${Math.round(j.gpu.power)} W`, sub: j.model.name, detail: `${Math.round(j.gpu.temp)}°C`,
                trend: h ? col(2) : undefined, tone: (j.running?.length ?? 0) > 0 ? 'accent' : 'neutral' },
              { label: 'GPU memory', icon: 'disk', color: '#ff7eb6', value: `${(j.gpu.mem / 1024).toFixed(1)} GB`, sub: `of ${Math.round(j.gpu.mem_total / 1024)} GB`, trend: h ? col(4) : undefined },
              { label: 'Temperature', icon: 'pulse', color: '#ff6f59', value: `${Math.round(j.gpu.temp)}°C`, sub: 'GPU', trend: h ? col(5) : undefined, tone: heat(j.gpu.temp) },
            ],
          };
        },
      },
      gpu: {
        title: 'Local AI', interval: 5000, card: 'stats',
        async fetch() {
          const j = await live();
          const g = j.gpu, m = j.model;
          const working = (j.running?.length ?? 0) > 0;
          return {
            type: 'stats', title: 'Local AI', icon: 'gpu', href: cfg.href,
            summary: { label: 'Local AI', icon: 'gpu', value: m.swapping ? 'Loading' : working ? 'Working' : 'Idle', sub: m.name,
              detail: `${Math.round(g.power)} W · ${Math.round(g.temp)}°C`, trend: [...hist.power], tone: working ? 'accent' : 'neutral' },
            note: m.swapping ? `loading ${m.swapping}…` : `${m.name}${working ? ' · working' : ' · idle'}`,
            activity: m.swapping ? { title: 'Loading model', subtitle: m.swapping, icon: 'gpu', tone: 'accent' }
              : working ? { title: 'Local AI', subtitle: `${j.running[0]?.app ? `${j.running[0].app} · ` : ''}${m.name}`, icon: 'gpu', trailing: `${Math.round(g.power)} W`,
                tone: 'accent', count: j.running.length } : undefined,
            items: [
              { label: 'GPU', value: Math.round(g.util), unit: '%', trend: [...hist.util], sub: `${Math.round(g.temp)}°C`, tone: heat(g.temp) },
              { label: 'Power', value: Math.round(g.power), unit: 'W', trend: [...hist.power], tone: 'accent' },
              { label: 'VRAM', value: (g.mem / 1024).toFixed(1), unit: 'GB', pct: g.mem / g.mem_total, sub: `of ${(g.mem_total / 1024).toFixed(0)} GB` },
              { label: 'Today', value: j.today.requests, sub: `${(j.today.tokens / 1e6).toFixed(2)}M tokens${j.today.cost != null ? ` · $${j.today.cost.toFixed(2)}` : ''}` },
            ],
          };
        },
      },
    } satisfies Instance['widgets'];

    return {
      async recap({ from, to }) {
        const days = await ctx.http(`${base}/api/cost`).then(x => check(Cost, x, '/api/cost').days).catch(() => []);
        const inRange = (days as any[]).filter(d => { const t = Date.parse(d.day); return t >= from && t < to; });
        const tokens = inRange.reduce((s, d) => s + (d.tokens ?? 0), 0), cost = inRange.reduce((s, d) => s + (d.cost ?? 0), 0);
        if (!tokens) return [];
        return [{ id: 'ai.tokens', theme: 'ai', icon: 'gpu', bars: inRange.slice(-14).map(d => ({ label: String(new Date(d.day).getUTCDate()), value: d.tokens ?? 0 })), stat: 'AI tokens', kicker: 'Your own AI wrote', value: tokens >= 1e6 ? (tokens / 1e6).toFixed(1) : tokens.toLocaleString('en'), unit: tokens >= 1e6 ? 'million tokens' : 'tokens', score: 58, scope: `Since ${new Date(inRange[0].day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
          line: `Ran on your own GPU, in your own house, for ${cost >= 1 ? `$${cost.toFixed(2)}` : `${Math.max(1, Math.round(cost * 100))}¢`} of electricity.` }];
      },
      widgets,
      tools: {
        local_ai_status: {
          live: true,
          label: 'Checked local AI',
          description: 'Status of the local AI server: GPU load, power draw, VRAM, temperature, which model is loaded (or swapping), anything running now, and today\'s requests, tokens and electricity cost.',
          access: 'read', input: z.object({}),
          async run() {
            const j = await live();
            return {
              data: { model: j.model.name, swapping: j.model.swapping, running: j.running?.length ?? 0, gpu: { utilPct: j.gpu.util, powerW: Math.round(j.gpu.power),
                vram: `${fmt.bytes(j.gpu.mem * 2 ** 20)} of ${fmt.bytes(j.gpu.mem_total * 2 ** 20)}`, tempC: j.gpu.temp },
                today: { requests: j.today.requests, tokens: j.today.tokens, kwh: j.today.kwh != null ? Number(j.today.kwh.toFixed(2)) : undefined, costUSD: j.today.cost != null ? Number(j.today.cost.toFixed(2)) : undefined },
                lastRequestFrom: j.last_query?.app },
              card: { type: 'group', layout: 'column', cards: [await widgets.gpu.fetch(),
                { type: 'chart', title: 'GPU load', unit: '%', max: 100, span: `last ${Math.round(hist.util.length * 5 / 60)} min`,
                  series: [{ name: 'GPU %', points: [...hist.util] }] }] },
            };
          },
        },
      },
    };
  },
});
