// Who is asking, and what they may see and do. `profiles` and `users` in the config give some accounts a narrower Valet
// (a child's, a guest's); an account `users` doesn't name is an owner, exactly as without them. One view is worked out
// per person and site, here, and every route reads it (main.ts): nothing is hidden by the page alone.
// A profile only narrows. What it doesn't name isn't there: a tab it leaves out, an action it doesn't list, an
// integration its assistant isn't given. Valet's own things (its log, rules, pins, setup, notifications, approvals asked
// of an owner) stay with owners whatever a profile says, and a name that maps to a profile that isn't there sees nothing.
import type { Activity } from './activity.ts';
import { type Asks, hashOf } from './asks.ts';
import type { Config } from './config.ts';
import type { Instance, Tool, Viewer } from './core.ts';
import { narrowMaps } from '../shared/map.ts';
import type { Message } from './notify.ts';
import { accessOf, rank, toolAccess } from './run.ts';
import type { Personal } from './personal.ts';

type Level = keyof typeof rank;
const LEVELS = ['none', 'read', 'write', 'control'] as const;
/** Valet's own parts: never a member's, on the page or in the chat. */
export const OWN = new Set(['valet', 'pins', 'config']);
/** The chat's built-ins a member keeps (each only looks, within what they may read), and Valet's docs. */
const KEPT = ['show', 'present', 'search_everything'], DOCS = ['docs_search', 'docs_read'];
/** how long a member's change stays on the line for an owner: as an MCP client's does */
export const HOLD = 45_000;

export interface View {
  owner: boolean;
  /** the account, and its profile when it has one */
  name?: string; profile?: string;
  /** a widget, by key */
  sees(key: string): boolean;
  /** an integration, by its key: one with a widget they see. A map of the homelab shows them only these (shared/map.ts) */
  knows(integration: string): boolean;
  /** a tab, by name as in layout */
  tab(name?: string): boolean;
  /** a page action */
  presses(inst: string, action: string): boolean;
  /** The config as this person's routes read it: the assistant is theirs (the owner's, narrowed) or absent. */
  config: Config;
  instances: Map<string, Instance>;
  /** who answers what their assistant asks first */
  approve: 'self' | 'owner';
  /** The integrations whose activity this person sees as their own (`people:`), each with the service's name for them, and
   *  `instances` holds those made for them. Empty for anyone not mapped, and for an owner who chose everyone's. */
  own: Map<string, string>;
  /** a widget whose card is this person's own: the shared card is never theirs to hear, and its notices aren't either */
  mine(key: string): boolean;
  /** an owner with their own somewhere: what they chose to see (⌘K, the `valet_everyone` cookie) */
  choice?: 'mine' | 'everyone';
  /** who this view is, as anything kept per person keys it (a chat, a live card): their profile and their own */
  key: string;
}
interface SiteLike { config: Config; instances: Map<string, Instance>; placed: Set<string>; personal?: Personal }

const names = new WeakMap<Config, Map<string, string>>();
const same = (n: string) => n.trim().toLowerCase();
/** The profile an account has, or nothing for an owner. Names compare without case, so `Sam` from a proxy is still sam:
 *  a spelling can't turn a member into an owner. */
export function profileOf(config: Config, name?: string) {
  if (!name) return undefined;
  let map = names.get(config);
  if (!map) names.set(config, map = new Map(Object.entries(config.users).map(([k, v]) => [same(k), v])));
  return map.get(same(name));
}

/** What a profile's assistant may use: for each integration and tool the lower of `assistant.access` and the profile's.
 *  The profile's `default` covers the integrations on their tabs; anything else has to be named. */
