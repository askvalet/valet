// The year in review, as a newspaper. Each story spins in like the montage in an old film, every number on the page is
// real, and it ends on a front page drawn to a canvas, so the picture you save is exactly the one you see. It carries no
// names, and titles only if you ask.
import './recap.css';
import { Download, EyeOff, Eye, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Recap, RecapSlide } from '../shared/cards.ts';

const W = 1080, H = 1620, STEP = 9000;
const roman = (n: number) => [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce((s, [v, r]) => { while (n >= (v as number)) { s += r; n -= v as number; } return s; }, '');
const dateline = (d = new Date()) => d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
const smart = (t = '') => t.replace(/(^|[\s(])"/g, '$1\u201c').replace(/"/g, '\u201d').replace(/'/g, '\u2019');
// what pays for the paper. Timeless, and true of every homelab.
const ADS: [string, string][] = [
  ['Uninterruptible Power Supplies', 'Beeps at 3 AM or your money back.'], ['Cable Management', 'Closed until further notice. Do not open the cabinet.'],
  ['Learn Kubernetes', 'In just 14 weeks you too can run a blog on nine containers.'], ['Is It DNS?', 'It is DNS. Free consultations.'],
  ['RAID Is Not a Backup', 'We will be saying this at your funeral.'], ['Backups', 'Everyone has them. Few have restored one.'],
  ['One More Container', 'Said 41 containers ago.'], ['The Cloud', "It's just someone else's computer. Yours is louder."],
  ['NAS for Sale', 'Used, loud. Only reason for selling: bought a bigger NAS.'], ['Spare Raspberry Pi?', 'You have four. Each one has a plan.'],
  ['Household Approval Low?', 'Our fans run quieter than the argument.'], ['Self-Hosters Anonymous', 'First step: admitting you have 34 services.'],
];
function Ad({ n }: { n: number }) {
  const [t, sub] = ADS[n % ADS.length], dark = n % 3 === 1;
  return <div className="np-adv" data-dark={dark || undefined}><div className="np-adv-k">Advertisement</div><b style={{ fontSize: t.length > 22 ? 62 : t.length > 14 ? 76 : 96 }}>{t}</b><p>{sub}</p></div>;
}

const TINT: Record<string, string> = { Business: 'salmon', Sports: 'green', Obituaries: 'plain' };

/** A picture as a newspaper would print it: greyscale turned to dots of ink. Drawn into any canvas, so the page and the
 *  saved front page share it. */
async function halftone(src: string, x: CanvasRenderingContext2D, dx: number, dy: number, w: number, h: number, ink: string, cell = 7) {
  const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true })!;
  c.width = cols; c.height = rows;
  const k = Math.max(cols / img.width, rows / img.height), iw = img.width * k, ih = img.height * k;
  g.drawImage(img, (cols - iw) / 2, (rows - ih) / 2, iw, ih);
  const d = g.getImageData(0, 0, cols, rows).data;
  x.save(); x.beginPath(); x.rect(dx, dy, w, h); x.clip(); x.fillStyle = ink;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const i = (row * cols + col) * 4, lum = (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11) / 255;
    const r = Math.sqrt(Math.max(0, 1 - Math.pow(lum, .8))) * cell * .68;
    if (r < .35) continue;
    x.beginPath(); x.arc(dx + (col + (row % 2 ? .5 : 0)) * cell, dy + (row + .5) * cell, r, 0, 7); x.fill();
  }
  x.restore();
}
function Halftone({ src, w, h }: { src: string; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!; halftone(src, c.getContext('2d')!, 0, 0, w, h, '#17130e').catch(() => {}); }, [src, w, h]);
  return <canvas ref={ref} width={w} height={h} className="np-ht" style={{ width: w, height: h }} />;
}

function Running({ r, section, n }: { r: Recap; section: string; n: number }) {
  return <div className="np-run"><b>{r.paper}</b><i>{section}</i><span>{r.year} · Page {n}</span></div>;
}
const fits = (text: string, big: number, small: number, limit: number) => text.length > limit ? small : big;

