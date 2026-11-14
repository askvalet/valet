// Motion (motion.dev), for the few gestures that want real physics: a throw that keeps its speed, a spring that settles.
// It's about 25 KB, so it's never on the first load: the page fetches it when it's idle, and until it's here everything
// moves the way it always did, with CSS. Held still (the system's setting or appearance.motion), nothing asks for it.
type Motion = typeof import('./motion-kit.ts');
let mod: Motion | undefined, loading: Promise<Motion> | undefined;
/** Fetches Motion once; the same promise after that. */
export const loadMotion = () => loading ??= import('./motion-kit.ts').then(m => (mod = m));
/** Motion if it's here already, so a gesture can use it without waiting a frame. */
export const motionNow = () => mod;

/** What Motion is doing to an element right now, so a finger that lands on it mid-spring can take over from where it is. */
export const moving = new WeakMap<Element, { stop: () => void }>();
/** Where an element's own transform has it right now, mid-animation or not. */
export const shift = (el: Element) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.m41, y: m.m42 }; };
const calm = (el: Element) => getComputedStyle(el).getPropertyValue('--move').trim() === '0';

/** A window arriving on a spring instead of the CSS ease: up and in from below in the middle, in from its side when it's
 *  docked, and up from the bottom edge as a phone's sheet (with no bounce there, so the bottom never shows). Goes on the
 *  element as a ref, so it starts before the first paint; until Motion is here, or held still, the CSS one plays. */
export function springIn(el: HTMLElement | null) {
  const m = motionNow(); if (!el || !m || calm(el)) return;
  const phone = matchMedia('(max-width: 639px)').matches, place = el.dataset.place;
  const side = !phone && (place === 'right' || place === 'left') ? (place === 'right' ? 24 : -24) : 0;
  el.dataset.sprung = '';
  const from = phone ? { y: innerHeight, opacity: 1, scale: 1, x: 0 } : side ? { x: side, y: 0, opacity: 0, scale: 1 } : { x: 0, y: 14, opacity: 0, scale: .96 };
  el.style.opacity = String(from.opacity); el.style.transform = `translate(${from.x}px, ${from.y}px) scale(${from.scale})`;
  const run = m.animate(el, { x: [from.x, 0], y: [from.y, 0], scale: [from.scale, 1], opacity: [from.opacity, 1] },
    phone ? { type: 'spring', visualDuration: .42, bounce: 0 } : { type: 'spring', visualDuration: .4, bounce: .22, opacity: { duration: .16, ease: 'easeOut' } });
  moving.set(el, run);
  void run.finished.then(() => { if (moving.get(el) === run) moving.delete(el); });
}
