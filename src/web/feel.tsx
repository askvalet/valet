// How things feel under the hand: a row you can throw, a pile you can flick, a button you hold, a slider that gives at its
// ends, a number where only what changed moves, and one place at the bottom of the page for what just happened. Plain React
// and CSS: a gesture writes transform and opacity straight to the element, and everything else is a CSS transition, so it
// can be caught mid-flight and the reduced-motion rule in styles.css needs nothing more. Licence at the end of this file.
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import './feel.css';

/** True when this page has been asked to hold still: the system's setting or appearance.motion, through the one --move. */
const still = (el?: Element | null) => !!el && getComputedStyle(el).getPropertyValue('--move').trim() === '0';
/** Past the end a thing still follows the finger, less and less, up to `limit` pixels. */
export const rubber = (d: number, limit: number) => Math.sign(d) * (1 - 1 / (Math.abs(d) * .55 / limit + 1)) * limit;
/** Where a throw comes to rest: the stop nearest to where its speed (px/s) would carry it. */
export const landing = (x: number, v: number, stops: number[]) => stops.reduce((best, s) => Math.abs(s - (x + v * .22)) < Math.abs(best - (x + v * .22)) ? s : best, stops[0] ?? x);
type Trail = { t: number; x: number }[];
/** How fast a pointer was going as it let go, from its last 90 ms. */
const speed = (trail: Trail) => { const end = trail.at(-1)!, from = trail.find(p => end.t - p.t < 90) ?? end; return end.t > from.t ? (end.x - from.x) / (end.t - from.t) * 1000 : 0; };

/** A row of things that scrolls natively, so a finger keeps the phone's own momentum and the page keeps its vertical scroll,
 *  and that a mouse can throw. It lands on a stop, and a press catches it mid-glide. Keys jump: nothing animates on a keyboard. */
