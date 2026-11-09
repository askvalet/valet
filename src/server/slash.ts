// The chat's commands on the server: a custom command's prompt in place of what was typed, the integrations a question is
// about (@mentions and a command's `tools`), and /undo, which runs the config's own undo tool with no model: the same
// tool, the same approval card, the same log as when the assistant calls it, and no tokens.
import type { LanguageModel, UIMessage } from 'ai';
import type { Config } from './config.ts';
import { customs, expand, mentionsIn, parseSlash, RESERVED, type Custom } from '../shared/slash.ts';

export const UNDO_TOOL = 'config__config_undo';

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

/** What this question is, as far as commands go: the custom command it ran, if any, whether it's /undo, and the
 *  integrations it names. `mentionable` is what the assistant may use here; anything else is left out. */
export function readAsk(messages: UIMessage[], commands: Map<string, Custom>, mentionable: Set<string>) {
  const said = lastAsk(messages), s = parseSlash(said);
  const custom = s && !RESERVED.has(s.name) ? commands.get(s.name) : undefined;
  const named = [...mentionsIn(said, mentionable), ...(custom?.tools ?? []).filter(id => mentionable.has(id))];
  return { custom, undo: s?.name === 'undo' && !s.input, mentions: [...new Set(named)] };
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

// ---- /undo -------------------------------------------------------------------------------------------------------------

const usage = { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } };
const said = (text: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }];
const streamOf = (parts: object[], reason: 'stop' | 'tool-calls') => ({ stream: new ReadableStream({ start(c) {
  c.enqueue({ type: 'stream-start', warnings: [] });
  for (const p of parts) c.enqueue(p);
  c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
  c.close();
} }) });

/** What answers /undo: it calls the undo tool once (so its card asks first, as always), then says how that went. It
 *  reads nothing but the tool's own result, and can call nothing else. */
export function undoModel(available: boolean): LanguageModel {
  const reply = (prompt: any[]) => {
    const last = prompt.at(-1);
    if (last?.role === 'tool') {
      const r = (last.content as any[]).find(p => p.type === 'tool-result' && p.toolName === UNDO_TOOL);
      const out = r?.output, v = out?.value;
      if (!r) return 'Nothing was undone.';
      if (out?.type === 'execution-denied') return 'Okay, the config stays as it is.';
      if (v?.undone) return 'Undone. The config is back as it was before the last change.';
      if (v?.error === 'nothing to undo') return 'There is no config change to undo yet.';
      return `Nothing was undone: ${typeof v?.error === 'string' ? v.error : 'the undo failed'}.`;
    }
    return null;
  };
  const model = {
    specificationVersion: 'v4', provider: 'valet', modelId: 'undo', supportedUrls: {},
    async doGenerate() { throw new Error('not used'); },
    async doStream({ prompt }: { prompt: any[] }) {
      const words = reply(prompt);
      if (words) return streamOf(said(words), 'stop');
      if (!available) return streamOf(said("I can't change the config from here, so there's nothing for /undo to take back."), 'stop');
      return streamOf([{ type: 'tool-call', toolCallId: `undo-${Date.now().toString(36)}`, toolName: UNDO_TOOL, input: '{}' }], 'tool-calls');
    },
  };
  return model as unknown as LanguageModel;
}
