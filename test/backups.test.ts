// Backup health: what's late or failing is worked out the same way whoever reported it, each change is told once, a plugin's
// odd answer is left out, and every integration that knows about backups says so in the shared shape.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setHouse } from '../src/server/core.ts';
setHouse({ locale: 'en-US' });   // what the server writes follows a language; these read like a US one wherever they run
process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-backups-'));
const { Backups, backupParts, changeOf, judge, limitOf, news, BackupShape } = await import('../src/server/backups.ts');
const { checkCard } = await import('../src/shared/cards.schema.ts');
const { session } = await import('../src/server/core.ts');
const { registry } = await import('../src/integrations/index.ts');
const { fakeContext, sampleConfig } = await import('../src/server/service-check.ts');

const H = 36e5, GB = 2 ** 30, now = Date.now();
const O = { overdue: 26 * H };
const parse = (j: unknown) => BackupShape.parse(j);

test('backups: overdue by the schedule when known, by the default when not, and by the config above both', () => {
  assert.equal(limitOf({ name: 'a' }, O), 26 * H);
  assert.equal(limitOf({ name: 'a', every: 24 * H }, O), 24 * H + 2.4 * H);                         // a tenth to spare
  assert.equal(limitOf({ name: 'a', every: 2 * H }, O), 3 * H);                                    // at least an hour
  assert.equal(limitOf({ name: 'a', lastRun: now - 6 * H, next: now + 6 * H }, O), 13.2 * H);       // the gap between runs
  assert.equal(limitOf({ name: 'Offsite', every: H }, { ...O, expect: { offsite: 8 * 864e5 } }), 8 * 864e5);
  assert.equal(judge(parse({ name: 'a', lastSuccess: now - 30 * H }), 'x', 'S', O, []).health, 'overdue');
  assert.equal(judge(parse({ name: 'a', lastSuccess: now - 20 * H }), 'x', 'S', O, []).health, 'ok');
  assert.equal(judge(parse({ name: 'a', lastSuccess: new Date(now - 2 * H).toISOString(), every: H }), 'x', 'S', O, []).health, 'overdue');
});

test('backups: a failure is a failure until a run works; running and never are their own', () => {
  assert.equal(judge(parse({ name: 'a', lastSuccess: now - 30 * H, lastRun: now - H, result: 'failed' }), 'x', 'S', O, []).health, 'failed');
  assert.equal(judge(parse({ name: 'a', lastSuccess: now - H, lastRun: now - 2 * H, result: 'failed' }), 'x', 'S', O, []).health, 'ok');
  assert.equal(judge(parse({ name: 'a', lastRun: now - H, result: 'ok' }), 'x', 'S', O, []).lastSuccess, now - H);
  assert.equal(judge(parse({ name: 'a', lastSuccess: now - H, result: 'running' }), 'x', 'S', O, []).health, 'running');
  assert.equal(judge(parse({ name: 'a' }), 'x', 'S', O, []).health, 'never');
});

test('backups: a sudden drop or jump in size is worth a look; a wobble or a small backup isn\'t', () => {
  assert.ok(changeOf([10 * GB, 5 * GB])! < 0);
  assert.ok(changeOf([10 * GB, 16 * GB])! > 0);
  assert.equal(changeOf([10 * GB, 9 * GB]), undefined);
  assert.equal(changeOf([10 * 2 ** 20, 1 * 2 ** 20]), undefined);
  assert.equal(changeOf([10 * GB]), undefined);
});

test('backups: the card leads with trouble, says when the rest last worked, and is a valid card', async () => {
  const jobs = [
    judge(parse({ name: 'Photos', lastSuccess: now - 2 * H, size: 400 * GB }), 'a:Photos', 'Backrest', O, [390 * GB, 395 * GB, 400 * GB]),
    judge(parse({ name: 'Offsite', lastSuccess: now - 72 * H }), 'a:Offsite', 'Duplicati', O, []),
    judge(parse({ name: 'Docs', lastSuccess: now - H, size: 9 * GB }), 'a:Docs', 'Kopia', O, [18 * GB, 18 * GB, 9 * GB]),
  ];
  const { card } = await import('../src/server/backups.ts'), c = card(jobs, ['Proxmox']);
  assert.ok(checkCard(c).success);
  assert.deepEqual(c.items.map(i => i.title), ['Offsite', 'Docs', 'Photos', 'Proxmox']);
  assert.equal(c.items[0].tone, 'bad'); assert.equal(c.items[0].meta, 'overdue'); assert.match(c.items[0].subtitle!, /Last good backup 3d ago, expected within 1d 2h/);
  assert.equal(c.items[1].tone, 'warn'); assert.match(c.items[1].detail!, /Shrank from 18\.0 GB to 9\.0 GB/);
  assert.equal(c.items[2].meta, '2h ago'); assert.match(c.items[2].subtitle!, /Backrest · 400\.0 GB/); assert.equal(c.items[2].trend?.length, 3);
  assert.equal(c.items[3].meta, 'unknown');
  assert.equal(c.summary?.value, '1 needs a look'); assert.equal(c.summary?.tone, 'bad');
});

