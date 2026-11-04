// Config loading: secrets from the environment and files, escaping, durations, and the checker's findings.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Config, Every, substitute } from '../src/server/config.ts';
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
  const a = (o: object) => Config.parse({ assistant: { model: 'qwen3.8-27b', ...o } }).assistant!;
  assert.equal(contextWindow(a({})), undefined);
  assert.equal(contextWindow(a({ contextWindow: 32768 })), 32768);
  assert.equal(contextWindow(a({ model: 'claude-sonnet-4-5', contextWindow: 1_000_000 })), 1_000_000);
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
