// Proxmox, Speedtest Tracker, Syncthing, Backrest and Healthchecks against made-up answers: every card validates, trouble
// comes first, and the tools that change something resolve one real thing or refuse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { session, type Context, type Instance } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { registry } from '../src/integrations/index.ts';
import proxmox from '../src/integrations/proxmox.ts';
import speedtest from '../src/integrations/speedtesttracker.ts';
import syncthing from '../src/integrations/syncthing.ts';
import backrest from '../src/integrations/backrest.ts';
import healthchecks from '../src/integrations/healthchecks.ts';

type Handler = (url: string, init: any) => unknown;
function fake(handler: Handler) {
  const calls: string[] = [];
  const ctx = {
    id: 't', calls, log() {}, image: (r: string) => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }), session,
    async http(url: string, init: any = {}) {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      const out = await handler(url, init);
      if (out === undefined) throw new Error(`no answer for ${url}`);
      if (init.as === 'response') return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
      return out;
    },
  };
  return ctx as unknown as Context & { calls: string[] };
}
const make = (i: { config: any; create(c: any, ctx: Context): Instance }, cfg: unknown, ctx: Context) => i.create(i.config.parse(cfg), ctx);
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
async function everyWidget(inst: Instance) {
  const out: Record<string, any> = {};
  for (const [k, w] of Object.entries(inst.widgets)) { out[k] = await w.fetch(); valid(out[k]); assert.ok(out[k].summary, `${k} has a summary`); }
  return out;
}
const H = 36e5, now = Date.now(), iso = (ms: number) => new Date(now - ms).toISOString();

test('the five are full integrations now, under their old types', () => {
  for (const t of ['proxmox', 'speedtest-tracker', 'syncthing', 'backrest', 'healthchecks']) assert.ok(!('def' in registry[t]), `${t} is no longer a service()`);
});

// ── Proxmox
const RESOURCES = [
  { id: 'node/alpha', type: 'node', node: 'alpha', status: 'online', cpu: 0.25, maxcpu: 16, mem: 32 * 2 ** 30, maxmem: 64 * 2 ** 30, uptime: 1209600 },
  { id: 'node/beta', type: 'node', node: 'beta', status: 'offline' },
  { id: 'qemu/100', type: 'qemu', vmid: 100, name: 'homeassist', node: 'alpha', status: 'running', cpu: 0.04, mem: 2 * 2 ** 30, maxmem: 4 * 2 ** 30, uptime: 86400, template: 0 },
  { id: 'qemu/101', type: 'qemu', vmid: 101, name: 'desktop', node: 'alpha', status: 'stopped', maxmem: 8 * 2 ** 30, template: 0 },
  { id: 'qemu/102', type: 'qemu', vmid: 102, name: 'media', node: 'alpha', status: 'paused', maxmem: 8 * 2 ** 30, template: 0 },
  { id: 'qemu/103', type: 'qemu', vmid: 103, name: 'media-test', node: 'alpha', status: 'running', cpu: 0.01, mem: 2 ** 30, maxmem: 2 * 2 ** 30, uptime: 600, template: 0 },
  { id: 'qemu/9000', type: 'qemu', vmid: 9000, name: 'debian-template', node: 'alpha', status: 'stopped', template: 1 },
  { id: 'lxc/200', type: 'lxc', vmid: 200, name: 'dns', node: 'alpha', status: 'running', cpu: 0.01, mem: 256 * 2 ** 20, maxmem: 512 * 2 ** 20, uptime: 86400, template: 0 },
  { id: 'lxc/201', type: 'lxc', vmid: 201, name: 'proxy', node: 'beta', status: 'unknown', template: 0 },
  { id: 'storage/alpha/local', type: 'storage', node: 'alpha', storage: 'local', status: 'available', disk: 20e9, maxdisk: 100e9, plugintype: 'dir', shared: 0 },
  { id: 'storage/alpha/tank', type: 'storage', node: 'alpha', storage: 'tank', status: 'available', disk: 9.2e12, maxdisk: 10e12, plugintype: 'zfspool', shared: 0 },
  { id: 'storage/alpha/nas', type: 'storage', node: 'alpha', storage: 'nas', status: 'available', disk: 1e12, maxdisk: 4e12, plugintype: 'nfs', shared: 1 },
  { id: 'storage/beta/nas', type: 'storage', node: 'beta', storage: 'nas', status: 'unknown', disk: 1e12, maxdisk: 4e12, plugintype: 'nfs', shared: 1 },
];
const pve = (posts: string[] = [], resources: unknown[] = RESOURCES) => fake((url, init) => {
  assert.equal(init.headers.Authorization, 'PVEAPIToken=valet@pve!dash=secret');
  if (init.method === 'POST') { posts.push(url); return { data: 'UPID:alpha:0001' }; }
  if (url.endsWith('/cluster/resources')) return { data: resources };
  if (url.endsWith('/status/current')) return { data: { status: 'running', qmpstatus: 'running', cpu: 0.05, mem: 2 ** 31, maxmem: 2 ** 32, uptime: 90000, ha: { managed: 0 } } };
});
const PVE = { url: 'https://pve:8006', key: 'valet@pve!dash=secret', insecure: true };

