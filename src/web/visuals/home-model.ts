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
/** A surface something can be drawn on: a box's top face and where it sits in the plan. */
type Top = { el: HTMLElement; x: number; z: number };
interface Kit {
  /** a box from the floor (or y0) up h; a thin one (a tabletop, a rug) is only its top */
  put(u: number, v: number, w: number, d: number, h: number, mat: string, y0?: number): Top;
  /** drawn flat on a top: cushions, a duvet, a basin. It paints into that face, so it costs no layer of its own */
  decal(on: Top, u: number, v: number, w: number, d: number, mat: string): void;
  /** one upright sheet from (u0, v0) to (u1, v1): a screen, a chair's back, a table's end, a row of books */
  pane(u0: number, v0: number, u1: number, v1: number, h: number, mat: string, y0?: number): void;
  leg(u: number, v: number, h: number, mat?: string, y0?: number): void;
}

// How each piece is made, in its own space: U across, V front to back, with its back along V = 0. Everything that
// faces a room (a sofa's seat, a bed's foot) faces +V, so `angle` turns the piece as a whole. Every box and sheet is a
// layer the phone holds, so a piece is a few solid shapes and the small things on it are drawn on its top.
const ends = (U: number, V: number, h: number, k: Kit, mat = 'walnut') => { k.pane(2, 2, 2, V - 2, h, mat); k.pane(U - 2, 2, U - 2, V - 2, h, mat); };
const PIECES: [RegExp, (U: number, V: number, k: Kit) => void][] = [
  [/bedside|night/i, (U, V, k) => { k.put(0, 0, U, V, 9, 'walnut'); }],
  [/bed/i, (U, V, k) => {
    const inset = 2, head = 5, pw = (U - inset * 2 - 4) / 2;
    k.put(0, 0, U, 3, 17, 'walnut');
    const m = k.put(0, 3, U, V - 3, 8, 'bedding');
    k.decal(m, inset, 3 + V * .28, U - inset * 2, V * .72 - 4, 'duvet');
    k.decal(m, inset + 1, head, pw, V * .17, 'pillow'); k.decal(m, inset + 3 + pw, head, pw, V * .17, 'pillow');
  }],
  [/sofa|couch/i, (U, V, k) => {
    const arm = Math.min(9, U * .1), back = V * .26, n = U > 90 ? 3 : U > 50 ? 2 : 1, cw = (U - arm * 2) / n;
    k.put(0, 0, U, back, 19, 'fabric'); k.put(0, back, arm, V - back, 12, 'fabric'); k.put(U - arm, back, arm, V - back, 12, 'fabric');
    const seat = k.put(arm, back, U - arm * 2, V - back, 8, 'fabric');
    for (let i = 0; i < n; i++) k.decal(seat, arm + i * cw + .5, back + .5, cw - 1, V - back - 1, 'cushion');
  }],
  [/desk/i, (U, V, k) => {
    const top = k.put(0, 0, U, V, 2, 'wood', 15); ends(U, V, 15, k, 'metal');
    k.pane(U / 2 - 15, 3.5, U / 2 + 15, 3.5, 15, 'screen', 21); k.decal(top, U / 2 - 12, V * .55, 24, 7, 'black');
  }],
  [/tv/i, (U, V, k) => { k.put(0, 0, U, V, 9, 'walnut'); k.pane(U * .1, V / 2, U * .9, V / 2, 26, 'screen', 11); }],
  [/rug|carpet/i, (U, V, k) => { k.put(0, 0, U, V, .4, 'rug'); }],
  [/plant/i, (U, V, k) => { const m = Math.min(U, V);
    k.put(U / 2 - m * .3, V / 2 - m * .3, m * .6, m * .6, 10, 'clay');
    const leaf = k.put(U / 2 - m * .45, V / 2 - m * .45, m * .9, m * .9, 14, 'leaf', 12); k.decal(leaf, U / 2 - m * .25, V / 2 - m * .25, m * .5, m * .5, 'sprout'); }],
  [/stool/i, (U, V, k) => { k.put(0, 0, U, V, 2, 'fabric', 15); k.leg(U / 2, V / 2, 15); }],
  [/chair/i, (U, V, k) => { k.put(0, 0, U, V, 2.5, 'fabric', 10); k.pane(0, 1.25, U, 1.25, 25, 'fabric'); k.pane(1, V - 1.5, U - 1, V - 1.5, 10, 'walnut'); }],
  [/toilet/i, (U, V, k) => { k.put(1, 0, U - 2, V * .3, 15, 'porcelain'); k.put(2, V * .3, U - 4, V * .7, 8, 'porcelain'); }],
  [/sink|basin/i, (U, V, k) => { const t = k.put(0, 0, U, V, 13, 'white'); k.decal(t, U * .2, V * .2, U * .6, V * .6, 'metal'); }],
  [/bath|tub|shower/i, (U, V, k) => { const t = k.put(0, 0, U, V, 9, 'porcelain'); k.decal(t, 4, 4, U - 8, V - 8, 'water'); }],
  [/fridge/i, (U, V, k) => { k.put(0, 0, U, V, 34, 'metal'); }],
  [/wardrobe|closet/i, (U, V, k) => { k.put(0, 0, U, V, 32, 'wood'); }],
  [/shelf|bookcase/i, (U, V, k) => { k.put(0, 0, U, V, 24, 'walnut'); k.pane(U * .06, V + .3, U * .86, V + .3, 14, 'books', 4); }],
  [/washer|dryer/i, (U, V, k) => { k.put(0, 0, U, V, 16, 'white'); k.pane(U * .22, V + .3, U * .78, V + .3, U * .56, 'porthole', 2); }],
  [/island|counter/i, (U, V, k) => { k.put(0, 0, U, V, 15, 'counter'); }],
  [/dining|table/i, (U, V, k) => { k.put(0, 0, U, V, 2, 'wood', 13); ends(U, V, 13, k); }],
];