function narrowed(a: NonNullable<Config['assistant']>, mine: Record<string, Level>, instances: Map<string, Instance>, onTabs: (id: string) => boolean) {
  const out: Record<string, Level> = { default: 'none', valet: 'none', pins: 'none', config: 'none', 'valet.plan': 'none' };
  const theirs = (id: string, tool?: string) => rank[(tool ? mine[`${id}.${tool}`] : undefined) ?? mine[id] ?? (onTabs(id) ? mine.default ?? 'none' : 'none')];
  for (const [id, inst] of instances) {
    if (OWN.has(id)) continue;
    const level = Math.min(accessOf(a, id), theirs(id));
    out[id] = LEVELS[level];
    for (const tool of Object.keys(inst.tools ?? {})) { const l = Math.min(toolAccess(a, id, tool), theirs(id, tool)); if (l !== level) out[`${id}.${tool}`] = LEVELS[l]; }
  }
  // a card made from another (`from`) is read no more than its source: theirs is the lower of the two
  for (const [id, inst] of instances) for (const w of Object.values(inst.widgets)) {
    const src = w.from?.slice(0, w.from.indexOf('.'));
    if (!src || !out[id]) continue;
    const cap = rank[(out[src] ?? 'none') as Level];
    if (rank[out[id] as Level] > cap) out[id] = LEVELS[cap];
    for (const tool of Object.keys(inst.tools ?? {})) if (out[`${id}.${tool}`] && rank[out[`${id}.${tool}`] as Level] > cap) out[`${id}.${tool}`] = LEVELS[cap];
  }
  for (const b of KEPT) if (a.access[`valet.${b}`] === 'none' || mine[`valet.${b}`] === 'none') out[`valet.${b}`] = 'none';
  for (const d of DOCS) if (toolAccess(a, 'valet', d) >= rank.read && mine[`valet.${d}`] !== 'none') out[`valet.${d}`] = 'read';
  return out;
}

/** An integration that draws the homelab itself (a widget that's a map), as someone with a profile gets it: its maps
 *  narrowed to the integrations on their tabs, and its tools told who's asking so their words are narrowed too. Anything
 *  else is handed over as it is. The hub's card stays one, shared; main.ts narrows it on the way to each page. */
function scoped(inst: Instance, who: Viewer): Instance {
  if (!Object.values(inst.widgets).some(w => w.card === 'map')) return inst;
  const may = (id: string) => who.sees(id);
  return {
    ...inst,
    widgets: Object.fromEntries(Object.entries(inst.widgets).map(([k, w]) => [k, { ...w, fetch: async () => narrowMaps(await w.fetch(), may)! }])),
    tools: inst.tools && Object.fromEntries(Object.entries(inst.tools).map(([k, t]) => [k, { ...t, run: async (args: unknown) => { const out = await t.run(args, who); return { ...out, card: narrowMaps(out.card, may) }; } } as Tool])),
  };
}

const built = new WeakMap<Map<string, Instance>, Map<string, Base>>();

/** The view for one account on one site. Asked on every request; a profile's is built once per site. `everyone`: an owner
 *  with their own on some service asked to see everyone's there instead. A member can't: theirs is all they get. */
export function viewOf(site: SiteLike, name?: string, o: { everyone?: boolean } = {}): View {
  const id = profileOf(site.config, name);
  const base: Base = id === undefined ? { owner: true, sees: () => true, knows: () => true, tab: () => true, presses: () => true, config: site.config, instances: site.instances, approve: 'self' } : (() => {
    let views = built.get(site.instances);
    if (!views) built.set(site.instances, views = new Map());
    let view = views.get(id);
    if (!view) views.set(id, view = member(site, id));
    return view;
  })();
  const theirs = site.personal?.of(name) ?? new Map<string, string>(), everyone = base.owner && !!o.everyone;
  const own = everyone ? new Map<string, string>() : new Map([...theirs].filter(([i]) => base.instances.has(i)));
  const key = `${base.owner ? '' : `profile ${base.profile}`}${own.size ? ` own ${[...own].map(([i, a]) => `${i}=${a.toLowerCase()}`).join(',')}` : ''}`;
  const mine = (k: string) => own.has(k.slice(0, k.indexOf('.'))) && !!site.personal?.personal(k);
  // A card made from another (`from:`) is computed once, from the shared card. For someone whose source is their own copy
  // the shared one isn't theirs to see, so neither is what's made from it: the same rule as a source off their tabs.
  const fromOf = (k: string) => { const dot = k.indexOf('.'); return site.instances.get(k.slice(0, dot))?.widgets[k.slice(dot + 1)]?.from; };
  const sees = own.size ? (k: string) => base.sees(k) && !(fromOf(k) && mine(fromOf(k)!)) : base.sees;
  return { ...base, name, own, key, sees, mine, choice: base.owner && theirs.size ? everyone ? 'everyone' : 'mine' : undefined,
    instances: own.size ? swapped(site, base, own, key) : base.instances };
}
type Base = Omit<View, 'own' | 'mine' | 'choice' | 'key' | 'name'>;

