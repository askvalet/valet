// Downloads, the screen and the shelves: made-up services answering as the real ones do. Titles and people are invented.
import { DAY, HOUR, MIN, ago, ahead, docPage, over, route, secondsAgo, ticker, wave, webPage, ymd } from './helpers.ts';
import type { Fixture } from './types.ts';

const art = (name: string) => `https://art.example/${name}.jpg`;
const images = (name: string) => [{ coverType: 'poster', remoteUrl: art(`${name}-poster`) }, { coverType: 'fanart', remoteUrl: art(`${name}-fan`) }];

// ── Sonarr and Radarr
const SHOWS = ['The Long Tide', 'Northern Line', 'Paper Lanterns', 'Salt Road', 'The Quiet Hour'];
const FILMS = ['Harbour Lights', 'A Slow Winter', 'The Cartographer', 'Glass Orchard'];
const episodes = [[.1, 0, 3, 'First Light', true], [1, 1, 5, 'The Junction', false], [2, 2, 2, 'Ember', false], [3, 3, 7, 'Mile Marker', false], [6, 4, 1, 'Evensong', false]]
  .map(([d, s, n, title, hasFile]) => ({ airDateUtc: ahead(+d * DAY), seasonNumber: 2, episodeNumber: n, title, hasFile, series: { title: SHOWS[+s], titleSlug: String(SHOWS[+s]).toLowerCase().replace(/ /g, '-'), images: images(`show${s}`) } }));
const films = [[2, 0, false], [5, 1, false], [9, 2, true]].map(([d, f, hasFile]) => ({ title: FILMS[+f], year: 2026, hasFile, titleSlug: String(FILMS[+f]).toLowerCase().replace(/ /g, '-'), tmdbId: 1000 + +f, digitalRelease: ahead(+d * DAY), images: images(`film${f}`) }));
const library = (kind: 'film' | 'show') => Array.from({ length: 24 }, (_, i) => ({ id: i + 1, title: kind === 'film' ? FILMS[i % 4] : SHOWS[i % 5], year: 2018 + i % 8, monitored: true, hasFile: true, added: ago((i + 2) * 9 * DAY), runtime: kind === 'film' ? 112 : 44, sizeOnDisk: 9e9, images: images(`${kind}${i % 5}`), statistics: { episodeFileCount: 40 + i, episodeCount: 44 + i, sizeOnDisk: 42e9 } }));
const arrHttp = route([
  ['8989/api/v3/calendar', episodes], ['7878/api/v3/calendar', films], ['/api/v3/series', library('show')], ['/api/v3/movie', library('film')],
]);

// ── qBittorrent
const torrents = [
  { hash: 'aa01', name: 'The.Long.Tide.S02E04.1080p.WEB-DL.x265-NOGRP', state: 'downloading', progress: .64, dlspeed: 18_400_000, amount_left: 1.4e9, eta: 90, num_seeds: 41 },
  { hash: 'aa02', name: 'Harbour.Lights.2026.2160p.WEB-DL.x265-NOGRP', state: 'downloading', progress: .31, dlspeed: 9_200_000, amount_left: 11e9, eta: 1300, num_seeds: 18 },
  { hash: 'aa03', name: 'Northern.Line.S01.1080p.WEBRip.x265-NOGRP', state: 'downloading', progress: .12, dlspeed: 4_100_000, amount_left: 21e9, eta: 5100, num_seeds: 9 },
  { hash: 'aa04', name: 'Paper.Lanterns.S03E02.720p.HDTV.x264-NOGRP', state: 'stalledDL', progress: .47, dlspeed: 0, amount_left: 480e6, eta: 8640000, num_seeds: 0, last_activity: secondsAgo(5 * HOUR), added_on: secondsAgo(26 * HOUR) },
  { hash: 'aa05', name: 'Salt.Road.2024.1080p.BluRay.x265-NOGRP', state: 'metaDL', progress: 0, dlspeed: 0, amount_left: 0, eta: 8640000, num_seeds: 0, added_on: secondsAgo(4 * MIN) },
];
const queue = (t: any[]) => ({ records: t });
const qbitLogin = () => new Response('Ok.', { headers: { 'set-cookie': 'SID=sample; Path=/' } });
const tick = ticker();
const transfer = () => { const i = tick(); return { dl_info_speed: Math.round(wave(i, 12e6, 34e6)), up_info_speed: Math.round(wave(i + 9, 1e6, 4e6)) }; };
const qbit = (list: any[], info: () => unknown = transfer) => route([
  ['auth/login', qbitLogin], ['transfer/info', info], ['torrents/info', list],
  ['sync/maindata', { server_state: { alltime_dl: 6.2e12, alltime_ul: 9.8e12 } }],
  ['7878/api/v3/queue', queue([{ downloadId: 'AA02', movie: { title: 'Harbour Lights', year: 2026, images: images('film0') }, quality: { quality: { name: 'WEBDL-2160p' } } }])],
  ['8989/api/v3/queue', queue([{ downloadId: 'AA01', series: { title: 'The Long Tide', images: images('show0') }, episode: { seasonNumber: 2, episodeNumber: 4, title: 'Undertow' }, quality: { quality: { name: 'WEBDL-1080p' } } }])],
  ['8989/api/v3/series', library('show')], ['7878/api/v3/movie', library('film')],
]);

