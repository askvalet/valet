// Cover flow (`view: coverflow`), after Blossom Carousel's own example: the one in the middle faces you, larger, and the
// rest turn away either side in 3D, close together, each with a faint reflection under it. A Blossom carousel, so it's the
// browser's own scrolling and snapping, thrown with momentum on a mouse. The turn comes from where each one sits, through a
// CSS scroll-driven animation, so nothing is written per frame; a browser without it, or a page asked to hold still, shows
// a plain row. The middle one's colours light the space behind it, and that's the only part that re-renders as it moves.
import { memo, useId, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfCard } from '../shared/cards.ts';
import { HeadActions, oneByOne, Row, RowArrows } from './feel.tsx';
import { Glow, openAt } from './focus.tsx';
import './coverflow.css';

export function CoverFlow({ card }: { card: ShelfCard }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <HeadActions><RowArrows id={id} one label={card.title} /></HeadActions>
      <div className={cn('cover', card.aspect && `is-${card.aspect}`, 'bleed')}>
        <Glow id={id} items={card.items} />
        <Covers id={id} card={card} />
      </div>
    </div>
  );
}

/** The covers themselves, which a live update bringing the same things back leaves alone. */
const Covers = memo(function Covers({ id, card }: { id: string; card: ShelfCard }) {
  const items = card.items;
  const linked = items.some(it => it.href), { tap } = oneByOne(id);
  return (
    <Row id={id} one start={openAt(items)} className="cover-track" role="group" aria-roledescription="carousel" aria-label={card.title} tabIndex={linked ? undefined : 0}>
      <ul className="cover-list">
        {items.map((it, i) => {
          const Turn = it.href ? 'a' : 'div', name = `${it.title}${it.subtitle ? `, ${it.subtitle}` : ''}`;
          return (
            <li key={i} data-blossom-slide className="cover-slide" {...(!it.href && { 'aria-roledescription': 'slide', 'aria-label': name })}>
              <Turn className="cover-turn" {...(it.href && { href: it.href, target: '_blank', rel: 'noreferrer', draggable: false, 'aria-label': name })} onClick={(e: MouseEvent<HTMLElement>) => tap(e, i)}>
                <span className={cn('cover-card', !it.image && 'is-blank')}>
                  {it.image ? <img src={it.image} alt="" draggable={false} loading="lazy" /> : <span className="cover-name">{it.title}</span>}
                  {it.mark && <img src={it.mark} alt="" draggable={false} loading="lazy" className="cover-mark" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                </span>
                <span className="cover-cap" aria-hidden><b>{it.title}</b>{it.subtitle && <small>{it.subtitle}</small>}</span>
              </Turn>
            </li>
          );
        })}
      </ul>
    </Row>
  );
}, (a, b) => a.id === b.id && (a.card === b.card || (a.card.title === b.card.title && a.card.aspect === b.card.aspect && JSON.stringify(a.card.items) === JSON.stringify(b.card.items))));
