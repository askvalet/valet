// History for headline numbers. Many services only report "now"; Atrium remembers what each widget's headline said
// over the last day (configurable), so its tile, ring and popover can show a graph even when the service keeps none.
// Samples are kept in memory and saved to data/history.json now and then, so a restart doesn't wipe the day.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Card, Summary } from '../shared/cards.ts';

const FILE = resolve(process.env.ATRIUM_DATA ?? 'data', 'history.json');

/** "13%", "62 W", "1.38M", "4,452", 7 → a number; words ("Healthy", "Fajr") → nothing */
export function numberOf(v: Summary['value']): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*([kKMG]?)/);
  if (!m) return null;
  return Number(m[1]) * ({ k: 1e3, K: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1);
}

export class History {
  private series = new Map<string, [number, number][]>();   // "<widget>#<summary index>" → [time, value]
  private dirty = false;
  private hours: number; private everyMs: number;
  constructor(hours: number, everyMs: number) { this.hours = hours; this.everyMs = everyMs; }

  async load() {
    const raw = await readFile(FILE, 'utf8').catch(() => '{}');
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, [number, number][]>)) this.series.set(k, v);
    setInterval(() => this.save(), 5 * 60_000).unref();
  }
  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(`${FILE}.tmp`, JSON.stringify(Object.fromEntries(this.series)));
    await rename(`${FILE}.tmp`, FILE);
  }

  /** Record this card's headline numbers, then give back the card with a day of history on any headline that has no
   *  graph of its own. */
  apply(key: string, card: Card): Card {
    const now = Date.now(), cutoff = now - this.hours * 36e5;
    const fill = (s: Summary | undefined, i: number): Summary | undefined => {
      if (!s) return s;
      const id = `${key}#${i}`, list = this.series.get(id) ?? [], v = numberOf(s.value);
      if (v != null && (!list.length || now - list[list.length - 1][0] >= this.everyMs)) {
        list.push([now, v]); this.dirty = true;
      }
      while (list.length && list[0][0] < cutoff) list.shift();
      this.series.set(id, list);
      return s.trend?.length || list.length < 3 ? s : { ...s, trend: list.map(p => p[1]) };
    };
    return { ...card, summary: fill(card.summary, 0), ...(card.summaries ? { summaries: card.summaries.map((s, i) => fill(s, i + 1)!) } : {}) };
  }
}
