// A collection, laid out as tall strips of its photos: the one under the pointer or the finger slides open and says what
// it is. The pictures keep their size and the strip around them moves, so they never stretch. Nothing runs at rest.
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PhotosCard } from '../shared/cards.ts';
import './album.css';

export function Album({ card }: { card: PhotosCard }) {
  const [open, setOpen] = useState(0), items = card.items.slice(0, 9);
  return (
    <div className="album" role="group" aria-label={card.title ?? 'Photos'}>
      {items.map((p, i) => (
        <button key={p.image} type="button" aria-pressed={i === open} aria-label={p.title ?? `Photo ${i + 1}`} className={cn('album-strip', i === open && 'is-open')}
          onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(i); }} onFocus={() => setOpen(i)} onClick={() => setOpen(i)}>
          <img src={p.image} alt="" draggable={false} loading="lazy" />
          {(p.title || p.subtitle) && <span className="album-note"><b>{p.title}</b>{p.subtitle && <i>{p.subtitle}</i>}</span>}
        </button>
      ))}
    </div>
  );
}
