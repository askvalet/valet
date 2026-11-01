// The cards that live in a house: weather, the family calendar and the thermostat. They draw their own frame edge to edge
// (the glass comes from WidgetView), read their own size, and stretch to fill a bento row without leaving a gap.
import { firstDay } from './format.ts';
import { Armchair, ArrowUpDown, BedDouble, ChevronLeft, ChevronRight, Droplets, Fan, Flame, House, Leaf, Minus, Moon, Plane, Plus, Power, Snowflake, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { CalendarCard, CalendarEvent, ForecastCard, ThermostatCard, ThermostatMode } from '../shared/cards.ts';
import { Counter } from './feel.tsx';
import { Cant } from './visuals/note.tsx';
import './home-cards.css';

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;

/** The element's size, known before the first paint. Zero until then, which each card treats as its everyday layout. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null), [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const see = () => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    see();
    const ro = new ResizeObserver(see); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

// ── Weather glyphs: one light from the top left, a glassy cloud with a lit rim, colour only where the weather has it.
const CLOUD = 'M20 50h26a11 11 0 0 0 2.2-21.8A15 15 0 0 0 19.4 24.6 12.8 12.8 0 0 0 20 50Z';
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

function Sun({ id, x = 32, y = 32, r = 13 }: { id: string; x?: number; y?: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r * 2.1} fill={`url(#${id}g)`} />
      <g>{RAYS.map(a => <rect key={a} x={-r * .1} y={-r * 1.62} width={r * .2} height={r * .36} rx={r * .1} fill="#ffc94d" transform={`rotate(${a})`} />)}</g>
      <circle r={r} fill={`url(#${id}s)`} />
      <path d={`M${-r * .62} ${-r * .3}A${r * .72} ${r * .72} 0 0 1 ${-r * .1} ${-r * .72}`} fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth={r * .11} strokeLinecap="round" />
    </g>
  );
}
function Crescent({ id, x = 32, y = 30, s = 1 }: { id: string; x?: number; y?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r="24" fill={`url(#${id}h)`} />
      <path d="M6-15.5A16.5 16.5 0 1 0 15.6 9.4 13.5 13.5 0 0 1 6-15.5Z" fill={`url(#${id}m)`} stroke="#fff" strokeOpacity=".5" strokeWidth=".6" />
    </g>
  );
}
function Stars({ points }: { points: [number, number, number][] }) {
  return <>{points.map(([x, y, r], i) => <path key={i} fill="#fff" d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`} />)}</>;
}
function Puff({ id, dark, transform, back }: { id: string; dark?: boolean; transform?: string; back?: boolean }) {
  return (
    <g transform={transform}>
      <path d={CLOUD} fill={`url(#${id}${back ? 'b' : dark ? 'd' : 'c'})`} stroke={back ? undefined : `url(#${id}e)`} strokeWidth=".9" />
      {!back && <path d="M16.5 31.5a8.5 8.5 0 0 1 8-6.4M31 17.5a11.5 11.5 0 0 1 11 7" fill="none" stroke="#fff" strokeOpacity={dark ? .28 : .6} strokeWidth="1.5" strokeLinecap="round" />}
    </g>
  );
}

const up = 'translate(1.5 -7.5) scale(.95)';
const SCENES: Record<string, (id: string) => ReactNode> = {
  sun: id => <Sun id={id} r={15} />,
  moon: id => <><Crescent id={id} /><Stars points={[[50, 14, 2.6], [55, 32, 1.7], [44, 46, 1.4]]} /></>,
  cloud: id => <><Puff id={id} back transform="translate(21 -3) scale(.68)" /><g><Puff id={id} transform="translate(-3 2)" /></g></>,
  'cloud-sun': id => <><Sun id={id} x={43} y={21} r={12.5} /><g><Puff id={id} transform="translate(-3.5 7.5) scale(.92)" /></g></>,
  'cloud-moon': id => <><Crescent id={id} x={43} y={20} s={.72} /><Stars points={[[23, 8, 2], [58, 40, 1.4]]} /><g><Puff id={id} transform="translate(-3.5 7.5) scale(.92)" /></g></>,
  rain: id => <><Puff id={id} back transform="translate(23 -8) scale(.6)" /><g><Puff id={id} transform={up} /></g>
    {[21, 32, 43].map(x => <path key={x} fill={`url(#${id}w)`} d={`M${x} 46.5c2.6 3.7 3.8 5.7 3.8 7.4a3.8 3.8 0 0 1-7.6 0c0-1.7 1.2-3.7 3.8-7.4Z`} />)}</>,
  snow: id => <><Puff id={id} back transform="translate(23 -8) scale(.6)" /><g><Puff id={id} transform={up} /></g>
    {[[20, 49], [32, 54], [44, 49]].map(([x, y]) => <g key={x}><g transform={`translate(${x} ${y})`} stroke="#e8f3ff" strokeWidth="1.5" strokeLinecap="round">{[0, 60, 120].map(a => <path key={a} d="M0-3.6V3.6" transform={`rotate(${a})`} />)}</g></g>)}</>,
  storm: id => <><Puff id={id} back dark transform="translate(23 -8) scale(.6)" /><g><Puff id={id} dark transform={up} /></g>
    <path d="M34.5 38 24.5 50.5h6.6L27.5 61l11.2-14.2h-6.9l3.5-8.8Z" fill={`url(#${id}y)`} stroke="#fff" strokeOpacity=".55" strokeWidth=".6" strokeLinejoin="round" /></>,
  fog: id => <><g><Puff id={id} transform="translate(0 -7) scale(.96)" /></g>
    {[[13, 40], [7, 50], [19, 34]].map(([x, w], i) => <rect key={i} x={x} y={46 + i * 6.2} width={w} height="3.2" rx="1.6" fill="#dbe6f4" fillOpacity={.85 - i * .2} />)}</>,
};

export const isWeather = (name: string) => name in SCENES;

/** A weather icon with some depth. */
export function WeatherGlyph({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, ''), scene = SCENES[name] ?? SCENES.cloud;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn('wx shrink-0 overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}c`} x1=".3" y1="0" x2=".6" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".55" stopColor="#e6edf8" stopOpacity=".94" /><stop offset="1" stopColor="#a9bcd8" stopOpacity=".82" /></linearGradient>
        <linearGradient id={`${id}b`} x1=".3" y1="0" x2=".6" y2="1"><stop offset="0" stopColor="#c6d3e6" stopOpacity=".85" /><stop offset="1" stopColor="#7d8fae" stopOpacity=".55" /></linearGradient>
        <linearGradient id={`${id}d`} x1=".3" y1="0" x2=".6" y2="1"><stop offset="0" stopColor="#a8b4ca" /><stop offset="1" stopColor="#535f7c" stopOpacity=".95" /></linearGradient>
        <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#fff" stopOpacity=".08" /></linearGradient>
        <radialGradient id={`${id}s`} cx=".38" cy=".32" r=".8"><stop offset="0" stopColor="#fff2b0" /><stop offset=".5" stopColor="#ffc93f" /><stop offset="1" stopColor="#ff9320" /></radialGradient>
        <radialGradient id={`${id}g`}><stop offset=".3" stopColor="#ffb648" stopOpacity=".42" /><stop offset="1" stopColor="#ffb648" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}h`}><stop offset=".3" stopColor="#b9b4ff" stopOpacity=".32" /><stop offset="1" stopColor="#b9b4ff" stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}m`} x1=".1" y1="0" x2=".8" y2="1"><stop offset="0" stopColor="#fffbe6" /><stop offset="1" stopColor="#c3bdf2" /></linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a9e2ff" /><stop offset="1" stopColor="#2f8fff" /></linearGradient>
        <linearGradient id={`${id}y`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff0a3" /><stop offset="1" stopColor="#ffb21f" /></linearGradient>
      </defs>
      {scene(id)}
    </svg>
  );
}

