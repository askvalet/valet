// Hacker News front page (or newest / best), through the Algolia API: one request, no key.
import { z } from 'zod';
import { defineIntegration, iconFor } from '../server/core.ts';
import type { ListItem } from '../shared/cards.ts';

const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } };

export default defineIntegration({
  type: 'hackernews',
  name: 'Hacker News',
  config: z.object({
    sort: z.enum(['top', 'new', 'best']).default('top'),
    limit: z.number().int().min(1).max(50).default(10),
    comments: z.boolean().default(true),     // link rows to the discussion instead of the article
  }),
  create(cfg, ctx) {
    const url = cfg.sort === 'new' ? 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=' : `https://hn.algolia.com/api/v1/search?tags=${cfg.sort === 'best' ? 'story&numericFilters=points>200' : 'front_page'}&hitsPerPage=`;
    interface Story { id: string; title: string; url?: string; points: number; comments: number; at: string; discussion: string }
    async function stories(n: number): Promise<Story[]> {
      const r = await ctx.http<any>(`${url}${n}`, { timeout: 10_000 });
      return (r.hits ?? []).map((h: any): Story => ({ id: h.objectID, title: h.title as string, url: h.url as string | undefined, points: h.points ?? 0, comments: h.num_comments ?? 0, at: h.created_at as string,
        discussion: `https://news.ycombinator.com/item?id=${h.objectID}` }));
    }
    const row = (s: Story): ListItem => ({ title: s.title, subtitle: [`${s.points} points`, `${s.comments} comments`, host(s.url)].filter(Boolean).join(' · '), meta: ago(s.at), href: cfg.comments ? s.discussion : s.url ?? s.discussion });
    return {
      widgets: {
        stories: {
          title: 'Hacker News', interval: 600_000,
          async fetch() {
            const list = await stories(cfg.limit);
            return { type: 'list', layout: 'headlines', title: 'Hacker News', icon: 'news', source: { name: 'Hacker News', icon: iconFor('hacker-news') }, href: 'https://hn.algolia.com', items: list.map(row), empty: 'Nothing on the front page',
              summary: list[0] ? { label: 'Hacker News', icon: 'news', value: list[0].title, sub: `${list[0].points} points` } : undefined };
          },
        },
      },
      tools: {
        hn_stories: {
          label: 'Checked Hacker News',
          followUps: ['Summarize the top story', 'Anything about Linux?'],
          description: 'Hacker News front page: titles, points, comment counts and links. Use for "what\'s on HN", tech news of the day.',
          access: 'read', input: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
          async run({ limit }) {
            const list = await stories(limit);
            return { data: list.map(s => ({ title: s.title, url: s.url, points: s.points, comments: s.comments, discussion: s.discussion })),
              card: { type: 'list', title: 'Hacker News', icon: 'news', items: list.map(row) } };
          },
        },
      },
    };
  },
});
