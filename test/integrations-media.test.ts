// Jellyfin, Emby, Navidrome and Audiobookshelf against made-up answers in their APIs' shapes: every card validates, the
// person's own shelves come from the right user, pictures only go through refs that check out, and stopping a stream
// stops the one the service named or nothing at all.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { session, type Context, type Instance } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import audiobookshelf from '../src/integrations/audiobookshelf.ts';
import emby from '../src/integrations/emby.ts';
import jellyfin from '../src/integrations/jellyfin.ts';
import navidrome from '../src/integrations/navidrome.ts';
import { setHouse } from '../src/server/core.ts';
setHouse({ locale: 'en-US' });   // what the server writes follows a language; these read like a US one wherever they run

type Handler = (url: string, init: any) => unknown;
function fake(handler: Handler): Context & { calls: { url: string; init: any }[] } {
  const calls: { url: string; init: any }[] = [];
  return {
    id: 't', calls, log() {}, image: r => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }),
    session,
    async http(url: string, init: any = {}) {
      calls.push({ url, init });
      const out = await handler(url, init);
      if (init.as === 'response') return out instanceof Response ? out : new Response(JSON.stringify(out ?? null), { status: 200 });
      if (out instanceof Response) { if (!out.ok) throw new Error(`answered ${out.status}`); return init.as === 'text' ? out.text() : out.json(); }
      if (out === undefined) throw new Error(`no answer for ${url}`);
      return init.as === 'text' ? '' : out as any;
    },
  } as any;
}
const make = (i: { config: any; create(c: any, ctx: Context): Instance }, cfg: unknown, ctx: Context) => i.create(i.config.parse(cfg), ctx);
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
const allValid = async (inst: Instance) => { for (const [k, w] of Object.entries(inst.widgets)) { const card = await w.fetch(); valid(card); assert.ok(card, k); } };
const route = (rules: [string | RegExp, unknown][]): Handler => (url, init) => {
  for (const [m, a] of rules) if (typeof m === 'string' ? url.includes(m) : m.test(url)) return typeof a === 'function' ? a(url, init) : a;
  return undefined;
};

// ── Jellyfin and Emby
const ADMIN = 'aa11bb22cc33dd44ee55ff6677889900', KID = '0011223344556677889900aabbccddee';
const users = [{ Id: KID, Name: 'Kid', Policy: { IsAdministrator: false } }, { Id: ADMIN, Name: 'Owner', Policy: { IsAdministrator: true } }, { Id: 'ffff', Name: 'Gone', Policy: { IsAdministrator: true, IsDisabled: true } }];
const episode = { Id: 'e1e1', Type: 'Episode', Name: 'Undertow', SeriesName: 'The Long Tide', SeriesId: 's1s1', SeriesPrimaryImageTag: 'tag1', ParentIndexNumber: 2, IndexNumber: 4, RunTimeTicks: 30_000_000_000, ParentBackdropItemId: 's1s1', ParentBackdropImageTags: ['bd1'], MediaType: 'Video' };
const film = { Id: 'f2f2', Type: 'Movie', Name: 'Harbour Lights', ProductionYear: 2025, ImageTags: { Primary: 'p2' }, BackdropImageTags: ['b2'], RunTimeTicks: 60_000_000_000, Height: 2160, MediaType: 'Video', ServerId: 'srv1' };
const sessions = [
  { Id: 'sess1', UserName: 'Sam', DeviceName: 'Living room TV', Client: 'Jellyfin Android TV', SupportsRemoteControl: true, NowPlayingItem: episode, PlayState: { PositionTicks: 7_500_000_000, IsPaused: false, PlayMethod: 'DirectPlay' } },
  { Id: 'sess2', UserName: 'Alex', DeviceName: 'Tablet', Client: 'Jellyfin Web', SupportsRemoteControl: true, NowPlayingItem: film, PlayState: { PositionTicks: 30_000_000_000, IsPaused: true, PlayMethod: 'Transcode' }, TranscodingInfo: { Bitrate: 8_000_000, Height: 1080, TranscodeReasons: ['ContainerNotSupported'] } },
  { Id: 'sess3', UserName: 'Priya', DeviceName: 'Phone', Client: 'Web' },   // signed in, playing nothing
];
const counts = { MovieCount: 612, SeriesCount: 48, EpisodeCount: 2104, SongCount: 0, AlbumCount: 0 };
const jf = (o: { sessions?: unknown[] } = {}) => route([
  [/\/Users$/, users], ['/Items/Counts', counts], ['/Sessions?', o.sessions ?? sessions], [/\/emby\/Sessions$/, o.sessions ?? sessions],
  [/\/Sessions\/[^/]+\/(Playing\/Stop|Message)/, ''],
  ['Items/Resume', { Items: [{ ...episode, UserData: { PlayedPercentage: 25, PlaybackPositionTicks: 7_500_000_000 } }], TotalRecordCount: 1 }],
  ['/Items/Latest', [film, { ...episode, DateCreated: new Date().toISOString() }]],
  [/\/Items\?/, { Items: [{ ...film, UserData: { Played: true } }] }],
]);