export function useRow<T extends HTMLElement = HTMLDivElement>() {
  const row = useRef<T | null>(null), [edge, setEdge] = useState({ start: true, end: false });
  const flight = useRef(0), grab = useRef<{ x: number; left: number; trail: Trail; live: boolean; caught: boolean } | null>(null), threw = useRef(false);
  const measure = useCallback(() => {
    const r = row.current; if (!r) return;
    const start = r.scrollLeft <= 2, end = r.scrollLeft + r.clientWidth >= r.scrollWidth - 2;
    setEdge(e => e.start === start && e.end === end ? e : { start, end });
  }, []);
  const ref = useCallback((el: T | null) => {
    row.current = el; if (!el) return;
    const o = new ResizeObserver(measure); o.observe(el);
    return () => { o.disconnect(); cancelAnimationFrame(flight.current); };
  }, [measure]);
  useLayoutEffect(measure);
  const stops = (r: T) => {
    const pad = parseFloat(getComputedStyle(r).scrollPaddingLeft) || 0, max = r.scrollWidth - r.clientWidth;
    return [...r.children].map(c => Math.max(0, Math.min(max, (c as HTMLElement).offsetLeft - pad)));
  };
  const halt = (r: T) => { const flying = !!flight.current; cancelAnimationFrame(flight.current); flight.current = 0; r.classList.remove('is-held'); return flying; };
  // a critically damped spring from wherever it is, at whatever speed it had: no duration to wait out and nothing to overshoot
  const glide = (r: T, to: number, v = 0) => {
    halt(r);
    if (still(r)) { r.scrollLeft = to; return; }
    r.classList.add('is-held');
    const W = 14, from = r.scrollLeft, a = from - to, b = v + W * a; let t0 = 0;
    const step = (t: number) => {
      t0 ||= t;
      const s = (t - t0) / 1000, x = to + (a + b * s) * Math.exp(-W * s);
      r.scrollLeft = x;
      if (s > .05 && Math.abs(x - to) < .5) { r.scrollLeft = to; halt(r); return; }
      flight.current = requestAnimationFrame(step);
    };
    flight.current = requestAnimationFrame(step);
  };
  const aim = (r: T, dir: number) => {
    const all = stops(r), to = landing(r.scrollLeft + dir * r.clientWidth * .85, 0, all);
    return (to - r.scrollLeft) * dir > 1 ? to : all.find(s => (s - r.scrollLeft) * dir > 1) ?? to;
  };
  const page = (dir: number) => { const r = row.current; if (r) glide(r, aim(r, dir)); };
  const bind = {
    ref, onScroll: measure,
    'data-start': edge.start || undefined, 'data-end': edge.end || undefined,
    onPointerDown(e: PointerEvent<T>) {
      const r = e.currentTarget, caught = halt(r); threw.current = false;
      if (e.pointerType !== 'touch' && !e.button && r.scrollWidth > r.clientWidth) grab.current = { x: e.clientX, left: r.scrollLeft, trail: [], live: false, caught };
    },
    onPointerMove(e: PointerEvent<T>) {
      const g = grab.current, r = e.currentTarget; if (!g) return;
      const dx = e.clientX - g.x;
      if (!g.live) { if (Math.abs(dx) < 5) return; g.live = threw.current = true; r.setPointerCapture(e.pointerId); r.classList.add('is-held', 'is-grabbed'); }
      const want = g.left - dx, max = r.scrollWidth - r.clientWidth, x = Math.max(0, Math.min(max, want));
      r.scrollLeft = x; r.style.translate = want === x ? '' : `${rubber(x - want, 36)}px 0`;
      g.trail.push({ t: e.timeStamp, x: -e.clientX }); if (g.trail.length > 8) g.trail.shift();
    },
    onPointerUp: (e: PointerEvent<T>) => letGo(e.currentTarget),
    onPointerCancel: (e: PointerEvent<T>) => letGo(e.currentTarget),
    onWheel: (e: { currentTarget: T }) => { halt(e.currentTarget); },
    onDragStart: (e: { preventDefault(): void }) => e.preventDefault(),
    // a drag that ends on a link isn't a click on it
    onClickCapture(e: { preventDefault(): void; stopPropagation(): void }) { if (threw.current) { threw.current = false; e.preventDefault(); e.stopPropagation(); } },
    onKeyDown(e: KeyboardEvent<T>) {
      const r = e.currentTarget, to = e.key === 'ArrowRight' ? aim(r, 1) : e.key === 'ArrowLeft' ? aim(r, -1) : e.key === 'Home' ? 0 : e.key === 'End' ? r.scrollWidth : null;
      if (to != null) { e.preventDefault(); halt(r); r.scrollLeft = to; }
    },
  };
  function letGo(r: T) {
    const g = grab.current; grab.current = null; if (!g) return;
    r.classList.remove('is-grabbed'); r.style.translate = '';
    if (g.live) { const v = g.trail.length ? speed(g.trail) : 0; glide(r, landing(r.scrollLeft, v, stops(r)), v); }
    else if (g.caught) glide(r, landing(r.scrollLeft, 0, stops(r)));
  }
  return { bind, page, edge };
}

/** Back and forward for a row: they dim at the ends and keep the keyboard's focus there (aria-disabled, not disabled). */
export function Arrows({ row, className }: { row: ReturnType<typeof useRow<any>>; className?: string }) {
  const arrow = (dir: number, shut: boolean, label: string, I: LucideIcon) => <button type="button" onClick={() => { if (!shut) row.page(dir); }} aria-label={label} aria-disabled={shut} className="shelf-arrow"><I className="size-4" /></button>;
  return <div className={cn('flex gap-1.5', className)}>{arrow(-1, row.edge.start, 'Previous', ChevronLeft)}{arrow(1, row.edge.end, 'Next', ChevronRight)}</div>;
}

/** Where a card sits: 0 on top, above that behind it and dimmer, -1 thrown off to the left. Fractions are a card being dragged.
 *  Depth is a dim laid over the card, not its opacity: a see-through card would show the next one's words. */
