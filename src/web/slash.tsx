// The message box's menus: `/` at the start offers the chat's commands, `@` anywhere offers the integrations, both
// narrowed as you type. Keys stay in the box (arrows move, Tab or Enter choose, Esc closes), so nothing steals focus from
// what's being written. What a command does is the chat's (assistant.tsx); this only offers and fills in.
import { createContext, Fragment, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { BUILTINS, LEVELS, builtinOf, filterMenu, matchModel, parseSlash } from '../shared/slash.ts';

/** A custom command as the page knows it: its name, what it's for, and whether it takes words after it. */
export interface Slash { name: string; description?: string; input?: boolean }
export interface Mentionable { id: string; name: string }
export interface Item { key: string; name: string; also?: string[]; description?: string; hint?: string; kind: 'command' | 'arg' | 'mention'; takes?: boolean }

const LEVEL_WORDS: Record<string, string> = { auto: 'As the config says', off: 'No thinking first', low: 'A little', medium: 'Some', high: 'As much as it likes' };

/** What a built-in needs from the chat it runs in. */
export interface SlashChat {
  commands: Slash[]; busy: boolean; external?: string; model: string; models: { id: string; model: string; label: string }[]; hasPicker: boolean; discover?: boolean;
  say: (n: { text?: string; help?: boolean }) => unknown; choose: (id: string) => void; think: (v: typeof LEVELS[number]) => void; startOver: () => void;
  openModels: () => void; openReasoning: () => void; findListed: (q: string) => void; compact: () => void;
}

/** A built-in, run: true if `text` was one, or a command name that isn't anything (which says so). A custom command is
 *  false: it goes as typed, and the server sends its prompt. Nothing here acts on anything but this chat. */
export function runSlash(text: string, c: SlashChat): boolean {
  const s = parseSlash(text);
  if (!s) return false;
  const b = builtinOf(s.name);
  if (!b) {
    if (c.commands.some(x => x.name === s.name)) return false;
    c.say({ text: `There's no /${s.name} command. /help lists them.` });
    return true;
  }
  if (c.external && b.name !== 'new' && b.name !== 'help') { c.say({ text: `/${b.name} is Valet's own, and ${c.external} runs on its own.` }); return true; }
  const waiting = () => { if (c.busy) c.say({ text: 'It is still answering. Wait, or press Stop first.' }); return c.busy; };
  switch (b.name) {
    case 'help': c.say({ help: true }); break;
    case 'new': c.startOver(); break;
    case 'model': {
      if (!s.input) { if (c.hasPicker) c.openModels(); else c.say({ text: `This chat has one model: ${c.model}.` }); break; }
      const hit = c.hasPicker ? matchModel(s.input, c.models) : undefined;
      if (hit) { c.choose(hit.id); c.say({ text: `This chat is on ${hit.label} now.` }); }
      else if (c.discover && !c.external) c.findListed(s.input);
      else c.say({ text: c.hasPicker ? `No model matches “${s.input}”. /model on its own lists them.` : `This chat has one model: ${c.model}.` });
      break;
    }
    case 'reasoning': {
      if (!s.input) { c.openReasoning(); break; }
      const v = LEVELS.find(l => l === s.input.toLowerCase());
      if (!v) c.say({ text: `Reasoning is one of ${LEVELS.join(', ')}.` });
      else { c.think(v); c.say({ text: v === 'auto' ? 'Reasoning is back to what the config says.' : `Reasoning is ${v} for this chat.` }); }
      break;
    }
    case 'compact': if (!waiting()) c.compact(); break;
  }
  return true;
}

/** What the box is asking for right now, from what's typed and where the caret is. */
export function menuFor(draft: string, caret: number, o: { commands: Slash[]; integrations: Mentionable[]; models: { id: string; label: string }[] }): { items: Item[]; from: number; to: number; kind: Item['kind'] } | null {
  // `/mo`: a command's name, still being typed
  const cmd = /^\/([a-z0-9-]*)$/.exec(draft.slice(0, caret));
  if (cmd && caret === draft.length) {
    const builtins: Item[] = BUILTINS.map(b => ({ key: `b:${b.name}`, name: b.name, also: b.aliases, description: b.description, hint: b.args, kind: 'command', takes: !!b.args }));
    const mine: Item[] = o.commands.map(c => ({ key: `c:${c.name}`, name: c.name, description: c.description, hint: c.input ? 'text' : undefined, kind: 'command', takes: !!c.input }));
    return { items: filterMenu([...builtins, ...mine], cmd[1]), from: 0, to: caret, kind: 'command' };
  }
  // `/model dee`, `/reasoning lo`: the choices it takes
  const arg = /^\/(model|reasoning)\s+(\S*)$/.exec(draft.slice(0, caret));
  if (arg && caret === draft.length) {
    const list: Item[] = arg[1] === 'model' ? o.models.map(m => ({ key: `m:${m.id}`, name: m.label, also: [m.id], kind: 'arg' }))
      : LEVELS.map(l => ({ key: `r:${l}`, name: l, description: LEVEL_WORDS[l], kind: 'arg' }));
    return { items: filterMenu(list, arg[2]), from: draft.length - arg[2].length, to: caret, kind: 'arg' };
  }
  // `@pl`: an integration, anywhere a word starts
  const at = /(^|[\s(,])@([a-z0-9_-]*)$/i.exec(draft.slice(0, caret));
  if (at && o.integrations.length) {
    const list: Item[] = o.integrations.map(i => ({ key: `i:${i.id}`, name: i.id, also: [i.name], description: i.name !== i.id ? i.name : undefined, kind: 'mention' }));
    return { items: filterMenu(list, at[2]), from: caret - at[2].length - 1, to: caret, kind: 'mention' };
  }
  return null;
}

/** The menu's state for one message box. `run` is Enter on a command that needs nothing more. */
export function useComposerMenu(o: { draft: string; setDraft: (s: string) => void; box: React.RefObject<HTMLTextAreaElement | null>; commands: Slash[]; integrations: Mentionable[]; models: { id: string; label: string }[]; run: (text: string) => void }) {
  const [caret, setCaret] = useState(0), [index, pick] = useState(0), [shut, setShut] = useState<string | null>(null);
  // whether a row was picked by arrow or pointer: `/model ` with nothing after it and nothing picked sends as it is
  const moved = useRef(false), setIndex = (n: number | ((i: number) => number)) => { moved.current = true; pick(n); };
  const found = menuFor(o.draft, caret, o);
  const menu = found && found.items.length && shut !== o.draft ? found : null;
  const sig = menu ? `${menu.kind}:${menu.items.map(i => i.key).join(',')}` : '';
  useEffect(() => { pick(0); moved.current = false; }, [sig]);
  // Esc closes the menu, not the chat around it: a dialog hears Escape on the way down, so it's caught before that
  const open = !!menu, draftNow = o.draft;
  useEffect(() => {
    if (!open) return;
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && document.activeElement === o.box.current) { e.stopPropagation(); e.preventDefault(); setShut(draftNow); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, draftNow]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sync = () => { const el = o.box.current; if (el) setCaret(el.selectionStart ?? el.value.length); };
  const place = (text: string, at: number) => { o.setDraft(text); setCaret(at); requestAnimationFrame(() => { const el = o.box.current; if (el) { el.focus(); el.setSelectionRange(at, at); } }); };
  const choose = (item: Item, how: 'tab' | 'enter') => {
    if (!menu) return;
    if (item.kind === 'command') {
      // Enter on a command that takes nothing runs it; anything else fills it in, ready for what comes after
      if (how === 'enter' && !item.takes) { o.run(`/${item.name}`); return; }
      place(`/${item.name} `, item.name.length + 2);
      return;
    }
    if (item.kind === 'arg') {
      const value = item.key.slice(2), text = `${o.draft.slice(0, menu.from)}${value}`;
      if (how === 'enter') { o.run(text); return; }
      place(`${text} `, text.length + 1);
      return;
    }
    const before = `${o.draft.slice(0, menu.from)}@${item.name} `, after = o.draft.slice(menu.to).replace(/^\s+/, '');
    place(before + after, before.length);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || e.nativeEvent.isComposing) return false;
    const n = menu.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShut(o.draft); return true; }
    if (e.key === 'Enter' && menu.kind === 'arg' && menu.from === menu.to && !moved.current) return false;
    if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); choose(menu.items[Math.min(index, n - 1)], e.key === 'Tab' ? 'tab' : 'enter'); return true; }
    return false;
  };
  return { menu, index, setIndex, choose, onKey, sync, id: 'composer-menu' };
}

