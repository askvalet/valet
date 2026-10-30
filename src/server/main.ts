import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { sameOrigin, setupAuth, userCommand } from './auth.ts';
import { loadConfig, usedSecrets } from './config.ts';
import { canAct, headers, hostGuard, redactor } from './security.ts';
import { makeContext, UPLOAD_DIR, type Instance, type Integration } from './core.ts';
import { Hub } from './hub.ts';
import { noticesFor, type Notice } from './notices.ts';
import { History } from './history.ts';
import { loadPlugins } from './plugins.ts';
import { checkCard } from '../shared/cards.schema.ts';
import { registry } from '../integrations/index.ts';

const CONFIG = process.env.ATRIUM_CONFIG ?? 'config.yaml';
const PORT = Number(process.env.PORT ?? 7575);
const HOST = process.env.HOST ?? '0.0.0.0';

// `node dist/server.js user add <name>` and friends manage accounts, then exit
if (process.argv[2] === 'new-integration') process.exit(await (await import('./plugins.ts')).scaffold(process.argv[3]));
if (process.argv[2] === 'user') process.exit(await userCommand(process.argv.slice(3)).catch(e => { console.error(String(e.message ?? e)); return 1; }));

// one bad promise in an integration shouldn't take the whole page down: log it and carry on
process.on('unhandledRejection', e => console.error('unhandled:', e instanceof Error ? e.message : e));

const config = loadConfig(CONFIG);
const redact = redactor(usedSecrets);
const acting = canAct(config);
const fromPlugins = await loadPlugins(registry, config.plugins.packages, config.plugins.replace);

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
  const inst = integration.create(parsed.data, makeContext(id));
  // a plugin's cards are checked against the catalog, so a mistake shows as the widget's error, not a broken page
  if (fromPlugins.has(block.type)) for (const w of Object.values(inst.widgets)) {
    const fetch = w.fetch.bind(w);
    w.fetch = async () => {
      const card = await fetch(), r = checkCard(card);
      if (!r.success) throw new Error(`card doesn't match the catalog: ${r.error.issues.slice(0, 2).map(i => `${i.path.join('.') || 'card'}: ${i.message}`).join('; ')}`);
      return card;
    };
  }
  instances.set(id, inst);
  meta.set(id, { type, name: integration.name, integration });
}

// Only widgets placed in the layout are polled.
const placed = new Set([...config.layout.flatMap(s => s.widgets.map(w => w.widget)), ...config.menubar, ...(config.weather ? [config.weather] : []), ...(config.island?.activities ?? [])]);
for (const key of placed) {
  const [inst, w] = key.split('.');
  if (!instances.get(inst)?.widgets[w]) console.error(`config: layout: no widget "${key}"`);
}
const history = config.history ? new History(config.history.hours, config.history.every * 60_000) : undefined;
await history?.load();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, async () => { try { await history?.save(); } finally { process.exit(0); } });

// notices go to every open page; the last few are replayed to a page that opens within a minute of them
const noticeListeners = new Set<(n: Notice) => void>(), recent: Notice[] = [];
const hub = new Hub(new Map([...instances].map(([id, i]) => [id, {
  ...i, widgets: Object.fromEntries(Object.entries(i.widgets).filter(([w]) => placed.has(`${id}.${w}`))),
}])), (key, prev, next) => {
  for (const n of noticesFor(key, prev?.card, next.card, config.island?.notify ?? [])) {
    recent.push(n); if (recent.length > 5) recent.shift();
    for (const l of noticeListeners) l(n);
  }
}, history);
if (history && config.history && config.history.background) hub.sampleInBackground(config.history.every * 60_000);

const app = new Hono();
app.use('*', hostGuard(config.allowedHosts));
app.use('*', headers);
// for Docker's healthcheck and uptime monitors: up, and how many widgets have a fresh card
app.get('/healthz', c => c.json({ ok: true, widgets: hub.snapshot().filter(s => s.card && !s.error).length }));

