// What you take off the page leaves as dust: archived, removed, cleared or waved away, it comes apart from the left and
// drifts off up and to the right while the room it leaves closes. Only for what someone just did: a list that merely
// changed keeps its own quiet ways. One copy of the thing, on the body where it was, so the real one can go at once and the
// list close up under it. The copy is masked away and the specks are one small canvas, drawn for about 700 ms and gone.
// Held still (the system's setting or appearance.motion), it's a quick fade and no specks.
import { useLayoutEffect, useRef } from 'react';
import { play } from './sound.ts';

/** True when this page has been asked to hold still: the system's setting or appearance.motion, through the one --move. */
const calm = (el: Element) => getComputedStyle(el).getPropertyValue('--move').trim() === '0';

let actedAt = 0;
/** Someone just did something that can take things off the page: an action, an approval. */
export const acted = () => { actedAt = Date.now(); };
/** Whether what leaves now is their doing. An approval runs a tool, and the page hears of it a few seconds later. */
export const justActed = (ms = 15_000) => Date.now() - actedAt < ms;

const SWEEP = 300, LIFE = 440, PAD = 56;
interface Speck { x: number; y: number; dx: number; dy: number; at: number; life: number; size: number; color: string; alpha: number; wob: number }

const clear = (c: string) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);

/** A rough picture of the element, two pixels to a cell: its surfaces in their colours, its words as their lines in the
 *  words' colour, its pictures as they are. Specks only come from what's painted, so a row of text turns to the dust of
 *  its words, not of the empty glass around them. */
function sketch(el: HTMLElement, box: DOMRect, cell: number) {
  const w = Math.max(1, Math.ceil(box.width / cell)), h = Math.max(1, Math.ceil(box.height / cell));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); if (!g) return null;
  const fill = (r: DOMRect, color: string) => { g.fillStyle = color; g.fillRect((r.left - box.left) / cell, (r.top - box.top) / cell, Math.max(1, r.width / cell), Math.max(1, r.height / cell)); };
  for (const n of [el, ...el.querySelectorAll<HTMLElement>('*')].slice(0, 500)) {
    const st = getComputedStyle(n);
    if (st.visibility === 'hidden' || +st.opacity === 0) continue;
    if (!clear(st.backgroundColor)) fill(n.getBoundingClientRect(), st.backgroundColor);
    if (n instanceof SVGSVGElement) fill(n.getBoundingClientRect(), st.color);
    if (n instanceof HTMLImageElement && n.complete && n.naturalWidth) {
      const r = n.getBoundingClientRect();
      try { g.drawImage(n, (r.left - box.left) / cell, (r.top - box.top) / cell, r.width / cell, r.height / cell); } catch { /* not drawable */ }
    }
  }
  const words = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), range = document.createRange();
  for (let t = words.nextNode(); t; t = words.nextNode()) {
    if (!t.textContent?.trim() || !t.parentElement) continue;
    range.selectNodeContents(t);
    const color = getComputedStyle(t.parentElement).color;
    for (const r of range.getClientRects()) fill(new DOMRect(r.left, r.top + r.height * .2, r.width, r.height * .6), color);
  }
  try { return { data: g.getImageData(0, 0, w, h).data, w, h }; } catch { return null; }   // a picture from elsewhere taints it
}

/** The specks: one for every few painted pixels, coloured by what was there, leaving in the order the sweep reaches them. */
function specks(el: HTMLElement, box: DOMRect) {
  const cell = 2, seen = sketch(el, box, cell), out: Speck[] = [];
  if (!seen) return out;
  let painted = 0;
  for (let i = 3; i < seen.data.length; i += 4) if (seen.data[i] > 8) painted++;
  const stride = Math.max(1, Math.round(Math.sqrt(painted / 1600)));   // about 1600 at most, however big it is
  for (let y = 0; y < seen.h; y += stride) for (let x = 0; x < seen.w; x += stride) {
    const i = (y * seen.w + x) * 4; if (seen.data[i + 3] <= 8) continue;
    const px = x * cell, py = y * cell;
    out.push({ x: px + Math.random() * stride * cell, y: py + Math.random() * stride * cell, dx: 18 + Math.random() * 54, dy: -(10 + Math.random() * 42), at: (px / box.width) * SWEEP * .9 + Math.random() * 70,
      life: LIFE * (.7 + Math.random() * .5), size: Math.random() < .2 ? 2.2 : 1.4, color: `rgb(${seen.data[i]} ${seen.data[i + 1]} ${seen.data[i + 2]})`, alpha: (.5 + Math.random() * .5) * seen.data[i + 3] / 255, wob: Math.random() * 6.28 });
  }
  return out;
}

