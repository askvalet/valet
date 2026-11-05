// The rim lens of liquid glass: the wallpaper behind a surface's edge bends inward, the way the edge of a thick glass slab
// refracts it, and splits a little into its colours there. An SVG displacement map drives the bend through
// `backdrop-filter: url(#…)`, which only Chromium draws; Safari, iOS and Firefox keep the CSS glass as it is.
//
// Ported from glasswork's lens.js (https://github.com/kubai087/glasswork), MIT licence, Copyright (c) 2026 Kubai087; see
// NOTICE. The map is a nine-slice lens: only the rim bends, and a rim depends on the corner's radius and shape and the rim's
// width alone, so a lens is four corner tiles and four one-pixel edge strips (stretched along the sides) over a flat middle.
// Tiles are built and decoded once per rim and shared; a filter is shared by every surface of the same size and rim.
//
// What's ours: one manager for the page instead of one object per element. The stylesheet says which surfaces want a lens
// (`--lens-on: 1`, liquid glass only) and puts `var(--glass-lens,)` last in their backdrop-filter (`--bar-lens` for the top
// bars, whose frost is on ::before). Only surfaces on or near the screen get one, so a long page doesn't keep dozens of
// filters drawing; one ResizeObserver and one IntersectionObserver watch them all, and nothing runs per frame.

const RIM = 32;            // the widest the rim gets, in CSS px; small surfaces narrow it to a 3.5th of their short side
const EDGE = 1.1;          // how far inward the very edge samples the scene, in rim widths
const POWER = 2.6;         // how fast the bend falls off across the rim: (1 - d / rim) ^ power
const DISPERSION = .15;    // red bends this much further and blue this much less
const MIN_PX = 32;         // too small a surface has no flat middle to look through
const ROUND = 2;           // a circular corner's exponent (corner-shape: round)
const SVG = 'http://www.w3.org/2000/svg';

/** Only Chromium draws url() in backdrop-filter: Firefox parses it and draws nothing, WebKit draws none of it. */
export function lensSupported() {
  if (typeof CSS === 'undefined' || !CSS.supports?.('backdrop-filter', 'url(#a)')) return false;
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Firefox\/|FxiOS|CriOS|EdgiOS/.test(ua);
}

/** The superellipse exponent of a computed corner-shape: round is a circle, squircle superellipse(2). */
export function cornerExponent(shape: string) {
  const v = shape.trim();
  if (v === 'squircle') return 4;
  const k = Number(/^superellipse\(\s*([^)\s]+)\s*\)$/.exec(v)?.[1]);
  return Number.isFinite(k) && k >= 0 ? 2 ** k : ROUND;
}

// ---------- The map ----------

const strengthAt = (depth: number) => depth >= 1 ? 0 : (1 - Math.max(0, depth)) ** POWER;

// The rim's contours run from the outline (depth 0) to its inner edge (depth 1), each the outline inset by that share of
// the rim. A corner tighter than the rim widens its inner contours, so the bend turns the corner smoothly.
function contourRadius(depth: number, radius: number, bezel: number) {
  if (radius >= bezel) return radius - depth * bezel;
  return (1 - depth) * (radius + (bezel - radius) * depth * (2 - depth));
}

function within(x: number, y: number, depth: number, radius: number, bezel: number, corner: number) {
  const inset = depth * bezel;
  if (x < inset || y < inset) return false;
  const curve = contourRadius(depth, radius, bezel), centre = inset + curve;
  if (x >= centre || y >= centre) return true;
  return ((centre - x) / curve) ** corner + ((centre - y) / curve) ** corner <= 1;
}

/** The inward bend at a point `x`, `y` from a corner's two edges. */
function bendNearCorner(x: number, y: number, radius: number, bezel: number, corner: number): [number, number] {
  if (within(x, y, 1, radius, bezel, corner)) return [0, 0];
  let depth = 0;
  if (within(x, y, 0, radius, bezel, corner)) {
    // the contours are nested, so a point's depth is found by halving: 14 halvings is finer than a pixel
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (within(x, y, mid, radius, bezel, corner)) lo = mid; else hi = mid; }
    depth = lo;
  }
  const s = strengthAt(depth), curve = contourRadius(depth, radius, bezel), centre = depth * bezel + curve;
  if (x < centre && y < centre && curve > 0) {
    const nx = Math.max(0, (centre - x) / curve) ** (corner - 1), ny = Math.max(0, (centre - y) / curve) ** (corner - 1);
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len * s, ny / len * s];
  }
  return x < y ? [s, 0] : [0, s];
}

