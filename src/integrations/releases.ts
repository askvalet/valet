// Latest releases of GitHub repositories (the apps you self-host, say), newest first. A token is optional: it raises
// the API's rate limit from 60 to 5000 requests an hour and reaches private repos.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { ListItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'releases',
  name: 'Releases',
  config: z.object({
    repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name')).min(1),
    token: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10),
    prereleases: z.boolean().default(false),
  }),
  create(cfg, ctx) {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Valet', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) };
    interface Rel { repo: string; tag: string; name?: string; at: number; href: string; notes?: string; prerelease: boolean }
    let cache: { at: number; list: Rel[] } | undefined;
    async function releases(): Promise<Rel[]> {
      if (cache && Date.now() - cache.at < 1_800_000) return cache.list;
      let failed = '';
      const all = await Promise.all(cfg.repos.map(async repo => {
        try {
          // /releases/latest skips prereleases; the list has them
          const rs = cfg.prereleases ? await ctx.http<any[]>(`https://api.github.com/repos/${repo}/releases?per_page=3`, { headers, timeout: 10_000 })
            : [await ctx.http<any>(`https://api.github.com/repos/${repo}/releases/latest`, { headers, timeout: 10_000 })];
          const r = rs.find(x => x && !x.draft);
          return r ? [{ repo, tag: r.tag_name, name: r.name && r.name !== r.tag_name ? r.name : undefined, at: Date.parse(r.published_at ?? r.created_at), href: r.html_url, notes: (r.body as string | undefined)?.slice(0, 600), prerelease: !!r.prerelease }] : [];
        } catch (e) {
          // a repo without releases answers 404: fall back to its newest tag
          if (/404/.test((e as Error).message)) {
            const t = (await ctx.http<any[]>(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers, timeout: 10_000 }).catch(() => []))[0];
            return t ? [{ repo, tag: t.name, at: 0, href: `https://github.com/${repo}/releases/tag/${t.name}`, prerelease: false }] : [];
          }
          ctx.log(`${repo}: ${(e as Error).message}`); failed = (e as Error).message; return [];
        }
      }));
      const list = all.flat().sort((a, b) => b.at - a.at);
      // a rate limit isn't "no releases": keep what we knew, or say we couldn't look
      if (failed && cache) return cache.list;
      if (failed && !list.length) throw new Error(failed);
      if (!failed) cache = { at: Date.now(), list };
      return list;
    }
    // "immich", but "home-assistant/core": a generic repo name needs its owner to mean anything
    const label = (repo: string) => /^(core|server|app|main|web|api|backend|frontend|docker|src)$/i.test(repo.split('/')[1]) ? repo : repo.split('/')[1];
    const row = (r: Rel): ListItem => ({ title: label(r.repo), subtitle: [r.tag, r.name].filter(Boolean).join(' · '), meta: r.at ? fmt.relativeDay(r.at) : '', href: r.href, badge: r.prerelease ? 'pre' : undefined });
    return {
      widgets: {
        latest: {
          title: 'Releases', interval: 1_800_000, card: 'list',
          async fetch() {
            const list = (await releases()).slice(0, cfg.limit);
            return { type: 'list', layout: 'chips', title: 'Releases', icon: 'tag', items: list.map(row), empty: 'No releases yet',
              summary: list[0] ? { label: 'Releases', icon: 'tag', value: `${label(list[0].repo)} ${list[0].tag}`, sub: list[0].at ? fmt.relativeDay(list[0].at) : undefined } : undefined };
          },
        },
      },
      tools: {
        releases_latest: {
          label: 'Checked releases',
          followUps: ['What changed in the newest one?'],
          description: `Latest release of each watched repository (${cfg.repos.join(', ')}): version, date, link and the start of its notes. Use for "any updates", "what's new in <app>".`,
          access: 'read', input: z.object({ repo: z.string().optional().describe('only this one, e.g. "immich-app/immich"') }),
          async run({ repo }) {
            const list = (await releases()).filter(r => !repo || r.repo.toLowerCase().includes(repo.toLowerCase()));
            return { data: list.map(r => ({ repo: r.repo, version: r.tag, name: r.name, when: r.at ? fmt.day(r.at) : undefined, url: r.href, notes: r.notes })),
              card: { type: 'list', title: 'Releases', icon: 'tag', items: list.map(row), empty: 'No releases found' } };
          },
        },
      },
    };
  },
});
