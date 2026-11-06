// The phone film's footage: a 402x620 phone at 3x, liquid glass, frame-exact. Taps show as a soft ring.
//   node phone.mjs <outDir> [only,beats]
import { start, sleep, nav, btn, field, card, cardHas, says } from './vrec.mjs';
const out = process.argv[2], only = process.argv[3]?.split(',');
const want = n => !only || only.includes(n);
const p = await start({ url: 'http://localhost:7863/', W: 402, H: 620, dpr: 3, phone: true, storage: { 'valet-glass': 'liquid' } });
for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
await p.js(`localStorage.setItem('valet-glass','liquid');document.documentElement.classList.add('glass-liquid')`);
await p.warm(); await p.settle();
const up = (sel, minW) => `(()=>{let e=${sel};while(e&&e.getBoundingClientRect().width<${minW})e=e.parentElement;return e})()`;
const textEl = t => `[...document.querySelectorAll('*')].filter(e=>e.offsetParent!==null&&e.children.length<4&&(e.innerText||'').trim().startsWith(${JSON.stringify(t)})).at(-1)`;
const tabBtn = n => `[...document.querySelectorAll('nav button, nav a')].find(b=>b.offsetParent&&(b.getAttribute('aria-label')||b.innerText.trim())===${JSON.stringify(n)})`;
const yOf = (sel, top) => p.js(`Math.max(0,Math.round((${sel}).getBoundingClientRect().top+scrollY-${top}))`);
const go = async n => { await p.tap(tabBtn(n)); for (let i = 0; i < 12; i++) await p.frame() };

if (want('main')) {
  p.open(`${out}/main.mp4`);
  await p.wait(1.2);
  await p.scrollWin(await yOf(card('Services'), 64), 1.3); await p.wait(.5);
  await p.scrollWin(await yOf(card('Home Assistant'), 64), 1.3); await p.mark('house'); await p.wait(.7);
  await p.scrollWin(await yOf(cardHas('/November/'), 64), 1.6); await p.mark('cal'); await p.wait(.7);
  await p.scrollWin(await yOf(card('Now playing'), 64), 1.8); await p.mark('now'); await p.wait(.8);
  await p.shut();
}
if (want('tabs')) {
  await p.js('scrollTo(0,0)'); await p.settle();
  p.open(`${out}/tabs.mp4`);
  await p.wait(.2);
  await go('Home'); await p.settle(); await p.wait(1.4);
  await p.scrollWin(await yOf(card('Hallway'), 64), 1.2); await p.wait(.9);
  await go('Media'); await p.settle(); await p.wait(.6);
  await p.scrollWin(await yOf(card('Games'), 64), 1.4); await p.wait(.5);
  await p.tap(`[...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.getAttribute('aria-label')==='Next in Games')`); await p.wait(.9);
  await p.shut();
  await go('Overview'); await p.js('scrollTo(0,0)'); await p.settle();
}
const box = (sel, w, h) => `(()=>{let e=${sel};while(e&&(e.getBoundingClientRect().width<${w}||e.getBoundingClientRect().height<${h}))e=e.parentElement;return e})()`;
const lastCard = (t, h = 140) => box(textEl(t), 300, h);
if (want('ask')) {
  await p.js('scrollTo(0,0)'); await p.settle();
  p.open(`${out}/ask.mp4`);
  await p.wait(.4);
  await p.tap(`document.getElementById('ask-box')`); await p.wait(.2);
  await p.type("Who's watching?"); await p.wait(.25); await p.key('Enter');
  p.fast = 2; await p.until(says('minutes left.'), 20, 'watching'); p.fast = 1;
  await p.lift(lastCard('Now playing'), 74, .7); await p.mark('watching'); await p.wait(1.6);
  await p.tap(field); await p.wait(.15); await p.type('What should we watch tonight?'); await p.wait(.2); await p.key('Enter');
  p.fast = 2; await p.until(says('favourite lately'), 20, 'popular'); p.fast = 1;
  await p.lift(lastCard('Most watched'), 74, .8); await p.mark('popular'); await p.wait(1.8);
  await p.tap(field); await p.wait(.15); await p.type('Pause Pi-hole for 10 minutes'); await p.wait(.2); await p.key('Enter');
  p.fast = 2; await p.until(btn('Pause'), 20, 'approval'); p.fast = 1;
  await p.lift(up(btn('Pause'), 300), 200, .7); await p.mark('approval'); await p.wait(1.4);
  await p.tap(btn('Pause'));
  p.fast = 2; await p.until(says('Blocking paused'), 20, 'paused'); p.fast = 1;
  await p.lift(lastCard('Blocking paused', 200), 74, .9); await p.mark('paused'); await p.wait(2.2);
  await p.shut();
}
if (want('self')) {
  p.open(`${out}/self.mp4`);
  await p.wait(.2);
  await p.tap(field); await p.wait(.15); await p.type('Add an internet speed card'); await p.wait(.2); await p.key('Enter');
  p.fast = 2; await p.until(btn('Add'), 20, 'add'); p.fast = 1;
  await p.lift(up(btn('Add'), 300), 200, .7); await p.mark('ask'); await p.wait(1.2);
  await p.tap(btn('Add'));
  p.fast = 2; await p.until(says('under Services'), 20, 'added'); p.fast = 1; await p.wait(.9);
  await p.key('Escape', 'Escape', 27); await p.wait(.6);
  await p.scrollWin(await yOf(cardHas('/Internet speed/'), 120), 1.2); await p.mark('page'); await p.wait(2.2);
  await p.shut();
}
await p.close(); process.exit(0);
