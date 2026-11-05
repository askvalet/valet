// Backup health: every job any integration reports (Instance.backups), gathered into one card, worst first. A job is
// overdue when it hasn't succeeded within its interval (its schedule if the service knows it, `backups.overdue` if not),
// and a run whose size suddenly falls or jumps is worth a look. Going wrong and coming right are each told once: a notice,
// a line on the timeline and, if asked, a push. What was told, and the sizes seen, live in data/backups.json.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { fmt, type BackupJob, type Instance } from './core.ts';
import type { ListCard, ListItem, Mark, Tone } from '../shared/cards.ts';
import { sandbox } from './sandbox.ts';

export type Health = 'failed' | 'overdue' | 'never' | 'running' | 'ok';
export interface Job {
  id: string; name: string; source: string; health: Health; warning: boolean; error?: string; href?: string;
  lastSuccess?: number; lastRun?: number; next?: number; size?: number; sizes: number[]; change?: number; limit: number;
}
export interface Options { overdue: number; expect?: Record<string, number> }
export interface Source { id: string; name: string; instance: Pick<Instance, 'backups'> }
interface Saved { told: Record<string, Health>; sizes: Record<string, [number, number][]> }

const HOUR = 36e5, KEEP = 30;
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'backups.json');
const When = z.union([z.number(), z.string()]).transform(v => { const t = typeof v === 'number' ? v : new Date(v).getTime(); return Number.isFinite(t) && t > 0 ? t : undefined; });
const clip = (n: number) => z.string().transform(s => s.replace(/\s+/g, ' ').trim().slice(0, n));
const Bytes = z.number().finite().nonnegative();
// a plugin's answer is checked like its cards are: a job that doesn't fit is left out, never trusted
export const BackupShape = z.object({
  name: clip(80).pipe(z.string().min(1)), source: clip(40).optional(), lastSuccess: When.optional(), lastRun: When.optional(),
  result: z.enum(['ok', 'warning', 'failed', 'running']).optional(), error: clip(160).optional(), size: Bytes.optional(),
  sizes: z.array(Bytes).max(200).optional(), next: When.optional(), every: z.number().finite().positive().optional(), href: z.string().max(500).optional(),
});

export const ago = (t: number, now = Date.now()) => fmt.ago(t, now);
/** "1d 2h", "8d" */
export const span = (ms: number) => fmt.span(ms);
const soon = (t: number, now = Date.now()) => t - now < 864e5 && t > now ? fmt.time(t) : fmt.relativeDay(t);
const BAD = new Set<Health>(['failed', 'overdue']);
export const toneOf = (j: Job): Tone | undefined => BAD.has(j.health) ? 'bad' : j.health === 'never' || j.warning || j.change ? 'warn' : j.health === 'running' ? 'accent' : undefined;
const RANK: Record<string, number> = { bad: 0, warn: 1, accent: 2 };
const rank = (j: Job) => RANK[toneOf(j) ?? ''] ?? 3;

/** How long it may go without a success: the config's word for it, the service's schedule with an hour or a tenth to
 *  spare, or the default. A schedule is the gap from the last run to the next when the service only says when. */
export function limitOf(j: { name: string; every?: number; lastRun?: number; next?: number }, o: Options) {
  const set = Object.entries(o.expect ?? {}).find(([k]) => k.toLowerCase() === j.name.toLowerCase())?.[1];
  if (set) return set;
  const every = j.every ?? (j.next && j.lastRun && j.next > j.lastRun ? Math.max(j.next - j.lastRun, HOUR) : undefined);
  return every ? every + Math.max(HOUR, every * 0.1) : o.overdue;
}

/** A size worth a look: down by a third or more, or up by half, against the run before. Small backups wobble, so a change
 *  under 50 MB never counts. */
export function changeOf(sizes: number[]) {
  const [prev, now] = sizes.slice(-2);
  if (prev == null || now == null || !prev || Math.abs(now - prev) < 50 * 2 ** 20) return undefined;
  const r = now / prev;
  return r <= 2 / 3 || r >= 1.5 ? r - 1 : undefined;
}

