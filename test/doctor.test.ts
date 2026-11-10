// The doctor: it only looks, it never prints a secret, and each failure comes with something to do about it.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { Integration } from '../src/server/core.ts';
import { advise, doctor, doctorCommand, render, type Finding } from '../src/server/doctor.ts';
import http from '../src/integrations/http.ts';

// A made-up service. Its card fails the way `mode` says; everything that isn't a card counts how often it was touched.
const touched = { fetch: 0, other: 0 };
const failure = (code: string, more: object = {}) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code, ...more }) });
const FAILS: Record<string, (cfg: { url: string; key: string }) => Error> = {
  refused: () => failure('ECONNREFUSED', { address: '10.0.0.9', port: 8989 }),
  dns: () => failure('ENOTFOUND', { hostname: 'shelf' }),
  tls: () => failure('DEPTH_ZERO_SELF_SIGNED_CERT'),
  slow: () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
  denied: cfg => new Error(`${new URL(cfg.url).host} answered 401`),
  lost: cfg => new Error(`${new URL(cfg.url).host} answered 404`),
  leak: cfg => new Error(`GET ${cfg.url}/api?apikey=${cfg.key} failed: the key ${cfg.key} was refused`),
};
const shelf: Integration = {
  type: 'shelf', name: 'Shelf',
  config: z.object({ url: z.string().url(), key: z.string(), mode: z.string().default('ok'), insecure: z.boolean().optional() }),
  create(cfg: { url: string; key: string; mode: string }) {
    const card = async () => { touched.fetch++; if (FAILS[cfg.mode]) throw FAILS[cfg.mode](cfg); return { type: 'stats', title: 'Shelf', items: [{ label: 'Books', value: 3 }] } as any; };
    const other = async () => { touched.other++; return { data: {} } as any; };
    return {
      widgets: { status: { title: 'Shelf', fetch: card }, recent: { title: 'Recent', fetch: card } },
      actions: { wipe: { description: 'Removes every book', input: z.object({}), run: other } },
      tools: { look: { description: 'Lists books', access: 'read', input: z.object({}), run: other }, add: { description: 'Adds a book', access: 'write', input: z.object({}), run: other }, burn: { description: 'Removes a book', access: 'control', input: z.object({}), run: other } },
      commands: () => { touched.other++; return []; }, image: other, recap: other, backups: other, reminders: other, onChat: () => { touched.other++; },
    };
  },
};
const registry = () => ({ shelf, http } as Record<string, Integration>);

async function setup(yaml: string) {
  const dir = await mkdtemp(join(tmpdir(), 'valet-doctor-')), path = join(dir, 'config', 'config.yaml'), data = join(dir, 'data');
  await mkdir(join(dir, 'config')); await mkdir(data);
  await writeFile(path, yaml);
  return { dir, path, data };
}
/** A stand-in for the network: answers by host, and remembers every request it was asked to make. */
function net(answers: Record<string, (url: URL, init: RequestInit) => Response | Promise<Response>>) {
  const seen: { url: string; method: string; body?: string }[] = [];
  const get = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    seen.push({ url: url.href, method: init.method ?? 'GET', body: init.body == null ? undefined : String(init.body) });
    const answer = answers[url.host];
    if (!answer) throw failure('ENOTFOUND', { hostname: url.hostname });
    return answer(url, init);
  }) as typeof fetch;
  return { get, seen };
}
const models = (...ids: string[]) => () => Response.json({ data: ids.map(id => ({ id })) });
const by = (f: Finding[], check: string) => f.find(x => x.check.startsWith(check));

