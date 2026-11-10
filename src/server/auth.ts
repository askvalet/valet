// Sign-in. Valet can read your documents and switch your lights, so every API route needs a signed-in person.
//
// local (default): accounts in data/users.json, passwords hashed with scrypt; a session is an HttpOnly cookie
//   carrying the user, an expiry and the user's session version, signed with a secret kept in data/secret. Bumping
//   the version signs that user out everywhere. The first account needs a one-time setup code that's printed in the
//   server log, so whoever reaches a fresh install first can't claim it.
// proxy: an identity-aware proxy in front (Authelia, Authentik, Tailscale serve…) already signed the person in; trust
//   its user header, but only from the proxy addresses you list.
// oidc: sign in with an OpenID Connect provider (Authelia, Authentik, Keycloak, Pocket ID…); see oidc.ts.
// none: no sign-in at all (only for a page that nothing but you can reach).
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from './config.ts';
import { sandbox } from './sandbox.ts';
import { forgetUser } from './webpush.ts';
import { noOwner, profileOf } from './people.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
// OWASP's floor for scrypt is N=2^17,r=8,p=1 or the same work as N=2^15,r=8,p=3, which needs a quarter of the memory
// (a sign-in shouldn't take 128 MB from a small container). Hashes made before keep their `p` and are redone at sign-in.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 2 ** 20 };
const COOKIE = 'valet_session';
const DATA = resolve(process.env.VALET_DATA ?? 'data');
const USERS = resolve(DATA, 'users.json'), SECRET = resolve(DATA, 'secret');

interface User { name: string; hash: string; salt: string; version: number; created: string; p?: number }

