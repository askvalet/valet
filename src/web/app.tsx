import { ArrowUp, CornerDownLeft, LayoutGrid, MessageCircle, Moon, Sun } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ForecastCard, StatusCard, WidgetState } from '../shared/cards.ts';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import Island, { type Live } from './island.tsx';
import { Icon, NowPlaying, isEmpty, MiniRing, WeatherRing, Ring, SummaryTile, Widget } from './cards.tsx';

// The assistant (and the AI SDK client) loads only when someone asks something.
const Assistant = lazy(() => import('./assistant.tsx'));

interface Page {
  title: string; greeting?: string; location?: string;
  appearance: { wallpaper?: string; dim: number; blur: number };
  assistant: { name: string; model: string } | null;
  menubar?: string[];
  nav?: { side: 'left' | 'right' | 'top' | 'bottom' };
  island?: { activities: string[]; idle: 'notch' | 'hide' };
  weather?: string;
  sections: { title?: string; columns?: number; display?: 'cards' | 'tiles' | 'rings' | 'media'; place?: 'main' | 'left' | 'right'; overview?: boolean; variant?: 'full' | 'minimal'; header?: boolean; heading?: boolean; tab?: string; chat?: boolean; widgets: string[] }[];
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
  const down = items.filter(i => !i.ok && !i.quiet), errors = Object.values(state).filter(s => s.error);
  if (down.length) return { text: `${down.map(d => d.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} down`, tone: 'text-bad' };
  if (errors.length) return { text: `${errors.length} widget${errors.length > 1 ? 's' : ''} can't reach ${errors.length > 1 ? 'their services' : 'its service'}`, tone: 'text-warn' };
  return { text: '', tone: '' };   // all well: say nothing
}

