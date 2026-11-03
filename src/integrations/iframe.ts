// A page inside a card: a Grafana panel, a camera's web view. It runs sandboxed, and only the addresses named here are
// allowed to load at all (they're added to the page's content security policy).
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'iframe',
  name: 'Embedded page',
  config: z.object({ url: z.string().url().refine(u => /^https?:/.test(u), 'http or https'), title: z.string().default('Page'), height: z.number().int().min(100).max(1200).default(360), scripts: z.boolean().default(true) }),
  create(cfg) {
    return { frame: new URL(cfg.url).origin, widgets: { page: { title: cfg.title, interval: 3_600_000, fetch: async () => ({ type: 'embed', title: cfg.title, src: cfg.url, height: cfg.height, scripts: cfg.scripts, href: cfg.url }) } } };
  },
});
