// The pickers under the message box: which model this chat is on (assistant.models) and how much it thinks first. A few
// models are a plain menu; many (a router's hundreds, with `auto`) become a list you type to narrow, with what you've
// picked lately near the top and each listed server's models under its own heading. The server says which models there
// are and refuses anything else, so this only offers.
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface Choice { id: string; model: string }
/** A model a server listed: the id the chat knows it by, the server's own id when that differs, a name the server gave it,
 *  and its server's heading. */
export interface Listed { id: string; model?: string; label?: string; group: string }

/** Past this many choices the menu becomes a list you can search. */
export const SEARCH_FROM = 8;
/** At most this many of the servers' models are drawn at once, all headings together; typing narrows the rest. */
export const SHOWN = 100;
const RECENT = 'valet-models-recent', KEEP = 5;

const recent = (): string[] => { try { const r = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(r) ? r.filter(x => typeof x === 'string').slice(0, KEEP) : []; } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, KEEP))); } catch { /* private mode: nothing kept */ } };

// plain words under the message box: no box, the small print's size, a pointer, and the ink on hover
const TRIGGER = 'h-auto min-w-0 cursor-pointer gap-1 rounded-sm border-0 bg-transparent p-0 text-meta leading-4 text-muted-foreground shadow-none hover:text-foreground focus-visible:text-foreground dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3';
const ITEM = 'cursor-pointer';

/** What a choice is called: the default by its model, a configured one by its name. */
const nameOf = (c: Choice, i: number) => i ? c.id : c.model;

/** The model menu. `models` is the default first, then the configured choices; `discover` adds what the servers list. */
/** `open` and `onOpenChange` let /model open it from the message box. */
export interface Opened { open?: boolean; onOpenChange?: (open: boolean) => void }

export function ModelPicker({ models, discover, value, onChange, open, onOpenChange }: { models: Choice[]; discover?: boolean; value?: string; onChange: (id: string) => void } & Opened) {
  const current = value ?? models[0].id;
  if (!discover && models.length <= SEARCH_FROM) return (
    <Select value={current} onValueChange={onChange} open={open} onOpenChange={onOpenChange}>
      <SelectTrigger aria-label="Model" className={TRIGGER}><SelectValue /></SelectTrigger>
      <SelectContent data-chat-menu="" position="popper" side="top" align="end">{models.map((m, i) => <SelectItem key={m.id} value={m.id} className={ITEM}>{nameOf(m, i)}</SelectItem>)}</SelectContent>
    </Select>
  );
  return <SearchPicker models={models} discover={discover} current={current} onChange={onChange} open={open} onOpenChange={onOpenChange} />;
}

