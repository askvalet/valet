// The server as an attacker sees it: the real build, in each sign-in mode, from outside. Every route in the source is
// tried without a session, so a route added later is covered without anyone remembering to. Needs `npm run build`.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttp } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

const SECRET = 'CANARY-SECRET-3f9a1c', TITLE = 'CANARY-TITLE-77d2';

// Open on purpose, each for a reason. Anything else that answers without a session fails this file.
const PUBLIC = new Set([
  'GET /healthz',            // a docker healthcheck: a number, nothing named
  'GET /api/wallpaper/:n?',  // the sign-in screen wears these
  'GET /api/custom.css',
  'GET /api/font',
  'GET /api/icon/:slug',
  'GET /plugins/:file',      // a plugin's browser half: code, no data
  'GET *',                   // the page's shell, which holds no data until /api answers
]);
const IN_AUTH = /^\/api\/auth\//;   // the sign-in routes themselves

async function routes() {
  const src = await readFile('src/server/main.ts', 'utf8');
  return [...src.matchAll(/\bapp\.(get|post|put|patch|delete|all)\('([^']+)'/g)].map(m => ({ method: m[1].toUpperCase(), path: m[2] }));
}
const fill = (p: string) => p.replace(/:n\?/, '').replace(/:\w+/g, 'x');
const freePort = () => new Promise<number>(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as any; s.close(() => ok(port)); }); });

async function boot(auth: Record<string, unknown>, extra = '', access = '{ config: control }', env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'valet-exposure-')), port = await freePort(), file = join(dir, 'config.yaml');
  await writeFile(file, `title: ${TITLE}
auth: ${JSON.stringify(auth)}
assistant: { model: none, baseURL: "http://127.0.0.1:9/v1", access: ${access} }
integrations:
  probe: { type: api, url: "http://127.0.0.1:9/x", headers: { Authorization: "Bearer \${PROBE_KEY}" }, stats: [{ label: Up, value: a }] }
${extra}layout:
  - widgets: [probe.data]
`);
  let log = '';
  const proc = spawn('node', ['dist/server.js'], { env: { ...process.env, VALET_CONFIG: file, VALET_DATA: dir, PORT: String(port), HOST: '127.0.0.1', PROBE_KEY: SECRET, ...env } });
  proc.stdout!.on('data', d => { log += d; }); proc.stderr!.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/healthz`).then(r => r.ok, () => false)) return { proc, base, port, log: () => log, dir };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`didn't start:\n${log}`);
}
/** A request exactly as written: fetch would tidy the path before it left. */
const raw = (port: number, path: string) => new Promise<string>((ok, no) => {
  const s = connect(port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
  let out = ''; s.on('data', d => { out += d; }); s.on('end', () => ok(out)); s.on('error', no);
});
const clean = (where: string, text: string) => { assert.ok(!text.includes(SECRET), `${where} leaked the secret`); assert.ok(!text.includes(TITLE), `${where} leaked the config`); };

const FORGED = (body: string) => [`valet_session=${body}.${'A'.repeat(43)}`, `valet_session=${body}.${'é'.repeat(43)}`, `valet_session=${body}`, 'valet_session=.', 'valet_session=a.b.c'];
const SPOOFS = { 'X-Forwarded-User': 'admin', 'Remote-User': 'admin', 'X-Authentik-Username': 'admin', 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1' };

function everyRoute(name: string, auth: Record<string, unknown>) {
  describe(name, () => {
    let s: Awaited<ReturnType<typeof boot>>;
    before(async () => { s = await boot(auth); });
    after(() => { s.proc.kill(); });

    test('every route outside the public list refuses without a session', async () => {
      const list = await routes();
      assert.ok(list.length > 15, 'found the routes');
      for (const r of ['GET /api/commands', 'POST /api/command']) assert.ok(list.some(x => `${x.method} ${x.path}` === r), `${r} is among them`);   // ⌘K's commands
      for (const r of list) {
        const key = `${r.method} ${r.path}`;
        if (PUBLIC.has(key) || IN_AUTH.test(r.path)) continue;
        const res = await fetch(s.base + fill(r.path), { method: r.method, headers: r.method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: r.method === 'GET' ? undefined : '{}' });
        const text = await res.text();
        assert.equal(res.status, 401, `${key} answered ${res.status}: ${text.slice(0, 120)}`);
        clean(key, text);
      }
    });

    test('something Valet signed for another purpose is not a session', async () => {
      if (auth.mode !== 'oidc') return;
      const started = await fetch(`${s.base}/api/auth/oidc/start`, { redirect: 'manual' });
      const flow = (started.headers.get('set-cookie') ?? '').split(';')[0].split('=').slice(1).join('=');
      assert.ok(flow, 'the sign-in started and handed out its cookie');
      assert.equal((await fetch(`${s.base}/api/page`, { headers: { cookie: `valet_session=${flow}` } })).status, 401);
    });

    test('nothing public says what is configured', async () => {
      for (const key of PUBLIC) {
        const [method, path] = key.split(' '), url = path === '*' ? '/anything' : fill(path);
        clean(key, await fetch(s.base + url, { method }).then(r => r.text()));
      }
    });

    test('invented cookies and identity headers get nowhere', async () => {
      const body = Buffer.from(`admin|1|${Date.now() + 1e9}`).toString('base64url');
      for (const cookie of FORGED(body)) assert.equal((await fetch(`${s.base}/api/page`, { headers: { cookie } })).status, 401, cookie);
      assert.equal((await fetch(`${s.base}/api/page`, { headers: SPOOFS })).status, 401);
    });

    test('tricks with the path reach neither data nor files', async () => {
      for (const p of ['/api/auth/../page', '/api/auth/%2e%2e/page', '/api/auth/..%2fpage', '/api/icon/../page', '/api/wallpaper/../page', '//api/page', '/api//page', '/api/page/', '/API/page', '/api/%70age', '/api/custom.css/../page',
        '/../config.yaml', '/..%2f..%2fconfig.yaml', '/%2e%2e/%2e%2e/config.yaml', '/.env', '/data/secret', '/data/users.json', '/config.yaml', '/plugins/..%2f..%2fsecret', '/assets/../../../config.yaml'])
        clean(p, await raw(s.port, p));
    });

    test('the data folder stays unreadable by name', async () => {
      for (const f of ['secret', 'users.json', 'activity.json']) {
        const text = await fetch(`${s.base}/${f}`).then(r => r.text());
        assert.doesNotMatch(text, /"hash"|"salt"/);
      }
    });
  });
}

everyRoute('local accounts', { mode: 'local', secureCookie: false });
everyRoute('an auth proxy', { mode: 'proxy', proxy: { header: 'Remote-User', trusted: ['10.9.9.9'] } });
const idp = createHttp((_, r) => { const b = `http://127.0.0.1:${(idp.address() as any).port}`; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ issuer: b, authorization_endpoint: `${b}/auth`, token_endpoint: `${b}/token`, jwks_uri: `${b}/jwks` })); });
await new Promise<void>(ok => idp.listen(0, '127.0.0.1', ok)); idp.unref();
everyRoute('OpenID Connect', { mode: 'oidc', oidc: { issuer: `http://127.0.0.1:${(idp.address() as any).port}`, clientId: 'x', clientSecret: 'x' } });

