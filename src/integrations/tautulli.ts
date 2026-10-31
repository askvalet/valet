// Tautulli (https://tautulli.com): who's watching what on Plex right now, what was added, and watch history.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { RankedItem, MediaItem, RecapSlide } from '../shared/cards.ts';

export default defineIntegration({
  type: 'tautulli',
  name: 'Plex (Tautulli)',
  config: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const api = async (cmd: string, params: Record<string, string | number> = {}) => {
      const q = new URLSearchParams({ apikey: cfg.apiKey, cmd, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
      const r = await ctx.http(`${base}/api/v2?${q}`);
      if (r?.response?.result !== 'success') throw new Error(r?.response?.message ?? 'Tautulli error');
      return r.response.data;
    };
    const poster = (s: any) => { const t = s.grandparent_thumb || s.parent_thumb || s.thumb; return t ? ctx.image(t) : undefined; };
    const backdrop = (s: any) => { const a = s.grandparent_art || s.art; return a ? ctx.image(a) : undefined; };
    const left = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min left` : `${m} min left`; };
    const decision = (d: string) => d === 'direct play' ? 'Direct Play' : d === 'copy' ? 'Direct Stream' : d === 'transcode' ? 'Transcode' : d;
    const added = (t: number) => {
      const d = new Date(t * 1000), days = Math.floor((Date.now() - d.getTime()) / 864e5);
      return days < 1 ? 'Today' : days < 2 ? 'Yesterday' : days < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const title = (s: any) => s.media_type === 'episode' ? s.grandparent_title : s.title;
    const subtitle = (s: any) => s.media_type === 'episode'
      ? `S${s.parent_media_index}·E${s.media_index} — ${s.title}`
      : s.media_type === 'track' ? `${s.grandparent_title} — ${s.parent_title}` : s.year ? String(s.year) : undefined;

    /** The year from Plex's own history: time watched, the favourites, who, and when. */
    async function recap({ year, from, to }: { year: number; from: number; to: number }): Promise<RecapSlide[]> {
      const rows = ((await api('get_history', { length: 20000, after: `${year}-01-01`, before: `${year}-12-31` })).data as any[]).filter(h => h.date * 1000 >= from && h.date * 1000 < to);
      if (!rows.length) return [];
      const secs = (h: any) => Number(h.play_duration ?? h.duration) || 0, total = rows.reduce((s, h) => s + secs(h), 0), hours = Math.round(total / 3600);
      const rank = (key: (h: any) => string) => { const m = new Map<string, { n: number; s: number; h: any }>(); for (const h of rows) { const k = key(h), e = m.get(k) ?? { n: 0, s: 0, h }; e.n++; e.s += secs(h); m.set(k, e); } return [...m].sort((a, b) => b[1].s - a[1].s); };
      const hrs = (s: number) => s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 60)} min`;
      const titles = rank(h => h.media_type === 'episode' ? h.grandparent_title : h.title), people = rank(h => h.friendly_name || h.user);
      const when = (o: Intl.DateTimeFormatOptions) => rows.map(h => new Date(h.date * 1000).toLocaleString('en', o));
      const most = (l: string[]) => [...l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0];
      const [day, dayN] = most(when({ weekday: 'long' })), late = rows.filter(h => { const n = new Date(h.date * 1000).getHours(); return n >= 23 || n < 5; }).length / rows.length;
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], byDay = days.map(d => ({ label: d, value: rows.filter(h => new Date(h.date * 1000).toLocaleString('en', { weekday: 'short' }) === d).length }));
      const added: any[] = await api('get_recently_added', { count: 60 }).then(d => d.recently_added, () => []);
      const recent = added.map(x => x.grandparent_thumb || x.parent_thumb || x.thumb).filter(Boolean).map(t => ctx.image(t));
      const key = titles[0][1].h.grandparent_rating_key || titles[0][1].h.rating_key;
      const art = await api('get_metadata', { rating_key: key }).then(m => m.art ? ctx.image(m.art) : undefined, () => undefined);
      const slides: RecapSlide[] = [
        { id: 'watch.hours', theme: 'media', icon: 'play', kicker: 'You watched', value: hours.toLocaleString('en'), unit: 'hours', stat: 'Hours watched', score: 95, scope: 'year', facts: { watchedHours: total / 3600 }, art: recent, wall: true,
          line: `${rows.length} plays, all from your own server.`,
          trait: { name: 'The Projectionist', line: 'The lights go down, the server spins up, and the house gets exactly what it wanted to watch.', strength: Math.min(.9, hours / 500) } },
        { id: 'watch.top', theme: 'media', icon: 'film', kicker: 'Your most watched', value: titles[0][0], backdrop: art, line: `${titles[0][1].n} ${titles[0][1].n === 1 ? 'play' : 'plays'} and ${hrs(titles[0][1].s)}, more time than anything else this year.`, score: 90, scope: 'year',
          items: titles.slice(0, 5).map(([name, e]) => ({ name, value: hrs(e.s), image: poster(e.h) })) },
        { id: 'watch.day', theme: 'media', icon: 'calendar', kicker: 'Your night in', value: `${day}s`, line: `${dayN} of your ${rows.length} plays started on a ${day}.`, score: 60, scope: 'year', bars: byDay },
      ];
      if (people.length > 1) slides.push({ id: 'watch.people', theme: 'media', icon: 'play', kicker: 'Who kept Plex busiest', value: people[0][0], line: `${hrs(people[0][1].s)} of the ${hrs(total)} everyone watched.`, score: 70, scope: 'year', private: true, bars: people.slice(0, 5).map(([label, e]) => ({ label, value: e.s, show: hrs(e.s) })) });
      if (late > .25) slides.push({ id: 'watch.late', theme: 'media', icon: 'moon', kicker: 'After 11 PM', value: `${Math.round(late * 100)}%`, line: 'of everything you watched started when you should have been asleep.', score: 55, scope: 'year', trait: { name: 'The Night Owl', line: "The disks spin, the house sleeps, and you're still one more episode away from bed.", strength: late } });
      return slides;
    }

    const bw: number[] = [];
    async function activity() {
      const d = await api('get_activity');
      return { count: Number(d.stream_count), bandwidth: Number(d.total_bandwidth), sessions: d.sessions as any[] };
    }
    const toItem = (s: any): MediaItem => ({
      title: title(s), subtitle: subtitle(s), image: poster(s), backdrop: backdrop(s), pct: Number(s.progress_percent) / 100,
      tags: [s.stream_video_full_resolution, decision(s.transcode_decision), `${(Number(s.bandwidth) / 1000).toFixed(0)} Mbps`].filter(Boolean),
      remaining: left(Number(s.duration) - Number(s.view_offset)),
      state: s.state === 'paused' ? 'paused' : s.state === 'buffering' ? 'buffering' : 'playing',
      user: s.friendly_name, device: s.player,
      detail: [s.stream_video_full_resolution, s.transcode_decision === 'direct play' ? 'direct' : s.transcode_decision,
        `${(Number(s.bandwidth) / 1000).toFixed(0)} Mbps`].filter(Boolean).join(' · '),
    });

    const source = { name: 'Plex', icon: '/api/icon/plex' };
    const stat = (stats: any[], id: string): any[] => stats.find(x => x.stat_id === id)?.rows ?? [];
    const art = (r: any) => { const a = r.art || r.grandparent_art; return a ? ctx.image(a) : undefined; };
    /** Films and shows together, by time watched. */
    async function mostWatched(n: number): Promise<RankedItem[]> {
      const home = await api('get_home_stats', { time_range: 30, stats_count: n }) as any[];
      const rows = [...stat(home, 'top_movies').map(r => ({ ...r, kind: 'Movie' })), ...stat(home, 'top_tv').map(r => ({ ...r, kind: 'Show' }))].sort((a, b) => (b.total_duration ?? 0) - (a.total_duration ?? 0)).slice(0, n);
      const top = Math.max(1, ...rows.map(r => r.total_duration ?? 0));
      return rows.map(r => ({ title: r.title, subtitle: `${r.total_plays} play${r.total_plays === 1 ? '' : 's'}`, value: fmt.duration(r.total_duration ?? 0), image: r.thumb ? ctx.image(r.thumb) : undefined, backdrop: art(r), pct: (r.total_duration ?? 0) / top }));
    }

    const widgets = {
      library: {
        title: 'Your library', interval: 3_600_000,
        async fetch() {
          const libs = await api('get_libraries') as any[], sum = (t: string, k: string) => libs.filter(l => l.section_type === t).reduce((n, l) => n + Number(l[k] ?? 0), 0);
          const plays = await api('get_plays_by_date', { time_range: 30 }).catch(() => null);
          const total = (plays?.series as any[] | undefined)?.find(x => x.name === 'Total')?.data as number[] | undefined;
          const head = (label: string, n: number, icon: string, sub?: string) => ({ label, icon, value: n.toLocaleString(), sub });
          return { type: 'stats', title: 'Your library', icon: 'film', href: cfg.href, source, items: [{ label: 'Movies', value: sum('movie', 'count').toLocaleString() }, { label: 'Shows', value: sum('show', 'count').toLocaleString() }, { label: 'Episodes', value: sum('show', 'child_count').toLocaleString() }],
            summaries: [head('Movies', sum('movie', 'count'), 'film'), head('Shows', sum('show', 'count'), 'play', `${sum('show', 'parent_count').toLocaleString()} seasons`), head('Episodes', sum('show', 'child_count'), 'pulse'),
              ...(total ? [{ ...head('Plays', total.reduce((a, b) => a + b, 0), 'chart', 'last 30 days'), trend: total }] : [])] };
        },
      },
      top: {
        title: 'Most watched', interval: 3_600_000,
        async fetch() { return { type: 'ranked', title: 'Most watched', icon: 'film', source, note: 'last 30 days', items: await mostWatched(6), empty: 'Nothing watched yet' }; },
      },
      people: {
        title: 'Who\'s watching', interval: 3_600_000,
        async fetch() {
          const rows = stat(await api('get_home_stats', { time_range: 30, stats_count: 6 }) as any[], 'top_users'), top = Math.max(1, ...rows.map(r => r.total_duration ?? 0));
          return { type: 'list', title: 'Who\'s watching', icon: 'play', source, note: 'last 30 days', empty: 'Nobody yet',
            items: rows.map(r => ({ title: r.friendly_name, subtitle: `${r.total_plays} plays`, meta: fmt.duration(r.total_duration ?? 0), pct: (r.total_duration ?? 0) / top })) };
        },
      },
      plays: {
        title: 'Plays', interval: 3_600_000,
        async fetch() {
          const d = await api('get_plays_by_date', { time_range: 30 }), series = (d.series as any[]).filter(x => x.name !== 'Total' && x.data.some((n: number) => n > 0));
          const all = (d.series as any[]).find(x => x.name === 'Total')?.data as number[] | undefined;
          return { type: 'chart', title: 'Plays', icon: 'chart', source, span: 'last 30 days', headline: all ? `${all.reduce((a, b) => a + b, 0)} plays` : undefined, labels: d.categories, series: series.map(x => ({ name: x.name, points: x.data })) };
        },
      },
      streams: {
        title: 'Now playing', interval: 10_000,
        async fetch() {
          const a = await activity();
          bw.push(a.bandwidth / 1000); if (bw.length > 40) bw.shift();
          const items = a.sessions.map(toItem), first = items.find(i => i.state !== 'paused') ?? items[0];
          return { type: 'media', title: 'Now playing', icon: 'play', href: cfg.href, source, empty: 'Nothing playing',
            summary: { label: 'Plex', icon: 'play', value: a.count ? `${a.count} stream${a.count > 1 ? 's' : ''}` : 'Idle',
              sub: a.count ? [...new Set(a.sessions.map(s => s.friendly_name))].join(', ') : 'Nothing playing',
              detail: a.count ? `${(a.bandwidth / 1000).toFixed(0)} Mbps` : undefined, trend: [...bw] },
            note: a.count ? `${a.count} stream${a.count > 1 ? 's' : ''} · ${(a.bandwidth / 1000).toFixed(0)} Mbps` : undefined,
            activity: first && { title: first.title, subtitle: [first.user, first.device].filter(Boolean).join(' · '), image: first.image, icon: 'play',
              pct: first.pct, trailing: first.state === 'paused' ? 'Paused' : first.remaining, paused: first.state === 'paused', count: a.count },
            items };
        },
      },
      recent: {
        title: 'Recently added', interval: 300_000,
        async fetch() {
          const d = await api('get_recently_added', { count: 12 });
          return { type: 'shelf', title: 'Recently added', icon: 'film', href: cfg.href, aspect: 'poster', layout: 'spotlight', source,
            items: (d.recently_added as any[]).map(r => ({
              backdrop: r.art || r.grandparent_art || r.parent_art ? ctx.image(r.art || r.grandparent_art || r.parent_art) : undefined,
              title: r.media_type === 'season' ? r.parent_title : r.media_type === 'episode' ? r.grandparent_title : r.title,
              subtitle: r.media_type === 'season' ? r.title : r.media_type === 'episode' ? `S${r.parent_media_index} · E${r.media_index}` : r.year ? String(r.year) : undefined,
              image: ctx.image(r.media_type === 'episode' ? (r.grandparent_thumb || r.thumb) : r.thumb || r.parent_thumb),
              badge: added(Number(r.added_at)) })) };
        },
      },
    } satisfies Instance['widgets'];

    return {
      recap,
      widgets,
      image(ref) {
        if (!/^\/library\/metadata\/\d+\/(thumb|art)(\/\d+)?$/.test(ref)) throw new Error('bad image ref');
        // backdrops wide and sharp; posters at 2× for retina shelves
        const art = /\/art(\/|$)/.test(ref);
        const q = new URLSearchParams({ apikey: cfg.apiKey, cmd: 'pms_image_proxy', img: ref, width: art ? '1280' : '480', height: art ? '720' : '720',
          fallback: art ? 'art' : 'poster', img_format: 'jpg' });   // JPEG: a backdrop is ~100 KB instead of ~900 KB as PNG
        return ctx.http<Response>(`${base}/api/v2?${q}`, { as: 'response' });
      },
      tools: {
        plex_stop_stream: {
          label: 'Stopped a stream',
          confirm: ({ who, message }) => ({ title: `Stop ${who}'s stream?`, detail: message ? `They'll see: ${message}` : undefined, icon: 'play', verb: 'Stop', danger: true }),
          description: 'Stop someone\'s Plex stream, with a short message they\'ll see. Identify it by the user\'s name or the title (from plex_streams).',
          access: 'control', input: z.object({ who: z.string().describe('user name or title'), message: z.string().default('Stopped by the server owner.') }),
          async run({ who, message }) {
            const a = await activity(), w = who.toLowerCase();
            const s = a.sessions.find(x => String(x.friendly_name).toLowerCase().includes(w) || String(x.full_title).toLowerCase().includes(w));
            if (!s) return { data: { error: `no stream matches ${who}` } };
            await api('terminate_session', { session_key: s.session_key, message });
            return { data: { stopped: s.full_title, user: s.friendly_name }, card: { type: 'text', tone: 'warn', text: `Stopped ${s.friendly_name}'s ${s.full_title}.` } };
          },
        },
        plex_streams: {
          live: true,
          label: 'Checked Plex',
          followUps: ['What was added recently?', 'Who watched the most this week?'],
          description: 'Who is watching what on Plex right now: title, user, device, progress, quality, direct play or transcode, bandwidth.',
          access: 'read', input: z.object({}),
          async run() {
            const a = await activity();
            return {
              data: { streams: a.count, totalMbps: Math.round(a.bandwidth / 1000), sessions: a.sessions.map(s => ({
                title: s.full_title, user: s.friendly_name, device: `${s.player} (${s.product})`, state: s.state, progress: `${s.progress_percent}%`,
                quality: s.stream_video_full_resolution, decision: s.transcode_decision, mbps: Math.round(Number(s.bandwidth) / 1000),
                remote: s.location === 'wan', timeLeft: fmt.duration((Number(s.duration) - Number(s.view_offset)) / 1000) })) },
              card: await widgets.streams.fetch(),
            };
          },
        },
        plex_recently_added: {
          label: 'Checked what was added',
          followUps: ["What's playing now?"],
          description: 'The most recently added movies and episodes on Plex.',
          access: 'read', input: z.object({ count: z.number().int().min(1).max(25).default(8) }),
          async run({ count }) {
            const d = await api('get_recently_added', { count });
            const items = (d.recently_added as any[]).map(r => ({ title: r.full_title || r.title, type: r.media_type, added: new Date(Number(r.added_at) * 1000).toDateString() }));
            return { data: items, card: await widgets.recent.fetch() };
          },
        },
        plex_stats: {
          label: 'Checked what\'s popular', followUps: ['Who watched the most?', 'What should I watch next?'],
          description: 'What\'s been watched most on Plex in the last 30 days, and who has watched the most. Use for "what do we watch", "most popular", "who watches the most".',
          access: 'read', input: z.object({}),
          async run() {
            const items = await mostWatched(6), users = stat(await api('get_home_stats', { time_range: 30, stats_count: 6 }) as any[], 'top_users');
            return { data: { mostWatched: items.map(i => ({ title: i.title, plays: i.subtitle, time: i.value })), people: users.map(u => ({ name: u.friendly_name, plays: u.total_plays, time: fmt.duration(u.total_duration ?? 0) })) },
              card: { type: 'ranked', title: 'Most watched', icon: 'film', source, items } };
          },
        },
        plex_history: {
          label: 'Checked Plex history',
          followUps: ['What was added recently?'],
          description: 'Recent watch history: who watched what and when. Optionally filter by user name.',
          access: 'read', input: z.object({ user: z.string().optional(), count: z.number().int().min(1).max(50).default(15) }),
          async run({ user, count }) {
            const d = await api('get_history', { length: count, ...(user ? { search: user } : {}) });
            const rows = (d.data as any[]).map(h => ({ at: h.date * 1000, when: new Date(h.date * 1000).toLocaleString(), user: h.friendly_name, title: h.full_title, watched: `${h.percent_complete}%`, device: h.player }));
            return { data: rows.map(({ at, ...r }) => r), card: { type: 'list', title: 'Watch history', icon: 'film', items: rows.map(r => ({ title: r.title, subtitle: `${r.user} · ${r.device}`, meta: `${fmt.relativeDay(r.at)}, ${fmt.time(r.at)}` })) } };
          },
        },
      },
    };
  },
});