test('doctor: a healthy install passes, fetching each placed widget once and touching nothing else', async () => {
  const { path, data } = await setup(`
auth: { mode: none, trustNetwork: true }
allowedHosts: [home.example.com]
integrations:
  books: { type: shelf, url: "http://shelf:8080", key: abc }
  spare: { type: shelf, url: "http://spare:8080", key: abc }
assistant: { baseURL: "http://models:11434/v1", model: small-one }
notify: { channels: [{ type: ntfy, url: "https://ntfy.example.com/my-topic" }] }
layout: [{ title: Home, widgets: [books.status, books.recent] }]
`);
  touched.fetch = touched.other = 0;
  const { get, seen } = net({ 'models:11434': models('small-one', 'big-one'), 'ntfy.example.com': () => new Response('ok') });
  const found = await doctor({ path, data, registry: registry(), fetch: get });
  assert.deepEqual(found.filter(f => f.status === 'fail' || f.status === 'warn'), []);
  assert.equal(touched.fetch, 3);                          // both placed cards, and the first card of the one that isn't on the page
  assert.equal(touched.other, 0);                          // no action, no tool (not even a read one), no command, image, recap, backup or reminder
  assert.match(by(found, 'books (Shelf)')!.check, /2 widgets$/);
  assert.match(by(found, 'spare (Shelf)')!.check, /none of them on the page/);
  assert.match(by(found, 'assistant')!.check, /small-one on models:11434/);
  // a channel is asked whether its host is there, and nothing is posted to it
  assert.deepEqual(seen.map(s => `${s.method} ${s.url}`).sort(), ['GET http://models:11434/v1/models', 'GET https://ntfy.example.com/']);
  assert.match(render(found), /Nothing is wrong\.$/);
});

test('doctor: no secret is ever printed, from an error, an address or the config', async () => {
  process.env.VALET_T_SHELF_KEY = 'shelf-key-9f8e7d6c5b4a'; process.env.VALET_T_MODEL_KEY = 'model-key-1a2b3c4d5e6f';
  const { path, data } = await setup(`
integrations:
  books: { type: shelf, url: "http://shelf:8080", key: "\${VALET_T_SHELF_KEY}", mode: leak }
  inline: { type: shelf, url: "http://reader:written-in-the-file@shelf2:8080", key: k, mode: refused }
assistant: { baseURL: "http://models:11434/v1", apiKey: "\${VALET_T_MODEL_KEY}", model: small-one }
layout: [{ widgets: [books.status, inline.status] }]
`);
  const { get } = net({ 'models:11434': (_, init) => { throw new Error(`bad Authorization: ${new Headers(init.headers).get('authorization')}`); } });
  const found = await doctor({ path, data, registry: registry(), fetch: get }), all = JSON.stringify(found) + render(found);
  assert.equal(by(found, 'books (Shelf)')!.status, 'fail');
  assert.equal(by(found, 'assistant')!.status, 'fail');
  for (const secret of ['shelf-key-9f8e7d6c5b4a', 'model-key-1a2b3c4d5e6f', 'written-in-the-file']) assert.ok(!all.includes(secret), secret);
  assert.match(all, /•••/);
});

test('doctor: every unset variable is named with where it is used, and what waits on one is left alone', async () => {
  delete process.env.VALET_T_UNSET_KEY; delete process.env.VALET_T_UNSET_TOKEN; delete process.env.VALET_T_UNSET_URL;
  const { path, data } = await setup(`
integrations:
  books: { type: shelf, url: "http://shelf:8080", key: "\${VALET_T_UNSET_KEY}" }
  spare: { type: shelf, url: "http://spare:8080", key: abc }
mcpServer: { token: "\${VALET_T_UNSET_TOKEN}" }
notify: { channels: [{ type: discord, url: "\${VALET_T_UNSET_URL}" }] }
layout: [{ widgets: [books.status, spare.status] }]
`);
  touched.fetch = 0;
  const { get, seen } = net({});
  const found = await doctor({ path, data, registry: registry(), fetch: get });
  for (const [name, where] of [['VALET_T_UNSET_KEY', 'integrations.books.key'], ['VALET_T_UNSET_TOKEN', 'mcpServer.token'], ['VALET_T_UNSET_URL', 'notify.channels.0.url']]) {
    const f = by(found, `\${${name}}`)!;
    assert.equal(f.status, 'fail'); assert.ok(f.problem!.includes(where), f.problem); assert.match(f.fix!, new RegExp(`${name}=`));
  }
  assert.equal(found.filter(f => f.status === 'fail').length, 3);   // nothing else is blamed for what a missing value caused
  assert.equal(touched.fetch, 1); assert.ok(by(found, 'spare (Shelf)')); assert.equal(by(found, 'books (Shelf)'), undefined);
  assert.deepEqual(seen, []);                                       // and a stand-in address is never asked
});

