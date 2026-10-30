// Service health: is each URL answering, and how fast. The simplest integration, and a template for new ones.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'http',
  name: 'Service status',
  config: z.object({
    targets: z.array(z.object({
      name: z.string(),
      url: z.string().url(),
      href: z.string().optional(),               // where the tile links to (defaults to url)
      icon: z.string().optional(),               // dashboard-icons slug (e.g. "plex") or an image URL; default: from the name
      group: z.string().optional(),              // heading the service sits under, e.g. "Media"
      quiet: z.boolean().optional(),             // often off on purpose: shown grey when down, never an alert
      expect: z.array(z.number()).optional(),    // OK status codes; default any 2xx/3xx/401
    })),
    interval: z.number().default(30_000),
  }),
  create(cfg, ctx) {
    const lat: number[] = [];
    const icon = (t: (typeof cfg.targets)[number]) => t.icon?.includes('/') ? t.icon
      : `/api/icon/${t.icon ?? t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    async function check() {
      return Promise.all(cfg.targets.map(async t => {
        const t0 = performance.now();
        try {
          const res = await ctx.http<Response>(t.url, { as: 'response', timeout: 5000, redirect: 'manual' });
          const ok = t.expect ? t.expect.includes(res.status) : res.status < 400 || res.status === 401;
          return { name: t.name, ok, ms: Math.round(performance.now() - t0), detail: ok ? undefined : `HTTP ${res.status}`, href: t.href ?? t.url, icon: icon(t), group: t.group, quiet: t.quiet };
        } catch (e) {
          return { name: t.name, ok: false, detail: (e as Error).name === 'TimeoutError' ? 'timed out' : 'unreachable', href: t.href ?? t.url, icon: icon(t), group: t.group, quiet: t.quiet };
        }
      }));
    }
    return {
      widgets: {
        status: {
          title: 'Services', interval: cfg.interval,
          async fetch() {
            const items = await check(), down = items.filter(i => !i.ok && !i.quiet);
            const up = items.filter(i => i.ok && i.ms != null), avg = up.length ? Math.round(up.reduce((a, i) => a + i.ms!, 0) / up.length) : 0;
            lat.push(avg); if (lat.length > 40) lat.shift();
            return { type: 'status', title: 'Services', icon: 'pulse', items,
              summary: { label: 'Services', icon: 'pulse', value: `${items.filter(i => i.ok).length}/${items.length}`, tone: down.length ? 'bad' : 'good',
                sub: down.length ? `${down.map(d => d.name).join(', ')} down` : 'All up', detail: `${avg} ms avg`, trend: [...lat] } };
          },
        },
      },
      tools: {
        service_status: {
          description: 'Whether each self-hosted service is up, with response time. Use for "is X down", "what is offline".',
          access: 'read', input: z.object({}),
          async run() {
            const items = await check();
            // quiet services are expected to be offline at times: say so, so it isn't reported as a problem
            return { data: items.map(({ href, icon, quiet, ...i }) => (quiet && !i.ok ? { ...i, note: 'off on purpose at times; not a problem' } : i)), card: { type: 'status', title: 'Services', items } };
          },
        },
      },
    };
  },
});
