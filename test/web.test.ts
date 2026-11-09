// The assistant's web search and web_read, against made-up providers and a made-up internet: what each provider is
// asked and how its answer is read, that a key never comes back out, and every way web_read must refuse to be pointed
// at the home network. Nothing here reaches a real host: fetch, DNS and the wire are fakes, and the one real socket
// goes to a server this test starts on 127.0.0.1.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { Config } from '../src/server/config.ts';
import { MAX_PAGE, isPublic, pageText, publicAddress, publicPage, wire, type Address, type Reply, type Wire } from '../src/server/public.ts';
import { runTool } from '../src/server/run.ts';
import { redactor } from '../src/server/security.ts';
import { KEEP, MAX_TEXT, search, webFor, webMemory, webTools, type WebSearch } from '../src/server/web.ts';
import { checkCard } from '../src/shared/cards.schema.ts';

const KEY = 'made-up-search-key-4417';
const cfg = (w: object): WebSearch => Config.parse({ assistant: { model: 'm', webSearch: w } }).assistant!.webSearch!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A fetch that answers from `reply` and remembers what it was asked. */
const fake = (reply: (url: string) => Response | Promise<Response>) => {
  const seen: { url: URL; method: string; headers: Record<string, string>; body?: any; redirect?: string }[] = [];
  const fetcher = (async (url: any, init: any = {}) => { seen.push({ url: new URL(String(url)), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: init.body && JSON.parse(init.body), redirect: init.redirect }); return reply(String(url)); }) as typeof fetch;
  return { fetcher, seen };
};
const RESULTS = [{ title: 'Kettle 2.0 released', url: 'https://kettle.example/blog/2-0', content: 'Version <b>2.0</b> is out &amp; faster.', publishedDate: '2026-03-04T10:00:00Z' }, { title: 'Kettle docs', url: 'https://docs.kettle.example/', content: 'How to set it up.' }];

test('searxng: asks its JSON API with the settings, and reads titles, addresses, snippets and dates', async () => {
  const { fetcher, seen } = fake(() => json({ results: [...RESULTS, { title: 'again', url: 'https://kettle.example/blog/2-0' }, { title: 'A script', url: 'javascript:alert(1)' }, { title: '', url: 'https://nameless.example/' }] }));
  const hits = await search(cfg({ provider: 'searxng', url: 'http://searxng.home.example:8080/', safe: 'strict', language: 'de', region: 'ch' }), 'kettle release', fetcher);
  assert.equal(seen[0].url.origin + seen[0].url.pathname, 'http://searxng.home.example:8080/search');
  assert.deepEqual(Object.fromEntries(seen[0].url.searchParams), { q: 'kettle release', format: 'json', safesearch: '2', language: 'de-CH' });
  assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].redirect, 'manual');
  assert.deepEqual(hits, [{ title: 'Kettle 2.0 released', url: 'https://kettle.example/blog/2-0', snippet: 'Version 2.0 is out & faster.', date: '2026-03-04' }, { title: 'Kettle docs', url: 'https://docs.kettle.example/', snippet: 'How to set it up.', date: undefined }]);
});

test('searxng without the json format says how to turn it on', async () => {
  const c = cfg({ provider: 'searxng', url: 'http://searxng.home.example' });
  await assert.rejects(search(c, 'kettle', fake(() => new Response('Forbidden', { status: 403 })).fetcher), /searxng\.home\.example answered 403: turn on the json format/);
  await assert.rejects(search(c, 'kettle', fake(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })).fetcher), /didn't answer with search results/);
  await assert.rejects(search(c, 'kettle', fake(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } })).fetcher), /it redirects/);
});

