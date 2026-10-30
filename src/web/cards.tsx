// Renders any card from the shared catalog with shadcn/ui primitives. The homepage and the assistant both use this,
// so a generated card looks exactly like the widget it came from.
import {
  Activity, ArrowUpRight, Bookmark, Coins, MessageCircle, Type, ChevronLeft, FileText, ChevronRight, Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Cpu, Moon, Sun, Download, Film, Gpu, HardDrive, House, Lightbulb, MemoryStick, Pause, Play, Shield, Wifi,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Card as CardT, ForecastCard, ShowcaseCard, ChartCard, Control, ControlsCard, ListCard, MediaCard, MediaItem, ShelfCard, StatsCard, StatusCard, Summary, Tone } from '../shared/cards.ts';

const ICONS: Record<string, LucideIcon> = {
  cpu: Cpu, gpu: Gpu, memory: MemoryStick, wifi: Wifi, disk: HardDrive, download: Download, pulse: Activity, play: Play, film: Film,
  bulb: Lightbulb, home: House, shield: Shield, chat: MessageCircle, coins: Coins, text: Type,
  file: FileText, bookmark: Bookmark, sun: Sun, moon: Moon, cloud: Cloud, 'cloud-sun': CloudSun, 'cloud-moon': CloudMoon, rain: CloudRain, snow: CloudSnow, fog: CloudFog, storm: CloudLightning,
};
export function Icon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  if (name.startsWith('http') || name.startsWith('/')) return <img src={name} alt="" className={cn('size-4', className)} />;
  const I = ICONS[name];
  return I ? <I className={cn('size-4', className)} aria-hidden /> : null;
}

const toneText: Record<Tone, string> = { neutral: '', good: 'text-good', warn: 'text-warn', bad: 'text-bad', accent: 'text-primary' };
const toneBar: Record<Tone, string> = { neutral: '', good: '[&>div]:bg-good', warn: '[&>div]:bg-warn', bad: '[&>div]:bg-bad', accent: '' };
const toneVar = (t?: Tone) => (t && t !== 'neutral' && t !== 'accent' ? `var(--${t})` : 'var(--primary)');

