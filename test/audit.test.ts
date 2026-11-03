// Each of these was a real finding in the security audit. They stay here so none of them comes back.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-audit-'));
const { bounded, keptHome } = await import('../src/server/core.ts');
const { redactor, served } = await import('../src/server/security.ts');
const { bindings, guard, refused, setupTools } = await import('../src/server/setup.ts');
const { registry } = await import('../src/integrations/index.ts');
const { parseFeed } = await import('../src/integrations/rss.ts');
const { text } = await import('../src/server/xml.ts');
const { scrub } = await import('../src/server/guide.ts');
const { allowed, backHere, nameOf } = await import('../src/server/oidc.ts');
const { headers } = await import('../src/server/security.ts');

const listen = async (fn: (u: string | undefined, h: Record<string, any>, res: any) => void) => {
  const s = createServer((q, r) => fn(q.url, q.headers, r)); await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok));
  return { s, url: `http://127.0.0.1:${(s.address() as any).port}` };
};
const config = async (text: string) => { const f = join(process.env.VALET_DATA!, `c${Math.random()}.yaml`); await writeFile(f, text); return f; };

const BASE = `title: Home
assistant: { model: m, access: { config: control } }
integrations:
  kuma: { type: api, url: "https://kuma.example/metrics", headers: { Authorization: "Bearer \${KUMA_KEY}" }, stats: [{ label: A, value: a }] }
layout: []
`;
const edit = (from: string, to: string) => guard(BASE, BASE.replace(from, to));

test('a preview contacts nothing and reads no secret into a card', async () => {
  let hits = 0;
  const { s, url } = await listen((_, __, r) => { hits++; r.end('{"a":1}'); });
  process.env.AUDIT_MARKER = 'audit-marker-value';
  const tools = setupTools(await config('title: Home\nintegrations: {}\nlayout: []\n'), registry);
  const ops = [{ op: 'set', path: ['integrations', 'x'], value: { type: 'api', url: `${url}/?v=\${AUDIT_MARKER}`, headers: { Authorization: 'Bearer ${AUDIT_MARKER}' }, stats: [{ label: 'A', value: 'a' }] } }];
  const out = await tools.config_preview.run({ ops, summary: 's' }) as any;
  assert.equal(tools.config_preview.access, 'read'); assert.equal(hits, 0);
  assert.doesNotMatch(JSON.stringify(out), /audit-marker-value/);
  assert.equal(tools.config_try.access, 'write');   // really fetching is a separate step, and it asks
  const said = await tools.config_try.confirm!({ ops, summary: 's' });
  assert.match(said.detail!, /127\.0\.0\.1/); assert.match(said.detail!, /AUDIT_MARKER/);
  s.close();
});

test('a secret only goes where it already goes', () => {
  assert.match(edit('https://kuma.example/metrics', 'https://evil.example/x')!, /KUMA_KEY/);
  assert.equal(edit('https://kuma.example/metrics', 'https://kuma.example/other'), null);       // same host is fine
  const copy = BASE.replace('layout: []', '  other: { type: api, url: "https://evil.example", headers: { A: "${KUMA_KEY}" } }\nlayout: []');
  assert.match(guard(BASE, copy)!, /KUMA_KEY/);
  for (const line of ['title: "${KUMA_KEY}"', 'notice: "${KUMA_KEY}"']) assert.match(guard(BASE, BASE.replace('title: Home', line))!, /outside an integration/);
  assert.match(guard(BASE, `${BASE}appearance: { wallpaper: "https://evil.example/\${KUMA_KEY}.jpg" }\n`)!, /outside an integration/);
  const file = BASE.replace('layout: []', '  f: { type: api, url: "https://a.example", headers: { A: "${file:/etc/passwd}" } }\nlayout: []');
  assert.match(guard(BASE, file)!, /reads a file/);
});

test('owner-only keys are judged on the result, however the edit was phrased', () => {
  assert.match(guard(BASE, BASE.replace('access: { config: control }', 'access: { config: control, default: control }'))!, /assistant/);
  assert.match(guard(BASE, `${BASE}auth: { mode: none, trustNetwork: true }\n`)!, /auth/);
  assert.match(guard(BASE, `${BASE}appearance: { css: "body{}" }\n`)!, /css/);
  assert.equal(guard(BASE, BASE.replace('model: m,', 'model: m, name: Jeeves,')), null);
  assert.ok(refused([{ op: 'set', path: ['appearance', 'css'], value: 'x' }]));
});

