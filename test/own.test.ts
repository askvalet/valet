// Each person's own activity on a shared service (`people:`, personal.ts): the map is checked, each integration that takes
// it asks its service for that one user's activity with the owner's key and refuses a name it doesn't know, one copy is made
// per service user and fetched only while someone it's for watches, and the view hands each person their own and nobody
// else's. test/exposure.ts does the same against the real build, two people at once. Made-up people and services only.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-own-'));
const { session } = await import('../src/server/core.ts');
const { Config, People } = await import('../src/server/config.ts');
const { default: network, mapFrom } = await import('../src/integrations/network.ts');
const { check } = await import('../src/server/site.ts');
const { Personal } = await import('../src/server/personal.ts');
const { viewOf, unknownPeople } = await import('../src/server/people.ts');
const { findersOf } = await import('../src/server/search.ts');
const { registry } = await import('../src/integrations/index.ts');
const { checkCard } = await import('../src/shared/cards.schema.ts');
const { default: tautulli } = await import('../src/integrations/tautulli.ts');
const { default: jellyfin } = await import('../src/integrations/jellyfin.ts');
const { default: emby } = await import('../src/integrations/emby.ts');
const { default: seerr } = await import('../src/integrations/seerr.ts');
const { default: audiobookshelf } = await import('../src/integrations/audiobookshelf.ts');
type Context = import('../src/server/core.ts').Context;
type Instance = import('../src/server/core.ts').Instance;

type Handler = (url: string, init: any) => unknown;
function fake(handler: Handler, as?: string): Context & { calls: { url: string; init: any }[] } {
  const calls: { url: string; init: any }[] = [];
  return {
    id: 't', as, calls, log() {}, image: (r: string) => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }), session,
    async http(url: string, init: any = {}) {
      calls.push({ url, init });
      const out = await handler(url, init);
      if (init.as === 'response') return out instanceof Response ? out : new Response(JSON.stringify(out ?? null));
      if (out === undefined) throw new Error(`no answer for ${url}`);
      return init.as === 'text' ? '' : out;
    },
  } as any;
}
const make = (i: { config: any; create(c: any, ctx: Context): Instance }, cfg: unknown, ctx: Context) => i.create(i.config.parse(cfg), ctx);
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
const titles = (card: any) => (card.items ?? []).map((i: any) => i.title);

// ── the map itself

test('people: a map of names on the blocks that take it, checked for what can\'t be', () => {
  for (const i of [tautulli, jellyfin, emby, seerr, audiobookshelf]) {
    const block = (people: unknown) => ({ url: 'http://x', ...(['tautulli', 'seerr'].includes(i.type) ? { apiKey: 'k' } : { key: 'k' }), people });
    assert.ok(i.config.safeParse(block({ sam: 'samantha' })).success, i.type);
    assert.equal(i.config.safeParse(block({ sam: '' })).success, false, `${i.type}: an empty name is no one`);
    assert.equal(i.config.safeParse(block({ sam: 7 })).success, false);
  }
  const at = (auth: object, people: object, type = 'tautulli') => check(Config.parse({ auth, integrations: { plex: { type, url: 'http://t', ...(type === 'tautulli' ? { apiKey: 'k' } : { username: 'u', password: 'p' }), people } }, layout: [{ widgets: ['plex.streams'] }] }), registry);
  const ok = at({ mode: 'proxy' }, { sam: 'samantha', Pat: 'pat' });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual([...ok.mapped.get('plex')!.names], [['pat', 'pat'], ['sam', 'samantha']]);
  assert.ok(at({ mode: 'proxy' }, { sam: 'a', SAM: 'b' }).problems.some(p => /people\.SAM: the same person as sam.*first one counts/.test(p)));
  assert.equal(at({ mode: 'proxy' }, { sam: 'a', SAM: 'b' }).mapped.get('plex')!.names.get('sam'), 'a', 'the first one counts');
  assert.ok(at({ mode: 'none' }, { sam: 'a' }).problems.some(p => /plex\.people: auth\.mode is none/.test(p)));
  // a service that only answers for its own account doesn't take it, and says so
  assert.ok(at({ mode: 'proxy' }, { sam: 'a' }, 'navidrome').problems.some(p => /plex/.test(p) && /people/.test(p)));
  // no map: nothing made, nothing said
  assert.equal(check(Config.parse({ auth: { mode: 'proxy' }, integrations: { plex: { type: 'tautulli', url: 'http://t', apiKey: 'k' } } }), registry).mapped.size, 0);
});