async function runAction(key: string, action: string, args?: Record<string, unknown>) {
  const r = await fetch(`/api/action/${key.split('.')[0]}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

const SUGGESTIONS = ['Is anything down?', 'How are my downloads doing?', "What's playing on Plex?", 'Show me the GPU and Plex side by side'];

/** A round glass button for the floating rail and corners. Active is solid white, like a selected tab. */
function RoundButton({ label, active, onClick, children, tip = 'right' }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; tip?: 'left' | 'right' | 'top' | 'bottom' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}
          className={cn('glass-round grid size-11 place-items-center rounded-full transition-all duration-200 [&_svg]:size-[18px]',
            active ? 'bg-white text-black shadow-lg' : 'text-foreground/85 hover:text-foreground')}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tip}>{label}</TooltipContent>
    </Tooltip>
  );
}

function useWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => { const m = matchMedia(query), on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [query]);
  return wide;
}

export function App() {
  const [page, setPage] = useState<Page | null>(null);
  const { state } = useLive();
  const now = useClock();
  const theme = useTheme();
  const [view, setView] = useState<string>('all');   // 'all' (the overview) or a tab's name
  const [palette, setPalette] = useState(false);
  const [chat, setChat] = useState<{ text: string; n: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const wide = useWide();
  const bar = useRef<HTMLDivElement>(null);
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

  // tabs: sections sharing a `tab` (or title) open together; the overview shows every section that's on it
  const tabOf = (s: Page['sections'][number], i: number) => s.tab ?? s.title ?? `#${i}`;
  const chatTab = page?.sections.map((s, i) => (s.chat ? tabOf(s, i) : null)).find(Boolean) ?? null;
  const ask = useCallback((text: string) => {
    if (!text.trim()) return;
    setChat({ text: text.trim(), n: Date.now() }); setPalette(false); setDraft('');
    // on the assistant's own tab the answer appears on the page; anywhere else, in the side panel
    if (!(chatTab && view === chatTab)) setChatOpen(true);
  }, [chatTab, view]);

  const p = pulse(state);
  // every item of a section's media cards, in the config's order: what's playing, then what's downloading…
  const mediaOf = (keys: string[]) => keys.flatMap(key => {
    const c = state[key]?.card;
    return c?.type === 'media' ? c.items.map((m, i) => ({ m, href: c.href, k: `${key}:${i}` })) : [];
  });
  // what's live right now, most important first (the config's order)
  const live: Live[] = (page?.island?.activities ?? []).flatMap(key => {
    const c = state[key]?.card;
    return c?.activity ? [{ ...c.activity, key, href: c.href }] : [];
  });
  const sections = page?.sections.map((s, i) => ({ ...s, i })).filter(s => view === 'all' ? s.overview !== false : tabOf(s, s.i) === view) ?? [];
  const sectionIcon = (s: Page['sections'][number]) => state[s.widgets[0]]?.card?.icon;
  const navSide = page?.nav?.side ?? 'left';
  const hasSide = !!page?.sections.some(x => (x.place === 'left' || x.place === 'right') && (view === 'all' ? x.overview !== false : true));
  const tip = ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const)[navSide];
  const nav = (page?.sections.map((s, i) => ({ ...s, i, key: tabOf(s, i) })).filter(s => s.title || s.tab) ?? [])
    .filter((s, j, all) => all.findIndex(x => x.key === s.key) === j);

  // the hero: ask anything
  const hero = view === 'all' && (
          <header className="wall-text mx-auto w-full max-w-[720px] pt-8 text-center xl:pt-10">
            <div className="text-[22px] font-semibold tracking-tight">{greet(now.getHours())}{page?.greeting ? `, ${page.greeting}` : ''}</div>
            {p.text && <div className={cn('mt-0.5 text-[13px]', p.tone)}>{p.text}</div>}
            {page?.assistant && (
              <form className="glass-round mt-5 flex items-center gap-2.5 rounded-[26px] py-2 pr-2 pl-5 text-left transition-shadow focus-within:ring-2 focus-within:ring-white/25"
                onSubmit={e => { e.preventDefault(); ask(draft); }}>
                <input value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Ask ${page.assistant.name}`} placeholder={`Ask ${page.assistant.name} anything…`}
                  className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground" />
                {!draft.trim() && <kbd className="hidden rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground sm:block">⌘K</kbd>}
                <button type="submit" aria-label="Ask" disabled={!draft.trim()}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black transition-opacity disabled:opacity-25"><ArrowUp className="size-[18px]" /></button>
              </form>
            )}
            {page?.assistant && (
              <div className="no-scrollbar mt-2.5 overflow-x-auto">
                {/* centred when it fits, scrolls from the start when it doesn't */}
                <div className="mx-auto flex w-max gap-1.5">
                  {SUGGESTIONS.slice(0, 3).map(s => (
                    <button key={s} onClick={() => ask(s)} className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">{s}</button>
                  ))}
                </div>
              </div>
            )}
          </header>
        );

  const renderSection = (sec: (typeof sections)[number], aside = sec.place === 'left' || sec.place === 'right') => (
          <section key={`${view}:${sec.i}`} className="settle space-y-3" style={{ animationDelay: `${Math.min(sec.i, 6) * 45}ms` }}>
            {sec.title && sec.heading !== false && (sec.display === 'cards' || sec.display === 'media') && !(sec.widgets.length === 1 && page?.widgets[sec.widgets[0]]?.title === sec.title) && <h2 className="wall-text px-0.5 text-sm font-medium text-muted-foreground">{sec.title}</h2>}
            {sec.display === 'media'
              ? (
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${sec.columns ? Math.floor(1200 / sec.columns) - 40 : 420}px), 1fr))` }}>
                  {mediaOf(sec.widgets).map(({ m, href, k }) => (
                    <a key={k} href={href} target="_blank" rel="noreferrer" className="block min-w-0 transition-transform duration-300 hover:-translate-y-0.5"><NowPlaying m={m} compact /></a>
                  ))}
                </div>
              )
              : sec.display === 'rings'
              ? (
                <Card className="py-5 shadow-card">
                  <div className="grid gap-y-5 px-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
                    {sec.widgets.flatMap(key => {
                      const c = state[key]?.card;
                      return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <Ring key={`${key}${j}`} s={t} />);
                    })}
                  </div>
                </Card>
              )
              : sec.display === 'tiles'
              ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>
                  {sec.widgets.flatMap(key => {
                    const c = state[key]?.card;
                    return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <SummaryTile key={`${key}${j}`} s={t} href={c?.href} />);
                  })}
                </div>
              )
              : (
                (() => {
                  const keys = sec.widgets.filter(key => !isEmpty(state[key]?.card));
                  const widget = (key: string) => {
                    const s = state[key];
                    return <Widget key={key} card={s?.card} title={page?.widgets[key]?.title} columns={aside ? sec.columns : undefined} minimal={sec.variant === 'minimal' && view === 'all'} headless={sec.header === false && view === 'all'}
                      status={s?.error ? <span className="truncate text-xs text-warn" title={s.error}>{s.card ? 'stale' : s.error}</span> : null}
                      run={(action, args) => runAction(key, action, args)} />;
                  };
                  // a wide card (e.g. the 3D desktop) takes two thirds; the rest stack beside it
                  const hero = !sec.columns && keys.find(k => state[k]?.card?.wide);
                  if (hero && keys.length === 1) return widget(hero);
                  if (hero) return (
                    <div className="grid items-start gap-4 @5xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                      {widget(hero)}
                      <div className="grid gap-4">{keys.filter(k => k !== hero).map(widget)}</div>
                    </div>
                  );
                  return (
                    <div className="grid items-start gap-4" style={{ gridTemplateColumns: aside ? '1fr' : sec.columns ? `repeat(${sec.columns}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
                      {keys.map(widget)}
                    </div>
                  );
                })()
              )}
          </section>
  );

  return (
    <TooltipProvider delayDuration={300}>
      {wall && (
        <div className="wallpaper" style={{ '--wall-dim': page!.appearance.dim } as React.CSSProperties} aria-hidden>
          <img src={wall} alt="" style={page!.appearance.blur ? { filter: `blur(${page!.appearance.blur}px)` } : undefined} />
        </div>
      )}


      {/* the tab buttons, on whichever side the config says (wide screens); a column on the left/right, a dock at the top/bottom */}
      <nav aria-label="Sections" className={cn('z-30 hidden gap-3 md:flex', {
        left: 'fixed top-1/2 left-5 -translate-y-1/2 flex-col',
        right: 'fixed top-1/2 right-5 -translate-y-1/2 flex-col',
        bottom: 'glass-bar fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border p-1.5 gap-2',
        top: 'glass-bar absolute top-24 left-1/2 -translate-x-1/2 rounded-full border p-1.5 gap-2',
      }[navSide])}>
        <RoundButton tip={tip} label="Overview" active={view === 'all'} onClick={() => setView('all')}><LayoutGrid /></RoundButton>
        {nav.map(s => (
          <RoundButton tip={tip} key={s.key} label={s.key} active={view === s.key} onClick={() => setView(s.key)}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} /></RoundButton>
        ))}
        {page?.assistant && !chatTab && <RoundButton tip={tip} label={page.assistant.name} onClick={() => setChatOpen(true)}><MessageCircle /></RoundButton>}
      </nav>

      {/* top-right: the menubar rings, weather and time (and the theme switch when there's no wallpaper).
          Below lg it sits at the top of the page instead, centred and wrapping, so phones see it too. */}
      {page?.island && <Island live={live} idle={page.island.idle} docked={wide} />}
      {/* phones: one row, condensed; wide screens: top right, level with the island */}
      <div ref={bar} className="wall-text z-20 flex items-center justify-center gap-1.5 px-3 pt-3 sm:gap-2 xl:absolute xl:top-5 xl:right-5 xl:gap-4 xl:p-0">
        {!!page?.menubar?.length && (
          <div className="glass-bar relative flex shrink items-center gap-1 rounded-full border px-2 py-1 sm:gap-3 sm:px-4 sm:py-1.5">
            {page.menubar.flatMap(key => {
              const c = state[key]?.card;
              return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <MiniRing key={`${key}${j}`} s={t} />);
            })}
          </div>
        )}
        <div className="glass-bar relative flex shrink-0 items-center gap-2.5 rounded-full border py-1 pr-3.5 pl-1.5 sm:gap-4 sm:py-1.5 sm:pr-5 sm:pl-2">
          {page?.weather && state[page.weather]?.card?.type === 'forecast' && <WeatherRing card={state[page.weather]!.card as ForecastCard} />}
          <div className="text-right leading-tight">
          <div className="text-sm font-semibold tabular">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
          <div className="hidden text-xs text-muted-foreground sm:block">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          </div>
        </div>
        {!wall && <RoundButton label={theme.dark ? 'Light' : 'Dark'} onClick={theme.toggle}>{theme.dark ? <Sun /> : <Moon />}</RoundButton>}
      </div>

      <main className={cn('@container/main mx-auto flex flex-col gap-8 px-4 pt-6 pb-28 xl:pt-20', view !== 'all' && 'pt-10 xl:pt-32', { left: 'md:pr-8 md:pl-24 md:pb-16', right: 'md:pl-8 md:pr-24 md:pb-16', bottom: 'md:px-8 md:pb-28', top: 'md:px-8 md:pb-16 md:pt-40 xl:pt-40' }[navSide], page?.sections.some(x => x.place === 'left' || x.place === 'right') ? 'max-w-[1720px]' : 'max-w-[1320px]')}>
        {!hasSide && hero}

        {(() => {
          // sections placed left/right become a sidebar beside the rest on wide screens; stacked on smaller ones
          const shown = sections.filter(sec => sec.display === 'media' ? mediaOf(sec.widgets).length > 0 : sec.display !== 'cards' || sec.widgets.some(k => !isEmpty(state[k]?.card)));
          const side = shown.filter(x => x.place === 'left' || x.place === 'right'), rest = shown.filter(x => x.place !== 'left' && x.place !== 'right');
          if (!side.length) return rest.map(x => renderSection(x));
          // a sidebar runs the full height of the page; the greeting and the ask box move into the column beside it
          const right = side.some(x => x.place === 'right');
          return (
            <div className="grid items-start gap-8" style={wide ? { gridTemplateColumns: (w => right ? `minmax(0,1fr) ${w}px` : `${w}px minmax(0,1fr)`)(side.every(x => x.variant === 'minimal') ? 230 * Math.max(1, ...side.map(x => x.columns ?? 1)) : 460) } : undefined}>
              <aside className={cn('no-scrollbar flex flex-col gap-8 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto', right && 'xl:order-2')}>{side.map(x => renderSection(x))}</aside>
              <div className="flex min-w-0 flex-col gap-8">{hero}{rest.map(x => renderSection(x))}</div>
            </div>
          );
        })()}
        {chatTab && view === chatTab && page?.assistant && (
          <div data-slot="card" className="h-[min(78vh,900px)] min-h-[520px] overflow-hidden rounded-[calc(var(--radius)*1.4)] border bg-card shadow-card">
            <Suspense fallback={null}>
              <Assistant name={page.assistant.name} model={page.assistant.model} ask={chat} suggestions={SUGGESTIONS} onAsk={ask} />
            </Suspense>
          </div>
        )}
      </main>

      {/* phones: the rail becomes a floating pill at the bottom */}
      <nav aria-label="Sections" className="glass-round fixed inset-x-4 bottom-4 z-20 flex justify-around rounded-full p-1.5 md:hidden">
        <button onClick={() => setView('all')} aria-label="Overview" className={cn('grid size-10 place-items-center rounded-full', view === 'all' && 'bg-white text-black')}><LayoutGrid className="size-[18px]" /></button>
        {nav.map(s => (
          <button key={s.key} onClick={() => setView(s.key)} aria-label={s.key} className={cn('grid size-10 place-items-center rounded-full', view === s.key && 'bg-white text-black')}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} className="size-[18px]" /></button>
        ))}
        {page?.assistant && !chatTab && <button onClick={() => setChatOpen(true)} aria-label={page.assistant.name} className="grid size-10 place-items-center rounded-full"><CornerDownLeft className="text-muted-foreground" /></button>}
      </nav>

      {page?.assistant && (
        <CommandDialog open={palette} onOpenChange={setPalette} title={`Ask ${page.assistant.name}`} description="Ask a question or jump to a section">
          <CommandInput placeholder={`Ask ${page.assistant.name} anything about your homelab…`} value={query} onValueChange={setQuery}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim() && !document.querySelector('[cmdk-item][data-selected="true"]')) { ask(query); setQuery(''); } }} />
          <CommandList>
            <CommandEmpty>
              <button className="mx-auto flex items-center gap-2 text-sm" onClick={() => { ask(query); setQuery(''); }}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”</button>
            </CommandEmpty>
            {query.trim() && <CommandGroup heading="Ask"><CommandItem value={`ask ${query}`} onSelect={() => { ask(query); setQuery(''); }}><CornerDownLeft className="text-muted-foreground" />Ask “{query}”<CommandShortcut>↵</CommandShortcut></CommandItem></CommandGroup>}
            <CommandGroup heading="Suggestions">
              {SUGGESTIONS.map(s => <CommandItem key={s} onSelect={() => ask(s)}><CornerDownLeft className="text-muted-foreground" />{s}</CommandItem>)}
            </CommandGroup>
            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => { setView('all'); setPalette(false); }}><LayoutGrid />Overview</CommandItem>
              {nav.map(s => <CommandItem key={s.key} onSelect={() => { setView(s.key); setPalette(false); }}><Icon name={s.chat ? 'chat' : sectionIcon(s) ?? 'pulse'} />{s.key}</CommandItem>)}
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
