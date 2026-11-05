// Immich: your photos. Ask for "the beach in Portugal" or "photos of Mom last Christmas" and they come back as a photo
// stack (smart search understands what's in a picture; people and dates narrow it). The homepage shows today's
// memories ("on this day") as a masonry wall, or a handful of random photos when there are none.
import { z } from 'zod';
import { defineIntegration, fmt, keptHome } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'immich',
  name: 'Immich',
  config: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const headers = { 'x-api-key': cfg.apiKey, 'Content-Type': 'application/json' };
    const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}/api/${path}`, { ...init, headers, timeout: 20_000 });
    const day = fmt.day;
    const place = (a: any) => [a.exifInfo?.city, a.exifInfo?.country].filter(Boolean).join(', ') || undefined;
    const tile = (a: any): ShelfItem => ({ title: place(a) ?? day(a.localDateTime ?? a.fileCreatedAt) ?? 'Photo', subtitle: place(a) ? day(a.localDateTime) : undefined,
      image: ctx.image(a.id), href: `${web}/photos/${a.id}`, badge: a.type === 'VIDEO' ? 'Video' : undefined });
    const people = async (names: string[] = []) => {
      const ids: string[] = [];
      for (const n of names) { const hit = (await api<any[]>(`search/person?name=${encodeURIComponent(n)}`))[0]; if (hit) ids.push(hit.id); }
      return ids;
    };

    return {
      async recap({ year }) {
        const months = await api<{ timeBucket: string; count: number }[]>('timeline/buckets?size=MONTH&visibility=timeline');
        const inYear = months.filter(m => m.timeBucket.startsWith(`${year}-`)), n = inYear.reduce((s, m) => s + m.count, 0);
        if (n < 12) return [];                                   // too few to be someone's real library, or a key that can't see it
        const best = [...inYear].sort((a, b) => b.count - a.count)[0];
        return [{ id: 'photos', theme: 'files', icon: 'image', kicker: 'You kept', value: n.toLocaleString('en'), unit: 'photos and videos', stat: 'Memories kept', score: 68, scope: 'year',
          line: `${new Date(best.timeBucket).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' })} was your busiest month. All of it on your own disks.` }];
      },
      widgets: {
        memories: {
          title: 'On this day', interval: 3_600_000, card: 'photos',
          async fetch() {
            const today = new Date().toISOString().slice(0, 10);
            const mem = await api<any[]>(`memories?for=${today}`).catch(() => []);
            const year = new Date().getFullYear();
            let items = mem.flatMap(m => (m.assets ?? []).filter((a: any) => a.type === 'IMAGE').slice(0, 6).map((a: any) => {
              const y = m.data?.year ?? Number(String(a.localDateTime).slice(0, 4)), ago = year - y;
              return { image: ctx.image(a.id), badge: ago > 0 ? `${ago} year${ago > 1 ? 's' : ''} ago` : 'Today', title: place(a), subtitle: day(a.localDateTime), href: `${web}/photos/${a.id}` };
            })).slice(0, 12);
            const flashback = items.length > 0;
            // no memories today: a few favourites (or anything) from the library instead
            if (!flashback) {
              const pick = await api<any[]>('search/random', { method: 'POST', body: JSON.stringify({ size: 10, type: 'IMAGE', withExif: true, isFavorite: true }) }).catch(() => []);
              // photos first; a library of only videos still has thumbnails worth showing
              const any = pick.length ? pick : await api<any[]>('search/random', { method: 'POST', body: JSON.stringify({ size: 10, withExif: true }) });
              items = any.map(a => ({ image: ctx.image(a.id), badge: undefined as unknown as string, title: place(a), subtitle: day(a.localDateTime), href: `${web}/photos/${a.id}` }));
            }
            return { type: 'photos', style: 'masonry', title: flashback ? 'On this day' : 'From your library', icon: 'image', href: web, source: { name: 'Immich', icon: '/api/icon/immich' }, items, empty: 'No photos yet',
              summary: { label: flashback ? 'On this day' : 'Photos', icon: 'image', value: flashback ? items[0].badge : `${items.length}`, sub: items[0]?.title ?? items[0]?.subtitle } };
          },
        },
      },
      tools: {
        photos_search: {
          find: 'query',
          label: 'Searched photos',
          followUps: ['Only the ones with people', 'Same place, other years'],
          description: 'Search the person\'s photos and videos in Immich by what\'s in them (smart search: "sunset at the beach", "birthday cake", "dog in snow"), optionally narrowed to people (by name), a date range or a city. Results show as a photo stack. For "photos from <date>" with no subject, leave query empty and set the dates.',
          access: 'read',
          input: z.object({
            query: z.string().optional(), people: z.array(z.string()).optional(), city: z.string().optional(),
            after: z.string().optional().describe('YYYY-MM-DD'), before: z.string().optional().describe('YYYY-MM-DD'), limit: z.number().int().min(1).max(60).default(24),
          }),
          async run({ query, people: names, city, after, before, limit }) {
            const personIds = await people(names);
            if (names?.length && !personIds.length) return { data: { error: `No one named ${names.join(', ')} in Immich's people.` } };
            const filters = { ...(personIds.length ? { personIds } : {}), ...(city ? { city } : {}), ...(after ? { takenAfter: `${after}T00:00:00.000Z` } : {}),
              ...(before ? { takenBefore: `${before}T23:59:59.999Z` } : {}), size: limit, withExif: true };
            const r = query?.trim()
              ? await api<any>('search/smart', { method: 'POST', body: JSON.stringify({ query, ...filters }) })
              : await api<any>('search/metadata', { method: 'POST', body: JSON.stringify({ ...filters, order: 'desc', withPeople: true }) });
            const items = r.assets?.items ?? [];
            const label = [query, names?.join(' & '), city, after || before ? [after, before].filter(Boolean).join(' – ') : ''].filter(Boolean).join(' · ') || 'Photos';
            return {
              data: { found: r.assets?.total ?? items.length, shown: items.length,
                photos: items.slice(0, 12).map((a: any) => ({ id: a.id, taken: a.localDateTime?.slice(0, 10), place: place(a), video: a.type === 'VIDEO' })) },
              card: items.length ? { type: 'shelf', stack: true, title: label, icon: 'image', aspect: 'square', href: web, items: items.map(tile) }
                : { type: 'text', text: `No photos match ${label}.` },
            };
          },
        },
        photos_people: {
          label: 'Checked people',
          description: 'The people Immich recognises (named faces), to search photos of someone.',
          access: 'read', input: z.object({}),
          async run() {
            const r = await api<any>('people?size=200');
            return { data: (r.people ?? []).filter((p: any) => p.name).map((p: any) => p.name) };
          },
        },
      },
      image(ref) {
        if (!/^[0-9a-f-]{36}$/.test(ref)) throw new Error('bad image ref');
        return keptHome(`${base}/api/assets/${ref}/thumbnail?size=preview`, { headers: { 'x-api-key': cfg.apiKey }, signal: AbortSignal.timeout(15_000) });
      },
    };
  },
});