export const pose = (p: number): CSSProperties => p <= 0
  ? { transform: `translateX(${(p * 112).toFixed(2)}%) rotate(${(p * 5).toFixed(2)}deg)`, opacity: +Math.max(0, Math.min(1, 1.5 + p * 1.5)).toFixed(3), '--dim': 0 } as CSSProperties
  : { transform: `translateY(${(-9 * Math.min(p, 2)).toFixed(2)}px) scale(${(1 - .045 * Math.min(p, 2)).toFixed(4)})`, opacity: +Math.max(0, Math.min(1, 3 - p)).toFixed(3), '--dim': +(Math.min(p, 2) * .2).toFixed(3) } as CSSProperties;

/** A pile you flick through: the card on top, the next ones showing above it. Left is on, right is back; it follows the
 *  finger, and letting go decides by how far and how fast. Up and down still scroll the page. `over` sits above the cards
 *  and stays put while they change, for the controls. */
export function Pile({ count, at, go, id, card, label, status, over }: { count: number; at: number; go: (i: number) => void; id: (i: number) => string; card: (i: number) => ReactNode; label: string; status?: string; over?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null), threw = useRef(false), [keyed, setKeyed] = useState(false);
  const grab = useRef<{ x: number; y: number; width: number; dx: number; trail: Trail; live: boolean } | null>(null), now = useRef(at); now.current = at;
  const place = (pull: number, held: boolean) => box.current?.querySelectorAll<HTMLElement>(':scope > [data-at]').forEach(el => {
    const pos = +el.dataset.at!;
    if (held && pos < (pull < 0 ? -1 : 0)) return;   // what's already been thrown keeps going
    for (const [k, v] of Object.entries(pose(pos - pull))) el.style.setProperty(k, String(v));
    if (held && pull < 0 && !now.current && !pos) el.style.transform = `translateX(${-pull * 100}%)`;   // the first card has nothing to come back from
    el.toggleAttribute('data-held', held);
  });
  const letGo = () => {
    const g = grab.current; grab.current = null; if (!g?.live) return;
    const v = speed(g.trail), dir = g.dx < 0 ? 1 : -1, next = now.current + dir;
    if ((Math.abs(g.dx) > g.width * .28 || (Math.abs(v) > 450 && v * g.dx > 0)) && next >= 0 && next < count) { place(dir, false); go(next); } else place(0, false);
  };
  const shown = []; for (let i = Math.max(0, at - 1); i <= Math.min(count - 1, at + 3); i++) shown.push(i);
  return (
    <div ref={box} role="group" aria-roledescription="pile" aria-label={label} className={cn('pile', count === 1 && 'is-single')} data-still={keyed || undefined}
      onPointerDown={e => {
        setKeyed(false); threw.current = false;
        if (count > 1 && !e.button && !(e.target as Element).closest('.pile-over button, .pile-over a')) grab.current = { x: e.clientX, y: e.clientY, width: e.currentTarget.clientWidth, dx: 0, trail: [], live: false };
      }}
      onPointerMove={e => {
        const g = grab.current; if (!g) return;
        const dx = e.clientX - g.x;
        if (!g.live) {
          if (Math.abs(e.clientY - g.y) > Math.abs(dx) + 2) { grab.current = null; return; }   // that's the page scrolling
          if (Math.abs(dx) < 6) return;
          g.live = threw.current = true; e.currentTarget.setPointerCapture(e.pointerId);
        }
        const past = (dx > 0 && at === 0) || (dx < 0 && at === count - 1);
        g.dx = past ? rubber(dx, 54) : dx; place(-g.dx / g.width, true);
        g.trail.push({ t: e.timeStamp, x: e.clientX }); if (g.trail.length > 8) g.trail.shift();
      }}
      onPointerUp={letGo} onPointerCancel={letGo} onDragStart={e => e.preventDefault()}
      onClickCapture={e => { if (threw.current) { threw.current = false; e.preventDefault(); e.stopPropagation(); } }}
      onKeyDown={e => { const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : -1; if (to >= 0 && to < count) { e.preventDefault(); setKeyed(true); go(to); } }}>
      {shown.map(i => <div key={id(i)} data-at={i - at} inert={i !== at} className="pile-card" style={{ ...pose(i - at), zIndex: i < at ? 12 : 10 - (i - at) }}>{card(i)}</div>)}
      {over && <div className="pile-over">{over}</div>}
      {status && <span role="status" className="sr-only">{status}</span>}
    </div>
  );
}

