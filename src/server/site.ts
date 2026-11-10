// Everything built from a config: the integration instances, which widgets are placed, the hub that polls them, and
// the notices they raise. Built once at startup and again on every config reload (main.ts swaps the site in place).
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { usedSecrets, type Config } from './config.ts';
import { setFrames } from './security.ts';
import { makeContext, setHouse, type Instance, type Integration } from './core.ts';
import { History } from './history.ts';
import { fits, viewsFor } from '../shared/views.ts';
import { Hub } from './hub.ts';
import { noticesFor, type Notice } from './notices.ts';
import { guardCards } from './plugins.ts';
import { allowFonts, canAct, fontOrigins, redactor } from './security.ts';
import { inUnits } from './units.ts';
import { isBoth, isPaint, listOf, tabHash, wallsIn } from '../shared/look.ts';
import { links } from '../integrations/links.ts';
import { makeAsk, type Ask } from './brain.ts';
import { Activity } from './activity.ts';
import { buildRecap, recapYear } from './recap.ts';
import { troubles, Watcher } from './insight.ts';
import { push, type Message } from './notify.ts';
import { pushAll } from './webpush.ts';
import { OWN_TOOLS, ownInstance } from './own.ts';
import { Backups, news } from './backups.ts';
import { Reminders } from './reminders.ts';
import { Timeline } from './timeline.ts';
import { loadWatches, Watches } from './watches.ts';
import { loadRules, Rules } from './rules.ts';
import { Buckets, words, type Hook } from './hooks.ts';
import { Publisher } from './events.ts';
import { accessOf as granted, rank, runTool, toolAccess } from './run.ts';
import { customs } from '../shared/slash.ts';
import { CORE } from './lazy.ts';
import { loadPins, pinsInstance, savePins, type Pin } from './pins.ts';
import { setupTools } from './setup.ts';
import { sandbox } from './sandbox.ts';
import { wallPages, wallProblems, wallWidgets } from './wall.ts';
import { voiceProblems } from './voice.ts';
import { choices, servers } from './model.ts';