// the instances one person's doors use: their own copy in place of each service they're mapped on, the same map each time.
// A member's copy is scoped like the rest of theirs (a map of the homelab narrowed to their tabs).
const swaps = new WeakMap<Map<string, Instance>, Map<string, Map<string, Instance>>>();
function swapped(site: SiteLike, base: Base, own: Map<string, string>, key: string) {
  let kept = swaps.get(base.instances);
  if (!kept) swaps.set(base.instances, kept = new Map());
  let out = kept.get(key);
  // an integration with a card made from one of their own (`from:` a personal widget) reads the shared card through its
  // ctx.card: its tools would answer with everyone's, so it isn't among theirs at all (`sees` hides its card, above)
  const made = (inst: Instance) => Object.values(inst.widgets).some(w => w.from && own.has(w.from.slice(0, w.from.indexOf('.'))) && !!site.personal?.personal(w.from));
  if (!out) kept.set(key, out = new Map([...base.instances].filter(([, inst]) => !made(inst)).map(([id, inst]) => {
    if (!own.has(id)) return [id, inst];
    const copy = site.personal!.instance(id, own.get(id)!);
    return [id, base.owner ? copy : scoped(copy, { sees: base.knows })];
  })));
  return out;
}

function member({ config, instances, placed }: SiteLike, id: string): Base {
  const p = Object.hasOwn(config.profiles, id) ? config.profiles[id] : undefined;
  const tabs = p?.tabs && new Set(p.tabs), acts = new Set(p?.actions ?? []);
  const tab = (name?: string) => !!p && (!tabs || (name != null && tabs.has(name)));
  const keys = new Set(tabs ? config.layout.filter(s => tab(s.tab ?? s.title)).flatMap(s => s.widgets.map(w => w.widget)) : p ? [...placed] : []);
  // A card made from another widget (`type: api` with `from:`) carries that widget's data, so it's seen only by someone
  // who sees that one too: the source has to be on one of their tabs as well. Every route, the chat's `show`, a card's
  // pictures and its assistant access read `sees`, so this one rule covers them all. A chain is refused by the config
  // check; the depth here only keeps a broken config from looping.
  const fromOf = (key: string) => { const dot = key.indexOf('.'); return instances.get(key.slice(0, dot))?.widgets[key.slice(dot + 1)]?.from; };
  const seen = (key: string, depth: number): boolean => {
    if (!keys.has(key) || OWN.has(key.split('.')[0])) return false;
    const src = fromOf(key);
    return !src || (depth < 4 && seen(src, depth + 1));
  };
  const sees = (key: string) => seen(key, 0);
  const onTabs = (inst: string) => [...keys].some(k => k.startsWith(`${inst}.`) && sees(k));
  const mine = p?.assistant || undefined, a = config.assistant;
  const assistant = a && mine ? { ...a, access: narrowed(a, mine.access, instances, onTabs), suggestions: mine.suggestions, models: [], agent: undefined, telegram: undefined,
    instructions: [a.instructions, mine.instructions].filter(Boolean).join('\n') || undefined } : undefined;
  return {
    owner: false, profile: id, sees, knows: onTabs, tab,
    presses: (inst, action) => !OWN.has(inst) && acts.has(`${inst}.${action}`),
    // no assistant: nothing of the chat's is theirs, so nothing is searched either; an owner's commands and MCP servers stay the owner's
    config: { ...config, assistant, find: assistant ? config.find : false, chat: { ...config.chat, commands: {} }, mcp: {} },
    instances: new Map([...instances].filter(([i]) => i !== 'config' && i !== 'pins').map(([i, inst]) => [i, scoped(inst, { sees: onTabs })])),
    approve: mine?.approve ?? 'owner',
  };
}

/** What `profiles` and `users` say that can't be: for `config check` and the log. A typo here never widens anything (the
 *  account sees less, or nothing), so these are for the owner to fix, not for Valet to guess at. */
