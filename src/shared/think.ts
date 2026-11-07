// Models that reason out loud sometimes leave it in the reply: a stray `</think>` with the reasoning before it, or a
// whole `<think>…</think>` block. Whatever comes before the last close tag is thinking, not the answer.
// A small model that loses its way can also leave other bare tags of its template in the answer (`</thinking>`,
// `<trans>`), sometimes hundreds of them: those come out of both parts.
const STRAY = /<\/?(?:think|thinking|reasoning|trans)>/;
const clean = (s: string) => s.replace(new RegExp(STRAY, 'g'), '').replace(/\n{3,}/g, '\n\n').trim();

export function splitThink(text: string): { thought: string; said: string; thinking: boolean } {
  const close = text.lastIndexOf('</think>');
  if (close >= 0) return { thought: clean(text.slice(0, close)), said: clean(text.slice(close + 8)), thinking: false };
  const open = text.indexOf('<think>');
  if (open >= 0) return { thought: clean(text.slice(open + 7)), said: clean(text.slice(0, open)), thinking: true };   // still going
  return { thought: '', said: STRAY.test(text) ? clean(text) : text, thinking: false };
}