const source = (list: () => unknown) => [{ id: 'nas', name: 'NAS', instance: { backups: async () => list() as any } }];

test('backups: going wrong and coming right are told once each, and the first sight isn\'t news', async () => {
  let jobs: unknown[] = [{ name: 'Nightly', lastSuccess: now - 30 * H }];
  const told: string[] = [], b = new Backups();
  b.sources = () => source(() => jobs); b.tell = t => told.push(news(t).title);
  await b.jobs(true);
  assert.deepEqual(told, []);                                                   // already late when Valet first looked
  jobs = [{ name: 'Nightly', lastSuccess: now - H }]; await b.jobs(true);
  jobs = [{ name: 'Nightly', lastSuccess: now - H }]; await b.jobs(true);
  jobs = [{ name: 'Nightly', lastSuccess: now - H, lastRun: now, result: 'failed', error: 'repository locked' }]; await b.jobs(true);
  jobs = [{ name: 'Nightly', lastSuccess: now - 30 * H, lastRun: now, result: 'failed' }]; await b.jobs(true);   // failed, then also late: still one
  jobs = [{ name: 'Nightly', lastSuccess: now }]; await b.jobs(true);
  assert.deepEqual(told, ['Backing up again: Nightly (NAS)', 'Backup failed: Nightly (NAS)', 'Backing up again: Nightly (NAS)']);
});

test('backups: a plugin\'s odd jobs are left out, a source that throws is named, and sizes are remembered run by run', async () => {
  let size = 10 * GB, at = now - 3 * H;
  const b = new Backups();
  b.sources = () => [...source(() => [{ name: 'Good', lastSuccess: at, size }, { name: '' }, { lastSuccess: 'soon' }, 'nope', { name: 'Bad size', size: -1 }]),
    { id: 'x', name: 'Broken', instance: { backups: async () => { throw new Error('down'); } } }];
  let r = await b.jobs(true);
  assert.deepEqual(r.jobs.map(j => j.name), ['Good']); assert.deepEqual(r.failed, ['Broken']);
  size = 5 * GB; at = now - H;
  r = await b.jobs(true);
  assert.deepEqual(r.jobs[0].sizes, [10 * GB, 5 * GB]); assert.ok(r.jobs[0].change! < 0);
  r = await b.jobs(true);
  assert.deepEqual(r.jobs[0].sizes, [10 * GB, 5 * GB], 'the same run isn\'t counted twice');
});

test('backups: the tool reads only, hands the model plain facts, and offers a ⌘K command', async () => {
  const b = new Backups(); b.sources = () => source(() => [{ name: 'Nightly', lastSuccess: now - 30 * H, size: GB }]);
  const p = backupParts(b);
  assert.equal(p.tool.access, 'read');
  const out = await p.tool.run() as any;
  assert.equal(out.data.jobs[0].state, 'overdue'); assert.match(out.data.jobs[0].lastGood, /\(1d ago\)$/); assert.equal(out.data.summary, '1 needs a look (Nightly)');
  assert.ok(checkCard(out.card).success);
  assert.ok(p.commands[0].say.includes('are my backups ok'));
});

// ── what each integration reports
const fake = (answer: (url: string) => unknown) => ({ id: 't', log() {}, image: (r: string) => r, session, upload: async () => ({}) as any,
  async http(url: string, init: any = {}) { const out = answer(url); if (out === undefined) throw new Error(`no answer for ${url}`); return init.as === 'response' ? new Response(JSON.stringify(out)) : out; } }) as any;
const jobsOf = async (type: string, cfg: unknown, ctx: any) => { const i = registry[type], inst = i.create(i.config.parse(cfg), ctx); const jobs = await inst.backups!(); for (const j of jobs) assert.ok(BackupShape.safeParse(j).success, JSON.stringify(j)); return jobs; };

