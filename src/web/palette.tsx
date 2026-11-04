// The ⌘K palette: run a plain command, ask, do a card's action, open a service, jump to a tab. Loaded the first time it opens.
// Commands come first and need no model: they're matched here as you type and run by the server (src/server/commands.ts).
import { ArrowUp, Bell, BellOff, CornerDownLeft, Globe, LayoutGrid, LogOut, Search, Volume2, VolumeX, Zap } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { defaultFilter } from 'cmdk';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { stateOf, type Card, type Confirm, type StatusItem } from '../shared/cards.ts';
import { clear, match, type Match, type Phrase } from '../shared/commands.ts';
import { Approval, ChatCard } from './approval.tsx';
import type { ChatUi } from './assistant.tsx';
import { DOT, Icon } from './cards.tsx';
import { toast } from './feel.tsx';
import { signOut } from './signin.tsx';
import { play, toggleSounds, useSounds } from './sound.ts';
import { cannot, checkPush, disablePush, enablePush, usePush } from './push.ts';

const InlineAnswer = lazy(() => import('./assistant.tsx').then(m => ({ default: m.InlineAnswer })));

export interface PaletteProps {
  palette: boolean; setPalette: (open: boolean) => void; assistantName?: string; account: boolean; tools?: Record<string, any>; openChat: () => void; ask: (text: string) => void;
  actions: { key: string; b: { label: string; action: string; args?: Record<string, unknown> }; card: string }[];
  runAction: (key: string, action: string, args?: Record<string, unknown>) => Promise<void>;
  services: StatusItem[]; SUGGESTIONS: string[]; setView: (v: string) => void;
  nav: { key: string; chat?: boolean; icon?: string }[]; sectionIcon: (s: any) => string | undefined;
  search?: string;   // a provider name or a URL with {q}
  placeholder?: string; ui?: ChatUi;
  device: { sandbox?: boolean; canAct: boolean };   // whether this page could turn notifications on at all
}

const PROVIDERS: Record<string, string> = { duckduckgo: 'https://duckduckgo.com/?q={q}', google: 'https://www.google.com/search?q={q}', kagi: 'https://kagi.com/search?q={q}',
  brave: 'https://search.brave.com/search?q={q}', startpage: 'https://www.startpage.com/do/search?q={q}', searxng: '/search?q={q}' };
const searchUrl = (p: string, q: string) => (PROVIDERS[p] ?? p).replace('{q}', encodeURIComponent(q));
const filled = (label: string, slots: Record<string, number>) => label.replace(/\{(\w+)\}/g, (_, k) => String(slots[k] ?? '…'));
/** A command that's running or has run: asking first, its card, or why it couldn't. */
interface Ran { m: Match; c: Phrase; busy?: boolean; said?: Confirm & { logo?: string }; card?: Card; tool?: string; input?: unknown; error?: string }

/** What's first, and so what Enter does: a page, service or command by its name, then its name's start, then asking, then
 *  anything that only loosely matches. Typing "Media" goes to Media; typing a sentence asks it. cmdk orders the
 *  items inside a group by this but never the groups themselves, so those are put in order below. */
export function rank(value: string, query: string, names: string[] = []) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (value === 'ask') return .5;
  if (value === 'search web') return .45;
  const all = [...names, value].map(n => n.toLowerCase());
  if (names.some(n => n.toLowerCase() === q)) return 1;
  if (all.some(n => n.startsWith(q))) return .9;
  if (all.some(n => n.split(/[\s·-]+/).some(w => w.startsWith(q)))) return .8;
  return all.some(n => n.includes(q)) ? .4 : defaultFilter(value, query, names) * .3;
}
// the look shadcn's CommandDialog gives it; that one can't take a filter
const SHELL = '**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5';

