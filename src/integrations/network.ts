// The homelab drawn as Valet already knows it, with nothing to set up: every integration names an address, so grouping
// them by host gives the machines, the private ones give the networks, and the public ones hang from the internet. What's
// running comes from what the widgets last said (ctx.lab(): no service is asked anything for it), and containers, VMs and a
// machine's own services come from the docker, machines, host and Proxmox integrations where there are some.
import { z } from 'zod';
import { defineIntegration, type Address, type Peer } from '../server/core.ts';
import { stateOf, type Card, type ListItem, type MapCard, type MapKind, type MapNode, type ServiceState, type StatusItem } from '../shared/cards.ts';
import { mapFor, settle, stateNow } from '../shared/map.ts';

export interface NetworkOptions { title: string; names: Record<string, string>; containers: boolean; hide: string[] }

// ── where an address is
// The machine Valet runs on, as a container sees it: itself, Docker's gateway on the default bridge (and the first address of
// any other bridge), and the names Docker and Podman give the host.
const HERE = /^(localhost|127(\.\d+){3}|::1|0\.0\.0\.0|host\.docker\.internal|gateway\.docker\.internal|host\.containers\.internal|172\.(1[7-9]|2\d|3[01])\.\d+\.1)$/;
const ipv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ? h.split('.').map(Number) : undefined;
const TAILNET = (h: string) => { const p = ipv4(h); return !!p && p[0] === 100 && p[1] >= 64 && p[1] < 128 || /\.ts\.net$/.test(h); };
const LOCAL_NAME = /\.(local|lan|home|internal|localdomain|home\.arpa|intranet|private|corp)$/;
function privateIp(h: string) {
  const p = ipv4(h);
  if (p) return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] < 32) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
  return /^(fc|fd|fe80)[0-9a-f]*:/i.test(h);
}
type Where = { at: 'here' } | { at: 'lan'; net?: string } | { at: 'tailnet' } | { at: 'internet' };
/** A name with no dot is a container beside Valet on its Docker network (`sonarr`, `valet-dockerproxy`), or a machine `names`
 *  or machines already calls by that name. */
