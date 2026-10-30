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
