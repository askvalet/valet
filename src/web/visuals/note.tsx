// The small honest parts the house's controls share: what a control can't do here, what it just did, a number that
// rolls, a word in a slot, a named swatch and the corner of a 3D model.
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './note.css';

/** The one way anything says "not from here": a small lock and a few words, where the control would be. */
export function Cant({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex min-w-0 items-start gap-1.5 text-[12px] leading-[1.35] text-muted-foreground', className)}>
      <svg viewBox="0 0 16 16" className="mt-px size-3 flex-none" aria-hidden><path fill="currentColor" fillRule="evenodd" d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" /></svg>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export interface Note { id: number; text: string; tone?: 'busy' | 'good' | 'warn' | 'bad'; undo?: () => void }
/** One line at a time. It lapses by itself, sooner than an Undo does; `ms: 0` holds it until something replaces it. */
export function useNote() {
  const [note, setNote] = useState<Note | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined), n = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string, o: Omit<Note, 'id' | 'text'> & { ms?: number } = {}) => {
    clearTimeout(timer.current); setNote({ id: ++n.current, text, tone: o.tone, undo: o.undo });
    const ms = o.ms ?? (o.undo ? 7000 : o.tone === 'bad' || o.tone === 'warn' ? 9000 : 5000);
    if (ms) timer.current = setTimeout(() => setNote(null), ms);
  };
  return [note, say] as const;
}
const TONES = { busy: 'text-foreground', good: 'text-foreground', warn: 'text-warn', bad: 'text-bad' };
/** What just happened, in the flow beside the control, with Undo while that's still possible. */
export function Said({ note, className }: { note: Note | null; className?: string }) {
  return (
    <div role="status" className={cn('flex min-h-8 min-w-0 items-center gap-2 text-[12.5px] leading-[1.35]', className)}>
      {note && <span key={note.id} className={cn('min-w-0 animate-in fade-in duration-200', TONES[note.tone ?? 'good'])}>{note.text}</span>}
      {note?.undo && <button onClick={note.undo} className="h-8 flex-none rounded-full px-2.5 font-medium text-primary hover:bg-foreground/10">Undo</button>}
    </div>
  );
}

/** A number where only the digits that changed move. Keyed from the right, so 9 → 10 leaves nothing to chase. */
export function Roll({ value, className }: { value: string; className?: string }) {
  const was = useRef(value), first = useRef(true);
  const from = [...was.current].reverse(), to = [...value];
  useEffect(() => { was.current = value; first.current = false; }, [value]);
  return (
    <span className={cn('tabular whitespace-nowrap', !first.current && 'roll-on', className)}>
      <span className="sr-only">{value}</span>
      {to.map((c, i) => { const back = to.length - 1 - i; return <span key={`${back}:${c}`} aria-hidden className={cn('roll', from[back] !== c && 'roll-new')}>{c}</span>; })}
    </span>
  );
}

/** Every word a button can say, stacked in one cell. `at` picks the one showing. */
export function Slots({ at, words }: { at: string; words: Record<string, ReactNode> }) {
  return <span className="slots">{Object.entries(words).map(([k, w]) => <span key={k} aria-hidden={k !== at} data-off={k !== at || undefined}>{w}</span>)}</span>;
}

/** A colour with a name, a hit area of 32px and a ring, inside that area, when it's the one in use. */
export function Swatch({ name, color, on, press, disabled }: { name: string; color: string; on: boolean; press: () => void; disabled?: boolean }) {
  return <button type="button" className="swatch press" aria-label={name} title={name} aria-pressed={on} disabled={disabled} onClick={press}><i style={{ background: color }} /></button>;
}

/** Sits over a 3D model: how to move it, and the way back to where it started. */
export function StageTools({ moved, reset, hint }: { moved: boolean; reset: () => void; hint?: string }) {
  return (
    <div className="stage-tools">
      {hint && <span className="hint">{hint}</span>}
      <button type="button" disabled={!moved} onClick={reset} title="Reset view"><RotateCcw className="size-4" aria-hidden />Reset view</button>
    </div>
  );
}
