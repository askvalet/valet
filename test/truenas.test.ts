// TrueNAS against a made-up TrueNAS on localhost that speaks JSON-RPC 2.0 over a WebSocket at /api/current, as 24.10 and
// later do, and the old REST API when told to: signing in with auth.login_ex and with the older call, a bad key, each
// call's answer becoming the same card and backup jobs as before, a server that hangs, an install too old for the
// WebSocket, one too new for REST, and the key never reaching an error or a log line. The server's half of the protocol
// is written here on its own, so the client isn't only checked against itself.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'node:test';
import { makeContext, setHouse, type Context } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { registry } from '../src/integrations/index.ts';
import truenas, { limits, socketOf } from '../src/integrations/truenas.ts';
import { Frames, frame, jsonrpc, RpcError, Unreachable } from '../src/server/jsonrpc.ts';
setHouse({ locale: 'en-US' });

const KEY = '7-sampleSecretKeyThatMustNeverShowUp', USER = 'valet';
// what TrueNAS answers each call with, made up; dates are { $date: ms } on the WebSocket as on REST
const ANSWERS: Record<string, unknown> = {
  'system.info': { hostname: 'nas', version: 'TrueNAS-25.10.1', loadavg: [0.42, 0.5, 0.48], uptime_seconds: 864000.5 },
  'alert.list': [{ level: 'WARNING', dismissed: false }, { level: 'INFO', dismissed: true }],
  'pool.query': [{ name: 'tank', healthy: true, status: 'ONLINE', size: 8000000000000, allocated: 2000000000000, free: 6000000000000 }, { name: 'fast', healthy: true, status: 'ONLINE', size: 2000000000000, allocated: 500000000000, free: 1500000000000 }],
  'cloudsync.query': [{ id: 1, description: 'Photos to B2', enabled: true, job: { state: 'SUCCESS', time_started: { $date: 1793390000000 }, time_finished: { $date: 1793393600000 } } },
    { id: 2, description: 'Documents to S3', enabled: true, job: { state: 'FAILED', time_finished: { $date: 1793395000000 }, error: 'Access denied' } }, { id: 3, description: 'Old', enabled: false, job: null }],
  'replication.query': [{ id: 1, name: 'tank to backup box', enabled: true, state: { state: 'FINISHED', datetime: { $date: 1793380000000 } }, job: null }],
};
const REST: Record<string, string> = { '/api/v2.0/system/info': 'system.info', '/api/v2.0/alert/list': 'alert.list', '/api/v2.0/pool': 'pool.query', '/api/v2.0/cloudsync': 'cloudsync.query', '/api/v2.0/replication': 'replication.query' };