describe('signing in, from start to finish', () => {
  let s: Awaited<ReturnType<typeof boot>>, cookie = '';
  const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(s.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  before(async () => { s = await boot({ mode: 'local', secureCookie: false }); });
  after(() => { s.proc.kill(); });

  test('the setup code is needed, works once, and a password must be right', async () => {
    const code = s.log().match(/setup code:\s+(\S+)/)?.[1];
    assert.ok(code, 'printed a setup code');
    assert.equal((await post('/api/auth/setup', { code: 'wrong', name: 'me', password: 'correct horse' })).status, 401);
    assert.equal((await post('/api/auth/setup', { code, name: 'me', password: 'correct horse' })).status, 200);
    assert.equal((await post('/api/auth/setup', { code, name: 'evil', password: 'correct horse' })).status, 409);
    assert.equal((await post('/api/auth/login', { name: 'me', password: 'wrong' })).status, 401);
    const ok = await post('/api/auth/login', { name: 'me', password: 'correct horse' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(ok.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
    cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0];
  });

  test('a session opens the page, and never the secret', async () => {
    const r = await fetch(`${s.base}/api/page`, { headers: { cookie } }), text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(text.includes(TITLE), 'the marker is there to be found, so its absence elsewhere means something');
    assert.ok(!text.includes(SECRET));
  });

  test('another site can\'t act with your session', async () => {
    for (const Origin of ['https://evil.example', 'null']) assert.equal((await post('/api/action/probe/x', {}, { cookie, Origin })).status, 403, Origin);
  });

  test('signing out ends the session', async () => {
    await post('/api/auth/logout', { everywhere: true }, { cookie });
    assert.equal((await fetch(`${s.base}/api/page`, { headers: { cookie } })).status, 401);
  });

  test('passwords are stored hashed', async () => {
    const users = await readFile(join(s.dir, 'users.json'), 'utf8');
    assert.ok(!users.includes('correct horse'));
  });
});

describe('no sign-in, network not trusted', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  before(async () => { s = await boot({ mode: 'none' }); });
  after(() => { s.proc.kill(); });
  test('it can be looked at, not used', async () => {
    const page = await fetch(`${s.base}/api/page`);
    assert.equal(page.status, 200);
    const text = await page.text();
    assert.ok(text.includes(TITLE)); assert.ok(!text.includes(SECRET));
    assert.match(await raw(s.port, '/api/page'), new RegExp(TITLE), 'raw requests really reach the server');
    assert.equal((await fetch(`${s.base}/api/action/probe/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  });
});

describe('the approval card\'s route, on a page that can\'t act', () => {
  let s: Awaited<ReturnType<typeof boot>>, seen: string[] = [];
  const svc = createHttp((q, r) => { seen.push(String(q.url)); r.setHeader('content-type', 'application/json'); r.end('{"title":"ADMIN-ONLY"}'); });
  before(async () => {
    await new Promise<void>(ok => svc.listen(0, '127.0.0.1', ok));
    s = await boot({ mode: 'none' }, `  cd: { type: changedetection, url: "http://127.0.0.1:${(svc.address() as any).port}", key: "\${PROBE_KEY}" }\n`);
  });
  after(() => { s.proc.kill(); svc.close(); });
  test('it can\'t reach a service, whatever is passed as input', async () => {
    seen = [];
    const r = await fetch(`${s.base}/api/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'cd__watch_remove', input: { id: '../watch?recheck_all=1&x=' } }) });
    assert.doesNotMatch(await r.text(), /ADMIN-ONLY/);
    assert.deepEqual(seen.filter(u => u.includes('recheck')), []);
  });
});

describe('a pin can\'t show what the assistant is barred from', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  before(async () => { s = await boot({ mode: 'none', trustNetwork: true }, '', '{ default: read, probe: none }'); });
  after(() => { s.proc.kill(); });
  test('a card of several widgets is checked widget by widget', async () => {
    const pin = (widgets: string[]) => fetch(`${s.base}/api/pins`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'show', input: { widgets } }) });
    assert.equal((await pin(['probe.data'])).status, 403);
    assert.equal((await pin(['valet.activity', 'probe.data'])).status, 403);
  });
});

