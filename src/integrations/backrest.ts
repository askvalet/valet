// Backrest (restic with a web interface): each plan's last backup, when it ran, how much it added and how much it
// protects, whether it worked, and when the next one is; failures first. With control, the assistant can run a plan's
// backup now. Everything comes from GetSummaryDashboard, the call Backrest's own dashboard makes, so the repositories'
// passwords in its config are never asked for.
import { z } from 'zod';
import { bounded, defineIntegration, fmt } from '../server/core.ts';
import { Every } from '../server/config.ts';
import type { ListItem, StatItem, Tone } from '../shared/cards.ts';

type State = 'ok' | 'warning' | 'failed' | 'running' | 'cancelled' | 'none';
interface Run { at: number; ms: number; state: State; added: number }
interface Plan { id: string; last?: Run; ok30: number; failed30: number; warned30: number; added30: number; protects: number; snapshots: number; next?: number; overdue: boolean }

const n = (v: unknown) => Number(v) || 0;   // int64s arrive as strings
const PLAN = /^[A-Za-z0-9_.-]{1,100}$/;      // Backrest's own rule for an id
// enums arrive by name; a very old server might send the number
const STATE: Record<string, State> = { STATUS_SUCCESS: 'ok', 3: 'ok', STATUS_WARNING: 'warning', 7: 'warning', STATUS_ERROR: 'failed', 4: 'failed', STATUS_INPROGRESS: 'running', 2: 'running', STATUS_PENDING: 'running', 1: 'running', STATUS_SYSTEM_CANCELLED: 'cancelled', 5: 'cancelled', STATUS_USER_CANCELLED: 'cancelled', 6: 'cancelled' };
const ago = (t: number) => { const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : m < 144000 ? `${Math.floor(m / 1440)}d ago` : fmt.day(t)!; };
const next = (t: number) => t - Date.now() < 864e5 ? `next ${fmt.time(t)}` : `next ${fmt.relativeDay(t)}`;
const tone = (p: Plan): Tone | undefined => p.last?.state === 'failed' ? 'bad' : p.last?.state === 'warning' || p.overdue ? 'warn' : p.last?.state === 'running' ? 'accent' : undefined;
const rank = (p: Plan) => ({ bad: 0, warn: 1, accent: 2 } as Record<string, number>)[tone(p) ?? ''] ?? 3;

function parse(raw: any): Plan {
  const c = raw?.recentBackups ?? {}, at = (c.timestampMs ?? []) as unknown[];
  // newest first in today's Backrest; picked by time anyway, so an older order reads the same
  const runs: Run[] = at.map((t, i) => ({ at: n(t), ms: n(c.durationMs?.[i]), state: STATE[String(c.status?.[i])] ?? 'none', added: n(c.bytesAdded?.[i]) })).sort((a, b) => b.at - a.at);
  const days = Array.isArray(raw?.historyLast30days) ? raw.historyLast30days : [];
  return { id: String(raw?.id ?? ''), last: runs[0], ok30: n(raw?.backupsSuccessLast30days), failed30: n(raw?.backupsFailed30days), warned30: n(raw?.backupsWarningLast30days), added30: n(raw?.bytesAddedLast30days),
    protects: n(raw?.protectedBytes), snapshots: n(raw?.totalSnapshots), next: n(raw?.nextBackupTimeMs) || undefined, overdue: !!days.at(-1)?.overdue };
}
function words(p: Plan) {
  const r = p.last;
  if (!r) return 'No backups yet';
  if (r.state === 'running') return 'Backing up now';
  const what = { ok: 'Backed up', warning: 'Backed up with warnings', failed: 'Failed', cancelled: 'Cancelled', none: 'Ran' }[r.state];
  return [`${what} ${ago(r.at)}`, r.state !== 'failed' && r.added ? `+${fmt.bytes(r.added)}` : undefined, p.overdue && r.state !== 'failed' ? 'overdue' : undefined].filter(Boolean).join(' · ');
}

