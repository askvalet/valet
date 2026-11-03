// Standing instructions: when they go off (events, held conditions, a time of day, a cooldown), what they may run
// (one integration tool, at the access it has now, with checked input), and what happens when one fails. Made-up data.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-rules-'));
const { Rules, actionFor, blocked, nextRun, triggered, trigger, ruleTools, holds } = await import('../src/server/rules.ts');
const { Activity } = await import('../src/server/activity.ts');
const { runTool, rank } = await import('../src/server/run.ts');
const { sandbox } = await import('../src/server/sandbox.ts');
type Rule = import('../src/server/rules.ts').Rule;

const MIN = 60_000;
const at = (h: number, m = 0, day = 3) => new Date(2026, 10, day, h, m).getTime();
const rule = (o: Partial<Rule>): Rule => ({ id: 'r1', by: 'you', created: at(6), say: 'hi', repeat: true, cooldown: 30, armed: true, failures: 0, ...o });
const list = (...titles: string[]) => ({ type: 'list' as const, title: 'Downloads', items: titles.map(title => ({ title })) });
const status = (...items: [string, boolean][]) => ({ type: 'status' as const, items: items.map(([name, ok]) => ({ name, ok })) });
const gpu = (v: number) => ({ type: 'stats' as const, items: [{ label: 'GPU temp', value: v }] });

// a made-up homelab: downloads that can be paused, a read tool, a tool that only takes certain input
const ran: { tool: string; args: unknown }[] = [];
const t = (name: string, access: 'read' | 'write' | 'control', extra: object = {}) => ({ description: name, label: name, access, input: z.object({ hash: z.string().optional() }).strict(), run: async (args: unknown) => { ran.push({ tool: name, args }); return { data: { ok: true } }; }, ...extra });
const instances = () => new Map<string, any>([
  ['dl', { widgets: {}, tools: { pause_all: t('pause_all', 'control', { confirm: ({ hash }: any) => ({ title: hash ? 'Pause this download?' : 'Pause all downloads?', icon: 'download', verb: 'Pause' }) }), remove: t('remove', 'control', { confirm: () => ({ title: 'Remove Ubuntu ISO?', danger: true }) }), status: t('status', 'read') } }],
  ['links', { widgets: {}, tools: { save: t('save', 'write') } }],
  ['config', { widgets: {}, tools: { config_apply: t('config_apply', 'control') } }],
  ['valet', { widgets: {}, tools: { report_issue: t('report_issue', 'read'), watch_add: t('watch_add', 'write'), rule_add: t('rule_add', 'control') } }],
  ['pins', { widgets: {}, tools: { pin_remove: t('pin_remove', 'control') } }],
]);
const TITLES: Record<string, string> = { 'dl.active': 'Downloads', 'svc.status': 'Services', 'pc.gpu': 'GPU' };
function env(o: { access?: Record<string, number>; acting?: boolean; act?: (r: Rule) => { ok: boolean; error?: string } } = {}) {
  const told: { text: string; sub?: string; tone: string }[] = [], acts: string[] = [];
  const e = {
    instances, acting: () => o.acting ?? true, title: (w: string) => TITLES[w],
    access: (id: string) => o.access?.[id] ?? (id === 'links' ? rank.write : rank.control),
    act: async (r: Rule, s: any) => { acts.push(`${s.id}__${s.name}`); return o.act?.(r) ?? { ok: true }; },
    tell: (n: any) => { told.push(n); },
  };
  return { e, told, acts };
}
const settle = () => new Promise(r => setTimeout(r, 10));

test('ends: a row going from the card sets it off, and says which; with a name, only that one', () => {
  const held = new Map<string, number>();
  assert.deepEqual(triggered(rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 } }), { prev: list('Ubuntu ISO', 'Debian'), next: list('Debian') }, held, at(9)), { because: 'Ubuntu ISO' });
  assert.equal(triggered(rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 } }), { prev: list('Debian'), next: list('Debian') }, held, at(9)), null);
  assert.equal(triggered(rule({ when: { widget: 'dl.active', on: 'ends', name: 'fedora', minutes: 0 } }), { prev: list('Ubuntu ISO', 'Debian'), next: list('Debian') }, held, at(9)), null);
  assert.ok(triggered(rule({ when: { widget: 'dl.active', on: 'starts', name: 'fedora', minutes: 0 } }), { prev: list('Debian'), next: list('Debian', 'Fedora 41') }, held, at(9)));
  // the first look at a card isn't news
  assert.equal(triggered(rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 } }), { next: list() }, held, at(9)), null);
});

