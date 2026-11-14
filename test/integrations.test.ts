// Integrations against made-up service responses: the cards they produce validate, and the logic that's easy to get
// wrong (sign-in reuse, parsing, roll-over to tomorrow, a sensor's state) does what it says.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { headers as securityHeaders, setFrames } from '../src/server/security.ts';
import { Config } from '../src/server/config.ts';
import { session, type Context, type Instance } from '../src/server/core.ts';
import { Timeline } from '../src/server/timeline.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import arr from '../src/integrations/arr.ts';
import calendar from '../src/integrations/calendar.ts';
import clock from '../src/integrations/clock.ts';
import weather from '../src/integrations/weather.ts';
import docker from '../src/integrations/docker.ts';
import iframe from '../src/integrations/iframe.ts';
import lobsters from '../src/integrations/lobsters.ts';
import repository from '../src/integrations/repository.ts';
import todo from '../src/integrations/todo.ts';
import twitch from '../src/integrations/twitch.ts';
import homeassistant from '../src/integrations/homeassistant.ts';
import http from '../src/integrations/http.ts';
import pihole from '../src/integrations/pihole.ts';
import qbittorrent from '../src/integrations/qbittorrent.ts';
import releases from '../src/integrations/releases.ts';
import scrutiny from '../src/integrations/scrutiny.ts';
import changedetection from '../src/integrations/changedetection.ts';
import karakeep from '../src/integrations/karakeep.ts';
import seerr from '../src/integrations/seerr.ts';
import tautulli, { raceOf } from '../src/integrations/tautulli.ts';
import { Activity, outcome, sentence } from '../src/server/activity.ts';
import uptimekuma from '../src/integrations/uptimekuma.ts';
import { setHouse } from '../src/server/core.ts';
setHouse({ locale: 'en-US' });   // what the server writes follows a language; these read like a US one wherever they run

type Handler = (url: string, init: RequestInit) => unknown;
function fake(handler: Handler): Context & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 't', calls, log() {}, image: r => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }),
    session,
    async http(url: string, init: any = {}) {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      const out = await handler(url, init);
      if (init.as === 'response') return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
      if (out instanceof Response) { if (!out.ok) throw new Error(`answered ${out.status}`); return init.as === 'text' ? out.text() : out.json(); }
      return out as any;
    },
  } as any;
}
const make = <C>(i: { config: any; create(c: C, ctx: Context): Instance }, cfg: unknown, ctx: Context) => i.create(i.config.parse(cfg), ctx);
const headersFor = async () => { const a = new Hono(); a.use(securityHeaders); a.get('/', c => c.text('ok')); return (await a.request('/')).headers.get('content-security-policy') ?? ''; };
// noon, `days` calendar days from today: "now + 24 h" isn't tomorrow on a day the clocks change, nor late in the evening
const noonIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(12, 0, 0, 0); return d.getTime(); };
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };

test('config: widgets take a size, plain names default to medium', () => {
  const c = Config.parse({ layout: [{ widgets: ['a.b', { widget: 'c.d', size: 'small' }] }] });
  assert.deepEqual(c.layout[0].widgets, [{ widget: 'a.b', size: 'medium' }, { widget: 'c.d', size: 'small' }]);
  assert.equal(c.auth.mode, 'none');
});

test('pihole: parallel requests share one sign-in, and an expired session signs in again once', async () => {
  let logins = 0, expired = false;
  const ctx = fake(url => {
    if (url.endsWith('/api/auth')) { logins++; return { session: { valid: true, sid: `s${logins}` } }; }
    if (expired) { expired = false; return new Response('{}', { status: 401 }); }
    if (url.includes('summary')) return { queries: { total: 1000, blocked: 140, percent_blocked: 14 }, clients: { active: 9 } };
    if (url.includes('history')) return { history: [{ blocked: 1 }, { blocked: 3 }] };
    if (url.includes('blocking')) return { blocking: 'enabled', timer: null };
    return { domains: [{ domain: 'ads.example', count: 9 }] };
  });
  const p = make(pihole, { url: 'http://pi', password: 'x' }, ctx);
  const card = await p.widgets.stats.fetch();
  valid(card);
  assert.equal(logins, 1, 'four parallel calls should share one sign-in');
  expired = true;
  await p.widgets.stats.fetch();
  assert.equal(logins, 2);
  assert.equal((card as any).summary.value, '140');
  assert.equal((card as any).summary.ring, '14%');
});

test('pihole: status names the devices behind the blocks, and a domain says who asked for it', async () => {
  const seen: string[] = [];
  const ctx = fake(url => {
    seen.push(url);
    if (url.endsWith('/api/auth')) return { session: { valid: true, sid: 's' } };
    if (url.includes('summary')) return { queries: { total: 1000, blocked: 140, percent_blocked: 14 }, clients: { active: 3 } };
    if (url.includes('history')) return { history: [] };
    if (url.includes('dns/blocking')) return { blocking: 'enabled', timer: null };
    if (url.includes('top_clients')) return { clients: [{ name: 'tv.lan', ip: '192.168.1.20', count: 90 }, { name: '', ip: '100.64.0.5', count: 30 }, { name: '', ip: '192.168.1.9', count: 5 }] };
    if (url.includes('config/dns/hosts')) return { config: { dns: { hosts: ['100.64.0.5 laptop', '10.0.0.1 router gw'] } } };
    if (url.includes('queries?domain=') && url.includes('nothing')) return { queries: [], recordsFiltered: 0 };
    if (url.includes('queries?domain=')) return { recordsFiltered: 450, queries: [
      { domain: 'a.tracker.example', client: { ip: '192.168.1.20', name: 'tv.lan' } }, { domain: 'b.tracker.example', client: { ip: '192.168.1.20', name: 'tv.lan' } },
      { domain: 'a.tracker.example', client: { ip: '100.64.0.5', name: null } }] };
    return { domains: [{ domain: 'ads.example', count: 9 }] };
  });
  const p = make(pihole, { url: 'http://pi', password: 'x' }, ctx);
  const plain: any = await p.tools!.adblock_status.run({});
  assert.deepEqual(plain.data.topClients, [{ device: 'tv.lan', ip: '192.168.1.20', count: 90 }, { device: 'laptop', ip: '100.64.0.5', count: 30 }, { device: '192.168.1.9', count: 5 }]);
  assert.equal(plain.data.asked, undefined);
  assert.ok(seen.some(u => u.includes('stats/top_clients?blocked=true&count=5')));
  assert.ok(!seen.some(u => u.includes('queries?')), 'no domain, no query log');
  const asked: any = (await p.tools!.adblock_status.run({ domain: 'tracker' })).data.asked;
  assert.ok(seen.some(u => u.includes(`queries?domain=${encodeURIComponent('*tracker*')}&length=200`)), 'a plain name matches anywhere');
  assert.deepEqual(asked.devices, [{ device: 'tv.lan', ip: '192.168.1.20', count: 2 }, { device: 'laptop', ip: '100.64.0.5', count: 1 }]);
  assert.deepEqual(asked.domains, [{ domain: 'a.tracker.example', count: 2 }, { domain: 'b.tracker.example', count: 1 }]);
  assert.equal(asked.queries, 450); assert.equal(asked.note, 'counts are from the latest 3 of 450 queries');
  await p.tools!.adblock_status.run({ domain: '*.example' });
  assert.ok(seen.some(u => u.includes(`domain=${encodeURIComponent('*.example')}&`)), 'a pattern is used as given');
  const none: any = await p.tools!.adblock_status.run({ domain: 'nothing.example' });
  assert.equal(typeof none.data.asked, 'string'); assert.match(none.data.asked, /no queries/i);
});

test('uptime kuma: parses metrics; a down monitor makes the summary red', async () => {
  const metrics = [
    'monitor_status{monitor_id="1",monitor_name="Plex",monitor_type="http"} 1',
    'monitor_status{monitor_id="2",monitor_name="Router",monitor_type="ping"} 0',
    'monitor_response_time{monitor_id="1",monitor_name="Plex"} 12',
    'monitor_uptime_ratio{monitor_id="1",monitor_name="Plex",window="30d"} 0.999',
    'monitor_uptime_ratio{monitor_id="2",monitor_name="Router",window="30d"} 0.95',
    'monitor_cert_days_remaining{monitor_id="1",monitor_name="Plex"} 9',
  ].join('\n');
  const k = make(uptimekuma, { url: 'http://kuma', password: 'x' }, fake(() => new Response(metrics)));
  const card: any = await k.widgets.monitors.fetch();
  valid(card);
  assert.equal(card.items.length, 2);
  assert.equal(card.summary.tone, 'bad');
  assert.match(card.summary.value, /1 down/);
});

test('uptime kuma 1: no monitor_id, so each monitor is its name, type and address, never all of them as one', async () => {
  // as Uptime Kuma 1.23 writes it: no monitor_id and no uptime ratios. Two monitors share a name
  const line = (name: string, type: string, url: string, host: string, v: number, metric = 'monitor_status') =>
    `${metric}{monitor_name="${name}",monitor_type="${type}",monitor_url="${url}",monitor_hostname="${host}",monitor_port="null"} ${v}`;
  const metrics = [
    line('xoa', 'http', 'http://192.168.1.10/', 'null', 1), line('adguard', 'http', 'http://192.168.1.103/', 'null', 1),
    line('nas', 'http', 'http://192.168.1.20/', 'null', 1), line('nas', 'ping', 'null', '192.168.1.20', 0),
    line('adguard', 'http', 'http://192.168.1.103/', 'null', 14, 'monitor_response_time'),
  ].join('\n');
  const k = make(uptimekuma, { url: 'http://kuma', password: 'x' }, fake(() => new Response(metrics)));
  const card: any = await k.widgets.monitors.fetch();
  valid(card);
  assert.deepEqual(card.items.map((i: any) => [i.name, i.state, i.ms, i.detail]), [['xoa', 'up', undefined, 'up'], ['adguard', 'up', 14, 'up'], ['nas', 'up', undefined, 'up'], ['nas', 'down', undefined, 'down']]);
  assert.deepEqual([card.summary.value, card.summary.sub, card.summary.tone, card.note], ['1 down', 'nas', 'bad', undefined]);
  const allUp = make(uptimekuma, { url: 'http://kuma', password: 'x' }, fake(() => new Response(line('xoa', 'http', 'http://x/', 'null', 1))));
  const one: any = await allUp.widgets.monitors.fetch();
  assert.deepEqual([one.summary.value, one.summary.sub], ['All up', '1 monitor'], 'no percentage nobody sent');
});

