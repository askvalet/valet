import { randomBytes } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { sameOrigin, setupAuth, userCommand } from './auth.ts';
import { loadConfig, startConfig, validZone, type Config } from './config.ts';
import { cleanCss, headers, hostGuard, served } from './security.ts';
import { UPLOAD_DIR } from './core.ts';
import { parseSuggestions, statusLine, suggestPrompt, troubles, whyPrompt } from './insight.ts';
import { loadPins, newPin, pinnedCard, savePins } from './pins.ts';
import { loadPlugins } from './plugins.ts';
import { chatAgent } from './model.ts';
import { buildRecap, recapYear } from './recap.ts';
import { buildSite, type Site } from './site.ts';
import { registry } from '../integrations/index.ts';
import { LABELS } from '../shared/labels.ts';
import { cardLook, isPaint, listOf, lookOf } from '../shared/look.ts';

const CONFIG = process.env.VALET_CONFIG ?? 'config.yaml';
const DATA = resolve(process.env.VALET_DATA ?? 'data');
const PORT = Number(process.env.PORT ?? 7575);
const HOST = process.env.HOST ?? '0.0.0.0';

// `node dist/server.js user add <name>`, `config check` and friends run and exit
if (process.argv[2] === 'new-integration') process.exit(await (await import('./plugins.ts')).scaffold(process.argv[3]));
if (process.argv[2] === 'check-integration') process.exit(await (await import('./plugins.ts')).checkPlugin(process.argv[3]));
if (process.argv[2] === 'user') process.exit(await userCommand(process.argv.slice(3)).catch(e => { console.error(String(e.message ?? e)); return 1; }));
if (process.argv[2] === 'config') process.exit(await (await import('./cli.ts')).configCommand(process.argv.slice(3), CONFIG, registry));

const sseClients = new Set<() => void>();

// one bad promise in an integration shouldn't take the whole page down: log it and carry on
process.on('unhandledRejection', e => console.error('unhandled:', e instanceof Error ? e.message : e));

const { config, saved } = startConfig(CONFIG);
// Dates the server writes (assistant answers, "Tonight", watch history) need the person's clock, not the container's
// UTC. config `timezone` wins, then TZ; failing both, the first browser to open the page says where it is.
let zoneKnown = !!(config.timezone || process.env.TZ);
if (config.timezone) process.env.TZ = config.timezone;
const fromPlugins = await loadPlugins(registry, config.plugins.packages, config.plugins.replace);
const opts = { path: CONFIG, rebuild: () => swap(site.config) };
let site: Site = await buildSite(config, registry, fromPlugins, opts);
// A new site takes over from the old one, and every open page refetches and reconnects.
async function swap(next: Config) {
  const old = site;
  site = await buildSite(next, registry, fromPlugins, opts, old); chat = undefined;
  old.hub.dispose(); old.watcher?.stop(); old.watches.stop();
  for (const tell of sseClients) tell();
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, async () => { try { await site.history?.save(); } finally { process.exit(0); } });

// Edits to config.yaml apply live. A broken edit is reported and the last good config keeps running; sign-in
// settings and plugins are read once, so those still need a restart.
if (config.reload) {
  let timer: NodeJS.Timeout | undefined;
  const reload = async () => {
    let next; try { next = loadConfig(CONFIG); } catch (e) { console.error(`config: not applied: ${(e as Error).message}`); return; }
    if (JSON.stringify(next) === JSON.stringify(site.config)) return;
    if (JSON.stringify(next.auth) !== JSON.stringify(site.config.auth) || JSON.stringify(next.plugins) !== JSON.stringify(site.config.plugins)) console.log('config: auth and plugins changes take effect after a restart');
    if (next.timezone) { process.env.TZ = next.timezone; zoneKnown = true; }
    await swap(next);
    console.log(`config: reloaded · ${site.instances.size} integrations · ${site.placed.size} widgets${site.problems.length ? ` · ${site.problems.length} problems` : ''}`);
  };
  // editors save by replacing the file, which some watchers see as a delete; watch the folder and settle for 300ms
  try { watch(resolve(CONFIG, '..'), (_, f) => { if (f && resolve(CONFIG, '..', f) === resolve(CONFIG)) { clearTimeout(timer); timer = setTimeout(reload, 300); } }); }
  catch (e) { console.warn(`config: can't watch ${CONFIG} (${(e as Error).message})`); }
}

