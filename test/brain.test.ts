// The assistant's work outside the chat, with a fake model: when it's asked, what's believed, and what it may not do.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-brain-'));
const { digest, parseCause, parseSuggestions, suggestPrompt, troubles, Watcher, statusLine } = await import('../src/server/insight.ts');
const { applyOps, diff, refused, setupTools, validate } = await import('../src/server/setup.ts');
const { loadPins, newPin, pinnedCard, pinsInstance, savePins } = await import('../src/server/pins.ts');
const { suggest } = await import('../src/web/suggest.ts');
const { registry } = await import('../src/integrations/index.ts');
const { z } = await import('zod');

const down = (...names: string[]) => [{ key: 's.status', at: 1, card: { type: 'status' as const, title: 'Services', items: names.map(name => ({ name, ok: false, detail: 'timed out' })) } }];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('troubles: what is wrong, by name; quiet things and healthy things are not', () => {
  const t = troubles([
    { key: 's.status', at: 1, card: { type: 'status', items: [{ name: 'Radarr', ok: false }, { name: 'Printer', ok: false, quiet: true }, { name: 'Plex', ok: true }] } },
    { key: 'x.y', at: 1, error: 'ECONNREFUSED' },
    { key: 'd.drives', at: 1, card: { type: 'list', title: 'Drives', items: [{ title: 'WD', tone: 'bad', meta: 'Failing' }, { title: 'SSD', tone: 'warn' }] } },
  ]);
  assert.deepEqual(t.map(x => x.name), ['Radarr', 'x.y', 'WD']);
});

test('watcher: one problem never reaches the model; two do once settled; a cause must name real problems; it clears', async () => {
  const asked: string[] = [], said: (string | null)[] = [];
  let reply = 'CAUSE: The media disk is full. RELATED line below\nRELATED: Radarr, qBittorrent';
  const w = new Watcher(async (_s, p) => { asked.push(p); return reply; }, i => said.push(i?.text ?? null), 5);
  w.see(down('Radarr')); await sleep(20);
  assert.equal(asked.length, 0);
  w.see(down('Radarr', 'qBittorrent')); w.see(down('Radarr', 'qBittorrent')); await sleep(20);
  assert.equal(asked.length, 1);                                  // same problems: asked once
  assert.equal(w.insight?.related.length, 2);
  w.see([]);
  assert.equal(w.insight, null);
  assert.equal(said.at(-1), null);

  reply = 'NONE';
  w.see(down('A', 'B')); await sleep(20);
  assert.equal(w.insight, null);
  assert.equal(parseCause('CAUSE: Ghosts.\nRELATED: Radarr, Imaginary', troubles(down('Radarr', 'Plex'))), null);   // one real name isn't enough
  w.stop();
});

test('digest stays compact, and the status line is written at most every half hour', async () => {
  assert.equal(digest([{ key: 'a.b', at: 1, card: { type: 'stats', title: 'CPU', items: [], summary: { label: 'CPU', value: '4%' } } }]), 'CPU: CPU 4%');
  let n = 0; const ask = async () => { n++; return `Quiet, nothing needs you ${n}.`; };
  const at = (m: number) => new Date(2026, 9, 30, 8, m), states = down('x');
  assert.equal(await statusLine(ask, [], [], at(0)), null);                              // nothing to go on yet
  assert.equal((await statusLine(ask, [], states, at(0)))?.text, 'Quiet, nothing needs you 1');
  await statusLine(ask, [], states, at(10));
  assert.equal(n, 1);                                                                     // any number of opens, one rewrite
  assert.equal((await statusLine(ask, [], states, at(31)))?.text, 'Quiet, nothing needs you 2');
  assert.equal((await statusLine(async () => null, [], states, at(59 + 40)))?.text, 'Quiet, nothing needs you 2');   // no answer: keep the last
});

test('status line: rewritten soon after what\'s wrong changes, and a failed action in the log isn\'t trouble', async () => {
  let n = 0; const ask = async () => `Line ${++n}`;
  const at = (m: number) => new Date(2026, 10, 2, 8, m);
  await statusLine(ask, [], down('Mealie'), at(0));
  await statusLine(ask, [], down('Mealie'), at(3));
  await statusLine(ask, [], down('Plex'), at(3));
  assert.equal(n, 1);                                                                     // not more than once in five minutes
  assert.equal((await statusLine(ask, [], down('Plex'), at(6)))?.text, 'Line 2');
  assert.equal((await statusLine(ask, [], down('Plex'), at(12)))?.text, 'Line 2');        // same trouble: leave it
  const log = { key: 'valet.activity', at: 1, card: { type: 'list', title: 'Activity', items: [{ title: 'Changed the lights', tone: 'bad' }] } };
  assert.deepEqual(troubles([log] as any), []);
});