// ── Weather: the glyph beside a huge number, the words under them, what to do about today, the next days along the bottom.
const WET = /rain|storm|snow/;
const fall = (icon: string) => /snow/.test(icon) ? 'Snow' : /storm/.test(icon) ? 'Storms' : 'Rain';
/** The one thing worth acting on today: when the rain comes, or a temperature out of the ordinary. Nothing on a dull day. */
export function headsUp({ now, hours: all, days }: ForecastCard): string | undefined {
  const hours = all.slice(0, 12), wet = (h: ForecastCard['hours'][number]) => h.pop >= 50 || WET.test(h.icon) && h.pop >= 30;
  if ((now.precip ?? 0) > 0 || WET.test(now.icon)) {
    const dry = hours.findIndex(h => !wet(h));
    return dry >= 0 ? `${fall(now.icon)} easing around ${hours[dry].time}` : hours.length ? `${fall(now.icon)} until at least ${hours[hours.length - 1].time}` : undefined;
  }
  const from = hours.findIndex(wet);
  if (from >= 0) { const to = hours.findIndex((h, i) => i > from && !wet(h)); return `${fall(hours[from].icon)} likely from ${hours[from].time}${to > 0 ? ` to ${hours[to].time}` : ''}`; }
  const ahead = days?.slice(0, 3) ?? [], gap = ahead.length ? Math.round(now.hi - ahead.reduce((n, d) => n + d.hi, 0) / ahead.length) : 0;
  if (Math.abs(gap) >= 6) return `Today's high of ${now.hi}° is ${Math.abs(gap)}° ${gap > 0 ? 'warmer' : 'cooler'} than the next few days`;
  if (Math.abs(now.feels - now.temp) >= 5) return `Feels like ${now.feels}° right now`;
}
const HeadsUp = ({ card, className }: { card: ForecastCard; className?: string }) => { const line = headsUp(card); return line ? <p className={cn('text-center text-[14px] leading-[1.35] font-medium', className)}>{line}</p> : null; };
const skyOf = (icon: string) => /moon/.test(icon) ? 'night' : icon === 'sun' ? 'clear' : /rain|storm/.test(icon) ? 'wet' : 'grey';
const Caps = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('text-[11px] font-medium tracking-[.09em] uppercase', className)}>{children}</div>;

