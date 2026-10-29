// Renders any card from the shared catalog with shadcn/ui primitives. The homepage and the assistant both use this,
// so a generated card looks exactly like the widget it came from.
import {
  Activity, ArrowUpRight, Cpu, Download, Film, HardDrive, House, Lightbulb, MemoryStick, Play, Shield, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Card as CardT, ChartCard, Control, ControlsCard, ListCard, MediaCard, StatsCard, StatusCard, Summary, Tone } from '../shared/cards.ts';

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
  if (points.length < 2) return <div className="h-8" />;
  const w = 100, h = 32, max = Math.max(...points, 1), min = Math.min(...points, 0);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 3 - ((p - min) / (max - min || 1)) * (h - 6)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  const id = `g${Math.round(Math.random() * 1e9)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={toneVar(tone)} stopOpacity=".22" /><stop offset="1" stopColor={toneVar(tone)} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={toneVar(tone)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const Bar = ({ pct, tone }: { pct: number; tone?: Tone }) =>
  <Progress value={Math.max(1.5, Math.min(100, pct * 100))} className={cn('h-1', toneBar[tone ?? 'neutral'])} />;

function Stats({ card }: { card: StatsCard }) {
  return (
    <div className="grid gap-x-6 gap-y-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
      {card.items.map(s => (
        <div key={s.label} className="min-w-0">
          <div className="text-[13px] text-muted-foreground">{s.label}</div>
          <div className={cn('metric text-[28px] leading-tight', toneText[s.tone ?? 'neutral'])}>
            {s.value}{s.unit && <span className="ml-0.5 text-[15px] font-medium text-muted-foreground">{s.unit}</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{s.sub ?? ' '}</div>
          <div className="mt-2">{s.trend ? <Spark points={s.trend} tone={s.tone} /> : s.pct != null ? <div className="pt-3"><Bar pct={s.pct} tone={s.tone} /></div> : null}</div>
        </div>
      ))}
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

function Media({ card }: { card: MediaCard }) {
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing playing'} />;
  return (
    <ul className="space-y-4">
      {card.items.map((m, i) => (
        <li key={i} className="flex min-w-0 gap-4">
          <div className="grid h-[84px] w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted shadow-sm">
            {m.image ? <img src={m.image} alt="" className="size-full object-cover" loading="lazy" /> : <Film className="size-4 text-muted-foreground" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2">
              <div className="truncate font-medium">{m.title}</div>
              {m.state === 'paused' && <Badge variant="secondary">Paused</Badge>}
            </div>
            {m.subtitle && <div className="truncate text-sm text-muted-foreground">{m.subtitle}</div>}
            <div className="truncate text-xs text-muted-foreground">{[m.user, m.device].filter(Boolean).join(' · ')}</div>
            <div className="mt-auto space-y-1.5 pt-2">
              {m.pct != null && <Bar pct={m.pct} tone={m.state === 'paused' ? 'warn' : 'accent'} />}
              {m.detail && <div className="text-xs tabular text-muted-foreground">{m.detail}</div>}
            </div>
          </div>
        </li>
      ))}
    </ul>
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
export function Widget({ card, run, title, status, compact }: { card?: CardT; run?: RunAction; title?: string; status?: ReactNode; compact?: boolean }) {
  const t = card?.title ?? title;
  const bare = card?.type === 'group';
  return (
    <Card className={cn('@container/card min-w-0 gap-4 shadow-card', compact ? 'py-4 shadow-none' : 'py-5', bare && 'border-0 bg-transparent py-0 shadow-none')}>
      {t && !bare && (
        <CardHeader className={cn('flex items-center gap-2', compact ? 'px-4' : 'px-5')}>
          <Icon name={card?.icon} className="text-muted-foreground" />
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
