// The house as one mesh: rounded boxes, turned legs, plush cushions, books and leaves, all written into a single
// vertex buffer so the whole model is a handful of draw calls. Each vertex carries its material, its room (for which
// lights reach it), the light it glows with, and whether it's a wall (which the cutaway lowers).
import { THICK, WALL, type Gap, type Layout, type Wall } from './home-plan.ts';

// materials the fragment shader treats differently; anything else is matte
const K = { Matte: 0, PlankX: 1, PlankZ: 2, Tile: 3, Fabric: 4, Plaster: 5, Gloss: 6, Metal: 7, Glow: 8, Screen: 9, Leaf: 10, Grain: 11, Glass: 12, Water: 13, Rug: 14 };
type Mat = [r: number, g: number, b: number, kind: number];
const m = (hex: string, kind: number = K.Matte): Mat => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), kind];

const C = {
  plaster: m('#c7c0b4', K.Plaster), outside: m('#34363c'), cap: m('#e8e4dc'), skirting: m('#d9d4ca', K.Gloss), plinth: m('#17181c', K.Gloss), plinthEdge: m('#24262b', K.Gloss),
  oakFloorX: m('#94693f', K.PlankX), oakFloorZ: m('#94693f', K.PlankZ), tile: m('#a9aaa6', K.Tile), oak: m('#a87c50', K.Grain), walnut: m('#5e3d29', K.Grain), ash: m('#c8ab84', K.Grain),
  charcoal: m('#2c2e33'), ink: m('#16171a', K.Gloss), steel: m('#a3a7ad', K.Metal), brass: m('#c7a266', K.Metal), white: m('#e6e4df', K.Gloss), porcelain: m('#f0efeb', K.Gloss), stone: m('#d4d1ca', K.Gloss),
  sofa: m('#59616e', K.Fabric), sofaLight: m('#6b7482', K.Fabric), oat: m('#c9bda6', K.Fabric), rust: m('#a65a3a', K.Fabric), sage: m('#7f8f74', K.Fabric), mustard: m('#c49a45', K.Fabric), ink2: m('#39465c', K.Fabric),
  linen: m('#e2dcd0', K.Fabric), pillow: m('#f1ece2', K.Fabric), duvet: m('#7b8ca6', K.Fabric), towel: m('#b7c2c9', K.Fabric),
  rugA: m('#6d5763', K.Rug), rugB: m('#8c7a6c', K.Rug), rugC: m('#4b5563', K.Rug), rugEdge: m('#d6cdbc', K.Rug),
  leaf: m('#3f7d4f', K.Leaf), leaf2: m('#5b9a5f', K.Leaf), clay: m('#a8633f'), soil: m('#2a1f18'), water: m('#7fb9cc', K.Water), glass: m('#b8d0e0', K.Glass),
  shade: m('#efe3cc', K.Glow), bulb: m('#fff4e0', K.Glow), screen: m('#0d0e12', K.Screen), paper: m('#e8e2d6'),
};
const SPINES = [C.rust, C.sage, C.mustard, C.ink2, C.oat, C.walnut, C.linen].map(([r, g, b]) => [r, g, b, K.Matte] as Mat);

