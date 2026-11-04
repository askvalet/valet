// Reminders at a set time (Instance.reminders): a meeting about to start. Valet asks every integration that has them every
// half minute, says each one once when it falls due, and keeps what it said in data/reminders.json, so a restart or a
// config reload never says it again. Nothing is said for what was already over, or under way, when Valet came up.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Instance } from './core.ts';
import { sandbox } from './sandbox.ts';

const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'reminders.json');
const clip = (n: number) => z.string().transform(s => s.replace(/\s+/g, ' ').trim().slice(0, n));
const https = z.string().max(2000).refine(s => URL.parse(s)?.protocol === 'https:', 'not an https link');
// a plugin's answer is checked like its cards are: a reminder that doesn't fit is left out, never trusted
export const ReminderShape = z.object({
  id: z.string().min(1).max(300), at: z.number().finite(), until: z.number().finite(), about: z.string().max(300).optional(),
  title: clip(200).pipe(z.string().min(1)), text: clip(500).optional(), link: https.optional(), device: z.boolean().optional(),
});
export type Due = z.infer<typeof ReminderShape> & { source: string };
export interface Source { id: string; instance: Pick<Instance, 'reminders'> }

/** What's due now and not yet said: one per `about`, the latest, and nothing whose moment passed before `since`. */
export function due(list: Due[], said: Record<string, number>, now: number, since: number): { say: Due[]; skip: Due[] } {
  const ready = list.filter(r => !said[r.id] && r.at <= now && now < r.until && r.until > since);
  const latest = new Map<string, Due>();
  for (const r of ready) { const k = r.about ?? r.id, was = latest.get(k); if (!was || r.at > was.at) latest.set(k, r); }
  const say = [...latest.values()];
  return { say, skip: ready.filter(r => !say.includes(r)) };
}

/** The memory and the timer. One per site (it survives a reload). */
export class Reminders {
  private said: Record<string, number> = {};   // id → when it stops mattering, so the file forgets it after
  private since = Date.now();                 // when Valet came up
  private dirty = false;
  sources: () => Source[] = () => [];
  tell: (r: Due) => void = () => {};

  async load() {
    const raw = await readFile(FILE(), 'utf8').then(JSON.parse).catch(() => null);
    if (raw && typeof raw.said === 'object') this.said = Object.fromEntries(Object.entries(raw.said).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
    return this;
  }
  private writing: Promise<void> = Promise.resolve();
  private save() {
    this.writing = this.writing.then(async () => {
      if (sandbox.on || !this.dirty) return;
      this.dirty = false;
      await mkdir(dirname(FILE()), { recursive: true });
      await writeFile(`${FILE()}.tmp`, JSON.stringify({ said: this.said })); await rename(`${FILE()}.tmp`, FILE());
    }).catch(e => console.error('reminders: save failed:', (e as Error).message));
    return this.writing;
  }

  /** One look: ask, say what's due, remember it. */
  async check(now = Date.now()) {
    const all: Due[] = [];
    await Promise.all(this.sources().map(async s => {
      let list: unknown;
      try { list = await s.instance.reminders!(); } catch { return; }
      for (const r of Array.isArray(list) ? list.slice(0, 500) : []) { const p = ReminderShape.safeParse(r); if (p.success) all.push({ ...p.data, id: `${s.id}:${p.data.id}`, source: s.id }); }
    }));
    const { say, skip } = due(all, this.said, now, this.since);
    // marked before it's said: a slow channel must never mean saying it twice
    for (const r of [...say, ...skip]) { this.said[r.id] = Math.max(r.until, now) + 864e5; this.dirty = true; }
    for (const [id, keep] of Object.entries(this.said)) if (keep < now) { delete this.said[id]; this.dirty = true; }
    await this.save();
    for (const r of say) this.tell(r);
    return say;
  }

  /** Check on a timer. Returns how to stop it: the memory outlives a config reload, the timer belongs to the site. */
  start(every = 30_000) {
    if (!this.sources().length) return () => {};
    let busy = false;
    const tick = () => { if (busy) return; busy = true; void this.check().catch(e => console.error('reminders:', (e as Error).message)).finally(() => { busy = false; }); };
    tick();
    const timer = setInterval(tick, every);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