export default function Palette({ palette, setPalette, assistantName, ask, actions, runAction, services, SUGGESTIONS, setView, nav, sectionIcon, search, account, tools, openChat, placeholder, ui, device }: PaletteProps) {
  const [query, setQuery] = useState('');
  // a question is answered right here; approvals too. Only a longer conversation needs the chat.
  const [inline, setInline] = useState<{ text: string; n: number } | null>(null);
  const answer = (text: string) => { play('send'); setInline({ text, n: Date.now() }); setQuery(''); };
  const sounds = useSounds(), sound = { value: `sounds ${sounds.on ? 'off' : 'on'}`, keywords: ['sound', 'sounds', 'audio', sounds.on ? 'mute' : 'unmute'] };
  // notifications on this device: what it is now is asked of the browser and the server as the palette opens
  const pushed = usePush(), alerts = { value: 'notifications on this device', keywords: ['notifications', 'notify', 'push', 'alerts', 'phone'] };
  useEffect(() => { if (!cannot(device)) void checkPush(); }, []);
  const [asking, setAsking] = useState(false);
  const flipPush = async () => {
    const no = cannot(device);
    if (no) { play('no'); return toast('push', { text: no }, { ms: 7000 }); }
    if (asking) return;
    setAsking(true);
    try {
      if (pushed === 'on') { await disablePush(); toast('push', { text: 'Notifications off on this device' }, { ms: 2500 }); return; }
      const r = await enablePush();
      play(r.ok ? 'done' : 'no'); toast('push', { text: r.text, tone: r.ok ? undefined : 'warn' }, { ms: r.ok ? 4000 : 7000 });
    } catch (e) { play('no'); toast('push', { text: `Notifications couldn't be turned on: ${(e as Error).message}`, tone: 'warn' }, { ms: 7000 }); }
    finally { setAsking(false); }
  };
  // what this page may run, fetched as the palette opens; matching it is instant and needs nothing else
  const [commands, setCommands] = useState<Phrase[]>([]), [ran, setRan] = useState<Ran | null>(null);
  useEffect(() => { let on = true; fetch('/api/commands').then(r => r.ok ? r.json() : { commands: [] }).then(d => { if (on) setCommands(d.commands ?? []); }, () => {}); return () => { on = false; }; }, []);
  const matches = useMemo(() => match(commands, query), [commands, query]), byId = useMemo(() => new Map(commands.map(c => [c.id, c])), [commands]);
  const scores = useMemo(() => new Map(matches.map(m => [`cmd ${m.id}`, m.score])), [matches]);
  const sure = clear(matches), tied = matches.filter(m => m.exact).length > 1;
  // two commands with the same words: Enter waits until one is picked, by arrow or pointer
  const picked = useRef(false);
  useEffect(() => { picked.current = false; setRan(null); }, [query]);
  const command = async (m: Match, go = false) => {
    const c = byId.get(m.id)!;
    setRan({ m, c, busy: true, said: go ? ran?.said : undefined });
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.text, id: m.id, go }) }).catch(() => null);
    const out = await r?.json().catch(() => ({})) ?? {};
    if (!r?.ok) { play('no'); return setRan({ m, c, error: out.error ?? 'Couldn\'t reach Valet' }); }
    if (out.confirm) return setRan({ m, c, said: out.confirm });
    if (out.card) return setRan({ m, c, card: out.card, tool: out.tool, input: out.input });
    // done, and its card on the page shows it: just say so
    setPalette(false); play('done');
    toast(`command:${m.id}`, { text: out.done ?? `${filled(c.label, m.slots)}: done` }, { ms: 3000 });
  };
  const web = () => { window.open(searchUrl(search!, query), '_blank', 'noopener'); setQuery(''); setPalette(false); };
  const doing = ({ b, card }: PaletteProps['actions'][number]) => ({ value: `do ${card} ${b.label}`, keywords: [b.label, `${card} ${b.label}`] });
  const opening = (sv: StatusItem) => ({ value: `open ${sv.name} ${sv.group ?? ''}`, keywords: [sv.name] });
  const going = (key: string) => ({ value: `go ${key}`, keywords: [key] });
  const best = (items: { value: string; keywords?: string[] }[]) => query.trim() ? Math.max(0, ...items.map(i => rank(i.value, query, i.keywords))) : 0;
  const pages = [{ key: 'Overview' }, ...nav];
  // best match first; with nothing typed they all tie and stay in this order
  const run: [number, React.ReactNode] = [matches.length ? matches[0].score : 0, matches.length > 0 && (
    <CommandGroup key="run" heading={tied ? 'Commands · pick one' : 'Commands'}>
      {matches.map(m => { const c = byId.get(m.id)!; return (
        <CommandItem key={m.id} value={`cmd ${m.id}`} onSelect={() => command(m)}>
          {c.access === 'read' ? <Search className="text-muted-foreground" /> : <Zap className="text-muted-foreground" />}{filled(c.label, m.slots)}<span className="text-muted-foreground">· {c.service}</span>
          {sure?.id === m.id && <CommandShortcut>↵</CommandShortcut>}
        </CommandItem>
      ); })}
    </CommandGroup>
  )];
  const groups: [number, React.ReactNode][] = [
    [best(actions.map(doing)), actions.length > 0 && (
      <CommandGroup key="do" heading="Do">
        {actions.map(a => (
          <CommandItem key={`${a.key}:${a.b.label}`} {...doing(a)} onSelect={() => { setPalette(false); runAction(a.key, a.b.action, a.b.args).then(() => play('done'), () => play('no')); }}>
            <Zap className="text-muted-foreground" />{a.card}<span className="text-muted-foreground">· {a.b.label}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    )],
    [best(services.map(opening)), services.length > 0 && (
      <CommandGroup key="open" heading="Open">
        {services.map(sv => (
          <CommandItem key={sv.name} {...opening(sv)} onSelect={() => { window.open(sv.href, '_blank', 'noopener'); setPalette(false); }}>
            {sv.icon ? <img src={sv.icon} alt="" className="size-4 object-contain" /> : <ArrowUp className="rotate-45 text-muted-foreground" />}
            {sv.name}
            <span className={cn('dot ml-auto size-1.5', DOT[stateOf(sv)])} />
          </CommandItem>
        ))}
      </CommandGroup>
    )],
    [best([{ value: 'ask' }]), query.trim() && (assistantName || search) && <CommandGroup key="ask" heading="Ask">{assistantName && <CommandItem value="ask" onSelect={() => answer(query)}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”{!matches.some(m => m.exact) && <CommandShortcut>↵</CommandShortcut>}</CommandItem>}
      {search && <CommandItem value="search web" onSelect={web}><Globe className="text-muted-foreground" />Search the web for “{query}”</CommandItem>}</CommandGroup>],
    [best(SUGGESTIONS.map(value => ({ value }))), SUGGESTIONS.length > 0 && <CommandGroup key="suggest" heading="Suggestions">
      {SUGGESTIONS.map(s => <CommandItem key={s} value={s} onSelect={() => answer(s)}><CornerDownLeft className="text-muted-foreground" />{s}</CommandItem>)}
    </CommandGroup>],
    [best(pages.map(p => going(p.key))), <CommandGroup key="go" heading="Go to">
      <CommandItem {...going('Overview')} onSelect={() => { setView('all'); setPalette(false); }}><LayoutGrid />Overview</CommandItem>
      {nav.map(s => <CommandItem key={s.key} {...going(s.key)} onSelect={() => { setView(s.key); setPalette(false); }}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} />{s.key}</CommandItem>)}
    </CommandGroup>],
    // after Open and Go to, so a service or tab with the same name as a command keeps Enter
    run,
    // this browser's say over appearance.sounds; it's remembered here and nowhere else
    [best([sound, alerts]), <CommandGroup key="feel" heading="This device">
      <CommandItem {...sound} onSelect={() => { const on = toggleSounds(); toast('sounds', { text: on ? 'Sounds on' : 'Sounds off' }, { ms: 2000 }); }}>
        {sounds.on ? <VolumeX /> : <Volume2 />}{sounds.on ? 'Turn sounds off' : 'Turn sounds on'}
      </CommandItem>
      <CommandItem {...alerts} onSelect={() => void flipPush()} className={cn(asking && 'chat-shimmer')}>
        {pushed === 'on' ? <Bell /> : <BellOff className="text-muted-foreground" />}Notifications on this device
        <span className="ml-auto text-[12px] text-muted-foreground">{pushed === 'on' ? 'On' : 'Off'}</span>
      </CommandItem>
    </CommandGroup>],
    [best([{ value: 'sign out' }, { value: 'sign out everywhere' }]), account && <CommandGroup key="account" heading="Account">
      <CommandItem value="sign out" onSelect={() => signOut()}><LogOut />Sign out</CommandItem>
      <CommandItem value="sign out everywhere" onSelect={() => signOut(true)}><LogOut />Sign out everywhere</CommandItem>
    </CommandGroup>],
  ];
  groups.sort((x, y) => y[0] - x[0]);
  const lead = (groups.find(g => g[1])?.[1] as React.ReactElement | undefined)?.key === 'run';
  return (
        <Dialog open={palette} onOpenChange={setPalette}>
          <DialogHeader className="sr-only"><DialogTitle>{assistantName ? `Ask ${assistantName}` : 'Search'}</DialogTitle><DialogDescription>Run a command, ask a question or jump to a section</DialogDescription></DialogHeader>
          <DialogContent showCloseButton={false} className="palette-pop top-[18%] translate-y-0 overflow-hidden rounded-[22px] p-0 sm:max-w-[600px]">
          <Command filter={(v, q, k) => v.startsWith('cmd ') ? scores.get(v) ?? 0 : rank(v, q, k)} className={SHELL}>
          <CommandInput placeholder={placeholder ?? assistantName ? placeholder ?? `Ask ${assistantName} anything about your homelab…` : 'Type a command, or search services and pages…'} value={query} onValueChange={setQuery}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') picked.current = true;
              if (e.key !== 'Enter') return;
              if (ran) { e.preventDefault(); return; }
              // a command said exactly runs, even under an answer: no model for what a rule can do
              if (inline && sure) { e.preventDefault(); setInline(null); void command(sure); return; }
              const on = document.querySelector('[cmdk-item][data-selected="true"]');
              // commands lead and nothing else was picked: the clear one runs, a tie waits for a pick
              if (lead && !picked.current) { e.preventDefault(); if (sure) void command(sure); else if (!tied && on) (on as HTMLElement).click(); return; }
              if (assistantName && query.trim() && (inline || !on)) { e.preventDefault(); answer(query); }
            }} />
          {ran ? (
            <div className="max-h-[440px] overflow-y-auto p-4"><div className="space-y-3">
              <div className={cn('text-[13px] text-muted-foreground', ran.busy && 'chat-shimmer')}>{filled(ran.c.label, ran.m.slots)}</div>
              {ran.said && <Approval said={ran.said} title={ran.said.title ?? `${filled(ran.c.label, ran.m.slots)}?`} detail={ran.said.detail} icon="pulse" ready={!ran.busy} width="100%"
                answer={ok => { if (ok) void command(ran.m, true); else setRan(null); }} />}
              {ran.card && <ChatCard first={ran.card} name={ran.tool ?? ''} input={ran.input} tools={tools ?? {}} fresh />}
              {ran.error && <div className="text-sm text-bad">{ran.error}</div>}
            </div></div>
          ) : inline ? (
            <div className="max-h-[440px] overflow-y-auto p-4">
              <Suspense fallback={null}><InlineAnswer key={inline.n} text={inline.text} tools={tools ?? {}} ui={ui} onMore={openChat} /></Suspense>
            </div>
          ) : (
          <CommandList onPointerMove={() => { picked.current = true; }}>
            <CommandEmpty>
              {assistantName ? <button className="mx-auto flex items-center gap-2 text-sm" onClick={() => answer(query)}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”</button> : 'Nothing matches'}
            </CommandEmpty>
            {groups.map(g => g[1])}
          </CommandList>
          )}
          </Command>
          </DialogContent>
        </Dialog>
  );
}
