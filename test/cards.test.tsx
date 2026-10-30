// The card library: every card type validates, every sample renders in every size (homepage, chat, large) and as a
// headline tile, without throwing. Rendering runs through React's server renderer, so effects don't run, but every
// branch of every renderer that a card's data selects is exercised.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { checkCard } from '../src/shared/cards.schema.ts';
import { MiniRing, SummaryTile, Widget } from '../src/web/cards.tsx';
import Island from '../src/web/island.tsx';
import { SAMPLES } from '../src/web/samples.ts';

const TYPES = ['stats', 'list', 'media', 'shelf', 'status', 'links', 'chart', 'controls', 'showcase', 'forecast', 'photos', 'schedule', 'verse', 'kv', 'text', 'group'];

test('every card type has a sample', () => {
  const have = new Set(SAMPLES.map(s => s.card.type));
  assert.deepEqual(TYPES.filter(t => !have.has(t as never)), []);
});

for (const { name, card } of SAMPLES) {
  test(`schema accepts: ${name}`, () => {
    const r = checkCard(card);
    assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
  });
  for (const size of ['medium', 'compact', 'large'] as const) {
    test(`renders ${size}: ${name}`, () => {
      const html = renderToString(<TooltipProvider><Widget card={card} compact={size === 'compact'} large={size === 'large'} run={async () => {}} /></TooltipProvider>);
      assert.ok(html.length > 40, 'rendered almost nothing');
      assert.ok(!html.includes('undefined') && !html.includes('NaN'), `leaked "undefined"/"NaN" into the page: ${html.match(/.{40}(undefined|NaN).{20}/)?.[0]}`);
    });
  }
  for (const s of [card.summary, ...(card.summaries ?? [])].filter(Boolean)) {
    test(`renders as a tile and a ring: ${name}`, () => {
      assert.ok(renderToString(<SummaryTile s={s!} />).length > 40);
      assert.ok(renderToString(<MiniRing s={s!} />).length > 40);
    });
  }
}

test('schema rejects a malformed card', () => {
  assert.equal(checkCard({ type: 'stats', items: [{ label: 'x' }] }).success, false);            // no value
  assert.equal(checkCard({ type: 'stats', items: [], colour: 'red' }).success, false);          // unknown field
  assert.equal(checkCard({ type: 'nope' }).success, false);
  assert.equal(checkCard({ type: 'schedule', items: [{ name: 'Fajr', at: 'soon' }] }).success, false);
  assert.equal(checkCard({ type: 'list', items: [{ title: 'x', pct: 3 }] }).success, false);     // progress past 100%
});

test('the island renders with one and with several activities, and not at all when idle', () => {
  const a = { key: 'a', title: 'Joker', icon: 'play', pct: .3, trailing: '1h left' };
  assert.ok(renderToString(<Island live={[a]} idle="hide" docked />).includes('Joker'));
  assert.ok(renderToString(<Island live={[a, { ...a, key: 'b', title: 'Download', icon: 'download' }]} idle="hide" docked={false} />).includes('Download'));
  assert.equal(renderToString(<Island live={[]} idle="hide" docked />), '');
});
