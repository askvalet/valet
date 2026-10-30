// OpenID Connect against a made-up provider on localhost: discovery, the redirect, the code exchange with PKCE, the
// ID token's signature and claims, and the allow list.
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

process.env.ATRIUM_DATA = await mkdtemp(join(tmpdir(), 'atrium-oidc-'));
const { setupAuth } = await import('../src/server/auth.ts');
const { Config } = await import('../src/server/config.ts');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const idToken = (claims: object) => {
  const body = `${b64(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64(JSON.stringify(claims))}`;
  return `${body}.${createSign('sha256').update(body).sign(privateKey, 'base64url')}`;
};

// the provider: remembers the nonce and PKCE challenge the authorize call carried, checks the verifier on exchange
const provider = new Hono();
let issuer = '', seen: { nonce: string; challenge: string; code: string } | undefined, who = 'alice', tokenCalls = 0;
provider.get('/.well-known/openid-configuration', c => c.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
provider.get('/jwks', c => c.json({ keys: [jwk] }));
provider.get('/authorize', c => {
  seen = { nonce: c.req.query('nonce')!, challenge: c.req.query('code_challenge')!, code: randomBytes(8).toString('hex') };
  return c.redirect(`${c.req.query('redirect_uri')}?code=${seen.code}&state=${c.req.query('state')}`);
});
provider.post('/token', async c => {
  tokenCalls++;
  const f = await c.req.parseBody();
  if (f.code !== seen?.code || b64(createHash('sha256').update(String(f.code_verifier)).digest()) !== seen.challenge) return c.json({ error: 'invalid_grant' }, 400);
  const auth = Buffer.from(c.req.header('authorization')!.slice(6), 'base64').toString();
  if (auth !== 'atrium:s3cret') return c.json({ error: 'invalid_client' }, 401);
  const now = Math.floor(Date.now() / 1000);
  return c.json({ id_token: idToken({ iss: issuer, aud: 'atrium', sub: '1', preferred_username: who, email: `${who}@example.com`, nonce: seen.nonce, iat: now, exp: now + 300 }) });
});
const server = serve({ fetch: provider.fetch, port: 0, hostname: '127.0.0.1' });
await new Promise(r => server.once('listening', r));
issuer = `http://127.0.0.1:${(server.address() as any).port}`;

const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

test('oidc: start → provider → callback signs in; a wrong state, a stranger and no cookie are refused', async () => {
  const app = new Hono();
  const guard = await setupAuth(app, Config.parse({ auth: { mode: 'oidc', secureCookie: false, oidc: { issuer, clientId: 'atrium', clientSecret: 's3cret', allow: ['alice'] } } }));
  app.use('/api/*', guard);
  app.get('/api/x', c => c.text('ok'));
  const me = await app.request('/api/auth/me');
  assert.equal(me.status, 401);
  assert.equal((await me.json() as any).provider, 'SSO');

  const start = await app.request('/api/auth/oidc/start?to=/%23gallery', { headers: { host: 'atrium.test' } });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location')!);
  assert.equal(to.origin + to.pathname, `${issuer}/authorize`);
  assert.equal(to.searchParams.get('redirect_uri'), 'http://atrium.test/api/auth/oidc/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const flow = cookies(start);

  // the provider sends the person back with a code
  const back = await provider.request(to.toString());
  const cb = new URL(back.headers.get('location')!);
  assert.equal(cb.origin + cb.pathname, 'http://atrium.test/api/auth/oidc/callback');

  // without the flow cookie, nothing doing; with a wrong state, nothing doing
  assert.equal((await app.request(cb.pathname + cb.search, { headers: { host: 'atrium.test' } })).status, 400);
  assert.equal((await app.request(`${cb.pathname}?code=${cb.searchParams.get('code')}&state=nope`, { headers: { host: 'atrium.test', cookie: flow } })).status, 400);

  const done = await app.request(cb.pathname + cb.search, { headers: { host: 'atrium.test', cookie: flow } });
  assert.equal(done.status, 302, await done.text());
  assert.equal(done.headers.get('location'), '/#gallery');
  const session = cookies(done).split('; ').find(c => c.startsWith('atrium_session='))!;
  assert.ok(session);
  assert.equal((await app.request('/api/x', { headers: { cookie: session } })).status, 200);
  assert.deepEqual((await (await app.request('/api/auth/me', { headers: { cookie: session } })).json() as any).user, { name: 'alice' });

  // a second person the allow list doesn't name
  who = 'mallory';
  const s2 = await app.request('/api/auth/oidc/start', { headers: { host: 'atrium.test' } });
  const cb2 = new URL((await provider.request(s2.headers.get('location')!)).headers.get('location')!);
  const refused = await app.request(cb2.pathname + cb2.search, { headers: { host: 'atrium.test', cookie: cookies(s2) } });
  assert.equal(refused.status, 403);
  assert.match(await refused.text(), /mallory isn't on the allow list/);
  assert.equal(tokenCalls, 2);
  server.close();
});

test('oidc: ID tokens with a bad signature, wrong audience or expiry are refused', async () => {
  const { verifyIdToken } = await import('../src/server/oidc.ts');
  const keys = async () => [jwk];
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://idp', aud: 'atrium', exp: now + 60, sub: '1' };
  assert.equal((await verifyIdToken(idToken(good), 'https://idp/', 'atrium', keys)).sub, '1');
  await assert.rejects(verifyIdToken(idToken({ ...good, aud: 'other' }), 'https://idp', 'atrium', keys), /audience/);
  await assert.rejects(verifyIdToken(idToken({ ...good, exp: now - 600 }), 'https://idp', 'atrium', keys), /expired/);
  await assert.rejects(verifyIdToken(idToken({ ...good, iss: 'https://evil' }), 'https://idp', 'atrium', keys), /issuer/);
  const t = idToken(good), forged = t.slice(0, -4) + 'AAAA';
  await assert.rejects(verifyIdToken(forged, 'https://idp', 'atrium', keys), /signature/);
});