// Sign-in first: /api/auth/* are open; the wallpaper and icons too (the sign-in screen uses them); everything else
// under /api needs a session. Anything that changes something must also come from this page's origin.
app.use('/api/*', sameOrigin);                 // before the auth routes, so sign-in is covered too
const signedIn = await setupAuth(app, config);
app.use('/api/*', async (c, next) => {
  const p = c.req.path;
  if (p.startsWith('/api/auth/') || p === '/api/wallpaper' || p.startsWith('/api/icon/')) return next();
  return signedIn(c, next);
});

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
  title: config.title, greeting: config.greeting, location: config.location, canAct: acting,
  // ?v= the file's mtime: replacing the wallpaper changes the URL, so browsers never show a stale cached one
  appearance: { ...config.appearance, wallpaper: wallpaperFile ? `/api/wallpaper?v=${wallpaperVersion}` : wallpaper },
  assistant: config.assistant ? { name: config.assistant.name, model: config.assistant.model } : null,
  menubar: config.menubar.filter(k => hub.widget(k)),
  nav: config.nav,
  island: config.island && { ...config.island, activities: config.island.activities.filter(k => hub.widget(k)) },
  weather: config.weather && hub.widget(config.weather) ? config.weather : undefined,
  sections: config.layout.map(s => ({ title: s.title, columns: s.columns, display: s.display, place: s.place, overview: s.overview, variant: s.variant, header: s.header, heading: s.heading, tab: s.tab, chat: s.chat,
    widgets: s.widgets.map(w => w.widget).filter(k => hub.widget(k)),
    sizes: Object.fromEntries(s.widgets.filter(w => w.size !== 'medium').map(w => [w.widget, w.size])) })),
  widgets: Object.fromEntries([...placed].filter(k => hub.widget(k)).map(k => [k, { title: hub.widget(k)!.title }])),
}));

// Live updates: the full current state on connect, then each change as it happens.
app.get('/api/events', c => streamSSE(c, async stream => {
  // subscribe first so nothing changes unseen while the snapshot is written; a slow page keeps only the newest state
  // of each widget, so its queue can't grow without bound
  const queue = new Map<string, string>();
  let wake: (() => void) | null = null;
  const notices: string[] = recent.filter(n => Date.now() - n.at < 60_000).map(n => redact(JSON.stringify(n)));
  const off = hub.subscribe(s => { queue.delete(s.key); queue.set(s.key, redact(JSON.stringify(s))); wake?.(); });
  for (const s of hub.snapshot()) if (!queue.has(s.key)) queue.set(s.key, redact(JSON.stringify(s)));
  const tell = (n: Notice) => { notices.push(redact(JSON.stringify(n))); wake?.(); };
  noticeListeners.add(tell);
  stream.onAbort(() => { off(); noticeListeners.delete(tell); });
  while (!stream.aborted) {
    for (const [k, data] of queue) { queue.delete(k); await stream.writeSSE({ event: 'widget', data }); }
    while (notices.length) await stream.writeSSE({ event: 'notice', data: notices.shift()! });
    await Promise.race([new Promise<void>(r => (wake = r)), stream.sleep(25_000)]);
    wake = null;
    if (!queue.size && !notices.length) await stream.writeSSE({ event: 'ping', data: '' });   // keeps proxies from closing it
  }
  off(); noticeListeners.delete(tell);
}));

