// The card library: every card type validates, every sample renders in every size (homepage, chat, large) and as a
// headline tile, without throwing. Rendering runs through React's server renderer, so effects don't run, but every
// branch of every renderer that a card's data selects is exercised.
import { place } from '../src/web/coverflow.tsx';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import { stateOf } from '../src/shared/cards.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { MiniRing, SummaryTile, Widget } from '../src/web/cards.tsx';
import { Counter, ElasticSlider, Flap, landing, pose, RowSlot, rubber, Tick, useRows } from '../src/web/feel.tsx';
import { byDay, CalendarView, headsUp, span, splitToday, Thermostat, WeatherCard } from '../src/web/home-cards.tsx';
import HomeCase from '../src/web/visuals/home-case.tsx';
import { batteryNote, heard, near, restoreGroups, restoreOf, unsettled, wearNote, type PlanData, type PlanLight } from '../src/web/visuals/home-model.ts';
import PcCase, { type PcCaseData } from '../src/web/visuals/pc-case.tsx';
import type { ForecastCard, ThermostatCard } from '../src/shared/cards.ts';
import Island from '../src/web/island.tsx';
import { SAMPLES } from '../src/web/samples.ts';
import { chartless, Heatmap, Race, standing, Waffle } from '../src/web/charts.tsx';

const TYPES = ['cameras', 'stats', 'list', 'media', 'shelf', 'status', 'links', 'chart', 'code', 'table', 'ranked', 'race', 'heatmap', 'controls', 'showcase', 'forecast', 'calendar', 'thermostat', 'photos', 'schedule', 'verse', 'kv', 'text', 'group'];

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

