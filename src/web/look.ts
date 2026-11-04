// Puts the config's look on the page. The server has already worked it out (src/shared/look.ts); this applies it and
// takes back whatever the last config set, so a reload never leaves a stale value behind. It's also kept for theme.js,
// which puts it back before first paint.
import { setGlass } from './glass.ts';

export type Theme = 'auto' | 'system' | 'light' | 'dark';
export interface Look { vars: Record<string, string>; classes: string[]; theme: Theme; css?: string; font?: { family: string; file?: string; sheet?: string } }

const root = document.documentElement;
let vars: string[] = [], classes: string[] = [];


function link(id: string, href?: string) {
  const el = document.getElementById(id) as HTMLLinkElement | null;
  if (!href) { el?.remove(); return; }
  if (el?.getAttribute('href') === href) return;
  const next = el ?? document.head.appendChild(Object.assign(document.createElement('link'), { id, rel: 'stylesheet' }));
  next.href = href;
}

export function applyLook(look: Look) {
  for (const v of vars) root.style.removeProperty(v);
  root.classList.remove(...classes);
  for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v);
  root.classList.add(...look.classes);
  vars = Object.keys(look.vars); classes = look.classes;
  setGlass(look.classes.includes('glass-liquid'));
  link('valet-font', look.font?.sheet);
  if (look.font?.file) new FontFace(look.font.family, `url(${JSON.stringify(look.font.file)})`).load().then(f => document.fonts.add(f)).catch(() => {});
  document.getElementById('valet-css')?.remove();   // last in the head, so it comes after everything else
  link('valet-css', look.css);
  remember({ vars: look.vars, classes: look.classes });
}

/** what theme.js reads before first paint: the look, and the theme as last applied (with whether there was a wallpaper) */
function remember(part: object) {
  try {
    let was: object = {};
    try { was = JSON.parse(localStorage.getItem('valet-look') ?? '{}') ?? {}; } catch { /* a bad one is replaced */ }
    localStorage.setItem('valet-look', JSON.stringify({ ...was, ...part }));
  } catch { /* private mode */ }
}

const KEY = 'valet-theme', system = matchMedia('(prefers-color-scheme: dark)');
let own = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();   // this browser's choice, if any

/** What the config leaves to this browser: the device's light or dark, which the switch can override here. auto over a
 *  wallpaper is dark glass, as it always was, and light and dark are the config's. theme.js decides the same way. */
export function forcedBy(theme: Theme, wall: boolean): 'light' | 'dark' | '' {
  return theme === 'light' || theme === 'dark' ? theme : theme === 'auto' && wall ? 'dark' : '';
}
/** Whether the top bar's switch has anything to do */
export const switchable = (theme: Theme, wall: boolean) => !forcedBy(theme, wall);

let last: [Theme, boolean] | null = null;
/** Light or dark: the config's, else dark glass over a wallpaper (auto), else this browser's choice or the device's. */
export function applyTheme(theme: Theme, wall: boolean) {
  if (!last) system.addEventListener('change', () => { if (last) applyTheme(...last); });   // the device turns at sunset: so does the page
  last = [theme, wall];
  const forced = forcedBy(theme, wall);
  if (forced) root.dataset.theme = forced; else delete root.dataset.theme;
  const dark = forced ? forced === 'dark' : own ? own === 'dark' : system.matches;
  root.classList.toggle('dark', dark);
  root.classList.toggle('has-wallpaper', wall);
  root.classList.toggle('glass-light', wall && !dark);
  remember({ theme, wall });
}

/** The switch: this browser's light or dark, kept here. Choosing what the device says goes back to following the device. */
export function toggleTheme() {
  const next = !root.classList.contains('dark');
  own = next === system.matches ? null : next ? 'dark' : 'light';
  try { if (own) localStorage.setItem(KEY, own); else localStorage.removeItem(KEY); } catch { /* private mode: it holds for this visit */ }
  if (last) applyTheme(...last);
  else root.classList.toggle('dark', next);
  return next;
}
