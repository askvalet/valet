// One-shot questions to the model, for everything that isn't the chat: "why is this red?", the daily brief, spotting a
// shared cause. These calls get no tools at all, so whatever a feed or a document says, the worst they can do is say
// something odd. They run one at a time, and background jobs have a daily budget so a GPU isn't kept busy.
import type { Config } from './config.ts';
import { splitThink } from '../shared/think.ts';

export type Ask = (system: string, prompt: string, kind?: 'background' | 'asked') => Promise<string | null>;

let day = '', spent = { background: 0, asked: 0 };
let queue: Promise<unknown> = Promise.resolve();

export function makeAsk(a: NonNullable<Config['assistant']>): Ask {
  const limits = { background: a.background.perDay, asked: a.background.perDay * 10 };
  return (system, prompt, kind = 'background') => {
    const today = new Date().toDateString();
    if (today !== day) { day = today; spent = { background: 0, asked: 0 }; }
    if (spent[kind] >= limits[kind]) return Promise.resolve(null);
    spent[kind]++;
    const run = async () => {
      try {
        // loaded here so a page nobody asks anything of never pays for the AI SDK
        const [{ generateText }, { makeModel }] = await Promise.all([import('ai'), import('./model.ts')]);
        const r = await generateText({ model: makeModel(a), system, prompt, abortSignal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'Valet' } });
        return splitThink(r.text).said.trim() || null;
      } catch (e) { console.error(`assistant: ${(e as Error).message}`); return null; }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
}
