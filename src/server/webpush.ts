// Valet's own push notifications: Web Push straight to the browsers that turned it on in ⌘K, with nothing to install.
// The message is encrypted for that one browser (RFC 8291, aes128gcm), so the push service in between (Google's, Apple's,
// Mozilla's, Microsoft's) carries it without reading it, and each request is signed with Valet's own VAPID key (RFC 8292)
// so a subscription only accepts pushes from this server. Node's crypto does all of it; there's no library.
import { createECDH, createHmac, createCipheriv, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const DATA = () => resolve(process.env.VALET_DATA ?? 'data');
const KEYS = () => resolve(DATA(), 'vapid.json'), SUBS = () => resolve(DATA(), 'push.json');
const b64 = (b: Buffer) => b.toString('base64url'), unb64 = (s: string) => Buffer.from(s, 'base64url');

// ── RFC 8291: the payload, encrypted for one browser

const hmac = (key: Buffer, ...data: Buffer[]) => { const h = createHmac('sha256', key); for (const d of data) h.update(d); return h.digest(); };
/** HKDF with a single block of output, which is all Web Push ever needs. */
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) => hmac(hmac(salt, ikm), info, Buffer.from([1])).subarray(0, len);

/** The body of one push: the aes128gcm header (salt, record size, Valet's one-off public key) and a single record.
 *  `local` and `salt` are only given by tests, to check against the RFC's own example. */
export function encrypt(payload: Buffer, ua: { p256dh: string; auth: string }, local?: Buffer, salt = randomBytes(16)) {
  const uaPublic = unb64(ua.p256dh), auth = unb64(ua.auth);
  const ecdh = createECDH('prime256v1');
  if (local) ecdh.setPrivateKey(local); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);   // 2: the last (and only) record
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, body]);
}

// ── RFC 8292: Valet's key, kept in data/vapid.json, made the first time a browser asks for it

interface Vapid { publicKey: string; key: KeyObject }
let vapid: Promise<Vapid> | undefined;
export function vapidKeys(): Promise<Vapid> {
  return vapid ??= (async () => {
    let jwk = await readFile(KEYS(), 'utf8').then(JSON.parse, () => null);
    if (!jwk?.d) {
      jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
      await mkdir(DATA(), { recursive: true });
      await writeFile(KEYS(), JSON.stringify(jwk), { mode: 0o600 });
    }
    return { key: createPrivateKey({ key: jwk, format: 'jwk' }), publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)])) };
  })().catch(e => { vapid = undefined; throw e; });
}
/** The Authorization header for one push service: a JWT for its origin, good for twelve hours. */
export function vapidAuth(endpoint: string, v: Vapid, contact: string, now = Date.now()) {
  const part = (o: object) => b64(Buffer.from(JSON.stringify(o)));
  const body = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact })}`;
  return `vapid t=${body}.${b64(sign('sha256', Buffer.from(body), { key: v.key, dsaEncoding: 'ieee-p1363' }))}, k=${v.publicKey}`;
}

// ── who's subscribed: one entry per browser, and whose it is when there's sign-in

export const Subscription = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+=*$/).refine(s => { const k = unb64(s); return k.length === 65 && k[0] === 4; }, 'not a P-256 key'),
    auth: z.string().regex(/^[A-Za-z0-9_-]+=*$/).refine(s => unb64(s).length === 16, 'not a 16-byte secret'),
  }),
});
export type Subscription = z.infer<typeof Subscription>;
interface Saved extends Subscription { user?: string; at: number }

const MOST = 50;
let subs: Promise<Saved[]> | undefined;
const load = () => subs ??= readFile(SUBS(), 'utf8').then(t => (JSON.parse(t) as Saved[]).filter(s => Subscription.safeParse(s).success), () => []);
async function save(list: Saved[]) {
  subs = Promise.resolve(list);
  await mkdir(DATA(), { recursive: true });
  const tmp = `${SUBS()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });   // each one can push to someone's phone
  await rename(tmp, SUBS());
}
export const subscriptions = async () => (await load()).map(({ endpoint, user, at }) => ({ endpoint, user, at }));

/** A push service browsers really use, or one the config names: Valet only ever posts to those, so a subscription can't
 *  point it at something on your network. A host (`*.` for any below it) means HTTPS; a full origin allows plain HTTP. */
