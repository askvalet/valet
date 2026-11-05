// What to offer as a question right now. The model writes these from the page when it can (`tailored`); until then, and
// without one, they come from reading the cards. Either way anything that's just gone wrong comes first, because the
// model's list can be a few minutes old.
import { sameTrouble, stateOf, type WidgetState } from '../shared/cards.ts';
import { spellings } from './format.ts';

const capitals = (s: string) => s.replace(/\P{Lu}/gu, '').length;
/** The same question once, however many cards raised it, where it first came up, and in its best-capitalised spelling. */
const once = (list: string[]) => {
  const seen = new Map<string, string>();
  for (const q of list) { const key = q.toLowerCase(), had = seen.get(key); if (had === undefined || capitals(q) > capitals(had)) seen.set(key, q); }
  return [...seen.values()];
};

export function suggest(state: Record<string, WidgetState>, configured: string[], hour = new Date().getHours(), tailored?: string[] | null) {
  const out: string[] = [];
  const cards = Object.values(state), spelled = spellings(cards), known = sameTrouble(cards);
  for (const s of cards) {
    if (s.card?.type === 'status') for (const i of s.card.items) if (!i.ok && !i.quiet) out.push(`Why is ${spelled.get(i.name.toLowerCase()) ?? i.name} ${stateOf(i) === 'degraded' ? 'unhealthy' : 'down'}?`);
    if (s.error && !known(s)) out.push(`What's wrong with ${s.card?.title ?? s.key.split('.')[0]}?`);
  }
  if (tailored?.length) return once([...out, ...tailored]);
  for (const s of cards) {
    const a = s.card?.activity;
    if (!a) continue;
    if (a.icon === 'download') out.push(`When will ${a.title.length > 28 ? 'my download' : a.title} finish?`);
    else if (a.icon === 'play') out.push(`What's ${a.title} about?`);
  }
  if (hour >= 18 && cards.some(s => s.key.endsWith('.recent') && s.card?.type === 'shelf')) out.push('What should I watch tonight?');
  return once([...out, ...configured]);
}
