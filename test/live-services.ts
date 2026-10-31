// `npm run test:services`: runs catalog entries against real services, with the same code the page uses. Only reads. List
// them in VALET_LIVE as JSON: [{ "type": "bazarr", "url": "http://…", "key": "${BAZARR_KEY}" }]. It's the check samples can't do.
import { registry } from '../src/integrations/index.ts';
import { makeContext } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';

const list = JSON.parse(process.env.VALET_LIVE ?? '[]') as { type: string }[];
let bad = 0;
for (const { type, ...cfg } of list) {
  try {
    const s = registry[type], inst = s.create(s.config.parse(cfg), makeContext(type)), card: any = await inst.widgets.status.fetch(), ok = checkCard(card).success;
    const blank = (card.items ?? []).filter((i: any) => ['–', 'NaN', 'undefined'].includes(String(i.value))).map((i: any) => i.label);
    console.log(`${ok && !blank.length ? '✓' : '✗'} ${type}: ${(card.items ?? []).slice(0, 5).map((i: any) => `${i.label ?? i.name ?? i.title} ${i.value ?? (i.ok === undefined ? '' : i.ok ? 'up' : 'down')}`).join(' · ')}${blank.length ? `  [blank: ${blank.join(', ')}]` : ''}`);
    if (!ok || blank.length) bad++;
  } catch (e) { bad++; console.log(`✗ ${type}: ${(e as Error).message}`); }
}
process.exit(bad ? 1 : 0);
