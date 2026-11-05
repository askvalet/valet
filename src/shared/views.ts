// A card's data and the way it's drawn are separate choices. Numbers can be any chart, things with pictures can be any
// gallery: a widget's `view` in the config picks one, and what can't honestly become that view stays as it was.
import type { CalendarCard, Card, ChartCard, HeatmapCard, RaceCard, RankedCard, ShelfCard, ShelfItem } from './cards.ts';

export const CHART_VIEWS = ['line', 'bars', 'stream', 'race', 'heatmap', 'ranked', 'pie'] as const;
export const GALLERY_VIEWS = ['row', 'spotlight', 'focus', 'coverflow', 'masonry', 'cards', 'desk', 'windows', 'tickets', 'mosaic', 'flashback', 'album'] as const;
/** A calendar's own: a week of days side by side with the hours down the side, or the agenda (with the month when wide). */
export const CALENDAR_VIEWS = ['week', 'agenda'] as const;
export const VIEWS = [...CHART_VIEWS, ...GALLERY_VIEWS, ...CALENDAR_VIEWS] as const;
export type View = (typeof VIEWS)[number];

/** Which cards can honestly become which views: numbers into charts, pictures into galleries. */
const CHARTABLE: readonly Card['type'][] = ['chart', 'race', 'heatmap', 'ranked', 'stats'];
const PICTURED: readonly Card['type'][] = ['shelf', 'photos', 'ranked', 'race', 'media', 'article'];
export const fits = (view: View, type: Card['type']) => (CALENDAR_VIEWS as readonly string[]).includes(view) ? type === 'calendar'
  : ((CHART_VIEWS as readonly string[]).includes(view) ? CHARTABLE : PICTURED).includes(type);
/** The views a kind of card can take, for a config problem to suggest. */
export const viewsFor = (type: Card['type']) => VIEWS.filter(v => fits(v, type));

type Numbers = { series: { name: string; points: number[]; image?: string }[]; labels?: string[]; unit?: string; from?: number; to?: number; span?: string; headline?: string };
const DAY = 86_400_000;
const sum = (l: number[]) => l.reduce((a, b) => a + b, 0);
const amount = (v?: string | number) => { const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; };
const shared = ({ source, title, icon, href, note, summary, summaries, wide, activity, buttons, banner }: Card) => Object.fromEntries(
  Object.entries({ source, title, icon, href, note, summary, summaries, wide, activity, buttons, banner }).filter(([, v]) => v !== undefined));

/** The numbers in a card, whichever chart they came in. */
function numbers(card: Card): Numbers | undefined {
  switch (card.type) {
    case 'chart': return { series: card.series, labels: card.labels, unit: card.unit, from: card.from, to: card.to, span: card.span, headline: card.headline };
    // a race holds running totals; everything else here holds what each point added
    case 'race': return { series: card.items.map(i => ({ name: i.title, points: i.points.map((p, n) => p - (i.points[n - 1] ?? 0)), image: i.image })), labels: card.steps, unit: card.unit, span: card.span };
    case 'heatmap': { const from = Date.parse(card.from); return { series: [{ name: card.title ?? card.unit ?? 'Count', points: card.days }], from, to: from + (card.days.length - 1) * DAY, unit: card.unit, span: card.span, headline: card.headline }; }
    case 'ranked': { const items = card.items.flatMap(i => { const n = amount(i.value) ?? i.pct; return n == null ? [] : [{ name: i.title, n, image: i.image }]; }); return items.length ? { series: items.map(i => ({ name: i.name, points: [i.n], image: i.image })) } : undefined; }
    case 'stats': return card.pie?.length ? { series: card.pie.map(p => ({ name: p.label, points: [p.value] })) } : undefined;
    default: return undefined;
  }
}

/** One total per thing, largest first. */
const totals = (n: Numbers) => n.series.map(s => ({ name: s.name, image: s.image, value: sum(s.points) })).sort((a, b) => b.value - a.value);