test('people: with local accounts, a name no account has is named', () => {
  const config = Config.parse({ auth: { mode: 'local' }, integrations: { plex: { type: 'tautulli', url: 'http://t', apiKey: 'k', people: { sam: 'samantha', Pat: 'p', ghost: 'g' } } } });
  assert.deepEqual(unknownPeople(config, ['sam', 'pat']).map(p => p.split(':')[0]), ['integrations.plex.people.ghost']);
  assert.deepEqual(unknownPeople({ ...config, auth: { ...config.auth, mode: 'proxy' } }, ['sam']), [], 'with a proxy the names are the proxy\'s: nothing to compare');
});

// ── each integration, as one user

const tautulliHttp = (asked: string[] = []): Handler => url => {
  const q = new URL(url).searchParams, cmd = q.get('cmd')!;
  asked.push(`${cmd}${q.get('user_id') ? ` user_id=${q.get('user_id')}` : ''}${q.get('search') ? ` search=${q.get('search')}` : ''}`);
  const s = (user_id: number, friendly_name: string, title: string) => ({ user_id, friendly_name, title, full_title: title, media_type: 'movie', thumb: `/library/metadata/${user_id}/thumb`, progress_percent: '10', duration: '6000000', view_offset: '600000', bandwidth: '8000', state: 'playing', player: 'TV', session_key: String(user_id) });
  const data: Record<string, unknown> = {
    get_users: [{ user_id: 11, username: 'samantha', friendly_name: 'Sam', email: 'sam@example.com' }, { user_id: 22, username: 'patrick', friendly_name: 'Pat' }],
    get_activity: { stream_count: '2', total_bandwidth: '16000', sessions: [s(11, 'Sam', 'Sam Show'), s(22, 'Pat', 'Pat Film')] },
    get_home_stats: [{ stat_id: 'top_users', rows: [{ user_id: 11, friendly_name: 'Sam', total_duration: 100 }, { user_id: 22, friendly_name: 'Pat', total_duration: 50 }] }, { stat_id: 'top_movies', rows: [] }, { stat_id: 'top_tv', rows: [] }],
    get_plays_by_date: { categories: ['2026-11-01', '2026-11-02'], series: [{ name: 'Total', data: [1, 2] }, { name: 'Movies', data: [1, 2] }] },
    get_history: { data: [{ date: 1_700_000_000, friendly_name: 'Sam', full_title: 'Sam Show', percent_complete: 50, player: 'TV' }] },
    terminate_session: null,
  };
  return { response: { result: 'success', data: data[cmd] ?? [] } };
};

