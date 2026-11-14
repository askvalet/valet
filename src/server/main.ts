import { randomBytes } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { accounts, clientIp, sameOrigin, setupAuth, setupWall, userCommand } from './auth.ts';
import { noOwner, viaOwner, viewOf, type View } from './people.ts';
import { judge, Presses, viewsFor, wallMayPress, wallReads, wallTokens, wallView, widgetsOf, type Mind, type WallView } from './wall.ts';
import type { WidgetState } from '../shared/cards.ts';
import { loadConfig, startConfig, validZone, type Config } from './config.ts';
import { Refresh } from './secrets.ts';
import { cleanCss, headers, hostGuard, served } from './security.ts';
import { UPLOAD_DIR, LOGO, hearBrowser } from './core.ts';
import { parseSuggestions, scopeOf, statusLine, suggestPrompt, troubles } from './insight.ts';
import { loadPins, newPin, pinnedCard, savePins } from './pins.ts';
import { loadPlugins } from './plugins.ts';
import { chatAgent, choices, discovery } from './model.ts';
import { buildRecap, recapYear } from './recap.ts';
import { discover } from './discover.ts';
import { mcpServer } from './mcpserver.ts';
import { hookRoute } from './hooks.ts';
import { listCommands, runCommand } from './commands.ts';
import { findersOf, search } from './search.ts';
import { confirmWords } from './confirm.ts';
import { Asks } from './asks.ts';
import { buildSite, type Site } from './site.ts';
import { accessOf, rank, toolAccess } from './run.ts';
import { customs } from '../shared/slash.ts';
import { CORE } from './lazy.ts';
import { registry } from '../integrations/index.ts';
import { LABELS } from '../shared/labels.ts';
import { cardLook, isBoth, isPaint, listOf, lookOf, type Both } from '../shared/look.ts';
import { sandbox } from './sandbox.ts';
import { allowed, has, pushAll, Subscription, subscribe, unsubscribe, vapidKeys } from './webpush.ts';
import { paletteDocs } from './guide.ts';
import { MAX_AUDIO, speak, transcribe, voiceForPage, voiceOf } from './voice.ts';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getCookie, setCookie } from 'hono/cookie';

const CONFIG = process.env.VALET_CONFIG ?? 'config.yaml';
const DATA = resolve(process.env.VALET_DATA ?? 'data');
const PORT = Number(process.env.PORT ?? 7575);
const HOST = process.env.HOST ?? '0.0.0.0';

// `node dist/server.js user add <name>`, `config check`, `doctor` and friends run and exit
if (process.argv[2] === 'new-integration') process.exit(await (await import('./plugins.ts')).scaffold(process.argv[3]));
if (process.argv[2] === 'check-integration') process.exit(await (await import('./plugins.ts')).checkPlugin(process.argv[3]));
if (process.argv[2] === 'user') process.exit(await userCommand(process.argv.slice(3), () => loadConfig(CONFIG)).catch(e => { console.error(String(e.message ?? e)); return 1; }));
if (process.argv[2] === 'config') process.exit(await (await import('./cli.ts')).configCommand(process.argv.slice(3), CONFIG, registry));
if (process.argv[2] === 'doctor') process.exit(await (await import('./doctor.ts')).doctorCommand(process.argv.slice(3), CONFIG, DATA, registry));
if (process.argv[2] === 'init') process.exit(await (await import('./init.ts')).initCommand(process.argv.slice(3), CONFIG, registry));
if (process.argv[2] === 'import') process.exit(await (await import('./import.ts')).importCommand(process.argv.slice(3), registry));

const sseClients = new Set<() => void>();
// why the last edit to config.yaml wasn't applied, until one is: shown on the page, not only in the log
let configError: { message: string; at: number } | null = null;

// one bad promise in an integration shouldn't take the whole page down: log it and carry on
process.on('unhandledRejection', e => console.error('unhandled:', e instanceof Error ? e.message : e));

const { config, saved } = await startConfig(CONFIG);
// Dates the server writes (assistant answers, "Tonight", watch history) need the person's clock, not the container's
// UTC. config `timezone` wins, then TZ; failing both, the first browser to open the page says where it is.
let zoneKnown = !!(config.timezone || process.env.TZ);
if (config.timezone) process.env.TZ = config.timezone;
const fromPlugins = await loadPlugins(registry, config.plugins.packages, config.plugins.replace);
const opts = { path: CONFIG, rebuild: () => swap(site.config) };
sandbox.on = config.sandbox;
let base: Site = await buildSite(config, registry, fromPlugins, opts);
// In a sandbox each request runs against that visitor's own copy of the site; otherwise there's just the one.
const own = new AsyncLocalStorage<Site>();
const site = new Proxy({} as Site, { get: (_, k) => Reflect.get(own.getStore() ?? base, k), set: (_, k, v) => Reflect.set(own.getStore() ?? base, k, v) });
// said at start and after each reload, loudly: with local accounts, a `users` that leaves no owner (people.ts)
const ownerless = async () => { const no = noOwner(site.config, await accounts()); if (no) console.error(`config: ${no}`); };
const stopSite = (s: Site) => { s.hub.dispose(); s.watcher?.stop(); s.watches.stop(); s.rules.stop(); s.stopBackups(); s.stopReminders(); s.stopEvents(); };
// A new site takes over from the old one, and every open page refetches and reconnects.
async function swap(next: Config) {
  const old = base;
  base = await buildSite(next, registry, fromPlugins, opts, old); chats = new WeakMap();
  stopSite(old);
  void syncBot();
  for (const tell of sseClients) tell();
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, async () => { try { await site.history?.save(); } finally { process.exit(0); } });

// Edits to config.yaml apply live. A broken edit is reported and the last good config keeps running; sign-in
// settings and plugins are read once, so those still need a restart.
if (config.reload) {
  let timer: NodeJS.Timeout | undefined;
  const reload = async (asked = true) => {
    let next; try { next = await loadConfig(CONFIG); } catch (e) {
      // a provider that's away when it's only time to ask again changes nothing: the values it gave still stand
      if (!asked) return void console.error(`secrets: not refreshed: ${(e as Error).message}`);
      console.error(`config: not applied: ${(e as Error).message}`);
      configError = { message: (e as Error).message, at: Date.now() };
      for (const tell of sseClients) tell();   // open pages fetch the page again, and say so
      return;
    }
    fresh.set(next.secrets.refresh);
    if (configError) { configError = null; if (JSON.stringify(next) === JSON.stringify(site.config)) { for (const tell of sseClients) tell(); return; } }
    if (JSON.stringify(next) === JSON.stringify(site.config)) return;
    if (JSON.stringify(next.auth) !== JSON.stringify(site.config.auth) || JSON.stringify(next.plugins) !== JSON.stringify(site.config.plugins)) console.log('config: auth and plugins changes take effect after a restart');
    if (next.timezone) { process.env.TZ = next.timezone; zoneKnown = true; }
    await swap(next);
    void ownerless();
    console.log(`config: reloaded · ${site.instances.size} integrations · ${site.placed.size} widgets${site.problems.length ? ` · ${site.problems.length} problems` : ''}`);
  };
  // secrets.refresh: the same reload on a timer, which rebuilds only when a file or a provider gave something new
  const fresh = new Refresh(() => reload(false));
  fresh.set(config.secrets.refresh);
  // editors save by replacing the file, which some watchers see as a delete; watch the folder and settle for 300ms
  try { watch(resolve(CONFIG, '..'), (_, f) => { if (f && resolve(CONFIG, '..', f) === resolve(CONFIG)) { clearTimeout(timer); timer = setTimeout(reload, 300); } }); }
  catch (e) { console.warn(`config: can't watch ${CONFIG} (${(e as Error).message})`); }
}