test('proxmox: the old status card, the guests a node at a time with trouble first, and storage by fill', async () => {
  const p = make(proxmox, PVE, pve()), w = await everyWidget(p);
  const stat = Object.fromEntries(w.status.items.map((i: any) => [i.label, i.value]));
  assert.deepEqual(stat, { VMs: '2 / 4', Containers: '1 / 2', CPU: '25%', Memory: '50%', Nodes: '1 / 2' });
  const rows = w.guests.items;
  assert.equal(rows[0].title, 'beta'); assert.equal(rows[0].dot, 'bad');                 // the offline node leads
  assert.equal(rows[1].title, 'proxy'); assert.match(rows[1].subtitle, /node offline/);
  const alpha = rows.filter((r: any) => r.section === 'alpha').map((r: any) => r.title);
  assert.deepEqual(alpha, ['alpha', 'media', 'homeassist', 'media-test', 'dns', 'desktop']);   // paused first, stopped last, no template
  assert.match(w.guests.summary.value, /1 node offline/); assert.equal(w.guests.summary.tone, 'bad');
  assert.deepEqual(w.storage.items.map((i: any) => i.title), ['tank', 'nas', 'local']);       // one shared pool, fullest first
  assert.equal(w.storage.items[0].tone, 'warn'); assert.equal(w.storage.summary.value, '92%');
});

test('proxmox: a single VM, as the old vmid option showed it', async () => {
  const s = await make(proxmox, { ...PVE, vmid: 100 }, pve()).widgets.status.fetch() as any;
  assert.equal(s.items[0].value, 'running'); assert.equal(s.items[0].sub, 'homeassist');
});