/** Inward offset at a point: unit direction times strength (1 at the rim's outer edge, 0 in the flat middle). */
export function rimDisplacement(x: number, y: number, w: number, h: number, bezel: number, radius: number, corner = ROUND): [number, number] {
  const rim = Math.min(bezel, h / 2, w / 2), r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const [ix, iy] = bendNearCorner(Math.min(x, w - x), Math.min(y, h - y), r, rim, corner);
  if (ix === 0 && iy === 0) return [0, 0];
  return [x < w / 2 ? ix : -ix, y < h / 2 ? iy : -iy];
}

type Rect = [number, number, number, number];
/** Where each tile sits: corners (top left, top right, bottom left, bottom right), then edges (top, bottom, left, right). */
function layout(w: number, h: number, size: number): Rect[] {
  const across = Math.max(1, w - size * 2), down = Math.max(1, h - size * 2);
  return [[0, 0, size, size], [w - size, 0, size, size], [0, h - size, size, size], [w - size, h - size, size, size],
    [size, 0, across, size], [size, h - size, across, size], [0, size, size, down], [w - size, size, size, down]];
}

type Tiles = { size: number; urls: string[] };
const tileCache = new Map<string, Promise<Tiles>>();

/** One rim's tiles as decoded image URLs: a filter whose images are still decoding draws without its blur, so none points
 *  at one early. Red is the sideways bend, green the vertical one, 128 none. */
