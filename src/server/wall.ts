// The wall display (/wall): pages of their own, from `wall:` in the config. What they show is also everything a paired
// screen (wall.token) may read, and `touch` is everything it may press, so both are worked out here once and the server
// holds a paired screen to them. Which pages may show now (`when`) is judged here too, from the time and the cards
// Valet already has: a pure function, so the screen is told which pages, and never who is home.
import type { Config, When } from './config.ts';
import type { Card, WidgetState } from '../shared/cards.ts';

type WallPage = NonNullable<Config['wall']['pages']>[number];
type Cond = NonNullable<When['any']>[number];
/** One screen: the wall itself (`name` is ''), or one of `wall.screens`. */
export interface WallView { name: string; where: string; pages: WallPage[]; touch: Config['wall']['touch']; token?: string }
type State = Pick<WidgetState, 'key' | 'card'>;

const pagesOf = (w: { pages?: WallPage[]; layout?: Config['layout'] }): WallPage[] => w.pages ?? (w.layout ? [{ clock: true, layout: w.layout }] : []);
/** The wall's pages as written: `pages`, or the one page `layout` is. None means the default page. */
export const wallPages = (config: Config): WallPage[] => pagesOf(config.wall);

/** The wall at /wall, or the screen at /wall/<name>; nothing for a name the config doesn't have. */
export function wallView(config: Config, name = ''): WallView | undefined {
  const { wall } = config, s = name ? Object.hasOwn(wall.screens, name) ? wall.screens[name] : undefined : wall;
  if (!s) return undefined;
  return { name, where: name ? `wall.screens.${name}` : 'wall', pages: pagesOf(s), touch: s.touch ?? [], token: s.token ?? wall.token };
}
export const wallViews = (config: Config) => ['', ...Object.keys(config.wall.screens)].map(n => wallView(config, n)!);
/** The screens a paired browser may be: every one its token pairs. */
export const viewsFor = (config: Config, token: string) => wallViews(config).filter(v => v.token === token);
export const wallTokens = (config: Config) => [...new Set(wallViews(config).flatMap(v => v.token ?? []))];

/** Every widget one screen's pages name, in order. */
export const widgetsOf = (v: WallView) => [...new Set(v.pages.flatMap(p => p.layout.flatMap(s => s.widgets.map(w => w.widget))))];
/** Every widget the wall's pages name, on every screen, in order. */
export const wallWidgets = (config: Config) => [...new Set(wallViews(config).flatMap(widgetsOf))];

const conds = (w?: When): Cond[] => w ? [w, ...w.any ?? []] : [];
const list = <T,>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const eventsOf = (v: WallView) => [...new Set(v.pages.flatMap(p => conds(p.when).flatMap(c => list(c.event))))];
const asksHome = (v: WallView) => v.pages.some(p => conds(p.when).some(c => c.home !== undefined));
/** Widgets a `when` reads that may be on no page: polled like the rest, and never sent to a paired screen for that. */
export const wallNeeds = (config: Config) => [...new Set(wallViews(config).flatMap(v => [...asksHome(v) && config.wall.people ? [config.wall.people] : [], ...eventsOf(v)]))];

// with no pages of its own, the wall shows the main page's services and what's playing or downloading
export const DEFAULT_KINDS = new Set(['status', 'media']);
/** Whether the default page could show: there are no pages, or every one waits on a `when`. */
const mayDefault = (v: WallView) => !v.pages.some(p => !p.when);

/** Whether a paired screen may hear this widget: one its pages name, or the weather beside its clock; and where the
 *  default page could show, a main-page card of the kinds it shows, judged by what the card is now. */
export function wallReads(config: Config, s: State, view: WallView = wallView(config)!) {
  if (s.key === config.weather || widgetsOf(view).includes(s.key)) return true;
  return mayDefault(view) && !!s.card && DEFAULT_KINDS.has(s.card.type) && config.layout.some(x => x.widgets.some(w => w.widget === s.key));
}

/** What doesn't add up: a card no integration has, a section the wall won't draw, a `when` that can never be judged.
 *  `kind` is a widget's card type, where its integration says it ahead of time. */
