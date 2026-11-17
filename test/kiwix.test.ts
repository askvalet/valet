// Kiwix against made-up kiwix-serve answers: the catalog, search choosing full text or titles per book, the random
// article's first paragraph as plain words, the assistant's tools, the allowlist, and a server that's down.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { session, type Context } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { hitsOf } from '../src/shared/search.ts';
import kiwix, { lead, parseCatalog, articleText, unhidden } from '../src/integrations/kiwix.ts';

type Handler = (url: string, init: any) => unknown;
function fake(handler: Handler): Context & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'lib', calls, log() {}, image: r => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }), session,
    async http(url: string, init: any = {}) {
      calls.push(url);
      const out = await handler(url, init);
      if (out === undefined) throw new Error(`no answer for ${url}`);
      if (init.as === 'response') return out instanceof Response ? out : new Response(String(out));
      if (out instanceof Response) { if (!out.ok) throw new Error(`answered ${out.status}`); return init.as === 'text' ? out.text() : out.json(); }
      return out as any;
    },
  } as any;
}
const valid = (card: unknown) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };
const make = (cfg: Record<string, unknown>, ctx: Context) => kiwix.create(kiwix.config.parse({ url: 'http://10.0.0.8:8080', ...cfg }), ctx);

const entry = (uuid: string, name: string, flavour: string, id: string, title: string, articles: number, ft: boolean, more = '') => `
  <entry>
    <id>urn:uuid:${uuid}</id>
    <title>${title}</title>
    <summary>About ${title} &amp; more</summary>
    <language>eng</language>
    <name>${name}</name>
    <flavour>${flavour}</flavour>
    <category>${name.split('_')[0]}</category>
    <tags>_category:x;_pictures:yes;_ftindex:${ft ? 'yes' : 'no'};_details:yes</tags>
    <articleCount>${articles}</articleCount>
    <mediaCount>12</mediaCount>
    <link rel="http://opds-spec.org/image/thumbnail" href="/catalog/v2/illustration/${uuid}/?size=48" type="image/png;width=48;height=48;scale=1"/>
    <link type="text/html" href="/content/${id}" />${more}
  </entry>`;
const W = '00000000-0000-4000-8000-00000000000a', F = '00000000-0000-4000-8000-00000000000b', G = '00000000-0000-4000-8000-00000000000c';
const CATALOG = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>All Entries</title>
  ${entry(F, 'fixit_en_all', '', 'fixit_en_all_2026-01', 'Fixit Guides', 9000, false)}
  ${entry(W, 'wikipedia_en_all', 'maxi', 'wikipedia_en_all_maxi_2026-09', 'Wikipedia', 6_900_000, true, '\n    <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="/x.zim" length="118000000000" />')}
  ${entry(G, 'gutenberg_en_all', '', 'gutenberg_en_all_2026-05', 'Project Gutenberg', 70_000, true)}
</feed>`;
const searchXml = (book: string, items: [string, string, string][]) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Search</title><link>/search?x</link>
  ${items.map(([title, path, d]) => `<item><title>${title}</title><link>/content/${book}/${path}</link><description>${d}</description><book><title>B</title></book><wordCount>1,000</wordCount></item>`).join('')}
</channel></rss>`;
const suggest = (rows: [string, string][]) => JSON.stringify([...rows.map(([value, path]) => ({ value, label: `<b>${value}</b>`, kind: 'path', path })), { value: 'x ', label: 'containing x...', kind: 'pattern' }]);
const ARTICLE = `<!DOCTYPE html><html><head><title>Lighthouse</title><style>p{color:red}</style><script>var p = "<p>never this, not even close to being words that someone would read</p>";</script></head><body>
  <h1>Lighthouse</h1>
  <table class="infobox"><tr><td><p>A table caption that is long enough to look like a paragraph, but it is inside a table.</p><table><tr><td>nested</td></tr></table></td></tr><tr><td>Height: 30 m</td></tr></table>
  <p class="mw-empty-elt"></p>
  <p>Short label.</p>
  <p>A <b>lighthouse</b> is a tower that sends out light<sup class="reference">[1]</sup> to help ships at sea find their way, warn them of rocks and <a href="./Harbour">harbours</a>, and mark the coast.<sup>[note 2]</sup> <script>alert(1)</script>Most are automated now.</p>
  <p>The second paragraph is never shown on the card, only read by the assistant when it reads the whole article.</p>
</body></html>`;

