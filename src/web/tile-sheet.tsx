// A tile's full card, opened over the page. The tile flips: it lifts from its place, turns over in 3D as it grows, and its
// back is the card; the page dims as it comes. Closing turns it back into the tile's place, however it's closed (×, a
// tap outside, Escape), and from wherever it is, so closing halfway through opening just turns it back.
//
// One number drives all of it: `p`, from 0 (the tile in its place) to 1 (the card open), moved by a spring (Motion).
// Where the card is, how big, how far it has turned, which face shows, the tile and its copy cross-fading, the page's
// dim: each is worked out from `p` every frame. A spring with a little bounce carries `p` just past 1 and back, which is
// the overshoot as it lands. Only transform and opacity change. With less motion asked for, the card just fades.
import { XIcon } from 'lucide-react';
import { animate, motionValue, type AnimationPlaybackControls } from 'motion';
import { Dialog as Primitive } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const OPEN = { type: 'spring', visualDuration: .55, bounce: .2 } as const;
const CLOSE = { type: 'spring', visualDuration: .4, bounce: 0 } as const;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /\bmotion-(reduced|none)\b/.test(document.documentElement.className);
const onScreen = (r: DOMRect) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** 0 at p = 0, 1 by p = `by`: the cross-fade at the tile's end of the turn */
const early = (p: number, by = .16) => clamp(p / by);