function tilesFor(radius: number, bezel: number, corner: number) {
  const key = `${radius}:${bezel}:${corner.toFixed(3)}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const size = Math.max(1, Math.ceil(Math.max(radius, bezel))), probe = size * 2 + 1;
  const made = Promise.all(layout(probe, probe, size).map(async ([left, top, w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d')!, img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [dx, dy] = rimDisplacement(left + x + .5, top + y + .5, probe, probe, bezel, radius, corner), i = (y * w + x) * 4;
      img.data[i] = Math.round(128 + dx * 127); img.data[i + 1] = Math.round(128 + dy * 127); img.data[i + 2] = 128; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
    const el = new Image(); el.src = url;
    await el.decode().catch(() => {});
    return url;
  })).then(urls => ({ size, urls }));
  tileCache.set(key, made);
  if (tileCache.size > 48) tileCache.delete(tileCache.keys().next().value!);
  return made;
}

// ---------- The filter ----------

function node(tag: string, attrs: Record<string, string | number>, parent?: Element) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.append(el);
  return el;
}

let count = 0;
/** Only the rim bends, so only the rim is worked on: four strips (top and bottom full width, the sides between them), each
 *  with its own map from the tiles that cover it and its own displacement, limited to the strip (a primitive subregion),
 *  laid over the backdrop as it is. Over a whole card the displacement cost a frame's worth of time on a busy page; over the
 *  rim it's a fraction of that. Where the colour split is on, each strip is displaced once per channel by that channel's
 *  share of the bend and the three added back together (screen on single channels is a sum). Each filter gets its own
 *  <svg>: adding one to an <svg> holding others can make Chrome reload all their images, and a backdrop whose images reload
 *  drops its blur. */
function buildFilter(w: number, h: number, tiles: Tiles, bezel: number, split: boolean) {
  const id = `valet-lens-${++count}`;
  const host = node('svg', { 'aria-hidden': 'true', width: 0, height: 0, style: 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none' });
  const f = node('filter', { id, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB', x: 0, y: 0, width: w, height: h }, host);
  const size = tiles.size, rects = layout(w, h, size), scale = 2 * EDGE * bezel;
  rects.forEach(([x, y, rw, rh], i) => node('feImage', { href: tiles.urls[i], preserveAspectRatio: 'none', x, y, width: rw, height: rh, result: `t${i}` }, f));
  // each strip and the tiles that cover it
  const strips: [Rect, number[]][] = [[[0, 0, w, size], [0, 4, 1]], [[0, h - size, w, size], [2, 5, 3]], [rects[6], [6]], [rects[7], [7]]];
  const done: string[] = [];
  strips.forEach(([[x, y, sw, sh], parts], k) => {
    const sub = { x, y, width: sw, height: sh };
    let map = `t${parts[0]}`;
    if (parts.length > 1) {
      const m = node('feMerge', { ...sub, result: map = `m${k}` }, f);
      for (const i of parts) node('feMergeNode', { in: `t${i}` }, m);
    }
    const pass = (share: number, result: string) => node('feDisplacementMap', { ...sub, in: 'SourceGraphic', in2: map, xChannelSelector: 'R', yChannelSelector: 'G', scale: (scale * share).toFixed(1), result }, f);
    if (split) {
      ['r', 'g', 'b'].forEach((name, ch) => {
        pass(1 + (1 - ch) * DISPERSION, `d${k}${name}`);
        const keep = Array.from({ length: 20 }, (_, c) => Number(c === ch * 6 || c === 18)).join(' ');
        node('feColorMatrix', { ...sub, in: `d${k}${name}`, type: 'matrix', values: keep, result: `c${k}${name}` }, f);
      });
      node('feBlend', { ...sub, in: `c${k}r`, in2: `c${k}g`, mode: 'screen', result: `rg${k}` }, f);
      node('feBlend', { ...sub, in: `rg${k}`, in2: `c${k}b`, mode: 'screen', result: `s${k}` }, f);
    } else pass(1, `s${k}`);
    done.push(`s${k}`);
  });
  const out = node('feMerge', {}, f);
  for (const r of ['SourceGraphic', ...done]) node('feMergeNode', { in: r }, out);
  document.body.append(host);
  return { id, host };
}

// ---------- The page's surfaces ----------

// Everything that can be glass; the stylesheet's --lens-on says which of them are liquid glass that wants a lens here.
const CANDIDATES = ':is([data-slot="card"], .glass, .glass-bar, .glass-round, .glass-pop, .undo-bar, [data-slot="popover-content"], [data-slot="select-content"], [data-slot="dialog-content"], [data-slot="sheet-content"])';

type Filter = { id: string; host: SVGElement; users: number };
type Surface = { key?: string; want?: string; visible: boolean; prop: string };
const filters = new Map<string, Filter>();
const surfaces = new Map<HTMLElement, Surface>();
let rejected = new WeakSet<Element>();   // candidates the stylesheet said no to, until the page's classes change
let on = false, scanning = 0, resizeQueue = new Set<HTMLElement>(), resizeFrame = 0;
let resize: ResizeObserver, seen: IntersectionObserver, dom: MutationObserver;

function release(key?: string) {
  const f = key ? filters.get(key) : undefined;
  if (!f || --f.users > 0) return;
  filters.delete(key!);
  // let whatever replaces it draw first
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!filters.has(key!)) f.host.remove(); }));
}

function unset(el: HTMLElement, s: Surface) {
  s.want = undefined;
  if (s.key) { el.style.removeProperty(s.prop); release(s.key); s.key = undefined; }
}

// While the page scrolls the lens is off: a bent rim is redrawn on every frame the wallpaper moves behind it, and that halved
// the frame rate of a long page. It's back when the page comes to rest (scrollend); the filters stay built, so that's one style change.
let moving = 0;
function moved() {
  if (!moving) for (const [el, s] of surfaces) if (s.key) el.style.removeProperty(s.prop);
  clearTimeout(moving);
  moving = window.setTimeout(rest, 400);   // in case scrollend never comes
}
function settled() { if (moving) { clearTimeout(moving); moving = window.setTimeout(rest, 80); } }
function rest() {
  moving = 0;
  for (const [el, s] of surfaces) { const f = s.key && filters.get(s.key); if (f) el.style.setProperty(s.prop, `url(#${f.id})`); }
}

/** Fits a surface's lens to its size and corner, or takes it off when it's off screen or too small. */
async function fit(el: HTMLElement) {
  const s = surfaces.get(el);
  if (!s) return;
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!on || !s.visible || w < MIN_PX || h < MIN_PX) { unset(el, s); return; }
  const cs = getComputedStyle(el);
  const radius = Math.round(Math.min(Number.parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2));
  const corner = cornerExponent(cs.getPropertyValue('corner-top-left-shape'));
  const bezel = Math.round(Math.max(4, Math.min(RIM, Math.min(w, h) / 3.5)));
  const key = `${radius}:${bezel}:${corner.toFixed(3)}:${w}x${h}`;
  if (s.key === key || s.want === key) return;
  s.want = key;
  let f = filters.get(key);
  if (!f) {
    const tiles = await tilesFor(radius, bezel, corner);
    if (s.want !== key || !surfaces.has(el)) return;
    f = filters.get(key) ?? (() => { const made = { ...buildFilter(w, h, tiles, bezel, DISPERSION > 0), users: 0 }; filters.set(key, made); return made; })();
  }
  f.users++;
  const was = s.key;
  s.key = key; s.want = undefined;
  if (!moving) el.style.setProperty(s.prop, `url(#${f.id})`);
  release(was);
}