/** Sizes a headline to the page: long ones shrink until they fit their lines. */
function Head({ text }: { text: string }) {
  const n = text.length, widest = Math.max(...text.split(' ').map(w => w.length));
  const size = Math.min(n < 16 ? 168 : n < 28 ? 134 : n < 42 ? 112 : n < 60 ? 94 : 80, 952 / (widest * .8));
  return <h1 className="np-head" style={{ fontSize: size }}>{text}</h1>;
}

function Ink({ c }: { c: NonNullable<RecapSlide['chart']> }) {
  const at = Math.max(.012, Math.min(1, c.pct));
  return (
    <div className="np-bar">
      <div className="np-bar-mark" style={{ left: `${at * 100}%` }}>{c.mark}</div>
      <div className="np-bar-track"><i style={{ width: `${at * 100}%` }} /></div>
      <div className="np-bar-ends"><span>{c.from}</span><span>{(c.pct * 100).toFixed(1)}% watched</span><span>{c.to}</span></div>
    </div>
  );
}

function Feature({ s, r, n }: { s: RecapSlide; r: Recap; n: number }) {
  const art = s.items?.[0]?.image, head = smart(s.headline ?? `${s.kicker} ${s.value}${s.unit ? ` ${s.unit}` : ''}`.toUpperCase());
  const list = s.kind === 'listing' || s.kind === 'table', figure = !list && !s.chart && !head.toUpperCase().includes(s.value.toUpperCase());
  // a story short of copy gets a picture, as it would in a real paper
  const shot = PHOTOS[n % PHOTOS.length], wants = !list && !s.chart && !figure && !s.private;
  // pages differ in copy: once the type has loaded, the picture takes whatever room is left, and an advert only runs if
  // it fits. Nothing gets cut off and nothing is left hollow.
  const box = useRef<HTMLDivElement>(null), [thin, setThin] = useState(0), [ad, setAd] = useState(true);
  useLayoutEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => { if (!live || !box.current) return; const page = box.current.closest<HTMLElement>('.np-page')!, room = box.current.clientHeight;
      if (page.scrollHeight > page.clientHeight + 1) setAd(false); else if (wants && room >= 190) setThin(Math.min(420, room - 60)); });
    return () => { live = false; };
  }, [wants]);
  return (
    <>
      <Running r={r} section={s.section ?? 'News'} n={n} />
      <div className="np-sec">{s.section ?? 'News'}</div>
      <Head text={head} />
      <p className="np-deck">{smart(s.line)}</p>
      {figure && <div className="np-fig" style={{ fontSize: fits(s.value, 250, 170, 6), marginTop: 36 }}>{s.value}{s.unit && <span className="np-unit">{s.unit}</span>}</div>}
      {s.chart && <Ink c={s.chart} />}
      {list && s.items && (
        <div style={{ display: 'flex', gap: 34, marginTop: 28 }}>
          {s.kind === 'listing' && art && <div style={{ flex: 'none' }}><Halftone src={art} w={306} h={452} /></div>}
          <div className="np-rows" style={{ flex: 1, minWidth: 0, marginTop: 0 }}>{s.items.slice(0, 5).map((it, i) => <div key={i} className="np-row" style={{ animationDelay: `${880 + i * 90}ms` }}><span className="n">{i + 1}</span><span className="t">{it.name}</span><span className="v">{it.value}</span></div>)}</div>
        </div>
      )}
      {thin > 0 && <figure style={{ marginTop: 26 }}><Halftone key={thin} src={photo(shot[0])} w={952} h={thin} /><figcaption style={{ fontSize: 26, fontStyle: 'italic', marginTop: 8 }}>{shot[1]}</figcaption></figure>}
      {s.story && <p className="np-body" data-short={s.story.length < 170 || undefined}>{smart(s.story)}</p>}
      <div ref={box} style={{ flex: 1 }} />
      {ad && <Ad n={n} />}
      <div className="np-foot"><span>{s.scope && s.scope !== 'year' ? s.scope : `The year ${r.year}`}</span><span>Set by Valet</span></div>
    </>
  );
}

