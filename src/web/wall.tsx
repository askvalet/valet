// The wall display (/wall, and /wall/<name> for another screen): the config's own wall pages, full screen, for reading
// from across a room. No chat, no ⌘K, no links, whoever is signed in; the only things that can be pressed are the controls
// of the cards `wall.touch` lists. Which pages may show is the server's to say (`when`). Loaded only when someone opens it.
import { tileActions, tilesOf } from '../shared/tiles.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ForecastCard, WidgetState } from '../shared/cards.ts';
import { asView } from '../shared/views.ts';
import { clock, highLow, label, longDay, oneLine, sayHow, setFormat } from './format.ts';
import { applyLook, applyTheme } from './look.ts';
import { isEmpty, NowPlaying, Ring, Shell, Shaped, shapeOf, SummaryTile, TileSkeleton, Widget, type RunAction } from './cards.tsx';
import { WeatherGlyph } from './home-cards.tsx';
import { dress, useDark, useHeld, useLive, wallScreen, Walls, type Page, type Size } from './app.tsx';
import { Scene, sceneFor, useStill } from './scene.tsx';
import { Touch } from './touch.ts';
import { nextPage, stayFor } from './wall-turn.ts';
import { gridVars, wallCell } from './grid.ts';

type Section = Page['sections'][number];
type WallPage = Page['wall']['pages'][number];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-(reduced|none)/.test(document.documentElement.className);

/** With no pages of its own, the wall shows the main page's services and what's playing or downloading. */
function defaultPage(state: Record<string, WidgetState>, sections: Section[]): WallPage {
  const order = [...new Set(sections.length ? sections.flatMap(s => s.widgets) : Object.keys(state))];
  const status = order.find(k => state[k]?.card?.type === 'status');
  const media = order.filter(k => state[k]?.card?.type === 'media').slice(0, 2);
  const plain = { display: 'cards' as const, sizes: {}, looks: {} };
  return { clock: true, sections: [...status ? [{ ...plain, widgets: [status], columns: 1 }] : [], ...media.length ? [{ ...plain, widgets: media, columns: media.length }] : []] };
}

/** Minutes past midnight, from "21:30" or a Date. */
const minutes = (t: string | Date) => typeof t === 'string' ? Number(t.slice(0, -3)) * 60 + Number(t.slice(-2)) : t.getHours() * 60 + t.getMinutes();
/** Night: between the configured times, or sunset and sunrise when the weather knows them (21:00 and 07:00 when it doesn't). */
function isNight(night: Page['wall']['night'], now: Date, sun?: { rise: string; set: string }) {
  if (!night) return false;
  const from = minutes(night.from === 'sunset' ? sun?.set ?? '21:00' : night.from), to = minutes(night.to === 'sunrise' ? sun?.rise ?? '07:00' : night.to), at = minutes(now);
  return from === to ? false : from < to ? at >= from && at < to : at >= from || at < to;
}

/** Keeps the screen on while the wall is open, where the browser allows it (it needs https, or localhost). */
function useAwake(on: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!on || !api) return;
    let lock: { release(): Promise<void> } | null = null, gone = false;
    const take = () => { if (document.visibilityState === 'visible' && !gone) api.request('screen').then(l => { if (gone) void l.release(); else lock = l; }).catch(() => {}); };
    take();
    document.addEventListener('visibilitychange', take);   // the browser lets go when the tab is hidden
    return () => { gone = true; document.removeEventListener('visibilitychange', take); void lock?.release().catch(() => {}); };
  }, [on]);
}

/** The pointer goes after a few seconds of stillness, and comes back when it moves. */
function useIdle(ms = 3000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), ms);
    const on = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), ms); };
    addEventListener('pointermove', on); addEventListener('pointerdown', on);
    return () => { clearTimeout(t); removeEventListener('pointermove', on); removeEventListener('pointerdown', on); };
  }, [ms]);
  return idle;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // on the minute, so the clock never lags what a phone beside it says
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}

/** The time, large, with the date and how things are under it; the weather on the other side. */
function Head({ now, weather, line }: { now: Date; weather?: ForecastCard; line: string }) {
  const time = clock(now), [, hm, ampm] = /^(.*?)(\s?[AaPp]\.?\s?[Mm]\.?)?$/.exec(time) ?? [, time];
  return (
    <header className="wd-head wall-text flex items-end justify-between gap-8">
      <div className="min-w-0">
        <div className="wd-time metric leading-[.9]">{hm}{ampm && <span className="wd-ampm">{ampm.trim()}</span>}</div>
        <div className="mt-3 truncate text-[30px] leading-tight text-foreground/90">{longDay(now)}</div>
        {line && <div role="status" className="mt-1 line-clamp-2 text-[22px] leading-snug text-muted-foreground">{line}</div>}
      </div>
      {weather && (
        <div className="flex shrink-0 items-center gap-4 text-right">
          <WeatherGlyph name={weather.now.icon} size={104} />
          <div>
            <div className="wd-temp metric leading-[.9]">{weather.now.temp}°</div>
            <div className="mt-2 text-[22px] leading-tight text-foreground/90">{weather.now.words}</div>
            <div className="text-[18px] leading-tight text-muted-foreground tabular">{highLow(weather.now.hi, weather.now.lo)}</div>
          </div>
        </div>
      )}
    </header>
  );
}