test('tautulli: someone\'s own copy asks for their user, keeps their streams, and stops only theirs', async () => {
  const asked: string[] = [], t = make(tautulli, { url: 'http://t', apiKey: 'k' }, fake(tautulliHttp(asked), 'SAMANTHA'));
  const streams = await t.widgets.streams.fetch(); valid(streams);
  assert.deepEqual(titles(streams), ['Sam Show']);
  assert.equal((streams as any).summary.value, '1 stream');
  assert.deepEqual(titles(await t.widgets.people.fetch()), ['Sam'], 'who\'s watching is only them');
  for (const w of ['top', 'plays', 'viewing']) { valid(await t.widgets[w].fetch()); }
  for (const cmd of ['get_home_stats', 'get_plays_by_date']) assert.ok(asked.filter(a => a.startsWith(cmd)).every(a => a.endsWith('user_id=11')), `${cmd} asked for theirs: ${asked}`);
  // the model naming someone else doesn't widen the history
  asked.length = 0; await t.tools!.plex_history.run({ user: 'Pat', count: 5 });
  assert.deepEqual(asked.filter(a => a.startsWith('get_history')), ['get_history user_id=11']);
  const theirs = await t.tools!.plex_stop_stream.run({ who: 'Pat', message: 'x' });
  assert.match(theirs.data.error, /no stream matches/, 'Pat\'s stream isn\'t theirs to stop');
  // the shared copy is unchanged: everyone's, and the history tool searches as asked
  const shared = make(tautulli, { url: 'http://t', apiKey: 'k' }, fake(tautulliHttp(asked)));
  assert.deepEqual(titles(await shared.widgets.streams.fetch()), ['Sam Show', 'Pat Film']);
  asked.length = 0; await shared.tools!.plex_history.run({ user: 'Pat', count: 5 });
  assert.deepEqual(asked.filter(a => a.startsWith('get_history')), ['get_history search=Pat']);
  // which are personal: what someone did, not what the server has
  assert.deepEqual(Object.entries(shared.widgets).filter(([, w]) => w.personal).map(([k]) => k).sort(), ['people', 'plays', 'race', 'streams', 'top', 'viewing']);
});

test('tautulli: a name Plex doesn\'t know is an error, never everyone\'s', async () => {
  const t = make(tautulli, { url: 'http://t', apiKey: 'k' }, fake(tautulliHttp(), 'nobody'));
  await assert.rejects(t.widgets.streams.fetch(), /no Plex user called nobody/);
  await assert.rejects(t.tools!.plex_streams.run({}), /no Plex user/);
});

const SAM = '0011223344556677889900aabbccddee', PAT = 'aa11bb22cc33dd44ee55ff6677889900';
const users = [{ Id: SAM, Name: 'Samantha', Policy: {} }, { Id: PAT, Name: 'Pat', Policy: { IsAdministrator: true } }, { Id: 'ffff', Name: 'Gone', Policy: { IsDisabled: true } }];
const item = (Id: string, Name: string) => ({ Id, Type: 'Movie', Name, RunTimeTicks: 60_000_000_000, MediaType: 'Video' });
const jfHttp = (prefix = ''): Handler => url => {
  const p = url.replace(/^http:\/\/[^/]+/, '').replace(prefix, '');
  if (/^\/Users(\?|$)/.test(p)) return users;
  if (p.startsWith('/Items/Counts')) return { MovieCount: p.includes(SAM) ? 3 : 9 };
  if (p.startsWith('/Sessions')) return [
    { Id: 's1', UserId: '00112233-4455-6677-8899-00aabbccddee', UserName: 'Samantha', DeviceName: 'TV', SupportsRemoteControl: true, NowPlayingItem: item('f1', 'Sam Film'), PlayState: {} },
    { Id: 's2', UserId: PAT, UserName: 'Pat', DeviceName: 'Phone', SupportsRemoteControl: true, NowPlayingItem: item('f2', 'Pat Film'), PlayState: {} }];
  const who = p.includes(SAM) ? 'Sam' : p.includes(PAT) ? 'Pat' : '?';
  if (/Resume/.test(p)) return { Items: [item('r1', `${who} half-watched`)] };
  if (/Latest/.test(p)) return [item('l1', `${who} latest`)];
  if (/\/Items\?|\/Items\?/.test(p) || /Users\/[^/]+\/Items\?/.test(p)) return { Items: [item('i1', `${who} search hit`)] };
  if (/Playing\/Stop|Message/.test(p)) return '';
  return undefined;
};

