// Any camera that can hand over a JPEG: Scrypted, ZoneMinder, Shinobi, an RTSP-to-JPEG bridge, the camera's own snapshot
// address. Valet fetches them, so the browser never sees the address or the password, and image() can only reach what's
// in the config: refs are positions in that list, never addresses.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'camera',
  name: 'Camera',
  config: z.object({
    title: z.string().default('Cameras'),
    href: z.string().optional(),
    username: z.string().optional(), password: z.string().optional(),
    insecure: z.boolean().optional(),
    refresh: z.number().min(.5).optional(),            // seconds between pictures; 1 by default
    cameras: z.array(z.object({
      name: z.string(),
      url: z.string().url(),                           // a snapshot: answers with a JPEG each time it's asked
      video: z.string().url().optional(),              // or an MP4 stream to play instead
    }).strict()).min(1),
  }).strict(),
  create(cfg, ctx) {
    const headers = cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` } : undefined;
    const live = (r: Response) => new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? '', 'Cache-Control': 'no-store' } });
    return {
      widgets: {
        cameras: {
          title: cfg.title, interval: 300_000,
          fetch: async () => ({ type: 'cameras', title: cfg.title, icon: 'camera', href: cfg.href, refresh: cfg.refresh,
            cameras: cfg.cameras.map((c, i) => ({ id: String(i), name: c.name, image: ctx.image(`picture:${i}`), ...(c.video ? { video: ctx.image(`video:${i}`) } : {}) })),
            summary: { label: cfg.title, icon: 'camera', value: cfg.cameras.length } }),
        },
      },
      async image(ref) {
        const [, kind, i] = /^(picture|video):(\d{1,3})$/.exec(ref) ?? [], c = cfg.cameras[Number(i)];
        if (!c || (kind === 'video' && !c.video)) throw new Error('bad image ref');
        if (kind === 'video') return live(await fetch(c.video!, { headers }));
        return live(await ctx.http<Response>(c.url, { as: 'response', timeout: 10_000, headers, insecure: cfg.insecure }));
      },
    };
  },
});
