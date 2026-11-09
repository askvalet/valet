// The chat header's pickers: which model this chat is on (assistant.models) and how much it thinks first. A few models
// are a plain menu; many (a router's hundreds, with `auto`) become a list you type to narrow, with what you've picked
// lately near the top. The server says which models there are and refuses anything else, so this only offers.
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface Choice { id: string; model: string }

/** Past this many choices the menu becomes a list you can search. */
export const SEARCH_FROM = 8;
/** At most this many of the server's models are drawn at once; typing narrows the rest. */
export const SHOWN = 100;
const RECENT = 'valet-models-recent', KEEP = 5;

const recent = (): string[] => { try { const r = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(r) ? r.filter(x => typeof x === 'string').slice(0, KEEP) : []; } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, KEEP))); } catch { /* private mode: nothing kept */ } };

// plain words under the message box: no box, the small print's size, a pointer, and the ink on hover
const TRIGGER = 'h-auto min-w-0 cursor-pointer gap-1 rounded-sm border-0 bg-transparent p-0 text-meta leading-4 text-muted-foreground shadow-none hover:text-foreground focus-visible:text-foreground dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3';
const ITEM = 'cursor-pointer';

/** What a choice is called: the default by its model, a configured one by its name. */
const nameOf = (c: Choice, i: number) => i ? c.id : c.model;

/** The model menu. `models` is the default first, then the configured choices; `discover` adds the main server's list. */
export function ModelPicker({ models, discover, value, onChange }: { models: Choice[]; discover?: boolean; value?: string; onChange: (id: string) => void }) {
  const current = value ?? models[0].id;
  if (!discover && models.length <= SEARCH_FROM) return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger aria-label="Model" className={TRIGGER}><SelectValue /></SelectTrigger>
      <SelectContent position="popper" side="top" align="end">{models.map((m, i) => <SelectItem key={m.id} value={m.id} className={ITEM}>{nameOf(m, i)}</SelectItem>)}</SelectContent>
    </Select>
  );
  return <SearchPicker models={models} discover={discover} current={current} onChange={onChange} />;
}

function SearchPicker({ models, discover, current, onChange }: { models: Choice[]; discover?: boolean; current: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [found, setFound] = useState<{ ids: string[]; ok: boolean; loading: boolean }>({ ids: [], ok: true, loading: false });
  const [lately, setLately] = useState<string[]>([]);
  const asking = useRef(0);
  const load = (fresh = false) => {
    if (!discover) return;
    const n = ++asking.current;
    setFound(f => ({ ...f, loading: true }));
    fetch(`/api/models${fresh ? '?fresh=1' : ''}`).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((j: { ok: boolean; models: { id: string }[] }) => { if (n === asking.current) setFound({ ids: j.models.map(m => m.id), ok: j.ok, loading: false }); })
      .catch(() => { if (n === asking.current) setFound(f => ({ ...f, ok: false, loading: false })); });
  };
  useEffect(() => { if (open) { load(); setLately(recent()); setQuery(''); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = new Set(models.map(m => m.id));
  const known = new Set([...pinned, ...found.ids]);
  const many = models.length + found.ids.length > SEARCH_FROM;
  const q = query.trim().toLowerCase(), hit = (s: string) => !q || s.toLowerCase().includes(q);
  const shown = useMemo(() => {
    const configured = models.map((m, i) => ({ m, i })).filter(({ m, i }) => hit(m.id) || hit(m.model) || hit(nameOf(m, i)));
    const recents = many ? lately.filter(id => !pinned.has(id) && known.has(id) && hit(id)) : [];
    const skip = new Set(recents), rest: string[] = [];
    let more = 0;
    for (const id of found.ids) if (!skip.has(id) && hit(id)) { if (rest.length < SHOWN) rest.push(id); else more++; }
    return { configured, recents, rest, more };
  }, [models, found.ids, lately, q, many]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a choice from the server's list shows its id; the trigger keeps its place while the list loads
  const label = (() => { const i = models.findIndex(m => m.id === current); return i >= 0 ? nameOf(models[i], i) : current; })();
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
        <Popover.Content data-slot="popover-content" side="top" align="end" sideOffset={6} collisionPadding={12}
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
              {!!shown.recents.length && <CommandGroup heading="Recent">{shown.recents.map(id => item(id, id))}</CommandGroup>}
              {!!shown.rest.length && <CommandGroup heading={many ? 'On the server' : undefined}>{shown.rest.map(id => item(id, id))}</CommandGroup>}
              {shown.more > 0 && <p className="px-3 pt-1 pb-2 text-meta text-muted-foreground">{shown.more} more. Keep typing to narrow it down.</p>}
              {discover && <CommandGroup className="border-t">
                {!found.ok && <p className="px-2 pt-1 pb-1.5 text-meta text-muted-foreground">Couldn't get the server's list, so only the configured models are here.</p>}
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
export function ReasoningPicker({ value, onChange }: { value: Thinking; onChange: (v: Thinking) => void }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as Thinking)}>
      <SelectTrigger aria-label="Reasoning" title="Reasoning" className={`${TRIGGER} shrink-0 text-muted-foreground/70`}><SelectValue>{LEVELS.find(l => l[0] === value)?.[1]}</SelectValue></SelectTrigger>
      <SelectContent position="popper" side="top" align="end">
        <SelectGroup><SelectLabel>Reasoning</SelectLabel>
          {LEVELS.map(([v, words]) => <SelectItem key={v} value={v} className={ITEM}>{words}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
