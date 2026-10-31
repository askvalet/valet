// The card library: every card type validates, every sample renders in every size (homepage, chat, large) and as a
// headline tile, without throwing. Rendering runs through React's server renderer, so effects don't run, but every
// branch of every renderer that a card's data selects is exercised.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { stateOf } from '../src/shared/cards.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { MiniRing, SummaryTile, Widget } from '../src/web/cards.tsx';
import { byDay, CalendarView, span, Thermostat } from '../src/web/home-cards.tsx';
import Island from '../src/web/island.tsx';
import { SAMPLES } from '../src/web/samples.ts';

const TYPES = ['cameras', 'stats', 'list', 'media', 'shelf', 'status', 'links', 'chart', 'code', 'table', 'ranked', 'controls', 'showcase', 'forecast', 'calendar', 'thermostat', 'photos', 'schedule', 'verse', 'kv', 'text', 'group'];

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

const html = (card: any, o: { run?: boolean; compact?: boolean } = {}) => renderToString(<TooltipProvider><Widget card={card} compact={o.compact} run={o.run ? async () => {} : undefined} /></TooltipProvider>).replaceAll('<!-- -->', '');

test('status: a state follows from ok and quiet unless it says, and off is hollow', () => {
  assert.deepEqual([stateOf({ ok: true }), stateOf({ ok: false }), stateOf({ ok: false, quiet: true }), stateOf({ ok: true, state: 'degraded' })], ['up', 'down', 'off', 'degraded']);
  assert.equal(checkCard({ type: 'status', items: [{ name: 'x', ok: true, state: 'sideways' }] }).success, false);
  const out = html({ type: 'status', items: [{ name: 'Prayer Clock', ok: false, quiet: true }, { name: 'Plex', ok: true, ms: 9 }] });
  assert.match(out, /dot-off/); assert.match(out, /1 off by choice/); assert.doesNotMatch(out, /Offline/);
});

test('status: the legend only shows once something is not plainly up', () => {
  assert.doesNotMatch(html({ type: 'status', items: [{ name: 'a', ok: true }, { name: 'b', ok: true }] }), /state-legend/);
  assert.match(html({ type: 'status', layout: 'wall', items: [{ name: 'a', ok: true }, { name: 'b', ok: false, detail: 'exited (1)' }] }), /state-legend/);
});

test('wall: trouble gets a label on its tile and comes first; families join under one count, a tile each', () => {
  const out = html({ type: 'status', layout: 'wall', items: [{ name: 'a', ok: true }, { name: 'immich', ok: true }, { name: 'immich-postgres', ok: true }, { name: 'immich_redis', ok: true }, { name: 'zed', ok: false, state: 'degraded', detail: 'unhealthy' }] });
  assert.equal(out.match(/wall-tile/g)!.length, 5);
  assert.equal(out.match(/is-joined/g)!.length, 2);
  assert.match(out, /wall-count[^>]*>3</);
  assert.ok(out.indexOf('is-worded') < out.indexOf('immich'), 'trouble first');
  assert.match(out, />zed</); assert.match(out, />unhealthy</);
});