test('brave: the key goes in its header, the settings in the query, and its answer is read', async () => {
  const { fetcher, seen } = fake(() => json({ web: { results: [{ title: 'Kettle <strong>2.0</strong>', url: 'https://kettle.example/blog/2-0', description: 'Out <strong>now</strong>.', age: '2 days ago' }, { title: 'Older', url: 'https://kettle.example/blog/1-9', description: 'x', page_age: '2025-11-02T08:00:00' }] } }));
  const hits = await search(cfg({ provider: 'brave', apiKey: KEY, results: 3, safe: 'off', region: 'ca', language: 'en' }), 'kettle 2.0', fetcher);
  assert.equal(seen[0].url.origin + seen[0].url.pathname, 'https://api.search.brave.com/res/v1/web/search');
  assert.deepEqual(Object.fromEntries(seen[0].url.searchParams), { q: 'kettle 2.0', count: '3', safesearch: 'off', country: 'CA', search_lang: 'en' });
  assert.equal(seen[0].headers['x-subscription-token'], KEY);
  assert.ok(!seen[0].url.href.includes(KEY));
  assert.deepEqual(hits.map(h => [h.title, h.snippet, h.date]), [['Kettle 2.0', 'Out now.', '2 days ago'], ['Older', 'x', '2025-11-02']]);
});

test('tavily: a POST with the key as a bearer, and its answer is read', async () => {
  const { fetcher, seen } = fake(() => json({ results: [{ title: 'Kettle 2.0', url: 'https://kettle.example/blog/2-0', content: 'Out now.', score: .9 }] }));
  const hits = await search(cfg({ provider: 'tavily', apiKey: KEY, results: 4 }), 'kettle 2.0', fetcher);
  assert.equal(seen[0].url.href, 'https://api.tavily.com/search'); assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(seen[0].body, { query: 'kettle 2.0', max_results: 4, search_depth: 'basic' });
  assert.deepEqual(hits, [{ title: 'Kettle 2.0', url: 'https://kettle.example/blog/2-0', snippet: 'Out now.', date: undefined }]);
});

test('results are capped at `results`, and a long title or snippet is cut', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `T${i} ${'t'.repeat(400)}`, url: `https://a.example/${i}`, content: 's'.repeat(900) }));
  const hits = await search(cfg({ provider: 'searxng', url: 'http://s.example' }), 'q q', fake(() => json({ results: many })).fetcher);
  assert.equal(hits.length, 5); assert.ok(hits[0].title.length <= 160); assert.ok(hits[0].snippet!.length <= 320);
});

