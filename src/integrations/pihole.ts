// Pi-hole (v6 API): how much of the network's traffic is being blocked, a day of queries, what's blocked most, and a
// pause switch (5 minutes, an hour, or until resumed). Pi-hole has a few session seats, so one session is kept and
// reused, and only renewed when it expires.
import { z } from 'zod';
import type { Card } from '../shared/cards.ts';
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
    /** Devices by name: Pi-hole only learns a name from its own lookups, so for one it hasn't named yet, its local DNS
     *  records (dns.hosts, "ip name") stand in, and failing that the address. */
    async function named(list: { name?: string | null; ip: string; count: number }[]) {
      const hosts = list.some(c => !c.name) ? await api<any>('config/dns/hosts').then(r => new Map<string, string>(((r.config?.dns?.hosts ?? []) as string[]).map(l => l.trim().split(/\s+/)).filter(p => p.length > 1).map(p => [p[0], p[1]])), () => new Map<string, string>()) : new Map<string, string>();
      return list.map(c => { const name = c.name || hosts.get(c.ip); return name ? { device: name.replace(/\.$/, ''), ip: c.ip, count: c.count } : { device: c.ip, count: c.count }; });
    }
    /** Who looked a domain up lately: a plain name matches anywhere in the domain, * works as in Pi-hole. */
    async function whoAsked(domain: string) {
      const pattern = domain.includes('*') ? domain : `*${domain}*`;
      const r = await api<any>(`queries?domain=${encodeURIComponent(pattern)}&length=200`);
      const qs = (r.queries ?? []) as any[];
      if (!qs.length) return `No queries for ${pattern} in Pi-hole's recent log.`;
      const tally = <K>(key: (q: any) => K) => { const m = new Map<K, number>(); for (const q of qs) m.set(key(q), (m.get(key(q)) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5); };
      const devices = await named(tally(q => q.client?.ip as string).map(([ip, count]) => ({ ip, count, name: qs.find(q => q.client?.ip === ip)?.client?.name })));
      const total = Number(r.recordsFiltered ?? qs.length);
      return { pattern, queries: total, ...(total > qs.length ? { note: `counts are from the latest ${qs.length} of ${total.toLocaleString('en')} queries` } : {}), devices, domains: tally(q => q.domain as string).map(([d, count]) => ({ domain: d, count })) };
    }
    /** The day's chart, with the pause banner while blocking is off: the widget, and what a pause from chat shows. */
    async function statsCard(): Promise<Card> {
      const { s, history, blocking, timer, top } = await stats();
      const off = blocking !== 'enabled';
      // half-hour columns: ten-minute ones are too thin to read
      const raw = history.filter(x => x.timestamp), hist = raw.length > 60 ? Array.from({ length: Math.ceil(raw.length / 3) }, (_, i) => raw.slice(i * 3, i * 3 + 3).reduce((a, x) => ({ timestamp: x.timestamp, total: a.total + (x.total ?? 0), blocked: a.blocked + (x.blocked ?? 0) }), { timestamp: 0, total: 0, blocked: 0 })) : raw;
      const total = s.queries.total as number;
      return {
        // a day of columns, the blocked share in red: how much of the day's chatter never left the house
        type: 'chart', style: 'bars', title: 'Pi-hole', icon: 'shield', source: { name: 'Pi-hole', icon: '/api/icon/pi-hole' }, ...(hist.length > 1 ? { from: hist[0].timestamp * 1000, to: hist.at(-1)!.timestamp * 1000 } : {}),
        headline: pct(s.queries.percent_blocked), span: `of ${total.toLocaleString()} queries${s.clients?.active ? ` · ${s.clients.active} devices` : ''}`, window: 'last 24 hours',
        // the service's own totals, so the legend can't disagree with the headline over a part-filled column
        series: [{ name: 'Blocked', tone: 'bad', points: hist.map(x => x.blocked ?? 0), total: s.queries.blocked }, { name: 'Allowed', points: hist.map(x => Math.max(0, (x.total ?? 0) - (x.blocked ?? 0))), total: total - s.queries.blocked }],
        facts: top.slice(0, 5).map(d => ({ label: d.domain, value: d.count.toLocaleString() })), factsNote: top.length ? 'Most blocked · last 24 hours' : undefined,
        banner: off ? { text: timer ? 'Blocking paused' : 'Blocking is off', until: timer ? Date.now() + timer * 1000 : undefined, tone: 'warn', button: { label: 'Resume', action: 'pause', args: { minutes: 0 } } } : undefined,
        buttons: off ? undefined : [{ label: 'Pause 5 min', action: 'pause', args: { minutes: 5 } }, { label: 'Pause 1 hour', action: 'pause', args: { minutes: 60 } }],
        summary: { label: 'Ads blocked', icon: 'shield', value: off ? 'Paused' : s.queries.blocked.toLocaleString(), tone: off ? 'warn' : 'good', ring: pct(s.queries.percent_blocked),
          sub: `${pct(s.queries.percent_blocked)} of queries`, trend: history.map(x => x.blocked), pct: s.queries.percent_blocked / 100, pie: true, color: '#ff453a' },
      };
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
          fetch: statsCard,
        },
      },
      commands: [
        { say: ['pause ads', 'pause ad blocking', 'ads off', 'ad blocking off', 'pause {name}', 'pause pihole', 'pause blocking'], run: 'action:pause', input: { minutes: 5 }, label: 'Pause ad blocking for 5 minutes' },
        { say: ['pause ads {minutes} min', 'pause ad blocking {minutes} min', 'ads off {minutes} min', 'pause {name} {minutes} min', 'pause pihole {minutes} min'], run: 'action:pause', label: 'Pause ad blocking: {minutes} min' },
        { say: ['pause ads {hours} hour', 'pause ad blocking {hours} hour', 'ads off {hours} hour', 'pause {name} {hours} hour', 'pause pihole {hours} hour'], run: 'action:pause', input: ({ hours }) => ({ minutes: hours * 60 }), label: 'Pause ad blocking: {hours} h' },
        { say: ['resume ads', 'resume ad blocking', 'ads on', 'ad blocking on', 'block ads', 'resume {name}', 'resume pihole'], run: 'action:pause', input: { minutes: 0 }, label: 'Turn ad blocking back on' },
        { say: ['ad blocking', 'ads blocked', 'how many ads blocked', '{name} status', 'pihole status', 'ad blocking status'], run: 'tool:adblock_status', label: 'Show ad blocking' },
      ],
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
          description: 'Pi-hole: share of DNS queries blocked today, totals, whether blocking is on, the most blocked domains and devices; pass domain to see which devices ask for it.',
          access: 'read', input: z.object({ domain: z.string().trim().min(1).max(253).optional() }),
          async run({ domain }) {
            const [{ s, blocking, timer, top }, card, clients, asked] = await Promise.all([stats(), statsCard(), api<any>('stats/top_clients?blocked=true&count=5'), domain ? whoAsked(domain) : undefined]);
            const topClients = await named(((clients.clients ?? []) as any[]).map(c => ({ name: c.name, ip: c.ip, count: c.count })));
            return { data: { blocking, pausedSeconds: timer, queries: s.queries.total, blocked: s.queries.blocked, percentBlocked: Math.round(s.queries.percent_blocked * 10) / 10, topBlocked: top, topClients, ...(asked ? { asked } : {}) }, card };
          },
        },
        adblock_pause: {
          label: 'Paused ad blocking',
          confirm: ({ minutes }) => minutes ? { title: `Pause ad blocking for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}?`, detail: 'Ads come back on every device until it ends', icon: 'shield', verb: 'Pause' } : { title: 'Turn ad blocking back on?', icon: 'shield', verb: 'Turn on' },
          description: 'Pause Pi-hole ad blocking for some minutes (e.g. a site breaks), or resume it with minutes: 0.',
          access: 'control', input: z.object({ minutes: z.number().int().min(0).max(1440) }),
          async run({ minutes }) {
            await api('dns/blocking', { method: 'POST', body: JSON.stringify(minutes ? { blocking: false, timer: minutes * 60 } : { blocking: true, timer: null }) });
            // the chart itself, now wearing the pause banner and its countdown
            return { data: { blocking: minutes ? `paused for ${minutes} min` : 'on' }, card: await statsCard() };
          },
        },
      },
    };
  },
});
