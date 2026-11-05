// Feeds: RSS and Atom, which covers blogs, YouTube channels (https://www.youtube.com/feeds/videos.xml?channel_id=…),
// podcasts, GitHub releases pages and most news sites. One list (or shelf of thumbnails) across every feed, newest
// first, and a tool for the assistant to read headlines.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import { child, elements, text } from '../server/xml.ts';
import type { ListItem, ShelfItem } from '../shared/cards.ts';

const RSS_MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23f26522'/%3E%3Ccircle cx='7' cy='17' r='2' fill='%23fff'/%3E%3Cpath d='M5 11a8 8 0 0 1 8 8M5 6a13 13 0 0 1 13 13' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E";

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
      ?? firstImage(child(x, 'description') ?? child(x, 'content:encoded') ?? '');
    const body = child(x, 'media:description') ?? child(x, 'summary') ?? child(x, 'description') ?? child(x, 'content') ?? '';
    return { title: text(child(x, 'title') ?? 'Untitled'), href: link?.trim(), source, at: when(child(x, atom ? 'published' : 'pubDate') ?? child(x, atom ? 'updated' : 'dc:date')),
      image: image && /^https?:\/\//.test(image) ? image : undefined, summary: text(body).slice(0, 280) || undefined };
  });
}

const MAX_FEED = 4 * 2 ** 20;   // far more than any feed; a parser has no business reading further
const firstImage = (html: string) => {
  const at = html.indexOf('<img'), end = at < 0 ? -1 : html.indexOf('>', at);
  return end < 0 ? undefined : html.slice(at, end).match(/\ssrc=["']([^"']+)/)?.[1];
};

const ago = (t?: number) => t ? fmt.span(Date.now() - t, { parts: 1 }) : '';
const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } };

/** Whether a picture's address is out on the web, so the proxy may fetch it: never this machine, the network it sits
 *  on or a name only that network knows. A feed is written by someone else, and its pictures shouldn't reach in. */
export function onTheWeb(href: string) {
  let u: URL;
  try { u = new URL(href); } catch { return false; }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return false;
  if (h.startsWith('[') || !h.includes('.') || /\.(local|lan|home|internal|localhost|localdomain|arpa)$/.test(h)) return false;   // IPv6, one-word names, local names
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)?.slice(1).map(Number);
  if (ip) { const [a, b] = ip; return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)); }
  return !/^\d+$/.test(h.split('.').pop()!);   // an address written some other way, like 0x7f.1
}
const refOf = (href: string) => createHash('sha256').update(href).digest('hex').slice(0, 24);

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
    let shown: Map<string, string>[] = [new Map(), new Map()];
    async function entries() {
      if (cache && Date.now() - cache.at < cfg.every * 1000) return cache.entries;
      const all = await Promise.all(cfg.feeds.map(async f => {
        try { return parseFeed((await ctx.http<string>(f.url, { as: 'text', timeout: 15_000, headers: { 'User-Agent': 'Valet (feed reader)' } })).slice(0, MAX_FEED), f.name); }
        catch (e) { ctx.log(`${new URL(f.url).host}: ${(e as Error).message}`); return []; }
      }));
      const list = all.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      cache = { at: Date.now(), entries: list };
      // the pictures the proxy may fetch: only ones a feed named, by a ref made from the address. The last fetch's stay
      // too, for a page still showing them.
      shown = [new Map(list.flatMap(e => e.image && onTheWeb(e.image) ? [[refOf(e.image), e.image] as const] : [])), shown[0]];
      return list;
    }
    const picture = (e: Entry) => e.image && onTheWeb(e.image) ? ctx.image(refOf(e.image)) : undefined;
    const row = (e: Entry): ListItem => ({ title: e.title, subtitle: e.source, meta: ago(e.at), href: e.href });
    // on the page: the article's site for its favicon, and its picture and summary for when it's the one on top
    const story = (e: Entry): ListItem => ({ ...row(e), site: host(e.href), image: picture(e), detail: e.summary });
    const tile = (e: Entry): ShelfItem => ({ title: e.title, subtitle: e.source, image: picture(e), href: e.href, badge: ago(e.at) || undefined });
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
              : { type: 'list', layout: 'headlines', title: cfg.title, icon: 'rss', source: { name: 'RSS', icon: RSS_MARK }, items: list.map(story), empty: 'Nothing new', summary };
          },
        },
      },
      tools: {
        feed_read: {
          find: 'query',
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
      // a picture a feed named, fetched by Valet so the browser never calls the feed's server. Redirects are followed
      // only while they stay out on the web.
      async image(ref) {
        if (!/^[0-9a-f]{24}$/.test(ref)) throw new Error('bad image ref');
        let href = shown[0].get(ref) ?? shown[1]?.get(ref);
        if (!href) throw new Error('no picture');
        for (let hop = 0; hop < 4; hop++) {
          if (!onTheWeb(href)) throw new Error('not on the web');
          const res: Response = await fetch(href, { redirect: 'manual', headers: { 'User-Agent': 'Valet (feed reader)', Accept: 'image/*' }, signal: AbortSignal.timeout(10_000) });
          const to: string | null | false = res.status >= 300 && res.status < 400 && res.headers.get('location');
          if (!to) return res;
          await res.body?.cancel();
          href = new URL(to, href).href;
        }
        throw new Error('too many redirects');
      },
    };
  },
});
