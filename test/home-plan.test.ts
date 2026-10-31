import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanData, PlanLight } from '../src/web/visuals/home-model.ts';
import { buildHouse } from '../src/web/visuals/home-mesh.ts';
import { plan, roomAt } from '../src/web/visuals/home-plan.ts';
import { createRobot } from '../src/web/visuals/home-robot.ts';

const light = (id: string, name = id, extra: Partial<PlanLight> = {}): PlanLight => ({ id, name, on: true, available: true, level: 80, canColor: false, canTemp: false, dims: true, ...extra });
// as a vacuum's map draws it: an L-shaped bedroom whose box covers its en-suite, and rooms that stop short of each other
const home: PlanData = {
  rooms: [
    { id: 1, name: 'Bedroom', floor: 'wood', x: -200, z: -150, w: 240, d: 300, lights: [light('l.bed', 'Bedside lamp')] },
    { id: 2, name: 'Bathroom', floor: 'tile', x: -60, z: 40, w: 100, d: 110, lights: [] },
    { id: 3, name: 'Living Room', floor: 'wood', x: 46, z: -150, w: 150, d: 180, lights: [light('l.tv', 'TV backlight'), light('l.a'), light('l.b')] },
    { id: 4, name: 'Kitchen', floor: 'tile', x: 46, z: 30, w: 150, d: 120, lights: [light('l.k', 'Over the table', { kind: 'pendant', at: { x: 120, z: 90 } })] },
  ],
  furniture: [{ type: 'Nightstand', room: 1, angle: 270, x: -190, z: -20, w: 20, d: 20 }, { type: 'Double bed', room: 1, angle: 270, x: -190, z: -110, w: 100, d: 80 },
    { type: 'TV Cabinet', room: 3, angle: 90, x: 170, z: -100, w: 20, d: 70 }, { type: 'Dining Table and Chairs', room: 4, angle: 90, x: 90, z: 60, w: 40, d: 60 }],
  dock: { x: 30, z: -130, a: 180 },
  robot: { x: 30, z: -130, a: 0, id: 'vacuum.r', state: 'cleaning', fanSpeeds: [], wear: [] },
};

test('the smaller room wins where boxes overlap, and gaps between rooms close', () => {
  const p = plan(home);
  assert.equal(roomAt(p, 0, 100), 2);                      // inside the bedroom's box, but it's the bathroom
  assert.equal(roomAt(p, -100, 100), 1);
  assert.equal(roomAt(p, 43, -100) > 0, true);             // the hairline between bedroom and living room
  assert.equal(roomAt(p, 500, 500), 0);
});

test('every room can be reached, and open-plan rooms flow into each other', () => {
  const p = plan(home), seen = new Set([1]);
  for (let i = 0; i < 4; i++) for (const g of p.gaps) { const w = p.walls[g.wall]; if (g.kind !== 'window' && (seen.has(w.a) || seen.has(w.b))) { seen.add(w.a); seen.add(w.b); } }
  assert.equal(seen.size, 4);
  assert.ok(p.gaps.some(g => g.kind === 'open'));
  assert.ok(p.gaps.some(g => g.kind === 'window'));
});

test('lights find their furniture, and shadows stop at the walls the plan knows about', () => {
  const p = plan(home), f = (id: string) => p.fixtures.find(x => x.id === id)!;
  assert.equal(f('l.bed').kind, 'lamp'); assert.equal(f('l.bed').base, 17);   // on the nightstand
  assert.equal(f('l.tv').kind, 'strip'); assert.equal(f('l.tv').x, 180);      // behind the TV
  assert.deepEqual([f('l.k').x, f('l.k').z], [120, 90]);
  for (const r of p.rooms) assert.ok(r.list.length <= 8);
  assert.ok(p.emitters.length <= 32);
});

test('a home with no plan still has a house, and an empty one has nothing to break', () => {
  const bare = plan({ rooms: [{ id: 1, name: 'A', lights: [light('x')] } as never, { id: 2, name: 'B', lights: [] } as never] });
  assert.equal(bare.rooms.every(r => r.floors.length > 0), true);
  assert.equal(bare.fixtures.length, 1);
  const none = plan({ rooms: [] });
  assert.equal(none.rooms.length, 0);
  assert.ok(buildHouse(none).count > 0);
});

test('the house stays one small mesh', () => {
  const m = buildHouse(plan(home), home.dock);
  assert.ok(m.index.length / 3 < 60_000, `${m.index.length / 3} triangles`);
  assert.ok(m.cast <= m.solid && m.solid <= m.index.length);
});

test('a robot with no position to report sweeps the floor, around the furniture and through the doors', () => {
  const p = plan(home), bot = createRobot(p, home.dock), rooms = new Set<number>(); let moved = 0, x = bot.pose.x, z = bot.pose.z;
  for (let i = 0; i < 60 * 900; i++) {
    const q = bot.step(1 / 60, home.robot); moved += Math.hypot(q.x - x, q.z - z); x = q.x; z = q.z;
    rooms.add(roomAt(p, x, z));
    for (const f of p.furniture.filter(f => /bed|tv/i.test(f.type))) assert.ok(!(x > f.x && x < f.x + f.w && z > f.z && z < f.z + f.d), 'drove through furniture');
  }
  assert.ok(moved > 3000, `moved ${moved}`);
  assert.ok(rooms.size >= 3, `only reached ${[...rooms]}`);
});

test('a live map moves the robot; docked it goes home', () => {
  const p = plan(home), bot = createRobot(p, home.dock), r = { ...home.robot!, x: 120, z: -60, state: 'cleaning' };
  bot.step(1 / 60, home.robot);
  for (let i = 0; i < 600; i++) bot.step(1 / 60, r);
  assert.ok(Math.hypot(bot.pose.x - 120, bot.pose.z + 60) < 14, `${bot.pose.x},${bot.pose.z}`);
  for (let i = 0; i < 60 * 60; i++) bot.step(1 / 60, { ...r, state: 'docked' });
  assert.ok(Math.hypot(bot.pose.x - 30, bot.pose.z + 130) < 4, `${bot.pose.x},${bot.pose.z}`);
});
