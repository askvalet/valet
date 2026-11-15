// Making a card by describing it: the expression language (expr.ts), the `api` card's =, where, sort, table and
// `from:`, the config check's word on `from:`, who may see a card made from another, and the assistant's widget_sample.
// Made-up services only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-cardmaker-'));
const { evaluate, parse, MAX_LENGTH } = await import('../src/server/expr.ts');
const { default: api, fill } = await import('../src/integrations/api.ts');
const { session } = await import('../src/server/core.ts');
const { parseConfig } = await import('../src/server/config.ts');
const { buildSite, capDerived, check } = await import('../src/server/site.ts');
const { viewOf } = await import('../src/server/people.ts');
const { setupTools } = await import('../src/server/setup.ts');
const { accessOf, rank } = await import('../src/server/run.ts');
const { checkCard } = await import('../src/shared/cards.schema.ts');
type Card = import('../src/shared/cards.ts').Card;

const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
const ctxWith = (o: { body?: unknown; cards?: Record<string, Card> } = {}) => ({
  id: 't', log() {}, image: (r: string) => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }), session,
  http: async () => o.body, card: async (key: string) => o.cards?.[key],
}) as any;
const make = (cfg: unknown, ctx = ctxWith()) => api.create(api.config.parse(cfg), ctx);

test('expressions: precedence, the way a calculator reads them', () => {
  assert.equal(evaluate('1 + 2 * 3', null), 7);
  assert.equal(evaluate('(1 + 2) * 3', null), 9);
  assert.equal(evaluate('-2 * 3 + 10 % 4', null), -4);
  assert.equal(evaluate('10 - 4 - 3', null), 3);                                    // left to right
  assert.equal(evaluate('12 / 3 / 2', null), 2);
  assert.equal(evaluate('not 1 == 2', null), true);                                 // not binds looser than ==
  assert.equal(evaluate('1 < 2 and 2 < 1 or 3 > 2', null), true);                   // and before or
  assert.equal(evaluate('1 < 2 and (2 < 1 or 3 < 2)', null), false);
  assert.equal(evaluate("'up' + ' ' + 3", null), 'up 3');                           // text joins
  assert.equal(evaluate('1.5e2', null), 150);
});

test('expressions: paths, literals and comparisons', () => {
  const d = { mem: 3, maxmem: 4, name: 'Plex', tags: ['a', 'b'], g: { list: [{ n: 7 }] }, 'odd key': 1, pct: '42', none: null };
  assert.equal(evaluate('mem / maxmem', d), .75);
  assert.equal(evaluate('g.list[0].n', d), 7);
  assert.equal(evaluate("$['odd key']", d), 1);
  assert.deepEqual(evaluate('$', d), d);
  assert.equal(evaluate('missing.deeper', d), undefined);
  assert.equal(evaluate('missing + 1', d), null);                                   // a missing number stays missing, not 0
  assert.equal(evaluate('mem / 0', d), null);
  assert.equal(evaluate('pct > 40', d), true);                                      // a number written as text compares as one
  assert.equal(evaluate("name == 'Plex'", d), true);
  assert.equal(evaluate('none == null and missing == null', d), true);
  assert.equal(evaluate('missing > 1', d), false);
  assert.equal(evaluate('true and not false', d), true);
});

test('expressions: the functions', () => {
  const d = { name: 'Immich-Server', tags: ['db', 'web'], n: -2.345, at: new Date(Date.now() - 3 * 3_600_000).toISOString(), secs: Math.floor(Date.now() / 1000) - 2 * 86_400 };
  assert.equal(evaluate('len(name) + len(tags)', d), 15);
  assert.equal(evaluate('lower(name)', d), 'immich-server');
  assert.equal(evaluate('upper(tags[0])', d), 'DB');
  assert.equal(evaluate("contains(name, 'server') and contains(tags, 'web') and not contains(tags, 'w')", d), true);   // text ignores case; a list wants the whole thing
  assert.deepEqual([evaluate('min(3, 1, 2)', d), evaluate('max(3, n, 9)', d), evaluate('round(n, 1)', d), evaluate('abs(n)', d), evaluate('round(n)', d)], [1, 9, -2.3, 2.345, -2]);
  assert.equal(evaluate("num('42%') + num('1,024')", d), 1066);
  assert.deepEqual(['51°C', '-1.5 GB', '.5', 'abc', '', '%'].map(t => evaluate('num(x)', { x: t })), [51, -1.5, .5, null, null, null]);
  assert.equal(Math.round(evaluate('hours(at)', d) as number), 3);
  assert.equal(Math.round(evaluate('days(secs)', d) as number), 2);                 // seconds since 1970 work too
  assert.equal(evaluate('hours(nothing)', d), null);
});

