// Integrations against made-up service responses: the cards they produce validate, and the logic that's easy to get
// wrong (sign-in reuse, parsing, roll-over to tomorrow, picking a verse) does what it says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/server/config.ts';
import { session, type Context, type Instance } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import arr from '../src/integrations/arr.ts';
import homeassistant from '../src/integrations/homeassistant.ts';
import pihole from '../src/integrations/pihole.ts';
import quran from '../src/integrations/quran.ts';
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
  assert.equal((card as any).summary.value, '14%');
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

test('scrutiny: a failing drive is called out', async () => {
  const s = make(scrutiny, { url: 'http://s' }, fake(() => ({ data: { summary: {
    a: { device: { device_name: 'sda', model_name: 'Disk A', device_status: 0 }, smart: { temp: 40, power_on_hours: 9000 } },
    b: { device: { device_name: 'sdb', model_name: 'Disk B', device_status: 2 }, smart: { temp: 61, power_on_hours: 20 } } } } })));
  const card: any = await s.widgets.drives.fetch();
  valid(card);
  assert.equal(card.summary.value, '1 failing');
  assert.equal(card.items[1].tone, 'bad');
});

test('arr: episodes and movies come out in date order with friendly days', async () => {
  const soon = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
  const a = make(arr, { sonarr: { url: 'http://s', apiKey: 'k' }, radarr: { url: 'http://r', apiKey: 'k' } }, fake(url => url.startsWith('http://s')
    ? [{ airDateUtc: soon(3), seasonNumber: 1, episodeNumber: 2, title: 'Two', hasFile: false, series: { title: 'Show', images: [] } }]
    : [{ title: 'Film', year: 2026, digitalRelease: soon(1), hasFile: false, images: [{ coverType: 'poster', remoteUrl: 'https://img/original/x.jpg' }] }]));
  const card: any = await a.widgets.upcoming.fetch();
  valid(card);
  assert.deepEqual(card.items.map((i: any) => i.title), ['Film', 'Show']);
  assert.equal(card.items[0].badge, 'Tomorrow');
  assert.equal(card.items[0].image, 'https://img/w342/x.jpg');
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
  const dir = await mkdtemp(join(tmpdir(), 'atrium-'));
  process.env.ATRIUM_DATA = dir;
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

test('security: secrets are redacted, and Atrium is read-only without sign-in unless the network is trusted', async () => {
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
  process.env.ATRIUM_DATA = await mkdtemp(join(tmpdir(), 'atrium-'));
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
  app.use('*', hostGuard(['atrium.example.com', '*.home.example.com']));
  app.get('/', c => c.text('ok'));
  const at = (host: string, fwd?: string) => app.request('/', { headers: { host, ...(fwd ? { 'x-forwarded-host': fwd } : {}) } }).then(r => r.status);
  for (const h of ['localhost:7575', '192.168.1.5:7575', '[::1]:7575', 'atrium.example.com', 'dash.home.example.com']) assert.equal(await at(h), 200, h);
  for (const h of ['evil.example.net', 'atrium.example.com.evil.net', 'home.example.com']) assert.equal(await at(h), 421, h);
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
