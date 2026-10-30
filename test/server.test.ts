// The server's own pieces: sign-in, the hub, config loading, plugin card checks, and that every built-in tool reads
// well in chat. No real services, no network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';

// auth.ts reads ATRIUM_DATA when it loads, so point it at a scratch folder first
process.env.ATRIUM_DATA = await mkdtemp(join(tmpdir(), 'atrium-srv-'));
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
  assert.match(cookie, /HttpOnly|atrium_session=/);
  assert.equal((await app.request('/api/secret', { headers: { cookie } }, ip)).status, 200);

  // a forged body (another name) with the old signature, and a truncated signature, are both refused
  const [name, mac] = cookie.split('=')[1].split('.');
  const forged = Buffer.from(`admin|1|${Date.now() + 1e9}`).toString('base64url');
  for (const bad of [`atrium_session=${forged}.${mac}`, `atrium_session=${name}.${mac.slice(0, 10)}`])
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
  const at = (method: string, origin?: string) => app.request('/x', { method, headers: { host: 'atrium.example.com', ...(origin ? { origin } : {}) } }).then(r => r.status);
  assert.equal(await at('POST', 'https://evil.example.net'), 403);
  assert.equal(await at('POST', 'https://atrium.example.com'), 200);
  assert.equal(await at('GET', 'https://evil.example.net'), 200);
});

test('config: ${VAR} fills from the environment and is remembered for redaction; a missing one is an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atrium-cfg-'));
  process.env.ATRIUM_TEST_KEY = 'k-1234567890';
  await writeFile(join(dir, 'a.yaml'), 'integrations:\n  w: { type: weather, apiKey: "${ATRIUM_TEST_KEY}" }\n');
  await writeFile(join(dir, 'b.yaml'), 'integrations:\n  w: { type: weather, apiKey: "${ATRIUM_NOT_SET}" }\n');
  const c = loadConfig(join(dir, 'a.yaml'));
  assert.equal((c.integrations.w as any).apiKey, 'k-1234567890');
  assert.ok(usedSecrets.includes('k-1234567890'));
  assert.throws(() => loadConfig(join(dir, 'b.yaml')), /ATRIUM_NOT_SET is not set/);
  await writeFile(join(dir, 'c.yaml'), 'titel: typo\n');
  assert.throws(() => loadConfig(join(dir, 'c.yaml')), /config\.yaml/);   // unknown top-level keys are mistakes
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
});