export interface Site {
  config: Config;
  instances: Map<string, Instance>;
  meta: Map<string, { type: string; name: string; integration: Integration }>;
  placed: Set<string>;
  hub: Hub;
  history?: History;
  acting: boolean;
  redact: (s: string) => string;
  walls: { path: string; file: string; version: string }[];   // wallpapers on this disk, served by number
  cssVersion?: string;
  recent: Notice[];
  noticeListeners: Set<(n: Notice) => void>;
  problems: string[];
  pins: Pin[];
  ask?: Ask;
  watcher?: Watcher;
  timeline: Timeline;
  activity: Activity;
  watches: Watches;
  rules: Rules;
  push: (m: Message) => void;
  backups: Backups;
  stopBackups: () => void;
  reminders: Reminders;
  stopReminders: () => void;
  /** An incoming hook fired (hooks.ts): a notice, the timeline, a push if it asks, the rules waiting on it, an event. */
  hook: (name: string, hook: Hook, payload: unknown) => void;
  hookLimit: Buckets;
  events: Publisher;
  stopEvents: () => void;
}

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
    if (['valet', 'pins', 'config'].includes(id)) { problems.push(`integrations.${id}: that name is taken by Valet itself`); continue; }
    const integration = block.type === 'links' ? links : registry[block.type];
    if (!integration) { problems.push(`integrations.${id}: unknown type "${block.type}"`); continue; }
    const { type, ...rest } = block;
    // zod drops keys it doesn't know; a misspelt option should say so rather than silently do nothing
    const known = (integration.config as { shape?: object }).shape;
    for (const k of known ? Object.keys(rest).filter(k => !(k in known)) : []) problems.push(`integrations.${id}: unknown option "${k}" (ignored)`);
    const parsed = integration.config.safeParse(rest);
    if (!parsed.success) { problems.push(...parsed.error.issues.map(i => `integrations.${id}.${i.path.join('.')}: ${i.message}`)); continue; }
    try {
      const inst = inUnits(integration.create(parsed.data, makeContext(id, config.format)), config.format);
      if (fromPlugins.has(block.type)) guardCards(inst);   // a plugin's cards are checked against the catalog
      instances.set(id, inst);
      meta.set(id, { type, name: integration.name, integration });
    } catch (e) { problems.push(`integrations.${id}: ${(e as Error).message}`); }
  }
  // only widgets placed somewhere are polled; a key that points nowhere is a typo
  const placed = new Set([...config.layout.flatMap(s => s.widgets.map(w => w.widget)), ...config.menubar.widgets, ...(config.weather ? [config.weather] : []), ...(config.live?.activities ?? [])]);
  for (const key of placed) {
    const [inst, w] = key.split('.');
    if (inst === 'valet') continue;      // Valet's own widgets exist once the site is built
    if (!instances.get(inst)?.widgets[w]) problems.push(`layout: no widget "${key}"${instances.has(inst) ? ` (${inst} has: ${Object.keys(instances.get(inst)!.widgets).join(', ')})` : ''}`);
  }
  // a choice on Anthropic with no key of its own (the main server's isn't passed to another provider) can't answer
  if (config.assistant) for (const c of choices(config.assistant).slice(1)) if (c.settings.provider === 'anthropic' && !c.settings.apiKey && !process.env.ANTHROPIC_API_KEY) problems.push(`assistant.models: "${c.id}" needs an apiKey, e.g. apiKey: \${ANTHROPIC_API_KEY} with the key in .env`);
  // the same for a server `auto` lists: Anthropic's list needs a key too
  if (config.assistant) for (const s of servers(config.assistant)) if (s.settings.provider === 'anthropic' && !s.settings.apiKey && !process.env.ANTHROPIC_API_KEY) problems.push(`assistant.models: auto on ${s.title} needs an apiKey, e.g. apiKey: \${ANTHROPIC_API_KEY} with the key in .env`);
  for (const [id] of Object.entries(config.assistant?.access ?? {})) if (!id.includes('.') && !['default', 'config', 'valet'].includes(id) && !instances.has(id)) problems.push(`assistant.access.${id}: no such integration`);
  // the wall's own cards are polled too, while a wall is open; its typos name the wall
  const has = (key: string) => { const [inst, w] = key.split('.'); return inst === 'valet' || !!instances.get(inst)?.widgets[w]; };
  problems.push(...wallProblems(config, has));
  problems.push(...voiceProblems(config));
  // a view the widget's card can't take is ignored on the page; say so here, with the ones it can
  const drawn = [...config.layout.flatMap(s => s.widgets.map(w => ({ ...w, where: 'layout' }))), ...wallPages(config).flatMap(p => p.layout.flatMap(s => s.widgets.map(w => ({ ...w, where: 'wall' }))))];
  for (const { widget, view, where } of drawn) {
    const [inst, w] = widget.split('.'), card = view && instances.get(inst)?.widgets[w]?.card;
    if (card && !fits(view, card)) problems.push(`${where}: ${widget} can't be drawn as "${view}" (it's a ${card} card${viewsFor(card).length ? `; it can be ${viewsFor(card).join(', ')}` : ''})`);
  }
  for (const key of wallWidgets(config)) placed.add(key);
  for (const n of config.live?.notify ?? []) if (!placed.has(n.widget)) problems.push(`live.notify: "${n.widget}" isn't placed on the page`);
  const tabs = new Set(config.layout.flatMap(s => s.tab ?? s.title ?? []));
  for (const t of Object.keys(config.appearance.wallpapers)) if (!tabs.has(t)) problems.push(`appearance.wallpapers: no tab "${t}" (the tabs are: ${[...tabs].join(', ')})`);
  const lists = [config.appearance.wallpaper].flatMap(w => isBoth(w) ? [w.light, w.dark] : [w]);
  if (lists.some(w => Array.isArray(w) && w.length > 1) && !config.appearance.rotate) problems.push('appearance.rotate: a list of wallpapers needs a time to take turns, like 10m (only the first shows)');
  // a dotted key in assistant.access names one tool: <instance>.<tool>
  for (const key of Object.keys(config.assistant?.access ?? {}).filter(k => k.includes('.'))) {
    const [id, name] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
    const names = id === 'valet' ? OWN_TOOLS : id === 'config' ? Object.keys(setupTools('', registry)) : Object.keys(instances.get(id)?.tools ?? {});
    if (id !== 'valet' && id !== 'config' && !instances.has(id)) problems.push(`assistant.access: "${key}" names no integration ${id}`);
    else if (!names.includes(name)) problems.push(`assistant.access: ${id} has no tool "${name}" (it has: ${names.join(', ') || 'none'})`);
  }
  problems.push(...commandProblems(config, instances));
  // a token opens one door: two hooks sharing one, or a hook sharing the MCP server's or the wall's, would open each other's
  const tokens = new Map<string, string>([...(config.mcpServer ? [[config.mcpServer.token, 'mcpServer.token']] : []), ...(config.wall.token ? [[config.wall.token, 'wall.token']] : [])] as [string, string][]);
  for (const [name, h] of Object.entries(config.hooks)) {
    if (tokens.has(h.token)) problems.push(`hooks.${name}.token: the same token as ${tokens.get(h.token)}; give each its own`);
    else tokens.set(h.token, `hooks.${name}.token`);
  }
  if (config.sandbox && (Object.keys(config.hooks).length || config.events?.targets.length)) problems.push('hooks and events are off in a sandbox');
  return { problems, instances, meta, placed };
}

