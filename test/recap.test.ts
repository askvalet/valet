// The year in review: slides come from whichever services can answer, in order, and one that can't is simply left out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRecap, clearRecap, recapYear } from '../src/server/recap.ts';
import { aboutTheYear, naming, revealing, startingStats } from '../src/web/recap.tsx';
import type { Instance } from '../src/server/core.ts';

const at = new Date(2026, 9, 30);
const inst = (recap: Instance['recap']) => ({ widgets: {}, recap }) as Instance;

test('recap: orders slides, and survives a service that fails', async () => {
  clearRecap();
  const r = await buildRecap(new Map([
    ['a', inst(async () => [{ id: 'low', kicker: 'x', value: '1', line: 'l', score: 10, stat: 'Low' }])],
    ['b', inst(async () => { throw new Error('down'); })],
    ['c', inst(async () => [{ id: 'high', kicker: 'y', value: '2', unit: 'h', line: 'l', score: 90, stat: 'High' }])],
    ['d', { widgets: {} } as Instance],
  ]), 2026, at);
  assert.deepEqual(r.slides.map(s => s.id), ['high', 'low']);
  assert.deepEqual(r.stats, [{ label: 'High', value: '2 h' }, { label: 'Low', value: '1' }]);
  assert.equal(r.soFar, true);
});

test('recap: with nothing to say it stays quiet', async () => {
  clearRecap();
  assert.deepEqual((await buildRecap(new Map(), 2024, at)).slides, []);
  assert.equal(recapYear('2031', at), 2026);
  assert.equal(recapYear('2024', at), 2024);
});

test('recap: no service runs the show, and neighbours differ', async () => {
  clearRecap();
  const many = (theme: string, score: number) => [0, 1, 2, 3, 4].map(i => ({ id: `${theme}${i}`, theme, kicker: 'k', value: '1', line: 'l', score: score - i }));
  const r = await buildRecap(new Map([['a', inst(async () => many('media', 90))], ['b', inst(async () => many('home', 50))], ['c', inst(async () => many('ai', 40))]]), 2023, at);
  assert.equal(r.slides.filter(s => s.theme === 'media').length, 3);                         // capped, however much it has to say
  assert.ok(r.slides.every((s, i) => i === 0 || s.theme !== r.slides[i - 1].theme));
  assert.equal(r.slides.length, 9);                                                            // two per theme lead, the rest follow
});

test('recap: the short story takes the slides with something to show, a theme pays for its second, and nothing is held back', async () => {
  clearRecap();
  const bare = (theme: string, score: number) => ({ id: `${theme}.count`, theme, kicker: 'k', value: '1', line: 'l', score });
  const r = await buildRecap(new Map([['a', inst(async () => [
    bare('media', 60), { id: 'media.chart', theme: 'media', kicker: 'k', value: '2', line: 'l', score: 70, chart: { pct: .5, from: 'a', to: 'b', mark: 'm' } },
    bare('home', 60), { id: 'home.bars', theme: 'home', kicker: 'k', value: '3', line: 'l', score: 55, bars: [{ label: 'a', value: 1, show: '1' }] },
    bare('files', 60), bare('ops', 58), bare('reach', 56), bare('code', 55), bare('food', 54), bare('games', 53), bare('music', 52), bare('ai', 51),
  ])]]), 2023, at);
  const ids = r.slides.map(s => s.id);
  assert.ok(ids.slice(0, 8).includes('media.chart') && !ids.slice(0, 8).includes('media.count'));   // the chart beat the bare count of the same theme
  assert.ok(ids.slice(0, 8).includes('home.bars') && !ids.slice(0, 8).includes('home.count'));
  assert.equal(ids.length, 12);                                                               // nothing lost
  clearRecap();
  const few = await buildRecap(new Map([['a', inst(async () => [bare('media', 80), bare('home', 60), bare('ai', 50)])]]), 2022, at);
  assert.deepEqual(few.slides.map(s => s.id), ['media.count', 'home.count', 'ai.count']);
});

