// Scrutiny: drive health from SMART data. Each disk with its status, temperature and age; a failing check or a hot
// drive turns the card amber or red.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'scrutiny',
  name: 'Scrutiny',
  config: z.object({ url: z.string().url(), href: z.string().optional(), hotC: z.number().default(55) }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    async function drives() {
      const d = await ctx.http<any>(`${base}/api/summary`, { timeout: 10_000 });
      return Object.values(d.data?.summary ?? {}).map((x: any) => {
        const dev = x.device ?? {}, smart = x.smart ?? {};
        // device_status: 0 passed; bit 1 failed by SMART, bit 2 failed by Scrutiny's thresholds
        const failed = (dev.device_status ?? 0) !== 0, hot = (smart.temp ?? 0) >= cfg.hotC;
        return { name: dev.device_name, model: dev.model_name ?? dev.device_name, failed, hot, temp: smart.temp, hours: smart.power_on_hours, wwn: dev.wwn };
      });
    }
    const age = (h?: number) => h == null ? '' : h >= 8760 ? `${(h / 8760).toFixed(1)} years on` : `${Math.round(h / 24)} days on`;
    return {
      widgets: {
        drives: {
          title: 'Drives', interval: 600_000,
          async fetch() {
            const list = await drives(), bad = list.filter(d => d.failed), warm = list.filter(d => d.hot);
            return {
              type: 'list', title: 'Drives', icon: 'disk', href: cfg.href ?? cfg.url,
              summary: { label: 'Drives', icon: 'disk', value: bad.length ? `${bad.length} failing` : 'Healthy', tone: bad.length ? 'bad' : warm.length ? 'warn' : 'good',
                sub: `${list.length} drives`, detail: list.length ? `${Math.max(...list.map(d => d.temp ?? 0))}°C max` : undefined },
              items: list.map(d => ({ title: d.model, subtitle: [d.temp != null && `${d.temp}°C`, age(d.hours)].filter(Boolean).join(' · '),
                meta: d.failed ? 'Failing' : d.hot ? 'Hot' : 'Healthy', tone: d.failed ? 'bad' : d.hot ? 'warn' : 'neutral' })),
            };
          },
        },
      },
      tools: {
        drive_health: {
          label: 'Checked the drives',
          description: 'Health of every disk (SMART via Scrutiny): passed or failing, temperature, hours powered on.',
          access: 'read', input: z.object({}),
          async run() { return { data: await drives() }; },
        },
      },
    };
  },
});
