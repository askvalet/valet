// The PC as a live 3D model (CSS 3D, no WebGL): fans, pump screen, RAM and GPU lit the colours they really are.
// A port of rgb-control's model. It builds plain DOM once per layout and repaints lights in place as state streams in.
import { useEffect, useRef } from 'react';
import './pc-case.css';

type Light = { mode?: string; color?: number[]; brightness?: number; speed?: number };
export interface PcCaseData {
  parts: { id: string; title: string; zones: Light[] }[];   // fans0..3, coolerfans, pump, ram, gpu, mobo
  layout?: Record<string, string>;                         // fan group → 'top' | 'hidden'
  screen?: string;                                         // the pump screen's picture
}

const CW = 560, CH = 600, CD = 300;
const hex = (c: number[] = [255, 255, 255]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

function lightOf(st: Light) {
  const m = (st.mode || '').toLowerCase(), col = hex(st.color);
  const kind = m === 'off' ? 'off' : /rainbow|spectrum|wave|morph/.test(m) ? 'rainbow' : /meteor|runway|comet|chase|tail/.test(m) ? 'comet'
    : /breath|pulse/.test(m) ? 'breathe' : /cycle/.test(m) ? 'cycle' : 'static';
  const base = kind === 'cycle' ? '#ff3b30' : col;
  return {
    kind,
    lc: kind === 'rainbow' ? 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)'
      : kind === 'comet' ? `conic-gradient(transparent 0 55%, ${col}55 75%, ${col} 97%, #fff 98%, transparent 99%)` : base,
    lb: kind === 'rainbow' ? 'linear-gradient(90deg, #ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92)' : base,
    lo: kind === 'off' ? 0 : Math.max(.12, (st.brightness ?? 100) / 100),
    dur: (8 - 6.5 * ((st.speed ?? 50) / 100)).toFixed(2) + 's',
    solid: kind === 'off' ? 'transparent' : kind === 'rainbow' ? '#8f7dff' : base,
  };
}
function setLight(e: HTMLElement, st: Light) {
  const L = lightOf(st);
  e.style.setProperty('--lc', L.lc); e.style.setProperty('--lb', L.lb); e.style.setProperty('--lo', String(L.lo));
  e.style.setProperty('--dur', L.dur); e.style.setProperty('--lcs', L.solid);
  e.classList.remove('m-off', 'm-rainbow', 'm-comet', 'm-breathe', 'm-cycle', 'm-static');
  e.classList.add('m-' + L.kind);
}