const server = (over: Handler = () => undefined): Handler => (url, init) => {
  const o = over(url, init);
  if (o !== undefined) return o;
  if (url.includes('/catalog/v2/entries')) return new Response(CATALOG);
  if (url.includes('/search?')) {
    const book = new URL(url).searchParams.get('books.name')!;
    return new Response(searchXml(book, [['Lighthouse', 'Lighthouse', '<b>Lighthouse</b> is a tower…'], ['Fresnel lens', 'Fresnel_lens', 'used in <b>lighthouses</b>'], ['Harbour', 'Harbour', 'a <b>lighthouse</b> at its mouth']].map(([t, p, d]) => [`${t}${book.startsWith('gutenberg') ? ' (book)' : ''}`, p, d] as [string, string, string])));
  }
  if (url.includes('/suggest?')) return new Response(suggest([['Lighthouse Lens Cleaning', 'Guide/Lighthouse+Lens+Cleaning/12'], ['Keeper&apos;s Lamp &amp; Wick', 'Device/Keeper&apos;s_Lamp_&amp;_Wick']]));
  if (url.includes('/random?')) return new Response(null, { status: 302, headers: { location: `/content/${new URL(url).searchParams.get('content')}/Lighthouse` } });
  if (url.includes('/content/')) return new Response(ARTICLE);
  return undefined;
};

test('kiwix: the catalog is read into books, with the name its addresses use, the full-text index and the size', () => {
  const books = parseCatalog(CATALOG);
  assert.equal(books.length, 3);
  const w = books.find(b => b.name === 'wikipedia_en_all')!;
  assert.deepEqual({ id: w.id, flavour: w.flavour, ft: w.ftindex, articles: w.articles, size: w.size, lang: w.language, summary: w.summary, uuid: w.uuid },
    { id: 'wikipedia_en_all_maxi_2026-09', flavour: 'maxi', ft: true, articles: 6_900_000, size: 118e9, lang: 'English', summary: 'About Wikipedia & more', uuid: W });
  assert.equal(books.find(b => b.name === 'fixit_en_all')!.ftindex, false);
  assert.deepEqual(parseCatalog('<feed></feed>'), []);
});

test('kiwix: the library card lists every book, biggest first, each opening its content at href', async () => {
  const k = make({ href: 'https://library.example.com/' }, fake(server()));
  const card: any = await k.widgets.library.fetch();
  valid(card);
  assert.deepEqual(card.items.map((i: any) => i.title), ['Wikipedia', 'Project Gutenberg', 'Fixit Guides']);
  assert.equal(card.items[0].href, 'https://library.example.com/content/wikipedia_en_all_maxi_2026-09');
  assert.equal(card.items[0].subtitle, 'English · 6,900,000 articles');
  assert.equal(card.items[0].image, `/img/${W}`);
  assert.match(card.items[0].meta, /GB/);
  assert.equal(card.summary.value, '6,979,000');
  assert.equal(card.summary.sub, 'articles in 3 books');
});

test('kiwix: books: keeps to the books named, in that order, by name, name and flavour, or address', async () => {
  const ctx = fake(server());
  const card: any = await make({ books: ['gutenberg_en_all_2026-05', 'WIKIPEDIA_EN_ALL_MAXI', 'nothing_here'] }, ctx).widgets.library.fetch();
  assert.deepEqual(card.items.map((i: any) => i.title), ['Project Gutenberg', 'Wikipedia']);
  const s: any = await make({ books: ['fixit_en_all'] }, ctx).tools!.kiwix_search.run({ query: 'lighthouse', limit: 8 });
  assert.deepEqual(new Set(s.data.results.map((r: any) => r.book)), new Set(['Fixit Guides']));
  assert.ok(!ctx.calls.some(u => u.includes('/search?')), 'a book left out is never searched');
});

