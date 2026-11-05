// Nothing to show: one way to say so, inside the card's own frame, so an empty card is the same card with a quiet middle.
import type { CSSProperties, ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A centred icon and a line, and a way forward when there is one. `height` holds the card at the size it has with
 *  something in it, so a list that empties doesn't shrink its row; a card that fills its row grows past it. */
export function Empty({ icon: I = Inbox, text, action, height, className }: { icon?: LucideIcon; text: ReactNode; action?: ReactNode; height?: number; className?: string }) {
  return (
    <div className={cn('empty', className)} style={height ? { '--empty-h': `${height}px` } as CSSProperties : undefined}>
      <I className="size-icon-lg text-muted-foreground" aria-hidden />
      <p className="max-w-[36ch] text-item text-balance text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
