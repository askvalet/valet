// Karakeep: bookmarks and read-later. Send the assistant a link and it's saved (Karakeep crawls it, tags and
// summarises it); ask about what you've saved and it searches and reads them. Recent saves show as a shelf.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'karakeep',
  name: 'Karakeep',
  config: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
    const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}/api/v1/${path}`, { ...init, headers, timeout: 15_000 });
    const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } };
    const search = `${web}/dashboard/search`, archived = `${web}/dashboard/archive`;
    const brief = (b: any) => ({
      id: b.id, title: b.title ?? b.content?.title ?? (b.content?.type === 'text' ? String(b.content.text).slice(0, 80) : undefined), url: b.content?.url,
      summary: b.summary ?? b.content?.description, note: b.note || undefined, tags: (b.tags ?? []).map((t: any) => t.name), saved: b.createdAt?.slice(0, 10),
    });
    const shelf = (list: any[]): ShelfItem[] => list.map(b => {
      const x = brief(b), img = b.content?.imageAssetId ?? b.content?.screenshotAssetId;
      return { title: x.title ?? x.url ?? 'Note', subtitle: host(x.url) ?? 'Note', image: img ? ctx.image(img) : b.content?.imageUrl, href: x.url ?? `${web}/dashboard/preview/${b.id}` };
    });

    return {
      async recap() {
        const s = await api<any>('users/me/stats');
        if (!s?.numBookmarks) return [];
        const top = s.topDomains?.[0];
        const tags = ((s.tagUsage ?? []) as { name: string; count: number }[]).filter(t => t.name.length > 2 && !/^x(-|$)/i.test(t.name)).slice(0, 4);
        return [{ id: 'saved', theme: 'files', icon: 'bookmark', kicker: 'You saved for later', value: s.numBookmarks.toLocaleString('en'), unit: 'things', stat: 'Things saved', score: 58, scope: 'All time',
          line: `${top ? `${top.count} of them came from ${top.domain}. ` : ''}Later is doing a lot of work here. What you keep saving:`, bars: tags.map(t => ({ label: t.name, value: t.count, show: String(t.count) })) }];
      },
      actions: {
        archive: { description: 'Archive a saved link', input: z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }), run: async ({ id }) => { await api(`bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }); return { done: 'Archived a saved link' }; } },
        unarchive: { description: 'Bring an archived link back', input: z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }), run: async ({ id }) => { await api(`bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) }); return { done: 'Brought back a saved link' }; } },
      },
      widgets: {
        digest: {
          title: 'Recently saved', interval: 300_000,
          async fetch() {
            const r = await api<any>('bookmarks?limit=8&sortOrder=desc');
            return { type: 'list', title: 'Recently saved', icon: 'bookmark', href: search, source: { name: 'Karakeep', icon: '/api/icon/karakeep' }, empty: 'Nothing saved yet',
              items: (r.bookmarks ?? []).map((b: any) => { const x = brief(b); return { title: x.title ?? x.url ?? 'Note', subtitle: [host(x.url), ...x.tags.slice(0, 2)].filter(Boolean).join(' · ') || undefined, detail: x.summary ? String(x.summary).slice(0, 500) : undefined, meta: fmt.relativeDay(b.createdAt), href: x.url ?? `${web}/dashboard/preview/${b.id}` }; }) };
          },
        },
        // something you saved, a new one each day: its page behind it and what it says up front
        reading: {
          title: 'From your reading', interval: 3_600_000,
          async fetch() {
            const r = await api<any>('bookmarks?limit=100&sortOrder=desc&archived=false');
            const worth = (r.bookmarks ?? []).filter((b: any) => b.content?.type === 'link' && (b.summary || b.content?.description));
            const base = { type: 'article' as const, title: 'From your reading', icon: 'bookmark', href: search, archived, source: { name: 'Karakeep', icon: '/api/icon/karakeep' }, empty: 'Nothing saved to read yet' };
            if (!worth.length) return { ...base, headline: '' };
            // the same pick all day, then the rest of the pile after it
            const start = Math.floor(Date.now() / 864e5) % worth.length, pile = [...worth.slice(start), ...worth.slice(0, start)].slice(0, 12);
            const more = pile.map((b: any) => {
              const x = brief(b), page = b.content?.screenshotAssetId ?? b.content?.imageAssetId;
              return { id: b.id, headline: x.title ?? x.url, blurb: String(x.summary).replace(/[#*_`>]/g, '').slice(0, 280), site: host(x.url), image: page ? ctx.image(page) : b.content?.imageUrl, link: x.url, saved: x.saved };
            });
            return { ...base, ...more[0], more };
          },
        },
        recent: {
          title: 'Saved', interval: 120_000,
          async fetch() {
            const r = await api<any>('bookmarks?limit=12&sortOrder=desc&archived=false');
            // the page as it looked, not its banner, for a window to show
            const items = (r.bookmarks ?? []).map((b: any) => ({ ...shelf([b])[0], id: b.id, note: brief(b).summary?.replace(/[#*_`>]/g, ''), image: b.content?.screenshotAssetId ? ctx.image(b.content.screenshotAssetId) : shelf([b])[0].image }));
            return { type: 'shelf', layout: 'windows', title: 'Recently saved', icon: 'bookmark', href: search, archived, aspect: 'wide', items, empty: 'Nothing saved yet' };
          },
        },
      },
      tools: {
        bookmarks_search: {
          find: 'query',
          label: 'Searched saved links',
          followUps: ['Summarize the newest one', 'What else did I save this week?'],
          description: 'Search the person\'s saved links and notes in Karakeep (titles, page text, AI summaries, tags). Use for "that article about…", "what did I save on…".',
          access: 'read', input: z.object({ query: z.string(), limit: z.number().int().min(1).max(20).default(8) }),
          async run({ query, limit }) {
            const r = await api<any>(`bookmarks/search?q=${encodeURIComponent(query)}&limit=${limit}`);
            const list = r.bookmarks ?? [];
            return { data: list.map(brief),
              card: list.length ? { type: 'shelf', title: `Saved · “${query}”`, icon: 'bookmark', href: web, aspect: 'wide', items: shelf(list) } : { type: 'text', text: `Nothing saved matches “${query}”.` } };
          },
        },
        bookmark_summarize: {
          label: 'Summarized a bookmark', followUps: ['Summarize the next one'],
          description: 'Have Karakeep write its AI summary of a saved link or note, by id (bookmarks_search finds the id). Use for "summarize that article I saved". If it has one already, that comes back. Answer from what it returns.',
          confirm: () => ({ title: 'Summarise this bookmark?', detail: 'Karakeep writes a summary and saves it with the link.', icon: 'bookmark', verb: 'Summarise' }),
          access: 'write', input: z.object({ id: z.string() }),
          async run({ id }) {
            let b = await api<any>(`bookmarks/${encodeURIComponent(id)}`);
            if (!b.summary) { await api(`bookmarks/${encodeURIComponent(id)}/summarize`, { method: 'POST' }); b = await api<any>(`bookmarks/${encodeURIComponent(id)}`); }
            const x = brief(b);
            return { data: { title: x.title, url: x.url, summary: x.summary ?? 'Karakeep has no summary for this yet' }, card: { type: 'kv', title: x.title ?? 'Bookmark', rows: [['Summary', String(x.summary ?? 'Not ready yet')]] } };
          },
        },
        bookmark_read: {
          label: 'Read a bookmark',
          followUps: ['Summarize the newest one', 'What else did I save this week?'],
          description: 'Read one saved bookmark by id: its summary, note, tags and link.',
          access: 'read', input: z.object({ id: z.string() }),
          async run({ id }) {
            const b = await api<any>(`bookmarks/${encodeURIComponent(id)}`);
            return { data: { ...brief(b), description: b.content?.description, author: b.content?.author, publisher: b.content?.publisher },
              card: { type: 'shelf', title: brief(b).title ?? 'Bookmark', icon: 'bookmark', aspect: 'wide', items: shelf([b]) } };
          },
        },
        bookmark_save: {
          label: 'Saved a link',
          confirm: ({ url, text }) => ({ title: 'Save this to Karakeep?', detail: url ?? text, icon: 'bookmark', verb: 'Save' }),
          description: 'Save a link (or a text note) to Karakeep. Optionally a note, tags, or a list to put it in. Karakeep crawls the page and adds its own summary and tags.',
          access: 'write',
          input: z.object({ url: z.string().url().optional(), text: z.string().optional(), note: z.string().optional(), tags: z.array(z.string()).optional(), list: z.string().optional() }),
          async run({ url, text, note, tags, list }) {
            if (!url && !text) return { data: { error: 'give a link or some text' } };
            const b = await api<any>('bookmarks', { method: 'POST', body: JSON.stringify(url ? { type: 'link', url } : { type: 'text', text }) });
            if (note) await api(`bookmarks/${b.id}`, { method: 'PATCH', body: JSON.stringify({ note }) });
            if (tags?.length) await api(`bookmarks/${b.id}/tags`, { method: 'POST', body: JSON.stringify({ tags: tags.map((tagName: string) => ({ tagName })) }) });
            if (list) {
              const lists = (await api<any>('lists')).lists ?? [];
              const l = lists.find((x: any) => x.name.toLowerCase() === list.toLowerCase());
              if (l) await api(`lists/${l.id}/bookmarks/${b.id}`, { method: 'PUT' });
            }
            return { data: { saved: true, id: b.id, alreadySaved: !!b.alreadyExists, url },
              card: { type: 'text', tone: 'good', text: b.alreadyExists ? `Already saved: ${host(url) ?? 'that note'}.` : `Saved ${url ? host(url) : 'the note'} to Karakeep. It'll fetch the page and summarise it.` } };
          },
        },
      },
      image(ref) {
        if (!/^[a-zA-Z0-9-]{8,64}$/.test(ref)) throw new Error('bad image ref');
        return fetch(`${base}/api/assets/${ref}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10_000) });
      },
    };
  },
});