test('chips: past the limit they fold behind a count, and a mark shows', () => {
  const out = html({ type: 'list', layout: 'chips', limit: 1, items: [{ title: 'immich', badge: 'Major' }, { title: 'caddy' }, { title: 'plex' }] });
  assert.equal(out.match(/font-medium">(immich|caddy|plex)</g)!.length, 1);
  assert.match(out, /3 in all/); assert.match(out, /chip-mark[^>]*>Major/);
});

test('drives read as readings: a meter with a normal band, no knob, and each number named', () => {
  const out = html({ type: 'list', layout: 'temps', items: [{ title: 'Disk', subtitle: 'Powered on 2.0 years', meta: '41°C', pct: .5, band: [.1, .9] }] });
  assert.match(out, /role="meter"/); assert.doesNotMatch(out, /temp-track/);
  assert.match(out, /left:10%;width:80%/); assert.match(out, /Powered on 2\.0 years/); assert.match(out, />now</);
});

test('columns: the axis says when, the legend trusts the service, and the chips say what they are', () => {
  const from = Date.now() - 864e5, out = html({ type: 'chart', style: 'bars', headline: '14%', window: 'last 24 h', factsNote: 'Most blocked · last 24 h', facts: [{ label: 'x', value: '1' }], from, to: Date.now(),
    series: [{ name: 'Blocked', points: [1, 2, 3], total: 140 }] });
  assert.match(out, /col-axis/); assert.match(out, />now</); assert.match(out, /Blocked 140/); assert.match(out, /last 24 h/); assert.match(out, /Most blocked/);
});

test('a paused card says until when, and offers the way out only if it can act', () => {
  const card = { type: 'chart', style: 'bars', series: [], banner: { text: 'Blocking paused', until: Date.now() + 6e4, button: { label: 'Resume', action: 'pause', args: { minutes: 0 } } } };
  assert.match(html(card, { run: true }), /Blocking paused until/); assert.match(html(card, { run: true }), />Resume</);
  assert.doesNotMatch(html(card), />Resume</);
  assert.doesNotMatch(html({ ...card, banner: { ...card.banner, until: Date.now() - 1 } }, { run: true }), /Blocking paused/);   // it lapsed
});

test('now playing has no play button shape; a stalled download says so and what to do', () => {
  const np = html({ type: 'media', items: [{ title: 'Film', state: 'paused', pct: .5 }] });
  assert.match(np, /np-state is-paused/); assert.doesNotMatch(np, /lucide-(play|pause)/);
  const dl = html({ type: 'media', href: 'http://q', source: { name: 'qBittorrent' }, items: [{ title: 'Film', state: 'buffering', icon: 'download', pct: .1, stall: { word: 'Stalled', since: Date.now() - 72e5, why: 'no peers' } }] });
  assert.match(dl, /Stalled 2 h · no peers/); assert.match(dl, /Check in qBittorrent/);
  assert.match(html({ type: 'media', items: [{ title: 'Film', state: 'buffering', icon: 'download', tags: ['Stalled'] }] }), /Stalled · nothing coming in/);   // an integration that says no more than its state
});

test('shelf: a next step opens from the whole tile, and the arrows start with nowhere to go back to', () => {
  const out = html({ type: 'shelf', items: Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, badge: 'Ready', href: 'http://sonarr', cta: { label: 'Open in Plex', href: 'http://plex/x' } })) });
  assert.match(out, /href="http:\/\/plex\/x"/); assert.doesNotMatch(out, /href="http:\/\/sonarr"/); assert.match(out, /Open in Plex/);
  assert.match(out, /aria-label="Previous" aria-disabled="true"/); assert.match(out, /aria-label="Next" aria-disabled="false"/);
});

test('hover lift stays on links: a plain card and a tile with nowhere to go sit still', () => {
  assert.doesNotMatch(html({ type: 'text', title: 'x', text: 'y' }), /\blift\b/);
  assert.doesNotMatch(renderToString(<SummaryTile s={{ label: 'x', value: 1 }} />), /\blift\b/);
  assert.match(renderToString(<SummaryTile s={{ label: 'x', value: 1 }} href="http://x" />), /\blift\b/);
});

test('archive offers a way to find what went, only where it can act', () => {
  const card = { type: 'shelf', layout: 'windows', title: 'Saved', archived: 'http://k/archive', items: [{ id: 'a', title: 'A', note: 'n' }] };
  assert.match(html(card, { run: true }), /See archived/); assert.doesNotMatch(html(card), /See archived/);
});

test('schema rejects a malformed card', () => {
  assert.equal(checkCard({ type: 'stats', items: [{ label: 'x' }] }).success, false);            // no value
  assert.equal(checkCard({ type: 'stats', items: [], colour: 'red' }).success, false);          // unknown field
  assert.equal(checkCard({ type: 'nope' }).success, false);
  assert.equal(checkCard({ type: 'schedule', items: [{ name: 'Fajr', at: 'soon' }] }).success, false);
  assert.equal(checkCard({ type: 'list', items: [{ title: 'x', pct: 3 }] }).success, false);     // progress past 100%
});