test('docker: a container that was made and never run is not down', async () => {
  const d = make(docker, { url: 'http://d' }, fake(() => [
    { Id: '1', Names: ['/musing_chaum'], State: 'created', Status: 'Created', Labels: {} },
    { Id: '2', Names: ['/radarr'], State: 'exited', Status: 'Exited (137) 2 hours ago', Labels: {} }]));
  const c: any = await d.widgets.containers.fetch();
  assert.deepEqual(c.items.map((i: any) => [i.name, i.detail, i.quiet]), [['musing_chaum', 'never started', true], ['radarr', 'exited (137)', false]]);
  assert.equal(c.summary.value, '1 down');
});

test('http: one failed answer gets a second look before it counts as down', async () => {
  let n = 0;
  const h = make(http, { targets: [{ name: 'Mealie', url: 'https://q' }] }, fake(() => { if (!n++) throw new Error('slow DNS'); return new Response('ok'); }));
  const c: any = await h.widgets.status.fetch();
  assert.deepEqual([c.items[0].ok, n], [true, 2]);
});

test('timeline: a problem never cleared stays unresolved until it is', async () => {
  const t = new Timeline();
  t.add('problem', 'Mealie is down'); t.add('problem', 'Plex is down'); t.add('cleared', 'Plex is down');
  assert.deepEqual(t.unresolved(), ['Mealie is down']);
  assert.deepEqual(t.lines(36e5, 40, true).map(l => l.split(' ').at(-1)), ['down']);       // only the "cleared" line
});

test('qbittorrent: stuck torrents are reported, and stay out of the live rings', async () => {
  const q = make(qbittorrent, { url: 'http://q', username: 'u', password: 'p' }, fake(url => {
    if (url.includes('auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=x; path=/' } });
    if (url.includes('transfer/info')) return new Response(JSON.stringify({ dl_info_speed: 0, up_info_speed: 0 }));
    assert.ok(!url.includes('filter=active'));                                              // that filter hides stalled torrents
    return new Response(JSON.stringify([
      { hash: 'a', name: 'Dead film', state: 'stalledDL', progress: 0, dlspeed: 0, amount_left: 2e9, eta: 8640000, num_seeds: 0, added_on: Date.now() / 1000 - 7200 },
      { hash: 'b', name: 'No metadata', state: 'metaDL', progress: 0, dlspeed: 0, amount_left: 0, eta: 8640000, num_seeds: 0 },
      { hash: 'c', name: 'Finished', state: 'uploading', progress: 1, dlspeed: 0, amount_left: 0, eta: 0, num_seeds: 3 }]));
  }));
  const card: any = await q.widgets.active.fetch();
  valid(card);
  assert.deepEqual([card.summary.sub, card.summary.tone], ['2 stuck', 'bad']);
  assert.equal(card.activity, undefined);
  assert.deepEqual(card.items.map((i: any) => i.detail), ['Stalled · 1.9 GB left', 'Finding peers']);
  const { data }: any = await q.tools.downloads_status.run({}, {} as any);
  assert.deepEqual([data.count, data.stuck, data.torrents[0].waitingHours], [2, 2, 2]);
});

test('releases: being rate limited is an error, not "no releases"', async () => {
  const r = make(releases, { repos: ['a/b'] }, fake(() => { throw new Error('api.github.com answered 403'); }));
  await assert.rejects(r.widgets.latest.fetch(), /403/);
});

test('qbittorrent: a pack added by hand still finds its show, season and quality', async () => {
  const q = make(qbittorrent, { url: 'http://q', username: 'u', password: 'p', arr: [{ type: 'sonarr', url: 'http://s', apiKey: 'k' }] }, fake(url => {
    if (url.includes('auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=x; path=/' } });
    if (url.includes('transfer/info')) return new Response(JSON.stringify({ dl_info_speed: 0, up_info_speed: 0 }));
    if (url.includes('torrents/info')) return new Response(JSON.stringify([{ hash: 'a', name: 'Full House S03 1080p WEBRip x265-RARBG', state: 'downloading', progress: .04, dlspeed: 1e6, amount_left: 8e9, eta: 900, added_on: 1 }, { hash: 'b', name: 'Something.Else.2019.1080p', state: 'downloading', progress: .1, dlspeed: 1e6, amount_left: 1e9, eta: 900, added_on: 1 }, { hash: 'c', name: 'Full House S01E37E38E39 WEB-DL', state: 'downloading', progress: .1, dlspeed: 1e6, amount_left: 1e9, eta: 900, added_on: 1 }]));
    if (url.includes('/queue')) return { records: [] };
    return [{ title: 'Full House', images: [{ coverType: 'poster', remoteUrl: 'https://img/original/fh.jpg' }] }];
  }));
  const c: any = await q.widgets.active.fetch();
  valid(c);
  assert.deepEqual([c.items[0].title, c.items[0].image, c.items[0].tags.slice(0, 2)], ['Full House', 'https://img/w500/fh.jpg', ['Season 3', 'WEBRip-1080p']]);
  assert.equal(c.items[1].title, 'Something.Else.2019.1080p');                                // nothing to match: the name, as it is
  assert.equal(c.items[2].title, 'Full House');                                               // three episodes in one file
});

test('scrutiny: a failing drive is called out', async () => {
  const s = make(scrutiny, { url: 'http://s' }, fake(() => ({ data: { summary: {
    a: { device: { device_name: 'sda', model_name: 'Disk A', device_status: 0 }, smart: { temp: 40, power_on_hours: 9000 } },
    b: { device: { device_name: 'sdb', model_name: 'Disk B', device_status: 2 }, smart: { temp: 61, power_on_hours: 20 } } } } })));
  const card: any = await s.widgets.drives.fetch();
  valid(card);
  assert.equal(card.summary.value, '1 failing');
  assert.deepEqual(card.summary.marks.map((m: any) => m.tone), [undefined, 'bad']);   // one bar per drive
  assert.equal(card.items[1].tone, 'bad');
});

test('scrutiny: age and temperature are told apart, and normal ends where hot begins', async () => {
  const s = make(scrutiny, { url: 'http://s', hotC: 50 }, fake(() => ({ data: { summary: { a: { device: { device_name: 'sda', device_status: 0 }, smart: { temp: 40, power_on_hours: 17520 } } } } })));
  const card: any = await s.widgets.drives.fetch(); valid(card);
  assert.equal(card.items[0].subtitle, 'Powered on 2 years');
  assert.deepEqual(card.items[0].band, [.125, .75]);
});

test('pihole: paused says until when with one way out; totals match the headline', async () => {
  let blocking = 'disabled';
  const ctx = fake((url, init) => {
    if (url.includes('/auth')) return { session: { valid: true, sid: 's' } };
    if (url.includes('dns/blocking')) { if (init.method === 'POST') blocking = 'enabled'; return { blocking, timer: blocking === 'enabled' ? null : 300 }; }
    if (url.includes('summary')) return { queries: { total: 1000, blocked: 140, percent_blocked: 14 }, clients: { active: 3 } };
    if (url.includes('history')) return { history: [{ timestamp: 1, total: 10, blocked: 1 }, { timestamp: 2, total: 20, blocked: 2 }] };
    return { domains: [{ domain: 'ads.example', count: 9 }] };
  });
  const p = make(pihole, { url: 'http://pi', password: 'x' }, ctx);
  const t0 = Date.now(), c: any = await p.widgets.stats.fetch(); valid(c);
  assert.equal(c.banner.text, 'Blocking paused'); assert.ok(c.banner.until >= t0 + 299_000 && c.banner.until <= Date.now() + 300_000);
  assert.deepEqual(c.banner.button.args, { minutes: 0 }); assert.equal(c.buttons, undefined);     // said once
  assert.deepEqual(c.series.map((x: any) => x.total), [140, 860]); assert.equal(c.window, 'last 24 hours'); assert.match(c.factsNote, /blocked/i);
  assert.deepEqual(await p.actions!.pause.run({ minutes: 0 }), { done: 'Resumed ad blocking' });
  const on: any = await p.widgets.stats.fetch();
  assert.equal(on.banner, undefined); assert.equal(on.buttons.length, 2);
});

test('changedetection: trouble first, the change itself, and a snapshot is read once', async () => {
  const now = Math.floor(Date.now() / 1000), reads: string[] = [];
  const list = {
    '00000000-0000-4000-8000-000000000001': { title: 'Quiet', url: 'http://q', last_changed: 0, last_checked: now, last_error: false, viewed: false },
    '00000000-0000-4000-8000-000000000002': { title: 'Desk', url: 'http://d', last_changed: now - 600, last_checked: now, last_error: false, viewed: false },
    '00000000-0000-4000-8000-000000000003': { title: 'Shop', url: 'http://s', last_changed: 0, last_checked: now, last_error: 'Timed out', viewed: true },
  };
  const k = make(changedetection, { url: 'http://c', key: 'x', href: 'http://watch' }, fake(url => {
    if (url.endsWith('/watch')) return list;
    reads.push(url);
    return url.includes('/difference/') ? new Response('(removed) Sold out\n(added) In stock') : new Response('In stock');
  }));
  const c: any = await k.widgets.watches.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.title, i.dot]), [['Shop', 'bad'], ['Desk', 'good'], ['Quiet', undefined]]);
  assert.equal(c.items[0].subtitle, 'Timed out');
  assert.equal(c.items[1].detail, 'In stock');
  assert.equal(c.summary.value, '1 failing'); assert.equal(c.summary.tone, 'bad');
  const once = reads.length; await k.widgets.watches.fetch();
  assert.equal(reads.length, once);
});

