// Paperless-ngx: your documents. The assistant can search them (full text, with highlighted matches), read one to
// answer questions about it, and file new ones: a pasted note, or a file attached in chat. Recent documents show
// as a shelf of page thumbnails.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'paperless',
  name: 'Paperless',
  config: z.object({ url: z.string().url(), token: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const headers = { Authorization: `Token ${cfg.token}` };
    const api = <T = any>(path: string, init: RequestInit = {}) => ctx.http<T>(`${base}/api/${path}`, { ...init, headers: { ...headers, ...init.headers }, timeout: 15_000 });

    // ids → names for correspondents, tags and types; refreshed every few minutes
    let names = { c: new Map<number, string>(), t: new Map<number, string>(), d: new Map<number, string>() }, namesAt = 0;
    async function lookup() {
      if (Date.now() - namesAt < 300_000) return names;
      const get = async (p: string) => new Map<number, string>(((await api<any>(`${p}/?page_size=1000`)).results ?? []).map((x: any) => [x.id, x.name]));
      const [c, t, d] = await Promise.all([get('correspondents'), get('tags'), get('document_types')]);
      names = { c, t, d }; namesAt = Date.now();
      return names;
    }
    const day = fmt.day;
    const plain = (h?: string) => (h ?? '').replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();
    const brief = (d: any, n: typeof names) => ({
      id: d.id, title: d.title, correspondent: n.c.get(d.correspondent), type: n.d.get(d.document_type), date: d.created_date ?? d.created?.slice(0, 10),
      tags: (d.tags ?? []).map((t: number) => n.t.get(t)).filter(Boolean),
    });
    const shelf = (docs: any[], n: typeof names): ShelfItem[] => docs.map(d => ({
      title: d.title, subtitle: [n.c.get(d.correspondent), day(d.created)].filter(Boolean).join(' · '),
      image: ctx.image(String(d.id)), href: `${web}/documents/${d.id}/details`,
    }));

    return {
      widgets: {
        recent: {
          title: 'Documents', interval: 300_000,
          async fetch() {
            const [n, r] = await Promise.all([lookup(), api<any>('documents/?ordering=-added&page_size=12')]);
            return { type: 'shelf', title: 'Recent documents', icon: 'file', href: web, aspect: 'poster', items: shelf(r.results, n), empty: 'No documents yet',
              summary: { label: 'Documents', icon: 'file', value: r.count.toLocaleString(), sub: 'in Paperless' } };
          },
        },
      },
      tools: {
        docs_search: {
          find: 'query',
          label: 'Searched documents',
          followUps: ['Summarize these', 'Anything due soon?'],
          description: 'Search the person\'s documents in Paperless (full text: letters, bills, receipts, contracts, statements, IDs…). Returns the best matches with a snippet of where the words appear. Use it before answering any question about their documents, then docs_read the most relevant to answer precisely.',
          access: 'read',
          input: z.object({ query: z.string().describe('words to look for, e.g. "lease renewal" or "car insurance 2025"'), limit: z.number().int().min(1).max(20).default(8) }),
          async run({ query, limit }) {
            const [n, r] = await Promise.all([lookup(), api<any>(`documents/?query=${encodeURIComponent(query)}&page_size=${limit}`)]);
            const hits = r.results ?? [];
            return {
              data: { total: r.count, results: hits.map((d: any) => ({ ...brief(d, n), snippet: plain(d.__search_hit__?.highlights).slice(0, 300) })) },
              card: hits.length ? { type: 'shelf', stack: true, title: `Documents · “${query}”`, icon: 'file', href: `${web}/documents?query=${encodeURIComponent(query)}`, aspect: 'poster', items: shelf(hits, n) }
                : { type: 'text', text: `No documents match “${query}”.` },
            };
          },
        },
        docs_read: {
          label: 'Read a document',
          followUps: ['Summarize these', 'Anything due soon?'],
          description: 'Read one document\'s text (OCR) and details by id, to answer a question about it.',
          access: 'read', input: z.object({ id: z.number().int() }),
          async run({ id }) {
            const [n, d] = await Promise.all([lookup(), api<any>(`documents/${id}/`)]);
            const text = String(d.content ?? '');
            return {
              data: { ...brief(d, n), pages: d.page_count, text: text.slice(0, 16_000), truncated: text.length > 16_000 },
              card: { type: 'shelf', stack: true, title: d.title, icon: 'file', aspect: 'poster', items: shelf([d], n) },
            };
          },
        },
        docs_add: {
          label: 'Filed a document',
          description: 'File something in Paperless: a file the person attached in chat (pass its file id from the message), or text they pasted (pass `text`; it\'s saved as a text document). Optionally a title and tags. Paperless OCRs and indexes it within a minute or two.',
          access: 'write', fromPerson: ['file_id', 'text'],   // only what the person attached or pasted files itself
          input: z.object({ file_id: z.string().optional(), text: z.string().optional(), title: z.string().optional(), tags: z.array(z.string()).optional() }),
          async run({ file_id, text, title, tags }) {
            if (!file_id && !text) return { data: { error: 'nothing to file: attach a file or paste the text' } };
            const f = file_id ? await ctx.upload(file_id) : { name: `${(title ?? 'Note').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'Note'}.txt`, type: 'text/plain', data: Buffer.from(text!, 'utf8') };
            const form = new FormData();
            form.append('document', new Blob([new Uint8Array(f.data)], { type: f.type }), f.name);
            if (title) form.append('title', title);
            if (tags?.length) {
              const n = await lookup(), byName = new Map([...n.t].map(([tid, name]) => [name.toLowerCase(), tid]));
              for (const t of tags) {
                let tid = byName.get(t.toLowerCase());
                if (!tid) { tid = (await api<any>('tags/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: t }) })).id; namesAt = 0; }
                form.append('tags', String(tid));
              }
            }
            const task = await ctx.http<string>(`${base}/api/documents/post_document/`, { method: 'POST', headers, body: form, as: 'text', timeout: 60_000 });
            return { data: { filed: true, name: title ?? f.name, task: task.replace(/"/g, '') },
              card: { type: 'text', text: `Filed “${title ?? f.name}” in Paperless. It'll be searchable once it's read, usually within a minute or two.`, tone: 'good' } };
          },
        },
      },
      image(ref) {
        if (!/^\d+$/.test(ref)) throw new Error('bad image ref');
        return fetch(`${base}/api/documents/${ref}/thumb/`, { headers, signal: AbortSignal.timeout(10_000) });
      },
    };
  },
});
