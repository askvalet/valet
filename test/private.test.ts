// What the docs screenshots, the site's samples and the public demo are made from must not look like someone's own
// homelab. The screenshot step refuses a page with a 192.168 address or one of the owner's private words, but only at
// publish time, after a long build; this says so in `npm test`, at the line. Made-up homelabs use 10.0.0.x.
// PRIVATE_WORDS (comma-separated, set on the publishing machine, never in the repo) adds the owner's own words.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const SOURCES = ['src/web/samples.ts', 'website/samples', 'demo/config.yaml', 'demo/integrations'];
const forbidden = new RegExp(['192\\.168', ...(process.env.PRIVATE_WORDS?.split(',').map(w => w.trim()).filter(Boolean) ?? [])].join('|'), 'i');

function files(path: string): string[] {
  const full = join(root, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap(f => files(join(path, f))).filter(f => /\.(ts|tsx|mjs|js|json|ya?ml)$/.test(f));
}

test('samples and the demo use made-up addresses and none of the owner\'s private words', () => {
  const found: string[] = [];
  for (const file of SOURCES.flatMap(files)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => { const m = line.match(forbidden); if (m) found.push(`${relative(root, file)}:${i + 1}: "${m[0]}"`); });
  }
  assert.deepEqual(found, [], `use 10.0.0.x and made-up names in samples:\n${found.join('\n')}`);
});
