// The cameras: what Frigate's API turns into, that image() can only reach what's known, what the proxy will pass on, how a
// box moves, and that the demo's footage is all there and all credited.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { renderToString } from 'react-dom/server';
import { defineIntegration, session, type Context } from '../src/server/core.ts';
import { served } from '../src/server/security.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { registry } from '../src/integrations/index.ts';
import { boxAt, Cameras, EventStill } from '../src/web/cameras.tsx';
import plugin from '../demo/integrations/homelab.mjs';

const now = () => Date.now() / 1000;
const API: Record<string, unknown> = {
  '/api/config': { cameras: { front_door: { enabled: true, ffmpeg: { inputs: [{ path: 'rtsp://user:hunter22@10.0.0.9/live' }] } }, drive: { friendly_name: 'Driveway' }, old: { enabled: false } } },
  '/api/stats': { detection_fps: 2, cameras: { front_door: {} }, detectors: {}, service: { uptime: 60 } },
};
const events = () => [
  { id: '1700.1-aaa', camera: 'front_door', label: 'person', start_time: now() - 5, end_time: null, top_score: .9, data: { box: [.1, .2, .3, .4], score: .8 } },
  { id: '1700.2-bbb', camera: 'drive', label: 'package', start_time: now() - 900, end_time: now() - 880, data: { score: .7 } },
  { id: '../../etc/passwd', camera: 'drive', label: 'car', start_time: now() },
  { id: '1700.3-ccc', camera: 'old', label: 'car', start_time: now() },
];
function ctx() {
  const calls: string[] = [];
  const c = { id: 't', calls, log() {}, image: (r: string) => `/img/${encodeURIComponent(r)}`, session,
    async http(url: string, init: any = {}) {
      calls.push(url);
      const u = new URL(url), body = u.pathname === '/api/events' ? events() : API[u.pathname];
      if (init.as === 'response') return body ? new Response(JSON.stringify(body)) : new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } });
      return body;
    } };
  return c as unknown as Context & { calls: string[] };
}
const frigate = (cfg: object, c = ctx()) => { const f = registry.frigate; return { c, i: f.create(f.config.parse({ url: 'http://frigate:5000', ...cfg }), c) }; };
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };

test('frigate: an old config still works, and its stats stay on status', async () => {
  const { i } = frigate({});
  assert.deepEqual(Object.keys(i.widgets), ['status', 'cameras']);
  const s = await i.widgets.status.fetch() as any;
  assert.equal(s.type, 'stats');
  assert.ok(i.tools?.frigate_status);
});

test('frigate: cameras, friendly names, live boxes and events, with nothing of Frigate\'s address in the card', async () => {
  const { i } = frigate({});
  const card = await i.widgets.cameras.fetch() as any;
  valid(card);
  assert.deepEqual(card.cameras.map((x: any) => [x.id, x.name]), [['front_door', 'Front door'], ['drive', 'Driveway']]);
  assert.deepEqual(card.cameras[0].detections, [{ label: 'Person', score: .9, box: [.1, .2, .3, .4] }]);
  assert.equal(card.cameras[1].detections.length, 0);
  assert.deepEqual(card.events.map((e: any) => [e.label, e.camera, e.score]), [['Person', 'front_door', .9], ['Package', 'drive', .7]]);   // the bad id and the disabled camera are gone
  assert.equal(card.activity.title, 'Person');
  assert.equal(card.summary.tone, 'warn');
  const text = JSON.stringify({ ...card, href: undefined });
  assert.doesNotMatch(text, /frigate:5000|hunter22|rtsp/);
});

test('frigate: chooses and orders cameras, and goes through go2rtc only when told to', async () => {
  const picked = await frigate({ cameras: ['drive', 'front_door'] }).i.widgets.cameras.fetch() as any;
  assert.deepEqual(picked.cameras.map((x: any) => x.id), ['drive', 'front_door']);
  assert.equal(picked.cameras[0].video, undefined);
  const rtc = await frigate({ go2rtc: 'http://frigate:1984' }).i.widgets.cameras.fetch() as any;
  assert.equal(rtc.cameras[0].video, '/img/stream%3Afront_door');
});

