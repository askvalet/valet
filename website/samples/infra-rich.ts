// Proxmox, Speedtest Tracker, Syncthing, Backrest and Healthchecks: the machines, the line and the jobs. Every name and
// number here is made up.
import { DAY, HOUR, MIN, ago, ahead, route, wave } from './helpers.ts';
import type { Fixture } from './types.ts';

const GB = 2 ** 30, TB = 2 ** 40;

// ── Proxmox: two nodes, a handful of guests, three pools
const node = (name: string, cpu: number, mem: number, o: Record<string, unknown> = {}) => ({ id: `node/${name}`, type: 'node', node: name, status: 'online', cpu, maxcpu: 16, mem: mem * GB, maxmem: 64 * GB, uptime: 23 * 86400, ...o });
const guest = (type: 'qemu' | 'lxc', vmid: number, name: string, nodeName: string, status: string, cpu = 0, mem = 0, maxmem = 4, o: Record<string, unknown> = {}) =>
  ({ id: `${type}/${vmid}`, type, vmid, name, node: nodeName, status, cpu, mem: mem * GB, maxmem: maxmem * GB, maxcpu: 4, uptime: status === 'running' ? 6 * 86400 + 3 * 3600 : 0, template: 0, ...o });
const pool = (name: string, nodeName: string, used: number, size: number, plugintype: string, o: Record<string, unknown> = {}) => ({ id: `storage/${nodeName}/${name}`, type: 'storage', storage: name, node: nodeName, status: 'available', disk: used * TB, maxdisk: size * TB, plugintype, shared: 0, ...o });
const LAB = [
  node('pve1', .18, 41), node('pve2', .07, 22),
  guest('qemu', 100, 'home-assistant', 'pve1', 'running', .04, 2.6, 4), guest('qemu', 101, 'media-server', 'pve1', 'running', .22, 11.2, 16), guest('lxc', 200, 'dns', 'pve1', 'running', .01, .3, 1),
  guest('lxc', 201, 'reverse-proxy', 'pve1', 'running', .02, .4, 1), guest('qemu', 102, 'windows', 'pve1', 'stopped', 0, 0, 16), guest('qemu', 9000, 'debian-12-template', 'pve1', 'stopped', 0, 0, 2, { template: 1 }),
  guest('lxc', 202, 'monitoring', 'pve2', 'running', .03, 1.1, 2), guest('qemu', 103, 'dev-box', 'pve2', 'running', .09, 5.8, 8), guest('lxc', 203, 'backups', 'pve2', 'running', .01, .6, 2, { lock: 'backup' }),
  pool('local-zfs', 'pve1', .61, 1.8, 'zfspool'), pool('tank', 'pve1', 9.4, 16, 'zfspool'), pool('local', 'pve2', .12, .9, 'dir'),
  pool('nas', 'pve1', 3.1, 8, 'nfs', { shared: 1 }), pool('nas', 'pve2', 3.1, 8, 'nfs', { shared: 1 }),
];
const pveRoutes = (resources: unknown[]) => route([
  ['/cluster/resources', { data: resources }],
  [/\/status\/current$/, { data: { status: 'running', qmpstatus: 'running', cpu: .04, mem: 2.6 * GB, maxmem: 4 * GB, uptime: 6 * 86400, ha: { managed: 0 } } }],
  [/\/status\/(start|shutdown|reboot)$/, { data: 'UPID:pve1:00001234:0000ABCD:65000000:qmreboot:100:valet@pve!dash:' }],
]);
const pveTrouble = LAB.map(r => r.id === 'node/pve2' ? { id: 'node/pve2', type: 'node', node: 'pve2', status: 'offline' } : r.type !== 'node' && r.node === 'pve2' && r.type !== 'storage' ? { ...r, status: 'unknown', cpu: 0, mem: 0, uptime: 0 } : r.id === 'storage/pve1/tank' ? { ...r, disk: 15.3 * TB } : r);

