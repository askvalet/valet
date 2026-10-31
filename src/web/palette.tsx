// The ⌘K palette: ask, do a card's action, open a service, jump to a tab. Loaded the first time it opens.
import { ArrowUp, CornerDownLeft, Globe, LayoutGrid, LogOut, Zap } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { defaultFilter } from 'cmdk';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { StatusItem } from '../shared/cards.ts';
import type { ChatUi } from './assistant.tsx';
import { Icon } from './cards.tsx';
import { signOut } from './signin.tsx';

const InlineAnswer = lazy(() => import('./assistant.tsx').then(m => ({ default: m.InlineAnswer })));

export interface PaletteProps {
  palette: boolean; setPalette: (open: boolean) => void; assistantName?: string; account: boolean; tools?: Record<string, any>; openChat: () => void; ask: (text: string) => void;
  actions: { key: string; b: { label: string; action: string; args?: Record<string, unknown> }; card: string }[];
  runAction: (key: string, action: string, args?: Record<string, unknown>) => Promise<void>;
  services: StatusItem[]; SUGGESTIONS: string[]; setView: (v: string) => void;
  nav: { key: string; chat?: boolean; icon?: string }[]; sectionIcon: (s: any) => string | undefined;
  search?: string;   // a provider name or a URL with {q}
  placeholder?: string; ui?: ChatUi;
}

const PROVIDERS: Record<string, string> = { duckduckgo: 'https://duckduckgo.com/?q={q}', google: 'https://www.google.com/search?q={q}', kagi: 'https://kagi.com/search?q={q}',
  brave: 'https://search.brave.com/search?q={q}', startpage: 'https://www.startpage.com/do/search?q={q}', searxng: '/search?q={q}' };
const searchUrl = (p: string, q: string) => (PROVIDERS[p] ?? p).replace('{q}', encodeURIComponent(q));

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

export default function Palette({ palette, setPalette, assistantName, ask, actions, runAction, services, SUGGESTIONS, setView, nav, sectionIcon, search, account, tools, openChat, placeholder, ui }: PaletteProps) {
  const [query, setQuery] = useState('');
  // a question is answered right here; approvals too. Only a longer conversation needs the chat.
  const [inline, setInline] = useState<{ text: string; n: number } | null>(null);
  const answer = (text: string) => { setInline({ text, n: Date.now() }); setQuery(''); };
  const web = () => { window.open(searchUrl(search!, query), '_blank', 'noopener'); setQuery(''); setPalette(false); };
  const doing = ({ b, card }: PaletteProps['actions'][number]) => ({ value: `do ${card} ${b.label}`, keywords: [b.label, `${card} ${b.label}`] });
  const opening = (sv: StatusItem) => ({ value: `open ${sv.name} ${sv.group ?? ''}`, keywords: [sv.name] });
  const going = (key: string) => ({ value: `go ${key}`, keywords: [key] });
  const best = (items: { value: string; keywords?: string[] }[]) => query.trim() ? Math.max(0, ...items.map(i => rank(i.value, query, i.keywords))) : 0;
  const pages = [{ key: 'Overview' }, ...nav];
  // best match first; with nothing typed they all tie and stay in this order
  const groups: [number, React.ReactNode][] = [
    [best(actions.map(doing)), actions.length > 0 && (
      <CommandGroup key="do" heading="Do">
        {actions.map(a => (
          <CommandItem key={`${a.key}:${a.b.label}`} {...doing(a)} onSelect={() => { setPalette(false); runAction(a.key, a.b.action, a.b.args).catch(() => {}); }}>
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
            <span className={cn('dot ml-auto size-1.5', sv.ok ? 'dot-good' : sv.quiet ? 'bg-muted-foreground/40' : 'dot-bad')} />
          </CommandItem>
        ))}
      </CommandGroup>
    )],
    [best([{ value: 'ask' }]), query.trim() && (assistantName || search) && <CommandGroup key="ask" heading="Ask">{assistantName && <CommandItem value="ask" onSelect={() => answer(query)}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”<CommandShortcut>↵</CommandShortcut></CommandItem>}
      {search && <CommandItem value="search web" onSelect={web}><Globe className="text-muted-foreground" />Search the web for “{query}”</CommandItem>}</CommandGroup>],
    [best(SUGGESTIONS.map(value => ({ value }))), SUGGESTIONS.length > 0 && <CommandGroup key="suggest" heading="Suggestions">
      {SUGGESTIONS.map(s => <CommandItem key={s} value={s} onSelect={() => answer(s)}><CornerDownLeft className="text-muted-foreground" />{s}</CommandItem>)}
    </CommandGroup>],
    [best(pages.map(p => going(p.key))), <CommandGroup key="go" heading="Go to">
      <CommandItem {...going('Overview')} onSelect={() => { setView('all'); setPalette(false); }}><LayoutGrid />Overview</CommandItem>
      {nav.map(s => <CommandItem key={s.key} {...going(s.key)} onSelect={() => { setView(s.key); setPalette(false); }}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} />{s.key}</CommandItem>)}
    </CommandGroup>],
    [best([{ value: 'sign out' }, { value: 'sign out everywhere' }]), account && <CommandGroup key="account" heading="Account">
      <CommandItem value="sign out" onSelect={() => signOut()}><LogOut />Sign out</CommandItem>
      <CommandItem value="sign out everywhere" onSelect={() => signOut(true)}><LogOut />Sign out everywhere</CommandItem>
    </CommandGroup>],
  ];
  return (
        <Dialog open={palette} onOpenChange={setPalette}>
          <DialogHeader className="sr-only"><DialogTitle>{assistantName ? `Ask ${assistantName}` : 'Search'}</DialogTitle><DialogDescription>Ask a question or jump to a section</DialogDescription></DialogHeader>
          <DialogContent showCloseButton={false} className="palette-pop top-[18%] translate-y-0 overflow-hidden rounded-[22px] p-0 sm:max-w-[600px]">
          <Command filter={rank} className={SHELL}>
          <CommandInput placeholder={placeholder ?? assistantName ? placeholder ?? `Ask ${assistantName} anything about your homelab…` : 'Search services, actions and pages…'} value={query} onValueChange={setQuery}
            onKeyDown={e => { if (assistantName && e.key === 'Enter' && query.trim() && (inline || !document.querySelector('[cmdk-item][data-selected="true"]'))) { e.preventDefault(); answer(query); } }} />
          {inline ? (
            <div className="max-h-[440px] overflow-y-auto p-4">
              <Suspense fallback={null}><InlineAnswer key={inline.n} text={inline.text} tools={tools ?? {}} ui={ui} onMore={openChat} /></Suspense>
            </div>
          ) : (
          <CommandList>
            <CommandEmpty>
              {assistantName ? <button className="mx-auto flex items-center gap-2 text-sm" onClick={() => answer(query)}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”</button> : 'Nothing matches'}
            </CommandEmpty>
            {groups.sort((x, y) => y[0] - x[0]).map(g => g[1])}
          </CommandList>
          )}
          </Command>
          </DialogContent>
        </Dialog>
  );
}
