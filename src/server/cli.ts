// `node dist/server.js config check|print|schema`: validate a config, show what Atrium made of it, or print the
// JSON schema (for editors and agents: `# yaml-language-server: $schema=./atrium.schema.json` at the top of the file).
import { stringify } from 'yaml';
import { z } from 'zod';
import { Config, loadConfig, usedSecrets } from './config.ts';
import type { Integration } from './core.ts';
import { loadPlugins } from './plugins.ts';
import { redactor } from './security.ts';
import { check } from './site.ts';

export async function configCommand(args: string[], path: string, registry: Record<string, Integration>) {
  const [cmd] = args;
  if (cmd === 'schema') { console.log(JSON.stringify(schema(registry), null, 2)); return 0; }
  if (cmd !== 'check' && cmd !== 'print') { console.log('usage: config check | print | schema'); return 1; }
  let config: Config;
  try { config = loadConfig(path); }
  catch (e) { console.error(String((e as Error).message)); return 1; }
  const fromPlugins = await loadPlugins(registry, config.plugins.packages, config.plugins.replace);
  const { problems, instances, placed } = check(config, registry, fromPlugins);
  if (cmd === 'print') { console.log(stringify(JSON.parse(redactor(usedSecrets)(JSON.stringify(config))))); return problems.length ? 1 : 0; }
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(`${problems.length ? '' : '✓ '}${path}: ${instances.size} integrations, ${placed.size} widgets placed, ${config.assistant ? 'assistant on' : 'no assistant'}${problems.length ? `, ${problems.length} problem${problems.length > 1 ? 's' : ''}` : ''}`);
  return problems.length ? 1 : 0;
}

/** The whole config as JSON schema, with every integration's options under its type. */
export function schema(registry: Record<string, Integration>) {
  const blocks = Object.values(registry).map(i => (i.config as z.ZodObject).extend({ type: z.literal(i.type) }));
  const full = Config.extend({ integrations: z.record(z.string(), z.union(blocks as unknown as [z.ZodType, ...z.ZodType[]])).default({}) });
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Atrium config.yaml', ...z.toJSONSchema(full, { io: 'input', unrepresentable: 'any' }) };
}