export function TileSheet({ tile, title, onClosed, children }: { tile: HTMLElement | null; title: string; onClosed: () => void; children: ReactNode }) {
  // the card is in a portal, which puts it on the page a commit after this one: it starts when it's actually there
  const wrap = useRef<HTMLDivElement | null>(null), [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const front = useRef<HTMLDivElement>(null), back = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null);
  const p = useRef(motionValue(0)).current, run = useRef<AnimationPlaybackControls | null>(null);
  const leaving = useRef(false), plain = useRef(false);
  // where the tile is, as a move from the card's own place: its centre's offset, and its size against the card's
  const home = useRef({ x: 0, y: 0, sx: 1, sy: 1 });

  const measure = () => {
    const card = wrap.current;
    if (!card || !tile) return;
    // the card's own place, without whatever transform it has this frame
    const t = tile.getBoundingClientRect(), c = { left: card.offsetLeft, top: card.offsetTop, width: card.offsetWidth, height: card.offsetHeight };
    const stage = card.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const cl = stage.left + c.left, ct = stage.top + c.top;
    home.current = { x: t.left + t.width / 2 - (cl + c.width / 2), y: t.top + t.height / 2 - (ct + c.height / 2), sx: t.width / c.width, sy: t.height / c.height };
  };

  // the tile's own face, copied onto the front of the card, drawn at the tile's size and stretched to the card's, so the
  // first frame is the tile exactly where it was
  const dress = () => {
    const box = front.current, card = wrap.current;
    if (!box || !card || !tile) return;
    const t = tile.getBoundingClientRect(), face = tile.cloneNode(true) as HTMLElement;
    face.removeAttribute('role'); face.removeAttribute('tabindex'); face.setAttribute('inert', ''); face.style.visibility = 'visible'; face.style.opacity = '1';
    const inner = box.firstElementChild as HTMLElement;
    inner.replaceChildren(face);
    Object.assign(inner.style, { width: `${t.width}px`, height: `${t.height}px`, transform: `scale(${card.offsetWidth / t.width}, ${card.offsetHeight / t.height})` });
  };

  // every frame: all of it from p
  const draw = (v: number) => {
    const card = wrap.current;
    if (!card) return;
    if (plain.current) { card.style.opacity = String(clamp(v)); if (dim.current) dim.current.style.opacity = String(clamp(v)); return; }
    const { x, y, sx, sy } = home.current, k = 1 - v;   // k: how far from open; past 1, v overshoots a touch
    card.style.transform = `translate(${x * k}px, ${y * k}px) scale(${sx + (1 - sx) * v}, ${sy + (1 - sy) * v}) rotateY(${-180 * k}deg)`;
    // exactly one face: the card while it faces you (Safari's backface-visibility can't be trusted with a face that has
    // layers of its own), the tile once it's past edge-on
    const facing = v >= .5;
    if (back.current) back.current.style.visibility = facing ? '' : 'hidden';
    if (front.current) { front.current.style.visibility = facing ? 'hidden' : ''; front.current.style.opacity = String(early(v)); }
    // the page's glass tile and the card's solid copy of it cross-fade where they lie on top of each other
    if (tile) tile.style.opacity = String(1 - early(v));
    if (dim.current) dim.current.style.opacity = String(clamp(v * 1.4));
    // the × comes in as the card nears flat, so it's there the moment it lands
    if (!leaving.current) card.classList.toggle('settled', v > .85);
  };
  const settle = (flat: boolean) => {
    const card = wrap.current;
    if (!card) return;
    card.classList.toggle('flipping', !flat);
    card.classList.toggle('settled', flat);
    if (flat) { card.style.transform = ''; if (back.current) back.current.style.visibility = ''; }
  };

  useLayoutEffect(() => {
    const card = wrap.current;
    if (!card) return;
    const off = p.on('change', draw);
    plain.current = still() || !tile || !onScreen(tile.getBoundingClientRect());
    if (plain.current) tile?.style.setProperty('visibility', 'hidden');
    else { measure(); dress(); settle(false); }
    draw(0);
    run.current = animate(p, 1, plain.current ? { duration: .2, ease: 'easeOut' } : OPEN);
    run.current.finished.then(() => { if (!leaving.current) settle(true); });
    return () => { off(); run.current?.stop(); if (tile) { tile.style.opacity = ''; tile.style.removeProperty('visibility'); } };
  }, [mounted]);   // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    const card = wrap.current;
    if (leaving.current || !card) return;
    leaving.current = true;
    const r = tile?.getBoundingClientRect();
    // a tile scrolled out of sight, or less motion: the card just fades
    if (!plain.current && (still() || !r || !onScreen(r))) { plain.current = true; settle(true); tile?.style.removeProperty('visibility'); }
    if (!plain.current) { measure(); dress(); settle(false); }
    run.current?.stop();
    run.current = animate(p, 0, plain.current ? { duration: .16, ease: 'easeIn' } : CLOSE);
    run.current.finished.then(() => { if (tile) { tile.style.opacity = ''; tile.style.removeProperty('visibility'); } onClosed(); });
  };

  return (
    <Primitive.Root open onOpenChange={o => { if (!o) close(); }}>
      <Primitive.Portal>
        <div ref={dim} className="tile-dim fixed inset-0 z-50 bg-black/45" style={{ opacity: 0 }} aria-hidden />
        {/* the whole screen is the dialog, so a tap beside the card is ours to answer: it closes, turning back. It keeps
            taking taps while it does, so the rest of the tap can't land on the page underneath. The dialog turns the
            page's clicks off and its own on with an inline style, which this one replaces, so it says so itself */}
        {/* focus goes to the card itself, quietly: focusing a control inside it while it still turns would scroll it */}
        <Primitive.Content aria-describedby={undefined} onCloseAutoFocus={e => { e.preventDefault(); tile?.focus({ preventScroll: true }); }}
          onOpenAutoFocus={e => { e.preventDefault(); wrap.current?.focus({ preventScroll: true }); }}
          onPointerDown={e => { if (e.target === e.currentTarget) close(); }}
          className="tile-stage fixed inset-0 z-50 grid place-items-center p-4 outline-none" style={{ pointerEvents: 'auto' }}>
          <Primitive.Title className="sr-only">{title}</Primitive.Title>
          <div ref={el => { wrap.current = el; if (el && el !== mounted) setMounted(el); }} tabIndex={-1} className="tile-flip relative w-[min(44rem,calc(100vw-2rem))] outline-none">
            <div ref={back} className="tile-face tile-back relative max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-surface">{children}</div>
            <div ref={front} className="tile-face tile-front" aria-hidden><div className="tile-front-face" /></div>
            {/* it arrives once the card is near flat, and leaves the moment it starts back: never turning with it */}
            <Primitive.Close className="tile-close absolute top-3 right-3 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-black/45 text-white/90 hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
              <XIcon className="size-4" />
            </Primitive.Close>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
