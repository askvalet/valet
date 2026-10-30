// One made-up example of every card type (and the interesting variations), for the tests and the #gallery page.
// Nothing here is real data. Keep one entry per card type at least; the schema test fails if a type is missing.
import type { Card } from '../shared/cards.ts';

const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const img = (seed: string, w = 600, h = 400) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const wave = (n: number, k = 1) => Array.from({ length: n }, (_, i) => Math.round(40 + 30 * Math.sin(i / 3 * k) + (i % 5) * 4));

export const SAMPLES: { name: string; card: Card }[] = [
  { name: 'stats', card: { type: 'stats', title: 'System', icon: 'cpu', note: 'up 9 days', items: [
    { label: 'CPU', value: 23, unit: '%', sub: '48°C', trend: wave(40) }, { label: 'Memory', value: 61, unit: '%' }, { label: 'GPU', value: 4, unit: '%' }, { label: 'Uptime', value: '9d' }],
    summary: { label: 'CPU', icon: 'cpu', value: '23%', sub: 'Ryzen 9', detail: '48°C', trend: wave(40), pct: .23, tone: 'good' } } },
  { name: 'stats · pie', card: { type: 'stats', title: 'Pi-hole', icon: 'shield', items: [{ label: 'Blocked', value: '14%' }], pieCenter: '14%', pie: [{ label: 'Blocked', value: 1400 }, { label: 'Forwarded', value: 6100 }, { label: 'Cached', value: 2500 }] } },
  { name: 'list · dots', card: { type: 'list', title: 'Drives', items: [{ title: 'WD Red', subtitle: '51°C · 3.1 years on', dot: 'good' }, { title: 'Old SSD', subtitle: '60°C', dot: 'warn', meta: 'Hot' }] } },
  { name: 'stats · warning', card: { type: 'stats', title: 'Drives', icon: 'disk', items: [{ label: 'Temperature', value: 61, unit: '°C', tone: 'warn', pct: .8 }] } },
  { name: 'list', card: { type: 'list', title: 'Downloads', icon: 'download', items: [
    { title: 'A very long release name that keeps going 2160p HDR x265 10bit-GROUP', subtitle: '12 MB/s · 3.2 GB left', meta: '4m', pct: .62 },
    { title: 'Stalled thing', subtitle: 'stalled', meta: '–', pct: .05, tone: 'warn' }, { title: 'With art', image: img('a', 80, 120), meta: 'done' }] } },
  { name: 'list · empty', card: { type: 'list', title: 'Downloads', items: [], empty: 'Nothing downloading' } },
  { name: 'media', card: { type: 'media', title: 'Now playing', icon: 'play', items: [
    { title: 'A Film With a Rather Long Title', subtitle: '2019', image: img('p', 300, 450), backdrop: img('b', 1280, 720), pct: .42, state: 'playing',
      user: 'someone', device: 'Living room TV', tags: ['4K', 'Direct', '40 Mbps'], remaining: '1 hr 2 min left' }] } },
  { name: 'media · two', card: { type: 'media', title: 'Now playing', items: [
    { title: 'Show', subtitle: 'S01E02 · Pilot', image: img('s'), pct: .1, state: 'paused' }, { title: 'Album', subtitle: 'Artist', image: img('m'), pct: .8, icon: 'download' }] } },
  { name: 'shelf · poster', card: { type: 'shelf', title: 'Recently added', icon: 'film', aspect: 'poster', items: Array.from({ length: 9 }, (_, i) => ({ title: `Title ${i + 1}`, subtitle: `${2010 + i}`, image: img(`r${i}`, 300, 450), badge: i ? undefined : 'Today' })) } },
  { name: 'shelf · stack', card: { type: 'shelf', title: 'Documents · “receipt”', icon: 'file', aspect: 'poster', stack: true, items: Array.from({ length: 6 }, (_, i) => ({ title: `Receipt ${i + 1}`, subtitle: 'Store · Jan 2', image: img(`d${i}`, 300, 400) })) } },
  { name: 'shelf · photo stack', card: { type: 'shelf', title: 'Beach', icon: 'image', aspect: 'square', stack: true, items: Array.from({ length: 5 }, (_, i) => ({ title: 'Lisbon', subtitle: 'Jun 2', image: img(`ph${i}`, 400, 400) })) } },
  { name: 'shelf · one', card: { type: 'shelf', title: 'A document', aspect: 'poster', stack: true, items: [{ title: 'Lease', subtitle: 'Landlord · Sep 1', image: img('l', 300, 400) }] } },
  { name: 'status', card: { type: 'status', title: 'Services', icon: 'pulse', items: [
    { name: 'Plex', ok: true, ms: 8, group: 'Media' }, { name: 'Radarr', ok: true, ms: 12, group: 'Media' }, { name: 'Broken', ok: false, detail: 'timed out', group: 'Home' },
    { name: 'Asleep', ok: false, quiet: true, group: 'Home' }, { name: 'A service with a long name', ok: true, ms: 1200, group: 'Network' }] } },
  { name: 'links', card: { type: 'links', title: 'Reading', icon: 'bookmark', items: [
    { name: 'Hacker News', href: 'https://news.ycombinator.com', note: 'news' }, { name: 'Lobsters', href: 'https://lobste.rs' }, { name: 'A bookmark with a long name that truncates', href: 'https://example.com', note: 'and a note' }] } },
  { name: 'list · links', card: { type: 'list', title: 'Feed', icon: 'rss', items: [{ title: 'An article worth reading', subtitle: 'The Verge', meta: '2h', href: 'https://example.com' }, { title: 'Another one', subtitle: 'Ars', meta: '5h', href: 'https://example.com' }] } },
  { name: 'chart', card: { type: 'chart', title: 'GPU', unit: 'W', span: 'last hour', series: [{ name: 'power', points: wave(60) }, { name: 'idle', points: wave(60, 2), tone: 'accent' }] } },
  { name: 'chart · scrub', card: { type: 'chart', title: 'Memory', unit: '%', from: Date.now() - 864e5, to: Date.now(), span: 'last 24 hours', series: [{ name: 'Memory', points: wave(48) }] } },
  { name: 'code · logs', card: { type: 'code', title: 'radarr logs', lines: ['03:11 Fetching feed', '03:12 Out of memory: killed process 412 (Radarr)', '03:12 exited with code 137'] } },
  { name: 'code · diff', card: { type: 'code', title: 'Config change', diff: true, lines: ['  integrations:', '+   speedtest:', '+     type: api', '-   old: true'] } },
  { name: 'table', card: { type: 'table', title: 'Watched', columns: ['Who', 'Title', 'Watched'], rows: [['Sam', 'Joker', 95], ['Alex', 'Dune', 40], ['Sam', 'A much longer title that has to fit somewhere', 12]] } },
  { name: 'controls', card: { type: 'controls', title: 'Lights', icon: 'bulb', items: [
    { id: 'a', label: 'Office', kind: 'toggle', value: true, color: '#ffb46b', sub: '80%', action: 'set' }, { id: 'b', label: 'Scene', kind: 'button', value: 'Run', action: 'press' },
    { id: 'c', label: 'Mode', kind: 'select', value: 'Auto', options: ['Auto', 'Off'], action: 'choose' }, { id: 'd', label: 'Brightness', kind: 'slider', value: 40, min: 0, max: 100, action: 'set' },
    { id: 'e', label: 'Temperature', kind: 'value', value: '21.5 °C' }] } },
  { name: 'forecast', card: { type: 'forecast', title: 'Weather', icon: 'sun', now: { temp: 16, feels: 14, words: 'Partly cloudy', icon: 'cloud-sun', hi: 18, lo: 9 },
    hours: Array.from({ length: 12 }, (_, i) => ({ time: `${(i + 9) % 12 || 12}${i < 3 ? 'am' : 'pm'}`, temp: 10 + Math.round(6 * Math.sin(i / 4)), icon: i > 6 ? 'rain' : 'cloud', pop: i > 6 ? 60 : 5 })),
    summary: { label: 'Partly cloudy', icon: 'cloud-sun', value: '16°', pct: .7, tone: 'good' } } },
  { name: 'photos · flashback', card: { type: 'photos', title: 'On this day', icon: 'image', style: 'flashback', items: Array.from({ length: 4 }, (_, i) => ({ image: img(`f${i}`, 1200, 900), badge: `${i + 1} years ago`, title: 'Lisbon', subtitle: 'Oct 29' })) } },
  { name: 'photos · mosaic', card: { type: 'photos', title: 'Trip', icon: 'image', style: 'mosaic', items: Array.from({ length: 5 }, (_, i) => ({ image: img(`m${i}`, 800, 800) })) } },
  { name: 'schedule', card: { type: 'schedule', title: 'Prayer times', icon: 'crescent', muted: ['Sunrise'],
    items: [['Fajr', 5, 31], ['Sunrise', 6, 50], ['Dhuhr', 12, 3], ['Asr', 15, 31], ['Maghrib', 17, 14], ['Isha', 18, 34]].map(([name, h, m]) => ({ name: name as string, at: at(h as number, m as number) })) } },
  { name: 'verse', card: { type: 'verse', title: 'Verse of the day', icon: 'book', arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا', english: 'Surely with hardship comes ease.', reference: 'Ash-Sharh 94:6', meaning: 'The Uplifting' } },
  { name: 'kv', card: { type: 'kv', title: 'Details', rows: [['Model', 'Something'], ['Firmware', '1.2.3'], ['A key that is quite long', 'and its value']] } },
  { name: 'text', card: { type: 'text', text: 'Filed “Lease” in Paperless.', tone: 'good' } },
  { name: 'group', card: { type: 'group', layout: 'row', cards: [
    { type: 'stats', title: 'GPU', items: [{ label: 'Load', value: 3, unit: '%' }] }, { type: 'text', text: 'Side by side.' }] } },
  { name: 'buttons', card: { type: 'stats', title: 'Pi-hole', icon: 'shield', items: [{ label: 'Blocked', value: '14%', tone: 'good', trend: wave(30) }],
    buttons: [{ label: 'Pause 5 min', action: 'pause', args: { minutes: 5 } }, { label: 'Pause 1 hour', action: 'pause', args: { minutes: 60 } }] } },
  { name: 'activity', card: { type: 'media', title: 'Now playing', items: [], activity: { title: 'Joker', subtitle: 'someone · TV', icon: 'play', pct: .3, trailing: '1h left' } } },
  { name: 'stats · 2001 at', card: { type: 'stats', title: 'Edge cases', items: [{ label: 'Huge', value: '1,234,567,890', unit: 'requests' }, { label: 'Zero', value: 0 }, { label: '', value: '' }] } },
  { name: 'showcase · image', card: { type: 'showcase', title: 'Camera', visual: { kind: 'image', src: img('cam', 800, 450) }, items: [{ label: 'Motion', value: 'none' }], caption: 'Front door' } },
];

export const STALE = ago(2);   // for tests that need a past time