test('expressions: only the data\'s own properties, and nothing that runs code', () => {
  for (const bad of ['__proto__', 'a.constructor', "$['prototype']", 'x.__proto__.y', "a['__proto__']"]) assert.throws(() => parse(bad), /can't be read/, bad);
  assert.equal(evaluate('toString', {}), undefined);                                // inherited, so not there
  assert.equal(evaluate('hasOwnProperty', {}), undefined);
  assert.equal(evaluate('length', 'text'), undefined);                              // a string isn't something to read into
  assert.throws(() => parse('eval(1)'), /no function "eval"/);
  assert.throws(() => parse('toString()'), /no function "toString"/);
  assert.throws(() => parse('constructor(1)'), /no function "constructor"/);
  const poisoned = JSON.parse('{"__proto__": {"x": 1}, "a": 1}');
  assert.equal(evaluate('a', poisoned), 1);
});

test('expressions: limits, and mistakes said plainly', () => {
  assert.throws(() => parse('1+'.repeat(MAX_LENGTH)), /characters long; 500 at most/);
  assert.throws(() => parse(`${'('.repeat(30)}1${')'.repeat(30)}`), /nests more than 24 deep/);
  assert.throws(() => parse(`${'-'.repeat(30)}1`), /nests more than/);
  assert.throws(() => parse(`${'not '.repeat(30)}1`), /nests more than/);
  assert.doesNotThrow(() => parse(Array.from({ length: 80 }, (_, i) => `a${i}`).join(' + ')));   // long but flat is fine
  const says = (src: string, re: RegExp) => assert.throws(() => parse(src), re, src);
  says('', /empty/);
  says('1 +', /stops too soon/);
  says('a = 1', /"=" compares as "=="/);
  says('a && b', /write "and"/);
  says('a || b', /write "or"/);
  says("'open", /never closed/);
  says('1 2', /"2" is out of place \(at character 3\)/);
  says('(1 + 2', /"\)" is missing/);
  says('len(1, 2)', /len\(\) takes 1 value, not 2/);
  says('round()', /round\(\) takes 1 to 2 values, not 0/);
  says('a.', /a name should follow/);
  says('a[1.5]', /isn't a position/);
  says('a ; b', /";" isn't part of an expression/);
  says('and 1', /needs something before it/);
});

test('api: = values, {=…} in templates, and thresholds on the number before it is written', async () => {
  assert.equal(fill('=mem / maxmem|pct', { mem: 1, maxmem: 4 }), '25%');
  assert.equal(fill('{=used / total|pct} of {total|bytes}', { used: 512, total: 2048 }), '25% of 2.0 KB');
  assert.equal(fill("=name + ' (' + id + ')'", { name: 'a', id: 7 }), 'a (7)');
  assert.equal(fill("=contains(s, '|')", { s: 'x|y' }), true);                       // a | inside quotes isn't a format
  const c: any = await make({ url: 'http://x/', stats: [{ label: 'Memory', value: '=used / total|pct', warn: .7, bad: .9, max: 1 }] }, ctxWith({ body: { used: 95, total: 100 } })).widgets.data.fetch();
  valid(c);
  assert.deepEqual([c.items[0].value, c.items[0].tone, c.items[0].pct], ['95%', 'bad', .95]);
  assert.throws(() => make({ url: 'http://x/', stats: [{ label: 'A', value: '=used /' }] }), /"=used \/": the expression stops too soon/);
});

const GUESTS = { type: 'list', title: 'Proxmox', items: [
  { id: 'node/pve', title: 'pve', pct: .91, meta: 'CPU 9%' },
  { id: 'qemu/100', title: 'plex', pct: .85, meta: 'CPU 40%' },
  { id: 'qemu/101', title: 'nas', pct: .42, meta: 'CPU 3%' },
  { id: 'lxc/102', title: 'pihole', pct: .93, meta: 'CPU 1%' },
  { id: 'lxc/103', title: 'stopped' },
] } as Card;

test('api: where, sort and limit on a list, status and table', async () => {
  const ctx = ctxWith({ body: { guests: (GUESTS as any).items } });
  const list: any = await make({ url: 'http://x/', title: 'Big VMs', list: { items: 'guests', where: "pct > 0.8 and not contains(id, 'node/')", sort: '-pct', title: 'title', meta: '=pct|pct', pct: 'pct' } }, ctx).widgets.data.fetch();
  valid(list);
  assert.deepEqual(list.items.map((i: any) => [i.title, i.meta]), [['pihole', '93%'], ['plex', '85%']]);
  assert.equal(list.summary.value, '2');
  const byName: any = await make({ url: 'http://x/', list: { items: 'guests', sort: 'title', limit: 2, title: 'title' } }, ctx).widgets.data.fetch();
  assert.deepEqual(byName.items.map((i: any) => i.title), ['nas', 'pihole']);
  const blanksLast: any = await make({ url: 'http://x/', list: { items: 'guests', sort: '-pct', title: 'title' } }, ctx).widgets.data.fetch();
  assert.equal(blanksLast.items.at(-1).title, 'stopped');
  const status: any = await make({ url: 'http://x/', status: { items: 'guests', where: 'pct != null', name: 'title', ok: '=pct < 0.9' } }, ctx).widgets.data.fetch();
  valid(status);
  assert.deepEqual([status.items.length, status.summary.value], [4, '2 down']);
  const table = make({ url: 'http://x/', title: 'Guests', table: { items: 'guests', where: 'pct', sort: '-pct', limit: 3, columns: { Name: 'title', Memory: 'pct|pct', Raw: 'pct', Note: '=upper(meta)' } } }, ctx);
  const t: any = await table.widgets.data.fetch();
  valid(t);
  assert.deepEqual(t.columns, ['Name', 'Memory', 'Raw', 'Note']);
  assert.deepEqual(t.rows, [['pihole', '93%', .93, 'CPU 1%'], ['pve', '91%', .91, 'CPU 9%'], ['plex', '85%', .85, 'CPU 40%']]);
  assert.equal(t.summary.value, '4');
  assert.deepEqual(((await table.tools!.read.run({})) as any).data[0], { Name: 'pihole', Memory: '93%', Raw: .93, Note: 'CPU 1%' });
  assert.throws(() => make({ url: 'http://x/', list: { items: 'guests', title: 'title', where: 'pct >' } }), /where "pct >": the expression stops too soon/);
  assert.throws(() => make({ url: 'http://x/', table: { items: 'guests', columns: {} } }), /at least one column/);
  assert.throws(() => make({ url: 'http://x/', table: { items: 'guests', columns: { A: 'a' } }, list: { items: 'guests', title: 'a' } }), /exactly one of stats, list, rows, status or table \(found 2\)/);
});

test('api: from another widget\'s card, with no request of its own', async () => {
  let asked = 0;
  const ctx = { ...ctxWith({ cards: { 'proxmox.guests': GUESTS } }), http: async () => { asked++; return {}; } };
  const big = make({ from: 'proxmox.guests', title: 'Big VMs', list: { items: 'items', where: "pct > 0.8 and not contains(id, 'node/')", sort: '-pct', title: 'title', meta: '=pct|pct' } }, ctx);
  assert.equal(big.widgets.data.from, 'proxmox.guests');
  const c: any = await big.widgets.data.fetch();
  valid(c);
  assert.deepEqual(c.items.map((i: any) => i.title), ['pihole', 'plex']);
  assert.equal(asked, 0);
  await assert.rejects(make({ from: 'proxmox.storage', list: { items: 'items', title: 'title' } }, ctx).widgets.data.fetch(), /proxmox.storage has no card yet/);
  await assert.rejects(make({ from: 'proxmox.guests', list: { items: 'title', title: 'title' } }, ctx).widgets.data.fetch(), /"title" isn't a list in proxmox.guests's card/);
  assert.throws(() => make({ list: { items: 'items', title: 'title' } }), /exactly one of url or from \(found 0\)/);
  assert.throws(() => make({ url: 'http://x/', from: 'a.b', list: { items: 'items', title: 'title' } }), /exactly one of url or from \(found 2\)/);
  assert.throws(() => api.config.parse({ from: 'nodot', list: { items: 'items', title: 't' } }), /instance\.widget/);
});

const yaml = (body: string) => parseConfig(`title: Home\n${body}`);
const SRC = 'src: { type: api, url: "http://src.example/", list: { items: items, title: name } }';

test('config check: a from that names nothing, a chain and a circle', () => {
  const { registry } = { registry: { api } };
  const problems = (integrations: string, layout = 'layout: []') => check(yaml(`integrations:\n${integrations.split('\n').map(l => `  ${l}`).join('\n')}\n${layout}`), registry).problems.filter(p => /from/.test(p));
  assert.deepEqual(problems(`${SRC}\nbig: { type: api, from: src.data, list: { items: items, title: name } }`), []);
  assert.deepEqual(problems('big: { type: api, from: nope.data, list: { items: items, title: name } }'), ['integrations.big.from: no widget "nope.data"']);
  assert.deepEqual(problems(`${SRC}\nbig: { type: api, from: src.list, list: { items: items, title: name } }`), ['integrations.big.from: no widget "src.list" (src has: data)']);
  assert.deepEqual(problems('big: { type: api, from: valet.backups, list: { items: items, title: name } }'), ["integrations.big.from: valet.backups is Valet's own; a card can be made from an integration's widget"]);
  assert.deepEqual(problems('big: { type: api, from: big.data, list: { items: items, title: name } }'), ["integrations.big.from: a card can't be made from itself"]);
  assert.deepEqual(problems(`${SRC}\nb: { type: api, from: src.data, list: { items: items, title: name } }\nc: { type: api, from: b.data, list: { items: items, title: name } }`),
    ['integrations.c.from: b.data is made from src.data itself; use from: src.data directly']);
  assert.deepEqual(problems('x: { type: api, from: y.data, list: { items: items, title: name } }\ny: { type: api, from: x.data, list: { items: items, title: name } }'), [
    'integrations.x.from: x.data → y.data → x.data goes round in a circle; make one of them from a widget that fetches its own data',
    'integrations.y.from: y.data → x.data → y.data goes round in a circle; make one of them from a widget that fetches its own data',
  ]);
  // placing the made card keeps its source polled, though the source is on no page
  const { placed } = check(yaml(`integrations:\n  ${SRC}\n  big: { type: api, from: src.data, list: { items: items, title: name } }\nlayout: [{ title: Home, widgets: [big.data] }]`), registry);
  assert.deepEqual([...placed].sort(), ['big.data', 'src.data']);
});

// A house where the source is on the House tab and the card made from it on Media, which the children see alone.
const HOUSE = `
integrations:
  ${SRC}
  big: { type: api, from: src.data, list: { items: items, title: name } }
  plain: { type: api, url: "http://plain.example/", list: { items: items, title: name } }
layout:
  - { title: Media, widgets: [big.data, plain.data] }
  - { title: House, widgets: [src.data] }
profiles:
  kids: { tabs: [Media], assistant: { access: { default: read } } }
  family: { tabs: [Media, House], assistant: { access: { default: read } } }
users: { sam: kids, pat: family }
assistant: { model: m, access: { default: read, config: control } }
`;

test('from: a card made from another is seen only by someone who sees that one', () => {
  const config = yaml(HOUSE), { instances, placed } = check(config, { api });
  const site = { config: { ...config, assistant: capDerived(config.assistant, instances) }, instances, placed };
  const kid = viewOf(site, 'sam'), family = viewOf(site, 'pat'), owner = viewOf(site, 'owner');
  assert.deepEqual([kid.sees('big.data'), kid.sees('plain.data'), kid.sees('src.data')], [false, true, false]);
  assert.deepEqual([family.sees('big.data'), family.sees('src.data')], [true, true]);
  assert.equal(owner.sees('big.data'), true);
  // and so their assistant can't read it either: its default covered only the integrations on their tabs
  assert.equal(accessOf(kid.config.assistant, 'big'), rank.none);
  assert.equal(accessOf(kid.config.assistant, 'plain'), rank.read);
  assert.equal(accessOf(family.config.assistant, 'big'), rank.read);
  // a profile that names the made card outright still gets no more than its source
  const named = yaml(HOUSE.replace('kids: { tabs: [Media], assistant: { access: { default: read } } }', 'kids: { tabs: [Media], assistant: { access: { default: read, big: read, src: none } } }'));
  const again = check(named, { api }), k2 = viewOf({ config: named, instances: again.instances, placed: again.placed }, 'sam');
  assert.equal(accessOf(k2.config.assistant, 'big'), rank.none);
});

test('from: the assistant reads a made card no more than its source', () => {
  const config = yaml(HOUSE.replace('access: { default: read, config: control }', 'access: { default: read, config: control, src: none, big.read: read }')), { instances } = check(config, { api });
  const a = capDerived(config.assistant, instances)!;
  assert.equal(accessOf(a, 'big'), rank.none);
  assert.equal(a.access['big.read'], 'none');
  assert.equal(accessOf(a, 'plain'), rank.read);
  const plain = yaml(HOUSE).assistant;
  assert.equal(capDerived(plain, check(yaml(HOUSE), { api }).instances), plain);   // nothing to lower: the same object back
});

test('widget_sample: only a widget the assistant may read, never a profile\'s, and nothing without a running site', async () => {
  const file = join(process.env.VALET_DATA!, 'sample.yaml');
  await writeFile(file, 'title: Home\nintegrations: {}\nlayout: []\n');
  const seen: string[] = [];
  const tools = setupTools(file, { api }, { may: k => k === 'src.data', card: async k => { seen.push(k); return GUESTS; } });
  assert.equal(tools.widget_sample.access, 'read');
  const ok: any = await tools.widget_sample.run({ widget: 'src.data' });
  assert.match(ok.data.sample, /"title":"pihole"/);
  const no: any = await tools.widget_sample.run({ widget: 'vault.secrets' });
  assert.match(no.data.error, /no widget "vault.secrets" you may read/);
  assert.deepEqual(seen, ['src.data']);
  assert.match(((await setupTools(file, { api }).widget_sample.run({ widget: 'src.data' })) as any).data.error, /you may read/);
  // the setup tools are an owner's: a profile's view has no config instance to offer them
  const config = yaml(HOUSE), { instances, placed } = check(config, { api });
  instances.set('config', { widgets: {}, tools });
  assert.equal(viewOf({ config, instances, placed }, 'pat').instances.has('config'), false);
  assert.equal(viewOf({ config, instances, placed }, 'owner').instances.has('config'), true);
});

test('a running site: the made card reads the hub, follows its source, and widget_sample keeps to assistant.access', { timeout: 20_000 }, async () => {
  let hits = 0, mem = .95;
  const s = createServer((_, r) => { hits++; r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ items: [{ name: 'plex', mem }, { name: 'nas', mem: .3 }] })); });
  await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(s.address() as any).port}/`;
  const file = join(process.env.VALET_DATA!, 'site.yaml');
  const text = `title: Home
assistant: { model: m, access: { config: control, secret: none } }
integrations:
  src: { type: api, url: "${url}", list: { items: items, title: name, pct: mem } }
  secret: { type: api, url: "${url}", list: { items: items, title: name } }
  big: { type: api, from: src.data, title: Big, list: { items: items, where: "pct > 0.8", title: title } }
layout: [{ title: Home, widgets: [big.data] }]
`;
  await writeFile(file, text);
  const site = await buildSite(parseConfig(text), { api }, new Set(), { path: file, rebuild: async () => {} });
  try {
    assert.deepEqual([...site.placed].filter(k => !k.startsWith('valet.')).sort(), ['big.data', 'src.data']);
    await site.hub.refresh('src.data');
    await site.hub.refresh('big.data');
    const before = hits;
    const card: any = await site.instances.get('big')!.widgets.data.fetch();
    assert.deepEqual(card.items.map((i: any) => i.title), ['plex']);
    assert.equal(hits, before);                                                     // no request of its own
    // its source changes, and it follows by itself: nothing here asks it to
    const followed = new Promise<void>(ok => site.hub.subscribe(st => { if (st.key === 'big.data' && !JSON.stringify(st.card).includes('plex')) ok(); }));
    mem = .1;
    await site.hub.refresh('src.data');
    await followed;
    const tools = site.instances.get('config')!.tools!;
    assert.match(((await tools.widget_sample.run({ widget: 'src.data' })) as any).data.sample, /"title":"nas"/);
    assert.match(((await tools.widget_sample.run({ widget: 'secret.data' })) as any).data.error, /you may read/);
    assert.match(((await tools.widget_sample.run({ widget: 'big.data' })) as any).data.error, /you may read/);
    // a card being tried may be made from what the assistant may read, and not from what it may not
    const tried: any = await tools.config_try.run({ summary: 'x', ops: [{ op: 'set', path: ['integrations', 'try'], value: { type: 'api', from: 'src.data', list: { items: 'items', title: 'title' } } }] });
    assert.equal(tried.card?.type, 'list', JSON.stringify(tried.data));
    const refused: any = await tools.config_try.run({ summary: 'x', ops: [{ op: 'set', path: ['integrations', 'try'], value: { type: 'api', from: 'secret.data', list: { items: 'items', title: 'title' } } }] });
    assert.match(JSON.stringify(refused.data), /secret.data isn't a widget you may read/);
    const said = await tools.config_try.confirm!({ summary: 'x', ops: [{ op: 'set', path: ['integrations', 'try'], value: { type: 'api', from: 'src.data', list: { items: 'items', title: 'title' } } }] });
    assert.match(said.title, /made from src.data/);
  } finally {
    site.hub.dispose(); site.watcher?.stop(); site.watches.stop(); site.rules.stop(); site.stopBackups(); site.stopReminders(); site.stopEvents(); s.close();
  }
});
