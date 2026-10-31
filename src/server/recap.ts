// The year in review. Each integration may offer a `recap(range)`: what it can honestly say about those months, as
// slides. This gathers them, orders them and works out who you are this year. It needs no AI, and works from what the
// services themselves remember, so it's a full year even in Valet's first week. A service that can't answer is left out.
import type { Instance } from './core.ts';
import type { Recap, RecapSlide } from '../shared/cards.ts';

type Ask = (system: string, prompt: string, kind: 'background') => Promise<string | null>;
const WAIT = 25_000, KEEP = 3_600_000;
const FALLBACK = { name: 'The Caretaker', line: 'You keep the lights on and the disks spinning, and nobody in the house ever has to think about it.' };
const cache = new Map<number, { at: number; recap: Recap }>();

const inTime = <T>(p: Promise<T>) => { let t: NodeJS.Timeout; return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error('took too long')), WAIT); })]).finally(() => clearTimeout(t)); };

export async function buildRecap(instances: Map<string, Instance>, year: number, ask?: Ask, now = new Date()): Promise<Recap> {
  const held = cache.get(year);
  if (held && now.getTime() - held.at < KEEP) return held.recap;
  const range = { year, from: Date.UTC(year, 0, 1), to: Math.min(Date.UTC(year + 1, 0, 1), now.getTime()) };
  const given = await Promise.all([...instances].map(async ([id, inst]) => {
    if (!inst.recap) return [];
    try { return await inTime(inst.recap(range)); }
    catch (e) { console.log(`[recap] ${id}: ${(e as Error).message}`); return []; }
  }));
  const slides = given.flat().filter(s => s.value !== '' && s.value != null).sort((a, b) => (b.score ?? 50) - (a.score ?? 50));
  // who you are: the strongest trait any slide claims. Plugins can bring their own.
  const persona = slides.flatMap(s => s.trait ? [s.trait] : []).sort((a, b) => b.strength - a.strength)[0] ?? FALLBACK;
  const stats = slides.filter(s => s.stat).slice(0, 6).map(s => ({ label: s.stat!, value: `${s.value}${s.unit && s.unit.length <= 5 ? ` ${s.unit}` : ''}` }));   // the label already says what it counts
  // numbers only: titles and names are other people's words, and stay out of the prompt
  const closing = ask && slides.length ? await ask(
    'You write the last line of someone\'s homelab year in review. One warm, dry, slightly funny sentence, at most 16 words. No emoji, no hashtags, no quotes.',
    `Their year: ${stats.map(s => `${s.label}: ${s.value}`).join('; ')}. They are "${persona.name}".`, 'background').catch(() => null) : null;
  const recap: Recap = { year, soFar: range.to < Date.UTC(year + 1, 0, 1) - 864e5, slides, persona: { name: persona.name, line: persona.line }, stats,
    closing: closing?.trim().replace(/^["']|["']$/g, '').slice(0, 140) || undefined };
  cache.set(year, { at: now.getTime(), recap });
  return recap;
}
export const recapYear = (asked: string | undefined, now = new Date()) => { const y = Number(asked); return Number.isInteger(y) && y >= 2000 && y <= now.getFullYear() ? y : now.getFullYear(); };
export const clearRecap = () => cache.clear();
export type { RecapSlide };