function Obituary({ s, r, n }: { s: RecapSlide; r: Recap; n: number }) {
  return (
    <>
      <Running r={r} section="Obituaries" n={n} />
      <div className="np-obit" style={{ margin: '60px 7px auto' }}>
        <div style={{ fontSize: 34, fontStyle: 'italic' }}>In loving memory of</div>
        <div className="np-fig" style={{ fontSize: fits(s.headline ?? '', 150, 118, 11), margin: '30px 0 26px' }}>{s.headline}</div>
        <div style={{ fontSize: 30, letterSpacing: '.14em' }}>BLOCKED, {r.year}</div>
        <p style={{ fontSize: 38, lineHeight: 1.3, marginTop: 40, textWrap: 'pretty' }}>{smart(s.story)}</p>
      </div>
      <Ad n={n} />
      <div className="np-foot"><span>{s.scope}</span><span>Rest in /dev/null</span></div>
    </>
  );
}

function Classifieds({ list, r, n }: { list: RecapSlide[]; r: Recap; n: number }) {
  const ads = [...list.map(s => ({ b: s.headline ?? s.kicker, t: s.line })), { b: `Free to good home`, t: 'One spare weekend. Previous owner spent it on a reverse proxy.' }, { b: 'Lost', t: 'The README for that thing you set up in March. If found, do not tell anyone how it works.' }, { b: 'Seeking', t: 'Second opinion on whether this needed Kubernetes. It did not.' },
    { b: 'For rent', t: 'One static IP. No pets, no port 25.' }, { b: 'Found', t: 'A process using 40 GB of memory. Owner may claim it from the OOM killer.' },
    { b: 'Situations vacant', t: 'On-call engineer for one family of three. No pay. Hours: dinner.' }, { b: 'Personal', t: 'To whoever renamed the Wi-Fi: every smart bulb in this house has stopped speaking to me.' },
    { b: 'Wanted', t: 'Certificate that renews itself. Last one said it would.' }];
  return (
    <>
      <Running r={r} section="Classifieds" n={n} />
      <div className="np-sec">Classifieds</div>
      <div style={{ columns: 2, columnGap: 22, marginTop: 34 }}>{ads.map((a, i) => <div key={i} className="np-ad" style={{ breakInside: 'avoid', marginBottom: 22 }}><b>{smart(a.b)}</b>{smart(a.t)}</div>)}</div>
      <div className="np-foot"><span>Ads taken by DNS only</span><span>Set by Valet</span></div>
    </>
  );
}

/** Page one: the headline only this household could have. */
function Extra({ r }: { r: Recap }) {
  const text = r.lead?.headline ?? `${r.persona.name.toUpperCase()} NAMED PERSON OF THE YEAR`;
  return (
    <>
      <div className="np-mast" style={{ fontSize: Math.min(150, 1500 / r.paper.length) }}>{r.paper}</div>
      <div style={{ textAlign: 'center', fontStyle: 'italic', fontSize: 28, margin: '14px 0 16px' }}>“All the logs that are fit to print”</div>
      <div className="np-flag"><span>VOL. {roman(r.year - 2000)}</span><span>{dateline()}</span><span>FREE (SELF-HOSTED)</span></div>
      <div className="np-sec" style={{ textAlign: 'center', fontSize: 72, marginTop: 64 }}>Extra! Extra!</div>
      <h1 className="np-head" style={{ fontSize: text.length > 60 ? 112 : 132, textAlign: 'center', marginTop: 34 }}>{text}</h1>
      {r.lead && <p className="np-deck" style={{ textAlign: 'center', fontSize: 46, marginTop: 40 }}>{smart(r.lead.deck)}</p>}
      <div className="np-inside">
        <div className="np-inside-k">Inside today</div>
        {r.slides.filter(s => s.section && !s.private).slice(0, 4).map((s, n) => <div key={s.id}><i>{s.section}</i><span>{smart(s.headline ?? s.kicker)}</span><b>{r.slides.indexOf(s) + 2}</b></div>)}
      </div>
      <div className="np-stamp" style={{ top: 268, bottom: 'auto', right: 62, fontSize: 25, padding: '8px 14px' }}>Year-end<br />edition</div>
      <div className="np-foot"><span>Tap to turn the page</span><span>Set by Valet</span></div>
    </>
  );
}

