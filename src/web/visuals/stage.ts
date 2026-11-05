// The stage every 3D model runs on (CSS 3D, no WebGL). A scene says how to build and paint itself and what can be
// picked; the stage fits it to its box, frames it, orbits on drag, highlights on hover, flies to a picked part and
// dims the rest. Frameworks only call update() with fresh data and select() with a pick id (or null).
import './stage.css';

export type Focus = [x: number, y: number, z: number, zoom: number];
export interface Scene<D> {
  scope: string;                                   // class for the scene's own styles, e.g. 'pcx'
  size: [w: number, h: number];                    // the world's box, scaled to fit the container
  center: [x: number, y: number, z: number];       // the scene point that sits at the camera's origin
  frame: string;                                   // selector for the faces that outline the scene (for framing)
  shape(d: D): string;                             // rebuild only when this changes
  build(world: HTMLElement, d: D): void;           // creates world > .cam > faces
  paint(world: HTMLElement, d: D): void;           // repaints lights and live values in place
  pickOf(id: string): string | null;               // a face's data-part / data-of / data-tint → a pick id
  facesOf(pick: string, d: D): string[];           // the data ids whose faces belong to a pick
  focus(pick: string, d: D): Focus | undefined;    // where the camera flies for a pick
  limits?: { tilt: [number, number]; turn: [number, number] };
  turned?(world: HTMLElement, tilt: number, turn: number): void;   // the camera turned: hide what now faces away (NaN: show it all)
}
export interface StageOptions { turn?: number; tilt?: number; draggable?: boolean; remember?: string; onPick?: (id: string | null) => void; onMove?: (moved: boolean) => void }
/** Someone asked for less motion, in the system or in Valet's own settings: the camera then cuts instead of flying. */
export const stillness = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches || /motion-(reduced|none)/.test(document.documentElement.className);