export function allowed(endpoint: string, services: string[]) {
  const u = URL.parse(endpoint);
  if (!u || u.username || u.password) return false;
  return services.some(s => {
    if (/^https?:\/\//.test(s)) return URL.parse(s)?.origin === u.origin;
    if (u.protocol !== 'https:') return false;
    return s.startsWith('*.') ? u.hostname.endsWith(s.slice(1)) : u.hostname === s;
  });
}

// one change at a time, so two browsers subscribing together can't each write a list without the other
let queue: Promise<unknown> = Promise.resolve();
const change = <T>(f: (list: Saved[]) => { next: Saved[]; out: T }) => {
  const run = queue.then(async () => { const { next, out } = f(await load()); await save(next); return out; });
  queue = run.catch(() => {});
  return run;
};

export const subscribe = (s: Subscription, user: string | undefined, replaces?: string) => change(list => ({
  next: [...list.filter(x => x.endpoint !== s.endpoint && x.endpoint !== replaces), { endpoint: s.endpoint, keys: s.keys, user, at: Date.now() }].slice(-MOST), out: true }));
/** Only the browser's own subscription, and with sign-in only its own account's. */
export const unsubscribe = (endpoint: string, user: string | undefined) => change(list => {
  const next = list.filter(x => !(x.endpoint === endpoint && (x.user ?? null) === (user ?? null)));
  return { next, out: next.length !== list.length };
});
/** Everything an account turned on, when it signs out everywhere. */
export const forgetUser = (user: string) => change(list => ({ next: list.filter(x => x.user !== user), out: true }));
export async function has(endpoint: string, user: string | undefined) { return (await load()).some(x => x.endpoint === endpoint && (x.user ?? null) === (user ?? null)); }

// ── sending

export interface Note { title: string; body?: string; url?: string; urgent?: boolean; open?: string }   // url: a place in Valet · open: an https link a tap opens instead (a meeting)
export interface PushOptions { contact: string; services: string[]; send?: typeof fetch }

/** One push to one browser. Gone (404/410) means the browser dropped it, so it goes from the list too. */
async function deliver(s: Saved, payload: Buffer, urgent: boolean, o: PushOptions) {
  if (!allowed(s.endpoint, o.services)) return 'refused';
  const r = await (o.send ?? fetch)(s.endpoint, {
    method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error',
    headers: { Authorization: vapidAuth(s.endpoint, await vapidKeys(), o.contact), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '43200', Urgency: urgent ? 'high' : 'normal' },
    body: encrypt(payload, s.keys),
  });
  await r.body?.cancel();
  return r.status === 404 || r.status === 410 ? 'gone' : r.ok ? 'ok' : `answered ${r.status}`;
}

export const httpsOnly = (s?: string) => { const u = s && s.length <= 2000 ? URL.parse(s) : null; return u && u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; };
const fit = (n: Note) => Buffer.from(JSON.stringify({ title: n.title.slice(0, 200), body: n.body?.slice(0, 1000), url: n.url, open: httpsOnly(n.open), urgent: n.urgent || undefined }));

/** To every browser that turned notifications on, or only `to`. Failures are logged and never thrown: nothing here can
 *  break the page. */
export async function pushAll(n: Note, o: PushOptions, to?: string) {
  const list = (await load()).filter(s => !to || s.endpoint === to);
  if (!list.length) return;
  const gone = new Set<string>(), payload = fit(n);
  await Promise.all(list.map(async s => {
    try {
      const out = await deliver(s, payload, !!n.urgent, o);
      if (out === 'gone' || out === 'refused') gone.add(s.endpoint);   // refused: a service the config no longer lists
      else if (out !== 'ok') console.error(`notify: push to ${new URL(s.endpoint).host} ${out}`);
    } catch (e) { console.error(`notify: push to ${new URL(s.endpoint).host}: ${(e as Error).message}`); }
  }));
  if (gone.size) await change(all => ({ next: all.filter(s => !gone.has(s.endpoint)), out: gone.size }));
}

/** Tests start from nothing. */
export const forget = () => { vapid = undefined; subs = undefined; queue = Promise.resolve(); };