function Hero({ card, s }: { card: ForecastCard; s: number }) {
  const { now } = card;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center justify-center" style={{ gap: 14 * s }}>
        <WeatherGlyph name={now.icon} size={112 * s} />
        <div className="wx-temp tabular" style={{ fontSize: 82 * s }}>{now.temp}°</div>
      </div>
      <div className="mt-1 font-semibold tracking-tight" style={{ fontSize: 21 * s }}>{now.words}.</div>
      <Caps className="mt-1.5 text-muted-foreground">High {now.hi}° <span className="ml-1.5">Low {now.lo}°</span></Caps>
    </div>
  );
}
/** The next days, or the next hours spaced out for a service that only knows those. */
function Outlook({ card, n, size = 34 }: { card: ForecastCard; n: number; size?: number }) {
  const hours = card.hours.filter((_, i) => i % 3 === 0);
  const cols = card.days?.length ? card.days.slice(0, n).map(d => ({ k: d.name, icon: d.icon, a: d.hi, b: d.lo as number | undefined })) : hours.slice(0, n).map(h => ({ k: h.time, icon: h.icon, a: h.temp, b: undefined }));
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map(c => (
        <div key={c.k} className="flex flex-col items-center">
          <div className="text-[13px] font-semibold">{c.k}</div>
          <WeatherGlyph name={c.icon} size={size} className="my-1" />
          <div className="tabular text-[14px] font-semibold">{c.a}°</div>
          {c.b != null && <div className="tabular text-[13px] text-muted-foreground">{c.b}°</div>}
        </div>
      ))}
    </div>
  );
}
function HourStrip({ card, n }: { card: ForecastCard; n: number }) {
  const hours = card.hours.slice(0, n);
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
      {hours.map((h, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div className="text-[12px] text-muted-foreground">{h.time}</div>
          <WeatherGlyph name={h.icon} size={24} />
          <div className="tabular text-[13px] font-semibold">{h.temp}°</div>
        </div>
      ))}
    </div>
  );
}
/** Days as rows, each with its range on a shared scale, for when there's room to compare them. */
function DayBars({ card }: { card: ForecastCard }) {
  const days = card.days ?? [], lo = Math.min(...days.map(d => d.lo)), hi = Math.max(...days.map(d => d.hi)), span = Math.max(1, hi - lo);
  return (
    <div className="space-y-1.5">
      {days.map(d => (
        <div key={d.name} className="grid grid-cols-[38px_28px_30px_minmax(0,1fr)_30px] items-center gap-2 text-[14px]">
          <div className="font-semibold">{d.name}</div>
          <WeatherGlyph name={d.icon} size={26} />
          <div className="tabular text-right text-muted-foreground">{d.lo}°</div>
          <div className="relative h-[5px] rounded-full bg-foreground/10"><div className="wx-range absolute inset-y-0 rounded-full" style={{ left: `${(d.lo - lo) / span * 100}%`, right: `${(hi - d.hi) / span * 100}%` }} /></div>
          <div className="tabular text-right font-semibold">{d.hi}°</div>
        </div>
      ))}
    </div>
  );
}

