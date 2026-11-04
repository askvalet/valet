// Surgical config edits: a list entry keeps its dash when its first key changes, and diffs fold what didn't.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { applyOps, diff } from '../src/server/yaml-edit.ts';

test('diff: each change with a line either side, and the unchanged stretch between two changes folded', () => {
  assert.equal(diff('a\nb\nc\nd\ne\nf\ng', 'a\nB\nc\nd\ne\nF\ng'), '  a\n- b\n+ B\n  c\n  …\n  e\n- f\n+ F\n  g');
  assert.equal(diff('a\nb', 'a\nb'), '');
});

test('applyOps: a list entry\'s first key can be replaced or removed without losing its dash', () => {
  const text = 'layout:\n  - title: A   # a\n    widgets:\n      - x.a\n  - title: B\n    widgets: [x.b]\n';
  assert.equal(applyOps(text, [{ op: 'remove', path: ['layout', 0, 'title'] }]), 'layout:\n  - widgets:\n      - x.a\n  - title: B\n    widgets: [x.b]\n');
  assert.deepEqual(parse(applyOps(text, [{ op: 'set', path: ['layout', 0], value: { title: 'B', widgets: ['x.b'] } }])).layout[0], { title: 'B', widgets: ['x.b'] });
  assert.equal(parse(applyOps(text, [{ op: 'set', path: ['layout', 0, 'icon'], value: 'home' }])).layout.length, 2);
  assert.equal(parse(applyOps(text, [{ op: 'set', path: ['layout', 0, 'icon'], value: 'home' }])).layout[0].icon, 'home');
});
