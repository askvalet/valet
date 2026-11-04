// How things feel under the hand: a row you can throw, a pile you can flick, a slider that gives at its
// ends, a number where only what changed moves, and one place at the bottom of the page for what just happened. Plain React
// and CSS: a gesture writes transform and opacity straight to the element, and everything else is a CSS transition, so it
// can be caught mid-flight and the reduced-motion rule in styles.css needs nothing more. Licence at the end of this file.
import { BlossomCarousel, useBlossomNavigation } from '@blossom-carousel/react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { dissolve } from './dust.ts';
import './feel.css';

/** True when this page has been asked to hold still: the system's setting or appearance.motion, through the one --move. */
const still = (el?: Element | null) => !!el && getComputedStyle(el).getPropertyValue('--move').trim() === '0';
/** Past the end a thing still follows the finger, less and less, up to `limit` pixels. */
export const rubber = (d: number, limit: number) => Math.sign(d) * (1 - 1 / (Math.abs(d) * .55 / limit + 1)) * limit;
type Trail = { t: number; x: number }[];
/** How fast a pointer was going as it let go, from its last 90 ms. */
const speed = (trail: Trail) => { const end = trail.at(-1)!, from = trail.find(p => end.t - p.t < 90) ?? end; return end.t > from.t ? (end.x - from.x) / (end.t - from.t) * 1000 : 0; };

/** How a carousel moves when asked: smoothly, unless this page has been asked to hold still or it was a key. */
export const glide = (el?: Element | null, key = false): ScrollBehavior => key || still(el ?? document.documentElement) ? 'instant' : 'smooth';

/** A row of things (Blossom Carousel): a native scroller, so a finger keeps the phone's own momentum and the page keeps
 *  its vertical scroll, and on a mouse Blossom's drag engine lets it be thrown. Snapping is the stylesheet's. Keys page
 *  through it at once: nothing animates on a keyboard. Its arrows are `RowArrows` with the same `id`. */
export function Row({ id, className, children, ...props }: ComponentProps<typeof BlossomCarousel> & { id: string }) {
  return (
    <BlossomCarousel id={id} data-start="" className={cn('carousel', className)} {...props}
      onKeyDown={e => {
        const r = e.currentTarget, dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, to = e.key === 'Home' ? 0 : e.key === 'End' ? r.scrollWidth : null;
        // on a poster, the arrows (and Home and End) take the focus along, which brings it into view; on the row they page it
        const all = slidesOf(r), on = all.findIndex(s => s.contains(e.target as Node));
        if (on >= 0 && (dir || to != null)) {
          const next = all[dir ? on + dir : to ? all.length - 1 : 0], f = next?.matches('a, button') ? next : next?.querySelector<HTMLElement>('a, button');
          if (f) { e.preventDefault(); f.focus(); }
        }
        else if (dir) { e.preventDefault(); page(r, dir, 'instant'); }
        else if (to != null) { e.preventDefault(); r.scrollTo({ left: to, behavior: 'instant' }); }
      }}>
      {children}
    </BlossomCarousel>
  );
}
/** About a screenful on; snapping settles it on the nearest thing. */
const page = (r: Element, dir: number, behavior: ScrollBehavior) => r.scrollBy({ left: dir * r.clientWidth * .85, behavior });

/** The slide nearest the middle of a carousel, and how to bring one there, without moving the page around it. */
export const nearest = (r: HTMLElement) => {
  const mid = r.scrollLeft + r.clientWidth / 2; let best = 0, gap = Infinity;
  slidesOf(r).forEach((s, i) => { const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid); if (d < gap) { gap = d; best = i; } });
  return best;
};
export const centre = (r: HTMLElement, i: number, behavior: ScrollBehavior) => {
  const all = slidesOf(r), s = all[Math.max(0, Math.min(all.length - 1, i))];
  if (s) r.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - r.clientWidth / 2, behavior });
};
const slidesOf = (r: HTMLElement) => [...r.querySelectorAll<HTMLElement>(':scope > [data-blossom-slide]')];

/** Back and forward for a `Row` (or any Blossom carousel): a screenful at a time, or with `one`, the next slide to the
 *  middle. They dim at the ends and keep the keyboard's focus there (aria-disabled, not disabled), and they're only there
 *  when the row overflows. This is the only part that hears the row move, and only when an end is reached or left, so the
 *  row itself never re-renders as it scrolls. It also marks the row's ends for its edge fades. */
export function RowArrows({ id, className, label, one }: { id: string; className?: string; label?: string; one?: boolean }) {
  const nav = useBlossomNavigation(id), known = nav.activeIndex >= 0;
  // until it's measured it's at its start with more to come, as it was drawn, so the arrows don't pop in
  const canPrev = known && nav.canPrev, canNext = !known || nav.canNext;
  useEffect(() => {
    const r = document.getElementById(id); if (!r || !known) return;
    r.toggleAttribute('data-start', !canPrev); r.toggleAttribute('data-end', !canNext);
  }, [id, known, canPrev, canNext]);
  const arrow = (dir: number, shut: boolean, name: string, I: LucideIcon) => (
    <button type="button" aria-controls={id} aria-label={label ? `${name} in ${label}` : name} aria-disabled={shut} className="shelf-arrow"
      onClick={e => {
        const r = document.getElementById(id); if (!r || shut) return;
        const how = glide(r, e.detail === 0);   // a click from the keyboard jumps
        if (one) centre(r, nearest(r) + dir, how); else page(r, dir, how);
      }}><I className="size-4" /></button>
  );
  return <div className={cn('flex gap-1.5', !(canPrev || canNext) && 'invisible', className)}>{arrow(-1, !canPrev, 'Previous', ChevronLeft)}{arrow(1, !canNext, 'Next', ChevronRight)}</div>;
}