test('down: it fires once while it holds, and again only after it came back', () => {
  const r = rule({ when: { widget: 'svc.status', on: 'down', name: 'plex', minutes: 0 }, cooldown: 1 }), held = new Map<string, number>();
  const down = status(['Plex', false], ['Sonarr', true]), up = status(['Plex', true], ['Sonarr', true]);
  assert.deepEqual(triggered(r, { next: down }, held, at(9)), { because: 'Plex' });
  r.lastRun = at(9);
  assert.equal(triggered(r, { next: down }, held, at(9, 5)), null, 'still down: not again');
  assert.equal(triggered(r, { next: up }, held, at(9, 6)), null);
  assert.ok(triggered(r, { next: down }, held, at(9, 7)), 'down again');
  // without a name, anything down counts, and "up" means everything is
  assert.equal(holds({ on: 'down' }, status(['A', true], ['B', false])), true);
  assert.equal(holds({ on: 'up' }, status(['A', true], ['B', false])), false);
  assert.equal(holds({ on: 'down', name: 'nope' }, down), null);
});

test('held: over 85° for 10 minutes means ten minutes of it, and dipping under starts again', () => {
  const r = rule({ when: { widget: 'pc.gpu', on: 'above', name: 'gpu', value: 85, minutes: 10 } }), held = new Map<string, number>();
  assert.equal(triggered(r, { next: gpu(90) }, held, at(9)), null);
  assert.equal(triggered(r, { next: gpu(91) }, held, at(9, 9)), null);
  assert.equal(triggered(r, { next: gpu(80) }, held, at(9, 9, 3) + 30_000), null);
  assert.equal(triggered(r, { next: gpu(90) }, held, at(9, 10)), null, 'the clock started again');
  assert.deepEqual(triggered(r, { next: gpu(92) }, held, at(9, 20)), { because: 'gpu: 92' });
});

test('cooldown: a flapping condition can\'t fire every half minute', () => {
  const r = rule({ when: { widget: 'svc.status', on: 'down', minutes: 0 }, cooldown: 30 }), held = new Map<string, number>();
  const down = status(['Plex', false]), up = status(['Plex', true]);
  let fired = 0;
  for (let i = 0; i < 40; i++) {   // twenty minutes of flapping, a look every half minute
    if (triggered(r, { next: i % 2 ? up : down }, held, at(9) + i * 30_000)) { fired++; r.lastRun = at(9) + i * 30_000; }
  }
  assert.equal(fired, 1);
  // after the cooldown, a condition still holding goes off once more
  assert.ok(triggered(r, { next: down }, held, at(9, 31)));
  // events too
  const e = rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 }, lastRun: at(9) });
  assert.equal(triggered(e, { prev: list('A'), next: list() }, held, at(9, 10)), null);
  assert.ok(triggered(e, { prev: list('A'), next: list() }, held, at(9, 31)));
});

test('a time of day: once a day at that time, never for a time that passed before it was set, never hours late', () => {
  const r = rule({ at: '07:00', created: at(6) }), held = new Map<string, number>();
  assert.equal(triggered(r, {}, held, at(6, 59)), null);
  assert.ok(triggered(r, {}, held, at(7) + 10_000));
  assert.equal(triggered(r, {}, held, at(7, 1)), null, 'once');
  assert.ok(triggered(r, {}, held, at(7, 0, 4) + 20_000), 'and tomorrow');
  assert.equal(triggered(rule({ at: '07:00', created: at(7, 5) }), {}, held, at(7, 5) + 30_000), null, 'set after seven: from tomorrow');
  const late = rule({ at: '07:00', created: at(6) });
  assert.equal(triggered(late, {}, held, at(9)), null, 'Valet was down at seven');
  assert.equal(triggered(late, {}, held, at(9, 1)), null);
  assert.equal(nextRun('07:00', at(6)), at(7));
  assert.equal(nextRun('07:00', at(8)), at(7, 0, 4));
});