/** chat.commands that couldn't do what they say: no assistant, a model that isn't a choice, an integration that isn't there
 *  or that the assistant may not use (a command never grants more than assistant.access). */
function commandProblems(config: Config, instances: Map<string, Instance>) {
  const list = customs(config.chat.commands), a = config.assistant, out: string[] = [];
  if (!list.length) return out;
  if (!a) return [`chat.commands: they need an assistant: block to answer them`];
  const ids = choices(a).map(c => c.id), listed = servers(a).length > 0;
  for (const c of list) {
    const at = `chat.commands.${c.name}`;
    if (c.model && !ids.includes(c.model) && !listed) out.push(`${at}.model: "${c.model}" isn't a model choice (they are: ${ids.join(', ')})`);
    for (const id of c.tools ?? []) {
      if (CORE.has(id)) out.push(`${at}.tools: ${id} is Valet's own and always there; list integrations`);
      else if (!instances.has(id)) out.push(`${at}.tools: no integration "${id}"${instances.size ? ` (there are: ${[...instances.keys()].join(', ')})` : ''}`);
      else if (granted(a, id) < rank.read || !Object.keys(instances.get(id)!.tools ?? {}).some(n => toolAccess(a, id, n) > rank.none)) out.push(`${at}.tools: the assistant may not use ${id} (assistant.access), and a command can't change that`);
    }
  }
  return out;
}

