// Several machines through their agents, against made-up answers: one going quiet never costs the others, what it last
// said is kept and marked, an agent from before versions still shows its services, and nothing here can change a machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { session, setHouse, type Context, type Instance } from '../src/server/core.ts';
import { noticesFor } from '../src/server/notices.ts';
import { troubles } from '../src/server/insight.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { hitsOf } from '../src/shared/search.ts';
import { oneLine, sayHow } from '../src/web/format.ts';
import machines from '../src/integrations/machines.ts';
setHouse({ locale: 'en-US' });

type Handler = (url: string, init: any) => unknown;
function fake(handler: Handler) {
  const calls: string[] = [], inits: Record<string, any> = {};
  const ctx = {
    id: 'm', calls, inits, log() {}, image: (r: string) => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }), session,
    async http(url: string, init: any = {}) {
      calls.push(`${init.method ?? 'GET'} ${url}`); inits[url] = init;
      const out = await handler(url, init);
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
    },
  };
  return ctx as unknown as Context & { calls: string[]; inits: Record<string, any> };
}
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); return card as any; };
const no = (status: number, body: object = {}) => new Response(JSON.stringify(body), { status });
/** The clock in the test's hands: answers are shared for two seconds, so time has to pass for a machine to be asked again. */
async function clocked(run: (pass: (ms: number) => void) => Promise<void>) {
  const real = Date.now; let at = real();
  Date.now = () => at;
  try { await run(ms => { at += ms; }); } finally { Date.now = real; }
}

const GB = 2 ** 30;
const nas = { api: 1, host: 'nas', can: { metrics: true, units: 2, docker: true }, os: 'Debian GNU/Linux 12 (bookworm)', osId: 'debian', kernel: '6.1.0', arch: 'x86_64', uptime: 9 * 86400 + 3600,
  cpu: { pct: 12.4, cores: 8, model: 'Example CPU 9000' }, load: [0.42, 0.3, 0.25], memory: { total: 64 * GB, available: 38 * GB }, swap: { total: 8 * GB, free: 8 * GB },
  disks: [{ mount: '/', total: 500 * GB, free: 290 * GB, used: 200 * GB }, { mount: '/mnt/media', total: 18000 * GB, free: 3200 * GB, used: 14800 * GB }],
  temperatures: [{ name: 'nvme Composite', c: 61 }, { name: 'coretemp Package id 0', c: 47 }, { name: 'acpitz', c: -63 }] };
const pi = { api: 1, host: 'raspberrypi', can: { metrics: true, units: 0, docker: false }, os: 'Raspberry Pi OS', osId: 'raspbian', uptime: 3600, cpu: { pct: 3, cores: 4, model: 'Raspberry Pi 4 Model B' }, load: [0.1, 0.1, 0.1],
  memory: { total: 4 * GB, available: 3 * GB }, swap: { total: 0, free: 0 }, disks: [{ mount: '/', total: 32 * GB, free: 2 * GB, used: 28 * GB }], temperatures: [{ name: 'cpu_thermal', c: 52.1 }] };