/** Takes `el` off the page as dust. The element itself is hidden at once (it's about to go anyway) and comes back after,
 *  in case it didn't: a removal that failed puts the thing back. */
export function dissolve(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  const box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) return;
  const style = getComputedStyle(el), still = calm(el);
  const ghost = el.cloneNode(true) as HTMLElement, layer = document.createElement('div');
  ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
  Object.assign(ghost.style, { width: '100%', height: '100%', margin: '0', boxSizing: 'border-box', transform: 'none', translate: 'none', opacity: '1' });
  layer.className = 'dust';
  Object.assign(layer.style, { left: `${box.left + scrollX}px`, top: `${box.top + scrollY}px`, width: `${box.width}px`, height: `${box.height}px`, color: style.color, font: style.font, borderRadius: style.borderRadius });
  layer.append(ghost); document.body.append(layer);
  const was = el.style.opacity; el.style.opacity = '0';
  const end = (ms: number) => setTimeout(() => { layer.remove(); el.style.opacity = was; }, ms);
  play('dust');
  if (still) { ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' }); end(180); return; }

  ghost.animate([{ maskPosition: '100% 0' }, { maskPosition: '0% 0' }], { duration: SWEEP, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
  const list = specks(el, box), canvas = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = box.width + PAD * 2, H = box.height + PAD * 2;
  canvas.width = Math.ceil(W * dpr); canvas.height = Math.ceil(H * dpr);
  Object.assign(canvas.style, { left: `${-PAD}px`, top: `${-PAD}px`, width: `${W}px`, height: `${H}px` });
  layer.append(canvas);
  const g = canvas.getContext('2d'); if (!g) { end(SWEEP); return; }
  g.scale(dpr, dpr);
  const last = Math.max(...list.map(s => s.at + s.life), SWEEP);
  let t0 = 0;
  const frame = (t: number) => {
    t0 ||= t;
    const now = t - t0;
    g.clearRect(0, 0, W, H);
    for (const s of list) {
      const p = (now - s.at) / s.life;
      if (p <= 0 || p >= 1) continue;
      const e = 1 - (1 - p) ** 3;   // ease out: a puff, then drifting
      g.globalAlpha = s.alpha * (1 - p) ** 1.4;
      g.fillStyle = s.color;
      const size = s.size * (1 - p * .5);
      g.fillRect(PAD + s.x + s.dx * e + Math.sin(s.wob + p * 5) * 2, PAD + s.y + s.dy * e, size, size);
    }
    if (now < last) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  end(last + 40);
}

/** A list closing up: when its children change, what's still there glides from where it was to where it is, by transform
 *  alone, so the room something left closes instead of jumping. Children are matched by their data-key. */
export function useSettle<T extends HTMLElement>(sig: string) {
  const ref = useRef<T>(null), was = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const box = ref.current; if (!box) return;
    const at = box.getBoundingClientRect(), now = new Map<string, { x: number; y: number }>();
    for (const c of box.children as HTMLCollectionOf<HTMLElement>) {
      const r = c.getBoundingClientRect(), key = c.dataset.key; if (!key) continue;
      now.set(key, { x: r.left - at.left, y: r.top - at.top });
      const from = was.current.get(key);
      if (!from || calm(box) || (Math.abs(from.x - (r.left - at.left)) < 1 && Math.abs(from.y - (r.top - at.top)) < 1)) continue;
      c.animate([{ transform: `translate(${from.x - (r.left - at.left)}px, ${from.y - (r.top - at.top)}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    was.current = now;
  }, [sig]);
  return ref;
}
