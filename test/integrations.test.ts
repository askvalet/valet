// Integrations against made-up service responses: the cards they produce validate, and the logic that's easy to get
// wrong (sign-in reuse, parsing, roll-over to tomorrow, picking a verse) does what it says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/server/config.ts';
import { session, type Context, type Instance } from '../src/server/core.ts';
import { Timeline } from '../src/server/timeline.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import arr from '../src/integrations/arr.ts';
import docker from '../src/integrations/docker.ts';
import homeassistant from '../src/integrations/homeassistant.ts';
import http from '../src/integrations/http.ts';
import pihole from '../src/integrations/pihole.ts';
import qbittorrent from '../src/integrations/qbittorrent.ts';
import quran from '../src/integrations/quran.ts';
import releases from '../src/integrations/releases.ts';
import scrutiny from '../src/integrations/scrutiny.ts';
import uptimekuma from '../src/integrations/uptimekuma.ts';

type Handler = (url: string, init: RequestInit) => unknown;
function fake(handler: Handler): Context & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 't', calls, log() {}, image: r => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }),
    session,
    async http(url: string, init: any = {}) {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      const out = await handler(url, init);
      if (init.as === 'response') return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
      if (out instanceof Response) { if (!out.ok) throw new Error(`answered ${out.status}`); return init.as === 'text' ? out.text() : out.json(); }
      return out as any;
    },
  } as any;
}
const make = <C>(i: { config: any; create(c: C, ctx: Context): Instance }, cfg: unknown, ctx: Context) => i.create(i.config.parse(cfg), ctx);
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };

test('config: widgets take a size, plain names default to medium', () => {
  const c = Config.parse({ layout: [{ widgets: ['a.b', { widget: 'c.d', size: 'small' }] }] });
  assert.deepEqual(c.layout[0].widgets, [{ widget: 'a.b', size: 'medium' }, { widget: 'c.d', size: 'small' }]);
  assert.equal(c.auth.mode, 'none');
});

test('pihole: parallel requests share one sign-in, and an expired session signs in again once', async () => {
  let logins = 0, expired = false;
  const ctx = fake(url => {
    if (url.endsWith('/api/auth')) { logins++; return { session: { valid: true, sid: `s${logins}` } }; }
    if (expired) { expired = false; return new Response('{}', { status: 401 }); }
    if (url.includes('summary')) return { queries: { total: 1000, blocked: 140, percent_blocked: 14 }, clients: { active: 9 } };
    if (url.includes('history')) return { history: [{ blocked: 1 }, { blocked: 3 }] };
    if (url.includes('blocking')) return { blocking: 'enabled', timer: null };
    return { domains: [{ domain: 'ads.example', count: 9 }] };
  });
  const p = make(pihole, { url: 'http://pi', password: 'x' }, ctx);
  const card = await p.widgets.stats.fetch();
  valid(card);
  assert.equal(logins, 1, 'four parallel calls should share one sign-in');
  expired = true;
  await p.widgets.stats.fetch();
  assert.equal(logins, 2);
  assert.equal((card as any).summary.value, '140');
  assert.equal((card as any).summary.ring, '14%');
});

test('uptime kuma: parses metrics; a down monitor makes the summary red', async () => {
  const metrics = [
    'monitor_status{monitor_id="1",monitor_name="Plex",monitor_type="http"} 1',
    'monitor_status{monitor_id="2",monitor_name="Router",monitor_type="ping"} 0',
    'monitor_response_time{monitor_id="1",monitor_name="Plex"} 12',
    'monitor_uptime_ratio{monitor_id="1",monitor_name="Plex",window="30d"} 0.999',
    'monitor_uptime_ratio{monitor_id="2",monitor_name="Router",window="30d"} 0.95',
    'monitor_cert_days_remaining{monitor_id="1",monitor_name="Plex"} 9',
  ].join('\n');
  const k = make(uptimekuma, { url: 'http://kuma', password: 'x' }, fake(() => new Response(metrics)));
  const card: any = await k.widgets.monitors.fetch();
  valid(card);
  assert.equal(card.items.length, 2);
  assert.equal(card.summary.tone, 'bad');
  assert.match(card.summary.value, /1 down/);
});