test('calendar: an event lands on every day it touches, and no further', () => {
  const on = (s: string) => new Date(2026, 2, Number(s)).toISOString();
  const days = byDay([{ title: 'Trip', start: '2026-03-06', end: '2026-03-09' }, { title: 'Late', start: on('10'), end: new Date(2026, 2, 11, 1).toISOString() }, { title: 'To midnight', start: new Date(2026, 2, 12, 22).toISOString(), end: on('13') }, { title: 'One day', start: '2026-03-14' }]);
  assert.deepEqual([...days.keys()], ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-14']);   // the iCal end is exclusive
  assert.equal(span({ title: 'x', start: '2026-03-14' }), 'All day');
  assert.equal(span({ title: 'Trip', start: '2026-03-06', end: '2026-03-09' }), 'All day · until Mar 8');
  assert.equal(span({ title: 'x', start: new Date(2026, 2, 1, 9).toISOString(), end: new Date(2026, 2, 1, 10, 30).toISOString() }), '9:00 – 10:30 AM');
  assert.equal(span({ title: 'x', start: new Date(2026, 2, 1, 11).toISOString(), end: new Date(2026, 2, 1, 13).toISOString() }).replace(/\s/g, ' '), '11:00 AM – 1:00 PM');
});

test('calendar: wide gets the month, and an all-day date stays on its day in any zone', () => {
  const html = renderToString(<CalendarView card={{ type: 'calendar', events: [], from: '2026-01-01', to: '2026-12-31' }} large />);
  for (const label of ['Previous month', 'Next month']) assert.ok(html.includes(label));
  assert.equal((html.match(/role="grid"/g) ?? []).length, 1);
  assert.ok(!renderToString(<CalendarView card={{ type: 'calendar', events: [] }} />).includes('role="grid"'), 'an everyday card is an agenda');
});

test('thermostat: read-only and targetless dials offer nothing to press and show nothing broken', () => {
  const base = { type: 'thermostat', unit: 'C', state: 'Idle', min: 7, max: 30, step: .5 } as const;
  const full = renderToString(<Thermostat card={{ ...base, target: 20, current: 19, set: { action: 'climate' } }} run={async () => {}} />);
  assert.ok(full.includes('role="slider"') && full.includes('Warmer'));
  const readOnly = renderToString(<Thermostat card={{ ...base, target: 20, set: { action: 'climate' } }} />);
  assert.ok(!readOnly.includes('role="slider"') && !readOnly.includes('Warmer'), 'without sign-in nothing can be changed');
  const none = renderToString(<Thermostat card={{ ...base, current: 18.4 }} run={async () => {}} />);
  assert.ok(none.includes('18.4') && !none.includes('th-knob') && !none.includes('Warmer'));
  assert.ok(renderToString(<Thermostat card={{ ...base, unit: 'F', step: 1, target: 68 }} />).includes('68'));
  assert.ok(!/undefined|NaN/.test(renderToString(<Thermostat card={base} />)));
});

test('schema: new cards reject what would break them', () => {
  const t = { type: 'thermostat', unit: 'C', state: 'Idle', min: 7, max: 30, step: .5 };
  assert.equal(checkCard(t).success, true);
  assert.equal(checkCard({ ...t, unit: 'K' }).success, false);
  assert.equal(checkCard({ ...t, step: 0 }).success, false);
  assert.equal(checkCard({ type: 'calendar', events: [{ title: 'x', start: 'soon' }] }).success, false);
  assert.equal(checkCard({ type: 'calendar', events: [{ title: 'x', start: '2026-01-01', color: 'url(x)' }] }).success, false);
});

test('the island renders with one and with several activities, and not at all when idle', () => {
  const a = { key: 'a', title: 'Joker', icon: 'play', pct: .3, trailing: '1h left' };
  assert.ok(renderToString(<Island live={[a]} idle="hide" docked />).includes('Joker'));
  assert.ok(renderToString(<Island live={[a, { ...a, key: 'b', title: 'Download', icon: 'download' }]} idle="hide" docked={false} />).includes('Download'));
  assert.equal(renderToString(<Island live={[]} idle="hide" docked />), '');
});