export function WeatherCard({ card, dense }: { card: ForecastCard; dense?: boolean }) {
  const [ref, { w, h }] = useBox<HTMLDivElement>();
  const wide = w >= 600 && !!card.days?.length, tall = !wide && h >= 540, s = dense ? .62 : w && w < 310 ? .78 : tall ? 1.14 : 1;
  return (
    <div ref={ref} className={cn('wx-card relative isolate flex h-full min-w-0 flex-1', wide ? 'items-center gap-7 px-7 py-6' : 'flex-col', !wide && (dense ? 'gap-3 p-1' : 'gap-5 px-5 pt-6 pb-5'))} data-sky={skyOf(card.now.icon)}>
      {wide ? <>
        <div className="w-[40%] shrink-0"><Hero card={card} s={w >= 720 ? 1 : .86} /></div>
        <div className="min-w-0 flex-1 space-y-4"><HeadsUp card={card} className="text-left" /><HourStrip card={card} n={w >= 720 ? 7 : 6} /><DayBars card={card} /></div>
      </> : <>
        <div className="flex flex-1 flex-col justify-center"><Hero card={card} s={s} /></div>
        <HeadsUp card={card} className={dense ? 'text-[13px]' : undefined} />
        {tall && <HourStrip card={card} n={w >= 380 ? 6 : 5} />}
        {tall && card.days?.length ? <DayBars card={card} /> : <Outlook card={card} n={4} size={dense ? 26 : 34} />}
      </>}
    </div>
  );
}

// ── Calendar: what's on, day by day, beside a month you can wander through. Everything after the data arrives is local.
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dated = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const parse = (s: string) => { if (!dated(s)) return new Date(s); const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const longDay = (d: Date) => `${d.toLocaleDateString('en', { weekday: 'long' })} ${nth(d.getDate())} ${d.toLocaleDateString('en', { month: 'long' })}`;
const clock = (d: Date) => d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });

// the calendar's own colour if it has one, or one of these, picked by name so a calendar keeps its colour
const CAL = ['#5ac8fa', '#ff9f6b', '#bf8bff', '#5ee0a0', '#ff7eb3', '#ffd25f', '#7d9bff', '#4fd8d0'];
const colorOf = (e: CalendarEvent) => e.color ?? CAL[[...(e.calendar ?? e.title)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % CAL.length];
export const span = (e: CalendarEvent) => {
  const a = parse(e.start), b = e.end ? parse(e.end) : a;
  if (dated(e.start)) return b > a ? `All day${+b - +a > 864e5 ? ` · until ${shift(b, -1).toLocaleDateString('en', { month: 'short', day: 'numeric' })}` : ''}` : 'All day';
  if (+b <= +a) return clock(a);
  const [x, y] = [clock(a), clock(b)];
  return keyOf(a) !== keyOf(b) ? `${x} – ${b.toLocaleDateString('en', { weekday: 'short' })} ${y}` : `${x.slice(-2) === y.slice(-2) ? x.slice(0, -3) : x} – ${y}`;
};

/** Events by the day they touch: a trip of four days shows on all four. */
export function byDay(events: CalendarEvent[]) {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const a = parse(e.start), b = e.end ? parse(e.end) : a;
    const last = dated(e.start) ? shift(b > a ? b : shift(a, 1), -1) : new Date(Math.max(+a, +b - 1));
    for (let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), i = 0; d <= last && i < 62; d = shift(d, 1), i++) { const k = keyOf(d); days.set(k, [...(days.get(k) ?? []), e]); }
  }
  return days;
}

/** Today by what still matters: what's on or next, then the all-day things, with what's over apart. */
export function splitToday(list: CalendarEvent[], at = Date.now()) {
  const over = (e: CalendarEvent) => !dated(e.start) && +parse(e.end && !dated(e.end) ? e.end : e.start) <= at;
  const timed = list.filter(e => !dated(e.start) && !over(e)).sort((a, b) => +parse(a.start) - +parse(b.start));
  return { ahead: [...timed, ...list.filter(e => dated(e.start))], earlier: list.filter(over) };
}
/** How soon, for the next thing on today. */
const soon = (e: CalendarEvent, at = Date.now()) => {
  if (dated(e.start)) return '';
  const mins = Math.round((+parse(e.start) - at) / 6e4);
  return mins <= 0 ? ' · Now' : mins < 60 ? ` · in ${mins} min` : mins < 360 ? ` · in ${Math.round(mins / 60)} h` : '';
};

