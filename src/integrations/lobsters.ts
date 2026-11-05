// Lobsters: the hottest stories, or one tag's. Public JSON, no key.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ListItem } from '../shared/cards.ts';

const ago = (t: string) => fmt.span(Date.now() - Date.parse(t), { parts: 1 });

export default defineIntegration({
  type: 'lobsters',
  name: 'Lobsters',
  config: z.object({ tags: z.array(z.string().regex(/^[a-z0-9_-]+$/)).default([]), sort: z.enum(['hottest', 'newest']).default('hottest'), limit: z.number().int().min(1).max(25).default(8) }),
  create(cfg, ctx) {
    const url = cfg.tags.length ? `https://lobste.rs/t/${cfg.tags.join(',')}.json` : `https://lobste.rs/${cfg.sort}.json`;
    const stories = async () => (await ctx.http<any[]>(url, { timeout: 10_000 })).slice(0, cfg.limit);
    const row = (s: any): ListItem => ({ title: s.title, subtitle: `${s.score} points · ${s.comment_count} comments${s.tags?.length ? ` · ${s.tags.slice(0, 3).join(', ')}` : ''}`, meta: ago(s.created_at), href: s.comments_url ?? s.url });
    return {
      widgets: { stories: { title: 'Lobsters', interval: 900_000, async fetch() { const list = await stories(); return { type: 'list', title: 'Lobsters', icon: 'news', items: list.map(row), empty: 'Nothing today', summary: list[0] ? { label: 'Lobsters', icon: 'news', value: list[0].title, sub: `${list[0].score} points` } : undefined }; } } },
      tools: { lobsters_stories: { label: 'Checked Lobsters', access: 'read', input: z.object({}), description: 'Top stories on Lobsters: title, points, comments, link.',
        async run() { const list = await stories(); return { data: list.map(s => ({ title: s.title, score: s.score, comments: s.comment_count, url: s.url })), card: { type: 'list', title: 'Lobsters', icon: 'news', items: list.map(row) } }; } } },
    };
  },
});
