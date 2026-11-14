// The tile view: what a card shows as a tile when it gave no headline of its own, and what a tile can do.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivedSummary, tileActions, tilesOf } from '../src/shared/tiles.ts';
import type { Card } from '../src/shared/cards.ts';

test('a card\'s own headlines come first; one without is given one from what it holds', () => {
  const own: Card = { type: 'list', title: 'Downloads', items: [{ title: 'A' }], summary: { label: 'Downloads', value: '4 MB/s' } };
  assert.deepEqual(tilesOf(own), [own.summary]);
  assert.deepEqual(tilesOf({ ...own, summaries: [{ label: 'x', value: 1 }, { label: 'y', value: 2 }] }).map(s => s.label), ['x', 'y']);
  assert.deepEqual(tilesOf(undefined), []);
  assert.deepEqual(tilesOf({ type: 'text', title: 'Note', text: 'hi' }), [], 'nothing short to say: no tile');
});

test('status: all up, or how many are down and which, with a bar for each', () => {
  const s = derivedSummary({ type: 'status', title: 'Services', items: [{ name: 'Plex', ok: true }, { name: 'Mealie', ok: false }, { name: 'Tautulli', ok: false, quiet: true }, { name: 'Sonarr', ok: true, state: 'degraded' }] })!;
  assert.deepEqual([s.value, s.sub, s.tone], ['1 down', 'Mealie', 'bad']);
  assert.deepEqual(s.marks!.map(m => m.tone), ['good', 'bad', undefined, 'warn'], 'something switched off on purpose isn\'t trouble');
  const fine = derivedSummary({ type: 'status', title: 'Services', items: [{ name: 'Plex', ok: true }, { name: 'Sonarr', ok: true }] })!;
  assert.deepEqual([fine.value, fine.sub, fine.tone], ['All up', '2 of 2 up', 'good']);
});

test('lists, shelves, controls, the calendar and the weather each say something short', () => {
  assert.deepEqual(derivedSummary({ type: 'list', title: 'Coming up', items: [{ title: 'Shōgun', meta: 'in 3 days' }, { title: 'Severance' }] }), { label: 'Coming up', icon: undefined, value: 2, sub: 'Shōgun', detail: 'in 3 days', pct: undefined, tone: undefined });
  const shelf = derivedSummary({ type: 'shelf', title: 'Recently added', items: [{ title: 'Arrival', image: '/a.jpg' }, { title: 'Dune' }] })!;
  assert.deepEqual([shelf.value, shelf.sub, shelf.image], [2, 'Arrival', '/a.jpg']);
  const lights = derivedSummary({ type: 'controls', title: 'Lights', items: [{ id: 'a', label: 'Lamp', kind: 'toggle', value: true }, { id: 'b', label: 'Fan', kind: 'toggle', value: false }] })!;
  assert.deepEqual([lights.value, lights.sub, lights.pct], ['1 on', 'of 2', .5]);
  const door = derivedSummary({ type: 'controls', title: 'Doors', items: [{ id: 'd', label: 'Front door', kind: 'value', value: 'Locked', tone: 'good' }] })!;
  assert.deepEqual([door.value, door.sub, door.tone], ['Locked', 'Front door', 'good']);
  const soon = new Date(Date.now() + 36e5).toISOString(), past = new Date(Date.now() - 2 * 36e5).toISOString();
  const cal = derivedSummary({ type: 'calendar', title: 'Week', events: [{ title: 'Over', start: past, end: past }, { title: 'Team sync', start: soon }] })!;
  assert.equal(cal.value, 'Team sync', 'the next one, not one that\'s over');
  const wx = derivedSummary({ type: 'forecast', title: 'Weather', now: { temp: 2.6, feels: 0, words: 'Cloudy', icon: 'cloud', hi: 4.2, lo: -1.4 }, hours: [] })!;
  assert.deepEqual([wx.value, wx.sub, wx.detail], ['3°', 'Cloudy', '4° / -1°']);
});

test('a tile offers its card\'s buttons and toggles, a toggle sending the opposite of where it stands', () => {
  const card: Card = { type: 'controls', title: 'Room', items: [
    { id: 'l', label: 'Lamp', kind: 'toggle', value: true, action: 'set', args: { id: 'l' } },
    { id: 'p', label: 'Scene', kind: 'button', value: 'Movie', action: 'scene', args: { id: 'movie' } },
    { id: 't', label: 'Temp', kind: 'value', value: '21°' },
    { id: 'x', label: 'Shown, no action', kind: 'toggle', value: false }],
    banner: { text: 'Paused', button: { label: 'Resume', action: 'resume' } }, buttons: [{ label: 'All off', action: 'all', args: { on: false } }] };
  assert.deepEqual(tileActions(card), [
    { label: 'Resume', action: 'resume', args: undefined },
    { label: 'All off', action: 'all', args: { on: false } },
    { label: 'Lamp', action: 'set', args: { id: 'l', value: false }, on: true },
    { label: 'Movie', action: 'scene', args: { id: 'movie' } }]);
  assert.equal(tileActions(card, 2).length, 2, 'a tile keeps to a few');
  assert.deepEqual(tileActions({ type: 'status', items: [] }), []);
});

test('a tile opens its own card by default; open: false, or another widget, by config', async () => {
  const { Config } = await import('../src/server/config.ts');
  const sec = Config.parse({ layout: [{ title: 'T', display: 'tiles', widgets: ['a.b', { widget: 'c.d', open: false }, { widget: 'e.f', open: 'home.plan' }] }] }).layout[0]!;
  assert.equal(sec.open, true, 'on unless said');
  assert.deepEqual(sec.widgets.map(w => w.open), [undefined, false, 'home.plan']);
  assert.equal(Config.parse({ layout: [{ title: 'T', display: 'tiles', open: false, widgets: [] }] }).layout[0]!.open, false);
  for (const open of ['plan', '../x', 'a.b.c', 'home.plan; x']) assert.throws(() => Config.parse({ layout: [{ title: 'T', widgets: [{ widget: 'a.b', open }] }] }), String(open));
});