export function mesher() {
  let cap = 1 << 18, buf = new ArrayBuffer(cap * 24), f = new Float32Array(buf), u = new Uint8Array(buf), i8 = new Int8Array(buf), n = 0;
  const layers: number[][] = [[], [], []];
  let layer = 0, room = 0, link = 0, wall = 0, cx = 0, cz = 0, q = 0, spot: number[] = [0, 0];
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Mat) => {
    if (n === cap) { cap *= 2; const b = new ArrayBuffer(cap * 24); new Uint8Array(b).set(u); buf = b; f = new Float32Array(b); u = new Uint8Array(b); i8 = new Int8Array(b); }
    const [px, pz, ax, az] = q === 0 ? [x, z, nx, nz] : q === 1 ? [-z, x, -nz, nx] : q === 2 ? [-x, -z, -nx, -nz] : [z, -x, nz, -nx];
    const o = n * 6, b = n * 24;
    f[o] = cx + px; f[o + 1] = y; f[o + 2] = cz + pz;
    i8[b + 12] = ax * 127; i8[b + 13] = ny * 127; i8[b + 14] = az * 127; i8[b + 15] = spot[0] - 128; u[b + 19] = spot[1];
    u[b + 16] = c[0]; u[b + 17] = c[1]; u[b + 18] = c[2]; u[b + 20] = c[3]; u[b + 21] = room; u[b + 22] = link; u[b + 23] = wall;
    return n++;
  };
  const tri = (a: number, b: number, c: number) => layers[layer].push(a, b, c);
  const quad = (a: number, b: number, c: number, d: number) => { tri(a, b, c); tri(a, c, d); };
  /** a flat four-corner face */
  const face = (p: number[][], nr: number[], c: Mat) => { const [a, b, e, d] = p.map(s => v(s[0], s[1], s[2], nr[0], nr[1], nr[2], c)); quad(a, b, e, d); };

  /** A box, corners rounded by r: min corner x,z, height from y. */
  function box(x: number, z: number, w: number, d: number, y: number, h: number, c: Mat, r = 0) {
    const X = x + w, Y = y + h, Z = z + d;
    if (r <= 0) {
      face([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], [0, 1, 0], c);
      face([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], [0, 0, 1], c); face([[X, y, z], [x, y, z], [x, Y, z], [X, Y, z]], [0, 0, -1], c);
      face([[X, y, Z], [X, y, z], [X, Y, z], [X, Y, Z]], [1, 0, 0], c); face([[x, y, z], [x, y, Z], [x, Y, Z], [x, Y, z]], [-1, 0, 0], c);
      return;
    }
    r = Math.min(r, w / 2 - .01, d / 2 - .01, h / 2 - .01);
    const stops = (a: number, l: number) => [a, a + r, a + l - r, a + l];
    const put = (px: number, py: number, pz: number) => {
      const ix = Math.max(x + r, Math.min(X - r, px)), iy = Math.max(y + r, Math.min(Y - r, py)), iz = Math.max(z + r, Math.min(Z - r, pz));
      let dx = px - ix, dy = py - iy, dz = pz - iz; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      return v(ix + dx * r, iy + dy * r, iz + dz * r, dx, dy, dz, c);
    };
    const xs = stops(x, w), ys = stops(y, h), zs = stops(z, d);
    const sheet = (as: number[], bs: number[], at: (a: number, b: number) => number) => {
      const ids = as.map(a => bs.map(b => at(a, b)));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) quad(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]);
    };
    sheet(xs, zs, (a, b) => put(a, Y, b)); sheet(xs, ys, (a, b) => put(a, b, Z)); sheet(xs, ys, (a, b) => put(a, b, z));
    sheet(zs, ys, (a, b) => put(X, b, a)); sheet(zs, ys, (a, b) => put(x, b, a));
    if (h > 6) sheet(xs, zs, (a, b) => put(a, y, b));
  }
  /** A turned shape about an upright axis, radius r0 at the bottom to r1 at the top. */
  function cyl(x: number, z: number, r0: number, y: number, h: number, c: Mat, r1 = r0, seg = 12, caps = true) {
    const ring = (rad: number, yy: number, ny: number, flat: boolean) => Array.from({ length: seg + 1 }, (_, i) => {
      const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      return flat ? v(x + ca * rad, yy, z + sa * rad, 0, Math.sign(ny), 0, c) : v(x + ca * rad, yy, z + sa * rad, ca, ny, sa, c);
    });
    const slope = (r0 - r1) / Math.max(h, 1), low = ring(r0, y, slope, false), high = ring(r1, y + h, slope, false);
    for (let i = 0; i < seg; i++) quad(low[i], low[i + 1], high[i + 1], high[i]);
    if (caps) { const top = ring(r1, y + h, 1, true), mid = v(x, y + h, z, 0, 1, 0, c); for (let i = 0; i < seg; i++) tri(mid, top[i + 1], top[i]); }
  }
  /** A soft ellipsoid. */
  function blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: Mat, seg = 8) {
    const rows = Math.ceil(seg * .6), ids: number[][] = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows * Math.PI, sy = Math.cos(t), sr = Math.sin(t), row: number[] = [];
      for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2, nx = Math.cos(a) * sr, nz = Math.sin(a) * sr; const l = Math.hypot(nx / rx, sy / ry, nz / rz); row.push(v(x + nx * rx, y + sy * ry, z + nz * rz, nx / rx / l, sy / ry / l, nz / rz / l, c)); }
      ids.push(row);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);
  }
  /** A leaf: a tapered blade arching out from (x,y,z) along heading a. */
  function frond(x: number, y: number, z: number, a: number, len: number, wid: number, rise: number, droop: number, c: Mat) {
    const ca = Math.cos(a), sa = Math.sin(a), seg = 5; let prev: number[] | null = null;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, w = wid * Math.sin(Math.PI * Math.min(.97, t * .92 + .06)), o = len * t, yy = y + rise * t - droop * t * t;
      const slopeY = rise - 2 * droop * t, l = Math.hypot(len, slopeY), nx = -ca * slopeY / l, ny = len / l, nz = -sa * slopeY / l;
      const ids = [v(x + ca * o + sa * w, yy - w * .25, z + sa * o - ca * w, nx, ny, nz, c), v(x + ca * o, yy, z + sa * o, nx, ny, nz, c), v(x + ca * o - sa * w, yy - w * .25, z + sa * o + ca * w, nx, ny, nz, c)];
      if (prev) { quad(prev[0], ids[0], ids[1], prev[1]); quad(prev[1], ids[1], ids[2], prev[2]); }
      prev = ids;
    }
  }
  return {
    box, cyl, blob, frond, face,
    /** spot: where along the plan (0–255 each way) a piece that vanishes whole is judged, so it goes all at once. */
    set(o: { room?: number; link?: number; wall?: number; layer?: number; spot?: number[] }) { room = o.room ?? room; link = o.link ?? link; wall = o.wall ?? wall; layer = o.layer ?? layer; spot = o.spot ?? spot; },
    /** Everything after this is in a piece's own space: U wide, V deep, centred at cx,cz, turned q quarter turns. */
    at(x: number, z: number, turn: number) { cx = x; cz = z; q = turn; },
    finish() {
      const index = new Uint32Array(layers[0].length + layers[1].length + layers[2].length);
      index.set(layers[0]); index.set(layers[1], layers[0].length); index.set(layers[2], layers[0].length + layers[1].length);
      return { verts: new Uint8Array(buf, 0, n * 24), index, cast: layers[0].length, solid: layers[0].length + layers[1].length, count: n };
    },
  };
}
type Mesher = ReturnType<typeof mesher>;
type Build = (M: Mesher, U: number, V: number, r: () => number) => void;

const seeded = (s: number) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

