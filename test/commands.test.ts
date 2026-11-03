// ⌘K's plain commands: how words match (exactly, never fuzzily), the doors a command goes through on the server (the
// same as the chat's), and that no model is asked anything on the way. Made-up services only.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-commands-'));
const { clear, match, words } = await import('../src/shared/commands.ts');
const { listCommands, runCommand, commandsOf } = await import('../src/server/commands.ts');
const { sameOrigin } = await import('../src/server/auth.ts');
const { Config } = await import('../src/server/config.ts');
const { Activity } = await import('../src/server/activity.ts');
const { redactor } = await import('../src/server/security.ts');
type Instance = import('../src/server/core.ts').Instance;

const SECRET = 'made-up-secret-9c1e';
const list = (...cmds: [string, string[]][]) => cmds.map(([id, say]) => ({ id, say }));

// ── matching ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('words: case, punctuation, order, plurals and synonyms come out the same', () => {
  assert.deepEqual(words('Pause ALL the downloads!'), ['pause', 'download']);
  assert.deepEqual(words('stop downloads'), words('pause downloads'));
  assert.deepEqual(words('disable ads').sort(), words('ads off').sort());
  assert.deepEqual(words("What's playing?"), ['what', 'playing']);
  assert.deepEqual(words('pause ads 5m'), ['pause', 'ad', '5', 'minute']);
  assert.deepEqual(words('pause ads five minutes'), ['pause', 'ad', '5', 'minute']);
});

test('match: exact phrasings run, word order and synonyms included', () => {
  const l = list(['dl', ['pause downloads']], ['lights', ['lights off']]);
  for (const t of ['pause downloads', 'Pause all downloads', 'stop downloads', 'downloads, pause']) {
    const m = match(l, t);
    assert.equal(clear(m)?.id, 'dl', t);
  }
  assert.equal(clear(match(l, 'turn off the lights'))?.id, 'lights');
  assert.equal(clear(match(l, 'disable lights'))?.id, 'lights');
});

test('match: nothing fuzzy. A near miss is no match, so it falls through to Ask', () => {
  const l = list(['dl', ['pause downloads']]);
  for (const t of ['pause download speed', 'pause downlods', 'pause', 'downloads', 'please pause downloads tomorrow', '', ' ']) assert.equal(clear(match(l, t)), undefined, t);
  assert.deepEqual(match(l, 'what is the weather'), []);
  assert.deepEqual(match(l, 'pause downlods'), []);
});

test('match: a half-typed command is offered below asking, never run', () => {
  const l = list(['dl', ['pause downloads']], ['ads', ['pause ads']]);
  const m = match(l, 'pause dow');
  assert.equal(m.length, 1);
  assert.equal(m[0].exact, false);
  assert.ok(m[0].score < .5, 'below Ask');
  assert.equal(m[0].text, 'pause downloads', 'selecting it sends the whole command');
  assert.equal(clear(m), undefined);
  assert.equal(match(l, 'pause ').length, 2);
});

test('match: two commands with the same words are both shown, and neither is chosen', () => {
  const l = list(['a:0', ['pause downloads']], ['b:0', ['pause downloads']]);
  const m = match(l, 'pause downloads');
  assert.deepEqual(m.map(x => [x.id, x.exact]), [['a:0', true], ['b:0', true]]);
  assert.equal(clear(m), undefined);
});

test('match: a slot takes a whole number, and a command missing its number is not offered', () => {
  const l = list(['p', ['pause ads {minutes} min']], ['p5', ['pause ads']]);
  const m = match(l, 'pause ads 10 minutes');
  assert.equal(clear(m)?.id, 'p');
  assert.deepEqual(clear(m)?.slots, { minutes: 10 });
  assert.equal(clear(match(l, 'pause ads for 15 min'))?.slots.minutes, 15);
  assert.equal(clear(match(l, 'pause ads'))?.id, 'p5');
  assert.ok(!match(l, 'pause ads').some(x => x.id === 'p'), 'no number, not offered');
  assert.equal(clear(match(l, 'pause ads ten min'))?.slots.minutes, 10);
  assert.equal(clear(match(l, 'pause ads 1.5 min')), undefined);
  assert.equal(clear(match(l, 'pause ads 10 20 min')), undefined);
});