export function whereIs(host: string): Where {
  if (HERE.test(host)) return { at: 'here' };
  if (TAILNET(host)) return { at: 'tailnet' };
  const p = ipv4(host);
  if (p) return privateIp(host) ? { at: 'lan', net: `${p[0]}.${p[1]}.${p[2]}` } : { at: 'internet' };
  if (host.includes(':')) return privateIp(host) ? { at: 'lan' } : { at: 'internet' };
  if (!host.includes('.')) return { at: 'here' };
  return LOCAL_NAME.test(host) ? { at: 'lan' } : { at: 'internet' };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const at = (a: Address) => a.port ? `${a.host}:${a.port}` : a.host;
const short = (host: string) => ipv4(host) || host.includes(':') ? host : host.replace(LOCAL_NAME, '');
// a status item that two machines share is named "x · machine"; a group that stopped answering says so after a dot
const before = (s: string) => s.split(' · ')[0];
const SOURCES = new Set(['docker', 'machines', 'host', 'proxmox']);

interface HostRec { id: string; label: string; net: string; addresses: Set<string>; here: boolean; state?: ServiceState; detail?: string; icon?: string; machine?: boolean; from?: string }

/** The map, from the other integrations as `ctx.lab()` sees them. Pure: the cards it reads are handed in with the peers. */
export function mapFrom(peers: Peer[], o: NetworkOptions, cards: (p: Peer, widget: string) => Card | undefined = (p, w) => p.widgets.find(x => x.name === w)?.card): MapCard {
  const hidden = new Set(o.hide.map(slug)), shown = (...names: (string | undefined)[]) => !names.some(n => n && hidden.has(slug(n)));
  const live = peers.filter(p => shown(p.id));
  const names = new Map(Object.entries(o.names).map(([k, v]) => [k.toLowerCase(), v]));

  // machines knows its machines by name: an address of theirs is that machine
  const machineAt = new Map<string, { name: string; state?: ServiceState; detail?: string; icon?: string; from: string }>();
  for (const p of live.filter(p => p.type === 'machines')) {
    const fleet = cards(p, 'fleet');
    for (const a of p.addresses.filter(a => /^hosts\.[^.]+\.url$/.test(a.field))) {
      const name = a.label ?? a.field.split('.')[1], item = fleet?.type === 'status' ? fleet.items.find(i => i.name === name) : undefined;
      machineAt.set(HERE.test(a.host) ? 'here' : a.host, { name, state: item ? stateOf(item) : undefined, detail: item?.detail, icon: item?.icon, from: p.id });
    }
  }
  // the machine Valet runs on by any of its names; a bare name is a container beside it unless something calls it a machine
  const keyOf = (host: string) => HERE.test(host) || (whereIs(host).at === 'here' && !names.has(host) && !machineAt.has(host)) ? 'here' : host;
  const hereName = names.get('localhost') ?? names.get('here') ?? machineAt.get('here')?.name ?? "Valet's machine";

  // the networks: one per private /24, the busiest is the one Valet and named machines sit on
  const all = live.flatMap(p => p.addresses);
  const nets = new Map<string, number>();
  for (const a of all) { const w = whereIs(a.host); if (w.at === 'lan' && w.net) nets.set(w.net, (nets.get(w.net) ?? 0) + 1); }
  const main = [...nets].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'lan';

  const hosts = new Map<string, HostRec>();
  /** The machine an address is on, nothing for the internet, or false for a machine `hide` names. */
  function hostOf(a: Address): HostRec | undefined | false {
    const key = keyOf(a.host), where = whereIs(a.host), w: Where = key !== 'here' && where.at === 'here' ? { at: 'lan' } : where;
    const named = names.get(a.host) ?? (key === 'here' ? hereName : undefined), m = machineAt.get(key);
    if (w.at === 'internet' && !named && !m) return undefined;
    const label = named ?? m?.name ?? short(a.host);
    if (!shown(label, a.host)) return false;
    const id = `host:${slug(label) || slug(a.host)}`;
    const net = w.at === 'tailnet' ? 'tailnet' : w.at === 'lan' && w.net ? w.net : main;
    let h = hosts.get(id);
    if (!h) hosts.set(id, h = { id, label, net, addresses: new Set(), here: key === 'here' });
    // an address of its own beats the one it was guessed onto
    if (w.at === 'lan' && w.net && h.net === main) h.net = w.net;
    if (key === 'here') h.here = true;
    // not 172.17.0.1 or a container's name: those are only how Valet's containers reach it
    if (key !== 'here' && (ipv4(a.host) || /[.:]/.test(a.host))) h.addresses.add(a.host);
    if (m) { h.machine = true; h.state = m.state; h.detail = m.detail; h.icon = m.icon; h.from = m.from; }
    return h;
  }

  const nodes: MapNode[] = [], leaves: MapNode[] = [], publics: MapNode[] = [];
  const leaf = (n: MapNode, h: HostRec | undefined | false) => { if (h !== false) (h ? leaves : publics).push({ ...n, parent: h ? h.id : 'internet' }); };

  for (const p of live) {
    if (p.type === 'machines') { for (const a of p.addresses) hostOf(a); continue; }   // its machines are hosts, not a service
    const first = p.addresses[0];
    if (!first) continue;   // nothing on the network: a clock, a to-do list
    const placed = p.widgets.filter(w => w.placed), failing = placed.find(w => w.error), card = placed.find(w => w.card)?.card;
    const state: ServiceState | undefined = failing ? 'down' : card ? 'up' : undefined;
    const href = p.widgets.map(w => w.card?.href).find(h => h && /^https?:\/\//.test(h));
    const icon = card?.source?.icon ?? (card?.icon?.startsWith('/') ? card.icon : undefined) ?? p.icon;
    // one integration that checks several labelled addresses (http checks): a node each, as its card has them
    const status = card?.type === 'status' ? card.items : [];
    const each = (p.addresses.length > 1 || p.type === 'http') && p.addresses.every(a => a.label) ? p.addresses : [];
    if (each.length) {
      for (const a of each) {
        const item = status.find(i => i.name === a.label);
        if (!shown(a.label)) continue;
        leaf({ id: `svc:${p.id}:${slug(a.label!)}`, label: a.label!, kind: 'service', from: p.id, address: at(a), icon: item?.icon ?? icon, href: item?.href && /^https?:/.test(item.href) ? item.href : undefined,
          state: item ? stateOf(item) : failing ? 'down' : undefined, detail: item?.detail ?? (failing ? `can't be reached: ${failing.error}` : undefined) }, hostOf(a));
      }
      continue;
    }
    const h = hostOf(first);
    // the machine's own agent: its services hang from the machine below, and when it can't be reached nor can the machine
    if (p.type === 'host') { if (h) { h.from = p.id; if (failing) { h.state = 'down'; h.detail = `its agent can't be reached: ${failing.error}`; } } continue; }
    // a custom API is called what its card is called; two of one kind by their keys
    leaf({ id: `svc:${p.id}`, label: p.type === 'api' ? [card?.title, p.widgets[0]?.title].find(t => t && t !== 'API') ?? p.id : sameType(live, p) ? p.id : p.name, kind: 'service', from: p.id, address: first.seen ? first.host : at(first), icon, href, state,
      detail: failing ? `can't be reached: ${failing.error}` : !placed.length ? 'not on the page, so not checked' : undefined }, h);
  }

  // what runs on the machines: containers, VMs and services, under the machine they're on
  if (o.containers) for (const p of live.filter(p => SOURCES.has(p.type))) {
    const home = (p.addresses[0] && hostOf(p.addresses[0])) || undefined;
    const onMachine = (group?: string) => [...hosts.values()].find(h => h.machine && group && h.label === before(group));
    const add = (kind: MapKind, items: StatusItem[], tag: string, where: (i: StatusItem) => HostRec | undefined) => {
      for (const i of items) {
        const h = where(i), name = before(i.name);
        if (!h || !shown(name)) continue;
        leaves.push({ id: `${kind}:${h.id}:${tag}:${slug(name)}`, label: name, kind, parent: h.id, from: p.id, state: stateOf(i), detail: i.detail, icon: i.icon });
      }
    };
    const status = (w: string) => { const c = cards(p, w); return c?.type === 'status' ? c.items : []; };
    if (p.type === 'docker') add('container', status('containers'), 'docker', () => home);
    if (p.type === 'host') add('service', status('services'), 'unit', () => home);
    if (p.type === 'machines') { add('container', status('containers'), 'docker', i => onMachine(i.group)); add('service', status('units'), 'unit', i => onMachine(i.group)); }
    if (p.type === 'proxmox' && home) {
      const g = cards(p, 'guests');
      for (const r of g?.type === 'list' ? g.items : []) {
        const kind = r.id?.startsWith('qemu/') ? 'vm' : r.id?.startsWith('lxc/') ? 'container' : undefined;
        if (!kind || !shown(r.title)) continue;
        leaves.push({ id: `${kind}:${home.id}:${r.id}`, label: r.title, kind, parent: home.id, from: p.id, state: guestState(r), detail: [r.subtitle, r.section && `on ${r.section}`].filter(Boolean).join(' · ') || undefined });
      }
    }
  }

  // a container that is a service already on the map is that service: one node, said once
  const kept: MapNode[] = [];
  for (const n of leaves) {
    const twin = n.kind === 'container' && leaves.find(s => s.kind === 'service' && s.parent === n.parent && s.id.startsWith('svc:') && [slug(s.label), slug(s.id.split(':')[1])].some(k => k === slug(n.label.replace(/[-_](server|app|web)$/i, ''))));
    // kept beside it rather than mixed in, so someone who may not see where the container came from doesn't learn it
    if (twin) { twin.also = { label: n.label, from: n.from, state: n.state, detail: n.detail }; continue; }
    if (!kept.some(k => k.id === n.id)) kept.push(n);
  }

  const netIds = [...new Set([...hosts.values()].map(h => h.net))];
  const lans = netIds.filter(n => n !== 'tailnet');
  const netNode = (n: string): MapNode => n === 'tailnet' ? { id: 'net:tailnet', label: names.get('tailnet') ?? 'Tailscale', kind: 'network', parent: 'internet', icon: '/api/icon/tailscale' }
    : { id: `net:${n}`, label: names.get(`${n}.0/24`) ?? (lans.length > 1 && n !== 'lan' ? `${n}.0/24` : 'Local network'), kind: 'network', parent: 'internet', detail: n === 'lan' ? undefined : `${n}.0/24` };
  nodes.push({ id: 'internet', label: 'Internet', kind: 'internet' });
  for (const n of netIds.sort((a, b) => Number(a === 'tailnet') - Number(b === 'tailnet') || a.localeCompare(b, undefined, { numeric: true }))) nodes.push(netNode(n));
  const order = [...hosts.values()].sort((a, b) => Number(b.here) - Number(a.here) || kept.filter(n => n.parent === b.id).length - kept.filter(n => n.parent === a.id).length || a.label.localeCompare(b.label));
  for (const h of order) nodes.push({ id: h.id, label: h.label, kind: 'host', parent: `net:${h.net}`, from: h.from, state: h.state, icon: h.icon,
    detail: [h.here ? 'Valet runs here' : undefined, h.detail].filter(Boolean).join(' · ') || undefined, address: [...h.addresses].slice(0, 3).join(', ') || undefined });
  const rank = (n: MapNode) => (stateNow(n) === 'down' ? 0 : stateNow(n) === 'degraded' ? 1 : 2) * 10 + ({ service: 0, vm: 1, container: 2, device: 3 } as Record<string, number>)[n.kind];
  nodes.push(...publics, ...kept.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)));

  // the machines' and the internet's own dots, and the headline, are worked out from what's on them: again after narrowing
  return settle({ type: 'map', title: o.title, icon: 'wifi', nodes, empty: 'No integration here names an address yet' });
}

