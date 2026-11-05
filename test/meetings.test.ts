// Online meetings from a calendar feed: the link found in a stranger's invitation (and nothing unsafe taken from it),
// repeating meetings with their moved, cancelled and declined ones, the ring before one starts, reminders said once and
// only once, and ⌘K's "join meeting". Made-up calendars only.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-meetings-'));
const { parseICS, meetingOf, linksIn, providerOf, contentLine, duration } = await import('../src/server/ics.ts');
const { default: calendar } = await import('../src/integrations/calendar.ts');
const { Reminders, due } = await import('../src/server/reminders.ts');
const { request } = await import('../src/server/notify.ts');
const { httpsOnly } = await import('../src/server/webpush.ts');
const { runCommand, commandsOf } = await import('../src/server/commands.ts');
const { checkCard } = await import('../src/shared/cards.schema.ts');
const { Config } = await import('../src/server/config.ts');
const { Activity } = await import('../src/server/activity.ts');
const { session } = await import('../src/server/core.ts');
type Context = import('../src/server/core.ts').Context;

const ics = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const pad = (n: number) => String(n).padStart(2, '0');
/** a local wall time as iCal writes it */
const local = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const sec = (t: number) => Math.floor(t / 1000) * 1000;
const utc = (t: number) => new Date(t).toISOString().replace(/[-:]|\.\d{3}/g, '');
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
const fake = (feed: () => string): Context => ({ id: 'cal', log() {}, image: r => r, upload: async () => ({ name: '', type: '', data: Buffer.from('') }), session,
  async http() { return feed() as any; } }) as Context;

// ── the link ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('links: each service by its host, https only, a home page is not a meeting', () => {
  const cases: [string, string | undefined][] = [
    ['https://meet.google.com/abc-defg-hij', 'Google Meet'], ['https://us02web.zoom.us/j/8123456789?pwd=x', 'Zoom'], ['https://zoom.us/j/1', 'Zoom'],
    ['https://teams.microsoft.com/l/meetup-join/19%3ameeting', 'Microsoft Teams'], ['https://acme.webex.com/meet/pat', 'Webex'], ['https://whereby.com/team-room', 'Whereby'],
    ['https://meet.jit.si/SomeRoom', 'Jitsi'], ['https://meet.goto.com/123456789', 'GoTo'], ['https://around.co/r/abc', 'Around'], ['https://discord.gg/abc', 'Discord'],
    ['http://meet.google.com/abc-defg-hij', undefined], ['https://meet.google.com/', undefined], ['https://evilmeet.google.com.example/x', undefined], ['https://notzoom.us/j/1', undefined],
    ['https://user:pw@zoom.us/j/1', undefined], ['https://zoom.us:8443/j/1', undefined], ['javascript:alert(1)//meet.google.com/x', undefined], ['https://goto.com/pricing', undefined], ['https://discord.com/pricing', undefined],
  ];
  for (const [href, provider] of cases) assert.equal(providerOf(href)?.provider, provider, href);
});

test('links: found in plain and HTML text, trailing punctuation and entities dealt with, linear on hostile text', () => {
  assert.deepEqual(linksIn('Join: https://zoom.us/j/1?pwd=a&amp;b=2. Or (https://meet.jit.si/x), see <a href="https://teams.microsoft.com/l/meetup-join/1">here</a>'),
    ['https://zoom.us/j/1?pwd=a&b=2', 'https://meet.jit.si/x', 'https://teams.microsoft.com/l/meetup-join/1']);
  const t0 = performance.now();
  linksIn('https://'.repeat(200_000)); linksIn(`https://${'a'.repeat(500_000)}`);
  assert.ok(performance.now() - t0 < 1500, 'a long hostile string costs one pass');
  // Google's own property wins over a link in the words
  assert.equal(meetingOf({ conference: 'https://meet.google.com/aaa-bbbb-ccc', description: 'https://zoom.us/j/9' })?.href, 'https://meet.google.com/aaa-bbbb-ccc');
  assert.equal(meetingOf({ location: 'Room 4', description: 'Agenda https://docs.example.com/x\nJoin https://zoom.us/j/9' })?.provider, 'Zoom');
  assert.equal(meetingOf({ description: 'http://zoom.us/j/9 and https://example.com/x' }), undefined);
});