function Agenda({ days, from, today, cap, empty }: { days: Map<string, CalendarEvent[]>; from: Date; today: Date; cap: number; empty: string }) {
  const groups: { day: Date; list: CalendarEvent[]; earlier: CalendarEvent[] }[] = [];
  const [open, setOpen] = useState(false), now = Date.now(), todayKey = keyOf(today);
  let left = cap;
  const keys = [...days.keys()].filter(k => k >= keyOf(from)).sort();
  for (const k of keys) {
    if (left <= 0) break;
    const { ahead, earlier } = k === todayKey ? splitToday(days.get(k)!, now) : { ahead: days.get(k)!, earlier: [] }, list = ahead.slice(0, left);
    groups.push({ day: parse(k), list, earlier }); left -= list.length;
  }
  const tag = (d: Date) => {
    const n = Math.round((+d - +today) / 864e5);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 && n < 7 ? d.toLocaleDateString('en', { weekday: 'long' }) : d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const row = (e: CalendarEvent, i: number, lead?: boolean) => (
    <li key={i} className={cn('flex min-w-0 items-stretch gap-2.5', e.end && !dated(e.end) && +parse(e.end) < now && 'opacity-50')}>
      <span className="w-[3.5px] shrink-0 rounded-full" style={{ background: colorOf(e) }} />
      <div className="min-w-0 py-px"><div className="truncate text-[14px] leading-[1.3] font-semibold">{e.title}</div><div className="truncate text-[13px] leading-[1.35] text-muted-foreground tabular">{span(e)}{lead && soon(e, now)}</div></div>
    </li>
  );
  if (!groups.length) return <p className="pt-3 text-[14px] text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-4">
      {groups.map(g => {
        const isToday = keyOf(g.day) === todayKey;
        return (
          <section key={keyOf(g.day)}>
            <Caps className="mb-2 text-muted-foreground">{tag(g.day)}</Caps>
            {g.list.length > 0 ? <ul className="space-y-2.5">{g.list.map((e, i) => row(e, i, isToday && i === 0))}</ul> : <p className="text-[13px] leading-[1.35] text-muted-foreground">Nothing else today</p>}
            {g.earlier.length > 0 && <>
              <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="press mt-1.5 flex h-8 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn('size-4 flex-none transition-transform', open && 'rotate-90')} />{g.earlier.length} earlier today</button>
              {open && <ul className="mt-1 space-y-2.5 opacity-70">{g.earlier.map((e, i) => row(e, i))}</ul>}
            </>}
          </section>
        );
      })}
    </div>
  );
}

