// What's happening right now, as rings beside the system's own: artwork inside, how far along around it, and the whole
// story on hover or tap, the same way every other ring tells it.
import { Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Activity } from '../shared/cards.ts';
import { Icon, Popover } from './cards.tsx';

export type Live = Activity & { key: string; href?: string; source?: { name: string; icon?: string } };
export type Notice = { key: string; text: string; sub?: string; icon?: string; image?: string; tone: 'good' | 'warn' | 'bad' | 'accent'; n: number };

const TONE: Record<string, string> = { accent: 'var(--primary)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };
const tint = (a: Live) => TONE[a.tone ?? ''] ?? (a.icon === 'play' ? 'var(--primary)' : a.icon === 'download' ? '#64d2ff' : 'var(--good)');

function Story({ a }: { a: Live }) {
  const title = <span className="block truncate text-[14px] font-medium">{a.title}</span>;
  return (
    <div className="flex items-center gap-3 p-3">
      {a.image ? <img src={a.image} alt="" className="h-[72px] w-12 shrink-0 rounded-lg object-cover" /> : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10"><Icon name={a.icon} className="size-5" /></span>}
      <div className="min-w-0 flex-1">
        {a.href ? <a href={a.href} target="_blank" rel="noreferrer" className="title-link">{title}</a> : title}
        {a.subtitle && <div className="truncate text-[13px] text-muted-foreground">{a.subtitle}</div>}
        {a.pct != null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full transition-transform duration-(--dur-move) ease-out" style={{ background: tint(a), transform: `translateX(${Math.round(a.pct * 100) - 100}%)` }} /></div>}
        <div className="mt-1.5 flex justify-between gap-3 text-[12px] text-muted-foreground tabular">
          <span className="truncate">{a.paused ? 'Paused' : a.source?.name}</span>{a.trailing && <span className="shrink-0">{a.trailing}</span>}
        </div>
      </div>
    </div>
  );
}

export function LiveRings({ live }: { live: Live[] }) {
  return live.map(a => {
    const r = 15, c = 2 * Math.PI * r, arc = c * .75, p = Math.max(0, Math.min(1, a.pct ?? 0));
    return (
      <div key={a.key} className="group/ring relative flex flex-col items-center outline-none" tabIndex={0} aria-label={[a.title, a.subtitle, a.trailing].filter(Boolean).join(', ')}>
        <div className="relative size-[clamp(26px,7.7vw,32px)] transition-transform duration-(--dur-pop) ease-out group-hover/ring:scale-110 sm:size-[38px]">
          <svg viewBox="0 0 38 38" className="size-full rotate-[135deg]" aria-hidden>
            <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
            {a.pct != null && <circle cx="19" cy="19" r={r} fill="none" stroke={tint(a)} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${Math.max(.001, p) * arc} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move) ease-out" />}
          </svg>
          <div className="absolute inset-[7px] grid place-items-center overflow-hidden rounded-full sm:inset-[8px]">
            {a.image ? <img src={a.image} alt="" className={cn('size-full object-cover', a.paused && 'opacity-40')} /> : <Icon name={a.icon} className="size-3.5" />}
            {a.paused && <Pause className="absolute size-3 fill-white text-white" aria-hidden />}
          </div>
        </div>
        <div className="-mt-1 max-w-[56px] truncate max-sm:hidden! text-[10px] font-medium text-muted-foreground sm:block">{a.title}</div>
        <Popover group="ring" className="right-1/2 w-[300px] translate-x-1/2"><Story a={a} /></Popover>
      </div>
    );
  });
}
