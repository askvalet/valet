// Adaptive glass for light mode over a wallpaper: light mode means light glass on every card, so where a card sits over a
// dark part of the wallpaper it isn't flipped dark; its white tint thickens (and on liquid glass its blur deepens) until dark
// words read on it. The wallpaper is read once into a small canvas; each card is then judged from 15 points of it under its own
// box (the two darkest and two brightest dropped), and the cards of one row share one answer. It runs when the layout settles
// (a scroll ending, a resize, a tab, a new wallpaper), never per frame, and a card near a step keeps the one it has. Dark glass
// needs none of this; a wallpaper it can't read (paint, video, another site's picture) leaves the theme's own glass.
const root = () => document.documentElement;
const CARDS = 'main :is([data-slot="card"], .glass):not(.card-look *, .chat-card *, .glass-pop *, [data-slot="card"] *)';
// how light what's behind a card is (0..1, after the page's white veil) below which its tint thickens a step, and the give
// around each step that stops a card near one from trading back and forth
const STEPS = [.62, .5, .38], GIVE = .04;
const stepOf = (l: number, was?: number) => {
  const below = (d: number) => STEPS.filter(s => l < s + d).length;
  return was == null ? below(0) : Math.min(Math.max(was, below(-GIVE)), below(GIVE));
};

const ids = new WeakMap<Element, number>();
let seen = 0;
let wall: { src: string; w: number; h: number; px: Uint8ClampedArray } | null = null, loading = '', timer = 0;
const active = () => ['glass-light', 'has-wallpaper'].every(c => root().classList.contains(c));
const clear = (els: Iterable<HTMLElement>) => { for (const c of els) { delete c.dataset.lift; delete c.dataset.judged; } };

/** The wallpaper as the page draws it (cover, scaled 1.04 from the centre), shrunk to a few dozen pixels across. */
function read(img: HTMLImageElement) {
  const w = 64, h = Math.max(1, Math.round(64 * innerHeight / innerWidth)), c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g || !img.naturalWidth) return null;
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.04, dw = img.naturalWidth * k, dh = img.naturalHeight * k;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  try { return { src: img.currentSrc, w, h, px: g.getImageData(0, 0, w, h).data }; } catch { return null; }   // another site's picture
}

/** How light the wallpaper is at a point on screen, after the page's veil (white, `--wall-dim` strong, in light). */
function lightAt(x: number, y: number, dim: number) {
  const { w, h, px } = wall!;
  const i = (Math.min(h - 1, Math.max(0, Math.floor(y / innerHeight * h))) * w + Math.min(w - 1, Math.max(0, Math.floor(x / innerWidth * w)))) * 4;
  return (.299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2]) / 255 * (1 - dim) + dim;
}

let wallpaper: MutationObserver | undefined, size: ResizeObserver | undefined;
function judge() {
  // the page and its wallpaper come and go with React: (re)watching is free when nothing changed
  const m = document.querySelector('main'), w = document.querySelector('.wallpaper');
  if (m) size?.observe(m); if (w) wallpaper?.observe(w, { childList: true });
  const cards = [...document.querySelectorAll<HTMLElement>(CARDS)];
  if (!active()) { clear(document.querySelectorAll<HTMLElement>('[data-judged]')); return; }
  const img = document.querySelector<HTMLImageElement>('.wallpaper > img:last-of-type');
  if (!img || document.querySelector('.wallpaper')?.lastElementChild !== img) { clear(cards); return; }
  if (!img.complete) { if (loading !== img.src) { loading = img.src; img.addEventListener('load', soon, { once: true }); } return; }
  if (!wall || wall.src !== img.currentSrc || wall.h !== Math.max(1, Math.round(64 * innerHeight / innerWidth))) wall = read(img);
  if (!wall) { clear(cards); return; }
  const dim = Number.parseFloat(getComputedStyle(root()).getPropertyValue('--wall-dim')), veil = Number.isNaN(dim) ? .35 : dim;
  // one row, one answer: cards side by side in the same section, tops within a few pixels
  const rows = new Map<string, { cards: HTMLElement[]; sum: number }>();
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;   // off screen: it keeps what it had
    const points: number[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) points.push(lightAt(r.left + r.width * (i + .5) / 5, r.top + r.height * (j + .5) / 3, veil));
    points.sort((a, b) => a - b);
    const mean = points.slice(2, -2).reduce((a, b) => a + b, 0) / 11;
    const group = c.closest('section') ?? c.parentElement ?? c;
    if (!ids.has(group)) ids.set(group, ++seen);
    const key = `${ids.get(group)}:${Math.round(r.top / 8)}`;
    const row = rows.get(key) ?? rows.set(key, { cards: [], sum: 0 }).get(key)!;
    row.cards.push(c); row.sum += mean;
  }
  for (const { cards: row, sum } of rows.values()) {
    const was = row.find(c => c.dataset.lift)?.dataset.lift, step = stepOf(sum / row.length, was ? Number(was) : row.some(c => c.dataset.judged) ? 0 : undefined);
    for (const c of row) { c.dataset.judged = ''; const v = step ? String(step) : undefined; if (c.dataset.lift !== v) { if (v) c.dataset.lift = v; else delete c.dataset.lift; } }
  }
}

function soon() { clearTimeout(timer); timer = window.setTimeout(judge, 140); }

/** Watches for what moves a card over another part of the wallpaper. Cheap when the glass isn't light. */
export function adaptInk() {
  if (size) return;
  wallpaper = new MutationObserver(soon); size = new ResizeObserver(soon);
  addEventListener('scroll', soon, { passive: true, capture: true });
  addEventListener('resize', soon);
  addEventListener('hashchange', soon);
  new MutationObserver(soon).observe(root(), { attributes: true, attributeFilter: ['class', 'style'] });
  soon();
}