test('jellyfin and emby: someone\'s own copy is their user, their sessions and their shelves, whatever `user` says', async () => {
  for (const [i, prefix] of [[jellyfin, ''], [emby, '/emby']] as const) {
    const ctx = fake(jfHttp(prefix), 'samantha'), j = make(i, { url: 'http://jf', key: 'k', user: 'Pat' }, ctx);
    const streams = await j.widgets.streams.fetch(); valid(streams);
    assert.deepEqual(titles(streams), ['Sam Film'], `${i.type}: their session, ids compared without dashes`);
    assert.deepEqual(titles(await j.widgets.resume.fetch()), ['Sam half-watched']);
    assert.deepEqual(titles(await j.widgets.recent.fetch()), ['Sam latest']);
    const status: any = await j.widgets.status.fetch(); valid(status);
    assert.equal(status.items[1].value, '3', 'counts are what their libraries hold');
    const found = await j.tools![`${i.type}_search`].run({ query: 'x', limit: 5 });
    assert.equal(found.data[0].title, 'Sam search hit');
    const stop = await j.tools![`${i.type}_stop`].run({ who: 'Pat' });
    assert.match(stop.data.error, /no stream matches/);
    assert.ok(!ctx.calls.some(c => /Playing\/Stop/.test(c.url)), 'nothing was stopped');
    // the shared copy: the configured user's shelves and everyone's streams
    const shared = make(i, { url: 'http://jf', key: 'k', user: 'Pat' }, fake(jfHttp(prefix)));
    assert.deepEqual(titles(await shared.widgets.streams.fetch()), ['Sam Film', 'Pat Film']);
    assert.deepEqual(titles(await shared.widgets.resume.fetch()), ['Pat half-watched']);
    await assert.rejects(make(i, { url: 'http://jf', key: 'k' }, fake(jfHttp(prefix), 'gone')).widgets.resume.fetch(), /no user called gone/, 'a disabled user is no one');
  }
});

const seerrHttp = (seen: { url: string; init: any }[] = []): Handler => (url, init) => {
  seen.push({ url, init });
  if (url.includes('/user?')) return { results: [{ id: 4, username: null, plexUsername: 'Samantha', email: 's@example.com', displayName: 'Sam' }, { id: 9, username: 'pat', displayName: 'Pat' }] };
  // an old Seerr that ignores requestedBy answers with everyone's: filtered again here
  if (url.includes('/request?')) return { results: [{ id: 1, type: 'movie', status: 1, media: { tmdbId: 101, status: 2 }, requestedBy: { id: 4 } }, { id: 2, type: 'movie', status: 1, media: { tmdbId: 202, status: 2 }, requestedBy: { id: 9 } }] };
  if (url.endsWith('/request')) return { status: 1 };
  const m = /movie\/(\d+)/.exec(url);
  if (m) return { id: Number(m[1]), title: m[1] === '101' ? 'Sam Asked' : 'Pat Asked', posterPath: '/p.jpg' };
  return undefined;
};

test('seerr: someone\'s own copy shows their requests and asks as them', async () => {
  const seen: { url: string; init: any }[] = [], s = make(seerr, { url: 'http://s', apiKey: 'k' }, fake(seerrHttp(seen), 'samantha'));
  const card = await s.widgets.requests.fetch(); valid(card);
  assert.deepEqual(titles(card), ['Sam Asked']);
  assert.ok(seen.some(c => c.url.includes('request?take=12&sort=added&requestedBy=4')));
  assert.deepEqual((await s.tools!.media_requests.run({})).data.map((r: any) => r.title), ['Sam Asked']);
  await s.tools!.media_request.run({ title: 'New', media_type: 'movie', tmdb_id: 303 });
  assert.equal(JSON.parse(seen.find(c => c.url.endsWith('/request'))!.init.body).userId, 4, 'the request is theirs in Seerr');
  // shared: everyone's, and a request with no one named
  const shared = make(seerr, { url: 'http://s', apiKey: 'k' }, fake(seerrHttp(seen)));
  assert.deepEqual(titles(await shared.widgets.requests.fetch()), ['Sam Asked', 'Pat Asked']);
  seen.length = 0; await shared.tools!.media_request.run({ title: 'New', media_type: 'movie', tmdb_id: 303 });
  assert.equal(JSON.parse(seen.find(c => c.url.endsWith('/request'))!.init.body).userId, undefined);
  await assert.rejects(make(seerr, { url: 'http://s', apiKey: 'k' }, fake(seerrHttp(), 'stranger')).widgets.requests.fetch(), /no user called stranger/);
});

