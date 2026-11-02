// The year in review, in Valet's own design: one idea per screen, over your artwork and your wallpaper. A short story, a
// screen that offers the rest, who you were, and a card drawn to a canvas, so the picture you save is exactly the one you see.
import { ThinkingOrb } from 'thinking-orbs';
import './recap.css';
import { AlignLeft, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './cards.tsx';
import { Race } from './charts.tsx';
import type { Recap, RecapSlide } from '../shared/cards.ts';

type Stat = Recap['stats'][number];

const STEP = 7000, RACE = 10_000, OPENING = 3200, PAYOFF = 10_000, CARD_MAX = 6, HINT = 'valet-recap-hint', TINTS = ['#64d2ff', '#ff9f6b', '#5ee0c5', '#ffc266', '#ff8ac4', '#7d9cff'];
const OUTWARD = new Set(['network', 'reach', 'security']);   // how your network is built and what it shares: nobody's business on a public card

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-(reduced|none)/.test(document.documentElement.className);
/** Is this honestly a story about the year? Only if most of it is. */
export const aboutTheYear = (r: Recap) => r.slides.filter(s => s.scope === 'year').length * 2 > r.slides.length;
/** Names someone: stays off the card unless you put it there. */
export const naming = (r: Recap, st: Stat) => r.slides.some(s => s.stat === st.label && s.private);
/** What the private version leaves out: names, the shape of your network, and anything that's a word rather than a number. */
export const revealing = (r: Recap, st: Stat) => naming(r, st) || !/\d/.test(st.value) || r.slides.some(s => s.stat === st.label && OUTWARD.has(s.theme ?? ''));
export const startingStats = (r: Recap) => r.stats.filter(st => !naming(r, st)).slice(0, CARD_MAX).map(st => st.label);

/** "22,595" or "4.66" settles digit by digit, last digit first. Every frame reads as a number, and at rest it's simply the value. */
function Count({ value }: { value: string }) {
  if (!/^\$?[\d,]+(\.\d+)?%?$/.test(value)) return <>{value}</>;
  const chars = [...value];
  return <><span className="sr-only">{value}</span><span aria-hidden className="whitespace-nowrap">{chars.map((c, k) => /\d/.test(c)
    ? <span key={k} className="rc-reel"><span>{c}</span><i style={{ animationDelay: `${chars.slice(k + 1).filter(d => /\d/.test(d)).length * 60}ms` }}>{[3, 2, 1, 0].map(b => <b key={b}>{(+c + 10 - b) % 10}</b>)}</i></span> : c)}</span></>;
}

/** Your library, drifting past. Columns repeat what they have, so even a small collection fills the screen. */
function Wall({ images, shape, soft }: { images: string[]; shape?: 'poster' | 'square'; soft?: boolean }) {
  const cols = Array.from({ length: 8 }, (_, c) => Array.from({ length: 9 }, (_, r) => images[(c * 7 + r * 3 + c * r) % images.length]));
  return <div className="rc-wall" data-shape={shape} data-soft={soft || undefined}>{cols.map((col, c) => <div key={c} className="rc-col" style={{ animationDelay: `${-c * 7}s` }}>{col.map((src, r) => <img key={r} src={src} alt="" loading="lazy" />)}</div>)}</div>;
}

/** A live 3D model beside the words: your own home, your own machine. It loads only when its slide comes up. */
function Model({ visual }: { visual: NonNullable<RecapSlide['visual']> }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stage: { update(d: any): void; destroy(): void } | undefined, gone = false;
    void (visual.kind === 'home'
      ? import('./visuals/home-model.ts').then(m => m.createHome(box.current!, { turn: -32, tilt: -46, draggable: false }))
      : import('./visuals/pc-model.ts').then(m => m.createViewer(box.current!, { turn: -27, tilt: -14, draggable: false })))
      .then(s => { if (gone) return s.destroy(); stage = s as typeof stage; s.update(visual.data as never); });
    return () => { gone = true; stage?.destroy(); };
  }, [visual]);
  return <div className="rc-model" ref={box} />;
}

