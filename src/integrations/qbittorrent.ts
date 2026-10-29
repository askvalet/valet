// qBittorrent Web API v2: what's downloading, overall speed, and pause/resume.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';

export default defineIntegration({
  type: 'qbittorrent',
  name: 'qBittorrent',
  config: z.object({ url: z.string().url(), username: z.string(), password: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    let cookie = '';
    const speeds: number[] = [];
    async function login() {
      const res = await ctx.http<Response>(`${base}/api/v2/auth/login`, {
        as: 'response', method: 'POST', body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
        headers: { Referer: base },
      });
      // the cookie is "SID" on older versions and "QBT_SID_<port>" on 5.x
      const sid = res.headers.get('set-cookie')?.match(/(?:QBT_SID_\d+|SID)=[^;]+/)?.[0];
      if (!sid) throw new Error('qBittorrent login failed');
      cookie = sid;
    }
    async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
      if (!cookie) await login();
      const go = () => ctx.http<Response>(`${base}/api/v2/${path}`, { ...init, as: 'response', headers: { Cookie: cookie, Referer: base } });
      let res = await go();
      if (res.status === 403) { await login(); res = await go(); }
      if (!res.ok) throw new Error(`qBittorrent answered ${res.status}`);
      const text = await res.text();
      return (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T;
    }
    async function state() {
      const [info, torrents] = await Promise.all([api('transfer/info'), api<any[]>('torrents/info?filter=active&sort=eta')]);
      const dl = torrents.filter(t => ['downloading', 'stalledDL', 'metaDL', 'forcedDL'].includes(t.state) || t.progress < 1);
      return { info, dl };
    }
    const label = (t: any) => [t.state === 'stalledDL' ? 'stalled' : fmt.rate(t.dlspeed), `${fmt.bytes(t.amount_left)} left`].join(' · ');

    const widgets = {
      active: {
        title: 'Downloads', interval: 5000,
        async fetch() {
          const { info, dl } = await state();
          speeds.push(info.dl_info_speed); if (speeds.length > 40) speeds.shift();
          return {
            type: 'list', title: 'Downloads', icon: 'download', href: cfg.href ?? cfg.url,
            summary: { label: 'Downloads', icon: 'download', value: fmt.rate(info.dl_info_speed), sub: dl.length ? `${dl.length} active` : 'Idle',
              detail: `↑ ${fmt.rate(info.up_info_speed)}`, trend: [...speeds] },
            note: `↓ ${fmt.rate(info.dl_info_speed)} · ↑ ${fmt.rate(info.up_info_speed)}`,
            empty: 'Nothing downloading',
            activity: dl.length ? { title: dl.length > 1 ? `${dl.length} downloads` : dl[0].name, subtitle: dl.length > 1 ? dl[0].name : `↓ ${fmt.rate(info.dl_info_speed)}`,
              icon: 'download', pct: dl.reduce((s, t) => s + t.progress, 0) / dl.length,
              trailing: dl.length > 1 ? fmt.rate(info.dl_info_speed) : dl[0].eta < 8640000 ? `${fmt.duration(dl[0].eta)} left` : undefined, count: dl.length } : undefined,
            items: dl.slice(0, 8).map(t => ({ title: t.name, pct: t.progress, subtitle: label(t),
              meta: t.eta < 8640000 ? fmt.duration(t.eta) : '–', tone: t.state === 'stalledDL' ? 'warn' : 'neutral' })),
          };
        },
      },
    } satisfies Instance['widgets'];

    return {
      widgets,
      actions: {
        pause: { description: 'Pause all or one torrent', input: z.object({ hash: z.string().default('all') }),
          run: ({ hash }) => api('torrents/stop', { method: 'POST', body: new URLSearchParams({ hashes: hash }) }) },
        resume: { description: 'Resume all or one torrent', input: z.object({ hash: z.string().default('all') }),
          run: ({ hash }) => api('torrents/start', { method: 'POST', body: new URLSearchParams({ hashes: hash }) }) },
      },
      tools: {
        downloads_status: {
          description: 'Torrents currently downloading with progress, speed, size left and ETA, plus total transfer speed.',
          access: 'read', input: z.object({}),
          async run() {
            const { info, dl } = await state();
            return {
              data: { down: fmt.rate(info.dl_info_speed), up: fmt.rate(info.up_info_speed), count: dl.length,
                      torrents: dl.slice(0, 25).map(t => ({ name: t.name, hash: t.hash, progress: fmt.pct(t.progress), state: t.state,
                        speed: fmt.rate(t.dlspeed), left: fmt.bytes(t.amount_left), eta: fmt.duration(t.eta), seeds: t.num_seeds })) },
              card: await widgets.active.fetch(),
            };
          },
        },
        pause_downloads: {
          description: 'Pause downloading. Pass a torrent hash from downloads_status to pause one, or nothing to pause all.',
          access: 'control', input: z.object({ hash: z.string().optional() }),
          async run({ hash }) {
            await api('torrents/stop', { method: 'POST', body: new URLSearchParams({ hashes: hash ?? 'all' }) });
            return { data: { paused: hash ?? 'all' } };
          },
        },
        resume_downloads: {
          description: 'Resume downloading. Pass a torrent hash to resume one, or nothing to resume all.',
          access: 'control', input: z.object({ hash: z.string().optional() }),
          async run({ hash }) {
            await api('torrents/start', { method: 'POST', body: new URLSearchParams({ hashes: hash ?? 'all' }) });
            return { data: { resumed: hash ?? 'all' } };
          },
        },
      },
    };
  },
});
