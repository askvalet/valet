// The agent for real, against stand-ins for systemctl, journalctl, /proc, /sys and Docker: what it refuses matters more
// than what it answers.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const python = spawnSync('python3', ['--version']).status === 0;
const dir = await mkdtemp(join(tmpdir(), 'valet-agent-')), log = join(dir, 'calls'), root = join(dir, 'root');
const TOKEN = 'a-token-that-is-long-enough-to-use';
// a port the system says is free, rather than a random guess another run could share
const freePort = () => new Promise<number>(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as any; s.close(() => ok(port)); }); });
const running: ChildProcess[] = [];
/** Starts an agent and waits for the line it prints once it's listening: no polling, no sleeping. */
async function start(env: Record<string, string>) {
  const port = await freePort();
  const agent = spawn('python3', ['agent/valet-agent.py'], { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_BIND: `127.0.0.1:${port}`, ...env } });
  running.push(agent);
  await new Promise<void>((ok, no) => { agent.stdout!.once('data', () => ok()); agent.once('exit', () => no(new Error('agent did not start'))); });
  const base = `http://127.0.0.1:${port}`;
  return { base, get: (path: string, token = TOKEN) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }) };
}
const put = async (path: string, text: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };

// ── a stand-in for Docker that writes down everything it's asked
const ID = { plex: 'a'.repeat(64), radarr: 'b'.repeat(64), vault: 'c'.repeat(64) };
const asked: string[] = [];
const frame = (stream: number, text: string) => { const b = Buffer.from(text), h = Buffer.alloc(8); h[0] = stream; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
const docker = httpServer((req, res) => {
  asked.push(`${req.method} ${req.url}`);
  const url = req.url ?? '', json = (o: unknown) => res.end(JSON.stringify(o));
  if (url === '/containers/json?all=1') return json([
    { Id: ID.plex, Names: ['/plex'], State: 'running', Status: 'Up 9 days (healthy)', Image: 'plex:1.41', Labels: { 'com.docker.compose.project': 'media' }, Mounts: [{ Source: '/srv/secret-path' }], Ports: [{ PublicPort: 32400 }] },
    { Id: ID.radarr, Names: ['/radarr'], State: 'exited', Status: 'Exited (137) 2 hours ago', Image: 'radarr:5', Labels: {} },
    { Id: ID.vault, Names: ['/vault'], State: 'running', Status: 'Up 1 hour', Image: 'vault:1', Labels: {} },
    { Id: '../../v1.41/containers/create', Names: ['/plex-twin'], State: 'running', Status: 'Up', Image: 'x', Labels: {} },
  ]);
  if (url.endsWith('/stats?stream=false')) return json({ cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 4 }, precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 }, memory_stats: { usage: 900, limit: 4000, stats: { inactive_file: 100 } } });
  if (url.includes('/logs?')) return res.end(Buffer.concat([frame(1, '2026-01-01T00:00:00Z starting\n'), frame(2, '2026-01-01T00:00:01Z \u001b[31mERROR\u001b[0m out of\u0007 memory\n')]));
  if (url.endsWith('/json')) return json({ RestartCount: 4, State: { OOMKilled: true, ExitCode: 137, StartedAt: '2026-01-01T00:00:00Z', FinishedAt: '2026-01-01T00:00:02Z' }, Config: { Env: ['API_KEY=hunter2'] } });
  res.statusCode = 404; res.end('{}');
});
const READS = /^GET \/containers\/(json\?all=1|[a-f0-9]{64}\/(json|stats\?stream=false|logs\?stdout=1&stderr=1&timestamps=1&tail=\d+(&since=\d+)?))$/;