/** A button that asks for a little more: hold it while the fill crosses, and letting go early takes it back. A quick press
 *  (and any press from a keyboard or a screen reader that doesn't hold) asks for a second one, with no clock on it. Held
 *  Enter or Space count as holding. With motion off there's no fill to read, so it's always the two presses. */
export function Hold({ verb, onConfirm, ms = 800, className }: { verb: string; onConfirm: () => void; ms?: number; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined), since = useRef(0), fired = useRef(false), handled = useRef(false);
  const [held, setHeld] = useState(false), [armed, setArmed] = useState(false), [twice, setTwice] = useState(false);
  useLayoutEffect(() => setTwice(still(btn.current)), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fire = () => { if (fired.current) return; fired.current = true; setHeld(false); onConfirm(); };
  const start = () => { since.current = Date.now(); if (still(btn.current)) return; setHeld(true); timer.current = setTimeout(fire, ms); };
  const stop = () => { clearTimeout(timer.current); setHeld(false); since.current = 0; };
  const press = () => { if (armed) fire(); else setArmed(true); };
  const release = () => { const quick = since.current && (twice || Date.now() - since.current < 280); stop(); if (quick) press(); };
  const key = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
  return (
    <button ref={btn} type="button" data-held={held || undefined} aria-label={armed ? `Press again: ${verb}` : `${verb}. Asks for a second press`} className={cn('hold press relative overflow-hidden', className)} style={{ '--hold': `${ms}ms` } as CSSProperties}
      onPointerDown={e => { if (!e.button) { e.currentTarget.setPointerCapture(e.pointerId); start(); } }}
      onPointerUp={() => { if (since.current) { handled.current = true; release(); } }} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (key(e)) { e.preventDefault(); if (!e.repeat) start(); } }} onKeyUp={e => { if (key(e)) { e.preventDefault(); release(); } }}
      onClick={() => { if (handled.current) handled.current = false; else press(); }}   // a screen reader's press arrives as a bare click
      onBlur={() => { stop(); setArmed(false); }}>
      <i className="hold-fill" aria-hidden />
      <span className="slots relative" aria-hidden>
        <span data-off={armed || undefined}>{`${twice ? 'Press twice' : 'Hold'} to ${verb.toLowerCase()}`}</span>
        <span data-off={!armed || undefined}>Press again</span>
      </span>
    </button>
  );
}

/** The app's slider, with the same keys, values and one commit a gesture, and a little give: drag past either end and the
 *  track stretches after the pointer, then springs back when it's let go. */
export function ElasticSlider({ className, ...p }: ComponentProps<typeof Slider>) {
  const box = useRef<HTMLDivElement>(null), span = useRef<DOMRect | null>(null);
  const parts = () => [box.current?.querySelector<HTMLElement>('[data-slot="slider-track"]'), box.current?.querySelector<HTMLElement>('[data-slot="slider-thumb"]')] as const;
  const pull = (past: number) => {
    const [track, thumb] = parts(), r = span.current; if (!track || !thumb || !r) return;
    track.style.transformOrigin = past < 0 ? 'right' : 'left';
    track.style.transform = past ? `scaleX(${1 + Math.abs(past) / r.width}) scaleY(${1 - Math.abs(past) * .01})` : ''; thumb.style.translate = past ? `${past}px 0` : '';
  };
  const release = () => { if (!span.current) return; box.current?.classList.remove('is-pulling'); pull(0); span.current = null; };
  return (
    <div ref={box} className={cn('elastic', className)}
      onPointerDown={e => { if (p.disabled || e.button || still(e.currentTarget)) return; span.current = e.currentTarget.getBoundingClientRect(); e.currentTarget.classList.add('is-pulling'); }}
      onPointerMove={e => { const r = span.current; if (r) pull(rubber(e.clientX < r.left ? e.clientX - r.left : e.clientX > r.right ? e.clientX - r.right : 0, 12)); }}
      onPointerUp={release} onPointerCancel={release}>
      <Slider {...p} />
    </div>
  );
}

