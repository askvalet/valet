// Live widget data. One poller per widget, shared by every open tab, and only running while at least one tab is
// connected: an idle homepage makes zero requests to your services.
import type { Instance } from './core.ts';
import type { History } from './history.ts';
import type { WidgetState } from '../shared/cards.ts';

type Listener = (s: WidgetState) => void;
type Change = (key: string, prev: WidgetState | undefined, next: WidgetState) => void;

export class Hub {
  private state = new Map<string, WidgetState>();
  private timers = new Map<string, NodeJS.Timeout>();
  private listeners = new Set<Listener>();
  private inflight = new Set<string>();
  private again = new Set<string>();   // a refresh was asked for while one was running: run once more after

  private instances: Map<string, Instance>;
  private onChange?: Change;
  private history?: History;
  constructor(instances: Map<string, Instance>, onChange?: Change, history?: History) { this.instances = instances; this.onChange = onChange; this.history = history; }

  /** Sample every widget every `ms` even with nobody watching, so history has no gaps. */
  sampleInBackground(ms: number) {
    for (const [inst, i] of this.instances) for (const name of Object.keys(i.widgets)) {
      setInterval(() => { if (!this.listeners.size) this.refresh(`${inst}.${name}`); }, ms).unref();
    }
  }

  widget(key: string) {
    const [inst, name] = key.split('.');
    return this.instances.get(inst)?.widgets[name];
  }

  snapshot() { return [...this.state.values()]; }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.start();
    return () => { this.listeners.delete(fn); if (!this.listeners.size) this.stop(); };
  }

  /** Refresh one widget now (after an action changed something) instead of waiting for its timer. */
  async refresh(key: string) {
    const w = this.widget(key);
    if (!w) return;
    if (this.inflight.has(key)) { this.again.add(key); return; }
    this.inflight.add(key);
    let next: WidgetState;
    try { const card = await w.fetch(); next = { key, card: this.history ? this.history.apply(key, card) : card, at: Date.now() }; }
    catch (e) { next = { key, error: (e as Error).message, at: Date.now(), card: this.state.get(key)?.card }; }
    finally { this.inflight.delete(key); }
    const prev = this.state.get(key);
    this.state.set(key, next);
    // don't push identical cards: most refreshes of a quiet service change nothing
    if (!prev || JSON.stringify(prev.card) !== JSON.stringify(next.card) || prev.error !== next.error) {
      if (!next.error) this.onChange?.(key, prev, next);
      for (const l of this.listeners) l(next);
    }
    if (this.again.delete(key)) await this.refresh(key);
  }

  refreshInstance(inst: string) {
    for (const name of Object.keys(this.instances.get(inst)?.widgets ?? {})) this.refresh(`${inst}.${name}`);
  }

  private start() {
    for (const [inst, i] of this.instances) for (const [name, w] of Object.entries(i.widgets)) {
      const key = `${inst}.${name}`;
      this.refresh(key);
      this.timers.set(key, setInterval(() => this.refresh(key), w.interval ?? 10_000));
    }
  }

  private stop() { for (const t of this.timers.values()) clearInterval(t); this.timers.clear(); }
}