// ── Speedtest Tracker: a week of hourly tests on a gigabit line, one failed overnight
const result = (i: number, hoursAgo: number, o: Record<string, unknown> = {}) => {
  const down = Math.round(wave(i, 860, 945)), up = Math.round(wave(i + 7, 38, 47)), ping = Math.round(wave(i + 3, 9, 16) * 10) / 10;
  return { id: 1000 + i, service: 'ookla', ping, download: down * 125000, upload: up * 125000, download_bits: down * 1e6, upload_bits: up * 1e6, healthy: true, status: 'completed', scheduled: true,
    data: { isp: 'Example Fibre', server: { id: 4242, name: 'Example City', location: 'Example City' } }, created_at: ago(hoursAgo * HOUR), updated_at: ago(hoursAgo * HOUR - MIN), ...o };
};
const week = (o: { slow?: boolean; failedNow?: boolean } = {}) => Array.from({ length: 168 }, (_, i) => {
  const h = 167 - i;
  if (h === 41) return { ...result(i, h), status: 'failed', download: null, upload: null, ping: null, download_bits: null, upload_bits: null, healthy: null };
  if (o.slow && h < 12) return { ...result(i, h), download: 212 * 125000, download_bits: 212e6, healthy: false };
  if (o.failedNow && h === 0) return { ...result(i, h), status: 'failed', download: null, upload: null, ping: null, download_bits: null, upload_bits: null, healthy: null };
  return result(i, h);
});
const speedRoutes = (list: any[]) => route([
  ['/api/v1/results/latest', () => ({ data: [...list].reverse().find(r => r.status === 'completed'), message: 'ok' })],
  ['/api/v1/results?', () => ({ data: [...list].reverse(), meta: { total: list.length } })],
  ['/api/v1/speedtests/run', () => new Response(JSON.stringify({ data: { id: 2000, status: 'waiting' }, message: 'ok' }), { status: 201 })],
]);

// ── Syncthing: four folders, three other devices
const DEVICES = { self: 'MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD', laptop: 'P56IOI7-MZJNU2Y-IQGDREY-DM2MGTI-MGL3BXN-PQ6W5BM-TBBZ4TJ-XZWICQ2', phone: 'XCTG7HL-QB5ZGWB-TCCNHFA-7NZOQVD-K2QK3Y2-BGSDOPS-FZDB3AN-NB7JKAV', nas: 'LGFPDIT-7SKNNJL-VJZA4FC-7QNCRKA-CE753K7-2BW5QDK-2FOZ7FR-FEP57QJ' };
const FOLDERS = [{ id: 'docs-x7k2p', label: 'Documents', path: '/data/documents' }, { id: 'photo-m3q9', label: 'Camera roll', path: '/data/camera' }, { id: 'notes-a1b2', label: 'Notes', path: '/data/notes' }, { id: 'music-z8y7', label: 'Music', path: '/data/music', paused: true }];
const folderStatus = (o: { syncing?: boolean; failing?: boolean } = {}): Record<string, unknown> => ({
  'docs-x7k2p': { state: 'idle', globalBytes: 18.4 * GB, inSyncBytes: 18.4 * GB, needBytes: 0, globalFiles: 14_210, pullErrors: 0 },
  'photo-m3q9': o.syncing ? { state: 'syncing', globalBytes: 212 * GB, inSyncBytes: 187 * GB, needBytes: 25 * GB, needFiles: 1_420, globalFiles: 48_900, pullErrors: 0 } : { state: 'idle', globalBytes: 212 * GB, inSyncBytes: 212 * GB, needBytes: 0, globalFiles: 48_900, pullErrors: 0 },
  'notes-a1b2': o.failing ? { state: 'idle', globalBytes: 0.4 * GB, inSyncBytes: 0.4 * GB, needBytes: 0, globalFiles: 2_310, pullErrors: 2 } : { state: 'idle', globalBytes: 0.4 * GB, inSyncBytes: 0.4 * GB, needBytes: 0, globalFiles: 2_310, pullErrors: 0 },
});
const syncRoutes = (o: { syncing?: boolean; failing?: boolean; phoneAway?: boolean } = {}) => (url: string) => {
  const u = new URL(url), status = folderStatus(o);
  if (u.pathname === '/rest/config/folders') return FOLDERS.map(f => ({ paused: false, ...f }));
  if (u.pathname === '/rest/config/devices') return Object.entries(DEVICES).map(([name, deviceID]) => ({ deviceID, name: name === 'self' ? 'server' : name, paused: false }));
  if (u.pathname === '/rest/system/status') return { myID: DEVICES.self };
  if (u.pathname === '/rest/system/connections') return { total: { inBytesTotal: 41.2 * GB, outBytesTotal: 63.8 * GB },
    connections: { [DEVICES.laptop]: { connected: true, address: '10.0.0.14:22000', type: 'tcp-client' }, [DEVICES.phone]: { connected: !o.phoneAway, address: '10.0.0.31:22000', type: 'quic-server' }, [DEVICES.nas]: { connected: true, address: '10.0.0.5:22000', type: 'tcp-server' } } };
  if (u.pathname === '/rest/stats/device') return { [DEVICES.phone]: { lastSeen: ago(26 * HOUR) } };
  if (u.pathname === '/rest/db/status') return status[u.searchParams.get('folder')!];
  if (u.pathname === '/rest/db/completion') return u.searchParams.get('device') === DEVICES.laptop && o.syncing ? { completion: 88.2, needBytes: 25 * GB } : { completion: 100, needBytes: 0 };
  if (u.pathname === '/rest/db/scan') return new Response(null, { status: 200 });
  return undefined;
};

