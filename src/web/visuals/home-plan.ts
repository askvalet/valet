// From the data to a house: a vacuum's map gives overlapping room boxes, so they're rasterised onto a grid (smaller
// rooms win, slivers go, hairline gaps close) and everything else is read off that grid: floors, walls between
// different cells, doors between rooms, windows on the outside, and where each light really hangs. Pure: no DOM or GL.
import type { PlanData, PlanLight, PlanRoom } from './home-model.ts';

export const WALL = 78, THICK = 7, CELL = 4;   // heights in plan units; a door is about 40 wide
export type Rect = { x: number; z: number; w: number; d: number };
export interface Wall { along: 'x' | 'z'; at: number; from: number; to: number; a: number; b: number }   // a: the room on its low side, b: high side (0: outside)
export interface Gap { wall: number; from: number; to: number; kind: 'door' | 'open' | 'window'; hinge?: number }
export interface Fixture { id: string; emit: number; x: number; z: number; y: number; base: number; kind: NonNullable<PlanLight['kind']>; room: number }
/** A source of light. Lights in a crowded room share one; a TV is one with no switch of its own. */
export interface Emitter { x: number; y: number; z: number; reach: number; room: number; ids: string[]; screen?: boolean }
export interface Room { i: number; src: PlanRoom; cx: number; cz: number; box: Rect; floors: Rect[]; list: number[] }
export interface Layout {
  x0: number; z0: number; cols: number; rows: number; grid: Int16Array;
  bounds: Rect; rooms: Room[]; walls: Wall[]; gaps: Gap[]; emitters: Emitter[]; fixtures: Fixture[]; furniture: NonNullable<PlanData['furniture']>;
}

const FLAT = /rug|carpet/i, TALL = /fridge|wardrobe|closet|shelf|bookcase/i;
/** Worktops a lamp can stand on, and how high. */
const TOPS: [RegExp, number][] = [[/bedside|night/i, 17], [/desk/i, 25], [/tv/i, 13], [/dining|table/i, 25], [/shelf|bookcase/i, 24], [/island|counter/i, 31]];

/** Rooms with no size (a home with lights but no map) get laid out in a simple block, so they still show. */
function arrange(rooms: PlanRoom[]) {
  const w = 170, d = 140, cols = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
  let n = 0;
  return rooms.map(r => { if (r.w > 0 && r.d > 0) return r; const i = n++; return { ...r, x: (i % cols - cols / 2) * w, z: (Math.floor(i / cols) - 1) * d, w, d }; });
}

