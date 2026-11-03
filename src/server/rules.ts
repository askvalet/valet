// Standing instructions: "when X happens, do Y", approved once in chat, then run by a plain rule with no model involved.
// A reminder (watches.ts) with an action and the option to repeat. The approval is the standing permission, so what a
// rule may do is held in code here, and checked again every time it runs: one integration tool, at a level
// `assistant.access` still grants, with input that still passes the tool's own check, on a page that may act.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { stateOf, type Card, type Confirm, type ListCard, type WidgetState } from '../shared/cards.ts';
import type { Instance, Tool } from './core.ts';
import { rank, who } from './run.ts';
import { sandbox } from './sandbox.ts';
import { has, reading, running, titles } from './watches.ts';

const widget = z.string().max(80).describe('widget key, e.g. downloads.active');
const name = z.string().max(80).optional();
export const When = z.object({
  widget, on: z.enum(['ends', 'starts', 'down', 'up', 'above', 'below']),
  name: name.describe('ends / starts: part of its title; down / up: the service; above / below: the number\'s label. Leave out for anything on that card'),
  value: z.number().optional().describe('above / below: the limit'),
  minutes: z.number().min(0).max(1440).default(0).describe('down / up / above / below: how long it must hold first'),
}).strict();
export const OnlyIf = z.object({ widget, on: z.enum(['running', 'idle', 'down', 'up', 'above', 'below']), name, value: z.number().optional() }).strict();
export const RuleInput = z.object({
  when: When.optional().describe('what sets it off. Use this or at'),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time like 07:00').optional().describe('every day at this time, 24-hour "HH:MM", in the home\'s time zone'),
  onlyIf: OnlyIf.optional().describe('and only if this is true at that moment'),
  tool: z.string().max(120).optional().describe('the one tool it runs, by its full name, e.g. downloads__pause_downloads. Leave out to only send the message'),
  input: z.record(z.string(), z.unknown()).optional().describe('that tool\'s input'),
  say: z.string().min(1).max(200).describe('the message they get each time it runs'),
  repeat: z.boolean().default(true).describe('false: run once, then it\'s gone'),
  cooldown: z.number().int().min(1).max(10080).default(30).describe('minutes before it may run again'),
}).strict();
export type RuleInput = z.infer<typeof RuleInput>;

export interface Rule {
  id: string; by: string; created: number;
  when?: z.infer<typeof When>; at?: string; onlyIf?: z.infer<typeof OnlyIf>;
  action?: { tool: string; input: unknown; does: string };   // does: the action tool's own words, from its confirm
  say: string; repeat: boolean; cooldown: number;
  armed: boolean;            // a condition that holds fires once, then again only after it has stopped holding
  slot?: number;             // a timed rule: the last time of day it dealt with
  lastRun?: number; lastError?: string; failures: number;
  paused?: string;           // why it isn't running, in words
}

/** Integrations whose tools a rule may never call: the config, Valet's own tools (rules, reminders, bug reports) and pins.
 *  `plan`, MCP tools and the other built-ins aren't integration tools, so they can't be named at all. */
export const FORBIDDEN = new Set(['config', 'valet', 'pins']);
export const MAX_RULES = 20, FAILS = 3, LATE_MS = 15 * 60_000;

export interface RuleEnv {
  instances(): Map<string, Instance>;
  /** What `assistant.access` grants this integration now (run.ts's rank). */
  access(id: string): number;
  acting(): boolean;
  /** A placed widget's own title, or nothing if it isn't on the page. */
  title(widget: string): string | undefined;
  act(r: Rule, step: Step): Promise<{ ok: boolean; error?: string }>;
  tell(n: { text: string; sub?: string; tone: 'accent' | 'bad'; rule: Rule }): void;
}
export interface Step { id: string; name: string; t: Tool; args: unknown }

const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'rules.json');
export const loadRules = (): Promise<Rule[]> => readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []);
async function save(list: Rule[]) {
  if (sandbox.on) return;
  await mkdir(dirname(FILE()), { recursive: true });
  await writeFile(`${FILE()}.tmp`, JSON.stringify(list, null, 2), { mode: 0o600 }); await rename(`${FILE()}.tmp`, FILE());
}

