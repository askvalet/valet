// Audiobookshelf: the books you're partway through and how far, what's being listened to right now, what's new on the
// shelves, and your listening this week. The assistant can say what you're listening to and search the libraries.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { bounded, defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { MediaItem, ShelfItem } from '../shared/cards.ts';

const ID = /^[\w-]{1,64}$/;                          // li_… on older servers, UUIDs on newer ones
const clamp = (x: number) => Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;
const local = (ms: number) => new Date(ms).toLocaleDateString('en-CA');   // YYYY-MM-DD in the server's own sense of a day
const hours = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s / 60) % 60}m` : `${Math.round(s / 60)} min`;

export default defineIntegration({
  type: 'audiobookshelf',
  name: 'Audiobookshelf',
  config: z.object({
    url: z.string().url(), key: z.string(), href: z.string().optional(),
    every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
  }).strict(),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, ''), insecure = cfg.insecure === true;
    const headers = { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' };
    const api = <T = any>(path: string) => ctx.http<T>(`${base}/api/${path}`, { headers, insecure, timeout: 15_000 });
    const source = { name: 'Audiobookshelf', icon: '/api/icon/audiobookshelf' };
    const cover = (id: unknown) => typeof id === 'string' && ID.test(id) ? ctx.image(id) : undefined;
    const link = (id: unknown) => typeof id === 'string' && ID.test(id) ? `${web}/item/${encodeURIComponent(id)}` : web;
    const meta = (i: any) => i?.media?.metadata ?? {};
    const author = (i: any) => meta(i).authorName ?? meta(i).author ?? ((meta(i).authors ?? []).map((a: any) => a?.name).filter(Boolean).join(', ') || undefined);

    let libs: { at: number; list: Promise<any[]> } | undefined;   // libraries hardly change: asked once every ten minutes
    const libraries = () => {
      if (!libs || Date.now() - libs.at > 600_000) libs = { at: Date.now(), list: api<any>('libraries').then(r => (r?.libraries ?? []).filter((l: any) => ID.test(String(l?.id)))) };
      libs.list.catch(() => { libs = undefined; });
      return libs.list;
    };

    /** What's started and not finished, newest first, each with how far along: the list comes without progress, /me has it. */
    async function inProgress(limit = 12) {
      const [r, me] = await Promise.all([api<any>(`me/items-in-progress?limit=${limit}`), api<any>('me')]);
      const progress = new Map<string, any>((me?.mediaProgress ?? []).map((p: any) => [`${p.libraryItemId}:${p.episodeId ?? ''}`, p]));
      return ((r?.libraryItems ?? []) as any[]).map(i => {
        const ep = i.recentEpisode, p = progress.get(`${i.id}:${ep?.id ?? ''}`) ?? progress.get(`${i.id}:`);
        const duration = Number(p?.duration) || Number(i.media?.duration) || Number(ep?.audioFile?.duration) || 0, at = Number(p?.currentTime) || 0;
        const pct = clamp(Number(p?.progress ?? (duration ? at / duration : NaN)));
        return { id: String(i.id), title: ep?.title ?? meta(i).title ?? 'Untitled', by: ep ? meta(i).title : author(i), podcast: i.mediaType === 'podcast', pct, left: duration ? Math.max(0, duration - at) : undefined, updated: Number(i.progressLastUpdate) || Number(p?.lastUpdate) || 0 };
      });
    }

    /** Who's listening to what right now. Only an administrator's key may see this. */
    async function open(): Promise<any[]> {
      const r = await ctx.http<Response>(`${base}/api/users/online`, { as: 'response', headers, insecure, timeout: 15_000 });
      if (r.status === 403 || r.status === 401) throw new Error('Seeing what\'s playing needs an administrator\'s API key');
      if (!r.ok) throw new Error(`Audiobookshelf answered ${r.status}`);
      const d: any = JSON.parse(await bounded(r));
      const names = new Map((d?.usersOnline ?? []).map((u: any) => [u.id, u.username]));
      return (d?.openSessions ?? []).map((s: any) => ({ ...s, username: names.get(s.userId) ?? s.user?.username }));
    }
    const device = (d: any) => d?.deviceName ?? d?.clientName ?? ([d?.browserName, d?.osName].filter(Boolean).join(' on ') || undefined);
    const toItem = (s: any): MediaItem => {
      const dur = Number(s.duration) || 0, at = Number(s.currentTime) || 0;
      return { title: s.displayTitle ?? s.mediaMetadata?.title ?? 'Untitled', subtitle: s.displayAuthor ?? s.mediaMetadata?.author, image: cover(s.libraryItemId),
        pct: dur ? clamp(at / dur) : undefined, state: 'playing', user: s.username, device: device(s.deviceInfo), remaining: dur ? `${hours(Math.max(0, dur - at))} left` : undefined, icon: 'book' };
    };

    async function week() {
      const s = await api<any>('me/listening-stats'), days = s?.days ?? {};
      const span = Array.from({ length: 7 }, (_, i) => Date.now() - (6 - i) * 864e5);
      const secs = span.map(t => Number(days[local(t)]) || 0);
      return { span, secs, total: secs.reduce((a, b) => a + b, 0), today: Number(s?.today) || 0 };
    }

    const shelf = (b: Awaited<ReturnType<typeof inProgress>>[number]): ShelfItem => ({ id: b.id, title: b.title, subtitle: b.by, image: cover(b.id), href: link(b.id),
      badge: b.pct != null ? fmt.pct(b.pct) : undefined, note: b.left != null ? `${hours(b.left)} left` : undefined });

    const widgets = {
      status: {
        title: 'Audiobookshelf', interval: (() => { const r = Every.safeParse(cfg.every); return r.success ? r.data : 300_000; })(),
        async fetch() {
          const [ls, going, w] = await Promise.all([libraries(), inProgress(25), week().catch(() => undefined)]);
          return { type: 'stats' as const, title: 'Audiobookshelf', icon: 'book', href: web, source,
            summary: { label: 'Audiobookshelf', icon: 'book', value: going.length, sub: going[0] ? `In progress · ${going[0].title}` : 'In progress' },
            items: [{ label: 'In progress', value: going.length }, ...(w ? [{ label: 'This week', value: hours(w.total) }] : []), { label: 'Libraries', value: ls.length,
              sub: [`${ls.filter(l => l.mediaType === 'book').length} books`, `${ls.filter(l => l.mediaType === 'podcast').length} podcasts`].filter(x => !x.startsWith('0 ')).join(' · ') || undefined }] };
        },
      },
      progress: {
        title: 'Continue listening', interval: 300_000,
        async fetch() {
          const items = (await inProgress()).map(shelf);
          return { type: 'shelf' as const, title: 'Continue listening', icon: 'book', href: web, source, aspect: 'square' as const, layout: 'coverflow' as const, items, empty: 'Nothing in progress',
            note: items.length ? `${items.length} in progress` : undefined,
            summary: items[0] && { label: 'Listening to', icon: 'book', value: items[0].title, sub: [items[0].subtitle, items[0].badge].filter(Boolean).join(' · ') || undefined, image: items[0].image } };
        },
      },
      playing: {
        title: 'Listening now', interval: 15_000,
        async fetch() {
          const now = await open(), items = now.map(toItem), first = items[0];
          return { type: 'media' as const, title: 'Listening now', icon: 'book', href: web, source, empty: 'Nobody listening', items,
            summary: { label: 'Audiobookshelf', icon: 'book', value: first ? first.title : 'Idle', sub: first ? [first.user, first.subtitle].filter(Boolean).join(' · ') : 'Nobody listening', image: first?.image },
            activity: first && { title: first.title, subtitle: [first.user, first.device].filter(Boolean).join(' · '), image: first.image, icon: 'book', pct: first.pct, trailing: first.remaining, count: now.length > 1 ? now.length : undefined } };
        },
      },
      recent: {
        title: 'New on the shelf', interval: 900_000,
        async fetch() {
          const ls = (await libraries()).filter(l => l.mediaType === 'book');
          const got = await Promise.all(ls.map(l => api<any>(`libraries/${encodeURIComponent(l.id)}/items?sort=addedAt&desc=1&limit=12&minified=1`).then(r => r?.results ?? [], () => [])));
          const items: ShelfItem[] = got.flat().sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0)).slice(0, 12)
            .map(i => ({ id: i.id, title: meta(i).title ?? 'Untitled', subtitle: author(i), image: cover(i.id), href: link(i.id), badge: i.addedAt ? fmt.relativeDay(Number(i.addedAt)).replace('Tonight', 'Today') : undefined }));
          return { type: 'shelf' as const, title: 'New on the shelf', icon: 'book', href: web, source, aspect: 'square' as const, items, empty: 'Nothing added yet',
            summary: items[0] && { label: 'New on the shelf', icon: 'book', value: items[0].title, sub: items[0].subtitle, image: items[0].image } };
        },
      },
      week: {
        title: 'Listening this week', interval: 900_000,
        async fetch() {
          const w = await week(), mins = w.secs.map(s => Math.round(s / 60));
          return { type: 'chart' as const, style: 'bars' as const, title: 'Listening this week', icon: 'book', href: web, source, unit: 'min', headline: hours(w.total), window: 'last 7 days',
            labels: w.span.map(t => new Date(t).toLocaleDateString('en', { weekday: 'short' })), from: w.span[0], to: w.span[6], series: [{ name: 'Listening', tone: 'accent' as const, points: mins }],
            summary: { label: 'Listened this week', icon: 'book', value: hours(w.total), sub: w.today ? `${hours(w.today)} today` : undefined, trend: mins } };
        },
      },
    } satisfies Instance['widgets'];

    return {
      widgets,
      async recap({ from, to }) {
        const s = await api<any>('me/listening-stats'), days = Object.entries<number>(s?.days ?? {}).filter(([d]) => { const t = Date.parse(`${d}T12:00:00`); return t >= from && t < to; });
        const total = days.reduce((a, [, v]) => a + (Number(v) || 0), 0);
        if (total < 3600) return [];
        return [{ id: 'listen.hours', theme: 'reading', icon: 'book', kicker: 'You listened to', value: String(Math.round(total / 3600)), unit: 'hours', stat: 'Hours listened', score: 72, scope: 'year', logo: source.icon,
          line: `Across ${days.length} days, from your own shelves.`, facts: { listenedHours: total / 3600 } }];
      },
      image(ref) {
        if (!ID.test(ref)) throw new Error('bad image ref');
        return ctx.http<Response>(`${base}/api/items/${encodeURIComponent(ref)}/cover?width=480&format=jpeg`, { as: 'response', headers: { Authorization: `Bearer ${cfg.key}` }, insecure, timeout: 15_000 });
      },
      tools: {
        audiobooks_listening: {
          label: 'Checked your audiobooks', followUps: ['How much did I listen this week?', "What's new on the shelf?"],
          description: 'What the person is listening to in Audiobookshelf: the books and podcasts in progress, how far along and how long is left, and anything playing right now (seen only with an administrator\'s key).',
          access: 'read', input: z.object({}),
          async run() {
            const [going, now] = await Promise.all([inProgress(), open().catch(() => undefined)]);
            return {
              data: { playingNow: now?.map(s => ({ title: s.displayTitle, by: s.displayAuthor, user: s.username, at: s.duration ? fmt.pct(Number(s.currentTime) / Number(s.duration)) : undefined })) ?? 'not visible with this key',
                inProgress: going.map(b => ({ title: b.title, by: b.by, podcast: b.podcast || undefined, progress: b.pct != null ? fmt.pct(b.pct) : undefined, left: b.left != null ? hours(b.left) : undefined, lastListened: b.updated ? fmt.relativeDay(b.updated) : undefined })) },
              card: await widgets.progress.fetch(),
            };
          },
        },
        audiobooks_week: {
          label: 'Checked your listening', followUps: ['What am I listening to?'],
          description: 'How long the person listened in Audiobookshelf each of the last seven days, and today.',
          access: 'read', input: z.object({}),
          async run() { const w = await week(); return { data: { total: hours(w.total), today: hours(w.today), days: w.span.map((t, i) => ({ day: local(t), minutes: Math.round(w.secs[i] / 60) })) }, card: await widgets.week.fetch() }; },
        },
        audiobooks_search: {
          find: 'query', label: 'Searched audiobooks', followUps: ['Am I partway through any of these?'],
          description: 'Search Audiobookshelf\'s libraries for books and podcasts by title, author, narrator or series.',
          access: 'read', input: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(20).default(8) }),
          async run({ query, limit }) {
            const ls = await libraries();
            const got = await Promise.all(ls.map(l => api<any>(`libraries/${encodeURIComponent(l.id)}/search?q=${encodeURIComponent(query)}&limit=${limit}`).catch(() => ({}))));
            const hits = got.flatMap(r => [...(r?.book ?? []), ...(r?.podcast ?? [])]).map((h: any) => h.libraryItem).filter(Boolean).slice(0, limit);
            return {
              data: hits.map((i: any) => ({ title: meta(i).title, by: author(i), narrator: meta(i).narratorName, series: meta(i).seriesName || undefined, podcast: i.mediaType === 'podcast' || undefined, length: i.media?.duration ? hours(Number(i.media.duration)) : undefined })),
              card: hits.length ? { type: 'shelf', title: `Audiobooks · “${query}”`, icon: 'book', href: web, source, aspect: 'square', items: hits.map((i: any) => ({ id: i.id, title: meta(i).title ?? 'Untitled', subtitle: author(i), image: cover(i.id), href: link(i.id) })) }
                : { type: 'text', text: `Nothing in Audiobookshelf matches “${query}”.` },
            };
          },
        },
      },
    };
  },
});