test('changedetection: a short snapshot of facts becomes rows, prose stays a preview', async () => {
  const id = '00000000-0000-4000-8000-000000000001', list = { [id]: { title: 'Shop', url: 'http://s', last_changed: 0, last_checked: 1, last_error: false, viewed: true } };
  const facts = make(changedetection, { url: 'http://c', key: 'x' }, fake(url => url.endsWith('/watch') ? list : new Response('North: In stock\nSouth: Sold out')));
  const c: any = await facts.widgets.watches.fetch(); valid(c);
  assert.deepEqual(c.items.slice(1).map((i: any) => [i.title, i.meta]), [['North', 'In stock'], ['South', 'Sold out']]);
  const prose = make(changedetection, { url: 'http://c', key: 'x' }, fake(url => url.endsWith('/watch') ? list : new Response('A long page of words')));
  const d: any = await prose.widgets.watches.fetch();
  assert.equal(d.items.length, 1); assert.equal(d.items[0].detail, 'A long page of words');
});

test('changedetection: a long snapshot keeps the rows that differ and folds the rest', async () => {
  const list = { '00000000-0000-4000-8000-000000000001': { title: 'Shop', url: 'http://s', last_changed: 0, last_checked: 1, last_error: false, viewed: true } };
  const page = (open: boolean) => Array.from({ length: 12 }, (_, i) => `Store ${i}: ${open && i === 3 ? 'In stock' : 'Sold out'}`).join('\n');
  const rows = async (open: boolean) => ((await make(changedetection, { url: 'http://c', key: 'x' }, fake(url => url.endsWith('/watch') ? list : new Response(page(open)))).widgets.watches.fetch()) as any).items.slice(1).map((i: any) => [i.title, i.meta]);
  assert.deepEqual(await rows(false), [['All 12', 'Sold out']]);
  assert.deepEqual(await rows(true), [['Store 3', 'In stock'], ['11 others', 'Sold out']]);
});

test('changedetection: what reaches the model leaves out the notification URLs', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const k = make(changedetection, { url: 'http://c', key: 'x' }, fake(url => url.includes('/history/') ? new Response('Hello') : { title: 'Page', url: 'http://p', notification_urls: ['tgram://secret/1'] }));
  const r: any = await k.tools!.watch_read.run({ id }); valid(r.card);
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('karakeep: archiving can be taken back, and the title goes to its search', async () => {
  const calls: any[] = [];
  const k = make(karakeep, { url: 'http://k', apiKey: 'x' }, fake((url, init) => { if (init.method === 'PATCH') calls.push([url, init.body]); return { bookmarks: [] }; }));
  await k.actions!.archive.run({ id: 'abc' }); await k.actions!.unarchive.run({ id: 'abc' });
  assert.deepEqual(calls.map(c => JSON.parse(c[1]).archived), [true, false]);
  const c: any = await k.widgets.recent.fetch(); valid(c);
  assert.equal(c.href, 'http://k/dashboard/search'); assert.equal(c.archived, 'http://k/dashboard/archive');
});

test('seerr: each ticket says what to do next, and what a part-filled one is missing', async () => {
  const media = (status: number, more = {}) => ({ type: 'tv', media: { tmdbId: status, status, ...more } });
  const s = make(seerr, { url: 'http://s', apiKey: 'x', downloads: 'http://dl' }, fake(url => url.includes('request?') ? { results: [
    media(5, { plexUrl: 'http://plex/5' }), media(3, { downloadStatus: [{ size: 100, sizeLeft: 25 }] }), media(4, { plexUrl: 'http://plex/4', seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 3 }] }), media(2)] } : { id: 1, name: 'Show' }));
  const c: any = await s.widgets.requests.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.cta?.label, i.cta?.href, i.note]), [['Watch', 'http://plex/5', undefined], ['See progress', 'http://dl', '75% there'], ['Watch what\'s here', 'http://plex/4', 'Missing S2'], [undefined, undefined, undefined]]);
});

const watch = (title: string, month: number, day: number, hours: number, show = true) => ({ date: new Date(2025, month, day, 20).getTime() / 1000, media_type: show ? 'episode' : 'movie', title: show ? 'Pilot' : title, grandparent_title: show ? title : '', thumb: `/library/metadata/${title.length}/thumb/1`, play_duration: hours * 3600 });

test('tautulli race: running hours per show or film, a step a month, and only titles that reach the board', () => {
  const r = raceOf([watch('A', 0, 3, 1), watch('A', 0, 9, 2), watch('B', 1, 1, 5), watch('C', 3, 2, 2, false), watch('A', 3, 9, 1), ...'DEFGH'.split('').map((t, i) => watch(t, 3, 12, 6 + i)), { ...watch('Song', 3, 3, 9), media_type: 'track' }], t => `/img${t}`)!;
  assert.deepEqual(r.steps, ['Jan', 'Feb', 'Mar', 'Apr']);
  assert.deepEqual(r.items.find(i => i.title === 'A')!.points, [3, 3, 3, 4]);   // a quiet month carries forward
  assert.deepEqual(r.items.find(i => i.title === 'B')!.points, [0, 5, 5, 5]);
  assert.equal(r.items[0].title, 'H');
  assert.ok(!r.items.some(i => i.title === 'Song'));
  assert.ok(r.items.every(i => i.points.every((p, k) => !k || p >= i.points[k - 1])));
  assert.ok(r.items.some(i => i.title === 'A'), 'led early, so it stays on the card');
  assert.ok(!r.items.some(i => i.title === 'C'), 'never on the board');
});

test('tautulli race: too few months go day by day, and too little is no race at all', () => {
  const r = raceOf([watch('A', 9, 20, 1), watch('B', 9, 21, 2), watch('C', 9, 23, 3)], t => t)!;
  assert.deepEqual(r.steps, ['Oct 20', 'Oct 21', 'Oct 22', 'Oct 23']);
  assert.deepEqual(r.items.map(i => i.points), [[0, 0, 0, 3], [0, 2, 2, 2], [1, 1, 1, 1]]);
  assert.equal(raceOf([watch('A', 9, 20, 1), watch('B', 9, 22, 1)], t => t), undefined);
  assert.equal(raceOf([], t => t), undefined);
});

test('tautulli race: asks a month at a time in pages, and only ever re-asks this month', async () => {
  const year = new Date().getFullYear(), month = new Date().getMonth(), asked: URLSearchParams[] = [];
  const t = make(tautulli, { url: 'http://t', apiKey: 'x' }, fake(url => {
    const q = new URL(url).searchParams; asked.push(q);
    const rows = q.get('after') === `${year}-01-01` && q.get('start') === '0' ? Array.from({ length: 1000 }, () => ({ date: new Date(year, 0, 2).getTime() / 1000, media_type: 'movie', title: 'Long', play_duration: 3600 })) : [];
    return { response: { result: 'success', data: { data: rows } } };
  }));
  const card: any = await t.widgets.race.fetch();
  assert.equal(asked.length, month + 2);   // January took two pages
  assert.equal(asked[1].get('start'), '1000');
  assert.ok(asked.every(q => q.get('after')!.slice(0, 7) === q.get('before')!.slice(0, 7)), 'each stays inside its month');
  assert.ok(checkCard(card).success);
  assert.equal(card.items.length, 0);   // a single title isn't a race, so the card says there's nothing to draw
  asked.length = 0;
  await t.widgets.race.fetch();
  assert.equal(asked.length, month ? 1 : 2);
});

test('tautulli: the year of days comes from one call, and a year-in-review slide carries the race', async () => {
  const rows = [watch('A', 0, 3, 9), watch('B', 1, 3, 7), watch('A', 1, 9, 1), watch('C', 2, 3, 2), watch('B', 3, 3, 6)];
  const t = make(tautulli, { url: 'http://t', apiKey: 'x' }, fake(url => ({ response: { result: 'success', data: url.includes('get_plays_by_date') ? { categories: ['2025-01-01', '2025-01-02'], series: [{ name: 'TV', data: [1, 2] }, { name: 'Total', data: [1, 3] }] } : url.includes('get_history') ? { data: rows } : url.includes('get_metadata') ? {} : url.includes('get_recently_added') ? { recently_added: [] } : {} } })));
  const card: any = await t.widgets.viewing.fetch();
  assert.ok(checkCard(card).success);
  assert.deepEqual([card.from, card.days], ['2025-01-01', [1, 3]]);
  const top = (await t.recap!({ year: 2025, from: Date.UTC(2025, 0, 1), to: Date.UTC(2026, 0, 1) })).find(s => s.id === 'watch.top')!;
  assert.equal(top.value, 'B');
  assert.equal(top.race?.steps.length, 4);
  assert.match(top.line, /In front from Apr\./);
});

test('tautulli: one list of who watched most, and whoever is on now says what', async () => {
  let streams: any[] = [{ friendly_name: 'Theo', title: 'Dune', media_type: 'movie', state: 'playing' }];
  const t = make(tautulli, { url: 'http://t', apiKey: 'x' }, fake(url => ({ response: { result: 'success', data: url.includes('get_activity') ? { stream_count: streams.length, total_bandwidth: 0, sessions: streams }
    : [{ stat_id: 'top_users', rows: [{ friendly_name: 'Theo', total_duration: 3600 }] }, { stat_id: 'top_movies', rows: [] }, { stat_id: 'top_tv', rows: [] }] } })));
  const both: any = await t.widgets.people.fetch(); valid(both);
  assert.equal(both.items.length, 1); assert.equal(both.items[0].subtitle, 'Watching Dune'); assert.equal(both.note, 'Everyone · last 30 days');
  streams = [];
  const quiet: any = await t.widgets.people.fetch();
  assert.equal(quiet.items[0].subtitle, undefined); assert.equal(quiet.note, 'Everyone · last 30 days');
  assert.equal(((await t.widgets.top.fetch()) as any).note, 'Everyone · last 30 days');
});