test('jellyfin: every widget validates, the old status keeps its numbers, and a stream lights the top bar', async () => {
  const ctx = fake(jf()), j = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, ctx);
  await allValid(j);
  const status: any = await j.widgets.status.fetch();
  assert.deepEqual(status.items.slice(0, 2), [{ label: 'Playing now', value: 2 }, { label: 'Movies', value: '612' }]);
  const now: any = await j.widgets.streams.fetch();
  assert.equal(now.items.length, 2, 'a signed-in session with nothing on is not a stream');
  assert.equal(now.items[0].title, 'The Long Tide');
  assert.equal(now.items[0].subtitle, 'S2 · E4 — Undertow');
  assert.equal(now.items[0].pct, .25);
  assert.equal(now.items[0].image, '/img/s1s1/Primary/tag1', 'an episode wears its show\'s poster');
  assert.deepEqual(now.items[1].tags, ['1080p', 'Transcode', '8 Mbps']);
  assert.equal(now.items[1].state, 'paused');
  assert.equal(now.activity.title, 'The Long Tide', 'the ring shows what is playing, not what is paused');
  assert.equal(now.activity.count, 2);
  const idle: any = await make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(jf({ sessions: [] }))).widgets.streams.fetch();
  assert.equal(idle.activity, undefined, 'nothing live, no ring');
  assert.ok(ctx.calls.every(c => c.init.headers?.Authorization === 'MediaBrowser Token="k"'));
});

test('jellyfin: continue watching and recently added are the first administrator\'s, or the named user\'s', async () => {
  const ctx = fake(jf()), j = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, ctx);
  const resume: any = await j.widgets.resume.fetch();
  assert.ok(ctx.calls.some(c => c.url === `http://jf:8096/UserItems/Resume?userId=${ADMIN}&Limit=12&MediaTypes=Video&Fields=PrimaryImageAspectRatio&EnableUserData=true`));
  assert.equal(resume.items[0].badge, '25%');
  assert.equal(resume.items[0].note, '38m left');
  assert.equal(resume.items[0].href, 'http://jf:8096/web/#/details?id=e1e1');
  const recent: any = await j.widgets.recent.fetch();
  assert.equal(recent.items[0].image, '/img/f2f2/Primary/p2');
  assert.equal(recent.items[0].backdrop, '/img/f2f2/Backdrop/b2');
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/Users')).length, 1, 'who it is is asked once');

  const kid = fake(jf());
  await make(jellyfin, { url: 'http://jf:8096', key: 'k', user: 'kid' }, kid).widgets.recent.fetch();
  assert.ok(kid.calls.some(c => c.url.includes(`/Items/Latest?userId=${KID}&`)));
  await assert.rejects(make(jellyfin, { url: 'http://jf:8096', key: 'k', user: 'nobody' }, fake(jf())).widgets.resume.fetch(), /no user called nobody/);
});

test('emby: the same cards from /emby and the per-user routes, with songs when it has them', async () => {
  const ctx = fake(route([['/emby/Items/Counts', { ...counts, SongCount: 8100 }], [/./, (u: string, i: any) => jf()(u, i)]])), e = make(emby, { url: 'http://emby:8096/', key: 'k' }, ctx);
  await allValid(e);
  assert.ok(ctx.calls.some(c => c.url.startsWith(`http://emby:8096/emby/Users/${ADMIN}/Items/Resume?`)));
  assert.ok(ctx.calls.some(c => c.url.startsWith(`http://emby:8096/emby/Users/${ADMIN}/Items/Latest?`)));
  assert.ok(ctx.calls.every(c => c.url.startsWith('http://emby:8096/emby/') && c.init.headers['X-Emby-Token'] === 'k'));
  const status: any = await e.widgets.status.fetch();
  assert.deepEqual(status.items.at(-1), { label: 'Songs', value: '8,100' });
  const recent: any = await e.widgets.recent.fetch();
  assert.equal(recent.items[0].href, 'http://emby:8096/web/index.html#!/item?id=f2f2&serverId=srv1');
  const found = await e.tools!.emby_search.run({ query: 'harbour', limit: 12 });
  assert.ok(ctx.calls.some(c => c.url.includes(`/emby/Users/${ADMIN}/Items?SearchTerm=harbour&`)));
  valid(found.card);
});