test('frigate: image() fetches known cameras and events and nothing else', async () => {
  const { i, c } = frigate({});
  await i.widgets.cameras.fetch();
  const snap = await i.image!('camera:front_door');
  assert.equal(snap.headers.get('cache-control'), 'no-store');
  assert.match(c.calls.at(-1)!, /^http:\/\/frigate:5000\/api\/front_door\/latest\.jpg\?h=720$/);
  await i.image!('event:1700.2-bbb');
  assert.match(c.calls.at(-1)!, /\/api\/events\/1700\.2-bbb\/thumbnail\.jpg$/);
  const before = c.calls.filter(u => !/config|events\?/.test(u)).length;
  for (const bad of ['camera:old', 'camera:nope', 'camera:../config', 'camera:http://169.254.169.254/', 'event:1700.9-zzz', 'event:../../etc/passwd', 'event:1700.3-ccc', 'stream:front_door', 'http://evil/', '', 'camera:', 'camera:front_door/../../x'])
    await assert.rejects(Promise.resolve().then(() => i.image!(bad)), /bad image ref/, bad);
  assert.equal(c.calls.filter(u => !/config|events\?/.test(u)).length, before, 'a refused ref reached Frigate');
});

test('frigate: the assistant can ask about a camera, and an unknown one is never passed along', async () => {
  const { i, c } = frigate({});
  const r = await i.tools!.camera_events.run({ camera: 'driveway', label: 'Package' }) as any;
  assert.match(c.calls.at(-1)!, /cameras=drive&labels=package$/);
  valid(r.card);
  assert.equal(r.data.events[0].camera, 'Front door');
  await i.tools!.camera_events.run({ camera: 'x&limit=9999' });
  assert.doesNotMatch(c.calls.at(-1)!, /cameras=|9999/);
});

test('camera: any snapshot address, kept on the server, reachable only by position', async () => {
  const f = registry.camera, c = ctx();
  const i = f.create(f.config.parse({ title: 'Yard', username: 'me', password: 'pw', cameras: [{ name: 'Shed', url: 'http://10.0.0.5/snap.jpg' }, { name: 'Gate', url: 'http://10.0.0.6/snap.jpg' }] }), c);
  const card = await i.widgets.cameras.fetch() as any;
  valid(card);
  assert.deepEqual(card.cameras.map((x: any) => x.name), ['Shed', 'Gate']);
  assert.doesNotMatch(JSON.stringify(card), /10\.0\.0|me:pw|pw/);
  assert.equal((await i.image!('picture:1')).headers.get('cache-control'), 'no-store');
  assert.deepEqual(c.calls, ['http://10.0.0.6/snap.jpg']);
  for (const bad of ['picture:2', 'picture:-1', 'video:0', 'picture:http://evil/', 'http://evil/', '']) await assert.rejects(Promise.resolve().then(() => i.image!(bad)), /bad image ref/, bad);
  assert.equal(c.calls.length, 1);
  assert.throws(() => f.config.parse({ cameras: [] }));
  assert.throws(() => f.config.parse({ cameras: [{ name: 'x', url: 'not a url' }] }));
});

