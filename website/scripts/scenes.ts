// The whole product, not one card: real Valet (the repo's own build) running the demo's config and its made-up homelab,
// with the demo's scripted model as the assistant. Nothing real is reachable: the only plugin is demo/integrations/homelab.mjs.
// The demo names real films and hot-links their posters, which is fine for a demo and wrong for documentation: here its
// copy gets invented titles, its pictures are drawn, and no request leaves 127.0.0.1.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { drawn, freePort } from './serve.ts';

const TITLES: Record<string, string> = {
  'Spider-Man: Brand New Day': 'The Long Tide', 'Dune: Part Two': 'Salt Road', 'The Bear': 'Night Kitchen', Arrival: 'First Light', Interstellar: 'Far Harbour', 'Blade Runner 2049': 'Rain City', Severance: 'Quiet Floor',
  'Spirited Away': 'The Paper Lantern', Andor: 'Northern Line', 'Shōgun': 'Iron Coast', 'The Grand Budapest Hotel': 'Hotel Meridian', Oppenheimer: 'The Last Winter',
};
const invented = (text: string) => Object.entries(TITLES).reduce((t, [real, made]) => t.replaceAll(real, made), text);

export async function scenes({ browser, root, repo, out, manifest, problems, stop, wanted, forbidden }: any) {
  const dir = resolve(root, '.cache/demo'), data = resolve(dir, 'data');
  if (!existsSync(resolve(repo, 'dist/server.js'))) throw new Error('Valet is not built: npm run shots builds it first');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(resolve(data, 'integrations'), { recursive: true });
  // pausing the downloads asks with a press and hold here, so the docs can show one: the demo has nothing dangerous to do
  writeFileSync(resolve(data, 'integrations/homelab.mjs'), invented(readFileSync(resolve(repo, 'demo/integrations/homelab.mjs'), 'utf8')).replace("title: 'Pause all downloads?',", "title: 'Pause all downloads?', danger: true,")
    // the same films under their new names, with no poster, so the demo draws one
    .replace(/^const ART = .*$/m, m => `${m}\nART.films = Object.fromEntries(Object.entries(ART.films).map(([k, v]) => [(${JSON.stringify(TITLES)})[k] ?? k, { year: v.year }]));`));
  cpSync(resolve(repo, 'demo/icons'), resolve(data, 'icons'), { recursive: true });
  const modelPort = await freePort(7730), port = await freePort(7760);
  // the demo's own model and config, on free ports, with the public host names taken out
  writeFileSync(resolve(dir, 'model.mjs'), invented(readFileSync(resolve(repo, 'demo/mock-model.mjs'), 'utf8')).replace(/if \(process\.argv\[1\].*server\.listen\(8080[^\n]*/, `server.listen(${modelPort}, '127.0.0.1');`));
  writeFileSync(resolve(dir, 'config.yaml'), readFileSync(resolve(repo, 'demo/config.yaml'), 'utf8')
    .replace(/^allowedHosts:.*$/m, 'allowedHosts: []').replace(/^notice:.*$/m, '').replace('http://valet-demo-model:8080/v1', `http://127.0.0.1:${modelPort}/v1`)
    .replace('/demo/wallpaper.jpg', resolve(repo, 'demo/wallpaper.jpg')).replace('type: demo-homelab', `type: demo-homelab\n    art: ${resolve(repo, 'demo/art/cameras')}`));
  const start = (args: string[], env = {}) => { const p = spawn('node', args, { cwd: repo, stdio: 'ignore', env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'America/Toronto', ...env } }); stop.push(() => { p.kill('SIGTERM'); }); return p; };
  start([resolve(dir, 'model.mjs')]);
  start(['dist/server.js'], { PORT: String(port), HOST: '127.0.0.1', VALET_CONFIG: resolve(dir, 'config.yaml'), VALET_DATA: data, NODE_ENV: 'production' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; ; i++) { try { if ((await fetch(`${url}healthz`)).ok) break; } catch { /* starting */ } if (i > 100) throw new Error('the demo did not start'); await sleep(200); }

  const make = async (width: number, height: number, mobile = false) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: mobile, hasTouch: mobile });
    await context.route('**/*', async (r: any) => {
      const u = new URL(r.request().url());
      if (u.hostname === '127.0.0.1' || u.protocol === 'data:') return r.continue();
      return r.request().resourceType() === 'image' ? r.fulfill({ body: drawn(u.pathname), contentType: 'image/svg+xml' }) : r.abort();
    });
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    return { context, page, cdp };
  };
  const shot = async (page: any, cdp: any, id: string, box?: any, pad = 16) => {
    if (!wanted(id)) return;
    const text = await page.evaluate(() => document.body.innerText);
    if (forbidden.test(text)) problems.push(`${id}: the page text has a forbidden word`);
    const view = page.viewportSize(), clip = box ? { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } : { x: 0, y: 0, width: view.width, height: view.height };
    const r = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 82, captureBeyondViewport: !!box, clip: { ...clip, scale: 2 } });
    const file = `${id}.webp`, to = resolve(out, file);
    mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, Buffer.from(r.data, 'base64'));
    manifest[id] = { id, file, w: Math.round(clip.width), h: Math.round(clip.height) };
  };
  const quiet = async (page: any, ms = 1500) => { await sleep(ms); await page.evaluate(async () => { const end = Date.now() + 4000; while (Date.now() < end && [...document.images].some(i => i.loading !== 'lazy' && !i.complete)) await new Promise(r => setTimeout(r, 60)); }); };
  const box = (page: any, sel: string) => page.locator(sel).first().boundingBox({ timeout: 4000 }).catch(() => null);
  /** the card around something: what a person would call "that card" */
  const cardOf = (page: any, sel: string) => page.locator(sel).first().evaluate((e: Element) => { const c = e.closest('[data-slot="card"]') ?? e; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; }).catch(() => null);
  const tab = async (page: any, name: string) => { await page.evaluate((h: string) => { location.hash = h; }, name.toLowerCase()); await quiet(page, 2500); };

  const desktop = await make(1440, 900);
  try {
    const { page, cdp } = desktop;
    await page.goto(url);
    await page.waitForSelector('#ask-box', { timeout: 15000 });
    await quiet(page, 4000);
    await shot(page, cdp, 'scene/overview');
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await shot(page, cdp, 'scene/overview-full', { x: 0, y: 0, width: 1440, height: full }, 0);

    for (const t of ['Services', 'AI', 'Media', 'Library']) { await tab(page, t); await shot(page, cdp, `scene/tab-${t.toLowerCase()}`); }
    await tab(page, 'Home');
    await shot(page, cdp, 'scene/tab-home');
    await page.evaluate(() => scrollTo(0, 0));
    const cardAt = (sel: string, n = 0) => page.locator(sel).nth(n).evaluate((e: Element) => { const c = e.closest('[data-slot="card"]') ?? e; const r = c.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }).catch(() => null);
    const cams = await cardAt('.cam-pill');
    if (cams) await shot(page, cdp, 'scene/cameras', cams);
    const house = await cardAt('.stage', 0);
    if (house) await shot(page, cdp, 'scene/house', house); else problems.push('scene/house: not found');
    const pc = await cardAt('.stage', 1);
    if (pc) await shot(page, cdp, 'scene/pc', pc); else problems.push('scene/pc: not found');

    // the palette
    await tab(page, 'Overview'); await page.goto(url); await page.waitForSelector('#ask-box'); await quiet(page, 2500);
    await page.keyboard.press('Control+k'); await sleep(900);
    await shot(page, cdp, 'scene/palette');
    await page.keyboard.type('re', { delay: 40 }); await sleep(600);
    await shot(page, cdp, 'scene/palette-search');
    await page.keyboard.press('Escape'); await sleep(400);

    // the island, closed then open
    const band = (height: number) => ({ x: 400, y: 0, width: 640, height });
    await shot(page, cdp, 'scene/island', band(84), 0);
    await page.locator('[class*="island"]').first().click({ timeout: 2000 }).catch(() => {}); await sleep(1400);
    await shot(page, cdp, 'scene/island-open', band(220), 0);
    await page.keyboard.press('Escape'); await page.mouse.click(700, 760); await sleep(500);

    // the assistant: an answer with a card, then an approval
    const ask = async (q: string) => { await page.fill('#ask-box', q); await page.keyboard.press('Enter'); };
    await ask('Is anything down?');
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 }); await sleep(6000);
    await shot(page, cdp, 'scene/chat');
    await page.fill('textarea[aria-label="Message"]', 'restart mealie'); await page.keyboard.press('Enter');
    await sleep(5000);
    await shot(page, cdp, 'scene/approval');
    const hold = await box(page, '.chat-card');
    if (hold) await shot(page, cdp, 'scene/approval-card', hold, 16);
    await page.getByRole('button', { name: /restart/i }).last().click(); await sleep(4000);
    await shot(page, cdp, 'scene/after-approval');
    await page.fill('textarea[aria-label="Message"]', 'pause downloads'); await page.keyboard.press('Enter');
    await sleep(4000);
    const risky = await page.locator('.chat-card').last().boundingBox({ timeout: 4000 }).catch(() => null);
    if (risky) await shot(page, cdp, 'scene/approval-danger', risky, 16); else problems.push('scene/approval-danger: no card');
    // a mouse holds; a touch screen presses twice. Whichever this browser counts as.
    const button = page.getByText(/^(Hold|Press twice) to pause$/).first(), press = await button.boundingBox({ timeout: 3000 }).catch(() => null);
    if (press) {
      await page.mouse.move(press.x + press.width / 2, press.y + press.height / 2); await page.mouse.down(); await sleep(420);
      await shot(page, cdp, 'scene/approval-holding', risky, 16);
      await page.mouse.move(10, 10); await page.mouse.up();
    } else problems.push('scene/approval-holding: no hold button');
  } finally { await desktop.context.close(); }

  const phone = await make(390, 844, true);
  try {
    const { page, cdp } = phone;
    await page.goto(url); await page.waitForSelector('#ask-box', { timeout: 15000 }); await quiet(page, 3500);
    await shot(page, cdp, 'scene/phone');
    await tab(page, 'Home'); await shot(page, cdp, 'scene/phone-home');
  } finally { await phone.context.close(); }

  const story = await make(1280, 720);
  try {
    const { page, cdp } = story;
    await page.addInitScript(() => { try { localStorage.setItem('valet-recap-hint', '1'); } catch { /* fine */ } });
    await page.goto(`${url}#recap`); await page.waitForSelector('.rc-ctl', { timeout: 20000 }); await sleep(800);
    await page.keyboard.press('p');
    await shot(page, cdp, 'scene/recap-open');
    for (let i = 1; i <= 8; i++) { await page.keyboard.press('ArrowRight'); await quiet(page, 1400); await shot(page, cdp, `scene/recap-${i}`); }
  } finally { await story.context.close(); }
}