function SearchPicker({ models, discover, current, onChange, ...told }: { models: Choice[]; discover?: boolean; current: string; onChange: (id: string) => void } & Opened) {
  const [own, setOwn] = useState(false), [query, setQuery] = useState('');
  const open = told.open ?? own, setOpen = (v: boolean) => { setOwn(v); told.onOpenChange?.(v); };
  const [found, setFound] = useState<{ list: Listed[]; failed: string[]; ok: boolean; loading: boolean }>({ list: [], failed: [], ok: true, loading: false });
  const [lately, setLately] = useState<string[]>([]);
  const asking = useRef(0);
  const load = (fresh = false) => {
    if (!discover) return;
    const n = ++asking.current;
    setFound(f => ({ ...f, loading: true }));
    fetch(`/api/models${fresh ? '?fresh=1' : ''}`).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((j: { ok: boolean; models: Listed[]; servers?: { title: string; ok: boolean }[] }) => {
        if (n === asking.current) setFound({ list: j.models, failed: (j.servers ?? []).filter(s => !s.ok).map(s => s.title), ok: j.ok, loading: false });
      })
      .catch(() => { if (n === asking.current) setFound(f => ({ ...f, ok: false, loading: false })); });
  };
  useEffect(() => { if (open) { load(); setLately(recent()); setQuery(''); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = new Set(models.map(m => m.id));
  const byId = useMemo(() => new Map(found.list.map(m => [m.id, m])), [found.list]);
  const many = models.length + found.list.length > SEARCH_FROM;
  // one server's own heading; several get one each (On the server, openrouter.ai, Claude…)
  const titled = many || new Set(found.list.map(m => m.group)).size > 1;
  const q = query.trim().toLowerCase(), hit = (s?: string) => !q || (!!s && s.toLowerCase().includes(q));
  const hits = (m: Listed) => hit(m.id) || hit(m.model) || hit(m.label);
  const shown = useMemo(() => {
    const configured = models.map((m, i) => ({ m, i })).filter(({ m, i }) => hit(m.id) || hit(m.model) || hit(nameOf(m, i)));
    const recents = many ? lately.flatMap(id => { const m = byId.get(id); return m && !pinned.has(id) && hits(m) ? [m] : []; }) : [];
    const skip = new Set(recents.map(m => m.id)), groups = new Map<string, Listed[]>();
    let drawn = 0, more = 0;
    for (const m of found.list) {
      if (skip.has(m.id) || !hits(m)) continue;
      if (drawn >= SHOWN) { more++; continue; }
      drawn++;
      const g = groups.get(m.group) ?? [];
      groups.set(m.group, g);
      g.push(m);
    }
    return { configured, recents, groups: [...groups], more };
  }, [models, found.list, lately, q, many]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a listed model shows its name (or its own id; the heading says which server); the trigger keeps its place while the list loads
  const words = (m: Listed) => m.label ?? m.model ?? m.id;
  const label = (() => { const i = models.findIndex(m => m.id === current); if (i >= 0) return nameOf(models[i], i); const m = byId.get(current); return m ? words(m) : current; })();
  const pick = (id: string) => { remember(id); onChange(id); setOpen(false); };
  const item = (id: string, words: string, hint?: string) => (
    <CommandItem key={id} value={id} onSelect={() => pick(id)} data-current={id === current || undefined} className={`${ITEM} data-[current]:font-medium`}>
      <span className="min-w-0 truncate">{words}</span>
      {hint && <span className="ml-auto min-w-0 shrink truncate text-meta text-muted-foreground">{hint}</span>}
    </CommandItem>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Model" className={`flex w-fit items-center whitespace-nowrap outline-hidden ${TRIGGER}`}>
        <span className="min-w-0 truncate">{label}</span><ChevronDown className="opacity-50" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-slot="popover-content" data-chat-menu="" side="top" align="end" sideOffset={6} collisionPadding={12}
          // keys go to the list: its search field when there is one, else the list itself (arrows, Enter)
          onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[cmdk-input], [cmdk-root]')?.focus(); }}
          className="z-50 w-[min(22rem,calc(100vw-24px))] origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {/* the list is filtered here, not by cmdk: hundreds of models, and only the first hundred matches drawn */}
          <Command shouldFilter={false} loop className="bg-transparent" label="Model">
            {many && <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder="Search models" aria-label="Search models" />}
            <CommandList className="max-h-[min(360px,var(--radix-popover-content-available-height,360px))]">
              <CommandEmpty>{found.loading ? 'Looking…' : 'No model matches.'}</CommandEmpty>
              {!!shown.configured.length && <CommandGroup heading={many ? 'Configured' : undefined}>
                {shown.configured.map(({ m, i }) => item(m.id, nameOf(m, i), i && m.id !== m.model ? m.model : !i ? 'default' : undefined))}
              </CommandGroup>}
              {!!shown.recents.length && <CommandGroup heading="Recent">{shown.recents.map(m => item(m.id, words(m), titled ? m.group : undefined))}</CommandGroup>}
              {shown.groups.map(([group, list]) => <CommandGroup key={`g:${group}`} heading={titled ? group : undefined}>{list.map(m => item(m.id, words(m), m.label ? m.model ?? m.id : undefined))}</CommandGroup>)}
              {shown.more > 0 && <p className="px-3 pt-1 pb-2 text-meta text-muted-foreground">{shown.more} more. Keep typing to narrow it down.</p>}
              {discover && <CommandGroup className="border-t">
                {!found.ok && <p className="px-2 pt-1 pb-1.5 text-meta text-muted-foreground">{found.failed.length
                  ? `Couldn't get the list from ${found.failed.join(', ')}, so ${found.failed.length > 1 ? 'their' : 'its'} models may be missing.`
                  : "Couldn't get the server's list, so only the configured models are here."}</p>}
                <CommandItem value="valet:refresh" onSelect={() => load(true)} className={`${ITEM} text-muted-foreground`}>
                  <RotateCcw className={found.loading ? 'animate-spin' : undefined} />Refresh the list
                </CommandItem>
              </CommandGroup>}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type Thinking = 'auto' | 'off' | 'low' | 'medium' | 'high';
const LEVELS: [Thinking, string][] = [['auto', 'Auto'], ['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];

/** How much the model thinks first, for this chat. Auto is whatever the config says for the model. */
export function ReasoningPicker({ value, onChange, open, onOpenChange }: { value: Thinking; onChange: (v: Thinking) => void } & Opened) {
  return (
    <Select value={value} onValueChange={v => onChange(v as Thinking)} open={open} onOpenChange={onOpenChange}>
      <SelectTrigger aria-label="Reasoning" title="Reasoning" className={`${TRIGGER} shrink-0 text-muted-foreground/70`}><SelectValue>{LEVELS.find(l => l[0] === value)?.[1]}</SelectValue></SelectTrigger>
      <SelectContent data-chat-menu="" position="popper" side="top" align="end">
        <SelectGroup><SelectLabel>Reasoning</SelectLabel>
          {LEVELS.map(([v, words]) => <SelectItem key={v} value={v} className={ITEM}>{words}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