function Person({ r, n }: { r: Recap; n: number }) {
  const tail = r.persona.name.replace(/^The /, '');
  return (
    <>
      <div className="np-mast" style={{ fontSize: 84 }}>{r.paper}</div>
      <div className="np-flag" style={{ marginTop: 18 }}><span>PERSON OF THE YEAR</span><span>{r.year}</span><span>PAGE {n}</span></div>
      <div style={{ margin: 'auto 0', textAlign: 'center' }}>
        <div style={{ fontSize: 52, fontStyle: 'italic' }}>{r.editor ? `${r.editor}, this year you were` : 'This year you were'}</div>
        <div className="np-fig" style={{ fontSize: tail.length > 12 ? 148 : 200, marginTop: 40, lineHeight: .95 }}>The<br />{tail}</div>
        <p style={{ fontSize: 44, lineHeight: 1.22, marginTop: 56, textWrap: 'balance' }}>{smart(r.persona.line)}</p>
      </div>
      <div className="np-stamp" style={{ top: 'auto', bottom: 170, right: 96 }}>Verified<br />by logs</div>
      <div className="np-foot"><span>Decided by the numbers. No committee met.</span><span>Set by Valet</span></div>
    </>
  );
}

/** The paper's one staff photographer. Every picture is drawn here, so nothing real ever leaves the house. */
function photo(kind: number) {
  const c = document.createElement('canvas'), x = c.getContext('2d')!, w = 640, h = 440;
  c.width = w; c.height = h;
  const wall = x.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, '#f4f4f4'); wall.addColorStop(1, '#a8a8a8');
  x.fillStyle = wall; x.fillRect(0, 0, w, h);
  const box = (l: number, t: number, wd: number, ht: number, f: string) => { x.fillStyle = f; x.fillRect(l, t, wd, ht); };
  const cables = (n: number, y: number) => { x.strokeStyle = '#111'; x.lineWidth = 5; for (let i = 0; i < n; i++) { x.beginPath(); x.moveTo(40 + i * 53, y - 90 + (i * 37) % 80); x.bezierCurveTo(200 + i * 31, 40 + (i * 90) % 300, 500 - i * 37, 420 - (i * 61) % 240, 560 - (i * 47) % 420, y + (i * 23) % 60); x.stroke(); } };
  if (kind === 1) {                                                                  // the sofa, lit by the television
    box(0, 330, w, 110, '#888');
    box(40, 70, 300, 190, '#111'); box(52, 82, 276, 166, '#fff');
    x.fillStyle = '#222'; x.beginPath(); x.arc(190, 170, 46, 0, 7); x.fill(); box(120, 214, 140, 34, '#222');
    box(380, 214, 240, 96, '#1a1a1a'); box(366, 190, 30, 120, '#111'); box(604, 190, 30, 120, '#111'); box(380, 176, 240, 50, '#2c2c2c');
    for (const p of [440, 520]) { x.fillStyle = '#0c0c0c'; x.beginPath(); x.arc(p, 152, 26, 0, 7); x.fill(); box(p - 30, 176, 60, 60, '#0c0c0c'); }
  } else if (kind === 2) {                                                           // the disks
    box(0, 352, w, 88, '#8a8a8a');
    for (let r = 0; r < 4; r++) for (let d = 0; d < 7; d++) {
      const l = 40 + d * 80, t = 60 + r * 74;
      box(l, t, 70, 62, '#161616'); box(l + 6, t + 8, 58, 8, '#555');
      x.fillStyle = (r * 3 + d * 5) % 4 ? '#fff' : '#333'; x.fillRect(l + 54, t + 46, 8, 8);
    }
  } else if (kind === 3) {                                                           // the cables
    box(0, 0, w, h, '#d8d8d8'); cables(16, 390); box(0, 0, 640, 22, '#111');
    box(250, 170, 150, 86, '#fff'); x.strokeStyle = '#111'; x.lineWidth = 4; x.strokeRect(250, 170, 150, 86);
    x.fillStyle = '#111'; x.font = '700 30px serif'; x.textAlign = 'center'; x.fillText('DO NOT', 325, 208); x.fillText('TOUCH', 325, 242);
  } else {                                                                            // the rack
    box(0, 362, w, 80, '#7c7c7c');
    box(36, 96, 66, 92, '#c9c9c9'); box(42, 102, 54, 80, '#efefef');
    for (const [left, top, wide, tall] of [[128, 46, 142, 322], [292, 22, 176, 350], [490, 74, 112, 296]]) {
      box(left, top, wide, tall, '#141414');
      for (let u = top + 12; u < top + tall - 24; u += 30) {
        box(left + 10, u, wide - 20, 22, '#3d3d3d');
        for (let l = 0; l < 6; l++) box(left + 18 + l * 14, u + 7, 8, 8, (u * 7 + l * 13 + left) % 5 < 2 ? '#fff' : '#111');
      }
    }
  }
  return c.toDataURL();
}
const PHOTOS: [number, string][] = [[1, 'Residents await the next episode.'], [3, 'Investigators at the scene of the cable run.'], [2, 'The disks, shortly before being told about the new arrivals.'], [0, 'The server, pictured in happier times.']];

