// `npm run test:live`: every widget in your config.yaml, fetched from your real services and checked against the card
// schema. Not part of `npm test` (it needs your services and secrets); run it after changing an integration.
import { loadConfig } from '../src/server/config.ts';
import { makeContext } from '../src/server/core.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import { registry } from '../src/integrations/index.ts';
import { loadPlugins } from '../src/server/plugins.ts';

const config = await loadConfig(process.env.VALET_CONFIG ?? 'config.yaml');
await loadPlugins(registry, config.plugins.packages, config.plugins.replace);
let bad = 0, ok = 0;
for (const [id, block] of Object.entries(config.integrations)) {
  const { type, ...rest } = block, integration = registry[type];
  if (!integration) { console.log(`✗ ${id}: unknown type ${type}`); bad++; continue; }
  const inst = integration.create(integration.config.parse(rest), makeContext(id));
  for (const [name, w] of Object.entries(inst.widgets)) {
    const t0 = performance.now();
    try {
      const card = await w.fetch(), r = checkCard(card), ms = Math.round(performance.now() - t0);
      if (r.success) { ok++; console.log(`✓ ${id}.${name} (${card.type}, ${ms} ms)`); }
      else { bad++; console.log(`✗ ${id}.${name}: ${r.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`); }
    } catch (e) { bad++; console.log(`✗ ${id}.${name}: ${(e as Error).message}`); }
  }
}
console.log(`\n${ok} widgets ok, ${bad} failing`);
process.exit(bad ? 1 : 0);