const absHttp = (seen: string[] = []): Handler => (url, init) => {
  const p = url.replace('http://abs/api/', ''); seen.push(p);
  if (p === 'users') return { users: [{ id: 'u-sam', username: 'samantha' }, { id: 'u-pat', username: 'pat' }] };
  if (p === 'users/u-sam') return { mediaProgress: [
    { libraryItemId: 'li-1', progress: 0.5, currentTime: 100, duration: 200, lastUpdate: 2 },
    { libraryItemId: 'li-2', progress: 1, isFinished: true, lastUpdate: 3 },
    { libraryItemId: 'li-3', progress: 0.1, currentTime: 10, duration: 100, lastUpdate: 1, hideFromContinueListening: true }] };
  if (p === 'items/batch/get') { assert.deepEqual(JSON.parse(init.body), { libraryItemIds: ['li-1'] }); return { libraryItems: [{ id: 'li-1', mediaType: 'book', media: { metadata: { title: 'Sam Book', authorName: 'A' }, duration: 200 } }] }; }
  if (p === 'users/u-sam/listening-stats') return { today: 60, days: { [new Date().toLocaleDateString('en-CA')]: 600 } };
  if (p === 'libraries') return { libraries: [] };
  if (p.startsWith('me')) throw new Error('the key owner\'s own was asked for');
  return undefined;
};

test('audiobookshelf: someone\'s own copy reads their progress and listening through the admin key, and their sessions only', async () => {
  const seen: string[] = [];
  const handler: Handler = (url, init) => url.endsWith('/users/online') ? new Response(JSON.stringify({ usersOnline: [{ id: 'u-sam', username: 'samantha' }, { id: 'u-pat', username: 'pat' }],
    openSessions: [{ userId: 'u-sam', displayTitle: 'Sam Book', libraryItemId: 'li-1', duration: 200, currentTime: 100 }, { userId: 'u-pat', displayTitle: 'Pat Book', libraryItemId: 'li-9', duration: 200, currentTime: 1 }] })) : absHttp(seen)(url, init);
  const a = make(audiobookshelf, { url: 'http://abs', key: 'k' }, fake(handler, 'Samantha'));
  const progress = await a.widgets.progress.fetch(); valid(progress);
  assert.deepEqual(titles(progress), ['Sam Book'], 'unfinished, not hidden, newest first');
  assert.equal((progress as any).items[0].badge, '50%');
  const playing = await a.widgets.playing.fetch(); valid(playing);
  assert.deepEqual(titles(playing), ['Sam Book']);
  const week: any = await a.widgets.week.fetch(); valid(week);
  assert.equal(week.series[0].points.at(-1), 10);
  valid(await a.widgets.status.fetch());
  assert.ok(!seen.some(p => p.startsWith('me')), 'never the key owner\'s own');
  await assert.rejects(make(audiobookshelf, { url: 'http://abs', key: 'k' }, fake(absHttp(), 'nobody')).widgets.progress.fetch(), /no user called nobody/);
});

// ── one copy per service user, fetched only while watched

