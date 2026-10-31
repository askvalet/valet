// The homelab's local-AI monitor (the proxy in front of the local models): GPU load, power, VRAM, temperature, which
// model is loaded, and today's requests, tokens and electricity cost.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';

export default defineIntegration({
  type: 'aimonitor',
  name: 'Local AI',
  config: z.object({ url: z.string().url(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const hist = { util: [] as number[], power: [] as number[] };
    const push = (a: number[], v: number) => { a.push(Math.round(v)); if (a.length > 60) a.shift(); };
    async function live() {
      const j = await ctx.http(`${base}/api/live`);
      push(hist.util, j.gpu.util); push(hist.power, j.gpu.power);
      return j;
    }
    const heat = (t: number) => t >= 85 ? 'bad' : t >= 75 ? 'warn' : 'neutral';

    const widgets = {
      // the day at a glance: cost, requests, tokens and power, each with its last 24 hours drawn behind it
      usage: {
        title: 'Local AI usage', interval: 60_000,
        async fetch() {
          const [h, c, j] = await Promise.all([ctx.http<any>(`${base}/api/history`), ctx.http<any>(`${base}/api/cost`), live()]);
          const buckets = (h.gpu as number[][]).map(r => r[0]);
          const per = (i: 2 | 3) => buckets.map(ts => (h.requests as any[]).filter(r => r[0] === ts).reduce((s, r) => s + r[i], 0));
          const today = c.days.at(-1) ?? { cost: 0, tokens: 0 };
          const tok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
          return {
            type: 'stats', title: 'Local AI usage', icon: 'gpu', href: cfg.href, items: [],
            summaries: [
              { label: 'Cost today', icon: 'coins', value: `${Math.round(today.cost * 100)}¢`, sub: `${Math.round(c.month * 100)}¢ this month`,
                detail: `${today.kwh?.toFixed(2) ?? '–'} kWh`, trend: c.days.map((d: any) => d.cost) },
              { label: 'Requests', icon: 'pulse', value: j.today.requests.toLocaleString(), sub: 'today',
                detail: `${Math.round(h.totals.avg_tok_s ?? 0)} tok/s avg`, trend: per(2) },
              { label: 'Tokens', icon: 'text', value: tok(today.tokens), sub: 'generated today', detail: `${tok(h.totals.prompt_tokens)} read`, trend: per(3) },
              { label: 'Power', icon: 'gpu', value: `${Math.round(j.gpu.power)} W`, sub: j.model.name, detail: `${Math.round(j.gpu.temp)}°C`,
                trend: (h.gpu as number[][]).map(r => r[2]), tone: (j.running?.length ?? 0) > 0 ? 'accent' : 'neutral' },
            ],
          };
        },
      },
      gpu: {
        title: 'Local AI', interval: 5000,
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
              { label: 'Today', value: j.today.requests, sub: `${(j.today.tokens / 1e6).toFixed(2)}M tokens · $${j.today.cost.toFixed(2)}` },
            ],
          };
        },
      },
    } satisfies Instance['widgets'];

    return {
      async recap({ from, to }) {
        const { days = [] } = await ctx.http<any>(`${base}/api/cost`);
        const inRange = (days as any[]).filter(d => { const t = Date.parse(d.day); return t >= from && t < to; });
        const tokens = inRange.reduce((s, d) => s + (d.tokens ?? 0), 0), cost = inRange.reduce((s, d) => s + (d.cost ?? 0), 0);
        if (!tokens) return [];
        return [{ id: 'ai.tokens', icon: 'gpu', kicker: 'Your own AI wrote', value: tokens >= 1e6 ? (tokens / 1e6).toFixed(1) : tokens.toLocaleString('en'), unit: tokens >= 1e6 ? 'million tokens' : 'tokens', stat: 'AI tokens', score: 58, scope: `Since ${new Date(inRange[0].day).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`,
          line: `On your own graphics card, for ${cost >= 1 ? `$${cost.toFixed(2)}` : `${Math.max(1, Math.round(cost * 100))}¢`} of electricity. Nobody else read a word of it.` }];
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
                today: { requests: j.today.requests, tokens: j.today.tokens, kwh: Number(j.today.kwh.toFixed(2)), costUSD: Number(j.today.cost.toFixed(2)) },
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
