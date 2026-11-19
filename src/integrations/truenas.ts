// TrueNAS: pools, alerts, load and uptime, and its cloud sync and replication tasks for the Backups card. It speaks
// TrueNAS's JSON-RPC 2.0 WebSocket API (/api/current, 24.10 and later), the only API TrueNAS 26 has left. One connection
// per fetch: connect, sign in, ask everything at once, close, all within the timeout.
//
// Signing in: with `username` (the key's user), auth.login_ex with API_KEY_PLAIN, which is what TrueNAS 27 requires;
// auth.login_with_api_key only where login_ex doesn't exist, or for a config with just a key, which works up to TrueNAS 26.
//
// The REST API is the fallback, never the default: only when something answers HTTP at the url but won't open a
// WebSocket at /api/current (an install from before 24.10) is it asked the same things the old way, so a config that
// worked before keeps working. A host that can't be reached at all isn't asked twice.
import { z } from 'zod';
import { bounded, defineIntegration, fmt, type BackupJob } from '../server/core.ts';
import { shown } from '../server/service.ts';
import { Every } from '../server/config.ts';
import { RpcError, Unreachable, jsonrpc } from '../server/jsonrpc.ts';
import type { Card, Summary } from '../shared/cards.ts';

/** How long one fetch may take, the connection included; a test shortens it. */
export const limits = { timeout: 15_000 };
const REST_FOR = 3_600_000;
// the same answers from each API: the JSON-RPC method, and the REST path that was its twin
const REST: Record<string, string> = { 'system.info': '/api/v2.0/system/info', 'alert.list': '/api/v2.0/alert/list', 'pool.query': '/api/v2.0/pool',
  'cloudsync.query': '/api/v2.0/cloudsync', 'replication.query': '/api/v2.0/replication' };
type Method = keyof typeof REST;
const STATS = { info: 'system.info', alerts: 'alert.list', pools: 'pool.query' } as const, BACKUPS = { cloudsync: 'cloudsync.query', replication: 'replication.query' } as const;
const OPTIONAL = new Set(['pool.query', 'cloudsync.query', 'replication.query']);   // a key that may not read these still gets a card

const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const sum = <T>(items: T[], pick: (i: T) => unknown) => items.reduce((n, i) => n + (Number(pick(i)) || 0), 0);
const share = (used = 0, total = 0) => total > 0 ? Math.min(Math.max((used || 0) / total, 0), 1) : 0;
// a time as ms, from an ISO date or the { $date: ms } both APIs write datetimes as
const at = (v: any): number | undefined => { const t = v?.$date ?? v; const n = typeof t === 'number' ? (t < 1e11 ? t * 1000 : t) : t ? new Date(String(t)).getTime() : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };

/** The card's numbers, from system.info, alert.list and pool.query. */
export function statsOf(d: { info?: any; alerts?: unknown; pools?: unknown }) {
  const pools = list(d.pools), healthy = pools.filter(p => p.healthy).length, used = sum(pools, p => p.allocated), total = sum(pools, p => p.size);
  return [
    { label: 'Pools healthy', value: `${healthy} / ${pools.length}`, tone: healthy < pools.length ? 'bad' as const : 'good' as const },
    { label: 'Pools used', value: fmt.pct(share(used, total)), pct: share(used, total), sub: `of ${fmt.bytes(total)}` },
    { label: 'Alerts', value: list(d.alerts).filter(a => !a.dismissed).length, tone: list(d.alerts).some(a => !a.dismissed) ? 'bad' as const : 'good' as const },
    { label: 'Load', value: d.info?.loadavg?.[0] ?? 0 },
    { label: 'Uptime', value: fmt.span((d.info?.uptime_seconds ?? 0) * 1000) },   // a span: servers run longer than fmt.duration's 100 days
  ];
}