test('personal: one copy per service user, shared by everyone mapped to it, polled only while someone watches', async () => {
  const made: string[] = [], fetched: string[] = [];
  const shared: Instance = { widgets: { now: { title: 'Now', personal: true, fetch: async () => ({ type: 'text', text: 'everyone' }) }, lib: { title: 'Library', fetch: async () => ({ type: 'text', text: 'lib' }) } } };
  const mapped = new Map([['media', { names: new Map([['sam', 'samantha'], ['alex', 'Samantha'], ['pat', 'pat']]), make: (as: string) => {
    made.push(as);
    return { widgets: { now: { title: 'Now', personal: true, interval: 60_000, fetch: async () => { fetched.push(as); return { type: 'text' as const, text: `${as}'s` }; } }, lib: shared.widgets.lib } };
  } }]]);
  const p = new Personal({ mapped, shared: new Map([['media', shared]]), placed: new Set(['media.now', 'media.lib']) });
  assert.deepEqual([...p.of('SAM')], [['media', 'samantha']]); assert.deepEqual([...p.of('robin')], []); assert.deepEqual([...p.of(undefined)], []);
  assert.equal(p.personal('media.now'), true); assert.equal(p.personal('media.lib'), false, 'what the server has stays shared');
  assert.deepEqual(made, [], 'nothing is made until someone needs it');
  assert.equal(p.instance('media', 'samantha'), p.instance('media', 'Samantha'), 'sam and alex share samantha');
  assert.deepEqual(made, ['samantha']);
  assert.equal(p.hub('media.lib', 'samantha'), undefined, 'no hub for a shared widget');
  const hub = p.hub('media.now', 'samantha')!;
  assert.equal(p.hub('media.now', 'SAMANTHA'), hub);
  p.refreshInstance('media'); await new Promise(r => setImmediate(r));
  assert.deepEqual(fetched, [], 'an action refreshes only what someone watches');
  const heard: string[] = [], off = hub.subscribe(s => heard.push((s.card as any).text));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(heard, ["samantha's"]);
  assert.deepEqual(p.snapshot(new Map([['media', 'samantha']])).map(s => (s.card as any).text), ["samantha's"]);
  assert.deepEqual(p.snapshot(new Map([['media', 'pat']])), [], 'pat has nothing yet, and never samantha\'s');
  off(); p.dispose();
});

// ── the view: who gets which

function house() {
  const card = (text: string) => async () => ({ type: 'text' as const, text });
  const media = (who: string): Instance => ({ widgets: { now: { title: 'Now', personal: true, fetch: card(`${who} now`) }, lib: { title: 'Library', fetch: card('lib') } },
    tools: { media_find: { description: 'find', access: 'read', find: 'q', input: z.object({ q: z.string() }), run: async () => ({ data: `${who} found` }) } } });
  const shared = media('everyone'), other: Instance = { widgets: { up: { title: 'Up', fetch: card('up') } } };
  const instances = new Map<string, Instance>([['media', shared], ['other', other]]);
  const config = Config.parse({ auth: { mode: 'proxy' }, profiles: { kids: { tabs: ['Media'], assistant: { access: { default: 'read' } } } }, users: { sam: 'kids', robin: 'kids' },
    assistant: { model: 'm', access: { default: 'read' } }, integrations: { media: { type: 'x' }, other: { type: 'y' } }, layout: [{ title: 'Media', widgets: ['media.now', 'media.lib'] }, { title: 'House', widgets: ['other.up'] }] });
  const placed = new Set(['media.now', 'media.lib', 'other.up']);
  const personal = new Personal({ shared: instances, placed, mapped: new Map([['media', { names: new Map([['sam', 'samantha'], ['pat', 'pat'], ['kit', 'samantha']]), make: media }]]) });
  return { config, instances, placed, personal, meta: new Map(), redact: (s: string) => s };
}

