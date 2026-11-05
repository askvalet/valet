// RomM: the game library. Recently added games as box art, how many games on how many systems, and what was last played.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';

export default defineIntegration({
  type: 'romm',
  name: 'RomM',
  config: z.object({ url: z.string().url(), username: z.string(), password: z.string(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    const auth = { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}` };
    const api = <T = any>(path: string) => ctx.http<T>(`${base}/api/${path}`, { headers: auth, timeout: 10_000 });
    const tile = (r: any) => ({ title: r.name, subtitle: r.platform_display_name, image: r.path_cover_large ? ctx.image(String(r.id)) : r.url_cover, href: `${web}/rom/${r.id}`,
      badge: r.last_played ? 'Played' : undefined, mark: r.platform_fs_slug ? ctx.image(`p-${r.platform_fs_slug}`) : undefined });
    return {
      async recap() {
        const [stats, roms] = await Promise.all([api<any>('stats'), api<any>('roms?limit=40&order_by=created_at&order_dir=desc')]);
        if (!stats?.ROMS) return [];
        const covers = (roms.items ?? []).map(tile).flatMap((t: any) => t.image ? [t.image] : []);
        return [{ id: 'games', theme: 'games', icon: 'game', kicker: 'Your game shelf holds', value: String(stats.ROMS), unit: 'games', stat: 'Games', score: 64, scope: 'All time', show: { images: covers, shape: 'square' },
          line: `Across ${stats.PLATFORMS} systems, in ${fmt.bytes(stats.TOTAL_FILESIZE_BYTES, 0)}. Save files so far: ${stats.SAVES}.` }];
      },
      widgets: {
        recent: {
          title: 'Games', interval: 900_000, card: 'shelf',
          async fetch() {
            const [stats, roms] = await Promise.all([api<any>('stats'), api<any>('roms?limit=24&order_by=created_at&order_dir=desc')]);
            return { type: 'shelf', layout: 'focus', title: 'Games', icon: 'game', href: web, aspect: 'square', source: { name: 'RomM', icon: '/api/icon/romm' }, note: `${stats.ROMS} games · ${stats.PLATFORMS} systems`, items: (roms.items ?? []).map(tile),
              summary: { label: 'Games', icon: 'game', value: String(stats.ROMS), sub: `${stats.PLATFORMS} systems · ${fmt.bytes(stats.TOTAL_FILESIZE_BYTES, 0)}` } };
          },
        },
      },
      tools: {
        games: {
          find: 'search',
          label: 'Looked at games',
          description: 'Games in the RomM library: search by name or list recent ones, with system and whether played.',
          access: 'read', input: z.object({ search: z.string().optional() }),
          async run({ search }) {
            const r = await api<any>(`roms?limit=24&${search ? `search_term=${encodeURIComponent(search)}` : 'order_by=created_at&order_dir=desc'}`);
            const items = r.items ?? [];
            return { data: items.map((x: any) => ({ name: x.name, system: x.platform_display_name, lastPlayed: x.last_played })),
              card: { type: 'shelf', title: search ? `Games · “${search}”` : 'Games', icon: 'game', aspect: 'square', href: web, items: items.map(tile), empty: 'No games found' } };
          },
        },
      },
      image(ref) {
        if (/^p-[a-z0-9-]{1,40}$/.test(ref)) return fetch(`${base}/assets/platforms/${ref.slice(2)}.ico`, { signal: AbortSignal.timeout(10_000) });   // the console itself, as RomM draws it
        if (!/^\d+$/.test(ref)) throw new Error('bad image ref');
        return api<any>(`roms/${ref}`).then(r => fetch(`${base}${r.path_cover_large}`, { headers: auth, signal: AbortSignal.timeout(10_000) }));
      },
    };
  },
});