/** Cloud sync and replication tasks as backup jobs; switched-off ones aren't expected to run. */
export function backupsOf(d: { cloudsync?: unknown; replication?: unknown }): BackupJob[] {
  return [
    ...list(d.cloudsync).filter(t => t.enabled !== false).map(t => {
      const j = t.job ?? {}, state = String(j.state ?? '');
      return { name: t.description || `Cloud sync ${t.id}`, source: 'TrueNAS cloud sync', lastRun: at(j.time_finished ?? j.time_started),
        ...(state === 'SUCCESS' ? { lastSuccess: at(j.time_finished), result: 'ok' as const } : state === 'RUNNING' ? { result: 'running' as const } : state === 'FAILED' || state === 'ABORTED' ? { result: 'failed' as const, error: j.error ? String(j.error) : undefined } : {}) };
    }),
    ...list(d.replication).filter(t => t.enabled !== false).map(t => {
      const st = t.state ?? {}, state = String(st.state ?? ''), when = at(st.datetime);
      return { name: t.name || `Replication ${t.id}`, source: 'TrueNAS replication', lastRun: when,
        ...(state === 'FINISHED' ? { lastSuccess: when, result: 'ok' as const } : state === 'RUNNING' ? { result: 'running' as const } : state === 'ERROR' ? { result: 'failed' as const, error: st.error ? String(st.error) : undefined } : {}) };
    }),
  ];
}

/** The WebSocket address for a TrueNAS url: http becomes ws, https wss, at /api/current under any path the url has. */
export const socketOf = (url: string) => { const u = new URL(url); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; u.pathname = `${u.pathname.replace(/\/$/, '')}/api/current`; u.search = ''; u.hash = ''; return u.href; };

const missing = (e: unknown) => e instanceof RpcError && (e.code === -32601 || /method not found|ENOMETHOD/i.test(e.message));
const busy = (e: unknown) => e instanceof RpcError && (e.data?.errname === 'EBUSY' || /rate limit/i.test(e.message));
const refused = (why = '') => new Error(`TrueNAS refused the API key${why}`);
const BUSY = 'TrueNAS is turning away new connections for a moment (its rate limit); it will be asked again';