function chair(M: Mesher, x: number, z: number, U: number, V: number, c: Mat, back = 16, seat = 14) {
  const t = Math.min(1.6, U * .09);
  for (const [a, b] of [[1.5, 1.5], [U - 1.5, 1.5], [1.5, V - 1.5], [U - 1.5, V - 1.5]]) M.cyl(x + a, z + b, t * .6, 0, seat, C.walnut, t, 6, false);
  M.box(x, z, U, V, seat, 2.6, c, 1.1);
  M.box(x + .6, z, U - 1.2, 2, seat + 2, back, c, .9);
}
const coffeeThings = (M: Mesher, U: number, V: number, y: number, r: () => number) => {
  M.box(U * .18, V * .22, U * .2, V * .5, y, 1, SPINES[Math.floor(r() * 4)], .3); M.box(U * .2, V * .26, U * .17, V * .42, y + 1, .9, C.paper, .3);
  M.cyl(U * .7, V * .5, Math.min(U, V) * .17, y, 1.6, C.stone, Math.min(U, V) * .24, 14, true);
};
function diningTable(M: Mesher, x: number, z: number, U: number, V: number, r: () => number) {
  M.box(x, z, U, V, 26, 2.4, C.oak, 1);
  for (const [a, b] of [[4, 4], [U - 4, 4], [4, V - 4], [U - 4, V - 4]]) M.cyl(x + a, z + b, 1.3, 0, 26, C.walnut, 1.9, 8, false);
  M.cyl(x + U / 2, z + V / 2, 5, 28.4, 5, C.stone, 7, 14);
  for (let i = 0; i < 5; i++) M.blob(x + U / 2 + (r() - .5) * 6, 34.5, z + V / 2 + (r() - .5) * 6, 2.2, 2.2, 2.2, C.mustard, 6);
}
function lean(M: Mesher, U: number, V: number, r: () => number) {
  const n = 7 + Math.floor(r() * 5), base = Math.min(U, V) * .34, h = 12;
  M.cyl(U / 2, V / 2, base * .72, 0, h, C.clay, base, 16, false); M.cyl(U / 2, V / 2, base * .94, h - 2, 1.2, C.soil, base * .94, 14);
  M.cyl(U / 2, V / 2, base * 1.02, h - 1.4, 1.4, C.clay, base * 1.06, 16, false);
  const tall = Math.min(U, V) > 22;
  if (tall) { M.cyl(U / 2, V / 2, 1, h, 26, C.walnut, .7, 6, false); }
  for (let i = 0; i < n + 6; i++) {
    const a = i * 2.4 + r(), hi = tall ? h + 8 + (i / (n + 6)) * 28 : h - 1 + r() * 4, L = 15 + r() * 15, c = r() > .5 ? C.leaf : C.leaf2;
    M.frond(U / 2 + Math.cos(a) * 1.2, hi, V / 2 + Math.sin(a) * 1.2, a, L, 3.2 + r() * 2.4, 13 + r() * 12, 14 + r() * 9, c);
  }
}

