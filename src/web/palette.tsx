// The ⌘K palette: ask, do a card's action, open a service, jump to a tab. Loaded the first time it opens.
import { ArrowUp, CornerDownLeft, Globe, LayoutGrid, LogOut, Zap } from 'lucide-react';
import { useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { StatusItem } from '../shared/cards.ts';
import { Icon } from './cards.tsx';
import { signOut } from './signin.tsx';

export interface PaletteProps {
  palette: boolean; setPalette: (open: boolean) => void; assistantName?: string; account: boolean; ask: (text: string) => void;
  actions: { key: string; b: { label: string; action: string; args?: Record<string, unknown> }; card: string }[];
  runAction: (key: string, action: string, args?: Record<string, unknown>) => Promise<void>;
  services: StatusItem[]; SUGGESTIONS: string[]; setView: (v: string) => void;
  nav: { key: string; chat?: boolean; icon?: string }[]; sectionIcon: (s: any) => string | undefined;
  search?: string;   // a provider name or a URL with {q}
}

const PROVIDERS: Record<string, string> = { duckduckgo: 'https://duckduckgo.com/?q={q}', google: 'https://www.google.com/search?q={q}', kagi: 'https://kagi.com/search?q={q}',
  brave: 'https://search.brave.com/search?q={q}', startpage: 'https://www.startpage.com/do/search?q={q}', searxng: '/search?q={q}' };
const searchUrl = (p: string, q: string) => (PROVIDERS[p] ?? p).replace('{q}', encodeURIComponent(q));

export default function Palette({ palette, setPalette, assistantName, ask, actions, runAction, services, SUGGESTIONS, setView, nav, sectionIcon, search, account }: PaletteProps) {
  const [query, setQuery] = useState('');
  const web = () => { window.open(searchUrl(search!, query), '_blank', 'noopener'); setQuery(''); setPalette(false); };
  return (
        <CommandDialog open={palette} onOpenChange={setPalette} title={assistantName ? `Ask ${assistantName}` : 'Search'} description="Ask a question or jump to a section"
          showCloseButton={false} className="palette-pop top-[18%] translate-y-0 rounded-[22px] sm:max-w-[600px]">
          <CommandInput placeholder={assistantName ? `Ask ${assistantName} anything about your homelab…` : 'Search services, actions and pages…'} value={query} onValueChange={setQuery}
            onKeyDown={e => { if (assistantName && e.key === 'Enter' && query.trim() && !document.querySelector('[cmdk-item][data-selected="true"]')) { ask(query); setQuery(''); } }} />
          <CommandList>
            <CommandEmpty>
              {assistantName ? <button className="mx-auto flex items-center gap-2 text-sm" onClick={() => { ask(query); setQuery(''); }}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”</button> : 'Nothing matches'}
            </CommandEmpty>
            {actions.length > 0 && (
              <CommandGroup heading="Do">
                {actions.map(({ key, b, card }) => (
                  <CommandItem key={`${key}:${b.label}`} value={`do ${card} ${b.label}`} onSelect={() => { setPalette(false); runAction(key, b.action, b.args).catch(() => {}); }}>
                    <Zap className="text-muted-foreground" />{card}<span className="text-muted-foreground">· {b.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {services.length > 0 && (
              <CommandGroup heading="Open">
                {services.map(sv => (
                  <CommandItem key={sv.name} value={`open ${sv.name} ${sv.group ?? ''}`} onSelect={() => { window.open(sv.href, '_blank', 'noopener'); setPalette(false); }}>
                    {sv.icon ? <img src={sv.icon} alt="" className="size-4 object-contain" /> : <ArrowUp className="rotate-45 text-muted-foreground" />}
                    {sv.name}
                    <span className={cn('dot ml-auto size-1.5', sv.ok ? 'dot-good' : sv.quiet ? 'bg-muted-foreground/40' : 'dot-bad')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query.trim() && (assistantName || search) && <CommandGroup heading="Ask">{assistantName && <CommandItem value={`ask ${query}`} onSelect={() => { ask(query); setQuery(''); }}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”<CommandShortcut>↵</CommandShortcut></CommandItem>}
              {search && <CommandItem value={`search web ${query}`} onSelect={web}><Globe className="text-muted-foreground" />Search the web for “{query}”</CommandItem>}</CommandGroup>}
            {SUGGESTIONS.length > 0 && <CommandGroup heading="Suggestions">
              {SUGGESTIONS.map(s => <CommandItem key={s} onSelect={() => ask(s)}><CornerDownLeft className="text-muted-foreground" />{s}</CommandItem>)}
            </CommandGroup>}
            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => { setView('all'); setPalette(false); }}><LayoutGrid />Overview</CommandItem>
              {nav.map(s => <CommandItem key={s.key} onSelect={() => { setView(s.key); setPalette(false); }}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} />{s.key}</CommandItem>)}
            </CommandGroup>
            {account && <CommandGroup heading="Account">
              <CommandItem value="sign out" onSelect={() => signOut()}><LogOut />Sign out</CommandItem>
              <CommandItem value="sign out everywhere" onSelect={() => signOut(true)}><LogOut />Sign out everywhere</CommandItem>
            </CommandGroup>}
          </CommandList>
        </CommandDialog>
  );
}