/** The one tool a rule may run, checked as it stands now. An error says why not, in words. */
export function actionFor(tool: string, input: unknown, env: Pick<RuleEnv, 'instances' | 'access'>): Step | { error: string } {
  const cut = tool.indexOf('__'), id = cut > 0 ? tool.slice(0, cut) : '', name = cut > 0 ? tool.slice(cut + 2) : '';
  if (!id || !name) return { error: `${tool} isn't an integration's tool: a rule runs exactly one, never a plan, an MCP tool or a built-in` };
  if (id === 'config') return { error: 'a rule can\'t change Valet\'s config' };
  if (FORBIDDEN.has(id)) return { error: `a rule can't use ${id === 'valet' ? 'Valet\'s own tools' : `${id} tools`}` };
  const t = env.instances().get(id)?.tools?.[name];
  if (!t) return { error: `no tool ${tool}` };
  if (t.access === 'read') return { error: `${tool} only looks, so a rule has nothing to do with it: leave the tool out to just send the message` };
  const level = env.access(id);
  if (level < rank[t.access]) return { error: `${tool} needs ${t.access} access, and assistant.access gives ${id} ${(Object.keys(rank) as (keyof typeof rank)[]).find(k => rank[k] === level)}` };
  const args = t.input.safeParse(input ?? {});
  if (!args.success) return { error: `${tool}: ${args.error.issues[0]?.path.join('.') || 'input'}: ${args.error.issues[0]?.message}` };
  return { id, name, t, args: args.data };
}

/** Why a rule can't run right now, or nothing. Asked every time it's about to run. */
export function blocked(r: Pick<Rule, 'action'>, env: Pick<RuleEnv, 'instances' | 'access' | 'acting'>) {
  if (!env.acting()) return 'Valet is read-only now, so nothing may act';
  if (env.access('valet') < rank.control) return 'rules are off: assistant.access.valet is below control';
  if (r.action) { const a = actionFor(r.action.tool, r.action.input, env); if ('error' in a) return a.error; }
  return undefined;
}

// --- when it goes off ---------------------------------------------------------------------------------------------

/** What's live on a card, a row each: its rows when it has them, otherwise its activity. */
const rows = (c: Card) => (c.type === 'media' || c.type === 'list' || c.type === 'shelf') && c.items.length ? c.items.map(i => i.title) : titles(c);

/** Whether a condition is true of this card now; null when the card can't say. */
export function holds(c: { on: string; name?: string; value?: number }, card: Card | undefined): boolean | null {
  if (!card) return null;
  if (c.on === 'running' || c.on === 'idle') return running(card, c.name) === (c.on === 'running');
  if (c.on === 'down' || c.on === 'up') {
    if (card.type !== 'status') return null;
    const items = card.items.filter(i => has(i.name, c.name));
    if (!items.length) return null;
    const down = items.some(i => stateOf(i) === 'down');
    return c.on === 'down' ? down : !down;
  }
  const v = reading(card, c.name);
  if (v == null || c.value == null) return null;
  return c.on === 'above' ? v > c.value : v < c.value;
}

/** What made it go off, for the message: which services, which number, which download. */
function because(c: { on: string; name?: string }, prev: Card | undefined, next: Card) {
  if (c.on === 'down' && next.type === 'status') return next.items.filter(i => has(i.name, c.name) && stateOf(i) === 'down').map(i => i.name).join(', ');
  if (c.on === 'above' || c.on === 'below') return `${c.name ?? 'it'}: ${reading(next, c.name)}`;
  if ((c.on === 'ends' || c.on === 'starts') && prev) {
    const [a, b] = c.on === 'ends' ? [rows(prev), rows(next)] : [rows(next), rows(prev)];
    return a.filter(t => !b.includes(t) && has(t, c.name)).join(', ') || undefined;
  }
  return undefined;
}

