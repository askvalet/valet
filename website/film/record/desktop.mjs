// The desktop film's footage: 1600x900 CSS at 2x, one clip per beat, frame-exact.
//   node desktop.mjs <outDir> [only,beats]
import { start, sleep, nav, btn, field, card, cardHas, says } from './vrec.mjs';
const out = process.argv[2], only = process.argv[3]?.split(',');
const want = n => !only || only.includes(n);
const p = await start({ url: 'http://localhost:7863/', W: 1600, H: 900, dpr: 2 });
for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
await p.warm(); await p.settle();
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

// 2. ⌘K, three ways: open a service by name, ask a question (answered right in the palette), find a page in the docs.
// Opening a service or a doc would open a new tab, so window.open is a no-op while filming.
if (want('kbar')) {
  await p.js('scrollTo(0,0);window.open=()=>null'); await p.setCursor(1180, 620); await p.settle();
  const pal = upH(`document.querySelector('[cmdk-input]')`, 220);
  const sel = `document.querySelector('[cmdk-item][data-selected=true]')?.getAttribute('data-value')||''`;
  p.open(`${out}/kbar.mp4`);
  await p.wait(.5);
  await p.key('k', 'KeyK', 75, 4); await p.wait(.45);
  await p.mark('open', { pal });
  await p.type('plex', 5); await p.wait(1.1);
  await p.mark('svc', { pal });
  await p.key('Enter'); await p.wait(.8);
  await p.key('k', 'KeyK', 75, 4); await p.wait(.4);
  await p.type('When will the downloads finish?', 3); await p.wait(.35); await p.key('Enter');
  await p.mark('asked', { pal });
  p.fast = 2; await p.until(says('with no peers'), 20, 'answer'); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.mark('answer', { pal }); await p.wait(2.4);
  await p.key('Escape', 'Escape', 27); await p.wait(.6);
  await p.key('k', 'KeyK', 75, 4); await p.wait(.4);
  await p.type('wallpaper', 4);
  await p.until(`[...document.querySelectorAll('[cmdk-item]')].some(e=>e.getAttribute('data-value')?.startsWith('docs '))`, 6, 'docs'); await p.wait(.5);
  for (let i = 0; i < 8 && !(await p.js(sel)).startsWith('docs '); i++) { await p.key('ArrowDown', 'ArrowDown', 40); await p.wait(.22) }
  await p.mark('docs', { pal }); await p.wait(1.8);
  await p.key('Escape', 'Escape', 27); await p.wait(.3);
  await p.mark('closed');
  await p.move(1250, 470, 1); await p.wait(.8);
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

// 4. The chat: what's playing, what to watch, then a change that waits for your OK
const box = (sel, w, h) => `(()=>{let e=${sel};while(e&&(e.getBoundingClientRect().width<${w}||e.getBoundingClientRect().height<${h}))e=e.parentElement;return e})()`;
const DLG = `document.querySelector('[role=dialog]')`;
const lastCard = t => `[...document.querySelectorAll('[role=dialog] .chat-card')].filter(c=>c.offsetParent&&c.innerText.includes(${JSON.stringify(t)})).at(-1)`;
if (want('chat')) {
  await go('Overview', false); await p.js('scrollTo(0,0)'); await p.setCursor(1180, 620); await p.settle();
  p.open(`${out}/chat.mp4`);
  await p.wait(.5);
  await p.press(`document.getElementById('ask-box')`, .8); await p.wait(.3);
  await p.type("Who's watching?"); await p.wait(.3); await p.key('Enter');
  await p.wait(.4); await p.mark('sheet', { sheet: DLG });
  p.fast = 2; await p.until(says('minutes left.'), 20, 'watching'); await p.until(lastCard('Now playing'), 20, 'watching card'); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.mark('watching', { sheet: DLG, card: lastCard('Now playing') }); await p.wait(1.6);
  await p.press(field, .6); await p.type('What should we watch tonight?'); await p.wait(.3); await p.key('Enter');
  p.fast = 2; await p.until(says('favourite lately'), 20, 'popular'); await p.until(lastCard('Most watched'), 20, 'popular card'); p.fast = 1; await p.settle(); await p.wait(.2);
  await p.lift(lastCard('Most watched'), 70, .8); await p.mark('popular', { sheet: DLG, card: lastCard('Most watched') }); await p.wait(1.8);
  await p.press(field, .6); await p.type('Pause Pi-hole for 10 minutes'); await p.wait(.3); await p.key('Enter');
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
