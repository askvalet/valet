// The wall display's config: its own pages, checked like the main layout, and the line a paired screen can't cross.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/server/config.ts';
import { check } from '../src/server/site.ts';
import { registry } from '../src/integrations/index.ts';
import { ACTIVITY_HOLD, clockAt, judge, PRESENCE_HOLD, peopleOf, Presses, wallMayPress, wallPages, wallReads, wallView, wallViews, wallWidgets, type Mind } from '../src/server/wall.ts';
import { CALM, nextPage, stayFor } from '../src/web/wall-turn.ts';
import type { Card } from '../src/shared/cards.ts';
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

// ── when a page shows: every test passes the time in, in Toronto, so nothing here depends on when or where it runs ─────

const at = (iso: string) => Date.parse(iso);
const page = (title: string, when?: object, more: object = {}) => ({ title, ...(when ? { when } : {}), ...more, layout: [{ widgets: ['a.data'] }] });
const wallOf = (pages: object[], extra: object = {}) => Config.parse({ ...base, timezone: 'America/Toronto', wall: { people: 'home.people', pages, ...extra } });
const people = (list: Record<string, boolean>): { key: string; card: Card } => ({ key: 'home.people', card: { type: 'controls', items: Object.entries(list).map(([label, home]) => ({ id: label, label, kind: 'value', value: home ? 'Home' : 'Away' })) } });
const shows = (c: Config, now: number, states: { key: string; card?: Card }[] = [], mind?: Mind) => judge(wallView(c)!, c, now, states, mind);

test('the wall reads the clock in the configured zone, through a change of the clocks', () => {
  assert.deepEqual(clockAt(at('2026-11-09T23:59:00-05:00'), 'America/Toronto'), { at: 23 * 60 + 59, day: 1 });
  assert.deepEqual(clockAt(at('2026-11-10T00:00:00-05:00'), 'America/Toronto'), { at: 0, day: 2 });
  // the night the clocks go back: 01:45 happens twice, and both are 01:45
  assert.equal(clockAt(at('2026-11-01T01:45:00-04:00'), 'America/Toronto').at, 105);
  assert.equal(clockAt(at('2026-11-01T01:45:00-05:00'), 'America/Toronto').at, 105);
  // the night they go forward, 02:30 never happens: half past one in winter time is followed by three in summer time
  assert.equal(clockAt(at('2026-03-08T01:59:00-05:00') + 60_000, 'America/Toronto').at, 180);
});

test('time: a range, an overnight range, near midnight, and across a change of the clocks', () => {
  const c = wallOf([page('Morning', { time: '06:00-09:00' }), page('Night', { time: '22:00-06:00' }), page('Late', { time: ['23:30-00:15', '12:00-12:30'] })]);
  assert.deepEqual(shows(c, at('2026-11-09T07:00:00-05:00')).pages, [0]);
  assert.deepEqual(shows(c, at('2026-11-09T09:00:00-05:00')).pages, [], 'the end is outside');
  assert.deepEqual(shows(c, at('2026-11-09T05:59:00-05:00')).pages, [1]);
  assert.deepEqual(shows(c, at('2026-11-09T23:45:00-05:00')).pages, [1, 2]);
  assert.deepEqual(shows(c, at('2026-11-10T00:10:00-05:00')).pages, [1, 2], 'past midnight');
  assert.deepEqual(shows(c, at('2026-11-10T00:15:00-05:00')).pages, [1]);
  // DST: the range goes by the wall clock, whatever the offset
  const dst = wallOf([page('Small hours', { time: '01:30-02:30' }), page('Early', { time: '03:00-04:00' })]);
  assert.deepEqual(shows(dst, at('2026-11-01T01:45:00-04:00')).pages, [0]);
  assert.deepEqual(shows(dst, at('2026-11-01T01:45:00-05:00')).pages, [0], 'the second 01:45 counts too');
  assert.deepEqual(shows(dst, at('2026-03-08T03:10:00-04:00')).pages, [1], 'after the hour that never happened');
  assert.deepEqual(shows(dst, at('2026-03-08T01:40:00-05:00')).pages, [0]);
});