interface Fake {
  socket?: false | 'hang';                 // no WebSocket (an old install), or one that never answers
  loginEx?: boolean;                       // auth.login_ex exists (default)
  legacy?: boolean;                        // auth.login_with_api_key exists (default)
  legacyFalse?: boolean;                   // 24.10's way of refusing a key: false, not an error
  rest?: false | 404 | 410;                // REST answers (default), or is gone
  deny?: string[];                         // methods this key may not call
  busy?: boolean;                          // its rate limit on new connections
}
async function nas(o: Fake = {}) {
  const heard: { method: string; params: any[] }[] = [], restHeard: { path: string; auth?: string }[] = [];
  const server = createServer((req, res) => {
    const method = REST[req.url ?? ''];
    restHeard.push({ path: req.url ?? '', auth: req.headers.authorization });
    if (o.rest === false || !method) { res.writeHead(o.rest === false ? 404 : 404).end(); return; }
    if (typeof o.rest === 'number') { res.writeHead(o.rest).end(); return; }
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(ANSWERS[method]));
  });
  const sockets = new Set<Socket>(), emptied: (() => void)[] = [];
  let upgrades = 0;
  server.on('connection', s => { sockets.add(s); s.on('close', () => { sockets.delete(s); if (!sockets.size) emptied.splice(0).forEach(f => f()); }); });
  server.on('upgrade', (req: IncomingMessage, sock: Socket) => {
    upgrades++;
    if (o.socket === false || req.url !== '/api/current') { sock.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let authed = false;
    const answer = (id: number, body: object) => sock.write(serverFrame(1, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, ...body }))));
    const error = (id: number, code: number, message: string, errname?: string) => answer(id, { error: { code, message, data: errname ? { errname } : undefined } });
    const read = clientFrames();
    sock.on('error', () => {});
    sock.on('data', chunk => { for (const f of read(chunk)) {
      if (f.opcode === 8) { sock.end(serverFrame(8, Buffer.alloc(0))); return; }
      if (f.opcode !== 1) continue;
      const m = JSON.parse(f.data.toString());
      heard.push({ method: m.method, params: m.params });
      if (o.socket === 'hang') continue;
      if (o.busy && m.method.startsWith('auth.')) { error(m.id, -32001, '[EBUSY] Rate Limit Exceeded', 'EBUSY'); continue; }
      if (m.method === 'auth.login_ex') {
        if (o.loginEx === false) { error(m.id, -32601, 'Method not found'); continue; }
        const p = m.params[0] ?? {};
        authed = p.mechanism === 'API_KEY_PLAIN' && p.username === USER && p.api_key === KEY;
        answer(m.id, { result: authed ? { response_type: 'SUCCESS', user_info: null } : { response_type: 'AUTH_ERR' } });
      } else if (m.method === 'auth.login_with_api_key') {
        if (o.legacy === false) { error(m.id, -32601, 'Method not found'); continue; }
        authed = m.params[0] === KEY;
        if (authed || o.legacyFalse) answer(m.id, { result: authed });
        else error(m.id, -32001, '[EINVAL] auth.login_with_api_key: Invalid API key', 'EINVAL');
      } else if (!authed) error(m.id, -32001, '[ENOTAUTHENTICATED] Authentication required', 'ENOTAUTHENTICATED');
      else if (o.deny?.includes(m.method)) error(m.id, -32001, '[EACCES] Not authorized', 'EACCES');
      else if (m.method in ANSWERS) answer(m.id, { result: ANSWERS[m.method] });
      else error(m.id, -32601, 'Method not found');
    } });
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, port, heard, restHeard, upgrades: () => upgrades,
    /** resolves once every connection to it has closed */
    idle: () => new Promise<void>(ok => sockets.size ? emptied.push(ok) : ok()), close: () => new Promise<void>(ok => { for (const s of sockets) s.destroy(); server.close(() => ok()); }) };
}

/** the server's half: frames unmasked going out, masked coming in, and nothing borrowed from the client's code */
function serverFrame(opcode: number, payload: Buffer) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}
function clientFrames() {
  let buf = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const out: { opcode: number; data: Buffer }[] = [];
    for (;;) {
      if (buf.length < 2) break;
      assert.ok(buf[1] & 0x80, 'a client masks every frame');
      let n = buf[1] & 0x7f, at = 2;
      if (n === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); at = 4; } else if (n === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (buf.length < at + 4 + n) break;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + n));
      for (let i = 0; i < n; i++) data[i] ^= mask[i % 4];
      out.push({ opcode: buf[0] & 0x0f, data });
      buf = buf.subarray(at + 4 + n);
    }
    return out;
  };
}

