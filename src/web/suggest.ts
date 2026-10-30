// What to offer as a question right now. The model writes these from the page when it can (`tailored`); until then, and
// without one, they come from reading the cards. Either way anything that's just gone wrong comes first, because the
// model's list can be a few minutes old.
import type { WidgetState } from '../shared/cards.ts';

export function suggest(state: Record<string, WidgetState>, configured: string[], hour = new Date().getHours(), tailored?: string[] | null) {
  const out: string[] = [];
  const cards = Object.values(state);
  for (const s of cards) {
    if (s.card?.type === 'status') for (const i of s.card.items) if (!i.ok && !i.quiet) out.push(`Why is ${i.name} down?`);
    if (s.error) out.push(`What's wrong with ${s.card?.title ?? s.key.split('.')[0]}?`);
  }
  if (tailored?.length) return [...new Set([...out, ...tailored])];
  for (const s of cards) {
    const a = s.card?.activity;
    if (!a) continue;
    if (a.icon === 'download') out.push(`When will ${a.title.length > 28 ? 'my download' : a.title} finish?`);
    else if (a.icon === 'play') out.push(`What's ${a.title} about?`);
  }
  if (hour >= 18 && cards.some(s => s.key.endsWith('.recent') && s.card?.type === 'shelf')) out.push('What should I watch tonight?');
  return [...new Set([...out, ...configured])];
}