export const slotOf = (at: string, now: number) => { const [h, m] = at.split(':').map(Number), d = new Date(now); d.setHours(h, m, 0, 0); return d.getTime(); };
/** When a timed rule runs next: today if that time is still ahead, otherwise tomorrow. */
export function nextRun(at: string, now = Date.now()) {
  const today = slotOf(at, now);
  if (now < today) return today;
  const d = new Date(now); d.setDate(d.getDate() + 1);
  return slotOf(at, d.getTime());
}

/** Whether a rule goes off now, and why. It keeps its own bookkeeping (armed, slot) on the rule and in `held`.
 *  `cards`: the trigger widget's previous and current card, and the `onlyIf` widget's current one. */
export function triggered(r: Rule, cards: { prev?: Card; next?: Card; check?: Card }, held: Map<string, number>, now = Date.now()): { because?: string } | null {
  const also = !r.onlyIf || holds(r.onlyIf, cards.check) === true;
  if (r.at) {
    const slot = slotOf(r.at, now);
    if (now < slot || (r.slot ?? r.created) >= slot) return null;
    r.slot = slot;                                     // dealt with, whether it runs or not
    return now - slot <= LATE_MS && also ? {} : null;  // a run missed while Valet was down isn't made up hours later
  }
  const w = r.when!, { prev, next } = cards;
  if (!next) return null;
  const cool = !r.lastRun || now - r.lastRun >= r.cooldown * 60_000;
  if (w.on === 'ends' || w.on === 'starts') {
    if (!prev) return null;
    const fired = w.name
      ? (w.on === 'ends' ? running(prev, w.name) && !running(next, w.name) : !running(prev, w.name) && running(next, w.name))
      : !!because(w, prev, next) || (w.on === 'ends' ? !!prev.activity && !next.activity : !prev.activity && !!next.activity);
    return fired && cool && also ? { because: because(w, prev, next) } : null;
  }
  const h = holds(w, next);
  if (h === null) return null;
  if (!h) { r.armed = true; held.delete(r.id); return null; }
  if (!held.has(r.id)) held.set(r.id, now);
  if (!r.armed || now - held.get(r.id)! < w.minutes * 60_000 || !cool || !also) return null;
  r.armed = false;
  return { because: because(w, prev, next) };
}

// --- in words -----------------------------------------------------------------------------------------------------

// a person's words go in quotes, on one line; what Valet itself writes around them is never theirs
const quote = (s?: string) => s ? `"${s.replace(/[\u0000-\u001f\u007f"“”]+/g, ' ').trim().slice(0, 80)}"` : undefined;
const mins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;
const state = (c: { widget: string; on: string; name?: string; value?: number }, title: (w: string) => string | undefined) => {
  const card = title(c.widget) ?? c.widget, n = quote(c.name);
  switch (c.on) {
    case 'running': return `${n ?? 'something'} on ${card} is running`;
    case 'idle': return `nothing${n ? ` like ${n}` : ''} on ${card} is running`;
    case 'down': return `${n ?? 'anything'} on ${card} is down`;
    case 'up': return `${n ?? 'everything'} on ${card} is up`;
    default: return `${n ?? 'the number'} on ${card} is ${c.on} ${c.value}`;
  }
};
/** "When something on Downloads finishes", "Every day at 07:00, if anything on Services is down". Built from the
 *  widget's real title and the rule's fields, so the words on the approval card can't be written by the model. */
export function trigger(r: Pick<Rule, 'when' | 'at' | 'onlyIf'>, title: (w: string) => string | undefined) {
  let s: string;
  if (r.at) s = `Every day at ${r.at}`;
  else {
    const w = r.when!, held = w.minutes ? ` for ${mins(w.minutes)}` : '';
    s = w.on === 'ends' || w.on === 'starts'
      ? `When ${quote(w.name) ?? 'something'} on ${title(w.widget) ?? w.widget} ${w.on === 'ends' ? 'finishes' : 'starts'}`
      : `When ${state(w, title)}${held}`;
  }
  return r.onlyIf ? `${s}, if ${state(r.onlyIf, title)}` : s;
}
const lower = (s: string) => s.replace(/^\p{Lu}(?!\p{Lu})/u, c => c.toLowerCase());
/** The whole rule, for the list: trigger, then what it does. */
export const sentence = (r: Rule, title: (w: string) => string | undefined) => `${trigger(r, title)}: ${r.action ? lower(r.action.does) : 'tell you'}`;

