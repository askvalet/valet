// `node dist/server.js import <homepage|homarr|dashy|heimdall> <path>`: another dashboard's config as a Valet one. A
// service Valet has an integration for becomes that integration; anything else becomes a link with an up/down check;
// groups stay as sections. Every key, token and password found is taken out: the config gets `${NAME}`, and the values
// are handed over separately for .env. These files are someone else's and may be anyone's: each reader takes only the
// shapes it knows, says what it left, and has no pattern that can be made to crawl.
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { flags } from './cli.ts';
import { makeContext, type Integration } from './core.ts';
import { match, secret } from './discover.ts';
import { worth } from './init.ts';
import { slug } from '../integrations/links.ts';

interface Creds { key?: string; username?: string; password?: string }
/** One thing on the old dashboard. `url` is where a person opens it, `api` where its widget asked; `kind` is the type the
 *  source gave it (without one its name has to do); `widget` marks a thing that was only ever a widget, never a link. */
interface Entry { group: string; name: string; url?: string; api?: string; ping?: string; kind?: string; icon?: string; note?: string; creds: Creds; widget?: boolean }
interface Skipped { what: string; why: string }
export interface Read { title?: string; search?: string; weather?: { latitude: number; longitude: number }; entries: Entry[]; skipped: Skipped[] }
export interface Env { name: string; value: string; of: string; note?: string }

const MAX_FILE = 5 * 2 ** 20, MAX_ENTRIES = 2000;
const obj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown, max = 300) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function text(path: string) {
  let size: number;
  try { size = statSync(path).size; } catch { throw new Error(`${path} can't be read`); }
  if (size > MAX_FILE) throw new Error(`${path} is over 5 MB, which no dashboard's config is`);
  return readFileSync(path, 'utf8');
}
function yamlOf(path: string) { const t = text(path); try { return parse(t) as unknown; } catch (e) { throw new Error(`${path} isn't valid YAML: ${(e as Error).message.split('\n')[0]}`); } }
function jsonOf(path: string) { const t = text(path); try { return JSON.parse(t) as unknown; } catch (e) { throw new Error(`${path} isn't valid JSON: ${(e as Error).message.slice(0, 120)}`); } }

/** the keys, tokens and passwords among a widget's options, whatever the source calls them */
function credsOf(o: Record<string, unknown> | undefined): Creds {
  const out: Creds = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    const name = flat(k), value = str(v, 4000);
    if (value === undefined) continue;
    if (['key', 'apikey', 'token', 'apitoken', 'accesstoken', 'secret'].includes(name)) out.key ??= value;
    else if (['username', 'user', 'login'].includes(name)) out.username ??= value;
    else if (['password', 'pass'].includes(name)) out.password ??= value;
  }
  return out;
}

/** Homepage's own way of keeping a secret out of its file: {{HOMEPAGE_VAR_X}} is the environment's X, and
 *  {{HOMEPAGE_FILE_X}} a file's contents, which Valet reads through X_FILE. */
const vars = (s: string) => s.replace(/\{\{HOMEPAGE_VAR_([A-Z0-9_]+)\}\}/g, '${HOMEPAGE_VAR_$1}').replace(/\{\{HOMEPAGE_FILE_([A-Z0-9_]+)\}\}/g, '${$1}');
const SECRETISH = /key|token|secret|pass|auth/i;
/** An http(s) address fit to write down: no password in front of the host and no key in the query (`lost` says one was
 *  taken out). Anything else, javascript: included, is no address. */
function web(raw: string | undefined) {
  if (!raw) return undefined;
  const s = vars(raw);
  if (s.includes('${')) return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('${') ? { url: s, lost: false } : undefined;
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  let lost = !!(u.username || u.password);
  u.username = u.password = '';
  for (const k of [...u.searchParams.keys()]) if (SECRETISH.test(k)) { u.searchParams.delete(k); lost = true; }
  return { url: lost ? u.href : s, lost };
}
/** A dashboard-icons name or an image address; an icon font's name or a file on the old dashboard's disk is dropped,
 *  and the link shows the site's own icon. */
