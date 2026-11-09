// The assistant in Telegram: who is heard, that what it may do is exactly what the chat may do (the real chat route runs
// here, with a scripted model), that an approval is the tool's own words and only its buttons run anything, and that
// nothing secret, the bot's token included, reaches a message or the log. A made-up Telegram and made-up services.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-telegram-'));
const { chatRoute } = await import('../src/server/chat.ts');
const { Config } = await import('../src/server/config.ts');
const { Activity } = await import('../src/server/activity.ts');
const { confirmWords } = await import('../src/server/confirm.ts');
const { Telegram } = await import('../src/server/telegram.ts');
const { plain } = await import('../src/shared/plain.ts');

const TOKEN = '123456:made-up-bot-token-AAAA', SECRET = 'sekret-value-123', ME = 111, STRANGER = 999;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const stream = (parts: any[], reason: string) => ({ stream: new ReadableStream({ start(c) {
  c.enqueue({ type: 'stream-start', warnings: [] });
  for (const p of parts) c.enqueue(p);
  c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
  c.close();
} }) });
function scripted(...turns: ([string, object][] | string)[]) {
  let n = 0, id = 0;
  return new MockLanguageModelV4({ doStream: async () => {
    const t = turns[n++] ?? 'done';
    if (typeof t === 'string') return stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }], 'stop') as any;
    return stream(t.map(([toolName, input]) => ({ type: 'tool-call', toolCallId: `c${++id}`, toolName, input: JSON.stringify(input) })), 'tool-calls') as any;
  } });
}

function lab(model: MockLanguageModelV4, o: { acting?: boolean; now?: () => number } = {}) {
  const ran: string[] = [], sent: { method: string; body: any }[] = [], logs: string[] = [];
  const redact = (s: string) => s.replaceAll(SECRET, '•••').replaceAll(TOKEN, '•••');
  const instances = new Map<string, any>([['dl', { widgets: {}, tools: {
    status: { description: 'status', label: 'Checked downloads', access: 'read', input: z.object({}), run: async () => { ran.push('status'); return { data: { key: SECRET }, card: { type: 'list', title: 'Downloads', items: [{ title: 'Dune', subtitle: '40%', meta: SECRET }] } }; } },
    pause: { description: 'pause', label: 'Paused downloads', access: 'control', input: z.object({ name: z.string().default('all') }),
      confirm: ({ name }: { name: string }) => ({ title: `Pause ${name}?`, detail: 'Nothing downloads until you resume.', verb: 'Pause' }), run: async ({ name }: { name: string }) => { ran.push(`pause ${name}`); return { data: { paused: name } }; } },
    wipe: { description: 'wipe', access: 'control', input: z.object({ what: z.string() }), run: async () => { ran.push('wipe'); return { data: {} }; } },
  } }]]);
  const config = Config.parse({ assistant: { model: 'm', access: { default: 'read', dl: 'control' } }, integrations: { dl: { type: 'dl' } } });
  const activity = new Activity(redact), acting = o.acting ?? true;
  const app = new Hono().post('/', c => { (c.set as any)('user', c.req.header('x-valet-user')); return chatRoute(config, instances, new Map([['dl', { type: 'dl', name: 'Downloads' } as any]]), { acting, redact, activity, model: model as any })(c); });
  let id = 100;
  const fetch_ = (async (url: string, init: RequestInit) => {
    const method = String(url).split('/').pop()!;
    assert.ok(String(url).startsWith(`https://api.telegram.org/bot${TOKEN}/`), 'only ever Telegram, with the token in the path');
    sent.push({ method, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, result: method === 'getMe' ? { username: 'valet_bot' } : { message_id: ++id } });
  }) as unknown as typeof fetch;
  const bot = new Telegram({ token: TOKEN, users: [ME], name: 'Valet', redact, fetch: fetch_, log: l => logs.push(l), now: o.now,
    chat: (messages, who) => Promise.resolve(app.request('/', { method: 'POST', headers: { 'x-valet-user': who }, body: JSON.stringify({ messages }) })),
    confirm: (tool, input) => confirmWords({ config, instances, acting, redact }, tool, input), label: tool => instances.get(tool.split('__')[0])?.tools[tool.split('__')[1]]?.label });
  let n = 0;
  const now = () => Math.floor((o.now?.() ?? Date.now()) / 1000);
  const text = (t: string, from = ME, type = 'private', date = now()) => bot.handle({ update_id: ++n, message: { message_id: ++n, date, text: t, chat: { id: from, type }, from: { id: from, first_name: 'Sam' } } });
  const press = (data: string, from = ME) => bot.handle({ update_id: ++n, callback_query: { id: `q${n}`, data, from: { id: from, first_name: 'Sam' }, message: { message_id: 1, chat: { id: from, type: 'private' } } } });
  const said = () => sent.filter(s => s.method === 'sendMessage').map(s => s.body.text as string);
  const buttons = () => sent.findLast(s => s.body.reply_markup)?.body.reply_markup.inline_keyboard[0] as { text: string; callback_data: string }[] | undefined;
  return { bot, ran, sent, logs, text, press, said, buttons, activity };
}