/** A poster under the pointer leans a little away from it, the picture sliding inside its frame, so it reads as a thing
 *  with depth rather than a flat tile. Only a mouse; the stylesheet holds it still for anyone who's asked for less. */
export const lean = (e: PointerEvent<HTMLElement>) => {
  const frame = e.currentTarget.querySelector<HTMLElement>('.poster'); if (!frame || e.pointerType !== 'mouse') return;
  if (e.type === 'pointerleave') { frame.style.removeProperty('--px'); frame.style.removeProperty('--py'); return; }
  const r = frame.getBoundingClientRect();
  frame.style.setProperty('--px', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3)); frame.style.setProperty('--py', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
};

/** Where a card sits: 0 on top, above that behind it and dimmer, -1 thrown off to the left. Fractions are a card being dragged.
 *  Depth is a dim laid over the card, not its opacity: a see-through card would show the next one's words. */
export const pose = (p: number): CSSProperties => p <= 0
  ? { transform: `translateX(${(p * 112).toFixed(2)}%) rotate(${(p * 5).toFixed(2)}deg)`, opacity: +Math.max(0, Math.min(1, 1.5 + p * 1.5)).toFixed(3), '--dim': 0 } as CSSProperties
  : { transform: `translateY(${(-14 * Math.min(p, 3)).toFixed(2)}px) scale(${(1 - .05 * Math.min(p, 3)).toFixed(4)})`, opacity: +Math.max(0, Math.min(1, 4 - p)).toFixed(3), '--dim': +(Math.min(p, 3) * .16).toFixed(3) } as CSSProperties;

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
  const shown = []; for (let i = Math.max(0, at - 1); i <= Math.min(count - 1, at + 4); i++) shown.push(i);
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
 *  paint, and nothing while it's changing too fast to follow. A value that isn't a number crossfades. `flap`: a departures board,
 *  for a countdown: a digit flips, and what isn't a digit just changes. */
export function Counter({ value, className, flap = true }: { value: string | number; className?: string; flap?: boolean }) {
  const text = String(value), [s, setS] = useState({ now: text, was: text, n: 0, at: 0 });
  if (s.now !== text) { const at = Date.now(); setS(at - s.at < QUICK ? { now: text, was: text, n: s.n, at } : { now: text, was: s.now, n: s.n + 1, at }); }
  const was = [...s.was].reverse(), to = [...s.now], down = parseFloat(s.now) < parseFloat(s.was), numbers = /\d/.test(s.now) && /\d/.test(s.was);
  if (!numbers) return <span key={s.n} className={cn('tabular whitespace-nowrap', s.n > 0 && 'tick', className)}>{s.now}</span>;
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      <span className="sr-only">{s.now}</span>
      {to.map((c, i) => {
        const back = to.length - 1 - i, from = was[back], on = s.was !== s.now && from !== c, order = on ? to.slice(i + 1).filter((d, k) => d !== was[to.length - 1 - (i + 1 + k)]).length : 0;
        const flip = flap && on && /\d/.test(c) && /\d/.test(from ?? '');
        return <span key={`${back}:${on ? s.n : 0}`} aria-hidden className={cn('digit', on && !flap && 'digit-new', down && 'is-down')} data-was={on && !flap ? from : undefined} style={on ? { '--i': order } as CSSProperties : undefined}>{flip ? <Flap was={from} now={c} /> : c}</span>;
      })}
    </span>
  );
}

/** One digit's flip. The face is the plain digit, hidden while four half-digits play over it and back when they finish, so
 *  nothing is left split down the middle, and with motion off the face is all there is. */
export function Flap({ was, now }: { was: string; now: string }) {
  return <><span className="flap-face">{now}</span><i className="flap flap-next">{now}</i><i className="flap flap-last">{was}</i><i className="flap flap-fall">{was}</i><i className="flap flap-rise">{now}</i></>;
}

const CLOSE = 200;   // --dur-pop
/** How long a row leaving as dust keeps its room: the sweep across it (dust.ts), then the close. */
export const DUST_HOLD = 300 + CLOSE;
interface Gone<T> { key: string; item: T; after?: string }
/** A list whose rows come and go: a new one is marked `in`, and one that's gone stays a moment as `out`, where it was. Nothing
 *  on first paint, and a list with nothing in common with the last is another list, so that simply shows. `hold`: how long
 *  a gone row stays, longer for one leaving as dust. */
