// The network map: a tree laid out in rows, the internet on top, then each network, then a column per machine with what
// runs on it listed down a spine. The layout is plain CSS and the same every time for the same card; the only drawing is
// the links from a network to its machines, measured from where the browser put them, and only while they sit in one row.
// Once they wrap (a phone, a narrow card) each network is a heading over its machines instead, so nothing ever crosses.
import './netmap.css';
import { AppWindow, Box, Globe, Monitor, Network, Server, Smartphone, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Empty } from './empty.tsx';
import type { MapCard, MapKind, MapNode, ServiceState } from '../shared/cards.ts';

const GLYPH: Record<MapKind, LucideIcon> = { internet: Globe, network: Network, host: Server, vm: Monitor, container: Box, service: AppWindow, device: Smartphone };
const DOT: Record<ServiceState, string> = { up: 'dot-good', degraded: 'dot-warn', down: 'dot-bad', off: 'dot-off' };
const SAY: Record<ServiceState, string> = { up: 'up', degraded: 'unwell', down: 'down', off: 'off by choice' };
const KINDS: Partial<Record<MapKind, [string, string]>> = { container: ['container', 'containers'], vm: ['VM', 'VMs'], service: ['service', 'services'], device: ['device', 'devices'] };

interface Tree { byId: Map<string, MapNode>; kids: Map<string, MapNode[]>; top: MapNode[] }
/** Who hangs from whom. A parent that isn't there, or a loop, puts a node at the top rather than losing it. */
export function treeOf(nodes: MapNode[]): Tree {
  const byId = new Map(nodes.map(n => [n.id, n])), kids = new Map<string, MapNode[]>(), top: MapNode[] = [];
  const loops = (n: MapNode) => { const seen = new Set([n.id]); for (let p = n.parent; p; p = byId.get(p)?.parent) { if (seen.has(p)) return true; seen.add(p); } return false; };
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent) && n.parent !== n.id && !loops(n)) kids.set(n.parent, [...kids.get(n.parent) ?? [], n]);
    else top.push(n);
  }
  return { byId, kids, top };
}

const COLUMN = 150, GAP = 12, NET_GAP = 28;
const columnsOf = (t: Tree, net: string) => { const k = t.kids.get(net) ?? []; return k.filter(n => n.kind === 'host').length + (k.some(n => n.kind !== 'host') ? 1 : 0); };
/** The least width the networks need side by side, each machine at its narrowest. */
export const rowWidth = (columns: number[]) => columns.reduce((w, c) => w + Math.max(1, c) * (COLUMN + GAP) - GAP, 0) + Math.max(0, columns.length - 1) * NET_GAP;

/** How many of a machine's things show before "+12 containers". Trouble is listed first, so it's never what's folded. */
export const shownOf = (dense: boolean, large: boolean, machines: number) => dense ? 3 : large ? 10 : machines > 4 ? 4 : 6;
/** "+12 containers", or "+5 more" when what's folded is of several kinds. */
export function moreOf(rest: MapNode[]) {
  const kinds = new Set(rest.map(n => n.kind)), k = kinds.size === 1 ? KINDS[rest[0].kind] : undefined;
  return `+${rest.length} ${k ? k[rest.length === 1 ? 0 : 1] : 'more'}`;
}

function Mark({ n, className }: { n: MapNode; className?: string }) {
  // which picture failed, not whether one did: a node's icon can change (its card arrives) and the new one deserves a try
  const [failed, setFailed] = useState<string>(), G = GLYPH[n.kind] ?? Box;
  if (n.icon && (n.icon.startsWith('/') || n.icon.startsWith('http')) && failed !== n.icon) return <img src={n.icon} alt="" loading="lazy" onError={() => setFailed(n.icon)} className={cn('nm-icon', className)} />;
  return <G className={cn('nm-icon nm-glyph', className)} aria-hidden />;
}

