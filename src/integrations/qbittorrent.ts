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
      // every torrent, not filter=active: that leaves out the stalled ones, which are the ones you'd want to know about
      const [info, torrents] = await Promise.all([api('transfer/info'), api<any[]>('torrents/info?sort=eta')]);
      const dl = torrents.filter(t => t.progress < 1);
      return { info, dl, stuck: dl.filter(isStuck), moving: dl.filter(t => !isStuck(t) && !/paused|stopped/i.test(t.state)) };
    }
    const isStuck = (t: any) => t.state === 'stalledDL' || t.state === 'metaDL';
    const word = (t: any) => t.state === 'metaDL' ? 'Finding peers' : t.state === 'stalledDL' ? 'Stalled' : fmt.rate(t.dlspeed);
    const label = (t: any) => [word(t), t.state !== 'metaDL' && `${fmt.bytes(t.amount_left)} left`].filter(Boolean).join(' · ');

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

    // Added by hand, or a season pack: no queue knows it, so read the torrent's name and find the show in the library.
    let shelf: { key: string; known: Known }[] = [], shelfAt = 0;
    const plain = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    async function library() {
      if (!cfg.arr.length || Date.now() - shelfAt < 600_000) return shelf;
      const next: typeof shelf = [];
      await Promise.all(cfg.arr.map(async a => {
        const list = await ctx.http<any[]>(`${a.url.replace(/\/$/, '')}/api/v3/${a.type === 'radarr' ? 'movie' : 'series'}`, { headers: { 'X-Api-Key': a.apiKey }, timeout: 8000 }).catch(() => []);
        for (const x of list) next.push({ key: plain(x.title), known: { title: x.title, subtitle: a.type === 'radarr' && x.year ? String(x.year) : undefined, poster: img(x.images, 'poster', 'w500'), backdrop: img(x.images, 'fanart', 'w1280') } });
      }));
      shelf = next; shelfAt = Date.now();
      return shelf;
    }
    /** "Full.House.S03.1080p.WEBRip.x265-RARBG" → the show, Season 3, WEBRip-1080p. */
    function fromName(name: string, on: typeof shelf): Known | undefined {
      const m = /^(.+?)[\s._-]+(?:[Ss](\d{1,2})(?:[Ee](\d{1,3})(?:-?[Ee]\d{1,3})*)?|[([]?((?:19|20)\d{2})[)\]]?)(?:[\s._-]|$)/.exec(name);
      const hit = m && on.find(x => x.key === plain(m[1]));
      if (!m || !hit) return undefined;
      const res = /(2160|1080|720|480)p/i.exec(name)?.[0].toLowerCase(), source = /web-?dl/i.test(name) ? 'WEBDL' : /webrip|web\b/i.test(name) ? 'WEBRip' : /blu-?ray|bdrip/i.test(name) ? 'Bluray' : /dvd/i.test(name) ? 'DVD' : /hdtv/i.test(name) ? 'HDTV' : undefined;
      const part = m[2] ? (m[3] ? `S${m[2].padStart(2, '0')}E${m[3].padStart(2, '0')}` : `Season ${Number(m[2])}`) : hit.known.subtitle;
      return { ...hit.known, subtitle: part, quality: source && res ? `${source}-${res}` : res };
    }

    const widgets = {
      active: {
        title: 'Downloads', interval: 5000,
        async fetch() {
          const { info, dl, stuck, moving } = await state();
          speeds.push(info.dl_info_speed); if (speeds.length > 40) speeds.shift();
          const k = await lookup(), on = dl.some(t => !k.has(String(t.hash).toLowerCase())) ? await library() : shelf;
          const items: MediaItem[] = dl.slice(0, 6).map(t => {
            const m = k.get(String(t.hash).toLowerCase()) ?? fromName(t.name, on);
            return { title: m?.title ?? t.name, subtitle: m?.subtitle ?? label(t), image: m?.poster, backdrop: m?.backdrop, pct: t.progress,
              state: t.state === 'pausedDL' || t.state === 'stoppedDL' ? 'paused' : t.state === 'stalledDL' || t.state === 'metaDL' ? 'buffering' : 'playing',
              remaining: `${Math.floor(t.progress * 100)}%${t.eta < 8640000 ? ` · ${fmt.duration(t.eta)} left` : ''}`, icon: 'download',
              tags: [m?.subtitle, m?.quality, word(t), t.state !== 'metaDL' && `${fmt.bytes(t.amount_left)} left`].filter(Boolean) as string[],
              detail: label(t),
              ...(isStuck(t) && { stall: { word: t.state === 'metaDL' ? 'Finding peers' : 'Stalled', since: t.last_activity ? t.last_activity * 1000 : undefined, why: t.num_seeds ? undefined : 'no peers' } }) };
          });
          const first = items[dl.indexOf(moving[0])];
          return {
            type: 'media', title: 'Downloading', icon: 'download', href: cfg.href ?? cfg.url, source: { name: 'qBittorrent', icon: '/api/icon/qbittorrent' },
            summary: { label: 'Downloads', icon: 'download', value: fmt.rate(info.dl_info_speed), sub: [moving.length && `${moving.length} active`, stuck.length && `${stuck.length} stuck`].filter(Boolean).join(' · ') || (dl.length ? `${dl.length} paused` : 'Idle'),
              detail: `↑ ${fmt.rate(info.up_info_speed)}`, trend: [...speeds],
              tone: stuck.some(t => t.added_on && Date.now() / 1000 - t.added_on > 3600) ? 'bad' as const : undefined },   // a minute finding peers is normal; hours isn't
            note: dl.length ? `${dl.length > 1 ? `${dl.length} downloads · ` : ''}↓ ${fmt.rate(info.dl_info_speed)}` : undefined,
            empty: 'Nothing downloading',
            buttons: dl.length && dl.every(t => /paused|stopped/i.test(t.state)) ? [{ label: 'Resume all', action: 'resume' }] : undefined,
            // the rings are for what's moving: a dead torrent shouldn't sit there for days
            activity: first && { title: moving.length > 1 ? `${first.title} +${moving.length - 1}` : first.title, subtitle: `↓ ${fmt.rate(info.dl_info_speed)}`,
              image: first.image, icon: 'download', pct: moving.reduce((s, t) => s + t.progress, 0) / moving.length, trailing: moving[0].eta < 8640000 ? `${fmt.duration(moving[0].eta)} left` : undefined, count: moving.length },
            items,
          };
        },
      },
    } satisfies Instance['widgets'];

    return {
      async recap() {
        const { server_state: s } = await api<any>('sync/maindata');
        if (!s?.alltime_dl) return [];
        const ratio = s.alltime_ul / s.alltime_dl;
        return [{ id: 'seed.ratio', theme: 'network', icon: 'download', kicker: 'Your share ratio', value: ratio.toFixed(2), stat: 'Share ratio', score: 75, scope: 'All time', facts: { uploadedBytes: s.alltime_ul, downloadedBytes: s.alltime_dl },
          line: `For every byte you took, ${ratio.toFixed(2)} went back.`, bars: [{ label: 'Taken', value: s.alltime_dl, show: fmt.bytes(s.alltime_dl) }, { label: 'Given back', value: s.alltime_ul, show: fmt.bytes(s.alltime_ul) }],
          trait: { name: 'The Generous Seeder', line: 'You give back far more than you take, and somewhere a stranger finished their download because of you.', strength: Math.min(1, ratio / 4) } }];
      },
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
          confirm: ({ name, do: what }) => ({ title: `${what === 'remove' ? 'Remove' : what === 'pause' ? 'Pause' : 'Resume'} ${name}?`, detail: what === 'remove' ? 'The downloaded files are kept' : undefined, icon: 'download', verb: what === 'remove' ? 'Remove' : what === 'pause' ? 'Pause' : 'Resume', danger: what === 'remove' }),
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
          live: true,
          label: 'Checked downloads',
          followUps: ['When will it finish?', 'Pause downloads'],
          description: 'Every unfinished torrent with progress, speed, size left and ETA, plus total transfer speed. `stuck` counts torrents getting nothing: stalled, or still looking for peers; `waitingHours` says how long each has been in the list.',
          access: 'read', input: z.object({}),
          async run() {
            const { info, dl, stuck } = await state();
            return {
              data: { down: fmt.rate(info.dl_info_speed), up: fmt.rate(info.up_info_speed), count: dl.length, stuck: stuck.length,
                      torrents: dl.slice(0, 25).map(t => ({ name: t.name, hash: t.hash, progress: fmt.pct(t.progress), state: t.state,
                        speed: fmt.rate(t.dlspeed), left: fmt.bytes(t.amount_left), eta: fmt.duration(t.eta), seeds: t.num_seeds, stuck: isStuck(t), waitingHours: t.added_on ? Math.round((Date.now() / 1000 - t.added_on) / 3600) : undefined })) },
              card: await widgets.active.fetch(),
            };
          },
        },
        pause_downloads: {
          undo: 'resume_downloads',
          label: 'Paused downloads',
          confirm: ({ hash }) => ({ title: hash ? 'Pause this download?' : 'Pause all downloads?', icon: 'download', verb: 'Pause' }),
          followUps: ['Resume downloads'],
          description: 'Pause downloading. Pass a torrent hash from downloads_status to pause one, or nothing to pause all.',
          access: 'control', input: z.object({ hash: z.string().optional() }),
          async run({ hash }) {
            await api('torrents/stop', { method: 'POST', body: new URLSearchParams({ hashes: hash ?? 'all' }) });
            return { data: { paused: hash ?? 'all' } };
          },
        },
        resume_downloads: {
          undo: 'pause_downloads',
          label: 'Resumed downloads',
          confirm: ({ hash }) => ({ title: hash ? 'Resume this download?' : 'Resume all downloads?', icon: 'download', verb: 'Resume' }),
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