test('a key never comes back out: not in an error, a result or the card, whatever the provider says', async () => {
  for (const provider of ['brave', 'tavily'] as const) {
    const c = cfg({ provider, apiKey: KEY });
    // a provider that repeats the key in its refusal, and a network error that names it
    const refused = await search(c, 'kettle', fake(() => json({ error: `bad key ${KEY}` }, 401)).fetcher).catch(e => e as Error);
    assert.match(refused.message, /answered 401: check the key/); assert.ok(!refused.message.includes(KEY));
    const down = await search(c, 'kettle', (async () => { throw new Error(`connect failed with ${KEY}`); }) as any).catch(e => e as Error);
    assert.match(down.message, /can't be reached/); assert.ok(!down.message.includes(KEY));
    // and one that echoes it in a result: the tool's door (run.ts) takes it out, as it does for every tool
    const tools = webTools(c, { memory: webMemory(), fetch: fake(() => provider === 'brave' ? json({ web: { results: [{ title: `Your key is ${KEY}`, url: 'https://a.example/', description: KEY }] } }) : json({ results: [{ title: `Your key is ${KEY}`, url: 'https://a.example/', content: KEY }] })).fetcher });
    const out = await runTool({ id: 'valet', name: 'web_search', t: tools.web_search, args: { query: 'kettle' }, via: 'chat', who: 'you', redact: redactor([KEY]) });
    assert.equal(out.data.results.length, 1); assert.ok(!JSON.stringify(out).includes(KEY));
  }
});

test('web_search: a compact list for the model, a card from the catalog for the person, and it only looks', async () => {
  const tools = webTools(cfg({ provider: 'searxng', url: 'http://s.example' }), { memory: webMemory(), fetch: fake(() => json({ results: RESULTS })).fetcher });
  assert.equal(tools.web_search.access, 'read'); assert.equal(tools.web_read.access, 'read');
  assert.equal(tools.web_search.label, 'Searched the web'); assert.ok(tools.web_search.followUps?.length);
  assert.equal(tools.web_search.find, undefined, 'never part of ⌘K\'s search as you type, which would send every keystroke out');
  const out = await tools.web_search.run(tools.web_search.input.parse({ query: ' kettle release ' })) as any;
  assert.match(out.data.note, /strangers/);
  assert.deepEqual(out.data.results[0], { title: 'Kettle 2.0 released', url: 'https://kettle.example/blog/2-0', snippet: 'Version 2.0 is out & faster.', date: '2026-03-04' });
  assert.ok(checkCard(out.card).success, JSON.stringify(checkCard(out.card).error?.issues));
  assert.equal(out.card.type, 'list'); assert.equal(out.card.title, 'kettle release');
  assert.deepEqual(out.card.items[0], { title: 'Kettle 2.0 released', href: 'https://kettle.example/blog/2-0', subtitle: 'kettle.example', detail: 'Version 2.0 is out & faster.', meta: '2026-03-04' });
  const none = webTools(cfg({ provider: 'searxng', url: 'http://s.example' }), { memory: webMemory(), fetch: fake(() => json({ results: [] })).fetcher });
  const empty = await none.web_search.run({ query: 'nothing at all' }) as any;
  assert.deepEqual(empty.data.results, []); assert.ok(checkCard(empty.card).success);
  assert.equal(none.web_search.input.safeParse({ query: 'x'.repeat(201) }).success, false);
  assert.equal(webTools(cfg({ provider: 'searxng', url: 'http://s.example', read: false })).web_read, undefined);
});

test('a day\'s searches are capped, and the same question within the hour is asked once', async () => {
  let at = new Date(2026, 2, 4, 9, 0);
  const { fetcher, seen } = fake(() => json({ results: RESULTS }));
  const tools = webTools(cfg({ provider: 'brave', apiKey: KEY, perDay: 2 }), { memory: webMemory(), fetch: (async (u: any, i: any) => fetcher(u, i).then(() => json({ web: { results: [{ title: 'T', url: 'https://a.example/' }] } }))) as any, now: () => at });
  const ask = async (query: string) => (await tools.web_search.run({ query }) as any).data;
  await ask('one thing'); await ask('One Thing'); await ask('one thing');
  assert.equal(seen.length, 1, 'a repeat is answered from memory');
  await ask('another thing');
  assert.match((await ask('a third thing')).error, /today's 2 web searches \(assistant\.webSearch\.perDay\)/);
  assert.equal(seen.length, 2);
  assert.equal((await ask('one thing')).results.length, 1, 'what it already has still answers');
  at = new Date(at.getTime() + KEEP + 1);
  assert.match((await ask('one thing')).error, /today's 2/, 'past the hour it would be a new search');
  at = new Date(2026, 2, 4, 9, 0); at.setDate(at.getDate() + 1);
  assert.equal((await ask('a third thing')).results.length, 1, 'a new day starts the count again');
});

// ── web_read
const INSIDE = ['127.0.0.1', '127.8.9.10', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.254', '0.0.0.0', '224.0.0.251', '239.255.255.250', '255.255.255.255', '240.0.0.1', '198.18.0.1',
  '::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1', '::ffff:10.0.0.5', '::ffff:127.0.0.1', '::ffff:c0a8:101', '64:ff9b::a00:5', '64:ff9b::192.168.1.1', '64:ff9b::7f00:1', '2002:c0a8:101::1', '2001::1', 'fec0::1'];
const OUTSIDE = ['93.184.216.34', '8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '192.167.255.255', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8', '64:ff9b::808:808'];
const names = (map: Record<string, string[]>) => async (host: string): Promise<Address[]> => (map[host] ?? []).map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
const reply = (body: string | Uint8Array[], o: { status?: number; type?: string; location?: string } = {}): Reply => ({
  status: o.status ?? 200, headers: { 'content-type': o.type ?? 'text/html; charset=utf-8', ...(o.location ? { location: o.location } : {}) },
  body: (async function* () { for (const c of typeof body === 'string' ? [Buffer.from(body)] : body) yield c; })(), close() {} });
/** A wire that answers by address, and remembers every address it was sent to. */
const wires = (pages: Record<string, () => Reply>) => { const went: string[] = []; const w: Wire = async (url, to) => { went.push(`${url.href} @ ${to.address}`); const p = pages[url.href]; if (!p) throw new Error(`nothing at ${url.href}`); return p(); }; return { w, went }; };

test('every kind of address that isn\'t the public internet is told apart from one that is', () => {
  for (const a of INSIDE) assert.equal(isPublic(a), false, a);
  for (const a of OUTSIDE) assert.equal(isPublic(a), true, a);
  for (const a of ['', 'localhost', '10.0.0', '999.1.1.1']) assert.equal(isPublic(a), false, a);
});

test('web_read refuses a name or a literal address that leads inside, before anything is sent', async () => {
  for (const a of INSIDE) {
    const { w, went } = wires({});
    await assert.rejects(publicPage('http://inside.example/admin', { resolve: names({ 'inside.example': [a] }), wire: w }), /not on the public internet/, a);
    const literal = `http://${a.includes(':') ? `[${a}]` : a}/admin`;
    await assert.rejects(publicPage(literal, { resolve: names({}), wire: w }), /not on the public internet/, literal);
    assert.deepEqual(went, []);
  }
  const { w, went } = wires({});
  // the spellings a URL allows for the same loopback address, and a name that answers with one public and one private address
  for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://0177.0.0.1/', 'http://[::ffff:7f00:1]/', 'http://localhost/', 'http://router/']) await assert.rejects(publicPage(url, { resolve: names({ localhost: ['127.0.0.1'], router: ['192.168.1.1'] }), wire: w }), /not on the public internet/, url);
  await assert.rejects(publicPage('https://two-faced.example/', { resolve: names({ 'two-faced.example': ['93.184.216.34', '192.168.1.10'] }), wire: w }), /not on the public internet/);
  await assert.rejects(publicPage('https://nowhere.example/', { resolve: names({}), wire: w }), /can't be found/);
  for (const url of ['file:///etc/passwd', 'ftp://files.example/x', 'gopher://x.example/', 'javascript:alert(1)', 'not a url']) await assert.rejects(publicPage(url, { resolve: names({}), wire: w }), /only http and https|isn't a web address/, url);
  await assert.rejects(publicPage('https://sam:hunter2@site.example/', { resolve: names({ 'site.example': ['93.184.216.34'] }), wire: w }), /sign-in in it/);
  assert.deepEqual(went, []);
});

test('web_read connects to the address it checked, and checks every redirect the same way', async () => {
  const resolve = names({ 'site.example': ['93.184.216.34', '93.184.216.35'], 'www.site.example': ['93.184.216.36'], 'rebind.example': ['192.168.1.1'], 'loop.example': ['93.184.216.40'] });
  const ok = wires({ 'http://site.example/a': () => reply('', { status: 301, location: 'https://www.site.example/a' }), 'https://www.site.example/a': () => reply('<title>A</title><p>Hello</p>') });
  const page = await publicPage('http://site.example/a#part', { resolve, wire: ok.w });
  assert.deepEqual(ok.went, ['http://site.example/a @ 93.184.216.34', 'https://www.site.example/a @ 93.184.216.36']);
  assert.equal(page.url, 'https://www.site.example/a'); assert.equal(page.type, 'text/html');
  for (const location of ['http://192.168.1.1/admin', 'http://rebind.example/', 'http://[::1]:8080/', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'https://sam:pw@site.example/']) {
    const bad = wires({ 'http://site.example/a': () => reply('', { status: 302, location }) });
    await assert.rejects(publicPage('http://site.example/a', { resolve, wire: bad.w }), /not on the public internet|only http and https|sign-in in it/, location);
    assert.deepEqual(bad.went, ['http://site.example/a @ 93.184.216.34'], `nothing was sent to ${location}`);
  }
  const loop = wires({ 'https://loop.example/': () => reply('', { status: 302, location: '/' }) });
  await assert.rejects(publicPage('https://loop.example/', { resolve, wire: loop.w }), /too many redirects/);
  assert.equal(loop.went.length, 5);
});

test('web_read takes HTML and plain text only, stops at the size cap, and gives up when its time is up', async () => {
  const resolve = names({ 'site.example': ['93.184.216.34'] }), at = 'https://site.example/';
  for (const type of ['application/pdf', 'image/png', 'application/json', 'application/octet-stream', 'text/javascript', 'video/mp4', '']) {
    let read = false;
    const w: Wire = async () => ({ ...reply('x', { type }), headers: type ? { 'content-type': type } : {}, body: (async function* () { read = true; yield Buffer.from('x'); })() });
    await assert.rejects(publicPage(at, { resolve, wire: w }), /not a page of text/, type);
    assert.equal(read, false, 'refused unread');
  }
  assert.equal((await publicPage(at, { resolve, wire: async () => reply('just words', { type: 'TEXT/PLAIN' }) })).type, 'text/plain');
  await assert.rejects(publicPage(at, { resolve, wire: async () => reply('gone', { status: 404 }) }), /site\.example answered 404/);
  // a page that never ends: read up to the cap and no further
  let sent = 0, closed = false;
  const endless: Wire = async () => ({ ...reply(''), body: (async function* () { for (;;) { sent++; yield Buffer.alloc(65536, 97); } })(), close() { closed = true; } });
  const big = await publicPage(at, { resolve, wire: endless });
  assert.equal(big.body.length, MAX_PAGE); assert.equal(big.cut, true); assert.ok(closed);
  assert.ok(sent <= MAX_PAGE / 65536 + 1, `it stopped reading at the cap (${sent} chunks)`);
  assert.equal((await publicPage(at, { resolve, wire: async () => reply('abcdef'), max: 4 })).body, 'abcd');
  // time: the signal is the clock. One that's already up means nothing is read; one that runs out mid-page ends it there
  let hung: (() => void) | undefined; const stuck: Wire = (_u, _t, signal) => new Promise((_, no) => { hung = () => no(new Error('aborted')); signal.addEventListener('abort', hung); });
  await assert.rejects(publicPage(at, { resolve, wire: stuck, signal: AbortSignal.abort() }), /took too long/);
  const clock = new AbortController();
  const slow: Wire = async () => ({ ...reply(''), body: (async function* () { yield Buffer.from('<p>start'); clock.abort(); await new Promise(() => {}); })() });
  await assert.rejects(publicPage(at, { resolve, wire: slow, signal: clock.signal }), /took too long/);
  const never: Resolve = () => new Promise(() => {});
  await assert.rejects(publicPage(at, { resolve: never, wire: stuck, signal: AbortSignal.abort() }), /took too long/);
});
type Resolve = (host: string) => Promise<Address[]>;

test('the real wire goes to the pinned address whatever the name, and sends no cookie or key', async () => {
  const seen: any[] = [];
  const server = createServer((q, r) => {
    seen.push({ url: q.url, headers: q.headers });
    if (q.url === '/zipped') { r.setHeader('content-type', 'text/html'); r.setHeader('content-encoding', 'gzip'); return r.end(gzipSync('<p>unpacked</p>')); }
    if (q.url === '/odd') { r.setHeader('content-encoding', 'zstd'); return r.end('x'); }
    if (q.url === '/hang') return;
    r.setHeader('content-type', 'text/html'); r.setHeader('set-cookie', 'session=1'); r.end('<p>hello</p>');
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as any).port, here: Address = { address: '127.0.0.1', family: 4 };
  const text = async (r: Reply) => { const parts: Uint8Array[] = []; for await (const c of r.body) parts.push(c); return Buffer.concat(parts).toString(); };
  try {
    // a name that exists nowhere: only the pin can have brought the request here
    const res = await wire(new URL(`http://pinned.invalid:${port}/page?x=1`), here, AbortSignal.timeout(5000));
    assert.equal(res.status, 200); assert.equal(await text(res), '<p>hello</p>');
    assert.equal(seen[0].url, '/page?x=1'); assert.equal(seen[0].headers.host, `pinned.invalid:${port}`);
    assert.deepEqual(Object.keys(seen[0].headers).sort(), ['accept', 'accept-encoding', 'connection', 'host', 'user-agent']);
    assert.equal(await text(await wire(new URL(`http://pinned.invalid:${port}/zipped`), here, AbortSignal.timeout(5000))), '<p>unpacked</p>');
    await assert.rejects(wire(new URL(`http://pinned.invalid:${port}/odd`), here, AbortSignal.timeout(5000)), /doesn't read/);
    // through the whole of publicPage, with the check answered as if the name were public: a server that never answers
    const clock = new AbortController();
    const waiting = publicPage(`http://pinned.invalid:${port}/hang`, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], wire: (u, _to, s) => { queueMicrotask(() => clock.abort()); return wire(u, here, s); }, signal: clock.signal });
    await assert.rejects(waiting, /took too long/);
  } finally { server.closeAllConnections(); server.close(); }
});

test('a page becomes its words: no scripts, styles or chrome, entities read, and nothing it holds can run', () => {
  const page = pageText(`<!DOCTYPE html><html><HEAD><title>Kettle &amp; Co &mdash; News</title><style>p{color:red}</style><script>var a = "<p>not words</p>";</script></HEAD>
    <body><nav><a href="/">Home</a></nav><!-- <p>a comment</p> --><h1>Kettle 2.0</h1><p>It&#39;s <b>fas</b>ter &#x26; smaller.<br>5 &lt; 6 and a < b.</p>
    <SCRIPT type="x">alert(1)</SCRIPT><ul><li>One</li><li>Two</li></ul><svg><text>drawn</text></svg><footer>© nobody</footer>&#x110000;&#0;&bogus;</body></html>`);
  assert.equal(page.title, 'Kettle & Co — News');
  assert.equal(page.text, 'Kettle 2.0\n\nIt\'s faster & smaller.\n5 < 6 and a < b.\n\nOne\n\nTwo\n\n&bogus;');
  assert.deepEqual(pageText('plain words'), { title: undefined, text: 'plain words' });
  assert.equal(pageText('<p>cut off <script>never closed').text, 'cut off');
  assert.equal(pageText('<p>before<!-- never closed').text, 'before');
});

test('web_read opens only what a search returned, and hands back a capped page of plain text', async () => {
  const memory = webMemory(), opened: string[] = [];
  const page = async (url: string) => { opened.push(url); return { url, type: url.endsWith('.txt') ? 'text/plain' : 'text/html', cut: false, body: url.endsWith('long') ? `<p>${'word '.repeat(4000)}</p>` : url.endsWith('empty') ? '<script>draw()</script>' : url.endsWith('.txt') ? 'notes  for\n\n\n\nyou' : '<title>Kettle 2.0</title><p>Out now.</p>' }; };
  const results = [...RESULTS, { title: 'Long', url: 'https://kettle.example/long' }, { title: 'Empty', url: 'https://kettle.example/empty' }, { title: 'Notes', url: 'https://kettle.example/notes.txt' }];
  const tools = webTools(cfg({ provider: 'searxng', url: 'http://s.example', results: 10 }), { memory, page, fetch: fake(() => json({ results })).fetcher });
  const read = async (url: string) => (await tools.web_read.run({ url }) as any).data;
  // nothing searched yet: not even a harmless address opens, and one made to carry something out never does
  assert.match((await read('https://kettle.example/blog/2-0')).error, /only opens an address web_search returned/);
  await tools.web_search.run({ query: 'kettle release' });
  for (const url of ['https://collector.example/?d=what-the-lease-says', 'https://kettle.example/blog/2-0?d=what-the-lease-says', 'https://kettle.example/', 'http://192.168.1.1/', 'http://kettle.example/blog/2-0']) assert.match((await read(url)).error, /only opens an address web_search returned/, url);
  assert.deepEqual(opened, []);
  const got = await read('https://kettle.example/blog/2-0#comments');
  assert.deepEqual(opened, ['https://kettle.example/blog/2-0']);
  assert.match(got.note, /strangers/); assert.deepEqual([got.url, got.title, got.text, got.cut], ['https://kettle.example/blog/2-0', 'Kettle 2.0', 'Out now.', undefined]);
  const long = await read('https://kettle.example/long');
  assert.equal(long.text.length, MAX_TEXT); assert.ok(long.cut);
  assert.match((await read('https://kettle.example/empty')).error, /no words to read/);
  assert.equal((await read('https://kettle.example/notes.txt')).text, 'notes for\n\nyou');
  // and with the real fetcher behind it, an address a search returned still can't lead inside
  const real = webTools(cfg({ provider: 'searxng', url: 'http://s.example' }), { memory: webMemory(), fetch: fake(() => json({ results: [{ title: 'Router', url: 'http://192.168.1.1/' }, { title: 'This machine', url: 'http://127.0.0.1:8080/api/page' }] })).fetcher });
  await real.web_search.run({ query: 'my router' });
  for (const url of ['http://192.168.1.1/', 'http://127.0.0.1:8080/api/page']) await assert.rejects(real.web_read.run({ url }), /not on the public internet/);
});

test('config: off unless set, each provider needs what it uses, and unknown options are refused', () => {
  const parse = (w?: object) => Config.safeParse({ assistant: { model: 'm', ...(w ? { webSearch: w } : {}) } });
  assert.equal(parse().data!.assistant!.webSearch, undefined);
  assert.deepEqual(cfg({ provider: 'searxng', url: 'http://searxng:8080' }), { provider: 'searxng', url: 'http://searxng:8080', results: 5, safe: 'moderate', read: true, perDay: 100 });
  for (const bad of [{ provider: 'searxng' }, { provider: 'brave' }, { provider: 'tavily' }, { provider: 'brave', apiKey: KEY, url: 'https://other.example' }, { provider: 'kagi', apiKey: KEY }, { provider: 'brave', apiKey: KEY, results: 50 }, { provider: 'brave', apiKey: KEY, engine: 'x' }, { provider: 'brave', apiKey: KEY, region: 'canada' }])
    assert.equal(parse(bad).success, false, JSON.stringify(bad));
});

test('a site gets the web tools only when its config asks: never by default, never in a sandbox', () => {
  const site = (o: object = {}, a: object = {}) => Object.keys(webFor(Config.parse({ ...o, assistant: { model: 'm', ...a } })) ?? {});
  const webSearch = { provider: 'searxng', url: 'http://searxng:8080' };
  assert.deepEqual(site(), []);
  assert.deepEqual(site({}, { webSearch }), ['web_search', 'web_read']);
  assert.deepEqual(site({}, { webSearch: { ...webSearch, read: false } }), ['web_search']);
  assert.deepEqual(site({}, { webSearch, access: { 'valet.web_search': 'none' } }), ['web_search'], 'chat.ts leaves that one out; with it gone, web_read has nothing to open');
  assert.deepEqual(site({ sandbox: true }, { webSearch }), []);
  assert.equal(webFor(Config.parse({})), undefined);
});
