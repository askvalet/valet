// The chat's commands and mentions: the menu, each built-in, custom commands from the config, @mentions and /compact.
// Driven with a scripted model like chat.test.ts. A command or a mention never grants anything: what the model is
// offered and what asks first are exactly what assistant.access says, whatever was typed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-slash-'));
const { chatRoute } = await import('../src/server/chat.ts');
const { Config } = await import('../src/server/config.ts');
const { check } = await import('../src/server/site.ts');
const { registry } = await import('../src/integrations/index.ts');
const { setupTools, validate } = await import('../src/server/setup.ts');
const { forgetSummaries } = await import('../src/server/compact.ts');
const { BUILTINS, RESERVED, expand, filterMenu, matchModel, mentionsIn, parseSlash } = await import('../src/shared/slash.ts');
const { menuFor, runSlash } = await import('../src/web/slash.tsx');

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const stream = (parts: any[], reason: string) => ({ stream: new ReadableStream({ start(c) {
  c.enqueue({ type: 'stream-start', warnings: [] });
  for (const p of parts) c.enqueue(p);
  c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
  c.close();
} }) });
function scripted(...turns: ([string, object][] | string)[]) {
  let n = 0, id = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: 'They asked about downloads; two were going.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }) as any,
    doStream: async () => {
      const t = turns[n++] ?? 'done';
      if (typeof t === 'string') return stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }], 'stop') as any;
      return stream(t.map(([toolName, input]) => ({ type: 'tool-call', toolCallId: `c${++id}`, toolName, input: JSON.stringify(input) })), 'tool-calls') as any;
    },
  });
}

const ran: string[] = [];
const tool = (name: string, access: 'read' | 'write' | 'control') => ({ description: name, label: name, access, input: z.object({}).loose(), run: async () => { ran.push(name); return { data: { ok: true } }; } });
const home = () => new Map<string, any>([
  ['dl', { widgets: {}, tools: { status: tool('status', 'read'), pause: tool('pause', 'control') } }],
  ['dns', { widgets: {}, tools: { blocked: tool('blocked', 'read'), adblock_pause: tool('adblock_pause', 'control') } }],
  ['lights', { widgets: {}, tools: { set_lights: tool('set_lights', 'control') } }],
  ['secret', { widgets: {}, tools: { peek: tool('peek', 'read') } }],
  ['config', { widgets: {}, tools: { config_undo: { ...tool('config_undo', 'control'), run: async () => { ran.push('config_undo'); return { data: { undone: true } }; } }, config_apply: tool('config_apply', 'control') } }],
  ['valet', { widgets: {}, tools: { rule_add: tool('rule_add', 'control') } }],
]);
const meta = () => new Map<string, any>(['dl', 'dns', 'lights', 'secret', 'config', 'valet'].map(id => [id, { type: id, name: id === 'dns' ? 'Pi-hole' : id }]));
const COMMANDS = {
  morning: 'Sum up overnight and anything down.',
  watch: { prompt: "Add {input} to my watchlist and tell me when it's out", reasoning: 'low' },
  lab: { prompt: 'Full health check of the lab, worst problems first', model: 'Deep', reasoning: 'high' },
  blocks: { prompt: "Who's blocking the most today?", tools: ['dns'] },
  stop: { prompt: 'Pause the downloads', tools: ['dl'] },
};