async function hash(password: string, salt = randomBytes(16)) {
  return { salt: salt.toString('base64'), hash: (await scrypt(password, salt, 32, SCRYPT)).toString('base64'), p: SCRYPT.p };
}
async function verify(u: User, password: string) {
  const h = await scrypt(password, Buffer.from(u.salt, 'base64'), 32, { ...SCRYPT, p: u.p ?? 1 });
  return timingSafeEqual(h, Buffer.from(u.hash, 'base64'));
}
async function load(): Promise<User[]> { return JSON.parse(await readFile(USERS, 'utf8').catch(() => '[]')); }
async function save(users: User[]) {
  await mkdir(dirname(USERS), { recursive: true });
  const tmp = `${USERS}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  await rename(tmp, USERS);
}
async function secret() {
  const s = await readFile(SECRET).catch(() => null);
  if (s?.length) return s;
  const fresh = randomBytes(32);
  if (sandbox.on) return fresh;
  await mkdir(DATA, { recursive: true });
  await writeFile(SECRET, fresh, { mode: 0o600 });
  return fresh;
}
const validName = (n: string) => /^[a-zA-Z0-9._-]{1,32}$/.test(n);

/** The local accounts, by name. */
export const accounts = async () => (await load()).map(u => u.name);

/** `node dist/server.js user list`: every account and what it is, an owner or its profile. `users` in the config may
 *  name people who have no local account (they sign in through a proxy or OpenID Connect): those are listed too. */
async function listUsers(config: Config) {
  const local = await load(), named = Object.keys(config.users).filter(n => !local.some(u => u.name.toLowerCase() === n.trim().toLowerCase()));
  const what = (n: string) => { const p = profileOf(config, n); return p === undefined ? 'owner' : Object.hasOwn(config.profiles, p) ? `profile: ${p}` : `profile: ${p} (not in profiles: sees nothing)`; };
  if (!local.length && !named.length) console.log(config.auth.mode === 'local' ? 'no accounts yet: node dist/server.js user add <name>' : `no local accounts (auth.mode is ${config.auth.mode}), and users names nobody`);
  const wide = Math.max(4, ...[...local.map(u => u.name), ...named].map(n => n.length));
  for (const u of local) console.log(`${u.name.padEnd(wide)}  ${what(u.name)}`);
  for (const n of named) console.log(`${n.padEnd(wide)}  ${what(n)}  (in users; ${config.auth.mode === 'local' ? 'no account yet' : `signs in through ${config.auth.mode === 'none' ? 'nothing: auth.mode is none' : config.auth.mode}`})`);
  const no = noOwner(config, local.map(u => u.name));
  if (no) console.log(`\n${no}`);
  return 0;
}

/** `node dist/server.js user add|passwd|remove|signout <name>` (asks for the password on the terminal), and `user list` */
export async function userCommand(args: string[], config?: () => Config | Promise<Config>) {
  const [cmd, name] = args;
  if (cmd === 'list' && config) return listUsers(await config());
  if (!cmd || !name || !validName(name)) { console.log('usage: user list | user add|passwd|remove|signout <name>'); return 1; }
  const users = await load(), u = users.find(x => x.name === name);
  const ask = async () => {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const pw = await rl.question('New password (8+ characters): ');
    rl.close();
    if (pw.length < 8) throw new Error('password too short');
    return pw;
  };
  if (cmd === 'add') { if (u) throw new Error(`${name} exists`); users.push({ name, ...(await hash(await ask())), version: 1, created: new Date().toISOString() }); }
  else if (!u) throw new Error(`no user ${name}`);
  else if (cmd === 'passwd') Object.assign(u, await hash(await ask()), { version: u.version + 1 });
  else if (cmd === 'signout') u.version++;
  else if (cmd === 'remove') users.splice(users.indexOf(u), 1);
  else { console.log('usage: user list | user add|passwd|remove|signout <name>'); return 1; }
  await save(users);
  console.log(`${cmd}: ${name} done`);
  return 0;
}

export async function setupAuth(app: Hono, config: Config): Promise<MiddlewareHandler> {
  const mode = config.auth.mode;
  if (mode === 'none') {
    console.log(config.auth.trustNetwork ? 'auth: off, network trusted (auth.trustNetwork): anyone who can reach this page can use its controls' : 'auth: off; read-only until you set auth.mode (or auth.trustNetwork for a private network)');
    app.get('/api/auth/me', c => c.json({ mode, user: { name: 'you' } }));
    return async (_c, next) => next();
  }

  if (mode === 'proxy') {
    const header = config.auth.proxy.header.toLowerCase(), trusted = new Set(config.auth.proxy.trusted);
    const who = (c: Context) => {
      const ip = getConnInfo(c).remote.address ?? '';
      return trusted.has(ip.replace(/^::ffff:/, '')) ? c.req.header(header) ?? null : null;
    };
    app.get('/api/auth/me', c => { const u = who(c); return u ? c.json({ mode, user: { name: u } }) : c.json({ mode, user: null }, 401); });
    return async (c, next) => { const u = who(c); if (!u) return c.json({ error: 'not signed in' }, 401); (c.set as any)('user', u); return next(); };
  }

  // ── a session cookie signed with a secret kept in data/secret, for local accounts and OIDC alike
  const key = await secret();
  // a purpose in every signature, so nothing signed for one job can pass for another (a sign-in in progress isn't a session)
  const signFor = (purpose: string) => (body: string) => createHmac('sha256', key).update(`${purpose}\0${body}`).digest('base64url');
  const sign = signFor('session');
  const secure = config.auth.secureCookie;
  const parse = (c: Context) => {
    const raw = getCookie(c, COOKIE); if (!raw) return null;
    const [body, mac] = raw.split('.');
    const given = Buffer.from(mac ?? ''), real = Buffer.from(sign(body ?? ''));   // bytes, not characters: timingSafeEqual throws on a mismatch
    if (!body || given.length !== real.length || !timingSafeEqual(given, real)) return null;
    const parts = Buffer.from(body, 'base64url').toString().split('|'), [name, version, exp] = parts;
    if (parts.length !== 3 || !name || !Number.isFinite(Number(version)) || !Number.isFinite(Number(exp))) return null;
    return Date.now() > Number(exp) ? null : { name, version: Number(version) };
  };
  function start(c: Context, name: string, version: number, remember: boolean) {
    const days = remember ? config.auth.sessionDays : 1;
    const body = Buffer.from(`${name}|${version}|${Date.now() + days * 864e5}`).toString('base64url');
    setCookie(c, COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: remember ? days * 86400 : undefined });
  }

  if (mode === 'oidc') {
    const session = (c: Context) => parse(c)?.name ?? null;
    app.get('/api/auth/me', c => { const u = session(c); return u ? c.json({ mode, user: { name: u } }) : c.json({ mode, user: null, provider: config.auth.oidc!.name }, 401); });
    app.post('/api/auth/logout', c => { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ ok: true }); });
    const { setupOidc } = await import('./oidc.ts');
    setupOidc(app, config, signFor('oidc-flow'), (c, name) => start(c, name, 1, true));
    console.log(`auth: OpenID Connect via ${config.auth.oidc!.issuer}`);
    return async (c, next) => { const u = session(c); if (!u) return c.json({ error: 'not signed in' }, 401); (c.set as any)('user', u); return next(); };
  }

  // ── local accounts
  let users = await load();
  // a fresh install: print a one-time code the first account must present
  let setupCode = users.length ? null : randomBytes(6).toString('hex').match(/.{4}/g)!.join('-');
  if (setupCode) console.log(`\n  auth: no accounts yet. Open the page and create one with this setup code:  ${setupCode}\n  (or: node dist/server.js user add <name>)\n`);

  async function session(c: Context) {
    const s = parse(c); if (!s) return null;
    const u = users.find(x => x.name === s.name);
    return u && u.version === s.version ? u : null;
  }

  // failed sign-ins slow down per address: 5 free, then a growing wait (up to 15 minutes)
  const fails = new Map<string, { n: number; until: number }>();
  // behind a trusted reverse proxy the client is in X-Forwarded-For, not the socket (or one attacker would lock
  // everyone out). Read it from the right: proxies append, so the leftmost hops are whatever the client sent.
  const trusted = new Set(config.auth.proxy.trusted);
  const ipOf = (c: Context) => clientIp((getConnInfo(c).remote.address ?? '?').replace(/^::ffff:/, ''), c.req.header('x-forwarded-for'), trusted);
  const throttled = (ip: string) => { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
  const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  // tries still being hashed count too: scrypt is slow, and a burst shouldn't all slip in before the first failure lands
  const pending = new Map<string, number>(), hold = (k: string, d: number) => { const n = (pending.get(k) ?? 0) + d; if (n > 0) pending.set(k, n); else pending.delete(k); };
  const failed = (ip: string) => {
    if (fails.size > 5000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);   // stays bounded
    const f = fails.get(ip) ?? { n: 0, until: 0 }; f.n++;
    if (f.n > 5) f.until = Date.now() + Math.min(900_000, 2 ** (f.n - 5) * 1000);
    fails.set(ip, f);
  };

  app.get('/api/auth/me', async c => {
    const u = await session(c);
    return u ? c.json({ mode, user: { name: u.name } }) : c.json({ mode, user: null, setup: !!setupCode }, 401);
  });
  app.post('/api/auth/login', async c => {
    const ip = ipOf(c);
    const { name, password, remember } = await c.req.json().catch(() => ({}));
    const who = `user:${String(name ?? '').slice(0, 32)}`, wait = Math.max(throttled(ip), throttled(who));
    if (wait) return c.json({ error: `Too many tries. Wait ${wait}s.` }, 429);
    if ((pending.get(ip) ?? 0) >= 5 || (pending.get(who) ?? 0) >= 5) return c.json({ error: 'Too many tries. Wait a moment.' }, 429);
    const u = users.find(x => x.name === String(name ?? ''));
    // check a hash even for unknown names, so timing doesn't reveal which names exist
    hold(ip, 1); hold(who, 1);
    const ok = await (u ? verify(u, String(password ?? '')) : hash(String(password ?? '')).then(() => false)).finally(() => { hold(ip, -1); hold(who, -1); });
    if (!ok) { failed(ip); failed(who); console.warn(`auth: failed sign-in for ${JSON.stringify(String(name ?? '').slice(0, 32))} from ${ip}`); return c.json({ error: 'That name and password don\'t match.' }, 401); }
    fails.delete(ip); fails.delete(who);
    console.log(`auth: ${u!.name} signed in from ${ip}`);
    if ((u!.p ?? 1) < SCRYPT.p) { Object.assign(u!, await hash(String(password))); await save(users); }   // a stronger hash, now that the password is at hand
    start(c, u!.name, u!.version, remember !== false);
    return c.json({ user: { name: u!.name } });
  });
  app.post('/api/auth/setup', async c => {
    const ip = ipOf(c), wait = throttled(ip);
    if (wait) return c.json({ error: `Too many tries. Wait ${wait}s.` }, 429);
    if (!setupCode) return c.json({ error: 'Already set up.' }, 409);
    const { code, name, password } = await c.req.json().catch(() => ({}));
    if (!same(String(code ?? '').trim().toLowerCase(), setupCode)) { failed(ip); console.warn(`auth: wrong setup code from ${ip}`); return c.json({ error: 'That setup code isn\'t right. It\'s in the server log.' }, 401); }
    if (!validName(String(name ?? ''))) return c.json({ error: 'Pick a name: letters, numbers, . _ -' }, 400);
    if (String(password ?? '').length < 8) return c.json({ error: 'Use at least 8 characters.' }, 400);
    const u: User = { name, ...(await hash(password)), version: 1, created: new Date().toISOString() };
    users = [u]; await save(users); setupCode = null;
    start(c, u.name, u.version, true);
    return c.json({ user: { name } });
  });
  app.post('/api/auth/logout', async c => {
    const { everywhere } = await c.req.json().catch(() => ({}));
    const u = await session(c);
    if (u && everywhere) { u.version++; await save(users); await forgetUser(u.name).catch(() => {}); }   // and its devices stop hearing
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
  app.post('/api/auth/password', async c => {
    const u = await session(c); if (!u) return c.json({ error: 'not signed in' }, 401);
    const { current, next: pw } = await c.req.json().catch(() => ({}));
    if (!(await verify(u, String(current ?? '')))) return c.json({ error: 'Current password is wrong.' }, 401);
    if (String(pw ?? '').length < 8) return c.json({ error: 'Use at least 8 characters.' }, 400);
    Object.assign(u, await hash(pw), { version: u.version + 1 }); await save(users);
    start(c, u.name, u.version, true);   // this browser stays signed in; every other one is signed out
    return c.json({ ok: true });
  });

  return async (c, next) => { const u = await session(c); if (!u) return c.json({ error: 'not signed in' }, 401); (c.set as any)('user', u.name); return next(); };
}

// ── a paired wall display (wall.token, or a screen's own): a screen that can't sign in, holding a cookie that reads the
// wall's cards, presses what `wall.touch` lists, and nothing else (main.ts holds it to that). The cookie is a signature
// over the token, so a new token unpairs every screen it paired. `paired` gives the token a request's cookie stands for.
const PAIRED = 'valet_wall';
export async function setupWall(app: Hono, config: Config, tokens: () => string[]) {
  const key = await secret();
  const digest = (t: string) => createHmac('sha256', key).update(`wall\0${createHash('sha256').update(t).digest('base64url')}`).digest('base64url');
  const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  const paired = (c: Context) => { const raw = getCookie(c, PAIRED); return raw && !sandbox.on ? tokens().find(t => same(raw, digest(t))) : undefined; };
  // a wrong key slows down per address, as a wrong password does
  const trusted = new Set(config.auth.proxy.trusted), fails = new Map<string, { n: number; until: number }>();
  const ipOf = (c: Context) => clientIp((getConnInfo(c).remote.address ?? '?').replace(/^::ffff:/, ''), c.req.header('x-forwarded-for'), trusted);
  app.get('/api/auth/wall', c => paired(c) ? c.json({ paired: true }) : c.json({ paired: false }, 401));
  app.post('/api/auth/wall', async c => {
    const ip = ipOf(c), f = fails.get(ip);
    if (f && f.until > Date.now()) return c.json({ error: `Too many tries. Wait ${Math.ceil((f.until - Date.now()) / 1000)}s.` }, 429);
    const { key: given } = await c.req.json().catch(() => ({}));
    const hash = (v: unknown) => createHash('sha256').update(String(v ?? '')).digest('base64url');   // equal lengths, so the compare is constant-time
    const t = sandbox.on || typeof given !== 'string' ? undefined : tokens().find(t => same(hash(given), hash(t)));
    if (!t) {
      if (fails.size > 5000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);
      const n = (f?.n ?? 0) + 1; fails.set(ip, { n, until: n > 5 ? Date.now() + Math.min(900_000, 2 ** (n - 5) * 1000) : 0 });
      console.warn(`auth: wrong wall key from ${ip}`);
      return c.json({ error: 'That wall key isn\'t right.' }, 401);
    }
    fails.delete(ip);
    console.log(`auth: a wall display was paired from ${ip}`);
    // a year (browsers cap a cookie's life near there); Strict, since a wall never arrives from another site's link
    setCookie(c, PAIRED, digest(t), { httpOnly: true, sameSite: 'Strict', secure: config.auth.secureCookie, path: '/', maxAge: 365 * 86400 });
    return c.json({ paired: true });
  });
  return paired;
}

/** The client's address: the socket, or behind trusted proxies the rightmost X-Forwarded-For hop that isn't one. */
export function clientIp(sock: string, xff: string | undefined, trusted: Set<string>) {
  if (!trusted.has(sock) || !xff) return sock;
  const hops = xff.split(',').map(h => h.trim().replace(/^::ffff:/, '')).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted.has(hops[i])) return hops[i];
  return hops[0] ?? sock;
}

/** Requests that change something must come from this page: a browser on another site can't forge the Origin. */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const origin = c.req.header('origin'), host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  if (origin && host && URL.parse(origin)?.host !== host) return c.json({ error: 'cross-site request refused' }, 403);   // a browser's opaque `Origin: null` parses to nothing
  return next();
};
