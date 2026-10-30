// Bookmarks: groups of links from the top-level `links:` block, each group a widget (`links.<group>`).
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

const Link = z.object({ name: z.string(), url: z.string().url(), icon: z.string().optional(), note: z.string().optional() });

/** "Media & TV" → "media-tv": the widget key for a group */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const links = defineIntegration({
  type: 'links',
  name: 'Links',
  config: z.object({ groups: z.record(z.string(), z.array(Link)) }),
  create(cfg) {
    const widgets: Record<string, { title: string; interval: number; fetch(): Promise<any> }> = {};
    for (const [group, items] of Object.entries(cfg.groups)) {
      widgets[slug(group)] = {
        title: group, interval: 3_600_000,
        async fetch() {
          return { type: 'links', title: group, icon: 'bookmark', items: items.map(l => ({ name: l.name, href: l.url, note: l.note,
            // a dashboard-icons slug, an image URL, or the site's own favicon (fetched by Atrium, never by the browser)
            icon: l.icon ? (/^https?:\/\/|^\//.test(l.icon) ? l.icon : `/api/icon/${l.icon}`) : `/api/favicon/${new URL(l.url).hostname}` })) };
        },
      };
    }
    return { widgets };
  },
});