test('view: someone mapped gets their own copy in every door, and nobody else does', async () => {
  const site = house();
  const sam = viewOf(site, 'Sam'), robin = viewOf(site, 'robin'), pat = viewOf(site, 'pat'), alex = viewOf(site, 'alex'), kit = viewOf(site, 'kit');
  assert.deepEqual([...sam.own], [['media', 'samantha']]);
  assert.equal(sam.mine('media.now'), true); assert.equal(sam.mine('media.lib'), false); assert.equal(sam.mine('other.up'), false);
  assert.equal(await sam.instances.get('media')!.widgets.now.fetch().then((c: any) => c.text), 'samantha now');
  assert.equal(sam.instances.get('other'), site.instances.get('other'), 'the rest is the shared');
  assert.equal(viewOf(site, 'sam').instances, sam.instances, 'the same map each time, so caches hold');
  // ⌘K's search and the assistant's search_everything read the view's instances: theirs
  const finder = findersOf({ config: sam.config, instances: sam.instances, meta: new Map() } as any).find(f => f.inst === 'media')!;
  assert.equal((await finder.t.run({ q: 'x' })).data, 'samantha found');
  // a member who isn't mapped, and an owner who isn't: exactly as before
  for (const v of [robin, alex]) { assert.equal(v.own.size, 0); assert.equal(v.mine('media.now'), false); assert.equal(v.choice, undefined); }
  assert.equal(alex.instances, site.instances);
  assert.equal(robin.instances.get('media'), site.instances.get('media'));
  // two people on one service user share the copy, yet each view is their own (a chat, a live card)
  assert.equal(kit.instances.get('media'), sam.instances.get('media'));
  assert.notEqual(sam.key, robin.key); assert.notEqual(pat.key, alex.key); assert.match(sam.key, /^profile kids own media=samantha$/);
  // an owner mapped: their own, and everyone's when they ask; a member asking for everyone's is ignored
  assert.equal(pat.choice, 'mine'); assert.equal(await pat.instances.get('media')!.widgets.now.fetch().then((c: any) => c.text), 'pat now');
  const all = viewOf(site, 'pat', { everyone: true });
  assert.equal(all.choice, 'everyone'); assert.equal(all.own.size, 0); assert.equal(all.instances, site.instances); assert.equal(all.key, alex.key);
  const sly = viewOf(site, 'sam', { everyone: true });
  assert.deepEqual([...sly.own], [['media', 'samantha']], 'only an owner may choose everyone\'s');
  assert.equal(sly.choice, undefined);
  // no name (a paired wall, a page with sign-in off): nobody's own
  assert.equal(viewOf(site).own.size, 0);
  // a Telegram id that isn't bound talks as "Name (Telegram)", which is no one's name here
  assert.equal(viewOf(site, 'sam (Telegram)').own.size, 0);
  site.personal.dispose();
});

// ── with the other features: cards made from others (`from:`), the network map, and a card's add line

function made() {
  const card = (text: string) => async () => ({ type: 'text' as const, text });
  const media = (who: string): Instance => ({ widgets: { now: { title: 'Now', personal: true, fetch: card(`${who} now`) } },
    actions: { add: { description: 'add', input: z.object({ text: z.string() }), run: async ({ text }: { text: string }) => ({ done: `${who} added ${text}` }) } } });
  const shared = media('everyone');
  // a card made from the personal one: computed once, from everyone's
  const derived: Instance = { widgets: { count: { title: 'Count', from: 'media.now', fetch: card('everyone, counted') } }, tools: { api_get: { description: 'get', access: 'read', input: z.object({}), run: async () => ({ data: 'everyone, counted' }) } } };
  const instances = new Map<string, Instance>([['media', shared], ['count', derived]]);
  const config = Config.parse({ auth: { mode: 'proxy' }, profiles: { kids: { tabs: ['Media'], actions: ['media.add'], assistant: { access: { default: 'read' } } } }, users: { sam: 'kids', robin: 'kids' },
    assistant: { model: 'm', access: { default: 'read' } }, layout: [{ title: 'Media', widgets: ['media.now', 'count.count'] }] });
  const placed = new Set(['media.now', 'count.count']);
  const personal = new Personal({ shared: instances, placed, mapped: new Map([['media', { names: new Map([['sam', 'samantha'], ['pat', 'pat']]), make: media }]]) });
  return { config, instances, placed, personal };
}

