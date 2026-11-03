// Jellyfin, Emby, Navidrome and Audiobookshelf: made-up servers answering as the real ones do. Titles and people are invented.
import { DAY, HOUR, MIN, ago, over, route } from './helpers.ts';
import type { Fixture } from './types.ts';

const T = 1e7;   // .NET ticks a second

// ── Jellyfin and Emby
const OWNER = '5f1e0c7a9b2d4e6f8a1b3c5d7e9f0a2b';
const users = [{ Id: OWNER, Name: 'Sam', Policy: { IsAdministrator: true } }, { Id: '0a2b4c6d8e1f3a5b7c9d1e3f5a7b9c0d', Name: 'Alex', Policy: { IsAdministrator: false } }];
const SHOWS = ['The Long Tide', 'Northern Line', 'Paper Lanterns', 'Salt Road'], FILMS = ['Harbour Lights', 'A Slow Winter', 'The Cartographer', 'Glass Orchard', 'Low Country'];
const hex = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(4);
const show = (i: number) => ({ Id: hex(`show${i}`), Type: 'Series', Name: SHOWS[i], ProductionYear: 2022 + i, ImageTags: { Primary: `p${i}` }, BackdropImageTags: [`b${i}`] });
const film = (i: number, o: object = {}) => ({ Id: hex(`film${i}`), Type: 'Movie', Name: FILMS[i], ProductionYear: 2019 + i, RunTimeTicks: (96 + i * 11) * 60 * T, ImageTags: { Primary: `p${i}` }, BackdropImageTags: [`b${i}`], ServerId: 'srv', DateCreated: ago((i * 2 + 1) * DAY), ...o });
const ep = (s: number, n: number, name: string, o: object = {}) => ({ Id: hex(`ep${s}${n}`), Type: 'Episode', Name: name, SeriesName: SHOWS[s], SeriesId: show(s).Id, SeriesPrimaryImageTag: `p${s}`, ParentBackdropItemId: show(s).Id, ParentBackdropImageTags: [`b${s}`],
  ParentIndexNumber: 2, IndexNumber: n, RunTimeTicks: 47 * 60 * T, ServerId: 'srv', DateCreated: ago((n * 7 + 3) * HOUR), ...o });
const SESSIONS = [
  { Id: 'a1b2c3d4e5f60718', UserName: 'Sam', DeviceName: 'Living room TV', Client: 'Jellyfin Android TV', SupportsRemoteControl: true, NowPlayingItem: ep(0, 4, 'Undertow'), PlayState: { PositionTicks: 19 * 60 * T, IsPaused: false, PlayMethod: 'DirectPlay' } },
  { Id: 'b2c3d4e5f6071829', UserName: 'Alex', DeviceName: 'iPad', Client: 'Jellyfin Mobile', SupportsRemoteControl: true, NowPlayingItem: film(1, { Height: 2160 }), PlayState: { PositionTicks: 71 * 60 * T, IsPaused: false, PlayMethod: 'Transcode' }, TranscodingInfo: { Bitrate: 12_000_000, Height: 1080 } },
];
const counts = { MovieCount: 612, SeriesCount: 48, EpisodeCount: 2104, AlbumCount: 0, SongCount: 0 };
const resume = { Items: [ep(1, 6, 'The Junction', { UserData: { PlayedPercentage: 62, PlaybackPositionTicks: 29 * 60 * T } }), film(2, { UserData: { PlayedPercentage: 35, PlaybackPositionTicks: 41 * 60 * T } }), ep(2, 2, 'Ember', { UserData: { PlayedPercentage: 12, PlaybackPositionTicks: 6 * 60 * T } })], TotalRecordCount: 3 };
const latest = [ep(0, 5, 'Mile Marker'), film(0), ep(3, 1, 'Evensong'), film(3), film(4), ep(2, 3, 'Lantern Night')];
const server = (o: { sessions?: unknown[]; counts?: object } = {}) => route([
  [/\/Users$/, users], ['/Items/Counts', o.counts ?? counts], [/\/Sessions(\?|$)/, o.sessions ?? SESSIONS],
  ['Items/Resume', resume], ['Items/Latest', latest], [/\/Items\?/, { Items: [film(0), show(0)] }],
]);
const jellyfinHttp = server(), embyHttp = server({ counts: { ...counts, MovieCount: 388, SongCount: 8100, AlbumCount: 640 } });

