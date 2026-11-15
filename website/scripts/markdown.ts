// The Markdown copy of each page (page.md, for agents: the Copy and Open buttons, and fetching it directly) is the page's
// source, cleaned by starlight-page-actions. What it leaves is ours: the screenshot components (Sizes, Shot, Row), the
// div around option tables, and escaped braces. They mean nothing outside the site, so they go here, after the build.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.md') ? [p] : []; });

let n = 0;
for (const file of files(dist)) {
  const before = readFileSync(file, 'utf8');
  const after = before
    .replace(/^[ \t]*<\/?(Sizes|Shot|Row)\b[^>]*?\/?>[ \t]*\n/gm, '')   // a whole line that's only one of them
    .replace(/<(Sizes|Shot)\b[^>]*?\/>/g, '')                            // and any left inside a line
    .replace(/^[ \t]*<\/?div\b[^>]*>[ \t]*\n/gm, '')
    .replace(/&#123;/g, '{').replace(/&#125;/g, '}')
    .replace(/\n{3,}/g, '\n\n');
  if (after !== before) { writeFileSync(file, after); n++; }
}
console.log(`markdown: cleaned ${n} of ${files(dist).length} pages`);
