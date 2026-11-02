// What has to be true of a finished site, or the build fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dist = join(root, 'dist'), shots = join(root, 'public/shots');
const catalog = JSON.parse(readFileSync(join(root, '.cache/catalog.json'), 'utf8')), manifest = JSON.parse(readFileSync(join(shots, 'manifest.json'), 'utf8'));
const fail: string[] = [];
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const base = (process.env.BASE_PATH ?? '/').replace(/^\/|\/$/g, '');
const built = (rel: string) => join(dist, rel);

// 1. every registered integration has a page and at least one real screenshot; every widget has one too
let flagged = 0;
for (const it of catalog.integrations) {
  if (!existsSync(built(`integrations/${it.type}/index.html`))) fail.push(`${it.type}: no page`);
  const own = Object.values<any>(manifest).filter(e => e.file && e.id.startsWith(`int/${it.type}/`) && existsSync(join(shots, e.file)) && statSync(join(shots, e.file)).size > 500);
  if (!own.length) { fail.push(`${it.type}: no screenshot`); flagged++; }
  for (const w of it.widgets) if (!own.some(e => e.id.startsWith(`int/${it.type}/${w.key}-`))) fail.push(`${it.type}.${w.key}: no screenshot of this widget`);
  for (const p of it.problems ?? []) fail.push(`${it.type}: ${p}`);
}
for (const g of catalog.gallery) { const b = `card/${g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`; if (!Object.values<any>(manifest).some(e => e.file && e.id.startsWith(`${b}-`))) fail.push(`card sample ${g.name}: no screenshot`); }

// 2. nothing of the owner's: words anywhere in the output. The one exception is the project's own public address.
// PRIVATE_WORDS: a comma-separated list, kept out of the repo, of anything that must never reach the site
const WORDS = new RegExp(['192\\.168', ...(process.env.PRIVATE_WORDS?.split(',') ?? [])].join('|'), 'i');
const text = (f: string) => /\.(html|js|mjs|css|json|txt|xml|svg|md|mdx)$/.test(f);
const scan = [...walk(dist).filter(text), ...walk(join(root, 'src/content/docs')), join(root, '.cache/catalog.json')];
for (const f of scan) { const m = WORDS.exec(readFileSync(f, 'utf8')); if (m) fail.push(`${f.replace(root, '')}: has "${m[0]}"`); }

// 3. works offline: no script, style, font or image from anywhere else
for (const f of walk(dist).filter(f => extname(f) === '.html')) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<(script|link|img|iframe|source)\b[^>]*?\b(?:src|href)=["']?(https?:)?\/\/[^"'\s>]+/gi)) if (!/rel=["']?(canonical|sitemap|me)/.test(m[0])) fail.push(`${f.replace(dist, '')}: loads ${m[0].slice(0, 100)}`);
}
for (const f of walk(dist).filter(f => extname(f) === '.css')) { const m = /url\(\s*["']?https?:[^)]*\)/.exec(readFileSync(f, 'utf8')); if (m) fail.push(`${f.replace(dist, '')}: loads ${m[0]}`); }

// 4. search is there
if (!existsSync(built('pagefind/pagefind.js'))) fail.push('no search index');

const pages = walk(dist).filter(f => f.endsWith('index.html')).length, pics = Object.values<any>(manifest).filter(e => e.file);
const bytes = pics.reduce((n, e) => n + statSync(join(shots, e.file)).size, 0);
console.log(`check: ${pages} pages, ${catalog.integrations.length} integrations, ${pics.length} screenshots, ${(bytes / 1048576).toFixed(1)} MB${base ? ` under /${base}/` : ''}`);
if (fail.length) { console.error(`\ncheck failed, ${fail.length} problems:\n${fail.slice(0, 60).map(f => `  ${f}`).join('\n')}`); process.exit(1); }
console.log('check: all good');
