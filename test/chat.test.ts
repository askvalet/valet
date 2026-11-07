// The chat's rules, with a scripted model: what it's offered, what asks first, what's redacted and what's logged. The
// model here does exactly what the script says, including the things it must not be able to do. `npm run eval:chat`
// covers the other half: whether a real model picks the right tools.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-chat-'));
const { chatRoute } = await import('../src/server/chat.ts');
const { Config } = await import('../src/server/config.ts');
const { Activity } = await import('../src/server/activity.ts');

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const stream = (parts: any[], reason: string) => ({ stream: new ReadableStream({ start(c) {
  c.enqueue({ type: 'stream-start', warnings: [] });
  for (const p of parts) c.enqueue(p);
  c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
  c.close();
} }) });
/** Each turn the model takes: a list of [tool, input] calls, or words. */
function scripted(...turns: ([string, object][] | string)[]) {
  let n = 0, id = 0;
  return new MockLanguageModelV4({ doStream: async () => {
    const t = turns[n++] ?? 'done';
    if (typeof t === 'string') return stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }], 'stop') as any;
    return stream(t.map(([toolName, input]) => ({ type: 'tool-call', toolCallId: `c${++id}`, toolName, input: JSON.stringify(input) })), 'tool-calls') as any;
  } });
}

const ran: string[] = [];
const tool = (name: string, access: 'read' | 'write' | 'control', extra: object = {}, out: unknown = { ok: true }) => ({ description: name, label: name, access, input: z.object({ url: z.string().optional(), n: z.number().optional() }), run: async () => { ran.push(name); return { data: out }; }, ...extra });
const home = () => new Map<string, any>([
  ['dl', { widgets: {}, tools: { status: tool('status', 'read', {}, { key: 'sekret-value-123' }), pause: tool('pause', 'control', { undo: 'resume' }), resume: tool('resume', 'control'), boom: { ...tool('boom', 'control'), run: async () => { ran.push('boom'); throw new Error('failed with sekret-value-123'); } } } }],
  ['links', { widgets: {}, tools: { save: tool('save', 'write') } }],
  ['secret', { widgets: {}, tools: { peek: tool('peek', 'read') } }],
  ['config', { widgets: {}, tools: { config_apply: tool('config_apply', 'control') } }],
  ['valet', { widgets: {}, tools: { rule_add: tool('rule_add', 'control') } }],
]);
const meta = () => new Map<string, any>(['dl', 'links', 'secret', 'config', 'valet'].map(id => [id, { type: id, name: id }]));
const redact = (s: string) => s.replaceAll('sekret-value-123', '•••');

async function talk(model: MockLanguageModelV4, messages: any[], o: { acting?: boolean; access?: object; activity?: InstanceType<typeof Activity>; assistant?: object } = {}) {
  ran.length = 0;
  const config = Config.parse({ assistant: { model: 'm', ...o.assistant, access: { default: 'read', dl: 'control', links: 'write', secret: 'none', config: 'control', ...o.access } } });
  const app = new Hono();
  app.post('/chat', chatRoute(config, home(), meta(), { acting: o.acting ?? true, redact, activity: o.activity, model: model as any }) as any);
  const r = await app.request('/chat', { method: 'POST', body: JSON.stringify({ messages }) });
  const text = await r.text();
  return { text, events: text.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6))), offered: Object.keys(model.doStreamCalls[0]?.tools?.reduce?.((m: any, t: any) => ({ ...m, [t.name]: 1 }), {}) ?? {}) };
}
const talkWith = (model: MockLanguageModelV4, messages: any[], assistant: object) => talk(model, messages, { assistant });
const say = (text: string) => [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }];

test('access: it\'s offered only what its level allows, and nothing that acts on a read-only page', async () => {
  const full = await talk(scripted('hi'), say('hi'));
  assert.deepEqual(full.offered.filter(t => t.startsWith('dl__')).sort(), ['dl__boom', 'dl__pause', 'dl__resume', 'dl__status']);
  assert.ok(full.offered.includes('links__save') && full.offered.includes('plan'));
  assert.ok(!full.offered.includes('secret__peek'));                                   // access: none
  const looking = await talk(scripted('hi'), say('hi'), { access: { dl: 'read' } });
  assert.deepEqual(looking.offered.filter(t => t.startsWith('dl__')), ['dl__status']);
  const readOnly = await talk(scripted('hi'), say('hi'), { acting: false });
  assert.deepEqual(readOnly.offered.filter(t => !t.includes('search')).sort(), ['dl__status', 'present']);   // present only draws a card
});

