// A button that opens a link from someone else's words (a meeting's Join, from an invitation): only https opens, in a new
// tab with no way back to this page, and its host is always said.
import { Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Link } from '../shared/cards.ts';

/** `strong` is the one thing to do where it sits, in the accent. */
export function LinkButton({ link, strong, className }: { link: Link; strong?: boolean; className?: string }) {
  const u = (() => { try { return new URL(link.href); } catch { return null; } })();
  if (!u || u.protocol !== 'https:') return null;
  return (
    <a href={u.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={[link.note, u.host].filter(Boolean).join(' · ')} aria-label={`${link.label}${link.note ? ` on ${link.note}` : ''} (${u.host})`}
      className={cn('press inline-flex shrink-0 items-center gap-1.5 rounded-sm font-medium transition-colors', strong ? 'h-8 bg-primary px-3.5 text-[13px] text-primary-foreground' : 'h-6 bg-foreground/[.07] px-2.5 text-[12px] text-foreground/85 hover:bg-foreground/[.12]', className)}>
      <Video className={strong ? 'size-4' : 'size-3.5'} aria-hidden />{link.label}
    </a>
  );
}

