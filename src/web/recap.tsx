// The year in review, as a story: one number at a time, full screen. Tap or arrow through, hold to pause. It ends on a
// card worth sharing, which leaves out people's names and titles unless you say otherwise.
import { Download, EyeOff, Eye, Pause, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Recap, RecapSlide } from '../shared/cards.ts';

const SCENES = [['#2b1a6b', '#e0447f', '#ffb45c'], ['#062f4f', '#0fa3b1', '#b5e48c'], ['#3c0d3f', '#ff5e5b', '#ffd166'], ['#101a5c', '#5b7cfa', '#9ef0ff'], ['#0b3d2e', '#2fbf71', '#f5e663'], ['#40120f', '#ff7a3d', '#ffd8a8']];
const STEP = 6500;

/** "22,595", "4.66" or "8.7" climbs to its value; anything else is shown as it is. */
function Climb({ value, run }: { value: string; run: boolean }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const m = /^([\d,]+)(\.\d+)?$/.exec(value);
    if (!m || !run || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const end = Number(value.replace(/,/g, '')), places = m[2] ? m[2].length - 1 : 0, t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const k = Math.min(1, (t - t0) / 1100), eased = 1 - (1 - k) ** 4;
      setShown((end * eased).toLocaleString('en', { minimumFractionDigits: places, maximumFractionDigits: places }));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, run]);
  return <>{shown}</>;
}

function Slide({ s, year }: { s: RecapSlide; year: number }) {
  const long = s.value.length > 11;
  return (
    <div className="recap-in flex w-full max-w-[720px] flex-col">
      <div className="text-[15px] font-medium tracking-wide text-white/75">{s.kicker}</div>
      <div className={cn('metric mt-2 leading-[.95] tracking-tight', long ? 'text-[clamp(40px,9vw,76px)]' : 'text-[clamp(72px,17vw,148px)]')}>
        <Climb value={s.value} run />{s.unit && <span className="ml-3 text-[.32em] font-semibold tracking-normal text-white/80">{s.unit}</span>}
      </div>
      <p className="mt-5 max-w-[560px] text-[clamp(18px,2.6vw,23px)] leading-snug font-medium text-white/90">{s.line}</p>
      {s.items && (
        <ol className="mt-7 space-y-2.5">
          {s.items.slice(0, 5).map((it, i) => (
            <li key={i} className="recap-row flex items-center gap-3" style={{ animationDelay: `${450 + i * 130}ms` }}>
              <span className="w-5 shrink-0 text-right text-[15px] font-semibold text-white/55 tabular">{i + 1}</span>
              {it.image && <img src={it.image} alt="" className="h-12 w-8 shrink-0 rounded-md object-cover shadow-lg" />}
              <span className="min-w-0 flex-1 truncate text-[18px] font-semibold">{it.name}</span>
              {it.value && <span className="shrink-0 text-[14px] text-white/70 tabular">{it.value}</span>}
            </li>
          ))}
        </ol>
      )}
      {s.scope && <div className="mt-6 w-fit rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium text-white/80">{s.scope === 'year' ? year : s.scope}</div>}
    </div>
  );
}

