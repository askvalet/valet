// An album (`view: album`): a trip's photos large and in a row, each at its own shape, the one in the middle whole and its
// neighbours peeking either side; the place and the month sit on the one in the middle, and the header counts where you are.
// A `Row` (Blossom Carousel, after its Slideshow example: snapping to the centre, each picture drifting a little inside its
// frame as it passes, a CSS scroll-driven animation on the compositor). The first and last sit at the inset, so the row
// starts full. The count marks the photo it's on, which is lit and captioned; a page asked to hold still gets a plain row.
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import type { PhotosCard } from '../shared/cards.ts';
import { HeadActions, oneByOne, Row, RowArrows } from './feel.tsx';
import './album.css';

type Photo = PhotosCard['items'][number];

export function Album({ card }: { card: PhotosCard }) {
  const id = useId(), items = card.items, title = card.title ?? 'Photos', box = useRef<HTMLDivElement>(null);
  // the photos are as tall as the box, which its row may stretch: told once per resize, never per frame
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => el.style.setProperty('--h', `${el.clientHeight}px`);
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div className="album">
      <HeadActions><Count id={id} n={items.length} /><RowArrows id={id} one label={title} /></HeadActions>
      <div ref={box} className="album-box bleed"><Slides id={id} items={items} title={title} /></div>
    </div>
  );
}

/** "3 / 9", and the photo it's on, which is lit and captioned: the one nearest the middle, or the first or last when the row is
 *  at an end (they sit at the inset, not the middle). Read when the row comes to rest, never per frame. */
function Count({ id, n }: { id: string; n: number }) {
  const [on, setOn] = useState(0);
  useEffect(() => {
    const r = document.getElementById(id); if (!r) return;
    let t = 0;
    const read = () => {
      const all = [...r.querySelectorAll<HTMLElement>(':scope > [data-blossom-slide]')], end = r.scrollWidth - r.clientWidth, mid = r.scrollLeft + r.clientWidth / 2;
      let at = 0, gap = Infinity;
      all.forEach((s, i) => { const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid); if (d < gap) { gap = d; at = i; } });
      if (r.scrollLeft < 2) at = 0; else if (r.scrollLeft > end - 2) at = all.length - 1;
      all.forEach((s, i) => s.toggleAttribute('data-on', i === at));
      setOn(at);
    };
    const settle = () => { clearTimeout(t); t = window.setTimeout(read, 90); };
    read(); r.addEventListener('scroll', settle, { passive: true }); r.addEventListener('scrollend', read);
    const ro = new ResizeObserver(settle); ro.observe(r);
    return () => { clearTimeout(t); r.removeEventListener('scroll', settle); r.removeEventListener('scrollend', read); ro.disconnect(); };
  }, [id, n]);
  return <span className="mr-1.5 text-meta text-muted-foreground tabular">{on + 1} / {n}</span>;
}

/** A photo's own shape, once it has loaded (3:2 until then, the usual camera's). */
const shape = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  if (img.naturalWidth && img.naturalHeight) img.parentElement?.style.setProperty('--r', String(img.naturalWidth / img.naturalHeight));
};

const Slides = memo(function Slides({ id, items, title }: { id: string; items: Photo[]; title: string }) {
  const linked = items.some(p => p.href), { tap } = oneByOne(id);
  return (
    <Row id={id} one className="album-track" role="group" aria-roledescription="carousel" aria-label={title} tabIndex={linked ? undefined : 0}>
      {items.map((p, i) => {
        const Slide = p.href ? 'a' : 'div', name = [p.title, p.subtitle].filter(Boolean).join(', ') || `Photo ${i + 1}`;
        return (
          <Slide key={p.image} data-blossom-slide className="album-slide" aria-label={`${name}, ${i + 1} of ${items.length}`}
            {...(p.href ? { href: p.href, target: '_blank', rel: 'noreferrer', draggable: false } : { role: 'group', 'aria-roledescription': 'slide' })}
            onClick={(e: MouseEvent<HTMLElement>) => tap(e, i)}>
            <img src={p.image} alt="" draggable={false} loading={i < 3 ? 'eager' : 'lazy'} onLoad={shape} />
            {(p.title || p.subtitle) && <span className="album-cap" aria-hidden><b>{p.title}</b>{p.subtitle && <i>{p.subtitle}</i>}</span>}
          </Slide>
        );
      })}
    </Row>
  );
}, (a, b) => a.id === b.id && a.title === b.title && (a.items === b.items || JSON.stringify(a.items) === JSON.stringify(b.items)));