test('undo leaves the owner\'s hand edits alone', async () => {
  const file = await config('title: Home\nintegrations: {}\nlayout: []\n'), tools = setupTools(file, registry);
  await tools.config_apply.run({ ops: [{ op: 'set', path: ['title'], value: 'Den' }], summary: 's' });
  await writeFile(file, `${await readFile(file, 'utf8')}auth: { mode: local }\n`);   // edited by hand since
  const out = await tools.config_undo.run({}) as any;
  assert.match(out.data.error, /auth/); assert.match(await readFile(file, 'utf8'), /mode: local/);
});

test('api_sample sends a key only to its own host, follows no redirect, and says so first', async () => {
  const seen: any[] = [];
  const { s, url } = await listen((_, h, r) => { seen.push(h.authorization); r.statusCode = 302; r.setHeader('location', 'https://evil.example/'); r.end(); });
  process.env.KUMA_KEY = 'kuma-secret-value';
  const tools = setupTools(await config(BASE), registry);
  assert.match((await tools.api_sample.run({ url, headers: { Authorization: '${KUMA_KEY}' } }) as any).data.error, /isn't sent/);
  assert.deepEqual(seen, []);
  assert.match((await tools.api_sample.run({ url }) as any).data.error, /redirects/);
  assert.match((await tools.api_sample.confirm!({ url, headers: { Authorization: 'Bearer ${KUMA_KEY}' } })).detail!, /Authorization \(\$\{KUMA_KEY\}\)/);
  s.close();
});

test('the image proxy passes pictures and video and nothing that can act as a page', () => {
  const r = (type: string) => new Response('x', { headers: { 'content-type': type } });
  for (const bad of ['image/svg+xml', 'image/SVG+xml', 'image/x+xml', 'text/html', 'application/pdf', 'image/svg']) assert.equal(served(r(bad)), null, bad);
  for (const ok of ['image/jpeg', 'IMAGE/PNG', 'image/webp; charset=x', 'video/mp4', 'image/x-icon']) assert.ok(served(r(ok)), ok);
  assert.match(served(r('image/png'))!.headers.get('content-security-policy')!, /sandbox/);
});

test('a hostile feed takes no longer than a normal one', () => {
  for (const bomb of ['<'.repeat(4e6), '<![CDATA['.repeat(4e5), '<img '.repeat(8e5), '<item '.repeat(6e5), `<rss><channel><item><description><![CDATA[${'<'.repeat(3e6)}]]></description></item></channel></rss>`]) {
    const t = Date.now(); parseFeed(bomb); text(bomb);
    assert.ok(Date.now() - t < 1500, `${bomb.slice(0, 12)} took ${Date.now() - t} ms`);
  }
  assert.equal(text('a<b>c</b> d'), 'a c d');
  assert.equal(parseFeed('<rss><channel><item><title>T</title><description><![CDATA[<p><img class="x" src="https://a/b.jpg"> hi</p>]]></description></item></channel></rss>')[0].image, 'https://a/b.jpg');
});

test('a reply past the limit is refused, not held in memory', async () => {
  await assert.rejects(bounded(new Response('x'.repeat(2000)), 1000), /too large/);
  await assert.rejects(bounded(new Response('x', { headers: { 'content-length': '999999999' } }), 1000), /too large/);
  assert.equal(await bounded(new Response('héllo')), 'héllo');
});

test('a key stays with its service across a redirect', async () => {
  const seen: Record<string, any> = {};
  const other = await listen((_, h, r) => { seen.other = h['x-api-key']; r.end('ok'); });
  const home = await listen((u, h, r) => { seen.home = h['x-api-key']; if (u === '/same') { r.statusCode = 302; r.setHeader('location', '/end'); return r.end(); } if (u === '/end') return r.end('ok'); r.statusCode = 302; r.setHeader('location', `${other.url}/`); r.end(); });
  assert.equal(await (await keptHome(`${home.url}/away`, { headers: { 'x-api-key': 'k' } })).text(), 'ok');
  assert.equal(seen.home, 'k'); assert.equal(seen.other, undefined);
  seen.home = undefined;
  await keptHome(`${home.url}/same`, { headers: { 'x-api-key': 'k' } });
  assert.equal(seen.home, 'k');   // a redirect within the service keeps it
  other.s.close(); home.s.close();
});

test('redaction reaches secrets that JSON or a URL has changed, and ones added later', () => {
  const list = ['pa"ss\\word123'], redact = redactor(list);
  assert.doesNotMatch(redact(JSON.stringify({ error: 'bad pa"ss\\word123' })), /word123/);
  list.push('another/secret value');
  assert.doesNotMatch(redact(`x?k=${encodeURIComponent(list[1])}`), /secret/);
});

test('issue text can\'t carry an address or a key in any field', () => {
  assert.doesNotMatch(scrub('see http://10.1.2.3 and token=abc123def'), /10\.1\.2\.3|abc123def/);
});

test('signing in only ever lands back on this page', () => {
  for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', '', 5]) assert.equal(backHere(bad), '/', String(bad));
  for (const ok of ['/', '/#gallery', '/a/b?c=1']) assert.equal(backHere(ok), ok);
});

test('an email address only counts once the provider verified it', () => {
  assert.equal(allowed(['boss@corp.example'], 'mallory', { email: 'boss@corp.example', email_verified: false }), false);
  assert.equal(allowed(['boss@corp.example'], 'mallory', { email: 'boss@corp.example' }), false);
  assert.equal(allowed(['boss@corp.example'], 'boss', { email: 'BOSS@corp.example', email_verified: true }), true);
  assert.equal(allowed([], 'anyone', {}), true);
});

test('the page\'s security headers don\'t replace what the image proxy set', async () => {
  const { Hono } = await import('hono');
  const app = new Hono(); app.use(headers);
  app.get('/img', () => served(new Response('x', { headers: { 'content-type': 'image/png' } }))!);
  app.get('/page', c => c.text('x'));
  assert.match((await app.request('/img')).headers.get('content-security-policy')!, /^sandbox/);
  assert.match((await app.request('/page')).headers.get('content-security-policy')!, /script-src 'self'/);
});

test('bindings ignore an escaped reference', () => {
  assert.equal(bindings('integrations: { a: { type: api, url: "https://x", body: "\\\\${NOT_ONE}" } }\n').hosts.size, 0);
});

test('an unverified email can\'t become who signed in, however the name is picked', () => {
  const claims = { sub: 'attacker', email: 'owner@example.test', email_verified: false };
  for (const claim of ['email', 'preferred_username', 'name']) assert.equal(nameOf(claim, claims), 'attacker', claim);
  assert.equal(nameOf('email', { ...claims, email_verified: true }), 'owner@example.test');
  assert.equal(allowed(['owner@example.test'], nameOf('email', claims), claims), false);
});

test('a body never follows a redirect to another host', async () => {
  for (const status of [307, 308]) {
    const seen: any[] = [], real = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => { seen.push({ url: String(url), ...init }); return seen.length === 1 ? new Response(null, { status, headers: { location: 'https://collector.example/receive' } }) : new Response('ok'); }) as any;
    try {
      await assert.rejects(keptHome('https://service.example/login', { method: 'POST', body: new URLSearchParams({ password: 'SYNTHETIC' }) }), /not followed/);
      assert.equal(seen.length, 1);
    } finally { globalThis.fetch = real; }
  }
});

test('an address a card only links to doesn\'t vouch for sending it a key', () => {
  const before = 'integrations:\n  s: { type: api, url: "https://internal.example/m", href: "https://display.example/", headers: { X: "${REVIEW_KEY}" } }\n';
  assert.match(guard(before, before.replace('https://internal.example/m', 'https://display.example/collect'))!, /REVIEW_KEY/);
});

test('saving a config that reaches somewhere new says so on the card', async () => {
  const tools = setupTools(await config('title: Home\nintegrations: {}\nlayout: []\n'), registry);
  const fresh = await tools.config_apply.confirm!({ ops: [{ op: 'set', path: ['appearance', 'wallpaper'], value: 'https://tracker.example/w.jpg' }], summary: 's' });
  assert.match(fresh.detail!, /tracker\.example/); assert.equal(fresh.danger, true);
  const quiet = await tools.config_apply.confirm!({ ops: [{ op: 'set', path: ['title'], value: 'Den' }], summary: 's' });
  assert.equal(quiet.detail, undefined);
});
