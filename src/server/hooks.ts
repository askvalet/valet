// Webhooks in: any program on the network (Sonarr, Uptime Kuma, a backup script, a cron job with curl) tells Valet that
// something happened, with one POST to /hooks/<name>. Off unless `hooks` names one, and each answers only to its own
// token. What arrives is another program's text: it becomes a notice, a line on the timeline and, if asked, a push,
// through a template that picks fields out by name. It is never handed to a model, never read as HTML, and cut to
// length before it's shown. A hook can set a rule off (rules.ts), and nothing from the body goes into what the rule does.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';

export const HOOK_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const Hook = z.object({
  token: z.string().min(32, 'use a long random token, at least 32 characters, from .env'),   // what the caller sends: Authorization: Bearer <token>, X-Valet-Token, or as the password of Basic auth; at least 32 characters, e.g. ${SONARR_HOOK}
  text: z.string().max(200).optional(),       // the notice: {series.title} fills in from the JSON it sent. Left out: its text, message, msg or title
  sub: z.string().max(200).optional(),        // a quieter second line, filled the same way
  tone: z.enum(['good', 'warn', 'bad', 'accent']).default('accent'),   // the notice's colour: good, warn, bad, or accent for news
  push: z.boolean().default(false),           // also to notify.channels and the devices with notifications on
  rate: z.number().int().min(1).max(600).default(30),   // the most calls a minute; past that it answers 429
  query: z.boolean().default(false),          // also take the token as ?token=…, for a sender that can't set a header. An address ends up in logs
}).strict();
export type Hook = z.infer<typeof Hook>;
export const Hooks = z.record(z.string().regex(HOOK_NAME, 'a hook\'s name is lowercase letters, numbers, - and _, 40 at most'), Hook);

export const MAX_BODY = 16 * 2 ** 10, TEXT = 200, DEPTH = 8;

// --- what it says ---------------------------------------------------------------------------------------------------

// keys that reach an object's prototype rather than what was sent
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const SEGMENT = /^[\w-]{1,60}$/;
/** One value by its dotted path (`episodes.0.title`), only from what the payload itself holds. Anything that isn't a
 *  word or a number, or isn't there, is nothing. */
function pick(v: unknown, path: string) {
  const keys = path.split('.');
  if (keys.length > DEPTH) return '';
  for (const k of keys) {
    if (v === null || typeof v !== 'object' || !SEGMENT.test(k) || UNSAFE.has(k) || !Object.hasOwn(v, k)) return '';
    v = (v as Record<string, unknown>)[k];
  }
  return typeof v === 'string' ? v.slice(0, TEXT * 8) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}

/** A template with each `{dotted.path}` filled from the payload, in one pass: every character is looked at once, and
 *  what's filled in is never read again, so a value can't smuggle in a placeholder of its own. */
export function fill(template: string, payload: unknown) {
  let out = '', i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i), close = open < 0 ? -1 : template.indexOf('}', open + 1);
    if (close < 0) break;
    out += template.slice(i, open) + pick(payload, template.slice(open + 1, close));
    i = close + 1;
  }
  return out + template.slice(i);
}

/** One line of plain words: no control or direction-changing characters, runs of space as one, cut to length. */
export const clean = (s: string, n = TEXT) => [...s.slice(0, n * 8).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/ {2,}/g, ' ').trim()].slice(0, n).join('');

/** What the body says, as a value templates can pick from: JSON as it is, a form's fields, or the words as `text`.
 *  Senders are sloppy about Content-Type (curl -d says it's a form), so what looks like JSON is tried as JSON first. */
export function parse(body: string, type = ''): unknown {
  const s = body.trim();
  if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s); } catch { /* words, then */ } }
  if (type.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(s));
  return { text: s.slice(0, TEXT * 8) };
}

/** The notice a call becomes. With no `text` template it's the payload's own text, message, msg or title; with nothing
 *  to say at all, the hook's name. */