test('days: weekdays, weekends, a list, and an overnight range belongs to the evening it starts', () => {
  const c = wallOf([page('Work', { days: 'weekdays' }), page('Weekend', { days: 'weekends' }), page('Friday night', { time: '22:00-06:00', days: ['fri'] })]);
  assert.deepEqual(shows(c, at('2026-11-13T12:00:00-05:00')).pages, [0]);         // Friday noon
  assert.deepEqual(shows(c, at('2026-11-13T23:00:00-05:00')).pages, [0, 2]);      // Friday night
  assert.deepEqual(shows(c, at('2026-11-14T03:00:00-05:00')).pages, [1, 2]);      // Saturday 3am: still Friday night
  assert.deepEqual(shows(c, at('2026-11-14T23:00:00-05:00')).pages, [1]);         // Saturday night isn't
  assert.deepEqual(shows(c, at('2026-11-13T03:00:00-05:00')).pages, [0], 'Friday 3am is Thursday\'s night');
});

test('home: anyone, nobody, these people, only these; nothing asks without a card that says', () => {
  const c = wallOf([page('Any', { home: 'any' }), page('None', { home: 'none' }), page('Sam', { home: ['sam'] }), page('Just Sam', { home: ['Sam'], only: true }), page('Both', { home: ['Sam', 'Ana'] })]);
  const t = at('2026-11-09T12:00:00-05:00');
  assert.deepEqual(shows(c, t, [people({ Sam: true, Ana: false })]).pages, [0, 2, 3]);
  assert.deepEqual(shows(c, t, [people({ Sam: true, Ana: true })]).pages, [0, 2, 4]);
  assert.deepEqual(shows(c, t, [people({ Sam: false, Ana: false })]).pages, [1]);
  const none = shows(c, t, []);
  assert.deepEqual(none.pages, [], 'with no word on who\'s home, a page that asks never shows');
  assert.equal(none.ready, false);
  // a status card of people works the same way, and a card that isn't about people says nothing
  assert.deepEqual(peopleOf({ type: 'status', items: [{ name: 'Sam', ok: true }, { name: 'Ana', ok: false }] }), [{ name: 'Sam', home: true }, { name: 'Ana', home: false }]);
  assert.deepEqual(peopleOf({ type: 'controls', items: [{ id: 'a', label: 'Ana', kind: 'value', value: 'Away', tone: 'good' }] }), [{ name: 'Ana', home: true }], 'a good tone means home, as Home Assistant colours it');
  assert.equal(peopleOf({ type: 'text', text: 'x' } as Card), undefined);
});

test('who\'s home settles before the page follows: a phone off the wifi for a moment isn\'t someone leaving', () => {
  const c = wallOf([page('Home', { home: 'any' }), page('Away', { home: 'none' })]), t = at('2026-11-09T12:00:00-05:00');
  let r = shows(c, t, [people({ Sam: true })]);
  assert.deepEqual(r.pages, [0]);
  r = shows(c, t + 20_000, [people({ Sam: false })], r.mind);
  assert.deepEqual(r.pages, [0], 'gone for twenty seconds: still home');
  r = shows(c, t + 40_000, [people({ Sam: true })], r.mind);
  r = shows(c, t + 50_000, [people({ Sam: false })], r.mind);
  r = shows(c, t + 50_000 + PRESENCE_HOLD - 1, [people({ Sam: false })], r.mind);
  assert.deepEqual(r.pages, [0], 'the minute starts again after coming back');
  r = shows(c, t + 50_000 + PRESENCE_HOLD, [people({ Sam: false })], r.mind);
  assert.deepEqual(r.pages, [1], 'gone a whole minute: gone');
});

const live = (key: string, icon = 'play', extra: object = {}): { key: string; card: Card } => ({ key, card: { type: 'list', items: [], activity: { title: 'x', icon, ...extra } } });
const quiet = (key: string): { key: string; card: Card } => ({ key, card: { type: 'list', items: [] } });