/** One section of a wall page, drawn as the main page would but read-only: no actions, no links, nothing to hover. A card
 *  on the touch list is the exception: its controls draw big and take a finger (`press` runs one). */
function WallSection({ sec, state, titles, touch, press }: { sec: Section; state: Record<string, WidgetState>; titles: Page['widgets']; touch: Page['wall']['touch']; press: (key: string) => RunAction }) {
  const style = sec.gap != null ? { '--card-gap': `${sec.gap}px`, '--tile-gap': `${sec.gap}px` } as React.CSSProperties : undefined;
  const heading = sec.title && sec.heading !== false && <h2 className="wall-text px-0.5 text-[17px] font-medium text-muted-foreground">{sec.title}</h2>;
  if (sec.display === 'media') {
    const items = sec.widgets.flatMap(key => { const c = state[key]?.card; return c?.type === 'media' ? c.items.map((m, i) => ({ m, k: `${key}:${i}` })) : []; });
    if (!items.length) return null;
    return <section className="space-y-3" style={style}>{heading}
      <div className="grid gap-(--card-gap)" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${sec.columns ? Math.floor(1200 / sec.columns) - 40 : 420}px), 1fr))` }}>
        {items.map(({ m, k }) => <Shell key={k}><div className="px-(--pad)"><NowPlaying m={m} compact /></div></Shell>)}
      </div></section>;
  }
  if (sec.display === 'rings') return (
    <section className="space-y-3" style={style}>{heading}
      <div data-slot="card" className="grid gap-y-5 rounded-surface border bg-card px-4 py-5 shadow-card" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
        {sec.widgets.flatMap(key => tilesOf(state[key]?.card).map((t, j) => <Ring key={`${key}${j}`} s={t} />))}
      </div></section>
  );
  if (sec.display === 'tiles') return (
    <section className="space-y-3" style={style}>{heading}
      <div className="grid gap-(--tile-gap)" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>
        {sec.widgets.flatMap(key => {
          const o = sec.looks?.[key], c = dress(state[key]?.card, o);
          if (!c) return [<TileSkeleton key={key} />];
          // on the wall a tile can be pressed only when its card is on wall.touch, as a card can
          const run = touch[key] ? press(key) : undefined;
          return tilesOf(c).map((t, j) => <div key={`${key}${j}`} className={cn('min-w-0', o?.style && 'card-look')} style={o?.style as React.CSSProperties}><SummaryTile s={t} actions={j === 0 ? tileActions(c) : undefined} run={run} /></div>);
        })}
      </div></section>
  );
  // cards: a card that's come up empty gives its place back, as on the main page
  const keys = sec.widgets.filter(key => state[key] ? !isEmpty(state[key].card) : !shapeOf(key)?.empty);
  if (!keys.length) return null;
  const sized = Object.keys(sec.sizes ?? {}).length > 0;
  const widget = (key: string, size: Size) => {
    const s = state[key], o = sec.looks?.[key], card = dress(asView(s?.card, o?.view), o);
    if ((size === 'small' || size === 'wide') && card?.summary) return <SummaryTile s={card.summary} />;
    const mine = touch[key];
    const drawn = <Shaped id={key} card={s?.card}><Widget large={size === 'large'} fill={sec.grid ? 'always' : true} card={card} kind={shapeOf(key)?.t} failed={s?.error} title={o?.title ?? titles[key]?.title} run={mine && press(key)}
      minimal={sec.variant === 'minimal'} headless={o?.header === false || (o?.header !== true && sec.header === false)} /></Shaped>;
    const body = mine ? <Touch.Provider value={mine}><div className="wd-touch contents">{drawn}</div></Touch.Provider> : drawn;
    return o?.style ? <div className="card-look contents" style={o.style as React.CSSProperties}>{body}</div> : body;
  };
  return (
    <section className="space-y-3" style={style}>{heading}
      {sized || sec.grid || !sec.columns
        // a bento of 2, 4 or 6 tracks as the wall widens, as on the main page, or the section's own columns per screen;
        // a card's cols and rows place it by number, never past the last column
        ? <div className={cn('bento grid grid-flow-row-dense gap-(--card-gap)', sec.grid ? 'cols' : 'grid-cols-2 @2xl/main:grid-cols-4 @5xl/main:grid-cols-6')} style={sec.grid && gridVars(sec.grid)}>
          {keys.map(key => { const size = sec.sizes?.[key] as Size | undefined, cell = wallCell(size, sec.looks?.[key], !!sec.grid);
            return <div key={key} className={cn('min-w-0', sec.grid && 'flex flex-col', cell.className)} style={cell.style}>{widget(key, size ?? 'medium')}</div>; })}
        </div>
        : <div className="grid grid-cols-1 gap-(--card-gap) @3xl/main:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': Math.min(sec.columns, keys.length) } as React.CSSProperties}>
          {keys.map(key => <div key={key} className="min-w-0">{widget(key, 'medium')}</div>)}
        </div>}
    </section>
  );
}

export default function WallScreen() {
  const screen = wallScreen() ?? '';
  const [page, setPage] = useState<Page | null>(null), [gone, setGone] = useState(false);
  const { state, generation, wallNow } = useLive(screen);
  useEffect(() => {
    fetch(`/api/page?wall=${encodeURIComponent(screen)}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&lang=${encodeURIComponent(navigator.language)}`).then(async r => {
      if (!r.ok) { setGone(true); return; }
      const p: Page = await r.json();
      setFormat(p.format, p.labels); applyLook(p.look); setGone(false); setPage(p);
    });
  }, [generation, screen]);
  const dark = useDark(), walls = (!dark && page?.appearance.light?.walls) || page?.appearance.walls || [];
  // dark glass over the wallpaper, or dark without one: a wall is read in a room, often a dim one. theme: system asks for
  // the screen's own light or dark instead, so a tablet that turns dark at sunset takes the wall with it.
  const themeName = page?.look.theme === 'system' ? 'system' : 'dark';
  // a background script runs on the wall too, the same one for every page, unless things should stay still
  const quiet = useStill(), scene = quiet ? undefined : sceneFor(page?.appearance.scenes, '', dark);
  useEffect(() => { if (page) applyTheme(themeName, walls.length > 0 || !!scene); }, [page, themeName, walls.length, scene]);
  useEffect(() => { document.title = page?.title ? `${page.title} · ${label('wall')}` : label('wall'); }, [page?.title]);
  const wall = page?.wall;
  useAwake(!!wall?.awake);
  const idle = useIdle();
  const now = useNow();

  // The pages that may show: all of the config's own, or, where they wait on a `when`, the ones the server says (a few
  // seconds' wait for its first word, so the wrong page is never the first thing up). None: the default page, -1, built
  // from what's on the main page.
  const own = wall?.pages ?? [], calm = !!wall?.conditional, late = useHeld(!!page, 4000);
  const waiting = !page || (calm && !wallNow?.ready && !late);
  const may = useMemo(() => calm ? (wallNow?.pages ?? []).filter(i => i < own.length) : own.map((_, i) => i), [calm, wallNow, own.length]);
  // ?page=Name keeps one on screen, while it may show
  const pinned = useMemo(() => { const q = new URLSearchParams(location.search).get('page'), i = q ? own.findIndex(p => p.title?.toLowerCase() === q.toLowerCase()) : -1; return may.includes(i) ? i : -1; }, [own, may]);
  // whose turn it is and since when; NONE until the first page is chosen
  const NONE = -2, [turn, setTurn] = useState({ n: NONE, since: 0 });
  const n = turn.n !== NONE && turn.n < own.length ? turn.n : waiting ? NONE : nextPage(-1, may);
  useEffect(() => { if (n !== turn.n) setTurn({ n, since: Date.now() }); }, [n, turn.n]);
  const [held, setHeld] = useState(0);   // until when a touch keeps this page, and lifts the night's dim
  // a finger on the glass: the page under it doesn't change for `pause`, and a takeover waits a few seconds to come or go
  const [busy, setBusy] = useState(false), calmed = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touch = () => { if (!wall) return; setHeld(Date.now() + wall.pause); setBusy(true); clearTimeout(calmed.current); calmed.current = setTimeout(() => setBusy(false), 5000); };
  useEffect(() => () => clearTimeout(calmed.current), []);
  const paused = held > Date.now();
  useEffect(() => { if (held <= Date.now()) return; const t = setTimeout(() => setHeld(0), held - Date.now()); return () => clearTimeout(t); }, [held]);
  // a page that takes over (a `when` with `takeover`) interrupts the turn and gives it back where it was, for its full time
  const asked = wallNow?.takeover !== undefined && own[wallNow.takeover]?.takeover ? wallNow.takeover : NONE, [taken, setTaken] = useState(NONE);
  useEffect(() => {
    if (busy || asked === taken) return;
    if (asked === NONE) setTurn(t => ({ ...t, since: Date.now() }));
    setTaken(asked);
  }, [asked, busy, taken]);
  // each page stays its own time, or the wall's; one that may no longer show leaves at the end of its turn, not before
  useEffect(() => {
    if (!wall || pinned >= 0 || taken !== NONE || turn.n === NONE || turn.n !== n) return;
    const wait = stayFor({ n, since: turn.since, pages: may, every: own[n]?.every ?? wall.every, held, now: Date.now(), calm });
    if (wait === null) return;
    const t = setTimeout(() => setTurn({ n: nextPage(n, may), since: Date.now() }), wait);
    return () => clearTimeout(t);
  }, [n, turn, held, may, wall, pinned, taken]);

  // what's on screen follows whose turn it is with a slow fade, and without one for the first page up
  const want = pinned >= 0 ? pinned : taken !== NONE ? taken : n;
  const [at, setAt] = useState(NONE), [view, setView] = useState<'in' | 'out' | ''>('');
  useEffect(() => {
    if (want === at) { if (view === 'out') setView('in'); return; }
    if (at === NONE || still()) { setAt(want); return; }
    setView('out');
    const t = setTimeout(() => { setAt(want); setView('in'); }, 600);
    return () => clearTimeout(t);
  }, [want, at]);
  useEffect(() => { if (view !== 'in') return; const t = setTimeout(() => setView(''), 900); return () => clearTimeout(t); }, [view, at]);
  const usual = useMemo(() => page && at === -1 ? defaultPage(state, page.sections ?? []) : undefined, [page, at === -1 ? state : null]);
  const shown = at === -1 ? usual : own[at];

  const runners = useRef(new Map<string, RunAction>());
  const press = (key: string) => {
    let f = runners.current.get(key);
    if (!f) runners.current.set(key, f = async (action, args) => {
      const r = await fetch(`/api/action/${key.split('.')[0]}/${action}?wall=${encodeURIComponent(screen)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    });
    return f;
  };

  // what's wrong, said as the main page says it; a stall has to last, since a torrent between peers reads 0 B/s for a moment
  const how = sayHow(Object.values(state)), stalled = useHeld(how.problems.some(p => p.id === 'downloads'), 20_000);
  const line = oneLine(how.problems.filter(p => p.id !== 'downloads' || stalled), how.parts);
  const weather = page?.weather && state[page.weather]?.card?.type === 'forecast' ? state[page.weather]!.card as ForecastCard : undefined;
  const night = !!wall && isNight(wall.night, now, weather?.sun), dim = night && wall.night ? wall.night.dim : 0;

  // the whole page fits the screen: it grows with the screen, and shrinks when a page holds more than fits
  const stage = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = body.current; if (!el || !wall) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vw = innerWidth, vh = innerHeight, want = wall.scale ?? Math.min(2.4, Math.max(1, Math.min(vw / 1180, vh / 720)));
        let s = want;
        // narrower means taller, so it takes a few goes to settle
        for (let i = 0; i < 4; i++) {
          el.style.width = `${vw / s}px`;
          const h = el.scrollHeight, room = vh / s;
          if (h <= room + 1) break;
          s = Math.max(.55, s * Math.sqrt(room / h));
        }
        setScale(s);
      });
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el.firstElementChild ?? el);
    addEventListener('resize', fit);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); removeEventListener('resize', fit); };
  }, [wall, at, own]);

  if (gone) return <div className="wd fixed inset-0"><p className="wd-gone">{label('noScreen')}</p></div>;
  if (!page || !wall) return null;
  return (
    <div className={cn('wd fixed inset-0 overflow-hidden', idle && 'wd-idle')} onPointerDown={touch}>
      {walls.length > 0 && <Walls list={walls} every={page.appearance.rotate} />}
      {scene && <Scene name={scene} theme={dark ? 'dark' : 'light'} tab="" />}
      <div ref={stage} className="wd-stage" data-view={view || undefined} style={{ '--wd-scale': scale } as React.CSSProperties}>
        <div ref={body} className="wd-body @container/main">
          <div className="wd-page flex flex-col gap-(--section-gap)">
            {shown?.clock !== false && <Head now={now} weather={weather} line={line} />}
            {shown?.sections.map((sec, i) => <WallSection key={`${at}:${i}`} sec={sec} state={state} titles={page.widgets} touch={wall.touch} press={press} />)}
          </div>
        </div>
      </div>
      {may.length > 1 && pinned < 0 && (
        <nav className="wd-dots" aria-label={label('wall')}>
          {may.map(i => <button key={i} aria-label={own[i].title ?? `${i + 1}`} aria-current={i === at ? 'page' : undefined} onClick={() => setTurn({ n: i, since: Date.now() })} className={cn('wd-dot', i === at && 'is-on')} />)}
          {paused && <span className="wd-paused">{label('paused')}</span>}
        </nav>
      )}
      <div className="wd-night" aria-hidden style={{ opacity: dim && held <= Date.now() ? dim : 0 }} />
    </div>
  );
}