export function useRows<T>(items: T[], keyOf: (item: T) => string, on = true, hold = CLOSE) {
  const seen = new Map<string, number>();
  const rows = items.map(item => { const k = keyOf(item), n = seen.get(k) ?? 0; seen.set(k, n + 1); return { key: n ? `${k}#${n}` : k, item }; });
  const sig = rows.map(r => r.key).join('\n'), last = useRef(rows), [s, setS] = useState({ sig, fresh: [] as string[], gone: [] as Gone<T>[], n: 0 });
  if (on && s.sig !== sig) {
    const had = new Set(last.current.map(r => r.key)), has = new Set(rows.map(r => r.key)), same = rows.some(r => had.has(r.key));
    const left = last.current.flatMap((r, i) => has.has(r.key) ? [] : [{ ...r, after: last.current[i - 1]?.key }]);
    setS({ sig, fresh: same ? rows.filter(r => !had.has(r.key)).map(r => r.key) : [], gone: same ? [...s.gone.filter(g => !has.has(g.key)), ...left] : [], n: s.n + 1 });
  }
  useEffect(() => { last.current = rows; });
  useEffect(() => { if (!s.gone.length) return; const t = setTimeout(() => setS(x => ({ ...x, gone: [] })), hold); return () => clearTimeout(t); }, [s.n]);
  const out: { key: string; item: T; state?: 'in' | 'out' }[] = rows.map(r => s.fresh.includes(r.key) ? { ...r, state: 'in' } : r);
  for (const g of s.gone) { const at = g.after == null ? 0 : out.findIndex(r => r.key === g.after) + 1 || out.length; out.splice(at, 0, { key: g.key, item: g.item, state: 'out' }); }
  return out;
}
/** A row's room in the list: it opens as the row slides out from under the one above, and closes quicker. `dust`: it was
 *  taken off by someone just now, so it leaves as dust, and its room closes once the dust has cleared it (DUST_HOLD). */
export function RowSlot({ state, as: As = 'div', on = true, dust, className, children }: { state?: 'in' | 'out'; as?: 'div' | 'li'; on?: boolean; dust?: boolean; className?: string; children: ReactNode }) {
  const clip = useRef<HTMLDivElement>(null), gone = state === 'out' && dust;
  useLayoutEffect(() => { if (gone) dissolve(clip.current?.firstElementChild ?? clip.current); }, [gone]);
  if (!on) return children;
  return <As className={cn('row-slot', state && `is-${state}`, gone && 'is-dust', className)}><div ref={clip} className="row-clip">{children}</div></As>;
}

/** A tick. `draw` strokes it on, once: for something that has only now finished. */
export function Tick({ draw, className }: { draw?: boolean; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn(draw && 'tick-draw', className)}><path pathLength={1} d="M4 12l5 5L20 6" /></svg>;
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
/** A note can be swiped away sideways: it follows the finger, and far or fast enough it's thrown off; otherwise it rides back. */
function useSwipe(key: string) {
  const grab = useRef<{ x: number; dx: number; trail: Trail; live: boolean } | null>(null);
  const letGo = (el: HTMLElement) => {
    const g = grab.current; grab.current = null; if (!g?.live) return;
    const v = g.trail.length ? speed(g.trail) : 0, away = Math.abs(g.dx) > 64 || (Math.abs(v) > 500 && v * g.dx > 0);
    el.classList.remove('is-held');
    if (away) { el.style.translate = `${Math.sign(g.dx || v) * 160}px 0`; el.style.opacity = '0'; toast(key, null); }
    else { el.style.translate = ''; el.style.opacity = ''; }
  };
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) { if (!e.button && !(e.target as Element).closest('button') && !still(e.currentTarget)) grab.current = { x: e.clientX, dx: 0, trail: [], live: false }; },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = grab.current; if (!g) return;
      g.dx = e.clientX - g.x;
      if (!g.live) { if (Math.abs(g.dx) < 6) return; g.live = true; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.classList.add('is-held'); }
      e.currentTarget.style.translate = `${g.dx}px 0`; e.currentTarget.style.opacity = String(Math.max(.2, 1 - Math.abs(g.dx) / 220));
      g.trail.push({ t: e.timeStamp, x: e.clientX }); if (g.trail.length > 8) g.trail.shift();
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => letGo(e.currentTarget),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => letGo(e.currentTarget),
  };
}
function Note({ t }: { t: Up }) {
  const swipe = useSwipe(t.key);
  return <div {...swipe} className={cn('undo-bar', t.tone && `is-${t.tone}`, t.out && 'is-out')}>{t.text}{t.undo && <button type="button" onClick={() => { t.undo!(); toast(t.key, null); }}>Undo</button>}</div>;
}
function Toasts() {
  const list = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => toasts, () => toasts);
  return (
    <div role="status" className={cn('toasts', near && 'is-near')} style={near ?? undefined}>
      {list.map(t => <Note key={t.key} t={t} />)}
    </div>
  );
}

/* Rewritten for Valet from the free items in Arc UI (https://uiarc.dev, github.com/kuratlielia/arc-library): `rubber` is its
   formula, and the carousel, card stack, elastic slider, animated counter and toast stack are the ideas.

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