const app = new Hono();
app.use('*', hostGuard(() => site.config.allowedHosts));
app.use('*', headers);
// One site per visitor, kept for as long as they stay: a cookie says who's who, and nothing about them outlives it.
const VISITORS = 40, IDLE = 15 * 60_000, visitors = new Map<string, { site: Promise<Site>; at: number }>();
const leave = (id: string) => { const v = visitors.get(id); visitors.delete(id); void v?.site.then(stopSite, () => {}); };
if (sandbox.on) {
  setInterval(() => { for (const [id, v] of visitors) if (Date.now() - v.at > IDLE) leave(id); }, 60_000).unref();
  app.use('*', async (c, next) => {
    let id = getCookie(c, 'valet_visitor');
    if (!id || !/^[0-9a-f]{32}$/.test(id)) { id = randomBytes(16).toString('hex'); setCookie(c, 'valet_visitor', id, { httpOnly: true, sameSite: 'Lax', path: '/' }); }
    let v = visitors.get(id);
    if (!v) {
      if (visitors.size >= VISITORS) leave([...visitors].sort((a, b) => a[1].at - b[1].at)[0][0]);
      v = { site: buildSite(base.config, registry, fromPlugins, opts), at: 0 }; visitors.set(id, v);
    }
    v.at = Date.now();
    return own.run(await v.site, next);
  });
}
// Valet as a read-only MCP server, for an AI client of the owner's choosing. Outside /api: it has no session or page
// origin, so it answers only to its own bearer token, and only when mcpServer is configured. The demo never offers it.
const mcpSize = bodyLimit({ maxSize: 64 * 2 ** 10, onError: c => c.json({ error: 'request too large' }, 413) });
// what an MCP client asked to change, waiting for a person on the page to say yes or no (asks.ts)
const asks = new Asks();
app.post('/mcp', mcpSize, c => sandbox.on ? c.notFound() : mcpServer(c, site, asks));
app.get('/mcp', c => sandbox.on ? c.notFound() : mcpServer(c, site, asks));
// Webhooks in (hooks:, hooks.ts): a service on the network says something happened. Outside /api like /mcp, and each
// hook answers only to its own token; no hooks, no such hook and a wrong token are the same 401. The demo has none.
app.post('/hooks/:name', c => hookRoute(c, sandbox.on ? undefined : site));
app.get('/hooks/:name', c => hookRoute(c, sandbox.on ? undefined : site));

// for Docker's healthcheck and uptime monitors: up, and how many widgets have a fresh card
app.get('/healthz', c => c.json({ ok: true, widgets: site.hub.snapshot().filter(s => s.card && !s.error).length }));

// Sign-in first: /api/auth/* are open; the wallpaper and icons too (the sign-in screen uses them); everything else
// under /api needs a session, and test/exposure.ts holds that for every route in this file. Anything that changes something must also come from this page's origin.
const tooBig = (c: Context) => c.json({ error: 'request too large' }, 413);
const small = bodyLimit({ maxSize: 256 * 2 ** 10, onError: tooBig }), chatSize = bodyLimit({ maxSize: 8 * 2 ** 20, onError: tooBig });   // a chat carries its history
const voiceSize = bodyLimit({ maxSize: MAX_AUDIO + 64 * 2 ** 10, onError: c => c.json({ error: 'a recording is limited to about two minutes' }, 413) });
app.use('/api/*', sameOrigin);                 // before the auth routes, so sign-in is covered too
// JSON bodies are small; only uploads are big. Capping before anything reads a body means nobody, signed in or not,
// can make the server buffer megabytes (sign-in routes included).
app.use('/api/*', async (c, next) => c.req.path === '/api/files' ? next() : c.req.path === '/api/chat' ? chatSize(c, next) : c.req.path === '/api/voice/transcribe' ? voiceSize(c, next) : small(c, next));
const signedIn = await setupAuth(app, config);
void ownerless();
// A paired wall display (wall.token, or a screen's own) may make three reads, each held to its own screens' cards below,
// and one kind of press: an action a card on its touch list offers now (wall.ts). Nothing else.
const paired = config.auth.mode === 'none' ? () => undefined : await setupWall(app, config, () => wallTokens(site.config));
const WALL_READS = (p: string) => p === '/api/page' || p === '/api/events' || /^\/api\/image\/[^/]+$/.test(p);
const WALL_PRESS = (p: string) => /^\/api\/action\/[^/]+\/[^/]+$/.test(p);
/** The token a paired screen's request stands for; nothing for a person's. */
const wallToken = (c: Context) => (c.get as (k: string) => string | undefined)('wall');
const isWall = (c: Context) => !!wallToken(c);
/** The screen a request is about, `?wall=<name>` (left out or empty: /wall itself). A paired one only among its token's own. */
const screenOf = (c: Context) => { const view = wallView(site.config, c.req.query('wall') ?? ''), token = wallToken(c); return view && (!token || view.token === token) ? view : undefined; };
const presses = new Presses();
// which of a screen's pages may show now. What it remembers (wall.ts, `Mind`) belongs to the site, so every tab of a
// screen agrees, a reconnect doesn't set off a takeover again, and a new config starts clean.
const minds = new WeakMap<Site, Map<string, Mind>>();
const wallNow = (view: WallView) => {
  const key = own.getStore() ?? base, kept = minds.get(key) ?? minds.set(key, new Map()).get(key)!;
  const { mind, ...now } = judge(view, site.config, Date.now(), site.hub.snapshot(), kept.get(view.name));
  kept.set(view.name, mind);
  return now;
};
app.use('/api/*', async (c, next) => {
  const p = c.req.path;
  if (p.startsWith('/api/auth/') || p.startsWith('/api/wallpaper') || p === '/api/custom.css' || p === '/api/font' || p.startsWith('/api/icon/')) return next();
  let person = false;
  const res = await signedIn(c, async () => { person = true; await next(); });
  const token = !person && (c.req.method === 'GET' ? WALL_READS(p) : c.req.method === 'POST' && WALL_PRESS(p)) ? paired(c) : undefined;
  if (!token) return res;
  (c.set as (k: string, v: unknown) => void)('wall', token);
  return next();
});