export default defineIntegration({
  type: 'truenas',
  name: 'TrueNAS',
  config: z.object({
    url: z.string().url(),                          // https, since TrueNAS revokes a key it sees over plain http
    href: z.string().optional(),
    every: z.union([z.string(), z.number()]).optional(),
    insecure: z.boolean().optional(),               // TrueNAS ships a self-signed certificate
    key: z.string(),                                // an API key (the user menu, API Keys)
    username: z.string().optional(),                // the key's user: Valet then signs in with auth.login_ex, which TrueNAS 27 requires
  }).strict(),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true, socket = socketOf(cfg.url);
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    let hinted = false, restUntil = 0;

    async function signIn(call: (m: string, p?: unknown[]) => Promise<any>) {
      if (cfg.username) {
        try {
          const r = await call('auth.login_ex', [{ mechanism: 'API_KEY_PLAIN', username: cfg.username, api_key: cfg.key }]);
          const kind = String(r?.response_type ?? '');
          if (kind === 'SUCCESS') return;
          throw kind === 'EXPIRED' ? refused(': it has expired') : kind === 'OTP_REQUIRED' ? refused(`: ${cfg.username} needs a one-time code; use a key for a user without two-factor`)
            : kind === 'REDIRECT' ? new Error('TrueNAS asked to be signed in to elsewhere (a standby controller?): point url at the active one') : refused(` for ${cfg.username}: are the key and its user right?`);
        } catch (e) {
          if (busy(e)) throw new Error(BUSY);
          if (!missing(e)) throw e instanceof RpcError ? refused(` for ${cfg.username}: are the key and its user right?`) : e;
        }
      }
      try {
        // 24.10 answers a bad key with false; later versions with an error
        if (await call('auth.login_with_api_key', [cfg.key]) !== true) throw refused();
      } catch (e) {
        if (busy(e)) throw new Error(BUSY);
        if (missing(e)) throw new Error('This TrueNAS signs in only with auth.login_ex, which needs the key\'s user: add `username:` beside `key:`');
        throw e instanceof RpcError ? refused() : e;
      }
      if (!cfg.username && !hinted) { hinted = true; ctx.log('signed in with auth.login_with_api_key, which TrueNAS 27 removes: add `username:` (the key\'s user) to sign in with auth.login_ex'); }
    }

    /** Over the WebSocket: sign in, then every call at once. */
    const overSocket = <K extends string>(calls: Record<K, Method>) => jsonrpc(socket, { timeout: limits.timeout, insecure }, async c => {
      await signIn(c.call);
      const entries = Object.entries(calls) as [K, Method][];
      const got = await Promise.allSettled(entries.map(([, m]) => c.call(m)));
      return Object.fromEntries(entries.map(([k, m], i) => {
        const g = got[i];
        if (g.status === 'fulfilled') return [k, g.value];
        if (OPTIONAL.has(m)) return [k, undefined];
        throw new Error(`TrueNAS couldn't answer ${m}: ${(g.reason as Error).message}`);
      })) as Record<K, unknown>;
    });

    /** The old way, for an install whose WebSocket isn't there: the same calls as REST, with the key as a bearer token. */
    async function overRest<K extends string>(calls: Record<K, Method>, why: Unreachable) {
      const one = async (m: Method) => {
        const r = await ctx.http<Response>(`${base}${REST[m]}`, { as: 'response', insecure, timeout: limits.timeout, headers: { Accept: 'application/json', Authorization: `Bearer ${cfg.key}` } });
        if (r.status === 401 || r.status === 403) { await r.body?.cancel(); throw refused(); }
        if (r.status === 404 || r.status === 410) { await r.body?.cancel(); throw new Error(`TrueNAS has no REST API here (it answered ${r.status}), as from TrueNAS 26, and its WebSocket at ${socket} wouldn't open (${why.message}): if a reverse proxy is in between, it must pass WebSocket upgrades`); }
        if (!r.ok) { await r.body?.cancel(); throw new Error(`TrueNAS answered ${r.status}`); }
        try { return JSON.parse(await bounded(r)); } catch { throw new Error('TrueNAS didn\'t send JSON: is the url right?'); }
      };
      const entries = Object.entries(calls) as [K, Method][];
      const got = await Promise.allSettled(entries.map(([, m]) => one(m)));
      const failed = got.find((g, i) => g.status === 'rejected' && !OPTIONAL.has(entries[i][1]));
      if (failed) throw (failed as PromiseRejectedResult).reason;
      return Object.fromEntries(entries.map(([k], i) => [k, got[i].status === 'fulfilled' ? (got[i] as PromiseFulfilledResult<unknown>).value : undefined])) as Record<K, unknown>;
    }

    async function ask<K extends string>(calls: Record<K, Method>) {
      if (Date.now() < restUntil) return overRest(calls, new Unreachable('when last tried, within the hour'));
      try { return await overSocket(calls); } catch (e) {
        if (!(e instanceof Unreachable)) throw e;
        if (e.status == null) throw new Error(`Can't reach TrueNAS's WebSocket at ${socket}: ${e.message}`);
        const d = await overRest(calls, e);
        restUntil = Date.now() + REST_FOR;           // an old install: ask it the old way for a while before trying again
        return d;
      }
    }

    const source = { name: 'TrueNAS', icon: '/api/icon/truenas' };
    const card = async (): Promise<Card> => {
      const items = statsOf(await ask(STATS)).map(shown), first = items[0];
      const summary: Summary = { label: 'TrueNAS', icon: 'disk', value: first.value, sub: first.label };
      return { type: 'stats', title: 'TrueNAS', icon: 'disk', href, source, items, summary };
    };
    return {
      widgets: { status: { title: 'TrueNAS', interval: every, fetch: card } },
      tools: {
        truenas_status: {
          label: 'Checked TrueNAS', access: 'read', input: z.object({}), live: true,
          description: 'What TrueNAS reports right now: Pools healthy, Pools used, Alerts, Load, Uptime.',
          async run() { const c = await card(); return { data: c, card: c }; },
        },
      },
      backups: async () => backupsOf(await ask(BACKUPS)).map(j => ({ href, ...j })),
    };
  },
});
