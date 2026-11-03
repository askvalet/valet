// The server as an attacker sees it: the real build, in each sign-in mode, from outside. Every route in the source is
// tried without a session, so a route added later is covered without anyone remembering to. Needs `npm run build`.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

async function boot(auth: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'valet-exposure-')), port = await freePort(), file = join(dir, 'config.yaml');
  await writeFile(file, `title: ${TITLE}
auth: ${JSON.stringify(auth)}
assistant: { model: none, baseURL: "http://127.0.0.1:9/v1", access: { config: control } }
integrations:
  probe: { type: api, url: "http://127.0.0.1:9/x", headers: { Authorization: "Bearer \${PROBE_KEY}" }, stats: [{ label: Up, path: a }] }
layout:
  - widgets: [probe.data]
`);
  let log = '';
  const proc = spawn('node', ['dist/server.js'], { env: { ...process.env, VALET_CONFIG: file, VALET_DATA: dir, PORT: String(port), HOST: '127.0.0.1', PROBE_KEY: SECRET } });
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
      for (const r of list) {
        const key = `${r.method} ${r.path}`;
        if (PUBLIC.has(key) || IN_AUTH.test(r.path)) continue;
        const res = await fetch(s.base + fill(r.path), { method: r.method, headers: r.method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: r.method === 'GET' ? undefined : '{}' });
        const text = await res.text();
        assert.equal(res.status, 401, `${key} answered ${res.status}: ${text.slice(0, 120)}`);
        clean(key, text);
      }
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
everyRoute('OpenID Connect', { mode: 'oidc', oidc: { issuer: 'http://127.0.0.1:9', clientId: 'x', clientSecret: 'x' } });

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

describe('a proxy is believed only from its own address', () => {
  let s: Awaited<ReturnType<typeof boot>>;
  before(async () => { s = await boot({ mode: 'proxy', proxy: { header: 'Remote-User', trusted: ['127.0.0.1'] } }); });
  after(() => { s.proc.kill(); });
  test('from the trusted address the header counts', async () => {
    assert.equal((await fetch(`${s.base}/api/page`, { headers: { 'Remote-User': 'me' } })).status, 200);
    assert.equal((await fetch(`${s.base}/api/page`)).status, 401);
  });
});