function attach(el: HTMLElement) {
  if (surfaces.has(el)) return;
  surfaces.set(el, { visible: false, prop: el.classList.contains('glass-bar') ? '--bar-lens' : '--glass-lens' });
  resize.observe(el); seen.observe(el);
}
function detach(el: HTMLElement) {
  const s = surfaces.get(el);
  if (!s) return;
  unset(el, s); surfaces.delete(el); resize.unobserve(el); seen.unobserve(el);
}

/** Finds surfaces that came and went. Reads one computed value per new candidate, nothing for ones it already knows. */
function scan() {
  scanning = 0;
  for (const el of surfaces.keys()) if (!el.isConnected) detach(el);
  if (!on) return;
  for (const el of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (surfaces.has(el) || rejected.has(el)) continue;
    if (getComputedStyle(el).getPropertyValue('--lens-on').trim() === '1') attach(el); else rejected.add(el);
  }
}
const rescan = () => { if (!scanning) scanning = requestAnimationFrame(scan); };

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : ({ matches: false } as MediaQueryList);
const quiet = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)') : ({ matches: false } as MediaQueryList);

/** Liquid glass over a wallpaper, with blur, and transparency wanted, on a computer: the only place a lens draws. A phone's
 *  GPU pays for every bent rim on every frame of a scroll, so it keeps the glass without one. */
function wanted() {
  const c = document.documentElement.classList;
  return c.contains('glass-liquid') && c.contains('has-wallpaper') && !c.contains('no-blur') && !c.contains('no-lens') && !quiet.matches && !coarse.matches;
}

function update() {
  const now = wanted();
  rejected = new WeakSet();
  if (now === on) { if (on) rescan(); return; }
  on = now;
  if (on) { dom.observe(document.body, { childList: true, subtree: true }); rescan(); }
  else { dom.disconnect(); for (const el of [...surfaces.keys()]) detach(el); }
}

let started = false;
/** Watches the page for liquid-glass surfaces and gives each on screen a rim lens. Does nothing outside Chromium. */
export function startLens() {
  if (started || !lensSupported()) return;
  started = true;
  document.documentElement.classList.add('lens-glass');   // the stylesheet's cue for corners that match the lens's map
  resize = new ResizeObserver(entries => {
    for (const e of entries) resizeQueue.add(e.target as HTMLElement);
    if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; const q = resizeQueue; resizeQueue = new Set(); for (const el of q) void fit(el); });
  });
  // a screen's height of margin, so a card scrolling in has its lens before it shows
  seen = new IntersectionObserver(entries => {
    for (const e of entries) { const s = surfaces.get(e.target as HTMLElement); if (s) { s.visible = e.isIntersecting; void fit(e.target as HTMLElement); } }
  }, { rootMargin: '50% 0px' });
  dom = new MutationObserver(records => { if (records.some(r => r.addedNodes.length || r.removedNodes.length)) rescan(); });
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  quiet.addEventListener?.('change', update);
  coarse.addEventListener?.('change', update);
  addEventListener('scroll', moved, { passive: true });
  addEventListener('scrollend', settled);
  update();
}
