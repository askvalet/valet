// The chat's commands on the server: a custom command's prompt in place of what was typed, the integrations a question is
// about (@mentions and a command's `tools`).
import type { UIMessage } from 'ai';
import type { Config } from './config.ts';
import { customs, expand, mentionsIn, parseSlash, RESERVED, type Custom } from '../shared/slash.ts';

/** The last thing the person asked, as typed. */
export const lastAsk = (messages: UIMessage[]) => {
  const m = messages.findLast(m => m.role === 'user');
  return (m?.parts.find(p => p.type === 'text') as { text?: string } | undefined)?.text ?? '';
};

export function commandsOf(config: Config) { return new Map(customs(config.chat.commands).map(c => [c.name, c])); }

/** What the model reads: every message that was a custom command becomes its prompt. The page keeps what was typed. */
export function expanded(messages: UIMessage[], commands: Map<string, Custom>): UIMessage[] {
  if (!commands.size) return messages;
  return messages.map(m => {
    if (m.role !== 'user') return m;
    let done = false;
    const parts = m.parts.map(p => {
      if (done || p.type !== 'text') return p;
      done = true;
      const s = parseSlash(p.text), c = s && !RESERVED.has(s.name) ? commands.get(s.name) : undefined;
      return c ? { ...p, text: expand(c.prompt, s!.input) } : p;
    });
    return { ...m, parts };
  });
}

/** What this question is, as far as commands go: the custom command it ran, if any, and the integrations it
 *  names. `mentionable` is what the assistant may use here; anything else is left out. */
export function readAsk(messages: UIMessage[], commands: Map<string, Custom>, mentionable: Set<string>) {
  const said = lastAsk(messages), s = parseSlash(said);
  const custom = s && !RESERVED.has(s.name) ? commands.get(s.name) : undefined;
  const named = [...mentionsIn(said, mentionable), ...(custom?.tools ?? []).filter(id => mentionable.has(id))];
  return { custom, mentions: [...new Set(named)] };
}

/** The request's own mention list: only ids the assistant may use. Anything else is refused, never ignored. */
export function checkMentions(raw: unknown, mentionable: Set<string>): { ok: string[] } | { error: string } {
  if (raw == null) return { ok: [] };
  if (!Array.isArray(raw) || raw.length > 12 || raw.some(x => typeof x !== 'string')) return { error: 'mentions is a list of integration ids.' };
  const bad = raw.find(id => !mentionable.has(id));
  return bad !== undefined ? { error: `@${String(bad).slice(0, 40)} isn't an integration the assistant can use here.` } : { ok: [...new Set(raw as string[])] };
}

/** The system line that says what the question is about. */
export const focusLine = (ids: string[], names: (id: string) => string, lazy: boolean) => !ids.length ? '' :
  `The user is asking about: ${ids.map(id => names(id) && names(id) !== id ? `${id} (${names(id)})` : id).join(', ')}.${lazy ? ' Their tools are already loaded.' : ' Prefer their tools.'}`;
