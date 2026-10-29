import { LayoutGrid, Moon, Sparkles, Sun } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { StatusCard, WidgetState } from '../shared/cards.ts';
import { Icon, SummaryTile, Widget } from './cards.tsx';

// The assistant (and the AI SDK client) loads only when someone asks something.
const Assistant = lazy(() => import('./assistant.tsx'));

interface Page {
  title: string; greeting?: string; location?: string;
  assistant: { name: string; model: string } | null;
  sections: { title?: string; columns?: number; widgets: string[] }[];
  widgets: Record<string, { title: string }>;
}

function useLive() {
  const [state, setState] = useState<Record<string, WidgetState>>({});
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('widget', e => {
      const s = JSON.parse((e as MessageEvent).data) as WidgetState;
      setState(prev => ({ ...prev, [s.key]: s }));
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);
  return { state, online };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('atrium-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
    setDark(next);
  };
  return { dark, toggle };
}

const greet = (h: number) => h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

/** One line that says whether anything needs attention. */
function pulse(state: Record<string, WidgetState>) {
  const items = Object.values(state).map(s => s.card).filter((c): c is StatusCard => c?.type === 'status').flatMap(c => c.items);
  const down = items.filter(i => !i.ok), errors = Object.values(state).filter(s => s.error);
  if (down.length) return { text: `${down.map(d => d.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} down`, tone: 'text-bad' };
  if (errors.length) return { text: `${errors.length} widget${errors.length > 1 ? 's' : ''} can't reach ${errors.length > 1 ? 'their services' : 'its service'}`, tone: 'text-warn' };
  if (items.length) return { text: `Everything's running. All ${items.length} services are up.`, tone: 'text-muted-foreground' };
  return { text: 'Connecting…', tone: 'text-muted-foreground' };
}

async function runAction(key: string, action: string, args?: Record<string, unknown>) {
  const r = await fetch(`/api/action/${key.split('.')[0]}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

const SUGGESTIONS = ['Is anything down?', 'How are my downloads doing?', "What's playing on Plex?", 'Show me the GPU and Plex side by side'];

export function App() {
  const [page, setPage] = useState<Page | null>(null);
  const { state, online } = useLive();
  const now = useClock();
  const theme = useTheme();
  const [view, setView] = useState<number | 'all'>('all');
  const [palette, setPalette] = useState(false);
  const [chat, setChat] = useState<{ text: string; n: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => { fetch('/api/page').then(r => r.json()).then(setPage); }, []);
  useEffect(() => { if (page) document.title = page.title; }, [page]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPalette(p => !p); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const ask = useCallback((text: string) => {
    if (!text.trim()) return;
    setChat({ text: text.trim(), n: Date.now() }); setChatOpen(true); setPalette(false);
  }, []);

  const p = pulse(state);
  const summaries = useMemo(() => Object.values(state).filter(s => s.card?.summary)
    .sort((a, b) => (page ? Object.keys(page.widgets).indexOf(a.key) - Object.keys(page.widgets).indexOf(b.key) : 0)), [state, page]);
  const sections = page?.sections.map((s, i) => ({ ...s, i })).filter(s => view === 'all' || s.i === view) ?? [];
  const sectionIcon = (s: Page['sections'][number]) => state[s.widgets[0]]?.card?.icon;
  const [query, setQuery] = useState('');

  return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
        <Sidebar variant="inset" collapsible="offcanvas">
          <SidebarHeader>
            <SidebarMenu><SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => setView('all')}>
                <div className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden><path d="M5 19V10l7-5 7 5v9" /></svg>
                </div>
                <div className="grid leading-tight"><span className="font-semibold">{page?.title ?? 'Home'}</span><span className="text-xs text-muted-foreground">{online ? 'Live' : 'Reconnecting…'}</span></div>
              </SidebarMenuButton>
            </SidebarMenuItem></SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent><SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === 'all'} onClick={() => setView('all')}><LayoutGrid /><span>Overview</span></SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu></SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Sections</SidebarGroupLabel>
              <SidebarGroupContent><SidebarMenu>
                {page?.sections.map((s, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuButton isActive={view === i} onClick={() => setView(i)}>
                      <Icon name={sectionIcon(s) ?? 'pulse'} /><span>{s.title ?? `Section ${i + 1}`}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu></SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          {page?.assistant && (
            <SidebarFooter>
              <SidebarMenu><SidebarMenuItem>
                <SidebarMenuButton onClick={() => setChatOpen(true)}><Sparkles className="text-primary" /><span>{page.assistant.name}</span></SidebarMenuButton>
              </SidebarMenuItem></SidebarMenu>
            </SidebarFooter>
          )}
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/80 px-4 backdrop-blur-xl lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            <h1 className="text-sm font-medium">{view === 'all' ? 'Overview' : page?.sections[view]?.title}</h1>
            <div className="ml-auto flex items-center gap-2">
              {page?.assistant && (
                <Button variant="outline" size="sm" className="h-8 w-44 justify-start gap-2 text-muted-foreground sm:w-64" onClick={() => setPalette(true)}>
                  <Sparkles className="text-primary" /><span className="truncate">Ask {page.assistant.name}…</span>
                  <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-[10px] font-medium sm:inline">⌘K</kbd>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="size-8" onClick={theme.toggle} aria-label="Toggle theme">{theme.dark ? <Sun /> : <Moon />}</Button>
            </div>
          </header>

          <main className="@container/main flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
            {view === 'all' && (
              <>
                <div>
                  <div className="text-sm text-muted-foreground tabular">
                    {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <h2 className="mt-1 text-3xl font-semibold tracking-tight">{greet(now.getHours())}{page?.greeting ? `, ${page.greeting}` : ''}</h2>
                  <p className={`mt-1 ${p.tone}`}>{p.text}</p>
                </div>
                {summaries.length > 0 && (
                  <div className="grid grid-cols-2 gap-4 @3xl/main:grid-cols-3 @5xl/main:grid-cols-5">
                    {summaries.map(s => <SummaryTile key={s.key} s={s.card!.summary!} href={s.card!.href} />)}
                  </div>
                )}
              </>
            )}
            {sections.map(sec => (
              <section key={sec.i} className="space-y-3">
                {view === 'all' && sec.title && <h3 className="px-0.5 text-sm font-medium text-muted-foreground">{sec.title}</h3>}
                <div className="grid items-start gap-4" style={{ gridTemplateColumns: sec.columns ? `repeat(${sec.columns}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
                  {sec.widgets.map(key => {
                    const s = state[key];
                    return <Widget key={key} card={s?.card} title={page?.widgets[key]?.title}
                      status={s?.error ? <span className="truncate text-xs text-warn" title={s.error}>{s.card ? 'stale' : s.error}</span> : null}
                      run={(action, args) => runAction(key, action, args)} />;
                  })}
                </div>
              </section>
            ))}
          </main>
        </SidebarInset>
      </SidebarProvider>

      {page?.assistant && (
        <CommandDialog open={palette} onOpenChange={setPalette} title={`Ask ${page.assistant.name}`} description="Ask a question or jump to a section">
          <CommandInput placeholder={`Ask ${page.assistant.name} anything about your homelab…`} value={query} onValueChange={setQuery}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim() && !document.querySelector('[cmdk-item][data-selected="true"]')) { ask(query); setQuery(''); } }} />
          <CommandList>
            <CommandEmpty>
              <button className="mx-auto flex items-center gap-2 text-sm" onClick={() => { ask(query); setQuery(''); }}><Sparkles className="size-4 text-primary" />Ask “{query}”</button>
            </CommandEmpty>
            {query.trim() && <CommandGroup heading="Ask"><CommandItem value={`ask ${query}`} onSelect={() => { ask(query); setQuery(''); }}><Sparkles className="text-primary" />Ask “{query}”<CommandShortcut>↵</CommandShortcut></CommandItem></CommandGroup>}
            <CommandGroup heading="Suggestions">
              {SUGGESTIONS.map(s => <CommandItem key={s} onSelect={() => ask(s)}><Sparkles className="text-muted-foreground" />{s}</CommandItem>)}
            </CommandGroup>
            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => { setView('all'); setPalette(false); }}><LayoutGrid />Overview</CommandItem>
              {page.sections.map((s, i) => <CommandItem key={i} onSelect={() => { setView(i); setPalette(false); }}><Icon name={sectionIcon(s) ?? 'pulse'} />{s.title}</CommandItem>)}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      )}

      {page?.assistant && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]">
            <SheetTitle className="sr-only">{page.assistant.name}</SheetTitle>
            <SheetDescription className="sr-only">Ask about your homelab</SheetDescription>
            {chatOpen && (
              <Suspense fallback={null}>
                <Assistant name={page.assistant.name} model={page.assistant.model} ask={chat} suggestions={SUGGESTIONS} onAsk={ask} />
              </Suspense>
            )}
          </SheetContent>
        </Sheet>
      )}
    </TooltipProvider>
  );
}