/** A wall of app icons, one for each thing you run. */
function Icons({ icons }: { icons: string[] }) {
  return <div className="rc-icons">{icons.slice(0, 42).map((src, i) => <span key={src} style={{ animationDelay: `${Math.min(i, 30) * 35}ms` }}><img src={src} alt="" onError={e => { e.currentTarget.parentElement!.style.display = 'none'; }} /></span>)}</div>;
}

function Backdrop({ s, wall, wallpaper }: { s?: RecapSlide; wall: string[]; wallpaper?: string }) {
  const scene = s?.backdrop ? <img className="rc-backdrop" src={s.backdrop} alt="" />
    : s?.show?.images.length ? <Wall images={s.show.images} shape={s.show.shape} soft={s.show.soft} />
    : s?.wall && wall.length ? <Wall images={wall} /> : null;
  return (
    <div className="rc-bg" aria-hidden>
      {wallpaper && <img className="rc-wallpaper" src={wallpaper} alt="" />}
      {s?.logo && <img key={s.logo} className="rc-tint" src={s.logo} alt="" />}
      <div key={s?.id} className="rc-scene">{scene}</div>
      <div className="rc-scrim" />
    </div>
  );
}

function Extra({ s }: { s: RecapSlide }) {
  if (s.chart) return (
    <div className="rc-glass">
      <div className="rc-track"><i style={{ width: `${Math.max(1.2, s.chart.pct * 100)}%` }} /></div>
      <div className="rc-ends"><span>{s.chart.mark}: {(s.chart.pct * 100).toFixed(1)}%</span><span>{s.chart.to}</span></div>
    </div>
  );
  if (s.bars?.length && s.bars.every(b => b.label.length <= 3)) {
    const top = Math.max(...s.bars.map(b => b.value));
    return <div className="rc-glass"><div className="rc-week">{s.bars.map((b, i) => <div key={b.label} className={b.value === top ? 'top' : ''}><i style={{ height: `${Math.max(4, b.value / top * 82)}%`, animationDelay: `${300 + i * 50}ms` }} />{b.label}</div>)}</div></div>;
  }
  if (s.bars?.length) {
    const top = Math.max(...s.bars.map(b => b.value));
    return <div className="rc-glass rc-rows">{s.bars.map(b => <div key={b.label}><span>{b.label}</span><em>{b.show}</em><div className="rc-track"><i style={{ width: `${b.value / top * 100}%` }} /></div></div>)}</div>;
  }
  if (s.race) return null;   // it stands beside the words
  if (s.items?.some(i => i.image)) return <div className="rc-posters">{s.items.slice(0, 5).map((it, i) => <div key={it.name} className="rc-poster" style={{ animationDelay: `${250 + i * 90}ms` }}><img src={it.image} alt="" /><b>{it.name}</b><em>{it.value}</em></div>)}</div>;
  return null;
}

const scopeLabel = (s: RecapSlide, year: number) => s.scope === 'year' ? `In ${year}` : s.scope;
const said = (s: RecapSlide, year: number) => `${s.kicker} ${s.value}${s.unit ? ` ${s.unit}` : ''}. ${s.line}${s.scope ? ` ${scopeLabel(s, year)}.` : ''}`;

function Slide({ s, year, children }: { s: RecapSlide; year: number; children?: React.ReactNode }) {
  const size = s.race ? (s.value.length > 10 ? 'clamp(36px, 4.6vw, 60px)' : 'clamp(44px, 7vw, 88px)') : s.value.length > 18 ? 'clamp(38px, 7vw, 68px)' : s.value.length > 9 ? 'clamp(52px, 10vw, 96px)' : 'clamp(64px, 17vw, 168px)';
  return (
    <div className={`rc-body ${s.visual || s.icons || s.logo || s.race ? 'rc-beside' : ''}`} key={s.id}>
      {s.icon && <div className="rc-tile"><Icon name={s.icon} className="size-[22px]" /></div>}
      <div className="rc-kicker">{s.kicker}</div>
      <div className="rc-value" style={{ fontSize: size }}><Count value={s.value} />{s.unit && <span className="rc-unit">{s.unit}</span>}</div>
      <p className="rc-line">{s.line}</p>
      <Extra s={s} />
      {s.scope && <div className="rc-chip">{scopeLabel(s, year)}</div>}
      {children}
    </div>
  );
}