async function talk(messages: any[], o: { model?: MockLanguageModelV4; deep?: MockLanguageModelV4; body?: object; acting?: boolean; assistant?: object; access?: object; commands?: object } = {}) {
  ran.length = 0;
  const model = o.model ?? scripted('ok'), deep = o.deep ?? scripted('from deep');
  const config = Config.parse({ chat: { commands: o.commands ?? COMMANDS }, assistant: { model: 'm', models: [{ name: 'Deep', model: 'big' }], ...o.assistant,
    access: { default: 'read', dl: 'control', dns: 'control', lights: 'control', secret: 'none', config: 'control', ...o.access } } });
  const app = new Hono();
  app.post('/chat', chatRoute(config, home(), meta(), { acting: o.acting ?? true, redact: s => s, model: model as any, models: { Deep: deep as any } }) as any);
  const r = await app.request('/chat', { method: 'POST', body: JSON.stringify({ messages, ...o.body }) });
  const text = await r.text();
  const events = text.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6)));
  const first = (model.doStreamCalls[0] ?? deep.doStreamCalls[0]) as any;
  const offered = (first?.tools ?? []).map((t: any) => t.name) as string[];
  const system = first?.prompt?.find((p: any) => p.role === 'system')?.content as string | undefined;
  const userText = (first?.prompt ?? []).filter((p: any) => p.role === 'user').flatMap((p: any) => p.content.filter((c: any) => c.type === 'text').map((c: any) => c.text)).join('\n');
  return { status: r.status, text, events, offered, system, userText, model, deep, json: () => JSON.parse(text) };
}
const say = (text: string, id = 'u1') => [{ id, role: 'user', parts: [{ type: 'text', text }] }];
const answer = (id: string, text: string) => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });

// ---- the menu --------------------------------------------------------------------------------------------------------

test('menu: / lists the built-ins and yours, narrowed by the start of a name first, then anywhere', () => {
  const o = { commands: [{ name: 'morning', description: 'Overnight' }, { name: 'watch', description: 'Add to the watchlist', input: true }], integrations: [{ id: 'plex', name: 'Plex' }, { id: 'dns', name: 'Pi-hole' }], models: [{ id: 'm', label: 'qwen' }, { id: 'Deep', label: 'Deep' }] };
  const all = menuFor('/', 1, o)!;
  assert.equal(all.kind, 'command');
  assert.deepEqual(all.items.map(i => i.name), [...BUILTINS.map(b => b.name), 'morning', 'watch']);
  assert.deepEqual(menuFor('/m', 2, o)!.items.map(i => i.name), ['model', 'morning', 'compact']);   // starts first, then anywhere in a name
  assert.deepEqual(menuFor('/cl', 3, o)!.items.map(i => i.name), ['new']);   // an alias finds its command
  assert.deepEqual(menuFor('/list', 5, o)!.items.map(i => i.name), ['help', 'watch']);   // its words, when no name fits
  assert.equal(menuFor('/zzz', 4, o)!.items.length, 0);
  // only at the very start, and only while the name is being typed
  assert.equal(menuFor('hi /m', 5, o), null);
  assert.equal(menuFor('/morning now', 12, o), null);
  // a built-in's choices
  assert.deepEqual(menuFor('/reasoning h', 12, o)!.items.map(i => i.name), ['high']);
  assert.deepEqual(menuFor('/model de', 9, o)!.items.map(i => i.name), ['Deep']);
  // @ anywhere a word starts, by id or name, where the caret is
  assert.deepEqual(menuFor('what is @pi', 11, o)!.items.map(i => i.name), ['dns']);
  assert.deepEqual(menuFor('@', 1, o)!.items.map(i => i.name), ['plex', 'dns']);
  assert.equal(menuFor('mail me@pl', 10, o), null);
  assert.equal(menuFor('@pl and more', 3, o)!.items[0].name, 'plex');
  assert.deepEqual(filterMenu([{ name: 'ab' }, { name: 'ba' }], 'a').map(i => i.name), ['ab', 'ba']);
});

