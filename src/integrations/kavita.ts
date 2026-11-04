// Kavita: books, comics and manga. What you're in the middle of with how far along, and what arrived lately, with
// covers. The assistant can search the library and say what you're reading.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, keptHome } from '../server/core.ts';
import { tally } from '../server/service.ts';
import type { ShelfItem } from '../shared/cards.ts';

const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

export default defineIntegration({
  type: 'kavita',
  name: 'Kavita',
  config: z.object({
    url: z.string().url(), href: z.string().optional(),
    username: z.string().optional(), password: z.string().optional(),
    key: z.string().optional(),                                         // an auth key instead of a password: your account → API keys
    every: Every.optional(), insecure: z.boolean().optional(),
  }).refine(c => c.key || (c.username && c.password), 'give a key, or a username and password'),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const source = { name: 'Kavita', icon: '/api/icon/kavita' };
    // a key signs in on its own; a password is traded for a token, and the token's user has a key covers can use
    const session = ctx.session(async () => {
      const r = await ctx.http<any>(`${base}/api/Account/login`, { method: 'POST', insecure: cfg.insecure, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg.key ? { username: '', password: '', apiKey: cfg.key } : { username: cfg.username, password: cfg.password, apiKey: '' }) });
      if (!r?.token) throw new Error('Kavita refused the sign-in');
      return { token: String(r.token), key: cfg.key ?? (typeof r.apiKey === 'string' && r.apiKey ? r.apiKey : r.authKeys?.[0]?.key) as string | undefined };
    });
    async function api<T = any>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
      const s = await session.get();
      const res = await ctx.http<Response>(`${base}/api/${path}`, { ...init, as: 'response', insecure: cfg.insecure, timeout: 15_000, headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
      if (res.status === 401 && retry) { await res.body?.cancel(); session.reset(); return api(path, init, false); }
      if (!res.ok) throw new Error(`Kavita answered ${res.status}`);
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const post = <T = any>(path: string, body?: object) => api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

    const progress = (s: any) => s.pages ? Math.min(1, (s.pagesRead ?? 0) / s.pages) : undefined;
    const name = (s: any) => s.localizedName || s.name;
    const href = (s: any) => int(s.libraryId) && int(s.id ?? s.seriesId) ? `${web}/library/${s.libraryId}/series/${s.id ?? s.seriesId}` : web;
    const tile = (s: any): ShelfItem => {
      const pct = progress(s), id = int(s.id ?? s.seriesId);
      return { id: String(id ?? name(s)), title: name(s), subtitle: s.libraryName, image: id ? ctx.image(String(id)) : undefined, href: href(s),
        badge: pct && pct < 1 ? `${Math.round(pct * 100)}%` : undefined };
    };
    const reading = async (size = 12) => (await post<any[]>(`Series/on-deck?pageNumber=1&pageSize=${size}`) ?? []).filter(s => int(s.id));
    const brief = (s: any) => ({ id: s.id, title: name(s), library: s.libraryName, pagesRead: s.pagesRead, pages: s.pages, lastRead: s.latestReadDate?.slice(0, 10) });

    return {
      async recap() {
        const st = await api<any>('Stats/server/stats');
        return tally(st?.seriesCount, { id: 'kavita.series', theme: 'reading', icon: 'book', logo: '/api/icon/kavita', kicker: 'Your Kavita library holds', unit: 'series', stat: 'Series', scope: 'All time', line: `${Number(st?.totalFiles ?? 0).toLocaleString('en')} files, ready on any screen you own.` });
      },
      widgets: {
        status: {
          title: 'Kavita', interval: cfg.every ?? 300_000,
          async fetch() {
            const st = await api<any>('Stats/server/stats');   // an admin's numbers: other accounts get a refusal
            const items = [{ label: 'Series', value: st?.seriesCount ?? 0 }, { label: 'Files', value: st?.totalFiles ?? 0 }].map(i => ({ ...i, value: Number(i.value).toLocaleString('en') }));
            return { type: 'stats', title: 'Kavita', icon: 'book', href: web, source, items, summary: { label: 'Kavita', icon: 'book', value: items[0].value, sub: 'Series' } };
          },
        },
        // Kavita's on deck is what you've started and not finished, latest first
        reading: {
          title: 'Continue reading', interval: 300_000,
          async fetch() {
            const list = await reading(), first = list[0], pct = first ? progress(first) : undefined;
            return { type: 'shelf', layout: 'focus', title: 'Continue reading', icon: 'book', href: web, source, aspect: 'poster', items: list.map(tile), empty: 'Nothing in progress',
              note: list.length ? `${list.length} in progress` : undefined,
              summary: { label: 'Reading', icon: 'book', value: first ? name(first) : 'Nothing', sub: first?.libraryName, pct, ring: pct != null ? `${Math.round(pct * 100)}%` : undefined, image: first ? ctx.image(String(first.id)) : undefined } };
          },
        },
        recent: {
          title: 'Recently added', interval: 900_000,
          async fetch() {
            const list = (await post<any[]>('Series/recently-added-v2?pageNumber=1&pageSize=12', {}) ?? []).filter(s => int(s.id));
            return { type: 'shelf', title: 'Recently added', icon: 'book', href: web, source, aspect: 'poster', items: list.map(tile), empty: 'Nothing added yet',
              summary: { label: 'New series', icon: 'book', value: list[0] ? name(list[0]) : 'None', sub: list[0] ? 'Latest' : undefined } };
          },
        },
      },
      tools: {
        library_search: {
          find: 'query', label: 'Searched the library', followUps: ['Which of these am I reading?'],
          description: 'Search the person\'s Kavita library (books, comics, manga) by title. Returns series with their library.',
          access: 'read', input: z.object({ query: z.string().min(1) }),
          async run({ query }) {
            const r = await api<any>(`Search/search?queryString=${encodeURIComponent(query)}`);
            const hits = ((r?.series ?? []) as any[]).filter(s => int(s.seriesId)).slice(0, 20);
            return { data: hits.map(s => ({ id: s.seriesId, title: name(s), library: s.libraryName })),
              card: hits.length ? { type: 'shelf', title: `Kavita · “${query}”`, icon: 'book', href: web, source, aspect: 'poster', items: hits.map(tile) } : { type: 'text', text: `Nothing in Kavita matches “${query}”.` } };
          },
        },
        reading_now: {
          label: 'Checked what you\'re reading', live: true, followUps: ['What did I add lately?'],
          description: 'What the person is in the middle of in Kavita, latest first: each series, pages read of pages, and when they last read it.',
          access: 'read', input: z.object({}),
          async run() {
            const list = await reading(20);
            return { data: list.map(brief), card: list.length ? { type: 'shelf', title: 'Continue reading', icon: 'book', href: web, source, aspect: 'poster', items: list.map(tile) } : { type: 'text', text: 'Nothing in progress in Kavita.' } };
          },
        },
      },
      async image(ref) {
        if (!/^\d{1,10}$/.test(ref)) throw new Error('bad image ref');
        // older Kavita wants the key in the address, newer takes the token: send both, and keep them home
        const s = await session.get(), q = new URLSearchParams({ seriesId: ref, ...(s.key ? { apiKey: s.key } : {}) });
        return keptHome(`${base}/api/Image/series-cover?${q}`, { headers: { Authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(10_000) });
      },
    };
  },
});