test('arr: what\'s ready opens where it can be watched, and only says Plex when it is', async () => {
  const eps = [{ airDateUtc: new Date().toISOString(), seasonNumber: 1, episodeNumber: 1, hasFile: true, series: { title: 'Show & Co', titleSlug: 'show' } }, { airDateUtc: new Date().toISOString(), seasonNumber: 1, episodeNumber: 2, hasFile: false, series: { title: 'Later', titleSlug: 'later' } }];
  const go = async (cfg: object) => ((await make(arr, { sonarr: { url: 'http://s', apiKey: 'k' }, ...cfg }, fake(() => eps)).widgets.upcoming.fetch()) as any).items;
  assert.deepEqual((await go({ plex: 'http://plex:32400/' }))[0].cta, { label: 'Open in Plex', href: 'http://plex:32400/web/index.html#!/search?query=Show%20%26%20Co' });
  assert.deepEqual((await go({}))[0].cta, { label: 'Open in Sonarr', href: 'http://s/series/show' });
  assert.equal((await go({}))[1].cta, undefined);
});

test('activity: the log reads as what, to what, how it went, who', async () => {
  assert.equal(sentence({ what: 'Requested', input: { title: 'Dune', tmdb_id: 1 } }), 'Requested Dune');
  assert.equal(sentence({ what: 'Searched for it', input: { title: 'Dune' } }), 'Searched for Dune');
  assert.equal(sentence({ what: 'Stopped a stream', input: { who: 'Theo' } }), 'Stopped a stream: Theo');
  assert.equal(sentence({ what: 'Saved a link', input: { url: 'https://www.example.com/a?b=1' } }), 'Saved a link: example.com');
  assert.equal(sentence({ what: 'Pi-hole: Pause or resume ad blocking', action: 'Paused ad blocking for 5 min', input: { minutes: 5 } }), 'Paused ad blocking for 5 min');   // a number names nothing
  assert.equal(sentence({ what: 'Paused downloads', input: { hash: 'abc' } }), 'Paused downloads');
  assert.equal(outcome({ ok: true, who: 'you', via: 'page' }), 'worked · you');
  assert.equal(outcome({ ok: false, error: 'timed out', who: 'you', via: 'chat' }), 'failed: timed out · you in chat');
  assert.equal(outcome({ ok: true, undone: true, who: 'you', via: 'page' }), 'undone · you');
  const log = new Activity(), e = log.add({ who: 'you', via: 'chat', what: 'Requested', input: { title: 'Dune' }, ok: true });
  assert.deepEqual([e.action, e.target], ['Requested', 'Dune']);
});

test('docker: states tell a sick container from a stopped one and a finished job; updates keep them all', async () => {
  const { default: docker } = await import('../src/integrations/docker.ts');
  const list = [{ Id: '1', Names: ['/a'], State: 'running', Status: 'Up 1 day (healthy)', Labels: {} }, { Id: '2', Names: ['/b'], State: 'running', Status: 'Up 1 day', Labels: {} }, { Id: '3', Names: ['/c'], State: 'running', Status: 'Up 1 day (unhealthy)', Labels: {} }, { Id: '4', Names: ['/d'], State: 'exited', Status: 'Exited (1) 1 day ago', Labels: {} }, { Id: '5', Names: ['/e'], State: 'exited', Status: 'Exited (0) 1 day ago', Labels: {} }];
  const c: any = await make(docker, { url: 'http://p' }, fake(() => list)).widgets.containers.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.state, i.detail]), [['up', 'healthy'], ['up', undefined], ['degraded', 'unhealthy'], ['down', 'exited (1)'], ['off', 'exited (0)']]);
});

