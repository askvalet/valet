// A short to-do list, kept in data/. Tick things off on the page; add to it from the card's own line, ⌘K or the chat.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import { sandbox } from '../server/sandbox.ts';
import type { Card } from '../shared/cards.ts';

interface Todo { id: string; text: string; done: boolean }
// what someone typed, from the card, ⌘K or the assistant: the same words are checked the same way wherever they came from
const Text = z.string().trim().min(1, 'Type something to add').max(200, 'That\'s over 200 characters');

export default defineIntegration({
  type: 'todo',
  name: 'To-do list',
  config: z.object({ title: z.string().default('To do') }),
  create(cfg, ctx) {
    const file = resolve(process.env.VALET_DATA ?? 'data', `todo-${ctx.id.replace(/[^\w-]/g, '')}.json`);
    const load = (): Promise<Todo[]> => readFile(file, 'utf8').then(JSON.parse).catch(() => []);
    let writing = Promise.resolve();
    const change = (f: (l: Todo[]) => Todo[]) => (writing = writing.then(async () => {
      const next = f(await load());
      if (sandbox.on) return;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(next)); await rename(`${file}.tmp`, file);
    }));
    const card = async (): Promise<Card> => {
      const l = await load(), open = l.filter(t => !t.done).length;
      return { type: 'controls', title: cfg.title, icon: 'tag', items: l.map(t => ({ id: t.id, label: t.text, kind: 'toggle' as const, value: t.done, action: 'tick', args: { id: t.id } })),
        buttons: l.some(t => t.done) ? [{ label: 'Clear finished', action: 'clear' }] : undefined, add: { placeholder: 'New task…', action: 'add' }, summary: { label: cfg.title, icon: 'tag', value: String(open), sub: open === 1 ? 'thing left' : 'things left' } };
    };
    // two added in the same millisecond (a quick Enter, Enter) must still be two rows
    let last = 0;
    const add = (text: string) => { const at = last = Math.max(Date.now(), last + 1); return change(l => [...l, { id: `t${at.toString(36)}`, text, done: false }]); };
    return {
      widgets: { list: { title: cfg.title, interval: 30_000, fetch: card } },
      commands: [
        { say: ['add {text} to {name}', `add {text} to ${cfg.title}`], run: 'action:add', label: `Add {text} to ${cfg.title}` },
        { say: ['clear finished', 'clear done', 'clear finished {name}', 'clear done {name}', `clear finished ${cfg.title}`], run: 'action:clear', label: `Clear what's finished` },
        { say: ['{name}', `show ${cfg.title}`, 'show {name}', `what's on ${cfg.title}`], run: 'tool:todo_list', label: `Show ${cfg.title}` },
      ],
      actions: {
        tick: { description: 'Tick something off', input: z.object({ id: z.string(), value: z.boolean() }), run: ({ id, value }) => change(l => l.map(t => t.id === id ? { ...t, done: value } : t)) },
        add: { description: 'Add something to the list', input: z.object({ text: Text }), run: async ({ text }) => { await add(text); return { done: `Added “${text}” to ${cfg.title}` }; } },
        clear: { description: 'Clear what is finished', input: z.object({}), run: () => change(l => l.filter(t => !t.done)) },
      },
      tools: {
        todo_add: { label: 'Added to the list', confirm: ({ text }) => ({ title: 'Add this to your list?', detail: text, icon: 'file', verb: 'Add' }), access: 'write', input: z.object({ text: Text }), description: `Add something to the "${cfg.title}" list.`, async run({ text }) { await add(text); return { data: { added: text }, card: await card() }; } },
        todo_list: { label: 'Checked the list', access: 'read', input: z.object({}), description: `What's on the "${cfg.title}" list.`, async run() { return { data: await load(), card: await card() }; } },
      },
    };
  },
});