// ── Tautulli
const thumb = (n: number) => `/library/metadata/${n}/thumb/1`, backdrop = (n: number) => `/library/metadata/${n}/art/1`;
const session = (n: number, o: Record<string, unknown>) => ({ session_key: String(n), media_type: 'episode', state: 'playing', grandparent_title: SHOWS[n % 5], title: 'Undertow', parent_media_index: 2, media_index: n + 3, full_title: `${SHOWS[n % 5]} - Undertow`, friendly_name: ['Sam', 'Alex', 'Priya'][n % 3], player: ['Living room TV', 'Bedroom Roku', 'iPad'][n % 3], product: 'Plex', progress_percent: 18 + n * 27, duration: 3_000_000, view_offset: 900_000 + n * 600_000, bandwidth: 8400 + n * 12_000, stream_video_full_resolution: ['1080p', '4K', '720p'][n % 3], transcode_decision: ['direct play', 'copy', 'transcode'][n % 3], location: 'lan', grandparent_thumb: thumb(10 + n), grandparent_art: backdrop(10 + n), ...o });
const SESSIONS = [session(0, {}), session(1, { media_type: 'movie', title: FILMS[1], full_title: FILMS[1], year: 2025, grandparent_title: '', grandparent_thumb: '', thumb: thumb(20), grandparent_art: '', art: backdrop(20) })];
const year = new Date().getFullYear();
const WATCHED = [['The Long Tide', 'episode', 1, 14], ['Northern Line', 'episode', 2, 11], ['Paper Lanterns', 'episode', 3, 9], ['Salt Road', 'episode', 4, 6], ['A Slow Winter', 'movie', 5, 3], ['The Cartographer', 'movie', 6, 2]] as const;
const historyRows = (() => {
  const rows: any[] = [], now = Date.now();
  for (const [title, media_type, n, weight] of WATCHED) for (let m = 0; m < 12; m++) for (let k = 0; k < Math.max(1, weight - Math.abs(m - n * 1.6)); k++) {
    const at = new Date(year, m, 3 + (k * 5 + n) % 24, 20 + (k + n) % 4, 10).getTime();
    if (at < now) rows.push({ date: Math.floor(at / 1000), media_type, title: media_type === 'episode' ? `Episode ${k + 1}` : title, grandparent_title: media_type === 'episode' ? title : '', full_title: title, friendly_name: ['Sam', 'Alex', 'Priya', 'Theo'][k % 4], user: 'user', player: 'Living room TV', percent_complete: 100, thumb: thumb(30 + n), grandparent_thumb: media_type === 'episode' ? thumb(30 + n) : '', rating_key: 30 + n, grandparent_rating_key: 30 + n, play_duration: media_type === 'episode' ? 2640 : 6780, duration: 2700 });
  }
  return rows.sort((a, b) => b.date - a.date);
})();
const byDate = (days: number) => {
  const dates = Array.from({ length: days }, (_, i) => ymd((i - days + 1) * DAY));
  const tv = dates.map((_, i) => Math.round(wave(i, 0, 7))), film = dates.map((_, i) => Math.round(wave(i + 4, 0, 3))), music = dates.map((_, i) => Math.round(wave(i + 2, 0, 2)));
  return { categories: dates, series: [{ name: 'TV', data: tv }, { name: 'Movies', data: film }, { name: 'Music', data: music }, { name: 'Total', data: tv.map((n, i) => n + film[i] + music[i]) }] };
};
const homeStats = [
  { stat_id: 'top_movies', rows: FILMS.slice(0, 3).map((title, i) => ({ title, total_plays: 4 - i, total_duration: (4 - i) * 6600, thumb: thumb(20 + i), art: backdrop(20 + i) })) },
  { stat_id: 'top_tv', rows: SHOWS.slice(0, 4).map((title, i) => ({ title, total_plays: 22 - i * 5, total_duration: (22 - i * 5) * 2640, thumb: thumb(10 + i), art: backdrop(10 + i) })) },
  { stat_id: 'top_users', rows: [['Sam', 31, 92_000], ['Alex', 24, 71_000], ['Priya', 12, 38_000], ['Theo', 6, 15_000]].map(([friendly_name, total_plays, total_duration]) => ({ friendly_name, total_plays, total_duration })) },
];
const added = [...SHOWS.map((t, i) => ({ media_type: 'episode', title: 'Undertow', grandparent_title: t, full_title: t, parent_media_index: 2, media_index: i + 1, grandparent_thumb: thumb(10 + i), grandparent_art: backdrop(10 + i), added_at: secondsAgo((i * 19 + 2) * HOUR) })),
  ...FILMS.map((t, i) => ({ media_type: 'movie', title: t, full_title: t, year: 2024 + i % 3, thumb: thumb(20 + i), art: backdrop(20 + i), added_at: secondsAgo((i * 2 + 4) * DAY) }))];
