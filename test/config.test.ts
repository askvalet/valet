// Config loading: secrets from the environment and files, escaping, durations, and the checker's findings.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Config, Every, parseConfig, substitute } from '../src/server/config.ts';
import { check } from '../src/server/site.ts';
import { registry } from '../src/integrations/index.ts';

test('substitute: env, NAME_FILE, file:, escaped, and a clear error when missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-sub-'));
  await writeFile(join(dir, 'k'), 'from-file\n');
  process.env.VALET_T_A = 'plain'; process.env.VALET_T_B_FILE = join(dir, 'k');
  assert.deepEqual(substitute({ a: '${VALET_T_A}', b: '${VALET_T_B}', c: '${file:' + join(dir, 'k') + '}', d: 'keep \\${VALET_T_A}', e: ['x${VALET_T_A}'] }),
    { a: 'plain', b: 'from-file', c: 'from-file', d: 'keep ${VALET_T_A}', e: ['xplain'] });
  assert.throws(() => substitute('${VALET_T_NOPE}'), /VALET_T_NOPE is not set \(nor VALET_T_NOPE_FILE\)/);
  assert.throws(() => substitute('${file:/nonexistent/x}'), /can't read/);
});

test('layout: tall and wide are sizes, anything else is refused', () => {
  const sizes = (size: string) => Config.safeParse({ layout: [{ widgets: [{ widget: 'a.b', size }] }] });
  for (const s of ['small', 'wide', 'medium', 'tall', 'large']) assert.ok(sizes(s).success, s);
  assert.equal(sizes('huge').success, false);
});

test('durations: seconds, 30s, 5m, 2h', () => {
  assert.deepEqual([10, '30s', '5m', '2h', '1d'].map(v => Every.parse(v)), [10_000, 30_000, 300_000, 7_200_000, 86_400_000]);
  assert.throws(() => Every.parse('soon'));
});

test('check: unknown types, options and widget keys are named; links from the top level become widgets', () => {
  const config = Config.parse({
    integrations: { w: { type: 'weather', latitude: 1, longitude: 2, colour: 'blue' }, x: { type: 'nope' } },
    links: { 'Reading list': [{ name: 'HN', url: 'https://news.ycombinator.com' }] },
    layout: [{ title: 'A', widgets: ['w.now', 'w.nope', 'links.reading-list', { widget: 'w.now', every: '2m' }] }],
    assistant: { model: 'm', access: { default: 'read', ghost: 'control' } },
  });
  const { problems, instances, placed } = check(config, registry);
  assert.ok(instances.has('links') && instances.has('w'));
  assert.ok(placed.has('links.reading-list'));
  assert.deepEqual(problems, [
    'integrations.w: unknown option "colour" (ignored)',
    'integrations.x: unknown type "nope"',
    'layout: no widget "w.nope" (w has: now)',
    'assistant.access.ghost: no such integration',
  ]);
  assert.equal(config.layout[0].widgets[3].every, 120_000);
});

test('check: a view the widget\'s card can\'t take is named, with the ones it can', () => {
  const config = Config.parse({
    integrations: { hn: { type: 'hackernews' }, w: { type: 'weather', latitude: 1, longitude: 2 } },
    layout: [{ widgets: [{ widget: 'hn.stories', view: 'masonry' }, { widget: 'w.now', view: 'coverflow' }] }],
  });
  const problems = check(config, registry).problems.filter(p => p.includes('drawn as'));
  assert.deepEqual(problems, [
    'layout: hn.stories can\'t be drawn as "masonry" (it\'s a list card)',
    'layout: w.now can\'t be drawn as "coverflow" (it\'s a forecast card)',
  ]);
});

test('first run: writes a starter config that checks clean, and runs from memory when it can\'t', async () => {
  const { startConfig } = await import('../src/server/config.ts');
  const dir = await mkdtemp(join(tmpdir(), 'valet-first-'));
  const log = console.log; console.log = () => {};
  const a = startConfig(join(dir, 'sub', 'config.yaml'));
  await writeFile(join(dir, 'file'), '');
  const b = startConfig(join(dir, 'file', 'x', 'config.yaml'));               // a file where the folder should be
  console.log = log;
  assert.equal(a.saved, true);
  assert.equal(b.saved, false);
  assert.equal(a.config.welcome, true);
  assert.equal(startConfig(join(dir, 'sub', 'config.yaml')).saved, true);     // now it's just a config
  assert.deepEqual(check(a.config, registry).problems, []);
});

