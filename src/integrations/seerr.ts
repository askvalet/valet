// Seerr (Overseerr / Jellyseerr): ask for a movie or show and it's requested, then Radarr/Sonarr fetch it. The
// assistant can search (with whether each title is already in the library or on its way), request, and list requests.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

// Seerr's media status: what's already in the library or on its way
const TONE: Record<number, 'good' | 'warn' | 'accent'> = { 2: 'warn', 3: 'accent', 4: 'accent', 5: 'good' };
const STATUS: Record<number, string> = { 2: 'Requested', 3: 'Downloading', 4: 'Partly available', 5: 'Available' };
const REQUEST: Record<number, string> = { 1: 'Waiting for approval', 2: 'Approved', 3: 'Declined' };

export default defineIntegration({
  type: 'seerr',
  name: 'Seerr',
  config: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const headers = { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' };
    const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}/api/v1/${path}`, { ...init, headers, timeout: 15_000 });
    const poster = (p?: string) => p ? `https://image.tmdb.org/t/p/w342${p}` : undefined;
    const year = (r: any) => (r.releaseDate ?? r.firstAirDate ?? '').slice(0, 4) || undefined;
    const tile = (r: any, status?: number): ShelfItem => ({
      title: r.title ?? r.name, subtitle: [year(r), r.mediaType === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · '),
      image: poster(r.posterPath), badge: status ? STATUS[status] : undefined, tone: status ? TONE[status] : undefined, href: `${web}/${r.mediaType === 'tv' ? 'tv' : 'movie'}/${r.id}`,
    });
    // a request's title lives on TMDB's record, which Seerr fetches per item
    // a title's details never change: remember up to 300 instead of fetching each request's every refresh
    const seen = new Map<string, Promise<any>>();
    const details = (type: string, id: number) => {
      const k = `${type}/${id}`;
      if (!seen.has(k)) {
        seen.set(k, api<any>(`${type === 'tv' ? 'tv' : 'movie'}/${id}`).catch(() => { seen.delete(k); return null; }));
        if (seen.size > 300) seen.delete(seen.keys().next().value!);
      }
      return seen.get(k)!;
    };
    async function requests(take: number) {
      const r = await api<any>(`request?take=${take}&sort=added`);
      return Promise.all((r.results ?? []).map(async (q: any) => {
        const d = await details(q.type, q.media?.tmdbId);
        return { q, d, title: d?.title ?? d?.name ?? `#${q.media?.tmdbId}` };
      }));
    }

    return {
      widgets: {
        requests: {
          title: 'Requests', interval: 300_000,
          async fetch() {
            const list = await requests(12);
            return { type: 'shelf', title: 'Requested', icon: 'film', href: `${web}/requests`, aspect: 'poster', layout: 'tickets', source: { name: 'Seerr', icon: '/api/icon/seerr' }, empty: 'No requests yet',
              items: list.map(({ q, d, title }) => ({ ...(d ? tile({ ...d, mediaType: q.type }, q.media?.status) : { title }), title })) };
          },
        },
      },
      tools: {
        media_search: {
          label: 'Searched movies & shows',
          description: 'Search movies and TV shows to watch or request (via Seerr/TMDB). Each result says whether it is already available in Plex, requested, or downloading. Use before media_request to get the right title and id; if the person\'s wording could mean several (a remake, a year), ask which.',
          access: 'read', input: z.object({ query: z.string() }),
          async run({ query }) {
            const r = await api<any>(`search?query=${encodeURIComponent(query)}&page=1`);
            const hits = (r.results ?? []).filter((x: any) => x.mediaType === 'movie' || x.mediaType === 'tv').slice(0, 8);
            return {
              data: hits.map((x: any) => ({ tmdb_id: x.id, media_type: x.mediaType, title: x.title ?? x.name, year: year(x),
                status: STATUS[x.mediaInfo?.status] ?? 'Not requested', overview: String(x.overview ?? '').slice(0, 160) })),
              card: hits.length ? { type: 'shelf', title: `“${query}”`, icon: 'film', aspect: 'poster', items: hits.map((x: any) => tile(x, x.mediaInfo?.status)) }
                : { type: 'text', text: `Nothing found for “${query}”.` },
            };
          },
        },
        media_request: {
          label: 'Requested',
          description: 'Request a movie or a whole TV show so it downloads into Plex. Pass tmdb_id and media_type from media_search, plus its title and year so the person can confirm the right one.',
          access: 'control',
          input: z.object({ title: z.string(), year: z.string().optional(), media_type: z.enum(['movie', 'tv']), tmdb_id: z.number().int() }),
          async run({ title, year: y, media_type, tmdb_id }) {
            const r = await api<any>('request', { method: 'POST', body: JSON.stringify({ mediaType: media_type, mediaId: tmdb_id, ...(media_type === 'tv' ? { seasons: 'all' } : {}) }) });
            const d = await details(media_type, tmdb_id);
            return { data: { requested: true, title, status: REQUEST[r.status] ?? 'Requested' },
              card: d ? { type: 'shelf', title: `Requested ${title}${y ? ` (${y})` : ''}`, icon: 'film', aspect: 'poster', items: [tile({ ...d, mediaType: media_type }, 2)] }
                : { type: 'text', tone: 'good', text: `Requested ${title}.` } };
          },
        },
        media_requests: {
          label: 'Checked requests',
          description: 'Recent movie and TV requests and where each one is (waiting, approved, downloading, available).',
          access: 'read', input: z.object({}),
          async run() {
            const list = await requests(10);
            return { data: list.map(({ q, title }) => ({ title, type: q.type, request: REQUEST[q.status], media: STATUS[q.media?.status] ?? 'Not available yet', by: q.requestedBy?.displayName, added: q.createdAt?.slice(0, 10) })),
              card: { type: 'shelf', title: 'Requests', icon: 'film', href: `${web}/requests`, aspect: 'poster', items: list.map(({ q, d, title }) => ({ ...(d ? tile({ ...d, mediaType: q.type }, q.media?.status) : {}), title })) } };
          },
        },
      },
    };
  },
});
