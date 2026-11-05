// The home as a 3D floor plan, drawn from the robot vacuum's room map: each room a floor with low glass walls, lit
// by its real lights (colour and brightness), furniture where the map has it, and the robot and dock where they are.
import './home.css';
import { createStage, type Scene, type StageOptions } from './stage.ts';

export interface PlanLight { id: string; name: string; on: boolean; available: boolean; color?: string; level: number; kelvin?: number; canColor: boolean; canTemp: boolean; dims: boolean;
  at?: { x: number; z: number };                           // where it is; without one, lights spread evenly across the room
  kind?: 'ceiling' | 'pendant' | 'lamp' | 'strip' }
export interface PlanRoom { id: number; name: string; floor: 'wood' | 'tile'; x: number; z: number; w: number; d: number; lights: PlanLight[] }
export interface PlanRobot { x?: number; z?: number; a?: number; id: string; state: string; status?: string; error?: string; battery?: number;
  fanSpeed?: string; fanSpeeds: string[]; cleaningMode?: string; cleanedArea?: number; cleaningTime?: number; wear: [string, number][];
  sent?: boolean }                                         // a command is on its way: the page's, not the robot's
export interface PlanData {
  view?: { turn: number; tilt: number };
  rooms: PlanRoom[];
  furniture: { type: string; room: number; angle: number; x: number; z: number; w: number; d: number }[];
  dock?: { x: number; z: number; a: number };
  robot?: PlanRobot;
  cleaning?: Record<number, 'queued' | 'running'>;         // rooms sent from this page, until the robot's done
}
export type LightChange = { on: boolean; brightness?: number; rgb?: number[]; kelvin?: number };

const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** Close enough to be the same colour: lights report back what they could actually do. */
export const near = (a?: string, b?: string) => !!a && !!b && rgbOf(a).reduce((n, v, i) => n + Math.abs(v - rgbOf(b)[i]), 0) < 40;
/** What it takes to put a light back as it was. */
export const restoreOf = (l: PlanLight): LightChange => !l.on ? { on: false } : { on: true, ...(l.dims ? { brightness: Math.max(1, l.level) } : {}),
  ...(l.kelvin && l.canTemp ? { kelvin: l.kelvin } : l.color && l.canColor ? { rgb: rgbOf(l.color) } : {}) };
/** Lights that go back the same way go back in one call. */
export function restoreGroups(lights: PlanLight[]) {
  const groups = new Map<string, { lights: PlanLight[]; change: LightChange }>();
  for (const l of lights) { const change = restoreOf(l), k = JSON.stringify(change); groups.set(k, { change, lights: [...(groups.get(k)?.lights ?? []), l] }); }
  return [...groups.values()];
}
/** The changes the lights haven't caught up with yet; a light that now agrees has nothing left to wait for. */
export function unsettled(draft: Record<string, Partial<PlanLight>>, rooms: PlanRoom[]) {
  const lights = new Map(rooms.flatMap(r => r.lights).map(l => [l.id, l]));
  const differs = (l: PlanLight, k: string, v: unknown) => k === 'color' ? !near(l.color, v as string) : k === 'level' ? Math.abs(l.level - (v as number)) > 2 : k === 'kelvin' ? Math.abs((l.kelvin ?? 0) - (v as number)) > 150 : l[k as keyof PlanLight] !== v;
  return Object.fromEntries(Object.entries(draft).filter(([id, p]) => { const l = lights.get(id); return l && Object.entries(p).some(([k, v]) => differs(l, k, v)); }));
}
const WANT: Record<string, RegExp> = { start: /clean|mop/i, clean_rooms: /clean|mop/i, dock: /return|dock|charg/i, pause: /paus/i };
/** Has the robot said it did what it was asked? */
export const heard = (sent: { command: string; fan?: string }, r: PlanRobot) => sent.command === 'fan_speed' ? r.fanSpeed === sent.fan : !!WANT[sent.command]?.test(`${r.state} ${r.status ?? ''}`);
/** What a percentage on the robot means, in the fewest words. Parts count down the life they've left. */
export const wearNote = (n: number) => n < 10 ? 'Replace now' : n < 25 ? 'Replace soon' : 'Due at 10%';
export const batteryNote = (n: number, r: PlanRobot) => /charg|dock/i.test(`${r.state} ${r.status ?? ''}`) ? n >= 100 ? 'Full' : 'Charging' : n < 20 ? 'Low, dock soon' : 'On battery';

