// Frigate: its stats stay on `status`, as a service in the catalog. This adds what you actually open it for: the cameras,
// live, with what they've noticed. Pictures come through Valet, so the browser never needs Frigate's address, and
// image() only fetches cameras and events Frigate itself has named.
import { z } from 'zod';
import type { Context, Instance, Integration } from '../server/core.ts';
import type { Camera, CameraEvent, CamerasCard, Detection } from '../shared/cards.ts';

export const frigateOptions = {
  cameras: z.array(z.string()).optional(),       // which ones, in this order; all of them otherwise
  go2rtc: z.string().url().optional(),           // for smooth video: its address, usually Frigate's host on port 1984. Snapshots otherwise
};
type Cfg = { url: string; href?: string; insecure?: boolean; cameras?: string[]; go2rtc?: string };

const REFRESH = 5 * 60_000;
const title = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const fraction = (v: unknown) => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && n >= 0 && n <= 1);
const unit = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1 ? n : undefined;

export function frigateCameras<T extends Integration<any>>(stats: T): T {
  return { ...stats, create(cfg: Cfg, ctx: Context): Instance {
    const base = cfg.url.replace(/\/$/, ''), rtc = cfg.go2rtc?.replace(/\/$/, ''), insecure = cfg.insecure === true;
    const api = <R = any>(path: string) => ctx.http<R>(`${base}${path}`, { timeout: 10_000, insecure });
    const source = { name: 'Frigate', icon: '/api/icon/frigate' };
    const named = new Map<string, string>(), seen = new Set<string>();   // all image() will ever ask Frigate for
    let listedAt = 0;

    const list = async () => {
      if (Date.now() - listedAt > REFRESH || !named.size) {
        const all = Object.entries<any>((await api('/api/config')).cameras ?? {}).filter(([, c]) => c?.enabled !== false);
        named.clear();
        for (const [id, c] of all) if (!cfg.cameras || cfg.cameras.includes(id)) named.set(id, c?.friendly_name || title(id));
        listedAt = Date.now();
      }
      return [...named.keys()].sort((a, b) => (cfg.cameras?.indexOf(a) ?? 0) - (cfg.cameras?.indexOf(b) ?? 0));
    };
    const events = async (query = '') => {
      const got = await api<any[]>(`/api/events?limit=20&has_snapshot=1${query}`);
      const list = Array.isArray(got) ? got.filter(e => /^[\w.-]{1,96}$/.test(String(e?.id)) && named.has(e.camera)) : [];
      if (seen.size > 500) seen.clear();
      for (const e of list) seen.add(e.id);
      return list;
    };
    const event = (e: any): CameraEvent => ({ id: e.id, camera: e.camera, label: title(String(e.label)), at: Math.round(e.start_time * 1000), image: ctx.image(`event:${e.id}`), score: unit(e.top_score ?? e.data?.score) });
    const card = async (query?: string): Promise<CamerasCard> => {
      const ids = await list(), recent = await events(query);
      const live = recent.filter(e => e.end_time == null);    // still in view
      const cameras = ids.map((id): Camera => ({
        id, name: named.get(id)!, image: ctx.image(`camera:${id}`), ...(rtc ? { video: ctx.image(`stream:${id}`) } : {}),
        detections: live.filter(e => e.camera === id).map((e): Detection => ({ label: title(String(e.label)), score: unit(e.top_score ?? e.data?.score), ...(fraction(e.data?.box) ? { box: e.data.box } : {}) })),
      }));
      const now = live[0];
      return { type: 'cameras', title: 'Cameras', icon: 'camera', href: cfg.href ?? cfg.url, source, cameras, events: recent.slice(0, 12).map(event), empty: 'No cameras in Frigate',
        summary: { label: 'Cameras', icon: 'camera', value: ids.length, sub: now ? `${title(String(now.label))} · ${named.get(now.camera)}` : recent[0] ? `Last: ${title(String(recent[0].label))}` : 'All quiet', tone: now ? 'warn' : 'neutral' },
        ...(now ? { activity: { title: title(String(now.label)), subtitle: named.get(now.camera), icon: 'camera', image: ctx.image(`event:${now.id}`), tone: 'warn' as const, count: live.length > 1 ? live.length : undefined } } : {}) };
    };

    const inner = stats.create(cfg, ctx);
    return {
      ...inner,
      widgets: { ...inner.widgets, cameras: { title: 'Cameras', interval: 5_000, fetch: () => card() } },
      tools: { ...inner.tools,
        camera_events: {
          label: 'Checked the cameras', followUps: ['Was anyone at the door today?'], access: 'read',
          description: 'What the Frigate cameras have seen lately: people, cars, packages, with when and on which camera. Use for "was anyone at the door", "did a car come by", "show me the cameras".',
          input: z.object({ camera: z.string().optional(), label: z.string().optional() }),
          async run({ camera, label }) {
            await list();
            const id = camera && [...named].find(([k, n]) => [k, n.toLowerCase()].includes(camera.toLowerCase()))?.[0];
            const c = await card(`${id ? `&cameras=${encodeURIComponent(id)}` : ''}${label ? `&labels=${encodeURIComponent(label.toLowerCase())}` : ''}`);
            return { data: { cameras: c.cameras.map(x => x.name), events: c.events?.map(e => ({ what: e.label, camera: named.get(e.camera), at: new Date(e.at).toISOString() })) }, card: c };
          },
        } },
      async image(ref) {
        const [kind, id = ''] = ref.split(/:(.*)/s);
        await list();
        const get = (path: string) => ctx.http<Response>(`${base}${path}`, { as: 'response', timeout: 10_000, insecure });
        if (kind === 'event' && seen.has(id)) return get(`/api/events/${encodeURIComponent(id)}/thumbnail.jpg`);
        if (kind === 'camera' && named.has(id)) {
          const r = await get(`/api/${encodeURIComponent(id)}/latest.jpg?h=720`);
          return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? '', 'Cache-Control': 'no-store' } });
        }
        if (kind === 'stream' && rtc && named.has(id)) {   // no timeout: a stream lasts as long as someone's watching
          const r = await fetch(`${rtc}/api/stream.mp4?src=${encodeURIComponent(id)}`);
          return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? '', 'Cache-Control': 'no-store' } });
        }
        throw new Error('bad image ref');
      },
    };
  } };
}
