// Jellyfin: what's playing and on which screen, what you're partway through, what just arrived, and the library's size.
// The assistant can say what's on, search the library, and stop a stream after asking. Emby speaks the same API (Jellyfin
// began as its fork), so `mediaServer` below is both: emby.ts is this with Emby's paths.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, fmt, type Context, type Instance } from '../server/core.ts';
import { tally } from '../server/service.ts';
import type { MediaItem, ShelfItem } from '../shared/cards.ts';

const TICKS = 1e7;                                   // .NET ticks: ten million a second
const ID = /^[A-Za-z0-9-]{1,64}$/;                   // Jellyfin's ids are 32 hex digits, Emby's are numbers
const REF = /^([A-Za-z0-9-]{1,64})\/(Primary|Backdrop|Thumb)(?:\/([A-Za-z0-9]{1,64}))?$/;

/** What differs between Jellyfin and Emby: the path prefix, the per-user routes and the web app's links. */
export interface Flavour {
  type: string; name: string;
  prefix: string;                                    // Emby answers under /emby
  resume(user: string): string;                      // each ends ready for more query: "…?" or "…&"
  latest(user: string): string;
  items(user: string): string;
  sessions: string;
  link(web: string, item: any): string;
  auth(key: string): Record<string, string>;
}
export const serverConfig = z.object({
  url: z.string().url(), key: z.string(), href: z.string().optional(),
  user: z.string().optional().describe('Whose "continue watching" and "recently added" to show, by user name. The first administrator if left out.'),
  every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
}).strict();
type Cfg = z.infer<typeof serverConfig>;