test('context window: known Claude models fill it in, however the provider spells them; the config wins; others stay unknown', async () => {
  const { contextWindow, windowOf } = await import('../src/server/model.ts');
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-5-5', 'claude-sonnet-5', 'anthropic/claude-sonnet-4.6', 'claude-haiku-5-5', 'claude-fable-5-1']) assert.equal(windowOf(m), 1_000_000, m);
  for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-opus-4-1-20250805', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'anthropic/claude-3.5-haiku']) assert.equal(windowOf(m), 200_000, m);
  for (const m of ['qwen3.8-27b', 'llama3.1:8b', 'gpt-4o', 'claude']) assert.equal(windowOf(m), undefined, m);
  const a = (o: object) => Config.parse({ assistant: { model: 'qwen3.8-27b', baseURL: 'http://127.0.0.1:9/v1', ...o } }).assistant!;   // nothing listens there
  assert.equal(await contextWindow(a({})), undefined);
  assert.equal(await contextWindow(a({ contextWindow: 32768 })), 32768);
  assert.equal(await contextWindow(a({ model: 'claude-sonnet-4-5', contextWindow: 1_000_000 })), 1_000_000);
  assert.equal(Config.safeParse({ assistant: { model: 'm', contextWindow: 12 } }).success, false);
});

test('sounds: off and quiet unless asked for; a browser\'s own choice wins either way', async () => {
  const { resolveSounds } = await import('../src/web/sound.ts');
  const c = Config.parse({});
  assert.deepEqual(c.appearance.sounds, { enabled: false, volume: .4 });
  assert.deepEqual(Config.parse({ appearance: { sounds: { enabled: true } } }).appearance.sounds, { enabled: true, volume: .4 });
  assert.equal(Config.safeParse({ appearance: { sounds: { volume: 2 } } }).success, false);
  assert.equal(Config.safeParse({ appearance: { sounds: { loud: true } } }).success, false);
  assert.deepEqual(resolveSounds(c.appearance.sounds, null), { on: false, volume: .4 });
  assert.deepEqual(resolveSounds({ enabled: true, volume: .2 }, null), { on: true, volume: .2 });
  assert.equal(resolveSounds({ enabled: true }, 'off').on, false);
  assert.equal(resolveSounds({ enabled: false }, 'on').on, true);
  assert.equal(resolveSounds(undefined, 'something else').on, false);
});

test('notify: a config from before webPush, with channels and no webPush, still loads', () => {
  const c = Config.parse({ notify: { channels: [] } });
  assert.equal(c.notify.webPush.enabled, true);
  assert.deepEqual(c.notify.channels, []);
  assert.equal(Config.parse({ notify: { insights: true } }).notify.webPush.enabled, true);
});

test('context window: read from the model server\'s list when the name doesn\'t say', async () => {
  const { windowFromModels } = await import('../src/server/model.ts');
  const list = { object: 'list', data: [{ id: 'qwen3.8-27b', max_model_len: 98304 }, { id: 'small', context_length: 32768 }, { id: 'cpp', meta: { n_ctx_train: 131072 } }, { id: 'odd', max_model_len: 'lots' }] };
  assert.equal(windowFromModels(list, 'qwen3.8-27b'), 98304);
  assert.equal(windowFromModels(list, 'small'), 32768);
  assert.equal(windowFromModels(list, 'cpp'), 131072);
  assert.equal(windowFromModels(list, 'odd'), undefined);
  assert.equal(windowFromModels(list, 'missing'), undefined);
  assert.equal(windowFromModels({ nope: true }, 'qwen3.8-27b'), undefined);
});