// Who is asking (people.ts). With `profiles`, some accounts get a narrower Valet, and it's narrowed here, on the server:
// every route below reads this view and answers with what that person may see and do, or refuses. A new route does the
// same. (A paired wall is not a person; `isWall` is checked first wherever it can reach.)
const userOf = (c: Context) => (c.get as (k: string) => string | undefined)('user');
const viewFor = (c: Context): View => viewOf(site, (c.get as (k: string) => string | undefined)('account') ?? userOf(c));
/** The site as this person's doors read it: their config (their assistant or none) and their integrations. */
const siteFor = (v: View) => ({ config: v.config, instances: v.instances, meta: site.meta, acting: site.acting, redact: site.redact, activity: site.activity, hub: site.hub });
const OWNERS = 'That belongs to the owners of this Valet.';

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
    if (!sandbox.on) await mkdir(resolve(file, '..'), { recursive: true }).then(() => writeFile(file, body!)).catch(() => {});
  }
  return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' });
};
app.get('/api/icon/:slug', async c => {
  const asked = c.req.param('slug');
  if (!/^[a-z0-9-]{1,64}$/.test(asked)) return c.notFound();
  const slug = LOGO[asked] ?? asked;   // homeassistant is home-assistant to the icon set
  // your own icon: drop data/icons/<slug>.svg (or .png) and it wins over the CDN
  const svg = await readFile(resolve(ICON_DIR, `${slug}.svg`)).catch(() => null);
  if (svg) return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  // "immich-postgres" has no icon of its own, but "immich" does. What isn't there is remembered, so the CDN is asked once.
  const parts = slug.split('-').slice(0, 6);
  for (let n = parts.length; n > 0; n--) {
    const name = parts.slice(0, n).join('-');
    if (noIcon.has(name)) continue;
    const r = await cached(resolve(ICON_DIR, `${name}.png`), `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${name}.png`, 'image/png', c);
    if (r.status === 200) return r;
    if (noIcon.size > 5000) noIcon.clear();
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
const wallsOf = (w?: string | string[] | Both<string | string[]>, light = false): { image?: string; paint?: string }[] => isBoth(w) ? wallsOf(light ? w.light : w.dark) : listOf(w).map(v => {
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

/** A layout's sections as the page draws them, for the main page and the wall's pages alike */
const sectionsOf = (layout: Config['layout'], sees: (key: string) => boolean = () => true) => layout.map(s => ({ title: s.title, icon: s.icon, columns: typeof s.columns === 'object' ? s.columns.desktop ?? s.columns.tablet ?? s.columns.phone : s.columns, grid: typeof s.columns === 'object' ? s.columns : undefined, gap: s.gap, tabColumns: s.tabColumns, display: s.display, place: s.place, overview: s.overview, variant: s.variant, header: s.header, heading: s.heading, tab: s.tab, chat: s.chat, favorites: s.favorites,
  widgets: s.widgets.map(w => w.widget).filter(k => site.hub.widget(k) && sees(k)),
  sizes: Object.fromEntries(s.widgets.filter(w => w.size !== 'medium' && sees(w.widget)).map(w => [w.widget, w.size])),
  looks: Object.fromEntries(s.widgets.filter(w => sees(w.widget) && ('title' in w || 'icon' in w || 'header' in w || 'view' in w || 'rows' in w || 'cols' in w || cardLook(w))).map(w => [w.widget, { title: w.title, icon: w.icon, header: w.header, view: w.view, rows: w.rows, cols: w.cols, style: cardLook(w) }])) }));
/** One screen's settings and pages; never a token, another screen, or what a `when` says (it can name people). No pages:
 *  the browser builds the default one from the cards it hears. `touch` is what a press may work, and empty when nothing may.
 *  For someone with a profile, the pages keep only the cards they see (a page left with none shows just its clock: the
 *  pages stay, so the `wall` event's page numbers still mean the same pages) and nothing is pressable. */
const wallOf = (config: Config, view: WallView, v?: View) => {
  const { token: _, pages: __, layout: ___, touch: ____, people: _____, screens: ______, ...wall } = config.wall, shown = widgetsOf(view), member = !!v && !v.owner;
  return { ...wall, screen: view.name || undefined, conditional: view.pages.some(p => p.when) || undefined,
    touch: Object.fromEntries(site.acting && !member ? view.touch.filter(t => shown.includes(t.widget)).map(t => [t.widget, { hold: t.hold || undefined }]) : []),
    pages: view.pages.map(p => ({ title: p.title, every: p.every, clock: p.clock, takeover: p.takeover ? true : undefined, sections: sectionsOf(p.layout, member ? v!.sees : undefined).map(x => ({ ...x, chat: false })).filter(x => !member || x.widgets.length) })) };
};

app.get('/api/page', c => {
  const { config, instances, hub, placed } = site;
  // someone with a profile gets the same page with less in it: their tabs, their cards, their assistant or none, and
  // nothing that names the rest (a hidden tab's wallpaper, its place in the nav, a tool they can't use)
  const wall = isWall(c), v = wall ? viewOf(site) : viewFor(c), mine = v.config, me = v.owner ? undefined : v;
  const tz = v.owner && !wall ? c.req.query('tz') : undefined;
  if (!zoneKnown && tz && validZone(tz)) { process.env.TZ = tz; zoneKnown = true; console.log(`time zone: ${tz} (from the browser; set timezone in config.yaml to fix it)`); }
  const lang = v.owner && !wall ? c.req.query('lang') : undefined;
  if (config.format.locale === 'auto' && lang && lang.length < 36 && hearBrowser(lang)) console.log(`language: ${lang} (from the browser; set format.locale in config.yaml to fix it)`);
  const look = { ...lookOf(config), theme: config.appearance.theme, css: site.cssVersion && `/api/custom.css?v=${site.cssVersion}`, font: fontOf(config) };
  // walls are dark's (or the only ones); light's come too when the config gives one for each theme
  const { wallpaper, wallpapers } = config.appearance, both = [wallpaper, ...Object.values(wallpapers)].some(w => isBoth(w));
  const set = (light = false) => ({ walls: wallsOf(wallpaper, light), tabWalls: Object.fromEntries(Object.entries(wallpapers).filter(([t]) => v.tab(t)).map(([t, w]) => [t, wallsOf(w, light)])) });
  // background scripts by name, for each theme; a tab's own (a hidden tab's isn't named)
  const scene = (s?: string | { light: string; dark: string }) => s === undefined ? undefined : typeof s === 'string' ? { light: s, dark: s } : s;
  const scenes = { all: scene(config.appearance.background), tabs: Object.fromEntries(Object.entries(config.appearance.backgrounds).filter(([t]) => v.tab(t)).map(([t, s]) => [t, scene(s)!])) };
  const appearance = { ...set(), light: both ? set(true) : undefined, rotate: config.appearance.rotate, sizes: config.appearance.sizes, sounds: config.appearance.sounds, scenes };
  const weather = config.weather && hub.widget(config.weather) && v.sees(config.weather) ? config.weather : undefined;
  // a paired wall display learns how the page looks and the wall's own pages: no title, no assistant, nothing it could act
  // with, and no other card's name
  const view = screenOf(c);
  if (!view) return isWall(c) ? c.json({ error: 'not signed in' }, 401) : c.json({ error: `no wall screen "${(c.req.query('wall') ?? '').slice(0, 40)}"` }, 404);
  if (isWall(c)) return c.json(JSON.parse(site.redact(JSON.stringify({
    title: '', paired: true, canAct: false, sandbox: false, labels: { ...LABELS, ...config.labels }, format: config.format, look, weather,
    appearance: { ...appearance, tabWalls: {}, light: appearance.light && { walls: appearance.light.walls, tabWalls: {} }, scenes: { all: scenes.all, tabs: {} } }, wall: wallOf(config, view), sections: [],
    widgets: Object.fromEntries([...widgetsOf(view), ...weather ? [weather] : []].filter(k => hub.widget(k)).map(k => [k, { title: hub.widget(k)!.title }])),
  }))));
  const a = mine.assistant, agent = a && chatAgent(a, site.acting), level = (id: string, n: string) => Math.min(toolAccess(a, id, n), site.acting ? rank.control : rank.read);
  const gone = new Set(me ? config.layout.flatMap(s => s.tab ?? s.title ?? []).filter(t => !me.tab(t)) : []);
  const sections = sectionsOf(config.layout.filter(s => v.tab(s.tab ?? s.title)), v.sees);
  return c.json(JSON.parse(site.redact(JSON.stringify({
    title: config.title, greeting: config.greeting, notice: config.notice, location: config.location, canAct: site.acting, sandbox: sandbox.on, search: config.search, find: findersOf(siteFor(v)).length > 0,
    // a profile: who this is and the page actions they were given, so the page offers no button the server would refuse
    member: me && { name: me.name, actions: config.profiles[me.profile!]?.actions ?? [] },
    // everyone learns an edit didn't apply; the error itself can quote the file, so only people who can change things see it
    configError: configError ? { message: site.acting && v.owner ? site.redact(configError.message).slice(0, 600) : undefined, at: configError.at } : undefined,
    welcome: config.welcome && v.owner ? { path: CONFIG, saved, setup: site.acting && instances.has('config') } : undefined,
    recap: config.recap && v.owner, hero: { ...config.hero, scope: config.hero.scope === true ? scopeOf([...site.meta].filter(([id]) => !me || [...placed].some(k => k.startsWith(`${id}.`) && me.sees(k))).map(([, m]) => m.type)) : config.hero.scope || undefined }, labels: { ...LABELS, ...config.labels }, format: config.format,
    appearance, look,
    // the chat's own commands, by name and what they're for: the prompt is the server's to send
    chat: { ...config.chat, commands: a ? customs(mine.chat.commands).map(c => ({ name: c.name, description: c.description ?? (c.prompt.length > 70 ? `${c.prompt.slice(0, 68)}…` : c.prompt), ...(c.prompt.includes('{input}') ? { input: true } : {}) })) : [] },
    // which halves of voice are on, never where they go
    voice: sandbox.on ? undefined : voiceForPage(mine),
    // the demo's model is scripted, and says so beside its name
    assistant: a ? { ...(agent ? { name: agent.name, model: agent.model, external: true } : { name: a.name, model: sandbox.on ? `${a.model} (demo)` : a.model,
        // assistant.models: what the chat's header offers, the default first; one model offers nothing. With `auto`, the
        // rest of each listed server's models come from /api/models when the menu opens
        ...(a.models.length ? { models: choices(a).map(c => ({ id: c.id, model: c.settings.model })), ...(discovery(a).on && !sandbox.on ? { discover: true } : {}) } : {}) }), suggestions: a.suggestions,
      // how each tool reads in chat, keyed as the assistant names them ("<instance>__<tool>"); a profile's, only the ones it may use
      tools: Object.fromEntries([...v.instances].flatMap(([id, inst]) => Object.entries(inst.tools ?? {}).filter(([n, t]) => !me || rank[t.access] <= level(id, n))
        .map(([n, t]) => [`${id}__${n}`, { label: t.label, followUps: t.followUps, access: t.access, live: t.live }]))),
      // what @ offers: integrations with a tool the chat may use here, as the chat itself decides (chat.ts)
      integrations: [...v.instances].filter(([id, inst]) => !CORE.has(id) && Object.entries(inst.tools ?? {}).some(([n, t]) => rank[t.access] <= level(id, n)))
        .map(([id]) => ({ id, name: site.meta.get(id)?.name ?? id })) } : null,
    menubar: { ...config.menubar, widgets: config.menubar.widgets.filter(k => hub.widget(k) && v.sees(k)) },
    nav: me ? { ...config.nav, hide: config.nav.hide.filter(t => !gone.has(t)), order: config.nav.order.filter(t => !gone.has(t)) } : config.nav,
    live: config.live && { activities: config.live.activities.filter(k => hub.widget(k) && v.sees(k)) },
    weather,
    calendar: config.calendar && hub.widget(config.calendar) && v.sees(config.calendar) ? config.calendar : undefined,
    // what several problems have in common is about the whole homelab: owners only
    insight: v.owner ? site.watcher?.insight?.text : undefined,
    sections: me ? sections.map(x => ({ ...x, chat: x.chat && !!a })).filter(x => x.widgets.length || x.chat)
      : [...(site.pins.length ? [{ widgets: site.pins.map(p => `pins.${p.id}`).filter(k => hub.widget(k)), display: 'cards', place: 'main', overview: true, sizes: {} }] : []), ...sections],
    widgets: Object.fromEntries([...placed].filter(k => hub.widget(k) && v.sees(k)).map(k => [k, { title: hub.widget(k)!.title }])),
    wall: wallOf(config, view, v),
  }))));
});

// Live updates: the full current state on connect, then each change as it happens.
app.get('/api/events', c => isWall(c) && !screenOf(c) ? c.json({ error: 'not signed in' }, 401) : streamSSE(c, async stream => {
  const { hub, redact, recent, noticeListeners } = site;
  // a paired wall display hears its screen's cards and nothing else: no other widget, and no notices, which can name anything.
  // Someone with a profile hears their own cards, and a notice only when it's the page's own about one of those cards:
  // a reminder, a rule, backups and the insight are Valet's word to owners
  const wall = isWall(c), config = site.config, v = wall ? viewOf(site) : viewFor(c), view = wall || c.req.query('wall') !== undefined ? screenOf(c) : undefined;
  const heard = (s: WidgetState) => wall ? wallReads(config, s, view) : v.sees(s.key);
  const told = (n: { key?: string; owner?: true }) => !wall && (v.owner || (!n.owner && !!n.key && v.sees(n.key)));
  // a wall whose pages wait on a `when` is told which may show, as that changes: on any card's news, and every few
  // seconds for the clock and for what has to last before it counts. Which pages, never why.
  let look = !!view?.pages.some(p => p.when), shown = '', last = Date.now();
  const clock = look ? setInterval(() => { look = true; wake?.(); }, 5000) : undefined, judged = look;
  // subscribe first so nothing changes unseen while the snapshot is written; a slow page keeps only the newest state
  // of each widget, so its queue can't grow without bound
  const queue = new Map<string, string>();
  let wake: (() => void) | null = null, reloaded = false;
  const notices: string[] = recent.filter(n => told(n) && Date.now() - n.at < 60_000).map(n => redact(JSON.stringify(n)));
  const off = hub.subscribe(s => { if (judged) { look = true; wake?.(); } if (!heard(s)) return; queue.delete(s.key); queue.set(s.key, redact(JSON.stringify(s))); wake?.(); });
  for (const s of hub.snapshot()) if (heard(s) && !queue.has(s.key)) queue.set(s.key, redact(JSON.stringify(s)));
  // a page too slow to take them keeps the newest few, like its widgets: a busy hook can't grow its queue
  const tell = (n: { at: number; key?: string; owner?: true }) => { if (!told(n)) return; notices.push(redact(JSON.stringify(n))); if (notices.length > 20) notices.shift(); wake?.(); };
  const onReload = () => { reloaded = true; wake?.(); };
  // approvals waiting from outside the chat: the whole (short) list whenever it changes, and on connect if there is one
  const answers = !wall && site.acting && v.owner;   // only a page that could answer one is shown any: an owner's
  let asked = answers && asks.list().length > 0;
  const onAsk = () => { if (answers) { asked = true; wake?.(); } };
  noticeListeners.add(tell); sseClients.add(onReload); asks.listeners.add(onAsk);
  const done = () => { off(); clearInterval(clock); noticeListeners.delete(tell); sseClients.delete(onReload); asks.listeners.delete(onAsk); };
  stream.onAbort(done);
  while (!stream.aborted && !reloaded) {
    if (look) { look = false; const now = JSON.stringify(wallNow(view!)); if (now !== shown) { shown = now; last = Date.now(); await stream.writeSSE({ event: 'wall', data: now }); } }
    if (queue.size || notices.length || asked) last = Date.now();
    for (const [k, data] of queue) { queue.delete(k); await stream.writeSSE({ event: 'widget', data }); }
    while (notices.length) await stream.writeSSE({ event: 'notice', data: notices.shift()! });
    if (asked) { asked = false; await stream.writeSSE({ event: 'asks', data: redact(JSON.stringify(asks.list())) }); }
    if (!look) await Promise.race([new Promise<void>(r => (wake = r)), stream.sleep(25_000)]);   // a card that reported while this was writing has already asked for another look
    wake = null;
    if (!queue.size && !notices.length && !reloaded && !asked && Date.now() - last >= 24_000) { last = Date.now(); await stream.writeSSE({ event: 'ping', data: '' }); }   // keeps proxies from closing it
  }
  if (reloaded) await stream.writeSSE({ event: 'reload', data: '' });
  done();
}));

// Files attached in chat (pasted, dropped or picked): stored for a day so a tool can file them (to Paperless, say).
// The browser gets back an id it puts in the message; nothing is served back out.
// attachments last a day: swept on each upload, at start and every hour, so a quiet week still clears them
async function sweepUploads() {
  for (const f of await readdir(UPLOAD_DIR).catch(() => [] as string[])) {
    const st = await stat(resolve(UPLOAD_DIR, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 864e5) await rm(resolve(UPLOAD_DIR, f), { force: true });
  }
}
if (!sandbox.on) { void sweepUploads(); setInterval(() => void sweepUploads(), 3_600_000).unref(); }
app.post('/api/files', bodyLimit({ maxSize: 50 * 2 ** 20, onError: c => c.json({ error: 'files are limited to 50 MB' }, 413) }), async c => {
  if (!site.acting || sandbox.on) return c.json({ error: site.acting ? 'This demo keeps nothing, so it takes no files' : 'Valet is read-only: attaching files is off' }, 403);
  if (!viewFor(c).config.assistant) return c.json({ error: 'Files are for the assistant, and your profile has none' }, 403);   // a profile with no chat has nowhere to send one
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
  await sweepUploads();
  return c.json({ id, name, type, size: body.length });
});

// Homepage controls: run an integration action, then refresh that integration's widgets right away.
app.post('/api/action/:inst/:action', async c => {
  const { instances, hub, redact } = site, { inst, action } = c.req.param(), token = wallToken(c);
  // a paired screen presses only what a card on its touch list offers now, with that card's own arguments, and not too
  // fast; anything else is refused as a stranger's would be
  if (token) {
    if (!site.acting || !wallMayPress(viewsFor(site.config, token), hub.snapshot(), inst, action, await c.req.json().catch(() => null))) return c.json({ error: 'not signed in' }, 401);
    if (!presses.allow(token, Date.now())) return c.json({ error: 'Too many presses. Wait a moment.' }, 429);
  }
  if (!site.acting) return c.json({ error: 'Valet is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)' }, 403);
  // a profile presses the actions it lists and no others; the answer is the same whether or not the action exists
  if (!token && !viewFor(c).presses(inst, action)) return c.json({ error: 'That isn\'t part of your profile. An owner can do it, or add it to your profile.' }, 403);
  const a = instances.get(inst)?.actions?.[action];
  if (!a) return c.json({ error: `no action ${inst}.${action}` }, 404);
  const args = a.input.safeParse(await c.req.json().catch(() => ({})));
  if (!args.success) return c.json({ error: args.error.issues[0]?.message }, 400);
  const screen = token && screenOf(c)?.name;   // which screen says so only when its token is that screen's
  const who = token ? `${site.config.labels.wall ?? LABELS.wall}${screen ? ` · ${screen}` : ''}` : userOf(c) ?? 'you', what = `${site.meta.get(inst)?.name ?? inst}: ${a.description ?? action}`;
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

// An approval asked from outside the chat (an MCP client's call, or someone whose profile says approve: owner): an owner
// answers it here, like a button on the page, so a read-only page can't, and neither can whoever asked. What runs is what
// was asked, never anything this request says.
app.post('/api/asks/:id', async c => {
  if (!site.acting) return c.json({ error: 'Valet is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)' }, 403);
  if (!viewFor(c).owner) return c.json({ error: OWNERS }, 403);
  const { ok } = await c.req.json().catch(() => ({})) as { ok?: unknown };
  if (typeof ok !== 'boolean') return c.json({ error: 'ok: true or false' }, 400);
  const ask = asks.answer(c.req.param('id'), ok, userOf(c));
  if (!ask) return c.json({ error: 'That\'s no longer waiting.' }, 404);
  site.activity.add({ who: userOf(c) ?? 'you', via: 'page', what: `${ok ? 'Approved' : 'Declined'} for ${ask.from}: ${ask.said.title}`, ok: true });
  return c.json({ ok: true });
});

// ⌘K's plain commands ("pause downloads"): run by rule, never by a model, through the same doors as the chat (commands.ts)
// For a profile: the page actions it lists, and tools its own assistant may use that only look.
const commandSite = (c: Context) => { const v = viewFor(c); return { ...siteFor(v), member: v.owner ? undefined : v }; };
app.get('/api/commands', c => listCommands(c, commandSite(c)));
app.post('/api/command', c => runCommand(c, commandSite(c)));
// ⌘K's search inside the services: every search tool at once, each answer sent as it arrives (search.ts)
// a profile searches what its own assistant may read, and nothing without one
app.get('/api/search', c => search(c, siteFor(viewFor(c))));
// ⌘K's docs: Valet's own pages, searched here from the copy it ships, so it works offline. Read-only and public
// knowledge, so a read-only page and every profile get it too; titles, paths and a line each, never a file.
app.get('/api/docs', async c => c.json({ docs: await paletteDocs(c.req.query('q') ?? '', registry) }));

app.get('/api/image/:inst', async c => {
  const inst = site.instances.get(c.req.param('inst'));
  const ref = c.req.query('ref');
  const shown = (ok: (s: WidgetState) => boolean) => !!ref && site.hub.snapshot().some(s => ok(s) && JSON.stringify(s.card ?? null).includes(`/api/image/${encodeURIComponent(c.req.param('inst'))}?ref=${encodeURIComponent(ref)}`));
  // a paired wall display sees only the pictures its cards show now
  if (isWall(c) && (!ref || !site.hub.snapshot().some(s => viewsFor(site.config, wallToken(c)!).some(v => wallReads(site.config, s, v)) && JSON.stringify(s.card ?? null).includes(`/api/image/${encodeURIComponent(c.req.param('inst'))}?ref=${encodeURIComponent(ref)}`)))) return c.json({ error: 'not signed in' }, 401);
  // and someone with a profile, the pictures their cards show now, or an integration's their own assistant may read (its
  // answers carry pictures too). The same answer as for a picture that isn't there
  else if (!isWall(c)) { const v = viewFor(c); if (!v.owner && !shown(s => v.sees(s.key)) && accessOf(v.config.assistant, c.req.param('inst')) < rank.read) return c.notFound(); }
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
// The approval card's words: what this action is about to do. It only reads, and nothing runs until the person says so.
app.post('/api/confirm', async c => {
  const { tool, input } = await c.req.json().catch(() => ({} as any));
  const v = viewFor(c);
  return c.json(await confirmWords({ ...siteFor(v), strict: !v.owner }, tool, input));
});

// the page has just opened, so give its widgets a moment to report in
const settled = async () => { for (let i = 0; i < 12 && site.hub.snapshot().length < site.placed.size * .6; i++) await new Promise(r => setTimeout(r, 500)); };
// Suggestions are rewritten every half hour while the page is in use, sooner (every ten minutes at most) when what's
// playing or downloading changes, and at once when what's wrong changes: a chip about what's over is worse than none.
// Each rewrite takes the GPU for a while, so they're on the daily budget. The assistant's own work must not count as news: its activity would set off the next rewrite.
const OUTSIDE = new Set(['rss', 'hackernews', 'reddit', 'lobsters', 'changedetection', 'karakeep', 'paperless', 'calendar', 'releases', 'repository', 'twitch', 'iframe', 'http', 'api']);   // written by strangers: see suggestPrompt
let tailored: { at: number; mood: string; wrong: string; names: string[]; list: string[] | null } | undefined, tailoring: Promise<void> | undefined;
// A fresh install's welcome card: what's running here that Valet could show. Only while that card is on.
app.get('/api/discover', async c => {
  if (!site.config.welcome || !viewFor(c).owner) return c.json({ via: null, found: [] });
  return c.json(await discover(registry, Object.values(site.config.integrations).map((b: any) => ({ type: b.type, url: b.url }))));
});

// Written from every card on the page, and kept once for everyone: owners only. A profile's chips are its own `suggestions`.
app.get('/api/suggest', async c => {
  if (!viewFor(c).owner) return c.json({ list: null, wrong: [] });
  if (!site.ask || !site.config.assistant?.background.suggest || site.config.chat.suggestions !== 'ai') return c.json({ list: null });
  await settled();
  const states = site.hub.snapshot().filter(s => !OUTSIDE.has(site.meta.get(s.key.split('.')[0])?.type ?? ''));
  const bad = troubles(states), wrong = bad.map(t => t.id).sort().join();
  const mood = JSON.stringify([wrong, states.flatMap(s => ['play', 'download'].includes(s.card?.activity?.icon ?? '') ? [s.card!.activity!.title] : []).sort()]);
  const age = Date.now() - (tailored?.at ?? 0);
  if (!tailored || wrong !== tailored.wrong || (mood !== tailored.mood && age > 600_000) || age > 1_800_000) {
    tailoring ??= (async () => {
      const tools = [...site.instances].flatMap(([, i]) => Object.values(i.tools ?? {}).filter(t => t.access !== 'control').flatMap(t => t.label ?? []));
      const p = suggestPrompt(states, site.timeline.lines(6 * 36e5, 10, true), tools);
      const list = parseSuggestions(await site.ask!(p.system, p.prompt, 'background'));
      tailored = { at: Date.now(), mood, wrong, names: bad.map(t => t.name), list: list ?? tailored?.list ?? null };
    })().finally(() => { tailoring = undefined; });
    await tailoring;
  }
  // `wrong`: what was down when these were written, so the page can drop them the moment it's back
  return c.json({ list: tailored?.list ? JSON.parse(site.redact(JSON.stringify(tailored.list))) : null, wrong: JSON.parse(site.redact(JSON.stringify(tailored?.names ?? []))) });
});
app.get('/api/brief', async c => {
  if (!viewFor(c).owner) return c.json({ text: null });   // a line about the whole homelab
  if (!site.ask || !site.config.assistant?.background.brief) return c.json({ text: null });
  await settled();
  const b = await statusLine(site.ask, site.timeline.lines(8 * 36e5, 40, true), site.hub.snapshot());
  return c.json({ text: b ? site.redact(b.text) : null });
});

app.get('/api/recap', async c => {
  if (!site.config.recap || !viewFor(c).owner) return c.notFound();   // a year of every service: owners only
  const recap = await buildRecap(site.instances, recapYear(c.req.query('year')));
  return c.json(JSON.parse(site.redact(JSON.stringify(recap))));
});

// Keep a chat card on the page. It must really produce a card now, from a tool that only looks.
app.post('/api/pins', async c => {
  if (!site.acting) return c.json({ error: 'Valet is read-only' }, 403);
  if (!viewFor(c).owner) return c.json({ error: OWNERS }, 403);   // a pin changes the page for everyone
  const { tool, input } = await c.req.json().catch(() => ({} as any));
  if (typeof tool !== 'string' || !input || typeof input !== 'object') return c.json({ error: 'bad pin' }, 400);
  const a = site.config.assistant;
  if (!a) return c.json({ error: 'no assistant configured' }, 404);
  // a pin of several cards is checked card by card: `show` is a key the access list doesn't name
  const barred = (inst: string) => (a.access[inst] ?? a.access.default ?? 'read') === 'none';
  const reaches = tool === 'show' ? (Array.isArray(input.widgets) ? input.widgets : []).map((k: unknown) => String(k).split('.')[0]) : [tool.split('__')[0]];
  // and a tool assistant.access turns off by name (`plex.plex_streams: none`, `valet.show: none`) can't be pinned either
  const [pi, pn] = tool.split('__'), off = tool === 'show' ? a.access['valet.show'] === 'none' : toolAccess(a, pi, pn) === rank.none;
  if (!reaches.length || reaches.some(barred) || off) return c.json({ error: 'the assistant can\'t reach that' }, 403);
  if (sandbox.on) return c.json({ ok: true });   // a demo saves nothing, and a rebuild would reload every other visitor
  const pins = await loadPins();
  if (pins.length >= 24) return c.json({ error: 'that\'s plenty of pins; unpin one first' }, 409);
  if (pins.some(p => p.tool === tool && JSON.stringify(p.input) === JSON.stringify(input))) return c.json({ ok: true });
  try {
    const card = await pinnedCard({ tool, input }, site.instances);
    await savePins([...pins, newPin(tool, input, card.title ?? 'Pinned')]);
    site.activity.add({ who: userOf(c) ?? 'you', via: 'pin', what: `Pinned ${card.title ?? 'a card'}`, ok: true });
    await swap(site.config);
    return c.json({ ok: true });
  } catch (e) { return c.json({ error: site.redact((e as Error).message) }, 400); }
});

// A chat card staying current: the same re-run a pin does, for tools that opted in, a few seconds apart at most.
const liveCache = new Map<string, { at: number; card: unknown }>();
app.post('/api/live', async c => {
  // a profile's cards re-run under its own assistant's access, and `show` only draws the cards on its tabs
  const v = viewFor(c), instances = v.instances;
  const a = v.config.assistant, { tool, input } = await c.req.json().catch(() => ({} as any));
  if (!a || typeof tool !== 'string' || !input || typeof input !== 'object') return c.json({ error: 'bad request' }, 400);
  const [inst, name] = tool.split('__');
  // its integration, and the tool by name (`plex.plex_streams: none`, `valet.show: none`), must still be reachable
  const allowed = (id: string) => (a.access[id] ?? a.access.default ?? 'read') !== 'none' && (tool === 'show' ? a.access['valet.show'] !== 'none' : toolAccess(a, id, name) > rank.none);
  const ok = tool === 'show' ? Array.isArray(input.widgets) && input.widgets.every((k: unknown) => typeof k === 'string' && allowed(k.split('.')[0]) && v.sees(k))
    : inst !== 'valet' ? !!instances.get(inst)?.tools?.[name]?.live && allowed(inst) : v.owner && !!instances.get(inst)?.tools?.[name]?.live && a.access[`valet.${name}`] !== 'none';
  if (!ok) return c.json({ error: 'not a live card' }, 403);
  const id = JSON.stringify([tool, input, v.profile ?? '']), hit = liveCache.get(id);
  if (hit && Date.now() - hit.at < 5000) return c.json({ card: hit.card });
  try {
    const card = JSON.parse(site.redact(JSON.stringify(await pinnedCard({ tool, input }, instances))));
    liveCache.set(id, { at: Date.now(), card });
    if (liveCache.size > 40) liveCache.delete(liveCache.keys().next().value!);
    return c.json({ card });
  } catch (e) { return c.json({ error: site.redact((e as Error).message) }, 502); }
});

// The AI SDK, providers and MCP client load on the first question, so an unused assistant costs no memory.
// One chat per site and profile: a profile's is built from its own view (its assistant, its integrations), so what it's
// offered is decided once, here, and nothing a request says can widen it.
let chats = new WeakMap<Site, Map<string, (c: any) => Promise<Response>>>();
const answer = async (c: Context) => {
  if (!site.config.assistant) return c.json({ error: 'no assistant configured' }, 404);
  const v = viewFor(c);
  if (!v.config.assistant) return c.json({ error: 'Your profile has no assistant.' }, 403);
  const key = own.getStore() ?? base;
  // whatever watches the assistant at work gets told, and shows it straight away
  for (const [id, inst] of site.instances) for (const w of inst.onChat?.() ?? []) void site.hub.refresh(`${id}.${w}`);
  let mine = chats.get(key);
  if (!mine) chats.set(key, mine = new Map());
  const id = v.owner ? '' : `profile ${v.profile}`;
  let chat = mine.get(id);
  if (!chat) mine.set(id, chat = (await import('./chat.ts')).chatRoute(v.config, v.instances, site.meta, { acting: site.acting, redact: site.redact, activity: site.activity,
    member: v.owner ? undefined : { profile: v.profile!, sees: v.sees, viaOwner: v.approve === 'owner' ? viaOwner({ asks, meta: site.meta, redact: site.redact, activity: site.activity, push: m => site.push(m) }) : undefined } }));
  return chat(c);
};
app.post('/api/chat', answer);

// The same chat from Telegram (assistant.telegram, telegram.ts): its messages go through the chat's own handler, on an app
// nothing outside can reach, so there is one set of rules. Loaded only when it's configured, and never in the demo.
// A Telegram id bound to an account (`{ id, as: sam }`) is that account here too, profile and all; one that isn't is an owner.
const fromTelegram = new Hono().post('/', c => {
  const set = c.set as (k: string, v: unknown) => void;
  set('user', decodeURIComponent(c.req.header('x-valet-user') ?? '') || undefined); set('account', decodeURIComponent(c.req.header('x-valet-account') ?? '') || undefined);
  return answer(c);
});
let bot: { key: string; stop(): void } | undefined;
async function syncBot() {
  const a = sandbox.on ? undefined : base.config.assistant, t = a?.telegram;
  const { Telegram } = t ? await import('./telegram.ts') : { Telegram: undefined };
  const next = t && Telegram ? new Telegram({
    token: t.token, users: t.users.map(u => typeof u === 'object' ? u.id : u), as: new Map(t.users.flatMap(u => typeof u === 'object' ? [[u.id, u.as] as const] : [])), name: a!.name, redact: s => site.redact(s), api: process.env.VALET_TELEGRAM_API,   // the address only for a test's stand-in
    chat: (messages, who, signal, account) => Promise.resolve(fromTelegram.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-valet-user': encodeURIComponent(who), 'x-valet-account': encodeURIComponent(account ?? '') }, body: JSON.stringify({ messages }), signal })),
    confirm: (tool, input, account) => { const v = viewOf(site, account); return confirmWords({ ...siteFor(v), strict: !v.owner }, tool, input); },
    label: tool => { const [inst, name] = tool.split('__'); return site.instances.get(inst)?.tools?.[name]?.label; },
  }) : undefined;
  if (next?.key === bot?.key) return;   // the same bot for the same people: a reload leaves its conversations alone
  bot?.stop(); bot = next;
  void next?.start();
}
void syncBot();

// `auto` in assistant.models: each server's list, asked from here so its key stays here, and kept five minutes
// (`?fresh=1` asks again). What fails says so quietly, and the configured choices still work. The page gets each model's
// id, its name where the server gives one, and its server's heading: never an address or a key.
app.get('/api/models', async c => {
  const a = site.config.assistant;
  // a profile's chat runs on the main model: which servers there are and what they hold is the owner's to know
  if (!a || sandbox.on || chatAgent(a, site.acting) || !viewFor(c).owner) return c.json({ models: [], servers: [], ok: true });
  const listed = await discovery(a).list(c.req.query('fresh') === '1');
  const models = listed.models.map(m => ({ id: m.id, ...(m.id !== m.model ? { model: m.model } : {}), ...(m.label ? { label: m.label } : {}), group: m.group }));
  return c.json(JSON.parse(site.redact(JSON.stringify({ ok: listed.ok, at: listed.at, servers: listed.servers, models }))));
});

// Voice in the chat (voice:): the recording in, the words out; an answer in, MP3 out. Valet calls the speech server so
// its address and key stay here. Wherever the chat is, so is voice, with no more than the chat may do; never in the demo.
const voiceDeps = (c: Context) => ({
  voice: voiceOf(site.config), redact: site.redact,
  refusal: !site.config.assistant ? 'no assistant configured' : sandbox.on ? "This demo doesn't listen or speak" : !viewFor(c).config.assistant ? 'Your profile has no assistant.' : null,
  who: userOf(c) ?? clientIp((getConnInfo(c).remote.address ?? '?').replace(/^::ffff:/, ''), c.req.header('x-forwarded-for'), new Set(site.config.auth.proxy.trusted)),
});
app.post('/api/voice/transcribe', c => transcribe(c, voiceDeps(c)));
app.post('/api/voice/speak', c => speak(c, voiceDeps(c)));

// Notifications on this device (⌘K): Valet's own Web Push. Turning them on or off is acting on the page, so it needs what
// a button needs; the demo and a read-only page say why not instead. Each browser is one subscription, kept with its account.
// They're the owners': a notification can name anything, so someone with a profile can't turn them on, and a browser
// subscribed before its account got a profile is skipped (site.ts). Turning one's own off is always allowed.
const pushRefusal = (c: Context) => sandbox.on ? 'demo' : !site.acting ? 'read-only' : !site.config.notify.webPush.enabled ? 'off' : !viewFor(c).owner ? 'profile' : null;
app.get('/api/push', async c => {
  const why = pushRefusal(c);
  if (why) return c.json({ ready: false, why });
  const endpoint = c.req.query('endpoint');
  return c.json({ ready: true, key: (await vapidKeys()).publicKey, on: endpoint ? await has(endpoint, userOf(c)) : undefined });
});
app.post('/api/push', async c => {
  const why = pushRefusal(c);
  if (why) return c.json({ error: why, why }, 403);
  const body = await c.req.json().catch(() => ({}));
  const sub = Subscription.safeParse(body?.subscription);
  if (!sub.success) return c.json({ error: 'not a push subscription' }, 400);
  if (!allowed(sub.data.endpoint, site.config.notify.webPush.services)) return c.json({ error: `Valet doesn't post to ${new URL(sub.data.endpoint).host} (notify.webPush.services)` }, 400);
  const fresh = !(await has(sub.data.endpoint, userOf(c)));
  await subscribe(sub.data, userOf(c), typeof body.replaces === 'string' ? body.replaces : undefined);
  // the first time, one to this browser alone: it says it works, and it's how you'd find out it doesn't
  if (fresh && body.hello !== false) void pushAll({ title: 'Notifications are on', body: `${site.config.title} will tell this device when something needs you.`, url: '/' }, site.config.notify.webPush, sub.data.endpoint);
  return c.json({ ok: true });
});
app.delete('/api/push', async c => {
  if (!site.acting || sandbox.on) return c.json({ error: 'Valet is read-only' }, 403);
  const { endpoint } = await c.req.json().catch(() => ({}));
  if (typeof endpoint !== 'string') return c.json({ error: 'which subscription?' }, 400);
  return c.json({ ok: true, removed: await unsubscribe(endpoint, userOf(c)) });
});

// The app's manifest, for "Add to Home Screen" and installing. It's fetched before anyone signs in, so with sign-in on it
// names the config's title only to a session (the page asks with credentials) and says Valet to everyone else.
app.get('/manifest.webmanifest', async c => {
  let known = false;
  await signedIn(c, async () => { known = true; });
  const name = known ? site.config.title : 'Valet';
  return c.body(JSON.stringify({
    name, short_name: name.length > 12 ? 'Valet' : name, id: '/', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#0f0f10', theme_color: '#0f0f10',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache', Vary: 'Cookie' });
});

// Background scripts: data/backgrounds/<name>.js, served as a module from here, so the page's script-src 'self' allows them
app.get('/backgrounds/:file', async c => {
  const file = c.req.param('file');
  if (!/^[a-z0-9][a-z0-9-]{0,63}\.js$/.test(file)) return c.notFound();
  const body = await readFile(resolve(DATA, 'backgrounds', file)).catch(() => null);
  return body ? c.body(body, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }) : c.notFound();
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