/** The front page, drawn. This canvas is both what's on screen and what's saved. */
async function drawFront(c: HTMLCanvasElement, r: Recap, titles: boolean) {
  await Promise.all(['700 80px UnifrakturCook', '800 80px "Newsreader Variable"', '400 30px "Newsreader Variable"', 'italic 400 30px "Newsreader Variable"'].map(f => document.fonts.load(f).catch(() => {})));
  const x = c.getContext('2d')!, ink = '#17130e', m = 58;
  x.fillStyle = '#efe8d9'; x.fillRect(0, 0, W, H); x.fillStyle = ink; x.strokeStyle = ink; x.textBaseline = 'alphabetic';
  const font = (s: string) => { x.font = s; }, line = (y: number, w = 2) => { x.lineWidth = w; x.beginPath(); x.moveTo(m, y); x.lineTo(W - m, y); x.stroke(); };
  const wrap = (text: string, left: number, top: number, width: number, height: number) => {
    const words = text.split(/\s+/); let l = '', y = top;
    for (const w of words) { const t = l ? `${l} ${w}` : w; if (x.measureText(t).width > width && l) { x.fillText(l, left, y); y += height; l = w; } else l = t; }
    if (l) x.fillText(l, left, y);
    return y + height;
  };
  const center = (t: string, y: number) => { x.textAlign = 'center'; x.fillText(t, W / 2, y); x.textAlign = 'left'; };
  let size = 168; do { font(`700 ${size}px UnifrakturCook`); size -= 4; } while (x.measureText(r.paper).width > W - m * 2 && size > 60);
  center(r.paper, 176);
  font('italic 400 25px "Newsreader Variable"'); center('“All the logs that are fit to print”', 226);
  line(242, 3); font('400 23px "Newsreader Variable"');
  x.fillText(`VOL. ${roman(r.year - 2000)}`, m, 272); center(dateline(), 272); x.textAlign = 'right'; x.fillText('FREE (SELF-HOSTED)', W - m, 272); x.textAlign = 'left';
  line(286, 1); line(291, 3);
  const lead = r.lead ?? { headline: (r.slides[0]?.headline ?? `${r.persona.name.toUpperCase()} NAMED PERSON OF THE YEAR`), deck: r.slides[0]?.line ?? '' };
  let hs = 100; const lines = (s: number) => { font(`800 ${s}px "Newsreader Variable"`); const out: string[] = []; let l = ''; for (const w of lead.headline.split(' ')) { const t = l ? `${l} ${w}` : w; if (x.measureText(t).width > W - m * 2 && l) { out.push(l); l = w; } else l = t; } out.push(l); return out; };
  let ls = lines(hs); while (ls.length > 3 && hs > 70) { hs -= 4; ls = lines(hs); }
  let y = 306 + hs; for (const l of ls) { center(l, y); y += hs * 1.0; }
  font('italic 400 37px "Newsreader Variable"'); center(smart(lead.deck), y + 2); y += 34;
  line(y, 1); y += 22;
  const col = (W - m * 2 - 56) / 3, stories = r.slides.filter(s => s.headline && !s.private && s.id !== 'watch.top' && s.kind !== 'classified' && s.kind !== 'obituary').slice(0, 6);
  const top = r.slides.find(s => s.kind === 'listing' && s.items?.[0]?.image), picW = col * 2 + 28, picH = 318, floor = H - 236;
  const heads: [RecapSlide, number, number, number][] = [];
  let ly = y;                                                     // left column, then the picture, then the rest under it
  // a story runs only if it fits above the corrections; a paper doesn't overprint itself
  const measure = (text: string, width: number, height: number) => { let l = '', n = 1; for (const w of text.split(/\s+/)) { const t = l ? `${l} ${w}` : w; if (x.measureText(t).width > width && l) { n++; l = w; } else l = t; } return n * height; };
  const story = (s: RecapSlide, left: number, topY: number, width: number) => {
    const head = smart(s.headline), body = smart((s.story ?? s.line).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s.line);
    font('800 33px "Newsreader Variable"'); const hh = measure(head, width, 34);
    font('400 25px "Newsreader Variable"'); const bh = measure(body, width, 29);
    if (topY + 30 + hh > floor) return topY;
    font('800 33px "Newsreader Variable"'); let yy = wrap(head, left, topY + 30, width, 34);
    if (yy + bh <= floor) { font('400 25px "Newsreader Variable"'); yy = wrap(body, left, yy + 2, width, 29); }
    return yy + 8;
  };
  const [a, b, d, e] = stories;
  if (a) ly = story(a, m, ly, col);
  if (b) ly = story(b, m, ly, col);
  const px = m + col + 28; let ry = y;
  const pic = titles && top?.items?.[0]?.image ? top.items[0].image : photo(0);
  await halftone(pic, x, px, y + 6, picW, picH, ink, 6).catch(() => {});
  x.fillStyle = ink; font('italic 400 24px "Newsreader Variable"');
  x.fillText(titles && top?.items?.[0] ? `“${top.items[0].name}”: most watched in ${r.year}` : 'The server, pictured in happier times.', px, y + picH + 34); ry = y + picH + 50;
  x.lineWidth = 1; x.beginPath(); x.moveTo(px - 14, y + 4); x.lineTo(px - 14, floor + 8); x.stroke();
  if (d) { const end = story(d, px, ry, col); if (e) story(e, px + col + 28, ry, col); ry = end; }
  const box = H - 214; line(box - 12, 3);
  font('800 27px "Newsreader Variable"'); x.fillText('CORRECTIONS', m, box + 26);
  font('400 23px "Newsreader Variable"'); wrap((r.corrections[0] ?? 'None. The numbers are real.'), m, box + 58, 640, 27);
  x.strokeRect(W - m - 256, box + 4, 256, 138);
  font('italic 400 23px "Newsreader Variable"'); x.fillText('Person of the Year', W - m - 240, box + 38); font('800 30px "Newsreader Variable"'); wrap(r.persona.name, W - m - 240, box + 78, 228, 32);
  line(H - 54, 1); font('italic 400 22px "Newsreader Variable"'); x.fillText('Set and printed at home by Valet', m, H - 24); x.textAlign = 'right'; x.fillText(`${r.year}${r.soFar ? ', so far' : ''}`, W - m, H - 24); x.textAlign = 'left';
}