export function words(hook: Pick<Hook, 'text' | 'sub'>, name: string, payload: unknown): { text: string; sub?: string } {
  const own = () => ['text', 'message', 'msg', 'title'].map(k => pick(payload, k)).find(Boolean) ?? '';
  return { text: clean(hook.text ? fill(hook.text, payload) : own()) || name, sub: (hook.sub && clean(fill(hook.sub, payload))) || undefined };
}

// --- who may call ---------------------------------------------------------------------------------------------------

const digest = (s: string) => createHash('sha256').update(s).digest();
// what a call for a hook that isn't there is compared with, so it takes as long as a wrong token for one that is
const NOBODY = digest(randomBytes(32).toString('hex'));
/** The hook this token opens, or nothing. Digests are compared, in constant time, whether or not the hook exists. */
export function opened(hooks: Record<string, Hook> | undefined, name: string, given: string) {
  const hook = hooks && Object.hasOwn(hooks, name) ? hooks[name] : undefined;
  return timingSafeEqual(digest(given), hook ? digest(hook.token) : NOBODY) && hook ? hook : undefined;
}

/** A bucket of calls per hook: it holds a minute's worth, refills steadily, and an empty one refuses. */
export class Buckets {
  private left = new Map<string, { n: number; at: number }>();
  take(key: string, perMinute: number, now = Date.now()) {
    const b = this.left.get(key) ?? { n: perMinute, at: now };
    b.n = Math.min(perMinute, b.n + (now - b.at) * perMinute / 60_000); b.at = now;
    this.left.set(key, b);
    if (b.n < 1) return false;
    b.n--;
    return true;
  }
}

/** The body, or null once it passes the cap: refused by its declared length before a byte is read, and cut off mid-stream
 *  if it didn't declare one. */
async function read(req: Request, max: number) {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  const reader = req.body?.getReader(), parts: Uint8Array[] = [];
  if (!reader) return '';
  for (let n = 0; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((n += value.length) > max) { void reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** The token in an Authorization header: a Bearer token, or a Basic password (what Sonarr's and Radarr's webhook
 *  settings offer), whatever the user name. */
export function tokenOf(header = '') {
  const bearer = /^Bearer (.+)$/.exec(header)?.[1];
  if (bearer) return bearer;
  const basic = /^Basic ([A-Za-z0-9+/=]{1,400})$/.exec(header)?.[1];
  if (!basic) return undefined;
  const pair = Buffer.from(basic, 'base64').toString('utf8'), at = pair.indexOf(':');
  return at < 0 ? undefined : pair.slice(at + 1);
}

export interface HookSite { config: { hooks: Record<string, Hook> }; hookLimit: Buckets; hook(name: string, hook: Hook, payload: unknown): void }

/** POST /hooks/<name>. No hooks at all, a name that isn't one and a wrong token are one answer, and nothing is logged
 *  for any of them: nobody outside learns which hooks exist, and guessing can't fill the log. */
export async function hookRoute(c: Context, site: HookSite | undefined) {
  const name = c.req.param('name') ?? '', hooks = site?.config.hooks;
  const sent = tokenOf(c.req.header('authorization')) ?? c.req.header('x-valet-token');
  const asked = hooks && Object.hasOwn(hooks, name) && hooks[name].query ? c.req.query('token') : undefined;
  const hook = opened(hooks, name, sent ?? asked ?? '');
  if (!site || !hook) return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' });
  if (!site.hookLimit.take(name, hook.rate)) return c.json({ error: 'too many calls' }, 429, { 'Retry-After': String(Math.ceil(60 / hook.rate)) });
  const body = await read(c.req.raw, MAX_BODY).catch(() => null);
  if (body === null) return c.json({ error: 'request too large' }, 413);
  site.hook(name, hook, parse(body, c.req.header('content-type')));
  return c.json({ ok: true });
}
