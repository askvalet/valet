// The desktop film's footage: 1600x900 CSS at 2x, one clip per beat, frame-exact.
//   node desktop.mjs <outDir> [only,beats]   (DEMO_URL=… for a demo that isn't on port 7863)
import { readFileSync } from 'node:fs';
import { start, sleep, nav, btn, field, card, cardHas, says } from './vrec.mjs';
const out = process.argv[2], only = process.argv[3]?.split(',');
const want = n => !only || only.includes(n);
// voice-stub.js gives the browser a microphone that "hears" a set sentence: the public demo's own mic never listens
const p = await start({ url: process.env.DEMO_URL || 'http://localhost:7863/', W: 1600, H: 900, dpr: 2, init: readFileSync(new URL('./voice-stub.js', import.meta.url), 'utf8') });
for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
await p.warm(); await p.settle(); await p.js('__ears()');
const next = c => `[...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.getAttribute('aria-label')==='Next in ${c}')`;
const up = (sel, minW) => `(()=>{let e=${sel};while(e&&e.getBoundingClientRect().width<${minW})e=e.parentElement;return e})()`;
const textEl = (t, root = 'document') => `[...${root}.querySelectorAll('*')].filter(e=>e.offsetParent!==null&&e.children.length<4&&(e.innerText||'').trim().startsWith(${JSON.stringify(t)})).at(-1)`;
const sheet = up(field, 900);
const go = async (tab, warm = true) => { await p.js(`(${nav(tab)}).click()`); for (let i = 0; i < 8; i++) { await p.step(10); await sleep(60) } if (warm) await p.warm(); await p.settle() };
const scrollTo = async (sel, top, sec) => { const y = await p.js(`Math.max(0,Math.round((${sel}).getBoundingClientRect().top+scrollY-${top}))`); await p.scrollWin(y, sec) };
const rects = names => Object.fromEntries(names.map(n => [n, card(n)]));

// 1. Overview, frosted: the page top to bottom, a turn of the carousels at the end
const upH = (sel, minH) => `(()=>{let e=${sel};while(e&&e.getBoundingClientRect().height<${minH})e=e.parentElement;return e})()`;
if (want('overview')) {
  await p.setCursor(1180, 620);
  p.open(`${out}/overview.mp4`);
  await p.mark('top', { services: card('Services') });
  await p.wait(5.6);   // the film starts this clip .5 s in: five seconds still before anything moves
  await scrollTo(card('Home Assistant'), 96, 1.8); await p.mark('three', { ha: card('Home Assistant'), pc: card("Daniel's Desktop"), cal: cardHas('/November/') }); await p.wait(1);
  await scrollTo(card('Pi-hole'), 96, 1.4); await p.mark('dns', { dns: card('Pi-hole'), drives: card('Drives') }); await p.wait(.8);
  await scrollTo(card('Now playing'), 96, 1.3); await p.mark('now', { now: card('Now playing'), photos: card('On this day') }); await p.wait(.8);
  await scrollTo(card('From your reading'), 120, 1.5); await p.mark('carousels', { reading: card('From your reading'), recent: card('Recently added') });
  await p.wait(.3); await p.press(next('Recently added'), .8); await p.wait(.9); await p.press(next('From your reading'), .8); await p.wait(1.2);
  await p.shut();
  await p.js('scrollTo(0,0)'); await p.settle();
}

// 2. ⌘K searches inside the services: a word, and each service's rows arrive under the page's own; Enter on one shows it.
if (want('kbar')) {
  await p.js('scrollTo(0,0);window.open=()=>null'); await p.setCursor(1180, 620); await p.settle();
  const pal = upH(`document.querySelector('[cmdk-input]')`, 120);
  const group = name => `[...document.querySelectorAll('[cmdk-group-heading]')].some(e=>e.innerText.trim()===${JSON.stringify(name)})`;
  p.open(`${out}/kbar.mp4`);
  await p.wait(.5);
  await p.key('k', 'KeyK', 75, 4); await p.wait(.5);
  await p.mark('open', { pal });
  await p.type('dune', 7);
  await p.until(`${group('Plex')}&&${group('Audiobookshelf')}`, 6, 'found'); await p.settle(); await p.wait(.3);
  await p.mark('found', { pal }); await p.wait(1.5);
  await p.key('ArrowDown', 'ArrowDown', 40); await p.wait(.55);
  await p.key('ArrowDown', 'ArrowDown', 40); await p.wait(.7);
  await p.key('ArrowUp', 'ArrowUp', 38); await p.wait(.6);
  await p.key('Enter'); await p.wait(.5); await p.settle();
  await p.mark('card', { pal }); await p.wait(1.9);
  await p.key('Escape', 'Escape', 27); await p.wait(.35);
  if (await p.js(`!!document.querySelector('[cmdk-input]')`)) { await p.key('Escape', 'Escape', 27); await p.wait(.35) }
  await p.mark('closed');
  await p.move(1250, 470, 1); await p.wait(.6);
  await p.shut();
}
await p.js(`localStorage.setItem('valet-glass','liquid');document.documentElement.classList.add('glass-liquid')`);

