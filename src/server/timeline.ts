// What happened and when, kept for a couple of weeks in data/timeline.json: things starting and ending, services going
// down and coming back, problems appearing and clearing, what was changed. It's what lets the assistant answer "what
// happened last night" rather than only "what's happening now".
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sandbox } from './sandbox.ts';
import { replaceFile } from './write.ts';

export interface Event { at: number; kind: string; widget?: string; text: string }
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'timeline.json');
const KEEP_MS = 14 * 864e5, KEEP_N = 4000;

export class Timeline {
  events: Event[] = [];
  private timer?: NodeJS.Timeout;
  async load() { this.events = await readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []); return this; }
  add(kind: string, text: string, widget?: string, at = Date.now()) {
    this.events.push({ at, kind, widget, text });
    const cutoff = Date.now() - KEEP_MS;
    if (this.events.length > KEEP_N || this.events[0].at < cutoff) this.events = this.events.filter(e => e.at >= cutoff).slice(-KEEP_N);
    // written shortly after, so a burst of changes is one write
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 2000);
    this.timer.unref?.();
  }
  async save() {
    if (sandbox.on) return;
    await replaceFile(FILE(), JSON.stringify(this.events));
  }
  since(ms: number) { const from = Date.now() - ms; return this.events.filter(e => e.at >= from); }
  /** Problems logged and never cleared. A restart forgets what's open, so the next run has to settle these. */
  unresolved() {
    const open = new Set<string>();
    for (const e of this.events) { if (e.kind === 'problem') open.add(e.text); else if (e.kind === 'cleared') open.delete(e.text); }
    return [...open];
  }
  /** One line each, for prompts. `news` leaves out what went wrong: that may be over, and the prompt has what's wrong now. */
  lines(ms: number, n = 40, news = false) {
    return this.since(ms).filter(e => !news || (e.kind !== 'problem' && e.kind !== 'down')).slice(-n).map(e => `${new Date(e.at).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ${e.kind}: ${e.text}`);
  }
}
