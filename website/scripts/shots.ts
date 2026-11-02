// Every screenshot on the site. Real renderers in a headless browser, made-up data, no network past 127.0.0.1 (the only
// exceptions are named in scenes.ts). Writes public/shots/ and public/shots/manifest.json.
//   npm run shots             everything
//   SHOTS=plex,gallery npm run shots   only what matches, for working on one thing (keeps the rest of the manifest)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { freePort, serve } from './serve.ts';
import { scenes } from './scenes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(root, '..'), out = resolve(root, 'public/shots');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', WORKERS = Number(process.env.SHOT_WORKERS ?? 4);
const only = process.env.SHOTS?.split(',').filter(Boolean);
const catalog = JSON.parse(readFileSync(resolve(root, '.cache/catalog.json'), 'utf8'));
const FORBIDDEN = /chotte|ibrahim|192\.168/i;

type Size = 'small' | 'wide' | 'medium' | 'tall' | 'large';
// medium first: when two sizes come out the same, the one kept should be the one most people use
const SIZES: Size[] = ['medium', 'large', 'tall', 'wide', 'small'];
export interface Entry { id: string; file: string; w: number; h: number; sameAs?: string }
const manifest: Record<string, Entry> = {};
const problems: string[] = [];
const wanted = (id: string) => !only || only.some(o => id.includes(o));
const manifestFile = resolve(out, 'manifest.json');
if (only && existsSync(manifestFile)) Object.assign(manifest, JSON.parse(readFileSync(manifestFile, 'utf8')));

/** A picture in the docs is named for what it shows, so a sentence can ask for it by name. */
const fileOf = (id: string) => `${id.replace(/[^a-zA-Z0-9/_.-]+/g, '-')}.webp`;

async function capture(page: Page, cdp: any, id: string, box: { x: number; y: number; width: number; height: number }) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 82, captureBeyondViewport: true, clip: { ...box, scale: 2 } });
  const file = fileOf(id), bytes = Buffer.from(r.data, 'base64'), to = resolve(out, file);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, bytes);
  return { file, w: Math.round(box.width), h: Math.round(box.height), bytes };
}

