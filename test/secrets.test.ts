// Where a ${NAME} comes from: the environment, a file, a folder of files, Vault, 1Password. Made-up servers and values
// only; what matters is the order, what's refused, and that no value or token shows up anywhere it's written out.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-secrets-'));
const { Config, loadConfig, parseConfig, resolveSecrets, usedSecrets } = await import('../src/server/config.ts');
const { askProviders, inFolder, lookup, readSecret, Refresh } = await import('../src/server/secrets.ts');
const { redactor } = await import('../src/server/security.ts');
const { check } = await import('../src/server/site.ts');
const { guard, refused, setupTools, withoutSecrets } = await import('../src/server/setup.ts');
const { configCommand } = await import('../src/server/cli.ts');
const { registry } = await import('../src/integrations/index.ts');

const dir = await mkdtemp(join(tmpdir(), 'valet-secrets-'));
const file = async (name: string, text: string) => { const f = join(dir, name); await writeFile(f, text); return f; };
// a test that fails before it closes its server shouldn't leave the run waiting on it
const servers: ReturnType<typeof createServer>[] = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });
const listen = async (fn: (q: IncomingMessage, r: ServerResponse) => void) => {
  const s = createServer(fn); await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok)); servers.push(s);
  return { s, url: `http://127.0.0.1:${(s.address() as any).port}`, close: () => new Promise(ok => { s.closeAllConnections(); s.close(ok); }) };
};
/** A Vault with one KV v2 secret at secret/valet. */
const fakeVault = async (data: Record<string, unknown>, token = 'vault-token-1234') => {
  const seen: { url?: string; token?: string; namespace?: string }[] = [];
  const v = await listen((q, r) => {
    seen.push({ url: q.url, token: q.headers['x-vault-token'] as string, namespace: q.headers['x-vault-namespace'] as string });
    if (q.headers['x-vault-token'] !== token) { r.statusCode = 403; return r.end(JSON.stringify({ errors: [`permission denied for ${q.headers['x-vault-token']}`] })); }
    if (q.url !== '/v1/secret/data/valet') { r.statusCode = 404; return r.end('{"errors":[]}'); }
    r.end(JSON.stringify({ data: { data, metadata: { version: 3 } } }));
  });
  return { ...v, seen, data };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const api = (id: string, key: string) => `  ${id}: { type: api, url: "https://${id}.example/m", headers: { X: "\${${key}}" }, stats: [{ label: A, value: a }] }\n`;
const keyOf = (c: any, id: string) => c.integrations[id].headers.X as string;

test('files: NAME_FILE, then a file in secrets.files called NAME or name, without its last newline', async () => {
  const folder = join(dir, 'run'); await mkdir(folder);
  await writeFile(join(folder, 'ST_UPPER'), 'upper-value-1\n'); await writeFile(join(folder, 'st_lower'), 'lower-value-2\n\n');
  await writeFile(join(folder, 'ST_BOTH'), 'from-the-folder'); process.env.ST_BOTH_FILE = await file('both', 'from-name-file\n');
  const c = parseConfig(`secrets: { files: ${folder} }\nintegrations:\n${api('a', 'ST_UPPER')}${api('b', 'ST_LOWER')}${api('c', 'ST_BOTH')}`);
  assert.deepEqual(['a', 'b', 'c'].map(id => keyOf(c, id)), ['upper-value-1', 'lower-value-2', 'from-name-file']);
  for (const v of ['upper-value-1', 'lower-value-2', 'from-name-file']) assert.ok(usedSecrets.includes(v), v);
  assert.equal(keyOf(parseConfig(`integrations:\n${api('c', 'ST_BOTH')}`), 'c'), 'from-name-file');   // no secrets block: as before
});

test('files: a link that leaves the folder is refused, and so is a file too big to be a secret', async () => {
  const folder = join(dir, 'mounted'), outside = await file('outside', 'not-yours-to-read'); await mkdir(folder);
  await symlink(outside, join(folder, 'ST_LINK')); await mkdir(join(folder, '..data')); await writeFile(join(folder, '..data', 'ST_K8S'), 'k8s-value-3');
  await symlink(join('..data', 'ST_K8S'), join(folder, 'ST_K8S'));   // how Kubernetes mounts one: a link that stays inside
  assert.throws(() => parseConfig(`secrets: { files: ${folder} }\nintegrations:\n${api('a', 'ST_LINK')}`), /\$\{ST_LINK\}: .*leads outside/);
  assert.throws(() => inFolder(folder, '../outside', '${secret:../outside}'), /leads outside/);
  assert.equal(inFolder(folder, 'ST_K8S', 'x'), 'k8s-value-3');
  assert.equal(inFolder(folder, 'ST_NOT_THERE', 'x'), undefined);
  const big = await file('big', 'x'.repeat(64 * 1024 + 1));
  assert.throws(() => readSecret(big, '${ST_BIG}'), /\$\{ST_BIG\}: .*too big/);
  assert.equal(readSecret(await file('fits', 'x'.repeat(64 * 1024)), 'x').length, 64 * 1024);
});

test('order: the environment, NAME_FILE, the folder, Vault, then 1Password for what Vault lacks', async () => {
  const folder = join(dir, 'order'); await mkdir(folder);
  const everywhere = ['ST_O_ENV', 'ST_O_FILE', 'ST_O_FOLDER', 'ST_O_VAULT'];
  const v = await fakeVault(Object.fromEntries(everywhere.map(n => [n, 'from-vault-55'])));
  process.env.ST_O_ENV = 'from-env-5555';
  process.env.ST_O_FILE_FILE = await file('o-file', 'from-name-file-55\n');
  for (const n of ['ST_O_ENV', 'ST_O_FILE', 'ST_O_FOLDER']) await writeFile(join(folder, n), 'from-folder-55\n');
  const asked: string[] = [];
  const send = (async (u: string, init: RequestInit) => {
    asked.push(u);
    if (u.startsWith(v.url)) return fetch(u, init);
    return json({ fields: [{ label: 'ST_O_VAULT', value: 'from-1password-55' }, { label: 'ST_O_OP', value: 'from-1password-55' }, { label: 'notes', purpose: 'NOTES' }] });
  }) as typeof fetch;
  process.env.ST_O_TOKEN = 'vault-token-1234'; process.env.ST_O_OP_TOKEN = 'connect-token-1234';
  const yaml = `secrets:\n  files: ${folder}\n  vault: { url: "${v.url}", token: "\${ST_O_TOKEN}" }\n  onepassword: { url: "https://op.example", token: "\${ST_O_OP_TOKEN}", vault: ${'v'.repeat(26)}, item: ${'i'.repeat(26)} }\n`
    + `integrations:\n${[...everywhere, 'ST_O_OP'].map((n, i) => api(`i${i}`, n)).join('')}`;
  const c = await loadConfig(await file('order.yaml', yaml), send);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => keyOf(c, `i${i}`)), ['from-env-5555', 'from-name-file-55', 'from-folder-55', 'from-vault-55', 'from-1password-55']);
  assert.deepEqual(asked, [`${v.url}/v1/secret/data/valet`, `https://op.example/v1/vaults/${'v'.repeat(26)}/items/${'i'.repeat(26)}`]);
  // nothing the providers are needed for: neither is asked
  asked.length = 0; await resolveSecrets(yaml.replace(/  i[34]:.*\n/g, ''), send); assert.deepEqual(asked, []);
  await v.close();
});