test('a read tool just runs; its result reaches neither the model nor the page unredacted', async () => {
  const model = scripted([['dl__status', {}]], 'all fine');
  const r = await talk(model, say('how is it'));
  assert.deepEqual(ran, ['status']);
  assert.ok(!r.text.includes('sekret-value-123'));
  assert.ok(!JSON.stringify(model.doStreamCalls[1].prompt).includes('sekret-value-123'));
});

test('a control tool asks first and doesn\'t run until approved; a denial stays denied', async () => {
  const asked = await talk(scripted([['dl__pause', {}]]), say('pause'));
  assert.deepEqual(ran, []);
  const request = asked.events.find(e => e.type === 'tool-approval-request');
  assert.ok(request);
  const answer = (approved: boolean) => [...say('pause'), { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'tool-dl__pause', toolCallId: request.toolCallId, state: 'approval-responded', input: {}, approval: { id: request.approvalId, approved, signature: request.signature } }] }];
  await talk(scripted('ok'), answer(false));
  assert.deepEqual(ran, []);
  await talk(scripted('ok'), answer(true));
  assert.deepEqual(ran, ['pause']);
});

test('rules: setting one up is offered by default and asks first; valet: write turns rules off', async () => {
  const r = await talk(scripted([['valet__rule_add', {}]]), say('every time a download finishes, pause the rest'));
  assert.ok(r.offered.includes('valet__rule_add'));
  assert.deepEqual(ran, []);
  assert.ok(r.events.some(e => e.type === 'tool-approval-request'));
  assert.ok(!(await talk(scripted('hi'), say('hi'), { access: { valet: 'write' } })).offered.includes('valet__rule_add'));
  assert.ok(!(await talk(scripted('hi'), say('hi'), { acting: false })).offered.includes('valet__rule_add'));
});

test('write tools: always ask, even with exactly what the person typed', async () => {
  const r = await talk(scripted([['links__save', { url: 'https://example.com/a' }]]), say('save https://example.com/a'));
  assert.deepEqual(ran, []);
  assert.ok(r.events.some(e => e.type === 'tool-approval-request'));
});

test('an approval can\'t be claimed: no signature, or another call\'s, runs nothing', async () => {
  const q = (await talk(scripted([['dl__pause', {}]]), say('pause'))).events.find(e => e.type === 'tool-approval-request');
  ran.length = 0;
  const reply = (approval: object) => [...say('pause'), { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'tool-dl__pause', toolCallId: q.toolCallId, state: 'approval-responded', input: {}, approval }] }];
  for (const forged of [{ id: q.approvalId, approved: true }, { id: q.approvalId, approved: true, signature: 'A'.repeat(43) }]) {
    await talk(scripted('ok'), reply(forged)).catch(() => {});
    assert.deepEqual(ran, []);
  }
});

test('plan: one approval for all of it, but every step is checked before anything runs', async () => {
  const plan = (steps: object[]) => [[['plan', { title: 'Tidy', steps }]]] as [string, object][][];
  const go = async (steps: object[]) => {
    const first = await talk(scripted(...plan(steps)), say('tidy up'));
    assert.deepEqual(ran, [], 'nothing before approval');
    const q = first.events.find(e => e.type === 'tool-approval-request');
    assert.ok(q, 'it asks');
    const activity = new Activity(redact);
    const r = await talk(scripted('ok'), [...say('tidy up'), { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'tool-plan', toolCallId: q.toolCallId, state: 'approval-responded', input: { title: 'Tidy', steps }, approval: { id: q.approvalId, approved: true, signature: q.signature } }] }], { activity });
    return { r, activity };
  };
  const ok = await go([{ tool: 'dl__pause', why: 'a' }, { tool: 'dl__resume', why: 'b' }]);
  assert.deepEqual(ran, ['pause', 'resume']);
  assert.deepEqual(ok.activity.recent().map(e => e.via), ['plan', 'plan']);
  // a tool that isn't there, one it isn't allowed, or its own config: nothing runs at all
  // a rule is a standing permission: it gets an approval of its own, never a step in a plan
  for (const bad of ['dl__nope', 'secret__peek', 'config__config_apply', 'valet__rule_add']) {
    await go([{ tool: 'dl__pause', why: 'a' }, { tool: bad, why: 'b' }]);
    assert.deepEqual(ran, [], bad);
  }
  // it stops at the first failure
  await go([{ tool: 'dl__boom', why: 'a' }, { tool: 'dl__pause', why: 'b' }]);
  assert.deepEqual(ran, ['boom']);
});

