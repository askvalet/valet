// Komga: comics, manga and books. What you're in the middle of with how far along, the next book in a series you've
// started, and what arrived lately, all with covers. The assistant can search the library and say what you're reading.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, keptHome } from '../server/core.ts';
import { tally } from '../server/service.ts';
import type { ShelfItem } from '../shared/cards.ts';

const ID = /^[0-9A-Za-z]{1,32}$/;      // Komga's ids are TSIDs: 13 characters of Crockford base32
const pageOf = (v: any): any[] => Array.isArray(v?.content) ? v.content : Array.isArray(v) ? v : [];

export default defineIntegration({
  type: 'komga',
  name: 'Komga',
  config: z.object({
    url: z.string().url(), href: z.string().optional(),
    username: z.string().optional(), password: z.string().optional(),
    key: z.string().optional(),                                         // an API key instead of a password (Komga 1.20 and later)
    every: Every.optional(), insecure: z.boolean().optional(),
  }).refine(c => c.key || (c.username && c.password), 'give a key, or a username and password'),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const auth: Record<string, string> = cfg.key ? { 'X-API-Key': cfg.key } : { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}` };
    const headers = { ...auth, Accept: 'application/json', 'Content-Type': 'application/json' };
    const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}/api/v1/${path}`, { ...init, headers, timeout: 15_000, insecure: cfg.insecure });
    // newer Komga searches with a POST and keeps the old GETs only as deprecated, older Komga has only the GETs
    const list = (kind: 'books' | 'series', q: string, body: object, old: string) =>
      api<any>(`${kind}/list?${q}`, { method: 'POST', body: JSON.stringify(body) }).catch(() => api<any>(`${kind}?${q}&${old}`));
    const source = { name: 'Komga', icon: '/api/icon/komga' };

    const progress = (b: any) => { const n = b.media?.pagesCount, p = b.readProgress?.page; return n && p != null ? Math.min(1, p / n) : undefined; };
    const title = (b: any) => b.metadata?.title || b.name;
    const authors = (m: any) => (m?.authors ?? []).filter((a: any) => /writer|author|story/i.test(a.role ?? '')).map((a: any) => a.name).slice(0, 2).join(', ') || undefined;
    const book = (b: any): ShelfItem => {
      const pct = progress(b), n = b.metadata?.number ?? b.number;
      return { id: b.id, title: title(b), subtitle: [b.seriesTitle !== title(b) ? b.seriesTitle : undefined, n != null && b.seriesTitle !== title(b) ? `#${n}` : undefined].filter(Boolean).join(' ') || authors(b.metadata),
        image: ID.test(b.id) ? ctx.image(`book-${b.id}`) : undefined, badge: pct != null && !b.readProgress?.completed ? `${Math.round(pct * 100)}%` : undefined,
        href: `${web}/book/${b.id}`, ...(pct != null ? { cta: { label: 'Keep reading', href: `${web}/book/${b.id}/read${b.media?.mediaProfile === 'EPUB' ? '-epub' : ''}` } } : {}) };
    };
    const series = (s: any): ShelfItem => ({ id: s.id, title: s.metadata?.title || s.name, subtitle: authors(s.booksMetadata) ?? `${s.booksCount ?? 0} book${s.booksCount === 1 ? '' : 's'}`,
      image: ID.test(s.id) ? ctx.image(`series-${s.id}`) : undefined, href: `${web}/series/${s.id}`,
      badge: s.booksCount && s.booksReadCount ? `${s.booksReadCount} of ${s.booksCount}` : undefined });
    const reading = async (size = 12) => pageOf(await list('books', `size=${size}&sort=readProgress.readDate,desc`, { condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } } }, 'read_status=IN_PROGRESS'));
    const brief = (b: any) => ({ id: b.id, title: title(b), series: b.seriesTitle, number: b.metadata?.number, page: b.readProgress?.page, pages: b.media?.pagesCount, lastRead: b.readProgress?.readDate?.slice(0, 10) });

    async function counts() {
      const [libraries, s, b] = await Promise.all([api<any[]>('libraries'), list('series', 'size=1', {}, ''), list('books', 'size=1', {}, '')]);
      return { libraries: (libraries ?? []).filter((l: any) => !l?.unavailable).length, series: s?.totalElements ?? 0, books: b?.totalElements ?? 0 };
    }

    return {
      async recap() {
        const c = await counts();
        return tally(c.books, { id: 'komga.books', theme: 'reading', icon: 'book', logo: '/api/icon/komga', kicker: 'On your shelves', unit: 'books', stat: 'Books', scope: 'All time', line: `Across ${c.series.toLocaleString('en')} series, and none of them can be pulled from a store.` });
      },
      widgets: {
        status: {
          title: 'Komga', interval: cfg.every ?? 300_000,
          async fetch() {
            const c = await counts();
            const items = [{ label: 'Libraries', value: c.libraries }, { label: 'Series', value: c.series }, { label: 'Books', value: c.books }].map(i => ({ ...i, value: i.value.toLocaleString('en') }));
            return { type: 'stats', title: 'Komga', icon: 'book', href: web, source, items, summary: { label: 'Komga', icon: 'book', value: items[0].value, sub: 'Libraries' } };
          },
        },
        reading: {
          title: 'Continue reading', interval: 300_000,
          async fetch() {
            const books = await reading(), first = books[0], pct = first ? progress(first) : undefined;
            return { type: 'shelf', layout: 'focus', title: 'Continue reading', icon: 'book', href: web, source, aspect: 'poster', items: books.map(book), empty: 'Nothing in progress',
              note: books.length ? `${books.length} in progress` : undefined,
              summary: { label: 'Reading', icon: 'book', value: first ? title(first) : 'Nothing', sub: first?.seriesTitle, pct, ring: pct != null ? `${Math.round(pct * 100)}%` : undefined, image: first && ID.test(first.id) ? ctx.image(`book-${first.id}`) : undefined } };
          },
        },
        // the next book of a series you've started and have nothing open in
        ondeck: {
          title: 'On deck', interval: 900_000,
          async fetch() {
            const books = pageOf(await api<any>('books/ondeck?size=12'));
            return { type: 'shelf', title: 'On deck', icon: 'book', href: web, source, aspect: 'poster', items: books.map(book), empty: 'Nothing next up',
              summary: { label: 'Next up', icon: 'book', value: books[0] ? title(books[0]) : 'Nothing', sub: books[0]?.seriesTitle } };
          },
        },
        recent: {
          title: 'Recently added', interval: 900_000,
          async fetch() {
            const s = pageOf(await api<any>('series/new?size=12'));
            return { type: 'shelf', title: 'Recently added', icon: 'book', href: web, source, aspect: 'poster', items: s.map(series), empty: 'Nothing added yet',
              summary: { label: 'New series', icon: 'book', value: s[0] ? s[0].metadata?.title || s[0].name : 'None', sub: s[0] ? 'Latest' : undefined } };
          },
        },
      },
      tools: {
        library_search: {
          find: 'query', label: 'Searched the comics', followUps: ['Which of these am I reading?'],
          description: 'Search the person\'s Komga library (comics, manga, books) by title. Returns series with how many books each has and how many are read.',
          access: 'read', input: z.object({ query: z.string(), limit: z.number().int().min(1).max(30).default(12) }),
          async run({ query, limit }) {
            const s = pageOf(await list('series', `size=${limit}`, { fullTextSearch: query }, `search=${encodeURIComponent(query)}`));
            return { data: s.map(x => ({ id: x.id, title: x.metadata?.title || x.name, books: x.booksCount, read: x.booksReadCount, inProgress: x.booksInProgressCount, status: x.metadata?.status, authors: authors(x.booksMetadata) })),
              card: s.length ? { type: 'shelf', title: `Komga · “${query}”`, icon: 'book', href: web, source, aspect: 'poster', items: s.map(series) } : { type: 'text', text: `Nothing in Komga matches “${query}”.` } };
          },
        },
        reading_now: {
          label: 'Checked what you\'re reading', live: true, followUps: ['What\'s next in that series?'],
          description: 'What the person is in the middle of in Komga, latest first: each book, its series, the page they\'re on and how many pages it has.',
          access: 'read', input: z.object({}),
          async run() {
            const books = await reading(20);
            return { data: books.map(brief), card: books.length ? { type: 'shelf', title: 'Continue reading', icon: 'book', href: web, source, aspect: 'poster', items: books.map(book) } : { type: 'text', text: 'Nothing in progress in Komga.' } };
          },
        },
      },
      image(ref) {
        const m = /^(book|series)-([0-9A-Za-z]{1,32})$/.exec(ref);
        if (!m) throw new Error('bad image ref');
        return keptHome(`${base}/api/v1/${m[1] === 'book' ? 'books' : 'series'}/${m[2]}/thumbnail`, { headers: auth, signal: AbortSignal.timeout(10_000) });
      },
    };
  },
});