test('plain: a card as a few lines', () => {
  assert.equal(plain({ type: 'list', title: 'Downloads', items: [{ title: 'Dune', subtitle: '40%' }, { title: 'Heat' }] }), 'Downloads\n• Dune · 40%\n• Heat');
  assert.equal(plain({ type: 'stats', title: 'Disk', items: [{ label: 'Used', value: 41, unit: '%', sub: 'of 8 TB' }] }), 'Disk\n• Used: 41% · of 8 TB');
  assert.equal(plain({ type: 'status', items: [{ name: 'Plex', ok: true }, { name: 'Mealie', ok: false, detail: 'timed out' }] }), '• ✓ Plex\n• ✗ Mealie · timed out');
  assert.equal(plain({ type: 'text', text: 'Nothing is playing.' }), 'Nothing is playing.');
  assert.match(plain({ type: 'list', items: Array.from({ length: 12 }, (_, i) => ({ title: `row ${i}` })) }, 8), /row 7\nand 4 more$/);
  assert.equal(plain({ type: 'chart', title: 'Speed', unit: ' Mbps', series: [{ name: 'Down', points: [1, 940] }] }), 'Speed\n• Down: 940 Mbps');
  assert.equal(plain(null), '');
});

test('only the people listed are heard, only in a private chat; a stranger gets nothing, and the log names their id once', async () => {
  const l = lab(scripted('hello'));
  await l.text('hi', STRANGER); await l.text('hi again', STRANGER); await l.press('ok:0', STRANGER);
  await l.text('hi', ME, 'group');
  assert.deepEqual(l.sent.filter(s => s.method !== 'answerCallbackQuery'), [], 'not a word, not even "not allowed"');
  assert.deepEqual(l.logs, [`telegram: ignored a message from user ${STRANGER} (not in assistant.telegram.users)`]);
});

test('a question is answered with the words and the card as lines, through the redactor', async () => {
  const l = lab(scripted([['dl__status', {}]], '**One** thing is downloading.'));
  await l.text('how are downloads');
  assert.deepEqual(l.ran, ['status']);
  assert.deepEqual(l.said(), ['Downloads\n• Dune · 40% · •••', 'One thing is downloading.']);
  assert.ok(l.sent.some(s => s.method === 'sendChatAction'));
  assert.ok(!JSON.stringify(l.sent).includes(SECRET));
});

test('something that changes things asks first, in the tool\'s own words, and only its button runs it', async () => {
  const l = lab(scripted([['dl__pause', { name: 'Dune' }]], 'Paused.'));
  await l.text('pause dune');
  assert.deepEqual(l.ran, [], 'nothing ran on the model\'s say-so');
  assert.deepEqual(l.said(), ['Pause Dune?\nNothing downloads until you resume.']);
  const [yes, no] = l.buttons()!;
  assert.deepEqual([yes.text, no.text], ['Pause', 'Not now']);
  await l.press('ok:7'); await l.press('nonsense'); await l.press(yes.callback_data, STRANGER);
  assert.deepEqual(l.ran, [], 'a made-up button, or the right one from someone else, runs nothing');
  await l.press(yes.callback_data);
  assert.deepEqual(l.ran, ['pause Dune']);
  assert.equal(l.said().at(-1), 'Paused.');
  assert.match(l.sent.find(s => s.method === 'editMessageText')!.body.text, /Pause Dune\?[\s\S]*Approved$/);
  const logged = l.activity.entries[0];
  assert.deepEqual([logged.who, logged.via, logged.what, logged.ok], ['Sam (Telegram)', 'chat', 'Paused downloads', true]);
  await l.press(yes.callback_data);
  assert.deepEqual(l.ran, ['pause Dune'], 'pressing it again does nothing');
});

test('Not now runs nothing, and the model hears it was declined', async () => {
  const model = scripted([['dl__pause', {}]], 'Left it running.');
  const l = lab(model);
  await l.text('pause everything');
  await l.press(l.buttons()![1].callback_data);
  assert.deepEqual(l.ran, []);
  assert.equal(l.said().at(-1), 'Left it running.');
  assert.match(JSON.stringify(model.doStreamCalls[1].prompt), /execution-denied/);
});