test('activity: changes are logged, redacted, with their undo; looking isn\'t logged', async () => {
  const activity = new Activity(redact);
  await talk(scripted([['dl__status', {}]], 'done'), say('how are the downloads'), { activity });
  assert.deepEqual(activity.recent(), []);
  const q = (await talk(scripted([['dl__pause', {}]]), say('pause'))).events.find(e => e.type === 'tool-approval-request');
  await talk(scripted('ok'), [...say('pause'), { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'tool-dl__pause', toolCallId: q.toolCallId, state: 'approval-responded', input: {}, approval: { id: q.approvalId, approved: true, signature: q.signature } }] }], { activity });
  assert.deepEqual(activity.recent()[0].undo, { tool: 'dl__resume', input: {} });
  const q2 = (await talk(scripted([['dl__boom', {}]]), say('go'))).events.find(e => e.type === 'tool-approval-request');
  await talk(scripted('ok'), [...say('go'), { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'tool-dl__boom', toolCallId: q2.toolCallId, state: 'approval-responded', input: {}, approval: { id: q2.approvalId, approved: true, signature: q2.signature } }] }], { activity });
  assert.equal(activity.recent()[0].ok, false);
  assert.equal(activity.recent()[0].error, 'failed with •••');
});

test('history: reasoning left in old replies isn\'t sent back, and only the last 24 messages go', async () => {
  const model = scripted('fine');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: i % 2 ? `secret plan ${i}</think>answer ${i}` : `q${i}` }] }));
  await talk(model, [...many, ...say('last')]);
  const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
  assert.ok(!prompt.includes('</think>') && !prompt.includes('secret plan'));
  assert.ok(prompt.includes('answer 39') && !prompt.includes('q0"'));
});

test('live cards: only tools that opted in are marked, and they must only look', async () => {
  const { registry } = await import('../src/integrations/index.ts');
  const ctx: any = { id: 't', http: async () => ({}), log() {}, image: (r: string) => r, upload: async () => ({}), session: () => ({ get: async () => '', reset() {} }) };
  const sample: Record<string, object> = { http: { targets: [] }, weather: { latitude: 1, longitude: 2 } };
  const live: string[] = [];
  for (const [type, i] of Object.entries(registry)) {
    let inst; try { inst = i.create(i.config.parse({ url: 'http://x', apiKey: 'k', token: 't', password: 'p', username: 'u', ...sample[type] }), ctx); } catch { continue; }
    for (const [name, t] of Object.entries(inst.tools ?? {})) if ((t as any).live) { live.push(name); assert.equal(t.access, 'read', name); }
  }
  assert.ok(live.includes('downloads_status') && live.includes('plex_streams'));
});

test('steps: the last one is for answering, so running out never means saying nothing', async () => {
  const model = scripted([['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], 'here is the answer');
  const r = await talk(model, say('dig into it'));
  assert.equal(model.doStreamCalls.length, 6);
  assert.equal(model.doStreamCalls[5].toolChoice?.type, 'none');
  assert.equal(model.doStreamCalls[4].toolChoice?.type ?? 'auto', 'auto');
  assert.match(r.text, /here is the answer/);
});

test('long chats: old tool results shrink, recent ones stay whole, and it says it shortened them', async () => {
  const { trimHistory } = await import('../src/server/chat.ts');
  const big = 'x'.repeat(5000), reply = (id: string) => ({ id, role: 'assistant', parts: [{ type: 'tool-a__b', toolCallId: id, state: 'output-available', input: {}, output: { data: big } }] }) as any;
  const trimmed = trimHistory([reply('old'), ...Array.from({ length: 6 }, (_, i) => reply(`new${i}`))]);
  assert.ok(JSON.stringify((trimmed[0].parts[0] as any).output).length < 1400);
  assert.match(JSON.stringify((trimmed[0].parts[0] as any).output), /shortened/);
  assert.equal((trimmed[6].parts[0] as any).output.data.length, 5000);
  const model = scripted('fine');
  await talk(model, [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'a' }] }, { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'thinking aloud</think>b' }] }, ...say('c')]);
  assert.ok(!JSON.stringify(model.doStreamCalls[0].prompt).includes('thinking aloud'));
});