let base = '', get: Awaited<ReturnType<typeof start>>['get'], full: Awaited<ReturnType<typeof start>>;
before(async () => {
  if (!python) return;
  // stand-ins that record how they were called; systemctl answers once for each service it's asked about, as the real one does
  await writeFile(join(dir, 'systemctl'), `#!/bin/sh\necho "$@" >> ${log}\nfor a in "$@"; do case "$a" in -*|show) ;; *) printf 'ActiveState=failed\\nSubState=failed\\nResult=exit-code\\nNRestarts=3\\nExecMainStatus=137\\nMemoryCurrent=[not set]\\nDescription=About %s\\n\\n' "$a";; esac; done\n`);
  await writeFile(join(dir, 'journalctl'), `#!/bin/sh\necho "$@" >> ${log}\nprintf '%s\\n' 'Oct 30 ok fine' 'Oct 30 ERROR out of memory'\n`);
  await chmod(join(dir, 'systemctl'), 0o755); await chmod(join(dir, 'journalctl'), 0o755);
  // a made-up machine: one core, 16 GB, a hot processor and a drive that isn't the processor
  await put('proc/stat', 'cpu  1000 0 500 8000 500 0 0 0 0 0\ncpu0 1000 0 500 8000 500 0 0 0 0 0\nintr 1\n');
  await put('proc/meminfo', 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    4000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n');
  await put('proc/loadavg', '0.42 0.30 0.25 1/300 4242\n'); await put('proc/uptime', '86400.55 80000.00\n');
  await put('proc/cpuinfo', 'processor\t: 0\nmodel\t\t: 68\nmodel name\t: Example CPU 9000\n');
  await put('proc/sys/kernel/hostname', 'made-up-nas\n'); await put('proc/sys/kernel/osrelease', '6.1.0-test\n');
  await put('etc/os-release', 'NAME="Debian GNU/Linux"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\n');
  await put('sys/class/hwmon/hwmon0/name', 'coretemp\n'); await put('sys/class/hwmon/hwmon0/temp1_label', 'Package id 0\n'); await put('sys/class/hwmon/hwmon0/temp1_input', '71500\n');
  await put('sys/class/hwmon/hwmon1/name', 'nvme\n'); await put('sys/class/hwmon/hwmon1/temp1_input', '38000\n'); await put('sys/class/hwmon/hwmon1/temp1_max', '99000\n');
  await mkdir(join(root, 'mnt/media'), { recursive: true });
  const dockerPort = await new Promise<number>(ok => docker.listen(0, '127.0.0.1', () => ok((docker.address() as any).port)));
  // the agent as it was before versions: services only
  ({ base, get } = await start({ VALET_AGENT_UNITS: 'radarr,user:ninfer' }));
  full = await start({ VALET_AGENT_UNITS: 'radarr,sonarr,user:job', VALET_AGENT_METRICS: '1', VALET_AGENT_MOUNTS: '/,/mnt/media,/not/there', VALET_AGENT_ROOT: root, VALET_AGENT_DOCKER: `http://127.0.0.1:${dockerPort}`, VALET_AGENT_CONTAINERS: 'plex*,radarr' });
});
after(() => { for (const a of running) a.kill(); docker.close(); });

test('agent: no token, no answer', { skip: !python }, async () => {
  assert.equal((await fetch(`${base}/services`)).status, 401);
  assert.equal((await get('/services', 'wrong')).status, 401);
  assert.equal((await get('/logs?unit=radarr', 'x'.repeat(TOKEN.length))).status, 401);
  for (const path of ['/v1/machine', '/v1/units', '/v1/containers', '/v1/logs?container=plex']) assert.equal((await full.get(path, 'wrong')).status, 401, path);
  assert.equal((await fetch(`${base}/health`)).status, 200);                  // alive is all this says
  assert.deepEqual(await (await fetch(`${full.base}/health`)).json(), { ok: true });
});

test('agent: reports listed services, user ones with --user', { skip: !python }, async () => {
  const j: any = await (await get('/services')).json();
  assert.deepEqual(j.services.map((s: any) => [s.unit, s.state, s.restarts, s.exitStatus, s.memoryBytes]), [['radarr', 'failed', 3, 137, null], ['user:ninfer', 'failed', 3, 137, null]]);
  const calls = await readFile(log, 'utf8');
  assert.match(calls, /^show radarr/m); assert.match(calls, /^--user show ninfer/m);
});

test('agent: one systemctl for all the system\'s services, each answer to its own name', { skip: !python }, async () => {
  await writeFile(log, '');
  const j: any = await (await full.get('/v1/units')).json();
  assert.deepEqual(j.services.map((s: any) => [s.unit, s.name, s.description]), [['radarr', 'radarr', 'About radarr'], ['sonarr', 'sonarr', 'About sonarr'], ['user:job', 'job', 'About job']]);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(l => l.split(' --no-pager')[0]), ['show radarr sonarr', '--user show job']);
  assert.deepEqual(((await (await full.get('/services')).json()) as any).services.length, 3);   // the old address still answers
});

test('agent: logs only for listed services, nothing unchecked reaches journalctl', { skip: !python }, async () => {
  const j: any = await (await get('/logs?unit=radarr&match=error')).json();
  assert.deepEqual(j.lines, ['Oct 30 ERROR out of memory']);
  await writeFile(log, '');
  for (const unit of ['ssh', 'sshd.service', 'radarr --since yesterday', '../etc', '-k', '*']) assert.equal((await get(`/logs?unit=${encodeURIComponent(unit)}`)).status, 404, unit);
  for (const unit of ['ssh', '-k', '*']) assert.equal((await full.get(`/v1/logs?unit=${encodeURIComponent(unit)}`)).status, 404, unit);
  assert.equal(await readFile(log, 'utf8'), '');
  assert.equal((await get('/logs?unit=radarr&lines=lots')).status, 400);
  await get('/logs?unit=radarr&lines=999999');
  assert.match(await readFile(log, 'utf8'), /-n 2000/);                       // capped
});