test('parsing: a command is a name at the start; {input} is what follows it; @ is a known id', () => {
  assert.deepEqual(parseSlash('/watch  Dune part two '), { name: 'watch', input: 'Dune part two' });
  assert.deepEqual(parseSlash('/new'), { name: 'new', input: '' });
  assert.equal(parseSlash('/etc/hosts is broken'), null);
  assert.equal(parseSlash('/Watch'), null);
  assert.equal(parseSlash('what about /new'), null);
  assert.equal(expand("Add {input} to my watchlist and tell me when it's out", 'Dune'), "Add Dune to my watchlist and tell me when it's out");
  assert.equal(expand('Add {input} please', ''), 'Add please');
  assert.equal(expand('Sum up overnight.', 'and the GPU'), 'Sum up overnight.\n\nand the GPU');
  assert.deepEqual(mentionsIn('@Plex and @dns, not me@plex or @nope', ['plex', 'dns']), ['plex', 'dns']);
  const list = [{ id: 'm', model: 'qwen3-27b', label: 'qwen3-27b' }, { id: 'Deep', model: 'big', label: 'Deep' }];
  assert.equal(matchModel('deep', list)?.id, 'Deep');
  assert.equal(matchModel('27b', list)?.id, 'm');
  assert.equal(matchModel('qwen327', list)?.id, 'm');
  assert.equal(matchModel('gpt', list), undefined);
  assert.equal(matchModel('-', list), undefined);
});

// ---- each built-in ---------------------------------------------------------------------------------------------------

function chatFor(o: Partial<Parameters<typeof runSlash>[1]> = {}) {
  const did: string[] = [], said: any[] = [];
  const c = {
    commands: [{ name: 'morning' }], busy: false, model: 'qwen', models: [{ id: 'm', model: 'qwen', label: 'qwen' }, { id: 'Deep', model: 'big', label: 'Deep' }], hasPicker: true,
    say: (n: any) => said.push(n), choose: (id: string) => did.push(`choose ${id}`), think: (v: string) => did.push(`think ${v}`), startOver: () => did.push('new'),
    openModels: () => did.push('open models'), openReasoning: () => did.push('open reasoning'), findListed: (q: string) => did.push(`find ${q}`),
    compact: () => did.push('compact'), ...o,
  };
  return { c, did, said, run: (t: string) => runSlash(t, c) };
}

test('built-ins: each does its one thing here, and says so in a line the model never sees', () => {
  let x = chatFor();
  assert.equal(x.run('/model deep'), true); assert.deepEqual(x.did, ['choose Deep']); assert.match(x.said[0].text, /on Deep now/);
  x = chatFor(); x.run('/model'); assert.deepEqual(x.did, ['open models']);
  x = chatFor(); x.run('/model gpt-9'); assert.deepEqual(x.did, []); assert.match(x.said[0].text, /No model matches “gpt-9”/);
  x = chatFor({ discover: true }); x.run('/model gpt-9'); assert.deepEqual(x.did, ['find gpt-9']);   // the servers' lists, as the picker has them
  x = chatFor({ hasPicker: false }); x.run('/model deep'); assert.deepEqual(x.did, []); assert.match(x.said[0].text, /one model: qwen/);
  x = chatFor(); x.run('/reasoning high'); assert.deepEqual(x.did, ['think high']);
  x = chatFor(); x.run('/reasoning HIGH'); assert.deepEqual(x.did, ['think high']);
  x = chatFor(); x.run('/reasoning max'); assert.deepEqual(x.did, []); assert.match(x.said[0].text, /one of auto, off, low, medium, high/);
  x = chatFor(); x.run('/reasoning'); assert.deepEqual(x.did, ['open reasoning']);
  for (const n of ['/new', '/clear']) { x = chatFor(); x.run(n); assert.deepEqual(x.did, ['new']); }
  x = chatFor(); x.run('/compact'); assert.deepEqual(x.did, ['compact']);
  // there's no /undo or /retry: typed, each is a name that's nothing (undo is asked for in words, retry is the answer's button)
  for (const n of ['undo', 'retry']) { x = chatFor(); assert.equal(x.run(`/${n}`), true); assert.deepEqual(x.did, []); assert.match(x.said[0].text, new RegExp(`no /${n} command`)); }
  x = chatFor(); x.run('/help'); assert.deepEqual(x.said, [{ help: true }]);
  // while it answers, nothing that would talk over it
  for (const n of ['/compact']) { x = chatFor({ busy: true }); x.run(n); assert.deepEqual(x.did, [], n); assert.match(x.said[0].text, /still answering/); }
  // a custom command goes as typed; a name that's nothing says so and sends nothing; a path is just words
  x = chatFor(); assert.equal(x.run('/morning'), false); assert.deepEqual(x.did, []);
  x = chatFor(); assert.equal(x.run('/nope'), true); assert.match(x.said[0].text, /no \/nope command/);
  x = chatFor(); assert.equal(x.run('/etc/hosts?'), false);
  // another agent's chat: only what's the page's own
  x = chatFor({ external: 'Hermes' }); x.run('/model deep'); assert.deepEqual(x.did, []); assert.match(x.said[0].text, /Hermes runs on its own/);
  x = chatFor({ external: 'Hermes' }); x.run('/new'); assert.deepEqual(x.did, ['new']);
});

