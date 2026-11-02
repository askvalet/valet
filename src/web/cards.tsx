// Renders any card from the shared catalog with shadcn/ui primitives. The homepage and the assistant both use this,
// so a generated card looks exactly like the widget it came from.
import { Check, Copy, X, Rss, Newspaper, MessagesSquare, Tag, TrendingUp, Calendar,
  Activity, Archive, ArrowUpRight, Search, BookOpen, Bookmark, Gamepad2, Clock, Moon as MoonIcon, Image as ImageIcon, Coins, MessageCircle, Type, ChevronLeft, FileText, ChevronRight, Thermometer, Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Cpu, Moon, Sun, Download, Film, Gpu, HardDrive, House, Lightbulb, MemoryStick, Play, Shield, Wifi,
  Box, Video, type LucideIcon,
} from 'lucide-react';
import { createContext, Fragment, lazy, memo, Suspense, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Cameras } from './cameras.tsx';
import { CoverFlow } from './coverflow.tsx';
import { chartless, flow, Heatmap, Race, smooth, Stream, Waffle } from './charts.tsx';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn, useOnScreen } from '@/lib/utils';
import { Arrows, Counter, Pile, RowSlot, toast, useRow, useRows } from './feel.tsx';
import { CalendarView, isWeather, Thermostat, WeatherCard, WeatherGlyph } from './home-cards.tsx';
import { clock as clockOf, day as dayOf, num as written } from './format.ts';
import { stateOf } from '../shared/cards.ts';
import type { ServiceState, Banner, Stall, ArticleCard, CodeCard, RankedCard, ShelfItem, StatusItem, TableCard, LinksCard, Card as CardT, VerseCard, ScheduleCard, PhotosCard, ForecastCard, ShowcaseCard, ChartCard, Control, ControlsCard, ListCard, MediaCard, MediaItem, ShelfCard, StatsCard, StatusCard, Summary, Tone } from '../shared/cards.ts';

// Icon names cards may use (docs/integrations.md lists them; keep the two in step). Anything else: a URL or a path.
const ICONS: Record<string, LucideIcon> = {
  camera: Video, cpu: Cpu, gpu: Gpu, memory: MemoryStick, wifi: Wifi, disk: HardDrive, download: Download, pulse: Activity, play: Play, film: Film,
  search: Search, bulb: Lightbulb, home: House, shield: Shield, chat: MessageCircle, image: ImageIcon, clock: Clock, crescent: MoonIcon, game: Gamepad2, book: BookOpen, coins: Coins, text: Type,
  file: FileText, bookmark: Bookmark, rss: Rss, news: Newspaper, reddit: MessagesSquare, tag: Tag, chart: TrendingUp, calendar: Calendar, sun: Sun, moon: Moon, cloud: Cloud, 'cloud-sun': CloudSun, 'cloud-moon': CloudMoon, rain: CloudRain, snow: CloudSnow, fog: CloudFog, storm: CloudLightning, thermometer: Thermometer,
};
export function Icon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  if (name.startsWith('http') || name.startsWith('/')) return <img src={name} alt="" className={cn('size-4', className)} />;
  const I = ICONS[name] ?? Activity;   // a name we don't know still fills its tile
  return <I className={cn('size-4', className)} aria-hidden />;
}