const speeds = ticker();
const tautulliAnswer = (sessions: any[], o: { history?: any[]; added?: any[]; home?: any[]; plays?: (d: number) => unknown } = {}) => (url: string) => {
  const q = new URL(url).searchParams, cmd = q.get('cmd');
  const data: Record<string, () => unknown> = {
    get_activity: () => ({ stream_count: String(sessions.length), total_bandwidth: String(sessions.reduce((n, s) => n + s.bandwidth, 0) + Math.round(wave(speeds(), 0, 2400))), sessions }),
    get_libraries: () => [{ section_type: 'movie', count: '612' }, { section_type: 'show', count: '148', parent_count: '512', child_count: '6204' }],
    get_plays_by_date: () => (o.plays ?? byDate)(Number(q.get('time_range') ?? 30)),
    get_home_stats: () => o.home ?? homeStats,
    get_recently_added: () => ({ recently_added: o.added ?? added }),
    get_metadata: () => ({ art: backdrop(31) }),
    get_history: () => {
      const after = q.get('after'), before = q.get('before'), start = Number(q.get('start') ?? 0);
      const rows = (o.history ?? historyRows).filter(h => { const d = new Date(h.date * 1000).toISOString().slice(0, 10); return (!after || d >= after) && (!before || d <= before); });
      return { data: rows.slice(start, start + Number(q.get('length') ?? 1000)) };
    },
  };
  return { response: { result: 'success', data: data[cmd!]?.() } };
};

// ── Seerr
const request = (id: number, type: string, media: Record<string, unknown>) => ({ type, createdAt: ago((id % 9 + 1) * DAY), media: { tmdbId: id, ...media } });
const requests = [
  request(1, 'movie', { status: 5, mediaUrl: 'https://plex.example.com/web/1' }), request(2, 'tv', { status: 4, mediaUrl: 'https://plex.example.com/web/2', seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 3 }, { seasonNumber: 3, status: 2 }] }),
  request(3, 'movie', { status: 3, downloadStatus: [{ size: 9e9, sizeLeft: 3.1e9 }] }), request(4, 'tv', { status: 3 }), request(5, 'movie', { status: 2 }), request(6, 'movie', { status: 2 }),
];
const seerrTitles = ['', 'Harbour Lights', 'The Long Tide', 'Glass Orchard', 'Salt Road', 'A Slow Winter', 'The Cartographer'];
const seerrHttp = route([
  ['/request?', { results: requests }],
  [/\/movie\/(\d+)/, (u: string) => { const n = Number(/\/movie\/(\d+)/.exec(u)![1]); return { id: n, title: seerrTitles[n], posterPath: `/film${n}.jpg`, releaseDate: `${2020 + n}-03-14` }; }],
  [/\/tv\/(\d+)/, (u: string) => { const n = Number(/\/tv\/(\d+)/.exec(u)![1]); return { id: n, name: seerrTitles[n], posterPath: `/show${n}.jpg`, firstAirDate: `${2019 + n}-09-02` }; }],
]);