const QUICK = 1500;   // a number changing faster than this just changes: a slider under a finger, a clock's seconds
/** A number where only the digits that changed move, in from the side it's heading, the last digit first. Nothing on first
 *  paint, and nothing while it's changing too fast to follow. A value that isn't a number crossfades. */
export function Counter({ value, className }: { value: string | number; className?: string }) {
  const text = String(value), [s, setS] = useState({ now: text, was: text, n: 0, at: 0 });
  if (s.now !== text) { const at = Date.now(); setS(at - s.at < QUICK ? { now: text, was: text, n: s.n, at } : { now: text, was: s.now, n: s.n + 1, at }); }
  const was = [...s.was].reverse(), to = [...s.now], down = parseFloat(s.now) < parseFloat(s.was), numbers = /\d/.test(s.now) && /\d/.test(s.was);
  if (!numbers) return <span key={s.n} className={cn('tabular whitespace-nowrap', s.n > 0 && 'tick', className)}>{s.now}</span>;
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      <span className="sr-only">{s.now}</span>
      {to.map((c, i) => {
        const back = to.length - 1 - i, from = was[back], on = s.was !== s.now && from !== c, order = on ? to.slice(i + 1).filter((d, k) => d !== was[to.length - 1 - (i + 1 + k)]).length : 0;
        return <span key={`${back}:${on ? s.n : 0}`} aria-hidden className={cn('digit', on && 'digit-new', down && 'is-down')} data-was={on ? from : undefined} style={on ? { '--i': order } as CSSProperties : undefined}>{c}</span>;
      })}
    </span>
  );
}

const CLOSE = 200;   // --dur-pop
interface Gone<T> { key: string; item: T; after?: string }
/** A list whose rows come and go: a new one is marked `in`, and one that's gone stays a moment as `out`, where it was. Nothing
 *  on first paint, and a list with nothing in common with the last is another list, so that simply shows. */
export function useRows<T>(items: T[], keyOf: (item: T) => string, on = true) {
  const seen = new Map<string, number>();
  const rows = items.map(item => { const k = keyOf(item), n = seen.get(k) ?? 0; seen.set(k, n + 1); return { key: n ? `${k}#${n}` : k, item }; });
  const sig = rows.map(r => r.key).join('\n'), last = useRef(rows), [s, setS] = useState({ sig, fresh: [] as string[], gone: [] as Gone<T>[], n: 0 });
  if (on && s.sig !== sig) {
    const had = new Set(last.current.map(r => r.key)), has = new Set(rows.map(r => r.key)), same = rows.some(r => had.has(r.key));
    const left = last.current.flatMap((r, i) => has.has(r.key) ? [] : [{ ...r, after: last.current[i - 1]?.key }]);
    setS({ sig, fresh: same ? rows.filter(r => !had.has(r.key)).map(r => r.key) : [], gone: same ? [...s.gone.filter(g => !has.has(g.key)), ...left] : [], n: s.n + 1 });
  }
  useEffect(() => { last.current = rows; });
  useEffect(() => { if (!s.gone.length) return; const t = setTimeout(() => setS(x => ({ ...x, gone: [] })), CLOSE); return () => clearTimeout(t); }, [s.n]);
  const out: { key: string; item: T; state?: 'in' | 'out' }[] = rows.map(r => s.fresh.includes(r.key) ? { ...r, state: 'in' } : r);
  for (const g of s.gone) { const at = g.after == null ? 0 : out.findIndex(r => r.key === g.after) + 1 || out.length; out.splice(at, 0, { key: g.key, item: g.item, state: 'out' }); }
  return out;
}
/** A row's room in the list: it opens as the row slides out from under the one above, and closes quicker. */
export function RowSlot({ state, as: As = 'div', on = true, className, children }: { state?: 'in' | 'out'; as?: 'div' | 'li'; on?: boolean; className?: string; children: ReactNode }) {
  if (!on) return children;
  return <As className={cn('row-slot', state && `is-${state}`, className)}><div className="row-clip">{children}</div></As>;
}

