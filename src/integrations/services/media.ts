// Media servers and what feeds them.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fmt, service, tally } from '../../server/service.ts';

const key = { key: z.string().optional() };
const login = { username: z.string(), password: z.string() };
const header = (name: string, v?: string): Record<string, string> => v ? { [name]: v } : {};
const sum = (...n: unknown[]) => n.reduce<number>((a, v) => a + (Number(v) || 0), 0);

// Subsonic answers 200 even when it says no
const subsonic = (r: any) => {
  const s = r?.['subsonic-response'];
  if (s?.status === 'failed') throw new Error(`Navidrome refused: ${s.error?.message ?? 'no reason given'}`);
  return s;
};
// Tdarr keeps each state in two tables, transcodes and health checks
const tdarrCount = (s: any, n: number) => Number.parseInt(s?.[`table${n}ViewableCount`] || s?.[`table${n}Count`], 10) || 0;

export default [
  // Servers
  service({
    type: 'jellyfin', name: 'Jellyfin', icon: 'film', auth: { header: 'X-Emby-Token' },
    get: { counts: '/Items/Counts', sessions: '/Sessions?activeWithinSeconds=120' },
    stats: d => [
      { label: 'Playing now', value: d.sessions.filter((s: any) => s.NowPlayingItem).length },
      { label: 'Movies', value: d.counts.MovieCount }, { label: 'Series', value: d.counts.SeriesCount }, { label: 'Episodes', value: d.counts.EpisodeCount }],
    recap: d => tally(sum(d.counts?.MovieCount, d.counts?.SeriesCount), { id: 'jellyfin.shelf', theme: 'media', icon: 'film', kicker: 'On your Jellyfin shelf', unit: 'titles', stat: 'Titles', scope: 'All time', line: `${d.counts?.MovieCount ?? 0} films and ${d.counts?.SeriesCount ?? 0} shows, ${d.counts?.EpisodeCount ?? 0} episodes in all.` }),
    sample: { counts: { MovieCount: 1204, SeriesCount: 88, EpisodeCount: 3120 }, sessions: [{ NowPlayingItem: { Name: 'A Film' } }, {}] },
    expect: { 'Playing now': 1, Movies: '1,204', Episodes: '3,120' },
  }),
  service({
    type: 'emby', name: 'Emby', icon: 'film', auth: { header: 'X-Emby-Token' },
    get: { counts: '/emby/Items/Counts', sessions: '/emby/Sessions' },
    stats: d => [
      { label: 'Playing now', value: (d.sessions ?? []).filter((s: any) => s?.NowPlayingItem).length },
      { label: 'Movies', value: d.counts?.MovieCount ?? 0 }, { label: 'Series', value: d.counts?.SeriesCount ?? 0 },
      { label: 'Episodes', value: d.counts?.EpisodeCount ?? 0 }, { label: 'Songs', value: d.counts?.SongCount ?? 0 }],
    sample: { counts: { MovieCount: 642, SeriesCount: 51, EpisodeCount: 2210, SongCount: 8100 }, sessions: [{ NowPlayingItem: { Name: 'An Episode' } }, { Client: 'Web' }] },
    expect: { 'Playing now': 1, Movies: 642, Songs: '8,100' },
  }),
  service({
    type: 'plex', name: 'Plex', icon: 'film', auth: { header: 'X-Plex-Token' },
    about: 'What the Plex server itself reports: streams playing now and how much is in its libraries.',
    // one size-0 page per kind: counts across every library without walking them
    get: () => {
      const count = (type: number) => ({ path: `/library/all?type=${type}`, optional: true, headers: { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '0' } });
      return { sessions: '/status/sessions', movies: count(1), shows: count(2), albums: count(9) };
    },
    stats: d => {
      const total = (r: any) => r?.MediaContainer?.totalSize ?? r?.MediaContainer?.size;
      return [{ label: 'Playing now', value: d.sessions?.MediaContainer?.size ?? 0 }, { label: 'Movies', value: total(d.movies) },
        { label: 'Shows', value: total(d.shows) }, { label: 'Albums', value: total(d.albums) }];
    },
    sample: { sessions: { MediaContainer: { size: 2 } }, movies: { MediaContainer: { size: 0, totalSize: 1530 } }, shows: { MediaContainer: { size: 0, totalSize: 96 } }, albums: { MediaContainer: { size: 0, totalSize: 412 } } },
    expect: { 'Playing now': 2, Movies: '1,530', Shows: 96 },
  }),
  service<{ username: string; password: string }>({
    type: 'navidrome', name: 'Navidrome', icon: 'play', options: login,
    // Subsonic signs each request: md5 of the password and a fresh salt
    get: o => {
      const salt = randomBytes(8).toString('hex'), token = createHash('md5').update(`${o.password}${salt}`).digest('hex');
      const rest = (call: string) => `/rest/${call}?u=${encodeURIComponent(o.username)}&t=${token}&s=${salt}&v=1.16.1&c=valet&f=json`;
      return { playing: rest('getNowPlaying'), scan: { path: rest('getScanStatus'), optional: true } };
    },
    stats: d => {
      const entry = subsonic(d.playing)?.nowPlaying?.entry;
      return [{ label: 'Playing now', value: entry ? Object.values(entry).length : 0 }, { label: 'Songs', value: d.scan?.['subsonic-response']?.scanStatus?.count }];
    },
    recap: d => tally(d.scan?.['subsonic-response']?.scanStatus?.count, { id: 'music.songs', theme: 'music', icon: 'play', kicker: 'Your music, on your own disks', unit: 'songs', stat: 'Songs', scope: 'All time', line: 'No subscription can take a single one of them away.' }),
    sample: { playing: { 'subsonic-response': { status: 'ok', nowPlaying: { entry: [{ id: 'a1', title: 'A Song', artist: 'A Band' }] } } },
      scan: { 'subsonic-response': { status: 'ok', scanStatus: { scanning: false, count: 18422, folderCount: 930 } } } },
    sampleOptions: { username: 'admin', password: 'hunter2' },
    expect: { 'Playing now': 1, Songs: '18,422' },
  }),
  service({
    type: 'photoprism', name: 'PhotoPrism', icon: 'image',
    auth: { login: '/api/v1/session', token: r => r.access_token ?? r.id, use: t => ({ 'X-Auth-Token': t, 'X-Session-ID': t }) },
    get: { config: '/api/v1/config' },
    stats: d => [{ label: 'Photos', value: d.config?.count?.photos ?? 0 }, { label: 'Videos', value: d.config?.count?.videos ?? 0 },
      { label: 'Albums', value: d.config?.count?.albums ?? 0 }, { label: 'People', value: d.config?.count?.people ?? 0 }],
    sample: { config: { count: { photos: 48210, videos: 1320, albums: 64, people: 37 } } },
    expect: { Photos: '48,210', Videos: '1,320', People: 37 },
  }),
  service<{ key?: string }>({
    type: 'stash', name: 'Stash', icon: 'film', options: key,
    get: o => ({ stats: { path: '/graphql', method: 'POST', headers: header('ApiKey', o.key),
      body: { query: '{ stats { scene_count scenes_size image_count images_size performer_count } }' } } }),
    stats: d => {
      const s = d.stats?.data?.stats;
      return [{ label: 'Scenes', value: s?.scene_count ?? 0 }, { label: 'Images', value: s?.image_count ?? 0 },
        { label: 'Performers', value: s?.performer_count ?? 0 }, { label: 'Library size', value: fmt.bytes(sum(s?.scenes_size, s?.images_size)) }];
    },
    sample: { stats: { data: { stats: { scene_count: 512, scenes_size: 1099511627776, image_count: 3400, images_size: 0, performer_count: 80 } } } },
    expect: { Scenes: 512, Images: '3,400', 'Library size': '1.0 TB' },
  }),

  // Who's watching and listening
  service({
    type: 'jellystat', name: 'Jellystat', icon: 'chart', auth: { header: 'X-API-Token' },
    get: { views: '/stats/getViewsByLibraryType?days=30' },
    stats: d => [{ label: 'Movies (30 days)', value: d.views?.Movie ?? 0 }, { label: 'Episodes (30 days)', value: d.views?.Series ?? 0 },
      { label: 'Songs (30 days)', value: d.views?.Audio ?? 0 }, { label: 'Other (30 days)', value: d.views?.Other ?? 0 }],
    sample: { views: { Audio: 1240, Movie: 38, Series: 212, Other: 4 } },
    expect: { 'Movies (30 days)': 38, 'Songs (30 days)': '1,240' },
  }),
  service({
    type: 'tracearr', name: 'Tracearr', icon: 'play', auth: 'bearer',
    get: { streams: '/api/v1/public/streams' },
    stats: d => {
      const s = d.streams?.summary;
      return [{ label: 'Streams', value: s?.total ?? d.streams?.data?.length ?? 0 }, { label: 'Transcodes', value: s?.transcodes ?? 0 },
        { label: 'Direct plays', value: s?.directPlays ?? 0 }, { label: 'Bitrate', value: s?.totalBitrate }];
    },
    sample: { streams: { data: [{ id: 's1', progressMs: 60000 }, { id: 's2', progressMs: 1200 }], summary: { total: 2, transcodes: 1, directPlays: 1, totalBitrate: '24.5 Mbps' } } },
    expect: { Streams: 2, Transcodes: 1, Bitrate: '24.5 Mbps' },
  }),
  service({
    type: 'your-spotify', name: 'Your Spotify', icon: 'chart', auth: { query: 'token' },
    get: () => {
      const week = `?start=${new Date(Date.now() - 7 * 864e5).toISOString()}&timeSplit=all`;
      return { songs: `/spotify/songs_per${week}`, time: `/spotify/time_per${week}`, artists: `/spotify/different_artists_per${week}` };
    },
    stats: d => [{ label: 'Songs (7 days)', value: d.songs?.[0]?.count ?? 0 }, { label: 'Listened (7 days)', value: fmt.duration((d.time?.[0]?.count ?? 0) / 1000) },
      { label: 'Artists (7 days)', value: d.artists?.[0]?.artists?.length ?? 0 }],
    sample: { songs: [{ count: 342 }], time: [{ count: 72_000_000 }], artists: [{ artists: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] },
    expect: { 'Songs (7 days)': 342, 'Listened (7 days)': '20h 0m', 'Artists (7 days)': 3 },
  }),

  // Books, comics and manga
  service({
    type: 'audiobookshelf', name: 'Audiobookshelf', icon: 'book', auth: 'bearer',
    // item counts and hours live per library, a call each: service() has no way to follow up on this answer
    get: { libraries: '/api/libraries' },
    stats: d => {
      const libs = d.libraries?.libraries ?? [];
      return [{ label: 'Libraries', value: libs.length }, { label: 'Book libraries', value: libs.filter((l: any) => l.mediaType === 'book').length },
        { label: 'Podcast libraries', value: libs.filter((l: any) => l.mediaType === 'podcast').length }];
    },
    sample: { libraries: { libraries: [{ id: 'l1', name: 'Audiobooks', mediaType: 'book' }, { id: 'l2', name: 'Lectures', mediaType: 'book' }, { id: 'l3', name: 'Podcasts', mediaType: 'podcast' }] } },
    expect: { Libraries: 3, 'Book libraries': 2, 'Podcast libraries': 1 },
  }),
  service({
    type: 'calibre-web', name: 'Calibre-Web', icon: 'book', auth: 'basic',
    get: { stats: '/opds/stats' },
    stats: d => [{ label: 'Books', value: d.stats?.books ?? 0 }, { label: 'Authors', value: d.stats?.authors ?? 0 },
      { label: 'Series', value: d.stats?.series ?? 0 }, { label: 'Categories', value: d.stats?.categories ?? 0 }],
    sample: { stats: { books: 1890, authors: 742, categories: 96, series: 133 } },
    expect: { Books: '1,890', Authors: 742 },
  }),
  service({
    type: 'booklore', name: 'BookLore', icon: 'book', auth: { login: '/api/v1/auth/login', token: r => r.accessToken },
    get: { libraries: '/api/v1/libraries', books: '/api/v1/books' },
    stats: d => {
      const books = d.books ?? [], read = (s: string) => books.filter((b: any) => String(b?.readStatus ?? '').toUpperCase() === s).length;
      return [{ label: 'Books', value: books.length }, { label: 'Reading', value: read('READING') }, { label: 'Finished', value: read('READ') }, { label: 'Libraries', value: d.libraries?.length ?? 0 }];
    },
    sample: { libraries: [{ id: 1, name: 'Fiction' }, { id: 2, name: 'Reference' }], books: [{ id: 1, readStatus: 'READING' }, { id: 2, readStatus: 'READ' }, { id: 3, readStatus: 'read' }, { id: 4 }] },
    expect: { Books: 4, Reading: 1, Finished: 2, Libraries: 2 },
  }),
  service({
    type: 'bookorbit', name: 'BookOrbit', icon: 'book',
    auth: { login: '/api/v1/auth/login', body: c => ({ username: c.username, password: c.password, clientKind: 'native', deviceLabel: 'Valet' }), token: r => r.accessToken },
    get: { library: '/api/v1/statistics/summary', reading: '/api/v1/user-statistics/summary' },
    stats: d => [{ label: 'Books', value: d.library?.totalBooks ?? 0 }, { label: 'Authors', value: d.library?.totalAuthors ?? 0 },
      { label: 'Reading', value: d.reading?.inProgressBooks ?? 0 }, { label: 'Finished', value: d.reading?.completedBooks ?? 0 },
      { label: 'Storage', value: fmt.bytes(d.library?.totalStorageBytes ?? 0) }],
    sample: { library: { totalBooks: 1120, totalAuthors: 480, totalSeries: 76, totalStorageBytes: 16106127360 }, reading: { inProgressBooks: 3, completedBooks: 214 } },
    expect: { Books: '1,120', Reading: 3, Storage: '15.0 GB' },
  }),
  service({
    type: 'atsumeru', name: 'Atsumeru', icon: 'book', auth: 'basic',
    get: { info: '/api/server/info' },
    stats: d => [{ label: 'Series', value: d.info?.stats?.total_series ?? 0 }, { label: 'Archives', value: d.info?.stats?.total_archives ?? 0 },
      { label: 'Chapters', value: d.info?.stats?.total_chapters ?? 0 }, { label: 'Categories', value: d.info?.stats?.total_categories ?? 0 }],
    sample: { info: { stats: { total_series: 160, total_archives: 2240, total_chapters: 9800, total_categories: 12 } } },
    expect: { Series: 160, Chapters: '9,800' },
  }),
  service<{ username?: string; password?: string }>({
    type: 'suwayomi', name: 'Suwayomi', icon: 'book',
    options: { username: z.string().optional(), password: z.string().optional() },
    get: o => {
      const count = (condition: string) => `chapters(condition: {${condition}}, filter: {inLibrary: {equalTo: true}}) { totalCount }`;
      return { counts: { path: '/api/graphql', method: 'POST',
        headers: header('Authorization', o.username && `Basic ${Buffer.from(`${o.username}:${o.password ?? ''}`).toString('base64')}`),
        body: { query: `query { unread: ${count('isRead: false')} read: ${count('isRead: true')} downloaded: ${count('isDownloaded: true')} }` } } };
    },
    stats: d => [{ label: 'Unread chapters', value: d.counts?.data?.unread?.totalCount ?? 0 }, { label: 'Read chapters', value: d.counts?.data?.read?.totalCount ?? 0 },
      { label: 'Downloaded', value: d.counts?.data?.downloaded?.totalCount ?? 0 }],
    sample: { counts: { data: { unread: { totalCount: 412 }, read: { totalCount: 1280 }, downloaded: { totalCount: 930 } } } },
    expect: { 'Unread chapters': 412, 'Read chapters': '1,280', Downloaded: 930 },
  }),

  // What fills the libraries
  service({
    type: 'lidarr', name: 'Lidarr', icon: 'download', auth: { header: 'X-Api-Key' },
    get: { artists: '/api/v1/artist', wanted: '/api/v1/wanted/missing?pageSize=1', queue: '/api/v1/queue/status' },
    stats: d => [{ label: 'Artists', value: d.artists?.length ?? 0 }, { label: 'Wanted', value: d.wanted?.totalRecords ?? 0 }, { label: 'Queued', value: d.queue?.totalCount ?? 0 }],
    sample: { artists: [{ id: 1, artistName: 'A Band' }, { id: 2, artistName: 'Another Band' }], wanted: { page: 1, pageSize: 1, totalRecords: 37, records: [] }, queue: { totalCount: 4 } },
    expect: { Artists: 2, Wanted: 37, Queued: 4 },
  }),
  service({
    type: 'readarr', name: 'Readarr', icon: 'download', auth: { header: 'X-Api-Key' },
    get: { books: '/api/v1/book', wanted: '/api/v1/wanted/missing?pageSize=1', queue: '/api/v1/queue/status' },
    stats: d => [{ label: 'Books', value: (d.books ?? []).filter((b: any) => b?.statistics?.bookFileCount > 0).length },
      { label: 'Wanted', value: d.wanted?.totalRecords ?? 0 }, { label: 'Queued', value: d.queue?.totalCount ?? 0 }],
    sample: { books: [{ id: 1, statistics: { bookFileCount: 1 } }, { id: 2, statistics: { bookFileCount: 0 } }, { id: 3 }], wanted: { totalRecords: 12, records: [] }, queue: { totalCount: 1 } },
    expect: { Books: 1, Wanted: 12, Queued: 1 },
  }),
  service({
    type: 'sportarr', name: 'Sportarr', icon: 'download', auth: { query: 'apikey' },
    get: { wanted: '/api/wanted/missing?page=1&pageSize=1', queue: '/api/queue', leagues: '/api/leagues' },
    stats: d => [{ label: 'Leagues', value: d.leagues?.length ?? 0 }, { label: 'Wanted', value: d.wanted?.totalRecords ?? 0 }, { label: 'Queued', value: d.queue?.length ?? 0 }],
    sample: { wanted: { totalRecords: 58, records: [] }, queue: [{ id: 1 }, { id: 2 }], leagues: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    expect: { Leagues: 3, Wanted: 58, Queued: 2 },
  }),
  service({
    type: 'mylar', name: 'Mylar3', icon: 'download', auth: { query: 'apikey' },
    get: { index: '/api?cmd=getIndex', wanted: '/api?cmd=getWanted' },
    stats: d => [{ label: 'Series', value: d.index?.data?.length ?? 0 }, { label: 'Issues', value: sum(...(d.index?.data ?? []).map((s: any) => s?.totalIssues)) },
      { label: 'Wanted', value: d.wanted?.issues?.length ?? 0 }],
    sample: { index: { success: true, data: [{ ComicName: 'A Comic', totalIssues: 120 }, { ComicName: 'Another', totalIssues: 48 }] }, wanted: { issues: [{ IssueID: '1' }, { IssueID: '2' }] } },
    expect: { Series: 2, Issues: 168, Wanted: 2 },
  }),
  service<{ key: string }>({
    type: 'medusa', name: 'Medusa', icon: 'download', options: { key: z.string() },
    // the key goes in the path
    get: o => ({ stats: `/api/v1/${o.key}/?cmd=shows.stats`, future: `/api/v1/${o.key}/?cmd=future` }),
    stats: d => {
      const f = d.future?.data;
      return [{ label: 'Shows', value: d.stats?.data?.shows_active ?? 0 }, { label: 'Scheduled', value: sum(f?.missed?.length, f?.today?.length, f?.soon?.length, f?.later?.length) },
        { label: 'Snatched', value: d.stats?.data?.ep_snatched ?? 0 }];
    },
    sample: { stats: { data: { shows_active: 74, ep_snatched: 3 } }, future: { data: { missed: [{}], today: [{}, {}], soon: [{}], later: [{}, {}, {}] } } },
    sampleOptions: { key: 'k' },
    expect: { Shows: 74, Scheduled: 7, Snatched: 3 },
  }),
  service({
    type: 'bazarr', name: 'Bazarr', icon: 'text', auth: { header: 'X-API-KEY' },
    get: { episodes: '/api/episodes/wanted?start=0&length=1', movies: '/api/movies/wanted?start=0&length=1' },
    stats: d => [{ label: 'Episodes missing subs', value: d.episodes?.total ?? 0 }, { label: 'Movies missing subs', value: d.movies?.total ?? 0 }],
    sample: { episodes: { data: [], total: 41 }, movies: { data: [], total: 9 } },
    expect: { 'Episodes missing subs': 41, 'Movies missing subs': 9 },
  }),
  service({
    type: 'tube-archivist', name: 'Tube Archivist', icon: 'play', auth: 'token',
    get: { videos: '/api/stats/video', channels: '/api/stats/channel', playlists: '/api/stats/playlist', downloads: '/api/stats/download' },
    stats: d => [{ label: 'Videos', value: d.videos?.doc_count ?? 0 }, { label: 'Channels', value: d.channels?.doc_count ?? 0 },
      { label: 'Playlists', value: d.playlists?.doc_count ?? 0 }, { label: 'Pending', value: d.downloads?.pending ?? 0 }],
    sample: { videos: { doc_count: 2460 }, channels: { doc_count: 38 }, playlists: { doc_count: 12 }, downloads: { pending: 17 } },
    expect: { Videos: '2,460', Pending: 17 },
  }),
  service<{ key: string }>({
    type: 'ombi', name: 'Ombi', icon: 'film', options: { key: z.string() },
    // ApiKey is Ombi's own name for it; some setups go by X-Api-Key
    get: o => ({ count: { path: '/api/v1/Request/count', headers: { ApiKey: o.key, 'X-Api-Key': o.key } } }),
    stats: d => [{ label: 'Pending', value: d.count?.pending ?? 0 }, { label: 'Approved', value: d.count?.approved ?? 0 }, { label: 'Available', value: d.count?.available ?? 0 }],
    sample: { count: { pending: 5, approved: 2, available: 318 } },
    sampleOptions: { key: 'k' },
    expect: { Pending: 5, Available: 318 },
  }),
  service({
    type: 'maintainerr', name: 'Maintainerr', icon: 'disk',
    get: { metrics: '/api/storage-metrics' },
    stats: d => [{ label: 'Reclaimable', value: fmt.bytes(d.metrics?.collectionSummary?.activeSizeBytes ?? 0) }, { label: 'Items handled', value: d.metrics?.cleanupTotals?.itemsHandled ?? 0 },
      { label: 'Movies handled', value: d.metrics?.cleanupTotals?.moviesHandled ?? 0 }, { label: 'Shows handled', value: d.metrics?.cleanupTotals?.showsHandled ?? 0 }],
    sample: { metrics: { collectionSummary: { activeSizeBytes: 536870912000 }, cleanupTotals: { itemsHandled: 340, moviesHandled: 120, showsHandled: 18 } } },
    expect: { Reclaimable: '500.0 GB', 'Items handled': 340 },
  }),

  // Live TV
  service({
    type: 'channels-dvr', name: 'Channels DVR', icon: 'film',
    get: { dvr: '/dvr' },
    stats: d => [{ label: 'Shows', value: d.dvr?.stats?.groups ?? 0 }, { label: 'Recordings', value: d.dvr?.stats?.files ?? 0 },
      { label: 'Scheduled', value: d.dvr?.stats?.jobs ?? 0 }, { label: 'Passes', value: d.dvr?.stats?.rules ?? 0 }],
    sample: { dvr: { stats: { groups: 44, files: 1032, jobs: 16, rules: 9 } } },
    expect: { Recordings: '1,032', Passes: 9 },
  }),
  service({
    type: 'dispatcharr', name: 'Dispatcharr', icon: 'film', auth: { login: '/api/accounts/token/', token: r => r.access },
    get: { channels: '/api/channels/channels/', streams: '/proxy/ts/status' },
    stats: d => [{ label: 'Channels', value: d.channels?.length ?? 0 }, { label: 'Streams', value: d.streams?.count ?? 0 }],
    sample: { channels: [{ id: 1, name: 'News' }, { id: 2, name: 'Sport' }, { id: 3, name: 'Films' }], streams: { count: 1, channels: [{ channel_name: 'News', clients: [{}], avg_bitrate: '4.2 Mbps' }] } },
    expect: { Channels: 3, Streams: 1 },
  }),
  service({
    type: 'hdhomerun', name: 'HDHomeRun', icon: 'wifi',
    get: { lineup: '/lineup.json', status: { path: '/status.json', optional: true } },
    stats: d => [{ label: 'Channels', value: d.lineup?.length ?? 0 }, { label: 'HD channels', value: (d.lineup ?? []).filter((c: any) => c?.HD === 1).length },
      { label: 'Tuners in use', value: d.status && `${d.status.filter((t: any) => t?.VctNumber != null).length} / ${d.status.length}` }],
    sample: { lineup: [{ GuideNumber: '2.1', GuideName: 'WABC', HD: 1 }, { GuideNumber: '2.2', GuideName: 'Sub' }], status: [{ Resource: 'tuner0', VctNumber: '2.1', VctName: 'WABC' }, { Resource: 'tuner1' }] },
    expect: { Channels: 2, 'HD channels': 1, 'Tuners in use': '1 / 2' },
  }),
  service({
    type: 'xteve', name: 'xTeVe', icon: 'film',
    about: "Stream counts from xTeVe's status call. Works with its API authentication off.",
    get: { status: { path: '/api/', method: 'POST', body: { cmd: 'status' } } },
    stats: d => [{ label: 'Active streams', value: d.status?.['streams.active'] ?? 0 }, { label: 'Streams', value: d.status?.['streams.all'] ?? 0 }, { label: 'In the guide', value: d.status?.['streams.xepg'] ?? 0 }],
    sample: { status: { 'streams.active': 1, 'streams.all': 840, 'streams.xepg': 212, status: true } },
    expect: { 'Active streams': 1, Streams: 840, 'In the guide': 212 },
  }),

  // Transcoding
  service<{ key?: string }>({
    type: 'tdarr', name: 'Tdarr', icon: 'cpu', options: key,
    get: o => ({ stats: { path: '/api/v2/cruddb', method: 'POST', headers: header('x-api-key', o.key),
      body: { data: { collection: 'StatisticsJSONDB', mode: 'getById', docID: 'statistics' } } } }),
    stats: d => [{ label: 'Queued', value: tdarrCount(d.stats, 1) + tdarrCount(d.stats, 4) }, { label: 'Processed', value: tdarrCount(d.stats, 2) + tdarrCount(d.stats, 5) },
      { label: 'Errored', value: tdarrCount(d.stats, 3) + tdarrCount(d.stats, 6) }, { label: 'Saved', value: fmt.bytes((Number.parseFloat(d.stats?.sizeDiff) || 0) * 1e9) }],
    sample: { stats: { table1Count: 12, table1ViewableCount: 10, table2Count: 400, table3Count: 3, table4Count: 2, table5Count: 600, table6Count: 1, sizeDiff: '512.5' } },
    expect: { Queued: 12, Processed: '1,000', Errored: 4, Saved: '477.3 GB' },
  }),
  service({
    type: 'unmanic', name: 'Unmanic', icon: 'cpu',
    get: { workers: '/unmanic/api/v2/workers/status', pending: { path: '/unmanic/api/v2/pending/tasks', method: 'POST', body: {} } },
    stats: d => {
      const workers = d.workers?.workers_status ?? [];
      return [{ label: 'Queued', value: d.pending?.recordsTotal ?? 0 }, { label: 'Active workers', value: workers.filter((w: any) => !w?.idle).length }, { label: 'Workers', value: workers.length }];
    },
    sample: { workers: { workers_status: [{ id: 'W0', idle: false }, { id: 'W1', idle: true }] }, pending: { recordsTotal: 86, results: [] } },
    expect: { Queued: 86, 'Active workers': 1, Workers: 2 },
  }),
  service<{ key?: string; version?: 1 | 2 }>({
    type: 'fileflows', name: 'FileFlows', icon: 'cpu',
    // version 2 is the webhook API, which also reports failures
    options: { ...key, version: z.union([z.literal(1), z.literal(2)]).optional() },
    get: o => ({ status: { path: o.version === 2 ? '/webhook/fenrus' : '/api/status', headers: header('X-Webhook-Token', o.key) } }),
    stats: d => {
      const s = d.status;
      return [{ label: 'Queued', value: s?.Unprocessed ?? s?.queue ?? 0 }, { label: 'Processing', value: s?.Processing ?? s?.processing ?? 0 },
        { label: 'Processed', value: s?.Processed ?? s?.processed ?? 0 }, ...(s?.Failed === undefined ? [] : [{ label: 'Failed', value: s.Failed }])];
    },
    sample: { status: { Unprocessed: 24, Processing: 1, Processed: 1980, Failed: 6 } },
    sampleOptions: { version: 2 },
    expect: { Queued: 24, Processed: '1,980', Failed: 6 },
  }),
];
