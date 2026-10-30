import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { loadConfig } from './config.ts';
import { makeContext, type Instance, type Integration } from './core.ts';
import { Hub } from './hub.ts';
import { registry } from '../integrations/index.ts';

const CONFIG = process.env.ATRIUM_CONFIG ?? 'config.yaml';
const PORT = Number(process.env.PORT ?? 7575);
const HOST = process.env.HOST ?? '0.0.0.0';

const config = loadConfig(CONFIG);

// Build every integration instance from config. A broken block is reported and skipped, not fatal.
const instances = new Map<string, Instance>();
const meta = new Map<string, { type: string; name: string; integration: Integration }>();
for (const [id, block] of Object.entries(config.integrations)) {
  const integration = registry[block.type];
  if (!integration) { console.error(`config: integrations.${id}: unknown type "${block.type}"`); continue; }
  const { type, ...rest } = block;
  const parsed = integration.config.safeParse(rest);
  if (!parsed.success) {
    console.error(`config: integrations.${id}:\n` + parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    continue;
  }
  instances.set(id, integration.create(parsed.data, makeContext(id)));
  meta.set(id, { type, name: integration.name, integration });
}

// Only widgets placed in the layout are polled.
const placed = new Set([...config.layout.flatMap(s => s.widgets), ...config.menubar, ...(config.weather ? [config.weather] : []), ...(config.island?.activities ?? [])]);
for (const key of placed) {
  const [inst, w] = key.split('.');
  if (!instances.get(inst)?.widgets[w]) console.error(`config: layout: no widget "${key}"`);
}
const hub = new Hub(new Map([...instances].map(([id, i]) => [id, {
  ...i, widgets: Object.fromEntries(Object.entries(i.widgets).filter(([w]) => placed.has(`${id}.${w}`))),
}])));

const app = new Hono();

// A local wallpaper file is served from here; a URL is handed to the browser as is.
const wallpaper = config.appearance.wallpaper;
const wallpaperFile = wallpaper && !/^https?:\/\//.test(wallpaper) ? resolve(wallpaper) : null;
let wallpaperVersion = 0;
if (wallpaperFile) wallpaperVersion = Math.round((await stat(wallpaperFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs);
app.get('/api/wallpaper', async c => {
  if (!wallpaperFile) return c.notFound();
  const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' }[extname(wallpaperFile).toLowerCase()];
  if (!type) return c.notFound();
  wallpaperVersion = Math.round((await stat(wallpaperFile)).mtimeMs);
  return c.body(await readFile(wallpaperFile), 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
});

// Service icons from the open dashboard-icons set (the one Homepage uses), fetched once and cached on disk, so the
// browser never talks to a CDN and the page works offline after the first load.
const ICON_DIR = resolve(process.env.ATRIUM_DATA ?? 'data', 'icons');
app.get('/api/icon/:slug', async c => {
  const slug = c.req.param('slug');
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return c.notFound();
  // your own icon: drop data/icons/<slug>.svg (or .png) and it wins over the CDN
  const svg = await readFile(resolve(ICON_DIR, `${slug}.svg`)).catch(() => null);
  if (svg) return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  const file = resolve(ICON_DIR, `${slug}.png`);
  let body = await readFile(file).catch(() => null);
  if (!body) {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) return c.notFound();
    body = Buffer.from(await r.arrayBuffer());
    await mkdir(ICON_DIR, { recursive: true }).then(() => writeFile(file, body!)).catch(() => {});
  }
  return c.body(body, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
});

app.get('/api/page', c => c.json({
  title: config.title, greeting: config.greeting, location: config.location,
  // ?v= the file's mtime: replacing the wallpaper changes the URL, so browsers never show a stale cached one
  appearance: { ...config.appearance, wallpaper: wallpaperFile ? `/api/wallpaper?v=${wallpaperVersion}` : wallpaper },
  assistant: config.assistant ? { name: config.assistant.name, model: config.assistant.model } : null,
  menubar: config.menubar.filter(k => hub.widget(k)),
  nav: config.nav,
  island: config.island && { ...config.island, activities: config.island.activities.filter(k => hub.widget(k)) },
  weather: config.weather && hub.widget(config.weather) ? config.weather : undefined,
  sections: config.layout.map(s => ({ title: s.title, columns: s.columns, display: s.display, place: s.place, overview: s.overview, variant: s.variant, header: s.header, widgets: s.widgets.filter(k => hub.widget(k)) })),
  widgets: Object.fromEntries([...placed].filter(k => hub.widget(k)).map(k => [k, { title: hub.widget(k)!.title }])),
}));

// Live updates: the full current state on connect, then each change as it happens.
app.get('/api/events', c => streamSSE(c, async stream => {
  for (const s of hub.snapshot()) await stream.writeSSE({ event: 'widget', data: JSON.stringify(s) });
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const off = hub.subscribe(s => { queue.push(JSON.stringify(s)); wake?.(); });
  stream.onAbort(off);
  while (!stream.aborted) {
    while (queue.length) await stream.writeSSE({ event: 'widget', data: queue.shift()! });
    await Promise.race([new Promise<void>(r => (wake = r)), stream.sleep(25_000)]);
    wake = null;
    if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' });   // keeps proxies from closing it
  }
  off();
}));

// Homepage controls: run an integration action, then refresh that integration's widgets right away.
app.post('/api/action/:inst/:action', async c => {
  const { inst, action } = c.req.param();
  const a = instances.get(inst)?.actions?.[action];
  if (!a) return c.json({ error: `no action ${inst}.${action}` }, 404);
  const args = a.input.safeParse(await c.req.json().catch(() => ({})));
  if (!args.success) return c.json({ error: args.error.issues[0]?.message }, 400);
  try {
    const result = await a.run(args.data);
    setTimeout(() => hub.refreshInstance(inst), 300);
    return c.json({ ok: true, result });
  } catch (e) { return c.json({ error: (e as Error).message }, 502); }
});

app.get('/api/image/:inst', async c => {
  const inst = instances.get(c.req.param('inst'));
  const ref = c.req.query('ref');
  if (!inst?.image || !ref) return c.notFound();
  try {
    const res = await inst.image(ref);
    if (!res.ok) return c.body(null, 502);
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  } catch { return c.body(null, 502); }
});

if (config.assistant) {
  // The AI SDK, providers and MCP client load on the first question, so an unused assistant costs no memory.
  let handler: ((c: any) => Promise<Response>) | undefined;
  app.post('/api/chat', async c => {
    handler ??= (await import('./chat.ts')).chatRoute(config, instances, meta);
    return handler(c);
  });
}

// Hashed assets never change, so they cache forever; the page itself is always revalidated, so a new build shows
// up on the next load instead of whenever the browser's heuristic cache expires.
const cacheFor = (path: string) => path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
app.use('/*', serveStatic({ root: './dist/web', onFound: (path, c) => { c.header('Cache-Control', cacheFor(path)); } }));
app.get('*', serveStatic({ path: './dist/web/index.html', onFound: (_, c) => { c.header('Cache-Control', 'no-cache'); } }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, i =>
  console.log(`atrium on http://${HOST}:${i.port} · ${instances.size} integrations · ${placed.size} widgets`));
