// The chat's own commands and mentions: `/model`, `/new`, a `/morning` of your own, `@plex`. The page and the server read
// them the same way. Built-ins are Valet's and never reach the model. A custom command is only words: its prompt goes
// through the normal chat, with the same access and approvals as anything typed. A mention only says what a question is
// about; it never grants anything.

export interface Builtin { name: string; aliases?: string[]; args?: string; description: string }
export const BUILTINS: Builtin[] = [
  { name: 'model', args: '[name]', description: 'Switch this chat to another model' },
  { name: 'reasoning', args: 'off|low|medium|high|auto', description: 'How much it thinks first, for this chat' },
  { name: 'new', aliases: ['clear'], description: 'Start a new chat' },
  { name: 'compact', description: 'Summarise the conversation so far, to make room' },
  { name: 'help', description: 'List the commands' },
];
/** Every name a built-in answers to: a custom command can't take one. */
export const RESERVED = new Set(BUILTINS.flatMap(b => [b.name, ...(b.aliases ?? [])]));
export const builtinOf = (name: string) => BUILTINS.find(b => b.name === name || b.aliases?.includes(name));
export const LEVELS = ['auto', 'off', 'low', 'medium', 'high'] as const;

/** A command's name: lowercase letters, digits and dashes. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** `chat.commands` as written: a prompt, or a prompt with what it runs on. */
export type CustomCommand = string | { prompt: string; description?: string; model?: string; reasoning?: typeof LEVELS[number]; tools?: string[] };
export interface Custom { name: string; prompt: string; description?: string; model?: string; reasoning?: typeof LEVELS[number]; tools?: string[] }
export const customs = (list: Record<string, CustomCommand> | undefined): Custom[] =>
  Object.entries(list ?? {}).map(([name, c]) => typeof c === 'string' ? { name, prompt: c } : { name, ...c });

/** "/watch Dune" → { name: 'watch', input: 'Dune' }. Only the start of a message counts, and only a name that could be one. */
export function parseSlash(text: string): { name: string; input: string } | null {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m && NAME.test(m[1]) ? { name: m[1], input: (m[2] ?? '').trim() } : null;
}

/** What a custom command sends: `{input}` is what came after its name; with no `{input}`, anything after goes on the end. */
export function expand(prompt: string, input: string) {
  if (prompt.includes('{input}')) return prompt.replaceAll('{input}', input).replace(/[ \t]{2,}/g, ' ').trim();
  return input ? `${prompt}\n\n${input}` : prompt;
}

/** What the menu offers for what's typed after `/` or `@`: names that start with it first, then any that contain it. */
export function filterMenu<T extends { name: string; description?: string; also?: string[] }>(items: T[], query: string): T[] {
  const q = query.toLowerCase();
  if (!q) return items;
  const starts = items.filter(i => i.name.toLowerCase().startsWith(q) || i.also?.some(a => a.toLowerCase().startsWith(q)));
  // a letter or two only finds names; past that, what it's for counts too
  const rest = items.filter(i => !starts.includes(i) && (i.name.toLowerCase().includes(q) || (q.length > 2 && !!i.description?.toLowerCase().includes(q))));
  return [...starts, ...rest];
}

/** The integrations a message mentions: `@plex`, matched to a known id (case aside), each once. An address stays an address. */
export function mentionsIn(text: string, ids: Iterable<string>): string[] {
  const known = new Map([...ids].map(id => [id.toLowerCase(), id])), out: string[] = [];
  for (const m of text.matchAll(/(^|[\s(,])@([a-z0-9][a-z0-9_-]*)/gi)) {
    const id = known.get(m[2].toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** `/model deep`: the choice it most likely means, by id, then by model, then by the start of either, then by any part. */
export function matchModel<T extends { id: string; model?: string; label?: string }>(query: string, list: T[]): T | undefined {
  const q = query.trim().toLowerCase();
  if (!/[a-z0-9]/.test(q)) return undefined;
  const words = (c: T) => [c.id, c.model, c.label].filter(Boolean).map(s => s!.toLowerCase());
  const bare = (s: string) => s.replace(/[^a-z0-9]/g, ''), b = bare(q);
  return list.find(c => words(c).includes(q)) ?? list.find(c => words(c).some(w => w.startsWith(q)))
    ?? list.find(c => words(c).some(w => w.includes(q))) ?? (b ? list.find(c => words(c).some(w => bare(w).includes(b))) : undefined);
}