const app = new Hono();
app.use('*', hostGuard(() => site.config.allowedHosts));
app.use('*', headers);
// for Docker's healthcheck and uptime monitors: up, and how many widgets have a fresh card
app.get('/healthz', c => c.json({ ok: true, widgets: site.hub.snapshot().filter(s => s.card && !s.error).length }));

// Sign-in first: /api/auth/* are open; the wallpaper and icons too (the sign-in screen uses them); everything else
// under /api needs a session. Anything that changes something must also come from this page's origin.
const tooBig = (c: Context) => c.json({ error: 'request too large' }, 413);
const small = bodyLimit({ maxSize: 256 * 2 ** 10, onError: tooBig }), chatSize = bodyLimit({ maxSize: 8 * 2 ** 20, onError: tooBig });   // a chat carries its history
app.use('/api/*', sameOrigin);                 // before the auth routes, so sign-in is covered too
// JSON bodies are small; only uploads are big. Capping before anything reads a body means nobody, signed in or not,
// can make the server buffer megabytes (sign-in routes included).
app.use('/api/*', async (c, next) => c.req.path === '/api/files' ? next() : c.req.path === '/api/chat' ? chatSize(c, next) : small(c, next));
const signedIn = await setupAuth(app, config);
app.use('/api/*', async (c, next) => {
  const p = c.req.path;
  if (p.startsWith('/api/auth/') || p.startsWith('/api/wallpaper') || p === '/api/custom.css' || p === '/api/font' || p.startsWith('/api/icon/') || p.startsWith('/api/favicon/')) return next();
  return signedIn(c, next);
});