const sameType = (peers: Peer[], p: Peer) => peers.filter(x => x.type === p.type).length > 1;
const guestState = (r: ListItem): ServiceState => r.dot === 'bad' ? 'down' : r.dot === 'warn' ? 'degraded' : /stopped/.test(r.subtitle ?? '') ? 'off' : 'up';

/** The map in a few lines for the model: each machine, where it is, and what runs on it, trouble said in words. */
export function told(card: MapCard, only?: string) {
  const kids = (id: string) => card.nodes.filter(n => n.parent === id);
  const say = (n: MapNode) => { const st = stateNow(n); return [n.label, n.kind === 'service' ? undefined : n.kind, n.address, st && st !== 'up' ? `${st}${n.detail ? `: ${n.detail}` : ''}` : undefined,
    n.also ? `container ${n.also.label}${n.also.state && n.also.state !== 'up' ? ` ${n.also.state}` : ''}` : undefined].filter(Boolean).join(', '); };
  const q = only?.toLowerCase();
  const hosts = card.nodes.filter(n => n.kind === 'host' && (!q || n.label.toLowerCase().includes(q) || n.address?.toLowerCase().includes(q) || kids(n.id).some(k => k.label.toLowerCase().includes(q))));
  return {
    machines: hosts.map(h => ({ machine: h.label, network: card.nodes.find(n => n.id === h.parent)?.label, address: h.address, state: stateNow(h) ?? 'not known', note: h.detail, runs: kids(h.id).map(say) })),
    ...(q ? {} : { internet: kids('internet').filter(n => n.kind !== 'network').map(say) }),
  };
}

