// Sign-in. Atrium can read your documents and switch your lights, so every API route needs a signed-in person.
//
// local (default): accounts in data/users.json, passwords hashed with scrypt; a session is an HttpOnly cookie
//   carrying the user, an expiry and the user's session version, signed with a secret kept in data/secret. Bumping
//   the version signs that user out everywhere. The first account needs a one-time setup code that's printed in the
//   server log, so whoever reaches a fresh install first can't claim it.
// proxy: an identity-aware proxy in front (Authelia, Authentik, Tailscale serve…) already signed the person in; trust
//   its user header, but only from the proxy addresses you list.
// none: no sign-in at all (only for a page that nothing but you can reach).
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from './config.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 2 ** 20 };
const COOKIE = 'atrium_session';
const DATA = resolve(process.env.ATRIUM_DATA ?? 'data');
const USERS = resolve(DATA, 'users.json'), SECRET = resolve(DATA, 'secret');

interface User { name: string; hash: string; salt: string; version: number; created: string }

async function hash(password: string, salt = randomBytes(16)) {
  return { salt: salt.toString('base64'), hash: (await scrypt(password, salt, 32, SCRYPT)).toString('base64') };
}
async function verify(u: User, password: string) {
  const h = await scrypt(password, Buffer.from(u.salt, 'base64'), 32, SCRYPT);
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
  await mkdir(DATA, { recursive: true });
  await writeFile(SECRET, fresh, { mode: 0o600 });
  return fresh;
}
const validName = (n: string) => /^[a-zA-Z0-9._-]{1,32}$/.test(n);

/** `node dist/server.js user add|passwd|remove|signout <name>` (asks for the password on the terminal) */
export async function userCommand(args: string[]) {
  const [cmd, name] = args;
  if (!cmd || !name || !validName(name)) { console.log('usage: user add|passwd|remove|signout <name>'); return 1; }
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
  else { console.log('usage: user add|passwd|remove|signout <name>'); return 1; }
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
    return async (c, next) => (who(c) ? next() : c.json({ error: 'not signed in' }, 401));
  }

  // ── local accounts
  const key = await secret();
  const sign = (body: string) => createHmac('sha256', key).update(body).digest('base64url');
  const secure = config.auth.secureCookie;
  let users = await load();
  // a fresh install: print a one-time code the first account must present
  let setupCode = users.length ? null : randomBytes(6).toString('hex').match(/.{4}/g)!.join('-');
  if (setupCode) console.log(`\n  auth: no accounts yet. Open the page and create one with this setup code:  ${setupCode}\n  (or: node dist/server.js user add <name>)\n`);

  async function session(c: Context) {
    const raw = getCookie(c, COOKIE); if (!raw) return null;
    const [body, mac] = raw.split('.');
    if (!body || !mac || mac.length !== 43 || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(body)))) return null;
    const [name, version, exp] = Buffer.from(body, 'base64url').toString().split('|');
    if (Date.now() > Number(exp)) return null;
    const u = users.find(x => x.name === name);
    return u && u.version === Number(version) ? u : null;
  }
  function start(c: Context, u: User, remember: boolean) {
    const days = remember ? config.auth.sessionDays : 1;
    const body = Buffer.from(`${u.name}|${u.version}|${Date.now() + days * 864e5}`).toString('base64url');
    setCookie(c, COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: remember ? days * 86400 : undefined });
  }

  // failed sign-ins slow down per address: 5 free, then a growing wait (up to 15 minutes)
  const fails = new Map<string, { n: number; until: number }>();
  const ipOf = (c: Context) => (getConnInfo(c).remote.address ?? '?').replace(/^::ffff:/, '');
  const throttled = (ip: string) => { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
  const failed = (ip: string) => {
    const f = fails.get(ip) ?? { n: 0, until: 0 }; f.n++;
    if (f.n > 5) f.until = Date.now() + Math.min(900_000, 2 ** (f.n - 5) * 1000);
    fails.set(ip, f);
  };

  app.get('/api/auth/me', async c => {
    const u = await session(c);
    return u ? c.json({ mode, user: { name: u.name } }) : c.json({ mode, user: null, setup: !!setupCode }, 401);
  });
  app.post('/api/auth/login', async c => {
    const ip = ipOf(c), wait = throttled(ip);
    if (wait) return c.json({ error: `Too many tries. Wait ${wait}s.` }, 429);
    const { name, password, remember } = await c.req.json().catch(() => ({}));
    const u = users.find(x => x.name === String(name ?? ''));
    // check a hash even for unknown names, so timing doesn't reveal which names exist
    const ok = u ? await verify(u, String(password ?? '')) : (await hash(String(password ?? '')), false);
    if (!ok) { failed(ip); return c.json({ error: 'That name and password don\'t match.' }, 401); }
    fails.delete(ip);
    start(c, u!, remember !== false);
    return c.json({ user: { name: u!.name } });
  });
  app.post('/api/auth/setup', async c => {
    const ip = ipOf(c), wait = throttled(ip);
    if (wait) return c.json({ error: `Too many tries. Wait ${wait}s.` }, 429);
    if (!setupCode) return c.json({ error: 'Already set up.' }, 409);
    const { code, name, password } = await c.req.json().catch(() => ({}));
    if (String(code ?? '').trim().toLowerCase() !== setupCode) { failed(ip); return c.json({ error: 'That setup code isn\'t right. It\'s in the server log.' }, 401); }
    if (!validName(String(name ?? ''))) return c.json({ error: 'Pick a name: letters, numbers, . _ -' }, 400);
    if (String(password ?? '').length < 8) return c.json({ error: 'Use at least 8 characters.' }, 400);
    const u: User = { name, ...(await hash(password)), version: 1, created: new Date().toISOString() };
    users = [u]; await save(users); setupCode = null;
    start(c, u, true);
    return c.json({ user: { name } });
  });
  app.post('/api/auth/logout', async c => {
    const { everywhere } = await c.req.json().catch(() => ({}));
    const u = await session(c);
    if (u && everywhere) { u.version++; await save(users); }
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
  app.post('/api/auth/password', async c => {
    const u = await session(c); if (!u) return c.json({ error: 'not signed in' }, 401);
    const { current, next: pw } = await c.req.json().catch(() => ({}));
    if (!(await verify(u, String(current ?? '')))) return c.json({ error: 'Current password is wrong.' }, 401);
    if (String(pw ?? '').length < 8) return c.json({ error: 'Use at least 8 characters.' }, 400);
    Object.assign(u, await hash(pw), { version: u.version + 1 }); await save(users);
    start(c, u, true);   // this browser stays signed in; every other one is signed out
    return c.json({ ok: true });
  });

  return async (c, next) => ((await session(c)) ? next() : c.json({ error: 'not signed in' }, 401));
}

/** Requests that change something must come from this page: a browser on another site can't forge the Origin. */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const origin = c.req.header('origin'), host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  if (origin && host && new URL(origin).host !== host) return c.json({ error: 'cross-site request refused' }, 403);
  return next();
};
