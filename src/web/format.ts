// How the page writes times, dates, numbers and its own words, as `format:` and `labels:` say. A module rather than
// React context, so a renderer swaps one call and needs nothing passed down; it's set before the page first draws, and
// a config reload redraws every card anyway.
import { stateOf, type Card, type StatusCard, type WidgetState } from '../shared/cards.ts';
import { LABELS, type Labels } from '../shared/labels.ts';

export interface Format { clock: 'auto' | '12h' | '24h'; date: 'short' | 'long' | 'numeric' | 'iso'; weekStart: 'auto' | 'monday' | 'sunday' | 'saturday'; locale: string }
let format: Format = { clock: 'auto', date: 'short', weekStart: 'auto', locale: 'auto' }, words: Labels = LABELS;
export const setFormat = (f: Format, l: Labels) => { format = f; words = l; };

const locale = () => format.locale === 'auto' ? undefined : format.locale;
export const label = (key: keyof Labels, fill: Record<string, string | number> = {}) => words[key].replace(/\{(\w+)\}/g, (m, k) => String(fill[k] ?? m));
export const num = (n: number, o?: Intl.NumberFormatOptions) => n.toLocaleString(locale(), o);

const hours: Record<string, Intl.DateTimeFormatOptions> = { '12h': { hour12: true }, '24h': { hour: '2-digit', hourCycle: 'h23' } };
export const clock = (t: Date | number) => new Date(t).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', ...hours[format.clock] });

const dates: Record<string, Intl.DateTimeFormatOptions> = {
  short: { weekday: 'short', month: 'short', day: 'numeric' }, long: { weekday: 'long', month: 'long', day: 'numeric' },
  numeric: { year: 'numeric', month: '2-digit', day: '2-digit' },
};
export const day = (t: Date | number) => {
  const d = new Date(t);
  if (format.date !== 'iso') return d.toLocaleDateString(locale(), dates[format.date]);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
};

/** The first column of a week, 0 for Sunday: for anything that draws one. */
export function firstDay() {
  if (format.weekStart !== 'auto') return { sunday: 0, monday: 1, saturday: 6 }[format.weekStart];
  const info = new Intl.Locale(locale() ?? navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } };
  return (info.getWeekInfo?.().firstDay ?? 7) % 7;
}

// a tab's address: its name in lower case and dashes. The names the page uses for itself stay its own.
export { tabHash } from '../shared/look.ts';