test('arr: episodes and movies come out in date order with friendly days', async () => {
  const soon = (d: number) => new Date(noonIn(d)).toISOString();
  const a = make(arr, { sonarr: { url: 'http://s', apiKey: 'k' }, radarr: { url: 'http://r', apiKey: 'k' } }, fake(url => url.startsWith('http://s')
    ? [{ airDateUtc: soon(3), seasonNumber: 1, episodeNumber: 2, title: 'Two', hasFile: false, series: { title: 'Show', images: [{ coverType: 'fanart', remoteUrl: 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg' }] } }]
    : [{ title: 'Film', year: 2026, digitalRelease: soon(1), hasFile: false, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/x.jpg' }, { coverType: 'fanart', remoteUrl: 'https://image.tmdb.org/t/p/original/y.jpg' }] }]));
  const card: any = await a.widgets.upcoming.fetch();
  valid(card);
  assert.deepEqual(card.items.map((i: any) => i.title), ['Film', 'Show']);
  assert.equal(card.items[0].badge, 'Tomorrow');
  assert.equal(card.items[0].image, 'https://image.tmdb.org/t/p/w342/x.jpg');
  assert.deepEqual([card.summary.value, card.summary.sub, card.summary.image], ['Film', 'Tomorrow', 'https://image.tmdb.org/t/p/w780/y.jpg']);
  assert.equal(card.items[1].backdrop, 'https://artworks.thetvdb.com/banners/fanart/original/1.jpg');   // only TMDB has sized copies
});

test('home assistant schedule: next time rolls to tomorrow, and shows as a live ring when close', async () => {
  const t = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
  const states = [
    { entity_id: 'sensor.a', state: t(-300), attributes: {} },   // already passed today
    { entity_id: 'sensor.b', state: t(10), attributes: {} },     // in 10 minutes
    { entity_id: 'sensor.c', state: t(-100), attributes: {} },   // muted
  ];
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', schedules: { p: { title: 'Tides', soon: 15,
    entities: [{ id: 'sensor.a', name: 'A' }, { id: 'sensor.b', name: 'B' }, { id: 'sensor.c', name: 'C', muted: true }] } } }, fake(() => states));
  const card: any = await ha.widgets.p.fetch();
  valid(card);
  assert.equal(card.summary.value, 'B');
  assert.ok(card.activity?.title.startsWith('B in'));
  states[1].state = t(-5);   // B passed too: next is A, tomorrow; nothing close
  const later: any = await ha.widgets.p.fetch();
  assert.equal(later.summary.value, 'A');
  assert.equal(later.activity, undefined);
});

test('home assistant cards: rows carry a small icon, and a lock, a garage door or a person says how things stand', async () => {
  const states = [
    { entity_id: 'lock.front', state: 'locked', attributes: { friendly_name: 'Front door' } },
    { entity_id: 'lock.back', state: 'unlocked', attributes: { friendly_name: 'Back door' } },
    { entity_id: 'cover.garage', state: 'open', attributes: { friendly_name: 'Garage', device_class: 'garage' } },
    { entity_id: 'person.sam', state: 'not_home', attributes: { friendly_name: 'Sam' } },
    { entity_id: 'person.kim', state: 'home', attributes: { friendly_name: 'Kim' } },
    { entity_id: 'sensor.solar', state: '8.4', attributes: { unit_of_measurement: 'kWh', device_class: 'energy', icon: 'mdi:solar-power' } },
    { entity_id: 'sensor.used', state: '9.7', attributes: { unit_of_measurement: 'kWh', device_class: 'energy' } },
    { entity_id: 'sensor.washer', state: 'Finished', attributes: {} },
    { entity_id: 'light.desk', state: 'on', attributes: {} },
  ];
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', cards: { h: { title: 'House', entities: [...states.slice(0, 7).map(s => s.entity_id), { id: 'sensor.washer', icon: 'washer' }, 'light.desk'] } } }, fake(() => states));
  const card: any = await ha.widgets.h.fetch();
  valid(card);
  const row = (id: string) => card.items.find((i: any) => i.id === id);
  assert.deepEqual([row('lock.front').icon, row('lock.front').tone, row('lock.front').value], ['lock', 'good', 'Locked']);
  assert.deepEqual([row('lock.back').icon, row('lock.back').tone], ['unlock', 'warn']);
  assert.deepEqual([row('cover.garage').icon, row('cover.garage').tone, row('cover.garage').value], ['garage', 'warn', 'Open']);
  assert.deepEqual([row('person.sam').value, row('person.sam').tone, row('person.kim').tone], ['Away', undefined, 'good']);
  assert.deepEqual([row('sensor.solar').icon, row('sensor.used').icon, row('sensor.used').value], ['sun', 'bolt', '9.7 kWh']);
  assert.deepEqual([row('sensor.washer').icon, row('sensor.washer').label, row('sensor.washer').value], ['washer', 'sensor.washer', 'Finished']);   // an icon alone, no name: the entity's own
  assert.equal(row('light.desk').icon, undefined);   // a light keeps its colour swatch
});

test('home assistant: a switch pressed shows on the next look, not the state kept from just before', async () => {
  let lamp = 'off', asked = 0;
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', cards: { h: { title: 'House', entities: ['light.lamp'] } } }, fake((url: string, init: any) => {
    if (url.endsWith('/api/states')) { asked++; return [{ entity_id: 'light.lamp', state: lamp, attributes: { friendly_name: 'Lamp' } }]; }
    if (url.includes('/api/services/')) { lamp = url.endsWith('turn_on') ? 'on' : 'off'; return []; }
  }));
  const value = async () => ((await ha.widgets.h.fetch()) as any).items[0].value;
  assert.equal(await value(), false);
  await ha.actions!.set.run({ entity_id: 'light.lamp', value: true });
  assert.equal(await value(), true, 'within the two seconds states are kept, a press still asks the house again');
  assert.equal(asked, 2);
  assert.equal(await value(), true); assert.equal(asked, 2, 'and otherwise they are kept, as before');
});

const climate = (over: Record<string, unknown> = {}, state = 'heat') => ({ entity_id: 'climate.hall', state, attributes: { friendly_name: 'Hall', hvac_modes: ['off', 'heat'], preset_modes: ['none', 'home', 'sleep'], preset_mode: 'home',
  hvac_action: 'idle', temperature: 20, current_temperature: 19.5, min_temp: 7, max_temp: 30, target_temp_step: .5, ...over } });
const thermostatHA = (entity: object, more: object = {}, seen: { url: string; body?: unknown }[] = [], unit = '°C') => make(homeassistant, { url: 'http://ha', token: 'x', thermostats: { hall: { entity: 'climate.hall', ...more } } }, fake((url, init) => {
  seen.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
  return url.endsWith('/api/states') ? [entity] : url.endsWith('/api/config') ? { unit_system: { temperature: unit } } : {};
}));

test('home assistant thermostat: a climate entity becomes a dial with its modes', async () => {
  const card: any = await thermostatHA(climate()).widgets.hall.fetch();
  valid(card);
  assert.deepEqual([card.title, card.unit, card.state, card.mode, card.target, card.current, card.min, card.max, card.step], ['Hall', 'C', 'Idle', 'heat', 20, 19.5, 7, 30, .5]);
  assert.deepEqual(card.modes.map((m: any) => [m.id, !!m.on]), [['off', false], ['heat', true], ['home', true], ['sleep', false]]);
  assert.equal(card.modes.find((m: any) => m.id === 'home').args.preset_mode, 'none');   // pressing the active preset clears it
  assert.equal(card.summary.value, '20.0°C');
  const picked: any = await thermostatHA(climate(), { modes: ['sleep', 'off', 'nope'], title: 'Upstairs' }).widgets.hall.fetch();
  assert.deepEqual([picked.title, picked.modes.map((m: any) => m.id)], ['Upstairs', ['sleep', 'off']]);
});

test('home assistant thermostat: nothing broken without a target, and each state stays valid', async () => {
  for (const [entity, want] of [
    [climate({ temperature: null, hvac_action: 'fan' }, 'fan_only'), { target: undefined, state: 'Fan', set: undefined }],
    [climate({ temperature: null, target_temp_low: 20, target_temp_high: 24, hvac_action: undefined }, 'heat_cool'), { target: undefined, range: [20, 24], mode: 'auto' }],
    [climate({}, 'off'), { target: undefined, mode: 'off', state: 'Idle' }],
    [{ entity_id: 'climate.hall', state: 'unavailable', attributes: {} }, { state: 'Unavailable', target: undefined, modes: undefined, mode: 'off' }],
  ] as [object, Record<string, unknown>][]) {
    const card: any = await thermostatHA(entity).widgets.hall.fetch();
    valid(card);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(card[k], v, k);
    assert.ok(!JSON.stringify(card).match(/NaN|undefined/));
  }
  await assert.rejects(make(homeassistant, { url: 'http://ha', token: 'x', thermostats: { hall: { entity: 'climate.hall' } } }, fake(() => [])).widgets.hall.fetch(), /not found/);
  assert.throws(() => homeassistant.config.parse({ url: 'http://ha', token: 'x', thermostats: { a: { entity: 'light.x' } } }));
});

test('home assistant thermostat: Fahrenheit comes from Home Assistant, or the config, or the range', async () => {
  const f = { min_temp: 45, max_temp: 95, temperature: 68, current_temperature: 67, target_temp_step: undefined };
  const card: any = await thermostatHA(climate(f), {}, [], '°F').widgets.hall.fetch();
  assert.deepEqual([card.unit, card.step, card.summary.value], ['F', 1, '68°F']);
  assert.equal(((await thermostatHA(climate(), { unit: 'F' }).widgets.hall.fetch()) as any).unit, 'F');
  const blind = make(homeassistant, { url: 'http://ha', token: 'x', thermostats: { hall: { entity: 'climate.hall' } } }, fake(url => { if (url.endsWith('/api/config')) throw new Error('no'); return [climate(f)]; }));
  assert.equal(((await blind.widgets.hall.fetch()) as any).unit, 'F');
});

test('home assistant thermostat: actions stay within the entity and the page', async () => {
  const seen: { url: string; body?: any }[] = [], ha = thermostatHA(climate(), {}, seen), run = ha.actions!.climate.run;
  await run({ entity_id: 'climate.hall', temperature: 21.5 });
  await run({ entity_id: 'climate.hall', hvac_mode: 'off' });
  await run({ entity_id: 'climate.hall', preset_mode: 'sleep' });
  const posted = seen.filter(s => s.body).map(s => [s.url.split('/services/')[1], s.body]);
  assert.deepEqual(posted, [['climate/set_temperature', { entity_id: 'climate.hall', temperature: 21.5 }], ['climate/set_hvac_mode', { entity_id: 'climate.hall', hvac_mode: 'off' }], ['climate/set_preset_mode', { entity_id: 'climate.hall', preset_mode: 'sleep' }]]);
  await assert.rejects(run({ entity_id: 'climate.hall', temperature: 99 }), /outside/);
  await assert.rejects(run({ entity_id: 'climate.hall', hvac_mode: 'cool' }), /no mode/);
  await assert.rejects(run({ entity_id: 'climate.hall', preset_mode: 'party' }), /no preset/);
  await assert.rejects(run({ entity_id: 'climate.other', temperature: 20 }), /isn't a thermostat on the page/);
  await assert.rejects(run({ entity_id: 'climate.hall' }), /nothing to change/);
  assert.equal(seen.filter(s => s.body).length, 3, 'a refused change never reaches Home Assistant');
  assert.equal(ha.tools!.home_climate.access, 'control');
  assert.match((await ha.tools!.home_climate.confirm!({ entity_id: 'climate.hall', temperature: 22 })).title, /Set Hall to 22°/);
});

const ics = (...events: string[]) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const stampICS = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
test('calendar agenda: one download covers the page, the months ahead and the assistant', async () => {
  const soon = new Date(Date.now() + 2 * 864e5), later = new Date(new Date().getFullYear(), new Date().getMonth() + 4, 15), gone = new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1);
  const feed = ics(`BEGIN:VEVENT\r\nSUMMARY:Soon\r\nDTSTART;VALUE=DATE:${stampICS(soon)}\r\nEND:VEVENT`, `BEGIN:VEVENT\r\nSUMMARY:Later\r\nDTSTART:${stampICS(later)}T090000\r\nDTEND:${stampICS(later)}T100000\r\nEND:VEVENT`, `BEGIN:VEVENT\r\nSUMMARY:Gone\r\nDTSTART:${stampICS(gone)}T090000\r\nEND:VEVENT`);
  const ctx = fake(() => new Response(feed)), cal = make(calendar, { calendars: [{ url: 'http://c/a.ics', name: 'Family', color: '#123456' }] }, ctx);
  const [card, list] = await Promise.all([cal.widgets.agenda.fetch() as Promise<any>, cal.widgets.upcoming.fetch() as Promise<any>]);
  await cal.widgets.agenda.fetch(); await cal.tools!.calendar_upcoming.run({ days: 7 });
  assert.equal(ctx.calls.length, 1, 'one download, however many ask');
  valid(card);
  assert.deepEqual(card.events.map((e: any) => e.title), ['Soon', 'Later']);
  assert.equal(card.events[0].start, `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`);
  assert.deepEqual([card.events[1].color, card.events[1].calendar], ['#123456', 'Family']);
  assert.ok(card.from < card.events[0].start && card.to > card.events[1].start.slice(0, 10));
  assert.deepEqual(list.items.map((i: any) => i.title), ['Soon']);   // the plain list still looks only `days` ahead
  assert.equal(card.summary.value, 'Soon');
});

test('calendar agenda: a server that fails keeps what it last gave', async () => {
  let up = true;
  const soon = new Date(Date.now() + 864e5), ctx = fake(() => up ? new Response(ics(`BEGIN:VEVENT\r\nSUMMARY:Kept\r\nDTSTART;VALUE=DATE:${stampICS(soon)}\r\nEND:VEVENT`)) : new Response('', { status: 500 }));
  const cal = make(calendar, { calendars: ['http://c/a.ics'] }, ctx), real = Date.now;
  assert.equal(((await cal.widgets.agenda.fetch()) as any).events.length, 1);
  up = false; Date.now = () => real() + 700_000;
  try { assert.equal(((await cal.widgets.agenda.fetch()) as any).events.length, 1); assert.equal(ctx.calls.length, 2); } finally { Date.now = real; }
});

test('weather: the next days come with their own icons, and today isn\'t among them', async () => {
  const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'];
  const w = { timezone: 'UTC', current: { temperature_2m: 16.2, apparent_temperature: 15, weather_code: 3, is_day: 1, precipitation: 0 },
    daily: { time: days, temperature_2m_max: [17, 18, 19, 20, 21, 22], temperature_2m_min: [11, 10, 9, 8, 7, 6], weather_code: [3, 0, 61, 95, 71, 45], precipitation_probability_max: [5, 0, 80, 90, 60, null] },
    hourly: { time: Array.from({ length: 13 }, (_, i) => `2026-03-02T${String(i).padStart(2, '0')}:00`), temperature_2m: Array(13).fill(16), precipitation_probability: Array(13).fill(0), precipitation: Array(13).fill(0), weather_code: Array(13).fill(3), is_day: Array(13).fill(1) } };
  const card: any = await make(weather, { latitude: 1, longitude: 2 }, fake(() => w)).widgets.now.fetch();
  valid(card);
  assert.deepEqual(card.days.map((d: any) => [d.name, d.icon, d.hi, d.lo]), [['Tue', 'sun', 18, 10], ['Wed', 'rain', 19, 9], ['Thu', 'storm', 20, 8], ['Fri', 'snow', 21, 7], ['Sat', 'fog', 22, 6]]);
  assert.equal(card.days[4].pop, undefined);
});

test('notices: only configured changes, never on first load, quiet services stay quiet', async () => {
  const { noticesFor } = await import('../src/server/notices.ts');
  const dl = (live: boolean) => ({ type: 'media', items: [], activity: live ? { title: 'Film', icon: 'download' } : undefined }) as any;
  const svc = (ok: boolean, quiet = false) => ({ type: 'status', items: [{ name: 'Plex', ok }, { name: 'Clock', ok, quiet }] }) as any;
  const rules = [{ widget: 'd', on: 'end' as const, text: '{title} finished' }, { widget: 's', on: 'down' as const }];
  assert.deepEqual(noticesFor('d', undefined, dl(false), rules), []);
  assert.equal(noticesFor('d', dl(true), dl(false), rules)[0].text, 'Film finished');
  assert.deepEqual(noticesFor('d', dl(false), dl(true), rules), []);           // start isn't configured
  const down = noticesFor('s', svc(true, true), svc(false, true), rules);
  assert.deepEqual(down.map(n => n.text), ['Plex is down']);                   // Clock is quiet
  assert.deepEqual(noticesFor('x', dl(true), dl(false), rules), []);           // no rule for this widget
});

test('history: reads numbers out of headlines, and gives a graph to headlines that have none', async () => {
  const { History, numberOf } = await import('../src/server/history.ts');
  assert.deepEqual(['13%', '62 W', '1.38M', '4,452', 7, 'Healthy', 'Idle'].map(numberOf), [13, 62, 1.38e6, 4452, 7, null, null]);
  const h = new History(24, 0);
  let card: any;
  for (const v of ['10%', '12%', '15%']) card = h.apply('w', { type: 'text', text: '', summary: { label: 'x', value: v } } as any);
  assert.deepEqual(card.summary.trend, [10, 12, 15]);
  const own = h.apply('w', { type: 'text', text: '', summary: { label: 'x', value: '16%', trend: [1, 2] } } as any) as any;
  assert.deepEqual(own.summary.trend, [1, 2]);   // a service's own graph wins
});

test('plugins: a one-file plugin loads, can\'t silently take a built-in name, and a broken one is skipped', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'valet-'));
  process.env.VALET_DATA = dir;
  await mkdir(join(dir, 'integrations'));
  const plugin = (type: string) => `export default ({ z, defineIntegration }) => defineIntegration({ type: '${type}', name: 'P', config: z.object({}),
    create: () => ({ widgets: { w: { title: 'W', fetch: async () => ({ type: 'text', text: 'hi' }) } } }) })`;
  await writeFile(join(dir, 'integrations', 'a.mjs'), plugin('hello'));
  await writeFile(join(dir, 'integrations', 'b.mjs'), plugin('tautulli'));          // a built-in name
  await writeFile(join(dir, 'integrations', 'c.mjs'), 'export default 42');         // not an integration
  await writeFile(join(dir, 'integrations', 'd.mjs'), 'throw new Error("boom")');   // crashes on load
  const { loadPlugins } = await import('../src/server/plugins.ts');
  const registry: Record<string, any> = { tautulli: { type: 'tautulli', builtin: true } };
  const loaded = await loadPlugins(registry, [], []);
  assert.deepEqual([...loaded], ['hello']);
  assert.equal(registry.tautulli.builtin, true);
  const card = await registry.hello.create({}, {}).widgets.w.fetch();
  assert.equal(card.text, 'hi');
});

