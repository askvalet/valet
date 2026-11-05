// The charts that aren't a line or a column: a race, a stream, a year of days, a hundred squares. Plain SVG and CSS, in
// Valet's own design. Each draws from one card's numbers and has no opinion about where it sits. A chart with nothing to
// show says so through `chartless`, and the page leaves its slot out.
import './charts.css';
import { Pause, Play } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { day as dayOf, duration, firstDay, month, num as written, withUnit } from './format.ts';
import type { Card, ChartCard, HeatmapCard, Race as RaceData, RaceItem } from '../shared/cards.ts';
import { Metric } from './metric.tsx';
import { HeadActions } from './feel.tsx';

/** True when a chart has nothing in it, so the card shouldn't take a slot on the page. */
export const chartless = (card?: Card) => card?.type === 'race' ? card.steps.length < 2 || !card.items.length
  : card?.type === 'heatmap' ? !card.days.some(n => n > 0)
  : card?.type === 'chart' && card.style === 'stream' ? !card.series.some(s => s.points.some(n => n > 0)) : false;

/** A smooth path through points (Catmull-Rom → cubic Bézier), for graphs that read as calm curves, not zig-zags. */
export function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[i + 2] ?? pts[i + 1];
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)},${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)},${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

const calm = () => typeof document === 'undefined' ? false : matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-(reduced|none)/.test(document.documentElement.className);

const ROWS = 6, PLAY = 7000, SLIDE = 130;   // rows shown; how long a whole year takes; how quickly a row closes on its new place, ms
/** Where things stand part-way through (`t` runs 0 to the last step): each title's total, and its place among those on the board. */
export function standing(items: RaceItem[], t: number) {
  const i = Math.floor(t), k = t - i, value = items.map(it => { const a = it.points[i] ?? 0; return a + ((it.points[i + 1] ?? a) - a) * k; });
  const order = items.map((_, n) => n).filter(n => value[n] > 0).sort((a, b) => value[b] - value[a] || a - b), place = items.map(() => ROWS);
  order.slice(0, ROWS).forEach((n, r) => { place[n] = r; });
  return { value, place, top: value[order[0]] ?? 0 };
}
const amount = (v: number, unit?: string) => unit === 'h' ? (v * 36e5 < 3e4 ? '0h' : duration(v * 36e5)) : withUnit(written(Math.round(v)), unit);
const shown = new Set<string>();   // each race runs once a visit: a tab you come back to is at rest

export type Tint = { h: number; c: number } | null;
const tints = new Map<string, Tint>();
/** sRGB (0-255) to OKLab, so a hue is a hue whatever its lightness. */
function oklab(r: number, g: number, b: number) {
  const lin = (v: number) => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(.4122214708 * R + .5363325363 * G + .0514459929 * B), m = Math.cbrt(.2119034982 * R + .6806995451 * G + .1073969566 * B), s = Math.cbrt(.0883024619 * R + .2817188376 * G + .6299787005 * B);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
/** A poster's own colour, for its bar: the hue its colourful pixels share most, and how colourful that is. Read once from a
 *  tiny copy of the picture already on the page. A picture from another site, or one without much colour, keeps the page's. */
export function tintOf(img: HTMLImageElement): Tint {
  const src = img.currentSrc || img.src;
  if (tints.has(src)) return tints.get(src)!;
  let out: Tint = null;
  try {
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true })!;
    c.width = 12; c.height = 18; g.drawImage(img, 0, 0, 12, 18);
    const px = g.getImageData(0, 0, 12, 18).data, bins = Array.from({ length: 24 }, () => ({ w: 0, a: 0, b: 0, c: 0, n: 0 }));
    for (let i = 0; i < px.length; i += 4) {
      const [L, a, b] = oklab(px[i], px[i + 1], px[i + 2]), ch = Math.hypot(a, b), w = ch * ch;
      if (ch < .04 || L < .2 || L > .96) continue;
      const k = bins[Math.floor((Math.atan2(b, a) / Math.PI + 1) * 12) % 24];
      k.w += w; k.a += a * w; k.b += b * w; k.c += ch * w; k.n++;
    }
    const near = (i: number) => [bins[(i + 23) % 24], bins[i], bins[(i + 1) % 24]];
    const best = bins.map((_, i) => near(i).reduce((s, k) => s + k.w, 0)).reduce((top, w, i, all) => w > all[top] ? i : top, 0), ks = near(best);
    const sum = (f: (k: typeof bins[0]) => number) => ks.reduce((s, k) => s + f(k), 0);
    if (sum(k => k.n) >= 14) out = { h: Math.round((Math.atan2(sum(k => k.b), sum(k => k.a)) * 180 / Math.PI + 360) % 360), c: sum(k => k.c) / sum(k => k.w) };
  } catch { /* another site's picture: the page's colours */ }
  tints.set(src, out);
  return out;
}
export const hue = (t: Tint) => t ? { '--hue': t.h, '--sat': Math.min(1, Math.max(.5, t.c / .12)).toFixed(2) } as CSSProperties : undefined;