const logs: string[] = [], errors: string[] = [];
function context(): Context { const c = makeContext('nas'); c.log = (...a) => { logs.push(a.map(String).join(' ')); }; return c; }
const make = (cfg: Record<string, unknown>) => truenas.create(truenas.config.parse({ key: KEY, ...cfg }), context());
const fetchCard = (inst: ReturnType<typeof make>) => inst.widgets.status.fetch() as Promise<any>;
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  try { await p; } catch (e) { errors.push((e as Error).message); assert.match((e as Error).message, pattern); return (e as Error).message; }
  assert.fail(`expected an error like ${pattern}`);
}
const shows = (card: any) => Object.fromEntries(card.items.map((i: any) => [i.label, String(i.value)]));
// what the REST service() showed for the same answers, before this was a full integration
const BEFORE = { 'Pools healthy': '2 / 2', 'Pools used': '25%', Alerts: '1', Load: '0.42', Uptime: '10d' };
const JOBS = [['Photos to B2', 'ok', 1793393600000], ['Documents to S3', 'failed', undefined], ['tank to backup box', 'ok', 1793380000000]];

test('truenas: a full integration under its old type, taking every option it took before', () => {
  assert.equal(registry.truenas, truenas);
  assert.ok(!('def' in registry.truenas), 'no longer a service()');
  for (const cfg of [{ url: 'https://10.0.0.5', key: 'k' }, { url: 'https://10.0.0.5', key: 'k', href: 'https://nas.example', every: '5m', insecure: true }, { url: 'https://10.0.0.5', key: 'k', username: 'admin' }])
    assert.ok(truenas.config.safeParse(cfg).success, JSON.stringify(cfg));
  assert.ok(!truenas.config.safeParse({ url: 'https://10.0.0.5' }).success, 'a key is needed');
  assert.ok(!truenas.config.safeParse({ url: 'https://10.0.0.5', key: 'k', typo: 1 }).success, 'unknown options are refused, as before');
  assert.equal(socketOf('https://10.0.0.5'), 'wss://10.0.0.5/api/current');
  assert.equal(socketOf('http://10.0.0.5:8080/'), 'ws://10.0.0.5:8080/api/current');
  assert.equal(socketOf('https://10.0.0.5/nas/'), 'wss://10.0.0.5/nas/api/current');
});

test('truenas: signs in with auth.login_ex and the key\'s user, then asks everything on one connection', async () => {
  const s = await nas();
  try {
    const inst = make({ url: s.url, username: USER, href: 'https://nas.example' }), card = await fetchCard(inst);
    assert.ok(checkCard(card).success);
    assert.deepEqual(shows(card), BEFORE);
    assert.equal(card.href, 'https://nas.example'); assert.equal(card.title, 'TrueNAS'); assert.deepEqual(card.summary, { label: 'TrueNAS', icon: 'disk', value: '2 / 2', sub: 'Pools healthy' });
    assert.deepEqual(s.heard.map(h => h.method), ['auth.login_ex', 'system.info', 'alert.list', 'pool.query']);
    assert.deepEqual(s.heard[0].params, [{ mechanism: 'API_KEY_PLAIN', username: USER, api_key: KEY }]);
    assert.equal(s.restHeard.length, 0, 'REST is never asked when the WebSocket answers');

    const jobs = await inst.backups!();
    assert.deepEqual(jobs.map(j => [j.name, j.result, j.lastSuccess]), JOBS);
    assert.equal(jobs[1].error, 'Access denied'); assert.equal(jobs[0].source, 'TrueNAS cloud sync'); assert.equal(jobs[2].source, 'TrueNAS replication');
    assert.ok(jobs.every(j => j.href === 'https://nas.example'));
    assert.deepEqual(s.heard.slice(4).map(h => h.method), ['auth.login_ex', 'cloudsync.query', 'replication.query']);

    const tool = await inst.tools!.truenas_status.run({}, undefined as any);
    assert.deepEqual(shows((tool as any).card), BEFORE);
  } finally { s.close(); }
});