const unit = (name: string, state = 'active', o: object = {}) => ({ unit: name, name, state, sub: state === 'active' ? 'running' : 'dead', restarts: 0, ...o });
const box = (name: string, Status: string, o: object = {}) => ({ id: `${name.length}`.repeat(12), name, state: /^Exited/.test(Status) ? 'exited' : 'running', status: Status, image: `${name}:1`, project: 'media', ...o });
const CONFIG = { hosts: { nas: { url: 'http://10.0.0.5:7576/', token: 'nas-token', quiet: ['backup-job'], hide: ['hidden'] }, pi: { url: 'http://10.0.0.6:7576', token: 'pi-token', name: 'Pi' }, old: { url: 'http://10.0.0.7:7576', token: 'old-token' } } };
/** Three machines: a NAS that reports everything, a Pi with only its numbers and a nearly full card, and one whose agent is from before versions. */
function lab(over: Handler = () => undefined) {
  const ctx = fake((url, init) => {
    const mine = over(url, init);
    if (mine !== undefined) return mine;
    const host = new URL(url).hostname, path = url.slice(url.indexOf('/', 8));
    assert.equal(init.headers.Authorization, { '10.0.0.5': 'Bearer nas-token', '10.0.0.6': 'Bearer pi-token', '10.0.0.7': 'Bearer old-token' }[host], 'each machine gets its own token and no other');
    if (host === '10.0.0.5') {
      if (path === '/v1/machine') return nas;
      if (path === '/v1/units') return { host: 'nas', services: [unit('smbd'), unit('radarr', 'failed', { result: 'exit-code', restarts: 5, exitStatus: 1 })] };
      if (path.startsWith('/v1/containers')) return { containers: [box('plex', 'Up 9 days (healthy)', path.includes('usage') ? { cpuPct: 41.5, memoryBytes: 900 * 2 ** 20 } : {}), box('sonarr', 'Exited (137) 2 hours ago'), box('backup-job', 'Exited (1) 3 hours ago'), box('hidden', 'Up 1 day')] };
      if (path.startsWith('/v1/logs?container=plex')) return { container: 'plex', state: 'running', status: 'Up 9 days (healthy)', killedForMemory: false, exitCode: 0, restarts: 2, lines: ['started', 'x'.repeat(900)] };
      if (path.startsWith('/v1/logs?unit=radarr')) return { unit: 'radarr', lines: ['boom'] };
    }
    if (host === '10.0.0.6') { if (path === '/v1/machine') return pi; }
    if (host === '10.0.0.7') {
      if (path === '/services') return { host: 'old', services: [unit('radarr'), unit('sshd')] };
      if (path.startsWith('/logs?unit=sshd')) return { unit: 'sshd', lines: ['Accepted publickey'] };
      return no(404, { error: 'no such path' });
    }
    return no(404, { error: 'no such path' });
  });
  return { ctx, m: machines.create(machines.config.parse(CONFIG), ctx) as Instance };
}

test('machines: one block, every machine at once, each a widget of its own', async () => {
  const { ctx, m } = lab();
  assert.deepEqual(Object.keys(m.widgets), ['fleet', 'overview', 'containers', 'units', 'disks', 'nas', 'pi', 'old']);
  const fleet = valid(await m.widgets.fleet.fetch());
  assert.deepEqual(fleet.items.map((i: any) => [i.name, i.ok, i.state, i.detail]), [
    ['nas', true, 'up', 'radarr is down · sonarr is down'],        // its own numbers are fine; what's down on it is said in words and counted on the services' cards
    ['Pi', false, 'degraded', '/ is 93% full'],
    ['old', true, 'up', 'Update its agent']]);
  assert.deepEqual([fleet.summary.value, fleet.summary.tone, fleet.summary.sub], ['3 of 3', 'warn', 'nas: radarr is down']);
  assert.deepEqual(fleet.items.map((i: any) => i.icon), ['/api/icon/debian', '/api/icon/raspberry-pi', '/api/icon/linux']);
  assert.equal(ctx.inits['http://10.0.0.5:7576/v1/machine'].timeout, 4000);
  const table = valid(await m.widgets.overview.fetch());
  assert.deepEqual(table.rows, [['nas', '12%', '41%', '82%', '47°C', '9d 1h'], ['Pi', '3%', '25%', '93%', '52°C', '1h'], ['old · update its agent', '', '', '', '', '']]);
  // the processor's sensor is the machine's temperature, never a drive's or a reading that can't be real
  const detail = valid(await m.widgets.nas.fetch());
  assert.deepEqual(detail.items.map((i: any) => [i.label, i.value, i.unit, i.sub]), [['CPU', 12, '%', '47°C'], ['Memory', 41, '%', undefined], ['/mnt/media', 82, '%', undefined], ['Up', '9d 1h', undefined, undefined]]);
  assert.deepEqual([detail.summary.label, detail.summary.value, detail.summary.detail, detail.summary.tone, detail.source.name], ['nas', '12%', 'RAM 41% · 47°C', 'good', 'nas']);
  assert.equal(valid(await m.widgets.pi.fetch()).summary.tone, 'bad');
  assert.match(valid(await m.widgets.old.fetch()).text, /older than this Valet expects: update it/);
  // one request a machine for the three widgets that read the same thing
  assert.equal(ctx.calls.filter(c => c.endsWith('10.0.0.5:7576/v1/machine')).length, 1);
  assert.ok(ctx.calls.every(c => c.startsWith('GET ')));
});

