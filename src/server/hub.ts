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
  private again = new Set<string>();   // a refresh was asked for while one was running: run once more after

  private instances: Map<string, Instance>;
  private onChange?: Change;
  private history?: History;
  /** Called after any change, errors included (onChange skips those). */
  watch?: () => void;
  constructor(instances: Map<string, Instance>, onChange?: Change, history?: History) { this.instances = instances; this.onChange = onChange; this.history = history; }

  /** Sample every widget every `ms` even with nobody watching, so history has no gaps. */
  sampleInBackground(ms: number) {
    for (const [inst, i] of this.instances) for (const name of Object.keys(i.widgets)) {
      this.background.push(setInterval(() => { if (!this.listeners.size) this.refresh(`${inst}.${name}`); }, ms).unref());
    }
  }
  private background: NodeJS.Timeout[] = [];

  /** Stop every timer and forget every listener (the config was reloaded; a new hub takes over). */
  dispose() { this.stop(); for (const t of this.background) clearInterval(t); this.background = []; this.listeners.clear(); }

  widget(key: string) {
    const [inst, name] = key.split('.');
    return this.instances.get(inst)?.widgets[name];
  }

  snapshot() { return [...this.state.values()]; }

  /** whether any page is listening now */
  get watched() { return this.listeners.size > 0; }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.start();
    return () => { this.listeners.delete(fn); if (!this.listeners.size) this.stop(); };
  }

  /** Refresh one widget now (after an action changed something) instead of waiting for its timer. Asked again while it
   *  runs, it runs once more after; that caller doesn't wait. */
  refresh(key: string): Promise<void> {
    const w = this.widget(key);
    if (!w) return Promise.resolve();
    const running = this.running.get(key);
    if (running) { this.again.add(key); return Promise.resolve(); }
    const run = this.fetch(key, w).finally(() => this.running.delete(key)).then(() => this.again.delete(key) ? this.refresh(key) : undefined);
    this.running.set(key, run);
    return run;
  }
  private running = new Map<string, Promise<void>>();

  private async fetch(key: string, w: NonNullable<ReturnType<Hub['widget']>>) {
    let next: WidgetState;
    try { const card = await w.fetch(); next = { key, card: this.history ? this.history.apply(key, card) : card, at: Date.now() }; }
    catch (e) { next = { key, error: (e as Error).message, at: Date.now(), card: this.state.get(key)?.card }; }
    const prev = this.state.get(key);
    this.state.set(key, next);
    // don't push identical cards: most refreshes of a quiet service change nothing
    if (!prev || JSON.stringify(prev.card) !== JSON.stringify(next.card) || prev.error !== next.error) {
      if (!next.error) this.onChange?.(key, prev, next);
      for (const l of this.listeners) l(next);
      this.watch?.();
      // a card made from this one (`from`) follows it at once rather than at its own next turn
      for (const [inst, i] of this.instances) for (const [name, d] of Object.entries(i.widgets)) if (d.from === key) void this.refresh(`${inst}.${name}`);
    }
  }

  /** A widget's latest card, waiting for its first if it's on its way (or asking for it if nothing has yet). */
  async latest(key: string) {
    if (!this.state.has(key)) await (this.running.get(key) ?? this.refresh(key));
    const s = this.state.get(key);
    if (!s?.card && s?.error) throw new Error(`${key} couldn't be read: ${s.error}`);
    return s?.card;
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
