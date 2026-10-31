// Pi-hole (v6 API): how much of the network's traffic is being blocked, a day of queries, what's blocked most, and a
// pause switch (5 minutes, an hour, or until resumed). Pi-hole has a few session seats, so one session is kept and
// reused, and only renewed when it expires.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'pihole',
  name: 'Pi-hole',
  config: z.object({ url: z.string().url(), password: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const sid = ctx.session(async () => {
      const r = await ctx.http<any>(`${base}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: cfg.password }) });
      if (!r.session?.valid) throw new Error('Pi-hole sign-in failed');
      return r.session.sid as string;
    });
    async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
      const go = async () => ctx.http<Response>(`${base}/api/${path}`, { ...init, as: 'response', headers: { 'X-FTL-SID': await sid.get(), 'Content-Type': 'application/json' } });
      let r = await go();
      if (r.status === 401) { sid.reset(); r = await go(); }
      if (!r.ok) throw new Error(`Pi-hole answered ${r.status}`);
      return r.json() as Promise<T>;
    }
    const pct = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)}%`;
    async function stats() {
      const [s, h, b, top] = await Promise.all([api<any>('stats/summary'), api<any>('history'), api<any>('dns/blocking'), api<any>('stats/top_domains?blocked=true&count=5')]);
      return { s, history: (h.history ?? []) as any[], blocking: b.blocking as string, timer: b.timer as number | null, top: (top.domains ?? []) as { domain: string; count: number }[] };
    }
    return {
      async recap({ from, to }) {
        const s = await api<any>(`stats/database/summary?from=${Math.floor(from / 1000)}&until=${Math.floor(to / 1000)}`);
        if (!s?.sum_blocked) return [];
        const covered = Number(s.total_clients ?? 0);
        const worst = ((await api<any>('stats/top_domains?blocked=true&count=4').catch(() => null))?.domains ?? []) as { domain: string; count: number }[];
        return [{ id: 'dns.blocked', theme: 'network', icon: 'shield', kicker: 'Pi-hole stopped', value: Number(s.sum_blocked).toLocaleString('en'), unit: 'requests', stat: 'Ads blocked', score: 72, scope: 'As far back as Pi-hole keeps',
          line: `That's ${Number(s.percent_blocked).toFixed(0)}% of everything your devices tried to look up${covered ? `, across ${covered} devices` : ''}.${worst.length ? ' The worst offenders lately:' : ''}`,
          bars: worst.map(d => ({ label: d.domain, value: d.count, show: d.count.toLocaleString('en') })) }];
      },
      widgets: {
        stats: {
          title: 'Pi-hole', interval: 60_000,
          async fetch() {
            const { s, history, blocking, timer, top } = await stats();
            const off = blocking !== 'enabled';
            // half-hour columns: ten-minute ones are too thin to read
            const raw = history.filter(x => x.timestamp), hist = raw.length > 60 ? Array.from({ length: Math.ceil(raw.length / 3) }, (_, i) => raw.slice(i * 3, i * 3 + 3).reduce((a, x) => ({ timestamp: x.timestamp, total: a.total + (x.total ?? 0), blocked: a.blocked + (x.blocked ?? 0) }), { timestamp: 0, total: 0, blocked: 0 })) : raw;
            const total = s.queries.total as number;
            return {
              // a day of columns, the blocked share in red: how much of the day's chatter never left the house
              type: 'chart', style: 'bars', title: 'Pi-hole', icon: 'shield', ...(hist.length > 1 ? { from: hist[0].timestamp * 1000, to: hist.at(-1)!.timestamp * 1000 } : {}),
              headline: pct(s.queries.percent_blocked), span: `of ${total.toLocaleString()} queries${s.clients?.active ? ` · ${s.clients.active} devices` : ''}`, window: 'last 24 h',
              // the service's own totals, so the legend can't disagree with the headline over a part-filled column
              series: [{ name: 'Blocked', tone: 'bad', points: hist.map(x => x.blocked ?? 0), total: s.queries.blocked }, { name: 'Allowed', points: hist.map(x => Math.max(0, (x.total ?? 0) - (x.blocked ?? 0))), total: total - s.queries.blocked }],
              facts: top.slice(0, 5).map(d => ({ label: d.domain, value: d.count.toLocaleString() })), factsNote: top.length ? 'Most blocked · last 24 h' : undefined,
              banner: off ? { text: timer ? 'Blocking paused' : 'Blocking is off', until: timer ? Date.now() + timer * 1000 : undefined, tone: 'warn', button: { label: 'Resume', action: 'pause', args: { minutes: 0 } } } : undefined,
              buttons: off ? undefined : [{ label: 'Pause 5 min', action: 'pause', args: { minutes: 5 } }, { label: 'Pause 1 hour', action: 'pause', args: { minutes: 60 } }],
              summary: { label: 'Ads blocked', icon: 'shield', value: off ? 'Paused' : s.queries.blocked.toLocaleString(), tone: off ? 'warn' : 'good', ring: pct(s.queries.percent_blocked),
                sub: `${pct(s.queries.percent_blocked)} of queries`, trend: history.map(x => x.blocked), pct: s.queries.percent_blocked / 100, waffle: true },
            };
          },
        },
      },
      actions: {
        pause: { description: 'Pause or resume ad blocking', input: z.object({ minutes: z.number().int().min(0).max(1440).default(5) }),
          run: async ({ minutes }) => {
            await api('dns/blocking', { method: 'POST', body: JSON.stringify(minutes ? { blocking: false, timer: minutes * 60 } : { blocking: true, timer: null }) });
            return { done: minutes ? `Paused ad blocking for ${minutes} min` : 'Resumed ad blocking' };
          } },
      },
      tools: {
        adblock_status: {
          live: true,
          label: 'Checked ad blocking',
          description: 'Pi-hole: share of DNS queries blocked today, totals, whether blocking is on, and the most blocked domains.',
          access: 'read', input: z.object({}),
          async run() {
            const { s, blocking, timer, top } = await stats();
            return { data: { blocking, pausedSeconds: timer, queries: s.queries.total, blocked: s.queries.blocked, percentBlocked: Math.round(s.queries.percent_blocked * 10) / 10, topBlocked: top } };
          },
        },
        adblock_pause: {
          label: 'Paused ad blocking',
          confirm: ({ minutes }) => minutes ? { title: `Pause ad blocking for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}?`, detail: 'Ads come back on every device until it ends', icon: 'shield', verb: 'Pause' } : { title: 'Turn ad blocking back on?', icon: 'shield', verb: 'Turn on' },
          description: 'Pause Pi-hole ad blocking for some minutes (e.g. a site breaks), or resume it with minutes: 0.',
          access: 'control', input: z.object({ minutes: z.number().int().min(0).max(1440) }),
          async run({ minutes }) {
            await api('dns/blocking', { method: 'POST', body: JSON.stringify(minutes ? { blocking: false, timer: minutes * 60 } : { blocking: true, timer: null }) });
            return { data: { blocking: minutes ? `paused for ${minutes} min` : 'on' }, card: { type: 'text', tone: minutes ? 'warn' : 'good', text: minutes ? `Ad blocking paused for ${minutes} minutes.` : 'Ad blocking is back on.' } };
          },
        },
      },
    };
  },
});
