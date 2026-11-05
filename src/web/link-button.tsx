// A button that opens a link from someone else's words (a meeting's Join, from an invitation): only https opens, in a new
// tab with no way back to this page, and its host is always said.
import { Video } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Link } from '../shared/cards.ts';

/** A `Button` for joining a call, in the meeting's blue (--meeting): small and tinted beside an event; `big` fills its popover. */
export function LinkButton({ link, big, className }: { link: Link; big?: boolean; className?: string }) {
  const u = (() => { try { return new URL(link.href); } catch { return null; } })();
  if (!u || u.protocol !== 'https:') return null;
  return (
    <a href={u.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={[link.note, u.host].filter(Boolean).join(' · ')} aria-label={`${link.label}${link.note && !link.label.includes(link.note) ? ` on ${link.note}` : ''} (${u.host})`}
      data-slot="button" className={big ? buttonVariants({ variant: 'solid', size: 'lg', className: cn('meeting-join w-full gap-2 text-white', className) })
        : buttonVariants({ variant: 'tonal', size: 'sm', className: cn('meeting-chip', className) })}>
      <Video className={big ? 'size-icon-lg' : 'size-icon'} aria-hidden />{link.label}
    </a>
  );
}