test('agent: the machine from /proc and /sys, and CPU from two looks without waiting', { skip: !python }, async () => {
  const m: any = await (await full.get('/v1/machine')).json();
  assert.equal(m.api, 1);
  assert.deepEqual(m.can, { metrics: true, units: 3, docker: true });
  assert.deepEqual([m.host, m.os, m.osId, m.kernel, m.uptime, m.load], ['made-up-nas', 'Debian GNU/Linux 12 (bookworm)', 'debian', '6.1.0-test', 86400.55, [0.42, 0.3, 0.25]]);
  assert.deepEqual(m.cpu, { pct: null, cores: 1, model: 'Example CPU 9000' });   // one look so far: nothing to compare with, and no sleeping to get one
  assert.deepEqual(m.memory, { total: 16_000_000 * 1024, available: 4_000_000 * 1024 });
  assert.deepEqual(m.swap, { total: 2_000_000 * 1024, free: 1_500_000 * 1024 });
  assert.deepEqual(m.temperatures, [{ name: 'coretemp Package id 0', c: 71.5 }, { name: 'nvme', c: 38 }]);
  assert.deepEqual(m.disks.map((d: any) => d.mount), ['/', '/mnt/media']);       // only the listed mounts, and only those that exist
  assert.ok(m.disks.every((d: any) => d.total > 0 && d.free <= d.total));
  // 300 of the next 1000 ticks were work
  await put('proc/stat', 'cpu  1200 0 600 8600 600 0 0 0 0 0\ncpu0 1200 0 600 8600 600 0 0 0 0 0\n');
  assert.equal(((await (await full.get('/v1/machine')).json()) as any).cpu.pct, 30);
  assert.equal(((await (await full.get('/v1/machine')).json()) as any).cpu.pct, 30);   // asked again at once: the same answer, not a division by nothing
  // an agent that wasn't told to report the machine says what it can do and nothing about the machine
  assert.deepEqual(await (await get('/v1/machine')).json(), { api: 1, host: (await (await get('/services')).json() as any).host, can: { metrics: false, units: 2, docker: false } });
  assert.equal((await get('/v1/containers')).status, 404);
});

