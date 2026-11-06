// Deterministic film: the page's virtual clock is stepped 1/60s per frame; each <video> seeks to match first.
//   node .tools/render.mjs <example> <out.mp4> [proofEvery]   (proofEvery > 1 = still frames into <out>-proof/)
import { spawn } from 'node:child_process'; import { mkdirSync, writeFileSync } from 'node:fs'
import { launch } from '../scripts/browser.mjs'
const [ex, out, nth = '1'] = process.argv.slice(2), N = +nth
const browser = await launch(); let ff
try {
  const ctx = await browser.newContext({ viewport: { width: 2100, height: 1500 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)) })
  await page.goto('http://127.0.0.1:7868/?embed=' + ex); await page.waitForSelector('.ss-stage')
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500)
  for (let i = 0; i < 240; i++) { const rs = await page.evaluate(() => [...document.querySelectorAll('video')].map(v => v.readyState + ':' + (v.error?.code ?? ''))); if (rs.every(x => +x[0] >= 2)) break; if (i % 20 === 0) console.log('videos', rs.join(' ')); await page.waitForTimeout(500) }
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))
  const cdp = await ctx.newCDPSession(page)
  const box = await page.evaluate(() => { const r = document.querySelector('.ss-stage').getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 } }); console.log(box)
  const dir = out + '-proof'; if (N > 1) mkdirSync(dir, { recursive: true }); else ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const t0 = Date.now(); const marks = []
  let last = null
  for (let i = 0; ; i++) {
    const r = await page.evaluate(async () => { const c = window.__stageshow.clock; await c.step(1); return { m: document.querySelector('.ss-stage').getAttribute('data-mark'), now: c.now() } })
    if (r.m !== last) { marks.push([r.m, i]); last = r.m }
    if (r.m === 'done') { console.log('done at frame', i, (i / 60).toFixed(2) + 's'); break }
    if (i % N) continue
    for (let t = 0; t < 600; t++) { if (!await page.evaluate(() => [...document.querySelectorAll('video')].some(v => v.seeking || (v.closest('[data-on]') && v.readyState < 2)))) break; await page.waitForTimeout(4) }
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: box, captureBeyondViewport: false })
    const buf = Buffer.from(data, 'base64')
    if (N > 1) writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.png`, buf); else if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
    if (i % 600 === 0) console.log('frame', i, ((Date.now() - t0) / 1000).toFixed(0) + 's')
  }
  writeFileSync(out.replace(/\.mp4$/, '') + '.marks.json', JSON.stringify(marks))
  if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)) }
} finally { await browser.close(); ff?.kill() }