/** Drawn on a canvas, so what's saved is exactly what's shown and nothing else on the page comes with it. */
function savePicture(r: Recap, names: boolean) {
  const W = 1080, H = 1350, c = document.createElement('canvas'), x = c.getContext('2d')!;
  c.width = W; c.height = H;
  const [a, b, d] = SCENES[r.year % SCENES.length], g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, a); g.addColorStop(.62, b); g.addColorStop(1, d);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const font = (n: number, w = 600) => `${w} ${n}px "Geist Variable", system-ui, sans-serif`;
  // text shrinks to fit its space, so a long name or number never runs off the edge or into its neighbour
  const fit = (text: string, size: number, weight: number, room: number) => { let n = size; do { x.font = font(n, weight); n -= 2; } while (x.measureText(text).width > room && n > 20); };
  x.fillStyle = '#fff'; x.font = font(40); x.fillText(`My ${r.year} homelab${r.soFar ? ', so far' : ''}`, 90, 150);
  fit(r.persona.name, 100, 700, W - 180); x.fillText(r.persona.name, 90, 280);
  r.stats.slice(0, 6).forEach((s, i) => {
    const px = 90 + (i % 2) * 460, py = 470 + Math.floor(i / 2) * 230;
    x.globalAlpha = .75; x.font = font(32, 500); x.fillText(s.label, px, py);
    x.globalAlpha = 1; fit(s.value, 72, 700, 420); x.fillText(s.value, px, py + 86);
  });
  const top = r.slides.find(s => s.items?.length && !s.private);
  if (names && top?.items) { x.globalAlpha = .9; const said = `${top.kicker}: ${top.items[0].name}`; fit(said, 36, 500, W - 180); x.fillText(said, 90, 1180); }
  x.globalAlpha = .8; x.font = font(32, 500); x.fillText('Made with Valet', 90, 1270);
  c.toBlob(blob => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `valet-${r.year}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
}

export default function RecapStory({ onClose, year }: { onClose: () => void; year?: number }) {
  const [r, setR] = useState<Recap | null>(null), [failed, setFailed] = useState(false), [i, setI] = useState(0), [held, setHeld] = useState(false), [names, setNames] = useState(false);
  useEffect(() => { fetch(`/api/recap${year ? `?year=${year}` : ''}`).then(x => x.ok ? x.json() : Promise.reject()).then(setR, () => setFailed(true)); }, [year]);
  const last = r ? r.slides.length + 3 : 0, done = i >= last - 1;      // the opening, every slide, who you are, the card
  const go = useCallback((by: number) => setI(n => Math.max(0, Math.min(last - 1, n + by))), [last]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight' || e.key === ' ') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [go, onClose]);
  useEffect(() => { if (!r || held || done) return; const t = setTimeout(() => go(1), i ? STEP : 3500); return () => clearTimeout(t); }, [r, i, held, done, go]);
  const pressed = useRef(0);
  const scene = SCENES[i % SCENES.length];
  const body = !r ? <div className="text-[17px] text-white/80">{failed ? "Couldn't put your year together." : 'Going through your year…'}</div>
    : !r.slides.length ? <div className="max-w-[460px] text-[20px] font-medium">Nothing to look back on yet. Connect a service or two and come back.</div>
    : i === 0 ? <div className="recap-in"><div className="text-[18px] font-medium text-white/80">Your homelab</div><div className="metric mt-1 text-[clamp(96px,24vw,220px)] leading-none">{r.year}</div><div className="mt-3 text-[20px] font-medium text-white/85">{r.soFar ? 'So far. Here\'s how it went.' : 'Here\'s how it went.'}</div></div>
    : i <= r.slides.length ? <Slide key={i} s={r.slides[i - 1]} year={r.year} />
    : i === r.slides.length + 1 ? <div key="who" className="recap-in max-w-[640px]"><div className="text-[17px] font-medium text-white/80">This year, you were</div><div className="metric mt-2 text-[clamp(52px,11vw,96px)] leading-none">{r.persona.name}</div><p className="mt-5 text-[21px] leading-snug font-medium text-white/90">{r.persona.line}</p></div>
    : <div key="card" className="recap-in w-full max-w-[560px]">
        <div className="text-[16px] font-medium text-white/80">My {r.year} homelab{r.soFar ? ', so far' : ''}</div>
        <div className="metric mt-1 text-[clamp(36px,7vw,56px)] leading-tight">{r.persona.name}</div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">{r.stats.map(s => <div key={s.label}><dt className="text-[14px] text-white/70">{s.label}</dt><dd className="metric truncate text-[clamp(26px,5vw,36px)]">{s.value}</dd></div>)}</dl>
        {r.closing && <p className="mt-6 text-[17px] font-medium text-white/90">{r.closing}</p>}
        <div className="mt-7 flex flex-wrap gap-2" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <button onClick={() => savePicture(r, names)} className="press flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black"><Download className="size-4" />Save picture</button>
          <button onClick={() => setNames(n => !n)} className="press flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-[14px] font-medium">{names ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{names ? 'Top title included' : 'Numbers only'}</button>
        </div>
      </div>;
  return createPortal(
    <div role="dialog" aria-modal aria-label={`Your ${r?.year ?? ''} in review`} className="recap fixed inset-0 z-[100] flex select-none items-center overflow-hidden px-7 text-white sm:px-[9vw]" style={{ background: `linear-gradient(150deg, ${scene[0]}, color-mix(in srgb, ${scene[1]} 55%, ${scene[0]}))` }}
      onPointerDown={() => { pressed.current = Date.now(); setHeld(true); }}
      onPointerUp={e => { setHeld(false); if (Date.now() - pressed.current < 280) go(e.clientX < innerWidth * .28 ? -1 : 1); }}>
      <i className="recap-blob" style={{ background: scene[1] }} /><i className="recap-blob b2" style={{ background: scene[2] }} />
      {r && last > 1 && <div className="absolute inset-x-4 top-3 z-10 flex gap-1">{Array.from({ length: last }, (_, k) => <span key={k} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25"><i className={cn('block h-full rounded-full bg-white', k < i ? 'w-full' : k > i ? 'w-0' : done ? 'w-full' : 'recap-fill')} style={k === i && !done ? { animationDuration: `${i ? STEP : 3500}ms`, animationPlayState: held ? 'paused' : 'running' } : undefined} /></span>)}</div>}
      <button aria-label="Close" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onClose(); }} className="press absolute top-7 right-5 z-10 grid size-10 place-items-center rounded-full bg-white/15"><X className="size-5" /></button>
      {held && <Pause className="absolute top-8 left-6 z-10 size-5 text-white/70" aria-hidden />}
      <div className="relative z-[1] flex w-full justify-start">{body}</div>
    </div>, document.body);
}