const settle = (page: Page) => page.evaluate(async () => {
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await document.fonts.ready;
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    const waiting = [...document.images].some(i => !i.complete) || document.querySelector('[data-slot="skeleton"]');
    if (!waiting) break;
    await new Promise(r => setTimeout(r, 40));
  }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
});
/** Where each thing inside the card sits and what it says: the same answer means only empty space changed. */
const signature = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('[data-shot]')!, o = root.getBoundingClientRect();
  const leaves = [...root.querySelectorAll('*')].filter(e => !e.children.length || ['svg', 'CANVAS', 'IMG'].includes(e.tagName));
  return JSON.stringify([o.width, leaves.map(e => { const r = e.getBoundingClientRect(); return [e.tagName, Math.round(r.x - o.x), Math.round(r.y - o.y), Math.round(r.width), Math.round(r.height), (e.textContent ?? '').slice(0, 60)]; })]);
});
const PAD = 16;
async function element(page: Page, cdp: any, id: string, spec: any, sig = false) {
  await page.evaluate(s => (window as any).show(s), { key: id, ...spec });
  await settle(page);
  const found = await page.evaluate(() => {
    const el = document.querySelector('[data-shot]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, text: (el as HTMLElement).innerText };
  });
  if (!found || found.height < 8) { problems.push(`${id}: nothing rendered`); return null; }
  if (FORBIDDEN.test(found.text)) problems.push(`${id}: the page text has a forbidden word`);
  const signed = sig ? await signature(page) : '';
  const box = { x: Math.max(0, found.x - PAD), y: Math.max(0, found.y - PAD), width: found.width + PAD * 2, height: found.height + PAD * 2 };
  return { box, signed };
}

interface Job { id: string; run(page: Page, cdp: any): Promise<void> }
const jobs: Job[] = [];

/** A card at every size, skipping one that only adds empty space, with the skip on record for the page to say so. */
function sized(base: string, card: any, sizes: Size[] = SIZES) {
  jobs.push({ id: base, async run(page, cdp) {
    const seen: { size: Size; sig: string; hash: string }[] = [];
    for (const size of sizes) {
      const id = `${base}-${size}`;
      if (!wanted(id)) continue;
      const got = await element(page, cdp, id, { mode: 'size', card, size }, true);
      if (!got) continue;
      const same = seen.find(s => s.sig === got.signed);
      if (same) { manifest[id] = { id, file: '', w: 0, h: 0, sameAs: `${base}-${same.size}` }; continue; }
      const shot = await capture(page, cdp, id, got.box);
      const digest = createHash('sha1').update(shot.bytes).digest('hex'), twin = seen.find(s => s.hash === digest);
      if (twin) { rmSync(resolve(out, shot.file), { force: true }); manifest[id] = { id, file: '', w: 0, h: 0, sameAs: `${base}-${twin.size}` }; continue; }
      seen.push({ size, sig: got.signed, hash: digest });
      manifest[id] = { id, file: shot.file, w: shot.w, h: shot.h };
    }
  } });
}
function one(id: string, spec: any) {
  jobs.push({ id, async run(page, cdp) {
    if (!wanted(id)) return;
    const got = await element(page, cdp, id, spec);
    if (!got) return;
    const shot = await capture(page, cdp, id, got.box);
    manifest[id] = { id, file: shot.file, w: shot.w, h: shot.h };
  } });
}
/** One slide of the year in review, in the real story, full screen. */
function slide(id: string, slides: any[], at: number) {
  jobs.push({ id, async run(page, cdp) {
    if (!wanted(id)) return;
    await page.setViewportSize({ width: 1280, height: 720 });
        await page.evaluate(s => (window as any).show(s), { mode: 'recap', key: id, recap: { year: new Date().getFullYear(), soFar: true, slides, persona: { name: 'The curator', line: 'Everything in its place.' }, stats: [], wall: [] } });
    await page.waitForSelector('.rc', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.rc-ctl'), undefined, { timeout: 5000 });
    await page.keyboard.press('p');                 // stop the timer: this is one slide, held
    for (let i = 0; i <= at; i++) await page.keyboard.press('ArrowRight');
    await settle(page);
    const text = await page.evaluate(() => document.body.innerText);
    if (FORBIDDEN.test(text)) problems.push(`${id}: the slide has a forbidden word`);
    const shot = await capture(page, cdp, id, { x: 0, y: 0, width: 1280, height: 720 });
    manifest[id] = { id, file: shot.file, w: shot.w, h: shot.h };
    await page.setViewportSize({ width: 1400, height: 1000 });
  } });
}

// the integrations: each widget at each size, then its other states at the size most people use
for (const it of catalog.integrations) {
  it.widgets.forEach((w: any) => {
    const base = `int/${it.type}/${w.key}`;
    for (const c of w.cards) {
      if (c.state === 'normal') { sized(base, c.card); one(`${base}-chat`, { mode: 'chat', card: c.card }); }
      else if (c.error) one(`${base}-${c.state}`, { mode: 'failed', title: w.title, error: c.error });
      else one(`${base}-${c.state}`, { mode: 'size', size: 'medium', card: c.card });
    }
  });
  (it.recap ?? []).forEach((_: any, i: number) => slide(`int/${it.type}/recap-${i}`, it.recap, i));
}
// the card gallery: every sample, in every size and in chat, then in the light theme
for (const g of catalog.gallery) {
  const base = `card/${g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  sized(base, g.card);
  one(`${base}-chat`, { mode: 'chat', card: g.card });
  one(`${base}-light`, { mode: 'size', size: 'medium', theme: 'light', card: g.card });
  if (g.card.summary) one(`${base}-ring`, { mode: 'ring', card: g.card });
}

async function worker(context: BrowserContext, url: string, list: Job[]) {
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).ready);
  while (list.length) {
    const job = list.shift()!;
    try { await job.run(page, cdp); }
    catch (e) { problems.push(`${job.id}: ${(e as Error).message.split('\n')[0]}`); await page.goto(url).catch(() => {}); await page.waitForFunction(() => (window as any).ready).catch(() => {}); }
    if ((total - list.length) % 100 === 0) console.log(`  ${total - list.length} of ${total}`);
  }
  await page.close();
}

let browser: Browser | undefined, total = 0;
const port = await freePort(7700);
const server = await serve(root, repo, port);
const url = `http://127.0.0.1:${port}/`;
const stopDemo: (() => Promise<void> | void)[] = [];
try {
  if (!only) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
  // nothing leaves this machine from a harness page
  await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' || r.request().url().startsWith('data:') ? r.continue() : r.abort());
  const list = jobs.filter(j => !only || only.some(o => j.id.includes(o)) || j.id.startsWith('int/') && only.some(o => j.id.split('/')[1].includes(o)));
  total = list.length;
  console.log(`shots: ${total} jobs, ${WORKERS} at a time`);
  await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(total, 1)) }, () => worker(context, url, list)));
  await context.close();
  if (!only || only.includes('scenes') || only.some(o => o.startsWith('scene/'))) await scenes({ browser, root, repo, out, manifest, problems, stop: stopDemo, wanted: id => !only || only.includes('scenes') || wanted(id), forbidden: FORBIDDEN });
} finally {
  for (const s of stopDemo) await s();
  await browser?.close().catch(() => {});
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 0));
const entries = Object.values(manifest), kept = entries.filter(e => e.file);
const size = kept.reduce((n, e) => { try { return n + readFileSync(resolve(out, e.file)).length; } catch { problems.push(`${e.id}: its file is missing`); return n; } }, 0);
console.log(`shots: ${kept.length} pictures, ${entries.length - kept.length} sizes skipped as identical, ${(size / 1048576).toFixed(1)} MB`);
if (problems.length) { console.error(`\n${problems.length} problems:\n${problems.slice(0, 80).map(p => `  ${p}`).join('\n')}`); process.exitCode = 1; }