test('ics: quoted parameters, durations, and an alarm\'s words stay out of the event', () => {
  assert.deepEqual(contentLine('ATTENDEE;CN="Doe, Jane: CTO";PARTSTAT=DECLINED:mailto:jane@example.com'), { name: 'ATTENDEE', params: { CN: 'Doe, Jane: CTO', PARTSTAT: 'DECLINED' }, value: 'mailto:jane@example.com' });
  assert.equal(duration('PT1H30M'), 5_400_000); assert.equal(duration('P1D'), 864e5); assert.equal(duration('nonsense'), undefined);
  const d = new Date(2026, 2, 10, 9, 0);
  const [e] = parseICS(ics(['SUMMARY:Sync', `DTSTART:${local(d)}`, 'DURATION:PT45M', 'DESCRIPTION:Meet at https://meet.google.com/abc-defg-hij',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:https://zoom.us/j/1', 'SUMMARY:alarm', 'END:VALARM']), +d - 864e5, +d + 864e5);
  assert.deepEqual([e.title, e.end! - e.start, e.join?.provider], ['Sync', 45 * 6e4, 'Google Meet']);
});

test('ics: a meeting set in another time zone lands at the right moment', () => {
  // 9:00 in New York on 4 Nov 2026 is 14:00 UTC (EST); in summer it's 13:00 UTC (EDT)
  const feed = ics(['SUMMARY:Winter', 'DTSTART;TZID=America/New_York:20261104T090000', 'DTEND;TZID=America/New_York:20261104T093000'],
    ['SUMMARY:Summer', 'DTSTART;TZID="America/New_York":20260701T090000', 'DTEND;TZID=America/New_York:20260701T093000'],
    ['SUMMARY:Outlook', 'DTSTART;TZID=W. Europe Standard Time:20261104T090000'], ['SUMMARY:Unknown zone', `DTSTART;TZID=Nowhere/Special:${local(new Date(2026, 10, 4, 9))}`]);
  const ev = parseICS(feed, Date.UTC(2026, 5, 1), Date.UTC(2026, 11, 1));
  const at = (t: string) => ev.find(e => e.title === t)!.start;
  assert.equal(at('Winter'), Date.UTC(2026, 10, 4, 14));
  assert.equal(at('Summer'), Date.UTC(2026, 6, 1, 13));
  assert.equal(at('Outlook'), Date.UTC(2026, 10, 4, 8));
  assert.equal(at('Unknown zone'), new Date(2026, 10, 4, 9).getTime(), 'a zone nobody knows is taken as local');
  // a weekly meeting keeps its New York time across the change of clocks
  const weekly = parseICS(ics(['SUMMARY:Standup', 'DTSTART;TZID=America/New_York:20261026T090000', 'RRULE:FREQ=WEEKLY;COUNT=3']), Date.UTC(2026, 9, 1), Date.UTC(2026, 11, 1));
  assert.deepEqual(weekly.map(e => new Date(e.start).getUTCHours()), [13, 14, 14]);
});

test('ics: cancelled, declined, moved and skipped meetings of a repeating series', () => {
  const day = (d: number, h = 10) => new Date(2026, 10, d, h);   // November 2026, local
  const feed = ics(
    ['UID:standup@x', 'SUMMARY:Standup', `DTSTART:${local(day(2))}`, `DTEND:${local(day(2, 11))}`, 'RRULE:FREQ=DAILY;COUNT=5', `EXDATE:${local(day(3))}`, 'X-GOOGLE-CONFERENCE:https://meet.google.com/aaa-bbbb-ccc',
      'ATTENDEE;CN=Alex Chen;PARTSTAT=ACCEPTED:mailto:alex@example.com', 'ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:ME@example.com', 'ATTENDEE;CN=Room 4;CUTYPE=ROOM:mailto:room@example.com'],
    ['UID:standup@x', `RECURRENCE-ID:${local(day(4))}`, 'SUMMARY:Standup (moved)', `DTSTART:${local(day(4, 15))}`, `DTEND:${local(day(4, 16))}`],
    ['UID:standup@x', `RECURRENCE-ID:${local(day(5))}`, 'STATUS:CANCELLED', 'SUMMARY:Standup', `DTSTART:${local(day(5))}`],
    ['UID:standup@x', `RECURRENCE-ID:${local(day(6))}`, 'SUMMARY:Standup', `DTSTART:${local(day(6))}`, 'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com'],
    ['UID:gone@x', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', `DTSTART:${local(day(2, 13))}`],
    ['UID:no@x', 'SUMMARY:Said no', `DTSTART:${local(day(2, 14))}`, 'ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:me@example.com'],
  );
  const got = (me?: string[]) => parseICS(feed, +day(1), +day(10), 'Work', { me }).map(e => `${e.title}@${new Date(e.start).getDate()}/${new Date(e.start).getHours()}`);
  assert.deepEqual(got(['me@example.com']), ['Standup@2/10', 'Standup (moved)@4/15']);
  assert.deepEqual(got(), ['Standup@2/10', 'Said no@2/14', 'Standup (moved)@4/15', 'Standup@6/10'], 'without `me`, nothing is known to be declined');
  const [first] = parseICS(feed, +day(1), +day(10), 'Work', { me: ['me@example.com'] });
  assert.deepEqual(first.people, ['Alex Chen']);
  assert.equal(first.join?.href, 'https://meet.google.com/aaa-bbbb-ccc');
});

test('ics: monthly by weekday, by day of the month, and weekly with an interval', () => {
  const at = (rule: string, from = new Date(2026, 0, 1), to = new Date(2026, 5, 30)) => parseICS(ics(['SUMMARY:x', `DTSTART:${local(new Date(2026, 0, 13, 9))}`, `RRULE:${rule}`]), +from, +to).map(e => `${new Date(e.start).getMonth() + 1}/${new Date(e.start).getDate()}`);
  assert.deepEqual(at('FREQ=MONTHLY;BYDAY=2TU;COUNT=4'), ['1/13', '2/10', '3/10', '4/14']);
  assert.deepEqual(at('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'), ['1/30', '2/27', '3/27']);
  assert.deepEqual(at('FREQ=MONTHLY;BYMONTHDAY=13;UNTIL=20260401T000000Z'), ['1/13', '2/13', '3/13']);
  assert.deepEqual(at('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=4'), ['1/13', '1/15', '1/27', '1/29']);
  assert.deepEqual(at('FREQ=DAILY;BYDAY=MO,WE;COUNT=3'), ['1/14', '1/19', '1/21']);
});

// ── the ring, the rows and the tool ────────────────────────────────────────────────────────────────────────────────────
const meetingFeed = (start: number, mins = 30, extra: string[][] = []) => () => ics(
  ['UID:design@x', 'SUMMARY:Design review', `DTSTART:${utc(start)}`, `DTEND:${utc(start + mins * 6e4)}`, 'DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij',
    'ATTENDEE;CN=Alex Chen:mailto:alex@example.com', 'ATTENDEE;CN=Sam Lee:mailto:sam@example.com'],
  ['UID:lunch@x', 'SUMMARY:Lunch', `DTSTART:${utc(start + 2 * 36e5)}`, `DTEND:${utc(start + 3 * 36e5)}`, 'LOCATION:http://zoom.us/j/1'],
  ...extra);

test('calendar: the ring comes `lead` before a meeting, counts down, and says Join', async () => {
  const real = Date.now, base = real();
  try {
    const start = sec(base + 4 * 6e4);
    const cal = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'] }), fake(meetingFeed(start)));
    const card: any = await cal.widgets.agenda.fetch();
    valid(card);
    assert.deepEqual(card.activity.countdown, { from: start - 10 * 6e4, start, end: start + 30 * 6e4 });
    assert.deepEqual(card.activity.link, { label: 'Join', href: 'https://meet.google.com/abc-defg-hij', note: 'Google Meet' });
    assert.match(card.activity.subtitle, /with Alex Chen, Sam Lee/);
    assert.equal(card.activity.count, undefined);
    assert.deepEqual(card.events.find((e: any) => e.title === 'Design review').join, { href: 'https://meet.google.com/abc-defg-hij', provider: 'Google Meet' });
    assert.equal(card.events.find((e: any) => e.title === 'Lunch').join, undefined, 'an http link is no meeting');
    const list: any = await cal.widgets.upcoming.fetch();
    valid(list);
    assert.equal(list.items[0].link.href, 'https://meet.google.com/abc-defg-hij');
    assert.match(list.items[0].subtitle, /^Google Meet/);
    // twenty minutes before: nothing yet
    Date.now = () => start - 20 * 6e4;
    const early: any = await calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'] }), fake(meetingFeed(start))).widgets.agenda.fetch();
    assert.equal(early.activity, undefined);
  } finally { Date.now = real; }
});

test('calendar: two at once, the one on now leads and the ring says how many', async () => {
  const now = Date.now(), start = now - 5 * 6e4;
  const other = ['UID:sync@x', 'SUMMARY:Vendor sync', `DTSTART:${utc(now + 3 * 6e4)}`, `DTEND:${utc(now + 33 * 6e4)}`, 'URL:https://acme.zoom.us/j/555'];
  const cal = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'] }), fake(meetingFeed(start, 30, [other])));
  const card: any = await cal.widgets.upcoming.fetch();
  assert.deepEqual([card.activity.title, card.activity.count], ['Design review', 2]);
  const out: any = await cal.tools!.calendar_next_meeting.run({});
  valid(out.card);
  assert.equal(out.open, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual([out.data.next.title, out.data.next.provider, out.data.later[0].provider], ['Design review', 'Google Meet', 'Zoom']);
  assert.match(out.card.items[0].meta, /^Now · \d+ min left/);
  const upcoming: any = await cal.tools!.calendar_upcoming.run({ days: 2 });   // the other meeting may start after midnight
  assert.equal(upcoming.data.find((e: any) => e.title === 'Vendor sync').join, 'https://acme.zoom.us/j/555');
});

test('calendar: meetings: false is the calendar as it was', async () => {
  const start = Date.now() + 4 * 6e4, cal = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'], meetings: false }), fake(meetingFeed(start)));
  const card: any = await cal.widgets.agenda.fetch();
  assert.equal(card.activity, undefined);
  assert.equal(card.events[0].join, undefined);
  assert.equal(cal.reminders, undefined); assert.equal(cal.commands, undefined); assert.equal(cal.tools!.calendar_next_meeting, undefined);
  assert.equal(cal.widgets.agenda.interval, 600_000);
});

// ── reminders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('calendar: a reminder at each `remind`, with the meeting\'s name, time and link', async () => {
  const start = sec(Date.now() + 5 * 6e4);
  const cal = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'], meetings: { remind: ['10m', '1m'], push: false } }), fake(meetingFeed(start)));
  const list = await cal.reminders!();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(r => r.at), [start - 10 * 6e4, start - 6e4]);
  assert.ok(list.every(r => r.until === start && r.about === list[0].about && r.link === 'https://meet.google.com/abc-defg-hij' && r.device === false));
  assert.match(list[0].title, /^Design review at /);
  assert.equal(list[0].text, 'Google Meet · with Alex Chen, Sam Lee');
});

test('reminders: due once, the latest of one meeting, never for what began before Valet came up', () => {
  const r = (id: string, at: number, until: number, about?: string) => ({ id, at, until, about, title: id, source: 'cal' });
  const now = 1_000_000, since = 900_000;
  const { say, skip } = due([r('a10', now - 9e5, now + 6e4, 'a'), r('a2', now - 6e4, now + 6e4, 'a'), r('later', now + 6e4, now + 9e5), r('before', 800_000, 890_000), r('gone', now - 9e5, now - 1)], {}, now, since);
  assert.deepEqual(say.map(x => x.id), ['a2']);
  assert.deepEqual(skip.map(x => x.id), ['a10']);
  assert.deepEqual(due([r('a2', now - 6e4, now + 6e4)], { a2: now + 864e5 }, now, since).say, [], 'said already');
});

test('reminders: said once across a restart, kept in the data folder', async () => {
  const start = Date.now() + 45_000;
  const instance = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'] }), fake(meetingFeed(start)));
  const told: string[] = [];
  const first = await new Reminders().load();
  first.sources = () => [{ id: 'work', instance }];
  first.tell = x => told.push(x.title);
  assert.equal((await first.check()).length, 1);
  assert.equal((await first.check()).length, 0);
  const saved = JSON.parse(await readFile(join(process.env.VALET_DATA!, 'reminders.json'), 'utf8'));
  assert.ok(Object.keys(saved.said).some(k => k.startsWith('work:design@x@')));
  const again = await new Reminders().load();   // Valet restarted
  again.sources = () => [{ id: 'work', instance }];
  again.tell = x => told.push(x.title);
  assert.equal((await again.check()).length, 0);
  assert.equal(told.length, 1);
  // a plugin's reminder with a link that isn't https is left out
  const odd = await new Reminders().load();
  odd.sources = () => [{ id: 'p', instance: { reminders: async () => [{ id: 'x', at: Date.now() - 1, until: Date.now() + 6e4, title: 'x', link: 'javascript:alert(1)' }] } }];
  assert.equal((await odd.check()).length, 0);
});

test('notify: the link reaches every channel, and a tap on ntfy or Pushover opens it', () => {
  const m = { title: 'Design review at 10:30', text: 'Google Meet', link: 'https://meet.google.com/abc-defg-hij' };
  const ntfy = request({ type: 'ntfy', url: 'https://ntfy.example/t' }, m);
  assert.equal((ntfy.init.headers as any).Click, m.link);
  assert.match(String(ntfy.init.body), /meet\.google\.com/);
  assert.equal(JSON.parse(String(request({ type: 'pushover', token: 't', user: 'u' }, m).init.body)).url, m.link);
  assert.match(JSON.parse(String(request({ type: 'discord', url: 'https://d.example/h' }, m).init.body)).content, /abc-defg-hij/);
  assert.equal(httpsOnly('https://meet.google.com/x'), 'https://meet.google.com/x');
  for (const bad of ['http://meet.google.com/x', 'javascript:alert(1)', '/relative', 'https://u:p@x.example/', undefined]) assert.equal(httpsOnly(bad), undefined, String(bad));
});

test('service worker: a tap opens only an https link, anything else goes to Valet', async () => {
  const sw = await readFile('src/web/sw.js', 'utf8');
  assert.match(sw, /u\.protocol === 'https:'/);
  assert.match(sw, /open: https\(m\.open\)/);
});

// ── ⌘K ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('⌘K: "join meeting" answers with the link to open; "next meeting" only shows it', async () => {
  const start = Date.now() + 4 * 6e4, cal = calendar.create(calendar.config.parse({ calendars: ['https://c/a.ics'] }), fake(meetingFeed(start)));
  const site = { config: Config.parse({}), instances: new Map([['work', cal]]), meta: new Map([['work', { type: 'calendar', name: 'Calendar' }]]), acting: false, redact: (s: string) => s, activity: new Activity() };
  const list = await commandsOf(site as any);
  const app = new Hono(); app.post('/api/command', c => runCommand(c, site as any));
  const say = async (text: string) => { const id = list.find(e => e.say.includes(text))!.id; return (await app.request('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, id }) })).json() as any; };
  const joined = await say('join meeting');
  assert.equal(joined.open, 'https://meet.google.com/abc-defg-hij', 'opening a link changes nothing, so even a read-only page may');
  valid(joined.card);
  const next = await say('next meeting');
  assert.equal(next.open, undefined);
  assert.equal(next.card.title, 'Next meeting');
});
