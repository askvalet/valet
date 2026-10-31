// Scrutiny: drive health from SMART data. Each disk with its status, temperature and age; a failing check or a hot
// drive turns the card amber or red.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';

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
        return { name: dev.device_name, model: dev.model_name ?? dev.device_name, failed, hot, temp: smart.temp, hours: smart.power_on_hours, wwn: dev.wwn, capacity: dev.capacity as number | undefined };
      });
    }
    const age = (h?: number) => h == null ? '' : h >= 8760 ? `${(h / 8760).toFixed(1)} years on` : `${Math.round(h / 24)} days on`;
    return {
      async recap() {
        const list = await drives();
        if (!list.length) return [];
        const total = list.reduce((s, d) => s + (d.capacity ?? 0), 0), bad = list.filter(d => d.failed).length, days = (h: number) => `${Math.round(h / 24).toLocaleString('en')} days`;
        return [{ id: 'drives', theme: 'hardware', icon: 'disk', kicker: 'Your data lives on', value: total ? fmt.bytes(total, 0) : String(list.length), unit: total ? undefined : 'drives', stat: 'Storage', score: 63, scope: 'Right now',
          line: `${list.length} drives, ${bad ? `${bad} of them failing` : 'all passing their health checks'}. How long each has been spinning:`, bars: list.map(d => ({ label: d.model, value: d.hours ?? 0, show: days(d.hours ?? 0) })) }];
      },
      widgets: {
        drives: {
          title: 'Drives', interval: 600_000,
          async fetch() {
            const list = await drives(), bad = list.filter(d => d.failed), warm = list.filter(d => d.hot);
            const temps = list.flatMap(d => d.temp != null ? [d.temp] : []);
            return {
              type: 'list', title: 'Drives', icon: 'disk', href: cfg.href ?? cfg.url,
              summary: { label: 'Drives', icon: 'disk', value: bad.length ? `${bad.length} failing` : temps.length ? `${Math.max(...temps)}°C` : 'Healthy', tone: bad.length ? 'bad' : warm.length ? 'warn' : 'good',
                sub: bad.length ? `of ${list.length} drives` : warm.length ? `${warm.length} of ${list.length} running hot` : `All ${list.length} healthy`,
                marks: list.map(d => ({ pct: d.temp != null ? Math.max(0, Math.min(1, (d.temp - 20) / 40)) : undefined, tone: d.failed ? 'bad' as const : d.hot ? 'warn' as const : undefined, label: [d.model, d.temp != null && `${d.temp}°C`].filter(Boolean).join(' · ') })) },
              items: list.map(d => ({ title: d.model, subtitle: [d.temp != null && `${d.temp}°C`, age(d.hours)].filter(Boolean).join(' · '),
                meta: d.failed ? 'Failing' : d.hot ? 'Hot' : undefined, dot: d.failed ? 'bad' : d.hot ? 'warn' : 'good', tone: d.failed ? 'bad' : d.hot ? 'warn' : 'neutral' })),
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
