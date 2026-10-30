// Karakeep: bookmarks and read-later. Send the assistant a link and it's saved (Karakeep crawls it, tags and
// summarises it); ask about what you've saved and it searches and reads them. Recent saves show as a shelf.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
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
    const brief = (b: any) => ({
      id: b.id, title: b.title ?? b.content?.title ?? (b.content?.type === 'text' ? String(b.content.text).slice(0, 80) : undefined), url: b.content?.url,
      summary: b.summary ?? b.content?.description, note: b.note || undefined, tags: (b.tags ?? []).map((t: any) => t.name), saved: b.createdAt?.slice(0, 10),
    });
    const shelf = (list: any[]): ShelfItem[] => list.map(b => {
      const x = brief(b), img = b.content?.imageAssetId ?? b.content?.screenshotAssetId;
      return { title: x.title ?? x.url ?? 'Note', subtitle: host(x.url) ?? 'Note', image: img ? ctx.image(img) : b.content?.imageUrl, href: x.url ?? `${web}/dashboard/preview/${b.id}` };
    });

    return {
      widgets: {
        recent: {
          title: 'Saved', interval: 120_000,
          async fetch() {
            const r = await api<any>('bookmarks?limit=12&sortOrder=desc');
            return { type: 'shelf', title: 'Recently saved', icon: 'bookmark', href: web, aspect: 'wide', items: shelf(r.bookmarks ?? []), empty: 'Nothing saved yet' };
          },
        },
      },
      tools: {
        bookmarks_search: {
          description: 'Search the person\'s saved links and notes in Karakeep (titles, page text, AI summaries, tags). Use for "that article about…", "what did I save on…".',
          access: 'read', input: z.object({ query: z.string(), limit: z.number().int().min(1).max(20).default(8) }),
          async run({ query, limit }) {
            const r = await api<any>(`bookmarks/search?q=${encodeURIComponent(query)}&limit=${limit}`);
            const list = r.bookmarks ?? [];
            return { data: list.map(brief),
              card: list.length ? { type: 'shelf', title: `Saved · “${query}”`, icon: 'bookmark', href: web, aspect: 'wide', items: shelf(list) } : { type: 'text', text: `Nothing saved matches “${query}”.` } };
          },
        },
        bookmark_read: {
          description: 'Read one saved bookmark by id: its summary, note, tags and link.',
          access: 'read', input: z.object({ id: z.string() }),
          async run({ id }) {
            const b = await api<any>(`bookmarks/${encodeURIComponent(id)}`);
            return { data: { ...brief(b), description: b.content?.description, author: b.content?.author, publisher: b.content?.publisher },
              card: { type: 'shelf', title: brief(b).title ?? 'Bookmark', icon: 'bookmark', aspect: 'wide', items: shelf([b]) } };
          },
        },
        bookmark_save: {
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