export function wallProblems(config: Config, has: (key: string) => boolean, kind: (key: string) => string | undefined = () => undefined): string[] {
  const { people } = config.wall;
  return [
    ...(people && !has(people) ? [`wall.people: no widget "${people}"`] : []),
    ...wallViews(config).flatMap(v => [
      ...v.touch.flatMap(t => !has(t.widget) ? [`${v.where}.touch: no widget "${t.widget}"`]
        : kind(t.widget) && !PRESSABLE.has(kind(t.widget)!) ? [`${v.where}.touch: ${t.widget} is a ${kind(t.widget)} card, and only controls and thermostat cards can be pressed`]
        : !widgetsOf(v).includes(t.widget) ? [`${v.where}.touch: ${t.widget} isn't on ${v.name ? 'that screen' : 'the wall'}'s pages`] : []),
      ...v.pages.flatMap((p, i) => {
        const where = (v.name ? config.wall.screens[v.name] : config.wall).pages ? `${v.where}.pages[${i}]${p.title ? ` (${p.title})` : ''}` : `${v.where}.layout`;
        return [
          ...p.layout.flatMap(s => [
            ...s.widgets.filter(w => !has(w.widget)).map(w => `${where}: no widget "${w.widget}"`),
            ...(s.chat ? [`${where}: chat never shows on a wall (the section's cards do)`] : []),
          ]),
          ...conds(p.when).flatMap(c => [
            ...list(c.event).filter(k => !has(k)).map(k => `${where}: when.event: no widget "${k}"`),
            ...(c.home !== undefined && !people ? [`${where}: when.home needs wall.people, the widget that says who's home`] : []),
          ]),
        ];
      }),
    ]),
  ];
}