test('live, playing and event come at once and go after a while; a paused film isn\'t playing', () => {
  const c = wallOf([page('Live', { live: true }), page('Playing', { playing: true }), page('Door', { event: 'cam.front' }), page('Still', { live: false })]), t = at('2026-11-09T12:00:00-05:00');
  let r = shows(c, t, [quiet('plex.streams'), quiet('cam.front')]);
  assert.deepEqual(r.pages, [3]);
  r = shows(c, t + 1000, [live('plex.streams'), quiet('cam.front')], r.mind);
  assert.deepEqual(r.pages, [0, 1]);
  r = shows(c, t + 2000, [live('plex.streams', 'play', { paused: true }), live('cam.front', 'camera')], r.mind);
  r = shows(c, t + 2000 + ACTIVITY_HOLD, [live('plex.streams', 'play', { paused: true }), live('cam.front', 'camera')], r.mind);
  assert.deepEqual(r.pages, [0, 2], 'paused for half a minute: not playing');
  r = shows(c, t + 40_000, [quiet('plex.streams'), quiet('cam.front')], r.mind);
  assert.deepEqual(r.pages, [0, 2], 'just stopped: held');
  r = shows(c, t + 40_000 + ACTIVITY_HOLD, [quiet('plex.streams'), quiet('cam.front')], r.mind);
  assert.deepEqual(r.pages, [3]);
  // a ring counting down to something that hasn't started isn't live
  assert.deepEqual(shows(c, t, [live('cal.next', 'video', { countdown: { start: t + 300_000 } })]).pages, [3]);
});

test('meeting: an online meeting starting within the lead, or on now', () => {
  const c = wallOf([page('Meeting', { meeting: '15m' }), page('Soon', { meeting: true })]), t = at('2026-11-09T09:50:00-05:00');
  const cal = (start: string, end?: string, join = true): { key: string; card: Card } => ({ key: 'cal.agenda', card: { type: 'calendar', events: [{ title: 'Standup', start, end, ...(join ? { join: { href: 'https://meet.example/x', provider: 'Meet' } } : {}) }] } });
  assert.deepEqual(shows(c, t, [cal('2026-11-09T15:00:00.000Z', '2026-11-09T15:30:00.000Z')]).pages, [0, 1], 'in ten minutes: within both');
  assert.deepEqual(shows(c, t - 60_000, [cal('2026-11-09T15:00:00.000Z')]).pages, [0], 'eleven minutes away');
  assert.deepEqual(shows(c, t + 25 * 60_000, [cal('2026-11-09T15:00:00.000Z')]).pages, [0, 1], 'on now (no end: half an hour)');
  assert.deepEqual(shows(c, t + 45 * 60_000, [cal('2026-11-09T15:00:00.000Z')]).pages, []);
  assert.deepEqual(shows(c, t, [cal('2026-11-09T15:00:00.000Z', undefined, false)]).pages, [], 'no way to join: not an online meeting');
  assert.deepEqual(shows(c, t, [{ key: 'cal.upcoming', card: { type: 'list', items: [], activity: { title: 'Standup', icon: 'video', countdown: { start: t + 5 * 60_000 } } } }]).pages, [0, 1], 'a meeting\'s ring counts too');
});

test('several keys all hold; `any` adds one of these', () => {
  const c = wallOf([page('Morning at home', { time: '06:00-09:00', home: 'any' }), page('Evening, or someone watching', { home: 'any', any: [{ time: '18:00-23:00' }, { playing: true }] })]);
  const t = at('2026-11-09T07:00:00-05:00'), sam = people({ Sam: true });
  assert.deepEqual(shows(c, t, [sam]).pages, [0]);
  assert.deepEqual(shows(c, t, [people({ Sam: false })]).pages, []);
  assert.deepEqual(shows(c, t, [sam, live('plex.streams')]).pages, [0, 1]);
  assert.deepEqual(shows(c, at('2026-11-09T19:00:00-05:00'), [sam]).pages, [1]);
});