test('recap: two themes still make a short story, and slides without one count on their own', async () => {
  clearRecap();
  const slide = (id: string, theme?: string) => ({ id, theme, kicker: 'k', value: '1', line: 'l' });
  const two = await buildRecap(new Map(['a', 'b'].map(n => [n, inst(async () => [0, 1, 2].flatMap(i => [slide(`${n}m${i}`, 'media'), slide(`${n}h${i}`, 'home')]))])), 2021, at);
  assert.equal(new Set(two.slides.slice(0, 6).map(s => s.theme)).size, 2);
  clearRecap();
  const none = await buildRecap(new Map(['a', 'b', 'c', 'd'].map(n => [n, inst(async () => [0, 1, 2].map(i => slide(`${n}${i}`)))])), 2020, at);
  assert.equal(none.slides.length, 12);
});

test('recap: the framing follows what the short story actually covers', async () => {
  const of = (scopes: (string | undefined)[], tail = false) => buildRecap(new Map([['a', inst(async () => [...scopes, ...(tail ? ['All time', 'All time', 'All time'] : [])].map((scope, i) => ({ id: `s${i}`, theme: `t${i}`, kicker: 'k', value: '1', line: 'l', scope, score: 90 - i })))]]), 2019, at);
  clearRecap();
  assert.equal(aboutTheYear(await of(['year', 'year', 'All time'])), true);
  clearRecap();
  assert.equal(aboutTheYear(await of(['year', 'All time', 'Right now', 'year'])), false);     // half is not most
  clearRecap();
  const r = await of([undefined, undefined, 'year']);
  assert.equal(r.slides[0].scope, 'Right now');                                                // unsaid doesn't get to claim the year
  assert.equal(aboutTheYear(r), false);
  clearRecap();
});

test('recap: the card offers more than it starts with, and names stay off it until asked', async () => {
  clearRecap();
  const stat = (id: string, theme: string, score: number, more = {}) => ({ id, theme, kicker: 'k', value: '5', line: 'l', score, stat: id, ...more });
  const r = await buildRecap(new Map([['a', inst(async () => [
    stat('Theo', 'media', 99, { private: true }), stat('Songs', 'music', 80), stat('Books', 'reading', 79), stat('Files', 'files', 78), stat('Rig', 'hardware', 77), stat('Bans', 'security', 76), stat('Hosts', 'reach', 75), stat('Ratio', 'network', 74),
  ])]]), 2018, at);
  assert.equal(r.stats.length, 8);
  assert.equal(r.stats.at(-1)!.label, 'Theo');
  assert.deepEqual(startingStats(r), ['Songs', 'Books', 'Files', 'Rig', 'Bans', 'Hosts']);
  const of = (label: string) => r.stats.find(s => s.label === label)!;
  assert.ok(naming(r, of('Theo')) && revealing(r, of('Theo')));
  assert.ok(revealing(r, of('Bans')) && revealing(r, of('Hosts')) && revealing(r, of('Ratio')));
  assert.ok(!revealing(r, of('Songs')));
  assert.ok(revealing(r, { label: 'Top film', value: 'Heat' }));                               // a word, not a number
});

test('recap: what only Valet can say comes from real numbers on both sides', async () => {
  clearRecap();
  const r = await buildRecap(new Map([['a', inst(async () => [
    { id: 'w', kicker: 'k', value: '20', line: 'l', facts: { watchedHours: 25 }, art: ['/p1'] },
    { id: 'l', kicker: 'k', value: '9', line: 'l', theme: 'media', facts: { libraryHours: 2500, uploadedBytes: 2 ** 40 }, items: [{ name: 'x', image: '/p2' }] }])]]), 2026, at);
  assert.match(r.slides.find(s => s.id === 'backlog')!.value, /^21\d\d$/);        // 2500 h at about 30 h a year
  const aws = r.slides.find(s => s.id === 'aws')!;
  assert.equal(aws.value, '$92');
  assert.match(aws.kicker, /^If that traffic had come from AWS at list price/);
  assert.match(aws.line, /illustrative transfer cost, not a saving/);
  assert.deepEqual(r.wall, ['/p1', '/p2']);
});

test('recap: the card does not count things twice', async () => {
  clearRecap();
  const r = await buildRecap(new Map([['a', inst(async () => [{ id: 'a', kicker: '', value: '18,422', unit: 'songs', stat: 'Songs', line: '', theme: 'music' }])]]), 2026, new Date(Date.UTC(2026, 5, 1)));
  assert.deepEqual(r.stats, [{ label: 'Songs', value: '18,422' }]);
});
