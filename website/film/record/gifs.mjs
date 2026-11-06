// Footage for the README/docs GIFs, frame-exact like the film. Every GIF is the page at its full desktop width
// (1600x900 CSS, 1.5x), and the camera is added afterwards (compose/valet-gifs) from the rectangles marked here:
// wide, in on what matters, and back out. The GIFs run side by side, one browser each.
//   node gifs.mjs <outDir> live,home3d,chat,card,recap,rule
import { start, sleep, btn, field, card, cardHas, says, nav } from './vrec.mjs';
const out = process.argv[2], which = (process.argv[3] || 'live,home3d,chat,card,recap,rule').split(',');
const W = 1600, H = 900, dpr = 1.5;
const boot = async o => { const p = await start({ url: process.env.DEMO_URL || 'http://localhost:7863/', W, H, dpr, ...o }); for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) } await p.warm(); await p.settle(); return p };
const up = (sel, minW) => `(()=>{let e=${sel};while(e&&e.getBoundingClientRect().width<${minW})e=e.parentElement;return e})()`;
const box = (sel, w, h) => `(()=>{let e=${sel};while(e&&(e.getBoundingClientRect().width<${w}||e.getBoundingClientRect().height<${h}))e=e.parentElement;return e})()`;
const DLG = `document.querySelector('[role=dialog]')`;
const ASK = `document.getElementById('ask-box')`;
const askBox = up(ASK, 700);
const lastCard = t => `[...document.querySelectorAll('[role=dialog] .chat-card')].filter(c=>c.offsetParent&&c.innerText.includes(${JSON.stringify(t)})).at(-1)`;
const jobs = [];

// the top bar: what's playing, a download and the CPU, each opening its live details. (Not the weather: headless
// Chrome hit-tests a ring under the pointer when it rests on the weather's plate, and the network's card opens late,
// so the GIF ends as the pointer heads there.)
if (which.includes('live')) jobs.push(async () => {
  const p = await boot({});
  const bar = `document.querySelector('.menubar')`;
  const ring = i => `[...document.querySelectorAll('.menubar [class*="group/ring"]')][${i}]`;
  // the bar re-renders as its numbers change, which drops a hover the pointer never left: keep telling it where it is
  const hold = async sec => { for (let i = 0, n = Math.round(sec * 60); i < n; i++) { const [x, y] = p.pos; await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await p.frame() } };
  await p.setCursor(1000, 520);
  p.open(`${out}/live.mp4`, { crf: 12 });
  await p.mark('top', { bar });
  await p.wait(1.6);
  await p.to(ring(1), 1); await hold(.5); await p.mark('r1', { bar }); await hold(1.7);
  await p.to(ring(2), .6); await hold(.5); await p.mark('r2'); await hold(1.7);
  await p.to(ring(3), .55); await hold(.5); await p.mark('r3'); await hold(1.7);
  await p.to(ring(5), .6); await hold(.5); await p.mark('r5'); await hold(1.7);
  await p.move(1000, 520, .9); await p.mark('out'); await p.wait(2);
  await p.shut(); await p.close();
});

// the house: pick the living room, turn it blue, send the vacuum, then back out to watch it drive
if (which.includes('home3d')) jobs.push(async () => {
  const p = await boot({});
  const ha = card('Home Assistant');
  const inCard = t => `[...(${ha}).querySelectorAll('button')].find(b=>b.offsetParent&&(b.getAttribute('aria-label')||b.innerText).trim().startsWith(${JSON.stringify(t)}))`;
  await p.setCursor(1000, 520);
  p.open(`${out}/home3d.mp4`, { crf: 12 });
  await p.mark('top', { card: ha });
  await p.wait(1.4);
  const y = await p.js(`Math.round((${ha}).getBoundingClientRect().top+scrollY-(innerHeight-(${ha}).getBoundingClientRect().height)/2)`);
  await p.scrollWin(y, 1.4); await p.settle();
  await p.mark('card', { card: ha }); await p.wait(1.6);
  await p.press(inCard('Living Room'), .9); await p.wait(1.6);
  await p.press(inCard('Blue'), .9); await p.wait(1.7);
  await p.press(inCard('Clean'), .9); await p.wait(2);
  await p.press(inCard('All rooms'), .8); await p.wait(.4);
  const r = await p.rect(ha); await p.move(r[0] + r[2] * .85, r[1] + r[3] * .3, .8);
  await p.mark('drive', { card: ha }); await p.wait(7);
  await p.shut(); await p.close();
});