test('a takeover interrupts when it comes true, for its time at most, and never on opening the wall', () => {
  const c = wallOf([page('Home'), page('Door', { event: 'cam.front' }, { takeover: '40s' })]), t = at('2026-11-09T12:00:00-05:00');
  // already ringing when the wall first looks: no interruption
  let r = shows(c, t, [live('cam.front', 'camera')]);
  assert.deepEqual([r.pages, r.takeover], [[0], undefined], 'a takeover page is never in the rotation');
  r = shows(c, t + ACTIVITY_HOLD + 1000, [quiet('cam.front')], r.mind);
  r = shows(c, t + 2 * ACTIVITY_HOLD + 1000, [quiet('cam.front')], r.mind);
  assert.equal(r.takeover, undefined);
  // it rings: at once
  r = shows(c, t + 100_000, [live('cam.front', 'camera')], r.mind);
  assert.equal(r.takeover, 1);
  r = shows(c, t + 139_000, [live('cam.front', 'camera')], r.mind);
  assert.equal(r.takeover, 1);
  r = shows(c, t + 140_000, [live('cam.front', 'camera')], r.mind);
  assert.equal(r.takeover, undefined, 'still ringing after 40s: back to the rotation');
  // over, then again: a fresh takeover
  r = shows(c, t + 141_000, [quiet('cam.front')], r.mind);
  r = shows(c, t + 141_000 + ACTIVITY_HOLD, [quiet('cam.front')], r.mind);
  r = shows(c, t + 200_000, [live('cam.front', 'camera')], r.mind);
  assert.equal(r.takeover, 1);
  // a takeover that's over early gives the page back early
  r = shows(c, t + 210_000, [quiet('cam.front')], r.mind);
  r = shows(c, t + 210_000 + ACTIVITY_HOLD, [quiet('cam.front')], r.mind);
  assert.equal(r.takeover, undefined);
  // `true` is a minute
  const m = wallOf([page('Home'), page('Door', { event: 'cam.front' }, { takeover: true })]);
  let q = shows(m, t, [quiet('cam.front')]);
  q = shows(m, t + 1000, [live('cam.front', 'camera')], q.mind);
  assert.equal(shows(m, t + 60_999, [live('cam.front', 'camera')], q.mind).takeover, 1);
  assert.equal(shows(m, t + 61_000, [live('cam.front', 'camera')], q.mind).takeover, undefined);
});

test('the screen takes turns calmly: each page at least 30s, a lost page leaves at its turn, the default when none may show', () => {
  assert.equal(nextPage(0, [0, 2, 3]), 2);
  assert.equal(nextPage(3, [0, 2, 3]), 0);
  assert.equal(nextPage(1, [0, 2]), 2, 'from a page that may no longer show, on to the next that may');
  assert.equal(nextPage(-1, []), -1, 'nothing may show: the default page');
  const base = { since: 1000, every: 10_000, held: 0, now: 1000 };
  assert.equal(stayFor({ ...base, n: 0, pages: [0, 1], calm: true }), CALM, 'a conditional wall holds each page 30s, whatever `every` says');
  assert.equal(stayFor({ ...base, n: 0, pages: [0, 1], calm: false }), 10_000);
  assert.equal(stayFor({ ...base, n: 0, pages: [0], calm: true }), null, 'the only page stays');
  assert.equal(stayFor({ ...base, n: 1, pages: [0], calm: true }), CALM, 'a page that may no longer show still has its turn');
  assert.equal(stayFor({ ...base, n: 0, pages: [0, 1], calm: true, held: 1000 + 120_000 }), 120_000, 'a touch holds it');
  assert.equal(stayFor({ ...base, n: -1, pages: [], calm: true }), null, 'the default page stays while nothing else may show');
  assert.equal(stayFor({ ...base, n: -1, pages: [2], calm: true }), CALM);
});

// ── the config, and what a paired screen may read and press ───────────────────────────────────────────────────────