test('asking something else instead of answering is a no: the buttons go, and a late press runs nothing', async () => {
  const l = lab(scripted([['dl__pause', {}]], 'Sure, something else.'));
  await l.text('pause everything');
  const [yes] = l.buttons()!;
  await l.text('actually never mind, what time is it');
  assert.match(l.sent.find(s => s.method === 'editMessageText')!.body.text, /Skipped$/);
  await l.press(yes.callback_data);
  assert.deepEqual(l.ran, []);
  assert.equal(l.sent.findLast(s => s.method === 'answerCallbackQuery')!.body.text, 'That\'s no longer waiting.');
});

test('a tool with no words of its own still says which tool and with what', async () => {
  const l = lab(scripted([['dl__wipe', { what: `everything ${SECRET}` }]]));
  await l.text('wipe it');
  assert.equal(l.said()[0], 'dl: wipe?\n{"what":"everything •••"}');
});

test('a read-only page stays read-only here too', async () => {
  const model = scripted('I can only look.');
  const l = lab(model, { acting: false });
  await l.text('pause everything');
  assert.ok(!model.doStreamCalls[0].tools!.some((t: any) => t.name === 'dl__pause'));
  assert.deepEqual(l.said(), ['I can only look.']);
});

test('a message that waited while Valet was away isn\'t acted on; /new, /start and a photo are answered without the model', async () => {
  const model = scripted('never');
  const l = lab(model);
  await l.text('turn everything off', ME, 'private', Math.floor(Date.now() / 1000) - 600);
  await l.text('/start'); await l.text('/new');
  await l.bot.handle({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: ME, type: 'private' }, from: { id: ME } } });
  assert.equal(model.doStreamCalls.length, 0);
  assert.match(l.said()[0], /reached me late/);
  assert.equal(l.said().length, 4);
});

test('a conversation carries on, and /new forgets it', async () => {
  const model = scripted('alpha-reply', 'second', 'third');
  const l = lab(model);
  await l.text('one'); await l.text('two');
  assert.match(JSON.stringify(model.doStreamCalls[1].prompt), /one[\s\S]*alpha-reply[\s\S]*two/);
  await l.text('/new'); await l.text('three');
  assert.ok(!JSON.stringify(model.doStreamCalls[2].prompt).includes('alpha-reply'));
});

test('a long answer goes in pieces Telegram accepts', async () => {
  const l = lab(scripted('x'.repeat(9000)));
  await l.text('go on');
  assert.deepEqual(l.said().map(s => s.length), [4000, 4000, 1000]);
});

test('listening: updates are handled in turn, a refused token ends it, and the token is in no log line', async () => {
  const logs: string[] = [], asked: string[] = [];
  let polls = 0;
  const bot: InstanceType<typeof Telegram> = new Telegram({ token: TOKEN, users: [ME], name: 'Valet', redact: s => s.replaceAll(TOKEN, '•••'), log: l => logs.push(l),
    chat: async () => Response.json({ error: 'no assistant configured' }, { status: 404 }), confirm: async () => ({}), label: () => undefined,
    fetch: (async (url: string, init: RequestInit) => {
      const method = String(url).split('/').pop()!; asked.push(method);
      if (method === 'getMe') return Response.json({ ok: true, result: { username: 'valet_bot' } });
      if (method === 'getUpdates') {
        if (polls++ === 0) return Response.json({ ok: true, result: [{ update_id: 41, message: { message_id: 1, date: Math.floor(Date.now() / 1000), text: 'hi', chat: { id: ME, type: 'private' }, from: { id: ME } } }] });
        assert.equal(JSON.parse(String(init.body)).offset, 42, 'the next poll starts after what was handled');
        return Response.json({ ok: false, description: `Unauthorized for bot${TOKEN}` }, { status: 401 });
      }
      return Response.json({ ok: true, result: { message_id: 1 } });
    }) as unknown as typeof fetch });
  await bot.start();
  assert.deepEqual(logs, ['telegram: listening as @valet_bot for 1 person', 'telegram: the bot token was refused; check assistant.telegram.token']);
  assert.ok(asked.includes('sendMessage'), 'the chat\'s own refusal is passed on');
  assert.ok(!logs.join().includes(TOKEN));
});

test('config: a token and at least one numeric user id, and the assistant can\'t be asked without them', () => {
  const a = (telegram: object) => Config.safeParse({ assistant: { model: 'm', telegram } });
  assert.deepEqual(a({ token: TOKEN, users: [111, '222'] }).data!.assistant!.telegram!.users, [111, 222]);
  assert.equal(a({ token: TOKEN, users: [] }).success, false);
  assert.equal(a({ token: TOKEN }).success, false);
  assert.equal(a({ token: TOKEN, users: ['@sam'] }).success, false);
  assert.equal(a({ token: 'short', users: [1] }).success, false);
});