const toneText: Record<Tone, string> = { neutral: '', good: 'text-good', warn: 'text-warn', bad: 'text-bad', accent: 'text-primary' };
const toneBar: Record<Tone, string> = { neutral: '', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', accent: 'bg-primary' };
const toneVar = (t?: Tone) => (t && t !== 'neutral' && t !== 'accent' ? `var(--${t})` : 'var(--primary)');

// Cards in chat are dense: same content, about half the height (smaller numbers, tighter rows, a smaller header)
const Dense = createContext(false);

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

const Bar = ({ pct, tone }: { pct: number; tone?: Tone }) => (
  <div role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-foreground/10">
    <div className={cn('h-full rounded-full bg-foreground/50 transition-transform duration-(--dur-move) ease-out', toneBar[tone ?? 'neutral'])} style={{ transform: `translateX(${Math.max(1.5, Math.min(100, pct * 100)) - 100}%)` }} />
  </div>
);

/** One point per card: the first item is the hero (large number, its label, one sparkline); the rest become a quiet
 *  footer of at most three small facts, divided by hairlines. */
/** Parts of a whole, as a ring: the first slice in colour, the number that matters in the middle. */
function Donut({ slices, center }: { slices: NonNullable<StatsCard['pie']>; center?: string }) {
  const total = slices.reduce((t, s) => t + s.value, 0) || 1, r = 15.9155, gap = 1.2;   // this radius makes the circumference 100
  const colors = ['var(--bad)', 'var(--primary)', 'rgb(255 255 255 / .28)', 'rgb(255 255 255 / .14)'];
  let at = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[88px] shrink-0">
        <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
          {slices.map((s, i) => {
            const pct = s.value / total * 100, seg = <circle key={s.label} className="donut-seg" cx="18" cy="18" r={r} fill="none" stroke={s.tone ? toneVar(s.tone) : colors[i % 4]} strokeWidth="3.4" strokeDasharray={`${Math.max(0, pct - gap)} ${100 - Math.max(0, pct - gap)}`} strokeDashoffset={-at} />;
            at += pct; return seg;
          })}
        </svg>
        {center && <span className="metric absolute inset-0 grid place-items-center text-[15px]">{center}</span>}
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-[13px]">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: s.tone ? toneVar(s.tone) : colors[i % 4] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="tabular">{written(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stats({ card }: { card: StatsCard }) {
  const dense = useContext(Dense);
  if (card.pie?.length && !dense) return <Donut slices={card.pie} center={card.pieCenter} />;
  const [hero, ...rest] = card.items;
  if (!hero) return null;
  const facts = rest.slice(0, 3);
  // one number on its own: its history fills the card behind it
  const trend = hero.trend ?? card.summaries?.find(t => t.label === hero.label)?.trend, behind = !dense && !facts.length && (trend?.length ?? 0) > 1;
  return (
    <div className={cn('flex flex-col', dense ? 'gap-2.5' : 'gap-4')}>
      {behind && <div style={{ color: 'var(--primary)' }}><TileGraph points={trend!} gauge /></div>}
      <div className={cn('flex items-end', dense ? 'gap-4' : 'gap-5')}>
        <div className="min-w-0 shrink-0">
          <div className={cn('metric leading-[0.95]', dense ? 'text-[26px]' : 'text-[44px]', toneText[hero.tone ?? 'neutral'])}>
            <Counter value={hero.value} />{hero.unit && <span className={cn('ml-1 font-medium tracking-normal text-muted-foreground', dense ? 'text-[13px]' : 'text-[18px]')}>{hero.unit}</span>}
          </div>
          <div className={cn('truncate text-muted-foreground', dense ? 'mt-1 text-[12px]' : 'mt-1.5 text-[13px]')}>{[hero.label, hero.sub].filter(Boolean).join(' · ')}</div>
        </div>
        {!behind && <div className={cn('min-w-0 flex-1 pb-1', dense && 'max-h-9 overflow-hidden')}>
          {trend ? <Spark points={trend} tone={hero.tone} /> : hero.pct != null ? <Bar pct={hero.pct} tone={hero.tone} /> : null}
        </div>}
      </div>
      {facts.length > 0 && (
        <div className={cn('grid divide-x border-t', dense ? 'pt-2.5' : 'pt-3.5')} style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
          {facts.map(f => (
            <div key={f.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
              <div className={cn('truncate text-muted-foreground', dense ? 'text-[11px]' : 'text-[12px]')}>{f.label}</div>
              <div className={cn('metric truncate', dense ? 'text-[14px]' : 'text-[17px]', toneText[f.tone ?? 'neutral'])}>
                <Counter value={f.value} />{f.unit && <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">{f.unit}</span>}
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
  const dense = useContext(Dense);
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing here'} />;
  if (card.layout === 'temps' && !dense) return <Temps card={card} />;
  if (card.layout === 'chips' && !dense) return <Chips card={card} />;
  if (card.layout === 'headlines' && !dense) return <Headlines card={card} />;
  return <Rows card={card} dense={dense} />;
}

/** Stories as a grid of small cards, each anchored by where it's from, so the eye sorts by source before it reads. */
function Headlines({ card }: { card: ListCard }) {
  const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } };
  return (
    <div className="headlines">
      {card.items.slice(0, 8).map((it, i) => {
        const h = host(it.href);
        return (
          <a key={i} href={it.href} target="_blank" rel="noreferrer" className={cn('headline', !it.href && 'pointer-events-none')}>
            {it.image ? <img src={it.image} alt="" loading="lazy" className="headline-art" />
              : h && <span className="headline-mark"><img src={`/api/favicon/${h}`} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} /></span>}
            <span className="min-w-0">
              <span className="line-clamp-2 text-[14px] leading-snug font-medium">{it.title}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{[h ?? it.subtitle, it.meta].filter(Boolean).join(' · ')}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/** A reading per drive: how far along it sits between cool and hot, and the colour says so before the number does. */
function Temps({ card }: { card: ListCard }) {
  return (
    <div className="space-y-3.5">
      {card.items.map((it, i) => {
        const at = Math.max(0, Math.min(1, it.pct ?? 0));
        return (
          <div key={i} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{it.title}</span>
              <span className="shrink-0 tabular"><Counter value={it.meta ?? ''} className={cn('font-medium', toneText[it.tone ?? 'neutral'])} /> <span className="text-xs text-muted-foreground">now</span></span>
            </div>
            <div className="reading mt-1.5" role="meter" aria-label={`${it.title} temperature`} aria-valuenow={Math.round(at * 100)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={it.meta}>
              <i style={{ clipPath: `inset(0 ${(1 - at) * 100}% 0 0 round 3px)` }} />
            </div>
            {it.subtitle && <div className={cn('mt-1 truncate text-xs', it.tone === 'bad' ? 'text-bad' : 'text-muted-foreground')}>{it.subtitle}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Pills with the app's icon: a glance says who, the small print says what. */
function Chips({ card }: { card: ListCard }) {
  const slug = (t: string) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(t) ? t : null;
  const [all, setAll] = useState(false), cap = card.limit && card.items.length > card.limit ? card.limit : 0;
  return (
    <div className="flex flex-wrap gap-2">
      {(cap && !all ? card.items.slice(0, cap) : card.items).map((it, i) => (
        <a key={i} href={it.href} target="_blank" rel="noreferrer" className={cn('chip', !it.badge && it.tone === 'warn' && 'is-warn', !it.href && 'pointer-events-none', i >= (cap || Infinity) && 'chip-in')}>
          {(it.image || slug(it.title)) && <img src={it.image ?? `/api/icon/${slug(it.title)}`} alt="" className="size-[18px] rounded-[5px] object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />}
          <span className="font-medium">{it.title}</span>
          {(it.subtitle || it.meta) && <span className="max-w-[180px] truncate text-muted-foreground" title={it.subtitle}>{it.subtitle ?? it.meta}</span>}
          {it.badge && <span className={cn('chip-mark', it.tone === 'warn' && 'text-warn')}>{it.badge}</span>}
        </a>
      ))}
      {cap > 0 && <button type="button" className="chip chip-more" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Fewer' : `${card.items.length} in all`}</button>}
    </div>
  );
}

/** A summary: two lines, and the rest on a tap. Text that fits stays plain and lets the tap through to its link. The
 *  ellipsis is the invitation: a "More" under every window would say it nine times. */
function Clamp({ text, className }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null), [open, setOpen] = useState(false), [more, setMore] = useState(false);
  useEffect(() => { const b = box.current; if (b && !open) setMore(b.scrollHeight > b.clientHeight + 1); }, [text, open]);
  const flip = (e: React.MouseEvent) => { if (more) { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); } };
  return (
    <button type="button" aria-expanded={more ? open : undefined} tabIndex={more ? 0 : -1} onClick={flip} className={cn('clamp block w-full text-left', more && 'is-more', className)}>
      <span ref={box} className={cn('block', !open && 'line-clamp-2')}>{text}</span>
    </button>
  );
}

function Rows({ card, dense }: { card: ListCard; dense: boolean }) {
  const rows = useRows(card.items, it => it.id ?? it.title, !!card.log), Row = card.log ? 'div' : 'li';
  return (
    <ul className="-my-1 divide-y">
      {rows.map(({ key, item: it, state }, i) => <Fragment key={key}>
        {it.section && it.section !== rows[i - 1]?.item.section && <li className="pt-2.5 pb-1 text-xs font-medium text-muted-foreground first:pt-1">{it.section}</li>}
        <RowSlot as="li" state={state} on={!!card.log}><Row className={cn('flex min-w-0 items-center gap-3', dense ? 'py-1.5' : 'py-2.5', it.href && 'row-link -mx-2 cursor-pointer px-2 transition-colors hover:bg-accent')}
          onClick={it.href ? () => window.open(it.href, '_blank', 'noopener') : undefined} role={it.href ? 'link' : undefined}>
          {it.image && <img src={it.image} alt="" loading="lazy" className={cn('shrink-0 rounded-md bg-muted object-cover', dense ? 'h-9 w-6' : 'h-12 w-8')} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <div className={cn('min-w-0 flex-1 font-medium', dense ? 'text-[13px]' : 'text-sm', it.href && !dense ? 'line-clamp-2 leading-snug' : 'truncate')}>{it.title}</div>
              {it.meta && <div className="shrink-0 text-xs tabular text-muted-foreground">{it.meta}</div>}
              {it.dot && <span className={cn('dot size-1.5', it.dot === 'good' ? 'dot-good' : 'dot-bad')} style={it.dot === 'warn' ? { background: 'var(--warn)' } : undefined} title={it.dot === 'good' ? 'Healthy' : undefined} />}
              {it.href && <ArrowUpRight className="row-arrow size-3.5 shrink-0 text-muted-foreground" />}
            </div>
            {it.subtitle && <div className={cn('truncate text-xs', it.tone && it.tone !== 'neutral' ? toneText[it.tone] : 'text-muted-foreground')}>{it.subtitle}</div>}
            {it.detail && <Clamp text={it.detail} className="mt-1 text-[13px] leading-snug text-foreground/70" />}
            {it.pct != null && <div className={dense ? 'mt-1' : 'mt-2'}><Bar pct={it.pct} tone={it.tone} /></div>}
          </div>
        </Row></RowSlot>
      </Fragment>)}
    </ul>
  );
}

/** An app icon that falls back to the service's initial if no icon exists. */
function AppIcon({ src, name, small }: { src?: string; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = small ? 'size-[18px]' : 'size-7';
  if (!src) return null;
  if (failed) return <span className={cn(size, 'shrink-0')} aria-hidden />;   // no icon found: just the space, so names still line up
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cn(size, 'shrink-0 object-contain')} />;
}

export const DOT: Record<ServiceState, string> = { up: 'dot-good', degraded: 'dot-warn', down: 'dot-bad', off: 'dot-off' };
const STATE: Record<ServiceState, string> = { up: 'Up', degraded: 'Unhealthy', down: 'Down', off: 'Off by choice' };
/** What a service's state is in words: answering, running or healthy when it's fine, and the reason when it isn't. */
const stateLine = (s: StatusItem, st = stateOf(s)) => st === 'up' ? s.ms != null ? `${s.ms} ms` : s.detail ?? 'Up' : st === 'off' ? STATE.off : s.detail ?? STATE[st];
const stateTip = (s: StatusItem, st = stateOf(s)) => [s.name, st === 'up' ? s.detail ?? (s.ms != null ? 'reachable' : 'running') : stateLine(s), st === 'up' && s.ms != null ? `${s.ms} ms` : undefined].filter(Boolean).join(' · ');

function ServiceRow({ s, minimal }: { s: StatusCard['items'][number]; minimal?: boolean }) {
  const st = stateOf(s), dot = DOT[st];
  // minimal: one tight line, icon, name and the dot; hover says what's wrong
  if (minimal) return (
    <Tile href={s.href} title={stateTip(s)} className={cn('flex min-w-0 break-inside-avoid items-center gap-2.5 rounded-lg px-2 py-1 transition-colors', s.href && 'hover:bg-accent')}>
      <AppIcon src={s.icon} name={s.name} small />
      <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
      <span className={cn('dot size-1.5', dot)} />
    </Tile>
  );
  return (
    <Tile href={s.href} title={stateTip(s)} className={cn('flex min-w-0 break-inside-avoid items-center gap-3 rounded-xl px-2 py-2 transition-colors', s.href && 'hover:bg-accent')}>
      <AppIcon src={s.icon} name={s.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.name}</div>
        <div className={cn('truncate text-xs tabular', st === 'down' ? 'text-bad' : st === 'degraded' ? 'text-warn' : 'text-muted-foreground')}>{stateLine(s)}</div>
      </div>
      <span className={cn('dot', dot)} />
    </Tile>
  );
}

/** An app's icon, or a plain box when it has none, so a wall never has a blank tile. */
function Glyph({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="wall-box"><Box className="size-4" /></span>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="object-contain" />;
}

/** Every app as one icon, however many containers it runs. Its dot says how it is; hover says what's wrong. */
function Wall({ items }: { items: StatusItem[] }) {
  const apps = new Map<string, StatusItem[]>();
  for (const i of items) { const k = (i.group ?? i.name).split(/[-_]/)[0].toLowerCase(); apps.set(k, [...apps.get(k) ?? [], i]); }
  const worst = (g: StatusItem[]): ServiceState => { const st = g.map(s => stateOf(s)); return st.includes('down') ? 'down' : st.includes('degraded') ? 'degraded' : st.every(x => x === 'off') ? 'off' : 'up'; };
  const rank = { down: 0, degraded: 1, up: 2, off: 3 };
  const tiles = [...apps].map(([k, g]) => ({ k, g, st: worst(g), lead: g.find(i => i.name.toLowerCase() === k) ?? g[0] })).sort((a, b) => rank[a.st] - rank[b.st]);
  return (
    <div className="wall">
      {tiles.map(({ k, g, st, lead }) => (
        <Tile key={k} href={lead.href} title={g.map(s => stateTip(s)).join('\n')} className={cn('wall-tile', `is-${st}`)}>
          <Glyph src={lead.icon} />
          {g.length > 1 && <i className="wall-count" aria-label={`${g.length} containers`}>{g.length}</i>}
        </Tile>
      ))}
    </div>
  );
}

/** Services in columns. With groups, each group is a block (heading + its services) and the blocks flow into as
 *  many columns as fit, so a long list stays short. */
function Status({ card, columns, minimal }: { card: StatusCard; columns?: number; minimal?: boolean }) {
  if (card.layout === 'wall' && !minimal) return <Wall items={card.items} />;
  const named = [...new Set(card.items.map(i => i.group ?? ''))];
  // headings only help when they gather things: a heading per item or two just doubles the list
  const groups = card.items.length / named.length < 3 ? [''] : named;
  if (groups.length === 1 && !groups[0]) return (
    <>
      <div className="-mx-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {card.items.map(s => <ServiceRow key={s.name} s={s} minimal={minimal} />)}
      </div>
    </>
  );
  if (!columns) return <><Balanced groups={groups.map(g => ({ g, items: card.items.filter(i => (i.group ?? '') === g) }))} minimal={minimal} /></>;
  return (
    <>
    <div className="-mx-2 gap-x-4" style={{ columnCount: columns }}>
      {groups.map(g => (
        // a sidebar list: groups flow on across its columns
        <div key={g} className={cn('break-inside-auto', minimal ? 'mb-2' : 'mb-3')}>
          <div className={cn('break-after-avoid px-2 font-medium text-muted-foreground', minimal ? 'pt-1 pb-0.5 text-[11px]' : 'pt-1 pb-1.5 text-xs')}>{g || '\u00a0'}</div>
          {card.items.filter(i => (i.group ?? '') === g).map(s => <ServiceRow key={s.name} s={s} minimal={minimal} />)}
        </div>
      ))}
    </div>
    </>
  );
}

/** Groups side by side across the whole width, each as wide as it needs: the shortest height at which they all fit, so
 *  no group runs longer than the rest and nothing is left empty on the right. Too narrow for that, they stack. */
function Balanced({ groups, minimal }: { groups: { g: string; items: StatusCard['items'] }[]; minimal?: boolean }) {
  const box = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(e.contentRect.width)); if (box.current) o.observe(box.current); return () => o.disconnect(); }, []);
  const room = Math.max(1, Math.floor((width || 1100) / (minimal ? 168 : 220))), most = Math.max(...groups.map(g => g.items.length));
  const widths = (rows: number) => groups.map(g => Math.ceil(g.items.length / rows)), total = (rows: number) => widths(rows).reduce((a, b) => a + b, 0);
  const side = groups.length <= room;
  let rows = 1; while (side && rows < most && total(rows) > room) rows++;
  return (
    <div ref={box} className="-mx-2 grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: `repeat(${side ? total(rows) : room}, minmax(0, 1fr))` }}>
      {groups.map(({ g, items }, i) => {
        const span = side ? widths(rows)[i] : room, down = side ? rows : Math.ceil(items.length / room);
        return (
          <div key={g} className="min-w-0" style={{ gridColumn: `span ${span}` }}>
            {g && <div className={cn('px-2 font-medium text-muted-foreground', minimal ? 'pt-1 pb-0.5 text-[11px]' : 'pt-1 pb-1.5 text-xs')}>{g}</div>}
            <div className="grid gap-x-4" style={{ gridAutoFlow: 'column', gridTemplateRows: `repeat(${down}, auto)`, gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
              {items.map(s => <ServiceRow key={s.name} s={s} minimal={minimal} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Archiving at once, with a few seconds to take it back. It leaves by moving; a failed call puts it back. `shared` says so
 *  in the page's stack, where each thing archived keeps its own Undo, instead of the card's single corner. */
function useArchive(run?: RunAction, shared?: boolean) {
  const [gone, setGone] = useState<string[]>([]), [leaving, setLeaving] = useState<string[]>([]), [last, setLast] = useState<string | null>(null), [slip, setSlip] = useState(''), [back, setBack] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const without = (id: string) => (l: string[]) => l.filter(x => x !== id);
  const say = (id: string | null, words = '') => {
    if (shared) { if (words) toast('archive-slip', { text: words, tone: 'bad' }); return; }
    clearTimeout(timer.current); setLast(id); setSlip(words); if (id || words) timer.current = setTimeout(() => { setLast(null); setSlip(''); }, 6000);
  };
  const undo = (id = last) => {
    if (!id) return;
    setLeaving(without(id)); setGone(without(id)); setBack(id); say(null);
    run?.('unarchive', { id }).catch(() => { setGone(g => [...g, id]); say(null, 'Couldn\'t bring it back'); });
  };
  return {
    gone, leaving, last, slip, back, undo,
    archive(id: string, by?: Element | null) {
      setLeaving(l => [...l, id]); say(id); setBack(null);
      if (shared) toast(`archive-${id}`, { text: 'Archived', undo: () => undo(id) }, { by });
      setTimeout(() => { setLeaving(without(id)); setGone(g => [...g, id]); }, 240);
      run?.('archive', { id }).catch(() => { setLeaving(without(id)); setGone(without(id)); if (shared) toast(`archive-${id}`, null); say(null, 'Couldn\'t archive that'); });
    },
  };
}
function UndoBar({ a }: { a: ReturnType<typeof useArchive> }) {
  if (!a.last && !a.slip) return null;
  return <div className="undo-bar" role="status">{a.slip || <>Archived<button type="button" onClick={() => a.undo()}>Undo</button></>}</div>;
}
const SeeArchived = ({ href, className }: { href?: string; className?: string }) => href ? <a href={href} target="_blank" rel="noreferrer" className={cn('title-link text-xs text-muted-foreground', className)}>See archived</a> : null;

/** The reading pile: each thing saved with the page itself filling the card, the next ones showing behind it. Flick through
 *  it, or use the controls, which stay put while the cards change. Hover and the page scrolls by, as if you'd started reading. */
function Article({ card, run }: { card: ArticleCard; run?: RunAction }) {
  const [at, setAt] = useState(0), arch = useArchive(run);
  const pile = (card.more?.length ? card.more : [card]).filter(a => !a.id || !arch.gone.includes(a.id)), now = Math.min(at, pile.length - 1), a = pile[now];
  if (!a?.headline) return <div className="relative grid h-full min-h-[200px] place-items-center rounded-2xl bg-card text-sm text-muted-foreground shadow-card">{card.empty ?? 'Nothing saved to read'}<div className="article-corner"><UndoBar a={arch} /></div></div>;
  const n = pile.length, top = a.link ?? card.href;
  const face = (i: number) => {
    const p = pile[i], link = p.link ?? card.href;
    return (
      <div className={cn('article', link && 'lift', p.id && arch.leaving.includes(p.id) && 'is-leaving', p.id && p.id === arch.back && 'is-back')}>
        {p.image && <img src={p.image} alt="" draggable={false} className="article-page" />}
        {link && <a href={link} target="_blank" rel="noreferrer" aria-label={p.headline} className="article-open" />}
        <div className="article-text">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-white/70">{card.source?.icon && <img src={card.source.icon} alt="" className="size-3.5 object-contain" />}<span className="truncate">{[card.title, p.site].filter(Boolean).join(' · ')}</span>{n > 1 && <span className="ml-auto shrink-0 tabular">{i + 1} of {n}</span>}</div>
          <div className="mt-1 line-clamp-2 text-[19px] leading-tight font-semibold tracking-tight text-pretty text-white">{p.headline}</div>
          {p.blurb && <Clamp text={p.blurb} className="article-blurb mt-1.5 text-[14px] leading-snug text-white/75" />}
        </div>
      </div>
    );
  };
  return (
    <Pile count={n} at={now} go={setAt} id={i => pile[i].id ?? pile[i].headline ?? String(i)} card={face} label={card.title ?? 'Reading'} status={n > 1 ? `${now + 1} of ${n}: ${a.headline}` : undefined} over={<>
      {arch.last || arch.slip ? <div className="article-corner"><UndoBar a={arch} /></div> : card.archived && run ? <div className="article-corner"><SeeArchived href={card.archived} className="article-chip" /></div> : null}
      {n > 1 || (run && a.id) ? <div className="article-tools">
        {n > 1 && <button type="button" aria-label="Previous" title="Previous" aria-disabled={now === 0} onClick={() => { if (now > 0) setAt(now - 1); }}><ChevronLeft className="size-4" /></button>}
        {run && a.id && <button type="button" aria-label="Archive" title="Archive" onClick={() => arch.archive(a.id!)}><Archive className="size-[15px]" /></button>}
        {top && <a href={top} target="_blank" rel="noreferrer" aria-label="Open" title="Open"><ArrowUpRight className="size-4" /></a>}
        {n > 1 && <button type="button" aria-label="Next" title="Next" aria-disabled={now === n - 1} onClick={() => { if (now < n - 1) setAt(now + 1); }}><ChevronRight className="size-4" /></button>}
      </div> : null}
    </>} />
  );
}

/** Bookmarks: icon, name, a quiet note; in two columns when there's room. */
function Links({ card }: { card: LinksCard }) {
  const dense = useContext(Dense);
  return (
    <div className="-mx-2 grid gap-0.5" style={{ gridTemplateColumns: dense ? undefined : 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {card.items.map(l => (
        <a key={l.href + l.name} href={l.href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
          <AppIcon src={l.icon} name={l.name} small />
          <span className="min-w-0 flex-1 truncate text-[13px]">{l.name}</span>
          {l.note && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{l.note}</span>}
        </a>
      ))}
    </div>
  );
}

/** Artwork that fades in once decoded, so nothing pops. */
function Art({ src, className, alt = '', style, onLoaded }: { src?: string; className?: string; alt?: string; style?: React.CSSProperties; onLoaded?: (img: HTMLImageElement) => void }) {
  const [ready, setReady] = useState(false);
  if (!src) return null;
  // one the browser already has is simply there: a tab you come back to doesn't fade its pictures up again
  return <img src={src} alt={alt} loading="lazy" decoding="async" style={style} ref={el => { if (el?.complete && el.naturalWidth) setReady(true); }} onLoad={e => { setReady(true); onLoaded?.(e.currentTarget); }}
    className={cn('transition-opacity duration-(--dur-move) ease-out', ready ? 'opacity-100' : 'opacity-0', className)} />;
}

/** One stream as a cinematic tile: the backdrop is the card, details float over a soft scrim. */
/** Which app a picture is from, in the corner of a full-bleed card. */
const AppBadge = ({ of }: { of?: CardT['source'] }) => !of?.icon ? null : (
  <span className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/45 py-1 pr-2.5 pl-1.5 text-[11px] font-medium text-white backdrop-blur-md"><img src={of.icon} alt="" className="size-4 object-contain" />{of.name}</span>
);

export function NowPlaying({ m, compact, source }: { m: MediaItem; compact?: boolean; source?: CardT['source'] }) {
  return (
    <div className={cn('@container/np relative isolate w-full overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-[0_18px_40px_-20px_rgb(0_0_0/0.55)]',
      compact ? 'aspect-[16/9] min-h-[170px]' : 'h-full min-h-[210px] flex-1')}>
      <AppBadge of={source} />
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
              {m.tags.map(t => <span key={t} className="rounded-sm bg-white/15 px-2 py-0.5 text-[12px] font-medium backdrop-blur-md">{t}</span>)}
            </div>
          )}
          <div className="truncate text-xl font-semibold tracking-tight @md/np:text-2xl">{m.title}</div>
          {m.subtitle && <div className="truncate text-[15px] text-white/75">{m.subtitle}</div>}
          <div className="mt-4 flex items-center gap-3">
            {/* a status, not a button: nothing here controls the stream */}
            {m.icon ? <Icon name={m.icon} className="size-3.5 shrink-0" /> : <span className={cn('np-state', m.state === 'paused' && 'is-paused')} role="img" aria-label={m.state === 'paused' ? 'Paused' : m.state === 'buffering' ? 'Buffering' : 'Playing'} />}
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-transform duration-(--dur-move)" style={{ transform: `translateX(${Math.round((m.pct ?? 0) * 100) - 100}%)` }} />
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
export const isEmpty = (card?: CardT) => ((card?.type === 'media' || card?.type === 'photos') && !card.items.length) || chartless(card);

/** A download getting nowhere, whether its integration says so or only its state does. */
const stallOf = (m: MediaItem): Stall | undefined => m.stall ?? (m.icon === 'download' && m.state === 'buffering' ? { word: m.tags?.find(t => /stalled|finding/i.test(t)) ?? 'Stalled' } : undefined);
const heldFor = (since: number) => { const m = Math.max(1, Math.round((Date.now() - since) / 60_000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
function StallLine({ m, stall, card, run }: { m: MediaItem; stall: Stall; card: MediaCard; run?: RunAction }) {
  const next = stall.next ?? (card.href ? { label: `Check in ${card.source?.name ?? 'the app'}`, href: card.href } : undefined), word = stall.word ?? 'Stalled';
  const says = [`${word}${stall.since ? ` ${heldFor(stall.since)}` : ''}`, stall.why ?? (/stalled/i.test(word) ? 'nothing coming in' : undefined)].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
      <span className="truncate text-warn">{says}</span>
      {next?.action && run ? <button type="button" className="title-link text-foreground/85" onClick={() => void run(next.action!, next.args)}>{next.label}</button>
        : next?.href ? <a href={next.href} target="_blank" rel="noreferrer" className="title-link text-foreground/85">{next.label}</a> : null}
    </div>
  );
}

function Media({ card, compact, run }: { card: MediaCard; compact?: boolean; run?: RunAction }) {
  const rows = useRows(card.items, m => m.title);
  // in chat, an empty answer is one quiet line, not a big empty frame
  if (!card.items.length) return compact
    ? <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 text-[13px] text-muted-foreground"><Film className="size-4" />{card.empty ?? 'Nothing playing'}</div>
    : (
    <div className="grid min-h-[180px] place-items-center rounded-2xl bg-card text-center shadow-card">
      <div><Film className="mx-auto mb-2 size-5 text-muted-foreground" /><div className="text-sm text-muted-foreground">{card.empty ?? 'Nothing playing'}</div></div>
    </div>
  );
  if (card.items.length === 1 && !stallOf(card.items[0])) return <NowPlaying m={card.items[0]} source={card.source} />;
  // banners suit something to watch; a pile of downloads, or three of anything, reads better as rows
  if (card.items.length > 2 || card.items.every(m => m.icon === 'download')) return (
    <Card className="flex-1 gap-0 divide-y divide-border overflow-hidden py-0 shadow-card">
      {rows.map(({ key, item: m, state }) => {
        const stall = stallOf(m);
        return (
          <RowSlot key={key} state={state}><div className="relative isolate flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-4 py-2.5">
            {m.pct != null && <span className={cn('absolute inset-0 -z-10 transition-transform duration-(--dur-move) ease-out', stall ? 'bg-warn/15' : 'bg-foreground/[.07]')} style={{ transform: `translateX(${m.pct * 100 - 100}%)` }} />}
            {m.image ? <Art src={m.image} className="h-12 w-8 shrink-0 rounded-md object-cover" /> : <span className="grid h-12 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-muted-foreground"><Icon name={m.icon ?? 'film'} className="size-4" /></span>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.title}</div>
              {stall ? <StallLine m={m} stall={stall} card={card} run={run} /> : <div className="truncate text-xs text-muted-foreground">{m.tags?.join(' · ') ?? m.subtitle}</div>}
            </div>
            {m.pct != null && <Counter value={`${Math.floor(m.pct * 100)}%`} className="shrink-0 text-sm font-medium" />}
          </div></RowSlot>
        );
      })}
    </Card>
  );
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
      {card.items.map((m, i) => <NowPlaying key={i} m={m} compact source={card.source} />)}
    </div>
  );
}

/** A row of artwork, like the Apple TV app: snap-scrolling, no borders, arrows to page through on desktop. */
/** A pile of pages, like an iMessage photo stack: slightly rotated, the top one in front. Hover fans them out; a
 *  click opens the full row. One page is just that page, held up a little. */
function Stack({ card, header, onOpen }: { card: ShelfCard; header?: ReactNode; onOpen: () => void }) {
  const pile = card.items.slice(0, 4), more = card.items.length - pile.length;
  const one = card.items.length === 1, top = card.items[0], photo = card.aspect === 'square';
  const rest = [[-7, -10], [6, 8], [-3, -4], [0, 0]].slice(4 - pile.length);   // [rotate°, x px] from back to front
  const open = one ? () => top.href && window.open(top.href, '_blank', 'noopener') : onOpen;
  return (
    <div>
      {header && <div className="mb-3 flex items-center gap-2">{header}</div>}
      <button onClick={open} aria-label={one ? `Open ${top.title}` : `Show all ${card.items.length}`}
        className="group/stack relative block h-[196px] w-full">
        {pile.slice().reverse().map((it, i) => {
          const [r, x] = rest[i], depth = pile.length - 1 - i;
          return (
            <div key={i} className={cn('stack-page absolute top-2.5 left-3 h-[176px] origin-bottom-left overflow-hidden shadow-[0_10px_30px_-10px_rgb(0_0_0/.6),0_0_0_1px_rgb(0_0_0/.08)]',
              photo ? 'aspect-square rounded-[16px] bg-muted ring-[3px] ring-white/90' : 'aspect-[3/4] rounded-[10px] bg-white')}
              style={{ '--r': `${one ? -2 : r * .7}deg`, '--x': `${x + 10}px`, '--fan-x': `${depth ? (pile.length - 1 - depth) * 58 : (pile.length - 1) * 58}px`, '--fan-r': `${(i - (pile.length - 1)) * -2.5}deg`,
                zIndex: i, filter: depth ? `brightness(${1 - depth * .06})` : undefined } as React.CSSProperties}>
              <Art src={it.image} alt="" className={cn('size-full object-cover', !photo && 'object-top')} />
            </div>
          );
        })}
        {more > 0 && <span className="absolute bottom-1 left-[140px] z-10 rounded-sm bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">+{more}</span>}
      </button>
      <div className="mt-2 pl-1">
        <div className="truncate text-[13px] font-medium">{top.title}</div>
        <div className="truncate text-xs text-muted-foreground">{one ? top.subtitle : `${card.items.length} ${photo ? 'photos' : 'documents'} · tap to see all`}</div>
      </div>
    </div>
  );
}

function Shelf({ card, header, small, run }: { card: ShelfCard; header?: ReactNode; small?: boolean; run?: RunAction }) {
  const [spread, setSpread] = useState(false);
  if (card.stack && !spread && card.items.length) return <Stack card={card} header={header} onOpen={() => setSpread(true)} />;
  if (!small && card.layout === 'spotlight' && card.items.length) return <Spotlight card={card} header={header} />;
  if (!small && card.layout === 'coverflow' && card.items.length > 2) return <CoverFlow card={card} header={header} />;
  if (!small && card.layout === 'desk' && card.items.length) return <Desk card={card} header={header} />;
  if (!small && card.layout === 'windows' && card.items.length) return <Windows card={card} header={header} run={run} />;
  // what's coming and what's asked for wear the same shelf as what's new: one shape, three times
  if (card.layout === 'week') {
    // several episodes of one show on one day are one poster
    const seen = new Map<string, ShelfItem & { n: number }>();
    for (const i of card.items) { const k = `${i.title}|${i.at ?? i.badge}`, had = seen.get(k); if (had) had.n++; else seen.set(k, { ...i, n: 1 }); }
    const items = [...seen.values()].map(({ n, ...i }) => ({ ...i, subtitle: n > 1 ? `${n} episodes` : i.subtitle, badge: i.badge === 'Ready' ? 'Ready' : dayWord(i.at) ?? i.badge }));
    return <ShelfRow card={{ ...card, items }} header={header} small={small} />;
  }
  if (card.layout === 'tickets') return <ShelfRow card={card} header={header} small={small} lines />;
  return <div className={card.stack ? 'stack-open' : undefined}><ShelfRow card={card} header={header} small={small} /></div>;
}

const Tile = ({ href, className, children, style, title }: { href?: string; className?: string; children: ReactNode; style?: React.CSSProperties; title?: string }) =>
  href ? <a href={href} target="_blank" rel="noreferrer" className={className} style={style} title={title}>{children}</a> : <div className={className} style={style} title={title}>{children}</div>;

/** The newest thing, large, with the rest running beside it. */
function Spotlight({ card, header }: { card: ShelfCard; header?: ReactNode }) {
  const [first, ...rest] = card.items;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">{header}</div>
      <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Tile href={first.href} className="group relative block aspect-[16/9] overflow-hidden rounded-2xl @4xl/main:aspect-auto @4xl/main:h-full bg-muted shadow-[0_18px_40px_-20px_rgb(0_0_0/.6)]">
          <Art src={first.backdrop ?? first.image} alt={first.title} className={cn('absolute inset-0 size-full object-cover transition-transform duration-(--dur-move) ease-out', first.href && 'group-hover:scale-[1.03]')} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 text-white">
            {first.backdrop && first.image && <Art src={first.image} alt="" className="h-[92px] w-[62px] shrink-0 rounded-lg object-cover shadow-lg" />}
            <div className="min-w-0"><div className="text-[12px] text-white/75">{first.badge ?? 'New'}</div>
              <div className="truncate text-[20px] font-semibold tracking-tight">{first.title}</div>{first.subtitle && <div className="truncate text-[13px] text-white/75">{first.subtitle}</div>}</div>
          </div>
        </Tile>
        {rest.length > 0 && <ShelfRow card={{ ...card, items: rest }} beside />}
      </div>
    </div>
  );
}

const TILT = [-3, 1.6, -1.2, 2.4, -2, .8, -2.6, 1.8];
const VIEW = 'valet-doc-view';
/** The same documents as a list, for finding one rather than looking at them: the page, its full title, who, when, what. */
function DocList({ items }: { items: ShelfItem[] }) {
  return (
    <ul className="-mx-2 mt-3 divide-y">
      {items.map((d, i) => {
        const [sender, date] = d.doc ? [d.doc.sender, d.doc.date] : (d.subtitle ?? '').split(' · ');
        return (
          <li key={i}>
            <Tile href={d.href} className={cn('doc-row', d.href && 'is-link')}>
              <Art src={d.image} className="doc-thumb" />
              <span className="doc-title">{d.title}</span>
              <span className="doc-cell">{sender}</span>
              <span className="doc-cell tabular">{date}</span>
              <span className="doc-cell">{d.doc?.type ?? d.badge}</span>
            </Tile>
          </li>
        );
      })}
    </ul>
  );
}

/** Documents as paper: real pages dealt onto a desk. Hover picks one up; the toggle lays them out as a list. */
function Desk({ card, header }: { card: ShelfCard; header?: ReactNode }) {
  const [list, setList] = useState(() => { try { return localStorage.getItem(VIEW) === 'list'; } catch { return false; } });
  const pick = (v: boolean) => { setList(v); try { localStorage.setItem(VIEW, v ? 'list' : 'desk'); } catch { /* private mode */ } };
  const row = useRow();   // the desk has room on a large screen; on a small one it's a row to throw, without losing the tilt
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">{header}</div>
        {!list && !(row.edge.start && row.edge.end) && <Arrows row={row} className="ml-auto hidden sm:flex" />}
        <div className="seg" role="group" aria-label="View documents as">
          {[false, true].map(v => <button key={String(v)} type="button" aria-pressed={list === v} onClick={() => pick(v)}>{v ? 'List' : 'Desk'}</button>)}
        </div>
      </div>
      {list ? <DocList items={card.items} /> : <div className="desk carousel" {...row.bind}>
        {card.items.slice(0, 8).map((d, i) => (
          <a key={i} href={d.href} target="_blank" rel="noreferrer" className="desk-page" style={{ '--tilt': `${TILT[i]}deg` } as React.CSSProperties}>
            <span className="desk-sheet"><Art src={d.image} className="size-full object-cover object-top" />{d.badge && <span className="desk-stamp">{d.badge}</span>}</span>
            <span className="mt-2.5 block truncate text-sm font-medium">{d.title}</span>
            {d.subtitle && <span className="block truncate text-xs text-muted-foreground">{d.subtitle}</span>}
          </a>
        ))}
      </div>}
    </div>
  );
}

/** Saved pages as small browser windows, the page itself inside; hover and it scrolls by. */
function Windows({ card, header, run }: { card: ShelfCard; header?: ReactNode; run?: RunAction }) {
  const arch = useArchive(run, true);
  const site = (s?: string) => s && /^[\w-]+(\.[\w-]+)+$/.test(s) ? s : undefined;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3"><div className="min-w-0">{header}</div>{run && <SeeArchived href={card.archived} className="shrink-0" />}</div>
      <div className="windows">
        {card.items.filter(w => !w.id || !arch.gone.includes(w.id)).slice(0, 9).map((w, i) => (
          <a key={w.id ?? i} href={w.href} target="_blank" rel="noreferrer" className={cn('window relative', w.id && arch.leaving.includes(w.id) && 'gone')}>
            {run && w.id && <button type="button" aria-label="Archive" title="Archive" className="window-archive" onClick={e => { e.preventDefault(); e.stopPropagation(); arch.archive(w.id!, e.currentTarget.closest('.window')); }}><Archive className="size-3.5" /></button>}
            <span className="window-bar"><i /><i /><i />{site(w.subtitle) && <img src={`/api/favicon/${w.subtitle}`} alt="" className="ml-1.5 size-3.5 rounded-sm" onError={e => { e.currentTarget.style.display = 'none'; }} />}<span className="min-w-0 truncate">{w.subtitle}</span></span>
            <span className="window-page">{w.image ? <Art src={w.image} className="w-full" /> : <span className="grid h-full place-items-center bg-white/[.04]"><Bookmark className="size-5 text-muted-foreground" /></span>}</span>
            <span className="block p-3.5">
              <span className="line-clamp-2 text-sm leading-snug font-medium">{w.title}</span>
              {w.note && <Clamp text={w.note} className="mt-1 text-xs leading-snug text-muted-foreground" />}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Today, Tomorrow, then the weekday and date: how a person says when. */
function dayWord(at?: string) {
  if (!at) return undefined;
  const d = new Date(`${at.slice(0, 10)}T00:00`), t = new Date(); t.setHours(0, 0, 0, 0);
  const n = Math.round((d.getTime() - t.getTime()) / 864e5);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? 'Aired' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}
const lineOf = (it: ShelfItem) => /partial/i.test(it.badge ?? '') ? 'part' : it.tone === 'good' ? 'done' : it.tone === 'accent' || /download|processing/i.test(it.badge ?? '') ? 'busy' : it.tone === 'bad' ? 'bad' : 'wait';

/** A leaderboard: the winner in full colour, the rest measured against it. */
function Ranked({ card }: { card: RankedCard }) {
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing yet'} />;
  return (
    <ol className="space-y-3">
      {card.items.slice(0, 5).map((it, i) => (
        <li key={i} className="flex min-w-0 items-center gap-3">
          {it.image && <Art src={it.image} alt="" className="h-[42px] w-7 shrink-0 rounded-[5px] object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3"><span className="min-w-0 flex-1 truncate text-sm font-medium">{it.title}</span>{it.value && <span className="shrink-0 text-xs tabular text-muted-foreground">{it.value}</span>}</div>
            <div className="mt-1.5"><Bar pct={it.pct ?? (i ? 0 : 1)} /></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ShelfRow({ card, header, small, beside, lines }: { card: ShelfCard; header?: ReactNode; small?: boolean; beside?: boolean; lines?: boolean }) {
  const row = useRow();
  const ratio = card.aspect === 'square' ? 'aspect-square' : card.aspect === 'wide' ? 'aspect-video' : 'aspect-[2/3]';
  const width = small ? (card.aspect === 'wide' ? 'w-[180px]' : 'w-[92px]') : card.aspect === 'wide' ? 'w-[240px] @3xl/main:w-[280px]' : 'w-[128px] @3xl/main:w-[150px]';
  return (
    <div className={cn(beside && 'relative min-w-0')}>
      <div className={cn('flex items-center gap-2', beside ? 'absolute -top-10 right-0 @max-4xl/main:hidden' : !!(header || card.items.length > (small ? 4 : 6)) && 'mb-3')}>
        {header}
        <Arrows row={row} className={cn('ml-auto hidden', !(row.edge.start && row.edge.end) && 'sm:flex')} />
      </div>
      {card.items.length === 0 ? <Empty text={card.empty ?? 'Nothing here yet'} /> : (
        <div {...row.bind} role="group" aria-label={card.title} tabIndex={card.items.some(it => it.cta?.href ?? it.href) ? undefined : 0}
          className="carousel -mx-2 -my-3 flex scroll-px-2 gap-4 overflow-x-auto px-2 py-3">
          {card.items.map((it, i) => {
            const href = it.cta?.href ?? it.href;
            const inner = (
              <div className="carousel-face">
                <div className={cn('relative overflow-hidden rounded-xl bg-muted shadow-[0_10px_24px_-12px_rgb(0_0_0/0.45)] transition-[translate,box-shadow] duration-(--dur-pop) ease-out', href && 'group-hover:-translate-y-1 group-hover:shadow-[0_18px_32px_-12px_rgb(0_0_0/0.5)]', ratio)}>
                  <Art src={it.image} alt={it.title} className="size-full object-cover" />
                  {it.badge && !lines && <span className={cn('absolute bottom-2 left-2 rounded-sm px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md', 'bg-black/60', it.badge === 'Ready' ? 'text-good' : it.badge === 'Today' && 'text-primary')}>{it.badge}</span>}
                  {lines && <i className={`ticket-line is-${lineOf(it)}`} />}
                </div>
                <div className="mt-2.5 truncate text-[13px] font-medium">{it.title}</div>
                {(lines ? it.badge ?? it.subtitle : it.subtitle) && <div className="truncate text-xs text-muted-foreground">{lines ? it.badge ?? it.subtitle : it.subtitle}</div>}
                {lines && it.note && <div className="truncate text-xs text-muted-foreground">{it.note}</div>}
                {it.cta && <div className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground"><span className="truncate">{it.cta.label}</span><ArrowUpRight className="size-3 shrink-0" /></div>}
              </div>
            );
            return href
              ? <a key={i} href={href} target="_blank" rel="noreferrer" className={cn('group shrink-0 snap-start', width)}>{inner}</a>
              : <div key={i} className={cn('shrink-0 snap-start', width)}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}

/** A line you can read with your finger: scrub across it for the exact value and when it was, and it says how far it's
 *  moved. The line draws itself in once. */
/** Stacked columns, one per point: the whole and its parts in one shape. Hover a column and it says what it holds. */
function Columns({ card }: { card: ChartCard }) {
  const n = Math.max(...card.series.map(s => s.points.length), 0), [at, setAt] = useState<number | null>(null);
  const tops = Array.from({ length: n }, (_, i) => card.series.reduce((t, s) => t + (s.points[i] ?? 0), 0)), max = Math.max(...tops, 1);
  const long = card.from != null && card.to != null && card.to - card.from > 1296e5;   // past a day and a half, days say more than hours
  const when = (i: number) => {
    const l = card.labels?.[i];
    if (l) return /^\d{4}-\d\d-\d\d/.test(l) ? dayOf(new Date(`${l.slice(0, 10)}T00:00`)) : l;
    if (card.from == null || card.to == null) return '';
    const t = card.from + (i / Math.max(1, n - 1)) * (card.to - card.from);
    return long ? dayOf(t) : clockOf(t);
  };
  const live = !card.labels?.length && card.to != null && Date.now() - card.to < 72e5;
  const ticks = n > 2 && (card.labels?.length || card.from != null) ? [0, (n - 1) >> 1, n - 1] : [];
  const paint = (s: ChartCard['series'][number]) => card.style === 'stream' ? flow(card.series.indexOf(s)) : s.tone ? toneVar(s.tone) : 'color-mix(in oklab, var(--foreground) 24%, transparent)';
  const sum = (s: ChartCard['series'][number]) => s.total ?? s.points.reduce((a, b) => a + b, 0), whole = tops.reduce((a, b) => a + b, 0), spot = at != null ? (at + .5) / n : 0;
  return (
    <div className="chart-body">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="metric text-[28px] leading-none"><Counter value={card.headline ?? written(whole)} /></span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{card.span}</span>
      </div>
      <div className="columns-chart" onPointerLeave={() => setAt(null)}>
        {card.style === 'stream' ? <Stream card={card} at={at} onAt={setAt} /> : tops.map((t, i) => (
          <div key={i} className={cn('col', at === i && 'is-at')} onPointerEnter={() => setAt(i)}>
            {card.series.map(s => <i key={s.name} style={{ height: `${(s.points[i] ?? 0) / max * 100}%`, background: paint(s) }} />)}
          </div>
        ))}
        {/* the label leans away from the card's edge as the pointer nears it, so it never clips */}
        {at != null && <div className="col-tip" style={{ left: `${spot * 100}%`, translate: `${-spot * 100}% 0` }}><b>{when(at)}</b>{card.series.map(s => ` · ${written(s.points[at] ?? 0)} ${/^[A-Z]+$/.test(s.name) ? s.name : s.name.toLowerCase()}`).join('')}</div>}
      </div>
      {ticks.length > 0 && <div className="col-axis">{ticks.map((i, k) => <span key={i}>{k === 2 && live ? 'now' : when(i)}</span>)}</div>}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        {card.series.map(s => <span key={s.name} className="flex items-center gap-1.5 tabular"><i className="size-2 rounded-full" style={{ background: paint(s) }} />{s.name} {written(sum(s))}</span>)}
        {card.window && <span className="ml-auto shrink-0">{card.window}</span>}
      </div>
      {card.facts?.length ? (
        <>
          {card.factsNote && <div className="mt-3 text-xs text-muted-foreground">{card.factsNote}</div>}
          <div className={cn('flex flex-wrap gap-1.5', card.factsNote ? 'mt-1.5' : 'mt-3')}>
            {card.facts.map(f => <span key={f.label} className="fact"><span className="truncate">{f.label}</span>{f.value && <b>{f.value}</b>}</span>)}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Chart({ card }: { card: ChartCard }) {
  if (card.style === 'bars' || card.style === 'stream') return <Columns card={card} />;
  const w = 300, h = 96, count = Math.max(...card.series.map(s => s.points.length), 0);
  // the scale fits the data, so a number that moves a little still shows its shape; a fixed max (a percentage) keeps zero
  const all = card.series.flatMap(s => s.points), top = Math.max(...all, 0), low = Math.min(...all, top), pad = (top - low) * .2 || Math.abs(top) * .1 || 1;
  const max = card.max ?? top + pad, min = card.max != null ? 0 : Math.max(low >= 0 ? 0 : -Infinity, low - pad);
  const x = (i: number, n: number) => (i / Math.max(1, n - 1)) * w, y = (p: number) => h - 3 - ((p - min) / (max - min || 1)) * (h - 8);
  const [at, setAt] = useState<number | null>(null);
  const unit = card.unit ?? '';
  const num = (v: number) => `${Math.abs(v) >= 100 ? written(Math.round(v)) : Math.round(v * 10) / 10}${unit && !/^\s/.test(unit) && unit.length > 2 ? ` ${unit}` : unit}`;
  const lead = card.series[0], last = lead?.points.at(-1), first = lead?.points[0];
  const move = (first != null && last != null && first !== 0) ? (last - first) / Math.abs(first) : null;
  const when = (i: number) => card.labels?.[i] ?? (card.from != null && card.to != null ? new Date(card.from + (i / Math.max(1, count - 1)) * (card.to - card.from)).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null);
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setAt(Math.round(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * (count - 1)));
  };
  const shown = at != null ? lead?.points[at] : last, wash = useId(), spot = at != null ? at / Math.max(1, count - 1) * 100 : 0;
  // what the line covers, under it. Past a day and a half days say more than hours; a line still arriving ends at "now"
  const timed = card.from != null && card.to != null && !card.labels?.length, tick = (t: number) => card.to! - card.from! > 1296e5 ? dayOf(t) : clockOf(t);
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="metric text-[22px] leading-none">{at == null && card.headline ? card.headline : shown != null ? num(shown) : '–'}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {at != null ? when(at) : card.headline ? card.span : move != null && Math.abs(move) >= .005 ? <span className={cn('tabular', lead.tone === 'bad' ? 'text-bad' : '')}>{move > 0 ? '+' : ''}{Math.round(move * 1000) / 10}%{card.span ? ` over the ${card.span}` : ''}</span> : card.span}
        </span>
      </div>
      <div className="chart-scrub relative touch-pan-y select-none" onPointerMove={scrub} onPointerDown={scrub} onPointerLeave={() => setAt(null)} onPointerUp={e => { if (e.pointerType !== 'mouse') setAt(null); }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
          {card.series.map((s, k) => {
            const pts = s.points.map((p, i) => [x(i, s.points.length), y(p)] as [number, number]), d = smooth(pts);
            const color = k ? 'var(--muted-foreground)' : toneVar(s.tone);
            return <g key={s.name}>{!k && <><defs><linearGradient id={wash} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".26" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs><path d={`${d}L${w},${h}L0,${h}Z`} fill={`url(#${wash})`} /></>}
              <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></g>;
          })}
        </svg>
        {at != null && lead && (
          <div className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${spot}%)` }}>
            <span className="absolute inset-y-0 left-0 w-px bg-foreground/25" />
            {card.series.map((s, k) => s.points[at] != null && <span key={s.name} className="absolute left-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background" style={{ top: `${(y(s.points[at]) / h) * 100}%`, background: k ? 'var(--muted-foreground)' : toneVar(s.tone) }} />)}
          </div>
        )}
      </div>
      {timed && <div className="col-axis"><span>{tick(card.from!)}</span><span>{tick((card.from! + card.to!) / 2)}</span><span>{Date.now() - card.to! < 72e5 ? 'now' : tick(card.to!)}</span></div>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {card.series.length > 1 && card.series.map((s, k) => <span key={s.name} className="tabular" style={k ? undefined : { color: toneVar(s.tone) }}>{s.name}{at != null && s.points[at] != null ? ` ${num(s.points[at])}` : card.headline ? '' : s.points.length ? ` ${num(s.points.at(-1)!)}` : ''}</span>)}
        {card.span && !card.headline && <span className="ml-auto">{card.span}</span>}
      </div>
    </div>
  );
}

/** Logs and config: monospace, numbered, one-tap copy; a diff shows what's added and removed. */
function Code({ card }: { card: CodeCard }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(card.lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <div className="group/code relative -mx-1">
      <button type="button" onClick={copy} aria-label="Copy" className="chat-icon absolute top-1 right-1 z-10 text-muted-foreground">{copied ? <Check className="morph size-3.5 text-good" /> : <Copy className="size-3.5" />}</button>
      <pre className="max-h-72 overflow-auto rounded-xl bg-black/25 py-2 font-mono text-[12px] leading-[1.65]">
        {card.lines.map((l, i) => {
          const tone = card.diff && l[0] === '+' ? 'bg-good/10 text-good' : card.diff && l[0] === '-' ? 'bg-bad/10 text-bad' : '';
          return <div key={i} className={cn('flex min-w-max gap-3 pr-10 pl-2', tone)}><span className="w-6 shrink-0 text-right text-muted-foreground/50 tabular select-none">{i + 1}</span><span className="whitespace-pre">{l || ' '}</span></div>;
        })}
      </pre>
    </div>
  );
}

/** Rows and columns, numbers lined up; tap a heading to sort by it. */
function Table({ card }: { card: TableCard }) {
  const [sort, setSort] = useState<{ col: number; up: boolean } | null>(null);
  const numeric = card.columns.map((_, c) => card.rows.length > 0 && card.rows.every(r => r[c] === '' || Number.isFinite(Number(String(r[c]).replace(/[,%$]/g, '')))));
  const value = (v: string | number, c: number) => numeric[c] ? Number(String(v).replace(/[,%$]/g, '')) : String(v).toLowerCase();
  const rows = sort ? [...card.rows].sort((a, b) => { const x = value(a[sort.col], sort.col), y = value(b[sort.col], sort.col); return (x < y ? -1 : x > y ? 1 : 0) * (sort.up ? 1 : -1); }) : card.rows;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr>{card.columns.map((c, i) => (
          <th key={c} className={cn('whitespace-nowrap px-1.5 pb-1.5 font-medium text-muted-foreground', numeric[i] ? 'text-right' : 'text-left')}>
            <button type="button" className="transition-colors hover:text-foreground" onClick={() => setSort(s => s?.col === i ? (s.up ? { col: i, up: false } : null) : { col: i, up: true })}>{c}{sort?.col === i ? (sort.up ? ' ↑' : ' ↓') : ''}</button>
          </th>
        ))}</tr></thead>
        <tbody className="divide-y">{rows.slice(0, 60).map((r, i) => <tr key={i} className="transition-colors hover:bg-accent/50">{r.map((v, c) => <td key={c} className={cn('max-w-[240px] truncate px-1.5 py-1.5', numeric[c] && 'text-right tabular')}>{v}</td>)}</tr>)}</tbody>
      </table>
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

/** A community visual: a browser module next to a plugin (data/integrations/<kind>.web.js), served at
 *  /plugins/<kind>.web.js. Its default export mounts into a box: mount(el, data, { run }) → { update?(data), destroy?() }.
 *  The same contract as Valet's own 3D models, so a plugin can draw anything without React or a build step. */
function PluginVisual({ kind, data, run }: { kind: string; data: unknown; run?: RunAction }) {
  const box = useRef<HTMLDivElement>(null), inst = useRef<{ update?(d: unknown): void; destroy?(): void } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let gone = false;
    import(/* @vite-ignore */ `/plugins/${encodeURIComponent(kind)}.web.js`)
      .then(m => { if (!gone && box.current) inst.current = m.default(box.current, data, { run }) ?? null; })
      .catch(e => setError(`couldn't load the "${kind}" visual: ${e.message}`));
    return () => { gone = true; inst.current?.destroy?.(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => { inst.current?.update?.(data); }, [data]);
  return error ? <Empty text={error} /> : <div ref={box} className="min-w-0" />;
}

/** The visual on the left, its numbers stacked on the right: big values, quiet labels, nothing else. */
function Showcase({ card, run }: { card: ShowcaseCard; run?: RunAction }) {
  const builtIn = VISUALS[card.visual.kind];
  const V = builtIn ?? (card.visual.kind !== 'image' ? (p: { data: any; run?: RunAction }) => <PluginVisual kind={card.visual.kind} {...p} /> : undefined);
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
              <Counter value={s.value} />{s.unit && <span className="ml-0.5 text-[14px] font-medium text-muted-foreground">{s.unit}</span>}
            </dd>
            {s.sub && <div className="mt-1 truncate text-[12px] text-muted-foreground">{s.sub}</div>}
          </div>
        ))}
        {card.caption && <div className="col-span-full text-[12px] text-muted-foreground">{card.caption}</div>}
      </dl>
    </div>
  );
}

/** Geometric star lattice, the kind that frames a mushaf page, fading out from the card's corner. */
function Lattice() {
  return (
    <svg className="verse-lattice pointer-events-none absolute inset-0 -z-10 size-full text-foreground" aria-hidden>
      <defs><pattern id="lattice" width="56" height="56" patternUnits="userSpaceOnUse">
        <g fill="none" stroke="currentColor" strokeWidth=".8"><rect x="17" y="17" width="22" height="22" /><rect x="17" y="17" width="22" height="22" transform="rotate(45 28 28)" /><path d="M0 0 12.4 12.4M56 0 43.6 12.4M0 56l12.4-12.4M56 56 43.6 43.6" /></g>
      </pattern></defs>
      <rect width="100%" height="100%" fill="url(#lattice)" />
    </svg>
  );
}

/** A verse: the Arabic large and right-to-left, its meaning beneath, the reference quietly at the end. */
function Verse({ card }: { card: VerseCard }) {
  const dense = useContext(Dense);
  return (
    <a href={card.href} target="_blank" rel="noreferrer" className="flex flex-1 flex-col gap-3">
      {card.arabic && <p dir="rtl" lang="ar" className={cn('verse-ar leading-[2.1] text-foreground', dense ? 'text-[20px]' : 'text-[26px]')}>{card.arabic}</p>}
      <p className={cn('leading-relaxed text-foreground/80', dense ? 'text-[13px]' : 'text-[14px]')}>{card.english.replace(/[˹˺]/g, '')}</p>
      <p className="mt-auto text-[12px] text-muted-foreground">{card.reference}{card.meaning ? ` · ${card.meaning}` : ''}</p>
    </a>
  );
}

/** The card's backdrop is the sky outside right now: dawn, day, golden hour, dusk or a night with stars. It needs a
 *  sunrise and a sunset in the times; any other schedule stays plain. */
function SkyWash({ card }: { card: ScheduleCard }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const time = (re: RegExp) => { const x = card.items.find(i => re.test(i.name)); return x ? Date.parse(x.at) : NaN; };
  const rise = time(/sunrise/i), set = time(/maghrib|sunset/i), min = 60_000;
  if (Number.isNaN(rise) || Number.isNaN(set)) return null;
  const sky = Math.abs(now - rise) < 50 * min ? ['#ff8a5c', '#6a5ae0'] : Math.abs(now - set) < 50 * min && now >= set ? ['#c2487f', '#2f2a7a']
    : now > set - 80 * min && now < set ? ['#ffab4d', '#c2557a'] : now > rise && now < set ? ['#4fb0ff', '#2a6fd6'] : ['#26338a', '#0d1140'];
  const night = now < rise - 50 * min || now > set + 50 * min;
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(120% 90% at 50% 112%, ${sky[0]}, ${sky[1]} 52%, transparent 82%)` }} />
      {night && [[8, 12], [17, 34], [26, 9], [38, 22], [49, 7], [61, 30], [72, 12], [83, 26], [92, 8], [13, 56], [88, 52]].map(([x, y], i) => <span key={i} className="twinkle absolute size-[2px] rounded-full bg-white" style={{ left: `${x}%`, top: `${y}%` }} />)}
    </div>
  );
}

/** The large prayer card: the sky over a day. The sun rides an arc from sunrise to sunset, each prayer sits where the
 *  sun is at its time (night prayers below the horizon), now glows on the path, and the next prayer counts down. */
function Sky({ card }: { card: ScheduleCard }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const items = card.items.map(x => ({ ...x, t: Date.parse(x.at), muted: card.muted?.includes(x.name) }));
  if (items.length < 2) return <Schedule card={card} />;
  const rise = items.find(x => /sunrise/i.test(x.name))?.t ?? items[1].t, set = items.find(x => /maghrib|sunset/i.test(x.name))?.t ?? items[items.length - 2].t;
  const W = 600, H = 250, base = 168, r = 230, cx = W / 2;
  // daylight maps onto the arc (0 at sunrise, 1 at sunset); before and after, the path dips below the horizon
  const point = (t: number) => {
    const day = (t - rise) / Math.max(1, set - rise);
    const u = Math.max(-0.22, Math.min(1.22, day)), a = Math.PI * (1 - u);
    return { x: cx + r * Math.cos(a), y: base - (u >= 0 && u <= 1 ? 1 : 0.55) * Math.sin(a) * 120, up: u >= 0 && u <= 1 };
  };
  const roll = items.filter(x => !x.muted).map(x => ({ ...x, t: x.t <= now ? x.t + 864e5 : x.t })).sort((a, b) => a.t - b.t);
  const next = roll[0], mins = Math.max(0, Math.round((next.t - now) / 60_000)), sun = point(now);
  const path = Array.from({ length: 61 }, (_, i) => { const p = point(rise - .22 * (set - rise) + (i / 60) * 1.44 * (set - rise)); return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join('');
  const clock = clockOf;
  return (
    <div className="flex flex-1 flex-col justify-between gap-2">
      <div className="flex items-end justify-between">
        <div><div className="metric text-[24px] leading-none">{next.name}</div><div className="mt-1.5 text-[13px] text-muted-foreground tabular">{clock(next.t)}</div></div>
        <div className="text-right"><div className={cn('metric text-[22px] tabular leading-none', mins <= 15 && 'text-good')}><Counter flap value={mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`} /></div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">to go</div></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-h-[150px] w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="sky-path" x1="0" x2="1"><stop offset="0" stopColor="#5e5ce6" /><stop offset=".25" stopColor="#ffb46b" /><stop offset=".5" stopColor="#ffd60a" /><stop offset=".75" stopColor="#ff9f0a" /><stop offset="1" stopColor="#5e5ce6" /></linearGradient>
          <radialGradient id="sky-sun"><stop offset="0" stopColor={sun.up ? '#fff4c2' : '#dfe6ff'} /><stop offset=".35" stopColor={sun.up ? '#ffd60a' : '#9fb4ff'} stopOpacity=".9" /><stop offset="1" stopColor={sun.up ? '#ffd60a' : '#9fb4ff'} stopOpacity="0" /></radialGradient>
        </defs>
        <line x1="0" x2={W} y1={base} y2={base} stroke="currentColor" strokeOpacity=".14" strokeDasharray="2 5" />
        <path d={path} fill="none" stroke="url(#sky-path)" strokeWidth="2.2" strokeLinecap="round" opacity=".75" />
        {items.map(x => {
          const p = point(x.t), isNext = x.name === next.name, off = Math.abs(p.x - cx);
          // labels sit outside the arc: above it by day, below it by night, and out to the side where it runs steep
          const side = p.up && off > r * .9, anchor = side ? (p.x < cx ? 'end' : 'start') : 'middle';
          const lx = side ? p.x + (p.x < cx ? -14 : 14) : p.x + (p.up ? (p.x - cx) * .12 : 0), ly = side ? p.y - 8 : p.y + (p.up ? -33 : 26);
          return (
            <g key={x.name} opacity={x.muted ? .45 : 1}>
              <circle cx={p.x} cy={p.y} r={isNext ? 5 : 3.5} fill={isNext ? '#fff' : 'currentColor'} fillOpacity={isNext ? 1 : .55} />
              <text x={lx} y={ly} textAnchor={anchor} className="fill-current text-[20px] font-medium" opacity={isNext ? 1 : .7}>{x.name}</text>
              <text x={lx} y={ly + 20} textAnchor={anchor} className="fill-current text-[17px] tabular" opacity=".6">{clock(x.t)}</text>
            </g>
          );
        })}
        <circle cx={sun.x} cy={sun.y} r="22" fill="url(#sky-sun)" />
        <circle cx={sun.x} cy={sun.y} r="6.5" fill={sun.up ? '#ffe680' : '#e8edff'} />
      </svg>
    </div>
  );
}

/** A day's times: the next one large, counting down live; all of them on a line with a dot for now. */
function Schedule({ card }: { card: ScheduleCard }) {
  const dense = useContext(Dense);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const items = card.items.map(x => ({ ...x, t: Date.parse(x.at), muted: card.muted?.includes(x.name) }));
  if (!items.length) return <Empty text="No times" />;
  const roll = items.filter(x => !x.muted).map(x => ({ ...x, t: x.t <= now ? x.t + 864e5 : x.t })).sort((a, b) => a.t - b.t);
  const next = roll[0], mins = Math.max(0, Math.round((next.t - now) / 60_000));
  const clock = clockOf;
  // markers sit evenly along the line (close times stay readable); now slides between its two neighbours
  const n = items.length, pos = (k: number) => n > 1 ? k / (n - 1) : .5;
  const at = (t: number) => {
    if (t <= items[0].t) return 0;
    const k = items.findIndex(x => x.t > t);
    if (k === -1) return 1;
    return pos(k - 1) + (pos(k) - pos(k - 1)) * (t - items[k - 1].t) / Math.max(1, items[k].t - items[k - 1].t);
  };
  return (
    <div className={cn(dense ? 'space-y-3' : 'space-y-5')}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className={cn('metric leading-none', dense ? 'text-[24px]' : 'text-[34px]')}>{next.name}</div>
          <div className="mt-1.5 text-[13px] text-muted-foreground tabular">{clock(next.t)}</div>
        </div>
        <div className="text-right">
          <div className={cn('metric tabular leading-none', dense ? 'text-[18px]' : 'text-[22px]', mins <= 15 && 'text-good')}>
            <Counter flap value={mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`} />
          </div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">to go</div>
        </div>
      </div>
      <div className="relative pt-1 pb-7">
        <div className="h-[3px] rounded-full bg-white/10" />
        <div className="absolute top-1 left-0 h-[3px] rounded-full bg-gradient-to-r from-white/20 to-white/60" style={{ width: `${at(now) * 100}%` }} />
        <span className="absolute top-[-1px] h-[11px] w-[2px] -translate-x-1/2 rounded-full bg-white" style={{ left: `${at(now) * 100}%` }} />
        {items.map((x, k) => x.muted
          // a moment that's never "next" is a notch on the line, not a word: hover says which
          ? <span key={x.name} title={`${x.name} · ${clock(x.t)}`} className="absolute top-[2px] h-[7px] w-px -translate-x-1/2 bg-white/35" style={{ left: `${pos(k) * 100}%` }} />
          : <div key={x.name} className={cn('absolute top-3 text-center', k === 0 ? '' : k === n - 1 ? '-translate-x-full text-right' : '-translate-x-1/2')} style={{ left: `${pos(k) * 100}%` }}>
              <div className={cn('text-[11px] font-medium', x.name === next.name ? 'text-foreground' : 'text-muted-foreground')}>{x.name}</div>
              {!dense && <div className="text-[11px] tabular text-muted-foreground/70">{clock(x.t)}</div>}
            </div>)}
      </div>
    </div>
  );
}

/** The black bars baked into a video still or a widescreen edit, as fractions of its height. Both edges must be black,
 *  so a photo that's merely dark at the top keeps its sky. Images from another origin can't be read, and stay as they are. */
function letterbox(img: HTMLImageElement): [number, number] | undefined {
  try {
    const W = 24, H = 96, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const black = (y: number) => Array.from({ length: W }, (_, i) => (y * W + i) * 4).every(k => d[k] + d[k + 1] + d[k + 2] < 36);
    let top = 0, bottom = 0;
    while (top < H / 3 && black(top)) top++;
    while (bottom < H / 3 && black(H - 1 - bottom)) bottom++;
    return top >= 3 && bottom >= 3 ? [(top + 1) / H, (bottom + 1) / H] : undefined;
  } catch { return undefined; }
}

/** Flashback: one photo at a time, filling the card, crossfading slowly with a gentle drift; the moment's caption
 *  ("3 years ago · Lisbon") sits over the bottom. Mosaic: one large photo and four small ones. Hover pauses. */
function Photos({ card, large, fill, label, status }: { card: PhotosCard; large?: boolean; fill?: boolean; label?: string; status?: ReactNode }) {
  const items = card.items, [i, setI] = useState(0), [paused, setPaused] = useState(false), [bars, setBars] = useState<Record<number, [number, number]>>({}), [box, seen] = useOnScreen<HTMLAnchorElement>();
  useEffect(() => {
    if (items.length < 2 || paused || !seen || (large && card.style !== 'flashback')) return;
    const t = setInterval(() => { if (!document.hidden) setI(n => (n + 1) % items.length); }, 7000);
    return () => clearInterval(t);
  }, [items.length, paused, seen, large, card.style]);
  if (!items.length) return <Empty text={card.empty ?? 'No photos'} />;
  if (large || card.style === 'mosaic') {
    const [first, ...rest] = items;
    return (
      <div className="grid aspect-[2/1] grid-cols-4 grid-rows-2 gap-1.5 overflow-hidden rounded-2xl">
        {[first, ...rest.slice(0, 4)].map((p, k) => (
          <a key={k} href={p.href} target="_blank" rel="noreferrer" className={cn('group/ph relative overflow-hidden bg-muted', k === 0 && 'col-span-2 row-span-2')}>
            <Art src={p.image} alt={p.title ?? ''} className={cn('size-full object-cover transition-transform duration-(--dur-move) ease-out', p.href && 'group-hover/ph:scale-[1.03]')} />
            {k === 0 && p.badge && <span className="absolute bottom-3 left-3 rounded-sm bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">{p.badge}</span>}
          </a>
        ))}
      </div>
    );
  }
  const cur = items[i], [lead, ...rest] = [cur.badge, cur.title, cur.subtitle].filter(Boolean);
  return (
    <a ref={box} href={cur.href} target="_blank" rel="noreferrer" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      className={cn(cur.href && 'lift', 'relative isolate block overflow-hidden rounded-[calc(var(--radius)*1.6)] bg-neutral-900 text-white shadow-[0_18px_40px_-20px_rgb(0_0_0/.55)]', fill ? 'h-full min-h-[280px]' : 'aspect-[4/3] max-h-[460px] w-full')}>
      {items.map((p, k) => (
        <Art key={k} src={p.image} alt={p.title ?? ''} className={cn('photo-slide absolute inset-0 -z-10 size-full object-cover', k === i && 'is-on')}
          style={bars[k] && { height: `${100 / (1 - bars[k][0] - bars[k][1])}%`, top: `${-100 * bars[k][0] / (1 - bars[k][0] - bars[k][1])}%` }}
          onLoaded={img => { const b = letterbox(img); if (b) setBars(s => ({ ...s, [k]: b })); }} />
      ))}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgb(0_0_0/.72),rgb(0_0_0/.08)_38%,transparent_60%,rgb(0_0_0/.5))]" />
      <AppBadge of={card.source} />
      {label && <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-5 text-[15px] font-semibold [text-shadow:0_1px_8px_rgb(0_0_0/.45)]"><span className="min-w-0 truncate">{label}</span>{status}</div>}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
        <div key={i} className="min-w-0 tick">
          {lead && <div className="truncate text-[21px] font-semibold tracking-tight">{lead}</div>}
          {rest.length > 0 && <div className="truncate text-[13px] text-white/75">{rest.join(' · ')}</div>}
        </div>
        {items.length > 1 && (
          <div className="mb-1 flex shrink-0 gap-1">
            {items.slice(0, 8).map((_, k) => <span key={k} className={cn('h-1.5 rounded-full bg-white transition-opacity', k === i % 8 ? 'w-4 opacity-90' : 'w-1.5 opacity-40')} />)}
          </div>
        )}
      </div>
    </a>
  );
}

/** The sky arc on the page; the plain timeline where space is tight. */
function Times({ card }: { card: ScheduleCard }) { return useContext(Dense) ? <Schedule card={card} /> : <Sky card={card} />; }

export function CardBody({ card, run, columns, minimal, large }: { card: CardT; run?: RunAction; columns?: number; minimal?: boolean; large?: boolean }): ReactNode {
  switch (card.type) {
    case 'cameras': return <Cameras card={card} />;
    case 'showcase': return <Showcase card={card} run={run} />;
    case 'photos': return <Photos card={card} large={large} />;
    case 'schedule': return <Times card={card} />;
    case 'embed': return <iframe src={card.src} title={card.title ?? 'Embedded page'} loading="lazy" referrerPolicy="no-referrer" sandbox={card.scripts ? 'allow-scripts allow-same-origin allow-forms' : ''} className="w-full rounded-xl border-0 bg-black/20" style={{ height: card.height }} />;
    case 'verse': return <Verse card={card} />;
    case 'forecast': return <WeatherCard card={card} dense />;
    case 'calendar': return <CalendarView card={card} dense />;
    case 'thermostat': return <Thermostat card={card} run={run} dense />;
    case 'stats': return <Stats card={card} />;
    case 'list': return <List card={card} />;
    case 'status': return <Status card={card} columns={columns} minimal={minimal} />;
    case 'links': return <Links card={card} />;
    case 'media': return <Media card={card} run={run} />;
    case 'shelf': return <Shelf card={card} />;
    case 'chart': return <Chart card={card} />;
    case 'race': return <Race race={card} span={card.span} />;
    case 'heatmap': return <Heatmap card={card} />;
    case 'code': return <Code card={card} />;
    case 'ranked': return <Ranked card={card} />;
    case 'table': return <Table card={card} />;
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
      <h3 className="truncate text-[15px] font-semibold tracking-tight">{card?.href ? <a href={card.href} target="_blank" rel="noreferrer" className="title-link">{card?.title ?? title}</a> : card?.title ?? title}</h3>
      {status}
      {card?.note && <span className="truncate text-xs tabular text-muted-foreground">{card.note}</span>}
    </div>
  );
}

/** A state someone chose and shouldn't forget, with the way out beside it. It lapses by itself at `until`. */
function BannerLine({ b, run }: { b: Banner; run?: RunAction }) {
  const [busy, setBusy] = useState(false);
  if (b.until && b.until < Date.now()) return null;
  const go = async () => { setBusy(true); try { await run?.(b.button!.action, b.button!.args); } finally { setBusy(false); } };
  return (
    <div className={cn('card-banner mb-3', b.tone === 'bad' ? 'is-bad' : 'is-warn')} role="status">
      <span className="min-w-0 flex-1 text-[14px] font-medium">{b.text}{b.until ? ` until ${clockOf(b.until)}` : ''}</span>
      {b.button && run && <button type="button" disabled={busy} onClick={go} className="press flex h-7 shrink-0 items-center gap-1.5 rounded-sm bg-foreground/15 px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/25 disabled:opacity-60">{busy && <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />}{b.button.label}</button>}
    </div>
  );
}

/** Where a card comes from: the service's logo and name, quiet, beside the title. */
/** Quick actions along a card's bottom: quiet pills that show they're working, then settle. */
function CardButtons({ buttons, run }: { buttons: NonNullable<CardT['buttons']>; run: RunAction }) {
  const [busy, setBusy] = useState<string | null>(null), [done, setDone] = useState<string | null>(null);
  return (
    <div className="mt-3.5 flex flex-wrap gap-1.5">
      {buttons.map(b => (
        <button key={b.label} disabled={!!busy} onClick={async () => {
          setBusy(b.label);
          try { await run(b.action, b.args); setDone(b.label); setTimeout(() => setDone(null), 1600); } finally { setBusy(null); }
        }} className="press flex h-7 items-center gap-1.5 rounded-sm bg-white/[.07] px-3 text-[12px] text-foreground/85 transition-colors hover:bg-white/[.12] disabled:opacity-60">
          {busy === b.label ? <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : done === b.label ? <span className="tick">✓</span> : null}
          {b.label}
        </button>
      ))}
    </div>
  );
}

// What each widget looked like last time (its card type and height, nothing it showed), so the placeholder on the next
// visit has the right shape and the page doesn't jump when the data lands.
const SHAPES = 'valet-shapes';
const shapes: Record<string, { t?: string; h?: number; empty?: boolean }> = (() => { try { return JSON.parse(localStorage.getItem(SHAPES) ?? '{}'); } catch { return {}; } })();
let saving: ReturnType<typeof setTimeout> | undefined;
export const shapeOf = (id: string) => shapes[id];
export function noteShape(id: string, shape: { t?: string; h?: number; empty?: boolean }) {
  if (JSON.stringify(shapes[id]) === JSON.stringify(shape)) return;
  shapes[id] = shape;
  clearTimeout(saving);
  saving = setTimeout(() => { try { localStorage.setItem(SHAPES, JSON.stringify(shapes)); } catch { /* private mode */ } }, 1000);
}
/** Holds a widget's remembered height until its card arrives, and notes the height once it has. */
export function Shaped({ id, card, children }: { id: string; card?: CardT; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (card && box.current?.offsetHeight) noteShape(id, { t: card.type, h: box.current.offsetHeight }); }, [id, card?.type, !card]);
  const h = !card ? shapes[id]?.h : undefined;
  return <div ref={box} className="h-full min-w-0" style={h ? { minHeight: h } : undefined}>{children}</div>;
}

/** A placeholder that looks like the card that's coming. */
function CardSkeleton({ kind }: { kind?: string }) {
  const row = (i: number) => <div key={i} className="flex items-center gap-3"><Skeleton className="size-8 shrink-0 rounded-lg" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div></div>;
  if (kind === 'stats') return <div className="grid grid-cols-2 gap-4">{[0, 1, 2, 3].map(i => <div key={i} className="space-y-2"><Skeleton className="h-2.5 w-1/2" /><Skeleton className="h-6 w-2/3" /></div>)}</div>;
  if (kind === 'status') return <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="flex items-center gap-2.5"><Skeleton className="size-[18px] rounded-md" /><Skeleton className="h-3 flex-1" /></div>)}</div>;
  if (kind === 'shelf') return <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="aspect-[2/3] w-[120px] shrink-0 rounded-xl" />)}</div>;
  if (kind === 'media' || kind === 'photos' || kind === 'showcase' || kind === 'cameras') return <Skeleton className="aspect-[16/7] w-full rounded-xl" />;
  if (kind === 'list' || kind === 'links') return <div className="space-y-4">{[0, 1, 2, 3].map(row)}</div>;
  return <div className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/5" /></div>;
}
export const TileSkeleton = () => (
  <Card className="relative h-[136px] gap-0 py-0 shadow-card"><div className="flex h-full flex-col justify-between p-4"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-7 w-1/2" /></div></Card>
);

function WidgetView({ card, run, title, status, compact, columns, minimal, headless, large, fill, kind, failed }: { card?: CardT; run?: RunAction; title?: string; status?: ReactNode; compact?: boolean; columns?: number; minimal?: boolean; headless?: boolean; large?: boolean; fill?: boolean; kind?: string; failed?: string }) {
  const fade = useRef(card ? '' : 'fade-in-soft').current;   // up from its skeleton; a tab you come back to is already there
  // artwork-led cards sit directly on the page, without a card frame
  const actions = card?.buttons?.length && run ? <CardButtons buttons={card.buttons} run={run} /> : null;
  if (card?.type === 'shelf') return <div className={cn(fade, 'min-w-0')}><Shelf card={card} small={compact} run={run} header={<BareHeader card={card} title={title} status={status} />} />{actions}</div>;
  // a flashback is all picture: its heading sits on the photo, so the card's edges line up with its neighbours
  if (card?.type === 'article') return <Article card={card} run={run} />;
  if (card?.type === 'photos' && card.items.length && !large && card.style !== 'mosaic') return (
    <div className={cn(fade, 'h-full min-w-0')}><Photos card={card} fill={fill} label={card.title ?? title} status={status} />{actions}</div>
  );
  if (card?.type === 'photos') return (
    <div className={cn(fade, 'min-w-0 space-y-3')}><BareHeader card={card} title={title} status={status} /><Photos card={card} large={large} />{actions}</div>
  );
  if (card?.type === 'media') return (
    <div className={cn(fade, 'flex min-w-0 flex-col gap-3', fill && 'h-full')}><BareHeader card={card} title={title} status={status} /><Media card={card} compact={compact} run={run} />{actions}</div>
  );
  // the house's cards are glass edge to edge, with no header; in chat they're ordinary cards, below
  if (!compact && (card?.type === 'forecast' || card?.type === 'calendar' || card?.type === 'thermostat')) return (
    <Card className={cn(fade, 'relative isolate min-w-0 gap-0 overflow-hidden py-0 shadow-card', fill && 'h-full')}>
      {status && <div className="absolute top-3 right-4 z-10">{status}</div>}
      {card.type === 'forecast' ? <WeatherCard card={card} /> : card.type === 'calendar' ? <CalendarView card={card} large={large} /> : <Thermostat card={card} run={run} />}
    </Card>
  );
  const t = card?.title ?? title;
  const bare = card?.type === 'group';
  const scene = !compact && card ? card.type === 'schedule' ? <SkyWash card={card} /> : card.type === 'verse' && card.arabic ? <Lattice /> : null : null;
  return (
    <Dense.Provider value={!!compact}>
    <Card className={cn('@container/card relative min-w-0 overflow-hidden shadow-card', compact ? 'gap-2.5 rounded-2xl py-3 shadow-none' : 'gap-4 py-5', !compact && card?.type === 'verse' && card.href && 'lift', bare && 'border-0 bg-transparent py-0 shadow-none', fill && 'h-full', scene && 'relative isolate overflow-hidden')}>
      {scene}
      {t && !bare && !headless && (
        <CardHeader className={cn('flex items-center gap-2', compact ? 'px-3.5' : 'px-5')}>
          <CardTitle className={cn('flex min-w-0 items-center gap-2 truncate', compact ? 'text-[13px]' : 'text-[15px]')}>{card?.source?.icon && <img src={card.source.icon} alt="" className="size-[18px] flex-none rounded-[5px] object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />}{card?.href ? <a href={card.href} target="_blank" rel="noreferrer" className="title-link">{t}</a> : t}</CardTitle>
          {status}
          <CardAction className="flex items-center gap-2 self-center">
            {card?.note && <span className="truncate text-xs tabular text-muted-foreground">{card.note}</span>}
          </CardAction>
        </CardHeader>
      )}
      <CardContent className={cn(bare ? 'p-0' : compact ? 'px-3.5' : 'px-5', fill && 'flex flex-1 flex-col')}>
        {card?.banner && <BannerLine b={card.banner} run={run} />}
        {card ? <div className={cn(fade, fill && 'flex flex-1 flex-col')}><CardBody card={card} run={run} large={large} columns={columns ?? (compact && card.type === 'status' ? 2 : undefined)} minimal={minimal || (compact && card.type === 'status')} /></div> : <CardSkeleton kind={kind} />}
        {card?.buttons?.length && run ? <CardButtons buttons={card.buttons} run={run} /> : null}
      </CardContent>
    </Card>
    </Dense.Provider>
  );
}


/** A bar for each thing a tile counts: it shows at a glance what a word like "Healthy" only tells you. */
function TileMarks({ marks }: { marks: NonNullable<Summary['marks']> }) {
  return (
    <div className="flex h-8 shrink-0 items-end gap-1" role="img" aria-label={marks.map(m => m.label).filter(Boolean).join(', ')}>
      {marks.slice(0, 12).map((m, i) => <span key={i} title={m.label} className="w-[7px] rounded-full" style={{ height: `${28 + (m.pct ?? .5) * 72}%`, background: m.tone && m.tone !== 'neutral' ? toneVar(m.tone) : 'var(--tint)' }} />)}
    </div>
  );
}

/** The live graph behind a summary tile: a soft filled area across the lower part of the tile, fading out on the
 *  left so the number there stays clear of it. */
function TileGraph({ points, gauge }: { points: number[]; gauge?: boolean }) {
  const fill = useId();   // each graph its own: a shared gradient takes the colour of whichever card drew it first
  const w = 200, h = 60, max = Math.max(...points), min = Math.min(...points), span = max - min || Math.max(1, max), still = max - min <= Math.abs(max) * .01;
  if (points.length < 2 || (still && !gauge)) return null;   // a count that barely moves has no story to draw; a gauge holding steady does
  const pts = points.map((p, i) => [(i / (points.length - 1)) * w, still ? h * .55 : h - 4 - ((p - min) / span) * (h - 14)] as [number, number]);
  const line = smooth(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="tile-graph pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full" aria-hidden>
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".24" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${fill})`} />
      <path d={line} fill="none" stroke="currentColor" strokeOpacity=".7" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Headline tile for the overview's top row: label and context up top, the value at the bottom. What's behind them
 *  depends on what the tile knows: artwork, a live graph, or a bar for each thing it counts. */
function SummaryTileView({ s, href }: { s: Summary; href?: string }) {
  const art = !!s.image;
  const body = (
    <Card className={cn('@container/tile relative isolate h-full min-h-[136px] gap-0 overflow-hidden py-0 shadow-card', href && 'lift', art && 'border-transparent text-white')} style={{ '--tint': 'color-mix(in oklab, var(--foreground) 55%, transparent)' } as React.CSSProperties}>
      {art && <><Art src={s.image} className={cn('absolute inset-0 -z-10 size-full object-cover transition-transform duration-(--dur-move) ease-out', href && 'group-hover/tile:scale-[1.03]')} /><div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(0_0_0/.78),rgb(0_0_0/.42)_38%,transparent_72%)]" /></>}
      {!art && !s.marks && !s.waffle && <div style={{ color: 'var(--tint)' }}><TileGraph points={s.trend ?? []} gauge={s.ring != null} /></div>}
      <div className={cn('relative flex flex-1 flex-col p-4', art && '[text-shadow:0_1px_10px_rgb(0_0_0/.7)]')}>
        <div className="flex items-center gap-2.5">
          {s.icon && isWeather(s.icon) && !art && <WeatherGlyph name={s.icon} size={38} className="-my-1 -ml-0.5" />}
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold leading-tight @[200px]/tile:text-[15px]">{s.label}</div>
            {s.sub && <div className={cn('truncate text-[13px] leading-tight', art ? 'text-white/75' : 'text-muted-foreground')}>{s.sub}</div>}
          </div>
          {s.tone === 'bad' && <span className="dot dot-bad ml-auto" />}
        </div>
        <div className={cn('mt-auto flex min-w-0 justify-between gap-3 pt-3', s.marks || s.waffle ? 'items-end' : 'items-baseline')}>
          <div className={cn('metric min-w-0 truncate text-[20px] leading-none @[200px]/tile:text-[22px]', !art && toneText[s.tone === 'good' ? 'neutral' : s.tone ?? 'neutral'])}><Counter value={s.value} /></div>
          {s.marks?.length ? <TileMarks marks={s.marks} /> : s.waffle && s.pct != null ? <Waffle pct={s.pct} label={s.sub} /> : null}
          {s.detail && <div className="hidden min-w-0 truncate text-xs tabular text-muted-foreground @[200px]/tile:block">{s.detail}</div>}
        </div>
      </div>
    </Card>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className="group/tile block h-full min-w-0">{body}</a> : <div className="group/tile h-full min-w-0">{body}</div>;
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
            strokeDasharray={`${Math.max(0.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move) ease-out"
            />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon name={s.icon} className="mb-0.5 size-4 text-muted-foreground" />
          <div className="metric max-w-[76px] truncate text-[19px] leading-tight"><Counter value={s.ring ?? s.value} /></div>
        </div>
      </div>
      <div className="mt-1 max-w-full truncate text-[13px] font-medium">{s.label}</div>
      {s.detail && <div className="max-w-full truncate text-[12px] text-muted-foreground">{s.detail}</div>}
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
    <div className={cn('invisible absolute top-full z-30 pt-3 transition-[visibility] duration-(--dur-pop)', show, className,
      'max-lg:fixed max-lg:inset-x-3 max-lg:top-auto max-lg:bottom-24 max-lg:w-auto max-lg:translate-x-0 max-lg:pt-0')}>
      <div className={cn('glass-pop -translate-y-1 scale-95 opacity-0 transition-[opacity,translate,scale] duration-(--dur-pop) ease-out max-lg:origin-bottom', group === 'ring' ? 'origin-top' : 'origin-top-right', pop)}>{children}</div>
    </div>
  );
}

/** The clock, with the month behind it on hover: your calendar's events when there is one, or just the month. */
export function ClockMonth({ card, children }: { card?: CardT; children: ReactNode }) {
  const events = card?.type === 'calendar';
  return (
    <div className="group/wx relative text-right leading-tight outline-none" tabIndex={0}>
      {children}
      <Popover group="wx" className={cn('right-[-14px]', events ? 'w-[680px]' : 'w-[340px]')}><div className={cn('text-left', !events && 'cal-month-only')}><CalendarView card={events ? card : { type: 'calendar', events: [] }} large /></div></Popover>
    </div>
  );
}

/** A headline's recent history as a line to scrub, ending now. */
const trendOf = (s: Summary): ChartCard => {
  const n = s.trend!.length, to = Date.now(), unit = String(s.value).match(/^\s*-?[\d.,]+\s*([^\d\s]\S*)\s*$/)?.[1];
  return { type: 'chart', headline: String(s.value), span: [s.label, s.detail].filter(Boolean).join(' · '), unit, from: to - (n - 1) * s.every!, to, series: [{ name: s.label, points: s.trend!, tone: s.tone }] };
};

/** The menubar version: a small ring with the number inside, label beneath; details on hover. */
function MiniRingView({ s }: { s: Summary }) {
  const r = 15, c = 2 * Math.PI * r, arc = c * 0.75, pct = Math.max(0, Math.min(1, s.pct ?? 0));
  const color = s.tone === 'bad' ? 'var(--bad)' : s.tone === 'warn' ? 'var(--warn)' : s.tone === 'accent' ? 'var(--primary)' : 'var(--good)';
  const n = String(s.ring ?? s.value).replace(/%$/, '');
  return (
    <div className="group/ring relative flex flex-col items-center outline-none" tabIndex={0} aria-label={[s.label, s.value, s.detail].filter(Boolean).join(', ')}>
      <div className="relative size-[32px] transition-transform duration-(--dur-pop) ease-out group-hover/ring:scale-110 sm:size-[38px]">
        <svg viewBox="0 0 38 38" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move) ease-out" />
        </svg>
        <div className="metric absolute inset-0 grid place-items-center text-[11px]">{n.length > 4 ? <Icon name={s.icon} className="size-3.5" /> : <Counter value={n} />}</div>
      </div>
      <div className="-mt-1 hidden max-w-[56px] truncate text-[10px] font-medium text-muted-foreground sm:block">{s.label}</div>
      <Popover group="ring" className="right-1/2 w-[280px] translate-x-1/2">{s.every && (s.trend?.length ?? 0) > 7 ? <div className="p-3.5"><Chart card={trendOf(s)} /></div> : <SummaryTile s={s} />}</Popover>
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
          <circle cx={mx} cy={my} r="3.6" fill="#fff" stroke="rgb(0 0 0 / .35)" strokeWidth="1" />
        </svg>
        <div className="absolute inset-0 grid place-items-center"><Icon name={s.icon} className="size-4" /></div>
      </div>
      <div className="text-left leading-tight">
        <div className="text-sm font-semibold tabular"><Counter value={s.value} /></div>
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
          <div className="metric text-[44px] leading-none"><Counter value={`${now.temp}°`} /></div>
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

// live updates replace only the widget that changed; unchanged cards keep their object, so memo skips them
export const Widget = memo(WidgetView);
export const SummaryTile = memo(SummaryTileView);
export const MiniRing = memo(MiniRingView);