export function judge(raw: z.infer<typeof BackupShape>, id: string, source: string, o: Options, sizes: number[], now = Date.now()): Job {
  const lastSuccess = raw.lastSuccess ?? (raw.result === 'ok' || raw.result === 'warning' ? raw.lastRun : undefined);
  const lastRun = raw.lastRun ?? lastSuccess, limit = limitOf({ ...raw, lastRun }, o);
  const late = lastSuccess != null && now - lastSuccess > limit;
  const health: Health = raw.result === 'failed' && (!lastSuccess || !lastRun || lastRun >= lastSuccess) ? 'failed' : late ? 'overdue' : raw.result === 'running' ? 'running' : lastSuccess == null ? 'never' : 'ok';
  return { id, name: raw.name, source: raw.source ?? source, health, warning: raw.result === 'warning', error: raw.error, href: raw.href, lastSuccess, lastRun, next: raw.next, size: raw.size, sizes, change: changeOf(sizes), limit };
}

const word = (j: Job, now = Date.now()) => {
  const good = j.lastSuccess ? `last good ${ago(j.lastSuccess, now)}` : 'no good backup on record';
  if (j.health === 'failed') return [`Failed${j.lastRun ? ` ${ago(j.lastRun, now)}` : ''}${j.error ? `: ${j.error}` : ''}`, good].join(' · ');
  if (j.health === 'overdue') return `Last good backup ${ago(j.lastSuccess!, now)}, expected within ${span(j.limit)}`;
  if (j.health === 'never') return 'No successful backup yet';
  if (j.health === 'running') return `Backing up now · ${good}`;
  return [j.source !== j.name ? j.source : undefined, j.size != null ? fmt.bytes(j.size) : undefined, j.warning ? 'with warnings' : undefined, j.next && j.next > now ? `next ${soon(j.next, now)}` : undefined].filter(Boolean).join(' · ');
};

export function row(j: Job, now = Date.now()): ListItem {
  const t = toneOf(j), bad = t === 'bad';
  const meta = j.health === 'failed' ? 'failed' : j.health === 'overdue' ? 'overdue' : j.health === 'running' ? 'running' : j.lastSuccess ? ago(j.lastSuccess, now) : 'never';
  const moved = j.change && j.size != null && j.sizes.length > 1 ? `${j.change < 0 ? 'Shrank' : 'Grew'} from ${fmt.bytes(j.sizes.at(-2)!)} to ${fmt.bytes(j.size)} in one run: worth a look` : undefined;
  return { id: j.id, title: j.name, meta, subtitle: bad || j.health === 'never' || j.health === 'running' ? `${word(j, now)} · ${j.source}` : word(j, now), dot: t === 'accent' ? undefined : t ?? 'good',
    ...(t && t !== 'accent' ? { tone: t } : {}), ...(moved ? { detail: moved } : {}), ...(j.href ? { href: j.href } : {}), ...(j.sizes.length > 2 ? { trend: j.sizes.slice(-12) } : {}) };
}

