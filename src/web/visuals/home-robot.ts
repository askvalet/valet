// Where the robot is, between the moments the map says so. A live map moves it: it drives to each new position by way
// of the doors. A robot that says it's cleaning but reports no position sweeps the house in lanes, as a real one does.
// Back and forth, pivot and go. Pure: the renderer asks step() for a pose.
import type { PlanRobot } from './home-model.ts';
import { obstacle, roomAt, type Layout } from './home-plan.ts';

const NAV = 10, SPEED = 58, TURN = 200, CLEARANCE = 13;
export interface Pose { x: number; z: number; a: number; moving: boolean }

export function createRobot(p: Layout, dock?: { x: number; z: number; a: number }) {
  const cols = Math.ceil((p.cols * 4) / NAV), rows = Math.ceil((p.rows * 4) / NAV), free = new Uint8Array(cols * rows);
  const X = (i: number) => p.x0 + (i + .5) * NAV, Z = (j: number) => p.z0 + (j + .5) * NAV;
  const opening = (x: number, z: number) => p.gaps.some(g => {
    if (g.kind === 'window') return false;
    const w = p.walls[g.wall], [s, c] = w.along === 'x' ? [x, z] : [z, x];
    return s > g.from + 10 && s < g.to - 10 && Math.abs(c - w.at) < CLEARANCE + 2;
  });
  const solid = p.furniture.filter(f => obstacle(f.type));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = X(i), z = Z(j), k = roomAt(p, x, z);
    if (solid.some(f => x > f.x - 8 && x < f.x + f.w + 8 && z > f.z - 8 && z < f.z + f.d + 8)) continue;
    if (opening(x, z)) { free[j * cols + i] = 1; continue; }
    if (k && [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([a, b]) => roomAt(p, x + a * CLEARANCE, z + b * CLEARANCE) === k)) free[j * cols + i] = 1;
  }
  const cellOf = (x: number, z: number) => {
    const i0 = Math.floor((x - p.x0) / NAV), j0 = Math.floor((z - p.z0) / NAV);
    for (let n = 0; n < 40; n++) for (let a = -n; a <= n; a++) for (const [i, j] of [[i0 + a, j0 - n], [i0 + a, j0 + n], [i0 - n, j0 + a], [i0 + n, j0 + a]]) {
      if (i >= 0 && j >= 0 && i < cols && j < rows && free[j * cols + i]) return j * cols + i;
    }
    return -1;
  };
  /** Breadth first from a cell to the nearest one `goal` accepts; the route there, walls and furniture respected. */
  const search = (from: number, goal: (c: number) => boolean) => {
    const prev = new Int32Array(free.length).fill(-1), queue = [from]; prev[from] = from;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      if (goal(c) && c !== from) { const route = []; for (let n = c; n !== from; n = prev[n]) route.unshift(n); return route; }
      for (const n of [c - 1, c + 1, c - cols, c + cols]) if (n >= 0 && n < free.length && Math.abs((n % cols) - (c % cols)) <= 1 && free[n] && prev[n] < 0) { prev[n] = c; queue.push(n); }
    }
    return [];
  };

  const home = dock ? { x: dock.x, z: dock.z, a: dock.a } : undefined;
  const pose: Pose = { x: home?.x ?? 0, z: home?.z ?? 0, a: home?.a ?? 0, moving: false };
  let route: [number, number][] = [], seen = new Uint8Array(free.length), dir = 1, last = '', fresh = -1e9, placed = false, clock = 0;
  const go = (cells: number[]) => { route = cells.map(c => [X(c % cols), Z(Math.floor(c / cols))]); };
  const mark = (c: number) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const n = c + a + b * cols; if (n >= 0 && n < seen.length) seen[n] = 1; } };
  // the next stretch of a sweep: on along the lane if there's floor left, otherwise the nearest floor not yet done
  const sweep = () => {
    const c = cellOf(pose.x, pose.z); if (c < 0) return;
    mark(c);
    const lane: number[] = [];
    for (let n = c + dir; n % cols !== 0 && n >= 0 && n < free.length && free[n] && !seen[n] && Math.abs(n - c) < cols; n += dir) lane.push(n);
    if (lane.length) { go(lane); lane.forEach(mark); return; }
    dir = -dir;
    const next = search(c, n => free[n] === 1 && !seen[n]);
    if (next.length) go(next); else { seen = new Uint8Array(free.length); }
  };

  return {
    pose,
    step(dt: number, r: PlanRobot | undefined): Pose {
      if (!r) return pose;
      clock += dt;
      const key = `${r.x},${r.z}`, known = r.x != null && r.z != null;
      if (known && !placed) { placed = true; last = key; pose.x = r.x!; pose.z = r.z!; pose.a = r.a ?? 0; if (r.state === 'docked' && home) { pose.x = home.x; pose.z = home.z; pose.a = home.a; } }
      if (known && key !== last) { last = key; fresh = clock; const c = cellOf(pose.x, pose.z), to = cellOf(r.x!, r.z!); route = []; if (c >= 0 && to >= 0 && c !== to) go(search(c, n => n === to)); }
      const live = clock - fresh < 15, cleaning = /clean|mop|sweep/i.test(r.state) && !r.error, away = home && Math.hypot(pose.x - home.x, pose.z - home.z) > 3;
      const returning = /return/i.test(r.state) || (r.state === 'docked' && !live);
      if (!route.length) {
        if (cleaning && !live) sweep();
        else if (returning && away && home) { const c = cellOf(pose.x, pose.z), to = cellOf(home.x, home.z); if (c >= 0 && to >= 0) go(search(c, n => n === to)); if (!route.length || c === to) route.push([home.x, home.z]); }
      }
      else if (!cleaning && !returning && !live) route = [];
      pose.moving = route.length > 0;
      if (!pose.moving) {
        if (r.state === 'docked' && home && !away) { const d = ((home.a - pose.a + 540) % 360) - 180; pose.a += Math.sign(d) * Math.min(Math.abs(d), TURN * dt); pose.moving = Math.abs(d) > 1; }
        return pose;
      }
      let [tx, tz] = route[0], want = Math.atan2(tz - pose.z, tx - pose.x) * 180 / Math.PI, d = ((want - pose.a + 540) % 360) - 180;
      const dist = Math.hypot(tx - pose.x, tz - pose.z);
      if (dist < .6) { route.shift(); return pose; }
      pose.a += Math.sign(d) * Math.min(Math.abs(d), TURN * dt);
      if (Math.abs(d) < 12) { const go = Math.min(dist, SPEED * dt); pose.x += Math.cos(want * Math.PI / 180) * go; pose.z += Math.sin(want * Math.PI / 180) * go; }
      return pose;
    },
  };
}
