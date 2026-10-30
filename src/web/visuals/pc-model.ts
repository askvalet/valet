// The PC as a live 3D model (CSS 3D, no WebGL): a dual-chamber glass case, its fans, cooler, board, RAM and GPU, lit
// the colours they really are. What's in it (fan counts, AIO or air cooler, sticks, the text on the board and the card)
// comes from a `build` description in the config, so it can look like anyone's PC. Framework-free: Valet's card and rgb-control's page both mount it with
// createViewer(). rgb-control gets a bundled copy (npm run export:pc-model).
import './pc-case.css';
import { createStage, type Scene, type StageOptions } from './stage.ts';

export type Light = { mode?: string; color?: number[]; brightness?: number; speed?: number };
export type Metric = { label: string; value: string | number; unit?: string; tone?: 'warn' | 'bad'; pct?: number };
export interface ModelData {
  parts: { id: string; title: string; sub?: string; modes?: string[]; zones: Light[] }[];   // fans0..3, coolerfans, pump, ram, gpu, mobo
  layout?: Record<string, string>;                         // fan group → 'top' | 'hidden'
  fans?: Record<string, number>;                           // fan group → rpm; blades spin at that speed, stand still at 0
  metrics?: Record<string, Metric[]>;                      // what each part shows when selected
  presets?: { id: string; name: string; swatch: string[] }[];
  view?: { turn: number; tilt: number; draggable: boolean };
  controls?: boolean;
  screen?: string;                                         // the pump screen's picture
  build?: Partial<PcBuild>;
}

/** What's in the case. Everything is optional; the defaults are a generic build with no brand text. */
export interface PcBuild {
  radiatorFans: number;                                    // fans on a top radiator, 0–3 (0: no radiator)
  floorFans: number;                                       // intake fans on the floor, 0–3
  cooler: 'aio' | 'air';                                   // aio: a pump head (shows the screen picture if there is one); air: a tower
  ram: number;                                             // sticks, 0–4
  ramLabel: string;                                        // text on the sticks' heat spreaders
  board: { label: string; plate: string; accent: string }; // text on the VRM heatsink and M.2 plate; the line-art colour
  gpu: { label: string; badge: string } | null;            // engraved name and the lit badge on its edge; null: no card
  strip: boolean;                                          // a light strip down the front edge
}
export const DEFAULT_BUILD: PcBuild = {
  radiatorFans: 3, floorFans: 3, cooler: 'aio', ram: 4, ramLabel: '',
  board: { label: '', plate: '', accent: '#8a8f98' }, gpu: { label: '', badge: '' }, strip: true,
};
const buildOf = (d: ModelData): PcBuild => ({ ...DEFAULT_BUILD, ...d.build,
  board: { ...DEFAULT_BUILD.board, ...d.build?.board }, gpu: d.build?.gpu === null ? null : { ...DEFAULT_BUILD.gpu!, ...d.build?.gpu } });