test('truenas: auth.login_with_api_key where login_ex doesn\'t exist, and for a config with just a key', async () => {
  const s = await nas({ loginEx: false });
  try {
    assert.deepEqual(shows(await fetchCard(make({ url: s.url, username: USER }))), BEFORE);
    assert.deepEqual(s.heard.slice(0, 2).map(h => h.method), ['auth.login_ex', 'auth.login_with_api_key']);
    assert.deepEqual(s.heard[1].params, [KEY]);
  } finally { s.close(); }
  const t = await nas(), before = logs.length;
  try {
    const inst = make({ url: t.url });
    assert.deepEqual(shows(await fetchCard(inst)), BEFORE);
    await fetchCard(inst);
    assert.deepEqual(t.heard.filter(h => h.method.startsWith('auth.')).map(h => h.method), ['auth.login_with_api_key', 'auth.login_with_api_key'], 'no user, so no login_ex');
    assert.equal(logs.slice(before).filter(l => /username/.test(l)).length, 1, 'says once how to be ready for TrueNAS 27');
  } finally { t.close(); }
  const u = await nas({ legacy: false });
  try { await rejects(fetchCard(make({ url: u.url })), /signs in only with auth\.login_ex.*`username:`/); } finally { u.close(); }
});

test('truenas: a bad key is "TrueNAS refused the API key", however the version says it, nothing more is asked, and a rate limit isn\'t a bad key', async () => {
  const s = await nas();
  try {
    await rejects(fetchCard(make({ url: s.url, username: USER, key: 'wrong' })), /^TrueNAS refused the API key for valet/);
    await rejects(fetchCard(make({ url: s.url, key: 'wrong' })), /^TrueNAS refused the API key$/);
    assert.deepEqual(s.heard.map(h => h.method), ['auth.login_ex', 'auth.login_with_api_key'], 'no data asked for after a refusal');
    assert.equal(s.restHeard.length, 0, 'a refused key doesn\'t send it to REST as well');
  } finally { s.close(); }
  const old = await nas({ legacyFalse: true });
  try { await rejects(fetchCard(make({ url: old.url, key: 'wrong' })), /^TrueNAS refused the API key$/); } finally { old.close(); }
  const busy = await nas({ busy: true });
  try { await rejects(fetchCard(make({ url: busy.url, username: USER })), /rate limit/); await rejects(fetchCard(make({ url: busy.url })), /rate limit/); } finally { busy.close(); }
});

