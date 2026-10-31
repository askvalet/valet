// GitHub repositories: stars, forks, open issues and pull requests, and the last release, for the projects you follow.
// A token is optional: it raises the rate limit from 60 to 5000 requests an hour and reaches private repos.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ListItem } from '../shared/cards.ts';

const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export default defineIntegration({
  type: 'repository',
  name: 'GitHub repositories',
  config: z.object({ repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name')).min(1), token: z.string().optional(), title: z.string().default('Repositories') }),
  create(cfg, ctx) {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Valet', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) };
    async function repos() {
      return (await Promise.all(cfg.repos.map(async r => {
        try {
          const [d, pulls] = await Promise.all([ctx.http<any>(`https://api.github.com/repos/${r}`, { headers, timeout: 10_000 }),
            ctx.http<any>(`https://api.github.com/search/issues?q=repo:${r}+is:pr+is:open&per_page=1`, { headers, timeout: 10_000 }).catch(() => null)]);
          return [{ name: r, stars: d.stargazers_count as number, forks: d.forks_count as number, prs: pulls?.total_count as number | undefined, issues: (d.open_issues_count as number) - (pulls?.total_count ?? 0), pushed: d.pushed_at as string, href: d.html_url as string }];
        } catch (e) { ctx.log(`${r}: ${(e as Error).message}`); return []; }
      }))).flat();
    }
    type Repo = Awaited<ReturnType<typeof repos>>[number];
    const row = (r: Repo): ListItem => ({ title: r.name, subtitle: `★ ${k(r.stars)} · ${k(r.forks)} forks · ${r.issues} issues${r.prs != null ? ` · ${r.prs} PRs` : ''}`, meta: fmt.relativeDay(Date.parse(r.pushed)), href: r.href });
    return {
      widgets: { repos: { title: cfg.title, interval: 1_800_000, async fetch() {
        const list = await repos();
        if (!list.length) throw new Error('GitHub answered nothing (rate limited? add a token)');
        return { type: 'list', title: cfg.title, icon: 'tag', items: list.map(row), summary: { label: cfg.title, icon: 'tag', value: k(list.reduce((s, r) => s + r.stars, 0)), sub: 'stars' } };
      } } },
      tools: { repository_stats: { label: 'Checked GitHub', access: 'read', input: z.object({}), description: `Stars, forks, open issues and pull requests for ${cfg.repos.join(', ')}.`, async run() { const list = await repos(); return { data: list, card: { type: 'list', title: cfg.title, icon: 'tag', items: list.map(row) } }; } } },
    };
  },
});
