// Small tools for writing fixtures. Nothing here touches the network.
import type { Answer } from './types.ts';

export const MIN = 60_000, HOUR = 36e5, DAY = 864e5;
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
export const secondsAgo = (ms: number) => Math.floor((Date.now() - ms) / 1000);
export const ymd = (ms = 0) => new Date(Date.now() + ms).toISOString().slice(0, 10);
export const wave = (i: number, lo: number, hi: number) => lo + (hi - lo) * (.5 + .32 * Math.sin(i / 3.1) + .18 * Math.sin(i / 1.3));

/** The first rule whose text appears in the URL (or whose pattern matches) answers; put the specific ones first. */
export const route = (rules: [string | RegExp, unknown][]): Answer => (url, init) => {
  for (const [match, answer] of rules) {
    if (typeof match === 'string' ? url.includes(match) : match.test(url)) return typeof answer === 'function' ? answer(url, init) : answer;
  }
  return undefined;   // catalog.ts turns this into "fixture has no answer", so a missed endpoint shows up
};
/** Rules placed before another fixture's: the same service with a few answers changed. */
export const over = (rules: [string | RegExp, unknown][], rest: Answer): Answer => (url, init) => route(rules)(url, init) ?? rest(url, init);
/** Keeps a counter between calls, for values that move as a page polls. */
export const ticker = () => { let i = 0; return () => i++; };
/** Art from demo/art, picked steadily by a ref's text. */
const sum = (s: string) => [...s].reduce((n, c) => n + c.charCodeAt(0), 0);
export const photo = (ref: string) => `/art/photos/${sum(ref) % 4}.jpg`;
export const docPage = (ref: string) => `/art/docs/${sum(ref) % 8}.jpg`;
export const webPage = (ref: string) => `/art/pages/${sum(ref) % 5}.jpg`;
export const sleep = (ms: number) => new Promise(ok => setTimeout(ok, ms));