test('Vault: one KV v2 secret, the token and namespace in headers, and a secret however the name reads', async () => {
  const v = await fakeVault({ ST_V_KEY: 'vault-value-777', st_v_lower: 'vault-lower-777', ST_V_HOST: 'db-host-from-vault', nested: { no: 1 } });
  const tokenFile = await file('vault-token', 'vault-token-1234\n');
  const yaml = `secrets:\n  vault: { url: "${v.url}/", tokenFile: ${tokenFile}, namespace: team/home }\nintegrations:\n${api('a', 'ST_V_KEY')}${api('b', 'ST_V_LOWER')}${api('c', 'ST_V_HOST')}`;
  const c = await loadConfig(await file('vault.yaml', yaml));
  assert.deepEqual(['a', 'b', 'c'].map(id => keyOf(c, id)), ['vault-value-777', 'vault-lower-777', 'db-host-from-vault']);
  assert.deepEqual(v.seen, [{ url: '/v1/secret/data/valet', token: 'vault-token-1234', namespace: 'team/home' }]);
  const out = redactor(usedSecrets)(JSON.stringify(c));
  for (const leak of ['vault-value-777', 'vault-lower-777', 'db-host-from-vault', 'vault-token-1234']) assert.doesNotMatch(out, new RegExp(leak), leak);
  // another mount and path, each part escaped
  const seen: string[] = [];
  await askProviders({ vault: { url: 'https://vault.example', token: 't-123456', mount: 'kv/home', path: 'apps/valet' } }, ['X'], (async (u: string) => { seen.push(u); return json({ data: { data: {} } }); }) as typeof fetch);
  assert.deepEqual(seen, ['https://vault.example/v1/kv/home/data/apps/valet']);
  await v.close();
});