// ── Navidrome (Subsonic)
const ok = (body: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'navidrome', openSubsonic: true, ...body } });
const ARTISTS = ['The Fern Collective', 'Mara Quill', 'Night Ferry', 'Static Orchard'], ALBUMS = ['Quiet Coast', 'Low Orbit', 'Paper Birds', 'The Long Way Round', 'Copper Sun', 'Field Notes', 'Glasshouse', 'Late Trains'];
const album = (i: number, o: object = {}) => ({ id: `al${i}`, name: ALBUMS[i % 8], artist: ARTISTS[i % 4], artistId: `ar${i % 4}`, coverArt: `al-al${i}_6400`, songCount: 9 + i % 4, duration: 2400 + i * 120, year: 2014 + i, created: ago(i * 3 * DAY), ...o });
const navidromeHttp = route([
  ['getNowPlaying', ok({ nowPlaying: { entry: [{ id: 'tr1', title: 'Harbour Bells', album: 'The Long Way Round', albumId: 'al3', artist: 'Night Ferry', coverArt: 'mf-tr1_6400', duration: 248, username: 'sam', minutesAgo: 0, playerId: 1, playerName: 'Kitchen speaker', state: 'playing', positionMs: 96_000 }] } })],
  ['getScanStatus', ok({ scanStatus: { scanning: false, count: 18_422, folderCount: 930 } })],
  ['type=recent', ok({ albumList2: { album: [3, 0, 5, 1, 6, 2].map((i, n) => album(i, { played: ago(n * 9 * HOUR + 20 * MIN) })) } })],
  ['type=frequent', ok({ albumList2: { album: [[3, 64], [0, 41], [6, 33], [1, 20], [4, 12], [2, 7]].map(([i, playCount]) => album(i, { playCount })) } })],
  ['type=newest', ok({ albumList2: { album: [7, 4, 2, 5].map(i => album(i)) } })],
  ['type=random', ok({ albumList2: { album: [4, 1, 6, 2, 7, 0].map(i => album(i)) } })],
  ['search3', ok({ searchResult3: { artist: [{ id: 'ar2', name: 'Night Ferry', albumCount: 3 }], album: [album(3), album(7)], song: [] } })],
]);

// ── Audiobookshelf
const BOOKS: [string, string, string][] = [['The Lamplighter\'s Year', 'Ada Thorne', 'li_b1'], ['A Map of Small Rivers', 'Jonah Vell', 'li_b2'], ['Northbound', 'Ines Calder', 'li_b3'], ['The Patient Garden', 'Ruth Okafor', 'li_b4'], ['Salt and Signal', 'Tomas Reyes', 'li_b5'], ['Winter Light', 'Ada Thorne', 'li_b6']];
const book = (i: number, o: object = {}) => ({ id: BOOKS[i][2], mediaType: 'book', addedAt: Date.now() - (i * 4 + 1) * DAY, media: { duration: (8 + i * 2) * 3600, metadata: { title: BOOKS[i][0], authorName: BOOKS[i][1], narratorName: 'Lee Marsh', seriesName: '' } }, ...o });
const PODCAST = '3d9f6a2e-0000-4000-8000-00000000a001';
const days = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [new Date(Date.now() - i * DAY).toLocaleDateString('en-CA'), [1500, 3900, 0, 2700, 5400, 1200, 3300][i]]));
const absHttp = (o: { online?: unknown; progress?: unknown[] } = {}) => route([
  ['/api/libraries/lib_books/items', { results: [book(5), book(4), book(3)], total: 3 }],
  ['/api/libraries/lib_books/search', { book: [{ libraryItem: book(1) }], authors: [], series: [] }],
  ['/api/libraries/lib_pods/search', { podcast: [], authors: [] }],
  ['/api/libraries', { libraries: [{ id: 'lib_books', name: 'Audiobooks', mediaType: 'book' }, { id: 'lib_pods', name: 'Podcasts', mediaType: 'podcast' }] }],
  ['/api/me/items-in-progress', { libraryItems: o.progress ?? [book(0, { progressLastUpdate: Date.now() - 2 * HOUR }), book(1, { progressLastUpdate: Date.now() - DAY }),
    { id: PODCAST, mediaType: 'podcast', media: { metadata: { title: 'The Workshop Hour', author: 'Example Studio' } }, recentEpisode: { id: 'ep_31', title: '31: Hand tools', audioFile: { duration: 3300 } }, progressLastUpdate: Date.now() - 2 * DAY }, book(2, { progressLastUpdate: Date.now() - 6 * DAY })] }],
  ['/api/me/listening-stats', { totalTime: 912_000, today: days[new Date().toLocaleDateString('en-CA')], days, dayOfWeek: {}, recentSessions: [] }],
  ['/api/me', { id: 'root', username: 'sam', mediaProgress: [
    { libraryItemId: 'li_b1', episodeId: null, duration: 8 * 3600, progress: .62, currentTime: .62 * 8 * 3600 }, { libraryItemId: 'li_b2', episodeId: null, duration: 10 * 3600, progress: .18, currentTime: .18 * 10 * 3600 },
    { libraryItemId: PODCAST, episodeId: 'ep_31', duration: 3300, progress: .45, currentTime: 1485 }, { libraryItemId: 'li_b3', episodeId: null, duration: 12 * 3600, progress: .91, currentTime: .91 * 12 * 3600 }] }],
  ['/api/users/online', o.online ?? { usersOnline: [{ id: 'root', username: 'sam' }], openSessions: [{ id: 'play_1', userId: 'root', libraryItemId: 'li_b1', displayTitle: BOOKS[0][0], displayAuthor: BOOKS[0][1], duration: 8 * 3600, currentTime: .62 * 8 * 3600, deviceInfo: { clientName: 'Audiobookshelf app', deviceName: 'Phone' } }] }],
]);