// 3. The tabs, liquid: one calm look at each, the film's camera leans in once
if (want('tabs')) {
  const look = async (tab, names, sec, from, to) => {
    await go(tab); await p.setCursor(...from);
    p.open(`${out}/${tab.toLowerCase()}.mp4`);
    await p.mark('top', rects(names));
    await p.wait(.4); await p.move(...to, 1.6); await p.wait(sec - 2);
    await p.shut();
  };
  await look('Services', ['Services', 'Updates', 'Pi-hole', 'CPU', 'Memory'], 4.2, [1000, 560], [900, 470]);
  await look('Home', ['Cameras', 'Hallway', 'Weather', 'Around the house', "Who's home"], 3.2, [1000, 560], [1060, 420]);
  await look('Media', ['Now playing', 'Downloading', 'The year so far', 'Viewing'], 3.2, [1000, 560], [900, 470]);
  await look('Library', ['Hacker News', 'Feeds', 'Recent documents', 'From your reading'], 3.2, [1000, 560], [1060, 470]);
  await go('Overview');
}

// 3b. Several machines, one Valet: the foot of the Services tab, the machines side by side and one of them on its own
if (want('machines')) {
  await go('Services'); await p.setCursor(1000, 420);
  // they're the last row of the tab: room under them, so they sit in the middle of the frame, clear of the film's caption
  await p.js(`document.querySelector('main').style.paddingBottom='420px';scrollTo(0,Math.round((${card('Machines')}).getBoundingClientRect().top+scrollY-300))`); await p.settle(); await p.step(30);
  p.open(`${out}/machines.mp4`);
  await p.mark('top', rects(['Machines', 'NAS', 'Network']));
  await p.wait(.4); await p.move(700, 470, 1.6); await p.wait(1.6); await p.move(1330, 500, 1.4); await p.wait(1.6);
  await p.shut();
  await p.js(`document.querySelector('main').style.paddingBottom='';scrollTo(0,0)`); await go('Overview');
}