// ── Immich
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number, city: string, country: string, yearsAgo: number) => ({ id: uuid(n), type: 'IMAGE', localDateTime: new Date(Date.now() - yearsAgo * 365 * DAY).toISOString(), exifInfo: { city, country } });
const trip = [asset(1, 'Banff', 'Canada', 1), asset(2, 'Skye', 'Scotland', 2), asset(3, 'Puerto Natales', 'Chile', 3), asset(4, 'Lake Louise', 'Canada', 4)];
const memories = [{ data: { year: year - 1 }, assets: [trip[0]] }, { data: { year: year - 2 }, assets: [trip[1]] }, { data: { year: year - 3 }, assets: [trip[2], trip[3]] }];
const buckets = Array.from({ length: 10 }, (_, m) => ({ timeBucket: `${year}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`, count: [212, 148, 96, 410, 188, 934, 1207, 620, 301, 144][m] }));
const immichHttp = route([['memories?', memories], ['search/random', trip], ['timeline/buckets', buckets]]);
const immichImage = (ref: string) => `/art/photos/${Number(ref.slice(-1)) % 4}.jpg`;

// ── RomM
const games = [['Star Courier', 'Game Boy', 'gb'], ['Moonlit Keep', 'Super Nintendo', 'snes'], ['Rally Atlas', 'Dreamcast', 'dc'], ['Tiny Frontier', 'Game Boy Advance', 'gba'], ['Pixel Harbor', 'Mega Drive', 'genesis'], ['Iron Lantern', 'PlayStation', 'psx'], ['Comet Runner', 'Nintendo 64', 'n64'], ['Hollow Bay', 'Super Nintendo', 'snes']]
  .map(([name, platform_display_name, platform_fs_slug], i) => ({ id: i + 1, name, platform_display_name, platform_fs_slug, path_cover_large: `/covers/${i}.png`, last_played: i % 3 ? null : ago(i * DAY) }));
const rommHttp = route([['/api/stats', { ROMS: 312, PLATFORMS: 9, TOTAL_FILESIZE_BYTES: 186e9, SAVES: 47 }], ['/api/roms', { items: games }]]);

// ── changedetection.io
const watches = {
  'a1b2c3d4-0000-4000-8000-000000000001': { title: 'Standing desk, oak', url: 'https://shop.example.com/desk', last_changed: secondsAgo(20 * MIN), last_checked: secondsAgo(MIN), last_error: false, viewed: false },
  'a1b2c3d4-0000-4000-8000-000000000002': { title: 'Router firmware', url: 'https://example.com/firmware', last_changed: secondsAgo(3 * DAY), last_checked: secondsAgo(2 * MIN), last_error: false, viewed: true },
  'a1b2c3d4-0000-4000-8000-000000000003': { title: 'Concert tickets', url: 'https://tickets.example.com/tour', last_changed: 0, last_checked: secondsAgo(4 * MIN), last_error: false, viewed: false },
};
const watchHttp = route([
  [/0001\/difference/, '(removed) Sold out\n(added) In stock, ships in 3 days'],
  [/0002\/difference/, '(added) Version 4.2.1, security fixes'], [/0001\/history/, 'In stock, ships in 3 days'],
  [/0002\/history/, 'Version 4.2.1, security fixes'], [/0003\/history/, 'Montreal: Sold out\nToronto: On sale Friday\nVancouver: Sold out'], ['/api/v1/watch', watches],
]);

// ── Karakeep
const saved = [
  ['Why I moved my photos off the cloud', 'https://notes.example.com/photos', 'A year on, what self-hosting a photo library cost in time and disks, and what it gave back.', ['self-hosting', 'photos'], 1],
  ['A field guide to ZFS scrubs', 'https://storage.example.org/zfs-scrubs', 'How often to scrub, what the numbers mean, and when a checksum error is worth losing sleep over.', ['storage'], 2],
  ['The small web is still here', 'https://blog.example.net/small-web', 'Personal sites never went away. A tour of the ones worth following, and how to find more.', ['web'], 4],
  ['Cooking for one, well', 'https://kitchen.example.com/one', 'Ten dinners that scale down without leaving half a cabbage in the fridge.', ['food'], 6],
  ['Reading a SMART report', 'https://drives.example.org/smart', 'The five attributes that predict failure, and the many that do not.', ['storage', 'hardware'], 9],
  ['Notes on running a home server for ten years', 'https://notes.example.com/ten-years', 'What lasted, what broke, and why boring hardware keeps winning.', ['homelab'], 12],
].map(([title, url, description, tags, d], i) => ({ id: `bm${i}`, title, createdAt: ago(+d! * DAY), summary: description, tags: (tags as string[]).map(name => ({ name })), content: { type: 'link', url, title, description, screenshotAssetId: `page${i}`, imageAssetId: `page${i}` } }));
const karakeepHttp = route([['users/me/stats', { numBookmarks: 1842, topDomains: [{ domain: 'notes.example.com', count: 96 }], tagUsage: [{ name: 'self-hosting', count: 212 }, { name: 'storage', count: 148 }, { name: 'food', count: 97 }, { name: 'homelab', count: 88 }] }], ['bookmarks', { bookmarks: saved }]]);