export function createStage<D>(box: HTMLElement, scene: Scene<D>, opts: StageOptions = {}) {
  const { turn = 0, tilt = 0, draggable = true, remember, onPick, onMove } = opts;
  // a view you dragged to sticks (this browser only); otherwise the configured angles
  const saved = (() => { try { return remember ? JSON.parse(localStorage.getItem(`valet-view:${remember}`) ?? 'null') : null; } catch { return null; } })();
  const [W, H] = scene.size, [cx, cy, cz] = scene.center;
  const lim = scene.limits ?? { tilt: [-18, 24], turn: [-55, 55] };
  box.classList.add('stage', scene.scope);
  const world = document.createElement('div'); world.className = 'world boot';
  Object.assign(world.style, { width: W + 'px', height: H + 'px' });
  box.appendChild(world);
  let data: D | null = null, shape = '', last = '', sel: string | null = null, dragged = false, boot: ReturnType<typeof setTimeout> | undefined, settled: ReturnType<typeof setTimeout> | undefined;
  const home: Focus = [cx, cy, cz, 1];
  // fans and lights loop forever: off screen they rest
  const away = new IntersectionObserver(([e]) => box.classList.toggle('is-away', !e.isIntersecting));
  away.observe(box);
  const cam = { ry: saved?.ry ?? turn, rx: saved?.rx ?? tilt, at: home as number[] };
  const moved = () => Math.abs(cam.ry - turn) > .5 || Math.abs(cam.rx - tilt) > .5;
  onMove?.(moved());

  const pose = (ox: number, oy: number, fit: number) => {
    const [x, y, z, k] = cam.at;
    return `translate(${ox}px, ${oy}px) scale(${fit * k}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) translate3d(${cx - x}px, ${cy - y}px, ${cz - z}px)`;
  };
  // The overview is framed: whatever the angle, the scene is centred and fills ~95% of the box. Perspective moves it
  // around as it turns, so this is measured rather than computed. A focused part just flies to the centre.
  const frame = (c: HTMLElement) => {
    if (sel) return pose(0, 0, .9);
    const before = c.style.transform, trans = c.style.transition;
    c.style.transition = 'none'; c.style.transform = pose(0, 0, 1);
    const k = box.clientWidth / W, b = box.getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, btm = -Infinity;
    world.querySelectorAll<HTMLElement>(scene.frame).forEach(f => {
      const q = f.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); btm = Math.max(btm, q.bottom);
    });
    c.style.transform = before; void c.offsetWidth; c.style.transition = trans;
    if (!isFinite(l) || !b.width) return pose(0, 0, .9);
    const fit = Math.min(.95 * b.width / (r - l), .95 * b.height / (btm - t));
    const dx = (b.left + b.width / 2 - (l + r) / 2) / k, dy = (b.top + b.height / 2 - (t + btm) / 2) / k;
    return pose(dx * fit, dy * fit, fit);
  };
  const aim = (animate = true) => {
    const c = world.querySelector<HTMLElement>('.cam'); if (!c) return;
    scene.turned?.(world, cam.rx, cam.ry);
    const target = frame(c);
    c.style.transition = animate && !stillness() ? 'transform .9s cubic-bezier(.2, .8, .2, 1)' : 'none';
    c.style.transform = target;
  };
  const fit = () => { const k = box.clientWidth / W; world.style.transform = `scale(${k})`; box.style.height = H * k + 'px'; aim(false); };
  const ro = new ResizeObserver(fit); ro.observe(box); fit();

  const facesFor = (pick: string | null) => {
    const ids = !pick || !data ? [] : scene.facesOf(pick, data);
    return [...world.querySelectorAll<HTMLElement>('.f')].filter(f => ids.some(id => f.dataset.part === id || f.dataset.of === id || f.dataset.tint === id));
  };
  const dim = () => {
    world.classList.toggle('picking', !!sel);
    const keep = new Set(facesFor(sel));
    world.querySelectorAll<HTMLElement>('.f').forEach(f => f.classList.toggle('keep', keep.has(f)));
  };

  // drag to orbit; a drag isn't a click
  let start: { x: number; y: number; rx: number; ry: number } | null = null;
  const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY, rx: cam.rx, ry: cam.ry }; dragged = false; };
  const move = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    if (!dragged) { dragged = true; box.setPointerCapture(e.pointerId); box.classList.add('dragging'); }
    cam.ry = Math.max(lim.turn[0], Math.min(lim.turn[1], start.ry + dx * .35));
    cam.rx = Math.max(lim.tilt[0], Math.min(lim.tilt[1], start.rx - dy * .25));
    scene.turned?.(world, cam.rx, cam.ry);
    const c = world.querySelector<HTMLElement>('.cam');
    if (c) { c.style.transition = 'none'; c.style.transform = c.style.transform.replace(/rotateX\([^)]*\) rotateY\([^)]*\)/, `rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)`); }
  };
  const up = () => {
    if (start && dragged) { aim(); onMove?.(moved()); try { if (remember) localStorage.setItem(`valet-view:${remember}`, JSON.stringify({ rx: cam.rx, ry: cam.ry })); } catch {} }
    start = null; box.classList.remove('dragging');
  };
  if (draggable) {
    box.classList.add('draggable');
    box.addEventListener('pointerdown', down); box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  }
  const pickAt = (target: EventTarget | null) => {
    for (let el = target as HTMLElement | null; el && el !== world; el = el.parentElement) {
      const id = el.dataset.part ?? el.dataset.of ?? el.dataset.tint;
      if (id) return scene.pickOf(id);
    }
    return null;
  };
  // hovering a part lifts it slightly
  let hovered: string | null = null;
  const hover = (e: PointerEvent) => {
    if (start && dragged) return;
    const p = pickAt(e.target);
    if (p === hovered) return;
    world.querySelectorAll('.hov').forEach(f => f.classList.remove('hov'));
    hovered = p;
    facesFor(p).forEach(f => f.classList.add('hov'));
  };
  const leave = () => { hovered = null; world.querySelectorAll('.hov').forEach(f => f.classList.remove('hov')); };
  world.addEventListener('pointermove', hover); world.addEventListener('pointerleave', leave);
  // clicking selects whatever was hit; clicking it again, or empty space, lets go
  const onClick = (e: MouseEvent) => {
    if (dragged) return;
    const hit = pickAt(e.target);
    const next = hit === sel ? null : hit;
    api.select(next); onPick?.(next);
  };
  world.addEventListener('click', onClick);

  const api = {
    update(d: D) {
      data = d;
      // a live update that changes nothing the model shows does nothing
      const all = JSON.stringify(d); if (all === last) return; last = all;
      const s = scene.shape(d);
      if (s !== shape) { shape = s; scene.build(world, d); clearTimeout(boot); boot = setTimeout(() => world.classList.remove('boot'), 150); aim(false); dim(); }
      scene.paint(world, d);
    },
    select(id: string | null) {
      sel = id;
      cam.at = (id && data && scene.focus(id, data)) || home;
      aim(); dim();
    },
    /** back to the configured angles, and forget the dragged-to view */
    reset() {
      // the camera swings back through angles in between, so nothing is hidden until it's there
      const swing = !stillness() && Math.abs(cam.ry - turn) > .5;
      cam.ry = turn; cam.rx = tilt; aim(); onMove?.(false);
      if (swing) { scene.turned?.(world, NaN, NaN); clearTimeout(settled); settled = setTimeout(() => scene.turned?.(world, cam.rx, cam.ry), 950); }
      try { if (remember) localStorage.removeItem(`valet-view:${remember}`); } catch {}
    },
    destroy() {
      clearTimeout(boot); clearTimeout(settled); ro.disconnect(); away.disconnect(); world.removeEventListener('click', onClick); world.removeEventListener('pointermove', hover); world.removeEventListener('pointerleave', leave);
      box.removeEventListener('pointerdown', down); box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
      world.remove();
    },
  };
  return api;
}
