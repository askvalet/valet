// Everything built from a config: the integration instances, which widgets are placed, the hub that polls them, and
// the notices they raise. Built once at startup and again on every config reload (main.ts swaps the site in place).
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { usedSecrets, type Config } from './config.ts';
import { makeContext, type Instance, type Integration } from './core.ts';
import { History } from './history.ts';
import { Hub } from './hub.ts';
import { noticesFor, type Notice } from './notices.ts';
import { guardCards } from './plugins.ts';
import { canAct, redactor } from './security.ts';
import { links } from '../integrations/links.ts';
import { makeAsk, type Ask } from './brain.ts';
import { Watcher } from './insight.ts';
import { loadPins, pinsInstance, savePins, type Pin } from './pins.ts';
import { setupTools } from './setup.ts';

export interface Site {
  config: Config;
  instances: Map<string, Instance>;
  meta: Map<string, { type: string; name: string; integration: Integration }>;
  placed: Set<string>;
  hub: Hub;
  history?: History;
  acting: boolean;
  redact: (s: string) => string;
  wallpaperFile: string | null;
  wallpaperVersion: number;
  recent: Notice[];
  noticeListeners: Set<(n: Notice) => void>;
  problems: string[];
  pins: Pin[];
  ask?: Ask;
  watcher?: Watcher;
  journal: string[];      // what's happened lately, in a line each, for the morning brief
}

const JOURNAL = () => resolve(process.env.ATRIUM_DATA ?? 'data', 'journal.json');
const EVERYTHING = ['start', 'end', 'down', 'up'] as const;

/** Check a config against the registry without starting anything: every problem, in order, with its path. */
export function check(config: Config, registry: Record<string, Integration>, fromPlugins = new Set<string>()) {
  const problems: string[] = [];
  const instances = new Map<string, Instance>();
  const meta = new Map<string, { type: string; name: string; integration: Integration }>();
  const blocks: Record<string, { type: string } & Record<string, unknown>> = { ...config.integrations };
  if (Object.keys(config.links).length) blocks.links = { type: 'links', groups: config.links };
  for (const [id, block] of Object.entries(blocks)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) { problems.push(`integrations.${id}: names are letters, numbers, - and _`); continue; }
    const integration = block.type === 'links' ? links : registry[block.type];
    if (!integration) { problems.push(`integrations.${id}: unknown type "${block.type}"`); continue; }
    const { type, ...rest } = block;
    // zod drops keys it doesn't know; a misspelt option should say so rather than silently do nothing
    const known = (integration.config as { shape?: object }).shape;
    for (const k of known ? Object.keys(rest).filter(k => !(k in known)) : []) problems.push(`integrations.${id}: unknown option "${k}" (ignored)`);
    const parsed = integration.config.safeParse(rest);
    if (!parsed.success) { problems.push(...parsed.error.issues.map(i => `integrations.${id}.${i.path.join('.')}: ${i.message}`)); continue; }
    try {
      const inst = integration.create(parsed.data, makeContext(id));
      if (fromPlugins.has(block.type)) guardCards(inst);   // a plugin's cards are checked against the catalog
      instances.set(id, inst);
      meta.set(id, { type, name: integration.name, integration });
    } catch (e) { problems.push(`integrations.${id}: ${(e as Error).message}`); }
  }
  // only widgets placed somewhere are polled; a key that points nowhere is a typo
  const placed = new Set([...config.layout.flatMap(s => s.widgets.map(w => w.widget)), ...config.menubar, ...(config.weather ? [config.weather] : []), ...(config.island?.activities ?? [])]);
  for (const key of placed) {
    const [inst, w] = key.split('.');
    if (!instances.get(inst)?.widgets[w]) problems.push(`layout: no widget "${key}"${instances.has(inst) ? ` (${inst} has: ${Object.keys(instances.get(inst)!.widgets).join(', ')})` : ''}`);
  }
  for (const [id] of Object.entries(config.assistant?.access ?? {})) if (id !== 'default' && id !== 'config' && !instances.has(id)) problems.push(`assistant.access.${id}: no such integration`);
  for (const n of config.island?.notify ?? []) if (!placed.has(n.widget)) problems.push(`island.notify: "${n.widget}" isn't placed on the page`);
  return { problems, instances, meta, placed };
}