export interface Problem { id: 'services' | 'downloads' | 'widgets'; text: string; why: string }
const and = (l: string[]) => l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`;

/** One service can show on several cards, spelled differently ("mealie", "Mealie"): lowercased name → its nicest spelling. */
export function spellings(states: WidgetState[]) {
  const spelled = new Map<string, string>();
  for (const { name } of states.flatMap(s => s.card?.type === 'status' ? s.card.items : [])) if (name !== name.toLowerCase() || !spelled.has(name.toLowerCase())) spelled.set(name.toLowerCase(), name);
  return spelled;
}

/** How the place is, from what the services report right now, so it can't be wrong and never needs a model. What needs
 *  someone comes apart from what's merely going on, worst first. */
export function sayHow(states: WidgetState[]) {
  const boards = states.flatMap(s => s.card?.type === 'status' ? [s.card.items] : []).sort((a, b) => b.length - a.length);
  // one service on several cards is still one problem; running but failing its health check isn't "down"
  const spelled = spellings(states), wrong = boards.flat().filter(i => !i.ok && !i.quiet);
  const named = (list: typeof wrong) => [...new Set(list.map(i => spelled.get(i.name.toLowerCase()) ?? i.name))];
  const down = named(wrong.filter(i => stateOf(i) !== 'degraded')), sick = named(wrong.filter(i => stateOf(i) === 'degraded'));
  const count = (st: ReturnType<typeof stateOf>) => (boards[0] ?? []).filter(i => stateOf(i) === st).length;
  const total = boards[0]?.length ?? 0, up = count('up'), off = count('off'), problems: Problem[] = [];
  const hurt = [...down, ...sick];
  if (hurt.length) problems.push({ id: 'services', text: hurt.length <= 3 ? `Everything's running except ${and(hurt)}` : total >= hurt.length ? `${hurt.length} of ${total} services need a look` : `${hurt.length} services need a look`,
    why: hurt.length === 1 ? `What's wrong with ${hurt[0]}?` : 'What\'s wrong with these services?' });
  const getting = states.flatMap(s => s.card?.type === 'media' ? [{ key: s.key, card: s.card, items: s.card.items.filter(m => m.icon === 'download' && m.state !== 'paused') }] : []).filter(g => g.items.length);
  // nothing's moving, and not because someone paused it
  const stuck = getting.filter(g => /(^|\s)0 B\/s/.test(g.card.note ?? '') && !g.card.buttons?.some(b => /^resume/i.test(b.label)));
  const nStuck = stuck.reduce((n, g) => n + g.items.length, 0);
  if (nStuck) problems.push({ id: 'downloads', text: nStuck === 1 ? 'A download is stalled' : `${nStuck} downloads are stalled`, why: nStuck === 1 ? 'Why is my download stalled?' : 'Why are my downloads stalled?' });
  const broken = states.filter(s => s.error);
  if (broken.length) problems.push({ id: 'widgets', text: `${broken.length} widget${broken.length > 1 ? 's' : ''} can't reach ${broken.length > 1 ? 'their services' : 'its service'}`,
    why: broken.length === 1 ? `What's wrong with ${broken[0].card?.title ?? broken[0].key.split('.')[0]}?` : 'Why can\'t these widgets reach their services?' });

  const media = states.flatMap(s => s.card?.type === 'media' ? s.card.items : []);
  const watching = media.filter(m => m.user && m.state !== 'paused'), coming = getting.filter(g => !stuck.includes(g)).reduce((n, g) => n + g.items.length, 0);
  const parts = [
    !total || hurt.length ? '' : up === total - off ? `All ${up} services are running` : `${up} of ${total - off} services are running`,
    watching.length === 1 ? `${watching[0].user} is watching ${watching[0].title}` : watching.length ? `${watching.length} people are watching` : '',
    coming ? `${coming === 1 ? 'a download is' : `${coming} downloads are`} on the way` : '',
  ].filter(Boolean);
  return { problems, parts };
}

/** The whole place in one short sentence: what needs someone first, then what's going on. Two things at most, so it stays on a line. */
export function oneLine(problems: Problem[], parts: string[]) {
  const all = [...problems.map(p => p.text), ...parts].slice(0, 2).map((t, i) => i ? t.replace(/^(A|All) /, m => m.toLowerCase()) : t);
  return all.length ? `${and(all)}.` : '';
}

const TROUBLE = /\b(down|offline|failing|failed|broken|crash\w*|restart\w*|fix|wrong|stopped|unreachable|errors?|back up)\b/i;
const says = (chip: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(chip);

/** Suggestions outlive what they were written about. A chip goes once a service it names is up again: it was down when
 *  the chip was written (`wrong`), or the chip reads as trouble. "What's new on Plex?" isn't, so it stays. */
export function stillTrue(chips: string[], wrong: string[], states: WidgetState[]) {
  const items = states.flatMap(s => s.card?.type === 'status' ? s.card.items : []);
  const up = items.filter(i => i.ok && !items.some(o => !o.ok && !o.quiet && o.name.toLowerCase() === i.name.toLowerCase())).map(i => i.name.toLowerCase());
  const was = new Set(wrong.map(w => w.toLowerCase()));
  return chips.filter(c => !up.some(n => says(c, n) && (was.has(n) || TROUBLE.test(c))));
}

const trimmed = new WeakMap<Card, { of: string[]; out: Card }>();
/** A status card down to its favourites. Anything that's down stays, favourite or not: a shorter list mustn't hide trouble.
 *  The same object for the same card, so memoised renderers stay still; names that match nothing leave it whole. */
export function favorites(card: Card | undefined, names?: string[]): Card | undefined {
  if (card?.type !== 'status' || !names?.length) return card;
  const hit = trimmed.get(card);
  if (hit?.of === names) return hit.out;
  const bad = (i: StatusCard['items'][number]) => !i.ok && !i.quiet;
  const liked = names.flatMap(n => card.items.filter(i => i.name.toLowerCase() === n.toLowerCase() && !bad(i)));
  const out = liked.length ? { ...card, items: [...card.items.filter(bad), ...liked] } : card;
  trimmed.set(card, { of: names, out });
  return out;
}
