import { ArrowUp, CornerDownLeft, LayoutGrid, MessageCircle, Moon, Search, Sun, TriangleAlert, X } from 'lucide-react';
import { tileActions, tilesOf } from '../shared/tiles.ts';
import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Card as CardData, ForecastCard, StatusCard, WidgetState } from '../shared/cards.ts';
import { toast } from './feel.tsx';
import { acted, dissolve } from './dust.ts';
import { gridVars, SPANS, type Grid, type Size } from './grid.ts';
export type { Size } from './grid.ts';
import { play, setSounds, type Sounds } from './sound.ts';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { LiveRings, type Live, type Notice } from './live.tsx';
import { SignIn, useMe } from './signin.tsx';
import { suggest } from './suggest.ts';
import { asView, type View } from '../shared/views.ts';
import { clock, day, favorites, label, oneLine, sayHow, setFormat, stillTrue, tabHash, type Format } from './format.ts';
import { applyLook, applyTheme, switchable, toggleTheme, type Look } from './look.ts';
import { adaptInk } from './ink.ts';
import type { Labels } from '../shared/labels.ts';
import { Scene, sceneFor, useStill, type Scenes } from './scene.tsx';
import { ChatBeam } from './beam.tsx';
import { ClockMonth, Icon, NowPlaying, isEmpty, MiniRing, noteShape, Shaped, shapeOf, TileSkeleton, WeatherRing, Ring, Shell, SummaryTile, Widget } from './cards.tsx';

// The assistant (and the AI SDK client) loads only when someone asks something.
const Assistant = lazy(() => import('./assistant.tsx'));
import type { ChatUi, ToolInfo } from './assistant.tsx';
import type { VoiceUi } from './voice.tsx';
import { loadMotion, springIn } from './motion.ts';
// ⌘K: once its code has arrived (it's fetched when the page goes quiet) it's drawn directly, not through Suspense, which
// holds back a boundary that resolves at once by about 300 ms. Until then, the lazy one.
let PaletteNow: typeof import('./palette.tsx').default | undefined;
const loadPalette = () => import('./palette.tsx').then(m => { PaletteNow = m.default; return m; });
// a tile's sheet, and Motion with it (about 25 KB), aren't on the first load: fetched once the page is quiet, so the first
// tap still opens at once
let SheetNow: typeof import('./tile-sheet.tsx').TileSheet | undefined;
const loadSheet = () => import('./tile-sheet.tsx').then(m => { SheetNow = m.TileSheet; return m; });
const Palette = lazy(loadPalette);
const Asks = lazy(() => import('./asks.tsx'));
const RecapStory = lazy(() => import('./recap.tsx'));

export type Paper = { image?: string; paint?: string };
export type CardOverride = { title?: string; icon?: string; header?: boolean; view?: View; rows?: number; cols?: number; style?: Record<string, string>; open?: boolean | string };

export interface Page {
  title: string; greeting?: string; notice?: string; location?: string; canAct?: boolean; sandbox?: boolean;
  member?: { name?: string; actions: string[] };   // someone with a profile: the page actions it lists, as <instance>.<action>
  appearance: { walls: Paper[]; tabWalls: Record<string, Paper[]>; light?: { walls: Paper[]; tabWalls: Record<string, Paper[]> }; rotate?: number; sizes: Partial<Record<Size, { cols?: number; rows?: number }>>; sounds?: Sounds; scenes?: Scenes };
  look: Look;
  hero: { greeting: boolean | string; status: boolean; search: boolean; review: boolean | 'end'; align: 'center' | 'left' | 'right'; scope?: string[] };
  chat: ChatUi & { open: 'center' | 'right' | 'left' | 'bottom' | 'page'; overview: boolean; placeholder?: string; suggestions: 'ai' | 'fixed' | 'off' };
  format: Format; labels: Labels;
  assistant: { name: string; model: string; models?: { id: string; model: string }[]; discover?: boolean; suggestions: string[]; tools: Record<string, ToolInfo>; external?: boolean; integrations?: { id: string; name: string }[] } | null;
  voice?: VoiceUi;   // voice: whether the chat has a mic and a speaker
  search?: string;
  find?: boolean;
  insight?: string;
  welcome?: { path: string; saved: boolean; setup?: boolean };
  configError?: { message?: string; at: number };
  menubar?: { widgets: string[]; position: 'left' | 'center' | 'right'; labels: boolean; clock: boolean; date: boolean; theme: boolean };
  nav?: { side: 'left' | 'right' | 'top' | 'bottom'; style: 'icons' | 'labels' | 'both'; hide: string[]; order?: string[] };
  live?: { activities: string[] };
  weather?: string;
  calendar?: string;
  recap?: boolean;
  sections: { title?: string; icon?: string; columns?: number; grid?: Grid; gap?: number; looks?: Record<string, CardOverride>; tabColumns?: number; display?: 'cards' | 'tiles' | 'rings' | 'media'; open?: boolean; sizes?: Record<string, Size>; place?: 'main' | 'left' | 'right'; overview?: boolean; variant?: 'full' | 'minimal'; header?: boolean; heading?: boolean; tab?: string; chat?: boolean; favorites?: string[]; widgets: string[] }[];
  widgets: Record<string, { title: string }>;
  // the wall display's own pages (/wall); none means it builds its default from the cards it hears
  // `touch`: the widgets a press may work there · `conditional`: its pages wait on the server's word (the `wall` event)
  wall: { every: number; pause: number; scale?: number; night: false | { from: string; to: string; dim: number }; awake: boolean; screen?: string; conditional?: boolean; touch: Record<string, { hold?: boolean }>;
    pages: { title?: string; every?: number; clock: boolean; takeover?: boolean; sections: Page['sections'] }[] };
}

/** Which of a wall's pages may show now, as the server judges it: the ones taking turns and the one taking over. */
export type WallNow = { pages: number[]; takeover?: number; ready: boolean };

