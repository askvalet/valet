// Footage for the README/docs GIFs, frame-exact like the film. One browser per GIF, sized so the GIF is a clean downscale.
//   node gifs.mjs <outDir> live,home3d,chat,card
import { start, sleep, btn, field, card, cardHas, says } from './vrec.mjs';
const out = process.argv[2], which = (process.argv[3] || 'live,home3d,chat,card').split(',');
const boot = async o => { const p = await start({ url: 'http://localhost:7863/', ...o }); for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) } await p.warm(); await p.settle(); return p };
const up = (sel, minW) => `(()=>{let e=${sel};while(e&&e.getBoundingClientRect().width<${minW})e=e.parentElement;return e})()`;
const textEl = t => `[...document.querySelectorAll('*')].filter(e=>e.offsetParent!==null&&e.children.length<4&&(e.innerText||'').trim().startsWith(${JSON.stringify(t)})).at(-1)`;

// the top bar: what's playing, a download, the CPU, then the weather, each opening its live details
if (which.includes('live')) {
  const p = await boot({ W: 1312, H: 568, dpr: 1.25 });
  const ring = i => `[...document.querySelectorAll('.menubar [class*="group/ring"]')][${i}]`;
  const weather = `[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&/Cloudy/.test(e.innerText||'')&&e.getBoundingClientRect().width>110&&e.getBoundingClientRect().width<300&&e.getBoundingClientRect().top<90).at(-1)`;
  await p.setCursor(860, 330);
  p.open(`${out}/live.mp4`, { crf: 12 });
  await p.wait(.8);
  await p.to(ring(1), .9); await p.wait(2.1);
  await p.to(ring(2), .6); await p.wait(2.1);
  await p.to(ring(3), .55); await p.wait(2.1);
  await p.to(weather, .8); await p.wait(2.3);
  await p.move(860, 330, .9); await p.wait(1);
  await p.shut(); await p.close();
}

// the house: pick the living room, turn it blue, send the vacuum, then back out to watch it drive
if (which.includes('home3d')) {
  const p = await boot({ W: 600, H: 900, dpr: 1.5 });
  const ha = card('Home Assistant');
  await p.js(`scrollTo(0,Math.round((${ha}).getBoundingClientRect().top+scrollY-16))`); await p.settle(); await p.step(30);
  const r = await p.rect(ha);
  const inCard = t => `[...(${ha}).querySelectorAll('button')].find(b=>b.offsetParent&&(b.getAttribute('aria-label')||b.innerText).trim().startsWith(${JSON.stringify(t)}))`;
  await p.setCursor(470, 260);
  p.open(`${out}/home3d.mp4`, { crf: 12 }); await p.mark('card', { card: ha });
  await p.wait(1.2);
  await p.press(inCard('Living Room'), .9); await p.wait(1.6);
  await p.press(inCard('Blue'), .9); await p.wait(1.7);
  await p.press(inCard('Clean'), .9); await p.wait(2.2);
  await p.press(inCard('All rooms'), .8); await p.move(480, r[1] + 200, .8); await p.wait(6);
  await p.shut(); await p.close();
}

const chatBoot = async () => { const p = await boot({ W: 1000, H: 720, dpr: 1.6 }); await p.setCursor(700, 460); return p };
const lastCard = t => up(textEl(t), 360);
// asking: who's watching, what to watch, then pausing Pi-hole waits for approval and shows its chart
if (which.includes('chat')) {
  const p = await chatBoot();
  p.open(`${out}/chat.mp4`, { crf: 12 });
  await p.wait(.6);
  await p.press(`document.getElementById('ask-box')`, .8); await p.wait(.3);
  await p.type("Who's watching?"); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(says('minutes left.'), 20, 'watching'); p.fast = 1; await p.wait(2.4);
  await p.press(field, .6); await p.type('What should we watch tonight?'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(says('favourite lately'), 20, 'popular'); p.fast = 1; await p.wait(.3);
  await p.lift(lastCard('Most watched'), 40, .8); await p.wait(2.4);
  await p.press(field, .6); await p.type('Pause Pi-hole for 10 minutes'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(btn('Pause'), 20, 'approval'); p.fast = 1; await p.wait(1.8);
  await p.press(btn('Pause'), .8);
  p.fast = 2; await p.until(says('Blocking paused'), 20, 'paused'); p.fast = 1; await p.wait(.3);
  await p.lift(lastCard('Blocking paused'), 70, .9); await p.wait(3.2);
  await p.shut(); await p.close();
}
// asking for a card: Valet asks first, then the card is on the page
if (which.includes('card')) {
  const p = await chatBoot();
  p.open(`${out}/card.mp4`, { crf: 12 });
  await p.wait(.6);
  await p.press(`document.getElementById('ask-box')`, .8); await p.wait(.3);
  await p.type('Add an internet speed card'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(btn('Add'), 20, 'add'); p.fast = 1; await p.wait(2);
  await p.press(btn('Add'), .8);
  p.fast = 2; await p.until(says('under Services'), 20, 'added'); p.fast = 1; await p.wait(2.2);
  await p.key('Escape', 'Escape', 27); await p.wait(.7);
  const sp = cardHas('/Internet speed/');
  await p.scrollWin(await p.js(`Math.max(0,Math.round((${sp}).getBoundingClientRect().top+scrollY-(innerHeight-(${sp}).getBoundingClientRect().height)/2))`), 1.4);
  const c = await p.center(sp); await p.move(c[0] - c[2][2] * .2, c[1], .9); await p.wait(3.4);
  await p.shut(); await p.close();
}
process.exit(0);
