// The short way to add a service. Most integrations are the same thing: call an endpoint or two, show some numbers. Say
// that here and Valet does the rest: the config, sign-in, a card with a headline tile, and a tool for the assistant.
// The sample response travels with the definition, so `npm test` checks every service without the real thing.
//
//   service({
//     type: 'adguard', name: 'AdGuard Home', icon: 'shield', auth: 'basic',
//     get: { stats: '/control/stats' },
//     stats: d => [{ label: 'Queries', value: d.stats.num_dns_queries }, { label: 'Blocked', value: d.stats.num_blocked_filtering }],
//     sample: { stats: { num_dns_queries: 1200, num_blocked_filtering: 300 } },
//     expect: { Queries: '1,200', Blocked: '300' },
//   })
//
// When a service needs more than this, write a full integration: docs/integrations.md.
import { z } from 'zod';
import { Every } from './config.ts';
import { defineIntegration, fmt, type Context, type Instance, type Integration } from './core.ts';
import type { Card, ListItem, Summary, StatItem, StatusItem, RecapSlide } from '../shared/cards.ts';

/** How it signs in. `bearer`, `token` and a `header` use `key:` from the config, `basic` uses `username:` and `password:`,
 *  `query` puts the key in the URL, and `login` trades a username and password for a session. */
export type Auth = 'none' | 'bearer' | 'token' | 'basic' | { header: string; prefix?: string } | { query: string } | Login | Handshake;
/** The service hands out a session id on a refused first request, and wants it back in a header (Transmission). */
export interface Handshake { handshake: { status: number; header: string } }
export interface Login {
  login: string;                                                       // the path to post to
  body?: (c: Creds) => Record<string, unknown> | URLSearchParams;      // JSON unless it's URLSearchParams
  token?: (res: any) => string;                                        // from the JSON answer; without it, the session cookie
  use?: (token: string) => Record<string, string>;                     // how it's sent back; Authorization: Bearer by default
  text?: boolean;                                                      // the answer is plain text, not JSON
  expired?: (answer: any) => boolean;                                  // some services say "signed out" with a 200
  needs?: ('username' | 'password' | 'key')[];                         // what it asks for; username and password by default
  redirects?: boolean;                                                 // the cookie comes on a redirect: don't follow it
  ttl?: number;                                                        // seconds a token lasts, for services that don't say when it ends
}
export interface Creds { key?: string; username?: string; password?: string; url?: string }
type Stat = Omit<StatItem, 'value'> & { value: unknown };
// body: an object goes as JSON; URLSearchParams and plain strings go as they are
export type Get = string | { path: string; method?: 'POST'; body?: unknown; headers?: Record<string, string>; as?: 'text' | 'headers'; optional?: boolean };

export interface ServiceDef<O = Record<string, never>> {
  type: string;                 // `type:` in config.yaml
  name: string;
  icon?: string;                // the card's icon; `logo` is the app's own, by dashboard-icons name (default: the type)
  logo?: string;
  auth?: Auth;
  authOptional?: boolean;       // many installs run without a login: send credentials only if they're configured
  options?: z.ZodRawShape;      // settings of its own, beyond url and credentials
  every?: string | number;      // how often: seconds, or "5m"; a minute by default. Slower for heavy calls.
  get: Record<string, Get> | ((o: O & { url: string; session?: string }) => Record<string, Get>);   // session: the sign-in token, for bodies
  then?: (d: any, o: O & { url: string; session?: string }) => Record<string, Get>;   // a second step that needs the first's answers
  stats?: (d: any, o: O) => Stat[];
  list?: (d: any, o: O) => ListItem[];
  status?: (d: any, o: O) => StatusItem[];
  card?: (d: any, o: O) => Card;                                       // anything the three above can't say
  headline?: (d: any, o: O) => Partial<Summary> | undefined;           // the tile; the first stat otherwise
  about?: string;               // what the assistant is told it's for; a sentence
  recap?: (d: any, o: O, range: { year: number; from: number; to: number }) => RecapSlide[];
  sample: Record<string, unknown>;                                     // an answer per `get`, as the real service sends it
  sampleOptions?: Record<string, unknown>;
  loginSample?: unknown;                                               // what signing in answers, for a `login` that reads it
  expect?: Record<string, string | number>;                            // label → what `sample` must show
}