test('assistant.access: a dotted key must name a tool the integration has', () => {
  const config = Config.parse({ integrations: { w: { type: 'weather', latitude: 1, longitude: 2 } }, layout: [], assistant: { model: 'm', access: { 'w.nope': 'none', 'w.weather': 'none', 'valet.report_issue': 'none', 'valet.plan': 'none', 'valet.nothing': 'none', 'gone.x': 'none' } } });
  const problems = check(config, registry).problems.filter(p => p.startsWith('assistant.access'));
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.match(problems.find(p => p.includes('"nope"'))!, /w has no tool "nope" \(it has: weather\)/);
  assert.ok(problems.some(p => p.includes('valet has no tool "nothing"')) && problems.some(p => p.includes('no integration gone')));
});

test('assistant.models: each choice fills in from the main settings, but a key never goes to another server', async () => {
  const { choices } = await import('../src/server/model.ts');
  const base = { model: 'qwen', baseURL: 'http://gpu:8000/v1', apiKey: 'local-key', reasoning: 'off', options: { temperature: 0.3 } };
  // left out, nothing changes: one choice, the main settings themselves
  const plain = Config.parse({ assistant: base }).assistant!;
  assert.deepEqual(plain.models, []);
  assert.deepEqual(choices(plain).map(c => c.id), ['qwen']);
  assert.equal(choices(plain)[0].settings, plain);
  const a = Config.parse({ assistant: { ...base, contextWindow: 32768, models: [
    { model: 'qwen-big' },                                                       // same server: its address and key
    { name: 'Other', model: 'llama', baseURL: 'http://other:8000/v1' },           // another server: not the main key
    { name: 'Sonnet', model: 'claude-sonnet-5-5', provider: 'anthropic', apiKey: 'anthropic-key', reasoning: 'high', options: { maxOutputTokens: 900 } },
  ] } }).assistant!;
  const [main, big, other, sonnet] = choices(a);
  assert.deepEqual(choices(a).map(c => c.id), ['qwen', 'qwen-big', 'Other', 'Sonnet']);
  assert.equal(main.settings, a);
  assert.deepEqual([big.settings.baseURL, big.settings.apiKey, big.settings.reasoning, big.settings.contextWindow], ['http://gpu:8000/v1', 'local-key', 'off', undefined]);
  assert.deepEqual([other.settings.baseURL, other.settings.apiKey], ['http://other:8000/v1', undefined]);
  assert.deepEqual([sonnet.settings.provider, sonnet.settings.baseURL, sonnet.settings.apiKey, sonnet.settings.reasoning], ['anthropic', undefined, 'anthropic-key', 'high']);
  assert.deepEqual(sonnet.settings.options, { temperature: 0.3, maxOutputTokens: 900 });
  assert.equal(sonnet.settings.access, a.access);                                // the same assistant: same access, tools, steps
});

test('assistant.models: names are unique, providers known, keys from the environment, and the checker names a missing key', () => {
  const parse = (models: object[]) => Config.safeParse({ assistant: { model: 'qwen', models } });
  assert.ok(parse([{ model: 'a' }, { name: 'A again', model: 'a' }]).success);
  const dup = parse([{ model: 'a' }, { model: 'a' }]);
  assert.equal(dup.success, false);
  assert.match(JSON.stringify(dup.error!.issues), /already a choice/);
  assert.equal(parse([{ model: 'qwen' }]).success, false);                        // the main model's id is taken
  assert.equal(parse([{ model: 'a', provider: 'openai' }]).success, false);
  assert.equal(parse([{ model: 'a', url: 'x' }]).success, false);
  assert.throws(() => parseConfig('assistant:\n  model: qwen\n  models:\n    - model: c\n      apiKey: ${VALET_T_MISSING_KEY}\n'), /VALET_T_MISSING_KEY is not set/);
  const had = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    const keyless = Config.parse({ assistant: { model: 'qwen', models: [{ name: 'Sonnet', model: 'claude-sonnet-5-5', provider: 'anthropic' }] } });
    assert.ok(check(keyless, registry).problems.some(p => /"Sonnet" needs an apiKey/.test(p)));
    const keyed = Config.parse({ assistant: { model: 'qwen', models: [{ name: 'Sonnet', model: 'claude-sonnet-5-5', provider: 'anthropic', apiKey: 'k' }] } });
    assert.ok(!check(keyed, registry).problems.some(p => p.includes('assistant.models')));
  } finally { if (had !== undefined) process.env.ANTHROPIC_API_KEY = had; }
});