export function plan(d: PlanData): Layout {
  const src = arrange(d.rooms ?? []), furniture = d.furniture ?? [];
  const minX = Math.min(...src.map(r => r.x), 0), maxX = Math.max(...src.map(r => r.x + r.w), 0);
  const minZ = Math.min(...src.map(r => r.z), 0), maxZ = Math.max(...src.map(r => r.z + r.d), 0);
  const x0 = Math.floor(minX / CELL) * CELL - CELL * 4, z0 = Math.floor(minZ / CELL) * CELL - CELL * 4;
  const cols = Math.ceil((maxX - x0) / CELL) + 5, rows = Math.ceil((maxZ - z0) / CELL) + 5;
  const grid = new Int16Array(cols * rows), at = (i: number, j: number) => i < 0 || j < 0 || i >= cols || j >= rows ? 0 : grid[j * cols + i];

  [...src.map((r, i) => ({ r, i: i + 1 }))].sort((a, b) => b.r.w * b.r.d - a.r.w * a.r.d).forEach(({ r, i }) => {
    const i0 = Math.round((r.x - x0) / CELL), j0 = Math.round((r.z - z0) / CELL), i1 = Math.round((r.x + r.w - x0) / CELL), j1 = Math.round((r.z + r.d - z0) / CELL);
    for (let j = j0; j < j1; j++) for (let k = i0; k < i1; k++) grid[j * cols + k] = i;
  });
  // what's left of a big box beside a smaller room can be a sliver a wall wide: keep only cells in a 3×3 block
  const keep = new Uint8Array(grid.length);
  for (let j = 0; j < rows - 2; j++) for (let i = 0; i < cols - 2; i++) {
    const k = at(i, j); if (!k) continue;
    let all = true; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) if (at(i + a, j + b) !== k) all = false;
    if (all) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) keep[(j + b) * cols + i + a] = 1;
  }
  grid.forEach((_, c) => { if (!keep[c]) grid[c] = 0; });
  // rooms on a map stop short of each other by the thickness of the wall: close gaps of up to three cells
  const near = (i: number, j: number, di: number, dj: number) => { for (let n = 1; n <= 3; n++) { const k = at(i + di * n, j + dj * n); if (k) return k; } return 0; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (!at(i, j)) {
    const l = near(i, j, -1, 0), r = near(i, j, 1, 0), u = near(i, j, 0, -1), o = near(i, j, 0, 1);
    if (l && r) grid[j * cols + i] = l; else if (u && o) grid[j * cols + i] = u;
  }

  // each room's floor, as few rectangles as cover it
  const rooms: Room[] = src.map((r, n) => ({ i: n + 1, src: r, cx: 0, cz: 0, box: { x: 0, z: 0, w: 0, d: 0 }, floors: [], list: [] }));
  const used = new Uint8Array(grid.length);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = at(i, j); if (!k || used[j * cols + i]) continue;
    let w = 1, h = 1;
    while (at(i + w, j) === k && !used[j * cols + i + w]) w++;
    grow: for (; j + h < rows; h++) for (let a = 0; a < w; a++) if (at(i + a, j + h) !== k || used[(j + h) * cols + i + a]) break grow;
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[(j + b) * cols + i + a] = 1;
    rooms[k - 1].floors.push({ x: x0 + i * CELL, z: z0 + j * CELL, w: w * CELL, d: h * CELL });
  }
  for (const r of rooms) {
    const area = r.floors.reduce((a, f) => a + f.w * f.d, 0) || 1, big = [...r.floors].sort((a, b) => b.w * b.d - a.w * a.d)[0] ?? { ...r.src };
    const x = Math.min(...r.floors.map(f => f.x), big.x), z = Math.min(...r.floors.map(f => f.z), big.z);
    r.box = { x, z, w: Math.max(...r.floors.map(f => f.x + f.w), big.x + big.w) - x, d: Math.max(...r.floors.map(f => f.z + f.d), big.z + big.d) - z };
    const mx = r.floors.reduce((a, f) => a + (f.x + f.w / 2) * f.w * f.d, 0) / area, mz = r.floors.reduce((a, f) => a + (f.z + f.d / 2) * f.w * f.d, 0) / area;
    [r.cx, r.cz] = r.floors.length > 1 ? [big.x + big.w / 2, big.z + big.d / 2] : [mx || big.x + big.w / 2, mz || big.z + big.d / 2];
  }

  // walls run wherever neighbouring cells differ
  const walls: Wall[] = [];
  const trace = (along: 'x' | 'z', n: number, m: number, cell: (l: number, s: number) => number, base: number, base2: number) => {
    for (let l = 0; l <= n; l++) {
      let s = 0;
      while (s < m) {
        const a = cell(l - 1, s), b = cell(l, s);
        if (a === b) { s++; continue; }
        let e = s + 1; while (e < m && cell(l - 1, e) === a && cell(l, e) === b) e++;
        walls.push({ along, at: base + l * CELL, from: base2 + s * CELL, to: base2 + e * CELL, a, b }); s = e;
      }
    }
  };
  trace('x', rows, cols, (j, i) => at(i, j), z0, x0);
  trace('z', cols, rows, (i, j) => at(i, j), x0, z0);

  // how much furniture a stretch of wall has in front of it
  const blocked = (w: Wall, from: number, to: number, pad: number, only?: RegExp) => furniture.reduce((sum, f) => {
    if (FLAT.test(f.type) || (only && !only.test(f.type))) return sum;
    const [fa, fb, c0, c1] = w.along === 'x' ? [f.x, f.x + f.w, f.z, f.z + f.d] : [f.z, f.z + f.d, f.x, f.x + f.w];
    const over = Math.min(to, fb) - Math.max(from, fa), near = c0 < w.at + pad && c1 > w.at - pad;
    return over > 0 && near ? sum + over : sum;
  }, 0);
  const place = (w: Wall, width: number, pad: number, only?: RegExp, taken: [number, number][] = []) => {
    const m = (w.from + w.to) / 2; let best = NaN, cost = Infinity;
    for (let s = w.from + 8; s + width <= w.to - 8; s += 6) {
      if (taken.some(([a, b]) => s < b + 10 && s + width > a - 10)) continue;
      const c = blocked(w, s, s + width, pad, only) * 4 + Math.abs(s + width / 2 - m) * .25;
      if (c < cost) { cost = c; best = s; }
    }
    return best;
  };

  // one way between any two rooms: the open-plan rooms flow into each other, halls come first, and the rest connect
  // by their longest shared wall
  const OPEN = /living|lounge|kitchen|dining|family/i, HALL = /hall|corridor|landing|entr/i;
  const links = new Map<string, number[]>();
  walls.forEach((w, n) => { if (w.a && w.b && w.to - w.from >= 56) { const k = `${Math.min(w.a, w.b)}:${Math.max(w.a, w.b)}`; links.set(k, [...links.get(k) ?? [], n]); } });
  const name = (i: number) => src[i - 1].name, len = (n: number) => walls[n].to - walls[n].from;
  const score = (ns: number[]) => { const w = walls[ns[0]]; return (HALL.test(name(w.a)) || HALL.test(name(w.b)) ? 1000 : 0) + (OPEN.test(name(w.a)) && OPEN.test(name(w.b)) ? 2000 : 0) + Math.max(...ns.map(len)); };
  const set = rooms.map(r => r.i), find = (i: number): number => set[i - 1] === i ? i : find(set[i - 1]);
  const gaps: Gap[] = [];
  for (const ns of [...links.values()].sort((a, b) => score(b) - score(a))) {
    const n = [...ns].sort((a, b) => len(b) - len(a))[0], w = walls[n];
    const open = OPEN.test(name(w.a)) && OPEN.test(name(w.b));
    if (!open && find(w.a) === find(w.b)) continue;
    set[find(w.a) - 1] = find(w.b);
    const width = open ? Math.min(150, Math.round(len(n) * .66)) : 42, s = place(w, width, 24);
    if (!isNaN(s)) gaps.push({ wall: n, from: s, to: s + width, kind: open ? 'open' : 'door', hinge: n % 2 });
  }
  // windows on the outside, clear of anything tall
  walls.forEach((w, n) => {
    if ((w.a && w.b) || w.to - w.from < 60) return;
    const L = w.to - w.from, small = /bath|wc|toilet|laundry/i.test(name(w.a || w.b)), width = small ? 34 : Math.min(72, L * .55), count = small ? 1 : Math.max(1, Math.floor(L / 150));
    const taken: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const piece: Wall = count > 1 ? { ...w, from: w.from + L * i / count, to: w.from + L * (i + 1) / count } : w;
      const s = place(piece, width, 22, TALL, taken);
      if (!isNaN(s)) { taken.push([s, s + width]); gaps.push({ wall: n, from: s, to: s + width, kind: 'window' }); }
    }
  });

  // the nearest point inside a room, kept off its walls
  const inside = (r: Room, x: number, z: number) => {
    const cell = (a: number, b: number) => Math.floor((a - b) / CELL), i0 = cell(x, x0), j0 = cell(z, z0);
    if (at(i0, j0) === r.i) return [x, z];
    for (let n = 1; n < 120; n++) for (let a = -n; a <= n; a++) for (const [i, j] of [[i0 + a, j0 - n], [i0 + a, j0 + n], [i0 - n, j0 + a], [i0 + n, j0 + a]]) {
      if (at(i, j) === r.i && at(i + 3, j) === r.i && at(i - 3, j) === r.i && at(i, j + 3) === r.i && at(i, j - 3) === r.i) return [x0 + (i + .5) * CELL, z0 + (j + .5) * CELL];
    }
    return [r.cx, r.cz];
  };

  // Where each light is: where the data says; a lamp named for a piece of furniture on it (a bedside lamp on a
  // nightstand, a TV backlight behind the TV); otherwise spread evenly across the room.
  const emitters: Emitter[] = [], fixtures: Fixture[] = [], perRoom = Math.max(2, Math.min(6, Math.floor(30 / Math.max(1, rooms.length))));
  const KINDS: [RegExp, PlanLight['kind']][] = [[/strip|backlight|led/i, 'strip'], [/lamp|bed.?side|night|side table/i, 'lamp'], [/pendant/i, 'pendant']];
  const HOSTS: [RegExp, RegExp][] = [[/bed|night/i, /bedside|night/i], [/desk/i, /desk/i], [/tv|backlight/i, /tv/i], [/table|dining/i, /dining|table/i]];
  for (const r of rooms) {
    const n = r.src.lights.length, gridCols = Math.ceil(Math.sqrt(n)), gridRows = Math.ceil(n / Math.max(1, gridCols)), taken = new Set<object>();
    const own = furniture.filter(f => f.room === r.src.id), group = Math.ceil(n / perRoom);
    const placed = r.src.lights.map((l, i) => {
      const kind = l.kind ?? KINDS.find(([re]) => re.test(`${l.name} ${l.id}`))?.[1] ?? 'ceiling';
      const host = l.at || kind === 'ceiling' ? undefined : own.find(f => !taken.has(f) && HOSTS.some(([a, b]) => a.test(`${l.name} ${l.id}`) && b.test(f.type)));
      if (host) taken.add(host);
      const [x, z] = l.at ? [l.at.x, l.at.z] : host ? [host.x + host.w / 2, host.z + host.d / 2]
        : inside(r, r.box.x + r.box.w * ((i % gridCols) + .5) / gridCols, r.box.z + r.box.d * (Math.floor(i / gridCols) + .5) / gridRows);
      // a lamp stands on whatever is under it, or on the floor
      const under = kind === 'lamp' ? own.find(f => x > f.x && x < f.x + f.w && z > f.z && z < f.z + f.d && TOPS.some(([re]) => re.test(f.type))) : undefined;
      const base = under ? TOPS.find(([re]) => re.test(under.type))![1] : 0;
      const y = kind === 'lamp' ? (base ? base + 15 : 46) : kind === 'pendant' ? 44 : kind === 'strip' ? 24 : WALL - 6;
      return { l, kind, x, z, y, base };
    });
    for (let g = 0; g * group < n; g++) {
      const part = placed.slice(g * group, (g + 1) * group), N = part.length, emit = emitters.length;
      const [x, y, z] = [0, 1, 2].map(a => part.reduce((s, p) => s + [p.x, p.y, p.z][a], 0) / N);
      const lamp = part[0].kind === 'lamp', strip = part[0].kind === 'strip';
      emitters.push({ x, y, z, room: r.i, reach: lamp ? 210 : strip ? 150 : 300, ids: part.map(p => p.l.id) });
      r.list.push(emit);
      for (const p of part) fixtures.push({ id: p.l.id, emit, x: p.x, z: p.z, y: p.y, base: p.base, kind: p.kind, room: r.i });
    }
    // a screen lights the room it's in while anyone's there
    for (const f of own) if (/tv/i.test(f.type) && emitters.length < 32) {
      const q = ((Math.round(f.angle / 90) % 4) + 4) % 4, [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][q];
      r.list.push(emitters.length);
      emitters.push({ x: f.x + f.w / 2 + dx * 16, y: 30, z: f.z + f.d / 2 + dz * 16, room: r.i, reach: 170, ids: [], screen: true });
    }
  }
  // what spills through an opening: the neighbours' lights, as far as the shadow maps let them
  for (const g of gaps) {
    if (g.kind === 'window') continue;
    const w = walls[g.wall], [a, b] = [rooms[w.a - 1], rooms[w.b - 1]];
    for (const [to, from] of [[a, b], [b, a]]) for (const e of from.list) if (!to.list.includes(e) && !to.list.includes(~e)) to.list.push(~e);
  }
  for (const r of rooms) r.list = r.list.slice(0, 8);

  const I = rooms.flatMap(r => r.floors);
  const bx = I.length ? Math.min(...I.map(f => f.x)) : -120, bz = I.length ? Math.min(...I.map(f => f.z)) : -80;
  const bounds = { x: bx, z: bz, w: (I.length ? Math.max(...I.map(f => f.x + f.w)) : 120) - bx, d: (I.length ? Math.max(...I.map(f => f.z + f.d)) : 80) - bz };
  return { x0, z0, cols, rows, grid, bounds, rooms, walls, gaps, emitters, fixtures, furniture };
}

/** The room at a point in the plan, 0 for outside. */
export const roomAt = (p: Layout, x: number, z: number) => {
  const i = Math.floor((x - p.x0) / CELL), j = Math.floor((z - p.z0) / CELL);
  return i < 0 || j < 0 || i >= p.cols || j >= p.rows ? 0 : p.grid[j * p.cols + i];
};

/** What a robot can't drive through or under. */
export const obstacle = (type: string) => !/rug|carpet|table|desk|stool|chair/i.test(type) || /tv|night|bedside/i.test(type);