const txt = (s: string) => s.replace(/[<>&"]/g, '');

// The case interior in model units: width × height on the motherboard wall, depth out to the front glass.
export const CW = 600, CH = 520, CD = 320;
export const hex = (c: number[] = [255, 255, 255]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');

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
/** a lit element that Valet can't read the state of (e.g. RAM before OpenRGB can reach it): drawn the white it ships as */
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

export function build(world: HTMLElement, d: ModelData) {
  world.innerHTML = '';
  const B = buildOf(d), gold = B.board.accent;
  const nRad = Math.max(0, Math.min(3, B.radiatorFans)), nFloor = Math.max(0, Math.min(3, B.floorFans)), nRam = Math.max(0, Math.min(4, B.ram));
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
  add(face(mk('floor'), CW, CD, `translateY(${CH / 2}px) rotateX(90deg)`));
  // intake fans on the floor: the same pack as the radiator's (same frames, same thickness), just unlit
  const FY = CH - 34;   // their top face
  if (nFloor) {
  const FW = 6 + nFloor * 154;
  const floorTop = lid(mk('fanunder floorpack'), 16, FY, FW, 280, 14);
  floorTop.innerHTML = Array.from({ length: nFloor }, (_, i) => i).map(i => `<i class="fanframe" style="left:${8 + i * 154}px;top:62px"></i>`
    + `<i class="fan dark" style="left:${15 + i * 154}px;top:69px"><i class="blades" style="animation-delay:${-i * .41}s"></i><i class="hub"></i></i>`).join('');
  const floorFront = mk('fanrow dark', Array.from({ length: nFloor }, (_, i) => `<i class="fanedge" style="left:${6 + i * 154}px"></i>`).join(''));
  for (const f of [floorTop, side(mk('fanpack rside'), 16, FY, 280, 34, 14), at(floorFront, 16, FY, FW, 34, 294)]) { f.dataset.of = 'floor'; add(f); }
  // their daisy-chained cable off the right end, back into the cable grommets
  add(at(mk('braids layer', svg(braid(`M${16 + FW} ${FY + 18} C 520 ${FY + 10}, 540 ${FY - 40}, 520 ${FY - 120}`, 3.2, 2, 2))), 0, 0, CW, CH, 160)).dataset.of = 'floor';
  }
  add(face(mk('ceiling'), CW, CD, `translateY(${-CH / 2}px) rotateX(90deg)`));

  // ── motherboard: dark board, line-art heatsinks in the board's accent, M.2 plate
  add(at(mk('board', svg(
    `<path d="M18 40 A 60 60 0 0 1 60 160 M12 120 A 90 90 0 0 0 40 230" stroke="${gold}" stroke-width=".8" opacity=".55"/>`
    + `<path d="M210 222 h86 v40 h-86 z M232 222 v40 M254 222 v40 M210 242 h86 M276 222 A 20 20 0 0 1 296 242" stroke="${gold}" stroke-width=".7" opacity=".6"/>`)
    + `<i class="sock"></i><i class="pcie" style="top:236px"></i><i class="m2plate"><span style="color:${gold}">${txt(B.board.plate)}</span></i>`
    + [[6, 6], [246, 6], [6, 246], [246, 246], [126, 120]].map(([x, y]) => `<i class="screw" style="left:${x}px;top:${y}px"></i>`).join('')), 80, 78, 258, 252, 1));
  // VRM heatsinks: the tall block on the left (with the board's name) and the bar across the top
  block(add, 82, 80, 44, 162, 2, 26, 'sink', mk('sink front', `<span class="boardname" style="color:${gold}">${txt(B.board.label)}</span><svg width="44" height="162"><path d="M4 30 Q 40 60 8 120 M14 4 Q 44 40 30 150" stroke="${gold}" stroke-width=".8" fill="none" opacity=".7"/></svg>`));
  block(add, 128, 86, 150, 24, 2, 18, 'sink', mk('sink front', `<svg width="150" height="24"><path d="M10 20 Q 70 -6 140 18" stroke="${gold}" stroke-width=".8" fill="none" opacity=".6"/></svg>`));
  block(add, 106, 270, 86, 22, 2, 8, 'chipset');

  // RAM: sticks lit along their whole length
  const ram = d.parts.find(p => p.id === 'ram');
  for (let i = 0; i < nRam; i++) {
    const x = 258 + i * 11;
    add(lid(mk('ramtop'), x, 98, 7, 30, 2)).dataset.of = 'ram';
    const label = `<i class="wash light lin"></i><b>${txt(B.ramLabel)}</b>`;
    const sideEl = ram ? mk('ramside', label) : unread('ramside', label);
    if (ram) sideEl.dataset.tint = 'ram';
    add(side(sideEl, x, 98, 30, 140, 2)).dataset.of = 'ram';
    const front = ram ? part('ram', 'ram', '<i class="glow light lin"></i><i class="bar light lin"></i>', i) : unread('ram', '<i class="glow light lin"></i><i class="bar light lin"></i>');
    add(at(front, x, 98, 7, 140, 32)).dataset.of = 'ram';
  }

  // 24-pin bundle out of the right edge of the board, looping back into the grommets
  add(at(mk('braids layer', svg(braid('M326 126 C 352 128, 372 150, 368 196 S 344 236, 330 238', 4.2, 7, 2.6))), 0, 0, CW, CH, 10));
  // CPU power up the top-left into the ceiling
  add(at(mk('braids layer', svg(braid('M96 82 C 92 50, 60 30, 58 -4', 3.6, 5, 2.4))), 0, 0, CW, CH, 22));

  if (B.cooler === 'air') {
    // an air cooler: a finned tower standing off the socket with a fan on its face
    block(add, 150, 120, 100, 130, 2, 120, 'tower', mk('tower front', '<i class="towerfan"><i class="blades"></i><i class="hub"></i></i>'), 'pump');
  } else {
  // pump head: a black block with the live screen between two lit strips, one down each side
  const pump = has('pump') ? part('pumpface', 'pump', '<i class="edge-l light"></i><i class="edge-r light"></i><i class="halo l light"></i><i class="halo r light"></i><div class="scr"><img alt=""></div>') : mk('pumpface', '<div class="scr"><img alt=""></div>');
  block(add, 160, 146, 76, 80, 2, 48, 'pump', pump, 'pump');

  // the two radiator hoses: down out of the pump, a wide sweep right, then up to the radiator at the top right
  if (nRad) add(at(mk('braids layer hose' /* pump */, svg(braid('M184 226 C 186 280, 250 292, 330 268 S 470 210, 478 64', 10) + braid('M206 226 C 210 270, 268 278, 340 252 S 456 196, 492 64', 10))), 0, 0, CW, CH, 40));
  }

  // the GPU: a long slab across the lower slot, its name engraved, a lit badge and emblem on its edge
  if (B.gpu) {
  const gpu = has('gpu'), G = B.gpu;
  const edge = `<i class="badgeglow light lin"></i><span class="rtx">${txt(G.label)}</span>${G.badge ? `<i class="badge light lin"><b>${txt(G.badge)}</b></i>` : ''}<i class="logo light lin"></i>`;
  add(lid(mk('gputop', `<span class="rtx">${txt(G.label)}</span><i class="emb"></i>`), 40, 312, 404, 170, 0)).dataset.of = 'gpu';
  add(side(mk('gpuend'), 40, 312, 170, 44)).dataset.of = 'gpu';
  add(at(gpu ? part('gpufront', 'gpu', edge) : unread('gpufront', edge), 40, 312, 404, 44, 170)).dataset.of = 'gpu';
  // its power cable: off the top, across and down to the floor
  add(at(mk('braids layer', svg(braid('M300 312 C 330 300, 420 300, 470 340 S 500 470, 520 520', 3.4, 6, 2.2))), 0, 0, CW, CH, 150));
  }

  // radiator up top; its fans hang beneath it, seen from below: lit rings and spinning blades
  if (nRad) {
  const RW = 6 + nRad * 154;
  add(lid(mk('radiator'), 16, 0, RW, 290, 20));
  add(at(mk('radfront'), 16, 0, RW, 30, 310));
  const fanId = top?.id ?? 'fans0';
  const fans = top ? part('fanrow', top.id) : mk('fanrow');
  const idx = Array.from({ length: nRad }, (_, i) => i);
  fans.innerHTML = idx.map(i => `<i class="fanbar" data-zone="${i}" style="left:${6 + i * 154}px"><i class="lb glow light lin"></i><i class="lb core light lin"></i><i class="lens"></i></i>`).join('');
  const under = top ? part('fanunder', top.id) : mk('fanunder');
  under.innerHTML = idx.map(i => `<i class="fanframe" style="left:${8 + i * 154}px"></i>`
    + `<i class="fan" data-zone="${i}" style="left:${15 + i * 154}px"><i class="glow light spin"></i><i class="r1 light spin"></i><i class="r2 light spin"></i><i class="r3 light spin"></i>`
    + `<i class="blades" style="animation-delay:${-i * .37}s"></i><i class="hub"></i></i>`).join('');
  for (const f of [lid(mk('fanpack top'), 16, 30, RW, 280, 30), side(mk('fanpack rside'), 16, 30, 280, 34, 30), lid(under, 16, 64, RW, 280, 30), at(fans, 16, 30, RW, 34, 310)]) { f.dataset.of = fanId; add(f); }
  if (B.cooler === 'aio') block(add, 470, 40, 36, 30, 220, 60, 'fitting');
  }

  // the case's own light strip down the front edge (white, set by the case)
  if (B.strip) add(at(mk('strip', '<i class="glow"></i><i class="bar"></i>'), 595, 96, 2.5, 330, CD - 4)).dataset.of = 'strip';
  add(face(mk('pane'), CW, CH, `translateZ(${CD / 2}px)`));
}

export function paint(world: HTMLElement, d: ModelData) {
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

// What can be picked, in the order the panel lists them. `light` is the rgb-control part whose lighting it sets;
// `at` is where the camera flies to (wall x, y and depth z, as when building) and how close it gets.
export const PICKS: { id: string; name: string; light?: string; note?: string; at: [number, number, number, number] }[] = [
  { id: 'fans', name: 'Radiator fans', light: 'fans0', at: [250, 80, 170, 1.35] },
  { id: 'pump', name: 'CPU cooler', light: 'pump', at: [198, 186, 50, 1.7] },
  { id: 'ram', name: 'Memory', light: 'ram', at: [276, 168, 30, 1.7] },
  { id: 'gpu', name: 'Graphics card', light: 'gpu', at: [242, 334, 150, 1.45] },
  { id: 'floor', name: 'Floor fans', note: 'Not lit. They follow the motherboard\u2019s fan curve.', at: [300, 500, 160, 1.5] },
  { id: 'strip', name: 'Case light', note: 'Set by the case itself, not something software can change.', at: [560, 260, 300, 1.5] },
];

const isFanUnit = (id: string) => id === 'coolerfans' || /^fans\d$/.test(id);
/** the fan group drawn on the radiator */
export const topFans = (d: ModelData) => d.parts.find(p => isFanUnit(p.id) && (d.layout?.[p.id] ?? (p.id === 'fans0' ? 'top' : '')) === 'top')?.id ?? 'fans0';

export const pcScene: Scene<ModelData> = {
  scope: 'pcx', size: [720, 430], center: [CW / 2, CH / 2, CD / 2],
  frame: '.wall, .rear, .mesh, .floor, .ceiling, .pane',
  shape: d => JSON.stringify([d.parts.map(p => [p.id, p.zones.length]), d.layout, d.build]),
  build, paint,
  pickOf: id => isFanUnit(id) ? 'fans' : PICKS.some(p => p.id === id) ? id : null,
  facesOf: (pick, d) => pick === 'fans' ? [topFans(d)] : [pick],
  focus: pick => PICKS.find(p => p.id === pick)?.at,
};

/** Mounts the PC in `box` (see stage.ts). Kept as its own export: rgb-control calls it. */
export const createViewer = (box: HTMLElement, opts: StageOptions = {}) => createStage(box, pcScene, { turn: -27, tilt: -18, remember: 'pc', ...opts });