// ── Backrest: four plans, newest run first as Backrest sends them
const runs = (...list: [number, string, number, number?][]) => ({ flowId: list.map((_, i) => String(900 + i)), timestampMs: list.map(r => String(Date.now() - r[0])), durationMs: list.map(r => String((r[3] ?? 6) * MIN)), status: list.map(r => r[1]), bytesAdded: list.map(r => String(r[2])) });
const plan = (id: string, o: Record<string, unknown>) => ({ id, backupsFailed30days: '0', backupsWarningLast30days: '0', backupsSuccessLast30days: '30', bytesScannedLast30days: String(900 * GB), totalSnapshots: '62', ...o });
const plans = (o: { failed?: boolean; running?: boolean } = {}) => [
  plan('home-nightly', { bytesAddedLast30days: String(14 * GB), protectedBytes: String(48.2 * GB), nextBackupTimeMs: String(Date.now() + 15 * HOUR), recentBackups: runs([9 * HOUR, 'STATUS_SUCCESS', 412 * 2 ** 20], [33 * HOUR, 'STATUS_SUCCESS', 380 * 2 ** 20]) }),
  plan('photos', { backupsFailed30days: o.failed ? '1' : '0', bytesAddedLast30days: String(31 * GB), protectedBytes: String(612 * GB), nextBackupTimeMs: String(Date.now() + 20 * HOUR),
    recentBackups: o.failed ? runs([4 * HOUR, 'STATUS_ERROR', 0, 1], [28 * HOUR, 'STATUS_SUCCESS', 2.1 * GB, 22]) : runs([4 * HOUR, 'STATUS_SUCCESS', 2.1 * GB, 22], [28 * HOUR, 'STATUS_SUCCESS', 1.4 * GB, 19]) }),
  plan('vm-configs', { bytesAddedLast30days: String(0.2 * GB), protectedBytes: String(1.3 * GB), nextBackupTimeMs: String(Date.now() + 45 * MIN), recentBackups: o.running ? runs([2 * MIN, 'STATUS_INPROGRESS', 0], [HOUR + 15 * MIN, 'STATUS_SUCCESS', 3 * 2 ** 20, 1]) : runs([HOUR + 15 * MIN, 'STATUS_SUCCESS', 3 * 2 ** 20, 1]) }),
  plan('offsite-weekly', { backupsSuccessLast30days: '4', totalSnapshots: '12', bytesAddedLast30days: String(22 * GB), protectedBytes: String(660 * GB), nextBackupTimeMs: String(Date.now() + 3 * DAY), recentBackups: runs([4 * DAY, 'STATUS_WARNING', 6.2 * GB, 95]) }),
];
const backrestRoutes = (o: { failed?: boolean; running?: boolean } = {}) => route([
  ['/v1.Backrest/GetSummaryDashboard', () => ({ planSummaries: plans(o), repoSummaries: [] })],
  ['/v1.Backrest/Backup', {}],
]);

