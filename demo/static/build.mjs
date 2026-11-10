// Builds the demo as a static site in demo/static/dist: `npm run demo:static`. Valet's page and backend.ts are bundled,
// and what only a server can work out (the layout, the year in review) is saved from a real one, once, here.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const repo = resolve(import.meta.dirname, '../..'), out = resolve(repo, 'demo/static/dist'), tmp = resolve(repo, 'demo/static/.cache'), port = 7799;
rmSync(out, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true });
mkdirSync(resolve(tmp, 'data/integrations'), { recursive: true }); mkdirSync(resolve(out, 'snapshot'), { recursive: true }); mkdirSync(resolve(out, 'api/icon'), { recursive: true });
cpSync(resolve(repo, 'demo/integrations/homelab.mjs'), resolve(tmp, 'data/integrations/homelab.mjs'));
cpSync(resolve(repo, 'demo/icons'), resolve(tmp, 'data/icons'), { recursive: true });
const config = readFileSync(resolve(repo, 'demo/config.yaml'), 'utf8').replace(/^allowedHosts:.*$/m, 'allowedHosts: []').replace('/demo/wallpaper.jpg', resolve(repo, 'demo/wallpaper.jpg'))
  .replace('type: demo-homelab', `type: demo-homelab\n    art: ${resolve(repo, 'demo/art/cameras')}`).replace('sandbox: true', 'sandbox: false');
writeFileSync(resolve(tmp, 'config.yaml'), config);

const env = { ...process.env, VALET_CONFIG: resolve(tmp, 'config.yaml'), VALET_DATA: resolve(tmp, 'data'), PORT: String(port), HOST: '127.0.0.1' };
const server = spawn('node', ['dist/server.js'], { cwd: repo, env, stdio: 'ignore' });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch {} await sleep(250); }
  await sleep(1500);
  const page = await (await fetch(`http://127.0.0.1:${port}/api/page`)).json(), recap = await fetch(`http://127.0.0.1:${port}/api/recap`).then(r => r.ok ? r.text() : 'null');
  page.canAct = true; page.sandbox = true; page.insight = null;
  // a speaker under each answer (recorded clips, see backend.ts) and a mic that says where voice is set up
  page.voice = { listen: true, speak: true, speakReplies: false, autoSend: false, demo: 'https://askvalet.dev/assistant/voice/' }; if (page.assistant && !/\(demo\)$/.test(page.assistant.model)) page.assistant.model += ' (demo)';
  writeFileSync(resolve(out, 'snapshot/page.json'), JSON.stringify(page));
  // installable like the real thing (notifications aren't: there's no server to send them)
  writeFileSync(resolve(out, 'manifest.webmanifest'), await (await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`)).text());
  writeFileSync(resolve(out, 'snapshot/recap.json'), recap.replace(/\/api\/image\/lab\?ref=cover-([0-9a-f]{12})/g, '/art/covers/$1.jpg').replace(/\/api\/image\/lab\?ref=([a-z]+)(\d)/g, (m, kind, n) => kind === 'album' ? `/art/album/${n}.jpg` : kind === 'page' ? `/art/pages/${n}.jpg` : kind === 'doc' ? `/art/docs/${n}.jpg` : kind === 'photo' ? `/art/photos/${n}.jpg` : m));
  for (const wall of page.appearance?.walls ?? []) if (wall.image?.startsWith('/api/')) { const path = resolve(out, wall.image.slice(1).split('?')[0]); mkdirSync(resolve(path, '..'), { recursive: true }); cpSync(resolve(repo, 'demo/wallpaper.jpg'), path); }
} finally { server.kill(); }

const parsed = execFileSync('node', ['--input-type=module', '-e', `import { loadConfig } from './src/server/config.ts'; console.log(JSON.stringify(await loadConfig(${JSON.stringify(resolve(tmp, 'config.yaml'))})));`], { cwd: repo, encoding: 'utf8' });
writeFileSync(resolve(out, 'snapshot/config.json'), parsed.replaceAll(repo, ''));
// ⌘K's docs: the sections of the pages the site has, searched in the tab as the server would (only fetched once it's used)
writeFileSync(resolve(out, 'snapshot/docs.json'), execFileSync('node', ['--input-type=module', '-e', `import { registry } from './src/integrations/index.ts'; import { docsIndex } from './src/server/guide.ts'; import { pathOf } from './src/shared/docs.ts';
const i = await docsIndex(registry); console.log(JSON.stringify({ ...i, parts: i.parts.filter(p => pathOf(p.page) !== undefined).map(p => ({ ...p, text: p.text.slice(0, 1500) })) }));`], { cwd: repo, encoding: 'utf8', maxBuffer: 2 ** 26 }));

execFileSync('npx', ['vite', 'build', '--config', 'demo/static/vite.config.mjs'], { cwd: repo, stdio: 'inherit' });
cpSync(resolve(repo, 'demo/art'), resolve(out, 'art'), { recursive: true });
cpSync(resolve(repo, 'demo/voices'), resolve(out, 'voices'), { recursive: true });
for (const f of readdirSync(resolve(repo, 'demo/icons'))) cpSync(resolve(repo, 'demo/icons', f), resolve(out, 'api/icon', f.replace(/\.(png|svg|webp)$/, '')));
cpSync(resolve(repo, 'demo/static/_headers'), resolve(out, '_headers'));
// /wall is the same page, which reads its address; a static host needs a file there
mkdirSync(resolve(out, 'wall'), { recursive: true }); cpSync(resolve(out, 'index.html'), resolve(out, 'wall/index.html'));
rmSync(tmp, { recursive: true, force: true });
console.log(`demo: ${out}`);