/** The menu itself, just above the box: the quiet popover look, a pointer on every row. */
export function ComposerMenu({ m }: { m: ReturnType<typeof useComposerMenu> }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [m.index]);
  if (!m.menu) return null;
  const { items, kind } = m.menu;
  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-2 flex justify-start">
      <div ref={list} id={m.id} role="listbox" aria-label={kind === 'mention' ? 'Integrations' : kind === 'arg' ? 'Choices' : 'Commands'}
        data-chat-menu="" className="composer-menu max-h-64 w-[min(24rem,100%)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 duration-(--dur-pop)">
        {items.map((it, i) => (
          <div key={it.key} id={`${m.id}-${i}`} role="option" aria-selected={i === m.index} data-selected={i === m.index || undefined}
            onPointerMove={() => m.setIndex(i)} onPointerDown={e => e.preventDefault()} onClick={() => m.choose(it, 'enter')}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-item select-none data-[selected]:bg-accent data-[selected]:text-accent-foreground">
            <span className="shrink-0 font-medium">{kind === 'command' ? `/${it.name}` : kind === 'mention' ? `@${it.name}` : it.name}</span>
            {it.hint && <span className="shrink-0 font-mono text-meta text-muted-foreground">{it.hint}</span>}
            {it.description && <span className="ml-auto min-w-0 truncate pl-2 text-meta text-muted-foreground">{it.description}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The integrations this chat can mention, for drawing `@plex` in a sent message as a token. */
export const Mentions = createContext<Set<string>>(new Set());

/** A sent message's words with each known `@id` drawn as a small token. */
export function WithMentions({ text }: { text: string }) {
  const ids = useContext(Mentions);
  if (!ids.size || !text.includes('@')) return <>{text}</>;
  const lower = new Map([...ids].map(id => [id.toLowerCase(), id]));
  return <>{text.split(/((?:^|(?<=[\s(,]))@[a-z0-9][a-z0-9_-]*)/gi).map((t, i) => {
    const id = t.startsWith('@') ? lower.get(t.slice(1).toLowerCase()) : undefined;
    return id ? <span key={i} className="mention rounded-tag bg-fill-2 px-1 py-px font-medium">@{id}</span> : <Fragment key={i}>{t}</Fragment>;
  })}</>;
}

/** /help, as a quiet list in the chat. */
export function HelpNote({ commands }: { commands: Slash[] }) {
  const row = (name: string, hint: string | undefined, words: string | undefined) => (
    <li key={name} className="flex gap-2"><span className="shrink-0 font-medium text-foreground/85">/{name}{hint ? <span className="ml-1 font-mono text-meta text-muted-foreground">{hint}</span> : null}</span><span className="min-w-0">{words}</span></li>
  );
  return (
    <div className="space-y-2">
      <ul className="space-y-1">{BUILTINS.map(b => row(b.name, b.args, `${b.description}${b.aliases ? ` (also /${b.aliases.join(', /')})` : ''}`))}</ul>
      {commands.length > 0 && <><div className="pt-1 text-meta">Yours</div><ul className="space-y-1">{commands.map(c => row(c.name, c.input ? 'text' : undefined, c.description))}</ul></>}
      <div>Type @ to name an integration, so its tools are used first.</div>
    </div>
  );
}

/** A line from Valet in the chat that the model never sees: what a command did, or why it couldn't. */
export function Note({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return <div role="status" className={cn('chat-note text-body text-muted-foreground', busy && 'chat-shimmer')}>{children}</div>;
}