test('security: secrets are redacted, and Valet is read-only without sign-in unless the network is trusted', async () => {
  const { redactor, canAct } = await import('../src/server/security.ts');
  const r = redactor(['s3cr3t-key-123', 'pw12', 'abc', 'another.secret+value']);
  assert.equal(r('GET http://x/?apikey=s3cr3t-key-123 failed'), 'GET http://x/?apikey=••• failed');
  assert.equal(r('pw another.secret+value!'), 'pw •••!');           // regex characters are escaped
  assert.equal(r('pass pw12'), 'pass •••');                          // short passwords too
  assert.equal(r('xpw12y'), 'xpw12y');                               // but only as whole words
  assert.equal(r('abc stays'), 'abc stays');                         // too short to tell from words
  const cfg = (auth: object) => Config.parse({ auth });
  assert.equal(canAct(cfg({})), false);
  assert.equal(canAct(cfg({ mode: 'none', trustNetwork: true })), true);
  assert.equal(canAct(cfg({ mode: 'local' })), true);
});

test('scaffold: new-integration writes a plugin that loads and whose cards and tools work', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-'));
  const { scaffold, loadPlugins } = await import('../src/server/plugins.ts');
  assert.equal(await scaffold('my-service'), 0);
  assert.equal(await scaffold('my-service'), 1);   // won't overwrite
  const registry: Record<string, any> = {};
  await loadPlugins(registry, [], []);
  // the short form checks out as it stands, so a new author starts from something that passes
  const { checkService } = await import('../src/server/service-check.ts');
  assert.deepEqual(await checkService(registry['my-service']), []);
  // the full form: every part of an integration, with a visual of its own
  process.argv.push('--full');
  assert.equal(await scaffold('my-full'), 0);
  process.argv.pop();
  const full: Record<string, any> = {};
  await loadPlugins(full, [], []);
  const i = full['my-full'];
  const inst = i.create(i.config.parse({ url: 'http://x' }), { http: async () => ({}) });
  valid(await inst.widgets.status.fetch());
  assert.equal(inst.tools['my_full_restart'].access, 'control');
  for (const c of inst.commands) { const [kind, name] = c.run.split(':'); assert.ok(inst[kind === 'action' ? 'actions' : 'tools'][name], c.run); }
});

test('check-integration: names what is wrong with a service, in words', async () => {
  const { service } = await import('../src/server/service.ts');
  const { checkService } = await import('../src/server/service-check.ts');
  const s = (over: object) => service({ type: 'x', name: 'X', get: { a: '/a' }, stats: (d: any) => [{ label: 'N', value: d.a.n }], sample: { a: { n: 5 } }, expect: { N: 5 }, ...over });
  assert.deepEqual(await checkService(s({})), []);
  assert.match((await checkService(s({ expect: { N: 6 } }))).join(), /"N" shows 5, expected 6/);
  assert.match((await checkService(s({ sample: { a: {} } , expect: {} }))).join(), /came up empty/);
  assert.match((await checkService(s({ stats: (d: any) => [{ label: 'N', value: d.b.n }] }))).join(), /can't read its own sample/);
});

test('host guard: IPs, localhost and listed names pass; other names are refused (DNS rebinding)', async () => {
  const { hostGuard } = await import('../src/server/security.ts');
  const { Hono } = await import('hono');
  const app = new Hono();
  app.use('*', hostGuard(['valet.example.com', '*.home.example.com']));
  app.get('/', c => c.text('ok'));
  const at = (host: string, fwd?: string) => app.request('/', { headers: { host, ...(fwd ? { 'x-forwarded-host': fwd } : {}) } }).then(r => r.status);
  for (const h of ['localhost:7575', '192.168.1.5:7575', '[::1]:7575', 'valet.example.com', 'dash.home.example.com']) assert.equal(await at(h), 200, h);
  for (const h of ['evil.example.net', 'valet.example.com.evil.net', 'home.example.com']) assert.equal(await at(h), 421, h);
  assert.equal(await at('localhost', 'evil.example.net'), 421);   // a proxy forwarding a strange name
  assert.equal(await at('evil.example.net', 'localhost'), 421);   // a rebinding page can't vouch for itself
});

test('toolkit: session helper signs in once for parallel callers and again after reset; relative days', async () => {
  const { session, fmt } = await import('../src/server/core.ts');
  let n = 0;
  const s = session(async () => { n++; await new Promise(r => setTimeout(r, 5)); return `sid${n}`; });
  assert.deepEqual(await Promise.all([s.get(), s.get(), s.get()]), ['sid1', 'sid1', 'sid1']);
  s.reset();
  assert.equal(await s.get(), 'sid2');
  let fail = true;
  const f = session(async () => { if (fail) throw new Error('no'); return 'ok'; });
  await assert.rejects(f.get());
  fail = false;
  assert.equal(await f.get(), 'ok');   // a failed sign-in isn't cached
  assert.equal(fmt.relativeDay(noonIn(1)), 'Tomorrow');
  assert.equal(fmt.relativeDay(noonIn(-1)), 'Yesterday');
});

test('home assistant: buttons only do what cards offer, never an arbitrary service', async () => {
  const calls: string[] = [];
  const ha = make(homeassistant, { url: 'http://ha', token: 'x', cards: { c: { title: 'C', entities: ['lock.front', 'vacuum.robot', 'sensor.t'] } } },
    fake(url => { calls.push(url); return {}; }));
  await assert.rejects(ha.actions!.press.run({ entity_id: 'lock.front', service: 'unlock' }));
  await assert.rejects(ha.actions!.choose.run({ entity_id: 'sensor.t', value: 'x' }));
  await ha.actions!.press.run({ entity_id: 'vacuum.robot', service: 'start' });
  assert.ok(calls.some(u => u.endsWith('/api/services/vacuum/start')));
});

test('custom api: paths, formats, templates, thresholds, and each way of showing it', async () => {
  const { default: api, pick, fill } = await import('../src/integrations/api.ts');
  assert.equal(pick({ a: { b: [{ c: 1 }] } }, 'a.b[0].c'), 1);
  assert.equal(pick({ a: { b: 1 } }, '$.a.b'), 1);                          // JSONPath habits are fine
  assert.equal(pick({ a: 2 }, '$a'), 2);
  assert.equal(pick({ a: 1 }, 'constructor'), undefined);                   // only the data's own properties
  assert.equal(fill('size|bytes', { size: 2048 }), '2.0 KB');
  assert.equal(fill('ratio|pct', { ratio: .42 }), '42%');
  assert.equal(fill('{used|bytes} of {total|bytes}', { used: 1024, total: 2048 }), '1.0 KB of 2.0 KB');
  assert.equal(fill('n|divide:1000|round:1', { n: 1234 }), 1.2);
  assert.throws(() => fill('n|nope', { n: 1 }), /unknown format "nope"/);

  const body = { cpu: 95, free: 5, name: 'box', items: [{ n: 'a', up: 'healthy', s: 1 }, { n: 'b', up: 'down', s: 2 }] };
  const ctx = fake(() => body);
  const stats = make(api, { url: 'http://x/', title: 'Box', stats: [{ label: 'CPU', value: 'cpu', unit: '%', max: 100, warn: 70, bad: 90 }, { label: 'Free', value: 'free', warn: 20, bad: 10 }, { label: 'Name', value: 'name' }] }, ctx);
  const s: any = await stats.widgets.data.fetch(); valid(s);
  assert.deepEqual(s.items.map((i: any) => [i.value, i.tone, i.pct]), [[95, 'bad', .95], [5, 'bad', undefined], ['box', undefined, undefined]]);
  assert.equal(s.summaries[0].value, '95%');

  const list: any = await make(api, { url: 'http://x/', list: { items: 'items', title: 'n', subtitle: 'status {up}' } }, ctx).widgets.data.fetch(); valid(list);
  assert.deepEqual(list.items.map((i: any) => i.subtitle), ['status healthy', 'status down']);
  const status: any = await make(api, { url: 'http://x/', status: { items: 'items', name: 'n', ok: 'up' } }, ctx).widgets.data.fetch(); valid(status);
  assert.deepEqual([status.items.map((i: any) => i.ok), status.summary.value], [[true, false], '1 down']);
  const rows = make(api, { url: 'http://x/', rows: { Name: 'name', CPU: '{cpu}%' } }, ctx);
  const kv: any = await rows.widgets.data.fetch(); valid(kv);
  assert.deepEqual(kv.rows, [['Name', 'box'], ['CPU', '95%']]);
  assert.deepEqual((await rows.tools!.read.run({})).data, { Name: 'box', CPU: '95%' });

  assert.throws(() => make(api, { url: 'http://x/' }, ctx), /exactly one of/);
  await assert.rejects(make(api, { url: 'http://x/', list: { items: 'name', title: 'n' } }, ctx).widgets.data.fetch(), /isn't a list/);
});

test('docker: reads frames and plain logs, names what\'s down, and offers no way to change anything', async () => {
  const { default: docker, parseLogs, tidyLogs } = await import('../src/integrations/docker.ts');
  const frame = (s: string) => { const b = Buffer.from(s), h = Buffer.alloc(8); h[0] = 1; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
  assert.equal(parseLogs(Buffer.concat([frame('one\n'), frame('two\n')])), 'one\ntwo\n');
  assert.equal(parseLogs(Buffer.from('plain tty log line\n')), 'plain tty log line\n');
  assert.deepEqual(tidyLogs('\u001b[31mERROR\u001b[0m out of memory\nok fine\n\n', 'error'), ['ERROR out of memory']);
  const list = [
    { Id: '1', Names: ['/radarr'], State: 'exited', Status: 'Exited (137) 2 hours ago', Labels: { 'com.docker.compose.project': 'media' } },
    { Id: '2', Names: ['/plex'], State: 'running', Status: 'Up 3 days (unhealthy)', Labels: {} },
    { Id: '3', Names: ['/backup'], State: 'exited', Status: 'Exited (0) 1 hour ago', Labels: {} },
    { Id: '4', Names: ['/caddy'], State: 'running', Status: 'Up 3 days', Labels: {} },
    { Id: '5', Names: ['/hidden'], State: 'running', Status: 'Up', Labels: {} },
  ];
  const calls: string[] = [];
  const ctx = fake(url => { calls.push(url); return url.includes('/logs') ? new Response(frame('2026 boom\n')) : list; });
  const d = make(docker, { url: 'http://proxy:2375', hide: ['hidden'] }, ctx);
  const c: any = await d.widgets.containers.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.name, i.ok, i.detail, i.quiet]), [['backup', false, 'exited (0)', true], ['caddy', true, undefined, false], ['plex', false, 'unhealthy', false], ['radarr', false, 'exited (137)', false]]);
  assert.equal(c.summary.value, '2 down');
  const logs: any = await d.tools!.container_logs.run({ name: 'rad', lines: 50 });
  assert.deepEqual(logs.data.lines, ['2026 boom']);
  await assert.rejects(d.tools!.container_logs.run({ name: 'nothing', lines: 50 }), /no container like/);
  assert.ok(Object.values(d.tools!).every(t => t.access === 'read'));
  assert.equal(d.actions, undefined);
  assert.ok(calls.every(u => !/\/(restart|stop|start|exec|create)\b/.test(u)));
});

