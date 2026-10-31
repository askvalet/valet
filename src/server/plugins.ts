// Community integrations. A plugin is a module whose default export is an integration (the same shape as the built-in
// ones: type, name, a zod config, create()), or a function that's handed Valet's toolkit and returns one, so a
// plugin can be a single .mjs file with no imports and no build step:
//
//   export default ({ z, defineIntegration }) => defineIntegration({ type: 'hello', name: 'Hello', config: z.object({}),
//     create: () => ({ widgets: { hi: { title: 'Hi', fetch: async () => ({ type: 'text', text: 'Hello!' }) } } }) })
//
// Plugins come from every .js/.mjs file in data/integrations/ and from the npm packages listed under `plugins:` in the
// config. They run inside Valet with the same access as built-in integrations: install only ones you trust.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { checkCard } from '../shared/cards.schema.ts';
import { defineIntegration, fmt, type Instance, type Integration } from './core.ts';
import { service } from './service.ts';

export const toolkit = { z, fmt, defineIntegration, service, checkCard };

async function load(spec: string): Promise<Integration[]> {
  const mod = await import(spec);
  const out = typeof mod.default === 'function' ? mod.default(toolkit) : mod.default;
  return (Array.isArray(out) ? out : [out]).filter(Boolean);
}
const valid = (i: any): i is Integration => i && typeof i.type === 'string' && typeof i.create === 'function' && typeof i.config?.safeParse === 'function';

/** Load plugins into the registry. Built-ins keep their names unless the config says a plugin may replace one. */
const mismatch = (card: unknown) => {
  const r = checkCard(card);
  return r.success ? null : `card doesn't match the catalog: ${r.error.issues.slice(0, 2).map(i => `${i.path.join('.') || 'card'}: ${i.message}`).join('; ')}`;
};

/** Check a plugin's cards against the catalog: a bad widget card becomes the widget's error, a bad chat card is dropped
 *  (the model still gets the data) with the reason logged. */
export function guardCards(inst: Instance) {
  for (const w of Object.values(inst.widgets)) {
    const fetch = w.fetch.bind(w);
    w.fetch = async () => { const card = await fetch(), bad = mismatch(card); if (bad) throw new Error(bad); return card; };
  }
  for (const [name, t] of Object.entries(inst.tools ?? {})) {
    const run = t.run.bind(t);
    t.run = async args => {
      const out = await run(args), bad = out.card && mismatch(out.card);
      if (!bad) return out;
      console.error(`plugin tool ${name}: ${bad}`);
      return { data: out.data };
    };
  }
  return inst;
}

export async function loadPlugins(registry: Record<string, Integration>, packages: string[], replace: string[]) {
  const dir = resolve(process.env.VALET_DATA ?? 'data', 'integrations');
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

/** `valet check-integration <file>`: runs a plugin against the sample it carries, as Valet's own tests do. */
export async function checkPlugin(file: string) {
  if (!file) { console.log('usage: check-integration <file.mjs>'); return 1; }
  const { checkService } = await import('./service-check.ts');
  const found = await load(pathToFileURL(resolve(file)).href), plain = found.filter(i => !(i as any).def);
  if (plain.length) console.log(`${plain.map(i => i.type).join(', ')}: written with defineIntegration, so there's no sample to run. Use service() to get this check.`);
  let bad = 0;
  for (const s of found.filter(i => (i as any).def) as any[]) {
    const problems = await checkService(s);
    console.log(problems.length ? `✗ ${s.def.name}\n${problems.map(p => `  ${p}`).join('\n')}` : `✓ ${s.def.name}: card, tile, assistant tool and failure handling all good`);
    bad += problems.length;
  }
  return bad ? 1 : 0;
}

/** `valet new-integration <name>`: writes a working plugin (and its visual) into data/integrations/ to start from. */
export async function scaffold(name: string) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name ?? '')) { console.log('usage: new-integration <name>   (lowercase letters, digits, dashes)'); return 1; }
  const { mkdir, writeFile, access } = await import('node:fs/promises');
  const dir = resolve(process.env.VALET_DATA ?? 'data', 'integrations');
  const fill = (t: string) => t.replaceAll('__SLUG__', name.replace(/-/g, '_')).replaceAll('__NAME__', name).replaceAll('__TITLE__', name.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase()))
    .replaceAll('__ENV__', name.toUpperCase().replace(/-/g, '_')).replaceAll('__SLUG__', name.replace(/-/g, '_'));
  // the templates are bundled as text into dist/server.js (imported only here, so `npm run dev` never needs them)
  // the short form by default; --full is everything an integration can do, and a visual of its own
  const full = process.argv.includes('--full');
  const PLUGIN = (await import(full ? './templates/plugin.mjs.txt' : './templates/service.mjs.txt')).default, VISUAL = (await import('./templates/visual.web.js.txt')).default;
  const files = (full ? [[`${name}.mjs`, PLUGIN], [`${name}.web.js`, VISUAL]] : [[`${name}.mjs`, PLUGIN]]) as [string, string][];
  await mkdir(dir, { recursive: true });
  for (const [f] of files) if (await access(resolve(dir, f)).then(() => true, () => false)) { console.log(`${f} already exists in ${dir}`); return 1; }
  for (const [f, t] of files) await writeFile(resolve(dir, f), fill(t));
  console.log(`Wrote ${files.map(f => f[0]).join(' and ')} in ${dir}.\nNext: add it to config.yaml (the file's first lines show how), place ${name}.status in the layout, restart.`);
  return 0;
}
