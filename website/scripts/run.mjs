// One way in for every step: bundles what needs bundling with Valet's own esbuild and runs it. `node scripts/run.mjs shots build`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(here, '..');
const bin = name => resolve(repo, 'node_modules/.bin', name);
if (!existsSync(bin('esbuild'))) { console.error('Run npm ci in the repo root first: the screenshots use Valet\'s own code and packages.'); process.exit(1); }
const run = (cmd, args, cwd = here, env = {}) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, VALET_DOCS_ROOT: here, ...env } });
const bundle = name => {
  mkdirSync(resolve(here, '.cache'), { recursive: true });
  // alias-free: the catalog only pulls in server code and the plain samples
  run(bin('esbuild'), [`scripts/${name}.ts`, '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=.cache/${name}.mjs`, '--loader:.txt=text', '--log-level=warning', '--tsconfig=../tsconfig.web.json',
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);']);
  run('node', [`.cache/${name}.mjs`]);
};
const steps = {
  catalog: () => bundle('catalog'),
  harness: () => run(bin('vite'), ['build', '--config', 'harness/vite.config.mjs', '--logLevel', 'warn']),
  // Valet's own build, for the whole-page scenes; dist/ is ignored and nothing else in the repo changes
  valet: () => run('npm', ['run', 'build'], repo),
  shots: () => { steps.catalog(); steps.harness(); steps.valet(); run('node', ['scripts/shots.ts']); },
  pages: () => run('node', ['scripts/pages.ts']),
  check: () => run('node', ['scripts/check.ts']),
  build: () => { steps.pages(); run(resolve(here, 'node_modules/.bin/astro'), ['build']); steps.check(); },
};
for (const s of process.argv.slice(2)) steps[s]();