describe('a proxy is believed only from its own address', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  before(async () => { s = await boot({ mode: 'proxy', proxy: { header: 'Remote-User', trusted: ['127.0.0.1'] } }); });
  after(() => { s.proc.kill(); });
  test('from the trusted address the header counts', async () => {
    assert.equal((await fetch(`${s.base}/api/page`, { headers: { 'Remote-User': 'me' } })).status, 200);
    assert.equal((await fetch(`${s.base}/api/page`)).status, 401);
  });
});

describe('the read-only MCP server', () => {
  const TOKEN = 'mcp-token-0123456789abcdef0123456789';
  let s: Awaited<ReturnType<typeof boot>>;
  before(async () => { s = await boot({ mode: 'local', secureCookie: false }, `mcpServer: { token: "${TOKEN}", access: { default: read, probe: read } }\n`); });
  after(() => { s.proc.kill(); });
  const rpc = (body: unknown, token = TOKEN) => fetch(`${s.base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  test('no token, a wrong one, or GET: nothing but 401', async () => {
    for (const r of [await fetch(`${s.base}/mcp`, { method: 'POST', body: '{}' }), await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `${TOKEN}x`), await fetch(`${s.base}/mcp`)]) {
      assert.equal(r.status, 401); clean('/mcp refused', await r.text());
    }
  });

  test('it offers only tools that look, never the config, and its answers keep secrets out', async () => {
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json();
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const { result } = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.ok(result.tools.length > 0, 'something to look at');
    for (const t of result.tools) {
      assert.equal(t.annotations.readOnlyHint, true);
      assert.doesNotMatch(t.name, /^config__/, `${t.name} reads the config file`);
      assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/);
    }
    for (const t of result.tools.slice(0, 6)) {
      const text = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: t.name, arguments: {} } })).text();
      assert.ok(!text.includes(SECRET), `${t.name} leaked the secret`);
    }
    const nope = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'config__config_apply', arguments: {} } })).json();
    assert.ok(nope.error, 'a tool it never offered can\'t be called');
  });
});

describe('a paired wall display reads the wall and nothing else', () => {
  const KEY = 'wall-key-0123456789abcdef0123456789abcdef';
  let s: Awaited<ReturnType<typeof boot>>, cookie = '';
  // a second integration that is on the main page only: the wall must never name or read it
  before(async () => { s = await boot({ mode: 'local', secureCookie: false }, `  hidden: { type: api, url: "http://127.0.0.1:9/y", stats: [{ label: Hidden, value: a }] }
wall:
  token: "\${WALL_KEY}"
  pages: [{ title: Hall, layout: [{ widgets: [probe.data] }] }]
`, undefined, { WALL_KEY: KEY }); });
  after(() => { s.proc.kill(); });
  const pair = (key: unknown, headers: Record<string, string> = {}) => fetch(`${s.base}/api/auth/wall`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ key }) });

  test('a wrong key, a forged cookie or none at all: nothing', async () => {
    for (const k of ['nope', `${KEY}x`, '', 42]) assert.equal((await pair(k)).status, 401, String(k));
    for (const c of ['valet_wall=x', `valet_wall=${'A'.repeat(43)}`, `valet_wall=${KEY}`]) {
      assert.equal((await fetch(`${s.base}/api/auth/wall`, { headers: { cookie: c } })).status, 401, c);
      assert.equal((await fetch(`${s.base}/api/page`, { headers: { cookie: c } })).status, 401, c);
    }
  });

  test('the right key pairs, from this page\'s origin only', async () => {
    assert.equal((await pair(KEY, { Origin: 'https://evil.example' })).status, 403);
    const r = await pair(KEY);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(r.headers.get('set-cookie') ?? '', /SameSite=Strict/i);
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal((await fetch(`${s.base}/api/auth/wall`, { headers: { cookie } })).status, 200);
  });

  test('it reads the wall\'s page: no title, no assistant, no token, no other card', async () => {
    const r = await fetch(`${s.base}/api/page`, { headers: { cookie } }), text = await r.text(), page = JSON.parse(text);
    assert.equal(r.status, 200);
    clean('the paired page', text);
    assert.ok(!text.includes(KEY), 'the token stays on the server');
    assert.doesNotMatch(text, /hidden/, 'a card that isn\'t on the wall isn\'t named');
    assert.equal(page.canAct, false); assert.equal(page.assistant, undefined);
    assert.deepEqual(page.wall.pages[0].sections[0].widgets, ['probe.data']);
  });

  test('its live updates carry the wall\'s cards and no notices', async () => {
    const ac = new AbortController(), r = await fetch(`${s.base}/api/events`, { headers: { cookie }, signal: ac.signal });
    assert.equal(r.status, 200);
    const reader = r.body!.getReader(); let text = '';
    const until = Date.now() + 2500;
    while (Date.now() < until && !text.includes('probe.data')) { const { value } = await Promise.race([reader.read(), new Promise<any>(ok => setTimeout(() => ok({ value: undefined }), 300))]); if (value) text += new TextDecoder().decode(value); }
    ac.abort();
    clean('the paired stream', text);
    assert.doesNotMatch(text, /hidden\./);
    assert.doesNotMatch(text, /event: notice/);
  });

  test('everything else refuses it, and it is not a session', async () => {
    const list = await routes();
    for (const r of list) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key) || IN_AUTH.test(r.path) || key === 'GET /api/page' || key === 'GET /api/events' || key === 'GET /api/image/:inst') continue;   // pictures: below
      const res = await fetch(s.base + fill(r.path), { method: r.method, headers: r.method === 'GET' ? { cookie } : { cookie, 'Content-Type': 'application/json' }, body: r.method === 'GET' ? undefined : '{}' });
      const text = await res.text();
      assert.equal(res.status, 401, `${key} answered ${res.status} to a paired wall: ${text.slice(0, 120)}`);
      clean(key, text);
    }
    assert.equal((await fetch(`${s.base}/api/image/probe?ref=anything`, { headers: { cookie } })).status, 401, 'only pictures its cards show');
    assert.equal((await fetch(`${s.base}/api/image/hidden?ref=x`, { headers: { cookie } })).status, 401);
    assert.equal((await fetch(`${s.base}/api/auth/me`, { headers: { cookie } })).status, 401);
  });

  test('wrong keys slow down', async () => {
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await pair('wrong', { 'X-Forwarded-For': '1.2.3.4' })).status;
    assert.equal(last, 429);
  });
});
