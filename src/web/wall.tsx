// The wall display (/wall): the config's own wall pages, full screen, for reading from across a room. It shows and never
// acts: no chat, no ⌘K, no buttons, no links, whoever is signed in. Loaded only when someone opens /wall.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ForecastCard, WidgetState } from '../shared/cards.ts';
import { asView } from '../shared/views.ts';
import { clock, day, label, oneLine, sayHow, setFormat } from './format.ts';
import { applyLook, applyTheme } from './look.ts';
import { isEmpty, NowPlaying, Ring, Shaped, shapeOf, SummaryTile, TileSkeleton, Widget } from './cards.tsx';
import { WeatherGlyph } from './home-cards.tsx';
import { dress, useDark, useHeld, useLive, Walls, type Page, type Size } from './app.tsx';

type Section = Page['sections'][number];
type WallPage = Page['wall']['pages'][number];
const SPAN: Record<Size, string> = { small: '', wide: 'col-span-2', medium: 'col-span-2', tall: 'col-span-2 row-span-2', large: 'col-span-full @5xl/main:col-span-4' };
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
        <div className="mt-3 truncate text-[30px] leading-tight text-foreground/90">{day(now)}</div>
        {line && <div role="status" className="mt-1 line-clamp-2 text-[22px] leading-snug text-muted-foreground">{line}</div>}
      </div>
      {weather && (
        <div className="flex shrink-0 items-center gap-4 text-right">
          <WeatherGlyph name={weather.now.icon} size={104} />
          <div>
            <div className="wd-temp metric leading-[.9]">{weather.now.temp}°</div>
            <div className="mt-2 text-[22px] leading-tight text-foreground/90">{weather.now.words}</div>
            <div className="text-[18px] leading-tight text-muted-foreground tabular">H {weather.now.hi}° · L {weather.now.lo}°</div>
          </div>
        </div>
      )}
    </header>
  );
}

