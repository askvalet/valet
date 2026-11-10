// The server's own pieces: sign-in, the hub, config loading, plugin card checks, and that every built-in tool reads
// well in chat. No real services, no network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';

// auth.ts reads VALET_DATA when it loads, so point it at a scratch folder first
process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-srv-'));
const { setupAuth, sameOrigin, clientIp } = await import('../src/server/auth.ts');
const { Config, loadConfig, usedSecrets } = await import('../src/server/config.ts');
const { Hub } = await import('../src/server/hub.ts');
const { guardCards } = await import('../src/server/plugins.ts');
const { registry } = await import('../src/integrations/index.ts');

// a request as if from this address (hono's node conninfo reads the socket)
const from = (ip: string) => ({ incoming: { socket: { remoteAddress: ip, remotePort: 1, remoteFamily: 'IPv4' } } });
const json = (body: object, cookie = '') => ({ method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

test('auth (local): setup code once, sign-in, tampered cookies refused, signing out everywhere', async () => {
  const lines: string[] = [], log = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  const app = new Hono();
  const guard = await setupAuth(app, Config.parse({ auth: { mode: 'local' } }));
  console.log = log;
  app.use('/api/*', guard);
  app.get('/api/secret', c => c.text('ok'));
  const code = lines.join('\n').match(/setup code:\s+(\S+)/)?.[1];
  assert.ok(code, 'prints a setup code');
  const ip = from('10.0.0.2');

  assert.equal((await app.request('/api/secret', {}, ip)).status, 401);
  assert.equal((await app.request('/api/auth/setup', json({ code: 'nope', name: 'me', password: 'longenough' }), ip)).status, 401);
  const setup = await app.request('/api/auth/setup', json({ code, name: 'me', password: 'longenough' }), ip);
  assert.equal(setup.status, 200);
  assert.equal((await app.request('/api/auth/setup', json({ code, name: 'x', password: 'longenough' }), ip)).status, 409);   // only once

  const login = await app.request('/api/auth/login', json({ name: 'me', password: 'longenough' }), ip);
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  assert.match(cookie, /HttpOnly|valet_session=/);
  assert.equal((await app.request('/api/secret', { headers: { cookie } }, ip)).status, 200);

  // a forged body (another name) with the old signature, and a truncated signature, are both refused
  const [name, mac] = cookie.split('=')[1].split('.');
  const forged = Buffer.from(`admin|1|${Date.now() + 1e9}`).toString('base64url');
  for (const bad of [`valet_session=${forged}.${mac}`, `valet_session=${name}.${mac.slice(0, 10)}`])
    assert.equal((await app.request('/api/secret', { headers: { cookie: bad } }, ip)).status, 401, bad);

  // signing out everywhere bumps the version, so the old cookie stops working
  await app.request('/api/auth/logout', json({ everywhere: true }, cookie), ip);
  assert.equal((await app.request('/api/secret', { headers: { cookie } }, ip)).status, 401);
});

test('auth (local): repeated wrong passwords slow down per address and per name', async () => {
  const app = new Hono(), log = console.log;
  console.log = () => {};
  await setupAuth(app, Config.parse({ auth: { mode: 'local' } }));
  console.log = log;
  const tries = async (ip: string, name: string) => (await app.request('/api/auth/login', json({ name, password: 'wrong-password' }), from(ip))).status;
  for (let i = 0; i < 6; i++) assert.equal(await tries('10.0.0.9', 'me'), 401);
  assert.equal(await tries('10.0.0.9', 'me'), 429);
  assert.equal(await tries('10.0.0.10', 'me'), 429);          // the name is throttled from any address
  assert.equal(await tries('10.0.0.11', 'someone'), 401);     // other people aren't
});

test('auth (proxy): the user header counts only from a trusted proxy', async () => {
  const app = new Hono();
  const guard = await setupAuth(app, Config.parse({ auth: { mode: 'proxy', proxy: { header: 'Remote-User', trusted: ['10.0.0.1'] } } }));
  app.use('/api/*', guard);
  app.get('/api/x', c => c.text('ok'));
  const h = { headers: { 'remote-user': 'me' } };
  assert.equal((await app.request('/api/x', h, from('10.0.0.1'))).status, 200);
  assert.equal((await app.request('/api/x', h, from('10.0.0.66'))).status, 401);   // anyone can send the header
});

test('client address: behind a trusted proxy, the hop the proxy saw, not one the client made up', () => {
  const proxy = new Set(['10.0.0.1']);
  assert.equal(clientIp('10.0.0.1', '6.6.6.6, 203.0.113.9', proxy), '203.0.113.9');   // client forged the first hop
  assert.equal(clientIp('10.0.0.1', '203.0.113.9, 10.0.0.1', proxy), '203.0.113.9'); // skips trusted hops
  assert.equal(clientIp('198.51.100.7', '1.2.3.4', proxy), '198.51.100.7');          // not from the proxy: ignored
  assert.equal(clientIp('10.0.0.1', undefined, proxy), '10.0.0.1');
});

test('same origin: changes from another site are refused, reads and same-site posts pass', async () => {
  const app = new Hono();
  app.use('*', sameOrigin);
  app.all('/x', c => c.text('ok'));
  const at = (method: string, origin?: string) => app.request('/x', { method, headers: { host: 'valet.example.com', ...(origin ? { origin } : {}) } }).then(r => r.status);
  assert.equal(await at('POST', 'https://evil.example.net'), 403);
  assert.equal(await at('POST', 'https://valet.example.com'), 200);
  assert.equal(await at('GET', 'https://evil.example.net'), 200);
});

test('config: ${VAR} fills from the environment and is remembered for redaction; a missing one is an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-cfg-'));
  process.env.VALET_TEST_KEY = 'k-1234567890';
  await writeFile(join(dir, 'a.yaml'), 'integrations:\n  w: { type: weather, apiKey: "${VALET_TEST_KEY}" }\n');
  await writeFile(join(dir, 'b.yaml'), 'integrations:\n  w: { type: weather, apiKey: "${VALET_NOT_SET}" }\n');
  const c = await loadConfig(join(dir, 'a.yaml'));
  assert.equal((c.integrations.w as any).apiKey, 'k-1234567890');
  assert.ok(usedSecrets.includes('k-1234567890'));
  await assert.rejects(loadConfig(join(dir, 'b.yaml')), /VALET_NOT_SET is not set/);
  await writeFile(join(dir, 'c.yaml'), 'titel: typo\n');
  await assert.rejects(loadConfig(join(dir, 'c.yaml')), /config\.yaml/);   // unknown top-level keys are mistakes
});

