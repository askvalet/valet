// Uptime Kuma: what it watches, whether each is up, and how reliable it's been (1 day / 30 days), plus certificate
// expiry. Read from Kuma's Prometheus /metrics (basic auth with the Kuma login or an API key).
import { z } from 'zod';
import { defineIntegration, iconFor } from '../server/core.ts';

type M = { name: string; status: number; ms?: number; day?: number; month?: number; certDays?: number };

export default defineIntegration({
  type: 'uptimekuma',
  name: 'Uptime Kuma',
  config: z.object({
    url: z.string().url(), href: z.string().optional(),
    username: z.string().default(''), password: z.string(),       // with an API key: username empty, password = the key
    certWarnDays: z.number().default(14),
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
    async function monitors(): Promise<M[]> {
      const text = await ctx.http<string>(`${base}/metrics`, { headers: { Authorization: auth }, as: 'text' });
      const by = new Map<string, M>();
      for (const line of text.split('\n')) {
        const m = line.match(/^(monitor_\w+)\{([^}]*)\}\s+([\d.e+-]+)/); if (!m) continue;
        const labels = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
        // Kuma 2 labels each line with its monitor's id; Kuma 1 doesn't, so there a monitor is everything it's described by
        // (two with one name still differ by type or address). Without this, every Kuma 1 monitor was one row.
        const id = labels.monitor_id ?? ['monitor_name', 'monitor_type', 'monitor_url', 'monitor_hostname', 'monitor_port'].map(k => labels[k] ?? '').join('\u0000'), v = Number(m[3]);
        const e = by.get(id) ?? { name: labels.monitor_name, status: 1 }; by.set(id, e);
        if (m[1] === 'monitor_status') e.status = v;                       // 1 up, 0 down, 2 pending, 3 maintenance
        else if (m[1] === 'monitor_response_time') e.ms = v > 0 ? Math.round(v) : undefined;
        else if (m[1] === 'monitor_uptime_ratio' && labels.window === '1d') e.day = v;
        else if (m[1] === 'monitor_uptime_ratio' && labels.window === '30d') e.month = v;
        else if (m[1] === 'monitor_cert_days_remaining') e.certDays = v;
      }
      return [...by.values()];
    }
    const pct = (r?: number) => r == null ? '–' : `${(r * 100).toFixed(r >= .9995 ? 0 : r >= .99 ? 2 : 1)}%`;
    return {
      async recap() {
        const month = (await monitors()).filter(m => m.month != null);
        if (!month.length) return [];
        const avg = month.reduce((s, m) => s + m.month!, 0) / month.length;
        return [{ id: 'uptime', theme: 'network', icon: 'pulse', kicker: 'Your homelab stayed up', value: pct(avg), stat: 'Uptime', score: 66, scope: 'Last 30 days', line: `Across the ${month.length} things Uptime Kuma watches. The ones that kept you busiest:`,
          bars: [...month].sort((a, b) => a.month! - b.month!).slice(0, 4).map(m => ({ label: m.name, value: m.month!, show: pct(m.month!) })) }];
      },
      widgets: {
        monitors: {
          title: 'Uptime', interval: 60_000, card: 'status',
          async fetch() {
            const list = await monitors(), down = list.filter(m => m.status === 0);
            const month = list.filter(m => m.month != null), avg = month.length ? month.reduce((s, m) => s + m.month!, 0) / month.length : undefined;
            const certs = list.filter(m => m.certDays != null && m.certDays <= cfg.certWarnDays);
            return {
              type: 'status', title: 'Uptime', icon: 'pulse', href: cfg.href ?? cfg.url,
              note: avg != null ? `${pct(avg)} over 30 days` : undefined,
              // Kuma 1 reports no uptime ratios: there it's how many are up, not a percentage nobody sent
              summary: { label: 'Uptime', icon: 'pulse', value: down.length ? `${down.length} down` : avg != null ? pct(avg) : 'All up', tone: down.length ? 'bad' : certs.length ? 'warn' : 'good',
                sub: down.length ? down.map(m => m.name).join(', ') : `${list.length} ${list.length === 1 ? 'monitor' : 'monitors'}${avg != null ? ' · 30 days' : ''}`, detail: certs.length ? `cert ${Math.min(...certs.map(c => c.certDays!))} days` : undefined, pct: avg },
              items: list.map(m => ({ name: m.name, icon: iconFor(m.name), ok: m.status !== 0, state: m.status === 0 ? 'down' as const : m.status === 2 ? 'degraded' as const : m.status === 3 ? 'off' as const : 'up' as const, ms: m.ms, detail: m.status === 0 ? 'down' : m.status === 3 ? 'maintenance' : m.month != null ? `${pct(m.month)} · 30d` : m.status === 2 ? 'pending' : 'up' })),
            };
          },
        },
      },
      tools: {
        uptime_history: {
          label: 'Checked uptime',
          description: 'Uptime Kuma: each monitored service, whether it is up now, and its uptime over the last day and 30 days; also certificates close to expiry. Use for "has X been flaky", "what went down".',
          access: 'read', input: z.object({}),
          async run() {
            const list = await monitors();
            return { data: list.map(m => ({ name: m.name, up: m.status !== 0, uptime1d: pct(m.day), uptime30d: pct(m.month), certDays: m.certDays })) };
          },
        },
      },
    };
  },
});