const pictures = new Map<string, Promise<HTMLImageElement | null>>();
const picture = (src: string) => { if (!pictures.has(src)) pictures.set(src, new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; })); return pictures.get(src)!; };
const lines = (x: CanvasRenderingContext2D, text: string, width: number) => text.split(' ').reduce<string[]>((out, w) => { const l = out.at(-1); if (l !== undefined && x.measureText(`${l} ${w}`).width <= width) out[out.length - 1] = `${l} ${w}`; else out.push(w); return out; }, []);

/** The card to share: a wall of your posters with who you were and your numbers over it. Without the posters there's
 *  nothing to fill the middle, so it's as tall as what it holds and says who you were in full. Drawn aside and copied in whole, so a toggle never shows a half-made card. */
async function drawCard(c: HTMLCanvasElement, r: Recap, art: boolean, title: string, list: Stat[], stale: () => boolean) {
  await document.fonts.load('600 80px "Geist Variable"').catch(() => {});
  const pics = art && r.wall.length ? (await Promise.all(r.wall.slice(0, 18).map(picture))).filter(Boolean) as HTMLImageElement[] : [];
  if (stale()) return;
  const o = document.createElement('canvas'), x = o.getContext('2d')!, posters = pics.length > 0;
  const font = (n: number, w = 600) => { x.font = `${w} ${n}px "Geist Variable", system-ui, sans-serif`; };
  const W = 1080, gap = 20, cw = (W - 144 - gap) / 2, ch = 172, odd = list.length % 2, rows = Math.ceil(list.length / 2), grid = rows ? rows * (ch + gap) - gap : 0;
  let n = 104; do { font(n); n -= 2; } while (x.measureText(r.persona.name).width > W - 144 && n > 40);
  const size = n + 2; font(40, 500); const about = posters ? [] : lines(x, r.persona.line, W - 144);
  const H = posters ? 1350 : 214 + about.length * 54 + 40 + grid + (grid ? 44 : 0) + 78;
  o.width = W; o.height = H;
  x.fillStyle = '#0b0b0d'; x.fillRect(0, 0, W, H);
  if (posters) {
    const size = 216, tall = 324, gap = 10;
    x.save(); x.translate(W / 2, H / 2); x.rotate(-.12); x.translate(-W / 2, -H / 2);
    for (let col = -1; col < 7; col++) for (let row = -1; row < 6; row++) {
      const img = pics[((col + 1) * 5 + (row + 1) * 3) % pics.length], px = col * (size + gap), py = row * (tall + gap) + (col % 2 ? 90 : 0);
      x.save(); x.beginPath(); x.roundRect(px, py, size, tall, 14); x.clip(); const k = Math.max(size / img.width, tall / img.height); x.drawImage(img, px + (size - img.width * k) / 2, py + (tall - img.height * k) / 2, img.width * k, img.height * k); x.restore();
    }
    x.restore();
    const fade = x.createLinearGradient(0, 0, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,.38)'); fade.addColorStop(.42, 'rgba(0,0,0,.62)'); fade.addColorStop(1, 'rgba(0,0,0,.92)');
    x.fillStyle = fade; x.fillRect(0, 0, W, H);
  } else {
    const glow = x.createRadialGradient(W, 0, 0, W, 0, W);
    glow.addColorStop(0, 'rgba(100,210,255,.26)'); glow.addColorStop(1, 'rgba(100,210,255,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
  }
  x.fillStyle = '#fff'; font(34, 500); x.globalAlpha = .85; x.fillText(title, 72, 104); x.globalAlpha = 1;
  font(size); x.letterSpacing = '-2px'; x.fillText(r.persona.name, 72, 214); x.letterSpacing = '0px';
  font(40, 500); x.globalAlpha = .82; about.forEach((l, i) => x.fillText(l, 72, 280 + i * 54)); x.globalAlpha = 1;
  const top = posters ? H - 118 - grid : 214 + about.length * 54 + 44 + 40;
  list.forEach((s, i) => {   // an odd one out leads, across the full width
    const lead = odd && i === 0, at = i + (odd && i ? 1 : 0), px = 72 + (at % 2) * (cw + gap), py = top + Math.floor(at / 2) * (ch + gap), w = lead ? W - 144 : cw;
    x.fillStyle = 'rgba(40,40,46,.72)'; x.beginPath(); x.roundRect(px, py, w, ch, 28); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#fff'; x.globalAlpha = .72; font(29, 500); x.fillText(s.label, px + 30, py + 54); x.globalAlpha = 1;
    let v = lead ? 96 : 74; do { font(v); v -= 2; } while (x.measureText(s.value).width > w - 60 && v > 30);
    x.fillText(s.value, px + 30, py + 134);
  });
  x.globalAlpha = .75; font(28, 500); x.fillText('Made with Valet', 72, H - 44); x.globalAlpha = 1;
  if (stale()) return;
  c.width = W; c.height = H; c.getContext('2d')!.drawImage(o, 0, 0);
}

function Card({ r, art, title, list }: { r: Recap; art: boolean; title: string; list: Stat[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let gone = false; void drawCard(ref.current!, r, art, title, list, () => gone); return () => { gone = true; }; }, [r, art, title, list]);
  return <canvas ref={ref} width={1080} height={1350} aria-hidden />;
}

/** Everything the story says, as ordinary text, in its order: no timer, nothing to catch. */
function Transcript({ r, heading, closing, list }: { r: Recap; heading: string; closing: string; list: Stat[] }) {
  const detail = (s: RecapSlide) => [...(s.chart ? [`${s.chart.mark}: ${(s.chart.pct * 100).toFixed(1)}%`] : []), ...(s.items ?? []).map(i => [i.name, i.value].filter(Boolean).join(', ')), ...(s.bars ?? []).map(b => [b.label, b.show].filter(Boolean).join(', '))];
  return (
    <div className="rc-text">
      <h2>{heading}</h2>
      <ol>{r.slides.map(s => <li key={s.id}>
        <h3>{s.kicker} <b>{s.value}{s.unit ? ` ${s.unit}` : ''}</b></h3><p>{s.line}</p>
        {detail(s).length > 0 && <ul>{detail(s).map(d => <li key={d}>{d}</li>)}</ul>}
        {s.scope && <small>{scopeLabel(s, r.year)}</small>}
      </li>)}</ol>
      <h3>{closing} <b>{r.persona.name}</b></h3><p>{r.persona.line}</p>
      {list.length > 0 && <dl>{list.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>}
    </div>
  );
}

export default function RecapStory({ onClose, year, wallpaper }: { onClose: () => void; year?: number; wallpaper?: string }) {
  const [r, setR] = useState<Recap | null>(null), [failed, setFailed] = useState(false), [i, setI] = useState(0), [held, setHeld] = useState(false), [paused, setPaused] = useState(calm);
  const [text, setText] = useState(false), [hint, setHint] = useState(false), [bare, setBare] = useState(false), [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => { fetch(`/api/recap${year ? `?year=${year}` : ''}`).then(x => x.ok ? x.json() : Promise.reject()).then(setR, () => setFailed(true)); }, [year]);
  const shown = r?.slides ?? [];
  // the opening, the slides, who you were, the card
  const last = r ? shown.length + 2 : 0, done = i >= last, who = !!r && i === shown.length + 1, s = i > 0 && i <= shown.length ? shown[i - 1] : undefined;
  const yearly = !!r && aboutTheYear(r), heading = !r || yearly ? `Your ${r?.year ?? ''} in review` : 'Your homelab in review', closing = yearly ? 'This year, you were' : 'All told, you are';
  const title = yearly ? `My ${r?.year} homelab${r?.soFar ? ', so far' : ''}` : 'My homelab';
  const list = useMemo(() => { if (!r) return []; const on = picked ?? startingStats(r); return r.stats.filter(st => on.includes(st.label) && !(bare && revealing(r, st))).slice(0, CARD_MAX); }, [r, picked, bare]);
  const go = useCallback((by: number) => setI(n => Math.max(0, Math.min(last, n + by))), [last]);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const was = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => was?.focus?.(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {   // it's a modal: the page behind it is out of reach
        const stops = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')], end = stops[e.shiftKey ? 0 : stops.length - 1], now = document.activeElement;
        if (now === end || now === dialog.current) { e.preventDefault(); stops[e.shiftKey ? stops.length - 1 : 0]?.focus(); }
      } else if (e.key === 'Escape') { if (text) setText(false); else onClose(); }
      else if (text) return;
      else if (e.key === 'ArrowRight' || (e.key === ' ' && !(e.target as Element).closest?.('button'))) { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'p') setPaused(p => !p);
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [go, onClose, text]);
  // the timer keeps what's left, so a hold or a pause carries on from where the bar stopped
  const ms = i === 0 ? OPENING : who ? PAYOFF : s?.race ? RACE : STEP, left = useRef(ms), running = !!r?.slides.length && !held && !paused && !done && !text;
  useEffect(() => { left.current = ms; }, [i, ms]);
  useEffect(() => { if (!running) return; const t0 = performance.now(), t = setTimeout(() => go(1), left.current); return () => { clearTimeout(t); left.current = Math.max(0, left.current - (performance.now() - t0)); }; }, [running, i, go]);
  useEffect(() => { for (const s of r?.slides ?? []) if (s.backdrop) new Image().src = s.backdrop; }, [r]);
  useEffect(() => {
    if (!r?.slides.length) return;
    try { if (localStorage.getItem(HINT)) return; localStorage.setItem(HINT, '1'); } catch { return; }
    setHint(true); const t = setTimeout(() => setHint(false), 9000); return () => clearTimeout(t);
  }, [r]);
  const pressed = useRef(0), off = (e: React.PointerEvent) => !!(e.target as Element).closest('button, .rc-share, .rc-text, .rc-race');
  const drop = () => { pressed.current = 0; setHeld(false); };
  const save = () => document.querySelector<HTMLCanvasElement>('.rc-share canvas')?.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `my-homelab${yearly ? `-${r!.year}` : ''}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
  const toggle = (label: string) => setPicked(p => { const on = p ?? startingStats(r!); return on.includes(label) ? on.filter(l => l !== label) : [...on, label]; });
  const say = !r?.slides.length ? '' : `Screen ${i + 1} of ${last + 1}. ${i === 0 ? heading : who ? `${closing} ${r.persona.name}. ${r.persona.line}` : done ? 'Your card. Choose what goes on it, then save the picture.' : s ? said(s, r.year) : ''}`;
  return createPortal(
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal aria-label={heading} className="rc" style={{ '--tint': TINTS[i % TINTS.length] } as React.CSSProperties}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { if (e.button || off(e)) return; pressed.current = Date.now(); setHeld(true); }}
      onPointerUp={e => { if (!pressed.current) return; const quick = Date.now() - pressed.current < 280; drop(); if (quick) go(e.clientX < innerWidth * .28 ? -1 : 1); }}
      onPointerCancel={drop} onPointerLeave={drop}>
      <Backdrop s={s ?? (r && (i === 0 || who) ? { id: who ? 'who' : 'open', kicker: '', value: '', line: '', wall: true } : undefined)} wall={r?.wall ?? []} wallpaper={wallpaper} />
      {s?.visual && <Model key={s.id} visual={s.visual} />}
      {s?.icons && <Icons key={s.id} icons={s.icons} />}
      {s?.logo && <div key={s.id} className="rc-logo"><img src={s.logo} alt="" /></div>}
      {s?.race && <div key={s.id} className="rc-race"><Race race={s.race} span={s.race.unit === 'h' ? 'Hours watched' : undefined} now /></div>}
      {!r ? <div className="rc-body">{!failed && <div className="mb-4"><ThinkingOrb state="weaving" size={64} theme="dark" /></div>}<div className="rc-kicker">{failed ? "Couldn't put your year together." : 'Going through your year…'}</div></div>
        : !r.slides.length ? <div className="rc-body"><div className="rc-kicker">Nothing to look back on yet. Connect a service or two and come back.</div></div>
        : i === 0 ? <div className="rc-body" key="open">
            {yearly ? <><div className="rc-kicker">Your</div><div className="rc-value" style={{ fontSize: 'clamp(96px, 22vw, 210px)' }}>{r.year}</div><p className="rc-line">{r.soFar ? 'The year so far.' : 'The whole year.'}</p></>
              : <><div className="rc-value" style={{ fontSize: 'clamp(64px, 13vw, 132px)' }}>Your homelab</div><p className="rc-line">Some of this is {r.year}, some goes further back. Each screen says which.</p></>}
          </div>
        : who ? <div className="rc-body" key="who"><div className="rc-kicker">{closing}</div><div className="rc-value" style={{ fontSize: 'clamp(50px, 10vw, 100px)' }}>{r.persona.name}</div><p className="rc-line">{r.persona.line}</p></div>
        : done ? <div className="rc-share" key="card">
            <Card r={r} art={!bare} title={title} list={list} />
            <div className="sr-only"><p>{title}: {r.persona.name}. {r.persona.line}</p>{list.length > 0 && <dl>{list.map(st => <div key={st.label}><dt>{st.label}</dt><dd>{st.value}</dd></div>)}</dl>}</div>
            <div className="rc-pick">
              <div className="rc-chips" role="group" aria-label="Numbers on the card">
                {r.stats.filter(st => !(bare && revealing(r, st))).map(st => { const on = list.includes(st); return <button key={st.label} aria-pressed={on} disabled={!on && list.length >= CARD_MAX} onClick={() => toggle(st.label)} className="press rc-pill">{st.label}</button>; })}
              </div>
              <button onClick={() => setBare(b => !b)} aria-pressed={bare} className="press rc-btn">{bare ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{bare ? 'Show posters and details' : 'Hide posters, names and network'}</button>
              <button onClick={save} className="press rc-btn rc-primary"><Download className="size-4" />Save picture</button>
            </div>
          </div>
        : s && <Slide s={s} year={r.year} />}
      {text && r && <Transcript r={r} heading={heading} closing={closing} list={list} />}
      <div className="sr-only" aria-live="polite">{text ? '' : say}</div>
      {!!r?.slides.length && <div className="rc-seg" aria-hidden>{Array.from({ length: last + 1 }, (_, n) => <span key={n}><i className={n === i && !done ? 'on' : ''} style={n < i || done ? { animation: 'none' } : n === i ? { animationDuration: `${ms}ms`, animationPlayState: running ? 'running' : 'paused' } : { transform: 'scaleX(0)' }} /></span>)}</div>}
      {hint && i < 2 && !text && <div className="rc-hint">Tap the right to go on, the left to go back. Hold to pause. Arrow keys work too.</div>}
      {!!r?.slides.length && !text && <div className="rc-ctl">
        <button aria-label="Previous" disabled={i === 0} onClick={() => go(-1)} className="press"><ChevronLeft className="size-5" /></button>
        <button aria-label={paused ? 'Play' : 'Pause'} disabled={done} onClick={() => setPaused(p => !p)} className="press">{paused ? <Play className="size-[18px]" /> : <Pause className="size-[18px]" />}</button>
        <button aria-label="Next" disabled={done} onClick={() => go(1)} className="press"><ChevronRight className="size-5" /></button>
        <span>{i + 1} of {last + 1}</span>
      </div>}
      {!!r?.slides.length && <button aria-label="Read as text" aria-pressed={text} onClick={() => setText(t => !t)} className="press absolute top-6 right-16 z-10 grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur-md"><AlignLeft className="size-5" /></button>}
      <button aria-label="Close" onClick={onClose} className="press absolute top-6 right-4 z-10 grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur-md"><X className="size-5" /></button>
    </div>, document.body);
}
