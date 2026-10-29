// The PC as a live 3D model (CSS 3D, no WebGL), modelled on the real build: a Lian Li case with a 360 radiator up top,
// an ASUS ProArt board, the pump head with its screen, four G.Skill sticks, an MSI SUPRIM card and three floor fans.
// Lights take the colours they really are. Built once per hardware layout; lights repaint in place as state streams in.
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import './pc-case.css';

type Light = { mode?: string; color?: number[]; brightness?: number; speed?: number };
type Metric = { label: string; value: string | number; unit?: string; tone?: 'warn' | 'bad'; pct?: number };
export interface PcCaseData {
  parts: { id: string; title: string; sub?: string; modes?: string[]; zones: Light[] }[];   // fans0..3, coolerfans, pump, ram, gpu, mobo
  layout?: Record<string, string>;                         // fan group → 'top' | 'hidden'
  fans?: Record<string, number>;                           // fan group → rpm; blades spin at that speed, stand still at 0
  metrics?: Record<string, Metric[]>;                      // what each part shows when selected
  presets?: { id: string; name: string; swatch: string[] }[];
  view?: { turn: number; tilt: number; draggable: boolean };
  controls?: boolean;
  screen?: string;                                         // the pump screen's picture
}

// The case interior in model units: width × height on the motherboard wall, depth out to the front glass.
const CW = 600, CH = 520, CD = 320;
const hex = (c: number[] = [255, 255, 255]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

function lightOf(st: Light) {
  const m = (st.mode || '').toLowerCase(), col = hex(st.color);
  const kind = m === 'off' ? 'off' : /rainbow|spectrum|wave|morph/.test(m) ? 'rainbow' : /meteor|runway|comet|chase|tail/.test(m) ? 'comet'
    : /breath|pulse/.test(m) ? 'breathe' : /cycle/.test(m) ? 'cycle' : 'static';
  const base = kind === 'cycle' ? '#ff3b30' : col;
  return {
    kind,
    lc: kind === 'rainbow' ? 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)' : base,
    lb: kind === 'rainbow' ? 'linear-gradient(90deg, #ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92)'
      : kind === 'comet' ? `linear-gradient(90deg, transparent, ${col} 70%, #fff)` : base,
    lo: kind === 'off' ? 0 : Math.max(.12, (st.brightness ?? 100) / 100),
    dur: (8 - 6.5 * ((st.speed ?? 50) / 100)).toFixed(2) + 's',
  };
}
function setLight(e: HTMLElement, st: Light) {
  const L = lightOf(st);
  e.style.setProperty('--lc', L.lc); e.style.setProperty('--lb', L.lb); e.style.setProperty('--lo', String(L.lo)); e.style.setProperty('--dur', L.dur);
  e.classList.remove('m-off', 'm-rainbow', 'm-comet', 'm-breathe', 'm-cycle', 'm-static');
  e.classList.add('m-' + L.kind);
}