test('docker: a container that was made and never run is not down', async () => {
  const d = make(docker, { url: 'http://d' }, fake(() => [
    { Id: '1', Names: ['/musing_chaum'], State: 'created', Status: 'Created', Labels: {} },
    { Id: '2', Names: ['/radarr'], State: 'exited', Status: 'Exited (137) 2 hours ago', Labels: {} }]));
  const c: any = await d.widgets.containers.fetch();
  assert.deepEqual(c.items.map((i: any) => [i.name, i.detail, i.quiet]), [['musing_chaum', 'never started', true], ['radarr', 'exited (137)', false]]);
  assert.equal(c.summary.value, '1 down');
});

test('http: one failed answer gets a second look before it counts as down', async () => {
  let n = 0;
  const h = make(http, { targets: [{ name: 'Quran', url: 'https://q' }] }, fake(() => { if (!n++) throw new Error('slow DNS'); return new Response('ok'); }));
  const c: any = await h.widgets.status.fetch();
  assert.deepEqual([c.items[0].ok, n], [true, 2]);
});

test('timeline: a problem never cleared stays unresolved until it is', async () => {
  const t = new Timeline();
  t.add('problem', 'Quran is down'); t.add('problem', 'Plex is down'); t.add('cleared', 'Plex is down');
  assert.deepEqual(t.unresolved(), ['Quran is down']);
  assert.deepEqual(t.lines(36e5, 40, true).map(l => l.split(' ').at(-1)), ['down']);       // only the "cleared" line
});

test('qbittorrent: stuck torrents are reported, and stay out of the island', async () => {
  const q = make(qbittorrent, { url: 'http://q', username: 'u', password: 'p' }, fake(url => {
    if (url.includes('auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=x; path=/' } });
    if (url.includes('transfer/info')) return new Response(JSON.stringify({ dl_info_speed: 0, up_info_speed: 0 }));
    assert.ok(!url.includes('filter=active'));                                              // that filter hides stalled torrents
    return new Response(JSON.stringify([
      { hash: 'a', name: 'Dead film', state: 'stalledDL', progress: 0, dlspeed: 0, amount_left: 2e9, eta: 8640000, num_seeds: 0, added_on: Date.now() / 1000 - 7200 },
      { hash: 'b', name: 'No metadata', state: 'metaDL', progress: 0, dlspeed: 0, amount_left: 0, eta: 8640000, num_seeds: 0 },
      { hash: 'c', name: 'Finished', state: 'uploading', progress: 1, dlspeed: 0, amount_left: 0, eta: 0, num_seeds: 3 }]));
  }));
  const card: any = await q.widgets.active.fetch();
  valid(card);
  assert.deepEqual([card.summary.sub, card.summary.tone], ['2 stuck', 'bad']);
  assert.equal(card.activity, undefined);
  assert.deepEqual(card.items.map((i: any) => i.detail), ['Stalled · 1.9 GB left', 'Finding peers']);
  const { data }: any = await q.tools.downloads_status.run({}, {} as any);
  assert.deepEqual([data.count, data.stuck, data.torrents[0].waitingHours], [2, 2, 2]);
});

test('releases: being rate limited is an error, not "no releases"', async () => {
  const r = make(releases, { repos: ['a/b'] }, fake(() => { throw new Error('api.github.com answered 403'); }));
  await assert.rejects(r.widgets.latest.fetch(), /403/);
});

