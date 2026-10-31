// The year in review: slides come from whichever services can answer, in order, and one that can't is simply left out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRecap, clearRecap, recapYear } from '../src/server/recap.ts';
import type { Instance } from '../src/server/core.ts';

const at = new Date(2026, 9, 30);
const inst = (recap: Instance['recap']) => ({ widgets: {}, recap }) as Instance;

test('recap: orders slides, takes the strongest trait, and survives a service that fails', async () => {
  clearRecap();
  const r = await buildRecap(new Map([
    ['a', inst(async () => [{ id: 'low', kicker: 'x', value: '1', line: 'l', score: 10, stat: 'Low', trait: { name: 'Weak', line: 'w', strength: .2 } }])],
    ['b', inst(async () => { throw new Error('down'); })],
    ['c', inst(async () => [{ id: 'high', kicker: 'y', value: '2', unit: 'h', line: 'l', score: 90, stat: 'High', trait: { name: 'Strong', line: 's', strength: .9 } }])],
    ['d', { widgets: {} } as Instance],
  ]), 2026, undefined, at);
  assert.deepEqual(r.slides.map(s => s.id), ['high', 'low']);
  assert.equal(r.persona.name, 'Strong');
  assert.deepEqual(r.stats, [{ label: 'High', value: '2 h' }, { label: 'Low', value: '1' }]);
  assert.equal(r.soFar, true);
});

test('recap: with nothing to say it stays quiet, and titles never reach the model', async () => {
  clearRecap();
  let seen = ''; const ask = async (s: string, p: string) => { seen = s + p; return '"A fine year."'; };
  const r = await buildRecap(new Map([['a', inst(async () => [{ id: 't', kicker: 'k', value: '9', line: 'l', stat: 'Plays', items: [{ name: 'Secret Title' }] }])]]), 2025, ask, at);
  assert.equal(r.closing, 'A fine year.');
  assert.doesNotMatch(seen, /Secret Title/);
  clearRecap();
  assert.deepEqual((await buildRecap(new Map(), 2024, undefined, at)).slides, []);
  assert.equal(recapYear('2031', at), 2026);
  assert.equal(recapYear('2024', at), 2024);
});