const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : v;
const seconds = (v: string | number | undefined) => { const r = Every.safeParse(v); return r.success ? r.data : undefined; };
const shown = (s: Stat): StatItem => ({ ...s, value: (number(s.value) ?? '–') as string | number });

export function service<O = Record<string, never>>(def: ServiceDef<O>): Integration<any> & { def: ServiceDef<O> } {
  const auth = def.auth ?? 'none';
  const needsKey = auth === 'bearer' || auth === 'token' || (typeof auth === 'object' && ('header' in auth || 'query' in auth));
  const login = typeof auth === 'object' && 'login' in auth ? auth : undefined;
  const asks = auth === 'basic' ? ['username', 'password'] : login ? login.needs ?? ['username', 'password'] : needsKey ? ['key'] : [];
  const logo = def.logo ?? def.type;
  const shape: z.ZodRawShape = { url: z.string().url(), href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(), ...Object.fromEntries(asks.map(k => [k, def.authOptional ? z.string().optional() : z.string()])), ...def.options };
  return {
    def, type: def.type, name: def.name, config: z.object(shape).strict(),
    create(cfg: any, ctx: Context): Instance {
      const base = String(cfg.url).replace(/\/$/, '');
      const have = !def.authOptional || asks.some(k => cfg[k]);       // nothing configured, nothing sent
      const insecure = cfg.insecure === true;                          // a self-signed certificate this person trusts
      let signedInAt = 0;
      const session = login && have ? ctx.session(async () => {
        const body = login.body?.(cfg) ?? { username: cfg.username, password: cfg.password };
        const form = body instanceof URLSearchParams;
        const res = await ctx.http<Response>(`${base}${login.login}`, { as: 'response', insecure, method: 'POST', body: form ? body : JSON.stringify(body), redirect: login.redirects ? 'manual' : 'follow', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } });
        if (!res.ok && !(login.redirects && res.status >= 300 && res.status < 400)) throw new Error(`${def.name} refused the sign-in (${res.status})`);
        signedInAt = Date.now();
        const cookie = res.headers.get('set-cookie')?.split(/,(?=[^;]+=)/).map(c => c.split(';')[0].trim()).join('; ');
        if (login.token) { const t = login.token(login.text ? await res.text() : await res.json()); return { token: t, headers: { ...(login.use?.(t) ?? { Authorization: `Bearer ${t}` }), ...(cookie && login.use ? { Cookie: cookie } : {}) } }; }
        if (!cookie) throw new Error(`${def.name} gave no session`);
        return { token: cookie, headers: { Cookie: cookie } };
      }) : undefined;
      const hand = typeof auth === 'object' && 'handshake' in auth ? auth.handshake : undefined;
      let handed = '';
      const headers = async (): Promise<Record<string, string>> => {
        if (session && login?.ttl && signedInAt && Date.now() - signedInAt > login.ttl * 1000) session.reset();
        if (session) return (await session.get()).headers;
        if (hand) return { ...(cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` } : {}), ...(handed ? { [hand.header]: handed } : {}) };
        if (!have) return {};
        if (auth === 'bearer') return { Authorization: `Bearer ${cfg.key}` };
        if (auth === 'token') return { Authorization: `Token ${cfg.key}` };
        if (auth === 'basic') return { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` };
        if (typeof auth === 'object' && 'header' in auth) return { [auth.header]: `${auth.prefix ?? ''}${cfg.key}` };
        return {};
      };
      const one = async (g: Get, retry = true): Promise<unknown> => {
        const o = typeof g === 'string' ? { path: g } : g;
        const url = new URL(`${base}${o.path}`);
        if (typeof auth === 'object' && 'query' in auth && have) url.searchParams.set(auth.query, cfg.key);
        const raw = typeof o.body === 'string' || o.body instanceof URLSearchParams;
        const res = await ctx.http<Response>(url.toString(), { as: 'response', insecure, method: o.method ?? 'GET', timeout: 15_000,
          headers: { Accept: 'application/json', ...(o.body ? { 'Content-Type': raw ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...await headers(), ...o.headers }, body: o.body ? raw ? o.body as BodyInit : JSON.stringify(o.body) : undefined });
        if (hand && res.status === hand.status && retry) { handed = res.headers.get(hand.header) ?? ''; return one(g, false); }
        if ((res.status === 401 || res.status === 403) && session && retry) { session.reset(); return one(g, false); }
        if (!res.ok) throw new Error(`${def.name} answered ${res.status}`);
        if (o.as === 'headers') return Object.fromEntries(res.headers);
        const text = await res.text();
        if (o.as === 'text') return text;
        let json: unknown;
        try { json = JSON.parse(text); } catch { throw new Error(`${def.name} didn't send JSON: is the url right?`); }
        if (login?.expired?.(json) && session) { if (retry) { session.reset(); return one(g, false); } throw new Error(`${def.name} refused the sign-in`); }
        return json;
      };
      const fetchAll = async (gets: Record<string, Get>) => {
        const wanted = Object.entries(gets), got = await Promise.allSettled(wanted.map(([, g]) => one(g)));
        const failed = got.find((g, i) => g.status === 'rejected' && !(typeof wanted[i][1] === 'object' && wanted[i][1].optional));
        if (failed) throw (failed as PromiseRejectedResult).reason;
        return Object.fromEntries(wanted.map(([k], i) => [k, got[i].status === 'fulfilled' ? got[i].value : undefined]));
      };
      const load = async () => {
        const o = { ...cfg, session: session ? (await session.get()).token : undefined };
        const d = await fetchAll(typeof def.get === 'function' ? def.get(o) : def.get);
        return def.then ? { ...d, ...await fetchAll(def.then(d, o)) } : d;
      };
      const href = cfg.href ?? cfg.url, source = { name: def.name, icon: `/api/icon/${logo}` };
      const toCard = (d: any): Card => {
        if (def.card) return def.card(d, cfg);
        const base = { title: def.name, icon: def.icon ?? 'pulse', href, source };
        const stats = def.stats?.(d, cfg).map(shown), first = stats?.[0];
        const summary: Summary | undefined = first && { label: def.name, icon: def.icon ?? 'pulse', value: first.value, sub: first.label, ...def.headline?.(d, cfg) };
        if (def.status) { const items = def.status(d, cfg), down = items.filter(i => !i.ok); return { ...base, type: 'status', items, summary: { label: def.name, icon: def.icon ?? 'pulse', value: down.length ? `${down.length} down` : `${items.length} up`, tone: down.length ? 'bad' : 'good' } }; }
        if (def.list && !stats) { const items = def.list(d, cfg); return { ...base, type: 'list', items, empty: 'Nothing here', summary: { label: def.name, icon: def.icon ?? 'pulse', value: String(items.length), sub: items[0]?.title, ...def.headline?.(d, cfg) } }; }
        return { ...base, type: 'stats', items: stats ?? [], summary };
      };
      return {
        widgets: { status: { title: def.name, interval: seconds(cfg.every ?? def.every) ?? 60_000, fetch: async () => toCard(await load()) } },
        tools: { [`${def.type.replace(/[^a-z0-9]+/g, '_')}_status`]: {
          label: `Checked ${def.name}`, access: 'read', input: z.object({}), live: true,
          description: def.about ?? `What ${def.name} reports right now: ${labels(def, cfg)}.`,
          async run() { const card = toCard(await load()); return { data: card, card }; } } },
        ...(def.recap ? { recap: async (range: { year: number; from: number; to: number }) => def.recap!(await load(), cfg, range) } : {}),
      };
    },
  };
}
/** The stat labels, read from the sample, so the assistant knows what the tool answers. */
function labels(def: ServiceDef<any>, cfg: unknown) {
  try { return def.stats?.(def.sample, cfg as never).map(s => s.label).join(', ') || 'its current state'; } catch { return 'its current state'; }
}
export { fmt };
