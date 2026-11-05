// Focus (`view: focus`): the artwork large, one at a time, its neighbours peeking either
// side, smaller and dimmer, and the name of the one in the middle under it. A Blossom carousel: native scrolling and
// snapping, thrown with momentum on a mouse. How big each one is comes from where it sits, through a CSS scroll-driven
// animation on the compositor, so nothing is written per frame; a browser without it, or a page asked to hold still,
// shows a plain row. The one in the middle tints a soft glow behind the row, and that's the only part that re-renders.
import { BlossomCarousel, useBlossomNavigation } from '@blossom-carousel/react';
import { memo, useEffect, useId, useLayoutEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfCard, ShelfItem } from '../shared/cards.ts';
import { centre, glide, lean, nearest, RowArrows, slidesOf } from './feel.tsx';
import './focus.css';

/** Where it opens: near the middle, on something with artwork, so there's something either side. */
export const openAt = (items: ShelfItem[]) => {
  const mid = Math.floor((items.length - 1) / 2);
  return items.map((it, i) => ({ i, off: Math.abs(i - mid) })).filter(x => items[x.i].image).sort((a, b) => a.off - b.off)[0]?.i ?? mid;
};

export function Focus({ card, header }: { card: ShelfCard; header?: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">{header}<RowArrows id={id} one label={card.title} className="ml-auto" /></div>
      <div className={cn('focus', card.aspect && `is-${card.aspect}`)}>
        <Glow id={id} items={card.items} />
        <Slides id={id} card={card} />
      </div>
    </div>
  );
}

const Slides = memo(function Slides({ id, card }: { id: string; card: ShelfCard }) {
  const items = card.items;
  useLayoutEffect(() => { const r = document.getElementById(id); if (r) centre(r, openAt(items), 'instant'); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const linked = items.some(it => it.href), { key, tap } = oneByOne(id);
  return (
    <BlossomCarousel id={id} className="focus-track" role="group" aria-roledescription="carousel" aria-label={card.title} tabIndex={linked ? undefined : 0} onKeyDown={key}>
      {items.map((it, i) => {
        const Slide = it.href ? 'a' : 'div';
        return (
          <Slide key={i} data-blossom-slide {...(it.href ? { href: it.href, target: '_blank', rel: 'noreferrer', draggable: false } : { role: 'group', 'aria-roledescription': 'slide' })} className="focus-slide"
            aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ''}`} onClick={(e: MouseEvent<HTMLElement>) => tap(e, i)} onPointerMove={lean} onPointerLeave={lean}>
            <span className={cn('focus-art poster', !it.image && 'is-blank')}>
              {it.image ? <img src={it.image} alt="" draggable={false} loading="lazy" /> : <span className="focus-name">{it.title}</span>}
              {it.mark && <img src={it.mark} alt="" draggable={false} loading="lazy" className="focus-mark" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            </span>
            <span className="focus-cap" aria-hidden><b>{it.title}</b>{it.subtitle && <small>{it.subtitle}</small>}</span>
          </Slide>
        );
      })}
    </BlossomCarousel>
  );
}, (a, b) => a.id === b.id && (a.card === b.card || (a.card.title === b.card.title && JSON.stringify(a.card.items) === JSON.stringify(b.card.items))));

/** How a carousel with one thing in the middle moves: the arrow keys and Home/End move by one and take the focus along, at
 *  once because it's a key; a click on one at the side brings it to the middle, and the one in the middle opens. */
export function oneByOne(id: string) {
  const root = () => document.getElementById(id);
  const focusable = (s?: HTMLElement) => s && (s.matches('a, button') ? s : s.querySelector<HTMLElement>('a, button'));
  return {
    key(e: KeyboardEvent<HTMLElement>) {
      const r = root(); if (!r) return;
      const all = slidesOf(r), on = all.findIndex(s => s.contains(document.activeElement));
      const from = on >= 0 ? on : nearest(r), to = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: all.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const i = Math.max(0, Math.min(all.length - 1, to));
      centre(r, i, 'instant');
      if (on >= 0) focusable(all[i])?.focus({ preventScroll: true });
    },
    tap(e: MouseEvent<HTMLElement>, i: number) {
      const r = root();
      if (r && nearest(r) !== i) { e.preventDefault(); centre(r, i, glide(r)); }
    },
  };
}

/** The middle one's colours, blurred behind the row. The newest fades in over the one before, which then goes. */
export function Glow({ id, items }: { id: string; items: ShelfItem[] }) {
  const { activeIndex } = useBlossomNavigation(id), src = items[activeIndex]?.image;
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => { if (src) setShown(s => s.at(-1) === src ? s : [...s.slice(-1), src]); }, [src]);
  return <div className="focus-glow" aria-hidden>{shown.map(s => <img key={s} src={s} alt="" />)}</div>;
}