function Month({ year, month, days, today, picked, pick }: { year: number; month: number; days: Map<string, CalendarEvent[]>; today: Date; picked: string; pick: (d: Date) => void }) {
  const first = new Date(year, month, 1), lead = (first.getDay() + 7 - firstDay()) % 7;   // six rows always, so the card never moves
  const cells = Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i)), now = keyOf(today);
  return (
    <div role="grid" aria-label={first.toLocaleDateString('en', { month: 'long', year: 'numeric' })} className="grid min-h-[216px] flex-1 grid-cols-7 grid-rows-6">
      {cells.map(d => {
        const k = keyOf(d), list = days.get(k) ?? [], out = d.getMonth() !== month, isToday = k === now, chosen = k === picked;
        return (
          <button key={k} onClick={() => pick(d)} aria-pressed={chosen} aria-current={isToday ? 'date' : undefined} aria-label={`${d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length ? `${list.length} event${list.length > 1 ? 's' : ''}` : 'nothing on'}`}
            className="cal-day press relative grid min-h-0 place-items-center" data-out={out || undefined}>
            <span className={cn('cal-num tabular grid size-[28px] place-items-center rounded-full text-[13px]', isToday ? 'bg-primary font-semibold text-primary-foreground' : chosen && 'is-picked font-semibold')}>{d.getDate()}</span>
            {!isToday && list.length > 0 && <span className="absolute bottom-[1px] flex gap-[2px]">{[...new Set(list.map(colorOf))].slice(0, 3).map(c => <i key={c} className="size-[3.5px] rounded-full" style={{ background: c }} />)}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarView({ card, large, dense }: { card: CalendarCard; large?: boolean; dense?: boolean }) {
  const [ref, { w, h }] = useBox<HTMLDivElement>();
  const [today, setToday] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); });
  useEffect(() => { const t = setInterval(() => setToday(was => { const d = new Date(), k = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return +k === +was ? was : k; }), 60_000); return () => clearInterval(t); }, []);
  const [picked, setPicked] = useState<Date | null>(null), [view, setView] = useState<{ y: number; m: number; dir?: number } | null>(null);
  const days = useMemo(() => byDay(card.events), [card.events]);
  const day = picked ?? today, y = view?.y ?? today.getFullYear(), m = view?.m ?? today.getMonth(), key = keyOf(day);
  const two = w ? w >= 540 : !!large, month = !dense && (two || large || h >= 620);
  const low = card.from ? parse(card.from) : null, high = card.to ? parse(card.to) : null;
  const go = (n: number) => { const d = new Date(y, m + n, 1); setView({ y: d.getFullYear(), m: d.getMonth(), dir: n }); };
  const pick = (d: Date) => { const same = keyOf(d) === keyOf(today); setPicked(same ? null : d); if (d.getMonth() !== m || d.getFullYear() !== y) setView({ y: d.getFullYear(), m: d.getMonth(), dir: +d > +new Date(y, m, 1) ? 1 : -1 }); };
  const home = () => { setPicked(null); setView(null); };
  const chosen = days.get(key) ?? [], away = !!picked || y !== today.getFullYear() || m !== today.getMonth();
  const list = <Agenda days={days} from={day} today={today} cap={two ? 14 : dense ? 4 : 6} empty={picked ? 'Nothing on from here' : card.empty ?? 'Nothing coming up'} />;
  return (
    <div ref={ref} className={cn('cal relative flex h-full min-w-0 flex-1', two ? 'gap-7' : 'flex-col gap-5', !dense && 'p-5')}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className={cn('truncate font-semibold tracking-tight', dense ? 'text-[15px]' : 'text-[20px]')}>{longDay(day)}</h3>
          {away && !dense && <button onClick={home} className="press shrink-0 text-[13px] font-medium text-primary">Today</button>}
        </div>
        {/* side by side the month sets the height, and the agenda scrolls in whatever's left: it can't stretch the row */}
        {two ? <div className="cal-scroll relative min-h-0 flex-1"><div className="absolute inset-0 overflow-y-auto pb-3">{list}</div></div> : list}
      </div>
      {month && (
        <div className={cn('flex min-w-0 flex-col', two && 'w-[47%] shrink-0')}>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[14px] font-semibold tracking-tight">{new Date(y, m, 1).toLocaleDateString('en', { month: 'long', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) })}</div>
            <div className="-mr-1.5 flex">
              <button aria-label="Previous month" disabled={!!low && new Date(y, m, 1) <= low} onClick={() => go(-1)} className="press grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-[17px]" /></button>
              <button aria-label="Next month" disabled={!!high && new Date(y, m + 1, 1) > high} onClick={() => go(1)} className="press grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"><ChevronRight className="size-[17px]" /></button>
            </div>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>{Array.from({ length: 7 }, (_, i) => 'SMTWTFS'[(firstDay() + i) % 7]).map((l, i) => <div key={i}>{l}</div>)}</div>
          <div key={`${y}-${m}`} className={cn('flex min-h-0 flex-1 flex-col', view?.dir && 'cal-page')} style={{ '--from': `${(view?.dir ?? 0) * 10}px` } as CSSProperties}><Month year={y} month={m} days={days} today={today} picked={key} pick={pick} /></div>
          {/* two quiet lines for the chosen day; always this tall, so choosing a day doesn't move anything */}
          <ul className="mt-2 h-[38px] space-y-0.5 overflow-hidden text-[12px] leading-[18px]">
            {chosen.slice(0, 2).map((e, i) => <li key={i} className="flex min-w-0 items-center gap-1.5"><i className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf(e) }} /><span className="truncate font-medium">{e.title}</span><span className="ml-auto shrink-0 tabular text-muted-foreground">{i === 1 && chosen.length > 2 ? `+${chosen.length - 2} more` : dated(e.start) ? 'All day' : clock(parse(e.start))}</span></li>)}
            {!chosen.length && <li className="text-muted-foreground">Nothing on</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Thermostat: a dial you can take hold of. It answers at once and lets the house catch up.
const ARC = 270, START = 135, C = 160, R = 136;
const at = (pct: number, r = R) => { const a = (START + ARC * pct) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)] as const; };
const TRACK = (() => { const [x0, y0] = at(0), [x1, y1] = at(1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; })();
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** Rests of the mode row: the moon and the zzz are the ones a person looks for at bedtime. */
const Zzz = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12.5h6.5L4 20h6.5" /><path d="M13.5 4H20l-6.5 7.5H20" strokeWidth="1.7" />
  </svg>
);
const MODE_ICONS: Record<string, LucideIcon | typeof Zzz> = { off: Power, heat: Flame, cool: Snowflake, heat_cool: ArrowUpDown, auto: Sparkles, dry: Droplets, fan_only: Fan, home: House, sleep: Zzz, night: Moon, away: Plane, eco: Leaf, boost: Zap, comfort: Armchair, activity: BedDouble };

// what a preset means, unless the device has said; only the pair people mix up needs saying
const HINTS: Record<string, string> = { sleep: 'A little cooler, for going to bed', night: 'The lowest setting, right through to morning' };

function ModeButton({ m, on, press, disabled }: { m: ThermostatMode; on: boolean; press: () => void; disabled: boolean }) {
  const I = MODE_ICONS[m.id];
  return <button onClick={press} disabled={disabled} aria-pressed={on} title={m.label} className={cn('th-mode press flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1', on && 'is-on')}>{I && <I className="size-[18px] flex-none" />}<span className="max-w-full truncate text-[11px] leading-[1.3] font-medium">{m.label}</span></button>;
}

export function Thermostat({ card, run, dense }: { card: ThermostatCard; run?: Run; dense?: boolean }) {
  const { min, max, step, unit } = card, grad = useId().replace(/[^a-zA-Z0-9]/g, ''), canSet = !!run && !!card.set && card.target != null;
  const [draft, setDraft] = useState<number | null>(null), [live, setLive] = useState<number | null>(null), [flip, setFlip] = useState<string | null>(null), [oops, setOops] = useState(false);
  const value = draft ?? card.target, drag = useRef<{ off: number; last: number } | null>(null), box = useRef<HTMLDivElement>(null), hit = useRef<SVGPathElement>(null);
  const latest = useRef(value), timer = useRef<ReturnType<typeof setTimeout>>(undefined), expiry = useRef<ReturnType<typeof setTimeout>>(undefined);
  latest.current = value;
  const pctOf = (v: number) => clamp((v - min) / (max - min), 0, 1);
  const snap = (pct: number) => { const v = Math.round((min + clamp(pct, 0, 1) * (max - min)) / step) * step; return clamp(Number(v.toFixed(4)), min, max); };
  // the house has caught up, or it's taken too long and what it says is the truth again
  useEffect(() => { if (draft != null && draft === card.target && !drag.current) setDraft(null); }, [card.target, draft]);
  useEffect(() => setFlip(null), [JSON.stringify(card.modes?.map(m => m.on))]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(expiry.current); }, []);
  const fail = () => { setDraft(null); setFlip(null); setOops(true); setTimeout(() => setOops(false), 3000); };
  const hold = () => { clearTimeout(expiry.current); expiry.current = setTimeout(() => { if (!drag.current) { setDraft(null); setFlip(null); } }, 8000); };
  const send = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (latest.current != null) run?.(card.set!.action, { ...card.set!.args, temperature: latest.current }).catch(fail); }, delay);
    hold();
  };
  const nudge = (dir: number) => { const v = clamp(Number(((latest.current ?? min) + dir * step).toFixed(4)), min, max); setDraft(v); latest.current = v; send(350); };

  const rawPct = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect(), a = ((Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180 / Math.PI - START) % 360 + 360) % 360;
    return a > ARC ? (a > (ARC + 360) / 2 ? 0 : 1) : a / ARC;   // in the gap: whichever end is nearer
  };
  const down = (e: PointerEvent) => {
    if (!canSet) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = rawPct(e), cur = pctOf(latest.current ?? min), off = Math.abs(p - cur) < .08 ? cur - p : 0;   // take hold of the handle where you touched it
    drag.current = { off, last: p + off }; setLive(clamp(p + off, 0, 1)); clearTimeout(timer.current); clearTimeout(expiry.current);
    const v = snap(p + off); if (v !== latest.current) { setDraft(v); latest.current = v; }
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = clamp(rawPct(e) + d.off, 0, 1);
    if (Math.abs(p - d.last) > .4) return;   // a jump across the gap isn't a gesture: it stops at the end instead
    d.last = p; setLive(p);
    const v = snap(p);
    if (v !== latest.current) { setDraft(v); latest.current = v; navigator.vibrate?.(4); }
  };
  // touch-action doesn't reach inside an SVG in Chrome, so the ring claims its own touches: a swipe anywhere else still scrolls
  useEffect(() => { const el = hit.current, stop = (e: Event) => e.preventDefault(); el?.addEventListener('touchstart', stop, { passive: false }); return () => el?.removeEventListener('touchstart', stop); }, [canSet]);
  const up = () => { if (!drag.current) return; drag.current = null; setLive(null); send(0); };
  const key = (e: KeyboardEvent) => { const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (d && canSet) { e.preventDefault(); nudge(d); } };

  const dp = step < 1 ? 1 : 0, big = value ?? card.current, room = card.current;
  const pct = live ?? (value != null ? pctOf(value) : 0), seg = card.range ? [pctOf(card.range[0]), pctOf(card.range[1])] : null;
  const ticks = useMemo(() => Array.from({ length: 49 }, (_, i) => { const [a, b] = [at(i / 48, R - 22), at(i / 48, R - (i % 4 ? 26 : 29))]; return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }).join(''), []);
  const [mx, my] = room != null ? at(pctOf(room)) : [0, 0], rise = value != null && room != null && card.mode !== 'off';
  const hints = (card.modes ?? []).filter(m => (m.hint ?? HINTS[m.id]) && (!dense || m.on));
  const pressMode = (m: ThermostatMode) => { setFlip(m.id); hold(); run?.(m.action, m.args).catch(fail); };
  return (
    <div className={cn('th flex h-full min-w-0 flex-1 flex-col items-center', dense ? 'gap-2' : 'gap-3 p-4')} data-mode={card.mode ?? 'heat'}>
      <div className="flex w-full min-h-0 flex-1 items-center justify-center">
        <div ref={box} className={cn('relative aspect-square w-full', live != null && 'is-drag', dense ? 'max-w-[220px]' : 'max-w-[320px]')}>
          <svg viewBox="0 0 320 320" className="absolute inset-0 size-full overflow-visible" aria-hidden={!canSet}>
            <defs><linearGradient id={grad} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--th-a)" /><stop offset="1" stopColor="var(--th-b)" /></linearGradient></defs>
            <path d={ticks} className="th-ticks" fill="none" strokeWidth="2" strokeLinecap="round" />
            <path d={TRACK} className="th-track" fill="none" strokeWidth="20" strokeLinecap="round" />
            {seg ? <path d={TRACK} pathLength={100} fill="none" stroke={`url(#${grad})`} strokeWidth="20" strokeLinecap="round" strokeDasharray={`${(seg[1] - seg[0]) * 100} 200`} strokeDashoffset={-seg[0] * 100} />
              : value != null && <path d={TRACK} pathLength={100} className="th-fill" fill="none" stroke={`url(#${grad})`} strokeWidth="20" strokeLinecap="round" strokeDasharray={`${pct * 100} 200`} />}
            {room != null && <circle cx={mx} cy={my} r="4.5" className={cn('th-room', rise && 'on-fill')} />}
            {value != null && <g className="th-handle" style={{ transform: `rotate(${START + ARC * pct}deg)` }}>
              <circle cx={C + R} cy={C} r="19" className="th-knob" /><circle cx={C + R} cy={C} r="6.5" className="th-pip" />
            </g>}
            {canSet && <path ref={hit} d={TRACK} role="slider" tabIndex={0} aria-label={`${card.title ?? 'Thermostat'} target`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} degrees`}
              className="th-hit" fill="none" strokeWidth="58" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} />}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-[8%] text-center">
            <div className={cn('font-medium', dense ? 'text-[12px]' : 'text-[14px]', oops ? 'text-bad' : 'text-muted-foreground')}>{oops ? "Couldn't set it" : card.state}</div>
            <div className={cn('mt-1 leading-[1.3] text-muted-foreground', dense ? 'text-[11px]' : 'text-[13px]')}>{value != null ? 'Set to' : 'Room'}</div>
            <div className={cn('wx-temp', dense ? 'text-[36px]' : 'text-[58px]')}>{big != null ? <Counter value={big.toFixed(value != null ? dp : 1)} /> : '–'}<span className={cn('ml-1 font-medium tracking-normal text-foreground/75', dense ? 'text-[15px]' : 'text-[22px]')}>°{unit}</span></div>
            {value != null && room != null ? <div className={cn('mt-1 text-muted-foreground tabular', dense ? 'text-[12px]' : 'text-[14px]')}>Room {room.toFixed(Number.isInteger(room) ? 0 : 1)} °{unit}</div>
              : card.range ? <div className="mt-1 text-[14px] text-muted-foreground tabular">Set to {card.range[0]}–{card.range[1]} °{unit}</div> : null}
          </div>
          {canSet && (
            <div className="absolute bottom-[2.5%] left-1/2 flex -translate-x-1/2 gap-3">
              <button aria-label="Cooler" disabled={(value ?? min) <= min} onClick={() => nudge(-1)} className="th-step press grid size-[46px] place-items-center rounded-full"><Minus className="size-5" /></button>
              <button aria-label="Warmer" disabled={(value ?? max) >= max} onClick={() => nudge(1)} className="th-step press grid size-[46px] place-items-center rounded-full"><Plus className="size-5" /></button>
            </div>
          )}
        </div>
      </div>
      {!!card.modes?.length && <div className="flex w-full gap-1.5">{card.modes.map(m => <ModeButton key={m.id} m={m} on={flip === m.id ? !m.on : !!m.on} disabled={!run} press={() => pressMode(m)} />)}</div>}
      {card.note && <p className="w-full text-center text-[13px] leading-[1.35] text-muted-foreground">{card.note}</p>}
      {hints.length > 0 && <ul className="w-full space-y-0.5 text-[13px] leading-[1.35] text-muted-foreground">{hints.map(m => <li key={m.id}><b className={cn('font-medium', m.on ? 'text-foreground' : 'text-foreground/80')}>{m.label}</b> {m.hint ?? HINTS[m.id]}</li>)}</ul>}
      {!run ? <Cant className="w-full justify-center">View only: sign in to change this.</Cant> : !card.set && card.range ? <Cant className="w-full justify-center">Its range can't be set from here.</Cant> : null}
    </div>
  );
}
