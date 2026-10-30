// Sonarr and Radarr: what's coming. Episodes airing and movies landing (digital or disc) in the days ahead, as
// posters with the day on them; each tells you if it's already downloaded. Uses the arrs' calendar API.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import type { ShelfItem } from '../shared/cards.ts';

const when = (iso: string) => {
  const d = new Date(iso), now = new Date(), day = 864e5;
  const diff = Math.floor((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / day);
  if (diff < 0) return diff === -1 ? 'Yesterday' : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  if (diff === 0) return d.getHours() >= 17 ? 'Tonight' : 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString('en', { weekday: 'short' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

export default defineIntegration({
  type: 'arr',
  name: 'Sonarr / Radarr',
  config: z.object({
    sonarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
    radarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
    days: z.number().int().min(1).max(90).default(14),          // how far ahead to look (movies: twice that)
  }),
  create(cfg, ctx) {
    const get = (s: { url: string; apiKey: string }, path: string) => ctx.http<any>(`${s.url.replace(/\/$/, '')}/api/v3/${path}`, { headers: { 'X-Api-Key': s.apiKey }, timeout: 10_000 });
    const img = (images: any[] = [], type = 'poster') => images.find(i => i.coverType === type)?.remoteUrl?.replace('/original/', '/w342/');
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

    async function upcoming(days: number) {
      const out: (ShelfItem & { at: string; kind: 'episode' | 'movie'; have: boolean })[] = [];
      if (cfg.sonarr) {
        const eps = await get(cfg.sonarr, `calendar?start=${day(-1)}&end=${day(days)}&includeSeries=true`);
        const web = (cfg.sonarr.href ?? cfg.sonarr.url).replace(/\/$/, '');
        for (const e of eps) out.push({ at: e.airDateUtc, kind: 'episode', have: e.hasFile, title: e.series?.title ?? e.title,
          subtitle: `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}${e.title ? ` · ${e.title}` : ''}`,
          image: img(e.series?.images), href: `${web}/series/${e.series?.titleSlug ?? ''}`, badge: e.hasFile ? 'Ready' : when(e.airDateUtc) });
      }
      if (cfg.radarr) {
        const films = await get(cfg.radarr, `calendar?start=${day(-1)}&end=${day(days * 2)}`);
        const web = (cfg.radarr.href ?? cfg.radarr.url).replace(/\/$/, '');
        for (const m of films) {
          const at = [m.digitalRelease, m.physicalRelease].filter(Boolean).sort().find(d => d >= day(-1)) ?? m.digitalRelease ?? m.inCinemas;
          if (!at) continue;
          out.push({ at, kind: 'movie', have: m.hasFile, title: m.title, subtitle: `${m.year ?? ''} · Movie`.replace(/^ · /, ''),
            image: img(m.images), href: `${web}/movie/${m.titleSlug ?? m.tmdbId}`, badge: m.hasFile ? 'Ready' : when(at) });
        }
      }
      return out.sort((a, b) => a.at.localeCompare(b.at));
    }

    return {
      widgets: {
        upcoming: {
          title: 'Coming up', interval: 900_000,
          async fetch() {
            const list = await upcoming(cfg.days);
            const next = list.find(x => !x.have);
            return { type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', items: list.map(({ at, kind, have, ...s }) => s), empty: 'Nothing scheduled',
              summary: { label: 'Coming up', icon: 'film', value: next ? next.badge! : 'Nothing', sub: next ? `${next.title}` : `next ${cfg.days} days` } };
          },
        },
      },
      tools: {
        upcoming_media: {
          description: 'Episodes airing and movies being released soon for shows and films the person follows (Sonarr/Radarr), and whether each is already downloaded.',
          access: 'read', input: z.object({ days: z.number().int().min(1).max(60).default(14) }),
          async run({ days }) {
            const list = await upcoming(days);
            return { data: list.map(x => ({ title: x.title, detail: x.subtitle, when: x.at.slice(0, 10), downloaded: x.have, kind: x.kind })),
              card: { type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', items: list.map(({ at, kind, have, ...s }) => s), empty: 'Nothing scheduled' } };
          },
        },
      },
    };
  },
});