// Homepage controls: run an integration action, then refresh that integration's widgets right away.
// Files attached in chat (pasted, dropped or picked): stored for a day so a tool can file them (to Paperless, say).
// The browser gets back an id it puts in the message; nothing is served back out.
app.post('/api/files', bodyLimit({ maxSize: 50 * 2 ** 20, onError: c => c.json({ error: 'files are limited to 50 MB' }, 413) }), async c => {
  if (!acting) return c.json({ error: 'Atrium is read-only: attaching files is off' }, 403);
  // at most 500 MB waiting to be filed at once
  let held = 0;
  for (const f of await readdir(UPLOAD_DIR).catch(() => [] as string[])) held += (await stat(resolve(UPLOAD_DIR, f)).catch(() => ({ size: 0 }))).size;
  if (held > 500 * 2 ** 20) return c.json({ error: 'too many files waiting; try again later' }, 507);
  const body = Buffer.from(await c.req.arrayBuffer());
  if (!body.length) return c.json({ error: 'empty file' }, 400);
  if (body.length > 50 * 2 ** 20) return c.json({ error: 'files are limited to 50 MB' }, 413);
  const id = randomBytes(12).toString('hex');
  let name = 'pasted';
  try { name = decodeURIComponent(c.req.header('x-file-name') ?? 'pasted'); } catch {}
  name = name.replace(/[\/\\\x00-\x1f]/g, '_').slice(0, 200);
  const type = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0];
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(resolve(UPLOAD_DIR, `${id}.bin`), body);
  await writeFile(resolve(UPLOAD_DIR, `${id}.json`), JSON.stringify({ name, type, size: body.length }));
  // sweep anything older than a day
  for (const f of await readdir(UPLOAD_DIR).catch(() => [] as string[])) {
    const st = await stat(resolve(UPLOAD_DIR, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 864e5) await rm(resolve(UPLOAD_DIR, f), { force: true });
  }
  return c.json({ id, name, type, size: body.length });
});

app.post('/api/action/:inst/:action', async c => {
  if (!acting) return c.json({ error: 'Atrium is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)' }, 403);
  const { inst, action } = c.req.param();
  const a = instances.get(inst)?.actions?.[action];
  if (!a) return c.json({ error: `no action ${inst}.${action}` }, 404);
  const args = a.input.safeParse(await c.req.json().catch(() => ({})));
  if (!args.success) return c.json({ error: args.error.issues[0]?.message }, 400);
  try {
    const result = await a.run(args.data);
    setTimeout(() => hub.refreshInstance(inst), 300);
    return c.json(JSON.parse(redact(JSON.stringify({ ok: true, result: result ?? null }))));
  } catch (e) { return c.json({ error: redact((e as Error).message) }, 502); }
});

app.get('/api/image/:inst', async c => {
  const inst = instances.get(c.req.param('inst'));
  const ref = c.req.query('ref');
  if (!inst?.image || !ref) return c.notFound();
  try {
    const res = await inst.image(ref);
    if (!res.ok) return c.body(null, 502);
    // images only: a service that answers with HTML or a PDF never gets it served from Atrium's origin
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(?!svg)/.test(type)) { await res.body?.cancel(); return c.body(null, 415); }
    return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': 'inline' } });
  } catch { return c.body(null, 502); }
});

if (config.assistant) {
  // The AI SDK, providers and MCP client load on the first question, so an unused assistant costs no memory.
  let handler: ((c: any) => Promise<Response>) | undefined;
  app.post('/api/chat', async c => {
    handler ??= (await import('./chat.ts')).chatRoute(config, instances, meta, { acting, redact });
    return handler(c);
  });
}

// Community visuals: the browser half of a plugin, data/integrations/<kind>.web.js, served as a module
app.get('/plugins/:file', async c => {
  const file = c.req.param('file');
  if (!/^[a-z0-9][a-z0-9-]{0,63}\.web\.js$/.test(file)) return c.notFound();
  const body = await readFile(resolve(process.env.ATRIUM_DATA ?? 'data', 'integrations', file)).catch(() => null);
  return body ? c.body(body, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }) : c.notFound();
});

// Hashed assets never change, so they cache forever; the page itself is always revalidated, so a new build shows
// up on the next load instead of whenever the browser's heuristic cache expires.
const cacheFor = (path: string) => path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
app.use('/*', serveStatic({ root: './dist/web', onFound: (path, c) => { c.header('Cache-Control', cacheFor(path)); } }));
app.get('*', serveStatic({ path: './dist/web/index.html', onFound: (_, c) => { c.header('Cache-Control', 'no-cache'); } }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, i =>
  console.log(`atrium on http://${HOST}:${i.port} · ${instances.size} integrations · ${placed.size} widgets`));