// ── Paperless
const named = (list: string[]) => ({ results: list.map((name, i) => ({ id: i + 1, name })) });
const docs = [['Electricity bill, October', 1, 1, 4], ['Home insurance renewal', 2, 2, 12], ['Boiler service receipt', 3, 3, 21], ['Lease addendum', 4, 2, 40], ['Water bill, September', 5, 1, 52], ['Vet invoice', 6, 3, 61], ['Annual tax summary', 7, 2, 90], ['Warranty, dishwasher', 3, 2, 120]]
  .map(([title, correspondent, document_type, d], i) => ({ id: i + 1, title, correspondent, document_type, tags: [1], created: ago(+d! * DAY) }));
const paperlessHttp = route([
  ['statistics/', { documents_total: 3412, character_count: 41_000_000 }],
  ['correspondents/?ordering', { results: [['City Power', 412], ['Northfield Insurance', 188], ['Harbour Plumbing', 74], ['Revenue Office', 51]].map(([name, document_count]) => ({ name, document_count })) }],
  ['correspondents/', named(['City Power', 'Northfield Insurance', 'Harbour Plumbing', 'Parkside Lettings', 'City Water', 'Oak Street Vets', 'Revenue Office'])],
  ['tags/', named(['Home', 'Tax'])], ['document_types/', named(['Invoice', 'Contract', 'Receipt'])],
  ['documents/?ordering=-added&page_size=36', { results: docs.map(d => ({ id: d.id })) }], ['documents/', { count: 3412, results: docs }],
]);

// ── Prowlarr and Bazarr
const indexerList = ['TrackerOne', 'OpenShelf', 'NZB Harbour', 'PublicBay', 'Lantern', 'ReleaseWatch', 'Archivist'].map((name, id) => ({ id: id + 1, name, enable: true }));
const indexerHttp = (status: unknown[], badges: unknown) => route([['/api/v1/indexerstatus', status], ['/api/v1/indexer', indexerList], ['/api/badges', badges]]);