export function peopleProblems(config: Config, instances: Map<string, Instance>): string[] {
  const out: string[] = [], profiles = Object.keys(config.profiles), bound = (config.assistant?.telegram?.users ?? []).flatMap(u => typeof u === 'object' ? [u.as] : []);
  if (!profiles.length && !Object.keys(config.users).length && !bound.length) return out;
  const seen = new Map<string, string>();
  for (const [name, id] of Object.entries(config.users)) {
    if (!Object.hasOwn(config.profiles, id)) out.push(`users.${name}: no profile "${id}"${profiles.length ? ` (the profiles are: ${profiles.join(', ')})` : ''}; until it's fixed ${name} sees nothing`);
    if (seen.has(same(name))) out.push(`users.${name}: the same account as ${seen.get(same(name))} (names compare without case); the first one counts`);
    else seen.set(same(name), name);
  }
  const tabs = new Set(config.layout.flatMap(s => s.tab ?? s.title ?? []));
  for (const [id, p] of Object.entries(config.profiles)) {
    const at = `profiles.${id}`;
    for (const t of p.tabs ?? []) if (!tabs.has(t)) out.push(`${at}.tabs: no tab "${t}" (the tabs are: ${[...tabs].join(', ')})`);
    for (const key of p.actions) {
      const [inst, action] = key.split('.'), has = Object.keys(instances.get(inst)?.actions ?? {});
      if (OWN.has(inst)) out.push(`${at}.actions: ${key} is Valet's own, and stays with owners`);
      else if (!instances.has(inst)) out.push(`${at}.actions: no integration "${inst}"`);
      else if (!has.includes(action)) out.push(`${at}.actions: ${inst} has no action "${action}" (it has: ${has.join(', ') || 'none'})`);
    }
    if (!p.assistant) continue;
    if (!config.assistant) out.push(`${at}.assistant: there's no assistant: block for it to narrow`);
    for (const [key, level] of Object.entries(p.assistant.access)) {
      const dot = key.indexOf('.'), inst = dot < 0 ? key : key.slice(0, dot), tool = dot < 0 ? undefined : key.slice(dot + 1);
      if (key === 'default') continue;
      if (OWN.has(inst)) { if (level !== 'none' && !(inst === 'valet' && tool && [...KEPT, ...DOCS].includes(tool))) out.push(`${at}.assistant.access.${key}: Valet's own tools stay with owners (ignored)`); }
      else if (!instances.has(inst)) out.push(`${at}.assistant.access.${key}: no such integration`);
      else if (tool && !instances.get(inst)!.tools?.[tool]) out.push(`${at}.assistant.access: ${inst} has no tool "${tool}" (it has: ${Object.keys(instances.get(inst)!.tools ?? {}).join(', ') || 'none'})`);
      else if (config.assistant && rank[level] > toolAccess(config.assistant, inst, tool)) out.push(`${at}.assistant.access.${key}: ${level} is more than assistant.access gives (${LEVELS[toolAccess(config.assistant, inst, tool)]}); a profile only narrows, so the lower one counts`);
    }
  }
  for (const as of bound) if (profileOf(config, as) === undefined) out.push(`assistant.telegram.users: "${as}" isn't in users, so that person is an owner there`);
  if (config.auth.mode === 'none' && profiles.length) out.push(`profiles: auth.mode is none, so nobody signs in and the page is the same for everyone; profiles ${bound.length ? 'only reach Telegram' : 'do nothing'} until sign-in is on`);
  return out;
}

/** What a `people:` map says that can't be. Like a profile's typos, none of them widens anything: a name that isn't anyone
 *  is nobody's, and a person with no name in it sees the shared cards, as before. */
export function ownProblems(config: Config, given: [string, Record<string, string>][], instances: Map<string, Instance>): string[] {
  const out: string[] = [];
  for (const [id, people] of given) {
    const at = `integrations.${id}.people`, seen = new Map<string, string>();
    if (config.auth.mode === 'none') out.push(`${at}: auth.mode is none, so nobody signs in and everyone sees the shared cards; it does nothing until sign-in is on`);
    for (const name of Object.keys(people)) {
      if (seen.has(same(name))) out.push(`${at}.${name}: the same person as ${seen.get(same(name))} (names compare without case); the first one counts`);
      else seen.set(same(name), name);
    }
    if (!Object.values(instances.get(id)?.widgets ?? {}).some(w => w.personal)) out.push(`${at}: none of its widgets is anyone's own, so only its tools follow the person`);
  }
  // a card made from a personal one is made from everyone's, so the people mapped there don't get it (viewOf)
  const mapped = new Set(given.map(([id]) => id));
  for (const [id, inst] of instances) for (const w of Object.values(inst.widgets)) {
    const src = w.from, si = src?.slice(0, src.indexOf('.'));
    if (src && si && mapped.has(si) && instances.get(si)?.widgets[src.slice(si.length + 1)]?.personal)
      out.push(`integrations.${id}.from: ${src} is someone's own for the people in ${si}.people, and this card is made from everyone's; they won't see it or its tools`);
  }
  return out;
}

