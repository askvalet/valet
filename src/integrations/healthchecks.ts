// Healthchecks.io (hosted or self-hosted): every check, up, late or down, when it last pinged and when the next is due;
// trouble first. With control, the assistant can pause a check (it stops alerting until its next ping) and resume it.
// A read-only API key shows everything; pausing needs the project's full key.
import { z } from 'zod';
import { bounded, defineIntegration, fmt, type BackupJob } from '../server/core.ts';
import { Every } from '../server/config.ts';
import type { ListItem, StatItem, Tone } from '../shared/cards.ts';

interface Check { key: string; uuid?: string; name: string; slug?: string; tags: string[]; status: string; started: boolean; lastPing?: number; nextPing?: number; pings: number; manualResume: boolean; period?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (t: unknown) => { if (t == null || t === '') return undefined; const v = new Date(String(t)).getTime(); return Number.isFinite(v) ? v : undefined; };
const ago = (t: number) => { const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : m < 144000 ? `${Math.floor(m / 1440)}d ago` : fmt.day(t)!; };
const toneOf = (c: Check): Tone | undefined => c.status === 'down' ? 'bad' : c.status === 'grace' ? 'warn' : c.status === 'up' ? 'good' : undefined;
const RANK: Record<string, number> = { down: 0, grace: 1, up: 2, new: 3, paused: 4 };
const WORD: Record<string, string> = { down: 'Down', grace: 'Late', up: 'Up', new: 'Never pinged', paused: 'Paused' };

export default defineIntegration({
  type: 'healthchecks',
  name: 'Healthchecks',
  config: z.object({
    url: z.string().url(),                                             // https://healthchecks.io, or your own
    href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
    key: z.string(),                                                   // a project's API key; the read-only one is enough to look
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true;
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    const source = { name: 'Healthchecks', icon: '/api/icon/healthchecks' };
    async function api(path: string, method: 'GET' | 'POST' = 'GET') {
      // POSTs carry an empty body, as the docs' examples do, so there's a Content-Length
      const r = await ctx.http<Response>(`${base}/api/v3/${path}`, { as: 'response', method, insecure, timeout: 15_000, ...(method === 'POST' ? { body: '' } : {}), headers: { Accept: 'application/json', 'X-Api-Key': cfg.key } });
      if (!r.ok) throw new Error(`Healthchecks answered ${r.status}${r.status === 401 ? ': is the API key right?' : r.status === 403 ? ': that needs the full API key, not the read-only one' : r.status === 409 ? ': it isn\'t paused' : ''}`);
      const text = await bounded(r);
      return text ? JSON.parse(text) : {};
    }
    const parse = (c: any): Check => ({ key: String(c?.uuid ?? c?.unique_key ?? c?.slug ?? c?.name), uuid: typeof c?.uuid === 'string' && UUID.test(c.uuid) ? c.uuid : undefined, name: String(c?.name || c?.slug || 'Unnamed'), slug: c?.slug || undefined,
      tags: String(c?.tags ?? '').split(' ').filter(Boolean), status: String(c?.status ?? 'new'), started: !!c?.started, lastPing: when(c?.last_ping), nextPing: when(c?.next_ping), pings: Number(c?.n_pings) || 0, manualResume: !!c?.manual_resume,
      period: Number(c?.timeout) > 0 ? (Number(c.timeout) + (Number(c?.grace) || 0)) * 1000 : undefined });
    let cached: { at: number; p: Promise<Check[]> } | undefined;
    function checks() {
      if (cached && Date.now() - cached.at < 5000) return cached.p;
      const p = api('checks/').then(j => (Array.isArray(j?.checks) ? j.checks : []).map(parse).sort((a: Check, b: Check) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || a.name.localeCompare(b.name)) as Check[]);
      cached = { at: Date.now(), p };
      p.catch(() => { if (cached?.p === p) cached = undefined; });
      return p;
    }
    const words = (c: Check) => [WORD[c.status] ?? c.status, c.started && 'running now', c.lastPing && `last ping ${ago(c.lastPing)}`].filter(Boolean).join(' · ');
    const due = (c: Check) => c.status === 'up' && c.nextPing ? (c.nextPing > Date.now() ? `due ${c.nextPing - Date.now() < 864e5 ? fmt.time(c.nextPing) : fmt.relativeDay(c.nextPing)}` : 'due now') : undefined;
    const row = (c: Check): ListItem => ({ id: c.key, title: c.name, subtitle: words(c), meta: due(c), dot: toneOf(c), tone: toneOf(c) === 'good' ? undefined : toneOf(c) });
    async function checksCard() {
      const all = await checks(), down = all.filter(c => c.status === 'down'), late = all.filter(c => c.status === 'grace'), up = all.filter(c => c.status === 'up');
      return { type: 'list' as const, title: 'Healthchecks', icon: 'pulse', href, source, items: all.map(row), empty: 'No checks yet',
        summary: { label: 'Healthchecks', icon: 'pulse', tone: down.length ? 'bad' as const : late.length ? 'warn' as const : 'good' as const,
          value: down.length ? `${down.length} down` : late.length ? `${late.length} late` : `${up.length} up`,
          sub: down.length || late.length ? [...down, ...late].slice(0, 3).map(c => c.name).join(', ') : `of ${all.length} checks`,
          marks: all.map(c => ({ pct: 1, tone: toneOf(c), label: `${c.name} · ${WORD[c.status] ?? c.status}` })) } };
    }
    async function find(q: string) {
      const all = await checks(), s = q.trim().toLowerCase();
      const exact = all.filter(c => c.uuid?.toLowerCase() === s || c.key.toLowerCase() === s || c.name.toLowerCase() === s || c.slug?.toLowerCase() === s);
      const hits = exact.length ? exact : all.filter(c => c.name.toLowerCase().includes(s) || !!c.slug?.toLowerCase().includes(s));
      if (hits.length > 1) throw new Error(`"${q}" could be ${hits.map(c => c.name).join(', ')}. Say which`);
      if (!hits.length) throw new Error(`no check like "${q}". There are: ${all.map(c => c.name).join(', ') || 'none'}`);
      if (!hits[0].uuid) throw new Error('this API key is read-only, so Valet can see the checks but not pause or resume them: use the project\'s full API key');
      return hits[0] as Check & { uuid: string };
    }
    const CHECK = z.object({ check: z.string().min(1).max(200).describe('its name, slug or id') });

    // a check named or tagged as a backup is one, for Valet's Backups card. Down means it failed or never pinged in time;
    // paused ones aren't expected to run
    const backups = async (): Promise<BackupJob[]> => (await checks()).filter(c => c.status !== 'paused' && /backup/i.test(`${c.name} ${c.tags.join(' ')}`)).map(c => ({
      name: c.name, source: 'Healthchecks', lastRun: c.lastPing, next: c.nextPing, every: c.period, href,
      ...(c.status === 'down' ? { result: 'failed' as const, error: 'Healthchecks has it down' } : c.started ? { result: 'running' as const } : c.lastPing && c.status !== 'new' ? { lastSuccess: c.lastPing, result: 'ok' as const } : {}) }));

    return {
      backups,
      widgets: {
        status: {
          title: 'Healthchecks', interval: every, card: 'stats',
          async fetch() {
            const all = await checks(), count = (s: string) => all.filter(c => c.status === s).length;
            const items: StatItem[] = [{ label: 'Up', value: count('up') }, { label: 'Down', value: count('down'), tone: count('down') ? 'bad' : 'good' }, { label: 'Late', value: count('grace'), tone: count('grace') ? 'warn' : 'good' }, { label: 'Paused', value: count('paused') }];
            return { type: 'stats', title: 'Healthchecks', icon: 'pulse', href, source, items, summary: { label: 'Healthchecks', icon: 'pulse', value: count('up'), sub: 'Up' } };
          },
        },
        checks: { title: 'Healthchecks', interval: every, fetch: checksCard },
      },
      tools: {
        checks_status: {
          label: 'Checked the scheduled jobs', live: true, followUps: ['When did it last run?'],
          description: 'Every Healthchecks check (a cron job or script that pings in): up, late (in its grace period), down, paused or never pinged, when it last pinged, when the next is due, and whether it is running right now. Use for "did the backup job run", "is anything down".',
          access: 'read', input: z.object({}),
          async run() {
            const all = await checks(), iso = (t?: number) => t ? new Date(t).toISOString() : undefined;
            return { data: all.map(c => ({ name: c.name, status: c.status === 'grace' ? 'late' : c.status, running: c.started || undefined, lastPing: iso(c.lastPing), nextPing: iso(c.nextPing), tags: c.tags.length ? c.tags : undefined })), card: await checksCard() };
          },
        },
        check_pause: {
          label: 'Paused a check', undo: 'check_resume',
          description: 'Pause one Healthchecks check, by name: it stops alerting. It resumes by itself on its next ping, unless the check is set to resume by hand. Use when the person says a job is off on purpose.',
          access: 'control', input: CHECK,
          async confirm({ check }) {
            try {
              const c = await find(check);
              return { title: `Pause ${c.name}?`, detail: `${words(c)}. ${c.manualResume ? 'It stays paused until you resume it.' : 'It stops alerting until its next ping.'}`, verb: 'Pause', logo: '/api/icon/healthchecks' };
            } catch (e) { return { title: `Can't pause "${check}"`, detail: (e as Error).message, logo: '/api/icon/healthchecks' }; }
          },
          async run({ check }) {
            const c = await find(check), j = await api(`checks/${c.uuid}/pause`, 'POST');
            cached = undefined;
            return { data: { name: c.name, status: j?.status ?? 'paused' }, card: { type: 'text', tone: 'good', text: `Paused ${c.name}.` } };
          },
        },
        check_resume: {
          label: 'Resumed a check',
          description: 'Resume one paused Healthchecks check, by name. It goes back to "never pinged" until its next ping.',
          access: 'control', input: CHECK,
          async confirm({ check }) {
            try { const c = await find(check); return { title: `Resume ${c.name}?`, detail: `${words(c)}. It starts watching for pings again.`, verb: 'Resume', logo: '/api/icon/healthchecks' }; }
            catch (e) { return { title: `Can't resume "${check}"`, detail: (e as Error).message, logo: '/api/icon/healthchecks' }; }
          },
          async run({ check }) {
            const c = await find(check);
            if (c.status !== 'paused') return { data: { name: c.name, note: `it isn't paused (${c.status}); nothing done` } };
            const j = await api(`checks/${c.uuid}/resume`, 'POST');
            cached = undefined;
            return { data: { name: c.name, status: j?.status ?? 'new' }, card: { type: 'text', tone: 'good', text: `Resumed ${c.name}.` } };
          },
        },
      },
    };
  },
});