function Spark({ points, tone }: { points: number[]; tone?: Tone }) {
  if (points.length < 2) return <div className="h-12" />;
  const w = 100, h = 32, max = Math.max(...points, 1), min = Math.min(...points, 0);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 3 - ((p - min) / (max - min || 1)) * (h - 6)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  const id = `g${Math.round(Math.random() * 1e9)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full" aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={toneVar(tone)} stopOpacity=".22" /><stop offset="1" stopColor={toneVar(tone)} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={toneVar(tone)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const Bar = ({ pct, tone }: { pct: number; tone?: Tone }) =>
  <Progress value={Math.max(1.5, Math.min(100, pct * 100))} className={cn('h-1', toneBar[tone ?? 'neutral'])} />;

/** One point per card: the first item is the hero (large number, its label, one sparkline); the rest become a quiet
 *  footer of at most three small facts, divided by hairlines. */
function Stats({ card }: { card: StatsCard }) {
  const [hero, ...rest] = card.items;
  if (!hero) return null;
  const facts = rest.slice(0, 3);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-5">
        <div className="min-w-0 shrink-0">
          <div className={cn('metric text-[44px] leading-[0.95]', toneText[hero.tone ?? 'neutral'])}>
            {hero.value}{hero.unit && <span className="ml-1 text-[18px] font-medium tracking-normal text-muted-foreground">{hero.unit}</span>}
          </div>
          <div className="mt-1.5 truncate text-[13px] text-muted-foreground">{[hero.label, hero.sub].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="min-w-0 flex-1 pb-1">
          {hero.trend ? <Spark points={hero.trend} tone={hero.tone} /> : hero.pct != null ? <Bar pct={hero.pct} tone={hero.tone} /> : null}
        </div>
      </div>
      {facts.length > 0 && (
        <div className="grid divide-x border-t pt-3.5" style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
          {facts.map(f => (
            <div key={f.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
              <div className="truncate text-[11.5px] text-muted-foreground">{f.label}</div>
              <div className={cn('metric truncate text-[17px]', toneText[f.tone ?? 'neutral'])}>
                {f.value}{f.unit && <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">{f.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;

function List({ card }: { card: ListCard }) {
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing here'} />;
  return (
    <ul className="-my-1 divide-y">
      {card.items.map((it, i) => (
        <li key={i} className="flex min-w-0 items-center gap-3 py-2.5">
          {it.image && <img src={it.image} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-md bg-muted object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <div className="min-w-0 flex-1 truncate text-sm font-medium">{it.title}</div>
              {it.meta && <div className="shrink-0 text-xs tabular text-muted-foreground">{it.meta}</div>}
            </div>
            {it.subtitle && <div className={cn('truncate text-xs', it.tone && it.tone !== 'neutral' ? toneText[it.tone] : 'text-muted-foreground')}>{it.subtitle}</div>}
            {it.pct != null && <div className="mt-2"><Bar pct={it.pct} tone={it.tone} /></div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** An app icon that falls back to the service's initial if no icon exists. */
function AppIcon({ src, name, small }: { src?: string; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? 'size-[18px]' : 'size-7';
  if (!src || failed) return <span className={cn(size, 'grid shrink-0 place-items-center rounded-md bg-secondary font-semibold text-muted-foreground', small ? 'text-[10px]' : 'text-xs')}>{name[0]}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cn(size, 'shrink-0 object-contain')} />;
}

function ServiceRow({ s, minimal }: { s: StatusCard['items'][number]; minimal?: boolean }) {
  // minimal: one tight line, icon, name and the dot; trouble still says what's wrong
  if (minimal) return (
    <a href={s.href} target="_blank" rel="noreferrer" title={s.ok ? `${s.name} · ${s.ms ?? ''} ms` : `${s.name} · ${s.quiet ? 'offline' : s.detail}`}
      className="flex min-w-0 break-inside-avoid items-center gap-2.5 rounded-lg px-2 py-[5px] transition-colors hover:bg-accent">
      <AppIcon src={s.icon} name={s.name} small />
      <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
      {!s.ok && !s.quiet && <span className="truncate text-[11px] text-bad">{s.detail}</span>}
      <span className={cn('dot size-1.5', s.ok ? 'dot-good' : s.quiet ? 'bg-muted-foreground/40' : 'dot-bad')} />
    </a>
  );
  return (
    <a href={s.href} target="_blank" rel="noreferrer" className="flex min-w-0 break-inside-avoid items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent">
      <AppIcon src={s.icon} name={s.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.name}</div>
        <div className={cn('truncate text-xs tabular', s.ok || s.quiet ? 'text-muted-foreground' : 'text-bad')}>{s.ok ? (s.ms != null ? `${s.ms} ms` : 'Up') : s.quiet ? 'Offline' : s.detail}</div>
      </div>
      <span className={cn('dot', s.ok ? 'dot-good' : s.quiet ? 'bg-muted-foreground/40' : 'dot-bad')} />
    </a>
  );
}

/** Services in columns. With groups, each group is a block (heading + its services) and the blocks flow into as
 *  many columns as fit, so a long list stays short. */
function Status({ card, columns, minimal }: { card: StatusCard; columns?: number; minimal?: boolean }) {
  const groups = [...new Set(card.items.map(i => i.group ?? ''))];
  if (groups.length === 1 && !groups[0]) return (
    <div className="-mx-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {card.items.map(s => <ServiceRow key={s.name} s={s} minimal={minimal} />)}
    </div>
  );
  // a long group (more than six) runs on into a second column beside itself, under the same heading
  const blocks = groups.flatMap(g => {
    const items = card.items.filter(i => (i.group ?? '') === g);
    if (items.length <= 6 || columns) return [{ g, label: g, items }];
    const half = Math.ceil(items.length / 2);
    return [{ g, label: g, items: items.slice(0, half) }, { g: `${g}·2`, label: '', items: items.slice(half) }];
  });
  return (
    <div className="-mx-2 gap-x-4" style={columns ? { columnCount: columns } : { columnWidth: minimal ? '165px' : '220px' }}>
      {blocks.map(b => (
        // with a set column count (a sidebar list) groups flow on across columns; otherwise each stays whole
        <div key={b.g} className={cn(minimal ? 'mb-2' : 'mb-3', columns ? 'break-inside-auto' : 'break-inside-avoid')}>
          {groups.some(Boolean) && <div className={cn('break-after-avoid px-2 font-medium text-muted-foreground', minimal ? 'pt-1 pb-0.5 text-[11px]' : 'pt-1 pb-1.5 text-xs')}>{b.label || '\u00a0'}</div>}
          {b.items.map(s => <ServiceRow key={s.name} s={s} minimal={minimal} />)}
        </div>
      ))}
    </div>
  );
}

/** Artwork that fades in once decoded, so nothing pops. */
function Art({ src, className, alt = '' }: { src?: string; className?: string; alt?: string }) {
  const [ready, setReady] = useState(false);
  if (!src) return null;
  return <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setReady(true)}
    className={cn('transition-opacity duration-700 ease-out', ready ? 'opacity-100' : 'opacity-0', className)} />;
}

/** One stream as a cinematic tile: the backdrop is the card, details float over a soft scrim. */
export function NowPlaying({ m, compact }: { m: MediaItem; compact?: boolean }) {
  return (
    <div className={cn('@container/np relative isolate w-full overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-[0_18px_40px_-20px_rgb(0_0_0/0.55)]',
      compact ? 'aspect-[16/9] min-h-[170px]' : 'aspect-[16/9] max-h-[210px] min-h-[170px] @3xl/main:aspect-[3.6/1]')}>
      {m.backdrop
        ? <Art src={m.backdrop} className="absolute inset-0 -z-10 size-full object-cover" />
        : <Art src={m.image} className="absolute inset-0 -z-10 size-full scale-125 object-cover blur-2xl saturate-150" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 p-5 @md/np:p-6">
        <Art src={m.image} className="hidden aspect-[2/3] w-[84px] shrink-0 rounded-lg object-cover shadow-[0_16px_32px_-8px_rgb(0_0_0/0.7)] @md/np:block @2xl/np:w-[96px]" />
        <div className="min-w-0 flex-1">
          {m.tags && m.tags.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {m.tags.map(t => <span key={t} className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium tracking-wide backdrop-blur-md">{t}</span>)}
            </div>
          )}
          <div className="truncate text-xl font-semibold tracking-tight @md/np:text-2xl">{m.title}</div>
          {m.subtitle && <div className="truncate text-[15px] text-white/75">{m.subtitle}</div>}
          <div className="mt-4 flex items-center gap-3">
            {m.state === 'paused' ? <Pause className="size-3.5 shrink-0 fill-white" /> : m.icon ? <Icon name={m.icon} className="size-3.5 shrink-0" /> : <Play className="size-3.5 shrink-0 fill-white" />}
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-[width] duration-1000" style={{ width: `${Math.round((m.pct ?? 0) * 100)}%` }} />
            </div>
            {m.remaining && <span className="shrink-0 text-xs tabular text-white/80">{m.remaining}</span>}
          </div>
          {(m.user || m.device) && <div className="mt-2 truncate text-xs text-white/65">{m.user}{m.device ? ` on ${m.device}` : ''}{m.state === 'paused' ? ' · Paused' : ''}</div>}
        </div>
      </div>
    </div>
  );
}

/** True when a card has nothing worth a slot on the page (e.g. Now Playing with nothing playing). */
export const isEmpty = (card?: CardT) => card?.type === 'media' && !card.items.length;

function Media({ card }: { card: MediaCard }) {
  if (!card.items.length) return (
    <div className="grid min-h-[180px] place-items-center rounded-2xl bg-card text-center shadow-card">
      <div><Film className="mx-auto mb-2 size-5 text-muted-foreground" /><div className="text-sm text-muted-foreground">{card.empty ?? 'Nothing playing'}</div></div>
    </div>
  );
  if (card.items.length === 1) return <NowPlaying m={card.items[0]} />;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
      {card.items.map((m, i) => <NowPlaying key={i} m={m} compact />)}
    </div>
  );
}

/** A row of artwork, like the Apple TV app: snap-scrolling, no borders, arrows to page through on desktop. */
function Shelf({ card, header, small }: { card: ShelfCard; header?: ReactNode; small?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const page = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  const ratio = card.aspect === 'square' ? 'aspect-square' : card.aspect === 'wide' ? 'aspect-video' : 'aspect-[2/3]';
  const width = small ? (card.aspect === 'wide' ? 'w-[180px]' : 'w-[92px]') : card.aspect === 'wide' ? 'w-[240px] @3xl/main:w-[280px]' : 'w-[128px] @3xl/main:w-[150px]';
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {header}
        <div className={cn('ml-auto hidden gap-1.5', card.items.length > (small ? 4 : 6) && 'sm:flex')}>
          <button onClick={() => page(-1)} aria-label="Previous" className="grid size-7 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft className="size-4" /></button>
          <button onClick={() => page(1)} aria-label="Next" className="grid size-7 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground"><ChevronRight className="size-4" /></button>
        </div>
      </div>
      {card.items.length === 0 ? <Empty text={card.empty ?? 'Nothing here yet'} /> : (
        <div ref={row} className="-mx-2 -my-3 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {card.items.map((it, i) => {
            const inner = (
              <>
                <div className={cn('relative overflow-hidden rounded-xl bg-muted shadow-[0_10px_24px_-12px_rgb(0_0_0/0.45)] transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_18px_32px_-12px_rgb(0_0_0/0.5)]', ratio)}>
                  <Art src={it.image} alt={it.title} className="size-full object-cover" />
                  {it.badge && <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-md">{it.badge}</span>}
                </div>
                <div className="mt-2.5 truncate text-[13px] font-medium">{it.title}</div>
                {it.subtitle && <div className="truncate text-xs text-muted-foreground">{it.subtitle}</div>}
              </>
            );
            return it.href
              ? <a key={i} href={it.href} target="_blank" rel="noreferrer" className={cn('group shrink-0 snap-start', width)}>{inner}</a>
              : <div key={i} className={cn('group shrink-0 snap-start', width)}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}

function Chart({ card }: { card: ChartCard }) {
  const w = 300, h = 96;
  const all = card.series.flatMap(s => s.points), max = card.max ?? Math.max(...all, 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="var(--border)" vectorEffect="non-scaling-stroke" />)}
        {card.series.map((s, k) => {
          const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, s.points.length - 1)) * w).toFixed(1)},${(h - 2 - (p / max) * (h - 6)).toFixed(1)}`).join('');
          const color = k ? 'var(--muted-foreground)' : toneVar(s.tone);
          return <g key={s.name}>{!k && <path d={`${d}L${w},${h}L0,${h}Z`} fill={color} opacity=".1" />}
            <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></g>;
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">{card.series.map(s => <span key={s.name}>{s.name}</span>)}{card.span && <span className="ml-auto">{card.span}</span>}</div>
    </div>
  );
}