/** The action in its tool's own words: its confirm, which may look things up. Its label if it has none, or it fails. */
async function words(s: Step): Promise<Confirm> {
  const fallback = { title: s.t.label ?? s.name.replace(/_/g, ' ') };
  try { return s.t.confirm ? await s.t.confirm(s.args) : fallback; } catch { return fallback; }
}
const plain = (c: Confirm) => c.title.replace(/\?$/, '');

// --- the store and its clock ----------------------------------------------------------------------------------------

export class Rules {
  list: Rule[];
  readonly env: RuleEnv;
  private seen = new Map<string, Card | undefined>();
  private held = new Map<string, number>();
  private busy = new Set<string>();
  private timer?: NodeJS.Timeout;
  private snapshot?: () => WidgetState[];
  private refresh?: (key: string) => void;
  constructor(list: Rule[], env: RuleEnv) { this.list = list; this.env = env; }

  /** Checked in full, as on the approval card: the trigger's widgets are on the page, the action is allowed now. */
  async prepare(input: RuleInput): Promise<{ rule: Omit<Rule, 'id' | 'by' | 'created'>; confirm?: Confirm } | { error: string }> {
    if (!!input.when === !!input.at) return { error: 'a rule needs one trigger: when (something happens) or at (a time of day)' };
    for (const c of [input.when, input.onlyIf]) {
      if (!c) continue;
      if (!this.env.title(c.widget)) return { error: `no widget ${c.widget} on the page` };
      if ((c.on === 'above' || c.on === 'below') && c.value == null) return { error: 'above and below need a value' };
    }
    if (this.list.length >= MAX_RULES) return { error: `that's ${MAX_RULES} rules already; remove one first` };
    if (!this.env.acting()) return { error: 'Valet is read-only, so it can\'t set up rules' };
    if (this.env.access('valet') < rank.control) return { error: 'rules are off: assistant.access.valet is below control' };
    let action: Rule['action'], confirm: Confirm | undefined;
    if (input.tool) {
      const step = actionFor(input.tool, input.input, this.env);
      if ('error' in step) return step;
      confirm = await words(step);
      action = { tool: input.tool, input: step.args, does: plain(confirm) };
    }
    return { rule: { when: input.when, at: input.at, onlyIf: input.onlyIf, action, say: input.say, repeat: input.repeat, cooldown: input.cooldown, armed: true, failures: 0 }, confirm };
  }
  async add(input: RuleInput, by = who()) {
    const p = await this.prepare(input);
    if ('error' in p) return p;
    const rule: Rule = { ...p.rule, id: randomBytes(4).toString('hex'), by, created: Date.now() };
    this.list.push(rule); await save(this.list);
    // it starts watching now, not at the next half minute: a condition already true is what was approved
    if (rule.when) for (const k of new Set([rule.when.widget, rule.onlyIf?.widget])) if (k) this.refresh?.(k);
    return { rule };
  }
  async remove(id: string) {
    const before = this.list.length;
    this.list = this.list.filter(r => r.id !== id);
    if (this.list.length !== before) await save(this.list);
    return this.list.length !== before;
  }
  /** Pause, or resume: a resumed rule starts afresh, and only if it could run now. */
  async pause(id: string, on: boolean) {
    const r = this.list.find(x => x.id === id);
    if (!r) throw new Error('no such rule');
    if (on) r.paused = 'you paused it';
    else {
      const why = blocked(r, this.env);
      if (why) throw new Error(`it can't run: ${why}`);
      Object.assign(r, { paused: undefined, failures: 0, lastError: undefined, armed: true });
    }
    await save(this.list);
    return r;
  }