test('doctor: a failure becomes advice about the thing to look at', async () => {
  const { path, data } = await setup(`
integrations:
${['refused', 'dns', 'tls', 'slow', 'denied', 'lost'].map(m => `  ${m}: { type: shelf, url: "http://${m}:8080", key: k, mode: ${m} }`).join('\n')}
layout: [{ widgets: [refused.status, dns.status, tls.status, slow.status, denied.status, lost.status, denied.recent] }]
`);
  const found = await doctor({ path, data, registry: registry(), fetch: net({}).get });
  const said = (id: string) => { const f = by(found, `${id} (Shelf)`)!; assert.equal(f.status, 'fail', id); return `${f.problem} | ${f.fix}`; };
  assert.match(said('refused'), /nothing answers at refused:8080 .*the port.*container name/);
  assert.match(said('dns'), /the name dns:8080 can't be found .*spelling/);
  assert.match(said('tls'), /certificate of tls:8080 .*insecure: true/);
  assert.match(said('slow'), /slow:8080 didn't answer in time/);
  assert.match(said('denied'), /denied:8080 refused its key, token or password \(401\) .*\.env/);
  assert.match(said('lost'), /lost:8080 answered 404.*base address/);
  assert.equal(found.filter(f => f.check.startsWith('denied')).length, 1);   // one cause, said once for both its widgets
  // the same reading for the shapes other parts of Valet throw
  assert.match(advise(new Error('403'), { url: 'https://api.example.com/v1', key: 'apiKey' }).fix, /read permission/);
  assert.match(advise(new Error('Shelf didn\'t send JSON: is the url right?')).problem, /isn't its API/);
  assert.match(advise(new Error('Shelf refused the sign-in (401)')).problem, /refused its key, token or password/);
  assert.match(advise(failure('ERR_SSL_WRONG_VERSION_NUMBER'), { url: 'https://nas:5000' }).fix, /http:\/\//);
  assert.match(advise(new Error('connect ECONNREFUSED 127.0.0.1:8989')).problem, /nothing answers/);
  assert.match(advise(new Error('nas answered 502')).problem, /nas failed on its own side \(502\)/);
});

test('doctor: a status check\'s targets that don\'t answer are a warning, not a failure of the card', async () => {
  const { path, data } = await setup(`
integrations:
  up: { type: http, targets: [{ name: Router, url: "http://router.test" }, { name: Printer, url: "http://printer.test" }, { name: Lab, url: "http://lab.test", quiet: true }] }
layout: [{ widgets: [up.status] }]
`);
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => { if (String(url).includes('router')) return new Response('ok'); throw failure('ECONNREFUSED'); }) as typeof fetch;
  try {
    const f = by(await doctor({ path, data, registry: registry(), fetch: net({}).get }), 'up (Service status)')!;
    assert.equal(f.status, 'warn'); assert.match(f.problem!, /Printer/); assert.doesNotMatch(f.problem!, /Router|Lab/);
  } finally { globalThis.fetch = real; }
});

test('doctor: the assistant\'s server, its model, a model choice, voice and the Telegram bot', async () => {
  const { path, data } = await setup(`
assistant:
  baseURL: "http://models:11434/v1"
  model: missing-one
  models: [{ name: Other, model: far-one, baseURL: "http://far:8000/v1", apiKey: far-key-123456 }]
  telegram: { token: "123456:made-up-token-made-up-token-made-up", users: [1] }
voice: { stt: { baseURL: "http://speech:8000/v1" }, tts: { baseURL: "http://gone:8000/v1" } }
`);
  const { get, seen } = net({ 'models:11434': models('small-one'), 'far:8000': () => new Response('no', { status: 401 }), 'speech:8000': () => new Response('{}'), 'api.telegram.org': () => Response.json({ ok: true, result: { username: 'made_up_bot' } }) });
  const found = await doctor({ path, data, registry: registry(), fetch: get });
  const main = by(found, 'assistant')!, other = by(found, 'assistant.models "Other"')!;
  assert.equal(main.status, 'warn'); assert.match(main.problem!, /doesn't list "missing-one"/); assert.match(main.fix!, /small-one/);
  assert.equal(other.status, 'fail'); assert.match(other.problem!, /far:8000 refused apiKey \(401\)/);
  assert.equal(by(found, 'voice.stt')!.status, 'ok');
  assert.equal(by(found, 'voice.tts')!.status, 'fail');
  assert.match(by(found, 'assistant.telegram')!.check, /@made_up_bot/);
  assert.ok(seen.every(s => s.method === 'GET'));                    // looking only: no completion, no speech, no message
  assert.ok(!(JSON.stringify(found) + render(found)).includes('made-up-token'));
});

test('doctor: notification channels are checked by shape and host; only --send-test sends, once, and says it is a test', async () => {
  const { path, data } = await setup(`
notify:
  channels:
    - { type: ntfy, url: "https://ntfy.example.com/my-topic" }
    - { type: gotify, url: "http://gotify:80", token: made-up }
    - { type: ntfy, url: "https://ntfy.example.com" }
    - { type: discord, url: "https://discord.example.com/not-a-webhook" }
`);
  const hosts = { 'ntfy.example.com': () => new Response('ok'), 'gotify': () => new Response('no', { status: 401 }) };
  const quiet = net(hosts), found = await doctor({ path, data, registry: registry(), fetch: quiet.get });
  assert.deepEqual(found.filter(f => f.group === 'Notifications').map(f => f.status), ['ok', 'ok', 'warn', 'warn']);   // reachable is all that's asked of gotify
  assert.match(by(found, 'notify.channels[2]')!.problem!, /topic/);
  assert.ok(quiet.seen.every(s => s.method === 'GET' && new URL(s.url).pathname === '/'));
  const loud = net(hosts), sent = await doctor({ path, data, registry: registry(), fetch: loud.get, sendTest: true });
  const posts = loud.seen.filter(s => s.method === 'POST');
  assert.deepEqual(posts.map(p => p.url), ['https://ntfy.example.com/my-topic', 'http://gotify/message']);   // one each, and none to a channel that looks wrong
  for (const p of posts) assert.match(p.body!, /test/i);
  assert.match(by(sent, 'notify.channels[0]')!.check, /a test message went to ntfy\.example\.com/);
  assert.equal(by(sent, 'notify.channels[1]')!.status, 'fail'); assert.match(by(sent, 'notify.channels[1]')!.problem!, /refused its token \(401\)/);
});

test('doctor: the install itself: folders, sign-in, allowedHosts, and what is only worth knowing', async () => {
  const { dir, path, data } = await setup(`
auth: { mode: oidc, oidc: { issuer: "https://auth.example.com", clientId: valet, clientSecret: made-up, redirectUrl: "https://home.example.com/api/auth/oidc/callback" } }
assistant: { baseURL: "http://models:11434/v1", model: small-one, access: { default: read, config: control } }
mcpServer: { token: made-up-token-made-up-token-made-up-token }
`);
  const { get } = net({ 'models:11434': models('small-one') });
  let found = await doctor({ path, data, registry: registry(), fetch: get });
  assert.equal(by(found, 'allowedHosts')!.status, 'fail'); assert.match(by(found, 'allowedHosts')!.fix!, /allowedHosts: \[home\.example\.com\]/);
  assert.match(by(found, 'mcpServer')!.check, /a token is set \(41 characters\)/);
  assert.equal(by(found, `data folder ${data}`)!.status, 'ok');
  assert.equal(by(found, 'config folder')!.status, 'ok');
  if (process.getuid?.() !== 0) {   // root may write anywhere, so there's nothing to see
    await chmod(join(dir, 'config'), 0o500); await chmod(data, 0o500);
    try {
      found = await doctor({ path, data, registry: registry(), fetch: get });
      assert.equal(by(found, 'data folder')!.status, 'fail');
      assert.equal(by(found, 'config folder')!.status, 'fail'); assert.match(by(found, 'config folder')!.problem!, /assistant\.access\.config/);
    } finally { await chmod(join(dir, 'config'), 0o700); await chmod(data, 0o700); }
  }
  // the defaults are information, never a problem
  const plain = await setup('title: Home\n'), quiet = await doctor({ path: plain.path, data: join(plain.dir, 'not-yet'), registry: registry(), fetch: get });
  assert.deepEqual(quiet.filter(f => f.status === 'fail' || f.status === 'warn'), []);
  assert.match(quiet.filter(f => f.status === 'info').map(f => f.check).join('\n'), /isn't there yet[^]*read-only[^]*allowedHosts is empty/);
});

test('doctor: a config it can\'t read says why and stops there, without a crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-doctor-')), data = join(dir, 'data');
  const run = async (yaml?: string) => { const path = join(dir, `${Math.random()}.yaml`); if (yaml != null) await writeFile(path, yaml); return doctor({ path, data, registry: registry(), fetch: net({}).get }); };
  assert.match((await run())[0].problem!, /no config file/);
  assert.match((await run('title: [unclosed'))[0].problem!, /isn't valid YAML/);
  const typo = await run('titel: Home\nauth: { mode: sometimes }\n');
  assert.deepEqual(typo.filter(f => f.group === 'Config').map(f => f.status), ['fail', 'fail']);
  assert.match(typo.map(f => f.problem).join(' '), /did you mean "title"/);
  const wrong = await run('integrations: { x: { type: nope }, books: { type: shelf, url: not-an-address, key: k } }\nlayout: [{ widgets: [books.status] }]\n');
  assert.match(wrong.map(f => `${f.check}: ${f.problem}`).join('\n'), /integrations\.x: unknown type "nope"[^]*integrations\.books\.url/);
});

test('doctor: the command prints the report, or JSON alone, and exits 1 only when something is wrong', async () => {
  const good = await setup('title: Home\n'), bad = await setup('integrations: { x: { type: nope } }\n');
  const lines: string[] = [], log = console.log, error = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = () => {};
  try {
    assert.equal(await doctorCommand([], good.path, good.data, registry()), 0);
    assert.match(lines.join('\n'), /^Config\n {2}✓ .*config\.yaml: 0 integrations[^]*Install\n[^]*Nothing is wrong\.$/);
    lines.length = 0;
    assert.equal(await doctorCommand(['--json'], bad.path, bad.data, registry()), 1);
    const report = JSON.parse(lines.join('\n'));
    assert.equal(report.ok, false);
    assert.deepEqual(report.checks.find((c: any) => c.status === 'fail'), { group: 'config', status: 'fail', check: 'integrations.x', problem: 'unknown type "nope"', fix: report.checks[0].fix });
    assert.equal(await doctorCommand(['--fix-it'], good.path, good.data, registry()), 1);
  } finally { console.log = log; console.error = error; }
  assert.equal(await readFile(good.path, 'utf8'), 'title: Home\n');   // and the config is as it was
});

test('doctor: a name found in secrets.files is set, not missing, and its value is never printed', async () => {
  delete process.env.VALET_T_FILED_KEY; delete process.env.VALET_T_FILED_KEY_FILE;
  const { dir, path, data } = await setup('');
  await mkdir(join(dir, 'secrets')); await writeFile(join(dir, 'secrets', 'VALET_T_FILED_KEY'), 'filed-secret-value-77\n');
  await writeFile(path, `secrets: { files: "${join(dir, 'secrets')}" }
integrations:
  books: { type: shelf, url: "http://shelf:8080", key: "\${VALET_T_FILED_KEY}" }
layout: [{ widgets: [books.status] }]
`);
  const found = await doctor({ path, data, registry: registry(), fetch: net({ 'shelf:8080': () => Response.json({ items: [] }) }).get });
  assert.equal(by(found, '${VALET_T_FILED_KEY}'), undefined);
  assert.ok(!(JSON.stringify(found) + render(found)).includes('filed-secret-value-77'));
});