/** `wall`: the wall screen this page is ('' for /wall itself), which also asks to be told which of its pages may show. */
export function useLive(wall?: string) {
  const [state, setState] = useState<Record<string, WidgetState>>({});
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [generation, setGeneration] = useState(0);   // bumps when the server's config was reloaded
  const [insight, setInsight] = useState<string | null | undefined>(undefined);   // undefined: nothing new since the page loaded
  const [asks, setAsks] = useState<import('./asks.tsx').Ask[]>([]);   // approvals asked from outside the chat, waiting for an answer here
  const [wallNow, setWallNow] = useState<WallNow | null>(null);
  useEffect(() => {
    const es = new EventSource(wall === undefined ? '/api/events' : `/api/events?wall=${encodeURIComponent(wall)}`);
    es.addEventListener('wall', e => setWallNow(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('notice', e => {
      const n = JSON.parse((e as MessageEvent).data);
      if (n.key === 'insight') setInsight(n.text || null);     // what several problems have in common; empty once they've cleared
      if (n.text) setNotice({ ...n, n: Date.now() });
    });
    es.addEventListener('asks', e => setAsks(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('widget', e => {
      const s = JSON.parse((e as MessageEvent).data) as WidgetState;
      setState(prev => ({ ...prev, [s.key]: s }));
    });
    // the config changed: drop what we know and come back for the new layout (the stream ends; this effect reruns)
    // the cards keep what they show until the new config's answers arrive, so a saved edit doesn't flash the page empty
    es.addEventListener('reload', () => { es.close(); setInsight(undefined); setGeneration(g => g + 1); });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, [generation, wall]);
  return { state, online, notice, generation, insight, asks, wallNow };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

/** Whether the page is dark right now, however it got there: the switch, the device turning at sunset, a tab's wallpaper. */
export function useDark() {
  const root = document.documentElement, [dark, setDark] = useState(() => root.classList.contains('dark'));
  useEffect(() => {
    const on = () => setDark(root.classList.contains('dark'));
    const o = new MutationObserver(on); o.observe(root, { attributes: true, attributeFilter: ['class'] }); on();
    return () => o.disconnect();
  }, []);
  return dark;
}

function useTheme() {
  return { dark: useDark(), toggle: toggleTheme };
}

const greet = (h: number) => label(h < 5 ? 'goodNight' : h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening');

export async function runAction(key: string, action: string, args?: Record<string, unknown>) {
  acted();
  const r = await fetch(`/api/action/${key.split('.')[0]}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}


/** A round glass button for the floating rail and corners. Active is solid white, like a selected tab. */
function RoundButton({ label, active, onClick, children, tip = 'right', words }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; tip?: 'left' | 'right' | 'top' | 'bottom'; words?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}
          className={cn('glass-round relative grid size-11 flex-none place-items-center rounded-full [&_svg]:size-icon-lg', active ? 'is-on' : 'text-foreground/85 hover:text-foreground')}>
          {children}{words && <span>{label}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tip}>{label}</TooltipContent>
    </Tooltip>
  );
}


/** One phone dock button: an icon over its word, and a solid surface when it's the tab you're on, in whichever theme. */
function DockButton({ name, active, onClick, children }: { name: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('press relative flex h-[46px] min-w-[54px] flex-[1_0_auto] flex-col items-center justify-center gap-0.5 rounded-full px-1.5 transition-colors focus-visible:-outline-offset-2 [&_svg]:size-icon-lg',
        active ? 'bg-[var(--nav-pill,var(--foreground))] text-[var(--nav-pill-ink,#fff)] dark:text-[var(--nav-pill-ink,#000)]' : 'text-foreground/85')}>
      {children}<span className="max-w-[64px] truncate text-caption leading-3 font-medium">{name}</span>
    </button>
  );
}

/** The Mac dock: buttons swell as the pointer nears them and settle when it leaves. Distances are measured from where the
 *  buttons rest, so growing doesn't push the target around. Mouse only; movement is off if someone's asked for less. */
function useDock(box: React.RefObject<HTMLElement | null>, side: 'left' | 'right' | 'top' | 'bottom') {
  const rest = useRef<{ b: HTMLElement; at: number }[]>([]), frame = useRef(0);
  const down = side === 'left' || side === 'right';
  const enter = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-/.test(document.documentElement.className) || box.current?.dataset.style !== 'icons') return;
    box.current?.classList.add('is-docking');
    rest.current = [...(box.current?.querySelectorAll<HTMLElement>('button') ?? [])].map(b => { const r = b.getBoundingClientRect(); return { b, at: down ? r.top + r.height / 2 : r.left + r.width / 2 }; });
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !rest.current.length) return;
    const p = down ? e.clientY : e.clientX;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      for (const { b, at } of rest.current) b.style.setProperty('--k', (1 + .5 * Math.exp(-((p - at) ** 2) / (2 * 62 ** 2))).toFixed(3));
    });
  };
  const leave = () => {
    cancelAnimationFrame(frame.current);
    for (const { b } of rest.current) b.style.removeProperty('--k');
    rest.current = [];
    box.current?.classList.remove('is-docking');
  };
  return { onPointerEnter: enter, onPointerMove: move, onPointerLeave: leave };
}

/** The page's backdrop: a picture or paint, taking turns if there's a list. The last one stays underneath while the next fades up. */
export function Walls({ list, every }: { list: Paper[]; every?: number }) {
  const [n, setN] = useState(0), now = list[n % list.length] ?? list[0];
  const [shown, setShown] = useState([now]);
  useEffect(() => { setN(0); if (!every || list.length < 2) return; const t = setInterval(() => { if (!document.hidden) setN(i => i + 1); }, every); return () => clearInterval(t); }, [list, every]);
  useEffect(() => { setShown(s => s.at(-1) === now ? s : [...s.filter(x => x !== now).slice(-1), now]); }, [now]);
  return (
    <div className="wallpaper" aria-hidden>
      {shown.map(w => w.image ? <Wall key={w.image} src={w.image} /> : <div key={w.paint} className="wall-paint" style={{ background: w.paint }} />)}
    </div>
  );
}

/** The wallpaper, fading up once it has decoded (at once if the browser already has it). */
// one ref for its life: a fresh one each render touched the picture's class every second (the clock re-renders the page),
// and Chrome redrew the glass over it in patches
const showWall = (el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth && !el.classList.contains('is-on')) el.classList.add('is-on'); };
function Wall({ src, style }: { src: string; style?: React.CSSProperties }) {
  return <img src={src} alt="" style={style} ref={showWall} onLoad={e => e.currentTarget.classList.add('is-on')} onError={e => { e.currentTarget.style.display = 'none'; }} />;
}

const arrived = new Set<string>();
/** A fade the first time something lands on the page, and only then: a tab you come back to is already there. */
const arrival = (key: string) => { if (arrived.has(key)) return ''; arrived.add(key); return 'fade-in-soft'; };

/** A line or a block that opens and closes instead of jumping, and keeps its words while it closes. */
function Fold({ open, className, children }: { open: boolean; className?: string; children: React.ReactNode }) {
  const last = useRef(children);
  if (open) last.current = children;
  return <div className={cn('fold', open && 'is-open', className)} aria-hidden={!open || undefined}><div>{last.current}</div></div>;
}

/** The chips that have just gone, and where they were, so they can leave instead of vanishing. */
function useLeaving(list: string[], ms = 260) {
  const [gone, setGone] = useState<{ s: string; at: number }[]>([]), last = useRef(list);
  useEffect(() => {
    const left = last.current.flatMap((s, at) => list.includes(s) ? [] : [{ s, at }]);
    last.current = list; setGone(left);
    if (!left.length) return;
    const t = setTimeout(() => setGone([]), ms);
    return () => clearTimeout(t);
  }, [list.join('\n')]);
  const all = list.map(s => ({ s, out: false }));
  for (const { s, at } of gone) if (!list.includes(s)) all.splice(Math.min(at, all.length), 0, { s, out: true });   // back already: one chip, not two with one key
  return all;
}

/** True once `on` has stayed true for a while, for what's only worth saying if it lasts. */
export function useHeld(on: boolean, ms: number) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) { setHeld(false); return; }
    const t = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return held;
}

/** On a fresh install: what to do next, in three lines. It goes away when the config says so. */
type Found = { type: string; name: string; icon: string; container: string; url: string; yaml: string };
/** What's already running here, and a way to say what else you run: set up by chat when the assistant may edit the
 *  config, and otherwise the lines to paste. */
function Starting({ setup, ask }: { setup: boolean; ask: (q: string) => void }) {
  const [found, setFound] = useState<Found[] | null>(null), [open, setOpen] = useState<string | null>(null), [said, setSaid] = useState('');
  useEffect(() => { fetch('/api/discover').then(r => r.json()).then(d => setFound(d.found ?? [])).catch(() => setFound([])); }, []);
  const shown = found?.find(f => f.type === open);
  return (
    <div className="grid gap-3 border-t pt-4">
      {!!found?.length && <div>
        <div className="text-item font-medium">Running on this machine</div>
        <div className="mt-2 flex flex-wrap gap-2">{found.map(f => (
          <Chip key={f.type} variant={!setup && open === f.type ? 'selected' : 'tonal'} onClick={() => setup ? ask(`Add ${f.name} to my page. It runs at ${f.url}.`) : setOpen(o => o === f.type ? null : f.type)} aria-pressed={!setup ? open === f.type : undefined}>
            <img src={f.icon} alt="" className="size-icon-lg object-contain" />{f.name}
          </Chip>))}</div>
        <p className="mt-2 text-body text-muted-foreground">{setup ? 'Pick one and Valet sets it up in chat. It asks before it saves anything.' : 'Pick one for the lines to add under integrations: in your config. Secrets go in .env.'}</p>
        {shown && <pre className="mt-2 overflow-x-auto rounded-inset bg-fill-1 p-3 font-mono text-meta leading-relaxed text-foreground/85">{shown.yaml}</pre>}
      </div>}
      {setup ? <form onSubmit={e => { e.preventDefault(); if (said.trim()) ask(`I run ${said.trim()}. Add them to my page.`); }} className="flex flex-wrap items-center gap-2">
          <label htmlFor="what-you-run" className="text-item font-medium">What do you run?</label>
          <input id="what-you-run" value={said} onChange={e => setSaid(e.target.value)} placeholder="Plex, Sonarr, Home Assistant…" className="h-9 min-w-0 flex-1 rounded-control border bg-fill-1 px-3.5 text-body outline-none placeholder:text-muted-foreground focus:border-ring" />
          <Button variant="solid" disabled={!said.trim()}>Set it up</Button>
        </form>
        : <p className="text-body text-muted-foreground">Or tell Valet what you run and let it write the config: give the assistant <code className="rounded-tag bg-fill-1 px-1.5 py-0.5 font-mono text-meta">access: {'{ config: control }'}</code>, and it asks before every change.</p>}
    </div>
  );
}

function Welcome({ path, saved, setup, ask }: { path: string; saved: boolean; setup?: boolean; ask?: (q: string) => void }) {
  const step = (n: number, title: string, body: React.ReactNode) => (
    <div className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-fill-2 text-meta font-medium tabular">{n}</span>
      <div className="min-w-0"><div className="text-item font-medium">{title}</div><div className="mt-0.5 text-body leading-relaxed text-muted-foreground">{body}</div></div></div>
  );
  const code = 'rounded-tag bg-fill-1 px-1.5 py-0.5 font-mono text-meta break-all text-foreground/85', word = code.replace('break-all', 'whitespace-nowrap');
  return (
    <Card className="settle gap-4 px-6 py-5 shadow-card">
      <div><div className="text-title font-semibold tracking-tight">Welcome to your homepage</div>
        <p className="mt-0.5 text-item text-muted-foreground">This page is built from one file. Edit it and watch here: changes appear as you save.</p></div>
      <div className="grid gap-4 md:grid-cols-3">
        {step(1, saved ? 'Open your config' : 'Create your config', <>{saved ? 'A starter is at' : 'Save a config at'} <code className={code}>{path}</code>{!saved && ' (that folder is read-only to Valet, so this page is a sample until then)'}</>)}
        {step(2, 'Add your services', <>Each one is a few lines. Secrets go in <code className={word}>.env</code> as <code className={word}>{'${NAME}'}</code>. Anything with a JSON API works with <code className={word}>type: api</code>.</>)}
        {step(3, 'Check it, then hide this', <>Run <code className={word}>config check</code> to find mistakes, and delete the <code className={word}>welcome</code> line when you're done.</>)}
      </div>
      <Starting setup={!!setup && !!ask} ask={ask ?? (() => {})} />
    </Card>
  );
}

function useWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => { const m = matchMedia(query), on = () => setWide(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [query]);
  return wide;
}

/** Signed in? Show the page; otherwise the sign-in screen (over the wallpaper, which needs no session). */
const Gallery = lazy(() => import('./gallery.tsx'));
const WallScreen = lazy(() => import('./wall.tsx'));
/** '' on /wall, a screen's name on /wall/<name>, and nothing anywhere else. */
export const wallScreen = () => /^\/wall(?:\/([a-z0-9][a-z0-9-]{0,31}))?\/?$/.exec(location.pathname)?.[1] ?? (/^\/wall\/?$/.test(location.pathname) ? '' : undefined);
const onWall = () => wallScreen() !== undefined;

/** A screen that can't sign in can still show the wall, once it's paired with wall.token: /wall#key=… The key leaves the
 *  address bar at once, and the browser keeps a cookie that reads the wall and nothing else. */
function usePaired(ask: boolean) {
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask) return;
    const key = /^#key=(.+)$/.exec(location.hash)?.[1];
    if (key) history.replaceState(null, '', location.pathname + location.search);
    const pair = key ? fetch('/api/auth/wall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: decodeURIComponent(key) }) }).catch(() => null) : Promise.resolve(null);
    void pair.then(() => fetch('/api/auth/wall')).then(r => setPaired(r.ok), () => setPaired(false));
  }, [ask]);
  return paired;
}

export function App() {
  const { me, setMe } = useMe();
  const wall = onWall(), paired = usePaired(wall && !!me && !me.user && me.mode !== 'none');
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  useEffect(() => { if (me && !me.user) document.documentElement.classList.add('dark', 'has-wallpaper'); }, [me]);
  if (!me) return null;
  if (wall && me && (me.user || paired)) return <Suspense fallback={null}><WallScreen /></Suspense>;
  if (wall && me && !me.user && paired === null) return null;
  if (me.user && hash === '#gallery') { document.documentElement.classList.add('dark'); return <Suspense fallback={null}><Gallery /></Suspense>; }
  if (!me.user) return (
    <SignIn setup={!!me.setup} provider={me.provider} onDone={name => setMe({ ...me, user: { name } })}
      wallpaper={<div className="wallpaper" aria-hidden><Wall src="/api/wallpaper" style={{ filter: 'blur(6px)' }} /></div>} />
  );
  return <Home account={me.mode !== 'none'} who={me.mode !== 'none' ? me.user.name : undefined} />;
}

// a card's own title and icon, from its layout entry: the same object for the same card, so memoised renderers stay still
const dressed = new WeakMap<CardOverride, { card: CardData; out: CardData }>();
export function dress(card?: CardData, o?: CardOverride) {
  if (!card || (!o?.title && !o?.icon)) return card;
  const hit = dressed.get(o);
  if (hit?.card === card) return hit.out;
  const out = { ...card, title: o.title ?? card.title, icon: o.icon ?? card.icon, ...(card.summary && { summary: { ...card.summary, label: o.title ?? card.summary.label, icon: o.icon ?? card.summary.icon } }) } as CardData;
  dressed.set(o, { card, out });
  return out;
}
// tabs: sections sharing a `tab` (or title) open together
const tabOf = (s: Page['sections'][number], i: number) => s.tab ?? s.title ?? `#${i}`;
const hashNow = () => { try { return decodeURIComponent(location.hash); } catch { return location.hash; } };

function Home({ account, who }: { account: boolean; who?: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const { state, notice, generation, insight: liveInsight, asks } = useLive();
  useEffect(() => { if (asks.length) play('notice'); }, [asks.length]);
  useEffect(() => { if (notice) play('notice'); }, [notice]);
  useEffect(() => { if (notice) toast(`notice:${notice.n}`, { text: notice.sub ? `${notice.text} · ${notice.sub}` : notice.text, tone: notice.tone === 'accent' ? undefined : notice.tone }, { ms: 6000 }); }, [notice]);
  const [brief, setBrief] = useState<string | null>(null);
  const [tailored, setTailored] = useState<{ list: string[]; wrong: string[] } | null>(null);
  const now = useClock();
  const theme = useTheme();
  // the address says which tab this is, so Back, Forward and a reload all work. Each tab keeps its own scroll position.
  const [hash, setHash] = useState(hashNow);
  const tabs = (page?.sections.map((s, i) => ({ ...s, i, key: tabOf(s, i) })).filter(s => s.title || s.tab) ?? [])
    .filter((s, j, all) => all.findIndex(x => x.key === s.key) === j);
  const view = tabs.find(t => `#${tabHash(t.key)}` === hash)?.key ?? 'all';   // 'all' (the overview) or a tab's name
  const seen = useRef('all'), spots = useRef(new Map<string, number>()), recapHere = useRef(false);
  // tabs change with a quick fade: the old one goes, the new one arrives. Each card fades itself, because fading the
  // page around it would cut the glass off from what's behind it.
  const pageEl = useRef<HTMLElement>(null), leaving = useRef<ReturnType<typeof setTimeout>>(undefined), arriving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-(reduced|none)/.test(document.documentElement.className);
  const go = useCallback((key: string) => {
    clearTimeout(leaving.current);
    if (key === seen.current) { delete pageEl.current?.dataset.view; return; }
    const change = () => {
      spots.current.set(seen.current, scrollY);
      history.pushState(null, '', key === 'all' ? location.pathname + location.search : `#${tabHash(key)}`);
      setHash(hashNow());
    };
    if (still() || !pageEl.current) { change(); return; }
    pageEl.current.dataset.view = 'out';
    leaving.current = setTimeout(change, 110);
  }, []);
  useEffect(() => {
    history.scrollRestoration = 'manual';
    const on = () => { spots.current.set(seen.current, scrollY); if (location.hash === '#recap') recapHere.current = true; setHash(hashNow()); };
    addEventListener('hashchange', on); return () => removeEventListener('hashchange', on);
  }, []);
  useLayoutEffect(() => {
    const moved = seen.current !== view;
    seen.current = view;
    if (moved && pageEl.current && !still()) {
      pageEl.current.dataset.view = 'in';
      clearTimeout(arriving.current);
      arriving.current = setTimeout(() => { delete pageEl.current?.dataset.view; }, 260);
    }
    const y = spots.current.get(view) ?? 0;
    scrollTo({ top: y, behavior: 'instant' });
    // a tab drawn again can need a moment to be tall enough
    let n = 0, frame = 0;
    const settle = () => { if (Math.abs(scrollY - y) < 2 || n++ > 20) return; scrollTo({ top: y, behavior: 'instant' }); frame = requestAnimationFrame(settle); };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [view]);
  const [palette, setPalette] = useState(false);
  // a tile tapped open: the widget whose full card shows in a sheet over the page
  const [opened, setOpened] = useState<{ key: string; tile: HTMLElement } | null>(null);
  const recap = hash === '#recap';
  const closeRecap = () => {
    if (location.hash !== '#recap') return;
    if (recapHere.current) { recapHere.current = false; history.back(); return; }   // it was opened from this page: go back to where that was
    history.replaceState(null, '', location.pathname + location.search); setHash('');
  };
  const [chat, setChat] = useState<{ text: string; n: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const wide = useWide();
  const phone = useWide('(max-width: 639px)');
  const bar = useRef<HTMLDivElement>(null), flipped = useRef(false);
  // the chat sheet follows the on-screen keyboard (phones report it through the visual viewport)
  useEffect(() => {
    const v = window.visualViewport, root = document.documentElement.style;
    if (!v || !chatOpen || !phone) return;
    const set = () => { root.setProperty('--vvh', `${v.height}px`); root.setProperty('--vvt', `${v.offsetTop}px`); };
    set(); v.addEventListener('resize', set); v.addEventListener('scroll', set);
    return () => { v.removeEventListener('resize', set); v.removeEventListener('scroll', set); root.removeProperty('--vvh'); root.removeProperty('--vvt'); };
  }, [chatOpen, phone]);
  const [draft, setDraft] = useState('');

  useEffect(() => { fetch(`/api/page?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&lang=${encodeURIComponent(navigator.language)}`).then(r => r.json()).then((p: Page) => { setFormat(p.format, p.labels); applyLook(p.look); setSounds(p.appearance.sounds); setPage(p); }); }, [generation]);
  useEffect(() => { if (page) document.title = page.title; }, [page]);
  // what's wrong and what's merely going on; a stall has to last, because a torrent between peers reads 0 B/s for a moment
  const how = sayHow(Object.values(state)), stalled = useHeld(how.problems.some(p => p.id === 'downloads'), 20_000);
  const trouble = how.problems.filter(p => p.id !== 'downloads' || stalled), mood = trouble.map(p => p.why).join('|');
  // questions the model wrote for what's going on now; refreshed while the page stays open, and soon after what's wrong changes
  const tailoring = !!page?.assistant && page.chat.suggestions === 'ai';
  const getTailored = useCallback(() => fetch('/api/suggest').then(r => r.json()).then(j => { if (j.list) setTailored({ list: j.list, wrong: j.wrong ?? [] }); }).catch(() => {}), []);
  useEffect(() => {
    if (!tailoring) return;
    getTailored();
    const t = setInterval(getTailored, 6 * 60_000);
    return () => clearInterval(t);
  }, [tailoring]);
  const asked = useRef(mood);
  useEffect(() => {
    if (!tailoring || mood === asked.current) return;
    asked.current = mood;
    const t = setTimeout(getTailored, 4000);   // let a burst of changes land first
    return () => clearTimeout(t);
  }, [tailoring, mood]);
  useEffect(() => {
    if (!page?.assistant) return;
    const get = () => fetch('/api/brief').then(r => r.json()).then(b => { if (b.text) setBrief(b.text); }).catch(() => {});
    get();
    const t = setInterval(get, 6 * 60_000);
    return () => clearInterval(t);
  }, [!!page?.assistant]);
  // A wallpaper means glass over it: dark glass, so text stays legible on any image, unless the config says light or system.
  // A config can give one wallpaper for light and one for dark; both or neither, so whether there's one never turns on the theme.
  const papers = (!theme.dark && page?.appearance.light) || page?.appearance;
  const walls = (view !== 'all' && papers?.tabWalls[view]) || papers?.walls || [];
  // a background script for this tab and theme, unless things should stay still; like a wallpaper, it puts the cards on glass
  const quiet = useStill(), scene = quiet ? undefined : sceneFor(page?.appearance.scenes, view, theme.dark);
  const wall = walls.length > 0 || !!scene, themeName = page?.look.theme;
  useEffect(() => { if (themeName) applyTheme(themeName, wall); }, [themeName, wall]);
  useEffect(adaptInk, []);
  // ⌘K's code is fetched once the page is quiet, so the first press opens as fast as any other
  useEffect(() => { const warm = () => { void loadPalette(); void loadSheet(); void loadMotion(); }; const id = 'requestIdleCallback' in window ? requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 2000); return () => { 'cancelIdleCallback' in window ? cancelIdleCallback(id as number) : clearTimeout(id); }; }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPalette(p => !p); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const chatTab = page?.sections.map((s, i) => (s.chat ? tabOf(s, i) : null)).find(Boolean) ?? null;
  const ask = useCallback((text: string) => {
    if (!text.trim()) return;
    play('send');
    setChat({ text: text.trim(), n: Date.now() }); setPalette(false); setDraft('');
    // on the assistant's own tab the answer appears on the page; anywhere else (and always on a phone), in the sheet
    if (phone || !(chatTab && view === chatTab)) setChatOpen(true);
  }, [chatTab, view, phone]);
  const warm = () => { void import('./assistant.tsx'); };   // about to be needed: start loading it

  // one stable action function per widget, so memoised cards don't re-render on every live update
  const runners = useRef(new Map<string, (action: string, args?: Record<string, unknown>) => Promise<void>>());
  const runFor = (key: string) => {
    let f = runners.current.get(key);
    if (!f) runners.current.set(key, f = (action, args) => runAction(key, action, args));
    return f;
  };
  const cause = liveInsight === undefined ? page?.insight : liveInsight;
  const chatMode = page?.chat.suggestions;
  const questions = !page?.assistant || chatMode === 'off' ? [] : chatMode === 'fixed' ? page.assistant.suggestions : stillTrue(suggest(state, page.assistant.suggestions, undefined, tailored?.list), tailored?.wrong ?? [], Object.values(state));
  // every card's quick actions, for ⌘K: "pause" finds "Pi-hole · Pause 5 min"
  // someone with a profile presses only the actions it lists. The server holds that; here the page just doesn't offer the
  // rest: no button in ⌘K, and a card of an integration they were given nothing on is read-only
  const granted = page?.member?.actions, may = (key: string, action?: string) => !granted || granted.some(a => action ? a === `${key.split('.')[0]}.${action}` : a.startsWith(`${key.split('.')[0]}.`));
  const actions = page?.canAct === false ? [] : Object.values(state).flatMap(w => (w.card?.buttons ?? []).filter(b => may(w.key, b.action)).map(b => ({ key: w.key, b, card: w.card!.title ?? page?.widgets[w.key]?.title ?? w.key })));
  // every service from the status cards, for ⌘K: type a name, open it
  const services = Object.values(state).flatMap(w => w.card?.type === 'status' ? w.card.items.filter(i => i.href) : []);
  // every item of a section's media cards, in the config's order: what's playing, then what's downloading…
  const mediaOf = (keys: string[]) => keys.flatMap(key => {
    const c = state[key]?.card;
    return c?.type === 'media' ? c.items.map((m, i) => ({ m, href: c.href, k: `${key}:${i}` })) : [];
  });
  // what's live right now, most important first (the config's order)
  const live: Live[] = (page?.live?.activities ?? []).flatMap(key => {
    const c = state[key]?.card;
    return c?.activity ? [{ ...c.activity, key, href: c.href, source: c.source }] : [];
  });
  const sections = page?.sections.map((s, i) => ({ ...s, i })).filter(s => view === 'all' ? s.overview !== false : tabOf(s, s.i) === view) ?? [];
  const sectionIcon = (s: Page['sections'][number]) => s.icon ?? state[s.widgets[0]]?.card?.icon;
  const navSide = page?.nav?.side ?? 'left';
  const hasSide = !!page?.sections.some(x => (x.place === 'left' || x.place === 'right') && (view === 'all' ? x.overview !== false : true));
  const tip = ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const)[navSide];
  const hidden = (name?: string) => !!name && !!page?.nav?.hide.some(h => h.toLowerCase() === name.toLowerCase());
  const spot = (k: string) => { const i = page?.nav?.order?.indexOf(k) ?? -1; return i < 0 ? Infinity : i; };
  const nav = tabs.filter(s => !hidden(s.key)).map((s, i) => [s, i] as const).sort(([a, i], [b, j]) => spot(a.key) - spot(b.key) || i - j).map(([s]) => s);   // stable: unlisted tabs keep their layout order
  const showOverview = !hidden('Overview') && !hidden(label('overview')), chatButton = page?.assistant && !chatTab && !hidden(page.assistant.name);
  const railBox = useRef<HTMLElement>(null), dockBox = useRef<HTMLDivElement>(null);
  const navStyle = page?.nav?.style ?? 'icons', words = navStyle !== 'icons', navIcon = navStyle !== 'labels';
  // the rail is as wide as its labels, and the page keeps clear of it
  const [railWidth, setRailWidth] = useState(0);
  useLayoutEffect(() => { setRailWidth((navSide === 'left' || navSide === 'right') && (words || getComputedStyle(document.documentElement).getPropertyValue('--nav-size')) ? railBox.current?.offsetWidth ?? 0 : 0); }, [navSide, words, nav.length, page]);
  const swell = useDock(railBox, navSide);
  useEffect(() => { dockBox.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [view, nav.length]);   // a dock that scrolls keeps its tab in sight
  // remember what's empty (nothing playing), so it doesn't flash a placeholder on the next visit
  useEffect(() => { for (const [k, s] of Object.entries(state)) if (isEmpty(s.card)) noteShape(k, { empty: true }); }, [state]);

  // the page waits a moment for its first readings and arrives whole, rather than cards popping in and pushing each other
  const [settled, setSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 900); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (settled || !page) return;
    const want = page.sections.filter(s => s.overview !== false).flatMap(s => s.widgets);
    if (want.filter(k => state[k]).length >= want.length * .8) setSettled(true);
  }, [page, state, settled]);
  const h = page?.hero, chatUi = page?.chat;
  // follow-ups outlive what they were about too: none about a service that's fine again
  const fresh = chatUi?.followUps && stillTrue(chatUi.followUps, [], Object.values(state)).join('\n');
  // the demo's chat also offers the year in review, so visitors find it; on a real Valet the page's link is enough
  const review = page?.sandbox && page.recap !== false && h?.review !== false ? label('review', { year: new Date().getFullYear() }) : undefined;
  const ui = useMemo(() => chatUi && { ...chatUi, review, ...(fresh != null && { followUps: fresh ? fresh.split('\n') : [] }) }, [chatUi, fresh, review]);
  const named = { name: page?.assistant?.name ?? '' };
  const placeholder = (ui?.placeholder ?? (h?.scope?.length ? label('askAbout', { scope: h.scope.slice(0, phone ? 2 : 6).join(', ') }) : label('askAnything'))).replace('{name}', page?.assistant?.name ?? '');
  const askHere = !!page?.assistant && ui?.overview !== false, chips = askHere && chatMode !== 'off';
  const hello = !h || h.greeting === false ? '' : typeof h.greeting === 'string' ? h.greeting.replace('{greeting}', greet(now.getHours())).replace('{name}', page?.greeting ?? '').trim() : page?.greeting ? label('homelab', { name: page.greeting }) : label('yourHomelab');
  const [reviewed, setReviewed] = useState(() => { try { return !!sessionStorage.getItem('valet-review'); } catch { return false; } });   // dismissed, for this visit
  // the link waits until there's a story to tell: a near-empty install has nothing to look back on
  const [story, setStory] = useState(false);
  useEffect(() => {
    if (!page || page.recap === false || h?.review === false) return;
    const t = setTimeout(() => fetch('/api/recap').then(r => r.ok ? r.json() : null).then(r => setStory((r?.slides?.length ?? 0) >= 3)).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [page?.recap, h?.review, !!page]);
  const offered = story && page?.recap !== false && h?.review !== false && !reviewed, pill = offered, closing = offered && h?.review === 'end' && view === 'all';
  const boxed = h?.search !== false, shownChips = useLeaving(chips ? questions.slice(0, pill && h?.review !== 'end' ? 2 : 3) : []);   // three in all: the year in review takes a place
  const dismissReview = () => { setReviewed(true); try { sessionStorage.setItem('valet-review', '1'); } catch { /* private mode */ } };
  const side = h?.align === 'left' ? 'mr-auto text-left' : h?.align === 'right' ? 'ml-auto text-right' : 'mx-auto text-center';
  // the hero: ask anything
  const line = cause || oneLine(trouble, how.parts);
  const hero = view === 'all' && (hello || h?.status !== false || boxed || pill || page?.notice) && (
          <header className={cn('wall-text w-full max-w-[720px] pt-3 xl:pt-5', side, h?.align === 'left' && '-mb-4')}>
            {page?.notice && <p className="mb-2 text-meta text-muted-foreground">{page.notice}</p>}
            {hello && <h1 className="hero-title text-metric-m leading-tight font-medium">{hello}</h1>}
            {/* its line is held from the start, so its words arriving move nothing */}
            {h?.status !== false && <div key={line} role="status" title={brief ?? undefined} className="brief-in mx-auto mt-1 min-h-[21px] max-w-full text-item leading-[1.5] text-pretty text-muted-foreground sm:truncate">{line}</div>}
            {askHere && boxed && (
              <ChatBeam ui={ui} className="mt-4"><form className="glass-round flex items-center gap-2.5 py-2 pr-2 pl-5 text-left transition-shadow focus-within:ring-2 focus-within:ring-fill-3"
                onSubmit={e => { e.preventDefault(); ask(draft); }}>
                <label htmlFor="ask-box" className="sr-only">{label('ask', named)}</label>
                <input id="ask-box" value={draft} onChange={e => setDraft(e.target.value)} onFocus={warm} placeholder={placeholder}
                  className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ellipsis outline-none placeholder:text-muted-foreground" />
                {!draft.trim() && <kbd className="hidden rounded-tag border border-input px-1.5 py-0.5 font-sans text-meta text-muted-foreground sm:block">⌘K</kbd>}
                <button type="submit" aria-label="Ask" disabled={!draft.trim()}
                  className="send-round grid size-10 shrink-0 place-items-center rounded-chip bg-foreground text-(--card-tint) transition-colors disabled:bg-fill-3 disabled:text-foreground"><ArrowUp className="size-icon-lg" /></button>
              </form></ChatBeam>
            )}
            {page && !askHere && boxed && (
              <button onClick={() => setPalette(true)} className="glass-round mt-4 flex h-11 w-full items-center gap-2.5 rounded-sm px-5 text-left text-title text-muted-foreground">
                <Search className="size-icon" /><span className="flex-1">{label('search')}</span>
                <kbd className="hidden rounded-tag border border-input px-1.5 py-0.5 font-sans text-meta sm:block">⌘K</kbd>
              </button>
            )}
            {chips && (
              <div className="fade-x no-scrollbar mt-1.5 overflow-x-auto py-1">
                {/* centred when it fits, scrolls from the start when it doesn't */}
                <div className={cn('flex min-h-8 w-max min-w-full gap-1.5', h?.align === 'left' ? 'justify-start' : h?.align === 'right' ? 'justify-end' : 'justify-center', h?.align === 'left' ? 'mr-auto' : h?.align === 'right' ? 'ml-auto' : 'mx-auto')}>
                  {shownChips.map(({ s, out }) => (
                    <Chip key={s} onClick={() => ask(s)} tabIndex={out ? -1 : undefined} className={out ? 'chip-out' : arrival(`chip:${s}`)} style={out ? { maxWidth: 320 } : undefined}>{s}</Chip>
                  ))}
                  {/* the year in review, one more chip in the row, with its own way to put it away */}
                  {pill && <span className="review-chip inline-flex flex-none items-center rounded-chip bg-fill-1">
                    <a href="#recap" className="press flex h-8 items-center pr-1 pl-3 text-body hover:text-foreground">{label('review', { year: now.getFullYear() })}</a>
                    <button onClick={e => { dissolve(e.currentTarget.parentElement); dismissReview(); }} aria-label={label('dismiss')} className="press mr-1 grid size-6 flex-none place-items-center rounded-sm text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
                  </span>}
                </div>
              </div>
            )}
            {pill && !chips && <div className={cn('mt-1 flex items-center text-body text-muted-foreground', h?.align === 'left' ? 'justify-start' : h?.align === 'right' ? 'justify-end' : 'justify-center')}>
              <a href="#recap" className="press rounded-sm py-1 pr-1 pl-2.5 hover:text-foreground">{label('review', { year: now.getFullYear() })}</a>
              <button onClick={e => { dissolve(e.currentTarget.parentElement); dismissReview(); }} aria-label={label('dismiss')} className="press grid size-6 flex-none place-items-center rounded-sm hover:text-foreground"><X className="size-3" /></button>
            </div>}
          </header>
        );

  const place = phone ? 'center' : ui?.open ?? 'center', docked = place === 'left' || place === 'right';
  const topbar = page?.menubar;
  const weatherCard = page?.weather && state[page.weather]?.card?.type === 'forecast' ? state[page.weather]!.card as ForecastCard : undefined;
  const noClock = phone && live.length > 0 && !!weatherCard;
  const chatWide = wide && !phone && !!chatTab && view === chatTab && !!page?.assistant;
  // a section title on the page, as it always was; one that's only a tab's name is still a heading to a screen reader
  const titled = (sec: Page['sections'][number]) => view === 'all' && sec.heading !== false && (sec.display === 'cards' || sec.display === 'media') && !(sec.widgets.length === 1 && page?.widgets[sec.widgets[0]]?.title === sec.title);
  const renderSection = (sec: (typeof sections)[number], aside = sec.place === 'left' || sec.place === 'right') => (
          <section key={`${view}:${sec.i}`} data-plain={sec.title && titled(sec) ? undefined : ''} className="space-y-3" style={sec.gap != null ? { '--card-gap': `${sec.gap}px`, '--tile-gap': `${sec.gap}px` } as React.CSSProperties : undefined}>
            {sec.title && (titled(sec) ? <h2 className="wall-text px-0.5 text-item font-medium text-muted-foreground">{sec.title}</h2> : sec.title !== view && <h2 className="sr-only">{sec.title}</h2>)}
            {sec.display === 'media'
              ? (
                <div className={cn('grid gap-(--card-gap)', sec.grid && 'cols')} style={sec.grid ? gridVars(sec.grid) : { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${sec.columns ? Math.floor(1200 / sec.columns) - 40 : 420}px), 1fr))` }}>
                  {mediaOf(sec.widgets).map(({ m, href, k }) => (
                    <Shell key={k}><a href={href} target="_blank" rel="noreferrer" className="block px-(--pad)"><NowPlaying m={m} compact /></a></Shell>
                  ))}
                </div>
              )
              : sec.display === 'rings'
              ? (
                <Card className="py-5 shadow-card">
                  <div className={cn('grid gap-y-5 px-4', sec.grid && 'cols')} style={sec.grid ? gridVars(sec.grid) : { gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
                    {sec.widgets.flatMap(key => {
                      const c = state[key]?.card;
                      return tilesOf(c).map((t, j) => <Ring key={`${key}${j}`} s={t} />);
                    })}
                  </div>
                </Card>
              )
              : sec.display === 'tiles'
              ? (
                <div className={cn('grid gap-(--tile-gap)', sec.grid && 'cols')} style={sec.grid ? gridVars(sec.grid) : { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>
                  {sec.widgets.flatMap(key => {
                    const o = sec.looks?.[key], c = dress(state[key]?.card, o);
                    if (!c) return [<TileSkeleton key={key} />];
                    // a tile does what its card does, on its first tile, where this page may act and this person may use it
                    const run = page?.canAct === false || !may(key) ? undefined : runFor(key), acts = tileActions(c);
                    // tapped, a tile opens its full card (or the one `open` names); `open: false`, on it or its section, keeps it to look at
                    const target = sec.open === false || o?.open === false ? undefined : typeof o?.open === 'string' ? o.open : key;
                    return tilesOf(c).map((t, j) => <div key={`${key}${j}`} className={cn(arrival(key), 'min-w-0', o?.style && 'card-look')} style={o?.style as React.CSSProperties}><SummaryTile s={t} href={c.href} actions={j === 0 ? acts : undefined} run={run} onOpen={target ? tile => { if (SheetNow) setOpened({ key: target, tile }); else void loadSheet().then(() => setOpened({ key: target, tile })); } : undefined} /></div>);
                  })}
                </div>
              )
              : (
                (() => {
                  const keys = sec.widgets.filter(key => state[key] ? !isEmpty(state[key].card) : !shapeOf(key)?.empty);
                  const widget = (key: string, large = false, fill: boolean | 'always' = false, dense = false) => {
                    const s = state[key], o = sec.looks?.[key], card = dress(asView(view === 'all' ? favorites(s?.card, sec.favorites) : s?.card, o?.view), o);
                    const body = <Shaped key={key} id={key} card={s?.card}><Widget large={large} fill={fill} card={card} kind={shapeOf(key)?.t} failed={s?.error} title={o?.title ?? page?.widgets[key]?.title} columns={aside ? sec.columns : undefined} minimal={dense || sec.variant === 'minimal' || (phone && view === 'all')} headless={o?.header === false || (o?.header !== true && sec.header === false)}
                      status={s?.error ? <span className="truncate text-meta text-warn" title={s.error}>{s.card ? 'stale' : s.error}</span> : null}
                      run={page?.canAct === false || !may(key) ? undefined : runFor(key)} /></Shaped>;
                    return o?.style ? <div key={key} className="card-look contents" style={o.style as React.CSSProperties}>{body}</div> : body;
                  };
                  const sized = page?.appearance.sizes ?? {};
                  // sized: a bento of 2, 4 or 6 tracks, so rows end flush at any width. Small cards take one track as their
                  // headline tile, wide takes two, medium is the card at two, tall is that over two rows, large four. A calendar needs
                  // the room for its month, so wide means large for it.
                  if (sec.sizes && Object.keys(sec.sizes).length && !aside) return (
                    <div className={cn('bento grid grid-flow-row-dense gap-(--card-gap)', sec.grid ? 'cols' : 'grid-cols-2 @2xl/main:grid-cols-4 @5xl/main:grid-cols-6 @[110rem]/main:grid-cols-8')} style={sec.grid && gridVars(sec.grid)}>
                      {keys.map((key, j) => {
                        const o = sec.looks?.[key], c = dress(state[key]?.card, o), size = c?.type === 'calendar' && sec.sizes![key] === 'wide' ? 'large' : sec.sizes![key];
                        const span = cn(size !== 'small' && 'col-span-2', size === 'tall' && 'row-span-2', size === 'large' && 'col-span-full @5xl/main:col-span-4');
                        // a size the config redefines, or a grid of its own, spans by number, never past the last column
                        const [cols, rows] = SPANS[size ?? 'medium'], own = sized[size ?? 'medium'];
                        const spans = (own || sec.grid || o?.cols) ? { gridColumn: `span min(${o?.cols ?? own?.cols ?? cols}, var(--tracks, 6))`, gridRow: `span ${o?.rows ?? own?.rows ?? rows}` } : o?.rows ? { gridRow: `span ${o.rows}` } : undefined;
                        if ((size === 'small' || size === 'wide') && c?.summary) return <div key={key} className={cn('min-w-0', !spans?.gridColumn && span, o?.style && 'card-look')} style={{ ...spans, ...o?.style }}><SummaryTile s={c.summary} href={c.href} /></div>;
                        return <div key={key} style={spans} className={cn('min-w-0', !spans?.gridColumn && (size === 'small' ? 'col-span-2' : span))}>{widget(key, size === 'large', 'always')}</div>;
                      })}
                    </div>
                  );
                  if (sec.grid && !aside) return (
                    <div className="cols grid grid-flow-row-dense gap-(--card-gap)" style={gridVars(sec.grid)}>
                      {keys.map(k => { const c = sec.looks?.[k]?.cols, r = sec.looks?.[k]?.rows; return <div key={k} className="flex min-w-0 flex-col" data-tall={r && r > 1 ? '' : undefined} style={{ ...(c && { gridColumn: `span min(${c}, var(--tracks))` }), ...(r && { gridRow: `span ${r}` }) }}>{widget(k, false, 'always')}</div>; })}
                    </div>
                  );
                  // a wide card (e.g. the 3D desktop) takes two thirds; the rest stack beside it
                  const hero = !sec.columns && keys.find(k => state[k]?.card?.wide);
                  if (hero && keys.length === 1) return widget(hero);
                  if (hero) return (
                    <div className="grid items-start gap-(--card-gap) @5xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                      {widget(hero)}
                      <div className="grid gap-(--card-gap)">{keys.filter(k => k !== hero).map(k => widget(k))}</div>
                    </div>
                  );
                  // a long mix of cards packs into columns with compact rows, and a very long card scrolls inside itself
                  if (!aside && !sec.columns && keys.length > 3) return (
                    <div className="columns-[340px] gap-(--card-gap)">
                      {keys.map(k => <div key={k} className="card-cap mb-(--card-gap) min-w-0 break-inside-avoid">{widget(k, false, false, true)}</div>)}
                    </div>
                  );
                  // a card that's come up empty gives its column back, and cards in a row share a height
                  const wanted = (view !== 'all' && sec.tabColumns) || sec.columns, cols = Math.min(wanted ?? keys.length, keys.length), row = !aside && keys.length > 1 && cols > 1;
                  return (
                    // a fixed column count applies from tablet width up; phones get one column
                    <div className={cn('grid gap-(--card-gap)', aside && 'items-start', sec.columns && !aside && 'grid-cols-1 @3xl/main:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]')}
                      style={sec.columns && !aside ? { '--cols': cols } as React.CSSProperties : { gridTemplateColumns: aside ? '1fr' : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
                      {keys.map(k => <div key={k} className="min-w-0">{widget(k, false, row)}</div>)}
                    </div>
                  );
                })()
              )}
            {(() => {   // favourites: the way to the rest of them
              const whole = view === 'all' && sec.favorites ? sec.widgets.map(k => state[k]?.card).find(c => c?.type === 'status') : undefined, key = tabOf(sec, sec.i);
              if (whole?.type !== 'status' || !tabs.some(t => t.key === key) || (favorites(whole, sec.favorites) as StatusCard).items.length >= whole.items.length) return null;
              return <div className="wall-text flex justify-end"><button onClick={() => go(key)} className="press px-0.5 text-body text-muted-foreground transition-colors hover:text-foreground"><span key={whole.items.length} className="tick">{label('allOf', { n: whole.items.length })}</span> →</button></div>;
            })()}
          </section>
  );

  return (
    <TooltipProvider delayDuration={300}>
      {walls.length > 0 && <Walls list={walls} every={page!.appearance.rotate} />}
      {scene && <Scene name={scene} theme={theme.dark ? 'dark' : 'light'} tab={view} />}


      {/* the tab buttons, on whichever side the config says (wide screens); a column on the left/right, a dock at the top/bottom */}
      <nav ref={railBox} {...swell} aria-label="Sections" data-style={navStyle} className={cn('dock z-30 hidden gap-3 md:flex', {
        left: 'fixed top-1/2 left-5 -translate-y-1/2 flex-col items-start',
        right: 'fixed top-1/2 right-5 -translate-y-1/2 flex-col items-end',
        bottom: 'glass-bar fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border p-1.5 gap-2',
        top: 'glass-bar absolute top-[calc(6rem*var(--bar-zoom,1))] left-1/2 -translate-x-1/2 rounded-full border p-1.5 gap-2',
      }[navSide])}>
        {showOverview && <RoundButton tip={tip} words={words} label={label('overview')} active={view === 'all'} onClick={() => go('all')}>{navIcon && <LayoutGrid />}</RoundButton>}
        {nav.map(s => (
          <RoundButton tip={tip} words={words} key={s.key} label={s.key} active={view === s.key} onClick={() => go(s.key)}>{navIcon && <Icon name={s.chat ? ui?.icon ?? 'chat' : sectionIcon(s) ?? 'pulse'} />}</RoundButton>
        ))}
        {chatButton && <RoundButton tip={tip} words={words} label={page!.assistant!.name} onClick={() => setChatOpen(o => !o)}>{navIcon && (ui?.icon ? <Icon name={ui.icon} /> : <MessageCircle />)}</RoundButton>}
      </nav>

      {/* top-right: the menubar rings, weather and time (and the theme switch when there's no wallpaper).
          Below lg it sits at the top of the page instead, centred and wrapping, so phones see it too. */}
      {/* phones: one row, condensed, and when something's live the weather gives up the clock to make room; wide screens: top right */}
      <div ref={bar} data-labels={topbar?.labels !== false || undefined} className={cn(!settled && 'invisible', 'menubar wall-text relative z-20 flex items-stretch justify-center gap-1.5 px-3 pt-[max(.75rem,env(safe-area-inset-top))] sm:gap-2 xl:absolute xl:top-5 xl:gap-4 xl:p-0', { left: 'xl:left-5', center: 'xl:left-1/2 xl:-translate-x-1/2', right: 'xl:right-5' }[topbar?.position ?? 'right'])}>
        {(!!topbar?.widgets.length || live.length > 0) && (
          <div className="ring-row glass-bar glass-plate relative flex shrink items-center border px-2 py-1 sm:px-4 sm:py-1.5">
            {live.length > 0 && <><LiveRings live={phone ? live.slice(0, 2) : live} />{!!topbar?.widgets.length && <i className="live-rule" aria-hidden />}</>}
            {topbar?.widgets.flatMap(key => {
              const c = state[key]?.card;
              return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <div key={`${key}${j}`} role="group" aria-label={`${t.label} ${t.value}`} className="fade-in-soft"><MiniRing s={t} /></div>);
            })}
          </div>
        )}
        {(topbar?.clock !== false || topbar?.date !== false || weatherCard) && <div className="glass-bar glass-plate relative flex shrink-0 items-center gap-2.5 rounded-full border py-1 pr-3.5 pl-1.5 sm:gap-4 sm:py-1.5 sm:pr-5 sm:pl-2">
          {weatherCard && <WeatherRing card={weatherCard} />}
          {!noClock && (topbar?.clock !== false || topbar?.date !== false) && <ClockMonth card={page?.calendar ? state[page.calendar]?.card : undefined}>
          {topbar?.clock !== false && <div className="text-item font-medium tabular">{clock(now)}</div>}
          {topbar?.date !== false && <div className={cn('text-meta text-muted-foreground sm:block', topbar?.clock !== false && 'hidden')}>{day(now)}</div>}
          </ClockMonth>}
        </div>}
        {topbar?.theme !== false && switchable(page?.look.theme ?? 'auto', wall) && <RoundButton label={theme.dark ? 'Light' : 'Dark'} onClick={() => { flipped.current = true; theme.toggle(); }}>{theme.dark ? <Sun key="sun" className={cn(flipped.current && 'spin-in')} /> : <Moon key="moon" className={cn(flipped.current && 'spin-in')} />}</RoundButton>}
      </div>

      <main ref={pageEl} data-settling={settled ? undefined : ''} style={railWidth ? { [navSide === 'left' ? 'paddingLeft' : 'paddingRight']: `calc(${railWidth}px + 2.5rem)` } : undefined} className={cn('@container/main mx-auto flex flex-col gap-(--section-gap) px-4 pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] xl:pt-20', view !== 'all' && (h?.align === 'left' ? 'pt-10 xl:pt-2' : 'pt-10 xl:pt-28'), view === 'all' && h?.align === 'left' && 'xl:pt-2',   /* a hero at the left shares the top bar's row */ chatWide && (h?.align === 'left' ? 'pb-6!' : 'pb-6! xl:pt-24'), { left: 'md:pr-8 md:pl-24 md:pb-16', right: 'md:pl-8 md:pr-24 md:pb-16', bottom: 'md:px-8 md:pb-28', top: 'md:px-8 md:pb-16 md:pt-[calc(10rem*var(--bar-zoom,1))] xl:pt-[calc(10rem*var(--bar-zoom,1))]' }[navSide], chatWide && navSide === 'left' && (topbar?.position ?? 'right') === 'right' ? 'max-w-none md:pr-5!' : chatWide || page?.sections.some(x => x.place === 'left' || x.place === 'right') ? 'max-w-[var(--page-max,1720px)]' : 'max-w-[var(--page-max,1320px)]')}>
        {/* with the greeting at the top left, each tab names itself in the same place, so every screen starts the same way */}
        {view !== 'all' && h?.align === 'left' ? <header className="wall-text hidden pt-3 xl:block xl:min-h-[calc(101px-0.5rem-var(--section-gap))] xl:pt-5"><h1 className="hero-title text-metric-m leading-tight font-medium">{view}</h1></header>
          : (view !== 'all' || !hello) && <h1 className="sr-only">{view === 'all' ? page?.title : view}</h1>}
        {!hasSide && hero}
        {/* an edit that didn't apply says so here, on every tab, until the next one that does */}
        {page?.configError && <div role="alert" className="settle flex gap-3 rounded-surface border border-[color-mix(in_oklab,var(--warn)_45%,transparent)] bg-card px-5 py-4 shadow-card">
          <TriangleAlert className="mt-0.5 size-icon-lg shrink-0 text-(--warn)" aria-hidden />
          <div className="min-w-0"><div className="text-title font-semibold">Your last edit to config.yaml wasn't applied</div>
            <p className="mt-0.5 text-body text-muted-foreground">The page is still running the last version that worked. {page.configError.message ? 'Fix this and save again:' : 'The server log says what went wrong.'}</p>
            {page.configError.message && <pre className="mt-2 overflow-x-auto rounded-md bg-foreground/[.06] px-3 py-2 font-mono text-meta leading-relaxed whitespace-pre-wrap text-foreground/85">{page.configError.message}</pre>}</div>
        </div>}
        {page?.welcome && view === 'all' && <Welcome path={page.welcome.path} saved={page.welcome.saved} setup={page.welcome.setup && !!page.assistant} ask={ask} />}

        {/* phones: the assistant's tab is its stats plus a way into the chat sheet */}
        {phone && chatTab && view === chatTab && page?.assistant && (
          <button onClick={() => setChatOpen(true)} className="glass-round press flex h-12 items-center gap-2.5 rounded-sm px-5 text-left text-[16px] text-muted-foreground"><MessageCircle className="size-icon-lg" />{label('ask', named)}</button>
        )}
        {!phone && chatTab && view === chatTab && page?.assistant && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_200px]">
          <div data-slot="card" className="h-[calc(100dvh-var(--chat-top,7.5rem))] min-h-[520px] overflow-hidden rounded-surface border bg-card shadow-card">
            <Suspense fallback={null}>
              <Assistant name={page.assistant.name} model={page.assistant.model} models={page.assistant.models} discover={page.assistant.discover} ask={chat} suggestions={questions.slice(0, 4)} tools={page.assistant.tools} integrations={page.assistant.integrations} external={page.assistant.external} onAsk={ask} ui={ui} attach={page.canAct !== false && !page.sandbox} voice={page.voice} />
            </Suspense>
          </div>
          {/* the tab's numbers sit small beside the chat, which gets the room */}
          {chatWide && <aside className="chat-aside no-scrollbar flex h-[calc(100dvh-var(--chat-top,7.5rem))] min-h-[520px] flex-col gap-3 overflow-y-auto">{sections.map(x => renderSection(x, true))}</aside>}
          </div>
        )}
        {!chatWide && (() => {
          // sections placed left/right become a sidebar beside the rest on wide screens; stacked on smaller ones
          const shown = sections.filter(sec => sec.display === 'media' ? mediaOf(sec.widgets).length > 0 : sec.display !== 'cards' || sec.widgets.some(k => !isEmpty(state[k]?.card)));
          const side = shown.filter(x => x.place === 'left' || x.place === 'right'), rest = shown.filter(x => x.place !== 'left' && x.place !== 'right');
          if (!side.length) return rest.map(x => renderSection(x));
          // a sidebar runs the full height of the page; the greeting and the ask box move into the column beside it
          const right = side.some(x => x.place === 'right');
          return (
            <div className="grid items-start gap-(--section-gap)" style={wide ? { gridTemplateColumns: (w => right ? `minmax(0,1fr) ${w}px` : `${w}px minmax(0,1fr)`)(side.every(x => x.variant === 'minimal') ? 230 * Math.max(1, ...side.map(x => x.columns ?? 1)) : 460) } : undefined}>
              <aside className={cn('no-scrollbar flex flex-col gap-(--section-gap) xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto', right && 'xl:order-2')}>{side.map(x => renderSection(x))}</aside>
              <div className="flex min-w-0 flex-col gap-(--section-gap)">{hero}{rest.map(x => renderSection(x))}</div>
            </div>
          );
        })()}
        {closing && (
          <div data-slot="card" className="review-end rounded-surface border bg-card shadow-card">
            <div className="min-w-0 flex-1">
              <div className="text-title font-medium">{label('review', { year: now.getFullYear() })}</div>
              <div className="mt-0.5 truncate text-item text-muted-foreground">{label('reviewMore')}</div>
            </div>
            <a href="#recap" className="review-end-go press">{label('reviewGo')}<ArrowUp className="size-icon rotate-90" /></a>
            <button onClick={e => { dissolve(e.currentTarget.closest('.review-end')); dismissReview(); }} aria-label={label('dismiss')} className="press grid size-8 flex-none place-items-center rounded-full text-muted-foreground hover:text-foreground"><X className="size-icon" /></button>
          </div>
        )}
      </main>

      {/* phones: the rail becomes a floating pill at the bottom */}
      <nav aria-label="Sections" className="glass-bar fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-20 rounded-full border p-1.5 md:hidden">
        <div ref={dockBox} className="no-scrollbar relative flex justify-between gap-1 overflow-x-auto">
          {showOverview && <DockButton name={label('overview')} active={view === 'all'} onClick={() => go('all')}><LayoutGrid /></DockButton>}
          {nav.map(s => <DockButton key={s.key} name={s.key} active={view === s.key} onClick={() => { go(s.key); if (s.chat) { warm(); setChatOpen(true); } }}><Icon name={s.chat ? ui?.icon ?? 'chat' : sectionIcon(s) ?? 'pulse'} /></DockButton>)}
          {chatButton && <DockButton name={page!.assistant!.name} onClick={() => setChatOpen(true)}>{ui?.icon ? <Icon name={ui.icon} /> : <MessageCircle />}</DockButton>}
        </div>
      </nav>

      {asks.length > 0 && <Suspense fallback={null}><Asks asks={asks} /></Suspense>}
      {recap && page?.recap !== false && <Suspense fallback={null}><RecapStory onClose={closeRecap} wallpaper={page?.appearance.walls.find(w => w.image)?.image} /></Suspense>}
      {page && palette && (
        <Suspense fallback={null}>{(P => <P palette={palette} setPalette={setPalette} assistantName={page.assistant?.name} placeholder={page.assistant && (page.chat.placeholder || page.hero.scope?.length) ? placeholder : undefined} ui={ui} ask={ask} actions={actions} account={account} who={who} tools={page.assistant?.tools}
          openChat={() => { setPalette(false); if (phone || !(chatTab && view === chatTab)) setChatOpen(true); }}
          runAction={runAction} services={services} SUGGESTIONS={questions} setView={go} nav={nav} sectionIcon={sectionIcon} search={page.search} find={page.find} device={{ sandbox: page.sandbox, canAct: page.canAct !== false, member: !!page.member }} />)(PaletteNow ?? Palette)}</Suspense>
      )}

      {/* a tile's full card, flipped open over the page, with what it can do here: the same controls, and rules, as the card */}
      {opened && SheetNow && <SheetNow key={opened.key} tile={opened.tile} title={page?.widgets[opened.key]?.title ?? state[opened.key]?.card?.title ?? opened.key} onClosed={() => setOpened(null)}>
        <Widget large card={state[opened.key]?.card} kind={shapeOf(opened.key)?.t} failed={state[opened.key]?.error} title={page?.widgets[opened.key]?.title}
          run={page?.canAct === false || !may(opened.key) ? undefined : runFor(opened.key)} />
      </SheetNow>}
      {page?.assistant && (
        <Dialog open={chatOpen} onOpenChange={setChatOpen} modal={!docked}>
          {/* the chat pops out over the page, frosted like everything else: a tall window in the middle unless the config
              moves it. A panel at the side leaves the page usable beside it; phones always get the full sheet. */}
          <DialogContent ref={springIn} showCloseButton={false} data-place={place} onOpenAutoFocus={e => { if (phone) e.preventDefault(); }} onInteractOutside={e => { if (docked) e.preventDefault(); }} className="chat-pop flex max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
            <DialogTitle className="sr-only">{page.assistant.name}</DialogTitle>
            <DialogDescription className="sr-only">Ask about your homelab</DialogDescription>
            {chatOpen && (
              <Suspense fallback={null}>
                <Assistant name={page.assistant.name} model={page.assistant.model} models={page.assistant.models} discover={page.assistant.discover} ask={chat} suggestions={questions.slice(0, 4)} tools={page.assistant.tools} integrations={page.assistant.integrations} external={page.assistant.external} onAsk={ask} ui={ui} attach={page.canAct !== false && !page.sandbox} voice={page.voice} onClose={phone ? () => setChatOpen(false) : undefined} onDismiss={!phone && place !== 'center' ? () => setChatOpen(false) : undefined} />
              </Suspense>
            )}
          </DialogContent>
        </Dialog>
      )}
    </TooltipProvider>
  );
}