  check(states: WidgetState[], now = Date.now()) {
    const card = (key?: string) => { const s = key ? states.find(x => x.key === key) : undefined; return s && !s.error ? s.card : undefined; };
    const before = JSON.stringify(this.list);
    for (const r of this.list) {
      if (r.paused || this.busy.has(r.id)) continue;
      const hit = triggered(r, { prev: r.when && this.seen.get(r.when.widget), next: card(r.when?.widget), check: card(r.onlyIf?.widget) }, this.held, now);
      if (hit) void this.fire(r, hit.because, now);
    }
    for (const s of states) if (!s.error) this.seen.set(s.key, s.card);
    if (JSON.stringify(this.list) !== before) void save(this.list).catch(() => {});
  }

  /** Run it: re-checked first, then the action through the same door as the chat, then the message. */
  async fire(r: Rule, why: string | undefined, now = Date.now()) {
    if (r.paused || this.busy.has(r.id)) return;
    this.busy.add(r.id);
    try {
      const no = blocked(r, this.env);
      if (no) {
        r.paused = `can't run: ${no}`;
        this.env.tell({ text: `Paused a rule: ${r.say}`, sub: no, tone: 'bad', rule: r });
        return;
      }
      const step = r.action && actionFor(r.action.tool, r.action.input, this.env) as Step;
      const out = step ? await this.env.act(r, step) : { ok: true };
      r.lastRun = now;
      if (out.ok) {
        Object.assign(r, { failures: 0, lastError: undefined });
        this.env.tell({ text: r.say, sub: why, tone: 'accent', rule: r });
        if (!r.repeat) this.list = this.list.filter(x => x !== r);
        return;
      }
      r.failures++; r.lastError = out.error;
      if (r.failures >= FAILS) {
        r.paused = `failed ${FAILS} times in a row`;
        this.env.tell({ text: `Paused a rule after ${FAILS} failures: ${r.say}`, sub: out.error, tone: 'bad', rule: r });
      } else this.env.tell({ text: `A rule failed: ${r.say}`, sub: out.error, tone: 'bad', rule: r });
    } finally {
      this.busy.delete(r.id);
      await save(this.list).catch(() => {});
    }
  }

  /** The widgets to keep fresh: a rule's trigger and its only-if, and a timed rule's only-if in the minutes before it runs. */
  watching(now = Date.now()) {
    const keys = new Set<string>();
    for (const r of this.list) {
      if (r.paused) continue;
      if (r.when) { keys.add(r.when.widget); if (r.onlyIf) keys.add(r.onlyIf.widget); }
      else if (r.onlyIf && r.at) { const slot = slotOf(r.at, now); if (slot - now < 120_000 && (r.slot ?? r.created) < slot) keys.add(r.onlyIf.widget); }
    }
    return keys;
  }
  /** Check every half minute, and whenever a widget changes; keep what rules watch fresh even with nobody looking. */
  start(snapshot: () => WidgetState[], refresh: (key: string) => void) {
    this.snapshot = snapshot; this.refresh = refresh;
    const tick = () => {
      const states = snapshot();
      for (const k of this.watching()) if (Date.now() - (states.find(s => s.key === k)?.at ?? 0) > 55_000) refresh(k);
      this.check(snapshot());
    };
    this.timer = setInterval(tick, 30_000);
    this.timer.unref?.();
    setTimeout(tick, 0).unref?.();
  }
  /** A widget changed: see whether that sets anything off. */
  changed() { if (this.snapshot && this.list.length) this.check(this.snapshot()); }
  stop() { clearInterval(this.timer); this.snapshot = this.refresh = undefined; }

