// Sounds for what you do and what happens on the page: a tap, a thing done, a "not now", a notice, a message sent, and
// the puff of something taken off. Each is made as it plays with the Web Audio API, so there are no files to fetch. Off
// unless appearance.sounds says otherwise, and each browser can turn them on or off in ⌘K, which wins. Nothing plays
// before the person has touched the page (browsers hold sound until then anyway), and nothing is loud: a few
// short notes, soft at the start and soft at the end.
import { useSyncExternalStore } from 'react';

export type Sound = 'tap' | 'done' | 'no' | 'notice' | 'send' | 'dust';
export interface Sounds { enabled: boolean; volume: number }
const KEY = 'valet-sounds';

/** On or off, and how loud: what this browser chose, if anything, over the config. */
export function resolveSounds(config: Partial<Sounds> | undefined, saved: string | null) {
  const on = saved === 'on' ? true : saved === 'off' ? false : !!config?.enabled;
  return { on, volume: Math.max(0, Math.min(1, config?.volume ?? .4)) };
}

let config: Partial<Sounds> | undefined, ctx: AudioContext | undefined, touched = false;
const subs = new Set<() => void>(), tell = () => subs.forEach(f => f());
const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
let state = resolveSounds(undefined, saved());

/** The config's say, from /api/page. */
export function setSounds(next?: Partial<Sounds>) { config = next; state = resolveSounds(config, saved()); tell(); }
/** This browser's choice, kept for next time. */
export function toggleSounds(on = !state.on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: it still holds for this visit */ }
  state = { ...resolveSounds(config, on ? 'on' : 'off') }; tell();
  if (on) { touched = true; play('tap'); }
  return on;
}
export const useSounds = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);

if (typeof window !== 'undefined') {
  const first = () => { touched = true; removeEventListener('pointerdown', first, true); removeEventListener('keydown', first, true); };
  addEventListener('pointerdown', first, true); addEventListener('keydown', first, true);
}

/** One note: a quick rise and a soft fall, gliding to `to` if it's given. */
function note(a: AudioContext, out: AudioNode, at: number, { f, to, dur, peak, type = 'sine' }: { f: number; to?: number; dur: number; peak: number; type?: OscillatorType }) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur * .8);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + .006); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
  o.connect(g).connect(out); o.start(at); o.stop(at + dur + .02);
}
/** A breath of noise through a narrowing filter: something fine blowing away. */
function puff(a: AudioContext, out: AudioNode, at: number, dur: number, peak: number) {
  const n = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.Q.value = .9;
  f.frequency.setValueAtTime(3200, at); f.frequency.exponentialRampToValueAtTime(900, at + dur);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + .04); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
  src.connect(f).connect(g).connect(out); src.start(at); src.stop(at + dur + .02);
}

const SCORE: Record<Sound, (a: AudioContext, out: AudioNode, t: number) => void> = {
  tap: (a, o, t) => note(a, o, t, { f: 1250, to: 900, dur: .05, peak: .35 }),
  done: (a, o, t) => { note(a, o, t, { f: 660, dur: .16, peak: .3, type: 'triangle' }); note(a, o, t + .075, { f: 988, dur: .24, peak: .26, type: 'triangle' }); },
  no: (a, o, t) => note(a, o, t, { f: 440, to: 330, dur: .18, peak: .28, type: 'triangle' }),
  notice: (a, o, t) => { note(a, o, t, { f: 880, dur: .7, peak: .2 }); note(a, o, t, { f: 1320, dur: .45, peak: .07 }); note(a, o, t + .11, { f: 1175, dur: .6, peak: .12 }); },
  send: (a, o, t) => note(a, o, t, { f: 440, to: 880, dur: .13, peak: .22 }),
  dust: (a, o, t) => puff(a, o, t, .32, .18),
};

/** Plays a sound, if sounds are on and the person has touched the page. */
export function play(s: Sound) {
  if (!state.on || !touched || !state.volume || typeof AudioContext === 'undefined') return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const out = ctx.createGain();
    out.gain.value = state.volume * .5;   // at 1 the loudest note is still well under full scale
    out.connect(ctx.destination);
    SCORE[s](ctx, out, ctx.currentTime + .005);
  } catch { /* no audio here: the page goes on silently */ }
}