test('scrutiny: a failing drive is called out', async () => {
  const s = make(scrutiny, { url: 'http://s' }, fake(() => ({ data: { summary: {
    a: { device: { device_name: 'sda', model_name: 'Disk A', device_status: 0 }, smart: { temp: 40, power_on_hours: 9000 } },
    b: { device: { device_name: 'sdb', model_name: 'Disk B', device_status: 2 }, smart: { temp: 61, power_on_hours: 20 } } } } })));
  const card: any = await s.widgets.drives.fetch();
  valid(card);
  assert.equal(card.summary.value, '1 failing');
  assert.deepEqual(card.summary.marks.map((m: any) => m.tone), [undefined, 'bad']);   // one bar per drive
  assert.equal(card.items[1].tone, 'bad');
});

test('arr: episodes and movies come out in date order with friendly days', async () => {
  const soon = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
  const a = make(arr, { sonarr: { url: 'http://s', apiKey: 'k' }, radarr: { url: 'http://r', apiKey: 'k' } }, fake(url => url.startsWith('http://s')
    ? [{ airDateUtc: soon(3), seasonNumber: 1, episodeNumber: 2, title: 'Two', hasFile: false, series: { title: 'Show', images: [{ coverType: 'fanart', remoteUrl: 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg' }] } }]
    : [{ title: 'Film', year: 2026, digitalRelease: soon(1), hasFile: false, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/x.jpg' }, { coverType: 'fanart', remoteUrl: 'https://image.tmdb.org/t/p/original/y.jpg' }] }]));
  const card: any = await a.widgets.upcoming.fetch();
  valid(card);
  assert.deepEqual(card.items.map((i: any) => i.title), ['Film', 'Show']);
  assert.equal(card.items[0].badge, 'Tomorrow');
  assert.equal(card.items[0].image, 'https://image.tmdb.org/t/p/w342/x.jpg');
  assert.deepEqual([card.summary.value, card.summary.sub, card.summary.image], ['Film', 'Tomorrow', 'https://image.tmdb.org/t/p/w780/y.jpg']);
  assert.equal(card.items[1].backdrop, 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg');   // only TMDB has sized copies
});

test('home assistant schedule: next time rolls to tomorrow, and shows in the island when close', async () => {
  const t = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
  const states = [
    { entity_id: 'sensor.a', state: t(-300), attributes: {} },   // already passed today
    { entity_id: 'sensor.b', state: t(10), attributes: {} },     // in 10 minutes
    { entity_id: 'sensor.c', state: t(-100), attributes: {} },   // muted
  ];
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', schedules: { p: { title: 'Prayers', soon: 15,
    entities: [{ id: 'sensor.a', name: 'A' }, { id: 'sensor.b', name: 'B' }, { id: 'sensor.c', name: 'C', muted: true }] } } }, fake(() => states));
  const card: any = await ha.widgets.p.fetch();
  valid(card);
  assert.equal(card.summary.value, 'B');
  assert.ok(card.activity?.title.startsWith('B in'));
  states[1].state = t(-5);   // B passed too: next is A, tomorrow; nothing close
  const later: any = await ha.widgets.p.fetch();
  assert.equal(later.summary.value, 'A');
  assert.equal(later.activity, undefined);
});

test('quran: picks a verse that reads on its own, and keeps the Arabic clean', async () => {
  const words = (s: string) => s.split(' ').map(w => [[w, null]]).concat([[['', null]]]);
  const data: Record<string, unknown> = {
    'index.json': { surahs: [{ n: 1, ar: 'x', en: 'Test', meaning: 'Testing', verses: 3 }] },
    's/1.json': [[1, words('كلمة'), {}], [2, words('كلمة اخرى'), {}], [3, words('ثالثة'), {}]],
    'en/1.json': { v: ['and then', 'Indeed, this is a complete sentence that is long enough to stand on its own as a verse.', 'short'] },
  };
  const q = make(quran, { url: 'http://q' }, fake(url => data[url.split('/data/')[1]]));
  const card: any = await q.widgets.today.fetch();
  valid(card);
  assert.equal(card.reference, 'Test 1:2');
  assert.equal(card.arabic, 'كلمة اخرى');
});

test('notices: only configured changes, never on first load, quiet services stay quiet', async () => {
  const { noticesFor } = await import('../src/server/notices.ts');
  const dl = (live: boolean) => ({ type: 'media', items: [], activity: live ? { title: 'Film', icon: 'download' } : undefined }) as any;
  const svc = (ok: boolean, quiet = false) => ({ type: 'status', items: [{ name: 'Plex', ok }, { name: 'Clock', ok, quiet }] }) as any;
  const rules = [{ widget: 'd', on: 'end' as const, text: '{title} finished' }, { widget: 's', on: 'down' as const }];
  assert.deepEqual(noticesFor('d', undefined, dl(false), rules), []);
  assert.equal(noticesFor('d', dl(true), dl(false), rules)[0].text, 'Film finished');
  assert.deepEqual(noticesFor('d', dl(false), dl(true), rules), []);           // start isn't configured
  const down = noticesFor('s', svc(true, true), svc(false, true), rules);
  assert.deepEqual(down.map(n => n.text), ['Plex is down']);                   // Clock is quiet
  assert.deepEqual(noticesFor('x', dl(true), dl(false), rules), []);           // no rule for this widget
});

test('history: reads numbers out of headlines, and gives a graph to headlines that have none', async () => {
  const { History, numberOf } = await import('../src/server/history.ts');
  assert.deepEqual(['13%', '62 W', '1.38M', '4,452', 7, 'Healthy', 'Fajr'].map(numberOf), [13, 62, 1.38e6, 4452, 7, null, null]);
  const h = new History(24, 0);
  let card: any;
  for (const v of ['10%', '12%', '15%']) card = h.apply('w', { type: 'text', text: '', summary: { label: 'x', value: v } } as any);
  assert.deepEqual(card.summary.trend, [10, 12, 15]);
  const own = h.apply('w', { type: 'text', text: '', summary: { label: 'x', value: '16%', trend: [1, 2] } } as any) as any;
  assert.deepEqual(own.summary.trend, [1, 2]);   // a service's own graph wins
});

test('plugins: a one-file plugin loads, can\'t silently take a built-in name, and a broken one is skipped', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'valet-'));
  process.env.VALET_DATA = dir;
  await mkdir(join(dir, 'integrations'));
  const plugin = (type: string) => `export default ({ z, defineIntegration }) => defineIntegration({ type: '${type}', name: 'P', config: z.object({}),
    create: () => ({ widgets: { w: { title: 'W', fetch: async () => ({ type: 'text', text: 'hi' }) } } }) })`;
  await writeFile(join(dir, 'integrations', 'a.mjs'), plugin('hello'));
  await writeFile(join(dir, 'integrations', 'b.mjs'), plugin('tautulli'));          // a built-in name
  await writeFile(join(dir, 'integrations', 'c.mjs'), 'export default 42');         // not an integration
  await writeFile(join(dir, 'integrations', 'd.mjs'), 'throw new Error("boom")');   // crashes on load
  const { loadPlugins } = await import('../src/server/plugins.ts');
  const registry: Record<string, any> = { tautulli: { type: 'tautulli', builtin: true } };
  const loaded = await loadPlugins(registry, [], []);
  assert.deepEqual([...loaded], ['hello']);
  assert.equal(registry.tautulli.builtin, true);
  const card = await registry.hello.create({}, {}).widgets.w.fetch();
  assert.equal(card.text, 'hi');
});

test('security: secrets are redacted, and Valet is read-only without sign-in unless the network is trusted', async () => {
  const { redactor, canAct } = await import('../src/server/security.ts');
  const r = redactor(['s3cr3t-key-123', 'pw12', 'abc', 'another.secret+value']);
  assert.equal(r('GET http://x/?apikey=s3cr3t-key-123 failed'), 'GET http://x/?apikey=••• failed');
  assert.equal(r('pw another.secret+value!'), 'pw •••!');           // regex characters are escaped
  assert.equal(r('pass pw12'), 'pass •••');                          // short passwords too
  assert.equal(r('xpw12y'), 'xpw12y');                               // but only as whole words
  assert.equal(r('abc stays'), 'abc stays');                         // too short to tell from words
  const cfg = (auth: object) => Config.parse({ auth });
  assert.equal(canAct(cfg({})), false);
  assert.equal(canAct(cfg({ mode: 'none', trustNetwork: true })), true);
  assert.equal(canAct(cfg({ mode: 'local' })), true);
});

test('scaffold: new-integration writes a plugin that loads and whose cards and tools work', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-'));
  const { scaffold, loadPlugins } = await import('../src/server/plugins.ts');
  assert.equal(await scaffold('my-service'), 0);
  assert.equal(await scaffold('my-service'), 1);   // won't overwrite
  const registry: Record<string, any> = {};
  await loadPlugins(registry, [], []);
  const i = registry['my-service'];
  const inst = i.create(i.config.parse({ url: 'http://x' }), { http: async () => ({}) });
  valid(await inst.widgets.status.fetch());
  assert.equal(inst.tools['my_service_restart'].access, 'control');
});

test('host guard: IPs, localhost and listed names pass; other names are refused (DNS rebinding)', async () => {
  const { hostGuard } = await import('../src/server/security.ts');
  const { Hono } = await import('hono');
  const app = new Hono();
  app.use('*', hostGuard(['valet.example.com', '*.home.example.com']));
  app.get('/', c => c.text('ok'));
  const at = (host: string, fwd?: string) => app.request('/', { headers: { host, ...(fwd ? { 'x-forwarded-host': fwd } : {}) } }).then(r => r.status);
  for (const h of ['localhost:7575', '192.168.1.5:7575', '[::1]:7575', 'valet.example.com', 'dash.home.example.com']) assert.equal(await at(h), 200, h);
  for (const h of ['evil.example.net', 'valet.example.com.evil.net', 'home.example.com']) assert.equal(await at(h), 421, h);
  assert.equal(await at('localhost', 'evil.example.net'), 421);   // a proxy forwarding a strange name
  assert.equal(await at('evil.example.net', 'localhost'), 421);   // a rebinding page can't vouch for itself
});

test('toolkit: session helper signs in once for parallel callers and again after reset; relative days', async () => {
  const { session, fmt } = await import('../src/server/core.ts');
  let n = 0;
  const s = session(async () => { n++; await new Promise(r => setTimeout(r, 5)); return `sid${n}`; });
  assert.deepEqual(await Promise.all([s.get(), s.get(), s.get()]), ['sid1', 'sid1', 'sid1']);
  s.reset();
  assert.equal(await s.get(), 'sid2');
  let fail = true;
  const f = session(async () => { if (fail) throw new Error('no'); return 'ok'; });
  await assert.rejects(f.get());
  fail = false;
  assert.equal(await f.get(), 'ok');   // a failed sign-in isn't cached
  assert.equal(fmt.relativeDay(Date.now() + 864e5), 'Tomorrow');
});

test('home assistant: buttons only do what cards offer, never an arbitrary service', async () => {
  const calls: string[] = [];
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', cards: { c: { title: 'C', entities: ['lock.front', 'vacuum.robot', 'sensor.t'] } } },
    fake(url => { calls.push(url); return {}; }));
  await assert.rejects(ha.actions!.press.run({ entity_id: 'lock.front', service: 'unlock' }));
  await assert.rejects(ha.actions!.choose.run({ entity_id: 'sensor.t', value: 'x' }));
  await ha.actions!.press.run({ entity_id: 'vacuum.robot', service: 'start' });
  assert.ok(calls.some(u => u.endsWith('/api/services/vacuum/start')));
});

test('custom api: paths, formats, templates, thresholds, and each way of showing it', async () => {
  const { default: api, pick, fill } = await import('../src/integrations/api.ts');
  assert.equal(pick({ a: { b: [{ c: 1 }] } }, 'a.b[0].c'), 1);
  assert.equal(pick({ a: { b: 1 } }, '$.a.b'), 1);                          // JSONPath habits are fine
  assert.equal(pick({ a: 2 }, '$a'), 2);
  assert.equal(pick({ a: 1 }, 'constructor'), undefined);                   // only the data's own properties
  assert.equal(fill('size|bytes', { size: 2048 }), '2.0 KB');
  assert.equal(fill('ratio|pct', { ratio: .42 }), '42%');
  assert.equal(fill('{used|bytes} of {total|bytes}', { used: 1024, total: 2048 }), '1.0 KB of 2.0 KB');
  assert.equal(fill('n|divide:1000|round:1', { n: 1234 }), 1.2);
  assert.throws(() => fill('n|nope', { n: 1 }), /unknown format "nope"/);

  const body = { cpu: 95, free: 5, name: 'box', items: [{ n: 'a', up: 'healthy', s: 1 }, { n: 'b', up: 'down', s: 2 }] };
  const ctx = fake(() => body);
  const stats = make(api, { url: 'http://x/', title: 'Box', stats: [{ label: 'CPU', value: 'cpu', unit: '%', max: 100, warn: 70, bad: 90 }, { label: 'Free', value: 'free', warn: 20, bad: 10 }, { label: 'Name', value: 'name' }] }, ctx);
  const s: any = await stats.widgets.data.fetch(); valid(s);
  assert.deepEqual(s.items.map((i: any) => [i.value, i.tone, i.pct]), [[95, 'bad', .95], [5, 'bad', undefined], ['box', undefined, undefined]]);
  assert.equal(s.summaries[0].value, '95%');

  const list: any = await make(api, { url: 'http://x/', list: { items: 'items', title: 'n', subtitle: 'status {up}' } }, ctx).widgets.data.fetch(); valid(list);
  assert.deepEqual(list.items.map((i: any) => i.subtitle), ['status healthy', 'status down']);
  const status: any = await make(api, { url: 'http://x/', status: { items: 'items', name: 'n', ok: 'up' } }, ctx).widgets.data.fetch(); valid(status);
  assert.deepEqual([status.items.map((i: any) => i.ok), status.summary.value], [[true, false], '1 down']);
  const rows = make(api, { url: 'http://x/', rows: { Name: 'name', CPU: '{cpu}%' } }, ctx);
  const kv: any = await rows.widgets.data.fetch(); valid(kv);
  assert.deepEqual(kv.rows, [['Name', 'box'], ['CPU', '95%']]);
  assert.deepEqual((await rows.tools!.read.run({})).data, { Name: 'box', CPU: '95%' });

  assert.throws(() => make(api, { url: 'http://x/' }, ctx), /exactly one of/);
  await assert.rejects(make(api, { url: 'http://x/', list: { items: 'name', title: 'n' } }, ctx).widgets.data.fetch(), /isn't a list/);
});

test('docker: reads frames and plain logs, names what\'s down, and offers no way to change anything', async () => {
  const { default: docker, parseLogs, tidyLogs } = await import('../src/integrations/docker.ts');
  const frame = (s: string) => { const b = Buffer.from(s), h = Buffer.alloc(8); h[0] = 1; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
  assert.equal(parseLogs(Buffer.concat([frame('one\n'), frame('two\n')])), 'one\ntwo\n');
  assert.equal(parseLogs(Buffer.from('plain tty log line\n')), 'plain tty log line\n');
  assert.deepEqual(tidyLogs('\u001b[31mERROR\u001b[0m out of memory\nok fine\n\n', 'error'), ['ERROR out of memory']);
  const list = [
    { Id: '1', Names: ['/radarr'], State: 'exited', Status: 'Exited (137) 2 hours ago', Labels: { 'com.docker.compose.project': 'media' } },
    { Id: '2', Names: ['/plex'], State: 'running', Status: 'Up 3 days (unhealthy)', Labels: {} },
    { Id: '3', Names: ['/backup'], State: 'exited', Status: 'Exited (0) 1 hour ago', Labels: {} },
    { Id: '4', Names: ['/caddy'], State: 'running', Status: 'Up 3 days', Labels: {} },
    { Id: '5', Names: ['/hidden'], State: 'running', Status: 'Up', Labels: {} },
  ];
  const calls: string[] = [];
  const ctx = fake(url => { calls.push(url); return url.includes('/logs') ? new Response(frame('2026 boom\n')) : list; });
  const d = make(docker, { url: 'http://proxy:2375', hide: ['hidden'] }, ctx);
  const c: any = await d.widgets.containers.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.name, i.ok, i.detail, i.quiet]), [['backup', false, 'exited (0)', true], ['caddy', true, undefined, false], ['plex', false, 'unhealthy', false], ['radarr', false, 'exited (137)', false]]);
  assert.equal(c.summary.value, '2 down');
  const logs: any = await d.tools!.container_logs.run({ name: 'rad', lines: 50 });
  assert.deepEqual(logs.data.lines, ['2026 boom']);
  await assert.rejects(d.tools!.container_logs.run({ name: 'nothing', lines: 50 }), /no container like/);
  assert.ok(Object.values(d.tools!).every(t => t.access === 'read'));
  assert.equal(d.actions, undefined);
  assert.ok(calls.every(u => !/\/(restart|stop|start|exec|create)\b/.test(u)));
});

