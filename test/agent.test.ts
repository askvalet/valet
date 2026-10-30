// The agent for real, against stand-ins for systemctl and journalctl: what it refuses matters more than what it answers.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, test } from 'node:test';

const python = spawnSync('python3', ['--version']).status === 0;
const dir = await mkdtemp(join(tmpdir(), 'valet-agent-')), log = join(dir, 'calls');
const TOKEN = 'a-token-that-is-long-enough-to-use', PORT = 17576 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${PORT}`;
let agent: ReturnType<typeof spawn> | undefined;

before(async () => {
  if (!python) return;
  // stand-ins that record how they were called
  await writeFile(join(dir, 'systemctl'), `#!/bin/sh\necho "$@" >> ${log}\ncat <<X\nActiveState=failed\nSubState=failed\nResult=exit-code\nNRestarts=3\nExecMainStatus=137\nMemoryCurrent=[not set]\nDescription=Radarr\nX\n`);
  await writeFile(join(dir, 'journalctl'), `#!/bin/sh\necho "$@" >> ${log}\nprintf '%s\\n' 'Oct 30 ok fine' 'Oct 30 ERROR out of memory'\n`);
  await chmod(join(dir, 'systemctl'), 0o755); await chmod(join(dir, 'journalctl'), 0o755);
  agent = spawn('python3', ['agent/valet-agent.py'], { stdio: 'ignore', env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: 'radarr,user:ninfer', VALET_AGENT_BIND: `127.0.0.1:${PORT}` } });
  for (let i = 0; i < 50; i++) { if (await fetch(`${base}/health`).then(r => r.ok, () => false)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('agent did not start');
});
after(() => { agent?.kill(); });
const get = (path: string, token = TOKEN) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });

test('agent: no token, no answer', { skip: !python }, async () => {
  assert.equal((await fetch(`${base}/services`)).status, 401);
  assert.equal((await get('/services', 'wrong')).status, 401);
  assert.equal((await get('/logs?unit=radarr', 'x'.repeat(TOKEN.length))).status, 401);
  assert.equal((await fetch(`${base}/health`)).status, 200);                  // alive is all this says
});

test('agent: reports listed services, user ones with --user', { skip: !python }, async () => {
  const j: any = await (await get('/services')).json();
  assert.deepEqual(j.services.map((s: any) => [s.unit, s.state, s.restarts, s.exitStatus, s.memoryBytes]), [['radarr', 'failed', 3, 137, null], ['user:ninfer', 'failed', 3, 137, null]]);
  const calls = await readFile(log, 'utf8');
  assert.match(calls, /^show radarr/m); assert.match(calls, /^--user show ninfer/m);
});

test('agent: logs only for listed services, nothing unchecked reaches journalctl', { skip: !python }, async () => {
  const j: any = await (await get('/logs?unit=radarr&match=error')).json();
  assert.deepEqual(j.lines, ['Oct 30 ERROR out of memory']);
  await writeFile(log, '');
  for (const unit of ['ssh', 'sshd.service', 'radarr --since yesterday', '../etc', '-k', '*']) assert.equal((await get(`/logs?unit=${encodeURIComponent(unit)}`)).status, 404, unit);
  assert.equal(await readFile(log, 'utf8'), '');
  assert.equal((await get('/logs?unit=radarr&lines=lots')).status, 400);
  await get('/logs?unit=radarr&lines=999999');
  assert.match(await readFile(log, 'utf8'), /-n 2000/);                       // capped
});

test('agent: it only reads', { skip: !python }, async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(`${base}/services`, { method, headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405, method);
  const source = await readFile('agent/valet-agent.py', 'utf8');
  for (const verb of ['"start"', '"stop"', '"restart"', 'shell=True', 'os.system']) assert.ok(!source.includes(verb), verb);
});

test('agent: won\'t start without a real token or a list of services', { skip: !python }, () => {
  const run = (env: object) => spawnSync('python3', ['agent/valet-agent.py'], { env: { ...process.env, VALET_AGENT_BIND: '127.0.0.1:0', ...env }, timeout: 3000 }).status;
  assert.equal(run({ VALET_AGENT_TOKEN: 'short', VALET_AGENT_UNITS: 'radarr' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: '' }), 1);
  assert.equal(run({ VALET_AGENT_TOKEN: TOKEN, VALET_AGENT_UNITS: 'radarr;reboot' }), 1);
});