test('1Password Connect: a vault and an item by name are looked up, and field labels are the names', async () => {
  const asked: { url: string; auth: string | null; redirect?: string; signal: boolean }[] = [];
  const send = (async (u: string, init: RequestInit) => {
    asked.push({ url: decodeURIComponent(u), auth: new Headers(init.headers).get('authorization'), redirect: init.redirect, signal: !!init.signal });
    const { pathname } = new URL(u);
    if (pathname === '/v1/vaults') return json([{ id: 'vaultid1', name: 'Homelab' }, { id: 'vaultid2', name: 'Homelab Old' }]);
    if (pathname === '/v1/vaults/vaultid1/items') return json([{ id: 'itemid1', title: 'Valet' }]);
    if (pathname === '/v1/vaults/vaultid1/items/itemid1') return json({ fields: [{ label: 'ST_OP_KEY', value: 'op-value-888' }, { label: 'ST_OP_KEY', value: 'a-second-one' }, { label: 'ST_OP_EMPTY', value: '' }] });
    return json({ message: 'no' }, 404);
  }) as typeof fetch;
  process.env.ST_OP_TOKEN = 'connect-token-5678';
  const yaml = `secrets:\n  onepassword: { url: "http://op-connect:8080", token: "\${ST_OP_TOKEN}", vault: Homelab }\nintegrations:\n${api('a', 'ST_OP_KEY')}`;
  const c = await loadConfig(await file('op.yaml', yaml), send);
  assert.equal(keyOf(c, 'a'), 'op-value-888');
  assert.deepEqual(asked.map(a => a.url), ['http://op-connect:8080/v1/vaults?filter=name eq "Homelab"', 'http://op-connect:8080/v1/vaults/vaultid1/items?filter=title eq "Valet"', 'http://op-connect:8080/v1/vaults/vaultid1/items/itemid1']);
  assert.ok(asked.every(a => a.auth === 'Bearer connect-token-5678' && a.redirect === 'manual' && a.signal));
  assert.ok(usedSecrets.includes('op-value-888') && usedSecrets.includes('connect-token-5678'));
  const none = yaml.replace('vault: Homelab', 'vault: Elsewhere');
  await assert.rejects(resolveSecrets(none, send), /can't get \$\{ST_OP_KEY\} from 1Password at op-connect:8080: no vault called "Elsewhere"/);
  // a name that would break out of the filter never reaches the server
  assert.throws(() => parseConfig(yaml.replace('vault: Homelab', 'vault: \'a" or name pr "\'')), /secrets\.onepassword\.vault/);
});

test('a provider that fails names the variable and the provider, never a value or the token', async () => {
  const v = await fakeVault({ ST_F_KEY: 'vault-value-999' }), elsewhere = await listen((_, r) => r.end('{}'));
  let hits = 0; elsewhere.s.on('request', () => hits++);
  process.env.ST_F_TOKEN = 'wrong-token-4321';
  const yaml = (url: string, extra = '') => `secrets:\n  vault: { url: "${url}", token: "\${ST_F_TOKEN}"${extra} }\nintegrations:\n${api('a', 'ST_F_KEY')}${api('b', 'ST_F_OTHER')}`;
  const fails = async (text: string, what: RegExp, send?: typeof fetch) => {
    const e = await resolveSecrets(text, send).then(() => null, e => e as Error);
    assert.ok(e, 'it should fail'); assert.match(e.message, what);
    assert.match(e.message, /\$\{ST_F_KEY\}, \$\{ST_F_OTHER\} from Vault at /);
    assert.doesNotMatch(e.message, /wrong-token-4321|vault-token-1234|vault-value-999/);
  };
  await fails(yaml(v.url), /the token was refused \(403\)/);                         // the fake Vault echoes the token in its error: it isn't passed on
  process.env.ST_F_TOKEN = 'vault-token-1234';
  await fails(yaml(v.url, ', path: nothing-here'), /no secret at secret\/nothing-here.*\(404\)/);
  const redirecting = await listen((_, r) => { r.statusCode = 307; r.setHeader('location', `${elsewhere.url}/v1/secret/data/valet`); r.end(); });
  await fails(yaml(redirecting.url), /it redirects to 127\.0\.0\.1:\d+, which isn't followed/);
  assert.equal(hits, 0);                                                              // the token went nowhere new
  const closed = redirecting.url; await redirecting.close();
  await fails(yaml(closed), /can't reach it \(ECONNREFUSED\)/);
  await fails(yaml('https://vault.example'), /no answer in 10 seconds/, (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof fetch);
  await fails(yaml('https://vault.example'), /can't reach it$/, (async () => { throw new Error('connect to vault-token-1234 failed'); }) as unknown as typeof fetch);
  await fails(yaml('https://vault.example'), /isn't JSON/, (async () => new Response('<html>')) as unknown as typeof fetch);
  await fails(yaml('https://vault.example'), /doesn't look like a KV version 2/, (async () => json({ data: { ST_F_KEY: 'v1-shape' } })) as unknown as typeof fetch);
  const huge = await listen((_, r) => { r.write('{"data":{"data":{"ST_F_KEY":"'); r.end('x'.repeat(600 * 1024) + '"}}}'); });
  await fails(yaml(huge.url), /its answer is over 512 KB/);
  await fails(yaml('https://vault.example'), /over 512 KB/, (async () => new Response('{}', { headers: { 'content-length': '99999999' } })) as unknown as typeof fetch);
  await fails(yaml('https://vault.example', ', tokenFile: /nowhere/at/all').replace('token: "${ST_F_TOKEN}", ', ''), /secrets\.vault\.tokenFile: can't read/);
  await Promise.all([v.close(), elsewhere.close(), huge.close()]);
});

test('a variable nothing has is the same error as ever, and says where Valet looked', async () => {
  const folder = join(dir, 'empty'); await mkdir(folder);
  const v = await fakeVault({});
  process.env.ST_M_TOKEN = 'vault-token-1234';
  const yaml = `secrets:\n  files: ${folder}\n  vault: { url: "${v.url}", token: "\${ST_M_TOKEN}" }\nintegrations:\n${api('a', 'ST_M_NOWHERE')}`;
  await assert.rejects(loadConfig(await file('missing.yaml', yaml)), new RegExp(`environment variable ST_M_NOWHERE is not set \\(nor ST_M_NOWHERE_FILE, nor a file in ${folder}, and Vault had none\\)`));
  assert.throws(() => parseConfig(`integrations:\n${api('a', 'ST_M_NOWHERE')}`), /ST_M_NOWHERE is not set \(nor ST_M_NOWHERE_FILE\)/);
  await v.close();
});

test('a provider\'s own token comes from the environment or a file, never from a provider, and never sits in the file unremarked', async () => {
  const folder = join(dir, 'tokens'); await mkdir(folder); await writeFile(join(folder, 'ST_T_FOLDER_TOKEN'), 'folder-token-1234');
  const vault = (token: string) => `secrets:\n  files: ${folder}\n  vault: { url: "https://vault.example", ${token} }\n`;
  // the folder is a provider too: the block's own ${NAME} only reads the environment and NAME_FILE
  assert.throws(() => parseConfig(vault('token: "${ST_T_FOLDER_TOKEN}"')), /ST_T_FOLDER_TOKEN is not set \(nor ST_T_FOLDER_TOKEN_FILE\)/);
  process.env.ST_T_TOKEN_FILE = await file('t-token', 'file-token-1234\n');
  const fine = parseConfig(vault('token: "${ST_T_TOKEN}"'));
  assert.equal(fine.secrets.vault!.token, 'file-token-1234');
  assert.deepEqual(check(fine, registry).problems, []);
  const literal = parseConfig(vault('token: hvs.typed-into-the-file'));
  assert.deepEqual(check(literal, registry).problems, ['secrets.vault.token: a token doesn\'t belong in config.yaml; write ${SOME_NAME} and set that in the environment, or use tokenFile']);
  assert.ok(usedSecrets.includes('hvs.typed-into-the-file'));                         // it still never leaves
  assert.throws(() => parseConfig(vault('mount: secret')), /secrets\.vault\.token: needs token/);
  assert.throws(() => parseConfig(vault('token: "${ST_T_TOKEN}", tokenFile: /x')), /secrets\.vault\.token: needs token/);
  for (const url of ['ftp://vault.example', 'file:///etc/passwd', 'https://user:pass@vault.example']) assert.throws(() => parseConfig(`secrets:\n  vault: { url: "${url}", tokenFile: /x }\n`), /secrets\.vault\.url/, url);
  for (const path of ['../sys/raw', 'a/../b', 'valet?list=true']) assert.throws(() => parseConfig(`secrets:\n  vault: { url: "https://vault.example", tokenFile: /x, path: "${path}" }\n`), /secrets\.vault\.path/, path);
  assert.throws(() => parseConfig('secrets: { refresh: 5s }\n'), /secrets\.refresh: between 1m and 7d/);
  assert.throws(() => parseConfig('secrets: { valut: {} }\n'), /did you mean "vault"/);
  assert.deepEqual(check(parseConfig('secrets: { refresh: 1h }\nreload: false\n'), registry).problems, ['secrets.refresh: needs reload, which is turned off']);
});

test('config print and check show no value and no token from a provider', async () => {
  const v = await fakeVault({ ST_P_KEY: 'vault-value-print-1', ST_P_URL: 'https://printed.example/hook/abc' });
  process.env.ST_P_TOKEN = 'vault-token-1234';
  const path = await file('print.yaml', `secrets:\n  vault: { url: "${v.url}", token: "\${ST_P_TOKEN}" }\ntitle: "\${ST_P_URL}"\nintegrations:\n${api('a', 'ST_P_KEY')}`);
  const said: string[] = [], log = console.log, error = console.error;
  console.log = console.error = (...a: unknown[]) => { said.push(a.join(' ')); };
  try {
    assert.equal(await configCommand(['print'], path, registry), 0);
    assert.equal(await configCommand(['check'], path, registry), 0);
    await v.close();
    assert.equal(await configCommand(['check'], path, registry), 1);                  // the provider is gone: said plainly, and nothing more
  } finally { console.log = log; console.error = error; }
  const all = said.join('\n');
  assert.match(all, /X: •••/); assert.match(all, /token: •••/); assert.match(all, /can't get \$\{ST_P_URL\}, \$\{ST_P_KEY\} from Vault/);
  assert.doesNotMatch(all, /vault-value-print-1|printed\.example|vault-token-1234/);
});

test('a reload with the provider down fails whole, and what it gave before still stands', async () => {
  let down = false, value = 'vault-value-first';
  const send = (async () => { if (down) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); return json({ data: { data: { ST_R_KEY: value } } }); }) as unknown as typeof fetch;
  process.env.ST_R_TOKEN = 'vault-token-1234';
  const yaml = `secrets:\n  vault: { url: "https://vault.example", token: "\${ST_R_TOKEN}" }\n  refresh: 1h\nintegrations:\n${api('a', 'ST_R_KEY')}`, path = await file('reload.yaml', yaml);
  const first = await loadConfig(path, send);
  assert.equal(first.secrets.refresh, 3_600_000);
  assert.equal(JSON.stringify(await loadConfig(path, send)), JSON.stringify(first));   // asked again, nothing new: main.ts rebuilds nothing
  down = true;
  await assert.rejects(loadConfig(path, send), /can't get \$\{ST_R_KEY\} from Vault at vault\.example: can't reach it \(ECONNREFUSED\)/);
  assert.equal(keyOf(parseConfig(yaml), 'a'), 'vault-value-first');                    // the assistant's checks and the next good load still find it
  down = false; value = 'vault-value-rotated';
  assert.equal(keyOf(await loadConfig(path, send), 'a'), 'vault-value-rotated');
  assert.ok(usedSecrets.includes('vault-value-first') && usedSecrets.includes('vault-value-rotated'));   // the old one stays covered
  await writeFile(path, `integrations:\n${api('a', 'ST_R_KEY')}`);                    // the provider taken out of the config: its values go with it
  await assert.rejects(loadConfig(path, send), /ST_R_KEY is not set/);
});

test('refresh: one run at a time, restarted only by a new time, and stopped for good', async () => {
  let runs = 0, release = () => {};
  const r = new Refresh(() => { runs++; return new Promise<void>(ok => { release = ok; }); });
  r.set(3_600_000); const timer = (r as any).timer;
  r.set(3_600_000); assert.equal((r as any).timer, timer);
  const a = r.tick(), b = r.tick(); release(); await Promise.all([a, b]);
  assert.equal(runs, 1);
  r.set(60_000); assert.notEqual((r as any).timer, timer); assert.equal(timer._destroyed, true);
  r.set(undefined); assert.equal((r as any).timer, undefined); assert.equal(r.every, undefined);
  r.set(60_000); const last = (r as any).timer; r.stop(); assert.equal(last._destroyed, true);
});

test('the assistant can\'t see or change where secrets come from', async () => {
  const text = `title: Home\nsecrets:\n  files: /run/secrets   # mounted by compose\n  vault:\n    url: https://vault.example:8200\n    tokenFile: /run/secrets/vault_token\n    path: homelab/valet\n# after\nintegrations: {}\nlayout: []\n`;
  const shown = withoutSecrets(text);
  assert.equal(shown, 'title: Home\n# secrets: the owner\'s, not shown\n# after\nintegrations: {}\nlayout: []\n');
  assert.equal(withoutSecrets('title: Home\n'), 'title: Home\n');
  assert.doesNotMatch(withoutSecrets('secrets: { vault: { url: "https://vault.example", tokenFile: /x } }\ntitle: Home\n'), /vault/);
  const path = await file('assistant.yaml', text), tools = setupTools(path, registry);
  const read = await tools.config_read.run({}) as any;
  assert.doesNotMatch(JSON.stringify(read.data.config), /vault|run\/secrets|homelab/);
  assert.ok(!read.data.sections.includes('secrets') && read.data.ownerOnly.includes('secrets'));
  assert.match((await tools.config_options.run({ type: 'secrets' }) as any).data.error, /no type or section/);
  for (const ops of [[{ op: 'set', path: ['secrets', 'vault', 'url'], value: 'https://evil.example' }], [{ op: 'set', path: ['secrets'], value: { files: '/etc' } }], [{ op: 'remove', path: ['secrets'] }]]) {
    assert.match(refused(ops as any)!, /"secrets" isn't something the assistant may change/);
    for (const tool of [tools.config_preview, tools.config_apply]) assert.match((await tool.run({ ops, summary: 's' }) as any).data.error, /secrets/);
  }
  assert.match(guard(text, text.replace('vault.example', 'evil.example'))!, /"secrets" isn't something the assistant may change/);
  assert.match(guard('title: Home\n', 'title: Home\nsecrets: { files: /etc }\n')!, /secrets/);
  // an edit elsewhere goes through, and the diff it's shown has none of the block in it
  const ok = await tools.config_preview.run({ ops: [{ op: 'set', path: ['title'], value: 'Den' }, { op: 'set', path: ['layout'], value: [{ title: 'A', widgets: [] }] }], summary: 's' }) as any;
  assert.match(ok.data.diff, /Den/); assert.doesNotMatch(JSON.stringify(ok), /vault|run\/secrets|homelab/);
  assert.equal(await readFile(path, 'utf8'), text);
});

test('a secret from a provider is held to the hosts it already goes to, like one from the environment', async () => {
  const seen: (string | undefined)[] = [];
  const mine = await listen((q, r) => { seen.push(q.headers.authorization); r.end('{"a":1}'); }), theirs = await listen((q, r) => { seen.push(`theirs: ${q.headers.authorization}`); r.end('{}'); });
  const send = (async () => json({ data: { data: { ST_G_KEY: 'vault-value-guarded' } } })) as unknown as typeof fetch;
  process.env.ST_G_TOKEN = 'vault-token-1234';
  const text = `title: Home\nsecrets:\n  vault: { url: "https://vault.example", token: "\${ST_G_TOKEN}" }\nintegrations:\n  kuma: { type: api, url: "${mine.url}/m", headers: { Authorization: "\${ST_G_KEY}" }, stats: [{ label: A, value: a }] }\nlayout: []\n`;
  const path = await file('guard.yaml', text), tools = setupTools(path, registry);
  await loadConfig(path, send);
  assert.match(guard(text, text.replace(`${mine.url}/m`, 'https://evil.example/m'))!, /ST_G_KEY\} goes to 127\.0\.0\.1:\d+, and this would send it to evil\.example/);
  assert.match(guard(text, text.replace('title: Home', 'title: "${ST_G_KEY}"'))!, /outside an integration/);
  // the provider's own token is used by nothing else: not the page, not a card
  assert.match(guard(text, text.replace('title: Home', 'title: "${ST_G_TOKEN}"'))!, /outside an integration/);
  assert.match(guard(text, text.replace('layout: []', `  x: { type: api, url: "${theirs.url}", headers: { A: "\${ST_G_TOKEN}" } }\nlayout: []`))!, /ST_G_TOKEN\} is how Valet reaches its secrets/);
  assert.match((await tools.api_sample.run({ url: `${theirs.url}/a`, headers: { Authorization: '${ST_G_TOKEN}' } }) as any).data.error, /isn't sent/);
  const moved = await tools.config_apply.run({ ops: [{ op: 'set', path: ['integrations', 'x'], value: { type: 'api', url: `${theirs.url}/x`, headers: { A: '${ST_G_KEY}' }, stats: [{ label: 'A', value: 'a' }] } }], summary: 's' }) as any;
  assert.match(moved.data.error, /ST_G_KEY\} goes to/);
  assert.match((await tools.api_sample.run({ url: `${theirs.url}/a`, headers: { Authorization: '${ST_G_KEY}' } }) as any).data.error, /isn't sent/);
  assert.deepEqual(seen, []);
  // to its own host it's sent as what Vault gave, and what comes back to the model has passed nothing on
  const sample = await tools.api_sample.run({ url: `${mine.url}/m`, headers: { Authorization: '${ST_G_KEY}' } }) as any;
  assert.deepEqual(seen, ['vault-value-guarded']); assert.equal(sample.data.status, 200);
  assert.doesNotMatch(redactor(usedSecrets)(JSON.stringify({ echoed: 'vault-value-guarded' })), /vault-value-guarded/);
  assert.equal(lookup('ST_G_KEY'), undefined);                                         // and only where a config is being read
  assert.ok(Config.parse({}).secrets);
  await Promise.all([mine.close(), theirs.close()]);
});

test('a preview asks no provider; a save asks once for a name added there since the load', async () => {
  let hits = 0, data: Record<string, string> = {};
  const v = await listen((_, r) => { hits++; r.end(JSON.stringify({ data: { data } })); });
  process.env.ST_A_TOKEN = 'vault-token-1234';
  const path = await file('ask.yaml', `title: Home\nsecrets:\n  vault: { url: "${v.url}", token: "\${ST_A_TOKEN}" }\nintegrations: {}\nlayout: []\n`), tools = setupTools(path, registry);
  const ops = [{ op: 'set', path: ['integrations', 'n'], value: { type: 'api', url: 'https://n.example/m', headers: { X: '${ST_A_NEW}' }, stats: [{ label: 'A', value: 'a' }] } }];
  const preview = await tools.config_preview.run({ ops, summary: 's' }) as any;
  assert.deepEqual(preview.data.needsInEnv, ['ST_A_NEW']); assert.equal(hits, 0);
  data = { ST_A_NEW: 'added-in-vault-1' };
  const saved = await tools.config_apply.run({ ops, summary: 's' }) as any;
  assert.equal(saved.data.saved, true); assert.equal(hits, 1);
  assert.doesNotMatch(JSON.stringify(saved), /added-in-vault-1/);
  await v.close();
});
