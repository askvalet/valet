// An example background script for Valet: a slow field of ASCII characters, drawn on a canvas in the theme's colours.
// Copy it to data/backgrounds/ascii-flow.js and set `appearance.background: ascii-flow`.
//
// Valet calls the default export with a full-screen box behind the cards, and the theme and tab it's on:
//   mount(el, { theme, tab }) → { update({ theme, tab }), destroy() }
// It never runs with appearance.motion reduced or none, or when the device asks for less motion.

const RAMP = ' .:-=+*#%@';   // light to dense
const CELL = 14;             // px per character
const FPS = 24;              // enough for something this slow, and much lighter on the glass over it

export default function mount(el, ctx) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  el.appendChild(canvas);
  const g = canvas.getContext('2d');
  let theme = ctx.theme, w = 0, h = 0, cols = 0, rows = 0, raf = 0, last = 0, colour = '', ink = '';

  // the theme's colours, from the page's own CSS variables, so it follows accent and light or dark
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    colour = css.getPropertyValue('--primary').trim() || '#0a84ff';
    ink = theme === 'dark' ? 'rgb(10 10 14)' : 'rgb(246 246 248)';
  };
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = el.getBoundingClientRect();
    w = r.width; h = r.height; cols = Math.ceil(w / CELL); rows = Math.ceil(h / CELL);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `${CELL - 2}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.textBaseline = 'top';
  };
  // two slow waves crossing: smooth, and cheap enough to work out for every character every frame
  const field = (x, y, t) => (Math.sin(x * .09 + t * .6) + Math.sin(y * .13 - t * .45) + Math.sin((x + y) * .05 + t * .3)) / 3;

  const draw = now => {
    raf = requestAnimationFrame(draw);   // the browser stops calling this while the tab is hidden
    if (now - last < 1000 / FPS) return;
    last = now;
    const t = now / 1000;
    g.fillStyle = ink; g.fillRect(0, 0, w, h);
    g.fillStyle = colour;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const v = (field(x, y, t) + 1) / 2, c = RAMP[Math.min(RAMP.length - 1, Math.floor(v * v * RAMP.length))];
      if (c === ' ') continue;
      g.globalAlpha = .15 + v * .55;
      g.fillText(c, x * CELL, y * CELL);
    }
    g.globalAlpha = 1;
  };

  const seen = new ResizeObserver(size);
  seen.observe(el);
  read(); size(); raf = requestAnimationFrame(draw);
  return {
    update(next) { theme = next.theme; read(); },
    destroy() { cancelAnimationFrame(raf); seen.disconnect(); canvas.remove(); },
  };
}