// ---- custom commands ---------------------------------------------------------------------------------------------------

test('custom commands: the model reads the prompt with {input} filled in; the page keeps what was typed', async () => {
  const r = await talk(say('/watch Dune'));
  assert.equal(r.status, 200);
  assert.match(r.userText, /Add Dune to my watchlist and tell me when it's out/);
  assert.doesNotMatch(r.userText, /\/watch/);
  // earlier commands in the chat read as their prompts too
  const later = await talk([...say('/morning', 'u0'), answer('a0', 'quiet'), ...say('thanks')]);
  assert.match(later.userText, /Sum up overnight and anything down\./);
  // a built-in's name in the text, or an unknown one, goes as typed
  const plain = await talk(say('/nope at all'));
  assert.match(plain.userText, /\/nope at all/);
});

test('custom commands: their model and reasoning apply to that question, and the chat\'s own come back after', async () => {
  const lab = await talk(say('/lab'));
  assert.equal(lab.model.doStreamCalls.length, 0);
  assert.equal(lab.deep.doStreamCalls.length, 1);
  assert.equal((lab.deep.doStreamCalls[0] as any).reasoning, 'high');
  const watch = await talk(say('/watch Dune'), { body: { reasoning: 'off' } });
  assert.equal((watch.model.doStreamCalls[0] as any).reasoning, 'low');
  // the next question is the chat's again
  const next = await talk([...say('/lab', 'u0'), answer('a0', 'all fine'), ...say('and the GPU?')]);
  assert.deepEqual([next.model.doStreamCalls.length, next.deep.doStreamCalls.length], [1, 0]);
  // a model that isn't a choice is refused, as the picker's would be
  const bad = await talk(say('/x'), { commands: { x: { prompt: 'hi', model: 'gpt-9' } } });
  assert.equal(bad.status, 400);
});

test('custom commands: a command that acts still asks first, and its tools are only what access allows', async () => {
  const r = await talk(say('/stop'), { model: scripted([['dl__pause', {}]], 'paused') });
  assert.ok(r.events.some(e => e.type === 'tool-approval-request'));
  assert.deepEqual(ran, []);
  // on a read-only page the same command can only look
  const ro = await talk(say('/stop'), { acting: false, model: scripted('I can only look') });
  assert.ok(!ro.offered.includes('dl__pause') && ro.offered.includes('dl__status'));
  // a command's tools never reach an integration the assistant may not use
  const locked = await talk(say('/peek'), { commands: { peek: { prompt: 'peek', tools: ['secret'] } } });
  assert.ok(!locked.offered.some(t => t.startsWith('secret__')));
  assert.doesNotMatch(locked.system!, /asking about: secret/);
});

// ---- @mentions ---------------------------------------------------------------------------------------------------------

test('mentions: lazy loads what was named from the first step; all says what it is about', async () => {
  const lazy = { tools: 'lazy' };
  const named = await talk(say('who is blocking the most @dns'), { assistant: lazy, body: { mentions: ['dns'] } });
  assert.equal(named.status, 200);
  assert.ok(named.offered.includes('dns__blocked') && named.offered.includes('tools'));
  assert.ok(!named.offered.includes('dl__status'));
  assert.match(named.system!, /asking about: dns \(Pi-hole\)\. Their tools are already loaded/);
  // typed without the menu, it's the same
  const typed = await talk(say('anything odd on @DNS today?'), { assistant: lazy });
  assert.ok(typed.offered.includes('dns__blocked'));
  // a command's tools are a mention
  const blocks = await talk(say('/blocks'), { assistant: lazy });
  assert.ok(blocks.offered.includes('dns__blocked'));
  // without a mention, lazy starts without them
  const none = await talk(say('who is blocking the most?'), { assistant: lazy });
  assert.ok(!none.offered.includes('dns__blocked'));
  // all: every tool, as always, and a line saying what it's about
  const all = await talk(say('@dns blocks?'), { body: { mentions: ['dns'] } });
  assert.ok(all.offered.includes('dl__status') && all.offered.includes('dns__blocked'));
  assert.match(all.system!, /The user is asking about: dns \(Pi-hole\)\. Prefer their tools\./);
});

test('mentions: an unknown integration, or one the assistant may not use here, is refused before any model is asked', async () => {
  for (const [mentions, o] of [[['nope'], {}], [['secret'], {}], [['config'], {}], [['valet'], {}], [['lights'], { acting: false }], ['dns', {}], [[3], {}], [Array(13).fill('dns'), {}]] as const) {
    const r = await talk(say('hi'), { body: { mentions }, ...o });
    assert.equal(r.status, 400, JSON.stringify(mentions));
    assert.equal(r.model.doStreamCalls.length, 0);
  }
  // typed as text, an @ that isn't one is just words: nothing is loaded and nothing is refused
  const r = await talk(say('mail me @secret'), { assistant: { tools: 'lazy' } });
  assert.equal(r.status, 200);
  assert.ok(!r.offered.some(t => t.startsWith('secret__')));
  // naming one that acts asks first, as ever
  const act = await talk(say('@lights off'), { body: { mentions: ['lights'] }, model: scripted([['lights__set_lights', {}]], 'off') });
  assert.ok(act.events.some(e => e.type === 'tool-approval-request'));
  assert.deepEqual(ran, []);
});

// ---- /compact -----------------------------------------------------------------------------------------------------------

test('/compact: the conversation so far is summarised now, and the next question goes behind the summary', async () => {
  forgetSummaries();
  const chat = [...say('how are downloads', 'u0'), answer('a0', 'two going'), ...say('and the speed?', 'u1'), answer('a1', '40 MB/s')];
  const sum = scripted('x');
  const r = await talk(chat, { model: sum, body: { compact: true } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { compacted: 'summary' });
  assert.equal(sum.doGenerateCalls.length, 1);
  assert.match(JSON.stringify(sum.doGenerateCalls[0].prompt), /how are downloads/);
  // what the page sends next: the last message compacted, then the new question
  const next = await talk([answer('a1', '40 MB/s'), ...say('pause them?', 'u2')]);
  assert.match(next.userText, /summarised/);
  assert.match(next.userText, /They asked about downloads; two were going\./);
  assert.match(next.userText, /pause them\?/);
  assert.doesNotMatch(next.userText, /40 MB\/s/);
  // nothing to summarise, and a model that fails, say so
  assert.equal((await talk(say('hi'), { body: { compact: true } })).status, 400);
  const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('down'); } });
  assert.equal((await talk(chat.map(m => ({ ...m, id: `${m.id}b` })), { model: broken, body: { compact: true } })).status, 502);
});

