// In MDX, {word} in prose is a JavaScript expression, so `"add {text} to {name}"` written as plain text breaks the docs
// build ("text is not defined"), and only on publish. Phrases with slots go in `code`. This finds one in npm test.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const docs = join(import.meta.dirname, '..', 'website', 'src', 'content', 'docs');
const mdx = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? mdx(p) : p.endsWith('.mdx') ? [p] : []; });

test('docs prose has no bare {word}, which MDX would run as code', () => {
  const found: string[] = [];
  for (const file of mdx(docs)) {
    let fence = false;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('```')) { fence = !fence; return; }
      if (fence || /^\s*(import|export)\s/.test(line)) return;
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\{([a-zA-Z_]\w*)\}/g)) found.push(`${relative(docs, file)}:${i + 1}: {${m[1]}}`);
    });
  }
  assert.deepEqual(found, [], `put these in \`code\`:\n${found.join('\n')}`);
});
