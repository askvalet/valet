// The cameras card: a big live view, a pill per camera, what they've noticed lately. A video plays if there is one and a
// snapshot refreshes about once a second if not, and both rest when the tab is hidden or the card has scrolled away. An
// event opens as its own picture, never as the live view; a card that says `sample` plays recordings and never says LIVE.
import { Cctv, Expand, X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Camera, CameraEvent, CamerasCard, Detection } from '../shared/cards.ts';
import { Row, RowArrows, still as held } from './feel.tsx';
import { motionNow } from './motion.ts';
import type { MotionValue } from 'motion';
import { Empty } from './empty.tsx';
import { clock } from './format.ts';
import './cameras.css';

type Box = [number, number, number, number];
type Clock = MutableRefObject<() => number>;
const seconds = () => Date.now() / 1000;
const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
const clockTime = (ms: number) => clock(ms);

/** Where a detection is at `t`. A path wraps around its loop, so it can start before the end and finish after the start. */
export function boxAt(d: Detection, t: number, loop = 0): Box | null {
  const k = d.path;
  if (!k?.length) return d.box ?? null;
  const at = loop && t < k[0][0] ? t + loop : t;
  if (at < k[0][0] || at > k[k.length - 1][0]) return null;
  const i = Math.max(1, k.findIndex(p => p[0] >= at)), a = k[i - 1] ?? k[0], b = k[i] ?? a, u = b[0] > a[0] ? (at - a[0]) / (b[0] - a[0]) : 0;
  return [1, 2, 3, 4].map(n => a[n] + (b[n] - a[n]) * u) as Box;
}
/** Awake while the tab is showing and the element is on screen. */
function useAwake(el: RefObject<HTMLElement | null>) {
  const [awake, set] = useState(true);
  useEffect(() => {
    let seen = true;
    const sync = () => set(seen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); });
    if (el.current) io.observe(el.current);
    document.addEventListener('visibilitychange', sync);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return awake;
}