function chart(card: Card, n: Numbers, view: View): Card | undefined {
  const base = shared(card);
  if (view === 'line' || view === 'bars' || view === 'stream') {
    // things with one number each lie along the axis by name
    const single = n.series.every(s => s.points.length === 1);
    const series = single ? [{ name: card.title ?? 'Total', points: n.series.map(s => s.points[0]) }] : n.series.map(({ name, points }) => ({ name, points }));
    return { ...base, type: 'chart', style: view, series, labels: single ? n.series.map(s => s.name) : n.labels, unit: n.unit, from: n.from, to: n.to, span: n.span, headline: n.headline } satisfies ChartCard;
  }
  if (view === 'race') {
    if (n.series.every(s => s.points.length === 1)) return { ...base, type: 'race', span: n.span, unit: n.unit, steps: ['Start', 'Now'], items: n.series.map(s => ({ title: s.name, image: s.image, points: [0, s.points[0]] })) } satisfies RaceCard;
    const length = Math.max(...n.series.map(s => s.points.length));
    const steps = n.labels?.length === length ? n.labels : Array.from({ length }, (_, i) => String(i + 1));
    return { ...base, type: 'race', span: n.span, unit: n.unit, steps, items: n.series.map(s => { let at = 0; return { title: s.name, image: s.image, points: s.points.map(p => (at += p)) }; }) } satisfies RaceCard;
  }
  if (view === 'heatmap') {
    if (n.from == null || n.to == null) return undefined;   // squares are days: without dates there's nothing to place
    const length = Math.max(...n.series.map(s => s.points.length)), step = length > 1 ? (n.to - n.from) / (length - 1) : DAY;
    const days = new Map<number, number>();
    for (const s of n.series) s.points.forEach((p, i) => { const d = Math.floor((n.from! + i * step) / DAY); days.set(d, (days.get(d) ?? 0) + p); });
    const first = Math.floor(n.from / DAY), last = Math.floor(n.to / DAY);
    return { ...base, type: 'heatmap', from: new Date(first * DAY).toISOString().slice(0, 10), days: Array.from({ length: last - first + 1 }, (_, i) => days.get(first + i) ?? 0), unit: n.unit, span: n.span, headline: n.headline } satisfies HeatmapCard;
  }
  const all = totals(n);
  if (view === 'ranked') { const top = all[0]?.value || 1; return { ...base, type: 'ranked', items: all.map(t => ({ title: t.name, image: t.image, value: `${+t.value.toFixed(1)}${n.unit ? ` ${n.unit}` : ''}`, pct: t.value / top })) } satisfies RankedCard; }
  if (view === 'pie') return { ...base, type: 'stats', items: [], pie: all.map(t => ({ label: t.name, value: t.value })) };
  return undefined;
}

/** Whatever has pictures, as gallery items. */
function pictures(card: Card): ShelfItem[] | undefined {
  switch (card.type) {
    case 'shelf': return card.items;
    case 'photos': return card.items.map(i => ({ title: i.title ?? '', subtitle: i.subtitle, image: i.image, badge: i.badge, href: i.href }));
    case 'ranked': return card.items.map(i => ({ title: i.title, subtitle: i.subtitle ?? i.value, image: i.image, backdrop: i.backdrop, href: i.href }));
    case 'race': return card.items.map(i => ({ title: i.title, image: i.image }));
    case 'media': return card.items.map(i => ({ title: i.title, subtitle: i.subtitle, image: i.image }));
    // the reading pile: each thing saved keeps its id, so archiving still works from a gallery
    case 'article': return (card.more?.length ? card.more : card.headline ? [card] : []).map(a => ({ id: a.id, title: a.headline, subtitle: a.site, note: a.blurb, image: a.image, href: a.link }));
    default: return undefined;
  }
}

function gallery(card: Card, view: View): Card | undefined {
  const items = pictures(card); if (!items?.length) return undefined;
  const base = shared(card);
  // photos keep their own shapes in a collage; anything else becomes a shelf of tiles
  if (view === 'mosaic' || view === 'flashback' || view === 'album' || (view === 'masonry' && card.type === 'photos')) {
    const seen = items.flatMap(i => i.image ? [{ image: i.image, title: i.title || undefined, subtitle: i.subtitle, badge: i.badge, href: i.href }] : []);
    return seen.length ? { ...base, type: 'photos', style: view, items: seen } : undefined;
  }
  const was = card.type === 'shelf' ? card : undefined, archived = card.type === 'article' ? card.archived : undefined;
  const aspect = was?.aspect ?? (card.type === 'ranked' ? card.aspect : card.type === 'photos' ? 'wide' : card.type === 'article' ? 'poster' : undefined);   // a saved page is a page: upright, its top showing
  return { ...base, ...(archived && { archived }), ...was, type: 'shelf', layout: view === 'row' ? undefined : view as ShelfCard['layout'], aspect, items } as ShelfCard;
}

const drawn = new WeakMap<Card, { view: View; out: Card }>();
/** This card drawn the way the config asks. The same object for the same card, so memoised renderers stay still. */
export function asView<C extends Card | undefined>(card: C, view?: View): C | Card {
  if (!card || !view) return card;
  const hit = drawn.get(card); if (hit?.view === view) return hit.out;
  const n = (CHART_VIEWS as readonly string[]).includes(view) ? numbers(card) : undefined;
  const out = card.type === 'calendar' ? ((CALENDAR_VIEWS as readonly string[]).includes(view) ? { ...card, view: view as CalendarCard['view'] } : card)
    : (n ? chart(card, n, view) : (GALLERY_VIEWS as readonly string[]).includes(view) ? gallery(card, view) : undefined) ?? card;
  drawn.set(card, { view, out });
  return out;
}