export default defineIntegration({
  type: 'network',
  name: 'Network',
  config: z.object({
    title: z.string().default('Network'),                  // the card's title
    names: z.record(z.string(), z.string()).default({}),   // what to call a machine, by its address: { 192.168.1.20: Server }. Two addresses given one name are one machine; localhost names the one Valet runs on
    containers: z.boolean().default(true),                 // containers, VMs and machines' own services, from docker, machines, host and proxmox
    hide: z.array(z.string()).default([]),                 // integrations (by their key), machines or containers (by name) to leave off
  }),
  create(cfg, ctx) {
    // a container list that isn't on the page is read once a minute at most: the map is never what makes Docker busy
    const kept = new Map<string, { at: number; card?: Card }>();
    async function build() {
      const peers = ctx.lab?.() ?? [];
      if (cfg.containers) await Promise.all(peers.filter(p => SOURCES.has(p.type)).flatMap(p => p.widgets.filter(w => !w.placed && ['containers', 'units', 'services', 'guests', 'fleet'].includes(w.name)).map(async w => {
        const k = `${p.id}.${w.name}`, old = kept.get(k);
        if (old && Date.now() - old.at < 60_000) { w.card = old.card; return; }
        const card = await w.read().catch(() => undefined);
        kept.set(k, { at: Date.now(), card }); w.card = card;
      })));
      return mapFrom(peers, cfg);
    }
    return {
      // it asks nobody anything, so it can look often: a service that just went down shows within a few seconds
      widgets: { map: { title: cfg.title, interval: 5_000, card: 'map', fetch: build } },
      tools: {
        network_map: {
          label: 'Looked at the network', access: 'read', followUps: ['Is anything down?'],
          description: 'What runs where in the homelab: each machine, its network and address, and the services, containers and VMs on it, with whether each is answering. Use for "what runs on the server?", "where is Sonarr?", "what\'s on 192.168.1.20?". Only host and port are known, never paths or keys.',
          input: z.object({ host: z.string().max(100).optional().describe('one machine, by name or address, or something that runs on it') }),
          // someone with a profile is told only of the integrations on their tabs, as their page shows them
          async run({ host }, who) {
            const all = await build(), card = who ? mapFor(all, who.sees) : all, data = told(card, host);
            // asked about one machine, the card shows that one, on its network, with what runs on it
            const picked = card.nodes.filter(n => n.kind === 'host' && data.machines.some(m => m.machine === n.label));
            const ids = new Set(picked.map(h => h.id)), nets = new Set(picked.map(h => h.parent));
            const nodes = host ? card.nodes.filter(n => n.kind === 'internet' || nets.has(n.id) || ids.has(n.id) || (!!n.parent && ids.has(n.parent))) : card.nodes;
            return { data, card: { ...card, nodes, summary: undefined } };
          },
        },
      },
    };
  },
});