test('backups: Backrest, Proxmox, Home Assistant and Healthchecks', async () => {
  const run = (ago: number, status: string) => ({ timestampMs: [String(now - ago)], durationMs: ['1000'], status: [status], bytesAdded: ['0'] });
  const br = await jobsOf('backrest', { url: 'http://br' }, fake(u => u.endsWith('GetSummaryDashboard') ? { planSummaries: [
    { id: 'home', protectedBytes: String(50 * GB), nextBackupTimeMs: String(now + H), recentBackups: { timestampMs: [String(now - H), String(now - 25 * H)], durationMs: ['1', '1'], status: ['STATUS_ERROR', 'STATUS_SUCCESS'], bytesAdded: ['0', '0'] } },
    { id: 'photos', recentBackups: run(2 * H, 'STATUS_SUCCESS') }] } : undefined));
  assert.deepEqual(br.map(j => [j.name, j.result, j.lastSuccess]), [['home', 'failed', now - 25 * H], ['photos', 'ok', now - 2 * H]]);
  assert.equal(br[0].size, 50 * GB);

  const pve = await jobsOf('proxmox', { url: 'https://pve:8006', key: 'k' }, fake(u =>
    u.endsWith('/cluster/resources') ? { data: [{ type: 'qemu', vmid: 100, name: 'ha', node: 'alpha', status: 'running' }, { type: 'storage', node: 'alpha', storage: 'nas', status: 'available', content: 'backup,iso', shared: 1 }, { type: 'storage', node: 'alpha', storage: 'local', status: 'available', content: 'images' }] }
    : u.includes('/storage/nas/content') ? { data: [{ vmid: 100, ctime: (now - 30 * H) / 1000, size: 4 * GB }, { vmid: 100, ctime: (now - 6 * H) / 1000, size: 5 * GB }] }
    : u.endsWith('/cluster/tasks') ? { data: [{ type: 'vzdump', id: '100', status: 'unable to connect', starttime: (now - H) / 1000, endtime: (now - H) / 1000 + 5 }] } : undefined));
  assert.equal(pve.length, 1); assert.equal(pve[0].name, 'ha (VM 100)'); assert.deepEqual(pve[0].sizes, [4 * GB, 5 * GB]); assert.equal(pve[0].result, 'failed'); assert.equal(pve[0].error, 'unable to connect');

  const states = (extra: object[]) => fake(u => u.endsWith('/api/states') ? extra : undefined);
  assert.deepEqual(await jobsOf('homeassistant', { url: 'http://ha', token: 't' }, states([{ entity_id: 'light.a', state: 'on' }])), []);
  const ha = await jobsOf('homeassistant', { url: 'http://ha', token: 't' }, states([{ entity_id: 'sensor.backup_backup_manager_state', state: 'idle' },
    { entity_id: 'sensor.backup_last_successful_automatic_backup', state: new Date(now - 50 * H).toISOString() }, { entity_id: 'sensor.backup_last_attempted_automatic_backup', state: new Date(now - 2 * H).toISOString() }]));
  assert.equal(ha[0].result, 'failed'); assert.equal(ha[0].lastSuccess, now - 50 * H);

  const hc = await jobsOf('healthchecks', { url: 'https://hc', key: 'k' }, fake(u => u.endsWith('/checks/') ? { checks: [
    { name: 'Nightly backup', status: 'up', last_ping: new Date(now - H).toISOString(), timeout: 86400, grace: 3600 }, { name: 'Certs', status: 'down' }, { name: 'Restic', tags: 'backup', status: 'down', last_ping: new Date(now - 40 * H).toISOString() }] } : undefined));
  assert.deepEqual(hc.map(j => [j.name, j.result]), [['Restic', 'failed'], ['Nightly backup', 'ok']]);
  assert.equal(hc[1].every, 25 * H);
});

test('backups: Kopia, Duplicati, Proxmox Backup Server and TrueNAS from their samples', async () => {
  const of = async (type: string) => { const s = registry[type] as any; return s.create(s.config.parse(sampleConfig(s.def)), fakeContext(s.def)).backups!(); };
  const kopia = await of('kopia');
  assert.deepEqual(kopia.map((j: any) => [j.name, j.result]), [['nas:/data', 'ok'], ['nas:/home', 'warning'], ['nas:/new', undefined]]);
  const dup = await of('duplicati');
  assert.deepEqual(dup.map((j: any) => [j.name, j.result, j.every]), [['Photos', 'failed', 864e5], ['Job 2', 'running', undefined]]);
  const pbs = await of('proxmox-backup');
  assert.deepEqual(pbs.map((j: any) => [j.name, j.result]), [['homeassistant (vm/100)', undefined], ['vm/101', 'failed'], ['ct/200', undefined]]);
  const nas = await of('truenas');
  assert.deepEqual(nas.map((j: any) => [j.name, j.result]), [['Photos to B2', 'ok'], ['Documents to S3', 'failed'], ['tank to backup box', 'ok']]);
});
