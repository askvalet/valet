// Sonarr and Radarr: what's coming. Episodes airing and movies landing (digital or disc) in the days ahead, as
// posters with the day on them; each tells you if it's already downloaded. Uses the arrs' calendar API.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

const when = (iso: string) => {
  const d = new Date(iso), now = new Date(), day = 864e5;
  const diff = Math.floor((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / day);
  if (diff < 0) return diff === -1 ? 'Yesterday' : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  if (diff === 0) return d.getHours() >= 17 ? 'Tonight' : 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString('en', { weekday: 'short' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

export default defineIntegration({
  type: 'arr',
  name: 'Sonarr / Radarr',
  config: z.object({
    sonarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
    radarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
    days: z.number().int().min(1).max(90).default(14),          // how far ahead to look (movies: twice that)
  }),
  create(cfg, ctx) {
    const get = (s: { url: string; apiKey: string }, path: string) => ctx.http<any>(`${s.url.replace(/\/$/, '')}/api/v3/${path}`, { headers: { 'X-Api-Key': s.apiKey }, timeout: 10_000 });
    const command = (s: { url: string; apiKey: string }, body: object) => ctx.http<any>(`${s.url.replace(/\/$/, '')}/api/v3/command`,
      { method: 'POST', headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 10_000 });
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // the library, cached for a few minutes: is a title already there, and how complete is it
    let lib: { shows: any[]; films: any[]; at: number } | null = null;
    async function library() {
      if (lib && Date.now() - lib.at < 300_000) return lib;
      const [allShows, allFilms]: any[][] = await Promise.all([cfg.sonarr ? get(cfg.sonarr, "series") : [], cfg.radarr ? get(cfg.radarr, "movie") : []]);
      // keep only what lookups use: a big library's full payload is many MB
      const poster = (images: any[]) => [{ coverType: 'poster', remoteUrl: images?.find((i: any) => i.coverType === 'poster')?.remoteUrl }];
      const shows = allShows.map(s => ({ id: s.id, title: s.title, year: s.year, monitored: s.monitored, statistics: { episodeFileCount: s.statistics?.episodeFileCount, episodeCount: s.statistics?.episodeCount }, images: poster(s.images) }));
      const films = allFilms.map(m => ({ id: m.id, title: m.title, year: m.year, monitored: m.monitored, hasFile: m.hasFile, images: poster(m.images) }));
      return (lib = { shows, films, at: Date.now() });
    }
    async function find(title: string) {
      const l = await library(), q = norm(title);
      const score = (t: string) => norm(t) === q ? 2 : norm(t).includes(q) ? 1 : 0;
      return [
        ...l.shows.filter(s => score(s.title)).map(s => ({ kind: 'show' as const, id: s.id, title: s.title, year: s.year, score: score(s.title),
          have: s.statistics?.episodeFileCount ?? 0, of: s.statistics?.episodeCount ?? 0, monitored: s.monitored, image: img(s.images) })),
        ...l.films.filter(m => score(m.title)).map(m => ({ kind: 'movie' as const, id: m.id, title: m.title, year: m.year, score: score(m.title),
          have: m.hasFile ? 1 : 0, of: 1, monitored: m.monitored, image: img(m.images) })),
      ].sort((a, b) => b.score - a.score).slice(0, 6);
    }
    const img = (images: any[] = [], type = 'poster') => images.find(i => i.coverType === type)?.remoteUrl?.replace(/(image\.tmdb\.org\/t\/p)\/original\//, `$1/${type === 'fanart' ? 'w780' : 'w342'}/`);
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

    async function upcoming(days: number) {
      const out: (ShelfItem & { at: string; kind: 'episode' | 'movie'; have: boolean })[] = [];
      if (cfg.sonarr) {
        const eps = await get(cfg.sonarr, `calendar?start=${day(-1)}&end=${day(days)}&includeSeries=true`);
        const web = (cfg.sonarr.href ?? cfg.sonarr.url).replace(/\/$/, '');
        for (const e of eps) out.push({ at: e.airDateUtc, kind: 'episode', have: e.hasFile, title: e.series?.title ?? e.title,
          subtitle: `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`,
          image: img(e.series?.images), backdrop: img(e.series?.images, 'fanart'), href: `${web}/series/${e.series?.titleSlug ?? ''}`, badge: e.hasFile ? 'Ready' : when(e.airDateUtc) });
      }
      if (cfg.radarr) {
        const films = await get(cfg.radarr, `calendar?start=${day(-1)}&end=${day(days * 2)}`);
        const web = (cfg.radarr.href ?? cfg.radarr.url).replace(/\/$/, '');
        for (const m of films) {
          const at = [m.digitalRelease, m.physicalRelease].filter(Boolean).sort().find(d => d >= day(-1)) ?? m.digitalRelease ?? m.inCinemas;
          if (!at) continue;
          out.push({ at, kind: 'movie', have: m.hasFile, title: m.title, subtitle: `${m.year ?? ''} · Movie`.replace(/^ · /, ''),
            image: img(m.images), backdrop: img(m.images, 'fanart'), href: `${web}/movie/${m.titleSlug ?? m.tmdbId}`, badge: m.hasFile ? 'Ready' : when(at) });
        }
      }
      return out.sort((a, b) => a.at.localeCompare(b.at));
    }

    return {
      async recap({ from, to }) {
        const [films, shows] = await Promise.all([cfg.radarr ? get(cfg.radarr, 'movie') : [], cfg.sonarr ? get(cfg.sonarr, 'series') : []]) as [any[], any[]];
        const added = (l: any[]) => l.filter(x => { const t = Date.parse(x.added); return t >= from && t < to; });
        const newFilms = added(films), newShows = added(shows), n = newFilms.length + newShows.length;
        const size = [...films.map(f => f.sizeOnDisk ?? 0), ...shows.map(s => s.statistics?.sizeOnDisk ?? 0)].reduce((a, b) => a + b, 0);
        if (!n) return [];
        const hours = (films.reduce((a, f) => a + (f.hasFile ? f.runtime ?? 0 : 0), 0) + shows.reduce((a, s) => a + (s.runtime ?? 0) * (s.statistics?.episodeFileCount ?? 0), 0)) / 60;
        return [{ id: 'library.added', theme: 'media', icon: 'film', wall: true, kicker: 'Your library grew by', value: n.toLocaleString('en'), unit: 'titles', stat: 'Titles added', score: 80, scope: 'year', facts: { libraryHours: hours },
          line: `${newFilms.length} films and ${newShows.length} shows joined. The whole collection now takes up ${fmt.bytes(size)}.`,
          trait: { name: 'The Curator', line: 'You never just watch something. You acquire it, label it and find it the right quality profile.', strength: Math.min(.85, n / 400) } }];
      },
      widgets: {
        upcoming: {
          title: 'Coming up', interval: 900_000,
          async fetch() {
            const list = await upcoming(cfg.days);
            const next = list.find(x => !x.have);
            return { type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', layout: 'week', source: { name: 'Sonarr & Radarr', icon: '/api/icon/sonarr' }, items: list.map(({ at, kind, have, ...s }) => s), empty: 'Nothing scheduled',
              buttons: [{ label: 'Search for missing', action: 'search_missing' }],
              summary: { label: 'Coming up', icon: 'film', value: next ? next.title : 'Nothing', sub: next ? next.badge : `next ${cfg.days} days`, image: next?.backdrop ?? next?.image } };
          },
        },
      },
      actions: {
        search_missing: { description: 'Search for every missing episode and movie', input: z.object({}),
          async run() {
            await Promise.all([cfg.sonarr && command(cfg.sonarr, { name: 'MissingEpisodeSearch' }), cfg.radarr && command(cfg.radarr, { name: 'MissingMoviesSearch' })]);
          } },
      },
      tools: {
        library_lookup: {
          find: 'title',
          label: 'Checked the library',
          description: 'Is a show or movie in the library (Sonarr/Radarr), and how complete: episodes downloaded of total, or whether the movie file is there. Use for "do I have X", "how many episodes of Y".',
          access: 'read', input: z.object({ title: z.string() }),
          async run({ title }) {
            const hits = await find(title);
            return { data: hits.map(({ image, score, ...h }) => h),
              card: hits.length ? { type: 'shelf', title: `In the library · “${title}”`, icon: 'film', aspect: 'poster',
                items: hits.map(h => ({ title: h.title, subtitle: h.kind === 'show' ? `${h.have} of ${h.of} episodes` : h.have ? 'Downloaded' : 'Not downloaded yet', image: h.image, badge: h.have >= h.of && h.of ? 'Complete' : undefined })) }
                : { type: 'text', text: `“${title}” isn't in the library. It can be requested.` } };
          },
        },
        library_search: {
          label: 'Searched for it',
          description: 'Ask Sonarr/Radarr to search now for what\'s missing of one show or movie in the library (by title), e.g. when an episode didn\'t download.',
          access: 'control', input: z.object({ title: z.string() }),
          async run({ title }) {
            const h = (await find(title))[0];
            if (!h) return { data: { error: `${title} isn't in the library` } };
            if (h.kind === 'show') await command(cfg.sonarr!, { name: 'SeriesSearch', seriesId: h.id });
            else await command(cfg.radarr!, { name: 'MoviesSearch', movieIds: [h.id] });
            return { data: { searching: h.title }, card: { type: 'text', tone: 'good', text: `Searching for ${h.title}. New downloads show up under Downloading.` } };
          },
        },
        upcoming_media: {
          label: "Checked what's coming",
          description: 'Episodes airing and movies being released soon for shows and films the person follows (Sonarr/Radarr), and whether each is already downloaded.',
          access: 'read', input: z.object({ days: z.number().int().min(1).max(60).default(14) }),
          async run({ days }) {
            const list = await upcoming(days);
            return { data: list.map(x => ({ title: x.title, detail: x.subtitle, when: x.at.slice(0, 10), downloaded: x.have, kind: x.kind })),
              card: { type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', items: list.map(({ at, kind, have, ...s }) => s), empty: 'Nothing scheduled' } };
          },
        },
      },
    };
  },
});