test('host: services by name, quiet ones never alert, and logs say what\'s allowed', async () => {
  const { default: host } = await import('../src/integrations/host.ts');
  const services = [{ unit: 'radarr', name: 'radarr', state: 'failed', result: 'exit-code', restarts: 3 }, { unit: 'sonarr', name: 'sonarr', state: 'active' }, { unit: 'user:job', name: 'job', state: 'inactive' }];
  const h = make(host, { url: 'http://agent:7576/', token: 'tok', quiet: ['job'] }, fake(url => url.includes('/logs') ? new Response(JSON.stringify(url.includes('ssh') ? { error: 'not a listed service', listed: ['radarr'] } : { lines: ['boom'] }), { status: url.includes('ssh') ? 404 : 200 }) : { host: 'nas', services }));
  const c: any = await h.widgets.services.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.name, i.ok, i.detail, i.quiet]), [['radarr', false, 'failed (exit-code)', false], ['sonarr', true, undefined, false], ['job', false, 'inactive', true]]);
  assert.equal(c.summary.value, '1 down');
  assert.deepEqual(((await h.tools!.service_logs.run({ name: 'radarr.service', lines: 50 })) as any).data.lines, ['boom']);
  assert.deepEqual(((await h.tools!.service_logs.run({ name: 'ssh', lines: 50 })) as any).data.listed, ['radarr']);
  assert.ok(Object.values(h.tools!).every(t => t.access === 'read'));
});

test('updates: reading images and versions, and only comparing like with like', async () => {
  const { listTags, newest, parseImage, warnings } = await import('../src/server/registry.ts');
  assert.deepEqual(parseImage('ghcr.io/immich-app/immich-server:v3.3.5'), { registry: 'ghcr.io', repo: 'immich-app/immich-server', tag: 'v3.3.5' });
  assert.deepEqual(parseImage('nginx'), { registry: 'registry-1.docker.io', repo: 'library/nginx', tag: 'latest' });
  assert.deepEqual(parseImage('mccloud/subgen:2026.07.3'), { registry: 'registry-1.docker.io', repo: 'mccloud/subgen', tag: '2026.07.3' });
  assert.deepEqual(parseImage('lscr.io/linuxserver/bazarr:1.5.2@sha256:abc'), { registry: 'lscr.io', repo: 'linuxserver/bazarr', tag: '1.5.2' });
  assert.equal(parseImage('sha256:deadbeef'), null);

  assert.deepEqual(newest('v1.2.3', ['v1.2.3', 'v1.2.4', 'v1.10.0', 'v1.9.9', '2.0.0-rc1', 'v2.0.0-beta']), { tag: 'v1.10.0', major: false });   // numbers, not text
  assert.deepEqual(newest('15-alpine', ['15-alpine', '16-alpine', '17', '17-bookworm']), { tag: '16-alpine', major: true });                    // the same flavour
  assert.equal(newest('1.2.3', ['1.2.2', '1.2.3', 'latest']), null);
  assert.equal(newest('latest', ['1.2.3']), null);
  assert.deepEqual(newest('2026.10.25-54ca1d9cf', ['2026.10.25-54ca1d9cf', '2026.10.29-aabbccd1']), { tag: '2026.10.29-aabbccd1', major: false }); // a hash isn't a flavour
  assert.deepEqual(warnings('# 3.4\n- **Breaking**: config moved\n- faster search\n* Requires a database migration'), ['Breaking: config moved', 'Requires a database migration']);

  // the anonymous token dance every registry shares
  const seen: string[] = [];
  const tags = await listTags({ registry: 'ghcr.io', repo: 'a/b', tag: '1' }, async (url, headers) => {
    seen.push(url);
    if (url.includes('/token')) return new Response(JSON.stringify({ token: 'T' }));
    if (headers?.Authorization !== 'Bearer T') return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"' } });
    return new Response(JSON.stringify({ tags: ['1', '2'] }));
  });
  assert.deepEqual(tags, ['1', '2']);
  assert.match(seen[1], /token\?service=ghcr\.io&scope=repository%3Aa%2Fb%3Apull/);
});

test('docker updates: names what\'s behind, surfaces warnings, and caches registry checks', async () => {
  const { default: docker } = await import('../src/integrations/docker.ts');
  let registry = 0;
  const list = [
    { Id: '1', Names: ['/immich'], State: 'running', Status: 'Up', Image: 'ghcr.io/immich-app/immich-server:v3.3.5', Labels: {} },
    { Id: '2', Names: ['/caddy'], State: 'running', Status: 'Up', Image: 'caddy:2.11.7', Labels: {} },
    { Id: '3', Names: ['/watchtower'], State: 'running', Status: 'Up', Image: 'watchtower:latest', Labels: {} },
  ];
  const ctx = fake(url => {
    if (url.includes('/tags/list')) { registry++; return new Response(JSON.stringify({ tags: url.includes('immich') ? ['v3.3.5', 'v3.4.0'] : ['2.11.7'] })); }
    if (url.includes('/releases')) return [{ tag_name: 'v3.4.0', published_at: '2026-10-20', body: '- Breaking: run the database migration' }, { tag_name: 'v3.3.5', published_at: '2026-10-01', body: 'old' }];
    return list;
  });
  const d = make(docker, { url: 'http://proxy:2375' }, ctx);
  const c: any = await d.widgets.updates.fetch(); valid(c);
  assert.deepEqual(c.items.map((i: any) => [i.title, i.subtitle, i.meta, i.tone]), [['immich', 'v3.3.5 → v3.4.0', 'Read first', 'warn']]);
  assert.equal(c.summary.sub, '1 to read first');
  const t: any = await d.tools!.updates_check.run({});
  assert.deepEqual([t.data.upToDate, t.data.floatingTag], [1, ['watchtower']]);
  assert.equal(t.data.behind[0].warnings[0], 'v3.4.0: Breaking: run the database migration');
  assert.equal(registry, 2);                                                       // the second look used the cache
  const n: any = await d.tools!.update_notes.run({ name: 'immich' });
  assert.deepEqual(n.data.releases.map((r: any) => r.version), ['v3.4.0']);         // only what's new to you
});