function iconOf(raw: string | undefined) {
  if (!raw) return undefined;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return web(raw)?.url;
  const name = raw.startsWith('hl-') ? raw.slice(3) : raw;
  if (name.includes('/') || name.includes(' ') || /^(mdi|si|sh|fa[a-z]?|favicon|generative)(-|$)/.test(name)) return undefined;
  return slug(name.replace(/\.(png|svg|webp|jpe?g)$/i, '')) || undefined;
}

// ── Homepage (gethomepage.dev): services.yaml, and bookmarks.yaml, widgets.yaml and settings.yaml beside it ──────────
function homepage(path: string): Read {
  let dir: string | undefined;
  try { dir = statSync(path).isDirectory() ? path : undefined; } catch { throw new Error(`${path} can't be read`); }
  const file = (name: string) => dir ? [`${name}.yaml`, `${name}.yml`].map(f => join(dir!, f)).find(existsSync) : undefined;
  const services = dir ? file('services') : path;
  if (!services) throw new Error(`there's no services.yaml in ${path}`);
  const out: Read = { entries: [], skipped: [] }, doc = yamlOf(services);
  if (!Array.isArray(doc)) throw new Error(`${services} should be a list of groups, each a list of services; this isn't one`);
  const service = (group: string, name: string, p: Record<string, unknown>) => {
    const widgets = [p.widget, ...arr(p.widgets)].map(obj).filter(w => !!w), w = widgets[0];
    out.entries.push({ group, name, url: str(p.href), ping: str(p.siteMonitor), api: w && str(w.url), kind: w && str(w.type), icon: str(p.icon), note: str(p.description), creds: credsOf(w) });
    if (widgets.length > 1) out.skipped.push({ what: `${name}'s other ${plural(widgets.length - 1, 'widget')}`, why: 'a service brings one widget across' });
  };
  // a group's item is a service, or a group inside it, which becomes a group of its own
  const walk = (list: unknown, group: string, depth: number) => {
    for (const item of arr(list)) for (const [name, v] of Object.entries(obj(item) ?? {})) {
      if (Array.isArray(v)) { if (depth < 4) walk(v, name, depth + 1); }
      else if (obj(v)) service(group, name, obj(v)!);
      else out.skipped.push({ what: `${name} in ${group}`, why: 'it has no settings to read' });
    }
  };
  for (const g of doc) for (const [group, list] of Object.entries(obj(g) ?? {})) walk(list, group, 0);
  const bookmarks = file('bookmarks');
  for (const g of arr(bookmarks && yamlOf(bookmarks))) for (const [group, list] of Object.entries(obj(g) ?? {})) {
    for (const item of arr(list)) for (const [name, v] of Object.entries(obj(item) ?? {})) {
      const p = obj(arr(v)[0]) ?? obj(v);
      if (p) out.entries.push({ group, name, url: str(p.href), icon: str(p.icon), note: str(p.description), creds: {} });
    }
  }
  const widgets = file('widgets');
  for (const w of arr(widgets && yamlOf(widgets))) for (const [type, v] of Object.entries(obj(w) ?? {})) {
    const p = obj(v) ?? {}, lat = Number(p.latitude), lon = Number(p.longitude);
    if (['openmeteo', 'openweathermap', 'weatherapi'].includes(type) && p.latitude != null && p.longitude != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.weather ??= { latitude: lat, longitude: lon };
    else if (type === 'search' && str(p.provider)) out.search = str(p.provider);
    else if (type === 'glances' && str(p.url)) out.entries.push({ group: 'System', name: 'Glances', api: str(p.url), kind: 'glances', creds: credsOf(p), widget: true });
    else out.skipped.push({ what: `the ${type.slice(0, 40)} widget`, why: type === 'datetime' ? 'the top bar has a clock' : type === 'greeting' ? '`greeting:` says whose homelab it is' : 'Valet has no card like it' });
  }
  const settings = file('settings');
  out.title = str(obj(settings && yamlOf(settings))?.title, 80);
  return out;
}

// ── Dashy: conf.yml, sections of items, and widgets with their own options ─────────────────────────────────────────
function dashy(path: string): Read {
  const doc = obj(yamlOf(path));
  if (!doc || !Array.isArray(doc.sections)) throw new Error(`${path} has no \`sections:\` list, which a Dashy conf.yml always has`);
  const out: Read = { entries: [], skipped: [], title: str(obj(doc.pageInfo)?.title, 80) };
  for (const s of doc.sections) {
    const sec = obj(s);
    if (!sec) continue;
    const group = str(sec.name, 60) ?? 'Links';
    for (const it of arr(sec.items).flatMap(i => [i, ...arr(obj(i)?.subItems)])) {
      const p = obj(it), name = p && str(p.title);
      if (p && name) out.entries.push({ group, name, url: str(p.url), ping: str(p.statusCheckUrl), icon: str(p.icon), note: str(p.description), creds: {} });
      else if (p) out.skipped.push({ what: `an item in ${group}`, why: 'it has no title' });
    }
    for (const w of arr(sec.widgets)) {
      const p = obj(w), type = p && str(p.type, 60), o = obj(p?.options) ?? {};
      if (type) out.entries.push({ group, name: str(p!.label) ?? type, api: str(o.hostname) ?? str(o.url) ?? str(o.host), kind: type, creds: credsOf(o), widget: true });
    }
  }
  if (doc.pages) out.skipped.push({ what: 'its other pages', why: 'each is a file of its own: import them one at a time' });
  return out;
}

// ── Homarr: a board's JSON. Before 1.0 that's apps with an `integration` each, in categories; from 1.0, apps and
// integrations are lists of their own ───────────────────────────────────────────────────────────────────────────────
function homarr(path: string): Read {
  const doc = obj(jsonOf(path)), apps = arr(doc?.apps).map(obj).filter(a => !!a), integrations = arr(doc?.integrations).map(obj).filter(i => !!i);
  if (!apps.length && !integrations.length) throw new Error(`${path} has no \`apps\` list, which a Homarr board's JSON always has`);
  const out: Read = { entries: [], skipped: [], title: str(obj(obj(doc!.settings)?.customization)?.pageTitle, 80) };
  const categories = new Map(arr(doc!.categories).map(obj).filter(c => !!c).map(c => [str(c.id), str(c.name, 60)]));
  for (const a of apps) {
    const name = str(a.name);
    if (!name) { out.skipped.push({ what: 'an app', why: 'it has no name' }); continue; }
    const area = obj(a.area), integration = obj(a.integration), behaviour = obj(a.behaviour);
    const inner = str(a.url) ?? str(a.href), outer = str(behaviour?.externalUrl);
    out.entries.push({ group: (str(area?.type) === 'category' && categories.get(str(obj(area!.properties)?.id))) || 'Apps', name, url: outer ?? inner, api: inner, ping: str(a.pingUrl),
      kind: str(integration?.type), icon: str(obj(a.appearance)?.iconUrl) ?? str(a.iconUrl), note: str(a.description) ?? str(behaviour?.tooltipDescription),
      creds: credsOf(Object.fromEntries(arr(integration?.properties).map(obj).filter(p => !!p).map(p => [str(p.field) ?? '', p.value]))) });
  }
  for (const i of integrations) {
    const name = str(i.name) ?? str(i.kind);
    if (name) out.entries.push({ group: 'Apps', name, api: str(i.url), kind: str(i.kind), creds: credsOf(Object.fromEntries(arr(i.secrets).map(obj).filter(s => !!s).map(s => [str(s.kind) ?? '', s.value]))) });
  }
  const widgets = arr(doc!.widgets).map(obj).filter(w => !!w), other = new Set<string>();
  for (const w of widgets) {
    const at = obj(obj(w.properties)?.location), lat = Number(at?.latitude), lon = Number(at?.longitude);
    if (str(w.type) === 'weather' && at?.latitude != null && at.longitude != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.weather ??= { latitude: lat, longitude: lon };
    else other.add(str(w.type, 40) ?? 'unnamed');
  }
  if (other.size) out.skipped.push({ what: `its widgets (${[...other].slice(0, 12).join(', ')})`, why: 'Valet\'s cards come from the integrations: add the ones you want to `layout`' });
  return out;
}

// ── Heimdall: its exported JSON, a list of apps. An "enhanced" app keeps its settings as JSON in `description` ───────
function heimdall(path: string): Read {
  const doc = jsonOf(path), list = Array.isArray(doc) ? doc : arr(obj(doc)?.items ?? obj(doc)?.apps ?? obj(doc)?.data);
  if (!list.length) throw new Error(`${path} has no apps: Heimdall's export is a JSON list, each app with a title and a url`);
  const out: Read = { entries: [], skipped: [] };
  for (const it of list) {
    const p = obj(it), name = p && (str(p.title) ?? str(p.name));
    if (!p || !name) { out.skipped.push({ what: 'an app', why: 'it has no title' }); continue; }
    const words = str(p.description, 20_000);
    let settings: Record<string, unknown> | undefined;
    if (words?.startsWith('{')) try { settings = obj(JSON.parse(words)); } catch { /* a description that only looks like JSON */ }
    const tags = arr(p.tags).map(t => str(t, 60) ?? str(obj(t)?.title, 60)).filter(t => !!t);
    out.entries.push({ group: str(p.tag, 60) ?? tags[0] ?? 'Apps', name, url: str(p.url), api: str(settings?.override_url), kind: str(p.class)?.split('\\').pop() || undefined,
      note: settings || words?.startsWith('{') ? str(p.appdescription) : words?.slice(0, 300), creds: credsOf(settings) });
  }
  return out;
}

export const SOURCES = { homepage: { name: 'Homepage', read: homepage }, homarr: { name: 'Homarr', read: homarr }, dashy: { name: 'Dashy', read: dashy }, heimdall: { name: 'Heimdall', read: heimdall } } as const;
export type Source = keyof typeof SOURCES;

// what another dashboard calls a thing Valet knows by another name
const ALIAS: Record<string, string> = { overseerr: 'seerr', jellyseerr: 'seerr', paperlessngx: 'paperless', npm: 'nginxproxymanager', speedtest: 'speedtesttracker', changedetectionio: 'changedetection',
  synology: 'diskstation', channelsdvrserver: 'channelsdvr', proxmoxbackupserver: 'proxmoxbackup', pbs: 'proxmoxbackup', wud: 'whatsupdocker', adguardhome: 'adguard', hass: 'homeassistant', calibre: 'calibreweb' };
/** Which integration an entry is: by the type its source gave it, or else by its name. A widget's type may say more than
 *  the app ("pi-hole-stats", Dashy's "gl-current-cpu"), so that's read by how it starts. */
function find(registry: Record<string, Integration>, e: Entry) {
  const said = flat(e.kind ?? e.name), key = Object.hasOwn(ALIAS, said) ? ALIAS[said] : said;
  const exact = match(registry, key, key);
  if (exact || !e.widget) return exact;
  if (said.startsWith('gl') && e.kind?.startsWith('gl-')) return match(registry, 'glances', 'glances');
  const starts = Object.keys(registry).map(flat).filter(t => t.length >= 5 && said.startsWith(t)).sort((a, b) => b.length - a.length)[0];
  return starts ? match(registry, starts, starts) : null;
}

/** The Valet config an old dashboard comes to, the secrets it held (for .env, never the config), and what became what. */
export function convert(read: Read, registry: Record<string, Integration>, source = 'the old dashboard') {
  // links by group in a Map: a group may be called anything, `__proto__` included
  const integrations: Record<string, Record<string, unknown>> = {}, links = new Map<string, { name: string; url: string; icon?: string; note?: string }[]>();
  const targets: Record<string, unknown>[] = [], env = new Map<string, Env>(), sections = new Map<string, string[]>();
  const made = { integrations: [] as string[], links: [] as string[], skipped: [...read.skipped], notes: [] as string[] };
  const taken = new Set(['valet', 'pins', 'config', 'links', 'status', 'weather', 'coming']), same = new Map<string, string>(), titles = new Map<string, string>();
  const idFor = (name: string) => { const stem = slug(name).slice(0, 40) || 'service'; let id = stem; for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`; taken.add(id); return id; };
  // two groups that would share a widget key are one group
  const groupOf = (g: string) => { const s = slug(g) || 'links'; if (!titles.has(s)) titles.set(s, g.trim().slice(0, 60) || 'Links'); return titles.get(s)!; };
  const place = (group: string, keys: string[]) => { const at = sections.get(group) ?? []; sections.set(group, at); for (const k of keys) if (!at.includes(k)) at.push(k); };
  /** what the config holds where a secret was, and the lines .env needs for it */
  const keep = (id: string, key: string, value: string | undefined, of: string): { ref: string; adds: Env[] } => {
    const moved = value === undefined ? undefined : vars(value);
    // the source already kept it in the environment: the same name does, nothing to move
    if (moved !== undefined && moved !== value) return { ref: moved, adds: [...moved.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m => ({ name: m[1], value: '', of, note: m[1].startsWith('HOMEPAGE_VAR_') ? `already in ${source}'s environment under this name` : `${source} read it from a file: set ${m[1]}_FILE to that file's path` })) };
    const ref = secret(id, key), name = ref.slice(2, -1);
    return { ref, adds: [{ name, value: value ?? '', of, ...(value === undefined ? { note: `${source}'s config didn't have it: fill it in` } : {}) }] };
  };
  // for checking a block that holds ${NAME}s the way Valet will see it once they're set
  const filled = (v: unknown, key = ''): unknown => typeof v === 'string' ? (/^\$\{[A-Z0-9_]+\}$/.test(v) && /url$/i.test(key) ? 'http://x' : v.replace(/\$\{[A-Z0-9_]+\}/g, 'x'))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, filled(x, k)])) : v;

  /** Tries an entry as an integration. Says why not when it can't be one ('' when Valet has none for it). */
  const integrate = (e: Entry, group: string): string | undefined => {
    const m = find(registry, e);
    if (!m) return '';
    const address = web(e.api ?? e.url);
    if (address?.lost) made.notes.push(`${e.name}: a password or key was in its address and was taken out`);
    // known only by its name and holding no key: a link is what works today, and the integration is a line away
    const guess = !e.kind && !e.creds.key && !e.creds.password, later = `Valet has a ${m.i.type === 'arr' ? m.app[0].toUpperCase() + m.app.slice(1) : m.i.name} integration; add its key to use it`;
    if (m.i.type === 'arr') {
      if (!address) return 'it has no address';
      if (guess) return later;
      const coming = integrations.coming ??= { type: 'arr' };
      if (coming[m.app]) return `Valet's "coming up" takes one ${m.app}`;
      const k = keep(m.app, 'key', e.creds.key, e.name);
      coming[m.app] = { url: address.url, apiKey: k.ref };
      for (const a of k.adds) env.set(a.name, a);
      place(group, ['coming.upcoming']); made.integrations.push(`${e.name} (coming: ${m.app})`);
      return undefined;
    }
    const schema = z.toJSONSchema(m.i.config as z.ZodType, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, unknown>; required?: string[] };
    const props = schema.properties ?? {}, required = new Set(schema.required ?? []);
    if (props.url && !address) return 'it has no address';
    const was = same.get(`${m.i.type} ${address?.url}`);
    if (was) return undefined;   // the same service twice (a widget each for its numbers): once is enough
    const slots = ['key', 'apiKey', 'token'].filter(k => props[k]), slot = slots.find(k => required.has(k)) ?? slots[0];
    const id = idFor(e.widget && e.kind ? m.i.type : e.name), wants: [string, string | undefined][] = [];
    if (slot && (required.has(slot) || e.creds.key)) wants.push([slot, e.creds.key]);
    if (props.username && (required.has('username') || e.creds.username)) wants.push(['username', e.creds.username]);
    const password = e.creds.password ?? (slot ? undefined : e.creds.key);   // Pi-hole's key is an app password here
    if (props.password && (required.has('password') || password)) wants.push(['password', password]);
    const refuse = (why: string) => { taken.delete(id); return why; };
    const lacks = [...required].filter(k => k !== 'url' && !wants.some(([w]) => w === k));
    if (guess && (slot || props.password) && wants.some(([, v]) => v === undefined)) return refuse(later);
    if (lacks.length) return refuse(`Valet's ${m.i.name} needs ${lacks.join(', ')}, which ${source} doesn't say`);
    // some take a key or a sign-in and require neither by itself: with nothing given, ask for the key
    for (const extra of [false, true]) {
      if (extra) { if (wants.length || !slot) break; if (guess) return refuse(later); wants.push([slot, undefined]); }
      const kept = wants.map(([k, v]) => [k, keep(id, k, v, e.name)] as const);
      const block: Record<string, unknown> = { type: m.i.type, ...(props.url ? { url: address!.url } : {}), ...Object.fromEntries(kept.map(([k, x]) => [k, x.ref])) };
      const open = web(e.url);
      if (props.href && open && address && open.url !== address.url) block.href = open.url;
      const { type, ...rest } = block, parsed = m.i.config.safeParse(filled(rest));
      if (!parsed.success) { if (!extra && !wants.length && slot) continue; return refuse(`Valet's ${m.i.name} wants more than ${source} says (${parsed.error.issues[0].message})`); }
      let widgets: string[];
      try { widgets = worth(Object.keys(m.i.create(parsed.data, makeContext(id)).widgets)); } catch (err) { return refuse((err as Error).message.slice(0, 120)); }
      integrations[id] = block; same.set(`${type} ${address?.url}`, id);
      for (const [, x] of kept) for (const a of x.adds) env.set(a.name, a);
      place(group, widgets.map(w => `${id}.${w}`));
      made.integrations.push(`${e.name} (${id}: ${m.i.type})${widgets.length ? '' : ', with no card placed: its cards are yours to choose'}`);
      return undefined;
    }
    return refuse('it needs more than the source says');
  };

  if (read.entries.length > MAX_ENTRIES) made.skipped.push({ what: `${read.entries.length - MAX_ENTRIES} entries past the first ${MAX_ENTRIES}`, why: 'more than a page can hold' });
  for (const raw of read.entries.slice(0, MAX_ENTRIES)) {
    const e = { ...raw, name: raw.name.trim().slice(0, 120) || 'Unnamed' }, group = groupOf(e.group), why = integrate(e, group);
    if (why === undefined) continue;
    const address = web(e.url ?? (e.widget ? undefined : e.api));
    if (!address) { made.skipped.push({ what: e.name, why: e.widget ? (why || `Valet has no card for ${source}'s ${e.kind} widget`) : e.url ? 'its address isn\'t an http(s) one' : 'it has no address' }); continue; }
    if (address.lost) made.notes.push(`${e.name}: a password or key was in its address and was taken out`);
    const icon = iconOf(e.icon), ping = web(e.ping);
    links.set(group, [...(links.get(group) ?? []), { name: e.name, url: address.url, ...(icon ? { icon } : {}), ...(e.note ? { note: e.note } : {}) }]);
    targets.push({ name: e.name, url: ping?.url ?? address.url, ...(ping && ping.url !== address.url ? { href: address.url } : {}), group });
    place(group, [`links.${slug(group)}`]);
    made.links.push(`${e.name}${why ? ` (${why})` : ''}`);
    // a link's address may itself be a ${NAME} the source kept in its environment
    for (const m of `${address.url} ${ping?.url ?? ''}`.matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!env.has(m[1])) env.set(m[1], { name: m[1], value: '', of: e.name, note: `already in ${source}'s environment under this name` });
  }
  for (const b of Object.values(integrations)) for (const m of JSON.stringify(b).matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!env.has(m[1])) env.set(m[1], { name: m[1], value: '', of: 'an address', note: `already in ${source}'s environment under this name` });
  if (targets.length) integrations.status = { type: 'http', targets };
  if (read.weather) integrations.weather = { type: 'weather', ...read.weather };
  const SEARCH = ['duckduckgo', 'google', 'kagi', 'brave', 'startpage', 'searxng'];
  const layout = [...(targets.length ? [{ title: 'Status', widgets: ['status.status'] }] : []), ...[...sections].map(([title, widgets]) => ({ title, widgets }))];
  const config = {
    ...(read.title ? { title: read.title } : {}),
    ...(read.search && SEARCH.includes(read.search.toLowerCase()) ? { search: read.search.toLowerCase() } : {}),
    ...(read.weather ? { weather: 'weather.now' } : {}),
    integrations, ...(links.size ? { links: Object.fromEntries(links) } : {}), layout,
  };
  const yaml = `# Valet. Converted from ${source} by \`import\`: read it over, then save it as config.yaml.\n# Each \${NAME} stands for a secret: its value goes in .env, never in this file. Every option: docs/configuration.md.\n# To check this file and every service in it: node dist/server.js doctor\n\n${stringify(config, { lineWidth: 0 })}`;
  return { config, yaml, env: [...env.values()], made };
}

/** .env lines: a value as it is where that's safe, quoted where a space, a # or a quote would cut it short */
export function envFile(env: Env[], source: string) {
  const quote = (v: string) => /^[\w\-.:/@+=,]*$/.test(v) ? v : v.includes('\'') ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `'${v}'`;
  return `# Secrets ${source}'s config held, taken out by \`import\`. Move these lines into Valet's .env, then delete this file.\n${env.map(e => `${e.note ? `# ${e.note}\n` : ''}${e.name}=${quote(e.value)}`).join('\n')}\n`;
}

export function summary(made: ReturnType<typeof convert>['made'], env: Env[]) {
  const lines: string[] = [];
  const part = (n: number, word: string, items: string[]) => { if (n) lines.push(`${plural(n, word)}: ${items.slice(0, 40).join(', ')}${items.length > 40 ? '…' : ''}`); };
  part(made.integrations.length, 'integration', made.integrations);
  part(made.links.length, 'link', made.links);
  if (made.links.length) lines[lines.length - 1] += '. Each has an up/down check on the Status card';
  if (made.skipped.length) lines.push(`${made.skipped.length} skipped:`, ...made.skipped.slice(0, 40).map(s => `  ${s.what}: ${s.why}`), ...(made.skipped.length > 40 ? ['  …'] : []));
  lines.push(...made.notes);
  const moved = env.filter(e => e.value).length, empty = env.filter(e => !e.value && !e.note?.startsWith('already')).length;
  if (env.length) lines.push(`${plural(moved, 'secret')} taken out of the config${empty ? `, and ${empty} more for you to fill in` : ''}. None is in the Valet config: it has \${NAME} in their place.`);
  return lines;
}

export async function importCommand(args: string[], registry: Record<string, Integration>) {
  const f = flags(args, ['force'], ['out', 'env']), [from, path] = f.rest, source = SOURCES[from as Source];
  if (f.bad || !source || !path || f.rest.length > 2) { console.error(`${f.bad ?? (from && !source ? `import doesn't know "${from}"` : 'usage')}: import <${Object.keys(SOURCES).join('|')}> <path> [--out <config.yaml>] [--env <.env.import>] [--force]`); return 1; }
  const { out, env: envPath } = f.given;
  for (const file of [out, envPath]) if (file && existsSync(file) && !f.on.has('force')) { console.error(`${file} is already there, and import won't write over it. --force replaces it.`); return 1; }
  let made: ReturnType<typeof convert>;
  try { made = convert(source.read(path), registry, source.name); }
  catch (e) { console.error(`import: ${(e as Error).message}`); return 1; }
  if (!made.made.integrations.length && !made.made.links.length) { console.error([`import: nothing in ${path} could be brought across.`, ...made.made.skipped.slice(0, 20).map(s => `  ${s.what}: ${s.why}`)].join('\n')); return 1; }
  const say = out ? console.log : console.error;   // without --out, stdout is the config and nothing else
  try {
    if (out) writeFileSync(out, made.yaml, { mode: 0o600 }); else console.log(made.yaml);
    // a file that was there keeps its old mode unless it's set again
    if (envPath && made.env.length) { writeFileSync(envPath, envFile(made.env, source.name), { mode: 0o600 }); chmodSync(envPath, 0o600); }
  } catch (e) { console.error(`import: ${(e as NodeJS.ErrnoException).path ?? 'the file'} can't be written (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`); return 1; }
  say(`From ${source.name}${out ? `, written to ${out}` : ''}:`);
  for (const line of summary(made.made, made.env)) say(line);
  if (made.env.length && envPath) say(`Their names and values are in ${envPath} (only you can read it). Move them into .env, then delete it.`);
  else if (made.env.length) say(`\nFor .env (--env <file> writes these to a file instead of the screen):\n${envFile(made.env, source.name).split('\n').slice(1).join('\n')}`);
  say('To check the result and every service in it: node dist/server.js doctor');
  return 0;
}
