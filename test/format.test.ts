// One way to write a time, a date, a length of time and a number with its unit, on the page and the server alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, date, duration, highLow, range, relativeDay, splitUnit, stamp, time, withUnit } from '../src/shared/format.ts';

const M = 6e4, H = 36e5, D = 864e5;
test('durations: one short form for rings, chips, ago and left; one long form for sentences', () => {
  const short = [45e3, 59.6e3, 5 * M, 59.6 * M, 2 * H + 37 * M, 9 * H + 40 * M, 14 * H + 5 * M, 23.99 * H, 26 * H, 3 * D + 4 * H, 12 * D, 244 * D, 3.1 * 365 * D].map(ms => duration(ms));
  assert.deepEqual(short, ['45s', '1m', '5m', '1h', '2h 37m', '9h 40m', '14h', '1d', '1d 2h', '3d 4h', '12d', '244d', '3.1y']);
  assert.deepEqual([2 * H + 37 * M, 50 * M, 3 * D, 365 * D, 1.5 * 365 * D].map(ms => duration(ms, { style: 'long' })), ['2 hr 37 min', '50 min', '3 days', '1 year', '1.5 years']);
  assert.deepEqual([2 * H + 37 * M, 9 * H + 40 * M].map(ms => duration(ms, { parts: 1 })), ['3h', '10h']);
  assert.equal(duration(Infinity), '∞'); assert.equal(duration(-5), '0s');
  const now = Date.UTC(2026, 10, 5, 12);
  assert.deepEqual([now - 20e3, now - 5 * M, now - 2.2 * H, now - 3 * D].map(t => ago(t, now)), ['just now', '5m ago', '2h ago', '3d ago']);
});

test('times follow the clock setting and the language; a range is an en dash with no spaces and one AM/PM', () => {
  const a = new Date(2026, 10, 5, 8, 25), b = new Date(2026, 10, 5, 8, 50), c = new Date(2026, 10, 5, 13), d = new Date(2026, 10, 6, 1);
  const us = { locale: 'en-US' }, gb = { locale: 'en-GB' };
  assert.equal(time(a, us), '8:25 AM'); assert.equal(time(a, gb), '8:25'); assert.equal(time(a, { ...gb, clock: '24h' }), '08:25'); assert.equal(time(c, { ...gb, clock: '12h' }), '1:00 pm');
  assert.equal(range(a, b, us), '8:25–8:50 AM'); assert.equal(range(a, c, us), '8:25 AM–1:00 PM'); assert.equal(range(a, d, us), '8:25 AM–Fri 1:00 AM');
  assert.equal(range(a, b, gb), '8:25–8:50'); assert.equal(range(a, c, { ...gb, clock: '24h' }), '08:25–13:00');
  assert.equal(range(b, a, us), '8:50 AM');   // backwards is just the start
});

test('dates: short for meta, words for headings, the year only when it isn\'t this one, no ordinals', () => {
  const t = new Date(2026, 10, 5), now = +new Date(2026, 5, 1);
  assert.equal(date(t, { locale: 'en-GB' }, { now }), 'Thu 5 Nov'); assert.equal(date(t, { locale: 'en-US' }, { now }), 'Thu, Nov 5');
  assert.equal(date(t, { locale: 'en-GB' }, { as: 'heading', now }), 'Thursday 5 November');
  assert.equal(date(t, { locale: 'en-GB' }, { bare: true, now: +new Date(2027, 0, 2) }), '5 Nov 2026');
  assert.equal(date(t, { locale: 'en-GB', date: 'iso' }), '2026-11-05'); assert.equal(date(t, { locale: 'en-GB', date: 'numeric' }), '05/11/2026');
  const at = new Date(2026, 10, 5, 9);
  assert.deepEqual([0, 1, 3, 9].map(n => relativeDay(new Date(2026, 10, 5 + n, 9), { locale: 'en-GB' }, +at)), ['Today', 'Tomorrow', 'Sun', '14 Nov']);
  assert.equal(relativeDay(new Date(2026, 10, 5, 19), { locale: 'en-GB' }, +at), 'Tonight');
  assert.equal(stamp(new Date(2026, 10, 5, 7, 5), { locale: 'en-US' }, +at), '7:05 AM'); assert.equal(stamp(new Date(2026, 10, 3, 7, 5), { locale: 'en-US' }, +at), 'Tue 7:05 AM');
});

test('numbers with units: nothing before ° and %, a space before a word, and back again', () => {
  assert.deepEqual([withUnit(14, '%'), withUnit(42, '°C'), withUnit(58, 'GB'), withUnit('1.2', 'MB/s'), withUnit(7)], ['14%', '42°C', '58 GB', '1.2 MB/s', '7']);
  assert.deepEqual(splitUnit('20.0 °C'), ['20.0', '°C']); assert.deepEqual(splitUnit('14%'), ['14', '%']); assert.deepEqual(splitUnit('1.2 MB/s'), ['1.2', 'MB/s']);
  assert.deepEqual(splitUnit('20 of 64 GB'), ['20 of 64 GB', undefined]); assert.deepEqual(splitUnit('-4°'), ['-4', '°']);
  assert.equal(highLow(5, -4), 'High 5° · Low -4°');
});