test('agent: containers through GET alone, and only what Valet shows of them', { skip: !python }, async () => {
  asked.length = 0;
  const raw = await (await full.get('/v1/containers?usage=1')).text(), j = JSON.parse(raw);
  // vault isn't on the agent's list; the one whose id isn't an id is dropped rather than put in a path
  assert.deepEqual(j.containers, [
    { id: 'a'.repeat(12), name: 'plex', state: 'running', status: 'Up 9 days (healthy)', image: 'plex:1.41', project: 'media', source: null, cpuPct: 80, memoryBytes: 800, memoryLimit: 4000 },
    { id: 'b'.repeat(12), name: 'radarr', state: 'exited', status: 'Exited (137) 2 hours ago', image: 'radarr:5', project: null, source: null },
  ]);
  assert.ok(!/secret-path|32400|Mounts|Ports/.test(raw));
  const logs: any = await (await full.get('/v1/logs?container=radarr&lines=50&minutes=10&match=error')).json();
  assert.deepEqual(logs.lines, ['2026-01-01T00:00:01Z ERROR out of memory']);    // frames unwrapped, colour and control characters gone
  assert.deepEqual([logs.container, logs.killedForMemory, logs.exitCode, logs.restarts], ['radarr', true, 137, 4]);
  assert.ok(!JSON.stringify(logs).includes('hunter2'));                          // the inspect answer's environment stays behind
  const before = asked.length;
  for (const name of ['vault', 'plex-twin', 'nope', '../../containers/create', `${ID.plex}/../../images/json`, 'plex?x=1', 'plex/exec', '*', '']) assert.equal((await full.get(`/v1/logs?container=${encodeURIComponent(name)}`)).status, 404, name);
  assert.ok(asked.slice(before).every(a => a === 'GET /containers/json?all=1'));   // a name that isn't listed never reaches a path
  assert.equal((await full.get('/v1/logs?container=plex&lines=999999')).status, 200);
  assert.ok(asked.some(a => a.includes('tail=2000')));
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) for (const path of ['/v1/containers', `/v1/containers/${ID.plex}/restart`, '/v1/logs?container=plex']) assert.equal((await fetch(full.base + path, { method, headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405, `${method} ${path}`);
  assert.ok(asked.length > 6);
  for (const a of asked) assert.match(a, READS);                                 // everything Docker was ever asked
});

test('agent: Docker gone is said plainly, and the rest keeps answering', { skip: !python }, async () => {
  const a = await start({ VALET_AGENT_UNITS: 'radarr', VALET_AGENT_DOCKER: `http://127.0.0.1:${await freePort()}` });
  const r = await a.get('/v1/containers');
  assert.equal(r.status, 502); assert.match(((await r.json()) as any).error, /Docker didn't answer/);
  assert.equal((await a.get('/v1/units')).status, 200);
});

test('agent: only the addresses it was told to answer', { skip: !python }, async () => {
  const far = await start({ VALET_AGENT_UNITS: 'radarr', VALET_AGENT_ALLOW: '10.9.9.9,192.0.2.0/24' });
  assert.equal((await far.get('/v1/units')).status, 403); assert.equal((await fetch(`${far.base}/health`)).status, 403);
  const near = await start({ VALET_AGENT_UNITS: 'radarr', VALET_AGENT_ALLOW: '127.0.0.0/8' });
  assert.equal((await near.get('/v1/units')).status, 200); assert.equal((await near.get('/v1/units', 'wrong')).status, 401);
});

test('agent: it only reads', { skip: !python }, async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(`${base}/services`, { method, headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405, method);
  const source = await readFile('agent/valet-agent.py', 'utf8');
  for (const verb of ['"start"', '"stop"', '"restart"', 'shell=True', 'os.system']) assert.ok(!source.includes(verb), verb);
  // one way to run a program, and the only programs are systemctl show and journalctl
  assert.equal(source.match(/subprocess\.(?!TimeoutExpired)\w+/g)?.join(), 'subprocess.run');
  assert.deepEqual(source.match(/(?<![.\w])run\([^)]*/g), ['run(cmd', 'run(["systemctl", *flags, "show", *[scope(u', 'run(cmd']);   // its definition, then the two calls
  assert.deepEqual(source.match(/cmd = \[[^\]]*/g), ['cmd = ["journalctl", *flags, "-u", name, "-n", str(lines), "--no-pager", "-o", "short-iso"']);
  for (const word of ['"enable"', '"disable"', '"kill"', '"mask"', '"edit"', '"set-property"', '--vacuum', '--rotate', '--flush', 'Popen', 'os.exec', 'os.spawn', 'os.popen', 'eval(', 'exec(', '__import__', 'pickle', 'ctypes']) assert.ok(!source.includes(word), word);
  // one way to Docker, and it says GET; nothing else opens a connection
  assert.deepEqual(source.match(/\.request\([^)]*\)/g), ['.request("GET", path)']);
  for (const word of ['"POST"', '"PUT"', '"DELETE"', '"PATCH"', 'urllib.request', 'urlopen', '/exec', '/start', '/stop', '/kill', '/create', '/restart']) assert.ok(!source.includes(word), word);
  // one way to a file, and it's opened for reading; nothing that writes, moves or removes one
  assert.deepEqual(source.match(/\bopen\([^)]*\)/g), ['open(ROOT + path, "rb")']);
  for (const word of ['os.remove', 'os.unlink', 'os.rename', 'os.replace', 'os.mkdir', 'os.makedirs', 'os.rmdir', 'os.chmod', 'os.chown', 'os.truncate', 'os.open', 'os.write', 'os.kill', 'shutil', 'tempfile', 'pathlib', 'write_text', 'write_bytes'])
    assert.ok(!source.includes(word), word);
  // Python's standard library and nothing else
  const std = ['fnmatch', 'functools', 'hmac', 'http.client', 'ipaddress', 'json', 'os', 're', 'socket', 'subprocess', 'sys', 'threading', 'time', 'concurrent.futures', 'http.server', 'urllib.parse'];
  for (const m of source.matchAll(/^(?:import (.+)|from (\S+) import .+)$/gm)) for (const name of (m[1] ?? m[2]).split(',').map(s => s.trim())) assert.ok(std.includes(name), `imports ${name}`);
});

test('agent: won\'t start without a real token, something to report, or with a setting it can\'t trust', { skip: !python }, () => {
  const run = (env: object) => spawnSync('python3', ['agent/valet-agent.py'], { env: { ...process.env, VALET_AGENT_BIND: '127.0.0.1:0', ...env }, timeout: 30_000 }).status;   // a cap: a busy machine can take seconds to start Python
  assert.equal(run({ VALET_AGENT_TOKEN: 'short', VALET_AGENT_UNITS: 'radarr' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: '' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: 'radarr;reboot' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_METRICS: '1', VALET_AGENT_MOUNTS: '/mnt/../etc' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_METRICS: '1', VALET_AGENT_MOUNTS: 'relative' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_DOCKER: 'tcp://10.0.0.1:2375' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_DOCKER: 'http://proxy:2375/v1.41/containers/create?' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: 'radarr', VALET_AGENT_ALLOW: 'everyone' }), 1);
});
