// The map card's own logic, shared by the server and anything that serves a map: what a node's dot says once a container
// folded into it is counted, what a machine or the internet says when it's only known by what's on it, the tile's
// headline, and the same map narrowed to what one person may see. A node's `from` is the integration it came from, so
// someone with a profile gets only the nodes of integrations on their tabs, and what's worked out from them is worked out
// again from what's left: nothing about the rest shows through a machine's dot, its address or the headline.
import type { Card, MapCard, MapNode, ServiceState, Summary, Tone } from './cards.ts';

export const NOTHING = 'nothing on it answers';
const LEAF = new Set(['service', 'container', 'vm', 'device']);

/** A node's dot: its own state, unwell when a container folded into it is down. */
export function stateNow(n: MapNode): ServiceState | undefined {
  const a = n.also?.state;
  if (a === 'down' && (n.state === 'up' || !n.state)) return 'degraded';
  return n.state;
}

/** What's worked out rather than reported: a machine nothing reports on is down when nothing on it answers and up when
 *  something does; the internet the same by what's out there; and the tile's headline. Run again after narrowing. */
export function settle(card: MapCard): MapCard {
  const kids = (id: string) => card.nodes.filter(n => n.parent === id);
  const nodes = card.nodes.map(n => {
    if (n.kind === 'host' && (!n.from || !n.state)) {
      const under = kids(n.id).map(stateNow).filter(s => s && s !== 'off');
      const state: ServiceState | undefined = under.length ? under.every(s => s === 'down') ? 'down' : 'up' : undefined;
      const base = n.detail?.split(' · ').filter(p => p !== NOTHING) ?? [];
      const detail = [...base, ...(state === 'down' ? [NOTHING] : [])].join(' · ') || undefined;
      return { ...n, state, detail };
    }
    if (n.kind === 'internet') {
      const out = kids(n.id).filter(k => LEAF.has(k.kind)), said = out.map(stateNow).filter(Boolean);
      return { ...n, state: said.length ? said.includes('up') ? 'up' as const : 'down' as const : undefined, detail: out.length ? `${out.length} service${out.length === 1 ? '' : 's'} out there` : undefined };
    }
    return n;
  });
  return { ...card, nodes, summary: summaryOf(card.title ?? 'Network', nodes) };
}

/** "3 hosts", and what's down under it. A tile has a bar for each machine, coloured by the worst thing on it. */
export function summaryOf(label: string, nodes: MapNode[]): Summary {
  const st = new Map(nodes.map(n => [n.id, stateNow(n)]));
  // a machine that's down because everything on it is says nothing new: what's on it is already counted
  const hosts = nodes.filter(n => n.kind === 'host'), down = nodes.filter(n => st.get(n.id) === 'down' && n.kind !== 'network' && n.kind !== 'internet' && !(n.kind === 'host' && nodes.some(c => c.parent === n.id && st.get(c.id) === 'down')));
  const worst = (h: MapNode): Tone | undefined => {
    const under = [h, ...nodes.filter(n => n.parent === h.id)].map(n => st.get(n.id));
    return under.includes('down') ? 'bad' : under.includes('degraded') ? 'warn' : under.includes('up') ? 'good' : undefined;
  };
  return { label, icon: 'wifi', value: `${hosts.length} host${hosts.length === 1 ? '' : 's'}`,
    sub: down.length ? `${down.length} down: ${down.slice(0, 3).map(n => n.label).join(', ')}` : nodes.some(n => st.get(n.id)) ? 'all answering' : undefined,
    tone: down.length ? 'bad' : 'good', marks: hosts.slice(0, 12).map(h => ({ pct: 1, tone: worst(h), label: h.label })) };
}

const hostPart = (address: string) => address.replace(/:\d+$/, '');

/** The map as someone sees it who may see only some integrations (`may` answers by its key, as in config.yaml): their
 *  services, containers and VMs; a machine only if something of theirs is on it or they may see what reports it; a network
 *  only with a machine on it. A machine kept for what's on it keeps no state, icon or address from what they can't see. */
export function mapFor(card: MapCard, may: (integration: string) => boolean): MapCard {
  const ok = (from?: string) => !from || may(from);
  const leaves = card.nodes.filter(n => LEAF.has(n.kind) && ok(n.from)).map(n => n.also && !ok(n.also.from) ? { ...n, also: undefined } : n);
  const under = (id: string) => leaves.filter(n => n.parent === id);
  const hosts = card.nodes.filter(n => n.kind === 'host' && ((n.from && may(n.from)) || under(n.id).length)).map(h => {
    if (!h.from || may(h.from)) return h;
    const seen = new Set(under(h.id).flatMap(n => n.address ? [hostPart(n.address)] : []));
    const address = h.address?.split(', ').filter(a => seen.has(a)).join(', ') || undefined;
    const detail = h.detail?.split(' · ').filter(p => p === 'Valet runs here').join(' · ') || undefined;
    return { ...h, from: undefined, state: undefined, icon: undefined, address, detail };
  });
  const nets = card.nodes.filter(n => n.kind === 'network' && hosts.some(h => h.parent === n.id));
  const rest = card.nodes.filter(n => n.kind === 'internet');
  const keep = new Set([...rest, ...nets, ...hosts, ...leaves].map(n => n.id));
  const narrowed = [...rest, ...nets, ...hosts, ...leaves].filter(n => !n.parent || keep.has(n.parent) || n.kind === 'internet');
  return settle({ ...card, nodes: card.nodes.map(n => narrowed.find(x => x.id === n.id)).filter((n): n is MapNode => !!n) });
}

/** Every map in a card (one inside a group too) narrowed to `may`; anything else as it was. */
export function narrowMaps(card: Card | undefined, may: (integration: string) => boolean): Card | undefined {
  if (!card) return card;
  if (card.type === 'map') return mapFor(card, may);
  if (card.type === 'group') return { ...card, cards: card.cards.map(c => narrowMaps(c, may)!) };
  return card;
}
