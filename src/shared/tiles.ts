// What a card shows as a tile or a ring (display: tiles, rings). A card's own `summary` or `summaries` when it has them;
// otherwise one worked out from what the card holds, so a status card, a list, a shelf or a calendar can sit in a wall of
// tiles too. And what a tile can do: the same buttons and toggles its full card offers.
import { stateOf, type Card, type Summary } from './cards.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const when = (start: string, allDay: boolean) => {
  const d = new Date(allDay ? `${start}T12:00:00` : start);
  return Number.isNaN(+d) ? start : d.toLocaleString(undefined, allDay ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

/** A headline for a card that didn't give one, from its own contents; none for cards with nothing short to say. */
export function derivedSummary(card: Card): Summary | undefined {
  const label = card.title ?? '', icon = card.icon;
  switch (card.type) {
    case 'status': {
      const states = card.items.map(stateOf), down = card.items.filter((_, i) => states[i] === 'down'), slow = states.filter(s => s === 'degraded').length;
      const up = states.filter(s => s === 'up' || s === 'degraded').length;
      return { label, icon, value: down.length ? `${down.length} down` : 'All up', tone: down.length ? 'bad' : slow ? 'warn' : 'good',
        sub: down.length ? down.map(i => i.name).join(', ') : `${up} of ${card.items.length} up`,
        marks: card.items.slice(0, 40).map((it, i) => ({ pct: 1, tone: states[i] === 'down' ? 'bad' : states[i] === 'degraded' ? 'warn' : states[i] === 'off' ? undefined : 'good', label: it.name })) };
    }
    case 'list': case 'links': {
      const items = card.type === 'list' ? card.items.map(i => ({ title: i.title, more: i.meta ?? i.subtitle, image: i.image, pct: i.pct, tone: i.tone })) : card.items.map(i => ({ title: i.name, more: i.note, image: undefined, pct: undefined, tone: undefined }));
      const first = items[0];
      return { label, icon, value: items.length, sub: first?.title ?? (card.type === 'list' ? card.empty : undefined), detail: first?.more, pct: first?.pct, tone: first?.tone };
    }
    case 'ranked': {
      const top = card.items[0];
      return top && { label, icon, value: top.value ?? top.title, sub: top.value ? top.title : top.subtitle, image: top.image, pct: top.pct };
    }
    case 'shelf': case 'media': case 'photos': {
      const first = card.items[0];
      return { label, icon, value: card.items.length, sub: first?.title ?? first?.subtitle, image: first?.image };
    }
    case 'stats': {
      const s = card.items[0];
      return s && { label: label || s.label, icon, value: s.unit ? `${s.value}${s.unit}` : s.value, sub: label ? s.label : undefined, detail: s.sub, tone: s.tone, pct: s.pct, trend: s.trend };
    }
    case 'kv': { const [k, v] = card.rows[0] ?? []; return k === undefined ? undefined : { label, icon, value: v!, sub: k }; }
    case 'table': return { label, icon, value: card.rows.length, sub: card.rows[0] ? String(card.rows[0][0] ?? '') : undefined };
    case 'controls': {
      const toggles = card.items.filter(c => c.kind === 'toggle'), on = toggles.filter(c => c.value === true).length;
      if (toggles.length) return { label, icon, value: `${on} on`, sub: `of ${toggles.length}`, tone: on ? 'accent' : undefined, pct: on / toggles.length };
      const v = card.items.find(c => c.kind === 'value');
      return v && { label, icon, value: String(v.value ?? '–'), sub: v.label, tone: v.tone };
    }
    case 'calendar': {
      const now = Date.now(), next = card.events.find(e => +new Date(e.end ?? e.start) >= now);
      return { label, icon: icon ?? 'calendar', value: next?.title ?? (card.empty ?? 'Nothing coming up'), sub: next ? when(next.start, !next.start.includes('T')) : undefined };
    }
    case 'schedule': {
      const next = card.items.find(i => !card.muted?.includes(i.name) && +new Date(i.at) >= Date.now());
      return next && { label, icon, value: next.name, sub: when(next.at, false) };
    }
    case 'forecast': return { label, icon: card.now.icon, value: `${Math.round(card.now.temp)}°`, sub: card.now.words, detail: `${Math.round(card.now.hi)}° / ${Math.round(card.now.lo)}°` };
    case 'chart': {
      const s = card.series[0], last = s?.points.at(-1);
      return s && last !== undefined ? { label, icon, value: card.unit ? `${last}${card.unit}` : last, sub: s.name, trend: s.points, color: s.color } : undefined;
    }
    case 'group': for (const c of card.cards) { const s = derivedSummary(c); if (s) return { ...s, label: label || s.label }; } return undefined;
    default: return undefined;
  }
}

/** The tiles a card makes: its own headlines, or one worked out from it. */
export function tilesOf(card: Card | undefined): Summary[] {
  if (!card) return [];
  if (card.summaries?.length) return card.summaries;
  if (card.summary) return [card.summary];
  const s = derivedSummary(card);
  return s ? [s] : [];
}

/** Something a tile can do: a card's button (its banner's first), or one of its toggles, with what pressing it sends. */
export type TileAction = { label: string; action: string; args?: Record<string, unknown>; on?: boolean };
/** What a card's tile offers, in the order the card shows it; a toggle's press sends the opposite of where it stands. */
export function tileActions(card: Card | undefined, most = 4): TileAction[] {
  if (!card) return [];
  const out: TileAction[] = [];
  if (card.banner?.button) out.push({ label: card.banner.button.label, action: card.banner.button.action, args: card.banner.button.args });
  for (const b of card.buttons ?? []) out.push({ label: b.label, action: b.action, args: b.args });
  if (card.type === 'controls') for (const c of card.items) {
    if (!c.action) continue;
    if (c.kind === 'toggle') out.push({ label: c.label, action: c.action, args: { ...c.args, value: !(c.value === true) }, on: c.value === true });
    else if (c.kind === 'button') out.push({ label: String(c.value ?? c.label), action: c.action, args: c.args });
  }
  return out.slice(0, most);
}
