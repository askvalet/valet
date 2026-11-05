// What's happening right now, as rings beside the system's own: artwork inside, how far along around it, and the whole
// story on hover or tap, the same way every other ring tells it. Something at a set time (a meeting) counts itself down.
import { useEffect, useState } from 'react';
import { Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Activity } from '../shared/cards.ts';
import { Icon, Popover } from './cards.tsx';
import { LinkButton } from './link-button.tsx';
import { Meter } from './meter.tsx';

export type Live = Activity & { key: string; href?: string; source?: { name: string; icon?: string } };
export type Notice = { key: string; text: string; sub?: string; icon?: string; image?: string; tone: 'good' | 'warn' | 'bad' | 'accent'; n: number };

const TONE: Record<string, string> = { accent: 'var(--primary)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };
// a meeting is blue, the colour people know a call by, wherever it shows (the ring, its bar, its Join)
export const MEETING = '#0a84ff';
const tint = (a: Live) => a.link ? MEETING : TONE[a.tone ?? ''] ?? (a.icon === 'play' ? 'var(--primary)' : a.icon === 'download' ? '#64d2ff' : 'var(--good)');

/** Where a countdown is at `now`: the words, how far along, and the minutes for inside the ring. Over is null. */
export function counted(c: NonNullable<Activity['countdown']>, now: number) {
  if (c.end != null && now >= c.end) return null;
  if (now < c.start) {
    const mins = Math.ceil((c.start - now) / 6e4);
    return { text: mins <= 1 ? 'Starting now' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`, inside: mins < 60 ? `${mins}m` : undefined,
      pct: c.from != null && c.start > c.from ? Math.max(0, Math.min(1, (now - c.from) / (c.start - c.from))) : undefined };
  }
  const left = c.end != null ? Math.max(1, Math.ceil((c.end - now) / 6e4)) : undefined;
  return { text: left ? `Now · ${left} min left` : 'Now', inside: undefined, pct: c.end != null && c.end > c.start ? (now - c.start) / (c.end - c.start) : undefined };
}

/** The clock a countdown needs, ticking only while one is shown. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, [on]);
  return now;
}

const host = (href: string) => { try { return new URL(href).host; } catch { return ''; } };

function Story({ a, when }: { a: Live; when?: ReturnType<typeof counted> }) {
  if (a.link) return <Meeting a={a} when={when} />;
  const title = <span className="block truncate text-[14px] font-medium">{a.title}</span>;
  const pct = when ? when.pct : a.pct, trailing = when ? when.text : a.trailing;
  return (
    <div className="flex items-center gap-3 p-3">
      {a.image ? <img src={a.image} alt="" className="h-[72px] w-12 shrink-0 rounded-lg object-cover" /> : <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl bg-white/10', a.link && 'self-start')}><Icon name={a.icon} className="size-5" /></span>}
      <div className="min-w-0 flex-1">
        {a.href ? <a href={a.href} target="_blank" rel="noreferrer" className="title-link">{title}</a> : title}
        {a.subtitle && <div className="truncate text-[13px] text-muted-foreground">{a.subtitle}</div>}
        {pct != null && <Meter pct={pct} color={tint(a)} className="mt-2" />}
        <div className="mt-1.5 flex justify-between gap-3 text-[12px] text-muted-foreground tabular">
          <span className="truncate">{a.paused ? 'Paused' : (a.count ?? 0) > 1 && when ? `${a.count! - 1} more at the same time` : a.source?.name}</span>{trailing && <span className={cn('shrink-0', when && 'text-foreground/85')}>{trailing}</span>}
        </div>
      </div>
    </div>
  );
}

/** A meeting: what and when on top, how close it is, then one big Join. The link's address is on the button's tooltip. */
function Meeting({ a, when }: { a: Live; when?: ReturnType<typeof counted> }) {
  const [time, ...rest] = (a.subtitle ?? '').split(' · '), who = rest.join(' · ').replace(/^with /, '');
  const live = !!when && when.text.startsWith('Now');
  const status = live ? when!.text.replace(/ min left$/, 'm left') : when?.text.replace(/^in /, 'In ') ?? a.trailing;
  // people as small initials beside their names, all on the time's line: "Alex Chen, Priya Shah +1" → AC, PS, +1
  const extra = who.match(/\s*\+(\d+)$/), names = who.replace(/\s*\+\d+$/, '').split(/,\s*/).filter(Boolean), more = extra ? `+${extra[1]}` : undefined;
  const initials = (n: string) => n.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <div className="grid gap-2.5 p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[16px] font-semibold">{a.title}</span>
        {status && <span className="shrink-0 text-[13px] font-semibold tabular" style={{ color: MEETING }}>{status}</span>}
      </div>
      <div className="-mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        {time && <span className="shrink-0 tabular">{time}</span>}
        {names.length > 0 && <>
          <span className="flex shrink-0 -space-x-0.5" aria-hidden>
            {[...names.slice(0, 3).map(initials), ...(more ? [more] : [])].map((t, i) => (
              <span key={i} className="grid size-5 place-items-center rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,var(--popover))] text-[8.5px] font-semibold text-foreground/85 ring-[1.5px] ring-[var(--popover)]">{t}</span>
            ))}
          </span>
          <span className="min-w-0 truncate">{names.join(', ')}{more ? ` ${more}` : ''}</span>
        </>}
      </div>
      {live && when?.pct != null && <Meter pct={when.pct} color={MEETING} />}
      {(a.count ?? 0) > 1 && when && <div className="-mt-1 text-[12px] text-muted-foreground">{a.count! - 1} more at the same time</div>}
      <LinkButton link={{ ...a.link!, label: a.link!.note ? `Join ${a.link!.note}` : a.link!.label }} big />
    </div>
  );
}

export function LiveRings({ live }: { live: Live[] }) {
  const now = useNow(live.some(a => a.countdown));
  return live.map(a => {
    const when = a.countdown ? counted(a.countdown, now) : undefined;
    if (when === null) return null;   // it's over; the card just hasn't said so yet
    const r = 15, c = 2 * Math.PI * r, arc = c * .75, pct = when ? when.pct : a.pct, p = Math.max(0, Math.min(1, pct ?? 0));
    const more = (a.count ?? 0) > 1 && when ? `+${a.count! - 1}` : undefined;
    return (
      <div key={a.key} className="group/ring relative flex flex-col items-center outline-none" tabIndex={0} aria-label={[a.title, when?.text, a.subtitle, a.trailing, more && `${more} more`].filter(Boolean).join(', ')}>
        <div className="relative size-[clamp(26px,7.7vw,32px)] transition-transform duration-(--dur-pop) ease-out group-hover/ring:scale-110 sm:size-[38px]">
          <svg viewBox="0 0 38 38" className="size-full rotate-[135deg]" aria-hidden>
            <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
            {pct != null && <circle cx="19" cy="19" r={r} fill="none" stroke={tint(a)} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${Math.max(.001, p) * arc} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move) ease-out" />}
          </svg>
          <div className="absolute inset-[7px] grid place-items-center overflow-hidden rounded-full sm:inset-[8px]">
            {when?.inside ? <span className="text-[10px] leading-none font-semibold tabular sm:text-[11px]" aria-hidden>{when.inside}</span>
              : a.image ? <img src={a.image} alt="" className={cn('size-full object-cover', a.paused && 'opacity-40')} /> : <Icon name={a.icon} className="size-3.5" />}
            {a.paused && <Pause className="absolute size-3 fill-white text-white" aria-hidden />}
          </div>
          {more && <span className="ring-more absolute -top-1 -right-2 rounded-full bg-primary px-1 text-[9px] leading-[14px] font-semibold text-primary-foreground tabular" aria-hidden>{more}</span>}
        </div>
        <div className="-mt-1 max-w-[56px] truncate max-sm:hidden! text-[10px] font-medium text-muted-foreground sm:block">{a.title}</div>
        <Popover group="ring" className="right-1/2 w-[300px] translate-x-1/2"><Story a={a} when={when} /></Popover>
      </div>
    );
  });
}
