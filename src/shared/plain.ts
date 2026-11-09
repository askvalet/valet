// A card as a few lines of plain words, for places that can't draw one (a chat app, a notification). The same card the
// page gets; only what reads well in a line each, and never more than a screenful.
import type { Card } from './cards.ts';
import { hitsOf } from './search.ts';

const join = (...parts: (string | number | undefined)[]) => parts.filter(p => p != null && p !== '').join(' · ');

export function plain(card: Card | null | undefined, max = 8): string {
  if (!card) return '';
  const rows = ((): string[] => {
    switch (card.type) {
      case 'text': return [card.text];
      case 'stats': return card.items.map(i => `${i.label}: ${join(`${i.value}${i.unit ?? ''}`, i.sub)}`);
      case 'status': return card.items.map(i => `${i.ok ? '✓' : i.quiet ? '–' : '✗'} ${join(i.name, i.ok ? undefined : i.detail)}`);
      case 'chart': return card.series.map(s => `${s.name}: ${s.total ?? s.points.at(-1) ?? '–'}${card.unit ?? ''}`);
      case 'group': return card.cards.map(c => plain(c, max)).filter(Boolean);
      default: return hitsOf(card, 1000).map(h => join(h.title, h.sub));
    }
  })();
  const shown = rows.slice(0, max), more = rows.length - shown.length;
  // a card with nothing to list still has its headline number
  if (!shown.length && card.summary) shown.push(join(`${card.summary.label}: ${card.summary.value}`, card.summary.sub));
  const body = card.type === 'text' || card.type === 'group' ? shown.join('\n') : shown.map(r => `• ${r}`).join('\n');
  return [card.type === 'group' ? undefined : card.title, body, more > 0 ? `and ${more} more` : undefined].filter(Boolean).join('\n');
}