test('jellyfin: pictures only through refs that check out, fetched from the server with its key', async () => {
  const ctx = fake(() => new Response('img')), j = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, ctx);
  for (const bad of ['', '../etc/passwd', 'abc/Logo', 'abc/Primary/../../x', 'http://evil/x', 'a b/Primary', `${'a'.repeat(65)}/Primary`]) assert.throws(() => j.image!(bad), /bad image ref/, bad);
  await j.image!('f2f2/Backdrop/b2');
  assert.equal(ctx.calls[0].url, 'http://jf:8096/Items/f2f2/Images/Backdrop?maxWidth=1280&quality=85&tag=b2');
  assert.equal(ctx.calls[0].init.headers['X-Emby-Token'], 'k');
  // an id that isn't one never becomes a ref at all
  const odd = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(jf({ sessions: [{ ...sessions[0], NowPlayingItem: { ...episode, SeriesId: '../x' } }] })));
  assert.equal(((await odd.widgets.streams.fetch()) as any).items[0].image, undefined);
});

test('jellyfin: stopping names the stream the server reports, and refuses anything ambiguous', async () => {
  const ctx = fake(jf()), j = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, ctx), stop = j.tools!.jellyfin_stop;
  assert.equal(stop.access, 'control');
  const said = await stop.confirm!({ who: 'living room', message: 'Bedtime' });
  assert.equal(said.title, "Stop Sam's The Long Tide — S2 · E4 — Undertow?");
  assert.equal(said.detail, "On Living room TV · Jellyfin Android TV. They'll see: Bedtime");
  assert.equal(said.danger, true);
  assert.equal(said.image, '/img/s1s1/Primary/tag1');

  const two = await stop.confirm!({ who: 'jellyfin' });   // both clients' names say Jellyfin
  assert.match(two.title, /2 streams match/);
  assert.notEqual(two.danger, true);
  const none = await stop.run({ who: 'jellyfin' });
  assert.match((none.data as any).error, /2 streams match "jellyfin" \(Sam on Living room TV, Alex on Tablet\)/);
  assert.match(((await stop.run({ who: 'nobody here' })).data as any).error, /no stream matches/);
  assert.match(((await stop.run({ who: 'priya' })).data as any).error, /no stream matches/, 'a session playing nothing is never "stopped"');
  assert.ok(!ctx.calls.some(c => c.init.method === 'POST'), 'nothing was sent for a refusal');

  const done = await stop.run({ who: 'sam', message: 'Bedtime' });
  assert.deepEqual(done.data, { stopped: 'The Long Tide', user: 'Sam', device: 'Living room TV' });
  const posts = ctx.calls.filter(c => c.init.method === 'POST');
  assert.deepEqual(posts.map(p => p.url), ['http://jf:8096/Sessions/sess1/Message', 'http://jf:8096/Sessions/sess1/Playing/Stop']);
  assert.deepEqual(JSON.parse(posts[0].init.body), { Header: 'Jellyfin', Text: 'Bedtime', TimeoutMs: 8000 });
  valid(done.card);

  const odd = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(jf({ sessions: [{ ...sessions[0], Id: '../../System/Shutdown' }] })));
  assert.match(((await odd.tools!.jellyfin_stop.run({ who: 'sam' })).data as any).error, /no id Valet can use/);
  const deaf = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(jf({ sessions: [{ ...sessions[0], SupportsRemoteControl: false }] })));
  assert.match(((await deaf.tools!.jellyfin_stop.run({ who: 'sam' })).data as any).error, /doesn't take remote commands/);
});