test('lobsters: stories become rows', async () => {
  const l = make(lobsters, { limit: 1 }, fake(() => [{ title: 'A post', score: 41, comment_count: 7, tags: ['linux'], created_at: new Date().toISOString(), comments_url: 'https://lobste.rs/s/x', url: 'https://x' }, { title: 'Another' }]));
  const c: any = await l.widgets.stories.fetch();
  valid(c);
  assert.deepEqual([c.items.length, c.items[0].title, c.items[0].subtitle], [1, 'A post', '41 points · 7 comments · linux']);
});

test('repository: issues leave out pull requests, and a rate limit is a clear error', async () => {
  const r = make(repository, { repos: ['a/b'] }, fake(url => url.includes('search') ? { total_count: 3 } : { stargazers_count: 12400, forks_count: 80, open_issues_count: 10, pushed_at: new Date().toISOString(), html_url: 'https://github.com/a/b' }));
  const c: any = await r.widgets.repos.fetch();
  valid(c);
  assert.match(c.items[0].subtitle, /12k · 80 forks · 7 issues · 3 PRs/);
  const limited = make(repository, { repos: ['a/b'] }, fake(() => { throw new Error('answered 403'); }));
  await assert.rejects(limited.widgets.repos.fetch(), /rate limited/);
});

test('twitch: signs in with its own app, and says who is live', async () => {
  const t = make(twitch, { clientId: 'i', clientSecret: 's', channels: ['one'] }, fake(url => url.includes('oauth2') ? { access_token: 'x' } : url.includes('games/top') ? { data: [{ name: 'Chess' }] } : { data: [{ user_name: 'One', user_login: 'one', game_name: 'Chess', title: 'hi', viewer_count: 1500 }] }));
  const c: any = await t.widgets.channels.fetch();
  valid(c);
  assert.deepEqual([c.summary.value, c.items[0].meta], ['1 live', '1.5k']);
  valid(await t.widgets.games.fetch());
});

test('clock: every zone is checked at startup', async () => {
  const c: any = await make(clock, { clocks: [{ name: 'Tokyo', zone: 'Asia/Tokyo' }] }, fake(() => null)).widgets.times.fetch();
  valid(c);
  assert.equal(c.items[0].label, 'Tokyo');
  assert.throws(() => clock.config.parse({ clocks: [{ name: 'x', zone: 'Mars/Base' }] }));
});

test('iframe: only what it names can load, and nothing can be framed otherwise', async () => {
  const before = headersFor();
  assert.match(await before, /frame-src 'none'/);
  const inst = make(iframe, { url: 'https://grafana.example/d/1' }, fake(() => null)), c: any = await inst.widgets.page.fetch();
  valid(c);
  assert.match(await headersFor(), /frame-src 'none'/);   // checking a config opens nothing: only a config in use does
  setFrames([inst.frame!]);
  assert.match(await headersFor(), /frame-src https:\/\/grafana\.example[;\s]/);
  setFrames([]);
  assert.throws(() => iframe.config.parse({ url: 'javascript:alert(1)' }));
});

test('todo: add, tick and clear', async () => {
  process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-todo-'));
  const t = make(todo, {}, fake(() => null)) as any;
  await t.tools.todo_add.run({ text: 'Patch the Pi' });
  let c: any = await t.widgets.list.fetch();
  valid(c);
  assert.equal(c.summary.value, '1');
  assert.deepEqual(c.items[0].args, { id: c.items[0].id });   // the page sends a control's args with its value, so the switch can say which
  await t.actions.tick.run({ ...c.items[0].args, value: true });
  assert.equal(((await t.widgets.list.fetch()) as any).summary.value, '0');
  await t.actions.clear.run({});
  assert.deepEqual(((await t.widgets.list.fetch()) as any).items, []);
});

test('sockets: speaks Minecraft and apcupsd to a real socket', async () => {
  const { createServer } = await import('node:net');
  const { ping, upsStatus } = await import('../src/integrations/sockets.ts');
  const serve = (answer: Buffer) => new Promise<{ port: number; close(): void }>(ok => { const s = createServer(c => c.once('data', () => c.write(answer))); s.listen(0, '127.0.0.1', () => ok({ port: (s.address() as any).port, close: () => s.close() })); });
  const json = Buffer.from(JSON.stringify({ version: { name: '1.21' }, players: { online: 2, max: 20 } }));
  const mc = await serve(Buffer.concat([Buffer.from([json.length + 2, 0, json.length]), json]));
  assert.deepEqual((await ping('127.0.0.1', mc.port)).players, { online: 2, max: 20 });
  mc.close();
  const line = (t: string) => { const b = Buffer.from(t); return Buffer.concat([Buffer.from([0, b.length]), b]); };
  const ups = await serve(Buffer.concat([line('STATUS   : ONLINE \n'), line('BCHARGE  : 100.0 Percent\n'), Buffer.from([0, 0])]));
  assert.deepEqual(await upsStatus('127.0.0.1', ups.port), { STATUS: 'ONLINE', BCHARGE: '100.0 Percent' });
  ups.close();
});

test('service: self-signed, handshakes, expiring sessions and a second step', async () => {
  const { service } = await import('../src/server/service.ts');
  const { checkService } = await import('../src/server/service-check.ts');
  // a session that dies with a 200: sign in again, once
  let logins = 0, calls = 0;
  const s = service({ type: 'y', name: 'Y', auth: { login: '/in', token: (r: any) => r.t, expired: (a: any) => a.gone }, get: { a: '/a' }, stats: (d: any) => [{ label: 'N', value: d.a.n }], sample: { a: { n: 1 } }, expect: { N: 1 } });
  const ctx: any = { session: (await import('../src/server/core.ts')).session, async http(url: string) { if (url.endsWith('/in')) { logins++; return new Response(JSON.stringify({ t: 'x' })); } return new Response(JSON.stringify(calls++ ? { n: 7 } : { gone: true })); } };
  const c: any = await s.create(s.config.parse({ url: 'http://y', username: 'u', password: 'p' }), ctx).widgets.status.fetch();
  assert.deepEqual([c.items[0].value, logins], ['7', 2]);
  // a second step sees the first answer
  const chain = service({ type: 'z', name: 'Z', get: { libs: '/libs' }, then: (d: any) => ({ one: `/lib/${d.libs[0]}` }), stats: (d: any) => [{ label: 'Items', value: d.one.n }], sample: { libs: ['a'], one: { n: 3 } }, expect: { Items: 3 } });
  assert.deepEqual(await checkService(chain), []);
  // an interval in words, and insecure as a per-service choice
  const every = service({ type: 'w', name: 'W', every: '5m', get: { a: '/a' }, stats: () => [{ label: 'N', value: 1 }], sample: { a: {} }, expect: { N: 1 } });
  assert.equal(every.create(every.config.parse({ url: 'http://w', insecure: true }), ctx).widgets.status.interval, 300_000);
});

test('http: insecure accepts a self-signed certificate, and only when asked', async () => {
  const { createServer } = await import('node:https');
  const { makeContext } = await import('../src/server/core.ts');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'valet-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k`, '-out', `${dir}/c`, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const { readFileSync } = await import('node:fs');
  const s = createServer({ key: readFileSync(`${dir}/k`), cert: readFileSync(`${dir}/c`) }, (_, r) => r.end('{"ok":true}'));
  await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok));
  const url = `https://127.0.0.1:${(s.address() as any).port}/`, c = makeContext('t');
  await assert.rejects(c.http(url));
  assert.deepEqual(await c.http(url, { insecure: true }), { ok: true });
  s.close();
});

test('home assistant thermostat: says whether it is holding or on a schedule, only when the entity does', async () => {
  const note = async (over: object, state?: string) => ((await thermostatHA(climate(over, state)).widgets.hall.fetch()) as any).note;
  assert.equal(await note({}), undefined);
  assert.equal(await note({}, 'auto'), 'Following its schedule');
  assert.equal(await note({ preset_mode: 'temp' }), 'Temporary hold');
  assert.equal(await note({ preset_mode: 'hold' }), 'Held until you change it');
});

test('repository: traffic sums views per day across repos and ranks where visitors came from', async () => {
  const day = (d: number) => `2026-11-0${d}T00:00:00Z`;
  const ctx = fake(url => {
    if (url.endsWith('/traffic/views')) return { count: 30, uniques: 12, views: [{ timestamp: day(1), count: 10, uniques: 4 }, { timestamp: day(2), count: 20, uniques: 8 }] };
    if (url.endsWith('/traffic/clones')) return { count: 3, uniques: 2 };
    if (url.endsWith('/traffic/popular/referrers')) return url.includes('/a/') ? [{ referrer: 'reddit.com', count: 9, uniques: 5 }] : [{ referrer: 'news.ycombinator.com', count: 12, uniques: 7 }, { referrer: 'reddit.com', count: 2, uniques: 1 }];
    return {};
  });
  const inst = repository.create(repository.config.parse({ repos: ['a/one', 'b/two'], token: 'x' }), ctx);
  const card: any = await inst.widgets.traffic.fetch();
  assert.equal(card.headline, '24');                                                  // 12 visitors from each
  assert.deepEqual(card.series[0].points, [8, 16]);                                   // the same day, both repos
  assert.deepEqual(card.facts.map((f: any) => f.label), ['news.ycombinator.com', 'reddit.com']);
  assert.equal(card.facts[1].value, '6');
  const none = repository.create(repository.config.parse({ repos: ['a/one'] }), fake(() => { throw new Error('403'); }));
  await assert.rejects(none.widgets.traffic.fetch(), /needs a token that can push/);
});