export type RunAction = (action: string, args?: Record<string, unknown>) => Promise<void>;

function Controls({ card, run }: { card: ControlsCard; run?: RunAction }) {
  const fire = (c: Control, extra: Record<string, unknown>) => c.action && run?.(c.action, { ...c.args, ...extra });
  return (
    <div className="-my-1 divide-y">
      {card.items.map(c => (
        <div key={c.id} className="flex min-h-12 min-w-0 items-center gap-3 py-2">
          {c.color !== undefined && <span className="size-2.5 shrink-0 rounded-full ring-1 ring-border" style={{ background: c.color ?? 'var(--muted)' }} />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{c.label}</div>
            {c.sub && <div className="truncate text-xs text-muted-foreground">{c.sub}</div>}
          </div>
          {c.kind === 'value' && <span className="text-sm tabular text-muted-foreground">{String(c.value ?? '–')}</span>}
          {c.kind === 'toggle' && <Switch checked={!!c.value} disabled={!run} aria-label={c.label} onCheckedChange={v => fire(c, { value: v })} />}
          {c.kind === 'slider' && (
            <Slider className="w-32" min={c.min ?? 0} max={c.max ?? 100} step={c.step ?? 1} defaultValue={[Number(c.value ?? 0)]} disabled={!run}
              aria-label={c.label} onValueCommit={v => fire(c, { value: v[0] })} />
          )}
          {c.kind === 'select' && (
            <Select defaultValue={String(c.value ?? '')} disabled={!run} onValueChange={v => fire(c, { value: v })}>
              <SelectTrigger size="sm" className="w-40" aria-label={c.label}><SelectValue /></SelectTrigger>
              <SelectContent>{c.options?.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {c.kind === 'button' && <Button size="sm" variant="secondary" disabled={!run} onClick={() => fire(c, {})}>{String(c.value ?? 'Run')}</Button>}
        </div>
      ))}
    </div>
  );
}

/** The body of a card, without its frame. */
// Showcase visuals load on demand, so a page without them never downloads them.
const VISUALS: Record<string, React.LazyExoticComponent<(p: { data: any; run?: RunAction }) => ReactNode>> = {
  'pc-case': lazy(() => import('./visuals/pc-case.tsx')),
  home: lazy(() => import('./visuals/home-case.tsx')),
};

/** The visual on the left, its numbers stacked on the right: big values, quiet labels, nothing else. */
function Showcase({ card, run }: { card: ShowcaseCard; run?: RunAction }) {
  const V = VISUALS[card.visual.kind];
  // an interactive visual with no numbers of its own beside it lays itself out
  if (V && !card.items.length) return <Suspense fallback={<Skeleton className="aspect-[4/3] w-full rounded-xl" />}><V data={card.visual.data} run={run} /></Suspense>;
  return (
    <div className="grid items-center gap-x-6 gap-y-4 @md/card:grid-cols-[minmax(0,1fr)_150px]">
      <div className="min-w-0">
        {V ? <Suspense fallback={<Skeleton className="aspect-square w-full rounded-xl" />}><V data={card.visual.data} /></Suspense>
          : card.visual.src ? <img src={card.visual.src} alt="" className="w-full rounded-xl object-cover" /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 @md/card:grid-cols-1 @md/card:gap-y-5">
        {card.items.map(s => (
          <div key={s.label} className="min-w-0">
            <dt className="text-[12px] text-muted-foreground">{s.label}</dt>
            <dd className={cn('metric mt-0.5 truncate text-[26px] leading-none', toneText[s.tone ?? 'neutral'])}>
              {s.value}{s.unit && <span className="ml-0.5 text-[14px] font-medium text-muted-foreground">{s.unit}</span>}
            </dd>
            {s.sub && <div className="mt-1 truncate text-[12px] text-muted-foreground">{s.sub}</div>}
          </div>
        ))}
        {card.caption && <div className="col-span-full text-[12px] text-muted-foreground">{card.caption}</div>}
      </dl>
    </div>
  );
}

export function CardBody({ card, run, columns, minimal }: { card: CardT; run?: RunAction; columns?: number; minimal?: boolean }): ReactNode {
  switch (card.type) {
    case 'showcase': return <Showcase card={card} run={run} />;
    case 'forecast': return <Forecast card={card} />;
    case 'stats': return <Stats card={card} />;
    case 'list': return <List card={card} />;
    case 'status': return <Status card={card} columns={columns} minimal={minimal} />;
    case 'media': return <Media card={card} />;
    case 'shelf': return <Shelf card={card} />;
    case 'chart': return <Chart card={card} />;
    case 'controls': return <Controls card={card} run={run} />;
    case 'kv': return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{card.rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular">{v}</dd></Fragment>)}</dl>;
    case 'text': return <p className={cn('text-sm', toneText[card.tone ?? 'neutral'])}>{card.text}</p>;
    case 'group': return (
      <div className={card.layout === 'row' ? 'grid gap-4 @lg:grid-cols-2' : 'space-y-4'}>
        {card.cards.map((c, i) => <Widget key={i} card={c} run={run} compact />)}
      </div>
    );
  }
}

/** A card in its frame: title, icon, header note, "open app" link. */
function BareHeader({ card, title, status }: { card?: CardT; title?: string; status?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h3 className="truncate text-[15px] font-semibold tracking-tight">{card?.title ?? title}</h3>
      {status}
      {card?.note && <span className="truncate text-xs tabular text-muted-foreground">{card.note}</span>}
      {card?.href && <a href={card.href} target="_blank" rel="noreferrer" aria-label={`Open ${card.title ?? title}`} className="text-muted-foreground transition-colors hover:text-foreground"><ArrowUpRight className="size-4" /></a>}
    </div>
  );
}

export function Widget({ card, run, title, status, compact, columns, minimal, headless }: { card?: CardT; run?: RunAction; title?: string; status?: ReactNode; compact?: boolean; columns?: number; minimal?: boolean; headless?: boolean }) {
  // artwork-led cards sit directly on the page, without a card frame
  if (card?.type === 'shelf') return <Shelf card={card} small={compact} header={<BareHeader card={card} title={title} status={status} />} />;
  if (card?.type === 'media') return (
    <div className="min-w-0 space-y-3"><BareHeader card={card} title={title} status={status} /><Media card={card} /></div>
  );
  const t = card?.title ?? title;
  const bare = card?.type === 'group';
  return (
    <Card className={cn('@container/card min-w-0 gap-4 shadow-card', compact ? 'py-4 shadow-none' : 'py-5', bare && 'border-0 bg-transparent py-0 shadow-none')}>
      {t && !bare && !headless && (
        <CardHeader className={cn('flex items-center gap-2', compact ? 'px-4' : 'px-5')}>
          {card?.icon && <span className="icon-tile"><Icon name={card.icon} /></span>}
          <CardTitle className="truncate text-[15px]">{t}</CardTitle>
          {status}
          <CardAction className="flex items-center gap-2 self-center">
            {card?.note && <span className="truncate text-xs tabular text-muted-foreground">{card.note}</span>}
            {card?.href && (
              <a href={card.href} target="_blank" rel="noreferrer" aria-label={`Open ${t}`} className="text-muted-foreground transition-colors hover:text-foreground">
                <ArrowUpRight className="size-4" />
              </a>
            )}
          </CardAction>
        </CardHeader>
      )}
      <CardContent className={cn(bare ? 'p-0' : compact ? 'px-4' : 'px-5')}>
        {card ? <CardBody card={card} run={run} columns={columns ?? (compact && card.type === 'status' ? 2 : undefined)} minimal={minimal || (compact && card.type === 'status')} /> : <div className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/5" /></div>}
      </CardContent>
    </Card>
  );
}

/** A smooth path through points (Catmull-Rom → cubic Bézier), for graphs that read as calm curves, not zig-zags. */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[i + 2] ?? pts[i + 1];
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)},${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)},${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

/** The live graph behind a summary tile: a soft filled area across the lower part of the tile. */
function TileGraph({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 200, h = 60, max = Math.max(...points), min = Math.min(...points), span = max - min || Math.max(1, max);
  const pts = points.map((p, i) => [(i / (points.length - 1)) * w, h - 4 - ((p - min) / span) * (h - 14)] as [number, number]);
  const line = smooth(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] w-full" aria-hidden>
      <defs>
        <linearGradient id="tileFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".16" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill="url(#tileFill)" />
      <path d={line} fill="none" stroke="currentColor" strokeOpacity=".38" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Headline tile for the overview's top row: label and context up top, the value at the bottom, a live graph behind. */
export function SummaryTile({ s, href }: { s: Summary; href?: string }) {
  const body = (
    <Card className="relative h-[136px] gap-0 overflow-hidden py-0 shadow-card transition-colors hover:bg-accent/30">
      <div className="text-foreground"><TileGraph points={s.trend ?? []} /></div>
      <div className="relative flex h-full flex-col p-4">
        <div className="flex items-start gap-3">
          {s.icon && <Icon name={s.icon} className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight">{s.label}</div>
            {s.sub && <div className="truncate text-[13px] text-muted-foreground">{s.sub}</div>}
          </div>
          {s.tone && (s.tone === 'good' || s.tone === 'bad') && <span className={cn('dot ml-auto mt-1.5', s.tone === 'good' ? 'dot-good' : 'dot-bad')} />}
        </div>
        <div className="mt-auto flex items-baseline justify-between gap-3">
          <div className={cn('metric truncate text-[22px] leading-none', toneText[s.tone === 'good' ? 'neutral' : s.tone ?? 'neutral'])}>{s.value}</div>
          {s.detail && <div className="shrink-0 truncate text-xs tabular text-muted-foreground">{s.detail}</div>}
        </div>
      </div>
    </Card>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className="block min-w-0">{body}</a> : <div className="min-w-0">{body}</div>;
}

/** A ring gauge: a ¾ circle (gap at the bottom), the number in the middle, coloured by health. */
export function Ring({ s }: { s: Summary }) {
  const r = 40, c = 2 * Math.PI * r, arc = c * 0.75, pct = Math.max(0, Math.min(1, s.pct ?? 0));
  const color = s.tone === 'bad' ? 'var(--bad)' : s.tone === 'warn' ? 'var(--warn)' : s.tone === 'accent' ? 'var(--primary)' : 'var(--good)';
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="relative size-[104px]">
        <svg viewBox="0 0 100 100" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-700 ease-out"
            style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 45%, transparent))` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon name={s.icon} className="mb-0.5 size-4 text-muted-foreground" />
          <div className="metric max-w-[76px] truncate text-[19px] leading-tight">{s.ring ?? s.value}</div>
        </div>
      </div>
      <div className="mt-1 max-w-full truncate text-[13px] font-medium">{s.label}</div>
      {s.detail && <div className="max-w-full truncate text-[11.5px] text-muted-foreground">{s.detail}</div>}
    </div>
  );
}

/** A hover/focus popover under a menubar item. The frost sits on the element that fades: a parent fading its
 *  opacity would stop Chrome blurring anything inside it until the fade ends (the flicker). */
function Popover({ group, className, children }: { group: 'ring' | 'wx'; className?: string; children: ReactNode }) {
  const show = group === 'ring'
    ? 'group-hover/ring:visible group-focus/ring:visible'
    : 'group-hover/wx:visible group-focus/wx:visible';
  const pop = group === 'ring'
    ? 'group-hover/ring:opacity-100 group-hover/ring:translate-y-0 group-hover/ring:scale-100 group-focus/ring:opacity-100 group-focus/ring:translate-y-0 group-focus/ring:scale-100'
    : 'group-hover/wx:opacity-100 group-hover/wx:translate-y-0 group-hover/wx:scale-100 group-focus/wx:opacity-100 group-focus/wx:translate-y-0 group-focus/wx:scale-100';
  return (
    <div className={cn('invisible absolute top-full z-30 pt-3 transition-[visibility] duration-300', show, className,
      'max-lg:fixed max-lg:inset-x-3 max-lg:top-auto max-lg:bottom-24 max-lg:w-auto max-lg:translate-x-0 max-lg:pt-0')}>
      <div className={cn('glass-pop origin-top -translate-y-1 scale-95 opacity-0 transition-[opacity,translate,scale] duration-300 ease-out', pop)}>{children}</div>
    </div>
  );
}

/** The menubar version: a small ring with the number inside, label beneath; details on hover. */
export function MiniRing({ s }: { s: Summary }) {
  const r = 15, c = 2 * Math.PI * r, arc = c * 0.75, pct = Math.max(0, Math.min(1, s.pct ?? 0));
  const color = s.tone === 'bad' ? 'var(--bad)' : s.tone === 'warn' ? 'var(--warn)' : s.tone === 'accent' ? 'var(--primary)' : 'var(--good)';
  const n = String(s.ring ?? s.value).replace(/%$/, '');
  return (
    <div className="group/ring relative flex flex-col items-center outline-none" tabIndex={0} aria-label={[s.label, s.value, s.detail].filter(Boolean).join(', ')}>
      <div className="relative size-[32px] transition-transform duration-300 ease-out group-hover/ring:scale-110 sm:size-[38px]">
        <svg viewBox="0 0 38 38" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-700 ease-out" />
        </svg>
        <div className="metric absolute inset-0 grid place-items-center text-[11px]">{n.length > 4 ? <Icon name={s.icon} className="size-3.5" /> : <span key={n} className="tick">{n}</span>}</div>
      </div>
      <div className="-mt-1 hidden max-w-[56px] truncate text-[10px] font-medium text-muted-foreground sm:block">{s.label}</div>
      <Popover group="ring" className="right-1/2 w-[260px] translate-x-1/2"><SummaryTile s={s} /></Popover>
    </div>
  );
}

/** Weather beside the clock: the ring runs from today's low to high (cool blue → warm amber), the marker is now. */
export function WeatherRing({ card }: { card: ForecastCard }) {
  const s = card.summary!;
  const r = 17, c = 2 * Math.PI * r, arc = c * 0.75, pct = Math.max(0, Math.min(1, s.pct ?? 0.5));
  const a = (135 + 270 * pct) * Math.PI / 180, mx = 21 + r * Math.cos(a), my = 21 + r * Math.sin(a);
  return (
    <div className="group/wx relative flex items-center gap-2 outline-none sm:gap-2.5" tabIndex={0} aria-label={`${s.value}, ${s.label}. ${s.detail}`}>
      <div className="relative size-[32px] sm:size-[42px]">
        <svg viewBox="0 0 42 42" className="size-full" aria-hidden>
          <defs><linearGradient id="wx" x1="0" y1="1" x2="1" y2="1"><stop offset="0" stopColor="#64d2ff" /><stop offset=".55" stopColor="#ffd60a" /><stop offset="1" stopColor="#ff9f0a" /></linearGradient></defs>
          <circle cx="21" cy="21" r={r} fill="none" stroke="url(#wx)" strokeOpacity=".9" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} transform="rotate(135 21 21)" />
          <circle cx={mx} cy={my} r="3.6" fill="#fff" stroke="rgb(0 0 0 / .35)" strokeWidth="1" className="transition-all duration-700" />
        </svg>
        <div className="absolute inset-0 grid place-items-center"><Icon name={s.icon} className="size-4" /></div>
      </div>
      <div className="text-left leading-tight">
        <div className="text-sm font-semibold tabular">{s.value}</div>
        <div className="hidden max-w-[90px] truncate text-xs text-muted-foreground sm:block">{s.label}</div>
      </div>
      <Popover group="wx" className="right-[-8px] w-[440px]"><Forecast card={card} /></Popover>
    </div>
  );
}

/** Hour by hour: icon, temperature on a smooth line, and the chance of rain as soft blue bars beneath. */
export function Forecast({ card }: { card: ForecastCard }) {
  const { now, hours } = card;
  const lo = Math.min(...hours.map(h => h.temp)), hi = Math.max(...hours.map(h => h.temp)), span = Math.max(1, hi - lo);
  const W = 400, H = 44, x = (i: number) => (i + .5) * (W / hours.length), y = (t: number) => 8 + (1 - (t - lo) / span) * (H - 16);
  const wet = hours.some(h => h.pop >= 10);
  return (
    <div className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="metric text-[44px] leading-none">{now.temp}°</div>
          <div className="mt-1.5 text-sm font-medium">{now.words}</div>
          <div className="text-xs text-muted-foreground">Feels {now.feels}° · H {now.hi}° · L {now.lo}°</div>
        </div>
        <Icon name={now.icon} className="size-9 text-foreground/90" />
      </div>
      <div className="mt-5 grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
        {hours.map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="text-[11px] text-muted-foreground">{i === 0 ? 'Next' : h.time}</div>
            <Icon name={h.icon} className="size-4" />
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block w-full overflow-visible" aria-hidden>
        <path d={smooth(hours.map((h, i) => [x(i), y(h.temp)] as [number, number]))} fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.5" />
        {hours.map((h, i) => <g key={i}><circle cx={x(i)} cy={y(h.temp)} r="2.2" fill="currentColor" />
          <text x={x(i)} y={y(h.temp) - 6} textAnchor="middle" className="fill-current text-[10px] font-semibold tabular-nums">{h.temp}°</text></g>)}
      </svg>
      {wet ? (
        <div className="mt-2 grid items-end" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))`, height: 46 }}>
          {hours.map((h, i) => (
            <div key={i} className="flex h-full flex-col items-center justify-end gap-1">
              <div className="w-3 rounded-full bg-[#64d2ff]" style={{ height: `${Math.max(2, h.pop * .3)}px`, opacity: .25 + h.pop / 130 }} />
              <div className={cn('text-[10px] tabular', h.pop >= 30 ? 'text-[#64d2ff]' : 'text-muted-foreground')}>{h.pop}%</div>
            </div>
          ))}
        </div>
      ) : <div className="mt-3 text-center text-xs text-muted-foreground">No rain expected in the next 12 hours</div>}
    </div>
  );
}