test('jellyfin: the read tools answer small and search joins search_everything', async () => {
  const j = make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(jf()));
  assert.equal(j.tools!.jellyfin_search.find, 'query');
  for (const [name, t] of Object.entries(j.tools!)) if (name !== 'jellyfin_stop') assert.equal(t.access, 'read', name);
  const playing: any = await j.tools!.jellyfin_playing.run({});
  assert.equal(playing.data.streams, 2);
  assert.equal(playing.data.sessions[1].playback, 'Transcode');
  valid(playing.card);
  const found: any = await j.tools!.jellyfin_search.run({ query: 'harbour', limit: 12 });
  assert.deepEqual(found.data[0], { title: 'Harbour Lights', detail: '2025', kind: 'film', watched: true, progress: undefined, overview: undefined });
  valid(found.card);
  valid((await j.tools!.jellyfin_continue.run({})).card);
  valid((await j.tools!.jellyfin_recent.run({})).card);
  valid((await make(jellyfin, { url: 'http://jf:8096', key: 'k' }, fake(route([[/\/Items\?/, { Items: [] }], [/\/Users$/, users]]))).tools!.jellyfin_search.run({ query: 'x', limit: 3 })).card);
});

// ── Navidrome
const ok = (body: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });
const album = (n: number, o: object = {}) => ({ id: `al${n}`, name: ['Quiet Coast', 'Low Orbit', 'Paper Birds'][n % 3], artist: 'The Example Band', coverArt: `al-al${n}_0`, songCount: 10, duration: 2400, created: new Date(Date.now() - n * 864e5).toISOString(), year: 2020 + n, ...o });
const nd = (o: { playing?: unknown } = {}) => route([
  ['getNowPlaying', ok({ nowPlaying: o.playing ?? { entry: [{ id: 's1', title: 'Tidewater', artist: 'The Example Band', album: 'Quiet Coast', albumId: 'al0', coverArt: 'mf-s1_0', duration: 200, username: 'sam', minutesAgo: 0, playerId: 1, playerName: 'Kitchen', state: 'playing', positionMs: 50_000 }] } })],
  ['getScanStatus', ok({ scanStatus: { scanning: false, count: 18422 } })],
  ['type=recent', ok({ albumList2: { album: [album(0, { played: new Date().toISOString() }), album(1)] } })],
  ['type=frequent', ok({ albumList2: { album: [album(2, { playCount: 40 }), album(0, { playCount: 10 }), album(1, { playCount: 0 })] } })],
  ['type=newest', ok({ albumList2: { album: [album(1), album(2)] } })],
  ['type=random', ok({ albumList2: { album: album(2) } })],    // a lone element, as some servers send it
  ['search3', ok({ searchResult3: { artist: [{ id: 'ar1', name: 'The Example Band', albumCount: 3 }], album: [album(0)], song: [] } })],
]);

test('navidrome: every widget validates, now playing has its position, and requests are signed, never sent the password', async () => {
  const ctx = fake(nd()), n = make(navidrome, { url: 'http://nd:4533', username: 'sam', password: 'hunter2' }, ctx);
  await allValid(n);
  const status: any = await n.widgets.status.fetch();
  assert.deepEqual(status.items.map((i: any) => [i.label, i.value]), [['Playing now', 1], ['Songs', '18,422']]);
  const now: any = await n.widgets.playing.fetch();
  assert.equal(now.items[0].pct, .25);
  assert.equal(now.items[0].remaining, '3m left');
  assert.equal(now.items[0].image, '/img/mf-s1_0');
  assert.equal(now.items[0].device, 'Kitchen');
  assert.equal(now.activity.title, 'Tidewater');
  const top: any = await n.widgets.top.fetch();
  assert.deepEqual(top.items.map((i: any) => i.value), ['40 plays', '10 plays'], 'an album never played is not "most played"');
  assert.equal(top.items[0].href, 'http://nd:4533/app/#/album/al2/show');
  assert.equal(top.aspect, 'square', 'album covers stay square, as rows and in any gallery');
  assert.ok(ctx.calls.some(c => c.url.includes('type=frequent') && c.url.includes('size=10')), 'enough albums for a gallery view');
  const again: any = await n.widgets.rediscover.fetch();
  assert.equal(again.items.length, 1);
  await n.widgets.rediscover.fetch();
  assert.equal(ctx.calls.filter(c => c.url.includes('type=random')).length, 1, 'the same few all day');
  for (const c of ctx.calls) {
    const q = new URL(c.url).searchParams;
    assert.ok(q.get('t') && q.get('s') && q.get('u') === 'sam' && !c.url.includes('hunter2'));
  }
  const quiet: any = await make(navidrome, { url: 'http://nd:4533', username: 'sam', password: 'x' }, fake(nd({ playing: {} }))).widgets.playing.fetch();
  assert.equal(quiet.items.length, 0);
  assert.equal(quiet.activity, undefined);
});

