// config-live: ten edits to config.yaml, one after another, each landing on the open page as it's saved. A real server
// (reload on) watches the file; an editor panel drawn over the page shows the lines around each edit, the new value
// typed in and "Saved", then gets out of the way while the page changes.
//   node cfglive.mjs <outDir> <config.yaml> [a second wallpaper, as the server reads it: walls/lake.jpg]
// The server: dist/server.js on port 7867 with VALET_CONFIG=<config.yaml>, started in the repo root (the demo plugin
// reads demo/art from there, and relative wallpapers are read from there too), on a copy of demo/config.yaml that says
// `reload: true` and `sandbox: false`. The file is tidied first (comments dropped, `hero` and `nav` written out as
// blocks: the same config) and put back as it was when the recording ends.
import fs from 'node:fs';
import { start, sleep } from './vrec.mjs';
const [out, cfg, wall = 'walls/lake.jpg'] = process.argv.slice(2);
const orig = fs.readFileSync(cfg, 'utf8');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { fs.writeFileSync(cfg, orig); process.exit(1) });

// the edits: change a line (`line`, the first match at or after `near`) or add one after it (`after`); one save each
const EDITS = [
  [{ line: /^greeting: /, to: 'greeting: Sam' }],
  [{ line: /^  wallpaper: /, to: `  wallpaper: ${wall}` }],
  [{ after: /^  rim: /, to: '  glass: { material: liquid }' }],
  [{ line: /^  theme: /, to: '  theme: light' }],
  [{ line: /^  align: /, near: /^hero:/m, to: '  align: center' }],
  [{ after: /^  order: /, near: /^nav:/m, to: '  side: bottom' }, { after: /^  side: bottom/, to: '  style: both' }],
  [{ line: /^    columns: /, near: /^  - heading: false\n    columns: \{ phone: 1, tablet: 2, desktop: 3, wide: 3 \}\n    widgets:\n      - \{ widget: lab\.home/m, to: '    columns: 2' }],
  [{ line: /^    variant: minimal/, to: '    variant: full' }],
  [{ after: /^  align: center/, near: /^hero:/m, to: '  search: false' }],
  [{ after: /^  glass: /, to: '  font: { family: serif }' }],
];

// the same config, easier to read in the panel
const block = (name, b) => `${name}:\n` + b.split(/, (?=\w+: )/).map(kv => '  ' + kv).join('\n');
const tidy = t => t.split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/\s{2,}#.*$/, '')).join('\n')
  .replace(/^hero: \{ (.*) \}$/m, (_, b) => '\n' + block('hero', b)).replace(/^nav: \{ (.*) \}$/m, (_, b) => block('nav', b))
  .replace(/\n{3,}/g, '\n\n');
const lines = tidy(orig).split('\n');
const lineOf = (re, near) => {
  let from = 0;
  if (near) { const t = lines.join('\n'), m = near.exec(t); if (!m) throw new Error('not found: ' + near); from = t.slice(0, m.index).split('\n').length - 1 }
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error('not found: ' + re);
};

// the editor panel: a window of seven lines, the edited one lit, the caret where the typing is
const PANEL = `(()=>{
const css=document.createElement('style');css.textContent=\`
#__ed{position:fixed;right:28px;bottom:28px;width:720px;z-index:2147483646;border-radius:18px;overflow:hidden;background:rgb(16 17 22/.9);
 backdrop-filter:blur(22px) saturate(1.2);border:1px solid rgb(255 255 255/.14);box-shadow:0 30px 70px -20px rgb(0 0 0/.75),0 0 0 .5px rgb(0 0 0/.5);
 opacity:0;transform:translateY(36px) scale(.97);transform-origin:80% 100%;transition:opacity .3s ease,transform .38s cubic-bezier(.2,.8,.2,1);
 font:500 21px/34px ui-monospace,'JetBrains Mono','DejaVu Sans Mono',Menlo,monospace;color:#d6dae2;-webkit-font-smoothing:antialiased}
#__ed.on{opacity:1;transform:none}
#__ed .bar{display:flex;align-items:center;gap:12px;height:48px;padding:0 18px;background:rgb(255 255 255/.05);border-bottom:1px solid rgb(255 255 255/.08);font:600 17px system-ui,sans-serif;color:rgb(255 255 255/.9)}
#__ed .dots{display:flex;gap:7px;margin-right:4px}#__ed .dots i{width:12px;height:12px;border-radius:50%;background:rgb(255 255 255/.18)}
#__ed .path{color:rgb(255 255 255/.4);font-weight:500}
#__ed .st{margin-left:auto;display:flex;align-items:center;gap:8px;font:600 16px system-ui,sans-serif}
#__ed .st.ed{color:rgb(255 255 255/.55)}#__ed .st.ed::before{content:'';width:9px;height:9px;border-radius:50%;background:#e8eaed}
#__ed .st.ok{color:#5fe08a;padding:4px 12px 4px 10px;border-radius:99px;background:rgb(95 224 138/.14)}
#__ed .code{padding:10px 0 12px}
#__ed .ln{display:flex;white-space:pre;height:34px}
#__ed .ln b{flex:none;width:70px;padding-right:18px;text-align:right;color:rgb(255 255 255/.28);font-weight:500}
#__ed .ln span{overflow:hidden}
#__ed .ln.cur{background:rgb(120 160 255/.16);box-shadow:inset 3px 0 #7aa2ff}#__ed .ln.cur b{color:rgb(255 255 255/.8)}
#__ed .ln.saved{background:rgb(95 224 138/.16);box-shadow:inset 3px 0 #5fe08a}#__ed .ln.saved b{color:rgb(255 255 255/.8)}
#__ed i{font-style:normal}#__ed .k{color:#8fb8ff}#__ed .p{color:rgb(255 255 255/.45)}#__ed .v{color:#f2c58a}#__ed .n{color:#c3a6ff}#__ed .q{color:#a5e3a0}
#__ed .c{display:inline-block;width:2.5px;height:26px;margin:4px -1px 0 0;vertical-align:top;background:#fff;border-radius:1px}
#__ed .c.off{visibility:hidden}#__ed .sel{background:rgb(90 140 255/.45);border-radius:3px;color:#fff}\`;
document.head.appendChild(css);
const d=document.createElement('div');d.id='__ed';document.documentElement.appendChild(d);
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const val=s=>esc(s).replace(/("[^"]*"?)|(\\b\\d[\\d.]*(?:px)?\\b)|([{}\\[\\],:])|([\\w.\\/#-]+)/g,(m,q,n,p)=>'<i class='+(q?'q':n?'n':p?'p':'v')+'>'+m+'</i>');
const hl=s=>{const m=/^(\\s*)(- )?([\\w.]+)(:)(.*)$/.exec(s);if(!m)return val(s);return m[1]+(m[2]?'<i class=p>- </i>':'')+'<i class=k>'+m[3]+'</i><i class=p>:</i>'+val(m[5])};
window.__ed=o=>{
 d.innerHTML='<div class=bar><span class=dots><i></i><i></i><i></i></span>config.yaml<span class=path>~/valet</span><span class="st '+(o.st||'')+'">'+(o.st==='ok'?'✓ Saved':o.st==='ed'?'Edited':'')+'</span></div><div class=code>'
  +o.rows.map(r=>'<div class="ln'+(r.cur?(o.st==='ok'?' saved':' cur'):'')+'"><b>'+r.n+'</b><span>'+(r.cur&&r.tail!=null?hl(r.t)+(r.sel?'<i class=sel>'+esc(r.sel)+'</i>':'<i class="c'+(r.caret?'':' off')+'"></i>')+val(r.tail):hl(r.t))+'</span></div>').join('')+'</div>';
 d.classList.toggle('on',!!o.on)};
})()`;

const p = await start({ url: 'http://127.0.0.1:7867/', W: 1600, H: 900, dpr: 1.25 });
try {
  fs.writeFileSync(cfg, lines.join('\n'));   // the tidy copy: the same page
  for (let i = 0; i < 80; i++) { await p.step(15); if (await p.js(`!!document.getElementById('ask-box')`)) break; await sleep(50) }
  await sleep(1500); await p.step(30);
  await p.warm(); await p.settle();
  await p.js(PANEL);
  // count the page's reloads: a saved edit makes it fetch /api/page again
  await p.js(`(()=>{window.__pg=0;const f=window.fetch;window.fetch=function(u,...a){const r=f.call(this,u,...a);if(String(u).includes('/api/page'))r.then(x=>x.clone().text()).then(()=>{window.__pg++},()=>{});return r}})()`);
  await p.setCursor(-100, -100);

  let tick = 0, shown = false;
  const draw = (at, text, { tail = null, sel = '', caret = true, st = '', on = true } = {}) => {
    const a = Math.max(0, Math.min(at - 3, lines.length - 7)), rows = [];
    for (let i = a; i < a + 7; i++) rows.push(i === at ? { n: i + 1, t: text, tail: tail ?? '', sel, caret, cur: true } : { n: i + 1, t: lines[i] });
    shown = on; return p.js(`__ed(${JSON.stringify({ rows, st, on })})`);
  };
  const frames = async (n, f) => { for (let i = 0; i < n; i++) { if (f) await f(i); await p.frame(); tick++; if (process.env.DEBUG && tick % 30 === 0) console.log('frame', p.frames) } };
  const blink = () => (tick % 64) < 36;

  // type one change into a line: keep what the old and new share at each end, backspace the rest, type the new part
  const typeLine = async (at, from, to) => {
    let pre = 0; while (pre < from.length && pre < to.length && from[pre] === to[pre]) pre++;
    let suf = 0; while (suf < from.length - pre && suf < to.length - pre && from[from.length - 1 - suf] === to[to.length - 1 - suf]) suf++;
    const head = from.slice(0, pre), tail = from.slice(from.length - suf), oldMid = from.slice(pre, from.length - suf), newMid = to.slice(pre, to.length - suf);
    await frames(8, () => draw(at, head + oldMid, { tail, st: '' }));   // the caret steps to the spot
    if (oldMid.length > 8) await frames(14, () => draw(at, head, { sel: oldMid, tail, st: '' }));   // a long value is selected, then typed over
    else for (let i = oldMid.length - 1; i >= 0; i--) await frames(2, j => j === 0 && draw(at, head + oldMid.slice(0, i), { tail, st: 'ed' }));
    for (let i = 1; i <= newMid.length; i++) await frames(3 + (i % 5 === 2 ? 1 : 0), j => j === 0 && draw(at, head + newMid.slice(0, i), { tail, st: 'ed' }));
  };

  const edit = async (ops) => {
    let at = -1;
    for (const [k, op] of ops.entries()) {
      if (op.line) at = lineOf(op.line, op.near);
      else { at = lineOf(op.after, op.near) + 1; lines.splice(at, 0, '') }
      const from = lines[at];
      if (k === 0) { await draw(at, from, { on: false, caret: false }); await frames(1); await frames(20, () => draw(at, from, { caret: false })) }
      if (!op.line) {   // a new line: it opens, indented, under the one before
        lines[at] = op.to.match(/^\s*/)[0];
        await frames(4, () => draw(at, lines[at], { st: 'ed' }));
      }
      await typeLine(at, lines[at], op.to);
      lines[at] = op.to;
      await frames(10, () => draw(at, op.to, { st: 'ed' }));
    }
    // ⌘S: the file is written, the panel says so, and the page changes as soon as it has fetched the new config
    fs.writeFileSync(cfg, lines.join('\n'));
    const n0 = await p.js('__pg'), f0 = p.frames;
    await draw(at, lines[at], { caret: false, st: 'ok' });
    let got = false;
    for (let i = 0; i < 6 * 60 && !got; i++) { await frames(1); if (i % 2 === 0) got = await p.js('__pg') > n0 }
    if (!got) console.log('NO RELOAD after', lines[at]);
    const f1 = p.frames;
    for (let i = 0; i < 3 * 60; i++) { if (await p.js(`[...document.querySelectorAll('.wallpaper img')].every(i=>i.complete)`)) break; await frames(1) }   // a new wallpaper fades up once it's in
    if (process.env.DEBUG) console.log('reload', f1 - f0, 'frames, images', p.frames - f1);
    await frames(14);
    await draw(at, lines[at], { caret: false, st: 'ok', on: false });
    console.log('saved', JSON.stringify(lines[at].trim()), 'at', (p.frames / 60).toFixed(2) + 's');
    await frames(72);
  };

  p.open(`${out}/config.mp4`, { crf: 12 });
  await frames(40);
  for (const [i, ops] of EDITS.entries()) if (!process.env.ONLY || process.env.ONLY.split(',').includes(String(i + 1))) await edit(ops);
  await frames(36);
  await p.shut();
} finally { fs.writeFileSync(cfg, orig); await p.close() }
process.exit(0);