// Each piece in its own space: its back along V = 0, facing +V, on the floor. `angle` turns the piece as a whole.
const PIECES: [RegExp, Build][] = [
  [/bedside|night/i, (M, U, V) => {
    M.box(0, 0, U, V, 3, 13, C.walnut, .8); M.box(.8, V - .4, U - 1.6, .6, 9.8, 5, C.oak, .2); M.box(.8, V - .4, U - 1.6, .6, 4, 5, C.oak, .2);
    M.box(U / 2 - 1.5, V, 3, .7, 12, .8, C.brass); for (const [a, b] of [[1.5, 1.5], [U - 1.5, 1.5], [1.5, V - 1.5], [U - 1.5, V - 1.5]]) M.cyl(a, b, .6, 0, 3, C.brass, .8, 6, false);
    M.box(U * .55, V * .2, U * .3, V * .4, 16, 1.2, SPINES[1], .3);
  }],
  [/bed/i, (M, U, V) => {
    const m = 2, big = U > 80;
    M.box(-1, 0, U + 2, 4, 0, 30, C.walnut, 1.6); M.box(1, 3.6, U - 2, 1.6, 15, 12, big ? C.oat : C.sage, .7);
    M.box(0, 4, U, V - 4, 3, 7, C.walnut, 1.2);
    M.box(m, 4, U - m * 2, V - 5, 8, 7, C.linen, 2.4);
    const duvet = V * .34; M.box(m - 1, duvet, U - m * 2 + 2, V - duvet + 0, 9, 7.5, C.duvet, 3); M.box(m - 1, duvet - 1, U - m * 2 + 2, 7, 15.5, 1.8, C.linen, .8);
    const n = big ? 2 : 1, w = (U - m * 2 - 4 - (n - 1) * 2) / n;
    for (let i = 0; i < n; i++) { M.box(m + 2 + i * (w + 2), 6, w, V * .15, 14.5, 4.2, C.pillow, 2); M.box(m + 4 + i * (w + 2), 6 + V * .08, w - 4, V * .11, 18, 3.4, i ? C.rust : C.mustard, 1.6); }
    M.box(m - 1.4, V * .72, U - m * 2 + 2.8, V * .2, 16.2, 1.2, C.oat, .5);
  }],
  [/sofa|couch/i, (M, U, V) => {
    const arm = Math.min(9, U * .09), back = V * .28;
    for (const [a, b] of [[3, 3], [U - 3, 3], [3, V - 3], [U - 3, V - 3]]) M.cyl(a, b, .8, 0, 3, C.walnut, 1.2, 6, false);
    M.box(0, 0, U, V, 3, 7, C.sofa, 1.6); M.box(0, 0, U, back, 8, 18, C.sofa, 3); M.box(0, 0, arm, V, 8, 11, C.sofa, 3); M.box(U - arm, 0, arm, V, 8, 11, C.sofa, 3);
    const n = U > 95 ? 3 : U > 50 ? 2 : 1, w = (U - arm * 2) / n;
    for (let i = 0; i < n; i++) { M.box(arm + i * w + .3, back - 1, w - .6, V - back + .5, 10, 5.5, C.sofaLight, 2.2); M.box(arm + i * w + 1, back - 2.5, w - 2, 6.5, 14.5, 11, C.sofaLight, 2.8); }
    M.box(arm + 2, back + 3, 12, 4, 15.5, 11, C.mustard, 2); M.box(U - arm - 15, back + 3, 13, 4, 15.5, 11, C.rust, 2);
    if (U > 90) { M.box(U * .56, back - 1, U * .16, V - back + 1.4, 15.3, 1, C.oat, .4); M.box(U * .56, V, U * .16, .9, 7, 8.5, C.oat, .3); }
  }],
  [/desk/i, (M, U, V) => {
    M.box(0, 0, U, V, 23, 2.2, C.ash, .8);
    for (const a of [3, U - 3]) { M.box(a - 1, 2, 2, V - 4, 0, 1.4, C.charcoal, .4); M.box(a - .9, V / 2 - .9, 1.8, 1.8, 1, 22, C.charcoal, .4); }
    M.box(U / 2 - 15, 3, 30, 1.2, 30, 17, C.ink, .5); M.set({ layer: 1 }); M.box(U / 2 - 14.2, 4.1, 28.4, .3, 30.8, 15.4, C.screen); M.set({ layer: 0 });
    M.box(U / 2 - 1.5, 3.4, 3, 1.6, 25.2, 6, C.steel); M.box(U / 2 - 5, 2, 10, 5, 25.2, .5, C.steel, .2);
    M.box(U / 2 - 11, V * .58, 22, 6.5, 25.2, .7, C.white, .3); M.box(U / 2 + 13, V * .62, 4, 6, 25.2, .9, C.white, .4);
  }],
  [/tv/i, (M, U, V) => {
    M.box(0, 0, U, V, 3, 11, C.walnut, 1); for (const k of [.33, .66]) M.box(U * k - .15, V - .1, .3, .3, 4, 9, C.ink);
    for (const a of [4, U - 4]) M.box(a - 1, 1, 2, V - 2, 0, 3, C.charcoal);
    M.box(U / 2 - 7, V / 2 - 3, 14, 6, 14, .8, C.ink, .3); M.box(U / 2 - 1.5, V / 2 - .7, 3, 1.4, 14.8, 4, C.ink);
    const w = Math.min(U * .78, 84), h = w * .56; M.box(U / 2 - w / 2, V / 2 - .8, w, 1.6, 18, h, C.ink, .3);
    M.set({ layer: 1 }); M.box(U / 2 - w / 2 + .5, V / 2 + .75, w - 1, .2, 18.6, h - 1.2, C.screen); M.set({ layer: 0 });
    M.box(U * .1, V * .2, 8, V * .5, 14, 3, C.ink2, .5);
  }],
  [/rug|carpet/i, (M, U, V, r) => {
    const a = [C.rugA, C.rugB, C.rugC][Math.floor(r() * 3)], e = Math.min(U, V) * .09;
    M.box(0, 0, U, V, 0, .7, C.rugEdge, .3); M.box(1.4, 1.4, U - 2.8, V - 2.8, .2, .8, a, .3); M.box(e, e, U - e * 2, V - e * 2, .3, .85, C.rugEdge, .2); M.box(e + 1, e + 1, U - e * 2 - 2, V - e * 2 - 2, .4, .85, a, .2);
  }],
  [/plant/i, lean],
  [/stool/i, (M, U, V) => { const R = Math.min(U, V) / 2; M.cyl(U / 2, V / 2, R * .85, 0, .8, C.steel, R * .85, 14); M.cyl(U / 2, V / 2, .9, 0, 20, C.steel, .9, 6, false); M.cyl(U / 2, V / 2, R * .95, 20, 2.4, C.oat, R, 14); }],
  [/table and chairs|dining.*chairs/i, (M, U, V, r) => {
    const w = Math.max(U, V) * .55, d = Math.min(U, V) * .5, long = V > U, x = U / 2 - (long ? d : w) / 2, z = V / 2 - (long ? w : d) / 2;
    diningTable(M, x, z, long ? d : w, long ? w : d, r);
    const s = Math.min(U, V) * .24;
    for (const [a, b] of [[-1, -.5], [-1, .5], [1, -.5], [1, .5]]) {
      const [px, pz] = long ? [U / 2 + a * (d / 2 + s * .35) - s / 2, V / 2 + b * w * .6 - s / 2] : [U / 2 + b * w * .6 - s / 2, V / 2 + a * (d / 2 + s * .35) - s / 2];
      chair(M, px, pz, s, s, C.oat, 12, 13);
    }
  }],
  [/armchair|recliner/i, (M, U, V) => {
    const arm = U * .17; for (const [a, b] of [[3, 3], [U - 3, 3], [3, V - 3], [U - 3, V - 3]]) M.cyl(a, b, .8, 0, 5, C.walnut, 1.2, 6, false);
    M.box(0, 0, U, V, 5, 7, C.sage, 2); M.box(0, 0, U, V * .28, 10, 18, C.sage, 3); M.box(0, 0, arm, V, 10, 10, C.sage, 2.6); M.box(U - arm, 0, arm, V, 10, 10, C.sage, 2.6);
    M.box(arm, V * .24, U - arm * 2, V * .74, 11, 5, C.oat, 2); M.box(arm + 1, V * .2, U - arm * 2 - 2, 5, 15, 11, C.oat, 2.2);
  }],
  [/chair/i, (M, U, V) => {
    if (U > 24) { M.cyl(U / 2, V / 2, .9, 3, 12, C.steel, .9, 6, false); for (let i = 0; i < 5; i++) { const a = i * 1.257, c = Math.cos(a) * U * .36, s = Math.sin(a) * V * .36; M.box(U / 2 + c - 1, V / 2 + s - 1, 2, 2, .3, 2.4, C.ink, .8); M.box(U / 2 + c * .5 - 1, V / 2 + s * .5 - 1, 2, 2, 2.4, 1, C.ink, .3); }
      M.box(U * .1, V * .15, U * .8, V * .75, 14, 3.4, C.charcoal, 1.5); M.box(U * .14, V * .04, U * .72, 2.6, 18, 17, C.charcoal, 1.2); }
    else chair(M, 0, 0, U, V, C.oat);
  }],
  [/toilet/i, (M, U, V) => {
    M.box(1, 0, U - 2, V * .32, 0, 22, C.porcelain, 1.6); M.box(.4, -.2, U - .8, V * .34, 21.4, 1.2, C.white, .5);
    M.cyl(U / 2, V * .68, U * .32, 0, 11, C.porcelain, U * .42, 16, false); M.cyl(U / 2, V * .68, U * .44, 11, 1.6, C.white, U * .44, 18);
  }],
  [/sink|basin|vanity/i, (M, U, V) => {
    M.box(0, 0, U, V, 0, 18, C.oak, .7); M.box(U / 2 - .2, V - .1, .4, .3, 1, 16, C.walnut); M.box(-.6, -.2, U + 1.2, V + .8, 18, 1.6, C.stone, .4);
    M.cyl(U / 2, V * .55, Math.min(U, V) * .36, 19.6, 2.6, C.porcelain, Math.min(U, V) * .42, 18);
    M.cyl(U / 2, V * .14, .7, 19.6, 5, C.steel, .7, 6); M.box(U / 2 - .6, V * .14, 1.2, V * .2, 24, .9, C.steel);
    M.set({ wall: 1 }); M.box(U * .12, 0, U * .76, .8, 34, 24, C.ink, .4); M.box(U * .14, .8, U * .72, .1, 35, 22, C.stone); M.set({ wall: 0 });
  }],
  [/bath|tub|shower/i, (M, U, V) => {
    M.box(0, 0, U, V, 0, 17, C.porcelain, 2.4);
    M.box(3, 3, U - 6, V - 6, 13.5, 3.8, C.water, 2);
    M.cyl(U - 7, 1.8, .8, 17, 5, C.steel, .8, 6); M.box(U - 7.6, 1.2, 1.4, 5, 21, 1, C.steel);
    M.box(5, V * .12, 12, V * .3, 17, .9, C.towel, .4);
  }],
  [/fridge/i, (M, U, V) => {
    M.box(0, 0, U, V - 1.2, 1, 70, C.steel, .9); M.box(0, V - 2, U, 2, 26, 45, C.steel, .7); M.box(0, V - 2, U, 2, 1.2, 24.4, C.steel, .7);
    for (const y of [29, 12]) M.box(U * .12, V, 1.2, 1.2, y, 13, C.ink, .4);
  }],
  [/wardrobe|closet/i, (M, U, V) => {
    M.box(0, 0, U, V, 0, 72, C.ash, .6); const n = Math.max(2, Math.round(U / 42)), w = U / n;
    for (let i = 0; i < n; i++) { M.box(i * w + .5, V - .1, w - 1, .5, 3, 67, C.oak, .1); M.box(i * w + w - 3, V + .3, .8, .9, 32, 12, C.brass); }
  }],
  [/shelf|bookcase/i, (M, U, V, r) => {
    const tall = U >= 60 || V >= 60, h = tall ? 62 : 42, D = Math.min(V, 12), levels = tall ? 4 : 3, step = (h - 3) / levels;
    M.box(0, 0, U, 1.4, 0, h, C.walnut); M.box(0, 0, 1.6, D, 0, h, C.walnut, .3); M.box(U - 1.6, 0, 1.6, D, 0, h, C.walnut, .3);
    for (let l = 0; l <= levels; l++) {
      const y = l * step + .4; M.box(0, 0, U, D, y, 1.6, C.walnut, .3); if (l === levels) break;
      for (let x = 2.5; x < U - 4;) {
        const w = 1.6 + r() * 2.2, b = step * (.55 + r() * .3);
        if (r() < .16) { x += 5 + r() * 8; continue; }
        M.box(x, 1.6, w, D - 3.2 - r() * 1.4, y + 1.6, b, SPINES[Math.floor(r() * SPINES.length)], .2); x += w + .2;
      }
    }
  }],
  [/washer|dryer/i, (M, U, V) => {
    M.box(0, 0, U, V, 0, 30, C.white, 1.1); M.box(U * .1, V - .1, U * .3, .5, 25, 3, C.ink, .2);
    const R = Math.min(U, 30) * .3; for (let i = 0; i < 3; i++) M.box(U * .55 + i * 3.4, V - .1, 2.4, .5, 26, 1.6, C.steel);
    M.set({ layer: 0 });
    // the drum's door faces front: a stack of slim rings seen from the side, built from flat discs
    door(M, U / 2, V, R, 12);
  }],
  [/island/i, (M, U, V, r) => { M.box(0, 0, U, V, 0, 29, C.walnut, .6); M.box(-1.6, -1.6, U + 3.2, V + 3.2, 29, 2.4, C.stone, .7); for (let i = 0; i < 3; i++) M.box(U * (.2 + i * .1), V * .3, U * .08, V * .3, 31.4, .7, C.ink2, .2); M.cyl(U * .76, V * .5, 4.5, 31.4, 3, C.white, 6, 14); for (let i = 0; i < 4; i++) M.blob(U * .76 + (r() - .5) * 5, 35, V * .5 + (r() - .5) * 5, 1.8, 1.8, 1.8, C.mustard, 6); }],
  [/counter|kitchen|cabinet/i, (M, U, V) => {
    M.box(0, 0, U, V, 0, 29, C.walnut, .4); const n = Math.max(2, Math.round(U / 20)), w = U / n;
    for (let i = 0; i < n; i++) { M.box(i * w + .3, V - .1, w - .6, .5, 2, 26, C.oak, .1); M.box(i * w + w / 2 - 2, V + .3, 4, .7, 25, .8, C.brass); }
    M.box(-.4, -.2, U + .8, V + 1.2, 29, 2, C.stone, .4);
    M.box(U * .14, V * .2, U * .22, V * .6, 31, .3, C.steel); M.cyl(U * .25, V * .1, .7, 31, 7, C.steel, .7, 6); M.box(U * .25 - .6, V * .1, 1.2, V * .28, 37, .9, C.steel);
    M.box(U * .56, V * .14, U * .3, V * .72, 31, .5, C.ink, .3); for (const [a, b] of [[.64, .34], [.78, .34], [.64, .66], [.78, .66]]) M.cyl(U * a, V * b, 2.4, 31.5, .4, C.charcoal, 2.4, 10);
    for (let i = 0; i < n; i++) M.box(i * w + .3, 0, w - .6, 7, 46, 22, C.walnut, .4);
  }],
  [/coffee/i, (M, U, V, r) => {
    M.box(0, 0, U, V, 11, 1.8, C.walnut, .8); M.box(2.4, 2.4, U - 4.8, V - 4.8, 4, 1, C.walnut, .3);
    for (const [a, b] of [[2.4, 2.4], [U - 2.4, 2.4], [2.4, V - 2.4], [U - 2.4, V - 2.4]]) M.cyl(a, b, 1, 0, 11, C.brass, 1, 6, false);
    coffeeThings(M, U, V, 12.8, r);
  }],
  [/dining|table/i, (M, U, V, r) => diningTable(M, 0, 0, U, V, r)],
];
function door(M: Mesher, x: number, z: number, R: number, y: number) {
  // a port on the front face: concentric discs standing upright, facing +V
  const seg = 16, ring = (r: number, off: number, c: Mat) => { for (let i = 0; i < seg; i++) {
    const a = i / seg * Math.PI * 2, b = (i + 1) / seg * Math.PI * 2;
    M.face([[x, y + R, z + off], [x + Math.cos(a) * r, y + R + Math.sin(a) * r, z + off], [x + Math.cos(b) * r, y + R + Math.sin(b) * r, z + off], [x, y + R, z + off]], [0, 0, 1], c);
  } };
  ring(R, .25, C.steel); ring(R * .78, .4, C.ink);
}