test('kiwix: search uses the full-text index where a book has one and titles where it doesn\'t, every book at once', async () => {
  const ctx = fake(server());
  const k = make({}, ctx);
  const out: any = await k.tools!.kiwix_search.run({ query: 'lighthouse', limit: 6 });
  const asked = ctx.calls.filter(u => !u.includes('/catalog/'));
  assert.equal(asked.length, 3);
  assert.ok(asked.some(u => u.includes('/search?books.name=wikipedia_en_all_maxi_2026-09&pattern=lighthouse&format=xml&pageLength=3')));
  assert.ok(asked.some(u => u.includes('/search?books.name=gutenberg_en_all_2026-05')));
  assert.ok(asked.some(u => u.includes('/suggest?content=fixit_en_all_2026-01&term=lighthouse&count=3')));
  // one from each book in turn
  assert.deepEqual(out.data.results.slice(0, 3).map((r: any) => r.book), ['Wikipedia', 'Project Gutenberg', 'Fixit Guides']);
  assert.equal(out.data.results.length, 6);
  const w = out.data.results[0];
  assert.equal(w.link, 'http://10.0.0.8:8080/content/wikipedia_en_all_maxi_2026-09/Lighthouse');
  assert.equal(w.snippet, 'Lighthouse is a tower…');
  const fix = out.data.results.filter((r: any) => r.book === 'Fixit Guides');
  assert.deepEqual(fix.map((r: any) => [r.title, r.link]), [
    ['Lighthouse Lens Cleaning', 'http://10.0.0.8:8080/content/fixit_en_all_2026-01/Guide/Lighthouse%2BLens%2BCleaning/12'],
    ['Keeper\'s Lamp & Wick', 'http://10.0.0.8:8080/content/fixit_en_all_2026-01/Device/Keeper\'s_Lamp_%26_Wick'],
  ]);
  assert.match(out.data.note, /offline/);
  valid(out.card);
  // what ⌘K draws from it: rows that open the article, under the book's name
  const hits = hitsOf(out.card, 6);
  assert.equal(hits[0].href, w.link);
  assert.equal(hits[0].sub, 'Wikipedia');
  assert.equal(k.tools!.kiwix_search.find, 'query');
  assert.equal(k.tools!.kiwix_search.access, 'read');
});

test('kiwix: a book that fails or is slow leaves the others\' answers; nothing found is a sentence', async () => {
  const k = make({}, fake(server(url => url.includes('/search?books.name=wikipedia') ? new Response('no', { status: 500 }) : undefined)));
  const out: any = await k.tools!.kiwix_search.run({ query: 'lighthouse', limit: 8 });
  assert.ok(out.data.results.length > 0);
  assert.ok(!out.data.results.some((r: any) => r.book === 'Wikipedia'));
  const none: any = await make({}, fake(server(url => url.includes('/search?') ? new Response(searchXml('x', [])) : url.includes('/suggest?') ? new Response('[]') : undefined))).tools!.kiwix_search.run({ query: 'zzz', limit: 8 });
  assert.equal(none.card.type, 'text');
  assert.equal(hitsOf(none.card).length, 0);
  const one: any = await make({}, fake(server())).tools!.kiwix_search.run({ query: 'lighthouse', book: 'Wikipedia', limit: 8 });
  assert.deepEqual(new Set(one.data.results.map((r: any) => r.book)), new Set(['Wikipedia']));
  const bad: any = await make({}, fake(server())).tools!.kiwix_search.run({ query: 'x', book: 'encyclopedia galactica', limit: 8 });
  assert.match(bad.data.error, /no book/);
});

