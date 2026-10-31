// The year in review, in Valet's own design: one idea per screen, over your artwork and your wallpaper. Tap or arrow
// through, hold to pause. It ends on a card drawn to a canvas, so the picture you save is exactly the one you see.
import './recap.css';
import { Download, ImageOff, Image as ImageIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './cards.tsx';
import type { Recap, RecapSlide } from '../shared/cards.ts';

const STEP = 7000, TINTS = ['#64d2ff', '#ff9f6b', '#5ee0c5', '#bf8bff', '#ffc266', '#ff8ac4', '#7d9cff'];

/** "22,595" or "4.66" climbs to its value; anything else simply appears. */
function Climb({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const m = /^(\$?)([\d,]+)(\.\d+)?(%?)$/.exec(value);
    if (!m || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const end = Number(m[2].replace(/,/g, '') + (m[3] ?? '')), places = m[3] ? m[3].length - 1 : 0, year = !m[1] && !m[4] && !places && !m[2].includes(',') && end >= 2000 && end < 3000, t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const k = Math.min(1, (t - t0) / 1000), n = end * (1 - (1 - k) ** 4);
      setShown(`${m[1]}${n.toLocaleString('en', { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: !year })}${m[4]}`);
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

/** Your library, drifting past. Columns repeat what they have, so even a small collection fills the screen. */
function Wall({ images }: { images: string[] }) {
  const cols = Array.from({ length: 8 }, (_, c) => Array.from({ length: 9 }, (_, r) => images[(c * 7 + r * 3 + c * r) % images.length]));
  return <div className="rc-wall">{cols.map((col, c) => <div key={c} className="rc-col" style={{ animationDelay: `${-c * 7}s` }}>{col.map((src, r) => <img key={r} src={src} alt="" loading="lazy" />)}</div>)}</div>;
}

function Backdrop({ s, wall, scene: spare, wallpaper }: { s?: RecapSlide; wall: string[]; scene?: string; wallpaper?: string }) {
  const art = s?.backdrop ?? (s && !s.wall ? spare : undefined);
  const scene = art ? <img className="rc-backdrop" src={art} alt="" /> : s?.wall && wall.length ? <Wall images={wall} /> : null;
  return (
    <div className="rc-bg" aria-hidden>
      {wallpaper && <img className="rc-wallpaper" src={wallpaper} alt="" />}
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
  if (s.bars?.length && s.bars[0].label.length <= 3 && s.bars.length === 7) {
    const top = Math.max(...s.bars.map(b => b.value));
    return <div className="rc-glass"><div className="rc-week">{s.bars.map((b, i) => <div key={b.label} className={b.value === top ? 'top' : ''}><i style={{ height: `${Math.max(4, b.value / top * 82)}%`, animationDelay: `${300 + i * 50}ms` }} />{b.label}</div>)}</div></div>;
  }
  if (s.bars?.length) {
    const top = Math.max(...s.bars.map(b => b.value));
    return <div className="rc-glass rc-rows">{s.bars.map(b => <div key={b.label}><span>{b.label}</span><em>{b.show}</em><div className="rc-track"><i style={{ width: `${b.value / top * 100}%` }} /></div></div>)}</div>;
  }
  if (s.items?.some(i => i.image)) return <div className="rc-posters">{s.items.slice(0, 5).map((it, i) => <div key={it.name} className="rc-poster" style={{ animationDelay: `${250 + i * 90}ms` }}><img src={it.image} alt="" /><b>{it.name}</b><em>{it.value}</em></div>)}</div>;
  return null;
}

function Slide({ s, year }: { s: RecapSlide; year: number }) {
  const size = s.value.length > 18 ? 'clamp(38px, 7vw, 68px)' : s.value.length > 9 ? 'clamp(52px, 10vw, 96px)' : 'clamp(84px, 17vw, 168px)';
  return (
    <div className="rc-body" key={s.id}>
      {s.icon && <div className="rc-tile"><Icon name={s.icon} className="size-[22px]" /></div>}
      <div className="rc-kicker">{s.kicker}</div>
      <div className="rc-value" style={{ fontSize: size }}><Climb value={s.value} />{s.unit && <span className="rc-unit">{s.unit}</span>}</div>
      <p className="rc-line">{s.line}</p>
      <Extra s={s} />
      {s.scope && <div className="rc-chip">{s.scope === 'year' ? `In ${year}` : s.scope}</div>}
    </div>
  );
}

const picture = (src: string) => new Promise<HTMLImageElement | null>(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

/** The card to share: a wall of your posters (or your wallpaper's dark), who you were, and your numbers. No names. */
async function drawCard(c: HTMLCanvasElement, r: Recap, art: boolean) {
  await document.fonts.load('600 80px "Geist Variable"').catch(() => {});
  const W = 1080, H = 1350, x = c.getContext('2d')!;
  c.width = W; c.height = H;
  x.fillStyle = '#0b0b0d'; x.fillRect(0, 0, W, H);
  if (art && r.wall.length) {
    const size = 216, tall = 324, gap = 10, pics = await Promise.all(r.wall.slice(0, 18).map(picture)), ok = pics.filter(Boolean) as HTMLImageElement[];
    x.save(); x.translate(W / 2, H / 2); x.rotate(-.12); x.translate(-W / 2, -H / 2);
    if (ok.length) for (let col = -1; col < 7; col++) for (let row = -1; row < 6; row++) {
      const img = ok[((col + 1) * 5 + (row + 1) * 3) % ok.length], px = col * (size + gap), py = row * (tall + gap) + (col % 2 ? 90 : 0);
      x.save(); x.beginPath(); x.roundRect(px, py, size, tall, 14); x.clip(); const k = Math.max(size / img.width, tall / img.height); x.drawImage(img, px + (size - img.width * k) / 2, py + (tall - img.height * k) / 2, img.width * k, img.height * k); x.restore();
    }
    x.restore();
  }
  const fade = x.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,.38)'); fade.addColorStop(.42, 'rgba(0,0,0,.62)'); fade.addColorStop(1, 'rgba(0,0,0,.92)');
  x.fillStyle = fade; x.fillRect(0, 0, W, H);
  const font = (n: number, w = 600) => { x.font = `${w} ${n}px "Geist Variable", system-ui, sans-serif`; };
  x.fillStyle = '#fff'; font(34, 500); x.globalAlpha = .85; x.fillText(`My ${r.year} homelab${r.soFar ? ', so far' : ''}`, 72, 104); x.globalAlpha = 1;
  let n = 104; do { font(n); n -= 2; } while (x.measureText(r.persona.name).width > W - 144 && n > 40);
  x.letterSpacing = '-2px'; x.fillText(r.persona.name, 72, 214); x.letterSpacing = '0px';
  const cols = 2, gap = 20, cw = (W - 144 - gap) / cols, ch = 184, list = r.stats.slice(0, 6), rows = Math.ceil(list.length / cols), top = H - 118 - rows * (ch + gap) + gap;
  list.forEach((s, i) => {
    const px = 72 + (i % cols) * (cw + gap), py = top + Math.floor(i / cols) * (ch + gap);
    x.fillStyle = 'rgba(40,40,46,.72)'; x.beginPath(); x.roundRect(px, py, cw, ch, 28); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#fff'; x.globalAlpha = .72; font(29, 500); x.fillText(s.label, px + 30, py + 56); x.globalAlpha = 1;
    let v = 74; do { font(v); v -= 2; } while (x.measureText(s.value).width > cw - 60 && v > 30);
    x.fillText(s.value, px + 30, py + 142);
  });
  x.globalAlpha = .75; font(28, 500); x.fillText('Made with Valet', 72, H - 52); x.globalAlpha = 1;
}

function Card({ r, art }: { r: Recap; art: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { void drawCard(ref.current!, r, art); }, [r, art]);
  return <canvas ref={ref} width={1080} height={1350} />;
}

export default function RecapStory({ onClose, year, wallpaper }: { onClose: () => void; year?: number; wallpaper?: string }) {
  const [r, setR] = useState<Recap | null>(null), [failed, setFailed] = useState(false), [i, setI] = useState(0), [held, setHeld] = useState(false), [art, setArt] = useState(true);
  useEffect(() => { fetch(`/api/recap${year ? `?year=${year}` : ''}`).then(x => x.ok ? x.json() : Promise.reject()).then(setR, () => setFailed(true)); }, [year]);
  // the opening, every slide, who you were, the card
  const last = r ? r.slides.length + 2 : 0, done = i >= last, who = !!r && i === r.slides.length + 1;
  const go = useCallback((by: number) => setI(n => Math.max(0, Math.min(last, n + by))), [last]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight' || e.key === ' ') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [go, onClose]);
  useEffect(() => { if (!r?.slides.length || held || done) return; const t = setTimeout(() => go(1), i ? STEP : 3200); return () => clearTimeout(t); }, [r, i, held, done, go]);
  useEffect(() => { for (const src of [...(r?.slides ?? []).flatMap(s => s.backdrop ?? []), ...(r?.scenes ?? [])].slice(0, 20)) new Image().src = src; }, [r]);
  const pressed = useRef(0), s = r && i > 0 && i <= r.slides.length ? r.slides[i - 1] : undefined;
  const save = () => document.querySelector<HTMLCanvasElement>('.rc-share canvas')?.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `my-homelab-${r!.year}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
  return createPortal(
    <div role="dialog" aria-modal aria-label={`Your ${r?.year ?? ''} in review`} className="rc" style={{ '--tint': TINTS[i % TINTS.length] } as React.CSSProperties}
      onPointerDown={() => { pressed.current = Date.now(); setHeld(true); }}
      onPointerUp={e => { setHeld(false); if (Date.now() - pressed.current < 280) go(e.clientX < innerWidth * .28 ? -1 : 1); }}>
      <Backdrop s={s ?? (r && (i === 0 || who) ? { id: who ? 'who' : 'open', kicker: '', value: '', line: '', wall: true } : undefined)} wall={r?.wall ?? []} scene={r?.scenes.length ? r.scenes[i % r.scenes.length] : undefined} wallpaper={wallpaper} />
      {!r ? <div className="rc-body"><div className="rc-kicker">{failed ? "Couldn't put your year together." : 'Going through your year…'}</div></div>
        : !r.slides.length ? <div className="rc-body"><div className="rc-kicker">Nothing to look back on yet. Connect a service or two and come back.</div></div>
        : i === 0 ? <div className="rc-body" key="open"><div className="rc-kicker">Your homelab</div><div className="rc-value" style={{ fontSize: 'clamp(96px, 22vw, 210px)' }}>{r.year}</div><p className="rc-line">{r.soFar ? 'The year so far.' : 'The whole year.'}</p></div>
        : who ? <div className="rc-body" key="who"><div className="rc-kicker">This year, you were</div><div className="rc-value" style={{ fontSize: 'clamp(50px, 10vw, 100px)' }}>{r.persona.name}</div><p className="rc-line">{r.persona.line}</p></div>
        : done ? <div className="rc-share" key="card" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
            <Card r={r} art={art} />
            <div className="flex gap-2">
              <button onClick={save} className="press flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black"><Download className="size-4" />Save picture</button>
              {r.wall.length > 0 && <button onClick={() => setArt(a => !a)} className="press flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-[14px] font-medium">{art ? <ImageOff className="size-4" /> : <ImageIcon className="size-4" />}{art ? 'Hide posters' : 'Show posters'}</button>}
            </div>
          </div>
        : s && <Slide s={s} year={r.year} />}
      {r && last > 0 && <div className="rc-seg">{Array.from({ length: last + 1 }, (_, n) => <span key={n}><i className={n === i && !done ? 'on' : ''} style={n < i || done ? { width: '100%' } : n === i ? { animationDuration: `${i ? STEP : 3200}ms`, animationPlayState: held ? 'paused' : 'running' } : { width: 0 }} /></span>)}</div>}
      <button aria-label="Close" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={onClose} className="press absolute top-6 right-4 z-10 grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur-md"><X className="size-5" /></button>
    </div>, document.body);
}
