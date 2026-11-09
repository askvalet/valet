// ⌘K's search inside the services: what one service found, and the rows the palette draws from its card. The server
// sends the card a search tool already makes (the catalog is the contract); the rows are read off it here, so a new
// searchable integration needs nothing but `find` on its tool.
import type { Card } from './cards.ts';

/** One service's answer. `n` is its place in the config, so groups keep their order however fast each one answers. */
export interface Found { id: string; n: number; source: string; icon?: string; card: Card | null; ms?: number }
export interface Hit { title: string; sub?: string; image?: string; href?: string }

const line = (...parts: (string | number | undefined)[]) => parts.filter(p => p != null && p !== '').join(' · ') || undefined;

/** The things a card lists, as rows. A card that lists nothing (words, a chart) gives none. */
export function hitsOf(card: Card | null | undefined, max = 5): Hit[] {
  if (!card) return [];
  const all = ((): Hit[] => {
    switch (card.type) {
      case 'shelf': return card.items.map(i => ({ title: i.title, sub: i.subtitle ?? i.badge ?? i.note, image: i.image, href: i.href ?? i.cta?.href }));
      case 'list': return card.items.map(i => ({ title: i.title, sub: line(i.subtitle, i.meta), image: i.image, href: i.href }));
      case 'ranked': return card.items.map(i => ({ title: i.title, sub: line(i.subtitle, i.value), image: i.image, href: i.href }));
      case 'media': return card.items.map(i => ({ title: i.title, sub: i.subtitle, image: i.image }));
      case 'photos': return card.items.map(i => ({ title: i.title ?? i.subtitle ?? 'Photo', sub: i.title ? i.subtitle : undefined, image: i.image, href: i.href }));
      case 'links': return card.items.map(i => ({ title: i.name, sub: i.note, href: i.href }));
      case 'status': return card.items.map(i => ({ title: i.name, sub: i.detail, href: i.href }));
      case 'controls': return card.items.map(i => ({ title: i.label, sub: line(i.sub, typeof i.value === 'boolean' ? (i.value ? 'On' : 'Off') : i.value) }));
      case 'article': return [card, ...card.more ?? []].filter(a => a.headline).map(a => ({ title: a.headline, sub: a.site, image: a.image, href: a.link }));
      case 'table': return card.rows.map(r => ({ title: String(r[0] ?? ''), sub: line(...r.slice(1, 3)) }));
      case 'kv': return card.rows.map(([k, v]) => ({ title: k, sub: v }));
      case 'group': return card.cards.flatMap(c => hitsOf(c, max));
      default: return [];
    }
  })();
  // only a web address opens from a row; anything else (and nothing) shows the card instead
  return all.filter(h => h.title).slice(0, max).map(h => ({ ...h, href: h.href && /^https?:\/\//.test(h.href) ? h.href : undefined }));
}