export const media: Record<string, Fixture> = {
  arr: {
    config: { sonarr: { url: 'http://sonarr:8989', apiKey: '${SONARR_KEY}' }, radarr: { url: 'http://radarr:7878', apiKey: '${RADARR_KEY}' }, days: 14, plex: 'https://plex.example.com' },
    http: arrHttp,
    states: [{ widget: 'upcoming', state: 'empty', label: 'Nothing scheduled', http: over([['/api/v3/calendar', []]], arrHttp) }],
  },
  qbittorrent: {
    config: { url: 'http://qbittorrent:8080', username: 'admin', password: 'x', arr: [{ type: 'radarr', url: 'http://radarr:7878', apiKey: '${RADARR_KEY}' }, { type: 'sonarr', url: 'http://sonarr:8989', apiKey: '${SONARR_KEY}' }] },
    http: qbit(torrents), warm: 30,
    states: [
      { widget: 'active', state: 'moving', label: 'All moving', http: qbit(torrents.slice(0, 3)) },
      { widget: 'active', state: 'stalled', label: 'Stalled', http: qbit(torrents.slice(3), () => ({ dl_info_speed: 0, up_info_speed: 120_000 })) },
      { widget: 'active', state: 'paused', label: 'Paused', http: qbit(torrents.slice(0, 3).map(t => ({ ...t, state: 'pausedDL', dlspeed: 0 })), () => ({ dl_info_speed: 0, up_info_speed: 0 })) },
      { widget: 'active', state: 'empty', label: 'Nothing downloading', http: qbit([], () => ({ dl_info_speed: 0, up_info_speed: 0 })) },
    ],
  },
  tautulli: {
    config: { url: 'http://tautulli:8181', apiKey: 'x', href: 'https://plex.example.com' },
    http: tautulliAnswer(SESSIONS), warm: 24,
    states: [
      { widget: 'streams', state: 'one', label: 'One stream', http: tautulliAnswer(SESSIONS.slice(0, 1)) },
      { widget: 'streams', state: 'paused', label: 'Paused', http: tautulliAnswer([{ ...SESSIONS[0], state: 'paused' }]) },
      { widget: 'streams', state: 'buffering', label: 'Buffering', http: tautulliAnswer([{ ...SESSIONS[1], state: 'buffering' }]) },
      { widget: 'streams', state: 'empty', label: 'Nothing playing', http: tautulliAnswer([]) },
      { widget: 'people', state: 'idle', label: 'Nobody on right now', http: tautulliAnswer([]) },
      { widget: 'people', state: 'empty', label: 'Nobody yet', http: tautulliAnswer([], { home: [] }) },
      { widget: 'top', state: 'empty', label: 'Nothing watched yet', http: tautulliAnswer([], { home: [] }) },
      { widget: 'recent', state: 'empty', label: 'Nothing added', http: tautulliAnswer([], { added: [] }) },
      { widget: 'race', state: 'empty', label: 'No history yet', http: tautulliAnswer([], { history: [] }) },
    ],
  },
  seerr: {
    config: { url: 'http://seerr:5055', apiKey: 'x', href: 'https://requests.example.com', downloads: 'https://home.example.com/#media' },
    http: seerrHttp,
    states: [{ widget: 'requests', state: 'empty', label: 'No requests yet', http: over([['/request?', { results: [] }]], seerrHttp) }],
  },
  immich: {
    config: { url: 'http://immich:2283', apiKey: 'x', href: 'https://photos.example.com' },
    http: immichHttp, image: immichImage,
    states: [
      { widget: 'memories', state: 'library', label: 'No memories today', http: over([['memories?', []]], immichHttp) },
      { widget: 'memories', state: 'empty', label: 'No photos yet', http: over([['memories?', []], ['search/random', []]], immichHttp) },
    ],
  },
  romm: { config: { url: 'http://romm:8080', username: 'admin', password: 'x', href: 'https://games.example.com' }, http: rommHttp },
  changedetection: {
    config: { url: 'http://changedetection:5000', key: 'x', href: 'https://watch.example.com' },
    http: watchHttp,
    states: [
      { widget: 'watches', state: 'failing', label: 'A watch failing', http: over([[/\/api\/v1\/watch$/, { ...watches, 'a1b2c3d4-0000-4000-8000-000000000003': { ...watches['a1b2c3d4-0000-4000-8000-000000000003'], last_error: 'Received 403 from the site' } }]], watchHttp) },
      { widget: 'watches', state: 'empty', label: 'Nothing watched yet', http: () => ({}) },
    ],
  },
  karakeep: {
    config: { url: 'http://karakeep:3000', apiKey: 'x', href: 'https://saved.example.com' },
    http: karakeepHttp, image: webPage,
    states: ['digest', 'reading', 'recent'].map(widget => ({ widget, state: 'empty', label: 'Nothing saved yet', http: over([['bookmarks', { bookmarks: [] }]], karakeepHttp) })),
  },
  paperless: {
    config: { url: 'http://paperless:8000', token: 'x', href: 'https://docs.example.com' },
    http: paperlessHttp, image: docPage,
    states: [{ widget: 'recent', state: 'empty', label: 'No documents yet', http: over([['documents/', { count: 0, results: [] }]], paperlessHttp) }],
  },
  indexers: {
    config: { prowlarr: { url: 'http://prowlarr:9696', apiKey: '${PROWLARR_KEY}' }, bazarr: { url: 'http://bazarr:6767', apiKey: '${BAZARR_KEY}' } },
    http: indexerHttp([], { episodes: 0, movies: 0, providers: 2 }),
    states: [
      { widget: 'health', state: 'failing', label: 'Indexers failing', http: indexerHttp([{ indexerId: 2, disabledTill: ahead(2 * HOUR) }, { indexerId: 5, disabledTill: ahead(40 * MIN) }], { episodes: 14, movies: 3, providers: 2 }) },
    ],
  },
};
