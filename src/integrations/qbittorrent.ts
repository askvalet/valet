// qBittorrent Web API v2: what's downloading, overall speed, and pause/resume. With Radarr/Sonarr configured, each
// download is matched to its movie or episode, so the card shows real titles, posters and backdrops.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { MediaItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'qbittorrent',
  name: 'qBittorrent',
  config: z.object({
    url: z.string().url(), username: z.string(), password: z.string(), href: z.string().optional(),
    // where downloads come from: matched by torrent hash for titles and artwork
    arr: z.array(z.object({ type: z.enum(['radarr', 'sonarr']), url: z.string().url(), apiKey: z.string() })).default([]),
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const speeds: number[] = [];
    // qBittorrent hands back a cookie: "SID" on older versions, "QBT_SID_<port>" on 5.x
    const cookie = ctx.session(async () => {
      const res = await ctx.http<Response>(`${base}/api/v2/auth/login`, {
        as: 'response', method: 'POST', body: new URLSearchParams({ username: cfg.username, password: cfg.password }), headers: { Referer: base },
      });
      const sid = res.headers.get('set-cookie')?.match(/(?:QBT_SID_\d+|SID)=[^;]+/)?.[0];
      if (!sid) throw new Error('qBittorrent login failed');
      return sid;
    });
    async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
      const go = async () => ctx.http<Response>(`${base}/api/v2/${path}`, { ...init, as: 'response', headers: { Cookie: await cookie.get(), Referer: base } });
      let res = await go();
      if (res.status === 403) { cookie.reset(); res = await go(); }
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

    // Radarr/Sonarr queues → hash → what it is. Cached for a minute; the queues change slowly.
    type Known = { title: string; subtitle?: string; poster?: string; backdrop?: string; quality?: string };
    let known = new Map<string, Known>(), knownAt = 0;
    const img = (images: any[] = [], type: string, size: string) => images.find(i => i.coverType === type)?.remoteUrl?.replace('/original/', `/${size}/`);
    async function lookup() {
      if (!cfg.arr.length || Date.now() - knownAt < 60_000) return known;
      const next = new Map<string, Known>();
      await Promise.all(cfg.arr.map(async a => {
        const q = a.type === 'radarr' ? 'includeMovie=true' : 'includeSeries=true&includeEpisode=true';
        const res = await ctx.http<any>(`${a.url.replace(/\/$/, '')}/api/v3/queue?${q}&pageSize=100`, { headers: { 'X-Api-Key': a.apiKey }, timeout: 5000 }).catch(() => null);
        for (const r of res?.records ?? []) {
          if (!r.downloadId) continue;
          const m = r.movie, s = r.series, e = r.episode;
          next.set(String(r.downloadId).toLowerCase(), m
            ? { title: m.title, subtitle: m.year ? String(m.year) : undefined, poster: img(m.images, 'poster', 'w500'), backdrop: img(m.images, 'fanart', 'w1280'), quality: r.quality?.quality?.name }
            : { title: s?.title ?? r.title, subtitle: e ? `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}` : undefined,
                poster: img(s?.images, 'poster', 'w500'), backdrop: img(s?.images, 'fanart', 'w1280'), quality: r.quality?.quality?.name });
        }
      }));
      known = next; knownAt = Date.now();
      return known;
    }

    const widgets = {
      active: {
        title: 'Downloads', interval: 5000,
        async fetch() {
          const { info, dl } = await state();
          speeds.push(info.dl_info_speed); if (speeds.length > 40) speeds.shift();
          const k = await lookup();
          const items: MediaItem[] = dl.slice(0, 6).map(t => {
            const m = k.get(String(t.hash).toLowerCase());
            return { title: m?.title ?? t.name, subtitle: m?.subtitle ?? label(t), image: m?.poster, backdrop: m?.backdrop, pct: t.progress,
              state: t.state === 'pausedDL' || t.state === 'stoppedDL' ? 'paused' : t.state === 'stalledDL' || t.state === 'metaDL' ? 'buffering' : 'playing',
              remaining: `${Math.floor(t.progress * 100)}%${t.eta < 8640000 ? ` · ${fmt.duration(t.eta)} left` : ''}`, icon: 'download',
              tags: [m?.quality, t.state === 'stalledDL' ? 'Stalled' : fmt.rate(t.dlspeed), `${fmt.bytes(t.amount_left)} left`].filter(Boolean) as string[],
              detail: label(t) };
          });
          const first = items[0];
          return {
            type: 'media', title: 'Downloading', icon: 'download', href: cfg.href ?? cfg.url,
            summary: { label: 'Downloads', icon: 'download', value: fmt.rate(info.dl_info_speed), sub: dl.length ? `${dl.length} active` : 'Idle',
              detail: `↑ ${fmt.rate(info.up_info_speed)}`, trend: [...speeds] },
            note: dl.length ? `${dl.length > 1 ? `${dl.length} downloads · ` : ''}↓ ${fmt.rate(info.dl_info_speed)}` : undefined,
            empty: 'Nothing downloading',
            buttons: dl.length ? (dl.every(t => /paused|stopped/i.test(t.state)) ? [{ label: 'Resume all', action: 'resume' }] : [{ label: 'Pause all', action: 'pause' }]) : undefined,
            activity: first && { title: dl.length > 1 ? `${first.title} +${dl.length - 1}` : first.title, subtitle: `↓ ${fmt.rate(info.dl_info_speed)}`,
              image: first.image, icon: 'download', pct: dl.reduce((s, t) => s + t.progress, 0) / dl.length, trailing: dl[0].eta < 8640000 ? `${fmt.duration(dl[0].eta)} left` : undefined, count: dl.length },
            items,
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
        torrent_control: {
          label: 'Changed a download',
          description: 'Pause, resume or remove ONE torrent (by part of its name, from downloads_status). Removing keeps the downloaded files.',
          access: 'control', input: z.object({ name: z.string(), do: z.enum(['pause', 'resume', 'remove']) }),
          async run({ name, do: what }) {
            const all = await api<any[]>('torrents/info'), q = name.toLowerCase();
            const t = all.find(x => String(x.name).toLowerCase().includes(q));
            if (!t) return { data: { error: `no torrent matches ${name}` } };
            const paths: Record<string, string> = { pause: 'torrents/stop', resume: 'torrents/start', remove: 'torrents/delete' }, path = paths[what];
            await api(path, { method: 'POST', body: new URLSearchParams({ hashes: t.hash, ...(what === 'remove' ? { deleteFiles: 'false' } : {}) }) });
            return { data: { done: what, torrent: t.name }, card: { type: 'text', tone: 'good', text: `${what === 'remove' ? 'Removed' : what === 'pause' ? 'Paused' : 'Resumed'} ${t.name}.` } };
          },
        },
        downloads_status: {
          label: 'Checked downloads',
          followUps: ['When will it finish?', 'Pause downloads'],
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
          label: 'Paused downloads',
          followUps: ['Resume downloads'],
          description: 'Pause downloading. Pass a torrent hash from downloads_status to pause one, or nothing to pause all.',
          access: 'control', input: z.object({ hash: z.string().optional() }),
          async run({ hash }) {
            await api('torrents/stop', { method: 'POST', body: new URLSearchParams({ hashes: hash ?? 'all' }) });
            return { data: { paused: hash ?? 'all' } };
          },
        },
        resume_downloads: {
          label: 'Resumed downloads',
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
