// The design tokens (AGENTS.md, "Design tokens"): every one the components name is in styles.css, and `cn` knows them, so a
// colour class written after a size token doesn't knock the size out as if both were colours.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { cn } from '../src/web/lib/utils.ts';
import { inkFix } from '../src/web/icon-ink.ts';

const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
const TEXT = ['caption', 'meta', 'body', 'item', 'title', 'metric-s', 'metric-m', 'metric-l'];
const RADIUS = ['surface', 'popover', 'control', 'inset', 'chip', 'tag', 'thumb', 'poster', 'hero'];

test('every token is defined', () => {
  for (const t of TEXT) assert.match(css, new RegExp(`--text-${t}:`), t);
  for (const r of RADIUS) assert.match(css, new RegExp(`--radius-${r}:`), r);
  for (const f of ['--meeting:', '--precip:', '--color-meeting:', '--color-precip:', '--fill-1:', '--fill-2:', '--fill-3:', '--color-fill-1:', '--spacing-icon:', '--spacing-icon-sm:', '--spacing-icon-lg:', '--spacing-inset:', '--spacing-inset-tight:']) assert.ok(css.includes(f), f);
});

test('cn keeps a size token beside a colour', () => {
  for (const t of TEXT) assert.equal(cn(`text-${t}`, 'text-muted-foreground'), `text-${t} text-muted-foreground`);
  assert.equal(cn('text-meta', 'text-body'), 'text-body');
  assert.equal(cn('rounded-sm', 'rounded-chip'), 'rounded-chip');
  assert.equal(cn('size-4', 'size-icon-lg'), 'size-icon-lg');
  assert.equal(cn('bg-fill-1', 'bg-primary'), 'bg-primary');
  assert.equal(cn('text-caption', 'text-precip'), 'text-caption text-precip');
});

test('one radius scale, in order', () => {
  const k = (n: string) => Number(css.match(new RegExp(`--radius-${n}: calc\\(var\\(--radius\\) \\* ([\\d.]+)\\)`))?.[1] ?? (n === 'lg' ? 1 : NaN));
  const steps = ['sm', 'md', 'lg', 'xl', '2xl', '3xl'].map(k);
  assert.deepEqual([...steps].sort((a, b) => a - b), steps);
});

test('a service icon that would vanish on the glass is turned to the ink, or plated when it has colours', () => {
  const fill = (rgb: number[], n = 64) => new Uint8ClampedArray(Array.from({ length: n }, () => [...rgb, 255]).flat());
  assert.deepEqual(inkFix(fill([255, 255, 255])), { light: 'invert', dark: '' });     // a white logo (Karakeep)
  assert.deepEqual(inkFix(fill([0, 0, 0])), { light: '', dark: 'invert' });           // a black one (Miniflux)
  assert.deepEqual(inkFix(fill([200, 245, 215])), { light: 'plate', dark: '' });      // pale, but coloured (Uptime Kuma)
  assert.deepEqual(inkFix(fill([30, 120, 230])), { light: '', dark: '' });            // reads on both
  assert.deepEqual(inkFix(new Uint8ClampedArray(16)), { light: '', dark: '' });       // nothing to see
});