// ── a made-up homelab ───────────────────────────────────────────────────────────────────────────────────────────────
interface Ran { tool: string[]; action: string[] }
function lab(ran: Ran): Map<string, Instance> {
  const read = (name: string, card: object) => ({ description: name, access: 'read' as const, label: `Checked ${name}`, input: z.object({}), async run() { ran.tool.push(name); return { data: { key: SECRET }, card: { type: 'text', text: `${name} ok ${SECRET}` } as any }; } });
  return new Map<string, Instance>([
    ['downloads', {
      widgets: {},
      commands: [
        { say: ['pause downloads'], run: 'action:pause' },
        { say: ['downloads'], run: 'tool:status' },
        { say: ['remove the stuck one'], run: 'tool:remove', input: { name: 'stuck' } },
        { say: ['add a torrent'], run: 'tool:add', input: { name: 'thing' } },
        { say: ['broken input'], run: 'tool:remove', input: { name: 7 } },
        { say: ['nothing playing'], run: 'tool:remove', input: () => { throw new Error(`nothing to remove ${SECRET}`); } },
        { say: ['use the plan'], run: 'tool:plan' as any },
      ],
      actions: { pause: { description: 'Pause all', input: z.object({ hash: z.string().default('all') }), async run({ hash }) { ran.action.push(`pause ${hash}`); return { done: 'Paused everything' }; } } },
      tools: {
        status: read('status', {}),
        remove: { description: 'remove one', access: 'control', label: 'Removed a download', undo: 'add', input: z.object({ name: z.string() }),
          confirm: ({ name }) => ({ title: `Remove ${name}?`, verb: 'Remove', danger: true }), async run({ name }) { ran.tool.push(`remove ${name}`); return { data: { removed: name }, card: { type: 'text', text: `Removed ${name}` } }; } },
        add: { description: 'add one', access: 'write', input: z.object({ name: z.string() }), async run({ name }) { ran.tool.push(`add ${name}`); return { data: { added: name } }; } },
      },
    }],
    ['ads', {
      widgets: {},
      commands: [{ say: ['pause ads {minutes} min', 'pause {name} {minutes} min'], run: 'action:pause', label: 'Pause ads: {minutes} min' }, { say: ['ad blocking'], run: 'tool:status' }],
      actions: { pause: { description: 'Pause blocking', input: z.object({ minutes: z.number().int().min(0).max(1440) }), async run({ minutes }) { ran.action.push(`ads ${minutes}`); } } },
      tools: { status: read('ads', {}) },
    }],
    // Valet's own setup tools: a command may never reach them, whatever is declared
    ['config', {
      widgets: {},
      commands: [{ say: ['rewrite my config'], run: 'tool:config_apply' }, { say: ['show my config'], run: 'tool:config_read' }],
      tools: {
        config_apply: { description: 'x', access: 'control', input: z.object({}), async run() { ran.tool.push('config_apply'); return { data: {} }; } },
        config_read: { description: 'x', access: 'read', input: z.object({}), async run() { ran.tool.push('config_read'); return { data: {} }; } },
      },
    }],
  ]);
}

function serve(opts: { assistant?: object; acting?: boolean } = {}) {
  const ran: Ran = { tool: [], action: [] };
  const instances = lab(ran), activity = new Activity(redactor([SECRET]));
  const site = {
    config: Config.parse(opts.assistant ? { assistant: { model: 'm', ...opts.assistant } } : {}),
    instances, meta: new Map([...instances.keys()].map(id => [id, { type: id === 'downloads' ? 'qbittorrent' : id, name: id === 'ads' ? 'Pi-hole' : id }])),
    acting: opts.acting ?? true, redact: redactor([SECRET]), activity,
  };
  const app = new Hono();
  app.use('/api/*', sameOrigin);
  // a session is a cookie here; the real sign-in is tested in server.test.ts and test:exposure
  app.use('/api/*', async (c, next) => { if (!/session=ok/.test(c.req.header('cookie') ?? '')) return c.json({ error: 'not signed in' }, 401); (c.set as any)('user', 'sam'); return next(); });
  app.get('/api/commands', c => listCommands(c, site as any));
  app.post('/api/command', c => runCommand(c, site as any));
  const H = { 'Content-Type': 'application/json', cookie: 'session=ok', host: 'valet.test' };
  const run = async (text: string, id?: string, go?: boolean) => {
    const known = id ?? (await (await app.request('/api/commands', { headers: H })).json()).commands.find((c: any) => match([c], text).some(m => m.exact))?.id ?? `none`;
    const r = await app.request('/api/command', { method: 'POST', headers: H, body: JSON.stringify({ text, id: known, go }) });
    return { status: r.status, body: await r.json() as any };
  };
  const listed = async () => (await (await app.request('/api/commands', { headers: H })).json()).commands as any[];
  return { app, ran, site, activity, run, listed, H };
}
const idOf = async (s: ReturnType<typeof serve>, text: string) => (await commandsOf(s.site as any)).find(e => match([e], text).some(m => m.exact))!.id;

