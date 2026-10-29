// The home as a 3D floor plan, drawn from the robot vacuum's room map: each room a floor with low glass walls, lit
// by its real lights (colour and brightness), furniture where the map has it, and the robot and dock where they are.
import './home.css';
import { createStage, type Scene, type StageOptions } from './stage.ts';

export interface PlanLight { id: string; name: string; on: boolean; available: boolean; color?: string; level: number; kelvin?: number; canColor: boolean; canTemp: boolean; dims: boolean }
export interface PlanRoom { id: number; name: string; floor: 'wood' | 'tile'; x: number; z: number; w: number; d: number; lights: PlanLight[] }
export interface PlanRobot { x?: number; z?: number; a?: number; id: string; state: string; status?: string; error?: string; battery?: number;
  fanSpeed?: string; fanSpeeds: string[]; cleaningMode?: string; cleanedArea?: number; cleaningTime?: number; wear: [string, number][] }
export interface PlanData {
  view?: { turn: number; tilt: number };
  rooms: PlanRoom[];
  furniture: { type: string; room: number; angle: number; x: number; z: number; w: number; d: number }[];
  dock?: { x: number; z: number; a: number };
  robot?: PlanRobot;
}

const WALL = 22;   // wall height in plan units
const mk = (cls: string, html?: string) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; return e; };
function face(e: HTMLElement, w: number, h: number, tf: string) { e.classList.add('f'); Object.assign(e.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px', transform: tf }); return e; }
/** a horizontal face (floor, tabletop) at height y; plan x/z are its top-left corner */
const flat = (e: HTMLElement, x: number, z: number, w: number, d: number, y = 0) => face(e, w, d, `translate3d(${x + w / 2}px, ${-y}px, ${z + d / 2}px) rotateX(90deg)`);
/** an upright face along x (facing the viewer), from height y0 up h */
const upX = (e: HTMLElement, x: number, z: number, w: number, h: number, y0 = 0) => face(e, w, h, `translate3d(${x + w / 2}px, ${-(y0 + h / 2)}px, ${z}px)`);
/** an upright face along z */
const upZ = (e: HTMLElement, x: number, z: number, d: number, h: number, y0 = 0) => face(e, d, h, `translate3d(${x}px, ${-(y0 + h / 2)}px, ${z + d / 2}px) rotateY(90deg)`);
/** a box: top and the four sides */
function box(add: (e: HTMLElement) => HTMLElement, x: number, z: number, w: number, d: number, h: number, cls: string, of?: string, y0 = 0) {
  const faces = [flat(mk(`${cls} top`), x, z, w, d, y0 + h), upX(mk(`${cls} side`), x, z, w, h, y0), upX(mk(`${cls} side`), x, z + d, w, h, y0),
    upZ(mk(`${cls} side end`), x, z, d, h, y0), upZ(mk(`${cls} side end`), x + w, z, d, h, y0)];
  for (const f of faces) { if (of) f.dataset.of = of; add(f); }
  return faces[0];
}

// what furniture looks like: height and material, by the map's type names
const FURNITURE: [RegExp, number, string][] = [[/bed/i, 9, 'bed'], [/sofa|couch/i, 11, 'sofa'], [/table|desk/i, 15, 'table'], [/toilet/i, 8, 'porcelain'],
  [/cabinet|wardrobe|shelf|fridge/i, 24, 'cabinet'], [/chair/i, 10, 'sofa'], [/tv/i, 18, 'cabinet']];

export function build(world: HTMLElement, d: PlanData) {
  world.innerHTML = '';
  const cam = mk('cam'); world.appendChild(cam);
  const add = (e: HTMLElement) => (cam.appendChild(e), e);
  // a base slab under the whole plan
  const xs = d.rooms.flatMap(r => [r.x, r.x + r.w]), zs = d.rooms.flatMap(r => [r.z, r.z + r.d]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 14, Math.max(...xs) + 14, Math.min(...zs) - 14, Math.max(...zs) + 14];
  add(flat(mk('slab'), x0, z0, x1 - x0, z1 - z0, -1));
  add(upX(mk('slab-edge'), x0, z1, x1 - x0, 10, -11));
  add(upZ(mk('slab-edge'), x1, z0, z1 - z0, 10, -11));

  // the map's room outlines are bounding boxes and overlap (an L-shaped bedroom's box covers its en-suite), so
  // smaller rooms sit a hair above bigger ones
  const rank = new Map([...d.rooms].sort((a, b) => b.w * b.d - a.w * a.d).map((r, i) => [r.id, i * .6]));
  for (const r of d.rooms) {
    const of = `room:${r.id}`;
    // the floor carries the room's light pool and its name
    const fl = add(flat(mk(`floor ${r.floor}`, `<i class="pool light"></i><span class="label"><b>${r.name.replace(/</g, '')}</b><em></em></span>`), r.x, r.z, r.w, r.d, rank.get(r.id)));
    fl.dataset.of = of; fl.dataset.room = String(r.id);
    // low glass walls round the room
    for (const w of [upX(mk('wallp'), r.x, r.z, r.w, WALL), upX(mk('wallp'), r.x, r.z + r.d, r.w, WALL), upZ(mk('wallp'), r.x, r.z, r.d, WALL), upZ(mk('wallp'), r.x + r.w, r.z, r.d, WALL)]) {
      w.dataset.of = of; add(w);
    }
    // each light: a glowing orb hanging over the room, spread across it
    r.lights.forEach((l, i) => {
      const n = r.lights.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const lx = r.x + r.w * ((i % cols) + .5) / cols, lz = r.z + r.d * (Math.floor(i / cols) + .5) / rows;
      const orb = add(flat(mk('orb', '<i class="core light"></i><i class="halo light"></i>'), lx - 7, lz - 7, 14, 14, WALL + 10));
      orb.dataset.of = of; orb.dataset.light = l.id;
    });
  }
  for (const f of d.furniture) {
    const [, h, cls] = FURNITURE.find(([re]) => re.test(f.type)) ?? [/./, 8, 'cabinet'];
    const [w, dd] = Math.round(f.angle / 90) % 2 ? [f.d, f.w] : [f.w, f.d];
    const cx = f.x + f.w / 2, cz = f.z + f.d / 2;
    box(add, cx - w / 2, cz - dd / 2, w, dd, h, `furn ${cls}`, `room:${f.room}`);
  }
  if (d.dock) {
    const k = d.dock;
    box(add, k.x - 11, k.z - 7, 22, 14, 30, 'dock', 'robot');
    add(upX(mk('dockled light'), k.x - 4, k.z + 7.2, 8, 2, 24)).dataset.of = 'robot';
  }
  if (d.robot?.x != null) {
    // the robot: a puck with a lidar turret; it moves in paint()
    const bot = mk('bot f');
    bot.dataset.of = 'robot';
    bot.innerHTML = '<i class="disc d0"></i><i class="disc d1"></i><i class="disc d2"></i><i class="turret"></i><i class="ring light"></i>';
    add(bot);
  }
}

export function paint(world: HTMLElement, d: PlanData) {
  for (const r of d.rooms) {
    const on = r.lights.filter(l => l.on);
    const fl = world.querySelector<HTMLElement>(`.floor[data-room="${r.id}"]`); if (!fl) continue;
    // the pool mixes the room's lit colours, as bright as its brightest light
    const color = on.find(l => l.color)?.color ?? '#ffd8a8';
    fl.style.setProperty('--lc', color);
    fl.style.setProperty('--lo', on.length ? String(Math.max(.25, Math.max(...on.map(l => l.level)) / 100)) : '0');
    fl.querySelector('em')!.textContent = !r.lights.length ? '' : on.length ? `${on.length} of ${r.lights.length} on` : 'Off';
    fl.classList.toggle('lit', on.length > 0);
    for (const l of r.lights) {
      const orb = world.querySelector<HTMLElement>(`.orb[data-light="${l.id}"]`); if (!orb) continue;
      orb.style.setProperty('--lc', l.color ?? '#ffd8a8');
      orb.style.setProperty('--lo', l.on ? String(Math.max(.3, l.level / 100)) : '0');
      orb.classList.toggle('off', !l.on); orb.classList.toggle('gone', !l.available);
    }
  }
  const bot = world.querySelector<HTMLElement>('.bot'), r = d.robot;
  if (bot && r?.x != null) {
    bot.style.transform = `translate3d(${r.x}px, -2px, ${r.z}px) rotateX(90deg) rotateZ(${-(r.a ?? 0)}deg)`;
    const busy = /clean|return|mop/i.test(r.state);
    bot.dataset.state = r.error ? 'error' : busy ? 'busy' : r.state === 'docked' ? 'docked' : 'idle';
  }
  const led = world.querySelector<HTMLElement>('.dockled');
  if (led && r) led.dataset.state = r.state === 'docked' ? 'docked' : 'away';
}

export const homeScene: Scene<PlanData> = {
  scope: 'homex', size: [720, 430], center: [0, 0, 0],
  frame: '.slab',
  shape: d => JSON.stringify([d.rooms.map(r => [r.id, Math.round(r.x), Math.round(r.z), r.lights.map(l => l.id)]), d.furniture.length, !!d.dock, !!d.robot]),
  build, paint,
  pickOf: id => id === 'robot' || id.startsWith('room:') ? id : null,
  facesOf: pick => [pick],
  focus: (pick, d) => {
    if (pick === 'robot') { const r = d.robot; return r?.x != null ? [r.x, 0, r.z!, 2.4] : undefined; }
    const r = d.rooms.find(r => `room:${r.id}` === pick); if (!r) return undefined;
    return [r.x + r.w / 2, 0, r.z + r.d / 2, Math.max(1.15, Math.min(2.6, 300 / Math.max(r.w, r.d)))];
  },
  limits: { tilt: [-80, -18], turn: [-180, 180] },   // negative tilt looks down onto the plan
};

export const createHome = (box: HTMLElement, opts: StageOptions = {}) => createStage(box, homeScene, opts);
