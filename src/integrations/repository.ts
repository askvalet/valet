// GitHub repositories: stars, forks, open issues and pull requests, and the last release, for the projects you follow.
// A token is optional: it raises the rate limit from 60 to 5000 requests an hour and reaches private repos. A token that
// can push to a repo also unlocks its traffic: views, visitors and where they came from, for GitHub's last 14 days.
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
    // GitHub only answers traffic to someone who can push, and keeps 14 days of it
    async function traffic() {
      return (await Promise.all(cfg.repos.map(async r => {
        try {
          const get = (p: string) => ctx.http<any>(`https://api.github.com/repos/${r}/traffic/${p}`, { headers, timeout: 10_000 });
          const [views, clones, refs] = await Promise.all([get('views'), get('clones'), get('popular/referrers')]);
          return [{ name: r, days: (views.views ?? []) as { timestamp: string; count: number; uniques: number }[], views: views.count as number, visitors: views.uniques as number,
            clones: clones.count as number, referrers: ((refs ?? []) as { referrer: string; count: number; uniques: number }[]) }];
        } catch { return []; }
      }))).flat();
    }
    const row = (r: Repo): ListItem => ({ title: r.name, subtitle: `★ ${k(r.stars)} · ${k(r.forks)} forks · ${r.issues} issues${r.prs != null ? ` · ${r.prs} PRs` : ''}`, meta: fmt.relativeDay(Date.parse(r.pushed)), href: r.href });
    return {
      widgets: { traffic: { title: 'Traffic', interval: 1_800_000, async fetch() {
        const all = await traffic();
        if (!all.length) throw new Error(cfg.token ? 'GitHub shows traffic only to a token that can push to the repo' : 'Traffic needs a token that can push to the repo');
        // one line per day across every repo named, the last 14 days GitHub keeps
        const byDay = new Map<string, { views: number; uniques: number }>();
        for (const r of all) for (const d of r.days) { const x = byDay.get(d.timestamp) ?? { views: 0, uniques: 0 }; x.views += d.count; x.uniques += d.uniques; byDay.set(d.timestamp, x); }
        const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
        const refs = new Map<string, number>();
        for (const r of all) for (const x of r.referrers) refs.set(x.referrer, (refs.get(x.referrer) ?? 0) + x.uniques);
        const visitors = all.reduce((s, r) => s + r.visitors, 0);
        return { type: 'chart', style: 'bars', title: all.length === 1 ? `${all[0].name} traffic` : 'Traffic', icon: 'chart', headline: k(visitors), span: `visitors · ${k(all.reduce((s, r) => s + r.views, 0))} views · ${k(all.reduce((s, r) => s + r.clones, 0))} clones`, window: 'last 14 days',
          ...(days.length > 1 ? { from: Date.parse(days[0][0]), to: Date.parse(days.at(-1)![0]) } : {}),
          series: [{ name: 'Visitors', tone: 'accent', points: days.map(([, d]) => d.uniques), total: visitors }, { name: 'Other views', points: days.map(([, d]) => Math.max(0, d.views - d.uniques)) }],
          facts: [...refs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, n]) => ({ label, value: k(n) })), factsNote: refs.size ? 'Visitors from · last 14 days' : undefined,
          summary: { label: 'Visitors', icon: 'chart', value: k(visitors), sub: 'last 14 days', trend: days.map(([, d]) => d.uniques) } };
      } },
      repos: { title: cfg.title, interval: 1_800_000, async fetch() {
        const list = await repos();
        if (!list.length) throw new Error('GitHub answered nothing (rate limited? add a token)');
        return { type: 'list', title: cfg.title, icon: 'tag', items: list.map(row), summary: { label: cfg.title, icon: 'tag', value: k(list.reduce((s, r) => s + r.stars, 0)), sub: 'stars' } };
      } } },
      tools: { repository_stats: { label: 'Checked GitHub', access: 'read', input: z.object({}), description: `Stars, forks, open issues and pull requests for ${cfg.repos.join(', ')}.`, async run() { const list = await repos(); return { data: list, card: { type: 'list', title: cfg.title, icon: 'tag', items: list.map(row) } }; } },
        repository_traffic: { label: 'Checked GitHub traffic', access: 'read', input: z.object({}), description: `Views, unique visitors, clones and where visitors came from, over GitHub's last 14 days, for ${cfg.repos.join(', ')}. Needs a token that can push.`, async run() { const all = await traffic(); return { data: all.map(r => ({ repo: r.name, views: r.views, visitors: r.visitors, clones: r.clones, referrers: r.referrers.slice(0, 8) })) }; } } },
    };
  },
});
