// The map's drawing: a tree that never loses a node, a long list folded into "+12 containers", and the row/heading choice
// made from the width alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { TooltipProvider } from '../src/web/components/ui/tooltip.tsx';
import { moreOf, NetMap, rowWidth, shownOf, treeOf } from '../src/web/netmap.tsx';
import { SAMPLES } from '../src/web/samples.ts';
import type { MapCard, MapNode } from '../src/shared/cards.ts';

test('a parent that is missing, or a loop, puts the node at the top instead of losing it', () => {
  const t = treeOf([{ id: 'a', label: 'A', kind: 'host', parent: 'b' }, { id: 'b', label: 'B', kind: 'host', parent: 'a' }, { id: 'c', label: 'C', kind: 'service', parent: 'gone' }, { id: 'd', label: 'D', kind: 'service', parent: 'c' }]);
  assert.deepEqual(t.top.map(n => n.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(t.kids.get('c')?.map(n => n.id), ['d']);
});

test('what is folded says what it is', () => {
  const ct = (id: string): MapNode => ({ id, label: id, kind: 'container' });
  assert.equal(moreOf([ct('a'), ct('b')]), '+2 containers');
  assert.equal(moreOf([ct('a')]), '+1 container');
  assert.equal(moreOf([ct('a'), { id: 'v', label: 'v', kind: 'vm' }]), '+2 more');
  assert.ok(shownOf(true, false, 2) < shownOf(false, false, 2) && shownOf(false, false, 2) < shownOf(false, true, 2));
  assert.ok(shownOf(false, false, 6) < shownOf(false, false, 2));
});

test('machines sit in one row while they fit at their narrowest', () => {
  assert.equal(rowWidth([1]), 150);
  assert.equal(rowWidth([3]), 3 * 150 + 2 * 12);
  assert.equal(rowWidth([2, 1]), 2 * 150 + 12 + 28 + 150);
});

test('the sample draws every machine, folds the long one, and reads as a group', () => {
  const card = SAMPLES.find(s => s.name === 'map')!.card as MapCard;
  const html = renderToString(<TooltipProvider><NetMap card={card} /></TooltipProvider>);
  for (const n of ['Internet', 'Local network', 'Server', 'NAS', 'Pi', 'Weather']) assert.ok(html.includes(`>${n}<`), n);
  assert.match(html, /\+\d+ containers/);
  assert.ok(html.includes('role="group"') && html.includes('aria-label="Network"'));
  assert.ok(html.includes('href="http://10.0.0.20:8989"'));
  const empty = renderToString(<TooltipProvider><NetMap card={{ type: 'map', nodes: [], empty: 'Nothing yet' }} /></TooltipProvider>);
  assert.ok(empty.includes('Nothing yet'));
});