test('proxmox: power names the guest it found, refuses one that could be two, and posts only once approved', async () => {
  const posts: string[] = [], p = make(proxmox, PVE, pve(posts)), power = p.tools!.guest_power;
  assert.equal(power.access, 'control');
  const c = await power.confirm!({ guest: '100', action: 'shutdown' });
  assert.equal(c.title, 'Shut down homeassist?'); assert.match(c.detail!, /VM 100 on alpha, running/); assert.equal(c.danger, true);
  assert.match((await power.confirm!({ guest: 'medi', action: 'reboot' })).title, /Can't reboot/);
  assert.deepEqual(posts, []);
  await assert.rejects(power.run({ guest: 'medi', action: 'reboot' }), /could be media \(VM 102 on alpha\), media-test/);
  await assert.rejects(power.run({ guest: 'nothing', action: 'start' }), /no guest like/);
  await assert.rejects(power.run({ guest: 'debian-template', action: 'start' }), /no guest like/);   // templates don't run
  assert.match(JSON.stringify((await power.run({ guest: 'desktop', action: 'shutdown' })).data), /already stopped/);
  await power.run({ guest: 'media', action: 'reboot' });                                          // the exact name wins over media-test
  await power.run({ guest: 'VM 200', action: 'reboot' });
  assert.deepEqual(posts, ['https://pve:8006/api2/json/nodes/alpha/qemu/102/status/reboot', 'https://pve:8006/api2/json/nodes/alpha/lxc/200/status/reboot']);
  assert.ok(power.input.safeParse({ guest: 'x', action: 'stop' }).success === false, 'only start, shutdown and reboot');
});

test('proxmox: an id from the service that would bend the path is refused', async () => {
  const bad = [{ id: 'qemu/1', type: 'qemu', vmid: 1, name: 'odd', node: '../../access', status: 'stopped', template: 0 }];
  const posts: string[] = [], p = make(proxmox, PVE, pve(posts, bad));
  await assert.rejects(p.tools!.guest_power.run({ guest: 'odd', action: 'start' }), /won't put in an address/);
  await assert.rejects(p.tools!.guest_status.run({ guest: 'odd' }), /won't put in an address/);
  assert.deepEqual(posts, []);
});

test('proxmox: guest status reads the guest right now', async () => {
  const r = await make(proxmox, PVE, pve()).tools!.guest_status.run({ guest: 'homeassist' });
  valid(r.card); assert.equal((r.data as any).status, 'running'); assert.ok((r.card as any).rows.some((x: string[]) => x[0] === 'Uptime' && x[1] === '1d'));
});

// ── Speedtest Tracker
const result = (id: number, hoursAgo: number, down: number, up: number, ping: number, status = 'completed', healthy: boolean | null = true) =>
  ({ id, ping, download: down * 1e6 / 8, upload: up * 1e6 / 8, status, healthy, scheduled: true, data: { isp: 'Example ISP', server: { name: 'Example City' } }, created_at: iso(hoursAgo * H) });
const RESULTS = [result(3, 1, 912, 95, 11), result(2, 13, 0, 0, 0, 'failed', null), result(1, 25, 880, 94, 14)].map(r => r.status === 'failed' ? { ...r, download: null, upload: null, ping: null } : r);
const st = (runs: string[] = [], latest: unknown = { data: RESULTS[0] }) => fake((url, init) => {
  assert.equal(init.headers.Authorization, 'Bearer tok');
  if (init.method === 'POST') { runs.push(url); return new Response(JSON.stringify({ data: { id: 4, status: 'waiting' }, message: 'ok' }), { status: 201 }); }
  if (url.includes('/results/latest')) return latest;
  if (url.includes('/api/v1/results?')) return { data: RESULTS, meta: { total: 3 } };
});

test('speedtest-tracker: the latest result, then download and upload over the days with ping and failures beside', async () => {
  const s = st(), w = await everyWidget(make(speedtest, { url: 'http://speed', key: 'tok' }, s));
  assert.deepEqual(w.status.items.map((i: any) => i.value), ['912 Mbps', '95 Mbps', '11 ms']);
  assert.equal(w.speed.type, 'chart'); assert.deepEqual(w.speed.series[0].points, [880, 912]);   // oldest first, failed run left out
  assert.equal(w.speed.headline, '912 Mbps'); assert.ok(w.speed.facts.some((f: any) => f.label === 'Failed' && f.value === '1'));
  assert.match(s.calls.find(c => c.includes('/results?'))!, /filter%5Bstart_at%5D=\d{4}-\d\d-\d\d.*sort=-created_at/);
});

test('speedtest-tracker: latest as the docs show it (bare) reads the same, and none at all is said plainly', async () => {
  const bare = await make(speedtest, { url: 'http://speed', key: 'tok' }, st([], RESULTS[0])).widgets.status.fetch() as any;
  assert.equal(bare.items[0].value, '912 Mbps');
  const none = await make(speedtest, { url: 'http://speed', key: 'tok' }, st([], new Response('{"message":"No result found"}', { status: 404 }))).widgets.status.fetch() as any;
  valid(none); assert.equal(none.items[0].value, '–');
});

test('speedtest-tracker: running a test is write, asks first, and posts once', async () => {
  const runs: string[] = [], t = make(speedtest, { url: 'http://speed', key: 'tok' }, st(runs)).tools!;
  assert.equal(t.speedtest_run.access, 'write'); assert.match((await t.speedtest_run.confirm!({})).title, /Run a speed test/);
  assert.deepEqual(runs, []);
  await t.speedtest_run.run({});
  assert.deepEqual(runs, ['http://speed/api/v1/speedtests/run']);
  const h = await t.speed_history.run({ days: 3 });
  valid(h.card); assert.equal((h.data as any).failed, 1); assert.equal((h.data as any).latest.download, '912 Mbps');
});

// ── Syncthing
const DEV = { me: 'AAAAAAA-AAAAAAA', laptop: 'BBBBBBB-BBBBBBB', phone: 'CCCCCCC-CCCCCCC', nas: 'DDDDDDD-DDDDDDD' };
const sync = (scans: string[] = []) => fake((url, init) => {
  assert.equal(init.headers['X-API-Key'], 'k');
  const u = new URL(url), folder = u.searchParams.get('folder');
  if (init.method === 'POST') { scans.push(`${u.pathname}?${u.searchParams}`); return new Response(null, { status: 200 }); }
  if (u.pathname === '/rest/config/folders') return [{ id: 'docs-1', label: 'Documents', path: '/data/docs', paused: false }, { id: 'pics-2', label: 'Photos', path: '/data/pics', paused: false },
    { id: 'pics-old', label: 'Photos archive', path: '/data/old', paused: true }, { id: 'music', label: 'Music', path: '/data/music', paused: false }];
  if (u.pathname === '/rest/config/devices') return Object.entries(DEV).map(([name, deviceID]) => ({ deviceID, name, paused: false }));
  if (u.pathname === '/rest/system/status') return { myID: DEV.me };
  if (u.pathname === '/rest/system/connections') return { total: { inBytesTotal: 2 ** 30, outBytesTotal: 2 ** 29 }, connections: { [DEV.laptop]: { connected: true, address: '10.0.0.4:22000' }, [DEV.phone]: { connected: false }, [DEV.nas]: { connected: true } } };
  if (u.pathname === '/rest/stats/device') return { [DEV.phone]: { lastSeen: iso(50 * H) }, [DEV.nas]: { lastSeen: '1970-01-01T00:00:00Z' } };
  if (u.pathname === '/rest/db/status') return {
    'docs-1': { state: 'idle', globalBytes: 1e9, inSyncBytes: 1e9, needBytes: 0, globalFiles: 1200, pullErrors: 0 },
    'pics-2': { state: 'syncing', globalBytes: 4e10, inSyncBytes: 3e10, needBytes: 1e10, needFiles: 800, globalFiles: 9000, pullErrors: 0 },
    music: { state: 'idle', globalBytes: 5e9, inSyncBytes: 5e9, needBytes: 0, globalFiles: 400, pullErrors: 3 },
  }[folder!];
  if (u.pathname === '/rest/db/completion') return u.searchParams.get('device') === DEV.laptop ? { completion: 100, needBytes: 0 } : { completion: 92.5, needBytes: 3e9 };
});

test('syncthing: folders and devices, failing first; the old status card still counts', async () => {
  const s = sync(), w = await everyWidget(make(syncthing, { url: 'http://st:8384', key: 'k' }, s));
  const stat = Object.fromEntries(w.status.items.map((i: any) => [i.label, i.value]));
  assert.deepEqual(stat, { 'Devices online': 2, Folders: 4, Received: '1.0 GB', Sent: '512.0 MB' });
  const folders = w.sync.items.filter((i: any) => i.section === 'Folders');
  assert.deepEqual(folders.map((f: any) => f.title), ['Music', 'Photos', 'Documents', 'Photos archive']);
  assert.match(folders[0].subtitle, /3 files failed/); assert.equal(folders[0].dot, 'bad');
  assert.equal(folders[1].meta, '75%'); assert.equal(folders[3].subtitle, 'Paused');
  const devices = w.sync.items.filter((i: any) => i.section === 'Devices');
  assert.deepEqual(devices.map((d: any) => d.title), ['nas', 'phone', 'laptop']);           // behind and away before up to date; never us
  assert.match(devices[1].subtitle, /last seen 2d 2h ago/); assert.match(devices[0].subtitle, /behind/);
  assert.equal(w.sync.summary.value, '1 failing'); assert.equal(w.sync.summary.tone, 'bad');
  assert.ok(!s.calls.some(c => c.includes('folder=pics-old')), 'a paused folder isn\'t asked');
});

test('syncthing: a rescan names the folder Syncthing has, refuses one that could be two, and is write', async () => {
  const scans: string[] = [], t = make(syncthing, { url: 'http://st:8384', key: 'k' }, sync(scans)).tools!.folder_rescan;
  assert.equal(t.access, 'write');
  const c = await t.confirm!({ folder: 'documents' });
  assert.equal(c.title, 'Rescan Documents?'); assert.equal(c.detail, '/data/docs');
  await assert.rejects(t.run({ folder: 'photo' }), /could be Photos \(pics-2\), Photos archive/);
  await assert.rejects(t.run({ folder: '../system/shutdown' }), /no folder like/);
  await t.run({ folder: 'Photos' });
  assert.deepEqual(scans, ['/rest/db/scan?folder=pics-2']);
});

// ── Backrest
const chart = (...runs: [number, string, number][]) => ({ timestampMs: runs.map(r => String(now - r[0])), durationMs: runs.map(() => '60000'), status: runs.map(r => r[1]), bytesAdded: runs.map(r => String(r[2])), flowId: runs.map((_, i) => String(i)) });
const PLANS = [
  { id: 'daily-home', backupsSuccessLast30days: '29', backupsFailed30days: '1', bytesAddedLast30days: String(2 ** 30), protectedBytes: String(50 * 2 ** 30), totalSnapshots: '40', nextBackupTimeMs: String(now + 6 * H), recentBackups: chart([10 * H, 'STATUS_SUCCESS', 2 ** 26], [34 * H, 'STATUS_ERROR', 0]) },
  { id: 'photos', backupsFailed30days: '2', nextBackupTimeMs: String(now + 2 * H), recentBackups: chart([3 * H, 'STATUS_ERROR', 0], [27 * H, 'STATUS_SUCCESS', 2 ** 20]) },
  { id: 'photos-offsite', recentBackups: chart([30 * H, 'STATUS_WARNING', 2 ** 20]), historyLast30days: [{ overdue: true }] },
  { id: 'fresh' },
];
const br = (posts: unknown[] = [], wait = false) => fake((url, init) => {
  assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, `Basic ${Buffer.from('admin:pw').toString('base64')}`);
  if (url.endsWith('/GetSummaryDashboard')) return { planSummaries: PLANS, repoSummaries: [] };
  if (url.endsWith('/Backup')) { posts.push(JSON.parse(init.body)); if (wait) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); return {}; }
});
const BR = { url: 'http://backrest:9898', username: 'admin', password: 'pw' };

test('backrest: each plan\'s last backup, failures first; the old status card still counts', async () => {
  const w = await everyWidget(make(backrest, BR, br()));
  const stat = Object.fromEntries(w.status.items.map((i: any) => [i.label, i.value]));
  assert.deepEqual(stat, { Plans: 4, 'Latest fine': 1, 'Latest failed': 1, 'Failed, 30 days': 3, 'Added, 30 days': '1.0 GB' });
  assert.deepEqual(w.plans.items.map((i: any) => i.title), ['photos', 'photos-offsite', 'daily-home', 'fresh']);
  assert.match(w.plans.items[0].subtitle, /^Failed 3h 0m ago/); assert.equal(w.plans.items[0].dot, 'bad');
  assert.match(w.plans.items[1].subtitle, /warnings.*overdue/);
  assert.match(w.plans.items[2].subtitle, /Backed up 10h 0m ago · \+64\.0 MB/); assert.match(w.plans.items[2].detail, /Protects 50\.0 GB · 40 snapshots/); assert.match(w.plans.items[2].meta, /^next/);
  assert.equal(w.plans.items[3].subtitle, 'No backups yet');
  assert.equal(w.plans.summary.value, '1 failed');
});

test('backrest: a backup runs one named plan, refuses one that could be two, and a long one is still under way', async () => {
  const posts: unknown[] = [], t = make(backrest, BR, br(posts)).tools!.backup_run;
  assert.equal(t.access, 'control');
  assert.equal((await t.confirm!({ plan: 'daily' })).title, 'Back up daily-home now?');
  await assert.rejects(t.run({ plan: 'photo' }), /could be photos, photos-offsite/);
  await t.run({ plan: 'photos' });                                                          // exact beats photos-offsite
  assert.deepEqual(posts, [{ value: 'photos' }]);
  const slow = await make(backrest, BR, br([], true)).tools!.backup_run.run({ plan: 'fresh' });
  assert.equal((slow.data as any).finished, false);
  await assert.rejects(t.run({ plan: 'nope' }), /no plan like/);
});

// ── Healthchecks
const CHECKS = [
  { name: 'Nightly backup', slug: 'nightly-backup', tags: 'backup', status: 'up', last_ping: iso(2 * H), next_ping: new Date(now + 22 * H).toISOString(), n_pings: 400, started: false, uuid: '11111111-1111-4111-8111-111111111111' },
  { name: 'Cert renewal', slug: 'certs', tags: '', status: 'grace', last_ping: iso(25 * H), n_pings: 30, started: false, uuid: '22222222-2222-4222-8222-222222222222' },
  { name: 'Disk scrub', slug: 'scrub', tags: 'nas', status: 'down', last_ping: iso(9 * 24 * H), n_pings: 12, started: false, uuid: '33333333-3333-4333-8333-333333333333' },
  { name: 'Disk scrub weekly', slug: 'scrub-weekly', status: 'paused', last_ping: iso(30 * 24 * H), n_pings: 4, uuid: '44444444-4444-4444-8444-444444444444', manual_resume: true },
  { name: 'New job', slug: 'new-job', status: 'new', n_pings: 0, uuid: '55555555-5555-4555-8555-555555555555' },
];
const hc = (posts: string[] = [], readOnly = false) => fake((url, init) => {
  assert.equal(init.headers['X-Api-Key'], 'hk');
  if (init.method === 'POST') { posts.push(url); return { status: url.endsWith('/pause') ? 'paused' : 'new' }; }
  if (url.endsWith('/api/v3/checks/')) return { checks: readOnly ? CHECKS.map(({ uuid, ...c }) => ({ ...c, unique_key: `ro${uuid.slice(0, 6)}` })) : CHECKS };
});
const HC = { url: 'https://hc.example', key: 'hk' };

test('healthchecks: each check with its last ping, down then late first; the old status card still counts', async () => {
  const w = await everyWidget(make(healthchecks, HC, hc()));
  assert.deepEqual(w.status.items.map((i: any) => i.value), [1, 1, 1, 1]);
  assert.deepEqual(w.checks.items.map((i: any) => i.title), ['Disk scrub', 'Cert renewal', 'Nightly backup', 'New job', 'Disk scrub weekly']);
  assert.match(w.checks.items[0].subtitle, /^Down · last ping/); assert.equal(w.checks.items[0].dot, 'bad');
  assert.equal(w.checks.items[1].dot, 'warn'); assert.match(w.checks.items[2].meta, /^due/);
  assert.equal(w.checks.summary.value, '1 down');
});

test('healthchecks: pause names the check, refuses one that could be two, undoes with resume, and needs the full key', async () => {
  const posts: string[] = [], t = make(healthchecks, HC, hc(posts)).tools!;
  assert.equal(t.check_pause.access, 'control'); assert.equal(t.check_pause.undo, 'check_resume');
  const c = await t.check_pause.confirm!({ check: 'certs' });
  assert.equal(c.title, 'Pause Cert renewal?'); assert.match(c.detail!, /Late · last ping/);
  await assert.rejects(t.check_pause.run({ check: 'disk' }), /could be Disk scrub, Disk scrub weekly/);
  await t.check_pause.run({ check: 'Disk scrub' });
  assert.match(JSON.stringify((await t.check_resume.run({ check: 'Nightly backup' })).data), /isn't paused/);
  await t.check_resume.run({ check: 'scrub-weekly' });
  assert.deepEqual(posts, ['https://hc.example/api/v3/checks/33333333-3333-4333-8333-333333333333/pause', 'https://hc.example/api/v3/checks/44444444-4444-4444-8444-444444444444/resume']);
  const ro = make(healthchecks, HC, hc(posts, true));
  valid(await ro.widgets.checks.fetch());
  await assert.rejects(ro.tools!.check_pause.run({ check: 'certs' }), /read-only/);
  assert.equal(posts.length, 2);
});
