// Card stills for the "185 integrations" reel: each card alone at 2x, liquid glass, dark
import { start, sleep } from './vrec.mjs'; import fs from 'node:fs';
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const url = process.argv[3] || 'http://localhost:7863/';
const p = await start({ url, W: 1600, H: 900, dpr: 2, cursor: false });
const run = async n => { for (let i = 0; i < n; i++) { await p.step(10); await sleep(25) } };
for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
await p.js(`localStorage.setItem('valet-glass','liquid');document.documentElement.classList.add('glass-liquid')`); await run(30);
const LIST = [
  ['Overview', 'Now playing', 'plex', 'Plex', 'plex'], ['Overview', 'Home Assistant', 'homeassistant', 'Home Assistant', 'home-assistant'],
  ['Home', 'Cameras', 'frigate', 'Frigate', 'frigate'], ['Overview', 'On this day', 'immich', 'Immich', 'immich'],
  ['Overview', 'Pi-hole', 'pihole', 'Pi-hole', 'pi-hole'], ['Overview', 'Downloading', 'qbittorrent', 'qBittorrent', 'qbittorrent'],
  ['Media', 'The year so far', 'tautulli', 'Tautulli', 'tautulli'], ['Media', 'Games', 'romm', 'RomM', 'romm'],
  ['Home', 'Mealie', 'mealie', 'Mealie', 'mealie'], ['Library', 'Recent documents', 'paperless', 'Paperless', 'paperless'],
  ['Library', 'Books', 'audiobookshelf', 'Audiobookshelf', 'audiobookshelf'], ['Services', 'Containers', 'docker', 'Docker', 'docker'],
  ['Home', 'Watching', 'changedetection', 'changedetection.io', 'changedetection'], ['Media', 'Most played', 'navidrome', 'Navidrome', 'navidrome'],
  ['Library', 'Hacker News', 'hackernews', 'Hacker News', 'hacker-news'],
];
const meta = [];
let tab = '';
for (const [t, title, file, name, icon] of LIST) {
  if (t !== tab) { await p.js(`[...document.querySelectorAll('nav button, nav a')].find(b=>b.offsetParent&&(b.getAttribute('aria-label')||b.innerText.trim())==='${t}').click()`); await run(30); tab = t;
    const h = await p.js('document.documentElement.scrollHeight'); for (let y = 0; y < h; y += 500) { await p.js(`scrollTo(0,${y})`); await run(3) } }
  const sel = `[...document.querySelectorAll('main [data-slot=card]')].find(c=>c.offsetParent&&(c.innerText||'').trim().split('\\n')[0].trim()===${JSON.stringify(title)})`;
  await p.js(`(${sel}).scrollIntoView({block:'center'})`); await run(30); await p.settle();
  const r = await p.js(`(()=>{const r=(${sel}).getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height]})()`);
  const s = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 } });
  fs.writeFileSync(`${out}/${file}.jpg`, Buffer.from(s.data, 'base64'));
  meta.push({ file, name, icon, w: Math.round(r[2]), h: Math.round(r[3]) }); console.log(file, r.map(Math.round).join());
}
fs.writeFileSync(`${out}/cards.json`, JSON.stringify(meta, null, 1));
await p.close(); process.exit(0);