export function card(jobs: Job[], failed: string[] = [], now = Date.now()): ListCard {
  const all = [...jobs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const bad = all.filter(j => toneOf(j) === 'bad'), warn = all.filter(j => toneOf(j) === 'warn');
  const split = (bad.length || warn.length) && bad.length + warn.length < all.length;
  const items: ListItem[] = all.map(j => ({ ...row(j, now), ...(split ? { section: toneOf(j) === 'bad' || toneOf(j) === 'warn' ? 'Needs a look' : 'Fine' } : {}) }));
  // a source that couldn't be asked: said quietly, since its own card already says it's unreachable
  for (const name of failed) items.push({ id: `?${name}`, title: name, subtitle: `Couldn't ask ${name} about its backups`, meta: 'unknown', ...(split ? { section: 'Fine' } : {}) });
  const last = all.flatMap(j => j.lastSuccess ? [j.lastSuccess] : []).sort((a, b) => b - a)[0];
  const value = bad.length ? `${bad.length} ${bad.length > 1 ? 'need' : 'needs'} a look` : warn.length ? `${warn.length} to check` : all.length ? 'All fine' : 'None yet';
  const marks: Mark[] = all.map(j => ({ pct: 1, tone: toneOf(j) === 'accent' ? undefined : toneOf(j) ?? 'good', label: `${j.name} · ${row(j, now).meta}` }));
  return { type: 'list', title: 'Backups', icon: 'shield', items, empty: 'No backups reported yet',
    summary: { label: 'Backups', icon: 'shield', value, tone: bad.length ? 'bad' : warn.length ? 'warn' : all.length ? 'good' : undefined,
      sub: bad.length ? bad.map(j => j.name).slice(0, 3).join(', ') : warn.length ? warn.map(j => j.name).slice(0, 3).join(', ') : last ? `Last ${ago(last, now)}` : undefined, marks: marks.length ? marks : undefined } };
}

/** What the assistant is handed: plain facts, with times it can read. */
export const brief = (j: Job, now = Date.now()) => ({ job: j.name, source: j.source, state: j.health === 'ok' && j.warning ? 'ok, with warnings' : j.health,
  lastGood: j.lastSuccess ? `${new Date(j.lastSuccess).toISOString()} (${ago(j.lastSuccess, now)})` : 'never', lastRun: j.lastRun && j.lastRun !== j.lastSuccess ? new Date(j.lastRun).toISOString() : undefined,
  error: j.error, size: j.size != null ? fmt.bytes(j.size) : undefined, sizeChange: j.change ? `${j.change > 0 ? '+' : ''}${Math.round(j.change * 100)}% since the run before` : undefined,
  next: j.next ? new Date(j.next).toISOString() : undefined, expectedWithin: span(j.limit) });

export interface Tell { job: Job; now: Health; was: Health }

/** The gathering and the memory. One per site (it survives a reload), asked by the card, the tool and its own timer. */
export class Backups {
  private saved: Saved = { told: {}, sizes: {} };
  private last?: { at: number; p: Promise<{ jobs: Job[]; failed: string[] }> };
  private dirty = false;
  sources: () => Source[] = () => [];
  options: Options = { overdue: 26 * HOUR };
  tell: (t: Tell) => void = () => {};

  async load() {
    const raw = await readFile(FILE(), 'utf8').then(JSON.parse).catch(() => null);
    if (raw && typeof raw === 'object') this.saved = { told: raw.told ?? {}, sizes: raw.sizes ?? {} };
    return this;
  }
  // one write at a time, so two gatherings close together can't trip over the same temporary file
  private writing: Promise<void> = Promise.resolve();
  private save() {
    this.writing = this.writing.then(async () => {
      if (sandbox.on || !this.dirty) return;
      this.dirty = false;
      await mkdir(dirname(FILE()), { recursive: true });
      await writeFile(`${FILE()}.tmp`, JSON.stringify(this.saved)); await rename(`${FILE()}.tmp`, FILE());
    }).catch(e => console.error('backups: save failed:', (e as Error).message));
    return this.writing;
  }

  /** Every job, judged. Asked at most once a minute however many cards and tools want it. */
  jobs(fresh = false) {
    if (!fresh && this.last && Date.now() - this.last.at < 60_000) return this.last.p;
    const p = this.gather();
    this.last = { at: Date.now(), p };
    p.catch(() => { if (this.last?.p === p) this.last = undefined; });
    return p;
  }

  private async gather() {
    const now = Date.now(), failed: string[] = [], jobs: Job[] = [];
    await Promise.all(this.sources().map(async s => {
      let list: unknown;
      try { list = await s.instance.backups!(); } catch { failed.push(s.name); return; }
      for (const r of Array.isArray(list) ? list.slice(0, 200) : []) {
        const p = BackupShape.safeParse(r);
        if (!p.success) continue;
        const id = `${s.id}:${p.data.name}`;
        jobs.push(judge(p.data, id, s.name, this.options, this.sizes(id, p.data), now));
      }
    }));
    this.remember(jobs);
    void this.save();
    return { jobs, failed };
  }

  /** The sizes it has seen, one per run, and this one if it's new. A service's own history wins. */
  private sizes(id: string, j: z.infer<typeof BackupShape>) {
    if (j.sizes?.length) return [...j.sizes, ...(j.size != null && j.sizes.at(-1) !== j.size ? [j.size] : [])].slice(-KEEP);
    const list = this.saved.sizes[id] ?? [], at = j.lastSuccess ?? (j.result === 'ok' || j.result === 'warning' ? j.lastRun : undefined) ?? 0;
    if (j.size != null && (!list.length || at > list.at(-1)![0])) { list.push([at, j.size]); this.saved.sizes[id] = list.slice(-KEEP); this.dirty = true; }
    return (this.saved.sizes[id] ?? []).map(x => x[1]);
  }

  /** Going wrong and coming right, once each. The first time a job is seen isn't news: it went wrong at some earlier time. */
  private remember(jobs: Job[]) {
    for (const j of jobs) {
      const was = this.saved.told[j.id], now = BAD.has(j.health) ? j.health : 'ok';
      if (was === now) continue;
      this.saved.told[j.id] = now; this.dirty = true;
      if (was && (BAD.has(now) || BAD.has(was)) && !(BAD.has(now) && BAD.has(was))) this.tell({ job: j, now, was });
    }
  }

  /** Check on a timer, so a job that goes quiet is noticed with nobody looking. Returns how to stop it: the memory outlives
   *  a config reload, the timer belongs to the site that started it. */
  start(every: number) {
    if (!this.sources().length) return () => {};
    void this.jobs(true).catch(() => {});
    const timer = setInterval(() => void this.jobs(true).catch(() => {}), every);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

/** The words for a change, for a notice, the timeline and a push. */
export function news(t: Tell): { title: string; text?: string; tone: 'bad' | 'good' } {
  const j = t.job, name = `${j.name} (${j.source})`;
  if (t.now === 'failed') return { title: `Backup failed: ${name}`, text: [j.error, j.lastSuccess ? `Last good backup ${ago(j.lastSuccess)}` : undefined].filter(Boolean).join('. ') || undefined, tone: 'bad' };
  if (t.now === 'overdue') return { title: `Backup overdue: ${name}`, text: j.lastSuccess ? `Last good backup ${ago(j.lastSuccess)}` : undefined, tone: 'bad' };
  return { title: `Backing up again: ${name}`, text: j.lastSuccess ? `Last good backup ${ago(j.lastSuccess)}` : undefined, tone: 'good' };
}

/** Valet's Backups card, the assistant's tool and the ⌘K words, from one gathering. */
export function backupParts(b: Backups) {
  const look = async () => {
    const { jobs, failed } = await b.jobs(), now = Date.now();
    return { jobs, failed, card: card(jobs, failed, now), now };
  };
  return {
    widget: { title: 'Backups', interval: 60_000, fetch: async () => (await look()).card },
    tool: {
      label: 'Checked the backups', live: true, followUps: ['Why did it fail?', 'When is the next one?'],
      description: 'Every backup job any connected service reports (Backrest, Kopia, Duplicati, Proxmox, Home Assistant and others), gathered in one place: whether each is fine, failed or overdue, when it last worked, its size and whether that changed sharply, and when the next is due. Use for "are my backups ok", "did last night\'s backup work", "when did X last back up". For why one failed, point the person at that service.',
      access: 'read' as const, input: z.object({}),
      async run() {
        const { jobs, failed, card: c, now } = await look();
        return { data: { summary: `${c.summary!.value}${c.summary!.sub ? ` (${c.summary!.sub})` : ''}`, jobs: [...jobs].sort((x, y) => rank(x) - rank(y)).map(j => brief(j, now)), ...(failed.length ? { couldNotAsk: failed } : {}) }, card: c };
      },
    },
    commands: [{ say: ['backups', 'backup status', 'check backups', 'check the backups', 'are my backups ok', 'are the backups ok', 'backup health'], run: 'tool:backups_status' as const, label: 'Check the backups' }],
  };
}