test('only if: a morning check that only speaks when something is down', () => {
  const held = new Map<string, number>(), r = () => rule({ at: '07:00', onlyIf: { widget: 'svc.status', on: 'down' } });
  assert.equal(triggered(r(), { check: status(['Plex', true]) }, held, at(7) + 5000), null);
  assert.ok(triggered(r(), { check: status(['Plex', false]) }, held, at(7) + 5000));
  assert.equal(triggered(r(), {}, held, at(7) + 5000), null, 'a card that can\'t say means no');
  const q = rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 }, onlyIf: { widget: 'svc.status', on: 'up', name: 'plex' } });
  assert.equal(triggered(q, { prev: list('A'), next: list(), check: status(['Plex', false]) }, held, at(9)), null);
});

test('what a rule may run: one integration tool, never the config, Valet\'s own tools, pins, plans or MCP', () => {
  const { e } = env();
  for (const [tool, why] of [
    ['config__config_apply', /config/], ['valet__rule_add', /Valet's own/], ['valet__report_issue', /Valet's own/], ['valet__watch_add', /Valet's own/],
    ['pins__pin_remove', /pins/], ['plan', /exactly one/], ['mcp_home__turn_on', /no tool/], ['show', /exactly one/], ['dl__nope', /no tool/],
    ['dl__status', /only looks/], ['__x', /exactly one/],
  ] as const) {
    const a = actionFor(tool, {}, e);
    assert.ok('error' in a, tool); assert.match((a as { error: string }).error, why, tool);
  }
  assert.ok(!('error' in actionFor('dl__pause_all', {}, e)));
  // access as it is now: a control tool on an integration granted write is refused
  assert.match((actionFor('dl__pause_all', {}, env({ access: { dl: rank.write } }).e) as any).error, /needs control access.*gives dl write/);
  assert.match((actionFor('dl__pause_all', {}, env({ access: { dl: rank.read } }).e) as any).error, /gives dl read/);
  // input checked against the tool's own schema
  assert.match((actionFor('dl__pause_all', { hash: 5 }, e) as any).error, /hash/);
  assert.match((actionFor('dl__pause_all', { extra: 'x' }, e) as any).error, /dl__pause_all/);
});

test('setting one up: one trigger, widgets on the page, a page that may act, rules on, and not too many', async () => {
  const { e } = env(), rules = new Rules([], e);
  const ok = { when: { widget: 'dl.active', on: 'ends' as const, minutes: 0 }, say: 'Done', repeat: true, cooldown: 30, tool: 'dl__pause_all' };
  assert.ok('rule' in await rules.prepare(ok));
  assert.match((await rules.prepare({ ...ok, at: '07:00' }) as any).error, /one trigger/);
  assert.match((await rules.prepare({ ...ok, when: undefined }) as any).error, /one trigger/);
  assert.match((await rules.prepare({ ...ok, when: { widget: 'nope.x', on: 'ends', minutes: 0 } }) as any).error, /no widget/);
  assert.match((await rules.prepare({ ...ok, when: { widget: 'pc.gpu', on: 'above', minutes: 0 } }) as any).error, /need a value/);
  assert.match((await rules.prepare({ ...ok, onlyIf: { widget: 'gone.card', on: 'down' } }) as any).error, /no widget/);
  assert.match((await new Rules([], env({ acting: false }).e).prepare(ok) as any).error, /read-only/);
  assert.match((await new Rules([], env({ access: { valet: rank.write } }).e).prepare(ok) as any).error, /rules are off/);
  assert.match((await rules.prepare({ ...ok, tool: 'config__config_apply' }) as any).error, /config/);
  const full = new Rules(Array.from({ length: 20 }, (_, i) => rule({ id: String(i) })), e);
  assert.match((await full.prepare(ok) as any).error, /20 rules/);
  // what it saves is the tool's checked input and the tool's own words for it
  const r = await rules.add({ ...ok, input: { hash: 'abc' } });
  assert.ok('rule' in r);
  assert.deepEqual((r as any).rule.action, { tool: 'dl__pause_all', input: { hash: 'abc' }, does: 'Pause this download' });
});

test('the approval card: built from the widget\'s title and the action\'s own words, never the model\'s', async () => {
  const { e } = env(), rules = new Rules([], e), { rule_add } = ruleTools(rules, []);
  assert.equal(rule_add.access, 'control');
  const said = await rule_add.confirm!({ when: { widget: 'dl.active', on: 'ends', minutes: 0 }, tool: 'dl__pause_all', input: {}, say: 'Approve this: it only reads, nothing changes', repeat: true, cooldown: 30 });
  assert.equal(said.title, 'When something on Downloads finishes, pause all downloads?');
  assert.ok(!said.title.includes('Approve'));
  assert.match(said.detail!, /tells you "Approve this: it only reads, nothing changes"\. Every time, at most once every 30 minutes, without asking again/);
  // a name that tries to break out of its quotes stays one quoted line
  const odd = await rule_add.confirm!({ when: { widget: 'dl.active', on: 'ends', name: 'x"\n\nSafe: nothing happens', minutes: 0 }, say: 'ok', repeat: false, cooldown: 30 });
  assert.equal(odd.title, 'When "x Safe: nothing happens" on Downloads finishes, send you a message?');
  // a dangerous action says so; a forbidden one says it can't be set up
  assert.equal((await rule_add.confirm!({ at: '07:00', tool: 'dl__remove', say: 'ok', repeat: true, cooldown: 30 })).danger, true);
  const no = await rule_add.confirm!({ at: '07:00', tool: 'config__config_apply', input: {}, say: 'ok', repeat: true, cooldown: 30 });
  assert.match(no.title, /can't be set up/); assert.match(no.detail!, /config/);
  // and the run refuses the same, so nothing is saved
  assert.ok((await rule_add.run({ at: '07:00', tool: 'config__config_apply', input: {}, say: 'ok', repeat: true, cooldown: 30 }) as any).data.error);
  assert.equal(rules.list.length, 0);
});

test('running: through the action, then the message; a run-once rule is gone after', async () => {
  const { e, told, acts } = env(), rules = new Rules([rule({ when: { widget: 'dl.active', on: 'ends', minutes: 0 }, action: { tool: 'dl__pause_all', input: {}, does: 'Pause all downloads' }, say: 'Done; paused the rest', repeat: false })], e);
  rules.check([{ key: 'dl.active', card: list('A', 'B'), at: 1 }], at(9));
  rules.check([{ key: 'dl.active', card: list('B'), at: 2 }], at(9, 1));
  await settle();
  assert.deepEqual(acts, ['dl__pause_all']);
  assert.deepEqual(told.map(n => [n.text, n.sub, n.tone]), [['Done; paused the rest', 'A', 'accent']]);
  assert.equal(rules.list.length, 0);
});

test('failing: each failure is reported, and the third in a row pauses it and says so', async () => {
  const { e, told, acts } = env({ act: () => ({ ok: false, error: 'qBittorrent answered 503' }) });
  const r = rule({ action: { tool: 'dl__pause_all', input: {}, does: 'Pause all downloads' } }), rules = new Rules([r], e);
  for (let i = 0; i < 4; i++) await rules.fire(r, undefined, at(9, i * 40));
  assert.equal(acts.length, 3, 'a paused rule doesn\'t run');
  assert.equal(r.paused, 'failed 3 times in a row');
  assert.deepEqual(told.map(n => n.tone), ['bad', 'bad', 'bad']);
  assert.match(told[2].text, /Paused a rule after 3 failures/); assert.equal(told[2].sub, 'qBittorrent answered 503');
  // a success in between starts the count again
  let n = 0;
  const flaky = rule({ id: 'f', action: { tool: 'dl__pause_all', input: {}, does: 'x' } }), f = new Rules([flaky], env({ act: () => ({ ok: n++ % 2 === 1 }) }).e);
  for (let i = 0; i < 6; i++) await f.fire(flaky, undefined, at(9, i * 40));
  assert.equal(flaky.paused, undefined); assert.equal(flaky.failures, 0);
});

test('checked again at every run: lowered access, a read-only page or rules switched off, and it doesn\'t run', async () => {
  for (const [o, why] of [[{ access: { dl: rank.read } }, /gives dl read/], [{ acting: false }, /read-only/], [{ access: { valet: rank.write } }, /rules are off/]] as const) {
    const { e, told, acts } = env(o), r = rule({ at: '07:00', action: { tool: 'dl__pause_all', input: {}, does: 'Pause all downloads' } }), rules = new Rules([r], e);
    await rules.fire(r, undefined, at(9));
    assert.deepEqual(acts, []);
    assert.match(r.paused!, why); assert.match(told[0].text, /Paused a rule/);
    await assert.rejects(rules.pause(r.id, false), why);   // and it can't be resumed until it could run
    assert.match(rules.card(at(9)).items[0].subtitle!, /Paused/);
  }
  // input that no longer passes the tool's check (the tool changed) doesn't run either
  const { e, acts } = env(), r = rule({ action: { tool: 'dl__pause_all', input: { gone: 1 }, does: 'x' } });
  await new Rules([r], e).fire(r, undefined, at(9));
  assert.deepEqual(acts, []); assert.match(r.paused!, /dl__pause_all/);
  assert.match(blocked({ action: { tool: 'config__config_apply', input: {}, does: 'x' } }, e)!, /config/);
});

test('the list card: each rule in words, when it ran, when it runs next, a dot when it\'s in trouble, and its switches', () => {
  const { e } = env(), rules = new Rules([
    rule({ id: 'a', when: { widget: 'dl.active', on: 'ends', minutes: 0 }, action: { tool: 'dl__pause_all', input: {}, does: 'Pause all downloads' }, lastRun: at(8) }),
    rule({ id: 'b', at: '07:00', onlyIf: { widget: 'svc.status', on: 'down' }, failures: 1, lastError: 'timed out' }),
    rule({ id: 'c', when: { widget: 'pc.gpu', on: 'above', name: 'gpu', value: 85, minutes: 10 }, paused: 'you paused it' }),
  ], e);
  const [a, b, c] = rules.card(at(9)).items;
  assert.equal(a.title, 'hi'); assert.equal(a.detail, 'When something on Downloads finishes: pause all downloads'); assert.match(a.subtitle!, /Last ran/); assert.equal(a.dot, undefined);
  assert.equal(b.detail, 'Every day at 07:00, if anything on Services is down: tell you'); assert.equal(b.dot, 'bad'); assert.match(b.meta!, /Next/); assert.equal(b.subtitle, 'Failed: timed out');
  assert.equal(c.detail, 'When "gpu" on GPU is above 85 for 10 minutes: tell you'); assert.equal(c.dot, 'warn');
  assert.deepEqual(c.buttons!.map(x => x.label), ['Resume', 'Remove']); assert.deepEqual(a.buttons![0].args, { id: 'a', on: true });
  assert.equal(trigger({ when: { widget: 'svc.status', on: 'up', name: 'plex', minutes: 5 } }, w => TITLES[w]), 'When "plex" on Services is up for 5 minutes');
});

test('a rule\'s run goes in the activity log like the chat\'s, redacted, with its rule and its undo', async () => {
  const activity = new Activity(s => s.replaceAll('sekret-1', '•••'));
  const tool = { ...t('pause_all', 'control'), undo: 'resume_all', run: async () => ({ data: { error: 'refused with sekret-1' } }) };
  const out = await runTool({ id: 'dl', name: 'pause_all', t: tool as any, args: {}, via: 'rule', who: 'sam', rule: 'r9', activity, redact: s => s.replaceAll('sekret-1', '•••') });
  assert.equal(out.data.error, 'refused with •••');
  const [entry] = activity.recent();
  assert.equal(entry.via, 'rule'); assert.equal(entry.rule, 'r9'); assert.equal(entry.who, 'sam'); assert.equal(entry.ok, false);
  assert.deepEqual(entry.undo, { tool: 'dl__resume_all', input: {} });
  const { outcome } = await import('../src/server/activity.ts');
  assert.match(outcome(entry), /sam, by a rule/);
});

test('stored in data/rules.json, and nothing at all in a sandbox', async () => {
  process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-rules-'));
  const file = join(process.env.VALET_DATA, 'rules.json'), { e } = env();
  sandbox.on = true;
  await new Rules([], e).add({ at: '07:00', say: 'Morning', repeat: true, cooldown: 30 });
  assert.equal(existsSync(file), false);
  sandbox.on = false;
  await new Rules([], e).add({ at: '07:00', say: 'Morning', repeat: true, cooldown: 30 });
  assert.equal(existsSync(file), true);
});
