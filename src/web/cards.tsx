// Renders any card from the shared catalog with shadcn/ui primitives. The homepage and the assistant both use this,
// so a generated card looks exactly like the widget it came from.
import {
  Activity, ArrowUpRight, ChevronLeft, ChevronRight, Cpu, Download, Film, HardDrive, House, Lightbulb, MemoryStick, Pause, Play, Shield, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Card as CardT, ChartCard, Control, ControlsCard, ListCard, MediaCard, MediaItem, ShelfCard, StatsCard, StatusCard, Summary, Tone } from '../shared/cards.ts';

const ICONS: Record<string, LucideIcon> = {
  cpu: Cpu, gpu: MemoryStick, disk: HardDrive, download: Download, pulse: Activity, play: Play, film: Film,
  bulb: Lightbulb, home: House, shield: Shield, sparkle: Sparkles,
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

function Status({ card }: { card: StatusCard }) {
  return (
    <div className="-mx-2 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
      {card.items.map(s => (
        <a key={s.name} href={s.href} target="_blank" rel="noreferrer"
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent">
          <span className={cn('dot', s.ok ? 'dot-good' : 'dot-bad')} />
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          <span className={cn('text-xs tabular', s.ok ? 'text-muted-foreground' : 'text-bad')}>{s.ok ? (s.ms != null ? `${s.ms} ms` : '') : s.detail}</span>
        </a>
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
function NowPlaying({ m }: { m: MediaItem }) {
  return (
    <div className="@container/np relative isolate aspect-[16/10] max-h-[380px] min-h-[230px] w-full overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-[0_18px_40px_-20px_rgb(0_0_0/0.55)] @2xl/main:aspect-[21/9]">
      {m.backdrop
        ? <Art src={m.backdrop} className="absolute inset-0 -z-10 size-full object-cover" />
        : <Art src={m.image} className="absolute inset-0 -z-10 size-full scale-125 object-cover blur-2xl saturate-150" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 p-5 @md/np:p-6">
        <Art src={m.image} className="hidden aspect-[2/3] w-[104px] shrink-0 rounded-lg object-cover shadow-[0_16px_32px_-8px_rgb(0_0_0/0.7)] @md/np:block @2xl/np:w-[124px]" />
        <div className="min-w-0 flex-1">
          {m.tags && m.tags.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {m.tags.map(t => <span key={t} className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium tracking-wide backdrop-blur-md">{t}</span>)}
            </div>
          )}
          <div className="truncate text-2xl font-semibold tracking-tight @md/np:text-[28px]">{m.title}</div>
          {m.subtitle && <div className="truncate text-[15px] text-white/75">{m.subtitle}</div>}
          <div className="mt-4 flex items-center gap-3">
            {m.state === 'paused' ? <Pause className="size-3.5 shrink-0 fill-white" /> : <Play className="size-3.5 shrink-0 fill-white" />}
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

function Media({ card }: { card: MediaCard }) {
  if (!card.items.length) return (
    <div className="grid min-h-[180px] place-items-center rounded-2xl bg-card text-center shadow-card">
      <div><Film className="mx-auto mb-2 size-5 text-muted-foreground" /><div className="text-sm text-muted-foreground">{card.empty ?? 'Nothing playing'}</div></div>
    </div>
  );
  return <div className="space-y-3">{card.items.map((m, i) => <NowPlaying key={i} m={m} />)}</div>;
}

/** A row of artwork, like the Apple TV app: snap-scrolling, no borders, arrows to page through on desktop. */
function Shelf({ card, header }: { card: ShelfCard; header?: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const page = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  const ratio = card.aspect === 'square' ? 'aspect-square' : card.aspect === 'wide' ? 'aspect-video' : 'aspect-[2/3]';
  const width = card.aspect === 'wide' ? 'w-[240px] @3xl/main:w-[280px]' : 'w-[128px] @3xl/main:w-[150px]';
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {header}
        <div className="ml-auto hidden gap-1.5 sm:flex">
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
export function CardBody({ card, run }: { card: CardT; run?: RunAction }): ReactNode {
  switch (card.type) {
    case 'stats': return <Stats card={card} />;
    case 'list': return <List card={card} />;
    case 'status': return <Status card={card} />;
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

export function Widget({ card, run, title, status, compact }: { card?: CardT; run?: RunAction; title?: string; status?: ReactNode; compact?: boolean }) {
  // artwork-led cards sit directly on the page, without a card frame
  if (card?.type === 'shelf') return <Shelf card={card} header={<BareHeader card={card} title={title} status={status} />} />;
  if (card?.type === 'media') return (
    <div className="min-w-0 space-y-3"><BareHeader card={card} title={title} status={status} /><Media card={card} /></div>
  );
  const t = card?.title ?? title;
  const bare = card?.type === 'group';
  return (
    <Card className={cn('@container/card min-w-0 gap-4 shadow-card', compact ? 'py-4 shadow-none' : 'py-5', bare && 'border-0 bg-transparent py-0 shadow-none')}>
      {t && !bare && (
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
        {card ? <CardBody card={card} run={run} /> : <div className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/5" /></div>}
      </CardContent>
    </Card>
  );
}

/** Headline tile for the overview's top row. */
export function SummaryTile({ s, href }: { s: Summary; href?: string }) {
  const body = (
    <Card className="@container/card h-full gap-2 py-4 shadow-card transition-colors hover:bg-accent/40">
      <CardHeader className="px-4">
        <CardDescription className="text-[13px]">{s.label}</CardDescription>
        <CardTitle className={cn('metric text-[26px] leading-none', toneText[s.tone ?? 'neutral'])}>{s.value}</CardTitle>
        {s.tone && s.tone !== 'neutral' && s.tone !== 'accent' && (
          <CardAction><span className={cn('dot', s.tone === 'good' ? 'dot-good' : 'dot-bad')} /></CardAction>
        )}
      </CardHeader>
      {s.sub && <CardFooter className="px-4"><span className="truncate text-xs text-muted-foreground">{s.sub}</span></CardFooter>}
    </Card>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className="block min-w-0">{body}</a> : <div className="min-w-0">{body}</div>;
}
