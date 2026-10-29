import { ArrowUp, LayoutGrid, Moon, Sparkles, Sun } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { StatusCard, WidgetState } from '../shared/cards.ts';
import { cn } from '@/lib/utils';
import { Icon, SummaryTile, Widget } from './cards.tsx';

// The assistant (and the AI SDK client) loads only when someone asks something.
const Assistant = lazy(() => import('./assistant.tsx'));

interface Page {
  title: string; greeting?: string; location?: string;
  appearance: { wallpaper?: string; dim: number; blur: number };
  assistant: { name: string; model: string } | null;
  sections: { title?: string; columns?: number; display?: 'cards' | 'tiles'; widgets: string[] }[];
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

/** A round glass button for the floating rail and corners. Active is solid white, like a selected tab. */
function RoundButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}
          className={cn('glass-round grid size-11 place-items-center rounded-full transition-all duration-200 [&_svg]:size-[18px]',
            active ? 'bg-white text-black shadow-lg' : 'text-foreground/85 hover:text-foreground')}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function App() {
  const [page, setPage] = useState<Page | null>(null);
  const { state, online } = useLive();
  const now = useClock();
  const theme = useTheme();
  const [view, setView] = useState<number | 'all'>('all');
  const [palette, setPalette] = useState(false);
  const [chat, setChat] = useState<{ text: string; n: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => { fetch('/api/page').then(r => r.json()).then(setPage); }, []);
  useEffect(() => { if (page) document.title = page.title; }, [page]);
  // A wallpaper means glass over a photo: always the dark material, so text stays legible on any image.
  const wall = page?.appearance?.wallpaper;
  useEffect(() => {
    document.documentElement.classList.toggle('has-wallpaper', !!wall);
    if (wall) document.documentElement.classList.add('dark');
  }, [wall]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPalette(p => !p); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const ask = useCallback((text: string) => {
    if (!text.trim()) return;
    setChat({ text: text.trim(), n: Date.now() }); setChatOpen(true); setPalette(false); setDraft('');
  }, []);

  const p = pulse(state);
  const sections = page?.sections.map((s, i) => ({ ...s, i })).filter(s => view === 'all' || s.i === view) ?? [];
  const sectionIcon = (s: Page['sections'][number]) => state[s.widgets[0]]?.card?.icon;
  const nav = page?.sections.map((s, i) => ({ ...s, i })).filter(s => s.title) ?? [];

  return (
    <TooltipProvider delayDuration={300}>
      {wall && (
        <div className="wallpaper" style={{ '--wall-dim': page!.appearance.dim } as React.CSSProperties} aria-hidden>
          <img src={wall} alt="" style={page!.appearance.blur ? { filter: `blur(${page!.appearance.blur}px)` } : undefined} />
        </div>
      )}

      {/* top-left: the home's name */}
      <div className="fixed top-5 left-5 z-20 hidden items-center gap-3 md:flex">
        <span className="icon-tile size-11! rounded-full!">
          <svg viewBox="0 0 24 24" className="size-[18px]!" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden><path d="M5 19V10l7-5 7 5v9" /></svg>
        </span>
        <div className="wall-text leading-tight"><div className="text-sm font-semibold">{page?.title ?? 'Home'}</div><div className="text-xs text-muted-foreground">{online ? 'Live' : 'Reconnecting…'}</div></div>
      </div>

      {/* the floating rail: one round button per section */}
      <nav aria-label="Sections" className="fixed top-1/2 left-5 z-20 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        <RoundButton label="Overview" active={view === 'all'} onClick={() => setView('all')}><LayoutGrid /></RoundButton>
        {nav.map(s => (
          <RoundButton key={s.i} label={s.title!} active={view === s.i} onClick={() => setView(s.i)}><Icon name={sectionIcon(s) ?? 'pulse'} /></RoundButton>
        ))}
        {page?.assistant && <RoundButton label={page.assistant.name} onClick={() => setChatOpen(true)}><Sparkles /></RoundButton>}
      </nav>

      {/* top-right: time, and the theme switch when there's no wallpaper */}
      <div className="wall-text fixed top-5 right-5 z-20 flex items-center gap-3">
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-semibold tabular">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
          <div className="text-xs text-muted-foreground">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        </div>
        {!wall && <RoundButton label={theme.dark ? 'Light' : 'Dark'} onClick={theme.toggle}>{theme.dark ? <Sun /> : <Moon />}</RoundButton>}
      </div>

      <main className="@container/main mx-auto flex max-w-[1320px] flex-col gap-8 px-4 pt-20 pb-28 md:pr-8 md:pl-24 md:pb-16">
        {/* the hero: ask anything */}
        {view === 'all' && (
          <header className="wall-text mx-auto w-full max-w-[760px] pt-4 text-center">
            <div className="text-[17px] font-medium">{greet(now.getHours())}{page?.greeting ? `, ${page.greeting}` : ''}</div>
            <div className={cn('mt-1 text-sm', p.tone)}>{p.text}</div>
            {page?.assistant && (
              <form className="group mt-5 flex items-center gap-3 border-b border-white/15 pb-3 transition-colors focus-within:border-white/40"
                onSubmit={e => { e.preventDefault(); ask(draft); }}>
                <input value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Ask ${page.assistant.name}`} placeholder="Ask me anything"
                  className="min-w-0 flex-1 bg-transparent text-center text-[34px] font-light tracking-tight outline-none placeholder:text-foreground/55 sm:text-[42px]" />
                {draft.trim() && <button type="submit" aria-label="Ask" className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black"><ArrowUp className="size-5" /></button>}
              </form>
            )}
            {page?.assistant && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)} className="glass-round rounded-full px-3.5 py-1.5 text-[13px] text-foreground/80 transition-colors hover:text-foreground">{s}</button>
                ))}
              </div>
            )}
          </header>
        )}

        {sections.map(sec => (
          <section key={sec.i} className="space-y-3">
            {sec.title && sec.display !== 'tiles' && !(sec.widgets.length === 1 && page?.widgets[sec.widgets[0]]?.title === sec.title) && <h2 className="wall-text px-0.5 text-sm font-medium text-muted-foreground">{sec.title}</h2>}
            {sec.display === 'tiles'
              ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>
                  {sec.widgets.flatMap(key => {
                    const c = state[key]?.card;
                    return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <SummaryTile key={`${key}${j}`} s={t} href={c?.href} />);
                  })}
                </div>
              )
              : (
                <div className="grid items-start gap-4" style={{ gridTemplateColumns: sec.columns ? `repeat(${sec.columns}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
                  {sec.widgets.map(key => {
                    const s = state[key];
                    return <Widget key={key} card={s?.card} title={page?.widgets[key]?.title}
                      status={s?.error ? <span className="truncate text-xs text-warn" title={s.error}>{s.card ? 'stale' : s.error}</span> : null}
                      run={(action, args) => runAction(key, action, args)} />;
                  })}
                </div>
              )}
          </section>
        ))}
      </main>

      {/* phones: the rail becomes a floating pill at the bottom */}
      <nav aria-label="Sections" className="glass-round fixed inset-x-4 bottom-4 z-20 flex justify-around rounded-full p-1.5 md:hidden">
        <button onClick={() => setView('all')} aria-label="Overview" className={cn('grid size-10 place-items-center rounded-full', view === 'all' && 'bg-white text-black')}><LayoutGrid className="size-[18px]" /></button>
        {nav.map(s => (
          <button key={s.i} onClick={() => setView(s.i)} aria-label={s.title} className={cn('grid size-10 place-items-center rounded-full', view === s.i && 'bg-white text-black')}><Icon name={sectionIcon(s) ?? 'pulse'} className="size-[18px]" /></button>
        ))}
        {page?.assistant && <button onClick={() => setChatOpen(true)} aria-label={page.assistant.name} className="grid size-10 place-items-center rounded-full"><Sparkles className="size-[18px]" /></button>}
      </nav>

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
              {nav.map(s => <CommandItem key={s.i} onSelect={() => { setView(s.i); setPalette(false); }}><Icon name={sectionIcon(s) ?? 'pulse'} />{s.title}</CommandItem>)}
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
