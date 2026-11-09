// ⌘K's search inside the services: which tools it may use, that answers arrive as each service gives them, that nothing
// secret comes out, and that a slow or broken service costs nobody else anything. Made-up services only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { z } from 'zod';
import { Config } from '../src/server/config.ts';
import { redactor } from '../src/server/security.ts';
import { findersOf, found, queryOf, search } from '../src/server/search.ts';
import { hitsOf, type Found } from '../src/shared/search.ts';
import type { Card } from '../src/shared/cards.ts';
import type { Instance, Tool } from '../src/server/core.ts';

const SECRET = 'made-up-secret-4f7a';
type Run = (q: string, limit?: number) => Promise<Card | null> | Card | null;
const shelf = (...titles: string[]): Card => ({ type: 'shelf', title: 'Found', items: titles.map(t => ({ title: t, href: `https://docs.example/${t}` })) });
const finder = (run: Run, more: Partial<Tool> = {}): Tool => ({
  description: 'search', access: 'read', find: 'query', input: z.object({ query: z.string(), limit: z.number().default(8) }),
  async run({ query, limit }) { const card = await run(query, limit); return { data: {}, card: card ?? { type: 'text', text: 'Nothing matches' } }; }, ...more,
});
const siteOf = (tools: Record<string, Record<string, Tool>>, config: object = {}) => ({
  config: Config.parse(config), redact: redactor([SECRET]),
  instances: new Map<string, Instance>(Object.entries(tools).map(([id, t]) => [id, { widgets: {}, tools: t }])),
  meta: new Map(Object.keys(tools).map(id => [id, { type: id, name: id[0].toUpperCase() + id.slice(1) }])),
});
const ask = async (site: ReturnType<typeof siteOf>, q: string, wait?: number) => {
  const app = new Hono().get('/api/search', c => search(c, site, wait));
  const r = await app.request(`/api/search?q=${encodeURIComponent(q)}`), text = await r.text();
  return { r, lines: text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Found), text };
};

// ── rows from cards ─────────────────────────────────────────────────────────────────────────────────────────────────
test('hitsOf: every card that lists things gives rows, and one that doesn\'t gives none', () => {
  assert.deepEqual(hitsOf({ type: 'shelf', items: [{ title: 'Lease', subtitle: 'Landlord', badge: '2025', image: '/api/image/docs?ref=1', href: 'https://docs.example/1' }] }),
    [{ title: 'Lease', sub: 'Landlord', image: '/api/image/docs?ref=1', href: 'https://docs.example/1' }]);
  assert.deepEqual(hitsOf({ type: 'list', items: [{ title: 'Dentist', subtitle: 'Tuesday', meta: '3 pm' }] }), [{ title: 'Dentist', sub: 'Tuesday · 3 pm', image: undefined, href: undefined }]);
  assert.equal(hitsOf({ type: 'controls', items: [{ id: 'l', label: 'Lamp', kind: 'toggle', value: true, sub: 'Office' }] })[0].sub, 'Office · On');
  assert.equal(hitsOf({ type: 'photos', items: [{ image: '/api/image/p?ref=1', subtitle: 'Lisbon' }] })[0].title, 'Lisbon');
  assert.deepEqual(hitsOf({ type: 'group', cards: [shelf('a'), shelf('b')] }).map(h => h.title), ['a', 'b']);
  assert.deepEqual(hitsOf({ type: 'text', text: 'Nothing matches' }), []);
  assert.deepEqual(hitsOf(null), []);
  assert.equal(hitsOf(shelf('a', 'b', 'c', 'd', 'e', 'f', 'g')).length, 5);
});

test('hitsOf: only a web address opens from a row', () => {
  const hrefs = hitsOf({ type: 'list', items: [{ title: 'a', href: 'javascript:alert(1)' }, { title: 'b', href: '/api/files/x' }, { title: 'c', href: 'https://ok.example' }, { title: 'd', href: 'data:text/html,x' }] }).map(h => h.href);
  assert.deepEqual(hrefs, [undefined, undefined, 'https://ok.example', undefined]);
});