// ── when a page shows ──────────────────────────────────────────────────────────────────────────────────────────────

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** The wall clock where the home is: minutes past midnight and the weekday, in `zone` (the server's own when left out). */
export function clockAt(now: number, zone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return { at: Number(get('hour')) * 60 + Number(get('minute')), day: DAYS.indexOf(get('weekday').toLowerCase() as typeof DAYS[number]) };
}
const minutes = (t: string) => { const [h, m] = t.trim().split(':').map(Number); return h * 60 + m; };
const onDays = (days: Cond['days'], day: number) => days === undefined || (days === 'weekdays' ? day >= 1 && day <= 5 : days === 'weekends' ? day === 0 || day === 6 : days.includes(DAYS[day]));
/** Inside a range, on a day that counts. After midnight an overnight range is still the evening's: Friday's 22:00-06:00
 *  runs into Saturday morning, and Saturday's hasn't begun. */
function inSpan(span: string, days: Cond['days'], at: number, day: number) {
  const [from, to] = span.split('-').map(minutes);
  if (from < to) return at >= from && at < to && onDays(days, day);
  return at >= from ? onDays(days, day) : at < to && onDays(days, (day + 6) % 7);
}

/** Who's home, read from any card that lists people: a `controls` card whose rows say Home (or are toned good, or
 *  switched on), or a `status` card whose rows are ok. Nothing when the card isn't one of those. */
export function peopleOf(card?: Card): { name: string; home: boolean }[] | undefined {
  if (card?.type === 'controls') return card.items.map(c => ({ name: c.label, home: c.value === true || c.tone === 'good' || /^home$/i.test(String(c.value ?? '')) }));
  if (card?.type === 'status') return card.items.map(s => ({ name: s.name, home: s.ok }));
  return undefined;
}

const MEETING = 30 * 6e4;   // how long a meeting with no end is taken to last, as the calendar takes it
/** Online meetings the cards know of: a calendar's events that have a way to join, and a meeting's ring. */
function meetingsOf(states: State[]) {
  return states.flatMap(({ card }) => {
    const ring = card?.activity?.icon === 'video' ? card.activity.countdown : undefined;
    const events = card?.type === 'calendar' ? card.events.filter(e => e.join && e.start.includes('T')).map(e => ({ start: Date.parse(e.start), end: e.end ? Date.parse(e.end) : NaN })) : [];
    return [...ring ? [{ start: ring.start, end: ring.end ?? NaN }] : [], ...events].map(m => ({ start: m.start, end: m.end > m.start ? m.end : m.start + MEETING }));
  });
}

/** What the wall remembers between looks, so a signal that flickers doesn't turn the page: each signal as last settled,
 *  and the takeovers under way. Plain data; `judge` returns the next one and changes nothing. */
export interface Mind { held?: Record<string, { on: boolean; since?: number }>; took?: Record<number, { at: number; quiet?: boolean }>; looked?: boolean }
// A change in who's home counts once it has lasted a minute (a phone dropping off the wifi isn't someone leaving).
// Something live counts at once, and for half a minute after it stops (a camera's event between two looks, a paused film).
export const PRESENCE_HOLD = 60_000, ACTIVITY_HOLD = 30_000, TAKEOVER = 60_000;

/** Which of a screen's pages may show at `now`: the ones taking turns, in order, and the one taking over if any.
 *  `ready` is false until every card a condition reads has reported once. Pure: the same inputs give the same answer. */
export function judge(view: WallView, config: Config, now: number, states: State[], mind: Mind = {}): { pages: number[]; takeover?: number; ready: boolean; mind: Mind } {
  const held = { ...mind.held }, took = { ...mind.took }, by = new Map(states.map(s => [s.key, s]));
  const settle = (key: string, raw: boolean, rise: number, fall: number) => {
    const h = held[key];
    if (!h) { held[key] = { on: raw }; return raw; }
    if (raw === h.on) { if (h.since !== undefined) held[key] = { on: h.on }; return h.on; }
    const since = h.since ?? now;
    held[key] = now - since >= (raw ? rise : fall) ? { on: raw } : { on: h.on, since };
    return held[key].on;
  };
  const { at, day } = clockAt(now, config.timezone);
  const people = config.wall.people ? peopleOf(by.get(config.wall.people)?.card)?.map(p => ({ name: p.name.trim().toLowerCase(), home: settle(`home:${p.name.trim().toLowerCase()}`, p.home, PRESENCE_HOLD, PRESENCE_HOLD) })) : undefined;
  // a ring that's still counting down to its start isn't live yet
  const liveNow = (s?: State) => !!s?.card?.activity && !(s.card.activity.countdown && s.card.activity.countdown.start > now);
  const scope = config.live?.activities.length ? config.live.activities.flatMap(k => by.get(k) ?? []) : states;
  const live = scope.map(s => settle(`live:${s.key}`, liveNow(s), 0, ACTIVITY_HOLD)).some(Boolean);
  const playing = scope.map(s => settle(`play:${s.key}`, liveNow(s) && s.card!.activity!.icon === 'play' && !s.card!.activity!.paused, 0, ACTIVITY_HOLD)).some(Boolean);
  const events = new Set(eventsOf(view).filter(k => settle(`event:${k}`, liveNow(by.get(k)), 0, ACTIVITY_HOLD)));
  const meetings = meetingsOf(states);

  const holds = (c: Cond) => {
    if (c.time !== undefined ? !list(c.time).some(t => inSpan(t, c.days, at, day)) : !onDays(c.days, day)) return false;
    if (c.home !== undefined) {
      if (!people) return false;   // nobody can say who's home, so nothing that asks is shown
      const home = people.filter(p => p.home).map(p => p.name), named = Array.isArray(c.home) ? c.home.map(n => n.trim().toLowerCase()) : [];
      if (c.home === 'any' ? !home.length : c.home === 'none' ? home.length > 0 : !named.every(n => home.includes(n)) || (!!c.only && home.some(n => !named.includes(n)))) return false;
    }
    if (c.live !== undefined && c.live !== live) return false;
    if (c.playing !== undefined && c.playing !== playing) return false;
    if (c.meeting !== undefined && !meetings.some(m => m.start - (c.meeting === true ? 10 * 6e4 : c.meeting!) <= now && now < m.end)) return false;
    if (c.event !== undefined && !list(c.event).some(k => events.has(k))) return false;
    return true;
  };
  const shows = (w?: When) => !w || (holds(w) && (!w.any || w.any.some(holds)));

  const pages: number[] = [];
  let takeover: number | undefined;
  view.pages.forEach((p, i) => {
    const on = shows(p.when);
    if (!p.takeover) { if (on) pages.push(i); return; }
    // it interrupts when its condition comes true, not because it already was when the wall was opened
    if (!on) { delete took[i]; return; }
    took[i] ??= { at: now, ...(mind.looked ? {} : { quiet: true }) };
    if (!took[i].quiet && now - took[i].at < (p.takeover === true ? TAKEOVER : p.takeover) && (takeover === undefined || took[i].at > took[takeover].at)) takeover = i;
  });
  const needs = [...asksHome(view) && config.wall.people ? [config.wall.people] : [], ...eventsOf(view)];
  const ready = needs.every(k => by.has(k));
  return { pages, ...(takeover !== undefined ? { takeover } : {}), ready, mind: { held, took, looked: mind.looked || ready } };
}

// ── what a touch may press ─────────────────────────────────────────────────────────────────────────────────────────

const PRESSABLE = new Set(['controls', 'thermostat']);
/** One thing a card offers to press: the action, the arguments the card gives it, and the one value a press may add. */
export interface Press { action: string; args: Record<string, unknown>; value?: { key: string; ok(v: unknown): boolean } }
const between = (min: number, max: number) => (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Everything on a card a touch could press, exactly as the card offers it. */
export function pressesOf(card?: Card): Press[] {
  if (card?.type === 'controls') return card.items.flatMap((c): Press[] => {
    if (!c.action || c.kind === 'value') return [];
    const value = c.kind === 'toggle' ? (v: unknown) => typeof v === 'boolean' : c.kind === 'slider' ? between(c.min ?? 0, c.max ?? 100) : c.kind === 'select' ? (v: unknown) => typeof v === 'string' && !!c.options?.includes(v) : undefined;
    return [{ action: c.action, args: c.args ?? {}, ...(value ? { value: { key: 'value', ok: value } } : {}) }];
  });
  if (card?.type === 'thermostat') return [
    ...card.set ? [{ action: card.set.action, args: card.set.args ?? {}, value: { key: 'temperature', ok: between(card.min, card.max) } }] : [],
    ...(card.modes ?? []).map(m => ({ action: m.action, args: m.args ?? {} })),
  ];
  return [];
}
const same = (a: unknown, b: unknown): boolean => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
  && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Object.hasOwn(b, k) && same(v, (b as Record<string, unknown>)[k])));