const seconds = (every: unknown) => { const r = Every.safeParse(every); return r.success ? r.data : undefined; };
const clamp = (x: number) => Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;
const left = (ticks: number) => { const m = Math.max(0, Math.round(ticks / TICKS / 60)); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min left` : `${m} min left`; };
const method = (m?: string) => m === 'DirectPlay' ? 'Direct Play' : m === 'DirectStream' ? 'Direct Stream' : m === 'Transcode' ? 'Transcode' : undefined;
const episode = (i: any) => i.ParentIndexNumber != null && i.IndexNumber != null ? `S${i.ParentIndexNumber} · E${i.IndexNumber}` : undefined;
/** The name a person would say: the show for an episode, the album for a song. */
export const titleOf = (i: any) => i.Type === 'Episode' || i.Type === 'Season' ? i.SeriesName ?? i.Name : i.Name ?? 'Untitled';
export const subtitleOf = (i: any) => i.Type === 'Episode' ? [episode(i), i.Name].filter(Boolean).join(' — ')
  : i.Type === 'Season' ? i.Name
  : i.Type === 'Audio' ? [i.AlbumArtist ?? i.Artists?.[0], i.Album].filter(Boolean).join(' — ') || undefined
  : i.Type === 'MusicAlbum' ? i.AlbumArtist ?? i.Artists?.[0]
  : i.ProductionYear ? String(i.ProductionYear) : undefined;
const kind = (t?: string) => ({ Movie: 'film', Series: 'show', Episode: 'episode', Season: 'season', MusicAlbum: 'album', Audio: 'song', AudioBook: 'audiobook', MusicVideo: 'music video' } as Record<string, string>)[t ?? ''] ?? t?.toLowerCase();

export function mediaServer(f: Flavour) {
  return defineIntegration({
    type: f.type,
    name: f.name,
    config: serverConfig,
    create(cfg: Cfg, ctx: Context): Instance {
      const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, ''), insecure = cfg.insecure === true;
      const headers = { Accept: 'application/json', ...f.auth(cfg.key) };
      const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}${f.prefix}${path}`, { ...init, headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, insecure, timeout: 15_000, ...(init.method === 'POST' ? { as: 'text' } : {}) });
      const source = { name: f.name, icon: `/api/icon/${f.type}` };
      const ref = (id: unknown, type: 'Primary' | 'Backdrop' | 'Thumb', tag?: unknown) =>
        typeof id === 'string' && ID.test(id) ? ctx.image(`${id}/${type}${typeof tag === 'string' && /^[A-Za-z0-9]{1,64}$/.test(tag) ? `/${tag}` : ''}`) : undefined;
      const poster = (i: any) => (i.Type === 'Episode' || i.Type === 'Season') && i.SeriesId && i.SeriesPrimaryImageTag ? ref(i.SeriesId, 'Primary', i.SeriesPrimaryImageTag)
        : i.ImageTags?.Primary ? ref(i.Id, 'Primary', i.ImageTags.Primary)
        : i.AlbumId && i.AlbumPrimaryImageTag ? ref(i.AlbumId, 'Primary', i.AlbumPrimaryImageTag) : undefined;
      const backdrop = (i: any) => i.BackdropImageTags?.[0] ? ref(i.Id, 'Backdrop', i.BackdropImageTags[0])
        : i.ParentBackdropItemId && i.ParentBackdropImageTags?.[0] ? ref(i.ParentBackdropItemId, 'Backdrop', i.ParentBackdropImageTags[0]) : undefined;
      const link = (i: any) => typeof i.Id === 'string' && ID.test(i.Id) ? f.link(web, i) : web;

      // The person whose shelves these are. An API key belongs to no one, so it's the named user or the first administrator.
      let who: Promise<{ id: string; name: string }> | undefined;
      const user = () => who ??= api<any[]>('/Users').then(list => {
        const live = (list ?? []).filter(u => !u?.Policy?.IsDisabled);
        const u = cfg.user ? live.find(x => String(x.Name).toLowerCase() === cfg.user!.toLowerCase()) : live.find(x => x?.Policy?.IsAdministrator) ?? live[0];
        if (!u || !ID.test(String(u.Id))) throw new Error(cfg.user ? `${f.name} has no user called ${cfg.user}` : `${f.name} lists no users: is the key an API key?`);
        return { id: String(u.Id), name: String(u.Name) };
      }).catch(e => { who = undefined; throw e; });

      const playing = async () => ((await api<any[]>(f.sessions)) ?? []).filter(s => s?.NowPlayingItem);
      const toItem = (s: any): MediaItem => {
        const i = s.NowPlayingItem, at = Number(s.PlayState?.PositionTicks) || 0, run = Number(i.RunTimeTicks) || 0, t = s.TranscodingInfo;
        const height = Number(t?.Height ?? i.Height) || 0, mbps = Number(t?.Bitrate) / 1e6;
        const tags = [height >= 2000 ? '4K' : height ? `${height}p` : undefined, method(s.PlayState?.PlayMethod), mbps > 0 ? `${mbps.toFixed(0)} Mbps` : undefined].filter(Boolean) as string[];
        return { title: titleOf(i), subtitle: subtitleOf(i), image: poster(i), backdrop: backdrop(i), pct: run ? clamp(at / run) : undefined,
          state: s.PlayState?.IsPaused ? 'paused' : 'playing', user: s.UserName, device: s.DeviceName ?? s.Client,
          tags: tags.length ? tags : undefined, remaining: run ? left(run - at) : undefined, icon: i.MediaType === 'Audio' ? 'play' : undefined };
      };
      const brief = (s: any) => {
        const i = s.NowPlayingItem, run = Number(i.RunTimeTicks) || 0, at = Number(s.PlayState?.PositionTicks) || 0;
        return { title: [titleOf(i), subtitleOf(i)].filter(Boolean).join(' — '), kind: kind(i.Type), user: s.UserName, device: [s.DeviceName, s.Client].filter(Boolean).join(' · '),
          paused: !!s.PlayState?.IsPaused, progress: run ? fmt.pct(at / run) : undefined, timeLeft: run ? fmt.duration((run - at) / TICKS) : undefined,
          playback: method(s.PlayState?.PlayMethod), transcodeReasons: s.TranscodingInfo?.TranscodeReasons };
      };

      const widgets = {
        status: {
          title: f.name, interval: seconds(cfg.every) ?? 60_000,
          async fetch() {
            const [counts, now] = await Promise.all([api<any>('/Items/Counts'), playing()]);
            const n = (k: string) => Number(counts?.[k] ?? 0);
            return { type: 'stats' as const, title: f.name, icon: 'film', href: web, source,
              summary: { label: f.name, icon: 'film', value: now.length ? `${now.length} playing` : n('MovieCount').toLocaleString('en'), sub: now.length ? [...new Set(now.map(s => s.UserName))].join(', ') : 'Movies' },
              items: [{ label: 'Playing now', value: now.length }, { label: 'Movies', value: n('MovieCount').toLocaleString('en') }, { label: 'Series', value: n('SeriesCount').toLocaleString('en') },
                { label: 'Episodes', value: n('EpisodeCount').toLocaleString('en') }, ...(n('SongCount') ? [{ label: 'Songs', value: n('SongCount').toLocaleString('en') }] : [])] };
          },
        },
        library: {
          title: 'Your library', interval: 3_600_000,
          async fetch() {
            const c = await api<any>('/Items/Counts'), n = (k: string) => Number(c?.[k] ?? 0);
            const parts = ([['Movies', 'MovieCount', 'film'], ['Shows', 'SeriesCount', 'play'], ['Episodes', 'EpisodeCount', 'pulse'], ['Albums', 'AlbumCount', 'play'], ['Books', 'BookCount', 'book']] as const).filter(([, k], i) => i < 3 || n(k));
            return { type: 'stats' as const, title: 'Your library', icon: 'film', href: web, source,
              items: parts.map(([label, k]) => ({ label, value: n(k).toLocaleString('en') })),
              summaries: parts.map(([label, k, icon]) => ({ label, icon, value: n(k).toLocaleString('en') })) };
          },
        },
        streams: {
          title: 'Now playing', interval: 10_000,
          async fetch() {
            const now = await playing(), items = now.map(toItem), first = items.find(i => i.state !== 'paused') ?? items[0];
            return { type: 'media' as const, title: 'Now playing', icon: 'play', href: web, source, empty: 'Nothing playing', items,
              note: now.length > 1 ? `${now.length} streams` : undefined,
              summary: { label: f.name, icon: 'play', value: now.length ? `${now.length} stream${now.length > 1 ? 's' : ''}` : 'Idle', sub: now.length ? [...new Set(now.map(s => s.UserName))].join(', ') : 'Nothing playing', image: first?.image },
              activity: first && { title: first.title, subtitle: [first.user, first.device].filter(Boolean).join(' · '), image: first.image, icon: 'play', pct: first.pct,
                trailing: first.state === 'paused' ? 'Paused' : first.remaining?.replace(' hr ', 'h ').replace(' min left', 'm left'), paused: first.state === 'paused', count: now.length > 1 ? now.length : undefined } };
          },
        },
        resume: {
          title: 'Continue watching', interval: 300_000,
          async fetch() {
            const u = await user(), r = await api<any>(`${f.resume(u.id)}Limit=12&MediaTypes=Video&Fields=PrimaryImageAspectRatio&EnableUserData=true`);
            const items: ShelfItem[] = (r?.Items ?? []).map((i: any) => {
              const run = Number(i.RunTimeTicks) || 0, at = Number(i.UserData?.PlaybackPositionTicks) || 0, pct = Number(i.UserData?.PlayedPercentage) || (run ? at / run * 100 : 0);
              return { id: i.Id, title: titleOf(i), subtitle: subtitleOf(i), image: poster(i), backdrop: backdrop(i), href: link(i), badge: pct ? `${Math.round(pct)}%` : undefined, note: run ? left(run - at) : undefined };
            });
            return { type: 'shelf' as const, title: 'Continue watching', icon: 'play', href: web, source, aspect: 'poster' as const, items, empty: 'Nothing half-watched', note: u.name,
              summary: items[0] && { label: 'Continue watching', icon: 'play', value: items[0].title, sub: [items[0].subtitle, items[0].badge].filter(Boolean).join(' · ') || undefined, image: items[0].backdrop ?? items[0].image } };
          },
        },
        recent: {
          title: 'Recently added', interval: 300_000,
          async fetch() {
            const u = await user(), list = await api<any[]>(`${f.latest(u.id)}Limit=16&Fields=DateCreated,PrimaryImageAspectRatio&IncludeItemTypes=Movie,Series,Episode&GroupItems=true`);
            const items: ShelfItem[] = (list ?? []).map(i => ({ id: i.Id, title: titleOf(i), subtitle: subtitleOf(i), image: poster(i), backdrop: backdrop(i), href: link(i), badge: i.DateCreated ? fmt.relativeDay(i.DateCreated).replace('Tonight', 'Today') : undefined }));
            return { type: 'shelf' as const, title: 'Recently added', icon: 'film', href: web, source, aspect: 'poster' as const, layout: 'spotlight' as const, items, empty: 'Nothing added yet',
              summary: items[0] && { label: 'Recently added', icon: 'film', value: items[0].title, sub: items[0].badge, image: items[0].backdrop ?? items[0].image } };
          },
        },
      } satisfies Instance['widgets'];

      /** The one stream a person means: by user, device or title. Anything less certain is refused, never guessed. */
      async function theSession(who: string) {
        const w = who.trim().toLowerCase(), now = await playing();
        const hits = now.filter(s => [s.UserName, s.DeviceName, s.Client, titleOf(s.NowPlayingItem), s.NowPlayingItem?.Name].some(x => typeof x === 'string' && x.toLowerCase().includes(w)));
        if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} streams match "${who}" (${hits.map(s => `${s.UserName} on ${s.DeviceName}`).join(', ')}): say which` : `no stream matches "${who}"`);
        const s = hits[0];
        if (typeof s.Id !== 'string' || !ID.test(s.Id)) throw new Error('that stream has no id Valet can use');
        if (s.SupportsRemoteControl === false) throw new Error(`${s.DeviceName ?? 'that player'} doesn't take remote commands`);
        return s;
      }
      const t = f.type.replace(/[^a-z0-9]+/g, '_');

      return {
        widgets,
        async recap() {
          const c = await api<any>('/Items/Counts'), movies = Number(c?.MovieCount ?? 0), shows = Number(c?.SeriesCount ?? 0);
          return tally(movies + shows, { id: `${f.type}.shelf`, theme: 'media', icon: 'film', kicker: `On your ${f.name} shelf`, unit: 'titles', stat: 'Titles', scope: 'All time', logo: `/api/icon/${f.type}`,
            line: `${movies} films and ${shows} shows, ${Number(c?.EpisodeCount ?? 0)} episodes in all.` });
        },
        image(r) {
          const m = REF.exec(r);
          if (!m) throw new Error('bad image ref');
          const [, id, type, tag] = m, wide = type !== 'Primary';
          const q = new URLSearchParams({ maxWidth: wide ? '1280' : '480', quality: '85', ...(tag ? { tag } : {}) });
          return ctx.http<Response>(`${base}${f.prefix}/Items/${encodeURIComponent(id)}/Images/${type}?${q}`, { as: 'response', headers: f.auth(cfg.key), insecure, timeout: 15_000 });
        },
        tools: {
          [`${t}_playing`]: {
            live: true, label: `Checked ${f.name}`, followUps: ['What was added recently?', 'What am I partway through?'],
            description: `Who is watching or listening to what on ${f.name} right now: title, user, device, progress, time left, and direct play or transcode.`,
            access: 'read', input: z.object({}),
            async run() { const now = await playing(); return { data: { streams: now.length, sessions: now.map(brief) }, card: await widgets.streams.fetch() }; },
          },
          [`${t}_continue`]: {
            label: 'Checked what you were watching', followUps: ['What was added recently?'],
            description: `What the person is partway through on ${f.name} (continue watching), with how far along and time left.`,
            access: 'read', input: z.object({}),
            async run() { const card = await widgets.resume.fetch(); return { data: card.items.map(i => ({ title: [i.title, i.subtitle].filter(Boolean).join(' — '), watched: i.badge, left: i.note })), card }; },
          },
          [`${t}_recent`]: {
            label: 'Checked what was added', followUps: ["What's playing now?"],
            description: `The latest films, shows and episodes added to ${f.name}.`,
            access: 'read', input: z.object({}),
            async run() { const card = await widgets.recent.fetch(); return { data: card.items.map(i => ({ title: [i.title, i.subtitle].filter(Boolean).join(' — '), added: i.badge })), card }; },
          },
          [`${t}_search`]: {
            find: 'query', label: `Searched ${f.name}`, followUps: ['Is any of it half-watched?'],
            description: `Search the ${f.name} library by title: films, shows, episodes and albums, with year, whether it's been watched and how far along.`,
            access: 'read', input: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(24).default(12) }),
            async run({ query, limit }) {
              const u = await user();
              const r = await api<any>(`${f.items(u.id)}SearchTerm=${encodeURIComponent(query)}&Recursive=true&IncludeItemTypes=Movie,Series,Episode,MusicAlbum&Limit=${limit}&Fields=ProductionYear,Overview&EnableUserData=true`);
              const list: any[] = r?.Items ?? [];
              return {
                data: list.map(i => ({ title: titleOf(i), detail: subtitleOf(i), kind: kind(i.Type), watched: i.UserData?.Played || undefined, progress: i.UserData?.PlayedPercentage ? `${Math.round(i.UserData.PlayedPercentage)}%` : undefined, overview: i.Overview ? String(i.Overview).slice(0, 200) : undefined })),
                card: list.length ? { type: 'shelf', title: `${f.name} · “${query}”`, icon: 'film', href: web, source, aspect: 'poster', items: list.map(i => ({ id: i.Id, title: titleOf(i), subtitle: subtitleOf(i), image: poster(i), href: link(i), badge: i.UserData?.Played ? 'Watched' : undefined })) }
                  : { type: 'text', text: `Nothing in ${f.name} matches “${query}”.` },
              };
            },
          },
          [`${t}_stop`]: {
            label: 'Stopped a stream',
            description: `Stop someone's ${f.name} stream, optionally showing them a short message first. Name it by the user, the device or the title (from ${t}_playing); if more than one stream matches, it refuses and says which ones did.`,
            access: 'control', input: z.object({ who: z.string().min(2).max(100).describe('user, device or title'), message: z.string().max(200).optional() }),
            async confirm({ who, message }) {
              const s = await theSession(who).catch(e => e as Error);
              if (s instanceof Error) return { title: `No single stream to stop: ${s.message}`, icon: 'play', verb: 'Try', logo: source.icon };
              const i = s.NowPlayingItem;
              return { title: `Stop ${s.UserName}'s ${[titleOf(i), subtitleOf(i)].filter(Boolean).join(' — ')}?`, detail: [`On ${[s.DeviceName, s.Client].filter(Boolean).join(' · ')}`, message && `They'll see: ${message}`].filter(Boolean).join('. '),
                image: poster(i), icon: 'play', verb: 'Stop', danger: true, logo: source.icon };
            },
            async run({ who, message }) {
              const s = await theSession(who).catch(e => e as Error);   // looked up again: what's approved is what's stopped, or nothing
              if (s instanceof Error) return { data: { error: s.message } };
              if (message) await api(`/Sessions/${encodeURIComponent(s.Id)}/Message`, { method: 'POST', body: JSON.stringify({ Header: f.name, Text: message, TimeoutMs: 8000 }) }).catch(() => {});
              await api(`/Sessions/${encodeURIComponent(s.Id)}/Playing/Stop`, { method: 'POST' });
              const what = titleOf(s.NowPlayingItem);
              return { data: { stopped: what, user: s.UserName, device: s.DeviceName }, card: { type: 'text', tone: 'warn', text: `Stopped ${s.UserName}'s ${what} on ${s.DeviceName ?? 'their player'}.` } };
            },
          },
        },
      };
    },
  });
}

export default mediaServer({
  type: 'jellyfin', name: 'Jellyfin', prefix: '',
  resume: u => `/UserItems/Resume?userId=${u}&`, latest: u => `/Items/Latest?userId=${u}&`, items: u => `/Items?userId=${u}&`,
  sessions: '/Sessions?activeWithinSeconds=960',
  link: (web, i) => `${web}/web/#/details?id=${i.Id}`,
  // the documented header, and the old one for servers from before it
  auth: key => ({ Authorization: `MediaBrowser Token="${key}"`, 'X-Emby-Token': key }),
});