export async function buildSite(config: Config, registry: Record<string, Integration>, fromPlugins: Set<string>, opts: { path: string; rebuild: () => Promise<void> }, previous?: Site): Promise<Site> {
  setHouse(config.format);
  const { problems, instances, meta, placed } = check(config, registry, fromPlugins);
  for (const p of problems) console.error(`config: ${p}`);

  // pinned answers are an integration of their own; setup tools one too, only if the config grants them
  const pins = await loadPins();
  instances.set('pins', pinsInstance(pins, instances, async id => { await savePins((await loadPins()).filter(p => p.id !== id)); await opts.rebuild(); }));
  for (const p of pins) placed.add(`pins.${p.id}`);
  if (!sandbox.on && config.assistant?.access.config && config.assistant.access.config !== 'none') {
    instances.set('config', { widgets: {}, tools: setupTools(opts.path, registry) });
    meta.set('config', { type: 'config', name: 'Setup', integration: { type: 'config', name: 'Setup' } as Integration });
  }

  setFrames([...instances.values()].flatMap(i => i.frame ? [i.frame] : []));

  // history survives a reload unless its settings changed
  const sameHistory = previous && JSON.stringify(previous.config.history) === JSON.stringify(config.history);
  const history = sameHistory ? previous.history : config.history ? new History(config.history.hours, config.history.every * 60_000) : undefined;
  if (history && !sameHistory) await history.load();

  // refresh cadence: the widget's own, unless the layout says `every`
  const every = new Map<string, number>();
  for (const s of [...config.layout, ...wallPages(config).flatMap(p => p.layout)]) for (const w of s.widgets) if (w.every) every.set(w.widget, Math.min(w.every, every.get(w.widget) ?? Infinity));

  const recent: Notice[] = previous?.recent ?? [], noticeListeners = previous?.noticeListeners ?? new Set<(n: Notice) => void>();
  // events out: the same publisher across a reload unless its settings changed, so a broker keeps one connection.
  // Nothing connects here; it starts at the end, once the old site's (if its settings differ) has said goodbye
  const sameEvents = !!previous && JSON.stringify(previous.config.events) === JSON.stringify(config.events);
  const events = sameEvents ? previous!.events : new Publisher(sandbox.on ? undefined : config.events, { redact: s => redactNow(s), log: line => console.error(redactNow(line)) });
  // a toast on every open page, and the last few for a page that opens just after
  const raise = (n: Notice) => {
    recent.push(n); if (recent.length > 5) recent.shift();
    for (const l of noticeListeners) l(n);
    events.emit({ type: 'notice', text: n.text, detail: n.sub, tone: n.tone, source: n.key }, n.at);
  };
  const timeline = previous?.timeline ?? await new Timeline().load();
  const activity = previous?.activity ?? await new Activity(s => redactor(usedSecrets)(s)).load();
  // reminders, and Valet's own tools
  const watches = new Watches(await loadWatches(), w => {
    raise({ key: w.widget, text: w.say, icon: 'pulse', tone: 'accent', at: Date.now() });
    timeline.add('reminder', w.say, w.widget);
    sendPush({ title: w.say, where: w.widget });
  });
  // standing instructions: each run re-checked against the config as it is now, then through the chat's own door
  const rules = new Rules(await loadRules(), {
    instances: () => instances,
    access: (id, tool) => toolAccess(config.assistant, id, tool),
    acting: () => canAct(config),
    title: key => hub.widget(key)?.title,
    hooks: () => sandbox.on ? [] : Object.keys(config.hooks),
    act: async (r, s) => {
      const out = await runTool({ ...s, via: 'rule', who: r.by, rule: r.id, activity, redact: redactNow });
      setTimeout(() => hub.refreshInstance(s.id), 300);
      return { ok: !out?.data?.error, error: out?.data?.error ? String(out.data.error) : undefined };
    },
    tell: ({ text: said, sub: why, tone, rule }) => {
      // a card's words can carry anything a service sent back, and these go to the phone too
      const text = redactNow(said), sub = why && redactNow(why);
      raise({ key: rule.when?.widget ?? 'valet.rules', text, sub, icon: 'pulse', tone, at: Date.now() });
      events.emit({ type: 'rule', id: rule.id, ok: tone !== 'bad', text, detail: sub });
      timeline.add('rule', sub ? `${text} (${sub})` : text, rule.when?.widget);
      sendPush({ title: text, text: sub, urgent: tone === 'bad', where: rule.when?.widget });
    },
  });
  const undo = async (id: number) => {
    const e = activity.entries.find(x => x.id === id);
    if (!e?.undo || e.undone) throw new Error('nothing to undo there');
    const [inst, name] = e.undo.tool.split('__'), t = instances.get(inst)?.tools?.[name];
    if (!t) throw new Error('that tool is gone');
    await t.run(t.input.parse(e.undo.input));
    e.undone = true;
    activity.add({ who: e.who, via: 'page', what: `Undid: ${e.what}`, ok: true });
    return 'done';
  };
  // backup health: every integration that reports backups, gathered on Valet's own card, which is always watched when
  // there's something to watch so its trouble reaches the summary and the insight like any other
  const backups = previous?.backups ?? await new Backups().load(), bk = config.backups;
  const sources = bk ? [...instances].filter(([id, i]) => typeof i.backups === 'function' && !['valet', 'pins', 'config'].includes(id)).map(([id, i]) => ({ id, name: meta.get(id)?.name ?? id, instance: i })) : [];
  backups.sources = () => sources;
  if (bk) backups.options = { overdue: bk.overdue, expect: bk.expect };
  backups.tell = t => {
    const m = news(t), text = redactNow(m.title), sub = m.text && redactNow(m.text);
    raise({ key: 'valet.backups', text, sub, icon: 'shield', tone: m.tone, at: Date.now() });
    events.emit({ type: 'backup', state: m.tone === 'bad' ? 'problem' : 'recovered', name: t.job.name, source: t.job.source, health: t.now, text, detail: sub });
    timeline.add('backup', sub ? `${text} (${sub})` : text, 'valet.backups');
    if (bk && bk.notify) sendPush({ title: text, text: sub, urgent: m.tone === 'bad' });
  };
  if (sources.length) placed.add('valet.backups');

  // reminders at a set time (a meeting about to start): said once, as a notice, to the channels and, if asked, to devices
  const reminders = previous?.reminders ?? await new Reminders().load();
  const reminding = [...instances].filter(([id, i]) => typeof i.reminders === 'function' && !['valet', 'pins', 'config'].includes(id)).map(([id, instance]) => ({ id, instance }));
  reminders.sources = () => reminding;
  reminders.tell = r => {
    const text = redactNow(r.title), sub = r.text && redactNow(r.text), link = r.link && redactNow(r.link) === r.link ? r.link : undefined;
    raise({ key: r.source, text, sub, icon: 'calendar', tone: 'accent', at: Date.now() });
    sendPush({ title: text, text: sub, link, device: r.device !== false, where: [...placed].find(k => k.startsWith(`${r.source}.`)) });
  };

  instances.set('valet', ownInstance({ timeline, activity, watches, rules, hub: () => hub, widgets: [...placed], history, backups: bk ? backups : undefined, recap: year => buildRecap(instances, recapYear(year == null ? undefined : String(year))), undo }));
  meta.set('valet', { type: 'valet', name: 'Valet', integration: { type: 'valet', name: 'Valet' } as Integration });

  const hub = new Hub(new Map([...instances].map(([id, i]) => [id, {
    ...i, widgets: Object.fromEntries(Object.entries(i.widgets).filter(([w]) => placed.has(`${id}.${w}`))
      .map(([w, def]) => [w, every.has(`${id}.${w}`) ? { ...def, interval: every.get(`${id}.${w}`) } : def])),
  }])), (key, prev, next) => {
    for (const n of noticesFor(key, prev?.card, next.card, config.live?.notify ?? [])) raise(n);
    // everything that came or went goes on the timeline, announced or not
    // (not the AI's own comings and goings: they'd drown out everything else, and every summary would cause more)
    if (meta.get(key.split('.')[0])?.type !== 'aimonitor') for (const on of EVERYTHING) for (const n of noticesFor(key, prev?.card, next.card, [{ widget: key, on }])) timeline.add(on, `${n.text}${n.sub ? ` (${n.sub})` : ''}`, key);
    // and out as events, by the same detection, with the name by itself rather than in a sentence
    if (meta.get(key.split('.')[0])?.type !== 'aimonitor') for (const on of EVERYTHING) for (const n of noticesFor(key, prev?.card, next.card, [{ widget: key, on, text: on === 'down' || on === 'up' ? '{name}' : '{title}' }]))
      events.emit(on === 'down' || on === 'up' ? { type: 'service', state: on, name: n.text, widget: key, detail: n.sub } : { type: 'activity', state: on, widget: key, title: n.text, detail: n.sub }, n.at);
    // and rules that asked for it reach your phone
    for (const r of config.live?.notify ?? []) if (r.push && r.widget === key) for (const n of noticesFor(key, prev?.card, next.card, [r])) sendPush({ title: n.text, text: n.sub, urgent: n.tone === 'bad', where: key });
  }, history);

  // to the channels, and to every browser that turned notifications on (not from a demo: there's nobody's phone to reach)
  const web = config.notify.webPush;
  const sendPush = (m: Message) => {
    void push(config.notify.channels, m, fetch, redactNow);
    if (web.enabled && !sandbox.on && m.device !== false) void pushAll({ title: redactNow(m.title), body: m.text && redactNow(m.text), urgent: m.urgent, url: placeOf(config, m.where), open: m.link }, web);
  };
  const redactNow = redactor(usedSecrets);

  // An incoming hook (hooks.ts). Its words are another program's: they go to the page, the phone and the event, never
  // into a prompt, so the timeline line a model can read says only that the hook fired, and a rule hears only its name.
  const hook = (name: string, h: Hook, payload: unknown) => {
    const said = words(h, name, payload), text = redactNow(said.text), sub = said.sub && redactNow(said.sub);
    raise({ key: `hooks.${name}`, text, sub, icon: 'pulse', tone: h.tone, at: Date.now() });
    timeline.add('hook', `The ${name} hook fired`, undefined, Date.now(), sub ? `${text} (${sub})` : text);
    if (h.push) sendPush({ title: text, text: sub, urgent: h.tone === 'bad' });
    events.emit({ type: 'hook', name, text, detail: sub, tone: h.tone });
    rules.hooked(name);
  };

  // the assistant's own background work, if there's an assistant
  const ask = config.assistant ? makeAsk(config.assistant) : undefined;
  const watcher = ask && config.assistant!.background.watch ? new Watcher(ask, i => {
    const n: Notice = { key: 'insight', text: i?.text ?? '', icon: 'pulse', tone: 'warn', at: Date.now() };
    for (const l of noticeListeners) l(n);
    if (i) { timeline.add('insight', i.text); if (config.notify.insights) sendPush({ title: 'Your homelab', text: i.text, urgent: true }); }
  }) : undefined;
  // problems appearing and clearing go on the timeline, whether or not the model has anything to add
  // A widget's first report isn't news: a service found down at startup went down at some earlier time, and the timeline
  // only records what it actually saw change.
  let open = new Map<string, string>(), known = new Set<string>();
  // what the last run left open gets settled once every widget has had time to report
  let leftOpen = timeline.unresolved();
  const settleAt = Date.now() + 120_000;
  hub.watch = () => {
    const states = hub.snapshot(), now = new Map(troubles(states).map(t => [t.id, t.text] as const));
    if (leftOpen.length && Date.now() > settleAt) {
      const still = new Set(now.values());
      for (const text of leftOpen) if (!still.has(text)) timeline.add('cleared', text);
      leftOpen = [];
    }
    // a backup's going wrong and coming right are logged by the backups themselves, with or without the card
    const logged = (id: string) => !id.startsWith('valet.backups:');
    for (const [id, text] of now) if (!open.has(id) && logged(id) && [...known].some(k => id.startsWith(`${k}:`))) timeline.add('problem', text);
    for (const [id, text] of open) if (!now.has(id) && logged(id)) timeline.add('cleared', text);
    open = now; known = new Set(states.map(s => s.key));
    watcher?.see(states);
    rules.changed();
  };

  if (history && config.history && config.history.background) hub.sampleInBackground(config.history.every * 60_000);
  watches.start(() => hub.snapshot(), key => void hub.refresh(key));
  rules.start(() => hub.snapshot(), key => void hub.refresh(key));
  const stopBackups = bk ? backups.start(bk.every) : () => {};
  const stopReminders = sandbox.on ? () => {} : reminders.start();
  // the publisher goes with the site that has it now; one whose settings changed says goodbye before the new one connects
  if (previous) { if (!sameEvents) previous.stopEvents(); previous.stopEvents = () => {}; }
  events.start();

  // a local wallpaper is served by Valet; a URL is handed to the browser as is, and paint is CSS
  const { appearance: a } = config;
  const local = [...new Set([a.wallpaper, ...Object.values(a.wallpapers)].flatMap(w => wallsIn(w)).filter(w => !isPaint(w) && !/^https?:\/\//.test(w)))];
  // the version is in the picture's address, so a different file (or the same one changed) is never the cached one
  const walls = await Promise.all(local.map(async path => {
    const at = await stat(resolve(path)).catch(() => ({ mtimeMs: 0, size: 0 }));
    return { path, file: resolve(path), version: createHash('sha1').update(`${resolve(path)}:${at.mtimeMs}:${at.size}`).digest('base64url').slice(0, 10) };
  }));
  // ?v= changes with the CSS, so an open page swaps its stylesheet the moment you save
  const cssStamp = a.cssFile && await stat(resolve(a.cssFile)).then(s => s.mtimeMs, () => 0);
  const cssVersion = a.css || a.cssFile ? createHash('sha256').update(`${a.css}|${cssStamp}`).digest('hex').slice(0, 10) : undefined;
  allowFonts(fontOrigins(a.font?.url));

  // the redactor knows every secret any config used, so a value from before a reload stays covered
  return { config, instances, meta, placed, hub, history, acting: canAct(config), redact: redactor(usedSecrets), walls, cssVersion, recent, noticeListeners, problems, pins, ask, watcher, timeline, activity, watches, rules, push: sendPush, backups, stopBackups, reminders, stopReminders, hook, hookLimit: previous?.hookLimit ?? new Buckets(), events, stopEvents: () => events.stop() };
}


/** Where a widget lives on the page: its tab's address, or the overview. A notification opens there. */
export function placeOf(config: Config, widget?: string) {
  const i = widget ? config.layout.findIndex(s => s.widgets.some(w => w.widget === widget)) : -1, s = config.layout[i];
  const tab = s?.tab ?? s?.title;
  return tab ? `/#${tabHash(tab)}` : '/';
}