test('navidrome: a refusal in a 200 is an error, covers only by ref, and search finds albums', async () => {
  const no = make(navidrome, { url: 'http://nd:4533', username: 'sam', password: 'x' }, fake(() => ({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })));
  await assert.rejects(no.widgets.playing.fetch(), /Navidrome refused: Wrong username or password/);
  const ctx = fake(() => new Response('img')), n = make(navidrome, { url: 'http://nd:4533', username: 'sam', password: 'x' }, ctx);
  for (const bad of ['', '../x', 'al 1', 'a/b', 'x?y=1']) assert.throws(() => n.image!(bad), /bad image ref/, bad);
  await n.image!('al-al0_0');
  const u = new URL(ctx.calls[0].url);
  assert.equal(u.pathname, '/rest/getCoverArt');
  assert.equal(u.searchParams.get('id'), 'al-al0_0');
  const found: any = await make(navidrome, { url: 'http://nd:4533', username: 'sam', password: 'x' }, fake(nd())).tools!.navidrome_search.run({ query: 'coast', limit: 10 });
  assert.equal(found.data.albums[0].album, 'Quiet Coast');
  valid(found.card);
  assert.equal(navidrome.create(navidrome.config.parse({ url: 'http://nd', username: 'a', password: 'b' }), fake(nd())).tools!.navidrome_search.find, 'query');
});

// ── Audiobookshelf
const BOOK = 'li_book1', PODCAST = '8a1f2c3d-0000-4000-8000-000000000001';
const libs = { libraries: [{ id: 'lib_books', name: 'Audiobooks', mediaType: 'book' }, { id: 'lib_pods', name: 'Podcasts', mediaType: 'podcast' }] };
const today = new Date().toLocaleDateString('en-CA'), yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
const abs = (o: { online?: unknown } = {}) => route([
  ['/api/libraries/lib_books/items', { results: [{ id: 'li_new', addedAt: Date.now() - 3600e3, media: { metadata: { title: 'The Lamplighter', authorName: 'A. Writer' } } }], total: 1 }],
  ['/api/libraries/lib_books/search', { book: [{ libraryItem: { id: BOOK, mediaType: 'book', media: { duration: 36000, metadata: { title: 'A Long Walk', authorName: 'B. Author', narratorName: 'C. Voice', seriesName: 'Walks' } } } }], authors: [], series: [] }],
  ['/api/libraries/lib_pods/search', { podcast: [], authors: [] }],
  ['/api/libraries', libs],
  ['/api/me/items-in-progress', { libraryItems: [
    { id: BOOK, mediaType: 'book', media: { duration: 36000, metadata: { title: 'A Long Walk', authorName: 'B. Author' } }, progressLastUpdate: Date.now() - 3600e3 },
    { id: PODCAST, mediaType: 'podcast', media: { metadata: { title: 'Example Radio', author: 'Example Studio' } }, recentEpisode: { id: 'ep_1', title: 'Episode 12', audioFile: { duration: 3600 } }, progressLastUpdate: Date.now() - 864e5 },
  ] }],
  ['/api/me/listening-stats', { totalTime: 99999, today: 1800, days: { [today]: 1800, [yesterday]: 5400, '2001-01-01': 99 } }],
  ['/api/me', { id: 'root', mediaProgress: [{ libraryItemId: BOOK, episodeId: null, duration: 36000, progress: .4, currentTime: 14400, isFinished: false }, { libraryItemId: PODCAST, episodeId: 'ep_1', duration: 3600, progress: .5, currentTime: 1800 }] }],
  ['/api/users/online', o.online ?? { usersOnline: [{ id: 'root', username: 'sam' }], openSessions: [{ id: 'play_1', userId: 'root', libraryItemId: BOOK, displayTitle: 'A Long Walk', displayAuthor: 'B. Author', duration: 36000, currentTime: 18000, deviceInfo: { browserName: 'Firefox', osName: 'Linux' } }] }],
]);

