// "Tell me when…": one-off watches the assistant sets up and a plain rule then checks, with no model involved. It looks
// at widgets' cards every half minute; when one fires it tells the page and your notification channels, then it's gone.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Card, WidgetState } from '../shared/cards.ts';
import { numberOf } from './history.ts';

export interface Watch { id: string; widget: string; on: 'ends' | 'starts' | 'down' | 'up' | 'above' | 'below'; name?: string; value?: number; minutes: number; say: string; until: number }
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'watches.json');
export const loadWatches = (): Promise<Watch[]> => readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []);
async function save(list: Watch[]) {
  await mkdir(dirname(FILE()), { recursive: true });
  await writeFile(`${FILE()}.tmp`, JSON.stringify(list, null, 2), { mode: 0o600 }); await rename(`${FILE()}.tmp`, FILE());
}

const has = (hay: string, needle?: string) => !needle || hay.toLowerCase().includes(needle.toLowerCase());
/** Everything live on a card: its activity, and any media or list rows. */
function titles(c: Card | undefined) {
  const out = c?.activity ? [c.activity.title] : [];
  if (c?.type === 'media' || c?.type === 'list' || c?.type === 'shelf') out.push(...c.items.map(i => i.title));
  return out;
}
const running = (c: Card | undefined, name?: string) => name ? titles(c).some(t => has(t, name)) : !!c?.activity;
/** A number on the card, found by its label. */
export function reading(c: Card | undefined, name?: string) {
  const heads = [c?.summary, ...(c?.summaries ?? [])].filter(Boolean).map(h => [h!.label, h!.value] as const);
  const rows = c?.type === 'stats' ? c.items.map(i => [i.label, i.value] as const) : [];
  const hit = [...rows, ...heads].find(([l]) => has(l, name));
  return hit ? numberOf(hit[1]) : null;
}

/** Whether a watch fires now. `held` remembers since when a threshold has been crossed. */
export function fires(w: Watch, prev: Card | undefined, next: Card | undefined, held: Map<string, number>, now = Date.now()) {
  if (!next) return false;
  if (w.on === 'ends') return !!prev && running(prev, w.name) && !running(next, w.name);
  if (w.on === 'starts') return !!prev && !running(prev, w.name) && running(next, w.name);
  if (w.on === 'down' || w.on === 'up') {
    if (next.type !== 'status') return false;
    const item = next.items.find(i => has(i.name, w.name));
    return !!item && item.ok === (w.on === 'up');
  }
  const v = reading(next, w.name);
  const crossed = v != null && w.value != null && (w.on === 'above' ? v > w.value : v < w.value);
  if (!crossed) { held.delete(w.id); return false; }
  if (!held.has(w.id)) held.set(w.id, now);
  return now - held.get(w.id)! >= w.minutes * 60_000;
}

export class Watches {
  list: Watch[] = [];
  private seen = new Map<string, Card | undefined>();
  private held = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private fire: (w: Watch) => void;
  constructor(list: Watch[], fire: (w: Watch) => void) { this.list = list; this.fire = fire; }
  async add(w: Omit<Watch, 'id'>) { const full = { ...w, id: randomBytes(4).toString('hex') }; this.list.push(full); await save(this.list); return full; }
  async remove(id: string) { const before = this.list.length; this.list = this.list.filter(w => w.id !== id); if (this.list.length !== before) await save(this.list); return this.list.length !== before; }
  check(states: WidgetState[], now = Date.now()) {
    let changed = false;
    for (const w of [...this.list]) {
      const s = states.find(x => x.key === w.widget);
      if (now > w.until) { this.list = this.list.filter(x => x !== w); changed = true; continue; }
      if (s?.card && fires(w, this.seen.get(w.widget), s.card, this.held, now)) { this.fire(w); this.list = this.list.filter(x => x !== w); this.held.delete(w.id); changed = true; }
    }
    for (const s of states) this.seen.set(s.key, s.card);
    if (changed) void save(this.list).catch(() => {});
  }
  /** Check on a timer, keeping watched widgets fresh even with nobody looking. */
  start(snapshot: () => WidgetState[], refresh: (key: string) => void) {
    this.timer = setInterval(() => {
      const states = snapshot();
      for (const w of new Set(this.list.map(x => x.widget))) if (Date.now() - (states.find(s => s.key === w)?.at ?? 0) > 55_000) refresh(w);
      this.check(snapshot());
    }, 30_000);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
}
