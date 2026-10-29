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
      gpu: {
        title: 'Local AI', interval: 5000,
        async fetch() {
          const j = await live();
          const g = j.gpu, m = j.model;
          const working = (j.running?.length ?? 0) > 0;
          return {
            type: 'stats', title: 'Local AI', icon: 'gpu', href: cfg.href,
            summary: { label: 'Local AI', value: m.swapping ? 'Loading' : working ? 'Working' : 'Idle', sub: `${m.name} · ${Math.round(g.power)} W`, tone: working ? 'accent' : 'neutral' },
            note: m.swapping ? `loading ${m.swapping}…` : `${m.name}${working ? ' · working' : ' · idle'}`,
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
      widgets,
      tools: {
        local_ai_status: {
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
