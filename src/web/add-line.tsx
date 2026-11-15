// The line at the foot of a list or controls card that takes words ("New task…"): Enter or its button runs the card's
// action with what was typed, through the same door as a button (`run`), so it's only drawn where a button would work.
import { Plus } from 'lucide-react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { addOf, type AddField } from '../shared/cards.ts';
import type { RunAction } from './cards.tsx';
import { play } from './sound.ts';
import { Touch } from './touch.ts';

/** How long the words wait for their row before they're cleared anyway: a service can be slow to list what it was given. */
const LAND = 2500;

/** `rows` names what the card lists now: once it changes after a send, the new row is there and the words leave the line
 *  in the same moment, so they never seem to vanish before they've landed. A failure keeps them and says why. */
export function AddLine({ add, run, rows, ruled }: { add: AddField; run: RunAction; rows: string; ruled?: boolean }) {
  const { arg, max } = addOf(add), touch = !!useContext(Touch), id = useId();
  const [text, setText] = useState(''), [phase, setPhase] = useState<'idle' | 'sending' | 'landing'>('idle'), [why, setWhy] = useState<string | null>(null);
  const sent = useRef(rows), timer = useRef<ReturnType<typeof setTimeout>>(undefined), box = useRef<HTMLInputElement>(null);
  const landed = () => { clearTimeout(timer.current); setText(''); setPhase('idle'); };
  useEffect(() => { if (phase === 'landing' && rows !== sent.current) landed(); }, [rows, phase]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const words = text.trim(), busy = phase !== 'idle';
  const send = async () => {
    if (!words || busy) return;
    if (words.length > max) { setWhy(`That's over ${max} characters`); play('no'); return; }
    setPhase('sending'); setWhy(null); sent.current = rows;
    try {
      await run(add.action, { ...add.args, [arg]: words });
      play('done'); setPhase('landing'); timer.current = setTimeout(landed, LAND);
    } catch (e) {
      play('no'); setPhase('idle'); setWhy((e as Error).message || "Couldn't add that");
    }
  };
  return (
    <div className={cn(ruled && 'border-t', 'add-line')}>
      <form className={cn('-mx-2 flex min-w-0 items-center gap-3 rounded-control px-2 transition-colors duration-(--dur-press) focus-within:bg-fill-1', touch ? 'min-h-14' : 'min-h-12')}
        onSubmit={e => { e.preventDefault(); void send(); }}>
        <label htmlFor={id} className="sr-only">{add.placeholder}</label>
        {/* read-only rather than disabled while it sends: a disabled field loses focus, and a phone would drop its keyboard */}
        <input id={id} ref={box} value={text} readOnly={busy} aria-busy={busy || undefined} maxLength={max} placeholder={add.placeholder}
          aria-invalid={why ? true : undefined} aria-describedby={why ? `${id}-why` : undefined}
          enterKeyHint="done" autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck
          onChange={e => { setText(e.target.value); if (why) setWhy(null); }}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) setText(''); setWhy(null); box.current?.blur(); } }}
          className={cn('h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground [@media(pointer:fine)]:text-item', busy && 'text-muted-foreground', touch && 'text-title')} />
        <button type="submit" aria-label={add.placeholder.replace(/…$|\.\.\.$/, '') || 'Add'} disabled={!words || busy}
          className={cn('press grid shrink-0 place-items-center rounded-full transition-colors duration-(--dur-press) disabled:cursor-default', touch ? 'size-11' : 'size-8',
            words && !busy ? 'bg-foreground text-(--card-tint)' : 'bg-fill-1 text-muted-foreground')}>
          {busy ? <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : <Plus className="size-icon" />}
        </button>
      </form>
      {why && <p id={`${id}-why`} role="alert" className="pb-2 text-meta text-bad">{why}</p>}
    </div>
  );
}
