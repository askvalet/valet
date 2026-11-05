// Masonry (`view: masonry`), after Blossom Carousel's example: pictures in a wall three rows high, some twice as wide or twice
// as tall, packed with CSS grid's dense flow, that you throw sideways and that snaps to every fourth one. Plain CSS on a
// `Row`, so it scrolls, drags and pages with the keys like any other row, and the tiles sit in a `memo`. In a card that's
// taller than the wall (a tall card, or a row that stretches it), the rows grow to fill it and the tiles grow with them.
import { memo, useId } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfItem } from '../shared/cards.ts';
import { HeadActions, Row, RowArrows } from './feel.tsx';
import './masonry.css';

type Tile = Pick<ShelfItem, 'title' | 'subtitle' | 'image' | 'badge' | 'href'>;

export function Masonry({ items, title, aspect }: { items: Tile[]; title?: string; aspect?: 'poster' | 'square' | 'wide' }) {
  const id = useId(), shown = items.filter(it => it.image);
  return (
    <div className="masonry-box bleed min-w-0">
      <HeadActions><RowArrows id={id} label={title} /></HeadActions>
      <Wall id={id} items={shown} title={title} aspect={aspect} />
    </div>
  );
}

const Wall = memo(function Wall({ id, items, title, aspect }: { id: string; items: Tile[]; title?: string; aspect?: string }) {
  return (
    <Row id={id} role="group" aria-roledescription="carousel" aria-label={title} tabIndex={items.some(it => it.href) ? undefined : 0} className={cn('masonry', aspect === 'poster' && 'is-poster')}>
      {items.map((it, i) => {
        const name = [it.title, it.subtitle].filter(Boolean).join(', ') || undefined;
        const inner = <>
          <img src={it.image} alt="" draggable={false} loading="lazy" />
          {(it.badge || it.title) && <span className="masonry-cap">{it.badge && <b>{it.badge}</b>}{it.title && <span>{it.title}</span>}</span>}
        </>;
        return it.href
          ? <a key={i} data-blossom-slide href={it.href} target="_blank" rel="noreferrer" draggable={false} aria-label={name} className="masonry-tile">{inner}</a>
          : <div key={i} data-blossom-slide role="img" aria-label={name} className="masonry-tile">{inner}</div>;
      })}
    </Row>
  );
}, (a, b) => a.id === b.id && a.title === b.title && a.aspect === b.aspect && (a.items === b.items || JSON.stringify(a.items) === JSON.stringify(b.items)));