/** Whether a paired screen may make this press: the widget is on one of its screens' touch lists and on its pages, and
 *  its card offers this action now with exactly these arguments, plus at most the one value that press takes. So a wall
 *  that may switch the lamp can't reach the lock behind the same action. */
export function wallMayPress(views: WallView[], states: State[], inst: string, action: string, body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const given = body as Record<string, unknown>;
  const listed = new Set(views.flatMap(v => v.touch.map(t => t.widget).filter(k => k.split('.')[0] === inst && widgetsOf(v).includes(k))));
  return states.some(s => listed.has(s.key) && pressesOf(s.card).some(p => p.action === action
    && Object.keys(given).every(k => Object.hasOwn(p.args, k) ? same(p.args[k], given[k]) : p.value?.key === k && p.value.ok(given[k]))
    && Object.keys(p.args).every(k => Object.hasOwn(given, k))
    && (!p.value || Object.hasOwn(p.args, p.value.key) || Object.hasOwn(given, p.value.key))));
}

/** A paired screen's presses, counted: a stolen cookie can't hammer a light or a lock. Thirty a minute for each token. */
export class Presses {
  private hits = new Map<string, number[]>();
  allow(id: string, now: number, max = 30, per = 60_000) {
    const recent = (this.hits.get(id) ?? []).filter(t => now - t < per), ok = recent.length < max;
    if (ok) recent.push(now);
    this.hits.set(id, recent);
    return ok;
  }
}
