// The content integrations' parsers, on made-up feeds and calendars.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { child, elements, text } from '../src/server/xml.ts';
import { parseFeed } from '../src/integrations/rss.ts';
import { parseICS } from '../src/integrations/calendar.ts';

test('xml: elements, nesting, self-closing tags, attributes, entities and CDATA', () => {
  const xml = `<a><b x="1">one</b><b y='2'/><b>two<b>inner</b>tail</b></a>`;
  const bs = elements(xml, 'b');
  assert.equal(bs.length, 3);
  assert.deepEqual([bs[0].inner, bs[0].attrs.x, bs[1].inner, bs[1].attrs.y, bs[2].inner], ['one', '1', '', '2', 'two<b>inner</b>tail']);
  assert.equal(child('<t>&lt;hi&gt; &amp; &#8217;s &#x263A;</t>', 't'), '<hi> & ’s ☺');
  assert.equal(text('<p>Hello <b>there</b>&nbsp;<![CDATA[<i>cdata</i>]]></p>'), 'Hello there cdata');
});

test('rss: items with links, dates, thumbnails and summaries; atom entries too', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>A Blog</title>
    <item><title>First &amp; best</title><link>https://a.example/1</link><pubDate>Wed, 29 Oct 2025 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Some <b>text</b> <img src="https://a.example/i.jpg"></p>]]></description></item>
    <item><title>Older</title><guid>https://a.example/0</guid><pubDate>Tue, 28 Oct 2025 10:00:00 GMT</pubDate><media:thumbnail url="https://a.example/t.jpg"/></item>
  </channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].href, items[0].source, items[0].image, items[0].summary], ['First & best', 'https://a.example/1', 'A Blog', 'https://a.example/i.jpg', 'Some text']);
  assert.deepEqual([items[1].href, items[1].image], ['https://a.example/0', 'https://a.example/t.jpg']);
  assert.ok(items[0].at! > items[1].at!);

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>YT</title><entry><title>Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=x"/><published>2025-10-29T10:00:00+00:00</published>
    <media:group><media:thumbnail url="https://i.ytimg.com/vi/x/hqdefault.jpg"/><media:description>desc</media:description></media:group></entry></feed>`;
  const [v] = parseFeed(atom, 'Channel');
  assert.deepEqual([v.title, v.href, v.source, v.image, v.summary], ['Video', 'https://www.youtube.com/watch?v=x', 'Channel', 'https://i.ytimg.com/vi/x/hqdefault.jpg', 'desc']);
});

test('ics: single, all-day, weekly by day, daily with count, exdate, and a window', () => {
  const day = (d: number) => new Date(2025, 9, d).getTime();   // local October 2025
  const ics = ['BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'SUMMARY:Dentist\\, 3pm', 'DTSTART:20251030T150000', 'DTEND:20251030T160000', 'LOCATION:Main St', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20251101', 'DTEND;VALUE=DATE:20251102', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Gym', 'DTSTART:20251027T070000', 'DTEND:20251027T080000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'EXDATE:20251031T070000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Pills', 'DTSTART:20251029T090000', 'RRULE:FREQ=DAILY;COUNT=3', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Long ago', 'DTSTART:20200101T090000', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const ev = parseICS(ics, day(29), day(31) + 864e5 - 1, 'Home');
  const names = ev.map(e => `${e.title}@${new Date(e.start).getDate()}`);
  assert.deepEqual(names, ['Gym@29', 'Pills@29', 'Pills@30', 'Dentist, 3pm@30', 'Pills@31']);   // Gym on the 31st is excluded; Holiday is after the window
  const dentist = ev.find(e => e.title.startsWith('Dentist'))!;
  assert.deepEqual([dentist.allDay, dentist.location, dentist.calendar, dentist.end! - dentist.start], [false, 'Main St', 'Home', 3_600_000]);
  const holiday = parseICS(ics, new Date(2025, 10, 1).getTime(), new Date(2025, 10, 5).getTime(), 'Home').find(e => e.title === 'Holiday')!;
  assert.equal(holiday.allDay, true);
});

test('calendar: colours come from the event, then the feed, and nothing unsafe gets through', () => {
  const ics = ['BEGIN:VCALENDAR', 'X-APPLE-CALENDAR-COLOR:#FF2968', 'BEGIN:VEVENT', 'SUMMARY:Plain', 'DTSTART:20260105T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Own', 'DTSTART:20260105T100000', 'COLOR:crimson', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:Bad', 'DTSTART:20260105T110000', 'COLOR:url(x)', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ev = parseICS(ics, new Date(2026, 0, 1).getTime(), new Date(2026, 0, 31).getTime());
  assert.deepEqual(ev.map(e => e.color), ['#FF2968', 'crimson', '#FF2968']);
});

test('calendar: a daily event started years ago still reaches the months being browsed', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Pills', 'DTSTART:20100101T090000', 'RRULE:FREQ=DAILY', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.equal(parseICS(ics, new Date(2026, 5, 1).getTime(), new Date(2026, 5, 3, 23).getTime()).length, 3);
});
