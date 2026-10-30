// Subreddits, through Reddit's public JSON (no key; a User-Agent is all it asks for). Posts from every listed sub,
// sorted the way you'd see them there, with thumbnails where there are any.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import type { ListItem, ShelfItem } from '../shared/cards.ts';

const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export default defineIntegration({
  type: 'reddit',
  name: 'Reddit',
  config: z.object({
    subreddits: z.array(z.string().regex(/^[A-Za-z0-9_]+$/, 'a subreddit name, without r/')).min(1),
    sort: z.enum(['hot', 'new', 'top', 'rising']).default('hot'),
    limit: z.number().int().min(1).max(50).default(10),
    style: z.enum(['list', 'shelf']).default('list'),   // shelf: image posts as tiles
  }),
  create(cfg, ctx) {
    const headers = { 'User-Agent': 'atrium-dashboard/1.0 (self-hosted homepage)' };
    async function posts(limit: number) {
      const per = Math.max(3, Math.ceil(limit / cfg.subreddits.length));
      const all = await Promise.all(cfg.subreddits.map(async s => {
        try {
          const r = await ctx.http<any>(`https://www.reddit.com/r/${s}/${cfg.sort}.json?limit=${per}&raw_json=1`, { headers, timeout: 10_000 });
          return (r.data?.children ?? []).map((c: any) => c.data).filter((d: any) => !d.stickied);
        } catch (e) { ctx.log(`r/${s}: ${(e as Error).message}`); return []; }
      }));
      return all.flat().sort((a, b) => cfg.sort === 'new' ? b.created_utc - a.created_utc : b.score - a.score).slice(0, limit).map((d: any) => ({
        title: d.title as string, sub: d.subreddit as string, score: d.score as number, comments: d.num_comments as number, at: d.created_utc as number,
        href: `https://www.reddit.com${d.permalink}`, url: d.is_self ? undefined : d.url as string,
        image: d.preview?.images?.[0]?.resolutions?.at(-1)?.url ?? (/^https?:\/\//.test(d.thumbnail) ? d.thumbnail : undefined),
        text: (d.selftext as string | undefined)?.slice(0, 280) || undefined,
      }));
    }
    type Post = Awaited<ReturnType<typeof posts>>[number];
    const row = (p: Post): ListItem => ({ title: p.title, subtitle: `r/${p.sub} · ${k(p.score)} · ${k(p.comments)} comments`, meta: ago(p.at), href: p.href, image: cfg.style === 'list' ? undefined : p.image });
    const tile = (p: Post): ShelfItem => ({ title: p.title, subtitle: `r/${p.sub} · ${k(p.score)}`, image: p.image, href: p.href, badge: ago(p.at) });
    const title = cfg.subreddits.length === 1 ? `r/${cfg.subreddits[0]}` : 'Reddit';
    return {
      widgets: {
        posts: {
          title, interval: 600_000,
          async fetch() {
            const list = await posts(cfg.limit);
            const summary = list[0] ? { label: title, icon: 'reddit', value: list[0].title, sub: `r/${list[0].sub} · ${k(list[0].score)}` } : undefined;
            return cfg.style === 'shelf'
              ? { type: 'shelf', title, icon: 'reddit', aspect: 'wide', items: list.filter(p => p.image).map(tile), empty: 'No posts', summary }
              : { type: 'list', title, icon: 'reddit', items: list.map(row), empty: 'No posts', summary };
          },
        },
      },
      tools: {
        reddit_posts: {
          label: 'Checked Reddit',
          followUps: ['Summarize the top post', 'What are people recommending?'],
          description: `Posts from ${cfg.subreddits.map(s => `r/${s}`).join(', ')}: title, score, comments, link, and the post text when it's a text post.`,
          access: 'read', input: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
          async run({ limit }) {
            const list = await posts(limit);
            return { data: list.map(p => ({ title: p.title, subreddit: p.sub, score: p.score, comments: p.comments, link: p.href, url: p.url, text: p.text })),
              card: { type: 'list', title, icon: 'reddit', items: list.map(row) } };
          },
        },
      },
    };
  },
});