/** The rooms' outlines as wall stretches, each drawn once: where rooms meet, the smaller room (higher rank) owns it. */
export function walls(rooms: PlanRoom[], rank: Map<number, number>) {
  const lines = new Map<string, { along: 'x' | 'z'; at: number; spans: [number, number, number][] }>();
  const edge = (along: 'x' | 'z', at: number, a: number, b: number, room: number) => {
    const k = `${along}${Math.round(at * 10)}`, l = lines.get(k) ?? { along, at, spans: [] };
    l.spans.push([a, b, room]); lines.set(k, l);
  };
  for (const r of rooms) { edge('x', r.z, r.x, r.x + r.w, r.id); edge('x', r.z + r.d, r.x, r.x + r.w, r.id); edge('z', r.x, r.z, r.z + r.d, r.id); edge('z', r.x + r.w, r.z, r.z + r.d, r.id); }
  const out: { along: 'x' | 'z'; at: number; a: number; b: number; room: number }[] = [];
  for (const { along, at, spans } of lines.values()) {
    const cuts = [...new Set(spans.flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], m = (a + b) / 2;
      const owners = spans.filter(([s, e]) => s < m && m < e); if (!owners.length) continue;
      const room = owners.reduce((x, y) => (rank.get(y[2]) ?? 0) > (rank.get(x[2]) ?? 0) ? y : x)[2], prev = out.at(-1);
      if (prev && prev.along === along && prev.at === at && prev.room === room && Math.abs(prev.b - a) < .01) prev.b = b;
      else out.push({ along, at, a, b, room });
    }
  }
  return out;
}

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
    for (const { l, x, z, kind } of lights) {
      if (kind === 'strip') continue;                      // a strip is only the glow on the floor and the wall behind it
      const y = kind === 'lamp' ? 26 : kind === 'pendant' ? 30 : WALL + 12, tag = (e: HTMLElement) => { e.dataset.of = of; e.dataset.light = l.id; return add(e); };
      // a cone of light from the bulb to the floor: two crossed sheets, of which only the one facing the camera is drawn
      const beams = [tag(upX(mk('beam light'), x - 34, z, 68, y)), tag(upZ(mk('beam light'), x, z - 34, 68, y))];
      beams[0].dataset.n = 'pz'; beams[1].dataset.n = 'px';
      if (kind === 'lamp') { post(add, x, z, y - 4, 'pole', of); box(add, x - 6, z - 6, 12, 12, 8, 'furn shade', of, y - 2); }
      if (kind === 'pendant') post(add, x, z, 26, 'cord', of, y + 3, .8);
      tag(flat(mk('orb', '<i class="core light"></i><i class="halo light"></i>'), x - 7, z - 7, 14, 14, y));
    }
  }
  // low glass walls round the rooms. Neighbours share a wall, so each stretch is drawn once, for the smaller room.
  for (const w of walls(d.rooms, rank)) { const e = add(w.along === 'x' ? upX(mk('wallp'), w.a, w.at, w.b - w.a, WALL) : upZ(mk('wallp'), w.at, w.a, w.b - w.a, WALL)); e.dataset.of = `room:${w.room}`; }
  for (const f of d.furniture) {
    // the piece in its own space, turned about its centre by the map's angle (quarter turns)
    const q = ((Math.round(f.angle / 90) % 4) + 4) % 4, U = f.w, V = f.d, cx = f.x + U / 2, cz = f.z + V / 2, of = `room:${f.room}`;
    const spin = (u: number, v: number) => { const a = u - U / 2, b = v - V / 2; return [[a, b], [-b, a], [-a, -b], [b, -a]][q]; };
    const rect = (u: number, v: number, w: number, dd: number) => {
      const [a, b] = spin(u, v), [c, e] = spin(u + w, v + dd);
      return { x: cx + Math.min(a, c), z: cz + Math.min(b, e), W: Math.abs(c - a), D: Math.abs(e - b) };
    };
    const k: Kit = {
      put(u, v, w, dd, h, mat, y0 = 0) {
        const { x, z, W, D } = rect(u, v, w, dd);
        if (h > 2.5) return { el: box(add, x, z, W, D, h, `furn ${mat}`, of, y0), x, z };
        const el = add(flat(mk(`furn ${mat} top`), x, z, W, D, y0 + h)); el.dataset.of = of;   // a tabletop or a rug: its edge would be a hairline
        return { el, x, z };
      },
      decal(on, u, v, w, dd, mat) {
        const { x, z, W, D } = rect(u, v, w, dd), i = document.createElement('i');
        i.className = `dc ${mat}`; Object.assign(i.style, { left: x - on.x + 'px', top: z - on.z + 'px', width: W + 'px', height: D + 'px' });
        on.el.appendChild(i);
      },
      pane(u0, v0, u1, v1, h, mat, y0 = 0) {
        const [a, b] = spin(u0, v0), [c, e] = spin(u1, v1);
        const el = Math.abs(b - e) < .01 ? upX(mk(`furn ${mat} side`), cx + Math.min(a, c), cz + b, Math.abs(c - a), h, y0)
          : upZ(mk(`furn ${mat} side end`), cx + a, cz + Math.min(b, e), Math.abs(e - b), h, y0);
        el.dataset.of = of; add(el);
      },
      leg(u, v, h, mat = 'metal', y0 = 0) { const [a, b] = spin(u, v); post(add, cx + a, cz + b, h, `furn ${mat}`, of, y0); },
    };
    (PIECES.find(([re]) => re.test(f.type))?.[1] ?? ((W, D, kit) => { kit.put(0, 0, W, D, 12, 'walnut'); }))(U, V, k);
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
