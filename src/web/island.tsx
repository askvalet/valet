// The island: a black notch at the top of the page that comes alive with whatever's happening right now. Compact,
// it shows the most important activity (and the next one as a bubble beside it); hovered or tapped, it springs open
// to all of them. Left alone with nothing new it draws back to the artwork and a dot, so it doesn't compete with the page.
// On wide screens it hangs from the top edge like a Mac notch; on phones it floats like the iPhone's.
import { Pause } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Activity } from '../shared/cards.ts';
import { Icon } from './cards.tsx';

export type Live = Activity & { key: string; href?: string; source?: { name: string; icon?: string } };
export type Notice = { key: string; text: string; sub?: string; icon?: string; image?: string; tone: 'good' | 'warn' | 'bad' | 'accent'; n: number };

const QUIET_AFTER = 20_000;
const TONE: Record<string, string> = { accent: 'var(--primary)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };
const tint = (a: Live) => TONE[a.tone ?? ''] ?? (a.icon === 'play' ? '#ff9f0a' : a.icon === 'download' ? 'var(--primary)' : 'var(--good)');

function Progress({ a, size = 20 }: { a: Live; size?: number }) {
  const r = 8, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, a.pct ?? 0));
  return (
    <svg viewBox="0 0 20 20" style={{ width: size, height: size }} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" stroke="rgb(255 255 255 / .16)" strokeWidth="2.6" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={tint(a)} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />
    </svg>
  );
}
/** a little equaliser while something plays; a pause glyph when it's paused */
function Bars({ a }: { a: Live }) {
  if (a.paused) return <Pause className="size-3.5 shrink-0" style={{ color: tint(a), fill: tint(a) }} aria-label="Paused" />;
  return (
    <span className="flex h-3.5 shrink-0 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map(i => <i key={i} className="island-bar w-[3px] rounded-full" style={{ background: tint(a), animationDelay: `${i * -.23}s` }} />)}
    </span>
  );
}
function Art({ a, size }: { a: Live; size: number }) {
  return a.image
    ? <img src={a.image} alt="" className="shrink-0 object-cover" style={{ width: size, height: size, borderRadius: size * .28 }} />
    : <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `color-mix(in srgb, ${tint(a)} 22%, transparent)`, color: tint(a) }}>
        <Icon name={a.icon} className="size-[55%]" />
      </span>;
}

/** A progress ring with the activity's artwork or icon inside, so a bubble says what it is at a glance. */
function Badge({ a, size }: { a: Live; size: number }) {
  const r = 15, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, a.pct ?? 0)), inner = size - 9;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {a.pct != null && (
        <svg viewBox="0 0 34 34" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle cx="17" cy="17" r={r} fill="none" stroke="rgb(255 255 255 / .16)" strokeWidth="2.4" />
          <circle cx="17" cy="17" r={r} fill="none" stroke={tint(a)} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />
        </svg>
      )}
      {a.image ? <img src={a.image} alt="" className="rounded-full object-cover" style={{ width: inner, height: inner }} />
        : <Icon name={a.icon} className="size-3.5" />}
    </span>
  );
}