const WALL = 22;   // wall height in plan units
const mk = (cls: string, html?: string) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; return e; };
function face(e: HTMLElement, w: number, h: number, tf: string) { e.classList.add('f'); Object.assign(e.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px', transform: tf }); return e; }
/** a horizontal face (floor, tabletop) at height y; plan x/z are its top-left corner */
const flat = (e: HTMLElement, x: number, z: number, w: number, d: number, y = 0) => face(e, w, d, `translate3d(${x + w / 2}px, ${-y}px, ${z + d / 2}px) rotateX(90deg)`);
/** an upright face along x (facing the viewer), from height y0 up h */
const upX = (e: HTMLElement, x: number, z: number, w: number, h: number, y0 = 0) => face(e, w, h, `translate3d(${x + w / 2}px, ${-(y0 + h / 2)}px, ${z}px)`);
/** an upright face along z */
const upZ = (e: HTMLElement, x: number, z: number, d: number, h: number, y0 = 0) => face(e, d, h, `translate3d(${x}px, ${-(y0 + h / 2)}px, ${z + d / 2}px) rotateY(90deg)`);
/** a box: top and the four sides, each side marked with the way it faces (see `turned`) */
function box(add: (e: HTMLElement) => HTMLElement, x: number, z: number, w: number, d: number, h: number, cls: string, of?: string, y0 = 0) {
  const faces = [flat(mk(`${cls} top`), x, z, w, d, y0 + h), upX(mk(`${cls} side`), x, z, w, h, y0), upX(mk(`${cls} side`), x, z + d, w, h, y0),
    upZ(mk(`${cls} side end`), x, z, d, h, y0), upZ(mk(`${cls} side end`), x + w, z, d, h, y0)];
  faces.slice(1).forEach((f, i) => f.dataset.n = SIDES[i]);
  for (const f of faces) { if (of) f.dataset.of = of; add(f); }
  return faces[0];
}
const SIDES = ['zn', 'zp', 'xn', 'xp'] as const, NORMAL = { zn: [0, -1], zp: [0, 1], xn: [-1, 0], xp: [1, 0] };
/** Every face is a layer the phone has to hold and draw, and a solid box's far sides are always behind its near ones, so
 *  sides that face away from the camera aren't drawn. Only clearly turned away: perspective shows a little round the edge.
 *  A post keeps whichever of its two faces is turned more towards the camera. */
export function turned(world: HTMLElement, _tilt: number, turn: number) {
  const a = turn * Math.PI / 180;
  for (const n of SIDES) { const [nx, nz] = NORMAL[n]; world.classList.toggle(`away-${n}`, -nx * Math.sin(a) + nz * Math.cos(a) < -.3); }
  const along = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a)), any = !isNaN(a);
  world.classList.toggle('away-px', any && along); world.classList.toggle('away-pz', any && !along);
}

/** A thin upright: two crossed faces, so legs, poles and cords read as round from any angle. Only the one that faces
 *  the camera more is drawn (`turned`); edge-on, the other would be a hairline anyway. */
function post(add: (e: HTMLElement) => HTMLElement, x: number, z: number, h: number, cls: string, of: string, y0 = 0, t = 2) {
  const faces = [upX(mk(cls), x - t / 2, z, t, h, y0), upZ(mk(cls), x, z - t / 2, t, h, y0)];
  faces[0].dataset.n = 'pz'; faces[1].dataset.n = 'px';
  for (const f of faces) { f.dataset.of = of; add(f); }
}
type Put = (u: number, v: number, w: number, d: number, h: number, mat: string, y0?: number) => void;
type Leg = (u: number, v: number, h: number, mat?: string, y0?: number) => void;

