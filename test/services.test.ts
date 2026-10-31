// Every service() in the catalog, against the sample answer it carries: see src/server/service-check.ts for what's checked.
// Contributors can run the same check on a plugin: node dist/server.js check-integration <file>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registry } from '../src/integrations/index.ts';
import { readFileSync } from 'node:fs';
import { doc } from '../scripts/services-doc.ts';
import { services } from '../src/integrations/services/index.ts';
import { checkService } from '../src/server/service-check.ts';

for (const s of services) test(`service ${s.def.name}`, async () => assert.deepEqual(await checkService(s), []));

test('services: no two share a type, and none replaces a built-in by accident', () => {
  const types = services.map(s => s.type);
  assert.deepEqual(types.filter((t, i) => types.indexOf(t) !== i), []);
  for (const s of services) assert.equal(registry[s.type], s);
});

test('docs: the supported list is current (npm run docs:services)', () => assert.equal(readFileSync('docs/services.md', 'utf8'), doc()));