test('context: each step says how much of the model\'s window the chat now takes, from the usage it reported', async () => {
  const r = await talk(scripted('hello'), say('hi'));
  const meta = r.events.filter(e => e.type === 'message-metadata').map(e => e.messageMetadata);
  assert.deepEqual(meta.at(-1), { context: { used: 2 } });   // one in, one out; the test's model has no known window
});

// ---- per-tool access, reasoning and sampling, the forced last step -------------------------------------------------------
const { actionFor } = await import('../src/server/rules.ts');
const { toolAccess } = await import('../src/server/run.ts');

test('per-tool access: a dotted key takes one tool away everywhere, or gives one more than its integration', async () => {
  const off = await talk(scripted('hi'), say('hi'), { access: { dl: 'control', 'dl.pause': 'none' } });
  assert.ok(!off.offered.includes('dl__pause') && off.offered.includes('dl__resume') && off.offered.includes('dl__status'));
  const config = Config.parse({ assistant: { model: 'm', access: { default: 'read', dl: 'control', 'dl.pause': 'none' } } });
  const env = { instances: () => home(), access: (id: string, t?: string) => toolAccess(config.assistant, id, t) };
  assert.match((actionFor('dl__pause', {}, env) as any).error, /needs control access/);   // a rule can't use it either
  assert.ok(!('error' in actionFor('dl__resume', {}, env)));
  const up = await talk(scripted('hi'), say('hi'), { access: { dl: 'read', 'dl.pause': 'control' } });
  assert.ok(up.offered.includes('dl__pause') && !up.offered.includes('dl__resume') && up.offered.includes('dl__status'));
  // a read-only page still only looks, whatever a key raises
  const ro = await talk(scripted('hi'), say('hi'), { acting: false, access: { dl: 'read', 'dl.pause': 'control' } });
  assert.ok(!ro.offered.includes('dl__pause'));
  // the chat's own built-ins answer to valet.<name>
  const builtins = await talk(scripted('hi'), say('hi'), { access: { 'valet.plan': 'none', 'valet.present': 'none' } });
  assert.ok(!builtins.offered.includes('plan') && !builtins.offered.includes('present'));
  // no dotted keys: exactly what the integration's level gives, as before
  const plain = await talk(scripted('hi'), say('hi'));
  assert.ok(['dl__pause', 'dl__resume', 'plan', 'present'].every(t => plain.offered.includes(t)));
});

test('a plan can\'t take a step its access takes away', async () => {
  const model = scripted([['plan', { title: 't', steps: [{ tool: 'dl__resume', why: 'x' }, { tool: 'dl__pause', why: 'y' }] }]], 'ok');
  const r = await talk(model, say('go'), { access: { dl: 'control', 'dl.pause': 'none' } });
  const request = r.events.find(e => e.type === 'tool-approval-request'), call = r.events.find(e => e.type === 'tool-input-available');
  const msgs = [...say('go'), { id: 'a1', role: 'assistant', parts: [{ type: 'tool-plan', toolCallId: call.toolCallId, state: 'approval-responded', input: call.input, approval: { id: request.approvalId, approved: true, signature: request.signature } }] }];
  const again = await talk(scripted('done'), msgs, { access: { dl: 'control', 'dl.pause': 'none' } });
  assert.deepEqual(ran, []);   // nothing ran, not even the allowed step
  assert.match(again.text, /no tool dl__pause/);
});

const firstCall = async (assistant: object) => {
  const model = scripted('hi');
  const app = new Hono();
  app.post('/chat', chatRoute(Config.parse({ assistant: { model: 'm', ...assistant } }), home(), meta(), { acting: true, redact, model: model as any }) as any);
  await (await app.request('/chat', { method: 'POST', body: JSON.stringify({ messages: say('hi') }) })).text();
  return model.doStreamCalls[0] as any;
};

