// config-live: edits to config.yaml land on the page as each line is saved. A real server (reload on) watches the
// file; a small overlay shows the line being changed, since the editor isn't on screen.
//   node cfglive.mjs <outDir> <config.yaml> <lake.jpg>
import fs from 'node:fs';
import { start, sleep } from './vrec.mjs';
const [out, cfg, lake] = process.argv.slice(2);
const orig = fs.readFileSync(cfg, 'utf8');
const p = await start({ url: 'http://127.0.0.1:7867/', W: 1312, H: 860, dpr: 1.25 });
try {
  for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
  await p.warm(); await p.settle();
  await p.js(`(()=>{const d=document.createElement('div');d.id='__cfg';d.style.cssText='position:fixed;left:50%;bottom:28px;translate:-50% 0;z-index:2147483646;display:flex;align-items:center;gap:14px;padding:12px 20px 12px 16px;border-radius:16px;background:rgb(12 12 16/.82);backdrop-filter:blur(18px);border:1px solid rgb(255 255 255/.16);box-shadow:0 18px 40px -12px rgb(0 0 0/.7);font:500 19px/1.2 ui-monospace,Menlo,monospace;color:#e8eaed;white-space:pre;opacity:0;transition:opacity .3s';d.innerHTML='<span style="font:600 13px system-ui;letter-spacing:.02em;color:rgb(255 255 255/.55);padding:4px 8px;border-radius:7px;background:rgb(255 255 255/.08)">config.yaml</span><span id="__cfgt"></span><span id="__cfgs" style="font:600 14px system-ui;color:#6de38a;opacity:0;transition:opacity .25s">Saved</span>';document.documentElement.appendChild(d);window.__cfg=(t,o,s)=>{document.getElementById('__cfgt').textContent=t;d.style.opacity=o;document.getElementById('__cfgs').style.opacity=s?1:0}})()`);
  await p.js(`window.__bgs=()=>[...document.querySelectorAll('body *')].map(e=>getComputedStyle(e).backgroundImage).filter(b=>b.includes('url')).join('|');window.__bg0=__bgs()`);
  console.log('bg0', (await p.js('__bg0')).slice(0, 200));
  await p.setCursor(1400, 1000);
  let text = orig;
  // type the new value over the old one, save, and wait for the page to show it
  const edit = async (key, before, after, done, settle = 1.6, value = after, max = 10) => {
    await p.js(`__cfg(${JSON.stringify(key + before)},1,0)`); await p.wait(.7);
    for (let i = before.length; i >= 0; i--) { await p.js(`__cfg(${JSON.stringify(key + before.slice(0, i))},1,0)`); await p.frame() }
    for (let i = 1; i <= after.length; i++) { await p.js(`__cfg(${JSON.stringify(key + after.slice(0, i))},1,0)`); for (let j = 0; j < 4; j++) await p.frame() }
    await p.wait(.3);
    text = text.replace(new RegExp('^(\\s*' + key.trim() + ' ).*$', 'm'), (_, k) => k + value); fs.writeFileSync(cfg, text);
    await p.js(`__cfg(${JSON.stringify(key + after)},1,1)`);
    for (let i = 0; i < max * 60; i++) { await p.frame(); if (i % 6 === 0) { await sleep(30); if (await p.js(`!!(${done})`)) break } }
    await p.settle(); await p.wait(settle);
  };
  p.open(`${out}/config.mp4`, { crf: 12 });
  await p.wait(1);
  await edit('greeting: ', 'Daniel', 'Sam', `document.body.innerText.includes("Sam's homelab")`);
  await edit('wallpaper: ', 'walls/mountains.jpg', 'walls/lake.jpg', 'false', 1.2, lake, 2.4);
  await edit('  dim: ', '0.3', '0.6', 'false', 1.4, '0.6', 1.2);
  await p.js(`__cfg('',0,0)`); await p.wait(.6);
  await p.shut();
} finally { fs.writeFileSync(cfg, orig); await p.close() }
process.exit(0);