const mk = (cls: string, html?: string) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; return e; };
function face(e: HTMLElement, w: number, h: number, tf: string) { e.classList.add('f'); Object.assign(e.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px', transform: tf }); return e; }
const at = (e: HTMLElement, x: number, y: number, w: number, h: number, z: number) => face(e, w, h, `translate3d(${x + w / 2 - CW / 2}px, ${y + h / 2 - CH / 2}px, ${z - CD / 2}px)`);
const side = (e: HTMLElement, x: number, y: number, d: number, h: number, z0 = 0) => face(e, d, h, `translate3d(${x - CW / 2}px, ${y + h / 2 - CH / 2}px, ${z0 + d / 2 - CD / 2}px) rotateY(90deg)`);
const lid = (e: HTMLElement, x: number, y: number, w: number, d: number, z0 = 0) => face(e, w, d, `translate3d(${x + w / 2 - CW / 2}px, ${y - CH / 2}px, ${z0 + d / 2 - CD / 2}px) rotateX(90deg)`);
const part = (cls: string, id: string, html = '', zone?: number) => { const e = mk('part ' + cls, html); e.dataset.part = id; if (zone != null) e.dataset.zone = String(zone); return e; };
const tint = (e: HTMLElement, id: string, zone = 0) => { e.dataset.tint = id; e.dataset.zone = String(zone); return e; };

function build(world: HTMLElement, d: PcCaseData) {
  world.innerHTML = '';
  const has = (id: string) => d.parts.some(p => p.id === id);
  const cam = mk('cam'); world.appendChild(cam);
  const add = (e: HTMLElement) => (cam.appendChild(e), e);
  const fanUnit = (id: string) => id === 'coolerfans' || /^fans\d$/.test(id);
  const top = d.parts.find(p => fanUnit(p.id) && (d.layout?.[p.id] ?? (p.id === 'fans0' ? 'top' : 'hidden')) === 'top');

  add(face(mk('backwall'), CW, CH, `translateZ(${-CD / 2}px)`));
  add(face(mk('mesh'), CD, CH, `translateX(${-CW / 2}px) rotateY(90deg)`));
  add(face(mk('mesh'), CD, CH, `translateX(${CW / 2}px) rotateY(90deg)`));
  const floor = add(face(mk('floor'), CW, CD, `translateY(${CH / 2}px) rotateX(90deg)`));
  for (const [x, y] of [[110, 150], [290, 150]]) { const f = mk('bfan'); Object.assign(f.style, { left: x + 'px', top: y - 75 + 'px', width: '150px', height: '150px' }); floor.appendChild(f); }
  if (has('gpu')) { const s = tint(mk('spill round'), 'gpu'); Object.assign(s.style, { position: 'absolute', left: '-40px', top: '120px', width: '280px', height: '200px' }); floor.appendChild(s); }
  const ceil = add(face(mk('ceiling'), CW, CD, `translateY(${-CH / 2}px) rotateX(90deg)`));
  const rad = mk('rad'); Object.assign(rad.style, { left: '30px', top: '58px', width: '500px', height: '178px' }); ceil.appendChild(rad);
  if (top) {
    const row = part('fanrow', top.id);
    Object.assign(row.style, { position: 'absolute', left: '34px', top: '18px', width: '492px', height: '222px' });
    [0, 1, 2].forEach(i => {
      const fr = mk('fanframe'); Object.assign(fr.style, { left: i * 166 + 'px', top: '42px', width: '160px', height: '160px' }); row.appendChild(fr);
      const f = mk('fan', '<i class="glow light spin"></i><i class="r1 light spin"></i><i class="r2 light spin"></i><i class="r3 light spin"></i><i class="blades"></i><i class="hub"></i>');
      f.dataset.zone = String(i); Object.assign(f.style, { left: i * 166 + 9 + 'px', top: '51px', width: '142px', height: '142px' });
      f.querySelectorAll<HTMLElement>('.spin').forEach(x => x.style.animationDelay = (-i * .4) + 's');
      row.appendChild(f);
      for (const cls of ['lbar soft light lin', 'lbar light lin']) {
        const b = mk(cls); b.dataset.zone = String(i); Object.assign(b.style, { left: i * 166 + 6 + 'px', top: '12px', width: '150px' }); row.appendChild(b);
      }
    });
    ceil.appendChild(row);
    add(at(tint(mk('spill'), top.id, 1), 0, 0, CW, 300, 1));
  }

  const mobo = has('mobo') ? part('mobo', 'mobo') : mk('mobo');
  mobo.insertAdjacentHTML('afterbegin', '<i class="io"></i><i class="vrm"></i><i class="m2"></i><i class="chip"></i><i class="slot" style="top:262px"></i><i class="slot" style="top:300px"></i><i class="atx"></i>'
    + [[8, 8], [372, 8], [8, 312], [372, 312], [190, 160]].map(([x, y]) => `<i class="screw" style="left:${x}px;top:${y}px"></i>`).join(''));
  add(at(mobo, 40, 60, 390, 330, 1));
  add(at(mk('grommets'), 462, 90, 70, 250, 1));
  const braid = (p: string, w: number) => `<path d="${p}" stroke="#141519" stroke-width="${w}"/><path d="${p}" stroke="#2a2d33" stroke-width="${w - 3}" stroke-dasharray="2 3"/>`;
  const svg = (paths: string) => `<svg width="560" height="600" viewBox="0 0 560 600" style="overflow:visible"><g fill="none" stroke-linecap="round">${paths}</g></svg>`;
  add(at(mk('braid', svg([0, 1, 2, 3].map(i => braid(`M${478 + i * 6} ${130 + i * 26} C ${455 + i * 4} ${160 + i * 22}, 436 ${170 + i * 14}, 420 ${186 + i * 8}`, 8)).join('')
    + braid('M330 80 C 380 64, 440 40, 470 -4', 7) + braid('M345 92 C 395 74, 455 52, 488 -4', 7))), 0, 0, CW, CH, 14));
  add(at(mk('braid', svg(braid('M214 190 C 270 172, 300 120, 336 0', 16) + braid('M214 226 C 300 214, 360 120, 392 0', 16))), 0, 0, CW, CH, 46));

  const ram = d.parts.find(p => p.id === 'ram');
  if (ram) {
    add(at(tint(mk('spill round'), 'ram'), 190, 70, 160, 220, 2));
    ram.zones.forEach((_, i) => {
      const x = 236 + i * 18;
      add(tint(side(mk('ramside', '<i class="wash light lin"></i>'), x, 108, 34, 154), 'ram', i));
      add(at(part('ram', 'ram', '<i class="glow light lin"></i><i class="bar light lin"></i>', i), x, 108, 8, 154, 34));
    });
  }
  if (has('pump')) {
    add(side(mk('pumpside'), 118, 160, 52, 114));
    add(lid(mk('pumptop'), 118, 160, 94, 52));
    add(at(part('pump', 'pump', `<i class="glow light"></i><i class="edge light"></i><div class="scr"><img alt=""></div>`), 118, 160, 94, 114, 52));
  }
  if (has('gpu')) {
    add(lid(part('gputop', 'gpu', '<i class="logo light lin"></i><i class="tube2"></i>'), 22, 430, 476, 150, 0));
    add(side(mk('gpuend'), 22, 430, 150, 34));
    add(at(part('gpuedge', 'gpu', '<i class="glow light lin"></i><span class="word light lin">SUPRIM</span>'), 22, 430, 476, 34, 150));
  }
  add(at(part('strip', 'strip', '<i class="glow"></i><i class="bar"></i>'), 547, 392, 6, 100, 286));
  add(face(mk('pane'), CW, CH, `translateZ(${CD / 2}px)`));
}

function paint(world: HTMLElement, d: PcCaseData) {
  const zones = (id?: string) => d.parts.find(p => p.id === id)?.zones;
  world.querySelectorAll<HTMLElement>('.part').forEach(e => {
    const z = zones(e.dataset.part); if (!z) return;
    setLight(e, (z[+(e.dataset.zone ?? 0)] || z[0]));
    e.querySelectorAll<HTMLElement>('[data-zone]').forEach(x => setLight(x, z[+x.dataset.zone!] || z[0]));
  });
  world.querySelectorAll<HTMLElement>('[data-tint]').forEach(e => { const z = zones(e.dataset.tint); if (z) setLight(e, z[+e.dataset.zone!] || z[0]); });
  const img = world.querySelector<HTMLImageElement>('.pump .scr img');
  if (img && d.screen && img.getAttribute('src') !== d.screen) img.src = d.screen;
}

export default function PcCase({ data }: { data: PcCaseData }) {
  const box = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const shape = JSON.stringify([data.parts.map(p => [p.id, p.zones.length]), data.layout]);

  useEffect(() => {   // rebuild only when the hardware or layout changes
    build(world.current!, data); paint(world.current!, data);
    const t = setTimeout(() => world.current?.classList.remove('boot'), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  useEffect(() => { paint(world.current!, data); }, [data]);
  useEffect(() => {   // the model is 740 wide; scale it to the card
    const fit = () => { const k = box.current!.clientWidth / 740; world.current!.style.transform = `scale(${k})`; box.current!.style.height = 735 * k + 'px'; };
    const ro = new ResizeObserver(fit); ro.observe(box.current!); fit();
    return () => ro.disconnect();
  }, []);

  return <div ref={box} className="pcx relative w-full" aria-label="3D model of the PC" role="img"><div ref={world} className="world boot" /></div>;
}
