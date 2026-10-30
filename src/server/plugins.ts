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

/** `atrium new-integration <name>`: writes a working plugin (and its visual) into data/integrations/ to start from. */
export async function scaffold(name: string) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name ?? '')) { console.log('usage: new-integration <name>   (lowercase letters, digits, dashes)'); return 1; }
  const { mkdir, writeFile, access } = await import('node:fs/promises');
  const dir = resolve(process.env.ATRIUM_DATA ?? 'data', 'integrations');
  const fill = (t: string) => t.replaceAll('__SLUG__', name.replace(/-/g, '_')).replaceAll('__NAME__', name).replaceAll('__TITLE__', name.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase()))
    .replaceAll('__ENV__', name.toUpperCase().replace(/-/g, '_')).replaceAll('__SLUG__', name.replace(/-/g, '_'));
  // the templates are bundled as text into dist/server.js (imported only here, so `npm run dev` never needs them)
  const PLUGIN = (await import('./templates/plugin.mjs.txt')).default, VISUAL = (await import('./templates/visual.web.js.txt')).default;
  const files = [[`${name}.mjs`, PLUGIN], [`${name}.web.js`, VISUAL]] as const;
  await mkdir(dir, { recursive: true });
  for (const [f] of files) if (await access(resolve(dir, f)).then(() => true, () => false)) { console.log(`${f} already exists in ${dir}`); return 1; }
  for (const [f, t] of files) await writeFile(resolve(dir, f), fill(t));
  console.log(`Wrote ${files.map(f => f[0]).join(' and ')} in ${dir}.\nNext: add it to config.yaml (the file's first lines show how), place ${name}.status in the layout, restart.`);
  return 0;
}