// asking: who's watching, what to watch, then pausing Pi-hole waits for approval and shows its chart
if (which.includes('chat')) jobs.push(async () => {
  const p = await boot({}); await p.setCursor(1000, 560);
  p.open(`${out}/chat.mp4`, { crf: 12 });
  await p.mark('top', { ask: askBox });
  await p.wait(1.2);
  await p.press(ASK, .8); await p.wait(.3);
  await p.type("Who's watching?"); await p.wait(.3); await p.key('Enter');
  await p.wait(.4); await p.mark('sheet', { sheet: DLG });
  p.fast = 2; await p.until(says('minutes left.'), 20, 'watching'); await p.until(lastCard('Now playing'), 20); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.mark('watching', { sheet: DLG, card: lastCard('Now playing') }); await p.wait(2.2);
  await p.press(field, .6); await p.type('What should we watch tonight?'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(says('favourite lately'), 20, 'popular'); await p.until(lastCard('Most watched'), 20); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.lift(lastCard('Most watched'), 70, .8); await p.mark('popular', { sheet: DLG, card: lastCard('Most watched') }); await p.wait(2.4);
  await p.press(field, .6); await p.type('Pause Pi-hole for 10 minutes'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(btn('Pause'), 20, 'approval'); p.fast = 1; await p.wait(.3);
  await p.mark('approval', { sheet: DLG, card: box(btn('Pause'), 420, 64) }); await p.wait(1.4);
  await p.press(btn('Pause'), .8);
  p.fast = 2; await p.until(lastCard('Blocking paused'), 20, 'paused'); p.fast = 1; await p.settle(); await p.wait(.3);
  await p.lift(lastCard('Blocking paused'), 70, .9);
  await p.mark('paused', { sheet: DLG, card: lastCard('Blocking paused') }); await p.wait(3);
  await p.key('Escape', 'Escape', 27); await p.wait(.4); await p.mark('closed'); await p.wait(2);
  await p.shut(); await p.close();
});

// asking for a card: Valet asks first, then the card is on the page
if (which.includes('card')) jobs.push(async () => {
  const p = await boot({}); await p.setCursor(1000, 560);
  p.open(`${out}/card.mp4`, { crf: 12 });
  await p.mark('top', { ask: askBox });
  await p.wait(1.2);
  await p.press(ASK, .8); await p.wait(.3);
  await p.type('Add an internet speed card'); await p.wait(.3); await p.key('Enter');
  await p.wait(.4); await p.mark('sheet', { sheet: DLG });
  p.fast = 2; await p.until(btn('Add'), 20, 'add'); p.fast = 1; await p.wait(.3);
  await p.mark('ask', { sheet: DLG, card: box(btn('Add'), 420, 64) }); await p.wait(1.6);
  await p.press(btn('Add'), .8);
  p.fast = 2; await p.until(says('under Services'), 20, 'added'); p.fast = 1; await p.wait(1.6);
  await p.mark('done', { sheet: DLG });
  await p.key('Escape', 'Escape', 27); await p.wait(.7);
  const sp = cardHas('/Internet speed/');
  await p.mark('closed', { speed: sp });
  await p.scrollWin(await p.js(`Math.max(0,Math.round((${sp}).getBoundingClientRect().top+scrollY-(innerHeight-(${sp}).getBoundingClientRect().height)/2))`), 1.4);
  await p.mark('page', { speed: sp });
  const c = await p.center(sp); await p.move(c[0] - c[2][2] * .2, c[1], .9); await p.wait(4);
  await p.shut(); await p.close();
});

// the year in review: the page, then the story full screen, a few of its best screens (screen 0 is the opening)
if (which.includes('recap')) jobs.push(async () => {
  const p = await boot({}); await p.setCursor(1000, 560);
  const at = `[...document.querySelectorAll('.rc-seg span')].findIndex(s=>s.querySelector('i.on'))`;
  const go = async n => { for (let i = 0; i < 30 && await p.js(at) < n; i++) await p.key('ArrowRight', 'ArrowRight', 39) };
  p.open(`${out}/recap.mp4`, { crf: 12 });
  await p.mark('top'); await p.wait(1);
  await p.js(`location.hash='#recap'`); await p.until(`document.querySelector('.rc')`, 5); await p.move(1540, 860, .6);
  await p.mark('open'); await p.wait(2.6);
  await go(3); await p.wait(.1); await p.mark('race', { race: `document.querySelector('.rc-race')` }); console.log('screen', await p.js(at)); await p.wait(5.2);
  await go(4); await p.mark('home'); console.log('screen', await p.js(at)); await p.wait(3.2);
  await go(12); await p.mark('dns'); console.log('screen', await p.js(at)); await p.wait(2.8);
  await go(16); await p.mark('uptime'); console.log('screen', await p.js(at)); await p.wait(2.8);
  await p.shut(); await p.close();
});

// a reminder in plain words: ask, approve, and later it arrives by itself (the demo's download finishes on cue)
if (which.includes('rule')) jobs.push(async () => {
  const p = await boot({}); await p.setCursor(1000, 560);
  const TOAST = `[...document.querySelectorAll('.toasts .undo-bar')].find(t=>t.innerText.includes('Oppenheimer'))`;
  p.open(`${out}/rule.mp4`, { crf: 12 });
  await p.mark('top', { ask: askBox });
  await p.wait(1.2);
  await p.press(ASK, .8); await p.wait(.3);
  await p.type('Tell me when Oppenheimer finishes downloading'); await p.wait(.3); await p.key('Enter');
  await p.wait(.4); await p.mark('sheet', { sheet: DLG });
  p.fast = 2; await p.until(btn('Set reminder'), 20, 'approval'); p.fast = 1; await p.wait(.3);
  await p.mark('approval', { sheet: DLG, card: box(btn('Set reminder'), 420, 64) }); await p.wait(1.6);
  await p.press(btn('Set reminder'), .8);
  p.fast = 2; await p.until(says("I'll tell you when Oppenheimer"), 20, 'confirmed'); p.fast = 1; await p.wait(.3);
  await p.mark('confirmed', { sheet: DLG }); await p.wait(1.8);
  await p.key('Escape', 'Escape', 27); await p.wait(.5);
  await p.press(nav('Media'), .9); await p.wait(.6); await p.settle();
  await p.mark('media', { dl: card('Downloading') });
  await p.until(`/9\\d%|100%/.test((${card('Downloading')})?.innerText||'')`, 20, 'nearly');
  await p.until(TOAST, 20, 'fired'); await p.wait(.2);
  await p.mark('fired', { toast: TOAST, dl: card('Downloading') }); await p.wait(3.6);
  await p.mark('end'); await p.wait(1.4);
  await p.shut(); await p.close();
});

await Promise.all(jobs.map(j => j()));
process.exit(0);
