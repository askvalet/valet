// Puts the config's look on the page. The server has already worked it out (src/shared/look.ts); this applies it and
// takes back whatever the last config set, so a reload never leaves a stale value behind. It's also kept for theme.js,
// which puts it back before first paint.
import { setGlass } from './glass.ts';

export type Theme = 'auto' | 'light' | 'dark';
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
  try { localStorage.setItem('valet-look', JSON.stringify({ vars: look.vars, classes: look.classes, theme: look.theme })); } catch { /* private mode */ }
}

/** Light or dark: the config's, else dark glass over a wallpaper, else the person's or the system's. */
export function applyTheme(theme: Theme, wall: boolean) {
  const forced = theme !== 'auto' ? theme : wall ? 'dark' : '';
  let saved: string | null = null;
  try { saved = localStorage.getItem('valet-theme'); } catch { /* private mode */ }
  if (forced) root.dataset.theme = forced; else delete root.dataset.theme;
  root.classList.toggle('dark', forced ? forced === 'dark' : saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('has-wallpaper', wall);
  root.classList.toggle('glass-light', wall && forced === 'light');
}