test('assistant.reasoning and assistant.options reach the model call, and left out change nothing', async () => {
  const auto = await firstCall({});
  assert.equal(auto.providerOptions?.assistant, undefined);
  assert.ok(auto.reasoning == null || auto.reasoning === 'provider-default');
  assert.equal(auto.temperature, undefined); assert.equal(auto.topP, undefined); assert.equal(auto.maxOutputTokens, undefined);
  assert.deepEqual((await firstCall({ reasoning: 'off' })).providerOptions.assistant, { chat_template_kwargs: { enable_thinking: false } });
  assert.equal((await firstCall({ reasoning: 'low' })).reasoning, 'low');
  assert.equal((await firstCall({ provider: 'anthropic', reasoning: 'off' })).reasoning, 'none');
  const tuned = await firstCall({ options: { temperature: 0.2, topP: 0.9, maxOutputTokens: 800 } });
  assert.equal(tuned.temperature, 0.2); assert.equal(tuned.topP, 0.9); assert.equal(tuned.maxOutputTokens, 800);
  assert.throws(() => Config.parse({ assistant: { model: 'm', options: { temperature: 5 } } }));
  assert.throws(() => Config.parse({ assistant: { model: 'm', options: { seed: 1 } } }));
  assert.throws(() => Config.parse({ assistant: { model: 'm', reasoning: 'max' } }));
});

test('the forced last step is short and doesn\'t think first, so a model that loops there stops soon', async () => {
  const model = scripted([['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], [['dl__status', {}]], 'here is the answer');
  await talk(model, say('dig into it'));
  const { LAST_STEP_TOKENS } = await import('../src/server/model.ts');
  const last = model.doStreamCalls[5] as any, before = model.doStreamCalls[4] as any;
  assert.equal(last.maxOutputTokens, LAST_STEP_TOKENS);
  assert.deepEqual(last.providerOptions?.assistant, { chat_template_kwargs: { enable_thinking: false } });
  assert.equal(before.maxOutputTokens, undefined);                        // the steps before keep the server's limit
  assert.equal(before.providerOptions?.assistant, undefined);
});

test('tools: lazy starts with Valet\'s own tools and an index, loads an integration when asked, and keeps it for follow-ups', async () => {
  const lazy = { tools: 'lazy' };
  const model = scripted([['tools', { use: ['dl'] }]], [['dl__status', {}]], 'all fine');
  const r = await talkWith(model, say('how is it'), lazy);
  const names = (i: number) => (model.doStreamCalls[i]!.tools ?? []).map((t: any) => t.name);
  assert.ok(names(0).includes('tools') && names(0).includes('valet__rule_add') && names(0).includes('config__config_apply'));
  assert.ok(!names(0).some((n: string) => n.startsWith('dl__') || n.startsWith('links__')));
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /- dl \(dl\): status, pause, resume, boom/);
  assert.ok(names(1).includes('dl__status') && names(1).includes('dl__pause') && !names(1).includes('links__save'));
  assert.deepEqual(ran, ['status']);
  assert.match(r.text, /all fine/);
  // approvals don't change: an unloaded tool is still registered and still asks
  const asked = await talkWith(scripted([['tools', { use: ['downloads', 'dl'] }]], [['dl__pause', {}]]), say('pause'), lazy);
  assert.deepEqual(ran, []);
  assert.ok(asked.events.some(e => e.type === 'tool-approval-request'));
  // used earlier in the chat: loaded from the first step
  const again = scripted('still fine');
  await talkWith(again, [...say('how is it'), { id: 'a1', role: 'assistant', parts: [{ type: 'tool-dl__status', toolCallId: 'x', state: 'output-available', input: {}, output: { data: {} } }, { type: 'text', text: 'fine' }] }, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'and now?' }] }], lazy);
  assert.ok((again.doStreamCalls[0]!.tools ?? []).some((t: any) => t.name === 'dl__status'));
  // calling one before loading it fails that call, and loads it for the next step
  const eager = scripted([['dl__status', {}]], [['dl__status', {}]], 'ok');
  await talkWith(eager, say('how is it'), lazy);
  assert.deepEqual(ran, ['status']);
  // auto, with a setup this small: everything, as before; and all is the default
  const small = await talkWith(scripted('hi'), say('hi'), { tools: 'auto' });
  assert.ok(small.offered.includes('dl__status') && !small.offered.includes('tools'));
  const plain = await talk(scripted('hi'), say('hi'));
  assert.ok(plain.offered.includes('dl__status') && !plain.offered.includes('tools'));
});
