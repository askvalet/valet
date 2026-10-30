// Feeds: RSS and Atom, which covers blogs, YouTube channels (https://www.youtube.com/feeds/videos.xml?channel_id=…),
// podcasts, GitHub releases pages and most news sites. One list (or shelf of thumbnails) across every feed, newest
// first, and a tool for the assistant to read headlines.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import { child, elements, text } from '../server/xml.ts';
import type { ListItem, ShelfItem } from '../shared/cards.ts';

export interface Entry { title: string; href?: string; source: string; at?: number; image?: string; summary?: string }

/** Entries of one feed, RSS or Atom. */
export function parseFeed(xml: string, name?: string): Entry[] {
  const atom = /<feed[\s>]/.test(xml) && !/<rss[\s>]/.test(xml);
  const source = name ?? (atom ? child(xml, 'title') : child(child(xml, 'channel') ?? xml, 'title')) ?? 'Feed';
  const when = (s?: string) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : undefined; };
  return elements(xml, atom ? 'entry' : 'item').map(e => {
    const x = e.inner;
    const link = atom ? (elements(x, 'link').find(l => !l.attrs.rel || l.attrs.rel === 'alternate')?.attrs.href ?? child(x, 'link', 'href')) : child(x, 'link') || child(x, 'guid');
    const image = child(x, 'media:thumbnail', 'url') ?? child(x, 'media:content', 'url') ?? child(x, 'enclosure', 'url')
      ?? (child(x, 'description') ?? child(x, 'content:encoded') ?? '').match(/<img[^>]+src=["']([^"']+)/)?.[1];
    const body = child(x, 'media:description') ?? child(x, 'summary') ?? child(x, 'description') ?? child(x, 'content') ?? '';
    return { title: text(child(x, 'title') ?? 'Untitled'), href: link?.trim(), source, at: when(child(x, atom ? 'published' : 'pubDate') ?? child(x, atom ? 'updated' : 'dc:date')),
      image: image && /^https?:\/\//.test(image) ? image : undefined, summary: text(body).slice(0, 280) || undefined };
  });
}

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default defineIntegration({
  type: 'rss',
  name: 'Feeds',
  config: z.object({
    feeds: z.array(z.union([z.string().url(), z.object({ url: z.string().url(), name: z.string().optional() })]))
      .transform(f => f.map(x => typeof x === 'string' ? { url: x } : x)),
    limit: z.number().int().min(1).max(50).default(12),
    style: z.enum(['list', 'shelf']).default('list'),      // shelf: thumbnails (YouTube, photo blogs)
    title: z.string().default('Feeds'),
    every: z.number().int().min(60).default(900),          // seconds between fetches
  }),
  create(cfg, ctx) {
    let cache: { at: number; entries: Entry[] } | undefined;
    async function entries() {
      if (cache && Date.now() - cache.at < cfg.every * 1000) return cache.entries;
      const all = await Promise.all(cfg.feeds.map(async f => {
        try { return parseFeed(await ctx.http<string>(f.url, { as: 'text', timeout: 15_000, headers: { 'User-Agent': 'Atrium (feed reader)' } }), f.name); }
        catch (e) { ctx.log(`${f.url}: ${(e as Error).message}`); return []; }
      }));
      const list = all.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      cache = { at: Date.now(), entries: list };
      return list;
    }
    const row = (e: Entry): ListItem => ({ title: e.title, subtitle: e.source, meta: ago(e.at), href: e.href });
    const tile = (e: Entry): ShelfItem => ({ title: e.title, subtitle: e.source, image: e.image, href: e.href, badge: ago(e.at) || undefined });
    return {
      widgets: {
        latest: {
          title: cfg.title, interval: Math.min(cfg.every, 300) * 1000,
          async fetch() {
            const list = (await entries()).slice(0, cfg.limit);
            const first = list[0];
            const summary = first ? { label: cfg.title, icon: 'rss', value: first.title, sub: `${first.source} · ${ago(first.at)}` } : undefined;
            return cfg.style === 'shelf'
              ? { type: 'shelf', title: cfg.title, icon: 'rss', aspect: 'wide', items: list.map(tile), empty: 'Nothing new', summary }
              : { type: 'list', title: cfg.title, icon: 'rss', items: list.map(row), empty: 'Nothing new', summary };
          },
        },
      },
      tools: {
        feed_read: {
          label: 'Read the feeds',
          followUps: ['Summarize the top three', 'Anything about self-hosting?'],
          description: `Latest entries across the person's feeds (${cfg.feeds.map(f => f.name ?? new URL(f.url).hostname).join(', ')}): title, source, link, when, and a short summary. Use for "what's new", "anything interesting today".`,
          access: 'read',
          input: z.object({ query: z.string().optional().describe('words to filter titles and summaries by'), limit: z.number().int().min(1).max(40).default(15) }),
          async run({ query, limit }) {
            const q = query?.toLowerCase();
            const list = (await entries()).filter(e => !q || `${e.title} ${e.summary ?? ''} ${e.source}`.toLowerCase().includes(q)).slice(0, limit);
            return { data: list.map(e => ({ title: e.title, source: e.source, url: e.href, when: e.at ? fmt.relativeDay(e.at) : undefined, summary: e.summary })),
              card: { type: 'list', title: q ? `Feeds · “${query}”` : cfg.title, icon: 'rss', items: list.map(row), empty: 'Nothing matches' } };
          },
        },
      },
    };
  },
});