test('host: services by name, quiet ones never alert, and logs say what\'s allowed', async () => {
  const { default: host } = await import('../src/integrations/host.ts');
  const services = [{ unit: 'radarr', name: 'radarr', state: 'failed', result: 'exit-code', restarts: 3 }, { unit: 'sonarr', name: 'sonarr', state: 'active' }, { unit: 'user:job', name: 'job', state: 'inactive' }];
  const h = make(host, { url: 'http://agent:7576/', token: 'tok', quiet: ['job'] }, fake(url => url.includes('/logs') ? new Response(JSON.stringify(url.includes('ssh') ? { error: 'not a listed service', listed: ['radarr'] } : { lines: ['boom'] }), { status: url.includes('ssh') ? 404 : 200 }) : { host: 'nas', services }));
  const c: any = await h.widgets.services.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.name, i.ok, i.detail, i.quiet]), [['radarr', false, 'failed (exit-code)', false], ['sonarr', true, undefined, false], ['job', false, 'inactive', true]]);
  assert.equal(c.summary.value, '1 down');
  assert.deepEqual(((await h.tools!.service_logs.run({ name: 'radarr.service', lines: 50 })) as any).data.lines, ['boom']);
  assert.deepEqual(((await h.tools!.service_logs.run({ name: 'ssh', lines: 50 })) as any).data.listed, ['radarr']);
  assert.ok(Object.values(h.tools!).every(t => t.access === 'read'));
});