test('setup: edits keep comments; it can\'t touch sign-in or its own access, or write a secret into the file', async () => {
  const text = '# my page\ntitle: Home   # keep me\nintegrations:\n  w: { type: weather, latitude: 1, longitude: 2 }\nlayout:\n  - title: A\n    widgets: [w.now]\n';
  const after = applyOps(text, [{ op: 'set', path: ['integrations', 'hn'], value: { type: 'hackernews' } }, { op: 'append', path: ['layout', 0, 'widgets'], value: 'hn.stories' }]);
  assert.match(after, /# my page/); assert.match(after, /title: Home   # keep me/);
  // only what changed changes: odd spacing, flow style and comments elsewhere stay byte for byte
  const fussy = 'title: Home\nhosts: [a.example,  b.example]   # two spaces\nintegrations:\n  w: { type: weather, latitude: 1, longitude: 2 }   # home\n\nlayout:\n  - title: A\n    widgets: [w.now]\n  - title: B   # b\n    widgets: []\nmenubar: [w.now]\n';
  const ops2 = [{ op: 'set', path: ['integrations', 'hn'], value: { type: 'hackernews', limit: 3 } }, { op: 'append', path: ['layout', 0, 'widgets'], value: 'hn.stories' }, { op: 'append', path: ['layout'], value: { title: 'C', widgets: ['hn.stories'] } }, { op: 'set', path: ['title'], value: 'Den' }] as any[];
  assert.equal(applyOps(fussy, ops2), 'title: Den\nhosts: [a.example,  b.example]   # two spaces\nintegrations:\n  w: { type: weather, latitude: 1, longitude: 2 }   # home\n  hn:\n    type: hackernews\n    limit: 3\n\nlayout:\n  - title: A\n    widgets: [w.now, hn.stories]\n  - title: B   # b\n    widgets: []\n  - title: C\n    widgets:\n      - hn.stories\nmenubar: [w.now]\n');
  assert.match(diff(text, after), /\+ .*hackernews/);
  assert.deepEqual(validate(after, registry).problems, []);
  assert.match(validate(applyOps(text, [{ op: 'append', path: ['layout', 0, 'widgets'], value: 'hn.nope' }]), registry).problems[0], /no widget/);
  assert.deepEqual(validate(applyOps(text, [{ op: 'set', path: ['integrations', 'k'], value: { type: 'seerr', url: 'http://x', apiKey: '${SEERR_NOT_SET}' } }]), registry).missing, ['SEERR_NOT_SET']);

  for (const path of ['auth', 'assistant', 'plugins', 'mcp', 'allowedHosts']) assert.match(refused([{ op: 'set', path: [path, 'x'], value: 1 }])!, /by hand/);
  assert.match(refused([{ op: 'set', path: ['integrations', 'k'], value: { type: 'seerr', apiKey: 'abc123' } }])!, /secret/);
  assert.match(refused([{ op: 'set', path: ['integrations', 'k'], value: { type: 'api', headers: { Authorization: 'Bearer abc' } } }])!, /secret/);
  assert.equal(refused([{ op: 'set', path: ['integrations', 'k'], value: { type: 'seerr', apiKey: '${KEY}', headers: { Authorization: 'Bearer ${KEY}' } } }]), null);

  const file = join(process.env.VALET_DATA!, 'c.yaml'); await writeFile(file, text);
  const tools = setupTools(file, registry), ops = [{ op: 'set', path: ['title'], value: 'Den' }];
  assert.equal(tools.config_apply.access, 'control');
  assert.equal(tools.config_preview.access, 'read');
  assert.equal(tools.api_sample.access, 'write');
  assert.match((await tools.config_preview.run({ ops, summary: 's' }) as any).data.diff, /\+ title: Den/);
  assert.match(await readFile(file, 'utf8'), /title: Home/);                                // a preview saves nothing
  assert.equal((await tools.config_apply.run({ ops, summary: 's' }) as any).data.saved, true);
  assert.match(await readFile(file, 'utf8'), /title: Den/);
  const bad = await tools.config_apply.run({ ops: [{ op: 'set', path: ['auth', 'mode'], value: 'none' }], summary: 's' }) as any;
  assert.match(bad.data.error, /by hand/);
});

test('pins: re-run a looking tool with no model; anything that changes things can\'t be pinned', async () => {
  let runs = 0;
  const inst = { widgets: { w: { title: 'W', fetch: async () => ({ type: 'text' as const, text: 'live' }) } }, tools: {
    look: { description: '', access: 'read' as const, input: z.object({ q: z.string() }), run: async () => { runs++; return { data: 1, card: { type: 'text' as const, text: 'found' } }; } },
    flip: { description: '', access: 'control' as const, input: z.object({}), run: async () => { runs += 100; return { data: 1, card: { type: 'text' as const, text: 'flipped' } }; } },
    words: { description: '', access: 'read' as const, input: z.object({}), run: async () => ({ data: 1 }) },
  } };
  const instances = new Map<string, any>([['a', inst], ['config', { widgets: {}, tools: { config_preview: inst.tools.look } }]]);
  assert.equal(((await pinnedCard({ tool: 'a__look', input: { q: 'x' } }, instances)) as any).text, 'found');
  await assert.rejects(pinnedCard({ tool: 'a__flip', input: {} }, instances), /only tools that just look/);
  await assert.rejects(pinnedCard({ tool: 'a__words', input: {} }, instances), /nothing to show/);
  await assert.rejects(pinnedCard({ tool: 'config__config_preview', input: { q: 'x' } }, instances), /gone/);
  await assert.rejects(pinnedCard({ tool: 'a__look', input: {} }, instances));                 // input is still validated
  assert.equal(runs, 1);
  assert.equal(((await pinnedCard({ tool: 'show', input: { widgets: ['a.w'] } }, instances)) as any).text, 'live');

  const pin = newPin('a__look', { q: 'x' }, 'Found');
  await savePins([pin]);
  assert.equal((await loadPins()).length, 1);
  const shown = await pinsInstance([pin], instances, async () => {}).widgets[pin.id].fetch();
  assert.deepEqual(shown.buttons, [{ label: 'Unpin', action: 'unpin', args: { id: pin.id } }]);
});

test('written suggestions: tidy lines only, nothing with a link, and the model sees the page', () => {
  assert.deepEqual(parseSuggestions('1. Why is Radarr down?\n- "Is the drive still hot?"\n\nSave https://evil.example/x\nOpen evil.com now\n* What did Touqir watch?'), ['Why is Radarr down?', 'Is the drive still hot?', 'What did Touqir watch?']);
  assert.deepEqual(parseSuggestions('Should I watch Odyssey later\nPause the downloads'), ['Should I watch Odyssey later?', 'Pause the downloads']);
  assert.equal(parseSuggestions('NONE'), null);
  assert.deepEqual(parseSuggestions('Why is Radarr down?'), ['Why is Radarr down?']);   // one good one beats padding
  assert.equal(parseSuggestions(null), null);
  assert.deepEqual(parseSuggestions(`${'very long '.repeat(9)}?\nAnother one here?`), ['Another one here?']);
  const p = suggestPrompt(down('Radarr'), ['8:00 PM end: Joker'], ['Checked Plex'], new Date(2026, 9, 30, 20));
  for (const bit of ['Friday', 'Radarr', 'Joker', 'Checked Plex']) assert.match(p.prompt, new RegExp(bit));
});

test('suggestions: trouble first, then what\'s live, then the configured ones', () => {
  const state: any = {
    's.status': { key: 's.status', at: 1, card: { type: 'status', items: [{ name: 'Radarr', ok: false }, { name: 'Printer', ok: false, quiet: true }] } },
    'd.active': { key: 'd.active', at: 1, card: { type: 'media', items: [], activity: { title: 'Joker', icon: 'download' } } },
  };
  assert.deepEqual(suggest(state, ['Is anything down?'], 12), ['Why is Radarr down?', 'When will Joker finish?', 'Is anything down?']);
  assert.deepEqual(suggest({}, ['A'], 12), ['A']);
  const mixed = { c: { key: 'c.c', at: 0, card: { type: 'status', items: [{ name: 'mealie', ok: false }] } }, s: { key: 's.s', at: 0, card: { type: 'status', items: [{ name: 'Mealie', ok: true }] } } } as any;
  assert.deepEqual(suggest(mixed, [], 12), ['Why is Mealie down?']);                       // the status card's spelling, even when only a lowercase card is unhappy
  assert.deepEqual(suggest({}, ['why is Plex down?', 'Why is Plex down?'], 12), ['Why is Plex down?']);
  const twice = { a: { key: 'a', at: 1, card: { type: 'status', items: [{ name: 'Mealie', ok: false }] } }, b: { key: 'b', at: 1, card: { type: 'status', items: [{ name: 'mealie', ok: false }] } } } as any;
  assert.deepEqual(suggest(twice, [], 12), ['Why is Mealie down?']);                       // one problem, however many cards show it
  // the model's list replaces the guesses, but something newly down still comes first
  assert.deepEqual(suggest(state, ['Is anything down?'], 12, ['Which indexer is failing?']), ['Why is Radarr down?', 'Which indexer is failing?']);
});