test('when, takeover, touch, people and screens are checked', () => {
  for (const wall of [
    { pages: [page('x', { time: '25:00-06:00' })] }, { pages: [page('x', { time: '06:00' })] }, { pages: [page('x', { time: '06:00-6:00' })] },
    { pages: [page('x', {})] }, { pages: [page('x', { home: 'any', only: true })] }, { pages: [page('x', { days: ['funday'] })] }, { pages: [page('x', { nope: 1 })] },
    { pages: [page('x', undefined, { takeover: '30s' })] }, { pages: [page('x', { live: true }, { takeover: '1s' })] }, { pages: [page('x', { event: 'nodot' })] },
    { touch: ['nodot'] }, { touch: [{ widget: 'a.data', hold: 'yes' }] }, { screens: { Kitchen: { layout: [{ widgets: ['a.data'] }] } } }, { screens: { k: { token: 'short' } } },
  ]) assert.equal(Config.safeParse({ ...base, wall }).success, false, JSON.stringify(wall));
  const ok = Config.parse({ ...base, wall: { touch: ['a.data', { widget: 'b.data', hold: true }], pages: [page('x', { time: '22:00-06:00', days: 'weekdays', home: ['Sam'], only: true, meeting: '10m', any: [{ live: true }] }, { takeover: '1m' })] } });
  assert.deepEqual(ok.wall.touch, [{ widget: 'a.data', hold: false }, { widget: 'b.data', hold: true }]);
  const { problems, placed } = check(Config.parse({ ...base, layout: [], wall: {
    people: 'a.nope', touch: ['a.data', 'b.data', 'c.data'],
    pages: [page('P', { event: 'z.data', home: 'any' })],
    screens: { kitchen: { touch: ['b.data'], pages: [{ title: 'K', layout: [{ widgets: ['b.data', 'k.gone'] }] }] } },
  } }), registry, new Set());
  for (const p of [/wall\.people: no widget "a\.nope"/, /wall\.touch: b\.data isn't on the wall's pages/, /wall\.touch: no widget "c\.data"/, /wall\.pages\[0\] \(P\): when\.event: no widget "z\.data"/, /wall\.screens\.kitchen\.pages\[0\] \(K\): no widget "k\.gone"/])
    assert.ok(problems.some(x => p.test(x)), `${p}\n${problems.join('\n')}`);
  assert.ok(!problems.some(x => /screens\.kitchen\.touch/.test(x)), 'the kitchen may press what its own page shows');
  assert.ok(placed.has('b.data'), 'a screen\'s cards are polled');
  // a card the integration says has nothing to press
  const ha = check(Config.parse({ integrations: { ha: { type: 'homeassistant', url: 'http://127.0.0.1:9', token: 'x', thermostats: { hall: { entity: 'climate.hall' } }, cards: { lights: { title: 'Lights', entities: ['light.a'] } }, schedules: { bins: { title: 'Bins', entities: [{ id: 'sensor.bins', name: 'Bins' }] } } } },
    layout: [], wall: { touch: ['ha.lights', 'ha.hall', 'ha.bins'], layout: [{ widgets: ['ha.lights', 'ha.hall', 'ha.bins'] }] } }), registry, new Set()).problems;
  assert.ok(ha.some(x => /wall\.touch: ha\.bins is a schedule card/.test(x)), ha.join('\n'));
  assert.ok(!ha.some(x => /ha\.(lights|hall)/.test(x)), ha.join('\n'));
});

test('a screen reads its own pages\' cards; a page that may never show the default doesn\'t open the main page\'s', () => {
  const c = Config.parse({ ...base, wall: { pages: [page('Only sometimes', { live: true })], screens: { kitchen: { layout: [{ widgets: ['b.data'] }] } } } });
  const kitchen = wallView(c, 'kitchen')!, main = wallView(c)!;
  assert.equal(wallView(c, 'nope'), undefined);
  assert.equal(wallView(c, 'constructor'), undefined);
  assert.deepEqual(wallViews(c).map(v => v.name), ['', 'kitchen']);
  assert.equal(wallReads(c, { key: 'b.data' }, kitchen), true);
  assert.equal(wallReads(c, { key: 'a.data' }, kitchen), false);
  // every page of /wall waits on a `when`, so its default page (main-page services) can show, and is heard
  assert.equal(wallReads(c, { key: 'b.data', card: { type: 'status', items: [] } }, main), true);
  const always = Config.parse({ ...base, wall: { pages: [page('Always'), page('Sometimes', { live: true })] } });
  assert.equal(wallReads(always, { key: 'b.data', card: { type: 'status', items: [] } }), false, 'a page without `when` always may: the default never shows');
  assert.deepEqual(wallWidgets(c), ['a.data', 'b.data']);
});