test('updates: reading images and versions, and only comparing like with like', async () => {
  const { listTags, newest, parseImage, warnings } = await import('../src/server/registry.ts');
  assert.deepEqual(parseImage('ghcr.io/immich-app/immich-server:v3.3.5'), { registry: 'ghcr.io', repo: 'immich-app/immich-server', tag: 'v3.3.5' });
  assert.deepEqual(parseImage('nginx'), { registry: 'registry-1.docker.io', repo: 'library/nginx', tag: 'latest' });
  assert.deepEqual(parseImage('mccloud/subgen:2026.07.3'), { registry: 'registry-1.docker.io', repo: 'mccloud/subgen', tag: '2026.07.3' });
  assert.deepEqual(parseImage('lscr.io/linuxserver/bazarr:1.5.2@sha256:abc'), { registry: 'lscr.io', repo: 'linuxserver/bazarr', tag: '1.5.2' });
  assert.equal(parseImage('sha256:deadbeef'), null);

  assert.deepEqual(newest('v1.2.3', ['v1.2.3', 'v1.2.4', 'v1.10.0', 'v1.9.9', '2.0.0-rc1', 'v2.0.0-beta']), { tag: 'v1.10.0', major: false });   // numbers, not text
  assert.deepEqual(newest('15-alpine', ['15-alpine', '16-alpine', '17', '17-bookworm']), { tag: '16-alpine', major: true });                    // the same flavour
  assert.equal(newest('1.2.3', ['1.2.2', '1.2.3', 'latest']), null);
  assert.equal(newest('latest', ['1.2.3']), null);
  assert.deepEqual(newest('2026.10.25-54ca1d9cf', ['2026.10.25-54ca1d9cf', '2026.10.29-aabbccd1']), { tag: '2026.10.29-aabbccd1', major: false }); // a hash isn't a flavour
  assert.deepEqual(warnings('# 3.4\n- **Breaking**: config moved\n- faster search\n* Requires a database migration'), ['Breaking: config moved', 'Requires a database migration']);

  // the anonymous token dance every registry shares
  const seen: string[] = [];
  const tags = await listTags({ registry: 'ghcr.io', repo: 'a/b', tag: '1' }, async (url, headers) => {
    seen.push(url);
    if (url.includes('/token')) return new Response(JSON.stringify({ token: 'T' }));
    if (headers?.Authorization !== 'Bearer T') return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"' } });
    return new Response(JSON.stringify({ tags: ['1', '2'] }));
  });
  assert.deepEqual(tags, ['1', '2']);
  assert.match(seen[1], /token\?service=ghcr\.io&scope=repository%3Aa%2Fb%3Apull/);
});

