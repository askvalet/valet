// Frame-exact recorder for Valet's demo. The page runs on a virtual clock (stageshow's kit/clock.ts, bundled as
// vc.js): time only moves when we step it, 1/60 s per frame, and every frame is a full screenshot piped to ffmpeg.
// So there are no dropped or doubled frames, eased moves are exact, and a slow render can't stutter the video.
// Marks (frame number + element rects in CSS px) are written beside the clip for the film's camera.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const here = path.dirname(new URL(import.meta.url).pathname);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;       // cubic in-out
export const easeQ = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;          // quad in-out, for scrolls
const CURSOR = `(()=>{if(document.getElementById('__c'))return;const d=document.createElement('div');d.id='__c';d.style.cssText='position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 4px rgb(0 0 0/.45))';d.innerHTML='<svg viewBox="0 0 26 26" width="26" height="26"><path d="M5 3l15 11.2-6.6.9 3.9 7.2-3 1.6-3.8-7.3L5.6 20z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';document.documentElement.appendChild(d);window.__cm=(x,y,s)=>{d.style.transform='translate('+(x-5)+'px,'+(y-3)+'px) scale('+(s||1)+')';d.style.transformOrigin='5px 3px'}})()`;
const TAP = `(()=>{if(document.getElementById('__t'))return;const d=document.createElement('div');d.id='__t';d.style.cssText='position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgb(255 255 255/.34);box-shadow:0 0 0 1.5px rgb(255 255 255/.55);z-index:2147483647;pointer-events:none;opacity:0';document.documentElement.appendChild(d);window.__tap=(x,y,o,s)=>{d.style.left=x+'px';d.style.top=y+'px';d.style.opacity=o;d.style.transform='scale('+s+')'}})()`;