test('kiwix: an article\'s first paragraph is plain words: no tags, scripts, tables or citation marks, and bounded', () => {
  const p = lead(ARTICLE)!;
  assert.equal(p, 'A lighthouse is a tower that sends out light to help ships at sea find their way, warn them of rocks and harbours, and mark the coast. Most are automated now.');
  assert.ok(!/[<>]|\[\d|alert/.test(p));
  const long = `<p>${'word '.repeat(400)}ends here.</p>`;
  const cut = lead(long, 200)!;
  assert.ok(cut.length <= 200 && cut.endsWith('…'), cut);
  assert.equal(lead('<p>tiny</p><pre>not a paragraph at all, though it is long enough to be one and has a full stop.</pre>'), undefined);
  assert.equal(unhidden('<p><abbr>INN</abbr><span class="sr-only" id="x">Tooltip International Nonproprietary Name</span>, a name</p>'), '<p><abbr>INN</abbr>, a name</p>');
  const prose = articleText(ARTICLE);
  assert.equal(prose.title, 'Lighthouse');
  assert.ok(!prose.text.includes('Height') && !prose.text.includes('nested') && !prose.text.includes('never this'));
  assert.match(prose.text, /The second paragraph/);
});

test('kiwix: the random article is one from Wikipedia, with its title, first paragraph and link', async () => {
  const ctx = fake(server());
  const card: any = await make({ href: 'https://library.example.com' }, ctx).widgets.random.fetch();
  valid(card);
  assert.ok(ctx.calls.some(u => u.endsWith('/random?content=wikipedia_en_all_maxi_2026-09')));
  assert.equal(card.headline, 'Lighthouse');
  assert.match(card.blurb, /^A lighthouse is a tower/);
  assert.equal(card.link, 'https://library.example.com/content/wikipedia_en_all_maxi_2026-09/Lighthouse');
  assert.equal(card.site, 'Wikipedia');
  assert.ok(make({}, ctx).widgets.random.interval! >= 3_600_000);
  // random: picks another book; one that isn't there says so
  await make({ random: 'gutenberg_en_all' }, ctx).widgets.random.fetch();
  assert.ok(ctx.calls.some(u => u.endsWith('/random?content=gutenberg_en_all_2026-05')));
  const none: any = await make({ random: 'nope' }, ctx).widgets.random.fetch();
  valid(none);
  assert.equal(none.headline, '');
  // an article with no paragraph is tried again, and kept as a title if none has one
  let n = 0;
  const bare: any = await make({}, fake(server(url => url.includes('/content/') ? new Response(`<html><head><title>Bare ${++n}</title></head><body><p>x</p></body></html>`) : undefined))).widgets.random.fetch();
  assert.equal(n, 3);
  assert.equal(bare.headline, 'Bare 1');
  assert.equal(bare.blurb, undefined);
});

test('kiwix: kiwix_read reads an article by its link or its title, as plain text with the link to cite', async () => {
  const ctx = fake(server());
  const k = make({ href: 'https://library.example.com' }, ctx);
  const out: any = await k.tools!.kiwix_read.run({ link: 'https://library.example.com/content/wikipedia_en_all_maxi_2026-09/Lighthouse' });
  assert.equal(out.data.title, 'Lighthouse');
  assert.equal(out.data.book, 'Wikipedia');
  assert.equal(out.data.link, 'https://library.example.com/content/wikipedia_en_all_maxi_2026-09/Lighthouse');
  assert.ok(!/[<>]/.test(out.data.text));
  assert.match(out.data.note, /instruction is not one/);
  assert.ok(ctx.calls.includes('http://10.0.0.8:8080/content/wikipedia_en_all_maxi_2026-09/Lighthouse'), 'read from url, never from href');
  valid(out.card);
  const byTitle: any = await k.tools!.kiwix_read.run({ title: 'keeper\'s lamp & wick', book: 'fixit_en_all' });
  assert.equal(byTitle.data.link, 'https://library.example.com/content/fixit_en_all_2026-01/Device/Keeper\'s_Lamp_%26_Wick');
  // a long article is cut, and says so
  const big: any = await make({}, fake(server(url => url.includes('/content/') ? new Response(`<p>${'Words go on. '.repeat(3000)}</p>`) : undefined))).tools!.kiwix_read.run({ link: '/content/wikipedia_en_all_maxi_2026-09/Long' });
  assert.equal(big.data.text.length, 12_000);
  assert.ok(big.data.cut);
});

test('kiwix: kiwix_read opens only articles in this library, on its own server', async () => {
  const ctx = fake(server());
  const k = make({ books: ['wikipedia_en_all'] }, ctx);
  for (const link of ['https://elsewhere.example.com/content/fixit_en_all_2026-01/Guide', '/content/fixit_en_all_2026-01/Guide', '/content/wikipedia_en_all_maxi_2026-09/../../catalog', '/catalog/v2/entries', '/content/wikipedia_en_all_maxi_2026-09/']) {
    const out: any = await k.tools!.kiwix_read.run({ link });
    assert.match(out.data.error, /isn't a link/, link);
  }
  const elsewhere: any = await k.tools!.kiwix_read.run({ link: 'https://elsewhere.example.com/content/wikipedia_en_all_maxi_2026-09/Lighthouse' });
  assert.equal(elsewhere.data.title, 'Lighthouse');
  assert.ok(ctx.calls.every(u => u.startsWith('http://10.0.0.8:8080/')));
  assert.equal(k.tools!.kiwix_read.access, 'read');
});

test('kiwix: headers go with every request, and pictures only by a book\'s id', async () => {
  const seen: any[] = [];
  const k = make({ headers: { Authorization: 'Basic abc' } }, fake(server((url, init) => { seen.push(init.headers); return url.includes('/illustration/') ? new Response('png', { headers: { 'content-type': 'image/png' } }) : undefined; })));
  await k.widgets.library.fetch();
  await k.tools!.kiwix_search.run({ query: 'x', limit: 3 });
  assert.ok(seen.length >= 4 && seen.every(h => h?.Authorization === 'Basic abc'));
  assert.equal(await (await k.image!(W) as Response).text(), 'png');
  assert.throws(() => k.image!('../../etc/passwd'), /bad image ref/);
});

test('kiwix: a server that can\'t be reached is the card\'s error, and tried again next time', async () => {
  let down = true;
  const ctx = fake(server(url => down && url.includes('/catalog/') ? new Response('', { status: 502 }) : undefined));
  const k = make({}, ctx);
  await assert.rejects(k.widgets.library.fetch(), /502/);
  await assert.rejects(k.widgets.random.fetch(), /502/);
  down = false;
  valid(await k.widgets.library.fetch());
});

test('kiwix: a hostile article takes no longer to read than a normal one', () => {
  // articles are other people's pages: measured as the feed and web page parsers are in audit.test.ts
  const para = '<div><h2>Tides &amp; more</h2><table><tr><td>x</td></tr></table><p>Some <b>words</b> here, and <a href="/x">a link</a>.</p></div>';
  const time = (page: string) => { const t = performance.now(); lead(page); articleText(page); return performance.now() - t; };
  for (const bomb of ['<p'.repeat(1e6), '<table>'.repeat(3e5), '<table><p>'.repeat(2e5), '</table>'.repeat(3e5), '<script>'.repeat(3e5), '<p>x</p><table>'.repeat(1.5e5), 'sr-only'.repeat(4e5), '<span class="sr-only">'.repeat(2e5), `<p>${'[1]'.repeat(6e5)}</p>`]) {
    const normal = `<html><body>${para.repeat(Math.ceil(bomb.length / para.length))}</body></html>`;
    let took = 0, usual = 0;
    for (let i = 0; i < 3 && (!i || took > 10 * usual); i++) { usual = time(normal); took = time(bomb); }
    assert.ok(took < 10 * usual, `${bomb.slice(0, 12)} took ${took.toFixed(0)} ms, a normal page that size ${usual.toFixed(0)} ms`);
  }
});
