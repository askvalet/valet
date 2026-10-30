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
  private labels = new Map<string, string>();               // series → what its headline is called
  private dirty = false;
  private hours: number; private everyMs: number;
  constructor(hours: number, everyMs: number) { this.hours = hours; this.everyMs = everyMs; }

  async load() {
    const raw = await readFile(FILE, 'utf8').catch(() => '{}');
    let saved: Record<string, [number, number][]> = {};
    try { saved = JSON.parse(raw); } catch { console.error('history: history.json is unreadable; starting fresh'); }
    for (const [k, v] of Object.entries(saved)) if (Array.isArray(v)) this.series.set(k, v);
    for (const [k, v] of Object.entries((saved as any).$labels ?? {})) this.labels.set(k, String(v));
    setInterval(() => this.save().catch(e => console.error('history: save failed:', e.message)), 5 * 60_000).unref();
  }
  async save() {
    if (!this.dirty) return;
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(`${FILE}.tmp`, JSON.stringify({ ...Object.fromEntries(this.series), $labels: Object.fromEntries(this.labels) }));
    await rename(`${FILE}.tmp`, FILE);
    this.dirty = false;   // only once it's safely on disk
  }

  /** How each headline number moved over a period, the ones that moved most first. */
  overview(ms: number) {
    const from = Date.now() - ms, at = (t: number) => new Date(t).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return [...this.series].flatMap(([k, list]) => {
      const pts = list.filter(p => p[0] >= from);
      if (pts.length < 2) return [];
      const vals = pts.map(p => p[1]), low = Math.min(...vals), high = Math.max(...vals), peak = pts.find(p => p[1] === high)!;
      return [{ name: `${this.labels.get(k) ?? k.split('#')[0]} (${k.split('#')[0]})`, now: vals.at(-1)!, low, high, peakAt: at(peak[0]), spread: high - low ? (high - low) / (Math.abs(high) || 1) : 0 }];
    }).sort((a, b) => b.spread - a.spread).map(({ spread, ...r }) => r);
  }

  /** The last few samples of each of a widget's headlines, for explaining a change. */
  recent(key: string, n = 12) { return [...this.series].filter(([k]) => k.startsWith(`${key}#`)).map(([, v]) => v.slice(-n).map(p => p[1])); }

  /** Record this card's headline numbers, then give back the card with a day of history on any headline that has no
   *  graph of its own. */
  apply(key: string, card: Card): Card {
    const now = Date.now(), cutoff = now - this.hours * 36e5;
    const fill = (s: Summary | undefined, i: number): Summary | undefined => {
      if (!s) return s;
      const id = `${key}#${i}`, list = this.series.get(id) ?? [], v = numberOf(s.value);
      this.labels.set(id, s.label);
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