test('hub: identical cards aren\'t re-sent, errors keep the last card, a refresh asked mid-flight runs once more', async () => {
  let n = 0, fail = false, release: () => void = () => {};
  const widget = { title: 'W', fetch: async () => {
    n++;
    if (fail) throw new Error('down');
    if (n === 3) await new Promise<void>(r => { release = r; });
    return { type: 'text' as const, text: n >= 3 ? `v${n}` : 'same' };
  } };
  const changes: string[] = [];
  const hub = new Hub(new Map([['i', { widgets: { w: widget } }]]), (k, _prev, next) => { changes.push(next.card && 'text' in next.card ? next.card.text : ''); });
  const sent: unknown[] = [];
  const stop = hub.subscribe(s => sent.push(s));   // starts polling: first fetch
  await new Promise(r => setTimeout(r, 5));
  await hub.refresh('i.w');           // same card: not pushed again
  assert.equal(sent.length, 1);

  const busy = hub.refresh('i.w');    // n=3 waits…
  await hub.refresh('i.w');           // …so this one is queued, not run in parallel
  assert.equal(n, 3);
  release(); await busy;
  assert.equal(n, 4);                 // ran exactly once more
  assert.deepEqual(changes, ['same', 'v3', 'v4']);

  fail = true;
  await hub.refresh('i.w');
  const last = hub.snapshot()[0];
  assert.equal(last.error, 'down');
  assert.deepEqual(last.card, { type: 'text', text: 'v4' });   // the last good card stays up
  assert.equal(changes.length, 3);                             // errors don't fire change notices
  stop();
});