test('gate: without an assistant, commands run page actions and tools that only look', async () => {
  const s = serve();
  const said = (await s.listed()).map(c => c.say[0]);
  assert.ok(said.includes('pause downloads') && said.includes('downloads') && said.includes('ad blocking'));
  assert.ok(!said.includes('remove the stuck one') && !said.includes('add a torrent'), 'nothing that changes through a tool');
  const look = await s.run('downloads');
  assert.equal(look.status, 200);
  assert.equal(look.body.card.type, 'text');
  const act = await s.run('pause all downloads');
  assert.equal(act.status, 200);
  assert.equal(act.body.done, 'Paused everything');
  assert.deepEqual(s.ran.action, ['pause all']);
  const no = await s.run('remove the stuck one', await idOf(s, 'remove the stuck one'));
  assert.equal(no.status, 403);
  assert.match(no.body.error, /without an assistant/);
  assert.ok(!s.ran.tool.some(t => t.startsWith('remove')));
});

test('gate: the assistant\'s access decides which tools a command may use', async () => {
  const s = serve({ assistant: { access: { default: 'read', downloads: 'control' } } });
  const r = await s.run('remove the stuck one');
  assert.equal(r.status, 200);
  assert.ok(r.body.confirm, 'asks first');
  const w = serve({ assistant: { access: { default: 'read', downloads: 'write' } } });
  assert.equal((await w.run('remove the stuck one', await idOf(w, 'remove the stuck one'))).status, 403, 'write is not control');
  assert.ok((await w.run('add a torrent')).body.confirm, 'write is enough to add');
  const none = serve({ assistant: { access: { default: 'read', downloads: 'none' } } });
  assert.ok(!(await none.listed()).some(c => c.say[0] === 'downloads'));
  assert.equal((await none.run('downloads', await idOf(none, 'downloads'))).status, 403, 'none means not even looking');
  assert.equal((await none.run('pause downloads')).status, 200, 'page actions are the page\'s, as their buttons are');
});

test('gate: a read-only page only looks', async () => {
  const s = serve({ acting: false, assistant: { access: { default: 'control' } } });
  const listed = (await s.listed()).map(c => c.say[0]);
  assert.deepEqual(listed.sort(), ['ad blocking', 'downloads']);
  assert.equal((await s.run('pause downloads', await idOf(s, 'pause downloads'))).status, 403);
  assert.equal((await s.run('remove the stuck one', await idOf(s, 'remove the stuck one'), true)).status, 403);
  assert.equal((await s.run('downloads')).status, 200);
  assert.deepEqual(s.ran.action, []);
});

test('gate: what changes something asks with the tool\'s own words, runs only on go, and is logged', async () => {
  const s = serve({ assistant: { access: { default: 'control' } } });
  const id = await idOf(s, 'remove the stuck one');
  const ask = await s.run('remove the stuck one', id);
  assert.deepEqual(ask.body.confirm, { logo: '/api/icon/qbittorrent', title: 'Remove stuck?', verb: 'Remove', danger: true });
  assert.deepEqual(s.ran.tool, [], 'nothing ran while asking');
  const done = await s.run('remove the stuck one', id, true);
  assert.equal(done.status, 200);
  assert.equal(done.body.card.text, 'Removed stuck');
  assert.deepEqual(s.ran.tool, ['remove stuck']);
  const e = s.activity.entries.at(-1)!;
  assert.equal(e.via, 'command');
  assert.equal(e.who, 'sam');
  assert.deepEqual(e.undo, { tool: 'downloads__add', input: { name: 'stuck' } });
  const act = s.activity.entries.length;
  await s.run('downloads');
  assert.equal(s.activity.entries.length, act, 'looking is not logged, as in chat');
  await s.run('pause downloads');
  assert.equal(s.activity.entries.at(-1)!.via, 'command');
});