// ── placing faces. x, y on the motherboard wall from its top-left; z out from the wall towards the glass.
const mk = (cls: string, html?: string) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; return e; };
function face(e: HTMLElement, w: number, h: number, tf: string) { e.classList.add('f'); Object.assign(e.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px', transform: tf }); return e; }
/** a face parallel to the wall */
const at = (e: HTMLElement, x: number, y: number, w: number, h: number, z: number) => face(e, w, h, `translate3d(${x + w / 2 - CW / 2}px, ${y + h / 2 - CH / 2}px, ${z - CD / 2}px)`);
/** a face standing out of the wall, seen side-on, at x; depth d from z0 */
const side = (e: HTMLElement, x: number, y: number, d: number, h: number, z0 = 0) => face(e, d, h, `translate3d(${x - CW / 2}px, ${y + h / 2 - CH / 2}px, ${z0 + d / 2 - CD / 2}px) rotateY(90deg)`);
/** a horizontal face (a top) at y; its first row is at the wall, its last at z0 + d */
const lid = (e: HTMLElement, x: number, y: number, w: number, d: number, z0 = 0) => face(e, w, d, `translate3d(${x + w / 2 - CW / 2}px, ${y - CH / 2}px, ${z0 + d / 2 - CD / 2}px) rotateX(90deg)`);
/** a solid block: top, left side (the side we see) and front */
function block(add: (e: HTMLElement) => HTMLElement, x: number, y: number, w: number, h: number, z0: number, d: number, cls: string, front?: HTMLElement, of?: string) {
  const faces = [lid(mk(`${cls} top`), x, y, w, d, z0), side(mk(`${cls} rside`), x, y, d, h, z0), at(front ?? mk(`${cls} front`), x, y, w, h, z0 + d)];
  for (const f of faces) { if (of) f.dataset.of = of; add(f); }
  return faces[2];
}
const part = (cls: string, id: string, html = '', zone?: number) => { const e = mk('part ' + cls, html); e.dataset.part = id; if (zone != null) e.dataset.zone = String(zone); return e; };
/** a lit element that Atrium can't read the state of (e.g. RAM before OpenRGB can reach it): drawn the white it ships as */
const unread = (cls: string, html = '') => { const e = mk(cls + ' m-static', html); e.style.setProperty('--lc', '#fff'); e.style.setProperty('--lb', '#fff'); e.style.setProperty('--lo', '1'); return e; };

// honeycomb steel (the rear panel and the slot area): hexagonal holes showing the room behind
const HEX = (() => {
  const h = (cx: number, cy: number, r = 4.4) => `M${cx} ${cy - r}l${r * .866} ${r / 2}v${r}l${-r * .866} ${r / 2}l${-r * .866} ${-r / 2}v${-r}z`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='11' height='17'><path d='${h(5.5, 4.25)}${h(0, 12.75)}${h(11, 12.75)}' fill='%23383b42'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;
})();
// braided sleeving: a dark core with a woven sheen
const braid = (d: string, w: number, n = 1, gap = 0) => Array.from({ length: n }, (_, i) =>
  `<g transform="translate(${i * gap} ${i * gap * .35})"><path d="${d}" stroke="#08090a" stroke-width="${w + 2}"/><path d="${d}" stroke="#1c1e22" stroke-width="${w}"/>`
  + `<path d="${d}" stroke="#34373d" stroke-width="${w * .5}" stroke-dasharray="1.6 2.4" opacity=".75"/></g>`).join('');
const svg = (paths: string) => `<svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" style="overflow:visible"><g fill="none" stroke-linecap="round">${paths}</g></svg>`;

function build(world: HTMLElement, d: PcCaseData) {
  world.innerHTML = '';
  const has = (id: string) => d.parts.some(p => p.id === id);
  const cam = mk('cam'); world.appendChild(cam);
  const add = (e: HTMLElement) => (cam.appendChild(e), e);
  const fanUnit = (id: string) => id === 'coolerfans' || /^fans\d$/.test(id);
  const top = d.parts.find(p => fanUnit(p.id) && (d.layout?.[p.id] ?? (p.id === 'fans0' ? 'top' : 'hidden')) === 'top');

  // ── the case: wall, rear honeycomb panel on the left, mesh on the right, floor, ceiling
  const wall = add(face(mk('wall'), CW, CH, `translateZ(${-CD / 2}px)`));
  wall.insertAdjacentHTML('beforeend', `<i class="hexpatch" style="left:12px;top:86px;width:62px;height:150px;background-image:${HEX}"></i>`
    + [0, 1, 2, 3].map(i => `<i class="grommet" style="left:${392 + i * 20}px;top:${96 + (i % 2) * 14}px;height:${200 - (i % 2) * 28}px"></i>`).join(''));
  const rear = add(face(mk('rear'), CD, CH, `translateX(${-CW / 2}px) rotateY(90deg)`));
  rear.style.backgroundImage = HEX;
  rear.insertAdjacentHTML('beforeend', [0, 1, 2, 3, 4, 5, 6].map(i => `<i class="slotcover" style="top:${262 + i * 22}px"></i>`).join(''));
  add(face(mk('mesh'), CD, CH, `translateX(${CW / 2}px) rotateY(90deg)`));
  const floor = add(face(mk('floor'), CW, CD, `translateY(${CH / 2}px) rotateX(90deg)`));
  floor.dataset.of = 'floor';
  // three 140 mm intake fans on the floor, framed in a tray; seen from above through the glass
  floor.insertAdjacentHTML('beforeend', '<i class="tray"></i>');
  [0, 1, 2].forEach(i => { const f = mk('floorfan', `<i class="ring"></i><i class="blades" style="animation-delay:${-i * .41}s"></i><i class="hub"></i>`); Object.assign(f.style, { left: 62 + i * 158 + 'px', top: '52px', width: '150px', height: '150px' }); floor.appendChild(f); });
  add(face(mk('ceiling'), CW, CD, `translateY(${-CH / 2}px) rotateX(90deg)`));

  // ── motherboard (ASUS ProArt): dark board, gold line-art heatsinks, M.2 plate
  add(at(mk('board', svg(
    '<path d="M18 40 A 60 60 0 0 1 60 160 M12 120 A 90 90 0 0 0 40 230" stroke="#b08d57" stroke-width=".8" opacity=".55"/>'
    + '<path d="M210 222 h86 v40 h-86 z M232 222 v40 M254 222 v40 M210 242 h86 M276 222 A 20 20 0 0 1 296 242" stroke="#b08d57" stroke-width=".7" opacity=".6"/>')
    + '<i class="sock"></i><i class="pcie" style="top:236px"></i><i class="m2plate"><span>Power Up Your Imagination</span></i>'
    + [[6, 6], [246, 6], [6, 246], [246, 246], [126, 120]].map(([x, y]) => `<i class="screw" style="left:${x}px;top:${y}px"></i>`).join('')), 80, 78, 258, 252, 1));
  // VRM heatsinks: the tall "ProArt" block on the left and the bar across the top
  block(add, 82, 80, 44, 162, 2, 26, 'sink', mk('sink front', '<span class="proart">ProArt</span><svg width="44" height="162"><path d="M4 30 Q 40 60 8 120 M14 4 Q 44 40 30 150" stroke="#b08d57" stroke-width=".8" fill="none" opacity=".7"/></svg>'));
  block(add, 128, 86, 150, 24, 2, 18, 'sink', mk('sink front', '<svg width="150" height="24"><path d="M10 20 Q 70 -6 140 18" stroke="#b08d57" stroke-width=".8" fill="none" opacity=".6"/></svg>'));
  block(add, 106, 270, 86, 22, 2, 8, 'chipset');

  // RAM: four G.Skill Trident Z5 sticks, lit along their whole length
  const ram = d.parts.find(p => p.id === 'ram');
  for (let i = 0; i < 4; i++) {
    const x = 258 + i * 11;
    add(lid(mk('ramtop'), x, 98, 7, 30, 2)).dataset.of = 'ram';
    const sideEl = ram ? mk('ramside', '<i class="wash light lin"></i><b>G.SKILL</b>') : unread('ramside', '<i class="wash light lin"></i><b>G.SKILL</b>');
    if (ram) sideEl.dataset.tint = 'ram';
    add(side(sideEl, x, 98, 30, 140, 2)).dataset.of = 'ram';
    const front = ram ? part('ram', 'ram', '<i class="glow light lin"></i><i class="bar light lin"></i>', i) : unread('ram', '<i class="glow light lin"></i><i class="bar light lin"></i>');
    add(at(front, x, 98, 7, 140, 32)).dataset.of = 'ram';
  }

  // 24-pin bundle out of the right edge of the board, looping back into the grommets
  add(at(mk('braids', svg(braid('M326 126 C 352 128, 372 150, 368 196 S 344 236, 330 238', 4.2, 7, 2.6))), 0, 0, CW, CH, 10));
  // CPU power up the top-left into the ceiling
  add(at(mk('braids', svg(braid('M96 82 C 92 50, 60 30, 58 -4', 3.6, 5, 2.4))), 0, 0, CW, CH, 22));

  // pump head: a black block with the live screen, its edge light down the right side and across the top
  const pump = has('pump') ? part('pumpface', 'pump', '<i class="edge-r light"></i><i class="edge-t light"></i><i class="halo light"></i><div class="scr"><img alt=""></div>') : mk('pumpface', '<div class="scr"><img alt=""></div>');
  block(add, 160, 146, 76, 80, 2, 48, 'pump', pump, 'pump');

  // the two radiator hoses: down out of the pump, a wide sweep right, then up to the radiator at the top right
  add(at(mk('braids hose' /* pump */, svg(braid('M184 226 C 186 280, 250 292, 330 268 S 470 210, 478 64', 10) + braid('M206 226 C 210 270, 268 278, 340 252 S 456 196, 492 64', 10))), 0, 0, CW, CH, 40));

  // the GPU (MSI SUPRIM): a long slab across the lower slot, SUPRIM badge and the emblem lit on its edge
  const gpu = has('gpu');
  add(lid(mk('gputop', '<span class="rtx">GEFORCE RTX</span><i class="emb"></i>'), 40, 312, 404, 170, 0)).dataset.of = 'gpu';
  add(side(mk('gpuend'), 40, 312, 170, 44)).dataset.of = 'gpu';
  add(at(gpu ? part('gpufront', 'gpu', '<span class="rtx">GEFORCE RTX</span><i class="badge light lin"><b>SUPRIM</b></i><i class="badgeglow light lin"></i><i class="logo light lin"></i>')
    : unread('gpufront', '<span class="rtx">GEFORCE RTX</span><i class="badge light lin"><b>SUPRIM</b></i><i class="badgeglow light lin"></i><i class="logo light lin"></i>'), 40, 312, 404, 44, 170)).dataset.of = 'gpu';
  // its power cable: off the top, across and down to the floor
  add(at(mk('braids', svg(braid('M300 312 C 330 300, 420 300, 470 340 S 500 470, 520 520', 3.4, 6, 2.2))), 0, 0, CW, CH, 150));

  // radiator up top; its three fans hang beneath it, seen from below: lit rings and spinning blades
  add(lid(mk('radiator'), 16, 0, 468, 290, 20));
  add(at(mk('radfront'), 16, 0, 468, 30, 310));
  const fanId = top?.id ?? 'fans0';
  const fans = top ? part('fanrow', top.id) : mk('fanrow');
  fans.innerHTML = [0, 1, 2].map(i => `<i class="fanbar" data-zone="${i}" style="left:${6 + i * 154}px"><i class="lb glow light lin"></i><i class="lb core light lin"></i><i class="lens"></i></i>`).join('');
  const under = top ? part('fanunder', top.id) : mk('fanunder');
  under.innerHTML = [0, 1, 2].map(i => `<i class="fanframe" style="left:${8 + i * 154}px"></i>`
    + `<i class="fan" data-zone="${i}" style="left:${15 + i * 154}px"><i class="glow light spin"></i><i class="r1 light spin"></i><i class="r2 light spin"></i><i class="r3 light spin"></i>`
    + `<i class="blades" style="animation-delay:${-i * .37}s"></i><i class="hub"></i></i>`).join('');
  for (const f of [lid(mk('fanpack top'), 16, 30, 468, 280, 30), side(mk('fanpack rside'), 16, 30, 280, 34, 30), lid(under, 16, 64, 468, 280, 30), at(fans, 16, 30, 468, 34, 310)]) { f.dataset.of = fanId; add(f); }
  block(add, 470, 40, 36, 30, 220, 60, 'fitting');

  // the case's own light strip down the front edge (white, set by the case)
  add(at(mk('strip', '<i class="glow"></i><i class="bar"></i>'), 595, 96, 2.5, 330, CD - 4)).dataset.of = 'strip';
  add(face(mk('pane'), CW, CH, `translateZ(${CD / 2}px)`));
}

function paint(world: HTMLElement, d: PcCaseData) {
  const zones = (id?: string) => d.parts.find(p => p.id === id)?.zones;
  world.querySelectorAll<HTMLElement>('.part').forEach(e => {
    const z = zones(e.dataset.part); if (!z) return;
    setLight(e, z[+(e.dataset.zone ?? 0)] || z[0]);
    e.querySelectorAll<HTMLElement>('[data-zone]').forEach(x => setLight(x, z[+x.dataset.zone!] || z[0]));
  });
  world.querySelectorAll<HTMLElement>('[data-tint]').forEach(e => { const z = zones(e.dataset.tint); if (z) setLight(e, z[0]); });
  // blades turn at the real speed (scaled down so it reads as motion, not blur) and stop when the fans do
  const rpm = Object.values(d.fans ?? {}).find(v => v > 0) ?? 0;
  world.style.setProperty('--fan', rpm > 0 ? `${Math.max(.45, 640 / rpm).toFixed(2)}s` : '0s');
  world.classList.toggle('fans-still', rpm <= 0);
  const img = world.querySelector<HTMLImageElement>('.scr img');
  if (img && d.screen && img.getAttribute('src') !== d.screen) img.src = d.screen;
}

const W = 720, H = 640;

// What can be picked, in the order the panel lists them. `light` is the rgb-control part whose lighting it sets;
// `at` is where the camera flies to (wall x, y and depth z, as when building) and how close it gets.
const PICKS: { id: string; name: string; light?: string; note?: string; at: [number, number, number, number] }[] = [
  { id: 'fans', name: 'Radiator fans', light: 'fans0', at: [250, 80, 170, 1.35] },
  { id: 'pump', name: 'CPU cooler', light: 'pump', at: [198, 186, 50, 1.7] },
  { id: 'ram', name: 'Memory', light: 'ram', at: [276, 168, 30, 1.7] },
  { id: 'gpu', name: 'Graphics card', light: 'gpu', at: [242, 334, 150, 1.45] },
  { id: 'floor', name: 'Floor fans', note: 'Not lit. They follow the motherboard\u2019s fan curve.', at: [300, 500, 160, 1.5] },
  { id: 'strip', name: 'Case light', note: 'Set by the case itself, not something software can change.', at: [560, 260, 300, 1.5] },
];
const SWATCHES = ['#ffffff', '#ffd2a1', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00e0c6', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d92'];
const NAMES: Record<string, string> = { '#ffffff': 'White', '#ffd2a1': 'Warm white', '#ff3b30': 'Red', '#ff9500': 'Orange', '#ffd60a': 'Yellow', '#34c759': 'Green', '#00e0c6': 'Teal', '#0a84ff': 'Blue', '#5e5ce6': 'Indigo', '#bf5af2': 'Purple', '#ff2d92': 'Pink' };
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const pretty = (m: string) => m.replace(/([a-z])([A-Z])/g, '$1 $2');
function describe(st?: Light) {
  if (!st || st.mode === 'Off') return 'Off';
  if (/rainbow|spectrum|wave|cycle|morph/i.test(st.mode ?? '')) return pretty(st.mode!);
  const name = NAMES[hex(st.color)] ?? hex(st.color);
  return `${name}${st.mode && !['Static', 'Direct'].includes(st.mode) ? ` · ${pretty(st.mode).toLowerCase()}` : ''}${(st.brightness ?? 100) < 100 ? ` · ${st.brightness}%` : ''}`;
}

/** A part's number as a ring: ¾ arc, value in the middle, coloured by health. */
function Gauge({ m }: { m: Metric }) {
  const r = 30, c = 2 * Math.PI * r, arc = c * .75, pct = Math.max(0, Math.min(1, m.pct ?? 0));
  const color = m.tone === 'bad' ? 'var(--bad)' : m.tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative size-[78px]">
        <svg viewBox="0 0 76 76" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, pct) * arc} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out" style={{ filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 40%, transparent))` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="metric text-[17px]">{m.value}</span>
          {m.unit && <span className="mt-0.5 text-[10px] text-muted-foreground">{m.unit}</span>}
        </div>
      </div>
      <div className="-mt-1 text-[11.5px] text-muted-foreground">{m.label}</div>
    </div>
  );
}

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;
export default function PcCase({ data, run }: { data: PcCaseData; run?: Run }) {
  const box = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Light>>({});   // optimistic lighting while a change is on its way
  const shape = JSON.stringify([data.parts.map(p => [p.id, p.zones.length]), data.layout]);
  const fanId = data.parts.find(p => /^fans\d$|coolerfans/.test(p.id) && (data.layout?.[p.id] ?? (p.id === 'fans0' ? 'top' : '')) === 'top')?.id ?? 'fans0';
  const lightId = (pick: string) => pick === 'fans' ? fanId : PICKS.find(p => p.id === pick)?.light;
  // the data the model paints with: server state, overlaid with what was just picked
  const shown = useMemo(() => ({ ...data, parts: data.parts.map(p => draft[p.id] ? { ...p, zones: p.zones.map(z => ({ ...z, ...draft[p.id] })) } : p) }), [data, draft]);
  useEffect(() => setDraft({}), [data]);

  useEffect(() => {
    build(world.current!, shown); paint(world.current!, shown);
    const t = setTimeout(() => world.current?.classList.remove('boot'), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  useEffect(() => { paint(world.current!, shown); }, [shown]);
  useEffect(() => {
    const fit = () => { const k = box.current!.clientWidth / W; world.current!.style.transform = `scale(${k})`; box.current!.style.height = H * k + 'px'; };
    const ro = new ResizeObserver(fit); ro.observe(box.current!); fit();
    return () => ro.disconnect();
  }, []);
  // the camera: drag to orbit, and fly in to whatever is selected
  const view = data.view ?? { turn: -15, tilt: 12, draggable: true };
  const cam = useRef({ ry: view.turn, rx: view.tilt, at: [CW / 2, CH / 2, CD / 2, 1] as number[] });
  const dragged = useRef(false);
  const aim = (animate = true) => {
    const c = world.current?.querySelector<HTMLElement>('.cam'); if (!c) return;
    const { rx, ry, at: [x, y, z, k] } = cam.current;
    c.style.transition = animate ? 'transform .9s cubic-bezier(.2, .8, .2, 1)' : 'none';
    c.style.transform = `translateY(18px) scale(${0.94 * k}) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${CW / 2 - x}px, ${CH / 2 - y}px, ${CD / 2 - z}px)`;
  };
  useEffect(() => {
    const p = PICKS.find(p => p.id === sel);
    cam.current.at = p ? p.at : [CW / 2, CH / 2, CD / 2, 1];
    aim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, shape]);
  useEffect(() => {
    if (!view.draggable) return;
    const b = box.current!;
    let start: { x: number; y: number; rx: number; ry: number } | null = null;
    const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY, rx: cam.current.rx, ry: cam.current.ry }; dragged.current = false; };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) < 5) return;
      if (!dragged.current) { dragged.current = true; b.setPointerCapture(e.pointerId); b.classList.add('dragging'); }
      cam.current.ry = Math.max(-55, Math.min(55, start.ry + dx * .35));
      cam.current.rx = Math.max(-18, Math.min(24, start.rx - dy * .25));
      aim(false);
    };
    const up = () => { start = null; b.classList.remove('dragging'); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    return () => { b.removeEventListener('pointerdown', down); b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.draggable]);

  // clicking the model selects whatever was hit (a drag isn't a click); everything else dims
  useEffect(() => {
    const w = world.current!;
    const pickOf = (el: Element | null): string | null => {
      for (let e = el as HTMLElement | null; e && e !== w; e = e.parentElement) {
        const id = e.dataset.part ?? e.dataset.of ?? e.dataset.tint;
        if (id) return /^fans\d$|coolerfans/.test(id) ? 'fans' : PICKS.some(p => p.id === id) ? id : null;
      }
      return null;
    };
    const click = (e: MouseEvent) => { if (dragged.current) return; const p = pickOf(e.target as Element); setSel(s => p === s ? null : p); };
    w.addEventListener('click', click); return () => w.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    const w = world.current!;
    w.classList.toggle('picking', !!sel);
    const ids = sel === 'fans' ? [fanId] : sel ? [sel] : [];
    w.querySelectorAll<HTMLElement>('.f').forEach(f => {
      const keep = ids.some(id => f.dataset.part === id || f.dataset.of === id || f.dataset.tint === id);
      f.classList.toggle('keep', keep);
    });
  }, [sel, shape, fanId]);

  const pick = PICKS.find(p => p.id === sel);
  const light = pick ? lightId(pick.id) : undefined;
  const lp = shown.parts.find(p => p.id === light);
  const metrics = (sel === 'fans' ? data.metrics?.[fanId] : sel ? data.metrics?.[sel] : undefined) ?? [];
  const set = (st: Light) => {
    if (!light || !run) return;
    setDraft(d => ({ ...d, [light]: { ...(lp?.zones[0] ?? {}), ...st } }));
    run('light', { part: light, state: st }).catch(() => setDraft(d => { const { [light]: _, ...rest } = d; return rest; }));
  };

  return (
    <div className="grid items-center gap-x-6 gap-y-4 @xl/card:grid-cols-[minmax(0,1fr)_220px]">
      <div ref={box} className={cn("pcx relative w-full touch-none select-none overflow-hidden rounded-xl", view.draggable && "cursor-grab")} aria-label="3D model of the PC. Select a part to see it and change its lighting." role="img"><div ref={world} className="world boot" /></div>
      <div className="min-w-0 self-stretch">
        {!pick ? (
          <div className="flex h-full flex-col justify-center gap-5 animate-in fade-in duration-300">
            {data.presets?.length ? (
              <div>
                <div className="mb-2.5 text-[11.5px] text-muted-foreground">Presets</div>
                <div className="grid grid-cols-2 gap-2">
                  {data.presets.map(p => (
                    <button key={p.id} onClick={() => run?.('preset', { id: p.id })}
                      className="group/p flex items-center gap-2.5 rounded-xl bg-white/[.06] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[.12]">
                      <span className="size-5 shrink-0 rounded-full transition-transform group-hover/p:scale-110"
                        style={{ background: p.swatch.length > 1 ? `conic-gradient(${[...p.swatch, p.swatch[0]].join(', ')})` : p.swatch[0], boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .2)' }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted-foreground">Parts</div>
              <div className="flex flex-wrap gap-1.5">
                {PICKS.map(p => (
                  <button key={p.id} onClick={() => setSel(p.id)} className="rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground ring-1 ring-white/12 transition-colors hover:bg-white/10 hover:text-foreground">{p.name}</button>
                ))}
              </div>
              {view.draggable && <p className="mt-3 text-[11.5px] text-muted-foreground/70">Drag to look around. Tap a part to focus it.</p>}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-right-2 space-y-5 duration-300">
            <div className="flex items-center gap-2">
              <button onClick={() => setSel(null)} aria-label="Back" className="-ml-1.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{pick.name}</div>
                {lp?.sub && <div className="truncate text-xs text-muted-foreground">{lp.sub}</div>}
              </div>
            </div>
            {metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">{metrics.map(m => <Gauge key={m.label} m={m} />)}</div>
            )}
            {pick.note && <p className="text-sm text-muted-foreground">{pick.note}</p>}
            {pick.light && !lp && <p className="text-sm text-muted-foreground">Its lighting isn&rsquo;t reachable yet. OpenRGB needs access to the i2c bus: <code className="text-xs">sudo usermod -aG i2c $USER</code>, then reboot.</p>}
            {lp && data.controls !== false && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11.5px] text-muted-foreground">Colour</div>
                  <div className="flex flex-wrap gap-2">
                    {SWATCHES.map(c => {
                      const on = lp.zones[0]?.mode !== 'Off' && hex(lp.zones[0]?.color) === c;
                      return <button key={c} aria-label={NAMES[c]} title={NAMES[c]} onClick={() => set({ color: rgbOf(c), mode: ['Off', 'Rainbow', 'RainbowMorph', 'ColorCycle'].includes(lp.zones[0]?.mode ?? '') ? 'Static' : lp.zones[0]?.mode })}
                        className={cn('size-6 rounded-full transition-transform hover:scale-110', on && 'ring-2 ring-white ring-offset-2 ring-offset-transparent')} style={{ background: c, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .2)' }} />;
                    })}
                    <label className="relative size-6 cursor-pointer overflow-hidden rounded-full" title="Any colour" style={{ background: 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)' }}>
                      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any colour" value={hex(lp.zones[0]?.color)} onChange={e => set({ color: rgbOf(e.target.value), mode: 'Static' })} />
                    </label>
                  </div>
                </div>
                {lp.modes && lp.modes.length > 1 && (
                  <div>
                    <div className="mb-2 text-[11.5px] text-muted-foreground">Effect</div>
                    <Select value={lp.zones[0]?.mode} onValueChange={mode => set({ mode })}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{lp.modes.map(m => <SelectItem key={m} value={m}>{pretty(m)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex justify-between text-[11.5px] text-muted-foreground"><span>Brightness</span><span className="tabular">{lp.zones[0]?.brightness ?? 100}%</span></div>
                  <Slider value={[lp.zones[0]?.brightness ?? 100]} min={5} max={100} step={5} onValueChange={([b]) => setDraft(d => ({ ...d, [light!]: { ...(lp.zones[0] ?? {}), brightness: b } }))}
                    onValueCommit={([b]) => set({ brightness: b })} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
