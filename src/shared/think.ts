// Models that reason out loud sometimes leave it in the reply: a stray `</think>` with the reasoning before it, or a
// whole `<think>…</think>` block. Whatever comes before the last close tag is thinking, not the answer.
export function splitThink(text: string): { thought: string; said: string; thinking: boolean } {
  const close = text.lastIndexOf('</think>');
  if (close >= 0) return { thought: text.slice(0, close).replace(/<\/?think>/g, '').trim(), said: text.slice(close + 8).trim(), thinking: false };
  const open = text.indexOf('<think>');
  if (open >= 0) return { thought: text.slice(open + 7).trim(), said: text.slice(0, open).trim(), thinking: true };   // still going
  return { thought: '', said: text, thinking: false };
}
