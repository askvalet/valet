// Valet's own docs as words: split into sections, searched, and named the way the docs site names them. The server reads
// the files (src/server/guide.ts); this part holds no file system, so the static demo can search the same way in a tab.

/** Where the docs live. A path from `findDocs` goes after it. */
export const DOCS_SITE = 'https://askvalet.dev';

export type Part = { page: string; title: string; heading: string; text: string; anchor?: string };
export type Page = { page: string; title: string; text: string };
/** What the palette is given for one docs result: no more of the page than a line of it. */
export type DocHit = { title: string; path: string; heading?: string; anchor?: string; snippet?: string };
export type DocIndex = { parts: Part[]; integrations: { type: string; name: string }[] };

/** The words of a Markdown or MDX page: frontmatter, imports and components come out, tables and code stay. */
export function plain(source: string) {
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  const title = front?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const body = (front ? source.slice(front[0].length) : source).split('\n')
    .filter(l => !/^(import|export) /.test(l) && !/^\s*<\/?[A-Z]\w*[^>]*>\s*$/.test(l)).join('\n').trim();
  return { title: title ?? body.match(/^# (.+)$/m)?.[1] ?? '', text: body };
}

/** A heading as its text: what Markdown draws, without the marks. */
const unmark = (h: string) => h.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\*\*|__/g, '').trim();
/** A heading's id as the docs site makes it (github-slugger): lower case, punctuation out, every space a hyphen. */
export const slug = (h: string) => unmark(h).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');

/** One entry for each `## heading`, so a search can answer with the part that matters rather than a whole page. Each
 *  carries the heading's id on the site, counted as the site counts them, so a second "Example" is `example-1`. */
export function sections(page: Page): Part[] {
  const parts: Part[] = [], seen = new Map<string, number>();
  let heading = page.title, anchor: string | undefined, lines: string[] = [];
  const flush = () => { const text = lines.join('\n').trim(); if (text) parts.push({ page: page.page, title: page.title, heading, text, ...anchor ? { anchor } : {} }); lines = []; };
  const id = (h: string) => { const base = slug(h); let s = base; while (seen.has(s)) { const n = seen.get(base)! + 1; seen.set(base, n); s = `${base}-${n}`; } seen.set(s, 0); return s; };
  let fenced = false;
  for (const l of page.text.split('\n')) {
    if (l.startsWith('```')) fenced = !fenced;
    const any = !fenced && l.match(/^(#{1,6}) (.+)$/);
    if (any && any[1].length <= 3) { flush(); heading = unmark(any[2]); anchor = id(any[2]); continue; }
    if (any) id(any[2]);
    lines.push(l);
  }
  flush();
  return parts;
}

const wordsOf = (q: string) => q.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(w => w.length > 2);

/** Best sections first: words in a heading count most, and every word of the question has to pull its weight. */
export function search(parts: Part[], query: string, limit = 5) {
  const words = wordsOf(query);
  const scored = parts.map(p => {
    const head = `${p.title} ${p.heading}`.toLowerCase(), body = p.text.toLowerCase();
    let score = 0, hit = 0;
    for (const w of words) {
      const n = body.split(w).length - 1, top = head.includes(w);
      if (n || top) hit++;
      score += (top ? 6 : 0) + Math.min(n, 5);
    }
    return { p, score: score * (hit / (words.length || 1)) };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.p);
}

/** Where a page of the index is on the site. `docs/configuration` is the reference's source; other `docs/` files aren't pages. */
export function pathOf(page: string) {
  if (page === 'docs/configuration') return 'reference/configuration/';
  if (!page.startsWith('guide/')) return undefined;
  const p = page.slice(6).replace(/(^|\/)index$/, '');
  return p ? `${p}/` : '';
}

// what "docs" or "help" alone offers: the front door and the pages people come back to
const KEY: DocHit[] = [
  { title: 'Valet docs', path: '' }, { title: 'Install', path: 'start/install/' }, { title: 'Configuration reference', path: 'reference/configuration/' },
  { title: 'Integrations', path: 'integrations/' }, { title: 'Security', path: 'security/' },
];
const ASKS = /^(docs?|documentation|help|manual|guide)$/;

/** A line of the section, from the first word that matched, in plain words. */
function snippet(text: string, words: string[]) {
  const flat = text.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_|>#]|:::\w*(\[[^\]]*\])?/g, '').replace(/\s+/g, ' ').trim();
  const i = Math.min(...words.map(w => flat.toLowerCase().indexOf(w)).filter(i => i >= 0), Infinity);
  const at = i === Infinity || i < 40 ? 0 : flat.lastIndexOf(' ', i - 30) + 1;
  const s = flat.slice(at, at + 110);
  return (at ? '…' : '') + s + (at + 110 < flat.length ? '…' : '');
}

/** The palette's docs results, at most `limit`: an integration's page by its name, then pages whose title matches, then
 *  sections whose heading does, then what only the words of a section match. "docs" alone offers the key pages. */
export function findDocs(index: DocIndex, query: string, limit = 5): DocHit[] {
  const all = query.toLowerCase().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 6);
  const words = all.filter(w => !ASKS.test(w));
  if (!words.length) return all.length ? KEY.slice(0, limit) : [];
  const out: DocHit[] = [], have = new Set<string>(), perPage = new Map<string, number>();
  const add = (h: DocHit) => {
    const key = `${h.path}#${h.anchor ?? ''}`, n = perPage.get(h.path) ?? 0;
    if (have.has(key) || n >= 2 || out.length >= limit) return;
    have.add(key); perPage.set(h.path, n + 1); out.push(h);
  };
  // 2 when every word is a whole word of the text, 1 when each only starts one, 0 when one doesn't
  const fit = (text: string) => { const ws = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const is = (w: string, x: string) => x === w || x === w.replace(/e?s$/, '');   // "backups" is the "Backup" page
    return words.every(w => ws.some(x => is(w, x))) ? 2 : words.every(w => ws.some(x => x.startsWith(w))) ? 1 : 0; };
  const parts = index.parts.map(p => ({ p, path: pathOf(p.page) })).filter((x): x is { p: Part; path: string } => x.path !== undefined);
  const section = (x: { p: Part; path: string }): DocHit => ({ title: x.p.title, path: x.path, ...x.p.anchor && x.path !== 'reference/configuration/' ? { heading: x.p.heading, anchor: x.p.anchor } : x.p.heading !== x.p.title ? { heading: x.p.heading } : {}, snippet: snippet(x.p.text, words) });
  // by name first: an integration's page, then a page's title, then a heading, whole words before beginnings
  const named: { hit: DocHit; rank: number }[] = [], firsts = new Set<string>();
  for (const i of index.integrations) { const f = fit(`${i.name} ${i.type}`); if (f) named.push({ hit: { title: `${i.name} docs`, path: `integrations/${i.type}/` }, rank: f * 10 + 3 }); }
  for (const x of parts) {
    if (!firsts.has(x.path)) { firsts.add(x.path); const f = fit(x.p.title); if (f) named.push({ hit: { title: x.p.title, path: x.path, snippet: snippet(x.p.text, words) }, rank: f * 10 + 2 }); }
    if (x.p.heading !== x.p.title) { const f = fit(x.p.heading); if (f) named.push({ hit: section(x), rank: f * 10 + 1 }); }
  }
  for (const n of named.sort((a, b) => b.rank - a.rank)) add(n.hit);
  if (out.length < limit && wordsOf(words.join(' ')).length) {
    const byPart = new Map(parts.map(x => [x.p, x]));
    for (const p of search(parts.map(x => x.p), words.join(' '), limit * 3)) add(section(byPart.get(p)!));
  }
  return out;
}