test('machines: services and containers by machine, a shared name told apart, quiet and hidden ones as asked', async () => {
  const { m } = lab();
  const units = valid(await m.widgets.units.fetch());
  assert.deepEqual(units.items.map((i: any) => [i.name, i.group, i.ok, i.detail]), [['smbd', 'nas', true, undefined], ['radarr · nas', 'nas', false, 'failed (exit-code)'], ['radarr · old', 'old', true, undefined], ['sshd', 'old', true, undefined]]);
  assert.deepEqual([units.summary.value, units.summary.sub, units.summary.tone], ['1 down', 'on 2 machines', 'bad']);
  const c = valid(await m.widgets.containers.fetch());
  assert.deepEqual(c.items.map((i: any) => [i.name, i.group, i.state, i.detail, i.quiet]), [['plex', 'nas', 'up', 'healthy', false], ['sonarr', 'nas', 'down', 'exited (137)', false], ['backup-job', 'nas', 'off', 'exited (1)', true]]);
  assert.deepEqual([c.summary.value, c.summary.tone], ['1 down', 'bad']);
  const disks = valid(await m.widgets.disks.fetch());
  assert.deepEqual(disks.items.map((i: any) => [i.section, i.title, i.tone, Math.round(i.pct * 100)]), [['nas', '/mnt/media', 'warn', 82], ['nas', '/', 'neutral', 41], ['Pi', '/', 'bad', 93]]);
  assert.deepEqual([disks.summary.value, disks.summary.sub, disks.summary.tone], ['93%', 'Pi /', 'bad']);
});

test('machines: one that stops answering is down, keeps what it last said, and costs one wait', async () => clocked(async pass => {
  let gone = false;
  const { ctx, m } = lab(url => { if (gone && url.includes('10.0.0.5')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); return undefined; });
  const key = (name: string) => `m.${name}`, at = Date.now();
  const first = { fleet: await m.widgets.fleet.fetch(), containers: await m.widgets.containers.fetch(), nas: await m.widgets.nas.fetch() };
  gone = true; pass(60_000); ctx.calls.length = 0;
  const fleet = valid(await m.widgets.fleet.fetch());
  assert.deepEqual(fleet.items.map((i: any) => [i.name, i.ok, i.state]), [['nas', false, 'down'], ['Pi', false, 'degraded'], ['old', true, 'up']]);
  assert.match(fleet.items[0].detail, /^timed out · last seen \d/);
  assert.deepEqual([fleet.summary.value, fleet.summary.tone], ['2 of 3', 'bad']);
  assert.deepEqual(ctx.calls.filter(c => c.includes('10.0.0.5')), ['GET http://10.0.0.5:7576/v1/machine']);   // its services and containers aren't asked for while it's away
  const row = valid(await m.widgets.overview.fetch()).rows[0];
  assert.match(row[0], /^nas · timed out · last seen /); assert.deepEqual(row.slice(1), ['', '', '', '', '']);   // stale numbers aren't shown as now
  // its containers stay on the card as they last were, under a heading that says so
  const c = valid(await m.widgets.containers.fetch());
  assert.deepEqual(c.items.map((i: any) => i.name), ['plex', 'sonarr', 'backup-job']);
  assert.match(c.items[0].group, /^nas · timed out · last seen /);
  assert.match(valid(await m.widgets.disks.fetch()).items[0].section, /^nas · timed out/);
  // its own widget fails, so the page keeps its last card and marks it
  await assert.rejects(() => m.widgets.nas.fetch(), /^Error: timed out · last seen/);
  // the page says it once, as it would for a service: the machine is down, and its stale card isn't a second problem
  const states = [{ key: key('fleet'), card: fleet, at }, { key: key('nas'), card: first.nas, error: 'timed out · last seen earlier', at }];
  const how = sayHow(states);
  assert.equal(oneLine(how.problems, how.parts), 'Everything\'s running except nas and Pi.');
  assert.deepEqual(troubles(states).map(t => t.text), ['nas is down (timed out · last seen ' + fleet.items[0].detail.split('last seen ')[1] + ')', 'Pi is unhealthy (/ is 93% full)']);
  assert.deepEqual(noticesFor(key('fleet'), first.fleet, fleet, [{ widget: key('fleet'), on: 'down' }]).map(n => n.text), ['nas is down']);
  // and when it answers again it's simply back
  gone = false; pass(60_000);
  const back = valid(await m.widgets.fleet.fetch());
  assert.equal(back.items[0].ok, true);
  assert.deepEqual(noticesFor(key('fleet'), fleet, back, [{ widget: key('fleet'), on: 'up' }]).map(n => n.text), ['nas is back']);
  assert.equal(valid(await m.widgets.containers.fetch()).items[0].group, 'nas');
}));

