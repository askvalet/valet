// Each person's own activity on a shared service (`people:` on its block, people.mdx). The integration is made again for
// one user on that service (`Context.as`), with the block's own key, so its personal widgets and its tools show only that
// user's. Two Valet people mapped to the same user share one copy. Its cards live here, apart from the shared hub: each
// personal widget has a hub of its own per user, polled only while someone it's for has it open, and nothing here reaches
// the timeline, notices, events, history or rules, which are the whole house's and owners'. Who gets which is people.ts's.
import type { Instance } from './core.ts';
import { Hub } from './hub.ts';
import type { WidgetState } from '../shared/cards.ts';

const same = (n: string) => n.trim().toLowerCase();

export interface Mapped {
  /** a Valet person, compared without case as profiles are, → the service's name for them */
  names: Map<string, string>;
  /** the integration made for one of those users */
  make(as: string): Instance;
}

export class Personal {
  private made = new Map<string, Instance>();
  private hubs = new Map<string, Hub>();
  private mapped: Map<string, Mapped>;
  private shared: Map<string, Instance>;
  private placed: Set<string>;
  private every: Map<string, number>;
  constructor(o: { mapped?: Map<string, Mapped>; shared: Map<string, Instance>; placed: Set<string>; every?: Map<string, number> }) {
    this.mapped = o.mapped ?? new Map(); this.shared = o.shared; this.placed = o.placed; this.every = o.every ?? new Map();
  }

  /** The integrations this person has their own on, each with the service's name for them. Nobody without a name has any. */
  of(person?: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!person) return out;
    for (const [id, m] of this.mapped) { const as = m.names.get(same(person)); if (as) out.set(id, as); }
    return out;
  }

  /** A widget that shows whose activity it is, on an integration with `people:`. */
  personal(key: string) {
    const dot = key.indexOf('.'), id = key.slice(0, dot);
    return this.mapped.has(id) && !!this.shared.get(id)?.widgets[key.slice(dot + 1)]?.personal;
  }

  /** The integration as one user on it: made once, and kept as long as this config is. */
  instance(id: string, as: string): Instance {
    const k = `${id}\n${same(as)}`;
    let inst = this.made.get(k);
    if (!inst) { const m = this.mapped.get(id); if (!m) throw new Error(`${id} has no people`); this.made.set(k, inst = m.make(as)); }
    return inst;
  }

  /** One personal widget as one user sees it. A hub each, so a widget is fetched only while someone who sees it is looking. */
  hub(key: string, as: string): Hub | undefined {
    if (!this.personal(key) || !this.placed.has(key)) return undefined;
    const dot = key.indexOf('.'), id = key.slice(0, dot), w = key.slice(dot + 1), k = `${key}\n${same(as)}`;
    let hub = this.hubs.get(k);
    if (!hub) {
      const def = this.instance(id, as).widgets[w];
      if (!def) return undefined;
      hub = new Hub(new Map([[id, { widgets: { [w]: this.every.has(key) ? { ...def, interval: this.every.get(key) } : def } }]]));
      this.hubs.set(k, hub);
    }
    return hub;
  }

  /** The personal cards one person has now (`own`: what people.ts gave them), for the pictures they may load. */
  snapshot(own: Map<string, string>): WidgetState[] {
    return [...this.placed].flatMap(key => { const as = own.get(key.slice(0, key.indexOf('.'))); return as && this.personal(key) ? this.hubs.get(`${key}\n${same(as)}`)?.snapshot() ?? [] : []; });
  }

  /** After an action: the personal cards of that integration that someone is looking at, again now. */
  refreshInstance(id: string) {
    for (const [k, hub] of this.hubs) if (k.startsWith(`${id}.`) && hub.watched) hub.refreshInstance(id);
  }

  dispose() { for (const h of this.hubs.values()) h.dispose(); this.hubs.clear(); }
}
