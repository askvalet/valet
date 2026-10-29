// Tautulli (https://tautulli.com): who's watching what on Plex right now, what was added, and watch history.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { MediaItem } from '../shared/cards.ts';

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

    const widgets = {
      streams: {
        title: 'Now playing', interval: 10_000,
        async fetch() {
          const a = await activity();
          return { type: 'media', title: 'Now playing', icon: 'play', href: cfg.href, empty: 'Nothing playing',
            summary: { label: 'Streaming', value: a.count, sub: a.count ? `${(a.bandwidth / 1000).toFixed(0)} Mbps · ${[...new Set(a.sessions.map(s => s.friendly_name))].join(', ')}` : 'Nothing playing' },
            note: a.count ? `${a.count} stream${a.count > 1 ? 's' : ''} · ${(a.bandwidth / 1000).toFixed(0)} Mbps` : undefined,
            items: a.sessions.map(toItem) };
        },
      },
      recent: {
        title: 'Recently added', interval: 300_000,
        async fetch() {
          const d = await api('get_recently_added', { count: 12 });
          return { type: 'shelf', title: 'Recently added', icon: 'film', href: cfg.href, aspect: 'poster',
            items: (d.recently_added as any[]).map(r => ({
              title: r.media_type === 'season' ? r.parent_title : r.media_type === 'episode' ? r.grandparent_title : r.title,
              subtitle: r.media_type === 'season' ? r.title : r.media_type === 'episode' ? `S${r.parent_media_index} · E${r.media_index}` : r.year ? String(r.year) : undefined,
              image: ctx.image(r.media_type === 'episode' ? (r.grandparent_thumb || r.thumb) : r.thumb || r.parent_thumb),
              badge: added(Number(r.added_at)) })) };
        },
      },
    } satisfies Instance['widgets'];

    return {
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
        plex_streams: {
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
          description: 'The most recently added movies and episodes on Plex.',
          access: 'read', input: z.object({ count: z.number().int().min(1).max(25).default(8) }),
          async run({ count }) {
            const d = await api('get_recently_added', { count });
            const items = (d.recently_added as any[]).map(r => ({ title: r.full_title || r.title, type: r.media_type, added: new Date(Number(r.added_at) * 1000).toDateString() }));
            return { data: items, card: await widgets.recent.fetch() };
          },
        },
        plex_history: {
          description: 'Recent watch history: who watched what and when. Optionally filter by user name.',
          access: 'read', input: z.object({ user: z.string().optional(), count: z.number().int().min(1).max(50).default(15) }),
          async run({ user, count }) {
            const d = await api('get_history', { length: count, ...(user ? { search: user } : {}) });
            const rows = (d.data as any[]).map(h => ({ when: new Date(h.date * 1000).toLocaleString(), user: h.friendly_name, title: h.full_title, watched: `${h.percent_complete}%`, device: h.player }));
            return { data: rows, card: { type: 'list', title: 'Watch history', icon: 'film', items: rows.map(r => ({ title: r.title, subtitle: `${r.user} · ${r.device}`, meta: r.when.replace(/:\d\d(\s|$)/, '$1') })) } };
          },
        },
      },
    };
  },
});