test('audiobookshelf: every widget validates, books in progress carry how far along, and the week adds up', async () => {
  const ctx = fake(abs()), a = make(audiobookshelf, { url: 'http://abs:13378', key: 'k' }, ctx);
  await allValid(a);
  const going: any = await a.widgets.progress.fetch();
  assert.deepEqual(going.items.map((i: any) => [i.title, i.subtitle, i.badge, i.note]), [['A Long Walk', 'B. Author', '40%', '6h left'], ['Episode 12', 'Example Radio', '50%', '30m left']]);
  assert.equal(going.items[1].image, `/img/${PODCAST}`);
  assert.equal(going.items[0].href, `http://abs:13378/item/${BOOK}`);
  const now: any = await a.widgets.playing.fetch();
  assert.equal(now.items[0].user, 'sam');
  assert.equal(now.items[0].pct, .5);
  assert.equal(now.items[0].device, 'Firefox on Linux');
  assert.equal(now.activity.title, 'A Long Walk');
  const week: any = await a.widgets.week.fetch();
  assert.equal(week.headline, '2h');
  assert.deepEqual(week.series[0].points.slice(-2), [90, 30]);
  const recent: any = await a.widgets.recent.fetch();
  assert.equal(recent.items[0].title, 'The Lamplighter');
  assert.ok(!ctx.calls.some(c => c.url.includes('lib_pods/items')), 'new books, from book libraries');
  const status: any = await a.widgets.status.fetch();
  assert.deepEqual(status.items.map((i: any) => [i.label, i.value]), [['In progress', 2], ['This week', '2h'], ['Libraries', 2]]);
  assert.ok(ctx.calls.every(c => c.init.headers.Authorization === 'Bearer k'));
});

test('audiobookshelf: what\'s playing needs an admin key and says so; covers only by ref; search spans libraries', async () => {
  const user = make(audiobookshelf, { url: 'http://abs:13378', key: 'k' }, fake(abs({ online: new Response('Forbidden', { status: 403 }) })));
  await assert.rejects(user.widgets.playing.fetch(), /needs an administrator's API key/);
  const told: any = await user.tools!.audiobooks_listening.run({});
  assert.equal(told.data.playingNow, 'not visible with this key');
  assert.equal(told.data.inProgress[0].progress, '40%');
  valid(told.card);

  const ctx = fake(() => new Response('img')), a = make(audiobookshelf, { url: 'http://abs:13378', key: 'k' }, ctx);
  for (const bad of ['', '../../api/me', 'li_x/../y', 'x y', 'a'.repeat(65)]) assert.throws(() => a.image!(bad), /bad image ref/, bad);
  await a.image!(PODCAST);
  assert.equal(ctx.calls[0].url, `http://abs:13378/api/items/${PODCAST}/cover?width=480&format=jpeg`);

  const s = make(audiobookshelf, { url: 'http://abs:13378', key: 'k' }, fake(abs()));
  assert.equal(s.tools!.audiobooks_search.find, 'query');
  const found: any = await s.tools!.audiobooks_search.run({ query: 'walk', limit: 8 });
  assert.deepEqual(found.data[0], { title: 'A Long Walk', by: 'B. Author', narrator: 'C. Voice', series: 'Walks', podcast: undefined, length: '10h' });
  valid(found.card);
  valid((await s.tools!.audiobooks_week.run({})).card);
  for (const t of Object.values(s.tools!)) assert.equal(t.access, 'read');
});

test('the old configs still parse, and the old status widget is still there', () => {
  assert.ok(jellyfin.config.parse({ url: 'http://jf', key: 'k', href: 'https://tv.example', every: '2m', insecure: true }));
  assert.ok(emby.config.parse({ url: 'http://emby', key: 'k' }));
  assert.ok(navidrome.config.parse({ url: 'http://nd', username: 'u', password: 'p', every: 30 }));
  assert.ok(audiobookshelf.config.parse({ url: 'http://abs', key: 'k', href: 'https://books.example' }));
  assert.throws(() => jellyfin.config.parse({ url: 'http://jf', key: 'k', typo: 1 }));
  for (const [i, c] of [[jellyfin, { key: 'k' }], [emby, { key: 'k' }], [navidrome, { username: 'u', password: 'p' }], [audiobookshelf, { key: 'k' }]] as const) assert.ok(make(i as any, { url: 'http://x', ...c }, fake(() => ({}))).widgets.status);
});