test('machines: a slow one holds nobody up', async () => {
  let hang!: (e: Error) => void;
  const { ctx, m } = lab(url => url.includes('10.0.0.6') ? new Promise((_, no) => { hang = no; }) : undefined);
  const card = m.widgets.fleet.fetch();
  await new Promise(ok => setImmediate(ok));
  // while the Pi hasn't answered, the others have already been asked for everything
  for (const want of ['10.0.0.5:7576/v1/machine', '10.0.0.5:7576/v1/units', '10.0.0.5:7576/v1/containers', '10.0.0.7:7576/services']) assert.ok(ctx.calls.some(c => c.endsWith(want)), want);
  hang(new Error('fetch failed'));
  assert.deepEqual(valid(await card).items.map((i: any) => [i.name, i.state, i.detail]), [['nas', 'up', 'radarr is down · sonarr is down'], ['Pi', 'down', 'not reachable'], ['old', 'up', 'Update its agent']]);
});

test('machines: a refused token and a refused address are said as that', async () => {
  const { m } = lab(url => url.includes('10.0.0.5') ? no(401, { error: 'bad token' }) : url.includes('10.0.0.6') ? no(403) : undefined);
  assert.deepEqual(valid(await m.widgets.fleet.fetch()).items.map((i: any) => [i.name, i.state, i.detail]), [['nas', 'down', 'refused the token'], ['Pi', 'down', 'refuses this address'], ['old', 'up', 'Update its agent']]);
  const none = valid(await m.widgets.containers.fetch());
  assert.equal(none.type, 'text');
});

test('machines: the assistant can ask about all of them, one of them, and what runs where, and only look', async () => {
  const { ctx, m } = lab(), t = m.tools!;
  assert.ok(Object.values(t).every(x => x.access === 'read')); assert.equal(m.actions, undefined);
  const all: any = await t.machines_status.run({}); valid(all.card);
  assert.deepEqual(all.card.cards.map((c: any) => c.type), ['status', 'table']);
  assert.deepEqual(all.data.machines.map((x: any) => [x.machine, x.reachable, x.wrong, x.agent]), [['nas', true, ['radarr is down', 'sonarr is down'], undefined], ['Pi', true, ['/ is 93% full'], undefined], ['old', true, undefined, 'its agent is older than this Valet expects: update it']]);
  assert.deepEqual(all.data.machines[1].disks, [{ mount: '/', percentFull: 93, free: '2.0 GB' }]);   // "which machine is low on disk?"
  const one: any = await t.machine_status.run({ machine: 'NAS' }); valid(one.card);
  assert.deepEqual([one.data.processor, one.data.cores, one.data.cpuTempC, one.data.reports.containers], ['Example CPU 9000', 8, 47, true]);
  await assert.rejects(() => t.machine_status.run({ machine: 'attic' }), /no machine like "attic". There are: nas, Pi, old/);
  const on: any = await t.machines_running.run({ machine: 'nas', usage: true }); valid(on.card);
  assert.ok(ctx.calls.includes('GET http://10.0.0.5:7576/v1/containers?usage=1'));
  assert.deepEqual(on.data.machines.map((x: any) => [x.machine, x.containers.map((c: any) => [c.name, c.cpuPercent, c.memoryMB]), x.services.map((s: any) => [s.name, s.state, s.restarts])]), [['nas', [['plex', 41.5, 900], ['sonarr', undefined, undefined], ['backup-job', undefined, undefined]], [['smbd', 'active', 0], ['radarr', 'failed', 5]]]]);
  assert.deepEqual((await t.machines_running.run({ usage: false }) as any).data.machines.map((x: any) => x.machine), ['nas', 'Pi', 'old']);
});