test('from: a card made from someone\'s own widget is made from everyone\'s, so the people mapped there don\'t get it', () => {
  const site = made();
  for (const who of ['sam', 'pat']) {
    const v = viewOf(site, who);
    assert.equal(v.sees('count.count'), false, `${who}: the shared source isn't theirs, so neither is what's made from it`);
    assert.equal(v.instances.has('count'), false, `${who}: nor its tools, which read the shared card`);
    assert.equal(v.sees('media.now'), true);
  }
  for (const v of [viewOf(site, 'robin'), viewOf(site, 'alex'), viewOf(site, 'pat', { everyone: true })]) {
    assert.equal(v.sees('count.count'), true, 'anyone who hears the shared source keeps it');
    assert.equal(v.instances.get('count'), site.instances.get('count'));
  }
  // and config check says so
  const plug = { type: 'own-src', name: 'Own', config: z.object({ people: People }), create: () => ({ widgets: { now: { title: 'Now', personal: true, fetch: async () => ({ type: 'text' as const, text: 'x' }) } } }) };
  const reg = { ...registry, 'own-src': plug } as any;
  const r = check(Config.parse({ auth: { mode: 'proxy' }, integrations: { media: { type: 'own-src', people: { sam: 's' } }, c: { type: 'api', from: 'media.now', stats: [{ label: 'N', value: 'a' }] } }, layout: [{ widgets: ['c.data'] }] }), reg);
  assert.ok(r.problems.some(p => /integrations\.c\.from: media\.now is someone's own/.test(p)), r.problems.join('\n'));
  site.personal.dispose();
});

test('a person\'s own copy reads only its service: no other widget\'s card, no view of the homelab', () => {
  let seen: any;
  const plug = { type: 'own-ctx', name: 'Own', config: z.object({ people: People }), create: (_: unknown, ctx: any) => { seen = ctx; return { widgets: { now: { title: 'Now', personal: true, fetch: async () => ({ type: 'text' as const, text: 'x' }) } } }; } };
  const r = check(Config.parse({ auth: { mode: 'proxy' }, integrations: { media: { type: 'own-ctx', people: { sam: 's' } } } }), { ...registry, 'own-ctx': plug } as any);
  assert.ok(seen.lab && seen.card, 'the shared one has both');
  r.mapped.get('media')!.make('s');
  assert.equal(seen.as, 's'); assert.equal(seen.lab, undefined); assert.equal(seen.card, undefined);
});

test('the network map: a service with people shows the service\'s health, never anyone\'s activity', () => {
  const streams = { type: 'media', title: 'Now playing', items: [{ title: 'SAM-SHOW', user: 'samantha' }], activity: { title: 'SAM-SHOW' } } as any;
  const map = mapFrom([{ id: 'plex', type: 'tautulli', name: 'Plex (Tautulli)', addresses: [{ host: '192.168.1.5', port: 8181, field: 'url' }],
    widgets: [{ name: 'streams', title: 'Now playing', placed: true, card: streams, read: async () => streams }] }], network.config.parse({}));
  const node = map.nodes.find(n => n.from === 'plex')!;
  assert.equal(node.state, 'up');
  assert.doesNotMatch(JSON.stringify(map), /SAM-SHOW|samantha/);
});

test('an add line on someone\'s own card presses their own copy, and only what their profile lists', async () => {
  const site = made(), sam = viewOf(site, 'sam'), robin = viewOf(site, 'robin');
  assert.deepEqual(await sam.instances.get('media')!.actions!.add.run({ text: 'milk' }), { done: 'samantha added milk' });
  assert.deepEqual(await robin.instances.get('media')!.actions!.add.run({ text: 'milk' }), { done: 'everyone added milk' }, 'unmapped: the shared one, as before');
  assert.equal(sam.presses('media', 'add'), true); assert.equal(sam.presses('media', 'remove'), false, 'the profile still decides what may be pressed');
  site.personal.dispose();
});