/** With local accounts: a name in a `people:` map that no account has (the accounts are in the data folder, not the
 *  config, so this is for `config check` and the log). */
export function unknownPeople(config: Config, accounts: string[]): string[] {
  if (config.auth.mode !== 'local' || !accounts.length) return [];
  const have = new Set(accounts.map(same)), out: string[] = [];
  for (const [id, block] of Object.entries(config.integrations)) {
    const people = (block as { people?: unknown }).people;
    if (!people || typeof people !== 'object') continue;
    for (const name of Object.keys(people)) if (!have.has(same(name))) out.push(`integrations.${id}.people.${name}: no account "${name}" (the accounts are: ${accounts.join(', ')}); it does nothing until there is one`);
  }
  return out;
}

/** With local accounts: every one of them has a profile, so nobody is an owner. Valet never promotes a member to fill
 *  the gap; the way back is the file (take one name out of `users`) or a new account (`user add`). */
export function noOwner(config: Config, accounts: string[]) {
  if (config.auth.mode !== 'local' || !accounts.length || accounts.some(n => profileOf(config, n) === undefined)) return null;
  return `users: every account (${accounts.join(', ')}) has a profile, so nobody is an owner and nobody can approve, see the log or use the full page. Take one out of users, or add an account: node dist/server.js user add <name>`;
}

type Out = { data: any; card?: unknown };
/** `approve: owner`: a member's tool call that would ask first asks an owner instead. It waits in asks.ts as an MCP
 *  client's does (one exact call, once), shown on owners' pages in the tool's own words, and the member's chat hears
 *  plainly that it's waiting, approved or declined. `run` is given who to log it under. */
export function viaOwner(o: { asks: Asks; meta: Map<string, { type: string; name: string }>; redact: (s: string) => string; activity?: Activity; push: (m: Message) => void; hold?: number }) {
  return async (call: { id: string; name: string; t: Tool; args: unknown; who: string }, run: (who: string) => Promise<Out>): Promise<Out> => {
    const { id, name, t, args, who } = call, tool = `${id}__${name}`;
    // the asker is part of the call: one person's yes never covers another's
    const hash = hashOf(`${who}\n${tool}`, args), does = t.label ?? name;
    const approved = () => { const by = o.asks.approver(hash); return run(by ? `${who}, approved by ${by}` : who); };
    if (o.asks.take(hash)) return approved();
    const own = await Promise.resolve(t.confirm?.(args as never)).catch(() => undefined), type = o.meta.get(id)?.type;
    const said = JSON.parse(o.redact(JSON.stringify({ ...(own ?? { title: `${o.meta.get(id)?.name ?? id}: ${does}?`, detail: JSON.stringify(args).slice(0, 300) }), logo: type && `/api/icon/${type}` })));
    const asked = o.asks.request({ from: who, tool, hash, said }, o.hold ?? HOLD);
    if (asked.fresh) o.push({ title: `${who} is waiting for your approval`, text: said.title, urgent: true });
    const answer = await asked.answer, note = (text: string, tone: 'warn' | 'bad') => ({ type: 'text', tone, text });
    if (answer === 'approved') return approved();
    if (answer === 'declined') {
      o.activity?.add({ who, via: 'chat', what: does, input: args, ok: false, error: 'declined by an owner' });
      return { data: { error: 'An owner declined this. Nothing was changed. Say so plainly, and do not try it again.' }, card: note(`An owner said no: ${said.title}`, 'bad') };
    }
    if (answer === 'full') return { data: { error: 'Too many approvals are already waiting for an owner. Nothing was changed. Say so, and that they can try again once an owner has answered those.' } };
    return { data: { waiting: `Not done yet: this needs an owner's approval, and it's on their Valet page now (“${said.title}”). Nothing has changed. Tell the person it's waiting for an owner, and to ask you again once one has approved; then call this tool again with exactly the same input. Don't call it again in this answer.` },
      card: note(`Waiting for an owner to approve: ${said.title}`, 'warn') };
  };
}
