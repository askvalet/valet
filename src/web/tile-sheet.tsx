// A tile's full card, opened over the page. The tile flips: it lifts from its place, turns over in 3D as it grows, and its
// back is the card. It overshoots by a few degrees and settles, and the page dims as it comes. Closing plays it backwards into the tile's place, however it's closed (×, a tap outside,
// Escape). Only transform and opacity move, so it stays smooth. With less motion asked for, the card just fades in.
import { XIcon } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const OPEN_MS = 720, CLOSE_MS = 440;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /\bmotion-(reduced|none)\b/.test(document.documentElement.className);

/** Where the tile is now, as a move from the card's own place: its centre's offset, and its size against the card's. */
function from(tile: Element, card: Element) {
  const t = tile.getBoundingClientRect(), c = card.getBoundingClientRect();
  return { x: t.left + t.width / 2 - (c.left + c.width / 2), y: t.top + t.height / 2 - (c.top + c.height / 2), sx: t.width / c.width, sy: t.height / c.height, t, c };
}
const onScreen = (r: DOMRect) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

export function TileSheet({ tile, title, onClosed, children }: { tile: HTMLElement | null; title: string; onClosed: () => void; children: ReactNode }) {
  // the card is in a portal, which puts it on the page a commit after this one: the flip starts when it's actually there
  const wrap = useRef<HTMLDivElement | null>(null), [mounted, setMounted] = useState<HTMLDivElement | null>(null), front = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);

  // the tile's own face, copied onto the front of the card, drawn at the tile's size and stretched to the card's, so the
  // first frame is the tile exactly where it was
  const dress = () => {
    const box = front.current, card = wrap.current;
    if (!box || !card || !tile) return;
    const t = tile.getBoundingClientRect(), c = card.getBoundingClientRect();
    const face = tile.cloneNode(true) as HTMLElement;
    face.removeAttribute('role'); face.removeAttribute('tabindex'); face.setAttribute('inert', ''); face.style.visibility = 'visible';
    const inner = box.firstElementChild as HTMLElement;
    inner.replaceChildren(face);
    Object.assign(inner.style, { width: `${t.width}px`, height: `${t.height}px`, transform: `scale(${c.width / t.width}, ${c.height / t.height})` });
  };

  useLayoutEffect(() => {
    const card = wrap.current;
    if (!card) return;
    tile?.style.setProperty('visibility', 'hidden');   // it has lifted off the page
    const gone = () => { tile?.style.removeProperty('visibility'); };
    if (still() || !tile || !onScreen(tile.getBoundingClientRect())) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still() ? 120 : 220, easing: 'ease-out' });
      dim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      return gone;
    }
    dress();
    const m = from(tile, card), lift = `translate(${m.x}px, ${m.y}px) scale(${m.sx}, ${m.sy})`;
    card.classList.add('flipping');
    busy.current = true;
    const a = card.animate([
      { transform: `${lift} rotateY(-180deg)` },
      { transform: 'translate(0, 0) scale(1.012, 1.012) rotateY(7deg)', offset: .72, easing: 'cubic-bezier(.3, .7, .3, 1)' },
      { transform: 'none' },
    ], { duration: OPEN_MS, easing: 'cubic-bezier(.2, .75, .25, 1)' });
    dim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * .7, easing: 'ease-out' });
    // the × comes in as the card settles, within a few degrees of flat, so it's there the moment it lands
    const settle = setTimeout(() => card.classList.add('settled'), OPEN_MS * .6);
    a.onfinish = () => { card.classList.remove('flipping'); busy.current = false; };
    a.oncancel = () => clearTimeout(settle);
    return gone;
  }, [mounted]);   // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    const card = wrap.current;
    if (leaving || !card) return;
    setLeaving(true);
    const done = () => { tile?.style.removeProperty('visibility'); onClosed(); };
    const r = tile?.getBoundingClientRect();
    dim.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    if (still() || !tile || !r || !onScreen(r)) {
      card.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = done;
      return;
    }
    dress();
    const m = from(tile, card);
    card.classList.remove('settled');
    card.classList.add('flipping');
    card.animate([
      { transform: 'none' },
      { transform: `translate(${m.x}px, ${m.y}px) scale(${m.sx}, ${m.sy}) rotateY(-180deg)` },
    ], { duration: CLOSE_MS, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' }).onfinish = done;
  };

  return (
    <Primitive.Root open onOpenChange={o => { if (!o) close(); }}>
      <Primitive.Portal>
        <div ref={dim} className="tile-dim fixed inset-0 z-50 bg-black/45" aria-hidden />
        {/* the whole screen is the dialog, so a tap beside the card is ours to answer: it closes, flipping back */}
        {/* focus goes to the card itself, quietly: focusing a control inside it while it still turns would scroll it */}
        <Primitive.Content aria-describedby={undefined} onCloseAutoFocus={e => { e.preventDefault(); tile?.focus({ preventScroll: true }); }}
          onOpenAutoFocus={e => { e.preventDefault(); wrap.current?.focus({ preventScroll: true }); }}
          onPointerDown={e => { if (e.target === e.currentTarget) close(); }}
          // the dialog turns the page's clicks off and its own back on with an inline style, which this one replaces: so it says
          // so itself, and only stops them while the card flips home
          className="tile-stage fixed inset-0 z-50 grid place-items-center p-4 outline-none" style={{ pointerEvents: leaving ? 'none' : 'auto' }}>
          <Primitive.Title className="sr-only">{title}</Primitive.Title>
          <div ref={el => { wrap.current = el; if (el && el !== mounted) setMounted(el); }} tabIndex={-1} className="tile-flip relative w-[min(44rem,calc(100vw-2rem))] outline-none">
            <div className="tile-face tile-back relative max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-surface">
              {children}
            </div>
            <div ref={front} className="tile-face tile-front" aria-hidden>
              <div className="tile-front-face" />
            </div>
            {/* it arrives once the card has landed, and leaves the moment it starts back: never turning with it */}
            <Primitive.Close className="tile-close absolute top-3 right-3 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-black/45 text-white/90 hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
              <XIcon className="size-4" />
            </Primitive.Close>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
