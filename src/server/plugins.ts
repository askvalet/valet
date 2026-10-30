// Community integrations. A plugin is a module whose default export is an integration (the same shape as the built-in
// ones: type, name, a zod config, create()), or a function that's handed Atrium's toolkit and returns one, so a
// plugin can be a single .mjs file with no imports and no build step:
//
//   export default ({ z, defineIntegration }) => defineIntegration({ type: 'hello', name: 'Hello', config: z.object({}),
//     create: () => ({ widgets: { hi: { title: 'Hi', fetch: async () => ({ type: 'text', text: 'Hello!' }) } } }) })
//
// Plugins come from every .js/.mjs file in data/integrations/ and from the npm packages listed under `plugins:` in the
// config. They run inside Atrium with the same access as built-in integrations: install only ones you trust.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { checkCard } from '../shared/cards.schema.ts';
import { defineIntegration, fmt, type Integration } from './core.ts';

export const toolkit = { z, fmt, defineIntegration, checkCard };

async function load(spec: string): Promise<Integration[]> {
  const mod = await import(spec);
  const out = typeof mod.default === 'function' ? mod.default(toolkit) : mod.default;
  return (Array.isArray(out) ? out : [out]).filter(Boolean);
}
const valid = (i: any): i is Integration => i && typeof i.type === 'string' && typeof i.create === 'function' && typeof i.config?.safeParse === 'function';

/** Load plugins into the registry. Built-ins keep their names unless the config says a plugin may replace one. */
export async function loadPlugins(registry: Record<string, Integration>, packages: string[], replace: string[]) {
  const dir = resolve(process.env.ATRIUM_DATA ?? 'data', 'integrations');
  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => /\.(m?js)$/.test(f)).sort().map(f => pathToFileURL(resolve(dir, f)).href);
  const loaded: string[] = [];
  for (const spec of [...files, ...packages]) {
    try {
      for (const i of await load(spec)) {
        if (!valid(i)) { console.error(`plugins: ${spec}: default export isn't an integration (needs type, config, create)`); continue; }
        if (registry[i.type] && !replace.includes(i.type)) { console.error(`plugins: ${spec}: "${i.type}" is built in (list it under plugins.replace to swap it)`); continue; }
        registry[i.type] = i; loaded.push(i.type);
      }
    } catch (e) { console.error(`plugins: ${spec}: ${(e as Error).message}`); }
  }
  if (loaded.length) console.log(`plugins: ${loaded.join(', ')}`);
  return new Set(loaded);
}