// ── which tools ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('finders: only tools that look and say they search, in the config\'s order', () => {
  const s = siteOf({
    docs: { docs_search: finder(() => null), docs_read: { ...finder(() => null), find: undefined }, docs_delete: finder(() => null, { access: 'control' }) },
    links: { find: finder(() => null) },
    config: { config_search: finder(() => null) }, valet: { what: finder(() => null) },
  });
  assert.deepEqual(findersOf(s).map(f => [f.id, f.n, f.source]), [['docs__docs_search', 0, 'Docs'], ['links__find', 1, 'Links']]);
});

test('finders: a search by likeness always finds something, so it goes last', () => {
  const s = siteOf({ photos: { search: finder(() => null, { nearest: true }) }, docs: { search: finder(() => null) }, links: { search: finder(() => null) } });
  assert.deepEqual(findersOf(s).map(f => [f.id, f.n]), [['docs__search', 0], ['links__search', 1], ['photos__search', 2]]);
});

test('finders: assistant.access none takes a service or one tool out; find: false or a list narrows it', () => {
  const tools = { docs: { search: finder(() => null) }, links: { search: finder(() => null) }, photos: { search: finder(() => null), faces: finder(() => null, { label: 'Searched faces' }) } };
  const ids = (config: object) => findersOf(siteOf(tools, config)).map(f => f.id);
  assert.deepEqual(ids({}), ['docs__search', 'links__search', 'photos__search', 'photos__faces']);
  assert.deepEqual(ids({ assistant: { model: 'm', access: { default: 'read', docs: 'none', 'photos.faces': 'none' } } }), ['links__search', 'photos__search']);
  assert.deepEqual(ids({ assistant: { model: 'm', access: { default: 'none', links: 'control' } } }), ['links__search']);
  assert.deepEqual(ids({ find: false }), []);
  assert.deepEqual(ids({ find: ['links', 'nope'] }), ['links__search']);
  // two search tools in one service are told apart by what they search
  assert.deepEqual(findersOf(siteOf(tools)).filter(f => f.inst === 'photos').map(f => f.source), ['Photos · search', 'Photos · faces']);
});

// ── the answer ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('search: each service is a line as it answers, the fast one first, and nothing found is a null card', async () => {
  let slow!: () => void;
  const waiting = new Promise<void>(ok => { slow = ok; });
  const s = siteOf({
    docs: { search: finder(async q => { await waiting; return shelf(`${q} lease`); }) },
    links: { search: finder(q => shelf(`${q} article`)) },
    games: { search: finder(() => null) },
  });
  const app = new Hono().get('/api/search', c => search(c, s));
  const r = await app.request('/api/search?q=flat'), reader = r.body!.getReader(), text = new TextDecoder();
  assert.match(r.headers.get('content-type')!, /ndjson/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const first: Found[] = [];
  while (first.length < 2) first.push(...text.decode((await reader.read()).value).split('\n').filter(Boolean).map(l => JSON.parse(l)));
  assert.deepEqual(first.map(f => [f.id, f.n, f.card && hitsOf(f.card)[0].title]).sort(), [['games__search', 2, null], ['links__search', 1, 'flat article']]);
  slow();
  const last = JSON.parse(text.decode((await reader.read()).value)) as Found;
  assert.deepEqual([last.id, last.n, last.source, last.icon, hitsOf(last.card)[0].title], ['docs__search', 0, 'Docs', '/api/icon/docs', 'flat lease']);
  assert.equal((await reader.read()).done, true);
});

test('search: a tool with a limit is asked for a palette\'s worth, one without still runs', async () => {
  const asked: unknown[] = [];
  const strict: Tool = { description: 's', access: 'read', find: 'title', input: z.object({ title: z.string() }).strict(), async run(a) { asked.push(a); return { data: {}, card: shelf('x') }; } };
  const s = siteOf({ docs: { search: finder((q, limit) => { asked.push({ q, limit }); return shelf('y'); }) }, library: { lookup: strict } });
  assert.equal((await ask(s, 'dune')).lines.filter(l => l.card).length, 2);
  assert.deepEqual(asked, [{ q: 'dune', limit: 6 }, { title: 'dune' }]);
});

