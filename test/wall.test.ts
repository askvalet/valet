// The wall display's config: its own pages, checked like the main layout, and the line a paired screen can't cross.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/server/config.ts';
import { check } from '../src/server/site.ts';
import { registry } from '../src/integrations/index.ts';
import { wallPages, wallReads, wallWidgets } from '../src/server/wall.ts';
import { wallCell } from '../src/web/grid.ts';

const base = { integrations: { a: { type: 'api', url: 'http://127.0.0.1:9/a', stats: [{ label: 'X', value: 'x' }] }, b: { type: 'api', url: 'http://127.0.0.1:9/b', stats: [{ label: 'Y', value: 'y' }] } }, layout: [{ widgets: ['a.data', 'b.data'] }] };

test('no wall block: one default page, sensible settings, nothing to poll', () => {
  const c = Config.parse(base);
  assert.deepEqual(wallPages(c), []);
  assert.equal(c.wall.every, 60_000); assert.equal(c.wall.awake, true);
  assert.deepEqual(c.wall.night, { from: 'sunset', to: 'sunrise', dim: .9 });
});

test('pages take the main layout\'s syntax, and layout is one page', () => {
  const c = Config.parse({ ...base, wall: { every: '45s', pages: [{ title: 'Hall', every: '2m', layout: [{ widgets: [{ widget: 'b.data', size: 'large' }] }] }] } });
  assert.equal(c.wall.every, 45_000); assert.equal(wallPages(c)[0].every, 120_000);
  assert.deepEqual(wallWidgets(c), ['b.data']);
  assert.deepEqual(wallWidgets(Config.parse({ ...base, wall: { layout: [{ widgets: ['a.data'] }] } })), ['a.data']);
  for (const wall of [{ pages: [], }, { pages: [{ layout: [] }] }, { layout: [{ widgets: ['a.data'] }], pages: [{ layout: [{ widgets: ['a.data'] }] }] }, { night: { from: '25:00' } }, { token: 'short' }, { every: 'soon' }, { buttons: true }])
    assert.equal(Config.safeParse({ ...base, wall }).success, false, JSON.stringify(wall));
});

test('config check names a wall card that doesn\'t exist, and polls the real ones', () => {
  const { problems, placed } = check(Config.parse({ ...base, layout: [], wall: { pages: [{ title: 'Hall', layout: [{ widgets: ['a.data', 'a.nope', 'c.data'], chat: true }] }] } }), registry, new Set());
  assert.ok(problems.some(p => /wall\.pages\[0\] \(Hall\): no widget "a\.nope"/.test(p)), problems.join('\n'));
  assert.ok(problems.some(p => /no widget "c\.data"/.test(p)));
  assert.ok(problems.some(p => /chat never shows on a wall/.test(p)));
  assert.ok(placed.has('a.data'));
});

test('a paired screen hears its pages\' cards and the weather, and nothing else', () => {
  const own = Config.parse({ ...base, weather: 'b.data', wall: { layout: [{ widgets: ['a.data'] }] } });
  assert.equal(wallReads(own, { key: 'a.data' }), true);
  assert.equal(wallReads(own, { key: 'b.data' }), true);
  assert.equal(wallReads(own, { key: 'c.data', card: { type: 'status', items: [] } }), false);
  // the default page: main-page cards, and only the kinds it shows
  const auto = Config.parse(base);
  assert.equal(wallReads(auto, { key: 'a.data', card: { type: 'status', items: [] } }), true);
  assert.equal(wallReads(auto, { key: 'a.data', card: { type: 'media', items: [] } }), true);
  assert.equal(wallReads(auto, { key: 'a.data', card: { type: 'text', text: 'x' } as never }), false);
  assert.equal(wallReads(auto, { key: 'a.data' }), false);
  assert.equal(wallReads(auto, { key: 'z.data', card: { type: 'status', items: [] } }), false);
});

test('a wall page lays out like the main page: columns per screen, and a card\'s own cols and rows', () => {
  const c = Config.parse({ ...base, wall: { pages: [{ layout: [{ columns: { phone: 1, tablet: 2, desktop: 4 }, widgets: [{ widget: 'a.data', cols: 2, rows: 2 }, 'b.data'] }] }] } });
  assert.deepEqual(wallPages(c)[0].layout[0].columns, { phone: 1, tablet: 2, desktop: 4 });
  // on a section's own columns, a card spans its cols and rows (never past the last column), and one column otherwise
  assert.deepEqual(wallCell(undefined, { cols: 2, rows: 2 }, true), { style: { gridColumn: 'span min(2, var(--tracks, 6))', gridRow: 'span 2' } });
  assert.deepEqual(wallCell(undefined, undefined, true), { style: { gridColumn: 'span min(1, var(--tracks, 6))', gridRow: 'span 1' } });
  assert.deepEqual(wallCell(undefined, { rows: 2 }, true).style, { gridColumn: 'span min(1, var(--tracks, 6))', gridRow: 'span 2' });
  assert.deepEqual(wallCell('tall', undefined, true).style, { gridColumn: 'span min(2, var(--tracks, 6))', gridRow: 'span 2' });
  // on the bento, sizes keep their classes, and cols places a card by number there too
  assert.deepEqual(wallCell('large', { rows: 2 }, false), { className: 'col-span-full @5xl/main:col-span-4', style: { gridRow: 'span 2' } });
  assert.deepEqual(wallCell(undefined, undefined, false), { className: 'col-span-2', style: undefined });
  assert.deepEqual(wallCell('medium', { cols: 3 }, false).style, { gridColumn: 'span min(3, var(--tracks, 6))', gridRow: 'span 1' });
});
