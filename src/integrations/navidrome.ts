// Navidrome, over the Subsonic API: what's playing, the albums played lately and most, what's new, and a few to
// rediscover, all with their covers. The assistant can say what's on and search the music.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import { tally } from '../server/service.ts';
import type { MediaItem, ShelfItem } from '../shared/cards.ts';

const COVER = /^[\w.-]{1,128}$/;                     // Navidrome's are like al-<id>_<hash>; other servers use plain ids
const ID = /^[\w.-]{1,128}$/;
const list = <T>(x: T | T[] | undefined): T[] => x == null ? [] : Array.isArray(x) ? x : [x];   // a lone element may come bare
const clamp = (x: number) => Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;

export default defineIntegration({
  type: 'navidrome',
  name: 'Navidrome',
  config: z.object({
    url: z.string().url(), username: z.string(), password: z.string(), href: z.string().optional(),
    every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
  }).strict(),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, ''), insecure = cfg.insecure === true;
    const source = { name: 'Navidrome', icon: '/api/icon/navidrome' };
    // Subsonic signs each request: md5 of the password and a fresh salt, so the password itself never travels
    const signed = (call: string, params: Record<string, string | number> = {}) => {
      const salt = randomBytes(8).toString('hex'), token = createHash('md5').update(`${cfg.password}${salt}`).digest('hex');
      const q = new URLSearchParams({ u: cfg.username, t: token, s: salt, v: '1.16.1', c: 'valet', f: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
      return `${base}/rest/${call}?${q}`;
    };
    // Subsonic answers 200 even when it says no
    const api = async (call: string, params: Record<string, string | number> = {}) => {
      const s = (await ctx.http<any>(signed(call, params), { insecure, timeout: 15_000 }))?.['subsonic-response'];
      if (!s) throw new Error('Navidrome didn\'t answer as Subsonic: is the url right?');
      if (s.status === 'failed') throw new Error(`Navidrome refused: ${s.error?.message ?? 'no reason given'}`);
      return s;
    };
    const cover = (id: unknown) => typeof id === 'string' && COVER.test(id) ? ctx.image(id) : undefined;
    const albumLink = (id: unknown) => typeof id === 'string' && ID.test(id) ? `${web}/app/#/album/${encodeURIComponent(id)}/show` : web;
    const albums = async (type: string, size: number) => list<any>((await api('getAlbumList2', { type, size })).albumList2?.album);
    const artist = (a: any) => a.displayArtist ?? a.artist;
    const tile = (a: any): ShelfItem => ({ id: a.id, title: a.name ?? 'Untitled', subtitle: artist(a), image: cover(a.coverArt ?? a.id), href: albumLink(a.id) });

    const nowPlaying = async () => list<any>((await api('getNowPlaying')).nowPlaying?.entry).filter(e => e.state !== 'stopped');
    const toItem = (e: any): MediaItem => {
      const pos = Number(e.positionMs) / 1000, dur = Number(e.duration) || 0, has = Number.isFinite(pos) && e.positionMs != null && dur > 0;
      return { title: e.title ?? 'Untitled', subtitle: [e.artist, e.album].filter(Boolean).join(' — ') || undefined, image: cover(e.coverArt ?? e.albumId),
        pct: has ? clamp(pos / dur) : undefined, state: e.state === 'paused' ? 'paused' : 'playing', user: e.username, device: e.playerName || undefined,
        remaining: has ? `${fmt.duration(Math.max(0, dur - pos))} left` : e.minutesAgo ? `${e.minutesAgo} min ago` : undefined, icon: 'play' };
    };

    // a few albums to come back to: the same ones all day, so the card doesn't reshuffle with every refresh
    let pick: { day: string; albums: any[] } | undefined;
    const rediscover = async () => {
      const day = new Date().toDateString();
      if (pick?.day !== day) pick = { day, albums: await albums('random', 8) };
      return pick.albums;
    };

    const widgets = {
      status: {
        title: 'Navidrome', interval: (() => { const r = Every.safeParse(cfg.every); return r.success ? r.data : 60_000; })(),
        async fetch() {
          const [now, scan] = await Promise.all([nowPlaying(), api('getScanStatus').then(s => s.scanStatus, () => undefined)]);
          const songs = Number(scan?.count);
          return { type: 'stats' as const, title: 'Navidrome', icon: 'play', href: web, source,
            summary: { label: 'Navidrome', icon: 'play', value: now.length ? `${now.length} playing` : Number.isFinite(songs) ? songs.toLocaleString('en') : 'Idle', sub: now.length ? now[0].title : 'Songs' },
            items: [{ label: 'Playing now', value: now.length }, { label: 'Songs', value: Number.isFinite(songs) ? songs.toLocaleString('en') : '–', sub: scan?.scanning ? 'Scanning' : undefined }] };
        },
      },
      playing: {
        title: 'Now playing', interval: 10_000,
        async fetch() {
          const now = await nowPlaying(), items = now.map(toItem), first = items.find(i => i.state !== 'paused') ?? items[0];
          return { type: 'media' as const, title: 'Now playing', icon: 'play', href: web, source, empty: 'Nothing playing', items,
            summary: { label: 'Navidrome', icon: 'play', value: first ? first.title : 'Idle', sub: first ? first.subtitle : 'Nothing playing', image: first?.image },
            activity: first && { title: first.title, subtitle: [first.subtitle?.split(' — ')[0], first.user].filter(Boolean).join(' · '), image: first.image, icon: 'play', pct: first.pct,
              paused: first.state === 'paused', trailing: first.state === 'paused' ? 'Paused' : undefined, count: now.length > 1 ? now.length : undefined } };
        },
      },
      recent: {
        title: 'Recently played', interval: 300_000,
        async fetch() {
          const items = (await albums('recent', 12)).map(a => ({ ...tile(a), badge: a.played ? fmt.relativeDay(a.played).replace('Tonight', 'Today') : undefined }));
          return { type: 'shelf' as const, title: 'Recently played', icon: 'play', href: web, source, aspect: 'square' as const, items, empty: 'Nothing played yet',
            summary: items[0] && { label: 'Last played', icon: 'play', value: items[0].title, sub: items[0].subtitle, image: items[0].image } };
        },
      },
      added: {
        title: 'New music', interval: 900_000,
        async fetch() {
          const items = (await albums('newest', 12)).map(a => ({ ...tile(a), badge: a.created ? fmt.relativeDay(a.created).replace('Tonight', 'Today') : undefined }));
          return { type: 'shelf' as const, title: 'New music', icon: 'play', href: web, source, aspect: 'square' as const, layout: 'spotlight' as const, items, empty: 'Nothing added yet',
            summary: items[0] && { label: 'New music', icon: 'play', value: items[0].title, sub: items[0].subtitle, image: items[0].image } };
        },
      },
      top: {
        title: 'Most played', interval: 3_600_000,
        async fetch() {
          const rows = (await albums('frequent', 6)).filter(a => Number(a.playCount) > 0), most = Math.max(1, ...rows.map(a => Number(a.playCount)));
          return { type: 'ranked' as const, title: 'Most played', icon: 'play', href: web, source, empty: 'Nothing played yet',
            items: rows.map(a => ({ title: a.name, subtitle: artist(a), value: `${a.playCount} play${Number(a.playCount) === 1 ? '' : 's'}`, image: cover(a.coverArt ?? a.id), pct: Number(a.playCount) / most, href: albumLink(a.id) })) };
        },
      },
      rediscover: {
        title: 'Rediscover', interval: 3_600_000,
        async fetch() {
          const items = (await rediscover()).map(a => ({ ...tile(a), note: a.year ? String(a.year) : undefined }));
          return { type: 'shelf' as const, title: 'Rediscover', icon: 'play', href: web, source, aspect: 'square' as const, layout: 'focus' as const, items, empty: 'No albums yet',
            summary: items[0] && { label: 'Rediscover', icon: 'play', value: items[0].title, sub: items[0].subtitle, image: items[0].image } };
        },
      },
    } satisfies Instance['widgets'];

    return {
      widgets,
      async recap() {
        const scan = await api('getScanStatus').then(s => s.scanStatus, () => undefined);
        return tally(scan?.count, { id: 'music.songs', theme: 'music', icon: 'play', kicker: 'Your music, on your own disks', unit: 'songs', stat: 'Songs', scope: 'All time', logo: source.icon, line: 'No subscription can take a single one of them away.' });
      },
      image(ref) {
        if (!COVER.test(ref)) throw new Error('bad image ref');
        return ctx.http<Response>(signed('getCoverArt', { id: ref, size: 600 }), { as: 'response', insecure, timeout: 15_000 });
      },
      tools: {
        navidrome_playing: {
          live: true, label: 'Checked Navidrome', followUps: ['What have I been listening to?', 'What did I play most?'],
          description: 'What is playing on Navidrome right now: song, artist, album, who and on which player, and how far in when the server says.',
          access: 'read', input: z.object({}),
          async run() {
            const now = await nowPlaying();
            return { data: now.map(e => ({ song: e.title, artist: e.artist, album: e.album, user: e.username, player: e.playerName, paused: e.state === 'paused' || undefined, minutesAgo: e.minutesAgo })), card: await widgets.playing.fetch() };
          },
        },
        navidrome_recent: {
          label: 'Checked recent listening', followUps: ['What did I play most?', 'Find something to rediscover'],
          description: 'The albums the person played most recently on Navidrome, and the ones they play most.',
          access: 'read', input: z.object({}),
          async run() {
            const [recent, top] = await Promise.all([albums('recent', 10), albums('frequent', 5)]);
            return { data: { recent: recent.map(a => ({ album: a.name, artist: artist(a), played: a.played?.slice(0, 10) })), mostPlayed: top.map(a => ({ album: a.name, artist: artist(a), plays: a.playCount })) }, card: await widgets.recent.fetch() };
          },
        },
        navidrome_search: {
          find: 'query', label: 'Searched music', followUps: ['Play count for that album?'],
          description: 'Search the music on Navidrome for artists, albums and songs by name.',
          access: 'read', input: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(20).default(10) }),
          async run({ query, limit }) {
            const r = (await api('search3', { query, artistCount: 5, albumCount: limit, songCount: limit })).searchResult3 ?? {};
            const found = { artists: list<any>(r.artist), albums: list<any>(r.album), songs: list<any>(r.song) };
            const shelf = found.albums.length ? found.albums.map(tile) : found.songs.map(s => ({ id: s.id, title: s.title, subtitle: [s.artist, s.album].filter(Boolean).join(' — '), image: cover(s.coverArt ?? s.albumId), href: albumLink(s.albumId) }));
            return {
              data: { artists: found.artists.map(a => ({ name: a.name, albums: a.albumCount })), albums: found.albums.map(a => ({ album: a.name, artist: artist(a), year: a.year, plays: a.playCount })),
                songs: found.songs.map(s => ({ song: s.title, artist: s.artist, album: s.album, length: s.duration ? fmt.duration(s.duration) : undefined })) },
              card: shelf.length ? { type: 'shelf', title: `Music · “${query}”`, icon: 'play', href: web, source, aspect: 'square', items: shelf } : { type: 'text', text: `No music matches “${query}”.` },
            };
          },
        },
      },
    };
  },
});
