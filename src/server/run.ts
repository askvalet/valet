// The one door every tool call goes through, from chat, a plan or a rule: results are redacted (a secret in an error or a
// payload never reaches the model or the page), and anything that isn't just looking goes in the activity log. Kept
// apart from chat.ts so rules can use it without loading the AI SDK.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Activity, Entry } from './activity.ts';
import type { Config } from './config.ts';
import type { Tool } from './core.ts';

export const rank = { none: 0, read: 1, write: 2, control: 3 } as const;

/** What `assistant.access` grants an integration right now. Valet's own tools (what happened, reminders, rules) work
 *  without being granted; `valet: write` keeps reminders and turns rules off. */
export const accessOf = (a: Config['assistant'] | undefined, id: string) =>
  a ? rank[a.access[id] ?? (id === 'valet' ? 'control' : a.access.default ?? 'read')] : rank.none;

/** What `assistant.access` grants one tool: its own dotted key (`plex.plex_stop_stream: control`), else its integration's
 *  level. A key can lower or raise one tool; `none` takes it away everywhere. */
export const toolAccess = (a: Config['assistant'] | undefined, id: string, name?: string) => {
  const own = a && name ? a.access[`${id}.${name}`] : undefined;
  return own ? rank[own] : accessOf(a, id);
};

/** Who's asking, per request: two people can be chatting at once. */
export const asker = new AsyncLocalStorage<string>();
export const who = () => asker.getStore() ?? 'you';

export async function runTool(o: { id: string; name: string; t: Tool; args: unknown; via: Entry['via']; who: string; rule?: string; activity?: Activity; redact: (s: string) => string }) {
  const { t } = o;
  const log = (ok: boolean, error?: string) => { if (t.access !== 'read') o.activity?.add({ who: o.who, via: o.via, rule: o.rule, what: t.label ?? o.name, input: o.args, ok, error, undo: t.undo ? { tool: `${o.id}__${t.undo}`, input: o.args } : undefined }); };
  try {
    const out = await t.run(o.args), failed = (out?.data as { error?: unknown } | undefined)?.error;
    log(!failed, failed ? o.redact(String(failed)) : undefined);
    return JSON.parse(o.redact(JSON.stringify(out))) as { data: any; card?: unknown };
  } catch (e) {
    const error = o.redact((e as Error).message);
    log(false, error);
    return { data: { error } };
  }
}