// How each piece is made, in its own space: U across, V front to back, with its back along V = 0. Everything that
// faces a room (a sofa's seat, a bed's foot) faces +V, so `angle` turns the piece as a whole.
const legs = (U: number, V: number, h: number, leg: Leg, mat = 'metal') => { for (const [u, v] of [[2, 2], [U - 2, 2], [2, V - 2], [U - 2, V - 2]]) leg(u, v, h, mat); };
const PIECES: [RegExp, (U: number, V: number, put: Put, leg: Leg) => void][] = [
  [/bedside|night/i, (U, V, put) => { put(0, 0, U, V, 9, 'walnut'); put(1, V - 1, U - 2, .5, 3, 'wood', 4); }],
  [/bed/i, (U, V, put) => {
    const inset = 2, head = 5;
    put(0, 0, U, 3, 17, 'walnut'); put(0, 3, U, V - 3, 4, 'walnut');
    put(inset, 3, U - inset * 2, V - 4, 4, 'linen', 4);
    put(inset, 3 + V * .28, U - inset * 2, V * .72 - 4, 1.5, 'duvet', 8);
    const pw = (U - inset * 2 - 4) / 2;
    put(inset + 1, head, pw, V * .17, 2, 'pillow', 8); put(inset + 3 + pw, head, pw, V * .17, 2, 'pillow', 8);
  }],
  [/sofa|couch/i, (U, V, put) => {
    const arm = Math.min(9, U * .1), back = V * .26;
    put(0, 0, U, V, 4, 'fabric'); put(0, 0, U, back, 15, 'fabric', 4); put(0, 0, arm, V, 8, 'fabric', 4); put(U - arm, 0, arm, V, 8, 'fabric', 4);
    const n = U > 90 ? 3 : U > 50 ? 2 : 1, cw = (U - arm * 2) / n;
    for (let i = 0; i < n; i++) { put(arm + i * cw + .5, back, cw - 1, V - back - 1, 4, 'cushion', 4); put(arm + i * cw + 2, back - 1, cw - 4, 5, 8, 'cushion', 8); }
  }],
  [/desk/i, (U, V, put, leg) => {
    put(0, 0, U, V, 2, 'wood', 15); legs(U, V, 15, leg);
    put(U / 2 - 15, 3, 30, 1.5, 15, 'screen', 21); put(U / 2 - 2, 4, 4, 3, 4, 'black', 17); put(U / 2 - 12, V * .55, 24, 7, .6, 'black', 17);
  }],
  [/tv/i, (U, V, put) => { put(0, 0, U, V, 9, 'walnut'); put(U * .1, V / 2 - .75, U * .8, 1.5, 26, 'screen', 11); put(U / 2 - 6, V / 2 - 3, 12, 6, 2, 'black', 9); }],
  [/rug|carpet/i, (U, V, put) => put(0, 0, U, V, .4, 'rug')],
  [/plant/i, (U, V, put, leg) => { const m = Math.min(U, V); put(U / 2 - m * .3, V / 2 - m * .3, m * .6, m * .6, 10, 'clay'); leg(U / 2, V / 2, 10, 'leaf', 10);
    for (const [y, k] of [[17, 1], [23, .75], [29, .45]]) put(U / 2 - m * k / 2, V / 2 - m * k / 2, m * k, m * k, 5, 'leaf', y); }],
  [/stool/i, (U, V, put, leg) => { put(0, 0, U, V, 2, 'fabric', 15); leg(U / 2, V / 2, 15); }],
  [/chair/i, (U, V, put, leg) => { put(0, 0, U, V, 2.5, 'fabric', 10); put(0, 0, U, 2.5, 13, 'fabric', 12); legs(U, V, 10, leg, 'walnut'); }],
  [/toilet/i, (U, V, put) => { put(1, 0, U - 2, V * .3, 15, 'porcelain'); put(2, V * .3, U - 4, V * .7, 8, 'porcelain'); }],
  [/sink|basin/i, (U, V, put) => { put(0, 0, U, V, 13, 'white'); put(U * .2, V * .2, U * .6, V * .6, .6, 'metal', 13); }],
  [/bath|tub|shower/i, (U, V, put) => { put(0, 0, U, V, 9, 'porcelain'); put(4, 4, U - 8, V - 8, .5, 'water', 9); }],
  [/fridge/i, (U, V, put) => { put(0, 0, U, V, 34, 'metal'); put(0, V - 1, U, 1, 1, 'black', 21); }],
  [/wardrobe|closet/i, (U, V, put) => { put(0, 0, U, V, 32, 'wood'); put(U / 2 - .4, V - .5, .8, .8, 30, 'black', 1); }],
  [/shelf|bookcase/i, (U, V, put) => { put(0, 0, U, V, 24, 'walnut'); [.08, .3, .55, .72].forEach((k, i) => put(U * k, V - 1, U * .14, 1.2, 8 + i * 2, i % 2 ? 'cushion' : 'clay', 4 + i * 5)); }],
  [/washer|dryer/i, (U, V, put) => { put(0, 0, U, V, 16, 'white'); put(U * .25, V - .5, U * .5, 1, 9, 'black', 3); }],
  [/island|counter/i, (U, V, put) => { put(0, 0, U, V, 14, 'walnut'); put(-1, -1, U + 2, V + 2, 2, 'white', 14); }],
  [/dining|table/i, (U, V, put, leg) => { put(0, 0, U, V, 2, 'wood', 13); legs(U, V, 13, leg, 'walnut'); }],
];

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
    // where each light is: where the data says, or spread evenly across the room
    const lights = r.lights.map((l, i) => {
      const n = r.lights.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      return { l, x: l.at?.x ?? r.x + r.w * ((i % cols) + .5) / cols, z: l.at?.z ?? r.z + r.d * (Math.floor(i / cols) + .5) / rows, kind: l.kind ?? 'ceiling' };
    });
    // the floor carries the room's light, a pool under each lamp, and its name
    const spots = lights.map(({ l, x, z }) => `<i class="spot light" data-light="${l.id.replace(/"/g, '')}" style="left:${(x - r.x) / r.w * 100}%;top:${(z - r.z) / r.d * 100}%"></i>`).join('');
    const fl = add(flat(mk(`floor ${r.floor}`, `<i class="pool light"></i>${spots}<span class="label"><b>${r.name.replace(/</g, '')}</b><em></em></span>`), r.x, r.z, r.w, r.d, rank.get(r.id)));
    fl.dataset.of = of; fl.dataset.room = String(r.id);
    // low glass walls round the room
    for (const w of [upX(mk('wallp'), r.x, r.z, r.w, WALL), upX(mk('wallp'), r.x, r.z + r.d, r.w, WALL), upZ(mk('wallp'), r.x, r.z, r.d, WALL), upZ(mk('wallp'), r.x + r.w, r.z, r.d, WALL)]) {
      w.dataset.of = of; add(w);
    }
    for (const { l, x, z, kind } of lights) {
      if (kind === 'strip') continue;                      // a strip is only the glow on the floor and the wall behind it
      const y = kind === 'lamp' ? 26 : kind === 'pendant' ? 30 : WALL + 12, tag = (e: HTMLElement) => { e.dataset.of = of; e.dataset.light = l.id; return add(e); };
      // a cone of light from the bulb to the floor, two crossed sheets of it
      tag(upX(mk('beam light'), x - 34, z, 68, y)); tag(upZ(mk('beam light'), x, z - 34, 68, y));
      if (kind === 'lamp') { post(add, x, z, y - 4, 'pole', of); box(add, x - 6, z - 6, 12, 12, 8, 'furn shade', of, y - 2); }
      if (kind === 'pendant') { post(add, x, z, 26, 'cord', of, y + 3, .8); box(add, x - 5, z - 5, 10, 10, 3, 'furn brass', of, y + 1); }
      tag(flat(mk('orb', '<i class="core light"></i><i class="halo light"></i>'), x - 7, z - 7, 14, 14, y));
    }
  }
  for (const f of d.furniture) {
    // the piece in its own space, turned about its centre by the map's angle (quarter turns)
    const q = ((Math.round(f.angle / 90) % 4) + 4) % 4, U = f.w, V = f.d, cx = f.x + U / 2, cz = f.z + V / 2, of = `room:${f.room}`;
    const spin = (u: number, v: number) => { const a = u - U / 2, b = v - V / 2; return [[a, b], [-b, a], [-a, -b], [b, -a]][q]; };
    const put: Put = (u, v, w, dd, h, mat, y0 = 0) => {
      const [a, b] = spin(u, v), [c, e] = spin(u + w, v + dd);
      const x = cx + Math.min(a, c), z = cz + Math.min(b, e), W = Math.abs(c - a), D = Math.abs(e - b);
      if (h > 1) return box(add, x, z, W, D, h, `furn ${mat}`, of, y0);
      const top = add(flat(mk(`furn ${mat} top`), x, z, W, D, y0 + h)); top.dataset.of = of;   // a rug needs no sides
    };
    const leg: Leg = (u, v, h, mat = 'metal', y0 = 0) => { const [a, b] = spin(u, v); post(add, cx + a, cz + b, h, `furn ${mat}`, of, y0); };
    (PIECES.find(([re]) => re.test(f.type))?.[1] ?? ((W, D, p) => p(0, 0, W, D, 12, 'walnut')))(U, V, put, leg);
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
    const clean = d.cleaning?.[r.id];
    fl.dataset.clean = clean ?? '';
    fl.querySelector('em')!.textContent = clean ? (clean === 'queued' ? 'Clean queued' : 'Cleaning') : !r.lights.length ? '' : on.length ? `${on.length} of ${r.lights.length} on` : 'Off';
    fl.classList.toggle('lit', on.length > 0);
    for (const l of r.lights) for (const e of world.querySelectorAll<HTMLElement>(`[data-light="${l.id}"]`)) {
      e.style.setProperty('--lc', l.color ?? '#ffd8a8');
      e.style.setProperty('--lo', l.on ? String(Math.max(.3, l.level / 100)) : '0');
      e.classList.toggle('off', !l.on); e.classList.toggle('gone', !l.available);
    }
    // what's in the room picks up its light. Set only on a change: a room can hold a lot of faces.
    const lit = `${color} ${fl.style.getPropertyValue('--lo')}`;
    if (fl.dataset.lit !== lit) {
      fl.dataset.lit = lit;
      for (const e of world.querySelectorAll<HTMLElement>(`.furn[data-of="room:${r.id}"], .wallp[data-of="room:${r.id}"]`)) { e.style.setProperty('--lc', color); e.style.setProperty('--lo', fl.style.getPropertyValue('--lo')); }
    }
  }
  const bot = world.querySelector<HTMLElement>('.bot'), r = d.robot;
  if (bot && r?.x != null) {
    bot.style.transform = `translate3d(${r.x}px, -2px, ${r.z}px) rotateX(90deg) rotateZ(${-(r.a ?? 0)}deg)`;
    const busy = /clean|return|mop/i.test(r.state);
    bot.dataset.state = r.error ? 'error' : r.sent ? 'sent' : busy ? 'busy' : r.state === 'docked' ? 'docked' : 'idle';
  }
  const led = world.querySelector<HTMLElement>('.dockled');
  if (led && r) led.dataset.state = r.state === 'docked' ? 'docked' : 'away';
}

export const homeScene: Scene<PlanData> = {
  scope: 'homex', size: [720, 430], center: [0, 0, 0],
  frame: '.slab',
  shape: d => JSON.stringify([d.rooms.map(r => [r.id, Math.round(r.x), Math.round(r.z), r.lights.map(l => [l.id, l.kind, l.at?.x])]), d.furniture.length, !!d.dock, !!d.robot]),
  build, paint, turned,
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