export const mediaRich: Record<string, Fixture> = {
  jellyfin: {
    config: { url: 'http://jellyfin:8096', key: 'x', href: 'https://tv.example.com' },
    http: jellyfinHttp,
    states: [
      { widget: 'streams', state: 'paused', label: 'Paused', http: server({ sessions: [{ ...SESSIONS[0], PlayState: { ...SESSIONS[0].PlayState, IsPaused: true } }] }) },
      { widget: 'streams', state: 'empty', label: 'Nothing playing', http: server({ sessions: [] }) },
      { widget: 'resume', state: 'empty', label: 'Nothing half-watched', http: over([['Items/Resume', { Items: [], TotalRecordCount: 0 }]], jellyfinHttp) },
      { widget: 'recent', state: 'empty', label: 'Nothing added', http: over([['Items/Latest', []]], jellyfinHttp) },
    ],
  },
  emby: {
    config: { url: 'http://emby:8096', key: 'x', href: 'https://emby.example.com' },
    http: embyHttp,
    states: [{ widget: 'streams', state: 'empty', label: 'Nothing playing', http: server({ sessions: [] }) }],
  },
  navidrome: {
    config: { url: 'http://navidrome:4533', username: 'sam', password: 'x', href: 'https://music.example.com' },
    http: navidromeHttp,
    states: [
      { widget: 'playing', state: 'paused', label: 'Paused', http: over([['getNowPlaying', ok({ nowPlaying: { entry: [{ id: 'tr2', title: 'Copper Sun', album: 'Copper Sun', albumId: 'al4', artist: 'Mara Quill', coverArt: 'mf-tr2_6400', duration: 212, username: 'sam', minutesAgo: 3, playerId: 2, playerName: 'Desk', state: 'paused', positionMs: 150_000 }] } })]], navidromeHttp) },
      { widget: 'playing', state: 'empty', label: 'Nothing playing', http: over([['getNowPlaying', ok({ nowPlaying: {} })]], navidromeHttp) },
    ],
  },
  audiobookshelf: {
    config: { url: 'http://audiobookshelf:13378', key: 'x', href: 'https://books.example.com' },
    http: absHttp(),
    states: [
      { widget: 'playing', state: 'empty', label: 'Nobody listening', http: absHttp({ online: { usersOnline: [], openSessions: [] } }) },
      { widget: 'progress', state: 'empty', label: 'Nothing in progress', http: absHttp({ progress: [] }) },
    ],
  },
};