/** Titles overtaking each other. Everything that moves is written straight to the DOM from one rAF loop, which stops when the
 *  rows settle; the render itself is the final frame, so that's what shows with no script, no motion or no scroll. */
export function Race({ race, span, now, inCard }: { race: RaceData; span?: string; now?: boolean; inCard?: boolean }) {
  const { steps, items, unit } = race, end = steps.length - 1, key = `${steps.join()}|${items.map(i => `${i.title}${i.points[end]}`).join()}`, peak = useMemo(() => Math.max(...items.map(i => i.points[end] ?? 0), 1), [items, end]);
  const box = useRef<HTMLDivElement>(null), rows = useRef<(HTMLDivElement | null)[]>([]), date = useRef<HTMLSpanElement>(null), scrub = useRef<HTMLInputElement>(null);
  const live = useRef({ t: end, y: items.map(() => 0), o: items.map(() => 0), going: false, raf: 0, last: 0 }), [playing, setPlaying] = useState(false), [still, setStill] = useState(false);
  const [tint, setTint] = useState<Record<string, Tint>>({});
  const bar = (v: number, top: number) => Math.max(v > 0 ? .012 : 0, v / Math.max(top, peak * .3));   // the leader fills the lane, but early on the bars have room to grow
  const when = (t: number) => steps[Math.ceil(t - 1e-6)];

  // the name sits inside its bar; where the bar is shorter than the name, the amount waits past the name's end
  const fit = useRef<number[]>([]);
  useEffect(() => { const reset = () => { fit.current = []; }; addEventListener('resize', reset); return () => removeEventListener('resize', reset); }, []);
  const draw = (ms: number) => {
    const s = live.current, { value, place, top } = standing(items, s.t), ease = 1 - Math.exp(-ms / SLIDE), tall = rows.current[0]?.offsetHeight ?? 0;
    if (!fit.current.length) fit.current = rows.current.map(row => { const line = row?.querySelector<HTMLElement>('.race-line'), name = row?.querySelector<HTMLElement>('.race-name'); return line?.offsetWidth ? ((name?.offsetWidth ?? 0) + 20) / line.offsetWidth : 0; });
    let moving = false;
    rows.current.forEach((row, n) => {
      if (!row) return;
      const y = place[n] * tall, o = place[n] < ROWS ? 1 : 0, p = bar(value[n], top);
      s.y[n] += (y - s.y[n]) * ease; s.o[n] += (o - s.o[n]) * ease;
      if (Math.abs(y - s.y[n]) > .3 || Math.abs(o - s.o[n]) > .01) moving = true; else { s.y[n] = y; s.o[n] = o; }
      row.style.transform = `translateY(${s.y[n].toFixed(2)}px)`; row.style.opacity = s.o[n].toFixed(3);
      (row.querySelector('.race-bar') as HTMLElement).style.transform = `translateX(${((p - 1) * 100).toFixed(2)}%)`;
      (row.querySelector('.race-end') as HTMLElement).style.transform = `translateX(${(Math.max(p, fit.current[n] ?? 0) * 100).toFixed(2)}%)`;
      const text = amount(value[n], unit), label = row.querySelector('.race-end span')!;
      if (label.textContent !== text) label.textContent = text;
      row.classList.toggle('is-lead', place[n] === 0);
    });
    if (date.current && date.current.textContent !== when(s.t)) date.current.textContent = when(s.t);
    if (scrub.current) {
      scrub.current.value = String(s.t); scrub.current.style.setProperty('--at', (s.t / end).toFixed(4));
      if (scrub.current.getAttribute('aria-valuetext') !== when(s.t)) scrub.current.setAttribute('aria-valuetext', when(s.t));
    }
    return moving;
  };
  const run = () => {
    const s = live.current;
    cancelAnimationFrame(s.raf); s.last = 0;
    const frame = (at: number) => {
      const ms = s.last ? Math.min(50, at - s.last) : 16; s.last = at;
      if (s.going) { s.t = Math.min(end, s.t + ms * end / PLAY); if (s.t >= end) { s.going = false; setPlaying(false); } }
      if (draw(ms) || s.going) s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  };
  const start = () => { const s = live.current; if (s.t >= end) { s.t = 0; } s.going = true; setPlaying(true); run(); };
  const stop = () => { live.current.going = false; setPlaying(false); };
  const seek = (t: number) => { const s = live.current; stop(); s.t = Math.min(end, Math.max(0, t)); run(); };
  // the arrows step a month (or whatever a step is), not a hundredth of one
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const t = live.current.t, to = ({ ArrowRight: Math.floor(t + 1e-6) + 1, ArrowUp: Math.floor(t + 1e-6) + 1, ArrowLeft: Math.ceil(t - 1e-6) - 1, ArrowDown: Math.ceil(t - 1e-6) - 1,
      PageUp: Math.floor(t + 1e-6) + 3, PageDown: Math.ceil(t - 1e-6) - 3, Home: 0, End: end } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault(); seek(to);
  };

  // the first frame goes down before the page paints, so nobody sees the end before the start
  useLayoutEffect(() => {
    const s = live.current;
    setStill(calm());
    s.t = calm() || (shown.has(key) && !now) ? end : 0; draw(1e6);
  }, [key]);
  useEffect(() => {
    const s = live.current;
    if (calm() || (shown.has(key) && !now)) return;
    if (now) { const t = setTimeout(() => { shown.add(key); start(); }, 500); return () => { clearTimeout(t); stop(); cancelAnimationFrame(s.raf); }; }
    let wait: ReturnType<typeof setTimeout>;   // a beat, so a page still laying itself out can't set it off
    const seen = new IntersectionObserver(([e]) => {
      clearTimeout(wait);
      if (e.isIntersecting) wait = setTimeout(() => { shown.add(key); seen.disconnect(); start(); }, 350);
    }, { threshold: .4 });
    seen.observe(box.current!);
    return () => { clearTimeout(wait); seen.disconnect(); stop(); cancelAnimationFrame(s.raf); };
  }, [key]);

  const rest = standing(items, end), ticks = steps.length > 6 ? [0, end / 3, end * 2 / 3, end].map(Math.round) : steps.map((_, i) => i);
  const says = items.filter((_, n) => rest.place[n] < ROWS).sort((a, b) => (b.points[end] ?? 0) - (a.points[end] ?? 0)).map(i => `${i.title} ${amount(i.points[end] ?? 0, unit)}`).join(', ');
  return (
    <div ref={box} className={playing ? 'race is-running' : 'race'}>
      {/* in a card the month and what's measured ride the title row's right end, so the bars start at the top */}
      {inCard ? <HeadActions><span className="race-head is-in-head">{span && <span className="race-span">{span}</span>}<span ref={date} className="race-date">{steps[end]}</span></span></HeadActions> : <div className="race-head">
        <span ref={date} className="race-date metric">{steps[end]}</span>
        {span && <span className="race-span">{span}</span>}
      </div>}
      <div className="race-field" role="img" aria-label={says} style={{ height: `calc(var(--row) * ${Math.min(ROWS, items.length)})` }}>
        {items.map((it, n) => {
          const place = rest.place[n], p = bar(rest.value[n], rest.top), t = tint[it.title];
          return (
            <div key={it.title} ref={el => { rows.current[n] = el; }} className={place === 0 ? 'race-row is-lead' : 'race-row'} data-tint={t ? '' : undefined} style={{ transform: `translateY(calc(var(--row) * ${place}))`, opacity: place < ROWS ? 1 : 0, ...hue(t) }}>
              {it.image ? <img className="race-art" src={it.image} alt="" decoding="async" onLoad={e => { const c = tintOf(e.currentTarget); if (c && !t) setTint(m => ({ ...m, [it.title]: c })); }} /> : <span className="race-art" />}
              <div className="race-lane">
                <div className="race-line">
                  <div className="race-track"><i className="race-bar" style={{ transform: `translateX(${(p - 1) * 100}%)` }}><b /></i></div>
                  <span className="race-name">{it.title}</span>
                  <div className="race-end" style={{ transform: `translateX(${p * 100}%)` }}><span>{amount(rest.value[n], unit)}</span></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="race-foot">
        {!still && <button type="button" className="press race-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => playing ? stop() : start()}>{playing ? <Pause className="size-icon-sm" fill="currentColor" strokeWidth={0} /> : <Play className="size-icon-sm translate-x-px" fill="currentColor" strokeWidth={0} />}</button>}
        <div className="race-scale">
          <input ref={scrub} className="race-scrub" type="range" aria-label="Move through the year" aria-valuetext={steps[end]} min={0} max={end} step={.01} defaultValue={end} style={{ '--at': 1 } as CSSProperties}
            onKeyDown={keys} onInput={e => seek(Number(e.currentTarget.value))} />
          <div className="race-months">{ticks.map((i, k) => <span key={i} style={k && k < ticks.length - 1 ? { left: `calc(var(--knob) / 2 + (100% - var(--knob)) * ${(i / end).toFixed(4)})` } : undefined}>{steps[i]}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

/** The stream's parts: one hue, deep to pale, so it reads as one flow rather than rival colours. */
export const flow = (k: number) => k ? `color-mix(in oklab, var(--foreground) ${Math.max(20, 34 - k * 8)}%, transparent)` : 'color-mix(in oklab, var(--primary) 62%, transparent)';
const SOFT = [.25, .5, .25];
/** The shape of a day's counts with its neighbours', so the stream flows; the tip still reads the real count. */
const soften = (l: number[]) => l.map((_, i) => SOFT.reduce((sum, w, k) => sum + w * (l[i + k - 1] ?? l[i]), 0));

/** The parts of a whole flowing around a centre line. It fills the same box as the columns; `at` is the day under the pointer. */
export function Stream({ card, at, onAt }: { card: ChartCard; at: number | null; onAt: (i: number | null) => void }) {
  const W = 300, H = 112, n = Math.max(...card.series.map(s => s.points.length), 0);
  const layers = card.series.map(s => soften(Array.from({ length: n }, (_, i) => s.points[i] ?? 0))), whole = Array.from({ length: n }, (_, i) => layers.reduce((t, l) => t + l[i], 0));
  const scale = (H - 4) / Math.max(...whole, 1e-6), x = (i: number) => (i + .5) / n * W;
  const floor = whole.map(t => (H - t * scale) / 2), edge = (l: number[]) => [[0, l[0]], ...l.map((v, i) => [x(i), v]), [W, l[n - 1]]] as [number, number][];
  const paths = layers.map(l => { const low = floor.slice(), high = floor.map((f, i) => f + l[i] * scale); high.forEach((v, i) => { floor[i] = v; }); return `${smooth(edge(high))}${smooth(edge(low).reverse()).replace('M', 'L')}Z`; });
  const point = (e: React.PointerEvent<HTMLDivElement>) => { const b = e.currentTarget.getBoundingClientRect(); onAt(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - b.left) / b.width * n)))); };
  return (
    <div className="stream" onPointerMove={point} onPointerDown={point}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {card.series.map((s, k) => <path key={s.name} d={paths[k]} fill={flow(k)} />)}
      </svg>
      {at != null && <div className="stream-at" style={{ transform: `translateX(${(at + .5) / n * 100}%)` }}><i /></div>}
    </div>
  );
}

const CELL = 12, SIZE = 10;
/** A year of days, a column a week: deeper for days with more in them, on steps cut from the days themselves so one huge
 *  night can't wash the rest out. Where a year in one line would make the days too small to read (half a page, a phone),
 *  it folds into two lines, a half-year each, each with its months above it. */
export function Heatmap({ card }: { card: HeatmapCard }) {
  const [at, setAt] = useState<number | null>(null), box = useRef<HTMLDivElement>(null), [wide, setWide] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setWide(el.clientWidth);
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  const first = new Date(`${card.from}T00:00`), lead = (first.getDay() - firstDay() + 7) % 7, n = card.days.length, weeks = Math.ceil((n + lead) / 7);
  // a line of the year needs about 13px a week to read; short of that, two lines of half as many weeks
  const lines = wide && wide / weeks < 13 ? 2 : 1, per = Math.ceil(weeks / lines);
  const spot = (i: number) => [Math.floor((i + lead) / 7), (i + lead) % 7] as const, date = (i: number) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
  const busy = useMemo(() => card.days.filter(d => d > 0).sort((a, b) => a - b), [card.days]);
  const cut = [.25, .5, .8].map(q => busy[Math.floor(q * (busy.length - 1))] ?? 1), level = (d: number) => !d ? 0 : 1 + cut.filter(c => d > c).length;
  const months = useMemo(() => { const out: { col: number; name: string }[] = []; for (let i = 0; i < n; i++) { const d = date(i); if (d.getDate() === 1) out.push({ col: spot(i)[0], name: month(d, { short: true }) }); } return out; }, [card.from, n, lead]);
  const whole = card.days.reduce((a, b) => a + b, 0), most = Math.max(...card.days), word = card.unit ?? 'play', count = (v: number) => `${written(v)} ${word}${v === 1 ? '' : 's'}`;
  const point = (line: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect(), c = line * per + Math.floor((e.clientX - b.left) / b.width * per), r = Math.floor((e.clientY - b.top) / b.height * 7), i = c * 7 + Math.max(0, Math.min(6, r)) - lead;
    setAt(i >= 0 && i < n && c < (line + 1) * per ? i : null);
  };
  const best = card.days.indexOf(most), atCol = at != null ? spot(at)[0] : -1;
  return (
    <div ref={box} className="heatmap" data-lines={lines}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="metric text-metric-m leading-none"><Metric value={card.headline ?? count(whole)} /></span>
        {card.span && <span className="min-w-0 truncate text-meta text-muted-foreground">{card.span}</span>}
      </div>
      <div className="heat-lines" role="img" aria-label={`${count(whole)}, most on ${dayOf(date(best))}`}>
        {Array.from({ length: lines }, (_, line) => {
          const from = line * per, cols = Math.min(per, weeks - from), tip = (atCol - from + .5) / per;
          return (
            <div key={line} className="heat-line">
              <div className="heat-months" aria-hidden>{months.filter(m => m.col >= from && m.col < from + cols && (m.col - from) / per < .94).map(m => <span key={m.col} style={{ left: `${(m.col - from) / per * 100}%` }}>{m.name}</span>)}</div>
              <div className="heat" onPointerMove={point(line)} onPointerDown={point(line)} onPointerLeave={() => setAt(null)}>
                <svg viewBox={`0 0 ${per * CELL - (CELL - SIZE)} ${7 * CELL - (CELL - SIZE)}`} aria-hidden>
                  {card.days.map((d, i) => { const [c, r] = spot(i); return c >= from && c < from + cols && <rect key={i} x={(c - from) * CELL} y={r * CELL} width={SIZE} height={SIZE} rx={2} className={`heat-${level(d)}`} />; })}
                  {at != null && atCol >= from && atCol < from + cols && <rect x={(atCol - from) * CELL - .5} y={spot(at)[1] * CELL - .5} width={SIZE + 1} height={SIZE + 1} rx={2.5} className="heat-at" />}
                </svg>
                {at != null && atCol >= from && atCol < from + cols && <div className="col-tip" style={{ left: `${tip * 100}%`, translate: `${-tip * 100}% 0` }}><b>{dayOf(date(at))}</b> · {count(card.days[at])}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-meta text-muted-foreground">
        <span className="min-w-0 truncate tabular">Most in a day {written(most)}</span>
        <span className="heat-key shrink-0" aria-hidden>Less{[0, 1, 2, 3, 4].map(l => <svg key={l} viewBox="0 0 10 10"><rect width="10" height="10" rx="2" className={`heat-${l}`} /></svg>)}More</span>
      </div>
    </div>
  );
}

/** A share as a hundred squares. Anything above nothing shows at least one, and rounding never fills the grid early. */
export function Waffle({ pct, label }: { pct: number; label?: string }) {
  const on = pct > 0 ? Math.max(1, Math.min(pct < 1 ? 99 : 100, Math.round(pct * 100))) : 0;
  return <div className="waffle" role="img" aria-label={label ?? `${on} in every 100`} title={label}>{Array.from({ length: 100 }, (_, k) => <i key={k} className={(9 - Math.floor(k / 10)) * 10 + k % 10 < on ? 'on' : undefined} />)}</div>;
}