  /** The list card: each rule in words, when it last ran, when a timed one runs next, and a dot when it's in trouble. */
  card(now = Date.now()): ListCard {
    const title = (w: string) => this.env.title(w);
    const at = (t: number) => new Date(t).toDateString() === new Date(now).toDateString() ? new Date(t).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : new Date(t).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return { type: 'list', title: 'Rules', icon: 'pulse', empty: 'No rules yet. Ask the assistant: "when a download finishes, tell me"',
      items: this.list.map(r => {
        const no = r.paused ? undefined : blocked(r, this.env);
        const said = r.paused ? `Paused: ${r.paused}` : no ? `Can't run: ${no}` : r.lastError ? `Failed: ${r.lastError}` : r.lastRun ? `Last ran ${at(r.lastRun)}` : 'Not run yet';
        return { id: r.id, title: sentence(r, title), subtitle: said, meta: r.at && !r.paused ? `Next ${at(nextRun(r.at, now))}` : undefined,
          tone: r.lastError || no ? 'bad' as const : undefined, dot: r.paused ? 'warn' as const : r.failures || no ? 'bad' as const : undefined,
          buttons: [{ label: r.paused ? 'Resume' : 'Pause', action: 'rule_pause', args: { id: r.id, on: !r.paused } }, { label: 'Remove', action: 'rule_remove', args: { id: r.id } }] };
      }) };
  }
}

/** The chat's tools for rules. Setting one up is `control`: it's a standing permission, so it asks, and its card says
 *  what will really happen in the action tool's own words. */
export function ruleTools(rules: Rules, widgets: string[]): Record<string, Tool> {
  const title = (w: string) => rules.env.title(w);
  return {
    rule_add: {
      label: 'Set up a rule', followUps: ['What rules are there?'], access: 'control', input: RuleInput,
      description: `A standing instruction: every time something happens (when) or every day at a time (at), optionally only if something else is true (onlyIf), run one tool (tool + input) and send a message (say). It runs by itself from then on with no model, so use it only when asked for something that repeats ("whenever", "every time", "every morning"); for a one-off "tell me when", use watch_add. when.on: ends / starts (a download or stream), down / up (a service), above / below (a number, with minutes it must hold). The tool must be one integration tool you were given (not plan, config, MCP or Valet's own), with its exact input. Widgets: ${widgets.join(', ') || 'see the page'}.`,
      async confirm(input) {
        const p = await rules.prepare(input);
        if ('error' in p) return { title: 'This rule can\'t be set up', detail: p.error, icon: 'pulse', verb: 'OK' };
        const r = p.rule, c = p.confirm;
        return {
          title: `${trigger(r, title)}, ${c ? lower(plain(c)) : 'send you a message'}?`,
          detail: [c?.detail, `Then it tells you ${quote(r.say)}`, r.repeat ? `Every time, at most once every ${mins(r.cooldown)}, without asking again` : 'Once, then it\'s gone'].filter(Boolean).join('. '),
          icon: c?.icon ?? 'pulse', logo: c?.logo, verb: 'Set up rule', danger: c?.danger,
        };
      },
      async run(input) {
        const r = await rules.add(input);
        if ('error' in r) return { data: { error: r.error } };
        return { data: { set: true, id: r.rule.id, rule: sentence(r.rule, title), next: r.rule.at ? new Date(nextRun(r.rule.at)).toString() : undefined }, card: rules.card() };
      },
    },
    rule_list: {
      label: 'Checked rules', access: 'read', input: z.object({}),
      description: 'The standing instructions (rules) there are: what each does, when it last ran, and whether it\'s paused or failing.',
      async run() {
        return { data: rules.list.map(r => ({ id: r.id, rule: sentence(r, title), say: r.say, repeat: r.repeat, lastRun: r.lastRun && new Date(r.lastRun).toString(), next: r.at && !r.paused ? new Date(nextRun(r.at)).toString() : undefined, paused: r.paused, lastError: r.lastError, cantRun: r.paused ? undefined : blocked(r, rules.env) })), card: rules.card() };
      },
    },
    rule_remove: {
      label: 'Removed a rule', access: 'write', input: z.object({ id: z.string().max(20) }),
      description: 'Remove a rule by id, so it never runs again.',
      confirm: ({ id }) => { const r = rules.list.find(x => x.id === id); return { title: 'Remove this rule?', detail: r ? sentence(r, title) : 'There\'s no rule with that id', icon: 'pulse', verb: 'Remove' }; },
      async run({ id }) { return { data: { removed: await rules.remove(id) }, card: rules.card() }; },
    },
  };
}