/** A new picture about once a second, swapped in only once it has loaded, so it never flickers and a slow camera never queues. */
function Snapshot({ src, every, on, shape, up }: { src: string; every: number; on: boolean; shape: (a: number) => void; up: (is: boolean) => void }) {
  const [shown, setShown] = useState<string>();
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout>, stop = false, misses = 0;
    const next = () => {
      const url = `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, img = new Image(), began = Date.now();
      img.onload = () => { if (stop) return; misses = 0; setShown(url); up(true); shape(img.naturalWidth / img.naturalHeight); timer = setTimeout(next, Math.max(100, every * 1000 - (Date.now() - began))); };
      img.onerror = () => { if (stop) return; if (++misses >= 2) up(false); timer = setTimeout(next, every * 1000 * Math.min(misses + 1, 6)); };
      img.src = url;
    };
    next();
    return () => { stop = true; clearTimeout(timer); };
  }, [src, every, on]);
  return shown ? <img src={shown} alt="" className="cam-media" /> : null;
}

/** A video, muted and inline so phones will play it. A loop stays in step with the clock, so everyone sees the same moment
 *  and detections land on what they're about. */
function Video({ cam, on, clock, shape, failed }: { cam: Camera; on: boolean; clock: Clock; shape: (a: number) => void; failed: () => void }) {
  const v = useRef<HTMLVideoElement>(null), loop = cam.loop;
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    // currentTime runs ahead of what's on screen, so read the frame actually shown where the browser says
    let shown = -1, at = 0, frame = 0;
    const tick: VideoFrameRequestCallback = (_, m) => { shown = m.mediaTime; at = performance.now(); frame = el.requestVideoFrameCallback(tick); };
    if (loop) { clock.current = () => shown < 0 || el.paused ? el.currentTime : shown + Math.min(.1, (performance.now() - at) / 1000); frame = el.requestVideoFrameCallback?.(tick); }
    const sync = () => { if (!loop || !el.duration) return; const want = seconds() % loop, off = Math.abs(el.currentTime - want); if (Math.min(off, loop - off) > .4) el.currentTime = want; };
    el.muted = true;
    if (!on) { el.pause(); el.cancelVideoFrameCallback?.(frame); return; }
    sync();
    const retry = () => { void el.play().catch(() => {}); };
    void el.play().catch(() => document.addEventListener('pointerdown', retry, { once: true }));   // low power mode wants a tap first
    el.addEventListener('loadedmetadata', sync);
    const t = setInterval(sync, 3000);
    return () => { clearInterval(t); el.cancelVideoFrameCallback?.(frame); el.removeEventListener('loadedmetadata', sync); document.removeEventListener('pointerdown', retry); };
  }, [cam.id, on]);
  return <video ref={v} className="cam-media" src={on || loop ? cam.video : undefined} poster={cam.poster} muted playsInline autoPlay loop={!!loop} preload="metadata"
    onLoadedMetadata={e => { const m = e.currentTarget; if (m.videoHeight) shape(m.videoWidth / m.videoHeight); }} onError={failed} />;
}

/** Boxes around what's seen. They're moved straight from the clock, so following the picture never re-renders the card. */
function Boxes({ cam, on, clock }: { cam: Camera; on: boolean; clock: Clock }) {
  const shown = (cam.detections ?? []).filter(d => d.box || d.path), els = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!shown.length) return;
    let raf = 0;
    const paint = () => {
      const t = clock.current();
      shown.forEach((d, i) => {
        const el = els.current[i], b = boxAt(d, t, cam.loop);
        if (!el) return;
        if (!b) { if (el.dataset.on) delete el.dataset.on; return; }
        el.style.cssText = `left:${b[0] * 100}%;top:${b[1] * 100}%;width:${b[2] * 100}%;height:${b[3] * 100}%`;
        el.dataset.on = '1'; el.dataset.tight = b[1] < .1 ? '1' : '';
      });
      if (on && shown.some(d => d.path)) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [cam, on]);
  return shown.map((d, i) => (
    <div key={`${d.label}${i}`} ref={e => { els.current[i] = e; }} className="cam-box"><span className="cam-tag">{d.label}{d.score != null && <i>{Math.round(d.score * 100)}%</i>}</span></div>
  ));
}

/** One camera's picture, with its own little on-screen display, as if the camera had burned it in. */
function Feed({ cam, refresh, on, full, open, sample }: { cam: Camera; refresh?: number; on: boolean; full?: boolean; open?: () => void; sample?: boolean }) {
  const box = useRef<HTMLDivElement>(null), awake = useAwake(box), live = on && awake;
  const clock = useRef(seconds), time = useRef<HTMLSpanElement>(null);
  const [aspect, setAspect] = useState(16 / 9), [noVideo, setNoVideo] = useState(false), [up, setUp] = useState<boolean | null>(cam.offline ? false : null);   // null: not heard from yet
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (time.current) time.current.textContent = stamp(); }, 1000);
    return () => clearInterval(t);
  }, [live]);
  const video = cam.video && !noVideo, still = !video && cam.image;
  const props = open ? { role: 'button', tabIndex: 0, 'aria-label': `${cam.name}, full screen`, onClick: open, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } } : {};
  return (
    <div ref={box} className={cn('cam-stage', full && 'is-full', open && 'is-open')} {...props}>
      <div className="cam-frame" style={{ '--a': aspect } as React.CSSProperties}>
        {cam.poster && !video && !still && <img src={cam.poster} alt="" className="cam-media" />}
        {video && <Video cam={cam} on={live} clock={clock} shape={setAspect} failed={() => setNoVideo(true)} />}
        {still && <Snapshot src={cam.image!} every={refresh ?? 1} on={live} shape={setAspect} up={setUp} />}
        <Boxes cam={cam} on={live} clock={clock} />
        {up === false && <div className="cam-off"><span>No signal</span></div>}
        {up !== false && (video || up) && <div className="cam-osd cam-osd-top">{sample ? <span className="cam-live is-sample"><i />Sample footage</span> : <><span className="cam-live"><i />LIVE</span><span ref={time}>{stamp()}</span></>}</div>}
        <div className="cam-osd cam-osd-end">{cam.name}</div>
      </div>
      {open && <span className="cam-expand" aria-hidden><Expand /></span>}
    </div>
  );
}

function Pills({ cameras, at, pick, row }: { cameras: Camera[]; at: string; pick: (id: string) => void; row?: boolean }) {
  return (
    <div role="tablist" aria-label="Cameras" className={cn('cam-pills no-scrollbar', row && 'is-row')}>
      {cameras.map(c => (
        <button key={c.id} role="tab" aria-selected={c.id === at} onClick={() => pick(c.id)} className={cn('cam-pill press', c.id === at && 'is-on')}>
          {(c.poster ?? c.image) && <img src={c.poster ?? c.image} alt="" loading="lazy" onError={e => { e.currentTarget.removeAttribute('src'); }} />}
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

/** What they've noticed: a row like any other, which a live update bringing the same events back leaves alone. */
const Events = memo(function Events({ events, cameras, open, at }: { events: CameraEvent[]; cameras: Camera[]; open: (e: CameraEvent) => void; at: CameraEvent | null }) {
  const id = useId();
  return (
    <div className="cam-events-bar">
      <Row id={id} role="group" aria-roledescription="carousel" aria-label="Events" className="cam-events">
        {events.map((e, i) => (
          <button key={e.id ?? `${e.camera}${e.at}${i}`} data-blossom-slide onClick={() => open(e)} aria-pressed={!!at && at.camera === e.camera && at.at === e.at} className="cam-event press">
            {e.image && <img src={e.image} alt="" draggable={false} loading="lazy" />}
            <span className="min-w-0"><b>{e.label}</b><small>{cameras.find(c => c.id === e.camera)?.name ?? e.camera} · {clockTime(e.at)}</small></span>
          </button>
        ))}
      </Row>
      <RowArrows id={id} label="events" className="hidden sm:flex" />
    </div>
  );
}, (a, b) => a.open === b.open && a.at === b.at && JSON.stringify(a.events) === JSON.stringify(b.events) && a.cameras.map(c => c.id + c.name).join() === b.cameras.map(c => c.id + c.name).join());

/** What a camera saw, as a picture of that moment: when, what, and the way to the camera as it is now. */
export function EventStill({ event, cam, sample, live }: { event: CameraEvent; cam?: Camera; sample?: boolean; live: () => void }) {
  const src = event.image ?? cam?.poster, name = cam?.name ?? event.camera;
  return (
    <div className="cam-stage is-still" role="group" aria-label={`${event.label} on ${name} at ${clockTime(event.at)}`}>
      <div className="cam-frame" style={{ '--a': 16 / 9 } as React.CSSProperties}>
        {src ? <img src={src} alt={`${event.label} on ${name}`} className="cam-media" /> : <div className="cam-off"><span>No picture saved</span></div>}
        <div className="cam-osd cam-osd-top"><span className="cam-past">Event · {clockTime(event.at)}</span></div>
        <div className="cam-osd cam-osd-end">{name}</div>
      </div>
      <div className="cam-still-bar">
        <span className="min-w-0 truncate"><b>{event.label}</b>{event.score != null && ` · ${Math.round(event.score * 100)}%`}</span>
        <button onClick={live} className="cam-to-live press">{sample ? "View this camera's sample feed" : 'View this camera live'}</button>
      </div>
    </div>
  );
}

/** Full screen. It lives on the body because glass makes a card the containing block for anything fixed inside it, and
 *  it's its own overlay because iPhones won't put anything but a bare video in real full screen. */
function Theatre({ card, at, pick, close: done, from }: { card: CamerasCard; at: string; pick: (id: string) => void; close: () => void; from: () => HTMLElement | null | undefined }) {
  const box = useRef<HTMLDivElement>(null), cam = card.cameras.find(c => c.id === at) ?? card.cameras[0];
  const grow = useRef<{ p: MotionValue<number>; measure: () => void; draw: (v: number) => void } | null>(null), leaving = useRef(false);
  // Where there's no real full screen (an iPhone), the picture grows out of the card's own and goes back into it on a
  // spring: the whole overlay is scaled so its picture sits on the card's, and clipped to it, then let go. Both are
  // measured once each way, so a picture finding its shape mid-flight can't make it jump. Real full screen has its own
  // move, and Motion not here yet or a page held still gets the plain fade.
  useLayoutEffect(() => {
    const el = box.current, m = motionNow(); if (!el || !m || document.fullscreenEnabled || held(el)) return;
    const p = m.motionValue(0), bits = el.querySelectorAll<HTMLElement>('.cam-close, .cam-dock');
    let at: { r: DOMRect; c: DOMRect; s: number; round: number } | null = null;
    const measure = () => {
      const a = from()?.querySelector<HTMLElement>('.cam-frame'), b = el.querySelector<HTMLElement>('.cam-frame');
      const r = a?.getBoundingClientRect(), c = b?.getBoundingClientRect();
      at = a && r && c && r.width && c.width && r.bottom > 0 && r.top < innerHeight
        ? { r, c, s: r.width / c.width, round: parseFloat(getComputedStyle(a.closest('.cam-stage') ?? a).borderTopLeftRadius) || 0 } : null;
    };
    const draw = (v: number) => {
      bits.forEach(n => { n.style.opacity = String(Math.max(0, (v - .6) / .4)); });
      if (!at) { el.style.transform = el.style.clipPath = ''; el.style.opacity = String(v); return; }   // the card's picture is out of sight: a fade
      const { r, c, s, round } = at, k = 1 - v;
      el.style.transform = `translate(${(r.left - c.left * s) * k}px, ${(r.top - c.top * s) * k}px) scale(${1 + (s - 1) * k})`;
      el.style.clipPath = `inset(${c.top * k}px ${(innerWidth - c.right) * k}px ${(innerHeight - c.bottom) * k}px ${c.left * k}px round ${round / s * k}px)`;
    };
    el.dataset.grown = ''; el.style.transformOrigin = '0 0';
    measure(); p.on('change', draw); draw(0);
    grow.current = { p, measure, draw };
    const run = m.animate(p, 1, { type: 'spring', visualDuration: .45, bounce: .12 });
    return () => run.stop();
  }, []);
  const close = () => {
    const g = grow.current, m = motionNow();
    if (!g || !m) return done();
    if (leaving.current) return; leaving.current = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const el = box.current; if (el) el.style.transform = el.style.clipPath = '';   // measured as it will be at rest, even if closed mid-grow
    g.measure(); g.draw(g.p.get());
    void m.animate(g.p, 0, { type: 'spring', visualDuration: .36, bounce: 0 }).finished.then(done);
  };
  useEffect(() => {
    const el = box.current, step = (n: number) => pick(card.cameras[(card.cameras.findIndex(c => c.id === at) + n + card.cameras.length) % card.cameras.length].id);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
    const left = () => { if (!document.fullscreenElement) close(); };
    document.addEventListener('keydown', key); document.addEventListener('fullscreenchange', left);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', left); };
  }, [at]);
  useEffect(() => {
    box.current?.focus();
    void box.current?.requestFullscreen?.().catch(() => {});
    return () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  }, []);
  return createPortal(
    <div ref={box} role="dialog" aria-modal aria-label={cam.name} tabIndex={-1} className="cam-theatre">
      <Feed key={cam.id} cam={cam} refresh={card.refresh} on full sample={card.sample} />
      <button onClick={close} aria-label="Close" className="cam-close press"><X /></button>
      {card.cameras.length > 1 && <div className="cam-dock"><Pills cameras={card.cameras} at={at} pick={pick} row /></div>}
    </div>, document.body);
}

export function Cameras({ card }: { card: CamerasCard }) {
  const [at, setAt] = useState(card.cameras[0]?.id ?? ''), [full, setFull] = useState(false), [still, setStill] = useState<CameraEvent | null>(null);
  const cam = card.cameras.find(c => c.id === at) ?? card.cameras[0], many = card.cameras.length > 1;
  const pick = (id: string) => { setAt(id); setStill(null); };
  const grid = useRef<HTMLDivElement>(null);
  const openEvent = useCallback((e: CameraEvent) => { setAt(e.camera); setStill(e); }, []);
  if (!cam) return <Empty icon={Cctv} text={card.empty ?? 'No cameras'} height={240} />;
  return (
    <div className="cam-card @container">
      <div ref={grid} className={cn('cam-grid', many && 'has-pills')}>
        {still ? <EventStill event={still} cam={card.cameras.find(c => c.id === still.camera)} sample={card.sample} live={() => pick(still.camera)} />
          : <Feed key={cam.id} cam={cam} refresh={card.refresh} on={!full} open={() => setFull(true)} sample={card.sample} />}
        {many && <Pills cameras={card.cameras} at={cam.id} pick={pick} />}
      </div>
      {!!card.events?.length && <Events events={card.events} cameras={card.cameras} at={still} open={openEvent} />}
      {full && <Theatre card={card} at={cam.id} pick={pick} close={() => setFull(false)} from={() => grid.current?.querySelector<HTMLElement>('.cam-stage')} />}
    </div>
  );
}