export default function Island({ live, idle, docked, notice, position = 'top', label = true }: { live: Live[]; idle: 'notch' | 'hide'; docked: boolean; notice?: Notice | null; position?: 'top' | 'top-left' | 'top-right' | 'bottom'; label?: boolean }) {
  // a notice springs the island open for a few seconds, then it settles back to whatever's live
  const [shout, setShout] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShout(notice);
    const t = setTimeout(() => setShout(s => (s?.n === notice.n ? null : s)), 5200);
    return () => clearTimeout(t);
  }, [notice]);
  const [open, setOpen] = useState(false);
  const small = useRef<HTMLDivElement>(null), big = useRef<HTMLDivElement>(null), loud = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const expanded = open && live.length > 0;
  // a change is a new title or state; progress and speeds tick all the time and aren't news
  const [quiet, setQuiet] = useState(false), news = live.map(a => `${a.key}:${a.title}:${a.paused ?? ''}:${a.tone ?? ''}`).join('|');
  useEffect(() => {
    setQuiet(false);
    if (open || shout || !live.length) return;
    const t = setTimeout(() => setQuiet(true), QUIET_AFTER);
    return () => clearTimeout(t);
  }, [news, open, !!shout]);

  // the shell springs between the measured sizes of whichever layer is showing
  useLayoutEffect(() => {
    const el = (shout ? loud : expanded ? big : small).current; if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, live.length, shout]);
  useEffect(() => { if (!live.length) setOpen(false); }, [live.length]);

  if (!live.length && !shout && (idle === 'hide' || !docked)) return null;
  const [main, ...rest] = live;
  const layer = 'absolute top-0 left-1/2 w-max -translate-x-1/2 transition-[opacity,filter,scale] ease-out';

  return (
    <div className={cn('island-wrap z-40 flex justify-center', position === 'bottom' ? 'fixed bottom-5 left-1/2 -translate-x-1/2' : !docked ? 'sticky top-2 pt-1' : { top: 'fixed top-0 left-1/2 -translate-x-1/2', 'top-left': 'fixed top-0 left-24', 'top-right': 'fixed top-0 right-24' }[position])}
      onPointerEnter={e => { if (e.pointerType === 'mouse') { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 90); } }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 220); } }}>
      <div className="flex items-start gap-2">
        <div role={live.length ? 'button' : undefined} tabIndex={live.length ? 0 : -1} aria-expanded={expanded} aria-label={live.length ? 'Live activities' : undefined}
          onClick={e => { if ((e.nativeEvent as PointerEvent).pointerType !== 'mouse') setOpen(o => !o); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } if (e.key === 'Escape') setOpen(false); }}
          className={cn('island relative overflow-hidden bg-black text-white outline-none', docked ? 'island-docked' : 'rounded-[22px]', (expanded || shout) && 'island-open', live.length && 'cursor-pointer')}
          style={size ? { width: size.w, height: size.h } : undefined}>
          {/* compact: the most important activity */}
          <div ref={small} aria-hidden={expanded}
            className={cn(layer, 'duration-200', expanded || shout ? 'pointer-events-none scale-95 opacity-0 blur-[3px]' : 'opacity-100 delay-100 duration-300')}>
            <div className={cn('flex h-[44px] items-center gap-3 pr-4 pl-2', label && !quiet && 'min-w-[280px]', quiet && 'gap-2 pr-3', !live.length && 'h-[30px] w-[170px] min-w-0 p-0')}>
              {main && quiet ? (<>
                <Art a={main} size={28} />
                <span className="island-dot size-2 flex-none rounded-full" style={{ background: tint(main) }} />
              </>) : main && (<>
                <Art a={main} size={28} />
                {label && <span key={main.key} className="tick max-w-[260px] flex-1 truncate text-[14px] font-medium tracking-[-.01em]">{main.title}</span>}
                <span className={cn('flex items-center', label && 'ml-3')}>{main.icon === 'play' ? <Bars a={main} /> : main.pct != null ? <Progress a={main} /> : main.trailing && <span className="text-[11.5px] tabular text-white/60">{main.trailing}</span>}</span>
              </>)}
            </div>
          </div>
          {/* a notice: icon or artwork, the news, a line under it */}
          <div ref={loud} aria-live="polite" className={cn(layer, shout ? 'opacity-100 delay-100 duration-300' : 'pointer-events-none scale-95 opacity-0 blur-[3px] duration-200')}>
            {shout && (
              <div className="flex h-[58px] min-w-[300px] items-center gap-3 pr-5 pl-2.5">
                {shout.image ? <img src={shout.image} alt="" className="size-10 rounded-[11px] object-cover" />
                  : <span className="grid size-10 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${TONE[shout.tone]} 22%, transparent)`, color: TONE[shout.tone] }}><Icon name={shout.icon ?? 'pulse'} className="size-5" /></span>}
                <span className="min-w-0">
                  <span className="block max-w-[300px] truncate text-[14px] font-semibold">{shout.text}</span>
                  {shout.sub && <span className="block max-w-[300px] truncate text-[12px] text-white/55">{shout.sub}</span>}
                </span>
              </div>
            )}
          </div>
          {/* open: everything that's live */}
          <div ref={big} aria-hidden={!expanded}
            className={cn(layer, expanded && !shout ? 'opacity-100 delay-100 duration-300' : 'pointer-events-none scale-[.97] opacity-0 blur-[3px] duration-150')}>
            <div className="w-[min(420px,calc(100vw-24px))] space-y-1 p-3 pt-4">
              {live.map((a, i) => (
                <a key={a.key} href={a.href} target="_blank" rel="noreferrer" tabIndex={expanded ? 0 : -1} onClick={e => e.stopPropagation()}
                  style={{ '--i': i } as React.CSSProperties} className={cn('flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-white/[.07]', expanded && 'island-row')}>
                  <span className="relative shrink-0">
                    <Art a={a} size={44} />
                    {/* which app it's from, on the corner like a phone's notification */}
                    {a.source?.icon && <span className="absolute right-0.5 bottom-0.5 grid size-[18px] place-items-center rounded-[5px] bg-black/75 backdrop-blur-sm"><img src={a.source.icon} alt={a.source.name} className="size-3.5 object-contain" /></span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{a.title}</span>
                    {a.subtitle && <span className="block truncate text-[12px] text-white/55">{a.subtitle}</span>}
                    {a.pct != null && (
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/15">
                        <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.round(a.pct * 100)}%`, background: tint(a) }} />
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] tabular text-white/60">{a.icon === 'play' && <Bars a={a} />}{a.trailing}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
        {/* the others ride alongside as bubbles, like the iPhone's split island: artwork inside a progress ring */}
        {rest.slice(0, 2).map(a => (
          <div key={a.key} title={`${a.title}${a.trailing ? ` · ${a.trailing}` : ''}`}
            className={cn('island-bubble grid shrink-0 place-items-center rounded-full bg-black text-white transition-[opacity,scale] duration-300',
              docked ? 'mt-1 size-[36px]' : 'size-[42px]', (expanded || shout || quiet) && 'pointer-events-none scale-50 opacity-0')}>
            <Badge a={a} size={docked ? 34 : 36} />
          </div>
        ))}
      </div>
    </div>
  );
}
