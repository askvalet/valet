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
      widgets: {
        stats: {
          title: 'Pi-hole', interval: 60_000,
          async fetch() {
            const { s, history, blocking, timer, top } = await stats();
            const off = blocking !== 'enabled';
            return {
              type: 'stats', title: 'Pi-hole', icon: 'shield', href: cfg.href ?? `${base}/admin`,
              note: off ? (timer ? `paused · ${Math.ceil(timer / 60)} min left` : 'blocking off') : undefined,
              buttons: off ? [{ label: 'Resume blocking', action: 'pause', args: { minutes: 0 } }]
                : [{ label: 'Pause 5 min', action: 'pause', args: { minutes: 5 } }, { label: 'Pause 1 hour', action: 'pause', args: { minutes: 60 } }],
              summary: { label: 'Ads blocked', icon: 'shield', value: off ? 'Paused' : pct(s.queries.percent_blocked), tone: off ? 'warn' : 'good',
                sub: `${s.queries.blocked.toLocaleString()} today`, trend: history.map(x => x.blocked), pct: s.queries.percent_blocked / 100 },
              items: [
                { label: off ? 'Blocking paused' : 'Blocked', value: off ? 'Off' : pct(s.queries.percent_blocked), tone: off ? 'warn' : 'good', trend: history.map(x => x.blocked), sub: top[0] ? `most: ${top[0].domain}` : undefined },
                { label: 'Queries', value: s.queries.total.toLocaleString() },
                { label: 'Blocked', value: s.queries.blocked.toLocaleString() },
                { label: 'Clients', value: s.clients?.active ?? '–' },
              ],
            };
          },
        },
      },
      actions: {
        pause: { description: 'Pause or resume ad blocking', input: z.object({ minutes: z.number().int().min(0).max(1440).default(5) }),
          run: ({ minutes }) => api('dns/blocking', { method: 'POST', body: JSON.stringify(minutes ? { blocking: false, timer: minutes * 60 } : { blocking: true, timer: null }) }) },
      },
      tools: {
        adblock_status: {
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