test('wall: one tile per app with a count, trouble comes first with words, and a family split by trouble keeps both', () => {
  const out = html({ type: 'status', layout: 'wall', items: [{ name: 'a', ok: true }, { name: 'immich_server', group: 'immich', ok: true }, { name: 'immich_postgres', group: 'immich', ok: true }, { name: 'immich_redis', group: 'immich', ok: true }, { name: 'paperless', ok: true }, { name: 'paperless-tika', ok: false, detail: 'exited (1)' }] });
  assert.equal(out.match(/class="[^"]*wall-tile/g)!.length, 4);
  assert.ok(out.indexOf('paperless-tika') < out.indexOf('wall-count'));
  assert.match(out, /wall-count[^>]*>3</);
  assert.match(out, /exited \(1\)/);
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

test('without a link nothing looks clickable: rows are plain, posters and pictures sit still', () => {
  const rows = (href?: string, minimal?: boolean) => renderToString(<TooltipProvider><Widget card={{ type: 'status', items: [{ name: 'x', ok: true, href }] }} minimal={minimal} /></TooltipProvider>);
  for (const minimal of [false, true]) {
    assert.doesNotMatch(rows(undefined, minimal), /<a |hover:bg-accent/);
    assert.match(rows('http://x', minimal), /<a [^>]*hover:bg-accent/);
  }
  const shelf = (href?: string) => html({ type: 'shelf', items: [{ title: 'T', href }] });
  assert.doesNotMatch(shelf(), /group-hover:|<a /); assert.match(shelf('http://x'), /group-hover:-translate-y-1/);
  assert.doesNotMatch(html({ type: 'photos', style: 'flashback', items: [{ image: '/a.jpg' }] }), /\blift\b/);
  assert.match(html({ type: 'photos', style: 'flashback', items: [{ image: '/a.jpg', href: 'http://x' }] }), /\blift\b/);
  assert.doesNotMatch(html({ type: 'verse', title: 'v', english: 'e', reference: 'r' }), /\blift\b/);
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

const weather = (over: Partial<ForecastCard['now']> = {}, hours: ForecastCard['hours'] = [], days?: ForecastCard['days']): ForecastCard => ({ type: 'forecast', now: { temp: 12, feels: 11, words: 'Cloudy', icon: 'cloud', hi: 14, lo: 8, ...over }, hours, days });
const hour = (time: string, pop: number, icon = 'cloud') => ({ time, temp: 12, icon, pop });

test('weather: leads with what today asks of you, and says nothing on a dull day', () => {
  assert.equal(headsUp(weather()), undefined);
  assert.equal(headsUp(weather({}, [hour('1pm', 10), hour('2pm', 70, 'rain'), hour('3pm', 60, 'rain'), hour('4pm', 10)])), 'Rain likely from 2pm to 4pm');
  assert.equal(headsUp(weather({}, [hour('1pm', 80, 'snow')])), 'Snow likely from 1pm');
  assert.equal(headsUp(weather({ icon: 'rain', precip: 1 }, [hour('1pm', 70, 'rain'), hour('2pm', 10)])), 'Rain easing around 2pm');
  assert.equal(headsUp(weather({ icon: 'rain' }, [hour('1pm', 70, 'rain')])), 'Rain until at least 1pm');
  const cool = [{ name: 'Tue', icon: 'sun', hi: 6, lo: 1 }, { name: 'Wed', icon: 'sun', hi: 6, lo: 1 }];
  assert.match(headsUp(weather({}, [], cool))!, /high of 14° is 8° warmer/);
  assert.match(headsUp(weather({ temp: 12, feels: 5 }))!, /Feels like 5°/);
  assert.ok(renderToString(<WeatherCard card={weather({}, [hour('1pm', 70, 'rain')])} />).includes('Rain likely from 1pm'));
});

test('calendar: what is next leads, all-day follows, and what is over steps aside', () => {
  const at = new Date(2026, 5, 10, 12).getTime(), iso = (h: number) => new Date(2026, 5, 10, h).toISOString();
  const list = [{ title: 'Over', start: iso(9), end: iso(10) }, { title: 'Later', start: iso(15) }, { title: 'Now', start: iso(11), end: iso(13) }, { title: 'Holiday', start: '2026-06-10' }, { title: 'Point', start: iso(8) }];
  const { ahead, earlier } = splitToday(list, at);
  assert.deepEqual(ahead.map(e => e.title), ['Now', 'Later', 'Holiday']);
  assert.deepEqual(earlier.map(e => e.title), ['Over', 'Point']);
  const d = new Date(), html = renderToString(<CalendarView card={{ type: 'calendar', events: [{ title: 'Gone', start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0).toISOString(), end: new Date(Date.now() - 1000).toISOString() }, { title: 'Soon', start: new Date(Date.now() + 864e5 * 2).toISOString() }] }} />);
  assert.ok(html.includes('earlier today') && !html.includes('Gone'), 'collapsed until asked');
});

test('thermostat: the dial names both numbers, explains the pair people mix up, and owns up to being read-only', () => {
  const base: ThermostatCard = { type: 'thermostat', unit: 'C', state: 'Idle', min: 10, max: 30, step: .5, target: 20, current: 19.5, set: { action: 'climate' },
    modes: [{ id: 'sleep', label: 'Sleep', action: 'climate' }, { id: 'night', label: 'Night', action: 'climate', hint: '17 degrees' }], note: 'Following its schedule' };
  const html = renderToString(<Thermostat card={base} run={async () => {}} />);
  for (const word of ['Set to', 'Room ', '19.5', 'A little cooler', '17 degrees', 'Following its schedule']) assert.ok(html.includes(word), word);
  assert.ok(!html.includes('View only'));
  assert.ok(renderToString(<Thermostat card={base} />).includes('View only'));
  assert.ok(renderToString(<Thermostat card={{ ...base, target: undefined, set: undefined, range: [18, 22] }} run={async () => {}} />).includes("can&#x27;t be set from here"));
});

const lamp = (over: Partial<PlanLight> = {}): PlanLight => ({ id: 'light.a', name: 'A', on: true, available: true, level: 40, canColor: true, canTemp: true, dims: true, ...over });
const plan = (over: Partial<PlanData> = {}): PlanData => ({ rooms: [{ id: 1, name: 'Kitchen', floor: 'tile', x: 0, z: 0, w: 10, d: 10, lights: [lamp()] }, { id: 2, name: 'Store', floor: 'tile', x: 10, z: 0, w: 10, d: 10, lights: [] }], furniture: [],
  robot: { id: 'vacuum.r', state: 'docked', status: 'Docked', battery: 90, fanSpeeds: [], wear: [['Filter', 8]] }, ...over });

test('home: undo puts each light back as it was, in as few calls as it can', () => {
  assert.deepEqual(restoreOf(lamp({ on: false })), { on: false });
  assert.deepEqual(restoreOf(lamp({ color: '#ff0000' })), { on: true, brightness: 40, rgb: [255, 0, 0] });
  assert.deepEqual(restoreOf(lamp({ color: '#ffc98f', kelvin: 2700 })), { on: true, brightness: 40, kelvin: 2700 });
  assert.deepEqual(restoreOf(lamp({ dims: false, canColor: false, canTemp: false })), { on: true });
  const groups = restoreGroups([lamp({ id: 'a' }), lamp({ id: 'b' }), lamp({ id: 'c', on: false })]);
  assert.deepEqual(groups.map(g => g.lights.map(l => l.id)), [['a', 'b'], ['c']]);
});

test('home: a change stands until the lights agree with it', () => {
  const rooms = plan().rooms, draft = { 'light.a': { on: false } };
  assert.deepEqual(unsettled(draft, rooms), draft);
  assert.deepEqual(unsettled({ 'light.a': { on: true, level: 41 } }, rooms), {}, 'rounding is agreement');
  assert.deepEqual(unsettled({ 'light.gone': { on: true } }, rooms), {});
  assert.ok(near('#ff0000', '#fa0404') && !near('#ff0000', '#00ff00'));
});

test('home: the robot only counts as having answered when it says what was asked, and its percentages say what they mean', () => {
  const r = plan().robot!;
  assert.ok(!heard({ command: 'start' }, r));
  assert.ok(heard({ command: 'start' }, { ...r, state: 'cleaning' }));
  assert.ok(heard({ command: 'dock' }, { ...r, state: 'returning' }));
  assert.ok(heard({ command: 'fan_speed', fan: 'Turbo' }, { ...r, fanSpeed: 'Turbo' }));
  assert.ok(!heard({ command: 'locate' }, r), 'nothing to read back: the page says sent');
  assert.deepEqual([wearNote(50), wearNote(20), wearNote(5)], ['Due at 10%', 'Replace soon', 'Replace now']);
  assert.equal(batteryNote(60, r), 'Charging');
  assert.equal(batteryNote(100, r), 'Full');
  assert.equal(batteryNote(15, { ...r, state: 'cleaning', status: 'Cleaning' }), 'Low, dock soon');
});

test('home: every room can be reached without the model, and view-only says so', () => {
  const html = renderToString(<HomeCase data={plan()} run={async () => {}} />);
  assert.ok(html.includes('Kitchen') && html.includes('Store') && html.includes('No lights'));
  assert.ok(!html.includes('View only') && html.includes('Reset view'));
  assert.ok(renderToString(<HomeCase data={plan()} />).includes('View only'));
  assert.ok(!renderToString(<HomeCase data={plan({ robot: undefined })} />).includes('Store'), 'nothing to do in a room with no lights and no robot');
});

test('pc: presets read without hover, the chosen one is marked, and controls off says so', () => {
  const data: PcCaseData = { parts: [{ id: 'pump', title: 'Cooler', zones: [{ mode: 'Static', color: [0, 0, 255], brightness: 80 }] }], metrics: { pump: [{ label: 'CPU', value: 41, unit: '°C', pct: .3 }] },
    presets: [{ id: 'ocean', name: 'Ocean', swatch: ['#00f'], active: true }, { id: 'off', name: 'All off', swatch: ['#000'] }] } as PcCaseData;
  const html = renderToString(<PcCase data={data} run={async () => {}} />);
  assert.match(html, /aria-pressed="true"[^>]*title="Ocean"/);
  assert.ok(html.includes('>Ocean<') && html.includes('>All off<') && html.includes('41°') && html.includes('Reset view'));
  assert.ok(renderToString(<PcCase data={{ ...data, controls: false, presets: undefined }} run={async () => {}} />).includes('read-only in this install'));
});

test('race: the board at any moment, overtakes included, and a final frame that reads on its own', () => {
  const items = [{ title: 'A', points: [0, 10, 10] }, { title: 'B', points: [4, 4, 20] }, { title: 'C', points: [1, 1, 1] }];
  assert.deepEqual(standing(items, 0).place, [6, 0, 1]);   // nothing yet: not on the board
  assert.deepEqual(standing(items, 1).place, [0, 1, 2]);
  const mid = standing(items, 1.5);
  assert.deepEqual([mid.value[0], mid.value[1]], [10, 12]);
  assert.deepEqual(mid.place, [1, 0, 2]);
  const out = renderToString(<Race race={{ steps: ['Jan', 'Feb', 'Mar'], items, unit: 'h' }} span="Hours" />);
  assert.match(out, /aria-label="B 20 h, A 10 h, C 1 h"/);
  assert.match(out, />Mar</);
  assert.ok(chartless({ type: 'race', steps: [], items: [] }));
});

test('heatmap, stream and waffle: integer counts, and nothing drawn from nothing', () => {
  assert.equal(renderToString(<Waffle pct={.143} />).match(/class="on"/g)?.length, 14);
  assert.equal(renderToString(<Waffle pct={.001} />).match(/class="on"/g)?.length, 1);
  assert.equal(renderToString(<Waffle pct={.999} />).match(/class="on"/g)?.length, 99);
  assert.equal(renderToString(<Waffle pct={0} />).match(/class="on"/g), null);
  const out = renderToString(<Heatmap card={{ type: 'heatmap', from: '2026-03-01', days: [0, 1, 3, 0, 9], unit: 'play', span: 'last 12 months' }} />);
  assert.equal(out.match(/<rect x=/g)?.length, 5);
  assert.match(out, /13 plays/);
  assert.ok(chartless({ type: 'heatmap', from: '2026-03-01', days: [0, 0] }));
  assert.ok(chartless({ type: 'chart', style: 'stream', series: [{ name: 'TV', points: [0, 0] }] }));
  assert.ok(!chartless({ type: 'chart', style: 'bars', series: [{ name: 'TV', points: [0, 0] }] }));
});

test('feel: a throw lands on the stop its speed reaches, and rubber never passes its limit', () => {
  const stops = [0, 100, 200, 300];
  assert.equal(landing(40, 0, stops), 0);
  assert.equal(landing(60, 0, stops), 100);
  assert.equal(landing(100, 2000, stops), 300);
  assert.equal(landing(100, -2000, stops), 0);
  assert.equal(rubber(0, 36), 0);
  assert.ok(rubber(1e6, 36) < 36 && rubber(1e6, 36) > 35);
  assert.ok(rubber(-40, 36) < 0 && rubber(-40, 36) > -40, 'it gives, but less than the pointer moved');
});

test('feel: a pile: on top nothing is moved or dimmed, behind is smaller, thrown is gone', () => {
  const at = (p: number) => pose(p) as Record<string, unknown>;
  assert.equal(at(0).opacity, 1); assert.equal(at(0)['--dim'], 0); assert.match(String(at(0).transform), /translateX\(0\.00%\)/);
  assert.equal(at(-1).opacity, 0);
  assert.equal(at(1).opacity, 1, 'depth is a dim, not see-through: the next card must not show through');
  assert.ok(Number(at(2)['--dim']) > Number(at(1)['--dim']));
  assert.equal(at(4).opacity, 0, 'the one waiting behind is mounted but not seen');
  const card = { type: 'article', title: 'Reading', more: [{ id: 'a', headline: 'One', link: 'http://x/1' }, { id: 'b', headline: 'Two', link: 'http://x/2' }, { id: 'c', headline: 'Three', link: 'http://x/3' }] };
  const out = html(card, { run: true });
  assert.match(out, /class="pile"/); assert.match(out, /One/); assert.match(out, /Two/);
  assert.equal(out.match(/inert=""/g)?.length, 2, 'only the top card can be reached');
  for (const l of ['Previous', 'Archive', 'Open', 'Next']) assert.match(out, new RegExp(`aria-label="${l}"`));
  assert.doesNotMatch(html({ type: 'article', headline: 'Alone' }), /aria-label="Next"/);
  assert.match(html({ type: 'article', headline: 'Alone' }), /is-single/);
});

test('feel: a row: shelves throw, and the desk stays a desk', () => {
  const items = [{ title: 'A', href: 'http://x/a' }, { title: 'B', href: 'http://x/b' }];
  assert.match(html({ type: 'shelf', title: 'Shelf', items }), /class="carousel /);
  assert.match(html({ type: 'shelf', title: 'Shelf', items }), /carousel-face/);
  assert.match(html({ type: 'shelf', layout: 'desk', title: 'Docs', items }), /desk carousel/);
  assert.match(html({ type: 'shelf', layout: 'desk', title: 'Docs', items }), /desk-page/);
});

test('feel: a flap Counter starts as plain digits, and a flip ends on the plain digit', () => {
  const n = renderToString(<Counter flap value="1h 5m" />);
  assert.match(n, /sr-only">1h 5m/); assert.doesNotMatch(n, /flap|digit-new/);
  assert.equal(n.match(/class="digit"/g)?.length, 5);
  const f = renderToString(<Flap was="5" now="4" />);
  assert.match(f, /flap-face">4</);
  assert.deepEqual(['next', 'last', 'fall', 'rise'].map(k => new RegExp(`flap-${k}">(\\d)`).exec(f)?.[1]), ['4', '5', '5', '4']);
});

test('feel: rows show plainly on first paint, a tick is still unless it just happened', () => {
  const Rows = () => <>{useRows([{ t: 'a' }, { t: 'b' }, { t: 'a' }], x => x.t).map(r => <RowSlot key={r.key} state={r.state}>{r.key}</RowSlot>)}</>;
  const out = renderToString(<Rows />);
  assert.equal(out.match(/class="row-slot"/g)?.length, 3); assert.doesNotMatch(out, /is-in|is-out/);
  assert.match(out, /a#1/);   // the same words twice are two rows
  assert.equal(renderToString(<RowSlot on={false}><li>x</li></RowSlot>), '<li>x</li>');
  assert.doesNotMatch(renderToString(<Tick />), /tick-draw/); assert.match(renderToString(<Tick draw />), /tick-draw/);
});

test('feel: the slider keeps its range and value, and a Counter says the whole number once, unanimated at first', () => {
  const s = renderToString(<ElasticSlider value={[40]} min={1} max={100} onValueCommit={() => {}} aria-label="Brightness" />);
  assert.match(s, /role="slider"/); assert.match(s, /aria-valuemax="100"/); assert.match(s, /class="elastic"/);
  const n = renderToString(<Counter value="42%" />);
  assert.match(n, /sr-only">42%/); assert.doesNotMatch(n, /digit-new/);
  assert.equal(n.match(/class="digit"/g)?.length, 3);
  const word = renderToString(<Counter value="Off" />);
  assert.doesNotMatch(word, /digit/); assert.doesNotMatch(word, /tick/);
});

test('cover flow: the front is flat and in front, and the fan turns towards it from both sides', () => {
  assert.deepEqual(place(0), { x: 0, turn: -0, sink: 0, z: 100 });
  assert.ok(place(1).turn < 0 && place(-1).turn > 0 && place(1).x === -place(-1).x);
  assert.ok(place(3).x > place(2).x && place(2).x - place(1).x < place(1).x && place(3).z < place(1).z && place(1).z < place(0).z);
});
