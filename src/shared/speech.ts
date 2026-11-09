// What an answer sounds like read aloud: shared by the chat's speaker and the demo's recorded voices, which are looked
// up by these same words, so a change here is a change to both (`npm run demo:voices` records them again).

/** How much of an answer is read aloud: the start, to a sentence's end. */
export const SPEAK_CAP = 1500;

/** The words of an answer as they'd be said: no markdown, links, code blocks, tables or addresses, and only the start. */
export function speakable(text: string, cap = SPEAK_CAP) {
  const t = text
    .replace(/```[^]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n')
    .filter(l => !/^\s*\|/.test(l) && !/^\s*[-:| ]{3,}$/.test(l))   // tables and rules say nothing aloud
    .map(l => l.replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/, ''))
    .join('\n')
    .replace(/[*~#|]/g, '')
    .replace(/\s*\n\s*/g, '. ').replace(/([.!?:;,])\.\s/g, '$1 ').replace(/\s+/g, ' ').trim();
  if (t.length <= cap) return t;
  const cut = t.slice(0, cap), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > cap / 2 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
}

/** The name of a recording of these words: the first 16 hex digits of their SHA-256. Works in a browser and in Node. */
export async function voiceKey(words: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(words));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
