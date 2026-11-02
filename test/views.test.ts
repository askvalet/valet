import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CardSchema } from '../src/shared/cards.schema.ts';
import { asView, VIEWS } from '../src/shared/views.ts';
import { Config } from '../src/server/config.ts';
import type { Card } from '../src/shared/cards.ts';

const plays: Card = { type: 'chart', title: 'Plays', unit: 'play', from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 3), series: [{ name: 'TV', points: [1, 2, 3] }, { name: 'Film', points: [4, 0, 1] }] };
const race: Card = { type: 'race', title: 'Year', unit: 'h', steps: ['Jan', 'Feb'], items: [{ title: 'Bluey', image: '/a.jpg', points: [1, 5] }, { title: 'Dune', image: '/b.jpg', points: [2, 3] }] };
const ranked: Card = { type: 'ranked', title: 'Most watched', items: [{ title: 'Bluey', value: '12 plays', image: '/a.jpg' }, { title: 'Dune', value: '3 plays', image: '/b.jpg' }] };
const heat: Card = { type: 'heatmap', title: 'Viewing', from: '2026-01-01', days: [1, 0, 2], unit: 'play' };
const pie: Card = { type: 'stats', title: 'Disk', items: [], pie: [{ label: 'Films', value: 7 }, { label: 'TV', value: 3 }] };
const shelf: Card = { type: 'shelf', title: 'New', items: [{ title: 'A', image: '/a.jpg' }, { title: 'B', image: '/b.jpg' }, { title: 'C' }] };
const photos: Card = { type: 'photos', title: 'Memories', items: [{ image: '/p.jpg', title: 'Lisbon' }] };

test('any numbers can be any chart, and what comes out is a valid card', () => {
  for (const card of [plays, race, ranked, heat, pie]) for (const view of ['line', 'bars', 'stream', 'race', 'ranked', 'pie'] as const) {
    const out = asView(card, view);
    assert.notEqual(out, card, `${card.type} as ${view}`);
    CardSchema.parse(out);
  }
  assert.equal((asView(plays, 'bars') as any).style, 'bars');
  assert.deepEqual((asView(plays, 'race') as any).items[0].points, [1, 3, 6]);        // per point adds up as it runs
  assert.deepEqual((asView(race, 'ranked') as any).items.map((i: any) => i.title), ['Bluey', 'Dune']);
  assert.deepEqual((asView(ranked, 'bars') as any).labels, ['Bluey', 'Dune']);
  assert.deepEqual((asView(plays, 'heatmap') as any).days, [5, 2, 4]);
  assert.deepEqual((asView(race, 'bars') as any).series[0].points, [1, 4]);          // a race's running totals aren't counted twice
  assert.equal((asView(race, 'ranked') as any).items[0].value, '5 h');
  assert.deepEqual((asView(race, 'race') as any).items[0].points, [1, 5]);
});

test('a heatmap needs dates: without them the card stays as it was', () => {
  assert.equal(asView(ranked, 'heatmap'), ranked);
  assert.equal(asView(race, 'heatmap'), race);
  CardSchema.parse(asView(plays, 'heatmap'));
});

test('anything with pictures can be any gallery', () => {
  for (const card of [shelf, photos, ranked, race]) for (const view of ['row', 'spotlight', 'coverflow', 'desk', 'windows', 'tickets', 'mosaic', 'flashback'] as const) CardSchema.parse(asView(card, view));
  assert.equal((asView(photos, 'coverflow') as any).layout, 'coverflow');
  assert.equal((asView(shelf, 'mosaic') as any).items.length, 2);                     // only what has a picture
  assert.equal((asView(shelf, 'row') as any).layout, undefined);
});

test('a view that doesn\'t fit leaves the card alone; the same card gives the same object', () => {
  const text: Card = { type: 'text', text: 'hi' };
  for (const v of VIEWS) assert.equal(asView(text, v), text);
  assert.equal(asView(plays, 'bars'), asView(plays, 'bars'));
  assert.equal(asView(plays), plays);
});

test('a widget takes a view in the config, and only a real one', () => {
  const c = Config.parse({ layout: [{ widgets: [{ widget: 'plex.top', view: 'coverflow' }] }] });
  assert.equal(c.layout[0].widgets[0].view, 'coverflow');
  assert.throws(() => Config.parse({ layout: [{ widgets: [{ widget: 'plex.top', view: 'sideways' }] }] }));
});