/** One section of a wall page, drawn as the main page would but read-only: no actions, no links, nothing to hover. */
function WallSection({ sec, state, titles }: { sec: Section; state: Record<string, WidgetState>; titles: Page['widgets'] }) {
  const style = sec.gap != null ? { '--card-gap': `${sec.gap}px`, '--tile-gap': `${sec.gap}px` } as React.CSSProperties : undefined;
  const heading = sec.title && sec.heading !== false && <h2 className="wall-text px-0.5 text-[17px] font-medium text-muted-foreground">{sec.title}</h2>;
  if (sec.display === 'media') {
    const items = sec.widgets.flatMap(key => { const c = state[key]?.card; return c?.type === 'media' ? c.items.map((m, i) => ({ m, k: `${key}:${i}` })) : []; });
    if (!items.length) return null;
    return <section className="space-y-3" style={style}>{heading}
      <div className="grid gap-(--card-gap)" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${sec.columns ? Math.floor(1200 / sec.columns) - 40 : 420}px), 1fr))` }}>
        {items.map(({ m, k }) => <div key={k} className="min-w-0"><NowPlaying m={m} compact /></div>)}
      </div></section>;
  }
  if (sec.display === 'rings') return (
    <section className="space-y-3" style={style}>{heading}
      <div data-slot="card" className="grid gap-y-5 rounded-surface border bg-card px-4 py-5 shadow-card" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
        {sec.widgets.flatMap(key => { const c = state[key]?.card; return (c?.summaries ?? (c?.summary ? [c.summary] : [])).map((t, j) => <Ring key={`${key}${j}`} s={t} />); })}
      </div></section>
  );
  if (sec.display === 'tiles') return (
    <section className="space-y-3" style={style}>{heading}
      <div className="grid gap-(--tile-gap)" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>
        {sec.widgets.flatMap(key => {
          const o = sec.looks?.[key], c = dress(state[key]?.card, o);
          if (!c) return [<TileSkeleton key={key} />];
          return (c.summaries ?? (c.summary ? [c.summary] : [])).map((t, j) => <div key={`${key}${j}`} className={cn('min-w-0', o?.style && 'card-look')} style={o?.style as React.CSSProperties}><SummaryTile s={t} /></div>);
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
    const body = <Shaped id={key} card={s?.card}><Widget large={size === 'large'} fill card={card} kind={shapeOf(key)?.t} failed={s?.error} title={o?.title ?? titles[key]?.title}
      minimal={sec.variant === 'minimal'} headless={o?.header === false || (o?.header !== true && sec.header === false)} /></Shaped>;
    return o?.style ? <div className="card-look contents" style={o.style as React.CSSProperties}>{body}</div> : body;
  };
  return (
    <section className="space-y-3" style={style}>{heading}
      {sized || !sec.columns
        // a bento of 2, 4 or 6 tracks as the wall widens, as on the main page
        ? <div className="bento grid grid-flow-row-dense grid-cols-2 gap-(--card-gap) @2xl/main:grid-cols-4 @5xl/main:grid-cols-6">
          {keys.map(key => { const size = (sec.sizes?.[key] ?? 'medium') as Size, rows = sec.looks?.[key]?.rows;
            return <div key={key} className={cn('min-w-0', size === 'small' ? 'col-span-1' : SPAN[size])} style={rows ? { gridRow: `span ${rows}` } : undefined}>{widget(key, size)}</div>; })}
        </div>
        : <div className="grid grid-cols-1 gap-(--card-gap) @3xl/main:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': Math.min(sec.columns, keys.length) } as React.CSSProperties}>
          {keys.map(key => <div key={key} className="min-w-0">{widget(key, 'medium')}</div>)}
        </div>}
    </section>
  );
}

export default function WallScreen() {
  const [page, setPage] = useState<Page | null>(null);
  const { state, generation } = useLive();
  useEffect(() => {
    fetch(`/api/page?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`).then(r => r.json()).then((p: Page) => {
      setFormat(p.format, p.labels); applyLook(p.look); setPage(p);
    });
  }, [generation]);
  const dark = useDark(), walls = (!dark && page?.appearance.light?.walls) || page?.appearance.walls || [];
  // dark glass over the wallpaper, or dark without one: a wall is read in a room, often a dim one. theme: system asks for
  // the screen's own light or dark instead, so a tablet that turns dark at sunset takes the wall with it.
  const themeName = page?.look.theme === 'system' ? 'system' : 'dark';
  useEffect(() => { if (page) applyTheme(themeName, walls.length > 0); }, [page, themeName, walls.length]);
  useEffect(() => { document.title = page?.title ? `${page.title} · ${label('wall')}` : label('wall'); }, [page?.title]);
  const wall = page?.wall;
  useAwake(!!wall?.awake);
  const idle = useIdle();
  const now = useNow();

  // the pages: the config's own, or the default built from what's on the main page. ?page=Name keeps one on screen.
  const pages = useMemo(() => !page ? [] : page.wall.pages.length ? page.wall.pages : [defaultPage(state, page.sections ?? [])], [page, page?.wall.pages.length ? null : state]);
  const pinned = useMemo(() => { const q = new URLSearchParams(location.search).get('page'); return q ? pages.findIndex(p => p.title?.toLowerCase() === q.toLowerCase()) : -1; }, [pages]);
  const [n, setN] = useState(0), at = pinned >= 0 ? pinned : n % Math.max(1, pages.length), shown = pages[at];
  const [view, setView] = useState<'in' | 'out' | ''>('');
  const [held, setHeld] = useState(0);   // until when a touch keeps this page, and lifts the night's dim
  const go = (to: number) => {
    if (to === n) return;
    if (still()) { setN(to); return; }
    setView('out');
    setTimeout(() => { setN(to); setView('in'); setTimeout(() => setView(''), 900); }, 600);
  };
  // each page stays its own time, or the wall's; a touch holds it for `pause`
  useEffect(() => {
    if (!wall || pinned >= 0 || pages.length < 2) return;
    const wait = Math.max(5000, shown?.every ?? wall.every, held - Date.now());
    const t = setTimeout(() => go(n + 1), wait);
    return () => clearTimeout(t);
  }, [n, held, pages.length, wall, pinned]);
  const touch = () => { if (wall) setHeld(Date.now() + wall.pause); };
  const paused = held > Date.now();
  useEffect(() => { if (held <= Date.now()) return; const t = setTimeout(() => setHeld(0), held - Date.now()); return () => clearTimeout(t); }, [held]);

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
  }, [wall, at, pages]);

  if (!page || !wall) return null;
  return (
    <div className={cn('wd fixed inset-0 overflow-hidden', idle && 'wd-idle')} onPointerDown={touch}>
      {walls.length > 0 && <Walls list={walls} every={page.appearance.rotate} />}
      <div ref={stage} className="wd-stage" data-view={view || undefined} style={{ '--wd-scale': scale } as React.CSSProperties}>
        <div ref={body} className="wd-body @container/main">
          <div className="wd-page flex flex-col gap-(--section-gap)">
            {shown?.clock !== false && <Head now={now} weather={weather} line={line} />}
            {shown?.sections.map((sec, i) => <WallSection key={`${at}:${i}`} sec={sec} state={state} titles={page.widgets} />)}
          </div>
        </div>
      </div>
      {pages.length > 1 && pinned < 0 && (
        <nav className="wd-dots" aria-label={label('wall')}>
          {pages.map((p, i) => <button key={i} aria-label={p.title ?? `${i + 1}`} aria-current={i === at ? 'page' : undefined} onClick={() => { touch(); go(i); }} className={cn('wd-dot', i === at && 'is-on')} />)}
          {paused && <span className="wd-paused">{label('paused')}</span>}
        </nav>
      )}
      <div className="wd-night" aria-hidden style={{ opacity: dim && held <= Date.now() ? dim : 0 }} />
    </div>
  );
}
