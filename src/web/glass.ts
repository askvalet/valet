// The glass material: the config's (appearance.glass.material), unless this browser chose one in ⌘K, which wins. Kept apart
// from the look so a new config doesn't undo the choice; theme.js puts it back before first paint.
const KEY = 'valet-glass';
let config = false;
const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** The config's say, from the look. */
export function setGlass(liquid: boolean) {
  config = liquid;
  const s = saved();
  document.documentElement.classList.toggle('glass-liquid', s ? s === 'liquid' : liquid);
}
export const isLiquid = () => document.documentElement.classList.contains('glass-liquid');
/** This browser's material, remembered here and nowhere else; choosing what the config says goes back to following it. */
export function toggleGlass(on = !isLiquid()) {
  try { if (on === config) localStorage.removeItem(KEY); else localStorage.setItem(KEY, on ? 'liquid' : 'frosted'); } catch { /* private mode: it holds for this visit */ }
  document.documentElement.classList.toggle('glass-liquid', on);
  return on;
}
