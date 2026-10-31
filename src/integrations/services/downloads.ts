// What fetches things: torrent and usenet clients, indexers, and the containers around them. See media.ts for the shape of an entry.
import { z } from 'zod';
import { fmt, service } from '../../server/service.ts';

const add = (rows: any[] | undefined, field: string) => (rows ?? []).reduce((n, r) => n + (r?.[field] ?? 0), 0);
const transfers = (down: number, up: number, leeching: number, seeding: number) => [
  { label: 'Download', value: fmt.rate(down) }, { label: 'Upload', value: fmt.rate(up) },
  { label: 'Downloading', value: leeching }, { label: 'Seeding', value: seeding }];
const secret = (o: { key?: string }) => o.key ? { 'X-API-Key': o.key } : undefined;
// slskd groups transfers by user, then directory; a finished file's state starts "Completed"
const unfinished = (users: any[] | undefined) => (users ?? []).flatMap(u => u?.directories ?? []).flatMap(d => d?.files ?? [])
  .filter(f => !String(f?.state).includes('Completed')).length;
// Prometheus text: one "name value" a line
const metric = (text: unknown, name: string) => Number(String(text).match(new RegExp(`^${name} (\\S+)`, 'm'))?.[1] ?? 0);

export default [
  // torrents
  service({
    type: 'flood', name: 'Flood', icon: 'download', auth: { login: '/api/auth/authenticate' },
    get: { all: '/api/torrents' },
    stats: d => {
      const list: any[] = Object.values(d.all?.torrents ?? {}), has = (s: string) => list.filter(t => t?.status?.includes(s)).length;
      return transfers(add(list, 'downRate'), add(list, 'upRate'), has('downloading'), has('seeding'));
    },
    sample: { all: { id: 1730371200, torrents: {
      A1B2: { name: 'one', status: ['downloading', 'active'], downRate: 2097152, upRate: 1024 },
      C3D4: { name: 'two', status: ['seeding', 'complete', 'active'], downRate: 0, upRate: 524288 },
      E5F6: { name: 'three', status: ['seeding', 'complete', 'inactive'], downRate: 0, upRate: 0 } } } },
    expect: { Download: '2.0 MB/s', Downloading: 1, Seeding: 2 },
  }),
  service<{ instance?: string | number; key?: string }>({
    type: 'qui', name: 'qui', icon: 'download', auth: { header: 'X-API-Key' },
    options: { instance: z.union([z.string(), z.number()]).optional() },      // one qBittorrent; all of them otherwise
    get: o => ({ all: o.instance == null ? '/api/torrents/cross-instance?limit=1' : `/api/instances/${o.instance}/torrents?limit=1` }),
    stats: d => {
      const s = d.all?.stats ?? {};
      return [...transfers(s.totalDownloadSpeed ?? 0, s.totalUploadSpeed ?? 0, s.downloading ?? 0, s.seeding ?? 0),
        { label: 'Errored', value: d.all?.counts?.status?.errored ?? s.error ?? 0 }];
    },
    sample: { all: { torrents: [], total: 214, stats: { total: 214, downloading: 3, seeding: 41, error: 1, totalDownloadSpeed: 5242880, totalUploadSpeed: 1048576 },
      counts: { status: { all: 214, completed: 205, errored: 2 } } } },
    expect: { Download: '5.0 MB/s', Seeding: 41, Errored: 2 },
  }),

  // usenet and direct downloads
  service({
    type: 'sabnzbd', name: 'SABnzbd', icon: 'download', auth: { query: 'apikey' },
    get: { queue: '/api?mode=queue&output=json' },
    stats: d => {
      const q = d.queue?.queue ?? {};
      return [{ label: 'Speed', value: q.paused ? 'Paused' : fmt.rate(Number(q.kbpersec ?? 0) * 1024) }, { label: 'Queue', value: q.noofslots ?? 0 },
        { label: 'Left', value: q.sizeleft ?? '0 B' }, { label: 'Time left', value: q.timeleft ?? '0:00:00' }];
    },
    sample: { queue: { queue: { paused: false, status: 'Downloading', kbpersec: '3072.00', noofslots: 4, sizeleft: '6.2 GB', timeleft: '0:35:12', slots: [] } } },
    expect: { Speed: '3.0 MB/s', Queue: 4, Left: '6.2 GB', 'Time left': '0:35:12' },
  }),
  service({
    type: 'nzbget', name: 'NZBGet', icon: 'download', auth: 'basic',
    get: { status: { path: '/jsonrpc', method: 'POST', body: { method: 'status', params: [], id: 1 } } },
    stats: d => {
      const s = d.status?.result ?? {}, mb = (n?: number) => fmt.bytes((n ?? 0) * 1024 ** 2);
      return [{ label: 'Speed', value: s.DownloadPaused ? 'Paused' : fmt.rate(s.DownloadRate ?? 0) }, { label: 'Left', value: mb(s.RemainingSizeMB) },
        { label: 'Downloaded', value: mb(s.DownloadedSizeMB) }, { label: 'Post-processing', value: s.PostJobCount ?? 0 }];
    },
    sample: { status: { version: '1.1', result: { DownloadRate: 3145728, RemainingSizeMB: 2048, DownloadedSizeMB: 512000, DownloadPaused: false, PostJobCount: 1 } } },
    expect: { Speed: '3.0 MB/s', Left: '2.0 GB', 'Post-processing': 1 },
  }),
  service({
    type: 'pyload', name: 'pyLoad', icon: 'download', auth: { header: 'X-API-Key' },      // pyload-ng, with a key from its settings
    get: { status: '/api/status_server' },
    stats: d => [{ label: 'Speed', value: d.status?.pause ? 'Paused' : fmt.rate(d.status?.speed ?? 0) }, { label: 'Active', value: d.status?.active ?? 0 },
      { label: 'Queue', value: d.status?.queue ?? 0 }, { label: 'Total', value: d.status?.total ?? 0 }],
    sample: { status: { pause: false, active: 2, queue: 5, total: 18, speed: 1048576, download: true, reconnect: false, captcha: false, proxy: false } },
    expect: { Speed: '1.0 MB/s', Active: 2, Queue: 5, Total: 18 },
  }),
  service({
    type: 'slskd', name: 'slskd', icon: 'download', auth: { header: 'X-API-Key' },
    get: { app: '/api/v0/application', down: '/api/v0/transfers/downloads', up: '/api/v0/transfers/uploads' },
    stats: d => {
      const on = !!d.app?.server?.isConnected;
      return [{ label: 'Soulseek', value: on ? 'Connected' : 'Disconnected', tone: on ? 'good' : 'bad' }, { label: 'Downloading', value: unfinished(d.down) },
        { label: 'Uploading', value: unfinished(d.up) }, { label: 'Shared files', value: d.app?.shares?.files ?? 0 }];
    },
    sample: { app: { server: { isConnected: true, isLoggedIn: true }, shares: { directories: 120, files: 18432 }, version: { isUpdateAvailable: false } },
      down: [{ username: 'a', directories: [{ directory: 'x', fileCount: 3, files: [{ state: 'InProgress' }, { state: 'Queued, Remotely' }, { state: 'Completed, Succeeded' }] }] }],
      up: [{ username: 'b', directories: [{ directory: 'y', fileCount: 1, files: [{ state: 'Completed, Errored' }] }] }] },
    expect: { Soulseek: 'Connected', Downloading: 2, Uploading: 0, 'Shared files': '18,432' },
  }),

  // indexers and release hunting
  service({
    type: 'prowlarr', name: 'Prowlarr', icon: 'chart', auth: { header: 'X-Api-Key' },      // totals from its history; `indexers` says which are failing now
    get: { stats: '/api/v1/indexerstats' },
    stats: d => {
      const list = d.stats?.indexers;
      return [{ label: 'Grabs', value: add(list, 'numberOfGrabs') }, { label: 'Queries', value: add(list, 'numberOfQueries') },
        { label: 'Failed grabs', value: add(list, 'numberOfFailedGrabs') }, { label: 'Failed queries', value: add(list, 'numberOfFailedQueries') }];
    },
    sample: { stats: { indexers: [
      { indexerId: 1, indexerName: 'One', numberOfQueries: 1200, numberOfGrabs: 40, numberOfFailedQueries: 12, numberOfFailedGrabs: 1 },
      { indexerId: 2, indexerName: 'Two', numberOfQueries: 800, numberOfGrabs: 10, numberOfFailedQueries: 3, numberOfFailedGrabs: 0 }], userAgents: [], hosts: [] } },
    expect: { Grabs: 50, Queries: '2,000', 'Failed grabs': 1, 'Failed queries': 15 },
  }),
  service({
    // Needs no credentials, so only without an admin password: its sign-in answers with a redirect that service() can't read
    type: 'jackett', name: 'Jackett', icon: 'chart',
    get: { indexers: '/api/v2.0/indexers?configured=true' },
    stats: d => [{ label: 'Indexers', value: d.indexers?.length ?? 0 }, { label: 'Errored', value: (d.indexers ?? []).filter((i: any) => i?.last_error).length }],
    sample: { indexers: [{ id: 'one', name: 'One', configured: true, last_error: '' }, { id: 'two', name: 'Two', configured: true, last_error: 'Request timed out' }, { id: 'three', name: 'Three', configured: true }] },
    expect: { Indexers: 3, Errored: 1 },
  }),
  service({
    type: 'autobrr', name: 'autobrr', icon: 'rss', auth: { header: 'X-API-Token' },
    get: { stats: '/api/release/stats', filters: '/api/filters', indexers: '/api/release/indexers' },
    stats: d => [{ label: 'Approved', value: d.stats?.push_approved_count ?? 0 }, { label: 'Rejected', value: d.stats?.push_rejected_count ?? 0 },
      { label: 'Filters', value: d.filters?.length ?? 0 }, { label: 'Indexers', value: d.indexers?.length ?? 0 }],
    sample: { stats: { total_count: 9000, filtered_count: 300, filter_rejected_count: 8700, push_approved_count: 288, push_rejected_count: 12 },
      filters: [{ id: 1, name: 'Movies' }, { id: 2, name: 'Series' }], indexers: ['one', 'two', 'three'] },
    expect: { Approved: 288, Rejected: 12, Filters: 2, Indexers: 3 },
  }),

  // the containers around them
  service<{ key?: string }>({
    type: 'gluetun', name: 'Gluetun', icon: 'shield',
    options: { key: z.string().optional() },      // the control server's API key; older versions have none
    get: o => ({ ip: { path: '/v1/publicip/ip', headers: secret(o) },
      forward: { path: '/v1/portforward', headers: secret(o), optional: true }, oldForward: { path: '/v1/openvpn/portforwarded', headers: secret(o), optional: true } }),
    stats: d => {
      const port = d.forward?.port || d.oldForward?.port;
      return [{ label: 'Public IP', value: d.ip?.public_ip || undefined }, { label: 'Country', value: d.ip?.country || undefined }, { label: 'Region', value: d.ip?.region || undefined },
        ...(port ? [{ label: 'Forwarded port', value: String(port) }] : [])];
    },
    sample: { ip: { public_ip: '203.0.113.7', region: 'Ontario', country: 'Canada', city: 'Toronto' }, forward: { port: 51413 }, oldForward: { port: 0 } },
    expect: { 'Public IP': '203.0.113.7', Country: 'Canada', 'Forwarded port': '51413' },
  }),
  service({
    type: 'watchtower', name: 'Watchtower', icon: 'shield', auth: 'bearer',
    get: { metrics: { path: '/v1/metrics', as: 'text' } },
    stats: d => [{ label: 'Scanned', value: metric(d.metrics, 'watchtower_containers_scanned') }, { label: 'Updated', value: metric(d.metrics, 'watchtower_containers_updated') },
      { label: 'Failed', value: metric(d.metrics, 'watchtower_containers_failed') }],
    about: 'What Watchtower found in its last scan: containers scanned, updated and failed.',
    sample: { metrics: '# HELP watchtower_containers_scanned Number of containers scanned for changes by watchtower during the last scan\n# TYPE watchtower_containers_scanned gauge\nwatchtower_containers_scanned 24\nwatchtower_containers_updated 2\nwatchtower_containers_failed 1\nwatchtower_scans_total 310\n' },
    expect: { Scanned: 24, Updated: 2, Failed: 1 },
  }),
  service<{ username?: string; password?: string }>({
    type: 'whatsupdocker', name: "What's Up Docker", icon: 'shield', logo: 'whats-up-docker',
    options: { username: z.string().optional(), password: z.string().optional() },      // only if basic auth is on
    get: o => ({ containers: { path: '/api/containers', headers: o.username ? { Authorization: `Basic ${Buffer.from(`${o.username}:${o.password ?? ''}`).toString('base64')}` } : undefined } }),
    stats: d => [{ label: 'Watching', value: d.containers?.length ?? 0 }, { label: 'Updates', value: (d.containers ?? []).filter((c: any) => c?.updateAvailable).length }],
    sample: { containers: [{ id: 'a', name: 'plex', updateAvailable: true }, { id: 'b', name: 'sonarr', updateAvailable: false }, { id: 'c', name: 'radarr' }] },
    expect: { Watching: 3, Updates: 1 },
  }),
  service({
    type: 'transmission', name: 'Transmission', logo: 'transmission', icon: 'download', auth: { handshake: { status: 409, header: 'x-transmission-session-id' } }, authOptional: true,
    options: { username: z.string().optional(), password: z.string().optional(), rpc: z.string().default('/transmission/rpc') },
    get: o => ({ stats: { path: (o as any).rpc ?? '/transmission/rpc', method: 'POST', body: { method: 'session-stats' } } }),
    stats: d => { const a = d.stats?.arguments ?? {}; return [{ label: 'Down', value: fmt.rate(a.downloadSpeed ?? 0) }, { label: 'Up', value: fmt.rate(a.uploadSpeed ?? 0) }, { label: 'Active', value: a.activeTorrentCount ?? 0 }, { label: 'Torrents', value: a.torrentCount ?? 0 }]; },
    sample: { stats: { result: 'success', arguments: { downloadSpeed: 2048000, uploadSpeed: 1024, activeTorrentCount: 3, pausedTorrentCount: 1, torrentCount: 41 } } },
    expect: { Active: 3, Torrents: 41 },
  }),
  service({
    type: 'deluge', name: 'Deluge', icon: 'download',
    auth: { login: '/json', needs: ['password'], body: c => ({ method: 'auth.login', params: [c.password], id: 1 }), expired: a => a?.error?.code === 1 },
    get: { ui: { path: '/json', method: 'POST', body: { method: 'web.update_ui', params: [['state'], {}], id: 2 } } },
    stats: d => { const r = d.ui?.result ?? {}, all = Object.values(r.torrents ?? {}) as any[]; return [{ label: 'Down', value: fmt.rate(r.stats?.download_rate ?? 0) }, { label: 'Up', value: fmt.rate(r.stats?.upload_rate ?? 0) }, { label: 'Downloading', value: all.filter(t => t.state === 'Downloading').length }, { label: 'Torrents', value: all.length }]; },
    sample: { ui: { error: null, result: { stats: { download_rate: 1048576, upload_rate: 2048 }, torrents: { a: { state: 'Downloading' }, b: { state: 'Seeding' } } } } },
    loginSample: { result: true, error: null },
    expect: { Downloading: 1, Torrents: 2 },
  }),
  service({
    type: 'rutorrent', name: 'ruTorrent', icon: 'download', auth: 'basic', authOptional: true,
    get: { list: { path: '/plugins/httprpc/action.php', method: 'POST', body: 'mode=list' } },
    stats: d => { const all = Object.values(d.list?.t ?? {}) as string[][], sum = (i: number) => all.reduce((s, t) => s + (Number(t[i]) || 0), 0); return [{ label: 'Down', value: fmt.rate(sum(12)) }, { label: 'Up', value: fmt.rate(sum(11)) }, { label: 'Active', value: all.filter(t => t[3] === '1').length }, { label: 'Torrents', value: all.length }]; },
    sample: { list: { t: { H1: ['1', '0', '1', '1', 'One', '100', '1', '1', '100', '0', '0', '2048', '1048576'], H2: ['1', '0', '1', '0', 'Two', '100', '1', '1', '100', '0', '0', '0', '0'] } } },
    expect: { Active: 1, Torrents: 2 },
  }),
  service({
    type: 'download-station', name: 'Download Station', logo: 'synology-download-station', icon: 'download',
    about: 'Tasks and speeds from Synology Download Station. Targets DSM 7, and accounts with two-step sign-in can\'t use it.',
    auth: { login: '/webapi/entry.cgi', body: c => new URLSearchParams({ api: 'SYNO.API.Auth', version: '6', method: 'login', account: c.username ?? '', passwd: c.password ?? '', format: 'sid' }), token: r => r?.data?.sid, use: () => ({}), expired: a => a?.success === false && [105, 106, 107, 119].includes(a?.error?.code) },
    get: o => ({ tasks: `/webapi/entry.cgi?api=SYNO.DownloadStation.Task&version=1&method=list&additional=transfer&_sid=${encodeURIComponent(o.session ?? '')}` }),
    stats: d => { const t = (d.tasks?.data?.tasks ?? []) as any[], x = (k: string) => t.reduce((s, a) => s + (a.additional?.transfer?.[k] ?? 0), 0); return [{ label: 'Down', value: fmt.rate(x('speed_download')) }, { label: 'Up', value: fmt.rate(x('speed_upload')) }, { label: 'Downloading', value: t.filter(a => a.status === 'downloading').length }, { label: 'Tasks', value: t.length }]; },
    sample: { tasks: { success: true, data: { tasks: [{ status: 'downloading', size: 100, additional: { transfer: { speed_download: 2048, speed_upload: 10 } } }, { status: 'finished', size: 5, additional: { transfer: {} } }] } } },
    loginSample: { success: true, data: { sid: 'abc' } },
    expect: { Downloading: 1, Tasks: 2 },
  }),
];