export default defineIntegration({
  type: 'backrest',
  name: 'Backrest',
  config: z.object({
    url: z.string().url(), href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
    username: z.string().optional(), password: z.string().optional(),   // only if Backrest has users set up
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true;
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    const source = { name: 'Backrest', icon: '/api/icon/backrest' };
    const auth: Record<string, string> = cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ''}`).toString('base64')}` } : {};
    async function rpc(method: string, body: unknown = {}, timeout = 15_000) {
      const r = await ctx.http<Response>(`${base}/v1.Backrest/${method}`, { as: 'response', method: 'POST', insecure, timeout, body: JSON.stringify(body), headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...auth } });
      if (!r.ok) {
        const why = await bounded(r, 4096).then(t => JSON.parse(t)?.message as string | undefined).catch(() => undefined);
        throw new Error(`Backrest answered ${r.status}${r.status === 401 ? ': are the username and password right?' : why ? `: ${String(why).slice(0, 160)}` : ''}`);
      }
      const text = await bounded(r);
      return text ? JSON.parse(text) : {};
    }
    let cached: { at: number; p: Promise<Plan[]> } | undefined;
    function plans() {
      if (cached && Date.now() - cached.at < 5000) return cached.p;
      const p = rpc('GetSummaryDashboard').then((d): Plan[] => (Array.isArray(d?.planSummaries) ? d.planSummaries : []).map(parse).filter((x: Plan) => x.id));
      cached = { at: Date.now(), p };
      p.catch(() => { if (cached?.p === p) cached = undefined; });
      return p;
    }
    const row = (p: Plan): ListItem => ({ id: p.id, title: p.id, subtitle: words(p), meta: p.next ? next(p.next) : undefined, dot: tone(p), tone: tone(p) === 'accent' ? undefined : tone(p),
      detail: p.protects ? `Protects ${fmt.bytes(p.protects)}${p.snapshots ? ` · ${p.snapshots.toLocaleString('en')} snapshots` : ''}` : undefined });
    async function plansCard() {
      const all = (await plans()).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
      const failed = all.filter(p => tone(p) === 'bad'), warned = all.filter(p => tone(p) === 'warn'), running = all.filter(p => p.last?.state === 'running');
      const value = failed.length ? `${failed.length} failed` : warned.length ? `${warned.length} to check` : running.length ? 'Backing up' : all.length ? 'All fine' : 'No plans';
      const last = all.flatMap(p => p.last && p.last.state !== 'running' ? [p.last.at] : []).sort((a, b) => b - a)[0];
      return { type: 'list' as const, title: 'Backups', icon: 'shield', href, source, items: all.map(row), empty: 'No backup plans yet',
        activity: running.length ? { title: 'Backing up', subtitle: running.map(p => p.id).join(', '), icon: 'shield' } : undefined,
        summary: { label: 'Backups', icon: 'shield', value, tone: failed.length ? 'bad' as const : warned.length ? 'warn' as const : 'good' as const,
          sub: failed.length ? failed.map(p => p.id).join(', ') : warned.length ? warned.map(p => p.id).join(', ') : last ? `Last ${ago(last)}` : undefined,
          marks: all.map(p => ({ pct: 1, tone: tone(p) === 'accent' ? undefined : tone(p) ?? 'good', label: `${p.id} · ${words(p)}` })) } };
    }
    async function find(q: string) {
      const all = await plans(), s = q.trim().toLowerCase();
      const exact = all.filter(p => p.id.toLowerCase() === s), hits = exact.length ? exact : all.filter(p => p.id.toLowerCase().includes(s));
      if (hits.length === 1) { if (!PLAN.test(hits[0].id)) throw new Error(`Backrest sent a plan id Valet won't send back: ${hits[0].id.slice(0, 40)}`); return hits[0]; }
      if (!hits.length) throw new Error(`no plan like "${q}". There are: ${all.map(p => p.id).join(', ') || 'none'}`);
      throw new Error(`"${q}" could be ${hits.map(p => p.id).join(', ')}. Say which`);
    }
    const brief = (p: Plan) => ({ plan: p.id, last: p.last ? { state: p.last.state, at: new Date(p.last.at).toISOString(), took: fmt.duration(p.last.ms / 1000), added: fmt.bytes(p.last.added) } : 'never', next: p.next ? new Date(p.next).toISOString() : undefined,
      overdue: p.overdue || undefined, protects: p.protects ? fmt.bytes(p.protects) : undefined, snapshots: p.snapshots || undefined, last30days: { ok: p.ok30, warnings: p.warned30, failed: p.failed30, added: fmt.bytes(p.added30) } });

    return {
      widgets: {
        status: {
          title: 'Backrest', interval: every,
          async fetch() {
            const all = await plans(), latest = (s: State) => all.filter(p => p.last?.state === s).length, alarm = (label: string, v: number): StatItem => ({ label, value: v, tone: v ? 'bad' : 'good' });
            const items: StatItem[] = [{ label: 'Plans', value: all.length }, { label: 'Latest fine', value: latest('ok') }, alarm('Latest failed', latest('failed')),
              alarm('Failed, 30 days', all.reduce((s, p) => s + p.failed30, 0)), { label: 'Added, 30 days', value: fmt.bytes(all.reduce((s, p) => s + p.added30, 0)) }];
            return { type: 'stats', title: 'Backrest', icon: 'shield', href, source, items, summary: { label: 'Backrest', icon: 'shield', value: all.length, sub: 'Plans' } };
          },
        },
        plans: { title: 'Backups', interval: every, fetch: plansCard },
      },
      tools: {
        backup_status: {
          label: 'Checked the backups', live: true, followUps: ['Why did it fail?', 'When is the next one?'],
          description: 'Every Backrest plan: its last backup (worked, warnings, failed, running), when it ran, how long it took and how much it added, how much the last good one protects, when the next is due, whether it is overdue, and counts over 30 days. Use for "did last night\'s backup work", "when did X last back up". It can\'t read restic\'s logs: for why one failed, point the person at Backrest.',
          access: 'read', input: z.object({}),
          async run() { return { data: (await plans()).map(brief), card: await plansCard() }; },
        },
        backup_run: {
          label: 'Started a backup',
          description: 'Run one Backrest plan\'s backup now, by its id (backup_status lists them). It returns once Backrest has started it; a big backup takes a while, so check backup_status later.',
          access: 'control', input: z.object({ plan: z.string().min(1).max(100) }),
          async confirm({ plan }) {
            try {
              const p = await find(plan);
              return { title: `Back up ${p.id} now?`, detail: [words(p), p.next ? `Next scheduled ${fmt.relativeDay(p.next)} at ${fmt.time(p.next)}` : undefined].filter(Boolean).join('. '), verb: 'Back up', logo: '/api/icon/backrest' };
            } catch (e) { return { title: `Can't back up "${plan}"`, detail: (e as Error).message, logo: '/api/icon/backrest' }; }
          },
          async run({ plan }) {
            const p = await find(plan);
            if (p.last?.state === 'running') return { data: { plan: p.id, note: 'a backup is already running; nothing started' } };
            // Backrest answers when the backup ends, but runs it either way: a short wait that runs out means it's under way
            const finished = await rpc('Backup', { value: p.id }, 8000).then(() => true, (e: Error) => { if (e.name === 'TimeoutError' || /timed? ?out|aborted/i.test(e.message)) return false; throw e; });
            cached = undefined;
            return { data: { plan: p.id, finished }, card: { type: 'text', tone: 'good', text: finished ? `Backed up ${p.id}.` : `Backing up ${p.id}. It's still running.` } };
          },
        },
      },
    };
  },
});
