// Focus (`view: focus`): the artwork large, one at a time, its neighbours peeking either
// side, smaller and dimmer, and the name of the one in the middle under it. A Blossom carousel: native scrolling and
// snapping, thrown with momentum on a mouse. How big each one is comes from where it sits, through a CSS scroll-driven
// animation on the compositor, so nothing is written per frame; a browser without it, or a page asked to hold still,
// shows a plain row. The one in the middle tints a soft glow behind the row, and that's the only part that re-renders.
import { useBlossomNavigation } from '@blossom-carousel/react';
import { memo, useEffect, useId, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfCard, ShelfItem } from '../shared/cards.ts';
import { HeadActions, lean, oneByOne, Row, RowArrows } from './feel.tsx';
import './focus.css';

/** Where it opens: near the middle, on something with artwork, so there's something either side. */
export const openAt = (items: ShelfItem[]) => {
  const mid = Math.floor((items.length - 1) / 2);
  return items.map((it, i) => ({ i, off: Math.abs(i - mid) })).filter(x => items[x.i].image).sort((a, b) => a.off - b.off)[0]?.i ?? mid;
};

export function Focus({ card }: { card: ShelfCard }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <HeadActions><RowArrows id={id} one label={card.title} /></HeadActions>
      <div className={cn('focus', card.aspect && `is-${card.aspect}`, 'bleed')}>
        <Glow id={id} items={card.items} />
        <Slides id={id} card={card} />
      </div>
    </div>
  );
}

const Slides = memo(function Slides({ id, card }: { id: string; card: ShelfCard }) {
  const items = card.items;
  const linked = items.some(it => it.href), { tap } = oneByOne(id);
  return (
    <Row id={id} one start={openAt(items)} className="focus-track" role="group" aria-roledescription="carousel" aria-label={card.title} tabIndex={linked ? undefined : 0}>
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
    </Row>
  );
}, (a, b) => a.id === b.id && (a.card === b.card || (a.card.title === b.card.title && JSON.stringify(a.card.items) === JSON.stringify(b.card.items))));

/** The middle one's colours, blurred behind the row. The newest fades in over the one before, which then goes. */
export function Glow({ id, items }: { id: string; items: ShelfItem[] }) {
  const { activeIndex } = useBlossomNavigation(id), src = items[activeIndex]?.image;
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => { if (src) setShown(s => s.at(-1) === src ? s : [...s.slice(-1), src]); }, [src]);
  return <div className="focus-glow" aria-hidden>{shown.map(s => <img key={s} src={s} alt="" />)}</div>;
}
