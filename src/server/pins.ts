// Pinned answers: a card from the chat kept on the page. It re-runs the same tool with the same input; no model is
// involved after the moment it's pinned. Stored in data/pins.json; only tools that just look can be pinned.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Card } from '../shared/cards.ts';
import type { Instance } from './core.ts';
import { sandbox } from './sandbox.ts';

export interface Pin { id: string; tool: string; input: Record<string, unknown>; title: string }
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'pins.json');
export const loadPins = (): Promise<Pin[]> => readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []);
export async function savePins(pins: Pin[]) {
  if (sandbox.on) return;
  await mkdir(dirname(FILE()), { recursive: true });
  await writeFile(`${FILE()}.tmp`, JSON.stringify(pins, null, 2), { mode: 0o600 }); await rename(`${FILE()}.tmp`, FILE());
}

/** What a pin shows now. `show` is the assistant's own layout tool; anything else is an integration's look-only tool. */
export async function pinnedCard(pin: Pick<Pin, 'tool' | 'input'>, instances: Map<string, Instance>): Promise<Card> {
  if (pin.tool === 'show') {
    const keys = (pin.input.widgets ?? []) as string[];
    const cards = await Promise.all(keys.map(k => { const [i, w] = k.split('.'); const def = instances.get(i)?.widgets[w]; if (!def) throw new Error(`no widget ${k}`); return def.fetch(); }));
    return cards.length === 1 ? cards[0] : { type: 'group', layout: pin.input.layout === 'column' ? 'column' : 'row', cards };
  }
  const [inst, name] = pin.tool.split('__'), t = inst === 'config' ? undefined : instances.get(inst)?.tools?.[name];
  if (!t) throw new Error('that tool is gone');
  if (t.access !== 'read') throw new Error('only tools that just look can be pinned');
  const { card } = await t.run(t.input.parse(pin.input));
  if (!card) throw new Error('nothing to show');
  return card;
}

export const newPin = (tool: string, input: Record<string, unknown>, title: string): Pin => ({ id: randomBytes(4).toString('hex'), tool, input, title });

/** The pins as an ordinary integration: one widget each, and an Unpin button. */
export function pinsInstance(pins: Pin[], instances: Map<string, Instance>, unpin: (id: string) => Promise<void>): Instance {
  return {
    widgets: Object.fromEntries(pins.map(p => [p.id, { title: p.title, interval: 300_000, fetch: async () => {
      const card = await pinnedCard(p, instances);
      return { ...card, title: card.title ?? p.title, buttons: [...(card.buttons ?? []), { label: 'Unpin', action: 'unpin', args: { id: p.id } }] };
    } }])),
    actions: { unpin: { description: 'Take a pinned card off the page', input: z.object({ id: z.string() }), run: ({ id }: { id: string }) => unpin(id) } },
  };
}