// by number, so only what the config lists can be asked for
const IMAGES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
app.get('/api/wallpaper/:n?', async c => {
  const wall = site.walls[Number(c.req.param('n') ?? 0)], type = wall && IMAGES[extname(wall.file).toLowerCase()];
  if (!type) return c.notFound();
  return c.body(await readFile(wall.file), 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
});
// your own CSS and font: public like the wallpaper, because the sign-in screen wears them too
app.get('/api/custom.css', async c => {
  const { css, cssFile } = site.config.appearance;
  if (!css && !cssFile) return c.notFound();
  const file = cssFile ? await readFile(resolve(cssFile), 'utf8').catch(() => `/* can't read ${cssFile} */`) : '';
  return c.body(cleanCss(site.redact(`${file}\n${css ?? ''}`)), 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
});
const FONTS: Record<string, string> = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
app.get('/api/font', async c => {
  const url = site.config.appearance.font?.url, type = url && !/^https?:/.test(url) && FONTS[extname(url).toLowerCase()];
  const body = type && await readFile(resolve(url)).catch(() => null);
  return body ? c.body(body, 200, { 'Content-Type': type as string, 'Cache-Control': 'no-cache' }) : c.notFound();
});

// Service icons from the open dashboard-icons set (the one Homepage uses), and sites' own favicons, fetched once by
// the server and cached on disk: the browser never talks to a CDN, and the page works offline after the first load.
const ICON_DIR = resolve(DATA, 'icons'), noIcon = new Set<string>();
const cached = async (file: string, url: string, type: string, c: Context) => {
  let body = await readFile(file).catch(() => null);
  if (!body) {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Valet' } }).catch(() => null);
    if (!r?.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return c.notFound();
    body = Buffer.from(await r.arrayBuffer());
    await mkdir(resolve(file, '..'), { recursive: true }).then(() => writeFile(file, body!)).catch(() => {});
  }
  return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
};
app.get('/api/icon/:slug', async c => {
  const slug = c.req.param('slug');
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return c.notFound();
  // your own icon: drop data/icons/<slug>.svg (or .png) and it wins over the CDN
  const svg = await readFile(resolve(ICON_DIR, `${slug}.svg`)).catch(() => null);
  if (svg) return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  // "immich-postgres" has no icon of its own, but "immich" does. What isn't there is remembered, so the CDN is asked once.
  const parts = slug.split('-');
  for (let n = parts.length; n > 0; n--) {
    const name = parts.slice(0, n).join('-');
    if (noIcon.has(name)) continue;
    const r = await cached(resolve(ICON_DIR, `${name}.png`), `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${name}.png`, 'image/png', c);
    if (r.status === 200) return r;
    noIcon.add(name);
  }
  return c.notFound();
});
app.get('/api/favicon/:host', async c => {
  const host = c.req.param('host').toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return c.notFound();
  return cached(resolve(ICON_DIR, 'sites', `${host}.ico`), `https://icons.duckduckgo.com/ip3/${host}.ico`, 'image/x-icon', c);
});

// ?v= the file's mtime: replacing a wallpaper changes the URL, so browsers never show a stale cached one
const wallsOf = (w?: string | string[]) => listOf(w).map(v => {
  if (isPaint(v)) return { paint: v };
  const n = site.walls.findIndex(x => x.path === v);
  return { image: n < 0 ? v : `/api/wallpaper/${n}?v=${site.walls[n].version}` };
});
/** a font to load, if the config names one: a stylesheet, or a file (remote, or Valet's own) */
const fontOf = ({ appearance: { font } }: Config) => {
  if (!font?.url) return undefined;
  const remote = /^https?:/.test(font.url), file = /\.(woff2?|ttf|otf)(\?|$)/i.test(font.url);
  return { family: font.family!.split(',')[0].replace(/["']/g, '').trim(), ...(file ? { file: remote ? font.url : '/api/font' } : { sheet: font.url }) };
};

app.get('/api/page', c => {
  const { config, instances, hub, placed } = site;
  const agent = config.assistant && chatAgent(config.assistant, site.acting);
  const tz = c.req.query('tz');
  if (!zoneKnown && tz && validZone(tz)) { process.env.TZ = tz; zoneKnown = true; console.log(`time zone: ${tz} (from the browser; set timezone in config.yaml to fix it)`); }
  return c.json({
    title: config.title, greeting: config.greeting, location: config.location, canAct: site.acting, search: config.search,
    welcome: config.welcome ? { path: CONFIG, saved } : undefined,
    recap: config.recap, hero: config.hero, labels: { ...LABELS, ...config.labels }, format: config.format,
    appearance: { walls: wallsOf(config.appearance.wallpaper), tabWalls: Object.fromEntries(Object.entries(config.appearance.wallpapers).map(([t, w]) => [t, wallsOf(w)])), rotate: config.appearance.rotate, sizes: config.appearance.sizes },
    look: { ...lookOf(config), theme: config.appearance.theme, css: site.cssVersion && `/api/custom.css?v=${site.cssVersion}`, font: fontOf(config) },
    chat: config.chat,
    assistant: config.assistant ? { ...(agent ? { name: agent.name, model: agent.model, external: true } : { name: config.assistant.name, model: config.assistant.model }), suggestions: config.assistant.suggestions,
      // how each tool reads in chat, keyed as the assistant names them ("<instance>__<tool>")
      tools: Object.fromEntries([...instances].flatMap(([id, inst]) => Object.entries(inst.tools ?? {})
        .map(([n, t]) => [`${id}__${n}`, { label: t.label, followUps: t.followUps, access: t.access, live: t.live }]))) } : null,
    menubar: { ...config.menubar, widgets: config.menubar.widgets.filter(k => hub.widget(k)) },
    nav: config.nav,
    island: config.island && { ...config.island, activities: config.island.activities.filter(k => hub.widget(k)) },
    weather: config.weather && hub.widget(config.weather) ? config.weather : undefined,
    calendar: config.calendar && hub.widget(config.calendar) ? config.calendar : undefined,
    insight: site.watcher?.insight?.text,
    sections: [...(site.pins.length ? [{ widgets: site.pins.map(p => `pins.${p.id}`).filter(k => hub.widget(k)), display: 'cards', place: 'main', overview: true, sizes: {} }] : []), ...config.layout.map(s => ({ title: s.title, icon: s.icon, columns: typeof s.columns === 'object' ? s.columns.desktop ?? s.columns.tablet ?? s.columns.phone : s.columns, grid: typeof s.columns === 'object' ? s.columns : undefined, gap: s.gap, tabColumns: s.tabColumns, display: s.display, place: s.place, overview: s.overview, variant: s.variant, header: s.header, heading: s.heading, tab: s.tab, chat: s.chat,
      widgets: s.widgets.map(w => w.widget).filter(k => hub.widget(k)),
      sizes: Object.fromEntries(s.widgets.filter(w => w.size !== 'medium').map(w => [w.widget, w.size])),
      looks: Object.fromEntries(s.widgets.filter(w => 'title' in w || 'icon' in w || 'header' in w || cardLook(w)).map(w => [w.widget, { title: w.title, icon: w.icon, header: w.header, style: cardLook(w) }])) }))],
    widgets: Object.fromEntries([...placed].filter(k => hub.widget(k)).map(k => [k, { title: hub.widget(k)!.title }])),
  });
});

// Live updates: the full current state on connect, then each change as it happens.
app.get('/api/events', c => streamSSE(c, async stream => {
  const { hub, redact, recent, noticeListeners } = site;
  // subscribe first so nothing changes unseen while the snapshot is written; a slow page keeps only the newest state
  // of each widget, so its queue can't grow without bound
  const queue = new Map<string, string>();
  let wake: (() => void) | null = null, reloaded = false;
  const notices: string[] = recent.filter(n => Date.now() - n.at < 60_000).map(n => redact(JSON.stringify(n)));
  const off = hub.subscribe(s => { queue.delete(s.key); queue.set(s.key, redact(JSON.stringify(s))); wake?.(); });
  for (const s of hub.snapshot()) if (!queue.has(s.key)) queue.set(s.key, redact(JSON.stringify(s)));
  const tell = (n: { at: number }) => { notices.push(redact(JSON.stringify(n))); wake?.(); };
  const onReload = () => { reloaded = true; wake?.(); };
  noticeListeners.add(tell); sseClients.add(onReload);
  const done = () => { off(); noticeListeners.delete(tell); sseClients.delete(onReload); };
  stream.onAbort(done);
  while (!stream.aborted && !reloaded) {
    for (const [k, data] of queue) { queue.delete(k); await stream.writeSSE({ event: 'widget', data }); }
    while (notices.length) await stream.writeSSE({ event: 'notice', data: notices.shift()! });
    await Promise.race([new Promise<void>(r => (wake = r)), stream.sleep(25_000)]);
    wake = null;
    if (!queue.size && !notices.length && !reloaded) await stream.writeSSE({ event: 'ping', data: '' });   // keeps proxies from closing it
  }
  if (reloaded) await stream.writeSSE({ event: 'reload', data: '' });
  done();
}));

// Files attached in chat (pasted, dropped or picked): stored for a day so a tool can file them (to Paperless, say).
// The browser gets back an id it puts in the message; nothing is served back out.
app.post('/api/files', bodyLimit({ maxSize: 50 * 2 ** 20, onError: c => c.json({ error: 'files are limited to 50 MB' }, 413) }), async c => {
  if (!site.acting) return c.json({ error: 'Valet is read-only: attaching files is off' }, 403);
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

// Homepage controls: run an integration action, then refresh that integration's widgets right away.
app.post('/api/action/:inst/:action', async c => {
  const { instances, hub, redact } = site;
  if (!site.acting) return c.json({ error: 'Valet is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)' }, 403);
  const { inst, action } = c.req.param();
  const a = instances.get(inst)?.actions?.[action];
  if (!a) return c.json({ error: `no action ${inst}.${action}` }, 404);
  const args = a.input.safeParse(await c.req.json().catch(() => ({})));
  if (!args.success) return c.json({ error: args.error.issues[0]?.message }, 400);
  const who = (c.get as (k: string) => string | undefined)('user') ?? 'you', what = `${site.meta.get(inst)?.name ?? inst}: ${a.description ?? action}`;
  try {
    const result = await a.run(args.data);
    setTimeout(() => hub.refreshInstance(inst), 300);
    // an action may say what it did ({ done: 'Archived a saved link' }); its description is written for a model
    site.activity.add({ who, via: 'page', what, action: (result as { done?: string } | undefined)?.done ?? `${site.meta.get(inst)?.name ?? inst}: ${action}`, input: args.data, ok: true });
    return c.json(JSON.parse(redact(JSON.stringify({ ok: true, result: result ?? null }))));
  } catch (e) {
    site.activity.add({ who, via: 'page', what, action: `${site.meta.get(inst)?.name ?? inst}: ${action}`, input: args.data, ok: false, error: redact((e as Error).message) });
    return c.json({ error: redact((e as Error).message) }, 502);
  }
});

app.get('/api/image/:inst', async c => {
  const inst = site.instances.get(c.req.param('inst'));
  const ref = c.req.query('ref');
  if (!inst?.image || !ref) return c.notFound();
  try {
    const res = await inst.image(ref, c.req.header('range'));
    if (!res.ok) return c.body(null, 502);
    const out = served(res);
    if (!out) await res.body?.cancel();
    return out ?? c.body(null, 415);
  } catch { return c.body(null, 502); }
});

// Things the page asks the model by itself. No tools here: see brain.ts.
const whyCache = new Map<string, { at: number; text: string }>();
// The approval card's words: what this action is about to do. It only reads, and nothing runs until the person says so.
app.post('/api/confirm', async c => {
  const { tool, input } = await c.req.json().catch(() => ({} as any));
  const [inst, name] = String(tool ?? '').split('__'), t = name ? site.instances.get(inst)?.tools?.[name] : undefined;
  const type = site.config.integrations[inst]?.type, logo = type ? `/api/icon/${type}` : undefined;
  if (!t?.confirm) return c.json({ logo });
  try { return c.json(JSON.parse(site.redact(JSON.stringify({ logo, ...await t.confirm(input ?? {}) })))); } catch { return c.json({ logo }); }
});

app.post('/api/why', async c => {
  const { key, about } = await c.req.json().catch(() => ({} as any));
  if (!site.ask) return c.json({ error: 'no assistant configured' }, 404);
  const widget = typeof key === 'string' ? site.hub.widget(key) : undefined;
  if (!widget) return c.json({ error: 'no such widget' }, 404);
  const id = `${key}|${String(about ?? '').slice(0, 200)}`, hit = whyCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return c.json({ text: hit.text });
  if (!site.hub.snapshot().some(s => s.key === key)) await site.hub.refresh(key);   // nobody's been watching it
  const all = site.hub.snapshot(), p = whyPrompt(widget.title, about == null ? undefined : String(about), all.find(s => s.key === key), site.history?.recent(key) ?? [], all);
  const text = await site.ask(p.system, p.prompt, 'asked');
  if (!text) return c.json({ error: "The assistant couldn't answer just now." }, 503);
  const clean = site.redact(text);
  whyCache.set(id, { at: Date.now(), text: clean });
  if (whyCache.size > 60) whyCache.delete(whyCache.keys().next().value!);
  return c.json({ text: clean });
});
// the page has just opened, so give its widgets a moment to report in
const settled = async () => { for (let i = 0; i < 12 && site.hub.snapshot().length < site.placed.size * .6; i++) await new Promise(r => setTimeout(r, 500)); };
// Suggestions are rewritten every half hour while the page is in use, or sooner (every ten minutes at most) when something
// the person cares about changes. Each rewrite takes the GPU for a while, so they're on the daily budget. The assistant's own work must not count as news: its activity would set off the next rewrite.
const OUTSIDE = new Set(['rss', 'hackernews', 'reddit']);   // written by strangers: see suggestPrompt
let tailored: { at: number; mood: string; list: string[] | null } | undefined, tailoring: Promise<void> | undefined;
app.get('/api/suggest', async c => {
  if (!site.ask || !site.config.assistant?.background.suggest || site.config.chat.suggestions !== 'ai') return c.json({ list: null });
  await settled();
  const states = site.hub.snapshot().filter(s => !OUTSIDE.has(site.meta.get(s.key.split('.')[0])?.type ?? ''));
  const mood = JSON.stringify([troubles(states).map(t => t.id).sort(), states.flatMap(s => ['play', 'download'].includes(s.card?.activity?.icon ?? '') ? [s.card!.activity!.title] : []).sort()]);
  const age = Date.now() - (tailored?.at ?? 0);
  if (!tailored || (mood !== tailored.mood && age > 600_000) || age > 1_800_000) {
    tailoring ??= (async () => {
      const tools = [...site.instances].flatMap(([, i]) => Object.values(i.tools ?? {}).filter(t => t.access !== 'control').flatMap(t => t.label ?? []));
      const p = suggestPrompt(states, site.timeline.lines(6 * 36e5, 10, true), tools);
      const list = parseSuggestions(await site.ask!(p.system, p.prompt, 'background'));
      tailored = { at: Date.now(), mood, list: list ?? tailored?.list ?? null };
    })().finally(() => { tailoring = undefined; });
    await tailoring;
  }
  return c.json({ list: tailored?.list ? JSON.parse(site.redact(JSON.stringify(tailored.list))) : null });
});
app.get('/api/brief', async c => {
  if (!site.ask || !site.config.assistant?.background.brief) return c.json({ text: null });
  await settled();
  const b = await statusLine(site.ask, site.timeline.lines(8 * 36e5, 40, true), site.hub.snapshot());
  return c.json({ text: b ? site.redact(b.text) : null });
});

app.get('/api/recap', async c => {
  if (!site.config.recap) return c.notFound();
  const recap = await buildRecap(site.instances, recapYear(c.req.query('year')));
  return c.json(JSON.parse(site.redact(JSON.stringify(recap))));
});

// Keep a chat card on the page. It must really produce a card now, from a tool that only looks.
app.post('/api/pins', async c => {
  if (!site.acting) return c.json({ error: 'Valet is read-only' }, 403);
  const { tool, input } = await c.req.json().catch(() => ({} as any));
  if (typeof tool !== 'string' || !input || typeof input !== 'object') return c.json({ error: 'bad pin' }, 400);
  if (!site.config.assistant) return c.json({ error: 'no assistant configured' }, 404);
  const pins = await loadPins();
  if (pins.length >= 24) return c.json({ error: 'that\'s plenty of pins; unpin one first' }, 409);
  if (pins.some(p => p.tool === tool && JSON.stringify(p.input) === JSON.stringify(input))) return c.json({ ok: true });
  try {
    const card = await pinnedCard({ tool, input }, site.instances);
    await savePins([...pins, newPin(tool, input, card.title ?? 'Pinned')]);
    site.activity.add({ who: (c.get as (k: string) => string | undefined)('user') ?? 'you', via: 'pin', what: `Pinned ${card.title ?? 'a card'}`, ok: true });
    await swap(site.config);
    return c.json({ ok: true });
  } catch (e) { return c.json({ error: site.redact((e as Error).message) }, 400); }
});

// A chat card staying current: the same re-run a pin does, for tools that opted in, a few seconds apart at most.
const liveCache = new Map<string, { at: number; card: unknown }>();
app.post('/api/live', async c => {
  const a = site.config.assistant, { tool, input } = await c.req.json().catch(() => ({} as any));
  if (!a || typeof tool !== 'string' || !input || typeof input !== 'object') return c.json({ error: 'bad request' }, 400);
  const allowed = (id: string) => (a.access[id] ?? a.access.default ?? 'read') !== 'none';
  const [inst, name] = tool.split('__');
  const ok = tool === 'show' ? Array.isArray(input.widgets) && input.widgets.every((k: unknown) => typeof k === 'string' && allowed(k.split('.')[0]))
    : inst !== 'valet' ? !!site.instances.get(inst)?.tools?.[name]?.live && allowed(inst) : !!site.instances.get(inst)?.tools?.[name]?.live;
  if (!ok) return c.json({ error: 'not a live card' }, 403);
  const id = JSON.stringify([tool, input]), hit = liveCache.get(id);
  if (hit && Date.now() - hit.at < 5000) return c.json({ card: hit.card });
  try {
    const card = JSON.parse(site.redact(JSON.stringify(await pinnedCard({ tool, input }, site.instances))));
    liveCache.set(id, { at: Date.now(), card });
    if (liveCache.size > 40) liveCache.delete(liveCache.keys().next().value!);
    return c.json({ card });
  } catch (e) { return c.json({ error: site.redact((e as Error).message) }, 502); }
});

// The AI SDK, providers and MCP client load on the first question, so an unused assistant costs no memory.
let chat: ((c: any) => Promise<Response>) | undefined;
app.post('/api/chat', async c => {
  if (!site.config.assistant) return c.json({ error: 'no assistant configured' }, 404);
  chat ??= (await import('./chat.ts')).chatRoute(site.config, site.instances, site.meta, { acting: site.acting, redact: site.redact, activity: site.activity });
  return chat(c);
});

// Community visuals: the browser half of a plugin, data/integrations/<kind>.web.js, served as a module
app.get('/plugins/:file', async c => {
  const file = c.req.param('file');
  if (!/^[a-z0-9][a-z0-9-]{0,63}\.web\.js$/.test(file)) return c.notFound();
  const body = await readFile(resolve(DATA, 'integrations', file)).catch(() => null);
  return body ? c.body(body, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }) : c.notFound();
});

// Hashed assets never change, so they cache forever; the page itself is always revalidated, so a new build shows
// up on the next load instead of whenever the browser's heuristic cache expires.
const cacheFor = (path: string) => path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
app.use('/*', serveStatic({ root: './dist/web', onFound: (path, c) => { c.header('Cache-Control', cacheFor(path)); } }));
app.get('*', serveStatic({ path: './dist/web/index.html', onFound: (_, c) => { c.header('Cache-Control', 'no-cache'); } }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, i =>
  console.log(`valet on http://${HOST}:${i.port} · ${site.instances.size} integrations · ${site.placed.size} widgets${site.problems.length ? ` · ${site.problems.length} config problems (node dist/server.js config check)` : ''}`));
