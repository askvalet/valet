// Plain commands, matched by rule: "pause downloads", "lights off", "pause ads 10 min". The page and the server match the
// same way: words are normalised (case, punctuation, word order, plurals, a few synonyms) and must then be exactly the
// command's words. Nothing is fuzzy, so nothing can run that wasn't said. A half-typed command is only offered, and two
// commands that both match are both shown.

/** A command as the page knows it: the words that run it, and what it is. */
export interface Phrase {
  id: string;
  say: string[];
  label: string;
  /** whose it is, for the palette: "qBittorrent" */
  service: string;
  kind: 'action' | 'tool';
  access: 'read' | 'write' | 'control';
}
export interface Match {
  id: string;
  /** 1 for an exact match; less for one still being typed, which is only offered */
  score: number;
  exact: boolean;
  /** what to send to run it: what was typed, or for a half-typed command the command's own words */
  text: string;
  slots: Record<string, number>;
}

// one word for each meaning, applied to both sides: "stop downloads" and "pause downloads" are the same command
const SAME: Record<string, string> = {
  disable: 'off', deactivate: 'off', enable: 'on', activate: 'on',
  stop: 'pause', halt: 'pause', suspend: 'pause', unpause: 'resume', continue: 'resume', start: 'resume',
  min: 'minute', mins: 'minute', m: 'minute', minutes: 'minute', h: 'hour', hr: 'hour', hrs: 'hour', hours: 'hour',
  ads: 'ad', advert: 'ad', adverts: 'ad', torrent: 'download', torrents: 'download',
  whats: 'what', whos: 'who', thats: 'that', currently: 'now',
};
const FILLER = new Set(['the', 'a', 'an', 'please', 'my', 'all', 'for', 'to', 'turn', 'of', 'is', 'are', 'can', 'you', 'me', 'us', 'our', 'hey', 'just', 'some']);
const NUMBER: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  fifteen: '15', twenty: '20', thirty: '30', sixty: '60', ninety: '90' };
const SLOT = '#';
const MAX = 200;

const canon = (w: string) => {
  if (NUMBER[w]) return NUMBER[w];
  if (SAME[w]) return SAME[w];
  const stem = w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w;
  return SAME[stem] ?? stem;
};
/** Words as compared: lower case, no accents or apostrophes, numbers apart from units ("5m" is 5 minutes), no filler. */
export function words(text: string): string[] {
  return text.slice(0, MAX).toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’]/g, '')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9]+/).filter(w => w && !FILLER.has(w)).map(canon);
}
/** A phrase's words, with `{slot}` kept as a slot. */
function pattern(say: string) {
  const slots: string[] = [], out: string[] = [];
  for (const part of say.split(/(\{\w+\})/)) {
    if (/^\{\w+\}$/.test(part)) { slots.push(part.slice(1, -1)); out.push(SLOT); } else out.push(...words(part));
  }
  return { words: out, slots };
}
const isNum = (w: string) => /^\d{1,6}$/.test(w);

/** How what was typed fits one phrase: exactly, as a beginning, or not at all. */
function fit(say: string, typed: string[], open: boolean): { exact: boolean; slots: Record<string, number> } | null {
  const p = pattern(say);
  if (!p.words.length || !typed.length) return null;
  const left = [...p.words], numbers: number[] = [];
  const take = (w: string) => { const i = left.indexOf(w); if (i >= 0) { left.splice(i, 1); return true; } return false; };
  const last = open ? typed.length - 1 : -1;
  for (let i = 0; i < typed.length; i++) {
    const w = typed[i];
    if (take(w)) continue;
    if (isNum(w) && take(SLOT)) { numbers.push(Number(w)); continue; }
    // the word still being typed may be the start of one of the command's
    if (i === last && left.some(x => x !== SLOT && x.startsWith(w))) return { exact: false, slots: {} };
    return null;
  }
  const slots = Object.fromEntries(p.slots.slice(0, numbers.length).map((s, i) => [s, numbers[i]]));
  return left.length ? { exact: false, slots } : { exact: true, slots };
}

/** Every command that fits what was typed, best first. Exact ones score 1; a command still being typed scores below
 *  asking, so Enter never runs a guess, and one that needs a number it hasn't been given isn't offered yet. */
export function match(list: Pick<Phrase, 'id' | 'say'>[], text: string): Match[] {
  const typed = words(text);
  if (!typed.length || text.trim().length < 2) return [];
  const open = !/\s$/.test(text);
  const out: Match[] = [];
  for (const c of list) {
    let best: Match | null = null;
    for (const say of c.say) {
      const f = fit(say, typed, open);
      if (!f) continue;
      if (f.exact) { best = { id: c.id, score: 1, exact: true, text, slots: f.slots }; break; }
      if (best || pattern(say).slots.length > Object.keys(f.slots).length) continue;
      const filled = say.replace(/\{(\w+)\}/g, (_, k) => String(f.slots[k]));
      best = { id: c.id, score: .42, exact: false, text: filled, slots: f.slots };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The one command Enter may run: an exact match with no other exact match beside it. */
export const clear = (matches: Match[]) => matches.filter(m => m.exact).length === 1 ? matches.find(m => m.exact) : undefined;