export async function buildSite(config: Config, registry: Record<string, Integration>, fromPlugins: Set<string>, opts: { path: string; rebuild: () => Promise<void> }, previous?: Site): Promise<Site> {
  const { problems, instances, meta, placed } = check(config, registry, fromPlugins);
  for (const p of problems) console.error(`config: ${p}`);

  // pinned answers are an integration of their own; setup tools one too, only if the config grants them
  const pins = await loadPins();
  instances.set('pins', pinsInstance(pins, instances, async id => { await savePins((await loadPins()).filter(p => p.id !== id)); await opts.rebuild(); }));
  for (const p of pins) placed.add(`pins.${p.id}`);
  if (config.assistant?.access.config && config.assistant.access.config !== 'none') {
    instances.set('config', { widgets: {}, tools: setupTools(opts.path, registry) });
    meta.set('config', { type: 'config', name: 'Setup', integration: { type: 'config', name: 'Setup' } as Integration });
  }

  // history survives a reload unless its settings changed
  const sameHistory = previous && JSON.stringify(previous.config.history) === JSON.stringify(config.history);
  const history = sameHistory ? previous.history : config.history ? new History(config.history.hours, config.history.every * 60_000) : undefined;
  if (history && !sameHistory) await history.load();

  // refresh cadence: the widget's own, unless the layout says `every`
  const every = new Map<string, number>();
  for (const s of config.layout) for (const w of s.widgets) if (w.every) every.set(w.widget, Math.min(w.every, every.get(w.widget) ?? Infinity));

  const recent: Notice[] = previous?.recent ?? [], noticeListeners = previous?.noticeListeners ?? new Set<(n: Notice) => void>();
  const journal: string[] = previous?.journal ?? await readFile(JOURNAL(), 'utf8').then(JSON.parse).catch(() => []);
  const hub = new Hub(new Map([...instances].map(([id, i]) => [id, {
    ...i, widgets: Object.fromEntries(Object.entries(i.widgets).filter(([w]) => placed.has(`${id}.${w}`))
      .map(([w, def]) => [w, every.has(`${id}.${w}`) ? { ...def, interval: every.get(`${id}.${w}`) } : def])),
  }])), (key, prev, next) => {
    for (const n of noticesFor(key, prev?.card, next.card, config.island?.notify ?? [])) {
      recent.push(n); if (recent.length > 5) recent.shift();
      for (const l of noticeListeners) l(n);
    }
    // everything that came or went goes in the journal, announced or not
    for (const on of EVERYTHING) for (const n of noticesFor(key, prev?.card, next.card, [{ widget: key, on }])) journal.push(`${new Date(n.at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })} ${on}: ${n.text}${n.sub ? ` (${n.sub})` : ''}`);
    if (journal.length > 120) journal.splice(0, journal.length - 120);
    void mkdir(resolve(JOURNAL(), '..'), { recursive: true }).then(() => writeFile(JOURNAL(), JSON.stringify(journal))).catch(() => {});
  }, history);

  // the assistant's own background work, if there's an assistant
  const ask = config.assistant ? makeAsk(config.assistant) : undefined;
  const watcher = ask && config.assistant!.background.watch ? new Watcher(ask, i => {
    const n: Notice = { key: 'insight', text: i?.text ?? '', icon: 'pulse', tone: 'warn', at: Date.now() };
    for (const l of noticeListeners) l(n);
  }) : undefined;
  if (watcher) hub.watch = () => watcher.see(hub.snapshot());
  if (history && config.history && config.history.background) hub.sampleInBackground(config.history.every * 60_000);

  // a local wallpaper file is served by Atrium; a URL is handed to the browser as is
  const wallpaper = config.appearance.wallpaper;
  const wallpaperFile = wallpaper && !/^https?:\/\//.test(wallpaper) ? resolve(wallpaper) : null;
  const wallpaperVersion = wallpaperFile ? Math.round((await stat(wallpaperFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs) : 0;

  // the redactor knows every secret any config used, so a value from before a reload stays covered
  return { config, instances, meta, placed, hub, history, acting: canAct(config), redact: redactor(usedSecrets), wallpaperFile, wallpaperVersion, recent, noticeListeners, problems, pins, ask, watcher, journal };
}

