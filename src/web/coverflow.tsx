// Cover Flow: the artwork fanned out either side of the one in front, like iTunes had it. Everything sits in one 3D row
// and moves by transform alone, so a drag follows the finger and nothing runs once it settles. Our own, from the idea.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfCard } from '../shared/cards.ts';
import './coverflow.css';

const reach = 8;                     // how many covers either side stay in the page
const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
export const place = (d: number) => {
  const a = Math.min(1, Math.abs(d)), s = Math.sign(d);
  return { x: s * (a * .78 + Math.max(0, Math.abs(d) - 1) * .26), turn: -s * a * 58, sink: a, z: 100 - Math.round(Math.abs(d) * 10) };
};

export function CoverFlow({ card, header }: { card: ShelfCard; header?: ReactNode }) {
  const items = card.items, n = items.length;
  const [at, setAt] = useState(() => Math.floor((n - 1) / 2)), [pull, setPull] = useState<number | null>(null);
  const drag = useRef<{ x: number; from: number; moved: boolean; t: number; v: number; last: number } | null>(null), box = useRef<HTMLDivElement>(null), wheel = useRef(0);
  useEffect(() => setAt(a => clamp(a, n)), [n]);
  const go = (i: number) => setAt(clamp(i, n)), pos = pull ?? at, front = items[at];
  const unit = () => (box.current?.clientWidth ?? 600) * .16;
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
    const now = e.timeStamp, next = d.from - dx / unit();
    d.v = (next - d.last) / Math.max(1, now - d.t); d.t = now; d.last = next;
    setPull(Math.max(-.4, Math.min(n - .6, next)));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.moved) { go(Math.round(d.last + d.v * 180)); setPull(null); }
  };
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        {header}
        <div className="ml-auto flex gap-1.5">
          {[[-1, 'Previous', ChevronLeft], [1, 'Next', ChevronRight]].map(([by, name, I]: any) => (
            <button key={name} type="button" aria-label={name} aria-disabled={at + by < 0 || at + by >= n} onClick={() => go(at + by)} className="press grid size-7 flex-none place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground aria-disabled:opacity-40"><I className="size-4" /></button>
          ))}
        </div>
      </div>
      <div ref={box} tabIndex={0} role="group" aria-roledescription="carousel" aria-label={card.title} className={cn('flow', pull != null && 'is-drag')}
        onKeyDown={e => { const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (by) { e.preventDefault(); go(at + by); } else if (e.key === 'Home') go(0); else if (e.key === 'End') go(n - 1); }}
        onPointerDown={e => { if (e.button === 0) drag.current = { x: e.clientX, from: at, moved: false, t: e.timeStamp, v: 0, last: at }; }}
        onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={e => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; wheel.current += e.deltaX; if (Math.abs(wheel.current) > 50) { go(at + Math.sign(wheel.current)); wheel.current = 0; } }}>
        {items.map((it, i) => {
          if (Math.abs(i - at) > reach) return null;
          const p = place(i - pos), style = { '--x': p.x, '--turn': `${p.turn}deg`, '--sink': p.sink, zIndex: p.z } as React.CSSProperties;
          return (
            <a key={i} href={it.href} target="_blank" rel="noreferrer" draggable={false} aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ''}`} aria-current={i === at || undefined} tabIndex={i === at ? 0 : -1} style={style} className={cn('cover', !it.image && 'is-blank')}
              onClick={e => { if (i !== at || drag.current?.moved) { e.preventDefault(); if (i !== at) go(i); } }}>
              {it.image ? <img src={it.image} alt="" draggable={false} loading="lazy" /> : <span className="truncate-3">{it.title}</span>}
              {it.mark && <img src={it.mark} alt="" draggable={false} loading="lazy" className="cover-mark" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            </a>
          );
        })}
      </div>
      <div key={at} className="tick mt-1 text-center" aria-live="polite">
        <div className="truncate text-sm font-medium">{front?.title}</div>
        {front?.subtitle && <div className="truncate text-xs text-muted-foreground">{front.subtitle}</div>}
      </div>
    </div>
  );
}