// One place for what just happened. Most things keep their note beside the control; this is for a note whose place is out
// of view, and for what can pile up. A stack of independent notes, each with its own lapse, kept in a tiny store so anything
// can call it. It mounts itself on first use, and nothing lapses under the pointer: an Undo never leaves as you reach for it.
export interface Toast { text: string; tone?: 'busy' | 'good' | 'warn' | 'bad'; undo?: () => void }
type Up = Toast & { key: string; ms: number; out?: boolean };
let toasts: Up[] = [], near: { left: number; top: number } | null = null, mounted = false;
const subs = new Set<() => void>(), timers = new Map<string, ReturnType<typeof setTimeout>>();
const publish = (next: Up[]) => { toasts = next; subs.forEach(f => f()); };
const lapse = (t: Up, ms = t.ms) => {
  clearTimeout(timers.get(t.key));
  if (ms) timers.set(t.key, setTimeout(() => { if (matchMedia('(hover: hover)').matches && document.querySelector('.toasts:hover') || document.querySelector('.toasts:focus-within')) lapse(t, 1000); else toast(t.key, null); }, ms));
};
export function mountToasts() {
  if (mounted || typeof document === 'undefined') return; mounted = true;
  const el = document.createElement('div'); document.body.append(el); createRoot(el).render(<Toasts />);
}
/** Says something, or with null takes it back. Saying it again under the same key replaces it. `by` keeps it beside what
 *  it's about on a large screen, where the bottom of the page can be a long way from the eye. */
export function toast(key: string, t: Toast | null, o: { ms?: number; by?: Element | null } = {}) {
  clearTimeout(timers.get(key));
  if (!t) {
    if (!toasts.some(x => x.key === key && !x.out)) return;
    publish(toasts.map(x => x.key === key ? { ...x, out: true } : x));
    setTimeout(() => publish(toasts.filter(x => x.key !== key || !x.out)), 200);
    return;
  }
  mountToasts();
  const up: Up = { ...t, key, ms: o.ms ?? 6000 }, rect = o.by?.getBoundingClientRect();
  if (rect && matchMedia('(min-width: 768px)').matches) near = { left: rect.left + rect.width / 2, top: Math.min(rect.top + rect.height / 2, innerHeight - 120) };
  else if (!toasts.length) near = null;
  publish(toasts.some(x => x.key === key) ? toasts.map(x => x.key === key ? up : x) : [...toasts, up].slice(-4));
  lapse(up);
}
function Toasts() {
  const list = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => toasts, () => toasts);
  return (
    <div role="status" className={cn('toasts', near && 'is-near')} style={near ?? undefined}>
      {list.map(t => (
        <div key={t.key} className={cn('undo-bar', t.tone && `is-${t.tone}`, t.out && 'is-out')}>{t.text}{t.undo && <button type="button" onClick={() => { t.undo!(); toast(t.key, null); }}>Undo</button>}</div>
      ))}
    </div>
  );
}

/* Rewritten for Valet from the free items in Arc UI (https://uiarc.dev, github.com/kuratlielia/arc-library): `rubber` is its
   formula, and the carousel, card stack, hold to confirm, elastic slider, animated counter and toast stack are the ideas.

   MIT License. Copyright (c) 2026 Elia Kuratli

   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
   files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
   modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
   Software is furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
   OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
   IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. */