// ── Healthchecks: the cron jobs of a small lab
const check = (n: number, name: string, slug: string, status: string, lastPing?: number, next?: number, o: Record<string, unknown> = {}) => ({
  name, slug, tags: '', desc: '', grace: 3600, n_pings: 120 + n * 7, status, started: false, last_ping: lastPing == null ? null : ago(lastPing), next_ping: next == null ? null : ahead(next), manual_resume: false, methods: '',
  timeout: 86400, uuid: `0000000${n}-0000-4000-8000-00000000000${n}`, ping_url: `https://hc-ping.example.com/0000000${n}`, ...o });
const CHECKS = [
  check(1, 'Nightly backup', 'nightly-backup', 'up', 9 * HOUR, 15 * HOUR), check(2, 'Certificate renewal', 'cert-renewal', 'up', 2 * DAY, 5 * DAY), check(3, 'Photo import', 'photo-import', 'up', 12 * MIN, 48 * MIN),
  check(4, 'Disk scrub', 'disk-scrub', 'up', 3 * DAY, 4 * DAY), check(5, 'Offsite sync', 'offsite-sync', 'up', 20 * HOUR, 4 * HOUR), check(6, 'Old media cleanup', 'media-cleanup', 'paused', 40 * DAY),
];
const hcRoutes = (list: unknown[]) => route([['/api/v3/checks/', { checks: list }], [/\/(pause|resume)$/, { status: 'paused' }]]);

export const infraRich: Record<string, Fixture> = {
  proxmox: {
    config: { url: 'https://pve1.example:8006', key: 'valet@pve!dash=x', insecure: true },
    http: pveRoutes(LAB),
    states: [
      { widget: 'guests', state: 'trouble', label: 'A node offline', http: pveRoutes(pveTrouble) },
      { widget: 'storage', state: 'full', label: 'A pool filling up', http: pveRoutes(pveTrouble) },
      { widget: 'status', state: 'one', label: 'One VM', config: { vmid: 100 } },
    ],
  },
  'speedtest-tracker': {
    config: { url: 'http://speedtest:8080', key: 'x', days: 7 },
    http: speedRoutes(week()),
    states: [
      { widget: 'speed', state: 'slow', label: 'Slower than the benchmark', http: speedRoutes(week({ slow: true })) },
      { widget: 'speed', state: 'failed', label: 'The latest test failed', http: speedRoutes(week({ failedNow: true })) },
    ],
  },
  syncthing: {
    config: { url: 'http://syncthing:8384', key: 'x' },
    http: syncRoutes(),
    states: [
      { widget: 'sync', state: 'syncing', label: 'Catching up', http: syncRoutes({ syncing: true }) },
      { widget: 'sync', state: 'trouble', label: 'Files failing, a device away', http: syncRoutes({ failing: true, phoneAway: true }) },
    ],
  },
  backrest: {
    config: { url: 'http://backrest:9898', username: 'valet', password: 'x' },
    http: backrestRoutes(),
    states: [
      { widget: 'plans', state: 'failed', label: 'A backup failed', http: backrestRoutes({ failed: true }) },
      { widget: 'plans', state: 'running', label: 'Backing up now', http: backrestRoutes({ running: true }) },
    ],
  },
  healthchecks: {
    config: { url: 'https://healthchecks.example.com', key: 'x' },
    http: hcRoutes(CHECKS),
    states: [
      { widget: 'checks', state: 'trouble', label: 'One down, one late', http: hcRoutes(CHECKS.map(c => c.slug === 'offsite-sync' ? { ...c, status: 'down', last_ping: ago(3 * DAY), next_ping: null } : c.slug === 'photo-import' ? { ...c, status: 'grace', last_ping: ago(70 * MIN), next_ping: null } : c)) },
    ],
  },
};