test('docker updates: names what\'s behind, surfaces warnings, and caches registry checks', async () => {
  const { default: docker } = await import('../src/integrations/docker.ts');
  let registry = 0;
  const list = [
    { Id: '1', Names: ['/immich'], State: 'running', Status: 'Up', Image: 'ghcr.io/immich-app/immich-server:v3.3.5', Labels: {} },
    { Id: '2', Names: ['/caddy'], State: 'running', Status: 'Up', Image: 'caddy:2.11.7', Labels: {} },
    { Id: '3', Names: ['/watchtower'], State: 'running', Status: 'Up', Image: 'watchtower:latest', Labels: {} },
  ];
  const ctx = fake(url => {
    if (url.includes('/tags/list')) { registry++; return new Response(JSON.stringify({ tags: url.includes('immich') ? ['v3.3.5', 'v3.4.0'] : ['2.11.7'] })); }
    if (url.includes('/releases')) return [{ tag_name: 'v3.4.0', published_at: '2026-10-20', body: '- Breaking: run the database migration' }, { tag_name: 'v3.3.5', published_at: '2026-10-01', body: 'old' }];
    return list;
  });
  const d = make(docker, { url: 'http://proxy:2375' }, ctx);
  const c: any = await d.widgets.updates.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.title, i.subtitle, i.meta, i.tone]), [['immich', 'v3.3.5 → v3.4.0', 'Read first', 'warn']]);
  assert.equal(c.summary.sub, '1 to read first');
  const t: any = await d.tools!.updates_check.run({});
  assert.deepEqual([t.data.upToDate, t.data.floatingTag], [1, ['watchtower']]);
  assert.equal(t.data.behind[0].warnings[0], 'v3.4.0: Breaking: run the database migration');
  assert.equal(registry, 2);                                                       // the second look used the cache
  const n: any = await d.tools!.update_notes.run({ name: 'immich' });
  assert.deepEqual(n.data.releases.map((r: any) => r.version), ['v3.4.0']);         // only what's new to you
});