test('proxy: pictures and video pass, with what a phone needs to seek; anything else is refused', () => {
  const pass = (type: string, headers: Record<string, string> = {}, status = 200) => served(new Response('x', { status, headers: { 'Content-Type': type, ...headers } }));
  const v = pass('video/mp4', { 'Content-Range': 'bytes 0-1/9', 'Accept-Ranges': 'bytes', 'Content-Length': '2' }, 206)!;
  assert.deepEqual([v.status, v.headers.get('content-range'), v.headers.get('accept-ranges'), v.headers.get('content-length')], [206, 'bytes 0-1/9', 'bytes', '2']);
  assert.equal(v.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(pass('image/jpeg')!.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(pass('image/jpeg', { 'Cache-Control': 'no-store' })!.headers.get('cache-control'), 'no-store');
  assert.equal(pass('image/jpeg', { 'Content-Encoding': 'gzip', 'Content-Length': '5' })!.headers.get('content-length'), null);
  for (const bad of ['text/html', 'image/svg+xml', 'application/pdf', 'video/mp4+evil', '']) assert.equal(pass(bad), null, bad);
});

test('boxes: a fixed box stays, a path glides, wraps round its loop, and is gone between sightings', () => {
  assert.deepEqual(boxAt({ label: 'x', box: [.1, .2, .3, .4] }, 5), [.1, .2, .3, .4]);
  assert.equal(boxAt({ label: 'x' }, 5), null);
  const d = { label: 'x', path: [[10, 0, 0, .1, .1], [14, .4, .4, .1, .1]] as [number, number, number, number, number][] };
  assert.equal(boxAt(d, 9, 12), null);
  assert.deepEqual(boxAt(d, 12, 0)!.map(n => Math.round(n * 10) / 10), [.2, .2, .1, .1]);
  assert.deepEqual(boxAt(d, 1, 12)!.map(n => Math.round(n * 100) / 100), [.3, .3, .1, .1]);   // 13 of a 12 second loop
  assert.equal(boxAt(d, 14.1, 0), null);
  assert.ok(boxAt({ label: 'x', path: [[3, .1, .1, .1, .1]] }, 3));
});

test('the card: a pill per camera, the first one lit, nothing broken when there are none', () => {
  const card = { type: 'cameras' as const, cameras: [{ id: 'a', name: 'Front' }, { id: 'b', name: 'Back' }], events: [{ camera: 'b', label: 'Person', at: 1 }] };
  const html = renderToString(<Cameras card={card} />);
  assert.match(html, /aria-selected="true"[^>]*>.*Front/);
  assert.match(html, /Person/);
  assert.match(html, /blossom-carousel="true"[^>]*class="carousel cam-events"[^>]*aria-label="Events"/, 'the events are a Row like every carousel');
  assert.match(html, /aria-label="Next in events"/);
  assert.match(renderToString(<Cameras card={{ type: 'cameras', cameras: [], empty: 'None yet' }} />), /None yet/);
});

const demo = (plugin as any)({ z, defineIntegration }), lab = demo.create(demo.config.parse({ art: 'demo/art/cameras' }), { image: (r: string) => r } as any);

test('demo: every camera has its clip and still, small enough, credited, with boxes inside the picture', async () => {
  const card = await lab.widgets.cameras.fetch();
  valid(card);
  assert.ok(card.cameras.length >= 4 && card.cameras.length <= 5);
  const credits = readFileSync('demo/art/cameras/CREDITS.md', 'utf8');
  for (const c of card.cameras) {
    assert.ok(statSync(`demo/art/cameras/${c.video}`).size < 4e6, c.video);
    assert.ok(statSync(`demo/art/cameras/${c.poster}`).size > 0);
    assert.ok(credits.includes(`\`${c.video}\``), `${c.video} isn't in CREDITS.md`);
    for (const d of c.detections) for (const [t, x, y, w, h] of d.path) assert.ok(t >= 0 && x >= 0 && y >= 0 && x + w <= 1.01 && y + h <= 1.01, `${c.name} ${d.label} at ${t}`);
  }
  for (const e of card.events) { assert.ok(statSync(`demo/art/cameras/${e.image}`).size > 0); assert.ok(e.at <= Date.now()); }
  assert.deepEqual(card.events, [...card.events].sort((a: any, b: any) => b.at - a.at));
});

test('demo: clips are served with ranges, and only clips are served', async () => {
  const whole = lab.image('street.mp4'), size = statSync('demo/art/cameras/street.mp4').size;
  assert.equal(whole.status, 200);
  assert.equal(Number(whole.headers.get('content-length')), size);
  await whole.body.cancel();
  const part = lab.image('street.mp4', 'bytes=100-199');
  assert.deepEqual([part.status, part.headers.get('content-range'), (await part.arrayBuffer()).byteLength], [206, `bytes 100-199/${size}`, 100]);
  for (const bad of ['../homelab.mjs', '/etc/passwd', 'CREDITS.md', 'nothing.mp4']) assert.throws(() => lab.image(bad), /bad image ref/, bad);
});

test('cameras: a sample card never says LIVE, and an event is its own picture with the way to the camera', () => {
  const cam = { id: 'a', name: 'Street', video: '/a.mp4', poster: '/a.jpg' }, card = { type: 'cameras' as const, cameras: [cam] };
  assert.ok(renderToString(<Cameras card={card} />).includes('LIVE'));
  const sample = renderToString(<Cameras card={{ ...card, sample: true }} />);
  assert.ok(sample.includes('Sample footage') && !sample.includes('LIVE'));
  valid({ ...card, sample: true });
  const event = { camera: 'a', label: 'Bird', at: Date.now(), image: '/e.jpg', score: .95 };
  const still = renderToString(<EventStill event={event} cam={cam} live={() => {}} />);
  assert.ok(still.includes('View this camera live') && still.includes('/e.jpg') && still.includes('95%') && still.includes('Bird') && !still.includes('LIVE'));
  assert.ok(!renderToString(<EventStill event={event} cam={cam} sample live={() => {}} />).includes('camera live'));
  assert.ok(renderToString(<EventStill event={{ ...event, image: undefined }} live={() => {}} />).includes('No picture saved'));
});