test('machines: finding something by name across machines, for the assistant and for ⌘K', async () => {
  const { m } = lab(), t = m.tools!;
  assert.equal(t.machines_find.find, 'query');
  const r: any = await t.machines_find.run(t.machines_find.input.parse({ query: 'Radarr' })); valid(r.card);
  assert.deepEqual(r.data.found, [{ name: 'radarr', kind: 'service', machine: 'nas', state: 'failed (dead)' }, { name: 'radarr', kind: 'service', machine: 'old', state: 'active (running)' }]);
  assert.deepEqual(hitsOf(r.card), [{ title: 'radarr', sub: 'nas · service · failed (dead)', image: undefined, href: undefined }, { title: 'radarr', sub: 'old · service · active (running)', image: undefined, href: undefined }]);
  assert.deepEqual(hitsOf(((await t.machines_find.run(t.machines_find.input.parse({ query: 'plex:1' }))) as any).card).map(h => h.sub), ['nas · container · Up 9 days (healthy)']);   // by image too
  assert.deepEqual(hitsOf(((await t.machines_find.run(t.machines_find.input.parse({ query: 'nothing-like-it' }))) as any).card), []);
});

test('machines: logs from the machine that has it, the old way from an old agent, and a question when two could be meant', async () => {
  const { ctx, m } = lab(), logs = m.tools!.machine_logs, run = (a: object) => logs.run(logs.input.parse(a)) as Promise<any>;
  const plex = await run({ name: 'plex', minutes: 30, match: 'err' }); valid(plex.card);
  assert.ok(ctx.calls.includes('GET http://10.0.0.5:7576/v1/logs?container=plex&lines=300&minutes=30&match=err'));
  assert.deepEqual([plex.data.machine, plex.data.container, plex.data.restarts, plex.data.killedForMemory, plex.data.lines[1].length], ['nas', 'plex', 2, false, 401]);   // "why did plex restart?", and a long line cut
  assert.deepEqual((await run({ name: 'radarr' })).data, { error: 'more than one matches: say which', matches: [{ name: 'radarr', kind: 'service', machine: 'nas' }, { name: 'radarr', kind: 'service', machine: 'old' }] });
  const failed = await run({ name: 'radarr.service', machine: 'nas' });
  assert.deepEqual([failed.data.service, failed.data.state, failed.data.restarts, failed.data.lastResult, failed.data.lines], ['radarr', 'failed', 5, 'exit-code', ['boom']]);
  assert.deepEqual((await run({ name: 'sshd' })).data.lines, ['Accepted publickey']);
  assert.ok(ctx.calls.includes('GET http://10.0.0.7:7576/logs?unit=sshd&lines=300'));          // an agent from before versions is asked the way it knows
  const none = await run({ name: 'postgres', machine: 'pi' });
  assert.match(none.data.error, /nothing called "postgres" on Pi/);
  assert.ok(ctx.calls.every(c => c.startsWith('GET ') && !/\/(restart|stop|start|exec|create|kill)\b/.test(c)));
});

test('machines: a machine can\'t take a widget\'s name, and the block needs at least one', () => {
  const host = { url: 'http://10.0.0.5:7576', token: 'x' };
  assert.equal(machines.config.safeParse({ hosts: { fleet: host } }).success, false);
  assert.equal(machines.config.safeParse({ hosts: { 'my nas': host } }).success, false);
  assert.equal(machines.config.safeParse({ hosts: {} }).success, false);
  assert.equal(machines.config.safeParse({ hosts: { nas: host } }).success, true);
});