/** One node you can point at: what it is and how it is on hover or focus, and its page on a tap. */
function Node({ n, className, children }: { n: MapNode; className: string; children: ReactNode }) {
  const said = [n.state ? SAY[n.state] : undefined, n.detail, n.address].filter(Boolean).join(' · ');
  const label = `${n.label}${said ? `: ${said}` : ''}`;
  const el = n.href
    ? <a href={n.href} target="_blank" rel="noreferrer" className={cn(className, 'nm-link')} aria-label={label} data-id={n.id}>{children}</a>
    : <div tabIndex={said ? 0 : undefined} className={className} aria-label={label} data-id={n.id} role={said ? 'group' : undefined}>{children}</div>;
  if (!said) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72 text-left">
        <div className="font-medium">{n.label}</div>
        {[n.state ? SAY[n.state] : undefined, n.detail].filter(Boolean).length > 0 && <div className="opacity-80">{[n.state ? SAY[n.state] : undefined, n.detail].filter(Boolean).join(' · ')}</div>}
        {n.address && <div className="font-mono opacity-70">{n.address}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

const Dot = ({ s }: { s?: ServiceState }) => s ? <span className={cn('dot', DOT[s])} /> : null;

function Machine({ host, under, limit }: { host: MapNode; under: MapNode[]; limit: number }) {
  const [open, setOpen] = useState(false);
  const shown = open || under.length <= limit + 1 ? under : under.slice(0, limit), rest = under.slice(shown.length);
  return (
    <div className="nm-machine">
      <Node n={host} className="nm-host">
        <span className="nm-plate"><Mark n={host} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-item font-medium">{host.label}</span>
          {host.address && host.address !== host.label && <span className="block truncate text-meta tabular text-muted-foreground">{host.address}</span>}
        </span>
        <Dot s={host.state} />
      </Node>
      {under.length > 0 && (
        <ul className="nm-spine">
          {shown.map(n => (
            <li key={n.id}>
              <Node n={n} className="nm-leaf">
                <Mark n={n} />
                <span className="min-w-0 flex-1 truncate text-body">{n.label}</span>
                <Dot s={n.state} />
              </Node>
            </li>
          ))}
          {rest.length > 0 && <li><button type="button" className="nm-more" onClick={() => setOpen(true)} aria-expanded={false}>{moreOf(rest)}</button></li>}
          {open && under.length > limit + 1 && <li><button type="button" className="nm-more" onClick={() => setOpen(false)} aria-expanded>Show fewer</button></li>}
        </ul>
      )}
    </div>
  );
}

/** One network: its name, then its machines side by side, joined to it by lines while they fit in one row. */
function Net({ net, tree, limit }: { net: MapNode; tree: Tree; limit: number }) {
  const machines = tree.kids.get(net.id) ?? [];
  // what hangs from a network that isn't a machine (a device on the LAN) sits in a machine-like column of its own
  const loose = machines.filter(m => m.kind !== 'host'), hosts = machines.filter(m => m.kind === 'host');
  return (
    <section className="nm-net" aria-label={net.label}>
      <Node n={net} className="nm-pill nm-net-pill">
        <Mark n={net} /><span className="truncate">{net.label}</span>
        {net.detail && <span className="nm-pill-note tabular">{net.detail}</span>}
        <Dot s={net.state} />
      </Node>
      <div className="nm-hosts">
        {hosts.map(h => <Machine key={h.id} host={h} under={tree.kids.get(h.id) ?? []} limit={limit} />)}
        {loose.length > 0 && <Machine host={{ id: `${net.id}:loose`, label: 'Also here', kind: 'device', parent: net.id }} under={loose} limit={limit} />}
      </div>
    </section>
  );
}

export function NetMap({ card, dense = false, large = false }: { card: MapCard; dense?: boolean; large?: boolean }) {
  const tree = useMemo(() => treeOf(card.nodes), [card.nodes]);
  const box = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<{ d: string; tone?: ServiceState }[]>([]), [width, setWidth] = useState(0);
  const internet = tree.top.find(n => n.kind === 'internet');
  const nets = [...(internet ? tree.kids.get(internet.id) ?? [] : []), ...tree.top.filter(n => n !== internet)].filter(n => n.kind === 'network');
  const out = internet ? (tree.kids.get(internet.id) ?? []).filter(n => n.kind !== 'network') : [];
  // anything at the top that isn't the internet or a network (a machine with no network) gets one to stand in
  const orphans = tree.top.filter(n => n !== internet && n.kind !== 'network');
  const machines = card.nodes.filter(n => n.kind === 'host').length, limit = shownOf(dense, large, machines);
  // one row while every machine fits at its narrowest; worked out from the width alone, so it can't flip back and forth
  const columns = nets.map(n => columnsOf(tree, n.id)).concat(orphans.length ? [1] : []), wrapped = width > 0 && width < rowWidth(columns);
  // in a row, the machines share the width, up to a comfortable column each
  const count = columns.reduce((a, b) => a + Math.max(1, b), 0) || 1;
  const col = Math.max(COLUMN, Math.min(220, Math.floor((width - (rowWidth(columns) - count * COLUMN)) / count)));

  // the links: measured after layout, again whenever the box changes size; set only when they change, so it settles
  const measure = useRef(() => {});
  measure.current = () => {
    const el = box.current;
    if (!el) return;
    const at = el.getBoundingClientRect(), scale = at.width / (el.offsetWidth || 1) || 1;
    const rect = (q: Element) => { const r = q.getBoundingClientRect(); return { x: (r.left - at.left) / scale, y: (r.top - at.top) / scale, w: r.width / scale, h: r.height / scale }; };
    // down, across a shared rail halfway, and down again, with the corners rounded: the machines read as hanging from it
    const link = (a: Element, b: Element) => {
      const p = rect(a), c = rect(b), x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y, m = (y1 + y2) / 2, f = (n: number) => n.toFixed(1);
      const dx = x2 - x1, r = Math.min(8, Math.abs(dx) / 2, (y2 - y1) / 2), s = Math.sign(dx);
      if (Math.abs(dx) < 1) return `M${f(x1)},${f(y1)}V${f(y2)}`;
      return `M${f(x1)},${f(y1)}V${f(m - r)}Q${f(x1)},${f(m)} ${f(x1 + s * r)},${f(m)}H${f(x2 - s * r)}Q${f(x2)},${f(m)} ${f(x2)},${f(m + r)}V${f(y2)}`;
    };
    const next: { d: string; tone?: ServiceState }[] = [];
    const top = el.querySelector('.nm-internet');
    for (const s of el.querySelectorAll<HTMLElement>('.nm-net')) {
      const pill = s.querySelector('.nm-net-pill'), heads = [...s.querySelectorAll('.nm-host')];
      if (top && pill) next.push({ d: link(top, pill), tone: tree.byId.get(pill.getAttribute('data-id') ?? '')?.state });
      if (pill) for (const h of heads) next.push({ d: link(pill, h), tone: tree.byId.get(h.getAttribute('data-id') ?? '')?.state });
    }
    setLinks(l => JSON.stringify(l) === JSON.stringify(next) ? l : next);
  };
  useLayoutEffect(() => {
    measure.current();
    const o = new ResizeObserver(([e]) => { setWidth(Math.round(e.contentRect.width)); measure.current(); });
    if (box.current) o.observe(box.current);
    return () => o.disconnect();
  }, [card.nodes, wrapped]);

  if (!card.nodes.length) return <Empty icon={Network} text={card.empty ?? 'Nothing to draw yet'} height={dense ? 96 : 200} />;
  return (
    <div ref={box} className={cn('nm', wrapped ? 'is-wrapped' : 'is-tree', dense && 'is-dense')} style={width ? { '--nm-col': `${col}px` } as CSSProperties : undefined} role="group" aria-label={card.title ?? 'Network map'}>
      {/* a line to something down goes under the others, so only the part that's its own is dashed */}
      {!wrapped && <svg className="nm-links" aria-hidden>{[...links].sort((a, b) => Number(b.tone === 'down') - Number(a.tone === 'down')).map((l, i) => <path key={i} d={l.d} className={cn(l.tone === 'down' && 'is-down')} />)}</svg>}
      {internet && (
        <div className="nm-top">
          <Node n={internet} className="nm-pill nm-internet"><Mark n={internet} /><span>{internet.label}</span><Dot s={internet.state} /></Node>
          {out.length > 0 && (
            <ul className="nm-out" aria-label="Out on the internet">
              {out.map(n => <li key={n.id}><Node n={n} className="nm-chip"><Mark n={n} /><span className="truncate">{n.label}</span><Dot s={n.state} /></Node></li>)}
            </ul>
          )}
        </div>
      )}
      <div className="nm-nets">
        {nets.map(n => <Net key={n.id} net={n} tree={tree} limit={limit} />)}
        {orphans.length > 0 && <Net net={{ id: 'nm:orphans', label: 'Elsewhere', kind: 'network' }} tree={{ ...tree, kids: new Map([...tree.kids, ['nm:orphans', orphans]]) }} limit={limit} />}
      </div>
    </div>
  );
}