export async function start({ W = 1600, H = 900, dpr = 2, url, phone = false, dark = true, storage = {}, epoch = Date.parse('2026-11-05T17:18:00'), quality = 92, cursor = !phone, init = '' }) {
  const port = 9700 + Math.floor(Math.random() * 250), ud = path.join(os.tmpdir(), `vrec-${port}`);
  fs.rmSync(ud, { recursive: true, force: true });
  const chrome = spawn('google-chrome-stable', ['--headless=new', '--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=gl-egl', '--enable-gpu-rasterization', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', ...(phone ? [] : ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4']),
    `--user-data-dir=${ud}`, '--password-store=basic', `--window-size=${Math.ceil(W * dpr)},${Math.ceil(H * dpr)}`, `--remote-debugging-port=${port}`, 'about:blank'], { detached: true, stdio: 'ignore' });
  let target; for (let i = 0; i < 75 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch { } }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? { error: m.error }); pend.delete(m.id) } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  const js = e => send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }).then(r => { if (r.exceptionDetails) console.log('JSERR', e.slice(0, 80), r.exceptionDetails.exception?.description?.slice(0, 160)); return r.result?.value });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: phone });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'hover', value: phone ? 'none' : 'hover' }, { name: 'pointer', value: phone ? 'coarse' : 'fine' }] });
  const pre = `try{${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch{}`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(here, 'vc.js'), 'utf8') + `;__vc.installVirtualClock({fps:60,epoch:${epoch}});` + init + (storage && Object.keys(storage).length ? `if(location.href!=='about:blank'&&!sessionStorage.__pre){sessionStorage.__pre=1;${pre}}` : '') + (cursor ? `addEventListener('DOMContentLoaded',()=>{${CURSOR}})` : `addEventListener('DOMContentLoaded',()=>{${TAP}})`) });
  await send('Page.navigate', { url });
  await sleep(1500);
  const step = n => js(`window.__stageshow.clock.step(${n}).then(()=>1)`);

  // --- capture
  let fast = 1, ff = null, frames = 0, capture = false, clipName = '', marks = [], dir = '', total = 0;
  let region = null;
  const open = (out, { crf = 14, gop = 1, clip = null } = {}) => {
    region = clip ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 } : null; frames = 0; capture = true; marks = []; clipName = out; dir = path.dirname(out); fs.mkdirSync(dir, { recursive: true });
    ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-g', String(gop), '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  };
  const shut = async () => { capture = false; ff.stdin.end(); await new Promise(r => ff.on('close', r)); fs.writeFileSync(clipName.replace(/\.mp4$/, '.json'), JSON.stringify({ W, H, dpr, frames, marks }, null, 1)); console.log('clip', path.basename(clipName), frames, 'frames', (frames / 60).toFixed(2) + 's'); };
  const frame = async () => {
    await step(capture ? fast : 1); total++;
    if (!capture) return;
    const s = await send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true, ...(region ? { clip: region } : {}) });
    const b = Buffer.from(s.data, 'base64'); frames++;
    if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r));
  };
  const wait = async sec => { for (let i = 0, n = Math.round(sec * 60); i < n; i++) await frame() };
  const until = async (expr, max = 20, label = '') => { for (let i = 0; i < max * 60; i++) { if (await js(`!!(${expr})`)) return true; await frame() } console.log('TIMEOUT', label || expr.slice(0, 70)); return false };
  // rect of an element, CSS px in the viewport
  const rect = sel => js(`(()=>{const e=${sel};if(!e)return null;const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*10)/10)})()`);
  const mark = async (name, sels = {}) => { const m = { name, f: frames, t: +(frames / 60).toFixed(3) }; for (const [k, s] of Object.entries(sels)) m[k] = await rect(s); marks.push(m); console.log('MARK', name, m.f, JSON.stringify(m).slice(0, 160)); return m };

  // --- the pointer: drawn, eased, and real mouse events every frame so hover states follow it
  let cx = W * .55, cy = H * .6;
  const place = (s = 1) => js(`window.__cm&&__cm(${cx.toFixed(2)},${cy.toFixed(2)},${s})`);
  const mouse = (type, extra = {}) => send('Input.dispatchMouseEvent', { type, x: cx, y: cy, ...extra });
  const move = async (x, y, sec = .7) => { const x0 = cx, y0 = cy, n = Math.max(1, Math.round(sec * 60)); for (let i = 1; i <= n; i++) { const e = ease(i / n); cx = x0 + (x - x0) * e; cy = y0 + (y - y0) * e; await place(); await mouse('mouseMoved'); await frame() } };
  const center = async sel => { const r = await rect(sel); return r && [r[0] + r[2] / 2, r[1] + r[3] / 2, r] };
  const to = async (sel, sec = .7, dx = 0, dy = 0) => { const c = await center(sel); if (!c) { console.log('MISSING', sel.slice(0, 90)); return null } await move(c[0] + dx, c[1] + dy, sec); return c };
  const click = async () => { for (let i = 0; i < 5; i++) { await place(1 - i * .028); await frame() } await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 }); await frame(); await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 }); for (let i = 0; i < 5; i++) { await place(.86 + i * .028); await frame() } await place() };
  const press = async (sel, sec = .7) => { const c = await to(sel, sec); if (c) { await wait(.12); await click() } return c };
  // phone: a soft touch ring, then a real click on the element
  const tap = async sel => {
    const c = await center(sel); if (!c) { console.log('NOTAP', sel.slice(0, 90)); return null }
    for (let i = 0; i < 9; i++) { await js(`__tap(${c[0]},${c[1]},${(i / 8).toFixed(2)},${(1.25 - i * .03).toFixed(2)})`); await frame() }
    await js(`(()=>{const e=${sel};e.focus?.();e.click()})()`);
    for (let i = 0; i < 9; i++) { await js(`__tap(${c[0]},${c[1]},${(1 - i / 8).toFixed(2)},${(1 + i * .05).toFixed(2)})`); await frame() }
    return c;
  };
  // typing: one character every few frames, a little uneven like a person
  const type = async (text, per = 3) => { for (let i = 0; i < text.length; i++) { await send('Input.insertText', { text: text[i] }); const k = per + ((i * 7) % 3 === 0 ? 1 : 0); for (let j = 0; j < k; j++) await frame() } };
  const key = async (k, code = k, vk = 13, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: k === 'Enter' ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, text: k === 'Enter' ? '\r' : undefined }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }) };
  // eased scrolls of the window or any scroller, one exact step per frame. Browsers scroll in whole CSS pixels, which
  // makes an eased scroll stall at its ends and step unevenly in the middle; so the scroll takes the whole pixels and
  // a translate on the scrolled content carries the rest, on the device-pixel grid. Fixed layers (wallpaper, nav
  // bars) aren't moved. Both are put back exactly when the move ends.
  const SCROLLED = `[...document.querySelectorAll('body > div > .menubar, body > div > main')]`;
  const at = (y) => { const d = Math.round(y * dpr) / dpr, i = Math.floor(d + 1e-6); return [i, +(d - i).toFixed(4)] };
  const scrollWin = async (to, sec) => {
    const y0 = await js('scrollY'), n = Math.max(1, Math.round(sec * 60));
    for (let k = 1; k <= n; k++) { const [i, f] = at(y0 + (to - y0) * easeQ(k / n)); await js(`scrollTo(0,${i});for(const e of ${SCROLLED})e.style.translate=${f ? `'0 ${-f}px'` : `''`}`); await frame() }
    await js(`for(const e of ${SCROLLED})e.style.translate=''`);
  };
  const scrollerOf = sel => js(`(()=>{const e=${sel};if(!e)return false;let sc=e.parentElement;while(sc&&!(sc.scrollHeight>sc.clientHeight+20&&/auto|scroll/.test(getComputedStyle(sc).overflowY)))sc=sc.parentElement;window.__sc=sc;return !!sc})()`);
  // bring an element to `off` px below its scroller's top
  const lift = async (sel, off, sec = .8) => {
    if (!await scrollerOf(sel)) return;
    const d = await js(`Math.round((${sel}).getBoundingClientRect().top-__sc.getBoundingClientRect().top-${off})`);
    const y0 = await js('__sc.scrollTop'), max = await js('__sc.scrollHeight-__sc.clientHeight'), tgt = Math.max(0, Math.min(max, y0 + d)), n = Math.max(1, Math.round(sec * 60));
    for (let k = 1; k <= n; k++) { const [i, f] = at(y0 + (tgt - y0) * easeQ(k / n)); await js(`__sc.scrollTop=${i};for(const e of __sc.children)e.style.translate=${f ? `'0 ${-f}px'` : `''`}`); await frame() }
    await js(`for(const e of __sc.children)e.style.translate=''`);
  };
  // load every lazy image and let the page settle, off camera
  const warm = async () => {
    const h = await js('document.documentElement.scrollHeight');
    for (let y = 0; y < h; y += H * .6) { await js(`scrollTo(0,${y})`); await step(20) }
    await js('scrollTo(0,0)');
    for (let i = 0; i < 60; i++) { await step(10); if (await js(`[...document.images].filter(i=>i.loading!=='lazy'||i.getBoundingClientRect().top<innerHeight).every(i=>i.complete)`)) break; await sleep(60) }
    await step(90);
  };
  const imagesReady = () => js(`[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0}).every(i=>i.complete&&i.naturalWidth>0)`);
  const settle = async (max = 6) => { for (let i = 0; i < max * 10; i++) { if (await imagesReady()) break; await step(6); await sleep(40) } await step(6) };
  const setCursor = (x, y) => { cx = x; cy = y; return place() };
  return {
    W, H, send, js, step, open, shut, frame, wait, until, rect, mark, move, to, press, click, tap, type, key, scrollWin, lift, scrollerOf, warm, settle, imagesReady, setCursor, center,
    get frames() { return frames }, set fast(k) { fast = k }, get pos() { return [cx, cy] },
    async close() { ws.close(); try { process.kill(-chrome.pid, 'SIGKILL') } catch { } fs.rmSync(ud, { recursive: true, force: true }) },
  };
}
export const nav = n => `[...document.querySelectorAll('nav button, nav a')].find(b=>b.offsetParent&&(b.getAttribute('aria-label')||b.innerText.trim())===${JSON.stringify(n)})`;
export const btn = t => `[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.innerText.trim()===${JSON.stringify(t)}).at(-1)`;
export const field = `[...document.querySelectorAll('input,textarea')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height>0).at(-1)`;
export const card = title => `[...document.querySelectorAll('main [data-slot=card]')].find(c=>c.offsetParent&&(c.innerText||'').trim().split('\\n')[0].trim()===${JSON.stringify(title)})`;
export const cardHas = re => `[...document.querySelectorAll('main [data-slot=card]')].find(c=>c.offsetParent&&${re}.test(c.innerText||''))`;
export const says = t => `document.body.innerText.includes(${JSON.stringify(t)})`;