// 4. The chat: what's playing, what to watch, then a change that waits for your OK
const box = (sel, w, h) => `(()=>{let e=${sel};while(e&&(e.getBoundingClientRect().width<${w}||e.getBoundingClientRect().height<${h}))e=e.parentElement;return e})()`;
const DLG = `document.querySelector('[role=dialog]')`;
const lastCard = t => `[...document.querySelectorAll('[role=dialog] .chat-card')].filter(c=>c.offsetParent&&c.innerText.includes(${JSON.stringify(t)})).at(-1)`;
const MIC = `[...document.querySelectorAll('[role=dialog] button')].find(b=>/^(Speak|Stop and write it down)$/.test(b.getAttribute('aria-label')||''))`;
const COMPOSER = box(MIC, 500, 44), MODEL = `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.getAttribute('aria-label')==='Model')`;
const READ = `[...document.querySelectorAll('[role=dialog] button.chat-icon')].filter(b=>b.getAttribute('aria-label')==='Read aloud').at(-1)`;
const MENU = kind => `document.querySelector('[role=listbox][aria-label=${kind}]')`;
const PICKER = upH(`document.querySelector('input[placeholder="Search models"]')`, 200);
if (want('chat')) {
  await go('Overview', false); await p.js('scrollTo(0,0)'); await p.setCursor(1180, 620); await p.settle();
  p.open(`${out}/chat.mp4`);
  await p.wait(.5);
  // typed: what's playing
  await p.press(`document.getElementById('ask-box')`, .8); await p.wait(.3);
  await p.type("Who's watching?"); await p.wait(.3); await p.key('Enter');
  await p.wait(.4); await p.mark('sheet', { sheet: DLG });
  p.fast = 2; await p.until(says('minutes left.'), 20, 'watching'); await p.until(lastCard('Now playing'), 20, 'watching card'); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.mark('watching', { sheet: DLG, card: lastCard('Now playing') }); await p.wait(1.5);
  // spoken: what to watch, and the answer read aloud
  await p.js(`__heard='What should we watch tonight?'`);
  await p.press(MIC, .7); await p.wait(.25);
  await p.mark('listen', { sheet: DLG, box: COMPOSER }); await p.wait(2.3);
  await p.press(MIC, .25); await p.until(`(${field})&&(${field}).value.includes('tonight')`, 6, 'heard'); await p.wait(.2);
  await p.mark('heard', { sheet: DLG, box: COMPOSER }); await p.wait(.7); await p.key('Enter');
  p.fast = 2; await p.until(says('favourite lately'), 20, 'popular'); await p.until(lastCard('Most watched'), 20, 'popular card'); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.lift(lastCard('Most watched'), 70, .8); await p.mark('popular', { sheet: DLG, card: lastCard('Most watched') }); await p.wait(1.1);
  await p.press(READ, .8); await p.wait(.2);
  await p.mark('read', { sheet: DLG, card: lastCard('Most watched'), said: textEl('The household', DLG), row: box(READ, 200, 20) }); await p.wait(1.7);
  // a command: / lists them, /model opens the models, and the chat is on another one
  await p.press(field, .6); await p.type('/', 3); await p.wait(.9);
  await p.mark('slash', { sheet: DLG, menu: MENU('Commands'), box: COMPOSER });
  await p.type('model', 5); await p.wait(.5); await p.key('Enter'); await p.wait(.35);
  if (!await p.js(`!!(${PICKER})`)) { await p.key('Enter'); await p.wait(.35) }
  await p.until(PICKER, 4, 'picker'); await p.wait(.3);
  await p.mark('picker', { sheet: DLG, menu: PICKER, box: COMPOSER }); await p.wait(1.3);
  await p.type('gem', 7); await p.wait(.9); await p.key('Enter');
  await p.until(`(${MODEL}).innerText.includes('gemma')`, 5, 'switched'); await p.wait(.4);
  await p.mark('switched', { sheet: DLG, model: MODEL, box: COMPOSER }); await p.wait(1.6);
  // a mention, and a change that waits for your OK
  if (!await p.js(`document.activeElement===(${field})`)) await p.press(field, .5);
  await p.type('@', 3); await p.wait(.8);
  await p.mark('at', { sheet: DLG, menu: MENU('Integrations'), box: COMPOSER }); await p.wait(.5);
  await p.key('Enter'); await p.wait(.3);
  await p.type('Pause Pi-hole for 10 minutes'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(btn('Pause'), 20, 'approval'); p.fast = 1; await p.wait(.3);
  await p.mark('approval', { sheet: DLG, card: box(btn('Pause'), 420, 64) }); await p.wait(1.2);
  await p.press(btn('Pause'), .8);
  p.fast = 2; await p.until(lastCard('Blocking paused'), 20, 'paused'); p.fast = 1; await p.settle(); await p.wait(.3);
  await p.lift(lastCard('Blocking paused'), 70, .9);
  await p.mark('paused', { sheet: DLG, card: lastCard('Blocking paused') }); await p.wait(2);
  await p.shut();
}

// 5. Self-improving: ask for a card, approve it, see it on the page
if (want('self')) {
  if (!await p.js(`!!(${field})&&(${field}).placeholder?.includes('Message')`)) { await p.press(`document.getElementById('ask-box')`, .1) }
  p.open(`${out}/self.mp4`);
  await p.wait(.4);
  await p.press(field, .6); await p.type('Add an internet speed card'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(btn('Add'), 20, 'add'); p.fast = 1; await p.wait(.3);
  await p.mark('ask', { sheet: DLG, card: box(btn('Add'), 420, 64) }); await p.wait(1.2);
  await p.press(btn('Add'), .8);
  p.fast = 2; await p.until(says('under Services'), 20, 'added'); p.fast = 1; await p.wait(1);
  await p.mark('done', {});
  await p.key('Escape', 'Escape', 27); await p.wait(.8);
  await p.js('scrollTo(0,0)');
  await p.mark('page', { speed: cardHas('/Internet speed/') });
  await p.move(900, 560, .9); await p.wait(2.4);
  await p.shut();
}
await p.close(); process.exit(0);
