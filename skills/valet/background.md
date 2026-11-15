# Valet: a background script

A background script draws behind the cards: an animated canvas, particles, a slow field of characters. It fills the screen, sits over the wallpaper if there is one, and the cards turn to glass over it.

## Turn one on

Put the file at `data/backgrounds/<name>.js` (`/app/data/backgrounds/` in the container) and name it without `.js`:

```yaml
appearance:
  background: ascii-flow                         # data/backgrounds/ascii-flow.js
  # background: { light: paper, dark: ascii-flow }
  # backgrounds: { Media: none, Home: rain }     # per tab, by tab name; none turns it off there
```

- The name is lowercase letters, digits and dashes, up to 64 characters.
- `config check` names a script that isn't in the folder.
- Config changes apply live. After editing the script itself, reload the page.
- The wall display runs `background`, the same for every page.
- Only the owner can turn one on: the assistant can't set `background` or `backgrounds`. Say so if the user asks the assistant to.

`examples/backgrounds/ascii-flow.js` in the repo is a complete one to start from.

## The contract

The default export is called once, with a box to draw in and what's on screen. It returns `update` and `destroy`.

```js
// data/backgrounds/my-background.js
export default function mount(el, { theme, tab }) {
  // el: fills the screen, takes no clicks
  // theme: 'light' or 'dark'
  // tab: the tab on screen; '' on the overview and the wall
  return {
    update({ theme, tab }) { /* the theme or the tab changed */ },
    destroy() { /* stop every frame, observer and timer; remove what you added */ },
  };
}
```

`destroy` runs when the page goes to a tab with another background or none, when the theme switches to another script, and when motion is turned down. Clean up fully: a loop left running keeps drawing into nothing and costs the battery.

## A starting point

```js
// data/backgrounds/drift.js: soft dots drifting, in the accent colour
const FPS = 24;

export default function mount(el, ctx) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  el.appendChild(canvas);
  const g = canvas.getContext('2d', { alpha: false });   // opaque: it paints every pixel
  let theme = ctx.theme, w = 0, h = 0, raf = 0, last = 0, ink = '', paper = '';
  const dots = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 3, v: .002 + Math.random() * .004 }));

  const colours = () => {
    const css = getComputedStyle(document.documentElement);
    ink = css.getPropertyValue('--primary').trim() || '#0a84ff';
    paper = css.getPropertyValue('--background').trim() || (theme === 'dark' ? '#0f0f10' : '#f5f5f7');
  };
  const paint = () => {
    g.fillStyle = paper; g.fillRect(0, 0, w, h);
    g.fillStyle = ink; g.globalAlpha = .5;
    for (const d of dots) { g.beginPath(); g.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  };
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2), r = el.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();                                             // a resize blanks the canvas: fill it now
  };
  const frame = now => {
    raf = requestAnimationFrame(frame);                  // the browser pauses this while the tab is hidden
    if (now - last < 1000 / FPS) return;
    last = now;
    for (const d of dots) d.y = (d.y - d.v + 1) % 1;
    paint();
  };

  const seen = new ResizeObserver(size);
  seen.observe(el);
  colours(); size(); raf = requestAnimationFrame(frame);
  return {
    update(next) { theme = next.theme; colours(); paint(); },
    destroy() { cancelAnimationFrame(raf); seen.disconnect(); canvas.remove(); },
  };
}
```

## Theme colours

Read them from the page's CSS variables, so the script follows the accent and light or dark:

```js
const css = getComputedStyle(document.documentElement);
css.getPropertyValue('--primary')            // the accent (appearance.colors.accent)
```

| Variable | Is |
|---|---|
| `--primary` | The accent |
| `--background`, `--foreground` | The page's own colour, and text |
| `--muted-foreground` | Quiet text |
| `--good`, `--warn`, `--bad` | Status colours |
| `--card` | The card tint |

Read them again in `update`, because the theme may have changed. Don't hard-code a light or dark palette when a variable has it.

## Keep it light

Every glass card blurs what's behind it, so a background that changes every frame makes the browser redraw every card's blur every frame.

- **Draw with `requestAnimationFrame`**, never `setInterval`. The browser stops calling it while the tab is hidden.
- **Don't draw more often than you need.** Cap the rate: 24 frames a second is plenty for something slow. Skip frames by time, as above.
- **Cap the pixel ratio at 2.** A high-resolution screen has four times the pixels.
- **Paint again as soon as you resize.** Resizing a canvas blanks it. If you paint every pixel, an opaque canvas (`getContext('2d', { alpha: false })`) means a missed frame shows your colour, not the wallpaper.
- **Size from the box** with a `ResizeObserver` on `el`, not from `window`. The box stays the size of the largest viewport, so phone toolbars don't resize it.
- **Keep the work per frame small.** Simple maths per point; no layout reads in the loop; no DOM nodes added per frame.

## Reduced motion

Valet never runs a background script when `appearance.motion` is `reduced` or `none`, or when the device asks for less motion. It doesn't mount it, and it calls `destroy` if the setting changes while it's running. Then the wallpaper, or the page's colour, is all there is. So the script needs no motion check of its own, but `destroy` must stop everything.

## What it may do

- One file. The page's policy allows scripts and requests only from Valet itself, so no imports or fetches from a CDN or an API. Images from `https://` and inline styles are fine.
- No `eval` or `new Function`.
- It runs on the page with Valet's own reach, like a plugin's visual. Only use a script you wrote or have read.
