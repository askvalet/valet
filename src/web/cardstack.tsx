// Cards (`view: cards`), after Blossom Carousel's iMessage-style example: a stack of cards, the one in front square on,
// the next ones fanned out behind it either side. Scroll it, throw it, or use the arrows and it deals the next one to the
// front. Every card is sticky in its own column of a Blossom carousel and a CSS scroll-driven animation turns, scales and
// layers it by where its column is, so nothing is written per frame (only a mouse pulling past an end bends the stack, as
// Blossom's example does). A browser without it, or a page asked to hold still, shows a plain row of the same cards.
import { Archive, ArrowUpRight, FileText } from 'lucide-react';
import { memo, useEffect, useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ShelfItem } from '../shared/cards.ts';
import { oneByOne, Row, RowArrows, still } from './feel.tsx';
import './cardstack.css';

export function CardStack({ items, title, header, aside, archive, leaving }: {
  items: ShelfItem[]; title?: string; header?: ReactNode; aside?: ReactNode;
  archive?: (id: string, el: Element | null) => void; leaving?: string[];
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">{header}<span className="ml-auto flex items-center gap-3">{aside}<RowArrows id={id} one label={title} /></span></div>
      <div className="deck"><Deck id={id} items={items} title={title} archive={archive} leaving={leaving} /></div>
    </div>
  );
}

const Deck = memo(function Deck({ id, items, title, archive, leaving }: { id: string; items: ShelfItem[]; title?: string; archive?: (id: string, el: Element | null) => void; leaving?: string[] }) {
  const { tap } = oneByOne(id);
  // a mouse pulling past either end bends the whole stack a little, as Blossom's example does; touch has its own overscroll
  useEffect(() => {
    const r = document.getElementById(id); if (!r) return;
    const bend = (e: Event) => {
      if (still(r)) return;
      const d = ((e as CustomEvent<{ left?: number }>).detail?.left ?? 0) * .2, w = r.clientWidth || 1;
      for (const c of r.children) (c as HTMLElement).style.transform = d ? `translateX(${d}px) rotate(${d / w * 70}deg) scale(${1 - Math.abs(d) / w})` : '';
    };
    r.addEventListener('overscroll', bend);
    return () => r.removeEventListener('overscroll', bend);
  }, [id]);
  return (
    <Row id={id} one className="deck-track" role="group" aria-roledescription="carousel" aria-label={title} tabIndex={items.some(it => it.href) ? undefined : 0}>
      {items.map((it, i) => {
        const line = [it.subtitle, it.badge && it.badge !== it.subtitle ? it.badge : undefined].filter(Boolean).join(' · ');
        return (
          <div key={it.id ?? i} data-blossom-slide className="deck-slide" style={{ '--i': i + 1 } as CSSProperties}
            {...(!it.href && { 'aria-roledescription': 'slide', 'aria-label': it.title })}>
            <div className={cn('deck-card', it.id && leaving?.includes(it.id) && 'is-leaving')}>
              {it.image ? <img src={it.image} alt="" draggable={false} loading="lazy" className="deck-page" /> : <span className="deck-blank"><FileText className="size-7" /></span>}
              {it.href && <a href={it.href} target="_blank" rel="noreferrer" draggable={false} aria-label={it.title} className="deck-open" onClick={(e: MouseEvent<HTMLElement>) => tap(e, i)} />}
              <span className="deck-text">
                {it.doc?.type && <span className="deck-kind">{it.doc.type}</span>}
                <b>{it.title}</b>
                {line && <small>{line}</small>}
              </span>
              {(archive && it.id || it.href) && <span className="deck-tools">
                {archive && it.id && <button type="button" aria-label={`Archive ${it.title}`} title="Archive" onClick={e => archive(it.id!, e.currentTarget.closest('.deck-card'))}><Archive className="size-icon" /></button>}
                {it.href && <a href={it.href} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden title="Open"><ArrowUpRight className="size-icon" /></a>}
              </span>}
            </div>
          </div>
        );
      })}
    </Row>
  );
}, (a, b) => a.id === b.id && a.title === b.title && a.archive === b.archive && (a.leaving ?? []).join() === (b.leaving ?? []).join() && (a.items === b.items || JSON.stringify(a.items) === JSON.stringify(b.items)));