test('gate: input is checked by the target\'s schema, and a slot can\'t go past it', async () => {
  const s = serve({ assistant: { access: { default: 'control' } } });
  assert.equal((await s.run('pause ads 10 min')).status, 200);
  assert.deepEqual(s.ran.action, ['ads 10']);
  assert.equal((await s.run('pause pi-hole 20 min')).status, 200, '{name} is the integration\'s name too');
  const big = await s.run('pause ads 5000 min', await idOf(s, 'pause ads 1 min'));
  assert.equal(big.status, 400);
  assert.equal((await s.run('broken input', await idOf(s, 'broken input'), true)).status, 400);
  const cant = await s.run('nothing playing', await idOf(s, 'nothing playing'), true);
  assert.equal(cant.status, 409);
  assert.ok(!JSON.stringify(cant.body).includes(SECRET), 'its reason is redacted');
  assert.deepEqual(s.ran.action, ['ads 10', 'ads 20']);
});

test('gate: what runs is what was typed, and never Valet\'s own tools, plan or MCP', async () => {
  const s = serve({ assistant: { access: { default: 'control', config: 'control' } } });
  const all = await s.listed();
  assert.ok(!all.some(c => /config/.test(c.say[0]) || c.say[0] === 'use the plan'));
  for (const id of ['config:0', 'config:1', 'downloads:6', 'plan', 'mcp_x__y']) {
    for (const text of ['rewrite my config', 'show my config', 'use the plan']) assert.equal((await s.run(text, id, true)).status, 404, `${text} as ${id}`);
  }
  // the id of something that changes, with the words of something that looks: refused, not run
  assert.equal((await s.run('downloads', await idOf(s, 'remove the stuck one'), true)).status, 404);
  assert.equal((await s.run('pause downlods', await idOf(s, 'pause downloads'))).status, 404);
  assert.deepEqual(s.ran, { tool: [], action: [] });
});

test('gate: results are redacted, and no session or another site gets nothing', async () => {
  const s = serve();
  const r = await s.run('downloads');
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
  assert.equal((await s.app.request('/api/commands')).status, 401);
  assert.equal((await s.app.request('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'pause downloads', id: 'downloads:0' }) })).status, 401);
  const cross = await s.app.request('/api/command', { method: 'POST', headers: { ...s.H, origin: 'https://evil.example' }, body: JSON.stringify({ text: 'pause downloads', id: 'downloads:0' }) });
  assert.equal(cross.status, 403);
  assert.deepEqual(s.ran.action, []);
  assert.equal((await s.app.request('/api/command', { method: 'POST', headers: s.H, body: JSON.stringify({ text: 'x'.repeat(500), id: 'downloads:0' }) })).status, 400);
});

test('no model is asked anything: commands run with the model\'s server set to fail the test', async () => {
  let asked = 0;
  const model = createServer((_, res) => { asked++; res.statusCode = 500; res.end(); });
  await new Promise<void>(ok => model.listen(0, '127.0.0.1', ok));
  const baseURL = `http://127.0.0.1:${(model.address() as any).port}/v1`;
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: any, i?: any) => { if (String(u).startsWith(baseURL)) asked++; return real(u, i); }) as typeof fetch;
  try {
    const s = serve({ assistant: { baseURL, access: { default: 'control' } } });
    await s.listed();
    await s.run('downloads');
    await s.run('pause downloads');
    await s.run('pause ads 5 min');
    const id = await idOf(s, 'remove the stuck one');
    await s.run('remove the stuck one', id);
    await s.run('remove the stuck one', id, true);
    await s.run('no such thing', 'downloads:0');
    assert.deepEqual(s.ran, { tool: ['status', 'remove stuck'], action: ['pause all', 'ads 5'] });
    assert.equal(asked, 0, 'the model was contacted');
  } finally { globalThis.fetch = real; model.close(); }
  // and none could be: nothing on the command path imports the model, the chat or the AI SDK
  for (const f of ['src/server/commands.ts', 'src/shared/commands.ts']) {
    const src = await readFile(f, 'utf8');
    assert.doesNotMatch(src, /from '(\.\/(model|chat|brain|mcp|insight)\.ts|ai|@ai-sdk\/[^']+)'/, f);
  }
});
