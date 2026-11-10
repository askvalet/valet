// How the wall display takes turns: which page comes next and how long the one on screen stays. Plain functions of what
// the server says may show and the time, so the rules can be tested without a screen or a clock.

/** Calm by rule: where pages come and go by a `when`, each stays at least this long once it's up. */
export const CALM = 30_000;

/** The page after `n` among those that may show, in the config's order; -1, the default page, when none may. */
export const nextPage = (n: number, pages: number[]) => pages.find(i => i > n) ?? pages[0] ?? -1;

/** How long until the page on screen gives way, in ms from `now`; null when it stays (it's the only one that may show).
 *  A page that may no longer show isn't taken away: it leaves at its own turn's end, like any other. A touch holds
 *  whatever is up until `held`. */
export function stayFor(o: { n: number; since: number; pages: number[]; every: number; held: number; now: number; calm: boolean }): number | null {
  const may = o.n < 0 ? !o.pages.length : o.pages.includes(o.n);
  if (may && o.pages.length < 2) return null;
  return Math.max(0, o.since + Math.max(o.calm ? CALM : 5000, o.every) - o.now, o.held - o.now);
}
