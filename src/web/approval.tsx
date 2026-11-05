// What the chat and ⌘K's commands share: a tool's card that keeps itself current, and the card that asks before
// anything changes. Kept apart from assistant.tsx so a command can use them without loading the AI SDK.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BorderBeam } from 'border-beam';
import { cn } from '@/lib/utils';
import type { Card, Confirm } from '../shared/cards.ts';
import { Icon, Widget } from './cards.tsx';
import { acted, dissolve } from './dust.ts';
import { Tick } from './feel.tsx';
import { label } from './format.ts';
import { play } from './sound.ts';

export type ToolInfo = { label?: string; followUps?: string[]; access: 'read' | 'write' | 'control'; live?: boolean };

/** A card that keeps itself current while it's recent and on screen: downloads move, streams change. Nothing's sent when
 *  the tab is hidden, and after ten minutes it settles as it is. */
function useLive(first: Card, tool: string, input: unknown, on: boolean) {
  const [card, setCard] = useState(first), [live, setLive] = useState(on);
  useEffect(() => {
    if (!on) { setLive(false); return; }
    const started = Date.now();
    setLive(true);
    const t = setInterval(async () => {
      if (Date.now() - started > 600_000) { clearInterval(t); setLive(false); return; }
      if (document.hidden) return;
      const r = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, input }) }).catch(() => null);
      if (!r?.ok) return;
      const next = (await r.json()).card as Card;
      setCard(c => JSON.stringify(c) === JSON.stringify(next) ? c : next);
    }, 8000);
    return () => clearInterval(t);
  }, [on, tool, JSON.stringify(input)]);
  return { card, live };
}

export function ChatCard({ first, name, input, tools, fresh }: { first: Card; name: string; input: unknown; tools: Record<string, ToolInfo>; fresh?: boolean }) {
  const { card, live } = useLive(first, name, input ?? {}, !!fresh && (name === 'show' || !!tools[name]?.live));
  return (
    <div className="chat-card relative">
      {live && <span className="live-dot" title="Live" aria-label="Live" />}
      <Widget card={card} compact />
    </div>
  );
}

/** Asking before something happens: what it is, in words, and two buttons. The service supplies the words and the picture;
 *  until they arrive (`ready`), nobody can say yes to something it hasn't named yet. `children` lists what a plan or a
 *  config change will do. */
export function Approval({ said, title, detail, icon, ready, answer, children, width = 'min(560px, calc(100vw - 48px))' }: {
  said: (Confirm & { logo?: string }) | null; title: string; detail?: string; icon: string; ready: boolean; answer: (ok: boolean) => void; children?: ReactNode; width?: string;
}) {
  // a yes shows it took, a beat before the card gives way to what it set off; a no waves the card away
  const box = useRef<HTMLDivElement>(null), [chose, setChose] = useState<boolean | null>(null);
  const [broken, setBroken] = useState(false);   // a logo that doesn't load gives way to the icon, not to an empty gap
  const choose = (ok: boolean) => {
    if (chose != null) return;
    setChose(ok); play(ok ? 'done' : 'no');
    if (ok) { acted(); setTimeout(() => answer(true), 220); return; }
    dissolve(box.current?.closest('.is-asking') ?? box.current); answer(false);
  };
  const buttons = () => <>
    <button onClick={() => choose(false)} disabled={chose != null} className="press h-9 flex-1 rounded-sm px-4 text-item font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex-none">{label('notNow')}</button>
    <button disabled={!ready || chose != null} onClick={() => choose(true)} data-chosen={chose || undefined} className={cn('press approve relative h-9 flex-1 rounded-sm px-5 text-item font-medium transition-opacity sm:flex-none', chose ? '' : 'disabled:opacity-40', said?.danger ? 'bg-bad text-white' : 'bg-primary text-primary-foreground')}>
      <span className={cn('transition-opacity duration-(--dur-press)', chose && 'opacity-0')}>{said?.verb ?? label('allow')}</span>{chose && <Tick draw className="absolute inset-0 m-auto size-icon-lg" />}</button>
  </>;
  return (
    // a slow beam around the edge: nothing goes further until this has an answer
    <BorderBeam size="md" colorVariant={said?.danger ? 'sunset' : 'gold'} strength={.6} duration={3.2} className="chat-card is-asking rounded-surface" style={{ display: 'block', width }}>
    <div ref={box} className="overflow-hidden rounded-surface border bg-card shadow-card">
      <div className="flex items-center gap-3.5 p-3.5">
        {said?.image ? <img src={said.image} alt="" className="h-[84px] w-14 shrink-0 rounded-poster object-cover shadow-md" />
          : said?.logo && !broken ? <img src={said.logo} alt="" className="size-11 shrink-0 rounded-control object-contain" onError={() => setBroken(true)} />
          : <span className="grid size-11 shrink-0 place-items-center rounded-control bg-fill-2"><Icon name={said?.icon ?? icon} className="size-icon-lg" /></span>}
        <div className="min-w-0 flex-1">
          <div className="text-title leading-snug font-semibold text-pretty">{title}</div>
          {detail && <div className="mt-0.5 text-body leading-snug text-muted-foreground">{detail}</div>}
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">{buttons()}</div>
      </div>
      {children && <div className="px-3.5 pb-3.5">{children}</div>}
      <div className="flex gap-2 px-3.5 pb-3.5 sm:hidden">{buttons()}</div>
    </div>
    </BorderBeam>
  );
}
