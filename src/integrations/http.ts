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
      expect: z.array(z.number()).optional(),    // OK status codes; default any 2xx/3xx/401
    })),
    interval: z.number().default(30_000),
  }),
  create(cfg, ctx) {
    async function check() {
      return Promise.all(cfg.targets.map(async t => {
        const t0 = performance.now();
        try {
          const res = await ctx.http<Response>(t.url, { as: 'response', timeout: 5000, redirect: 'manual' });
          const ok = t.expect ? t.expect.includes(res.status) : res.status < 400 || res.status === 401;
          return { name: t.name, ok, ms: Math.round(performance.now() - t0), detail: ok ? undefined : `HTTP ${res.status}`, href: t.href ?? t.url };
        } catch (e) {
          return { name: t.name, ok: false, detail: (e as Error).name === 'TimeoutError' ? 'timed out' : 'unreachable', href: t.href ?? t.url };
        }
      }));
    }
    return {
      widgets: {
        status: {
          title: 'Services', interval: cfg.interval,
          async fetch() {
            const items = await check(), down = items.filter(i => !i.ok);
            return { type: 'status', title: 'Services', icon: 'pulse', items,
              summary: { label: 'Services', value: `${items.length - down.length}/${items.length}`, tone: down.length ? 'bad' : 'good',
                sub: down.length ? `${down.map(d => d.name).join(', ')} down` : 'All up' } };
          },
        },
      },
      tools: {
        service_status: {
          description: 'Whether each self-hosted service is up, with response time. Use for "is X down", "what is offline".',
          access: 'read', input: z.object({}),
          async run() {
            const items = await check();
            return { data: items.map(({ href, ...i }) => i), card: { type: 'status', title: 'Services', items } };
          },
        },
      },
    };
  },
});
