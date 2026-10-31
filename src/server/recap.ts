// The year in review. Each integration may offer a `recap(range)`: what it can honestly say about those months, as
// slides. This gathers them, orders them and works out who you are this year. No model writes any of it: a paper full of
// real numbers can't have one inventing a few. It works from what the services themselves remember, so it's a full year
// even in Valet's first week. A service that can't answer is left out.
import { fmt, type Instance } from './core.ts';
import type { Recap, RecapSlide } from '../shared/cards.ts';

const WAIT = 25_000, KEEP = 3_600_000;
const FALLBACK = { name: 'The Caretaker', line: 'You keep the lights on and the disks spinning, and nobody in the house ever has to think about it.' };
const cache = new Map<number, { at: number; recap: Recap }>();

const inTime = <T>(p: Promise<T>) => { let t: NodeJS.Timeout; return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error('took too long')), WAIT); })]).finally(() => clearTimeout(t)); };

const PER_SERVICE = 3, PER_THEME = 4;
/** Each in turn: the strongest slide that isn't the same theme as the last, so no one service runs the show. */
function spread(list: RecapSlide[]) {
  const left = [...list], out: RecapSlide[] = [];
  while (left.length) {
    const counts = new Map<string | undefined, number>(); for (const s of left) counts.set(s.theme, (counts.get(s.theme) ?? 0) + 1);
    const heavy = [...counts].find(([t, n]) => t && t !== out.at(-1)?.theme && n * 2 > left.length)?.[0];   // or it runs out of others to sit between
    const at = Math.max(0, left.findIndex(s => heavy ? s.theme === heavy : !s.theme || s.theme !== out.at(-1)?.theme));
    out.push(...left.splice(at, 1));
  }
  return out;
}

/** What only Valet can say, because no one service knows both halves. */
function acrossServices(facts: Record<string, number>, year: number, now: Date) {
  const out: RecapSlide[] = [], { watchedHours: watched, libraryHours: library, uploadedBytes: up } = facts;
  const part = Math.min(1, (now.getTime() - Date.UTC(year, 0, 1)) / (365.25 * 864e5));
  if (watched && library) {
    const by = year + Math.round(library / (watched / part));
    out.push({ id: 'backlog', score: 98, theme: 'media', icon: 'film', wall: true, kicker: 'At this rate, you finish your library in', value: String(by), stat: 'Library finished by', scope: 'year',
      line: `${Math.round(library).toLocaleString('en')} hours on the shelf. ${Math.round(watched)} watched this year.`,
      chart: { pct: watched / library, from: 'Watched', to: 'Still to go', mark: 'You are here' },
      trait: { name: 'The Collector', line: 'Owns everything. Has seen some of it.', strength: Math.min(.95, (by - year) / 60) } });
  }
  if (up) {
    const bill = Math.round(up / 2 ** 30 * .09);
    out.push({ id: 'aws', score: 92, theme: 'network', icon: 'coins', kicker: 'Sending that from AWS would have cost', value: `$${bill.toLocaleString('en')}`, scope: 'All time',
      line: `${fmt.bytes(up)} shared with strangers, at about nine cents a gigabyte, close to AWS list price. You charged nothing.` });
  }
  return out;
}

export async function buildRecap(instances: Map<string, Instance>, year: number, now = new Date()): Promise<Recap> {
  const held = cache.get(year);
  if (held && now.getTime() - held.at < KEEP) return held.recap;
  const range = { year, from: Date.UTC(year, 0, 1), to: Math.min(Date.UTC(year + 1, 0, 1), now.getTime()) };
  const given = await Promise.all([...instances].map(async ([id, inst]) => {
    if (!inst.recap) return [];
    try { return await inTime(inst.recap(range)); }
    catch (e) { console.log(`[recap] ${id}: ${(e as Error).message}`); return []; }
  }));
  const valid = given.map(l => l.filter(s => s.value !== '' && s.value != null));
  const facts = Object.assign({}, ...valid.flat().map(s => s.facts ?? {})) as Record<string, number>;
  const bestFirst = (a: RecapSlide, b: RecapSlide) => (b.score ?? 50) - (a.score ?? 50);
  // the vacuum against the sofa: the two halves only meet here
  const { vacuumHours: cleaned, watchedHours: sat } = facts;
  if (cleaned && sat && cleaned > sat) for (const s of valid.flat()) if (s.id === 'home.vacuum') s.line += ` That's ${Math.round(cleaned / sat)} times longer than anyone sat watching TV.`;
  const across = acrossServices(facts, year, now);
  const everything = [...valid.flat(), ...across].sort(bestFirst);
  const seen = new Map<string, number>();
  const slides = spread([...valid.flatMap(l => [...new Set(l.map(s => s.theme))].flatMap(t => l.filter(s => s.theme === t).sort(bestFirst).slice(0, PER_SERVICE))), ...across].sort(bestFirst)
    .filter(s => { const n = (seen.get(s.theme ?? s.id) ?? 0) + 1; seen.set(s.theme ?? s.id, n); return n <= PER_THEME; }));
  // who you are: the strongest trait any slide claims. Plugins can bring their own.
  const persona = slides.flatMap(s => s.trait ? [s.trait] : []).sort((a, b) => b.strength - a.strength)[0] ?? FALLBACK;
  // the card shows the range of the year: one number per theme first, then the best of the rest
  const carded = everything.filter(s => s.stat), picks = [...new Map(carded.map(s => [s.theme, s] as const).reverse()).values()].reverse();
  const stats = [...new Set([...picks, ...carded])].slice(0, 6).map(s => ({ label: s.stat!, value: `${s.value}${s.unit && s.unit.length <= 5 && !s.stat!.toLowerCase().split(' ').includes(s.unit) ? ` ${s.unit}` : ''}` }));   // the label already says what it counts
  const wall = [...new Set(everything.flatMap(s => [...(s.art ?? []), ...(s.theme === 'media' ? s.items ?? [] : []).flatMap(i => i.image ? [i.image] : [])]))].slice(0, 60);
  const recap: Recap = { year, soFar: range.to < Date.UTC(year + 1, 0, 1) - 864e5, slides, persona: { name: persona.name, line: persona.line }, stats, wall };
  cache.set(year, { at: now.getTime(), recap });
  return recap;
}
export const recapYear = (asked: string | undefined, now = new Date()) => { const y = Number(asked); return Number.isInteger(y) && y >= 2000 && y <= now.getFullYear() ? y : now.getFullYear(); };
export const clearRecap = () => cache.clear();
export type { RecapSlide };