const presses = new Map<string, Promise<HTMLCanvasElement>>();
const drawn = (r: Recap, titles: boolean) => { const key = `${r.year}${titles}`; if (!presses.has(key)) { const c = document.createElement('canvas'); c.width = W; c.height = H; presses.set(key, drawFront(c, r, titles).then(() => c)); } return presses.get(key)!; };

function Front({ r, titles }: { r: Recap; titles: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { void drawn(r, titles).then(c => ref.current?.getContext('2d')?.drawImage(c, 0, 0)); }, [r, titles]);
  return <canvas ref={ref} width={W} height={H} style={{ position: 'absolute', inset: 0, width: W, height: H }} />;
}

export default function RecapStory({ onClose, year }: { onClose: () => void; year?: number }) {
  const [r, setR] = useState<Recap | null>(null), [failed, setFailed] = useState(false), [i, setI] = useState(0), [held, setHeld] = useState(false), [titles, setTitles] = useState(false), [k, setK] = useState(1);
  useEffect(() => { fetch(`/api/recap${year ? `?year=${year}` : ''}`).then(x => x.ok ? x.json() : Promise.reject()).then(setR, () => setFailed(true)); }, [year]);
  useEffect(() => { if (r) void drawn(r, false); }, [r]);          // on the presses already, so the last page lands whole
  useLayoutEffect(() => { const fit = () => setK(Math.min(innerWidth / W, innerHeight / H) * (innerWidth > 700 ? .94 : 1)); fit(); addEventListener('resize', fit); return () => removeEventListener('resize', fit); }, []);
  // classifieds share one page; everything else is a page of its own
  const pages: ReactNode[] = [], ads = r?.slides.filter(s => s.kind === 'classified') ?? [];
  const tints: string[] = [];
  if (r) {
    tints.push(''); pages.push(<Extra r={r} />);
    r.slides.filter(s => s.kind !== 'classified').forEach((s, n) => { tints.push(TINT[s.section ?? ''] ?? ''); pages.push(s.kind === 'obituary' ? <Obituary s={s} r={r} n={n + 2} /> : <Feature s={s} r={r} n={n + 2} />); });
    if (ads.length) { tints.push(''); pages.push(<Classifieds list={ads} r={r} n={pages.length + 2} />); }
    tints.push(''); pages.push(<Person r={r} n={pages.length + 2} />);
    tints.push(''); pages.push(null);                              // the front page
  }
  const last = pages.length, front = i === last, go = useCallback((by: number) => setI(n => Math.max(0, Math.min(last, n + by))), [last]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight' || e.key === ' ') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [go, onClose]);
  useEffect(() => { if (!r || held || front || !r.slides.length) return; const t = setTimeout(() => go(1), i ? STEP : 4200); return () => clearTimeout(t); }, [r, i, held, front, go]);
  const pressed = useRef(0);
  const save = () => { const c = document.querySelector<HTMLCanvasElement>('.np-front canvas'); c?.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${r!.paper.toLowerCase().replace(/\s+/g, '-')}-${r!.year}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png'); };
  const tilt = `${((i * 37) % 13 - 6) / 5}deg`;
  const wait = (t: string) => <div style={{ color: '#efe8d9', fontSize: 30, fontStyle: 'italic' }}>{t}</div>;
  return createPortal(
    <div lang="en" role="dialog" aria-modal aria-label={r ? `${r.paper}, ${r.year}` : 'Your year in review'} className="np"
      onPointerDown={() => { pressed.current = Date.now(); setHeld(true); }}
      onPointerUp={e => { setHeld(false); if (Date.now() - pressed.current < 280) go(e.clientX < innerWidth * .28 ? -1 : 1); }}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden><filter id="np-ink"><feTurbulence baseFrequency=".7" numOctaves="2" seed="3" /><feDisplacementMap in="SourceGraphic" scale="1.3" /></filter></svg>
      {!r ? wait(failed ? 'The presses have jammed.' : 'Stop the presses…') : !r.slides.length ? wait('No news yet. Connect a service or two and come back.') : (
        <div className="np-scale" style={{ transform: `scale(${k})` }}>
          <div className="np-thud" key={`t${i}`}>
            <div className={`np-page np-spin ${front ? 'np-front' : ''}`} data-tint={tints[i]} style={{ '--tilt': front ? '0deg' : tilt } as React.CSSProperties} key={i}>
              {front ? <Front r={r} titles={titles} /> : pages[i]}
            </div>
          </div>
        </div>
      )}
      {r && last > 0 && <div className="np-seg">{Array.from({ length: last + 1 }, (_, n) => <span key={n}><i className={n === i && !front ? 'on' : ''} style={n < i || front ? { width: '100%' } : n === i ? { animationDuration: `${i ? STEP : 4200}ms`, animationPlayState: held ? 'paused' : 'running' } : { width: 0 }} /></span>)}</div>}
      <button aria-label="Close" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={onClose} className="np-ui press grid size-10 place-items-center rounded-full bg-black/55 text-white" style={{ top: 22, right: 14 }}><X className="size-5" /></button>
      {r && front && <div className="np-ui flex gap-2" style={{ bottom: 18, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans, system-ui)' }} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
        <button onClick={save} className="press flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black shadow-lg"><Download className="size-4" />Save front page</button>
        <button onClick={() => setTitles(t => !t)} className="press flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[14px] font-medium text-white shadow-lg">{titles ? <Eye className="size-4" /> : <EyeOff className="size-4" />}{titles ? 'Showing top title' : 'No titles'}</button>
      </div>}
    </div>, document.body);
}