test('search: too short asks nothing; the words are trimmed and capped', async () => {
  let n = 0;
  const s = siteOf({ docs: { search: finder(() => { n++; return shelf('x'); }) } });
  for (const q of ['', ' ', 'a', ' a ']) assert.equal((await ask(s, q)).text, '');
  assert.equal(n, 0);
  assert.equal(queryOf('  car   insurance  '), 'car insurance');
  assert.equal(queryOf('x'.repeat(500)).length, 80);
  assert.equal(queryOf(undefined), '');
});

test('search: nothing secret comes out, in a card or from an error', async () => {
  const s = siteOf({
    docs: { search: finder(() => ({ type: 'shelf', items: [{ title: `key ${SECRET}`, href: `https://docs.example/?token=${SECRET}` }] })) },
    links: { search: finder(() => { throw new Error(`refused ${SECRET}`); }) },
  });
  const { text, lines } = await ask(s, 'key');
  assert.ok(!text.includes(SECRET));
  assert.equal(lines.find(l => l.id === 'links__search')!.card, null);
  assert.ok(hitsOf(lines.find(l => l.id === 'docs__search')!.card).length);
});

test('search: a service that never answers is given up on, and the others are already there', async () => {
  const s = siteOf({ docs: { search: finder(() => new Promise(() => {})) }, links: { search: finder(() => shelf('here')) } });
  const { lines } = await ask(s, 'anything', 5);
  assert.deepEqual(lines.map(l => [l.id, !!l.card]), [['links__search', true], ['docs__search', false]]);
});

test('search: an error in the service\'s own answer is nothing found, not a card', async () => {
  const bad: Tool = { ...finder(() => null), async run() { return { data: { error: 'unauthorized' }, card: shelf('stale') }; } };
  assert.equal((await ask(siteOf({ docs: { search: bad } }), 'tax')).lines[0].card, null);
});

// ── asking each service once ────────────────────────────────────────────────────────────────────────────────────────
test('kept: the same words ask a service once, whatever their case, for a short while; then again', async () => {
  let n = 0;
  const s = siteOf({ docs: { search: finder(() => { n++; return shelf('x'); }) } }), [f] = findersOf(s);
  await Promise.all([found(s, f, 'Lease', 100, 1000), found(s, f, 'lease', 100, 1000)]);
  await found(s, f, 'LEASE', 100, 20_000);
  assert.equal(n, 1);
  await found(s, f, 'lease', 100, 1000 + 30_000);
  assert.equal(n, 2);
  await found(s, f, 'leases', 100, 1000);
  assert.equal(n, 3);
});

test('kept: a failure isn\'t remembered, and a reloaded config starts clean', async () => {
  let n = 0, down = true;
  const tool = finder(() => { n++; if (down) throw new Error('down'); return shelf('x'); });
  const s = siteOf({ docs: { search: tool } }), [f] = findersOf(s);
  assert.equal(await found(s, f, 'lease', 100, 1000), null);
  down = false;
  assert.ok(await found(s, f, 'lease', 100, 1001));
  assert.equal(n, 2);
  // the same integration built again is a new tool: nothing kept for the old one answers for it
  const again = siteOf({ docs: { search: finder(() => { n++; return shelf('y'); }) } });
  assert.equal(hitsOf(await found(again, findersOf(again)[0], 'lease', 100, 1002))[0].title, 'y');
  assert.equal(n, 3);
});

test('kept: many different words don\'t pile up', async () => {
  const s = siteOf({ docs: { search: finder(q => shelf(q)) } }), [f] = findersOf(s);
  for (let i = 0; i < 200; i++) await found(s, f, `word ${i}`, 100, 1000);
  // the first is long gone, so asking again runs it again
  let n = 0;
  const t = f.t.run; f.t.run = async a => { n++; return t(a); };
  await found(s, f, 'word 0', 100, 1000); await found(s, f, 'word 199', 100, 1000);
  assert.equal(n, 1);
});