/** The base under the house, walls with their openings, floors, lamps, furniture. */
export function buildHouse(p: Layout, dock?: { x: number; z: number; a: number }) {
  const M = mesher(), b = p.bounds, pad = 16;
  // the plinth: a slab of dark glass the model stands on
  M.box(b.x - pad, b.z - pad, b.w + pad * 2, b.d + pad * 2, -16, 15.4, C.plinth, 3);
  // floors, planks along each room's long side
  for (const r of p.rooms) {
    M.set({ room: r.i });
    const mat = r.src.floor === 'tile' ? C.tile : r.box.w >= r.box.d ? C.oakFloorX : C.oakFloorZ;
    for (const f of r.floors) M.face([[f.x, 0, f.z], [f.x + f.w, 0, f.z], [f.x + f.w, 0, f.z + f.d], [f.x, 0, f.z + f.d]], [0, 1, 0], mat);
  }
  const spotOf = ([x, z]: number[]) => [Math.round((x - b.x) / b.w * 255), Math.round((z - b.z) / b.d * 255)], along = (w: Wall, s: number) => w.along === 'x' ? [s, w.at] : [w.at, s];
  const sideOf = (i: number) => ({ room: i, mat: i ? C.plaster : C.outside });
  const piece = (w: Wall, from: number, to: number, y0: number, y1: number, kill: number, capA = false, capB = false) => {
    // a run of wall, cut into short lengths so the sloping cutaway stays straight
    const T = THICK / 2, n = Math.max(1, Math.round((to - from) / 26)), [A, B] = [sideOf(w.a), sideOf(w.b)];
    const pt = (s: number, c: number, y: number) => w.along === 'x' ? [s, y, w.at + c] : [w.at + c, y, s];
    const nr = (c: number) => w.along === 'x' ? [0, 0, c] : [c, 0, 0];
    M.set({ wall: kill || 1 });
    for (let i = 0; i < n; i++) {
      const s = from + (to - from) * i / n, e = from + (to - from) * (i + 1) / n;
      M.set({ room: A.room }); M.face([pt(s, -T, y0), pt(e, -T, y0), pt(e, -T, y1), pt(s, -T, y1)], nr(-1), A.mat);
      M.set({ room: B.room }); M.face([pt(s, T, y0), pt(e, T, y0), pt(e, T, y1), pt(s, T, y1)], nr(1), B.mat);
      M.set({ room: w.a || w.b }); M.face([pt(s, -T, y1), pt(e, -T, y1), pt(e, T, y1), pt(s, T, y1)], [0, 1, 0], C.cap);
    }
    const end = (s: number, sign: number) => { const nn = w.along === 'x' ? [sign, 0, 0] : [0, 0, sign]; M.set({ room: w.a || w.b }); M.face([pt(s, -T, y0), pt(s, T, y0), pt(s, T, y1), pt(s, -T, y1)], nn, C.plaster); };
    if (capA) end(from, -1); if (capB) end(to, 1);
    M.set({ wall: 0 });
  };
  const skirt = (w: Wall, from: number, to: number) => {
    for (const [i, c] of [[w.a, -1], [w.b, 1]] as const) if (i) {
      M.set({ room: i });
      const o = c * (THICK / 2 + .5), [x, z, W, D] = w.along === 'x' ? [from, w.at + o - .5, to - from, 1] : [w.at + o - .5, from, 1, to - from];
      M.box(x, z, W, D, 0, 4.4, C.skirting);
    }
  };
  p.walls.forEach((w, n) => {
    const gaps = p.gaps.filter(g => g.wall === n).sort((a, b) => a.from - b.from);
    // corners overlap by half a wall; a wall carrying straight on into the next doesn't
    const joins = (at: number) => p.walls.some(o => o !== w && o.along === w.along && o.at === w.at && (o.from === at || o.to === at));
    let s = w.from - (joins(w.from) ? 0 : THICK / 2 - .3), open = false;
    for (const g of gaps) {
      if (g.from > s) { piece(w, s, g.from, 0, WALL, 0, open && g.kind !== 'window', g.kind !== 'window'); skirt(w, s, g.from); }
      if (g.kind === 'window') window_(w, g); else if (g.kind === 'door') doorLeaf(w, g);
      s = g.to; open = g.kind !== 'window';
    }
    const e = w.to + (joins(w.to) ? 0 : THICK / 2 - .3);
    if (e > s) { piece(w, s, e, 0, WALL, 0, open); skirt(w, s, e); }
  });
  function window_(w: Wall, g: Gap) {
    const S = 22, T = 66, room = w.a || w.b, H = THICK / 2;
    piece(w, g.from, g.to, 0, S, 0); skirt(w, g.from, g.to); M.set({ spot: spotOf(along(w, (g.from + g.to) / 2)) }); piece(w, g.from, g.to, T, WALL, T);
    const pt = (s: number, c: number, y: number) => w.along === 'x' ? [s, y, w.at + c] : [w.at + c, y, s];
    const sign = w.a ? 1 : -1, nr = w.along === 'x' ? [0, 0, sign] : [sign, 0, 0];
    M.set({ room, wall: S + 2, spot: spotOf(along(w, (g.from + g.to) / 2)) });
    // a frame and a glazing bar, then the pane
    const n = Math.max(1, Math.round((g.to - g.from) / 30)), step = (g.to - g.from) / n;
    for (let i = 0; i <= n; i++) { const s = g.from + i * step, [x, z, W, D] = w.along === 'x' ? [s - .8, w.at - 1.2, 1.6, 2.4] : [w.at - 1.2, s - .8, 2.4, 1.6]; M.box(x, z, W, D, S, T - S, C.ink); }
    for (const y of [S, (S + T) / 2, T - 1.6]) { const [x, z, W, D] = w.along === 'x' ? [g.from, w.at - 1.2, g.to - g.from, 2.4] : [w.at - 1.2, g.from, 2.4, g.to - g.from]; M.box(x, z, W, D, y, 1.6, C.ink); }
    const [x, z, W, D] = w.along === 'x' ? [g.from - 1, w.at + sign * H * .4 - .9 * 1, g.to - g.from + 2, 1.8] : [w.at + sign * H * .4 - .9, g.from - 1, 1.8, g.to - g.from + 2];
    M.box(x, z, W, D, S - 1.2, 1.2, C.white, .3);
    M.set({ layer: 2 });
    const a = pt(g.from, 0, S), b2 = pt(g.to, 0, S), c = pt(g.to, 0, T), d = pt(g.from, 0, T);
    M.face([a, b2, c, d], nr, C.glass);
    M.set({ layer: 0, wall: 0 });
  }
  function doorLeaf(w: Wall, g: Gap) {
    // a slab of oak, standing open against the room on the wall's high side
    const at = (g.hinge ? g.from + 1 : g.to - 3), len = g.to - g.from - 3, c = w.at + THICK / 2, side = w.b ? w.b : w.a;
    M.set({ room: side, wall: 1 });
    if (w.along === 'x') { M.box(at, c, 2, len, 0, 68, C.ash, .3); M.cyl(at + (g.hinge ? 2.8 : -.8), c + len - 4, .8, 31, 1.2, C.brass, .8, 6); }
    else { M.box(c, at, len, 2, 0, 68, C.ash, .3); M.cyl(c + len - 4, at + (g.hinge ? 2.8 : -.8), .8, 31, 1.2, C.brass, .8, 6); }
    M.set({ wall: 0 });
  }
  // art on the tall walls, one per room, wherever there's clear wall
  p.rooms.forEach(r => {
    const w = p.walls.map((w, n) => ({ w, n })).filter(({ w }) => (w.a === r.i || w.b === r.i) && w.to - w.from > 70 && !p.gaps.some(g => g.wall === p.walls.indexOf(w) && g.kind !== 'window')).sort((a, b) => (b.w.to - b.w.from) - (a.w.to - a.w.from))[0];
    if (!w || r.src.floor === 'tile') return;
    const free = !p.furniture.some(f => /wardrobe|closet|fridge|shelf|bookcase/i.test(f.type) && (w.w.along === 'x' ? Math.abs(f.z + f.d / 2 - w.w.at) < 40 && f.x < w.w.to && f.x + f.w > w.w.from : Math.abs(f.x + f.w / 2 - w.w.at) < 40 && f.z < w.w.to && f.z + f.d > w.w.from));
    if (!free || p.gaps.some(g => g.wall === w.n)) return;
    const c = (w.w.from + w.w.to) / 2, side = w.w.a === r.i ? -1 : 1, o = side * (THICK / 2 + .3), W = 40, Hh = 26, y = 42;
    M.set({ room: r.i, wall: y + Hh + 2, spot: spotOf(along(w.w, c)) });
    const rect = (l: number, off: number, top: number, h: number, mat: Mat) => w.w.along === 'x' ? M.box(c - l / 2, w.w.at + o - off / 2, l, off, top, h, mat) : M.box(w.w.at + o - off / 2, c - l / 2, off, l, top, h, mat);
    const palette = [C.rust, C.sage, C.mustard, C.ink2];
    rect(W, 1, y, Hh, C.ink); rect(W - 2.4, 1.3, y + 1.2, Hh - 2.4, C.paper);
    for (let i = 0; i < 3; i++) rect(8 - i, 1.6, y + 5 + i * 2, 10 - i * 2, palette[(r.i + i) % 4]);
    M.set({ wall: 0 });
  });
  // the lights' fittings don't cast shadows: the light is inside them
  M.set({ layer: 1 });
  for (const f of p.fixtures) {
    M.set({ room: f.room, link: 0 });
    const glow = (mat: Mat) => { M.set({ link: f.emit + 1 }); return mat; };
    if (f.kind === 'lamp') {
      if (f.base) { M.cyl(f.x, f.z, 2.4, f.base, 7, C.stone, 1.2, 10, false); M.cyl(f.x, f.z, 3.2, f.base, .8, C.ink, 3.2, 12); M.cyl(f.x, f.z, 5.6, f.base + 9, 8, glow(C.shade), 3.8, 16, false); }
      else { M.cyl(f.x, f.z, 6.5, 0, .9, C.ink, 6.5, 16); M.cyl(f.x, f.z, .7, 0, 40, C.brass, .7, 6, false); M.cyl(f.x, f.z, 9, 40, 13, glow(C.shade), 7, 18, false); }
    } else if (f.kind === 'pendant') {
      M.set({ wall: 1 }); M.cyl(f.x, f.z, .25, f.y + 6, WALL - f.y - 6, C.ink, .25, 5, false); M.set({ wall: 0 }); M.cyl(f.x, f.z, 8.5, f.y, 7, C.ink, 2, 18, false); M.cyl(f.x, f.z, 8.2, f.y + .1, .3, glow(C.bulb), 8.2, 18);
    } else if (f.kind === 'ceiling') {
      M.set({ wall: f.y + 4, spot: spotOf([f.x, f.z]) }); M.cyl(f.x, f.z, 6.6, f.y + 2, 1.4, C.white, 6.6, 16); M.cyl(f.x, f.z, 6, f.y + 1.4, .7, glow(C.bulb), 6, 16); M.set({ wall: 0 });
    } else {
      M.box(f.x - 20, f.z - .6, 40, 1.2, f.y, 1.2, glow(C.bulb), .3);
    }
    M.set({ link: 0 });
  }
  M.set({ layer: 0 });
  p.furniture.forEach((f, i) => {
    // the map's rectangle is the piece's footprint as it stands, so a quarter-turned piece swaps its sides
    const q = ((Math.round(f.angle / 90) % 4) + 4) % 4, U = q % 2 ? f.d : f.w, V = q % 2 ? f.w : f.d;
    const room = p.rooms.find(r => r.src.id === f.room);
    M.set({ room: room?.i ?? 0, link: 0 });
    const r = seeded(Math.round(Math.abs(f.x * 31 + f.z * 17)) + i * 97 + 11);
    const tv = /tv/i.test(f.type), desk = /desk/i.test(f.type);
    const screen = tv ? p.emitters.findIndex(e => e.screen && e.room === room?.i) : desk ? room?.list.find(e => e >= 0) ?? -1 : -1;
    M.at(f.x + f.w / 2, f.z + f.d / 2, q);
    if (/fridge|wardrobe|closet|shelf|bookcase/i.test(f.type)) M.set({ wall: 1 });   // what stands tall is cut with the walls
    const build = PIECES.find(([re]) => re.test(f.type))?.[1] ?? ((N: Mesher, W: number, D: number) => N.box(0, 0, W, D, 0, 18, C.oak, 1));
    // pieces are written with their origin at the corner; shift to the centre by wrapping the mesher
    const shift: Mesher = { ...M,
      box: (x, z, w, d, y, h, c, ro) => { if (screen >= 0) M.set({ link: c === C.screen ? screen + 1 : 0 }); M.box(x - U / 2, z - V / 2, w, d, y, h, c, ro); },
      cyl: (x, z, r0, y, h, c, r1, s, ca) => M.cyl(x - U / 2, z - V / 2, r0, y, h, c, r1, s, ca),
      blob: (x, y, z, rx, ry, rz, c, s) => M.blob(x - U / 2, y, z - V / 2, rx, ry, rz, c, s),
      frond: (x, y, z, a, l, w, ri, dr, c) => M.frond(x - U / 2, y, z - V / 2, a, l, w, ri, dr, c),
      face: (pts, nr, c) => M.face(pts.map(([x, y, z]) => [x - U / 2, y, z - V / 2]), nr, c),
    };
    build(shift, U, V, r);
    M.set({ link: 0, wall: 0 });
    M.at(0, 0, 0);
  });
  // the dock: a pad on the floor and a tower against the wall, its back to where the robot faces out
  if (dock) {
    const q = ((Math.round(dock.a / 90) % 4) + 4) % 4;
    M.set({ room: p.rooms.find(r => r.floors.some(f => dock.x >= f.x && dock.x <= f.x + f.w && dock.z >= f.z && dock.z <= f.z + f.d))?.i ?? 0 });
    M.at(dock.x, dock.z, q);
    M.box(-20, -13, 12, 26, 0, 22, C.ink, 2); M.box(-22, -15, 34, 30, 0, .8, C.charcoal, .4); M.box(-9, -5, 1, 10, 3, 3, C.steel, .3);
    M.at(0, 0, 0);
  }
  M.set({ room: 0 });
  return M.finish();
}

/** The robot on its own, at the origin, facing +x. Moved each frame. */
export function buildRobot() {
  const M = mesher();
  M.cyl(0, 0, 11.6, .6, 5, C.ink, 12, 28); M.cyl(0, 0, 12, 5.6, .9, C.charcoal, 11.4, 28);
  M.cyl(0, 0, 9.5, 6.3, .25, C.ink, 9.5, 26); M.cyl(1.5, 0, 3.6, 6.3, 3, C.white, 3.3, 16); M.cyl(1.5, 0, 2.2, 9.2, .4, C.ink, 2.2, 12);
  M.box(9, -5, 2.6, 10, 1, 3.4, C.steel, .4);
  return M.finish();
}
