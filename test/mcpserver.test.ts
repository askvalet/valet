// Valet as an MCP server, and the changes a client may ask for: nothing past looking is offered unless the owner opened
// it, nothing runs on the client's word, and a yes covers one exact call, once. Made-up services only.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-mcp-'));
const { mcpServer } = await import('../src/server/mcpserver.ts');
const { Asks, ASK_FOR, WAITING, hashOf } = await import('../src/server/asks.ts');
const { Config } = await import('../src/server/config.ts');
const { Activity } = await import('../src/server/activity.ts');

const TOKEN = 'mcp-token-0123456789abcdef0123456789', SECRET = 'sekret-value-123';
function lab(access: object = { default: 'control' }, o: { acting?: boolean; hold?: number } = {}) {
  const ran: string[] = [], pushed: any[] = [], emitted: any[] = [], redact = (s: string) => s.replaceAll(SECRET, '•••');
  const tool = (name: string, a: 'read' | 'write' | 'control', more: object = {}) => ({ description: name, label: name, access: a, input: z.object({ name: z.string().default('all') }), run: async ({ name: n }: { name: string }) => { ran.push(`${name} ${n}`); return { data: { did: name, key: SECRET } }; }, ...more });
  const instances = new Map<string, any>([
    ['dl', { widgets: {}, tools: { status: tool('status', 'read'), add: tool('add', 'write'), pause: tool('pause', 'control', { confirm: ({ name }: { name: string }) => ({ title: `Pause ${name}?`, detail: `It holds ${SECRET}`, verb: 'Pause' }) }), boom: { ...tool('boom', 'control'), run: async () => { throw new Error(`failed ${SECRET}`); } } } }],
    ['config', { widgets: {}, tools: { config_read: tool('config_read', 'read'), config_apply: tool('config_apply', 'control') } }],
    ['valet', { widgets: {}, tools: { rule_list: tool('rule_list', 'read'), rule_add: tool('rule_add', 'control') } }],
    ['pins', { widgets: {}, tools: { pin_remove: tool('pin_remove', 'control') } }],
  ]);
  const site: any = { config: Config.parse({ mcpServer: { token: TOKEN, access } }), instances, meta: new Map([...instances.keys()].map(id => [id, { type: id, name: id }])),
    acting: o.acting ?? true, redact, activity: new Activity(redact), push: (m: any) => pushed.push(m), events: { emit: (e: any) => emitted.push(e) }, hub: { refreshInstance() {} } };
  const asks = new Asks(), app = new Hono().post('/mcp', c => mcpServer(c, site, asks, o.hold ?? 2000));
  let id = 0;
  const rpc = async (method: string, params?: object) => (await (await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json()) as any;
  const call = async (name: string, args: object = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { text: r.content[0].text as string, isError: r.isError as boolean }; };
  const names = async () => ((await rpc('tools/list')).result.tools as any[]).map(t => t.name).sort();
  return { site, asks, ran, pushed, emitted, rpc, call, names };
}
const asked = (asks: InstanceType<typeof Asks>) => new Promise<void>(ok => { if (asks.list().length) return ok(); const l = () => { asks.listeners.delete(l); ok(); }; asks.listeners.add(l); });

test('left as it was, it only looks: nothing that changes is listed or can be called', async () => {
  const l = lab({ default: 'read' });
  assert.deepEqual(await l.names(), ['dl__status', 'valet__rule_list']);
  assert.match((await l.rpc('tools/call', { name: 'dl__pause', arguments: {} })).error.message, /no tool/);
  assert.match((await l.rpc('initialize', {})).result.instructions, /read-only/);
  assert.deepEqual(l.ran, []);
});

test('opened up, each level offers what the chat would, never Valet\'s own tools that change, and never on a read-only page', async () => {
  assert.deepEqual(await lab({ default: 'control' }).names(), ['dl__add', 'dl__boom', 'dl__pause', 'dl__status', 'valet__rule_list']);
  assert.deepEqual(await lab({ default: 'read', dl: 'write' }).names(), ['dl__add', 'dl__status', 'valet__rule_list']);
  assert.deepEqual(await lab({ default: 'none', dl: 'control' }).names(), ['dl__add', 'dl__boom', 'dl__pause', 'dl__status']);
  assert.deepEqual(await lab({ default: 'control' }, { acting: false }).names(), ['dl__status', 'valet__rule_list']);
  const l = lab(), tools = (await l.rpc('tools/list')).result.tools as any[], hints = (n: string) => tools.find(t => t.name === n).annotations;
  assert.deepEqual([hints('dl__status').readOnlyHint, hints('dl__add').readOnlyHint, hints('dl__add').destructiveHint, hints('dl__pause').destructiveHint], [true, false, false, true]);
  assert.match((await l.rpc('initialize', {})).result.instructions, /approve/);
});

test('a change waits for a yes on the page, in the tool\'s own words; then it runs, once, and is logged', async () => {
  const l = lab(), going = l.call('dl__pause', { name: 'Dune' });
  await asked(l.asks);
  assert.deepEqual(l.ran, [], 'nothing ran on the client\'s word');
  const [a] = l.asks.list();
  assert.deepEqual([a.from, a.tool, a.said.title, a.said.detail, a.said.verb, a.said.logo], ['MCP client', 'dl__pause', 'Pause Dune?', 'It holds •••', 'Pause', '/api/icon/dl']);
  assert.deepEqual(l.pushed, [{ title: 'Something is waiting for your approval', text: 'Pause Dune?', urgent: true }]);
  // and out as an event, for whatever else is listening: which call, in the tool's own words, with the secret taken out
  assert.deepEqual(l.emitted, [{ type: 'ask', id: a.id, from: 'MCP client', tool: 'dl__pause', title: 'Pause Dune?' }]);
  l.asks.answer(a.id, true);
  const r = await going;
  assert.deepEqual(l.ran, ['pause Dune']);
  assert.equal(r.isError, false);
  assert.ok(!r.text.includes(SECRET) && r.text.includes('pause'));
  const e = l.site.activity.entries.at(-1);
  assert.deepEqual([e.who, e.via, e.what, e.ok], ['MCP client', 'mcp', 'pause', true]);
  assert.deepEqual(l.asks.list(), []);
  // the yes was for that call: the same one again asks again
  const again = l.call('dl__pause', { name: 'Dune' });
  await asked(l.asks);
  assert.deepEqual(l.ran, ['pause Dune']);
  l.asks.answer(l.asks.list()[0].id, false);
  assert.match((await again).text, /declined/);
  assert.deepEqual(l.ran, ['pause Dune']);
  assert.equal(l.site.activity.entries.at(-1).ok, false);
});

test('a client that stops waiting hears it\'s waiting; a yes given later covers that exact call, once, and no other', async () => {
  const l = lab({ default: 'control' }, { hold: 5 });
  const first = await l.call('dl__pause', { name: 'Dune' });
  assert.equal(first.isError, true);
  assert.match(first.text, /waiting for the owner to approve[\s\S]*Pause Dune\?[\s\S]*same arguments/);
  assert.deepEqual(l.ran, []);
  assert.match((await l.call('dl__pause', { name: 'Dune' })).text, /waiting/);
  assert.equal(l.asks.list().length, 1, 'asking again joins the same question');
  assert.equal(l.pushed.length, 1, 'and tells the owner once');
  l.asks.answer(l.asks.list()[0].id, true);
  assert.deepEqual(l.ran, [], 'a yes runs nothing by itself');
  assert.match((await l.call('dl__pause', { name: 'Heat' })).text, /waiting/, 'other arguments are another question');
  assert.deepEqual(l.ran, []);
  assert.equal((await l.call('dl__pause', { name: 'Dune' })).isError, false);
  assert.deepEqual(l.ran, ['pause Dune']);
  assert.match((await l.call('dl__pause', { name: 'Dune' })).text, /waiting/, 'used up');
  assert.deepEqual(l.ran, ['pause Dune']);
});

test('a tool without words of its own says which tool and with what; a failure comes back redacted', async () => {
  const l = lab(), going = l.call('dl__boom', { name: SECRET });
  await asked(l.asks);
  const [a] = l.asks.list();
  assert.deepEqual([a.said.title, a.said.detail], ['dl: boom?', '{"name":"•••"}']);
  l.asks.answer(a.id, true);
  const r = await going;
  assert.equal(r.isError, true);
  assert.ok(!r.text.includes(SECRET));
});

test('the page can\'t be flooded: a handful wait at most, and bad arguments never ask', async () => {
  const l = lab({ default: 'control' }, { hold: 5 });
  for (let i = 0; i < WAITING; i++) await l.call('dl__pause', { name: `n${i}` });
  assert.match((await l.call('dl__pause', { name: 'one more' })).text, /Too many/);
  assert.equal(l.asks.list().length, WAITING);
  assert.match((await l.call('dl__pause', { name: 7 })).text, /bad arguments/);
  assert.equal(l.asks.list().length, WAITING);
});

test('asks: a question lapses after ten minutes, and so does a yes nobody came back for', async () => {
  let now = 1000;
  const asks = new Asks(() => now), said = { title: 'Pause?' }, hash = hashOf('dl__pause', { b: 1, a: { d: 1, c: 2 } });
  assert.equal(hash, hashOf('dl__pause', { a: { c: 2, d: 1 }, b: 1 }), 'the same input in another order is the same call');
  assert.notEqual(hash, hashOf('dl__resume', { a: { c: 2, d: 1 }, b: 1 }));
  assert.equal(await asks.request({ from: 'x', tool: 'dl__pause', hash, said }, 1).answer, 'waiting');
  const [a] = asks.list();
  now += ASK_FOR + 1;
  assert.deepEqual(asks.list(), []);
  assert.equal(asks.answer(a.id, true), null, 'answering what lapsed does nothing');
  assert.equal(asks.take(hash), false);
  assert.equal(await asks.request({ from: 'x', tool: 'dl__pause', hash, said }, 1).answer, 'waiting');
  asks.answer(asks.list()[0].id, true);
  now += ASK_FOR + 1;
  assert.equal(asks.take(hash), false, 'a yes left unused is forgotten');
  assert.equal(asks.answer('nope', true), null);
});

test('config: access takes the assistant\'s levels, read by default', () => {
  assert.deepEqual(Config.parse({ mcpServer: { token: TOKEN } }).mcpServer!.access, { default: 'read' });
  assert.equal(Config.safeParse({ mcpServer: { token: TOKEN, access: { dl: 'control', docs: 'write', x: 'none' } } }).success, true);
  assert.equal(Config.safeParse({ mcpServer: { token: TOKEN, access: { dl: 'admin' } } }).success, false);
});