test('a paired screen may press exactly what its touch list\'s cards offer, as they offer it', () => {
  const lights: Card = { type: 'controls', items: [
    { id: 'l1', label: 'Lamp', kind: 'toggle', value: true, action: 'set', args: { entity_id: 'light.lamp' } },
    { id: 'l2', label: 'Level', kind: 'slider', value: 50, min: 0, max: 100, action: 'level', args: { entity_id: 'light.lamp' } },
    { id: 'l3', label: 'Mood', kind: 'select', value: 'Relax', options: ['Relax', 'Read'], action: 'choose', args: { entity_id: 'select.mood' } },
    { id: 's', label: 'Movie', kind: 'button', action: 'press', args: { entity_id: 'scene.movie' } },
    { id: 'p', label: 'Power', kind: 'value', value: '4 W', action: 'set', args: { entity_id: 'switch.hidden' } },
  ] };
  const lock: Card = { type: 'controls', items: [{ id: 'k', label: 'Front door', kind: 'toggle', value: true, action: 'set', args: { entity_id: 'lock.front' } }] };
  const thermostat: Card = { type: 'thermostat', unit: 'C', state: 'Idle', min: 10, max: 30, step: .5, target: 20, set: { action: 'climate', args: { entity_id: 'climate.hall' } }, modes: [{ id: 'eco', label: 'Eco', action: 'climate', args: { entity_id: 'climate.hall', preset_mode: 'eco' } }] };
  const c = Config.parse({ ...base, wall: { touch: ['ha.lights', 'ha.hall'], layout: [{ widgets: ['ha.lights', 'ha.hall', 'ha.doors', 'other.lights'] }] } });
  const states = [{ key: 'ha.lights', card: lights }, { key: 'ha.hall', card: thermostat }, { key: 'ha.doors', card: lock }, { key: 'other.lights', card: lights }];
  const may = (inst: string, action: string, body: unknown, views = wallViews(c)) => wallMayPress(views, states, inst, action, body);
  assert.ok(may('ha', 'set', { entity_id: 'light.lamp', value: false }));
  assert.ok(may('ha', 'level', { entity_id: 'light.lamp', value: 80 }));
  assert.ok(may('ha', 'choose', { entity_id: 'select.mood', value: 'Read' }));
  assert.ok(may('ha', 'press', { entity_id: 'scene.movie' }));
  assert.ok(may('ha', 'climate', { entity_id: 'climate.hall', temperature: 21.5 }));
  assert.ok(may('ha', 'climate', { entity_id: 'climate.hall', preset_mode: 'eco' }));
  for (const [action, body, why] of [
    ['set', { entity_id: 'lock.front', value: false }, 'the same action on a card that isn\'t listed'],
    ['set', { entity_id: 'switch.hidden', value: true }, 'a row that only shows a value'],
    ['set', { entity_id: 'light.lamp', value: 'on' }, 'a value of the wrong kind'],
    ['set', { entity_id: 'light.lamp' }, 'a toggle without its value'],
    ['set', { entity_id: 'light.lamp', value: true, brightness: 255 }, 'an argument the card doesn\'t give'],
    ['level', { entity_id: 'light.lamp', value: 101 }, 'past the slider\'s end'],
    ['choose', { entity_id: 'select.mood', value: 'Party' }, 'an option the card doesn\'t offer'],
    ['press', { entity_id: 'scene.movie', value: 1 }, 'a button takes nothing'],
    ['press', { entity_id: ['scene.movie'] }, 'an argument dressed up'],
    ['climate', { entity_id: 'climate.hall', temperature: 45 }, 'past the dial\'s end'],
    ['climate', { entity_id: 'climate.hall', hvac_mode: 'off' }, 'a mode the card doesn\'t offer'],
    ['climate', { entity_id: 'climate.hall' }, 'the dial without a temperature'],
    ['reboot', {}, 'an action no card offers'],
  ] as const) assert.ok(!may('ha', action, body), why);
  assert.ok(!may('other', 'set', { entity_id: 'light.lamp', value: false }), 'a listed card\'s action on another instance');
  for (const body of [null, [], 'x', 42]) assert.ok(!may('ha', 'press', body), JSON.stringify(body));
  // a screen with a list of its own is held to it, and one without may press nothing
  const s = Config.parse({ ...base, wall: { touch: ['ha.lights'], layout: [{ widgets: ['ha.lights'] }], screens: { hall: { layout: [{ widgets: ['ha.lights', 'ha.hall'] }], touch: ['ha.hall'] }, bare: { layout: [{ widgets: ['ha.lights'] }] } } } });
  assert.ok(wallMayPress([wallView(s, 'hall')!], states, 'ha', 'climate', { entity_id: 'climate.hall', temperature: 21 }));
  assert.ok(!wallMayPress([wallView(s, 'hall')!], states, 'ha', 'press', { entity_id: 'scene.movie' }));
  assert.ok(!wallMayPress([wallView(s, 'bare')!], states, 'ha', 'press', { entity_id: 'scene.movie' }));
});

test('a paired screen\'s presses are counted: thirty a minute', () => {
  const p = new Presses(), t = 1_000_000;
  for (let i = 0; i < 30; i++) assert.ok(p.allow('a', t + i));
  assert.ok(!p.allow('a', t + 100));
  assert.ok(p.allow('b', t + 100), 'each token its own count');
  assert.ok(!p.allow('a', t + 59_999));
  assert.ok(p.allow('a', t + 60_000), 'a minute on, the first has gone');
});