test('plugins: a card that isn\'t in the catalog becomes an error (widgets) or is dropped (chat)', async () => {
  const errors: string[] = [], err = console.error;
  console.error = (m: string) => { errors.push(m); };
  const inst = guardCards({
    widgets: { w: { title: 'W', fetch: async () => ({ type: 'hologram' }) as any } },
    tools: { t: { description: '', access: 'read', input: {} as any, run: async () => ({ data: { x: 1 }, card: { type: 'stats', items: 'no' } as any }) } },
  });
  await assert.rejects(inst.widgets.w.fetch(), /doesn't match the catalog/);
  assert.deepEqual(await inst.tools!.t.run({}), { data: { x: 1 } });
  console.error = err;
  assert.match(errors[0], /plugin tool t/);
});

test('built-in tools: each says what it did in words, and changes are never read-level', () => {
  const ctx = { id: 't', http: async () => ({}), log() {}, image: (r: string) => r, upload: async () => ({}), session: () => ({ get: async () => '', reset() {} }) } as any;
  const sample: Record<string, object> = { http: { services: [] }, homeassistant: { url: 'http://x', token: 't' }, 'rgb-control': { url: 'http://x' } };
  for (const [type, integration] of Object.entries(registry)) {
    let inst;
    try { inst = integration.create(integration.config.parse({ url: 'http://x', apiKey: 'k', token: 't', password: 'p', username: 'u', ...sample[type] }), ctx); }
    catch { continue; }   // needs options this generic config doesn't give; its own test covers it
    for (const [name, t] of Object.entries(inst.tools ?? {})) {
      assert.ok(t.label, `${type}.${name} has a label`);
      if (/^(pause|resume)_|_(stop_stream|unload|control|request|retest|lighting|save|add|pause)$/.test(name)) assert.notEqual(t.access, 'read', `${type}.${name} changes something`);
    }
  }
});

test('thinking: reasoning left in a reply is split from the answer', async () => {
  const { splitThink } = await import('../src/shared/think.ts');
  assert.deepEqual(splitThink('Reasoning here.\n</think>\n\nThe answer.'), { thought: 'Reasoning here.', said: 'The answer.', thinking: false });
  assert.deepEqual(splitThink('<think>hmm</think>Hello'), { thought: 'hmm', said: 'Hello', thinking: false });
  assert.deepEqual(splitThink('<think>still going'), { thought: 'still going', said: '', thinking: true });
  assert.deepEqual(splitThink('Plain answer about <b>'), { thought: '', said: 'Plain answer about <b>', thinking: false });
  assert.deepEqual(splitThink('one</think>two</think>three'), { thought: 'onetwo', said: 'three', thinking: false });
  // a model that lost its way: template tags left in the answer, sometimes hundreds of them
  assert.deepEqual(splitThink('Looking.</think>\n\nAll up.\n' + '</trans>\n'.repeat(300) + '<trans>'), { thought: 'Looking.', said: 'All up.', thinking: false });
  assert.equal(splitThink('All up.</thinking>').said, 'All up.');
  assert.equal(splitThink('<trans>All up.</trans>').said, 'All up.');
  assert.equal(splitThink('Use <transform> and <b>').said, 'Use <transform> and <b>');
});

test('another agent: the config hands it the chat, but never on a read-only page', async () => {
  const { chatAgent } = await import('../src/server/model.ts');
  const a = Config.parse({ assistant: { model: 'm', agent: { name: 'Hermes', baseURL: 'http://x/v1', model: 'h' } } }).assistant!;
  assert.equal(chatAgent(a, true)?.name, 'Hermes');
  assert.equal(chatAgent(a, false), undefined);
  assert.equal(chatAgent(Config.parse({ assistant: { model: 'm' } }).assistant!, true), undefined);
});

test('agent streams: named events are dropped, even split across chunks; ordinary frames pass', async () => {
  const { plainEvents } = await import('../src/server/model.ts');
  const parts = ['data: {"a":1}\n\nevent: hermes.tool.progress\nda', 'ta: {"tool":"x"}\n\ndata: {"a":2}\n\n', 'event: message\ndata: {"a":3}\n\ndata: [DONE]\n\n'];
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  assert.equal(await new Response(plainEvents(body)).text(), 'data: {"a":1}\n\ndata: {"a":2}\n\nevent: message\ndata: {"a":3}\n\ndata: [DONE]\n\n');
});

test('notify: each service gets the request it expects, and one failing leaves the others alone', async () => {
  const { push, request, Channel } = await import('../src/server/notify.ts');
  const m = { title: 'Joker finished', text: 'Ready to watch', urgent: true };
  const body = (c: any) => JSON.parse(String(request(Channel.parse(c), m).init.body));
  const ntfy = request(Channel.parse({ type: 'ntfy', url: 'https://ntfy.example/home', token: 't' }), m);
  assert.deepEqual([ntfy.url, ntfy.init.body, (ntfy.init.headers as any).Priority, (ntfy.init.headers as any).Authorization], ['https://ntfy.example/home', 'Ready to watch', '4', 'Bearer t']);
  assert.equal(request(Channel.parse({ type: 'telegram', token: 'T', chat: 5 }), m).url, 'https://api.telegram.org/botT/sendMessage');
  assert.deepEqual(body({ type: 'telegram', token: 'T', chat: 5 }), { chat_id: 5, text: 'Joker finished\nReady to watch' });
  assert.equal((request(Channel.parse({ type: 'gotify', url: 'https://g.example/', token: 'k' }), m).init.headers as any)['X-Gotify-Key'], 'k');
  assert.equal(request(Channel.parse({ type: 'gotify', url: 'https://g.example/', token: 'k' }), m).url, 'https://g.example/message');
  assert.equal(body({ type: 'discord', url: 'https://d.example/w' }).content, 'Joker finished\nReady to watch');
  assert.equal(body({ type: 'slack', url: 'https://s.example/w' }).text, 'Joker finished\nReady to watch');
  assert.equal(body({ type: 'pushover', token: 't', user: 'u' }).priority, 1);
  assert.deepEqual(body({ type: 'apprise', url: 'http://a/notify/k' }), { title: 'Joker finished', body: 'Ready to watch', type: 'warning' });
  assert.throws(() => Channel.parse({ type: 'carrier-pigeon' }));
  const sent: string[] = [], err = console.error; console.error = () => {};
  await push([{ type: 'slack', url: 'https://bad.example/' }, { type: 'discord', url: 'https://good.example/' }], m, (async (u: string) => { sent.push(u); if (u.includes('bad')) throw new Error('nope'); return new Response('{}'); }) as any);
  console.error = err;
  assert.deepEqual(sent, ['https://bad.example/', 'https://good.example/']);
});

test('reminders: fire once on the change asked for, thresholds must hold, and they expire', async () => {
  const { fires, reading, Watches } = await import('../src/server/watches.ts');
  const card = (titles: string[]): any => ({ type: 'media', items: titles.map(title => ({ title })), activity: titles[0] ? { title: titles[0] } : undefined });
  const w = (x: object): any => ({ id: 'a', widget: 'd.x', minutes: 0, say: 'hi', until: Infinity, ...x });
  const held = new Map<string, number>();
  assert.equal(fires(w({ on: 'ends', name: 'joker' }), card(['Joker', 'Dune']), card(['Dune']), held), true);
  assert.equal(fires(w({ on: 'ends', name: 'joker' }), card(['Joker', 'Dune']), card(['Joker']), held), false);
  assert.equal(fires(w({ on: 'ends' }), card(['Joker']), card([]), held), true);
  assert.equal(fires(w({ on: 'starts' }), card([]), card(['Joker']), held), true);
  assert.equal(fires(w({ on: 'ends' }), undefined, card([]), held), false);              // first sight isn't news
  const status = (ok: boolean): any => ({ type: 'status', items: [{ name: 'Radarr', ok }] });
  assert.equal(fires(w({ on: 'up', name: 'radarr' }), status(false), status(true), held), true);
  assert.equal(fires(w({ on: 'down', name: 'radarr' }), status(true), status(true), held), false);
  const temp = (v: string): any => ({ type: 'stats', items: [{ label: 'Temperature', value: v }] });
  assert.equal(reading(temp('61°C'), 'temp'), 61);
  const hot = w({ on: 'above', name: 'temp', value: 55, minutes: 10 });
  assert.equal(fires(hot, undefined, temp('60'), held, 0), false);                       // crossed, not held yet
  assert.equal(fires(hot, undefined, temp('50'), held, 300_000), false);                 // dropped: the clock resets
  assert.equal(fires(hot, undefined, temp('60'), held, 400_000), false);
  assert.equal(fires(hot, undefined, temp('60'), held, 1_000_001), true);

  const fired: string[] = [];
  const list = new Watches([w({ on: 'ends' }), w({ id: 'b', on: 'ends', until: 5, say: 'old' })], x => fired.push(x.say));
  const at = (t: string[], key = 'd.x') => [{ key, at: 1, card: card(t) }];
  list.check(at(['Joker']), 1); list.check(at([]), 2); list.check(at([]), 3);
  assert.deepEqual(fired, ['hi', 'old']);                                                 // both ended; each once
  assert.equal(list.list.length, 0);
  const late = new Watches([w({ on: 'starts', until: 5 })], x => fired.push(x.say));
  late.check(at([]), 10);
  assert.equal(late.list.length, 0);                                                      // past its date: dropped quietly
});

test('timeline and history: what happened, and how the numbers moved', async () => {
  const { Timeline } = await import('../src/server/timeline.ts');
  const { History } = await import('../src/server/history.ts');
  const t = new Timeline();
  t.add('down', 'Radarr is down', 's.status', Date.now() - 2 * 36e5); t.add('up', 'Radarr is back', 's.status');
  assert.equal(t.since(36e5).length, 1);
  assert.match(t.lines(3 * 36e5)[0], /down: Radarr is down/);
  const h = new History(24, 0);
  for (const v of ['10%', '90%', '20%']) { h.apply('a.b', { type: 'text', text: '', summary: { label: 'CPU', value: v } }); await new Promise(r => setTimeout(r, 2)); }
  const [m] = h.overview(36e5);
  assert.deepEqual([m.name, m.now, m.low, m.high], ['CPU (a.b)', 20, 10, 90]);
  assert.equal(m.unit, '%');                                 // the graph knows what the numbers are
  assert.equal(h.points('cpu', 36e5)[0].unit, '%');
});
