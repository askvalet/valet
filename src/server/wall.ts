// The wall display (/wall): pages of their own, from `wall:` in the config. What they show is also everything a paired
// screen (wall.token) may read, so it's worked out here once and the server holds a paired screen to it.
import type { Config } from './config.ts';
import type { WidgetState } from '../shared/cards.ts';

type WallPage = { title?: string; every?: number; clock: boolean; layout: Config['layout'] };

/** The wall's pages as written: `pages`, or the one page `layout` is. None means the default page. */
export const wallPages = (config: Config): WallPage[] => config.wall.pages ?? (config.wall.layout ? [{ clock: true, layout: config.wall.layout }] : []);

/** Every widget the wall's own pages name, in order. */
export const wallWidgets = (config: Config) => [...new Set(wallPages(config).flatMap(p => p.layout.flatMap(s => s.widgets.map(w => w.widget))))];

// with no pages of its own, the wall shows the main page's services and what's playing or downloading
export const DEFAULT_KINDS = new Set(['status', 'media']);

/** Whether a paired screen may hear this widget: one its pages name, or the weather beside its clock; for the default
 *  page, a main-page card of the kinds it shows, judged by what the card is now. */
export function wallReads(config: Config, s: Pick<WidgetState, 'key' | 'card'>) {
  if (s.key === config.weather) return true;
  const own = wallWidgets(config);
  if (own.length) return own.includes(s.key);
  return !!s.card && DEFAULT_KINDS.has(s.card.type) && config.layout.some(x => x.widgets.some(w => w.widget === s.key));
}

/** What doesn't add up: a card no integration has, or a section the wall won't draw. */
export function wallProblems(config: Config, has: (key: string) => boolean): string[] {
  return wallPages(config).flatMap((p, i) => {
    const where = config.wall.pages ? `wall.pages[${i}]${p.title ? ` (${p.title})` : ''}` : 'wall.layout';
    return p.layout.flatMap(s => [
      ...s.widgets.filter(w => !has(w.widget)).map(w => `${where}: no widget "${w.widget}"`),
      ...(s.chat ? [`${where}: chat never shows on a wall (the section's cards do)`] : []),
    ]);
  });
}
