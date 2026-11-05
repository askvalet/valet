// Service icons that would vanish on the glass. The icon set draws some logos white (Karakeep, Uptime Kuma) and some black
// (Miniflux, Tailscale, Vaultwarden), each made for one background. When one loads, it's read once into a small canvas and
// judged against the light glass and the dark glass: if almost none of it stands apart from one of them, it's marked for that
// theme. A logo in one colour (white or black) is turned to the ink, as the set's own other variant would be; a coloured one
// sits on a small plate of the ink, so its colours stay. styles.css draws both ("Service icons"). Only Valet's own icons
// (/api/icon/…) are read; anything on top of a picture is left alone there.
export type Fix = 'invert' | 'plate' | '';
const judged = new Map<string, { light: Fix; dark: Fix }>();
const SIZE = 24, ALPHA = 128;
// the glass each theme draws icons on (relative luminance), how far apart counts as standing out, and the share that must
const GLASS = { light: .9, dark: .025 }, APART = 1.6, ENOUGH = .12, MONO = .08;

const lin = (c: number) => (c /= 255) <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);

/** What an icon needs on each theme's glass, from its pixels (RGBA, as a canvas gives them). */
export function inkFix(px: Uint8ClampedArray): { light: Fix; dark: Fix } {
  const lum: number[] = [];
  let sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA) continue;
    lum.push(.2126 * lin(px[i]) + .7152 * lin(px[i + 1]) + .0722 * lin(px[i + 2]));
    sat += (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2])) / 255;
  }
  if (!lum.length) return { light: '', dark: '' };
  const mono = sat / lum.length < MONO;
  const fix = (glass: number): Fix => lum.filter(l => contrast(l, glass) >= APART).length / lum.length >= ENOUGH ? '' : mono ? 'invert' : 'plate';
  return { light: fix(GLASS.light), dark: fix(GLASS.dark) };
}

function judge(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  try { return inkFix(g.getImageData(0, 0, SIZE, SIZE).data); } catch { return null; }   // another site's picture
}

function mark(img: HTMLImageElement) {
  delete img.dataset.inkLight; delete img.dataset.inkDark;
  let path: string;
  try { path = new URL(img.currentSrc || img.src, location.href).pathname; } catch { return; }
  if (!path.startsWith('/api/icon/')) return;
  let r = judged.get(path);
  if (!r) { const j = judge(img); if (!j) return; judged.set(path, r = j); }
  if (r.light) img.dataset.inkLight = r.light;
  if (r.dark) img.dataset.inkDark = r.dark;
}

/** Watch every image that loads, now and later (load doesn't bubble, so it's caught on the way down). */
export function watchIconInk() {
  document.addEventListener('load', e => { if (e.target instanceof HTMLImageElement) mark(e.target); }, true);
  for (const img of document.images) if (img.complete && img.naturalWidth) mark(img);
}