// ---- the config ----------------------------------------------------------------------------------------------------------

test('config: names, clashes with built-ins, unknown integrations and models, and access are all checked', () => {
  const base = { integrations: { dns: { type: 'pihole', url: 'http://pi.hole', password: 'p' }, news: { type: 'lobsters' } }, assistant: { model: 'm', models: [{ name: 'Deep', model: 'big' }], access: { default: 'read', news: 'none' } } };
  const ok = Config.parse({ ...base, chat: { commands: { morning: 'Sum up overnight', blocks: { prompt: "Who's blocking?", tools: ['dns'] }, lab: { prompt: 'Health check', model: 'Deep', reasoning: 'high', description: 'Everything' }, 'check-disks': 'Disks?' } } });
  assert.deepEqual(check(ok, registry).problems, []);
  for (const bad of [{ Morning: 'x' }, { 'two words': 'x' }, { '-x': 'x' }, { new: 'x' }, { clear: 'x' }, { help: 'x' }, { x: '' }, { x: { prompt: 'x', reasoning: 'max' } }, { x: { prompt: 'x', other: 1 } }, { x: { description: 'no prompt' } }])
    assert.equal(Config.safeParse({ chat: { commands: bad } }).success, false, JSON.stringify(bad));
  assert.match(Config.safeParse({ chat: { commands: { new: 'x' } } }).error!.issues[0].message, /built in/);
  // the reserved names are the built-ins exactly: undo and retry are free to take
  assert.deepEqual([...RESERVED].sort(), ['clear', 'compact', 'help', 'model', 'new', 'reasoning']);
  assert.equal(Config.safeParse({ chat: { commands: { undo: 'Undo the last config change', retry: 'Ask that again' } } }).success, true);
  const problems = (commands: object, o: object = {}) => check(Config.parse({ ...base, ...o, chat: { commands } }), registry).problems;
  assert.match(problems({ x: { prompt: 'x', tools: ['plex'] } })[0], /chat\.commands\.x\.tools: no integration "plex"/);
  assert.match(problems({ x: { prompt: 'x', tools: ['news'] } })[0], /may not use news/);
  assert.match(problems({ x: { prompt: 'x', tools: ['config'] } })[0], /Valet's own/);
  assert.match(problems({ x: { prompt: 'x', model: 'gpt-9' } })[0], /"gpt-9" isn't a model choice \(they are: m, Deep\)/);
  assert.match(problems({ x: 'hi' }, { assistant: undefined })[0], /need an assistant/);
});

test('config: the assistant can add a command through its usual edit, and the preview says it works', async () => {
  const file = join(process.env.VALET_DATA!, 'config.yaml');
  await writeFile(file, 'title: Home\nintegrations:\n  dns: { type: pihole, url: "http://pi.hole", password: p }\nassistant:\n  model: m\n');
  const tools = setupTools(file, registry);
  const ops = [{ op: 'set', path: ['chat', 'commands', 'morning'], value: { prompt: 'Sum up overnight and what is down', description: 'Overnight in a line' } }, { op: 'set', path: ['chat', 'commands', 'blocks'], value: { prompt: "Who's blocking the most today?", tools: ['dns'] } }];
  const out = await tools.config_preview.run({ ops, summary: 'add /morning and /blocks' }) as any;
  assert.deepEqual(out.data.problems, []);
  assert.match(out.data.diff, /morning/);
  assert.equal(tools.config_apply.access, 'control');   // saving it still asks
  assert.match(await readFile(file, 'utf8'), /^title: Home/);   // and a preview saves nothing
  // a clash or a bad name is reported, not saved
  const clash = await tools.config_preview.run({ ops: [{ op: 'set', path: ['chat', 'commands', 'new'], value: 'x' }], summary: 's' }) as any;
  assert.ok(clash.data.problems.some((p: string) => /built in/.test(p)), JSON.stringify(clash.data));
  // the options it looks up describe chat.commands
  const options = await tools.config_options.run({ type: 'chat' }) as any;
  assert.match(JSON.stringify(options.data.properties.commands), /\{input\}/);
  assert.deepEqual(validate(await readFile(file, 'utf8'), registry).problems, []);
});
