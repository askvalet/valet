// What a config's appearance comes to on the page: CSS variables for :root and a few classes. The server works it out,
// /api/page carries it and the browser only applies it, so nothing needs a rebuild and a config reload shows at once.
// An option left out adds nothing, so the stylesheet's own value stands: an empty result is exactly the original look.

interface Look {
  appearance: {
    colors?: { accent?: string; good?: string; warn?: string; bad?: string; card?: string };
    font?: { family?: string; mono?: string; scale?: number; headingWeight?: number };
    shape?: { radius?: number; border?: number; borderColor?: string; shadow?: 'none' | 'soft' | 'deep' };
    glass?: { opacity?: number; blur?: number };
    dim: number; blur: number;
    density: 'compact' | 'comfortable' | 'spacious';
    gap?: number; sectionGap?: number; maxWidth?: string; rowHeight?: number;
    motion: 'full' | 'reduced' | 'none';
  };
  chat: { width?: string; height?: string; bubble?: string };
  nav: { size: number };
  menubar: { size: number };
  island?: { size: number };
}

/** black or white, whichever reads on this colour; only a hex can be judged here */
function inkOn(color?: string) {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})/i.exec(color ?? '');
  if (!m) return undefined;
  const hex = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  return .299 * r + .587 * g + .114 * b > 160 ? '#000000' : '#ffffff';
}

const FAMILY_END = ', -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif';
const SHADOWS = {
  soft: '0 1px 2px rgb(0 0 0 / .05), 0 6px 18px -8px rgb(0 0 0 / .18)',
  deep: '0 2px 4px rgb(0 0 0 / .12), 0 24px 48px -16px rgb(0 0 0 / .5)',
};
const tinted = (tint?: string, alpha?: number) => `color-mix(in srgb, ${tint ?? 'var(--card-tint)'} calc(${alpha ?? 'var(--card-alpha)'} * 100%), transparent)`;

export function lookOf({ appearance: a, chat, nav, menubar, island }: Look) {
  const vars: Record<string, string> = {}, classes: string[] = [];
  const set = (value: unknown, ...names: string[]) => { if (value != null) for (const n of names) vars[n] = String(value); };
  const { colors: c, font: f, shape: s, glass: g } = a;

  set(c?.accent, '--primary', '--ring', '--sidebar-primary', '--sidebar-ring');
  set(inkOn(c?.accent), '--primary-foreground', '--sidebar-primary-foreground');
  set(c?.good, '--good'); set(c?.warn, '--warn'); set(c?.bad, '--bad', '--destructive');
  if (c?.card || g?.opacity != null) vars['--card'] = tinted(c?.card, g?.opacity);

  if (f?.family) set(`${f.family}${FAMILY_END}`, '--font-ui');
  if (f?.mono) set(`${f.mono}, ui-monospace, monospace`, '--font-code');
  set(f?.scale, '--font-scale');
  set(f?.headingWeight, '--heading-weight');

  if (s?.radius != null) set(`${s.radius}px`, '--radius');
  if (s?.border != null) set(`${s.border}px`, '--card-border');
  set(s?.borderColor, '--border', '--glass-edge');
  if (s?.shadow) set(s.shadow === 'none' ? 'none' : SHADOWS[s.shadow], '--shadow-card', '--glass-shadow');
  if (s?.shadow === 'none') classes.push('no-shadow');

  // every blur in the stylesheet is a multiple of the cards', so the page's frost stays in proportion
  if (g?.blur === 0) classes.push('no-blur');
  else if (g?.blur != null) set(+(g.blur / 36).toFixed(3), '--frost');

  if (a.dim !== .35) set(a.dim, '--wall-dim');
  if (a.blur) set(`blur(${a.blur}px)`, '--wall-filter');

  if (a.density !== 'comfortable') set(a.density === 'compact' ? '.2rem' : '.3rem', '--spacing');
  if (a.gap != null) set(`${a.gap}px`, '--card-gap', '--tile-gap');
  if (a.sectionGap != null) set(`${a.sectionGap}px`, '--section-gap');
  set(a.maxWidth, '--page-max');
  if (a.rowHeight != null) set(`${a.rowHeight}px`, '--row-h');
  if (a.motion !== 'full') classes.push(`motion-${a.motion}`);

  set(chat.width, '--chat-w'); set(chat.height, '--chat-h');
  set(chat.bubble, '--chat-bubble'); set(inkOn(chat.bubble), '--chat-ink');
  if (nav.size !== 1) set(`${44 * nav.size}px`, '--nav-size');
  if (menubar.size !== 1) set(menubar.size, '--bar-zoom');
  if (island && island.size !== 1) set(island.size, '--island-zoom');
  return { vars, classes };
}

/** One card's own surface, from its layout entry: variables that hold for that card alone. */
export function cardLook(w: { tint?: string; opacity?: number; blur?: number; background?: string }) {
  if (w.tint == null && w.opacity == null && w.blur == null && !w.background) return undefined;
  const vars: Record<string, string> = {};
  // a picture needs its tint thinned, or the card hides it
  if (w.tint != null || w.opacity != null || w.background) vars['--card'] = tinted(w.tint, w.opacity ?? (w.background ? .45 : undefined));
  if (w.background) vars['--card-image'] = `url("${w.background}")`;
  if (w.blur != null) vars['--glass-blur'] = w.blur ? `blur(${w.blur}px) saturate(1.6)` : 'none';
  return vars;
}

/** a wallpaper that's paint rather than a picture: a colour or a gradient */
export const isPaint = (v: string) => /^#[0-9a-f]{3,8}$|^[a-z]+$|^[a-z-]+\(/i.test(v);
export const listOf = <T>(v?: T | T[]) => v == null ? [] : Array.isArray(v) ? v : [v];