test('truenas: a call the key may not make leaves an optional part out, and a needed one says which', async () => {
  const s = await nas({ deny: ['pool.query', 'replication.query'] });
  try {
    const inst = make({ url: s.url, username: USER }), card = await fetchCard(inst);
    assert.equal(shows(card)['Pools healthy'], '0 / 0'); assert.equal(shows(card).Alerts, '1');
    assert.deepEqual((await inst.backups!()).map(j => j.name), ['Photos to B2', 'Documents to S3']);
  } finally { s.close(); }
  const t = await nas({ deny: ['system.info'] });
  try { await rejects(fetchCard(make({ url: t.url, username: USER })), /couldn't answer system\.info: \[EACCES\]/); } finally { t.close(); }
});

test('truenas: a WebSocket that never answers gives up within the timeout and leaves no socket behind', async () => {
  const s = await nas({ socket: 'hang' }), was = limits.timeout;
  limits.timeout = 300;
  try {
    const started = Date.now();
    await rejects(fetchCard(make({ url: s.url, username: USER })), /stopped answering/);
    assert.ok(Date.now() - started < 3000);
    assert.equal(s.restHeard.length, 0, 'a WebSocket that opened isn\'t an old install');
    await s.idle();
  } finally { limits.timeout = was; s.close(); }
});

test('truenas: an install without the WebSocket is asked over REST, the same card and jobs, and keeps to REST for a while', async () => {
  const s = await nas({ socket: false });
  try {
    const inst = make({ url: s.url, username: USER });
    assert.deepEqual(shows(await fetchCard(inst)), BEFORE);
    assert.deepEqual((await inst.backups!()).map(j => [j.name, j.result, j.lastSuccess]), JOBS);
    assert.deepEqual(s.restHeard.map(r => r.path).sort(), [...Object.keys(REST)].sort());
    assert.ok(s.restHeard.every(r => r.auth === `Bearer ${KEY}`));
    assert.equal(s.heard.length, 0);
    assert.equal(s.upgrades(), 1, 'once it has said there\'s no WebSocket, it isn\'t asked again for a while');
  } finally { s.close(); }
});

test('truenas: TrueNAS 26 answering REST with 404 or 410 points at the WebSocket; a host that isn\'t there isn\'t asked twice', async () => {
  for (const status of [404, 410] as const) {
    const s = await nas({ socket: false, rest: status });
    try { await rejects(fetchCard(make({ url: s.url, username: USER })), new RegExp(`no REST API here \\(it answered ${status}\\), as from TrueNAS 26, and its WebSocket at ws://127\\.0\\.0\\.1:${s.port}/api/current wouldn't open`)); } finally { s.close(); }
  }
  const s = await nas();
  await s.close();
  await rejects(fetchCard(make({ url: s.url, username: USER })), /^Can't reach TrueNAS's WebSocket at ws:\/\/127\.0\.0\.1:\d+\/api\/current: 127\.0\.0\.1:\d+: ECONNREFUSED/);
});

test('truenas: the key never appears in an error or a log line', () => {
  assert.ok(errors.length >= 8, `errors seen: ${errors.length}`);
  for (const line of [...errors, ...logs]) assert.ok(!line.includes(KEY) && !line.includes(KEY.slice(2)), line);
});

test('jsonrpc: fragments joined, pings answered, and a masked, oversized or broken frame ends it', async () => {
  const masked = new Frames(1024, true), plain = new Frames(1024);
  const text = Buffer.from('{"jsonrpc":"2.0","id":1,"result":true}');
  assert.deepEqual(masked.push(frame(1, text)).map(f => f.data.toString()), [text.toString()]);
  const a = serverFrame(1, text.subarray(0, 10)); a[0] &= 0x7f;   // not the last fragment
  const b = serverFrame(0, text.subarray(10));
  assert.deepEqual(plain.push(Buffer.concat([a, serverFrame(9, Buffer.from('hi'))])).map(f => f.opcode), [9], 'a ping between fragments comes at once');
  assert.deepEqual(plain.push(b.subarray(0, 3)), [], 'half a frame waits');
  assert.deepEqual(plain.push(b.subarray(3)).map(f => f.data.toString()), [text.toString()]);
  assert.throws(() => new Frames(1024).push(frame(1, text)), /masked/);
  assert.throws(() => new Frames(16).push(serverFrame(1, text)), /too large/);
  assert.throws(() => new Frames(1024).push(serverFrame(0, text)), /continuation of nothing/);
  const big = Buffer.alloc(70_000, 97);
  assert.equal(new Frames(1e6, true).push(frame(1, big))[0].data.length, 70_000);
});

test('jsonrpc: an HTTP answer that isn\'t 101 is Unreachable with its status; an error answer is an RpcError', async () => {
  const s = await nas({ socket: false });
  try {
    const e = await jsonrpc(`ws://127.0.0.1:${s.port}/api/current`, { timeout: 2000 }, async () => 1).catch(x => x);
    assert.ok(e instanceof Unreachable); assert.equal(e.status, 404);
  } finally { s.close(); }
  const t = await nas();
  try {
    const e = await jsonrpc(`ws://127.0.0.1:${t.port}/api/current`, { timeout: 2000 }, c => c.call('system.info')).catch(x => x);
    assert.ok(e instanceof RpcError); assert.match(e.message, /Authentication required/);
    assert.deepEqual(await jsonrpc(`ws://127.0.0.1:${t.port}/api/current`, { timeout: 2000 }, async c => [await c.call('auth.login_with_api_key', [KEY]), (await c.call('system.info')).hostname]), [true, 'nas']);
  } finally { t.close(); }
});
