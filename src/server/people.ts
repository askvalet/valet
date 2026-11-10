// Who is asking, and what they may see and do. `profiles` and `users` in the config give some accounts a narrower Valet
// (a child's, a guest's); an account `users` doesn't name is an owner, exactly as without them. One view is worked out
// per person and site, here, and every route reads it (main.ts): nothing is hidden by the page alone.
// A profile only narrows. What it doesn't name isn't there: a tab it leaves out, an action it doesn't list, an
// integration its assistant isn't given. Valet's own things (its log, rules, pins, setup, notifications, approvals asked
// of an owner) stay with owners whatever a profile says, and a name that maps to a profile that isn't there sees nothing.
import type { Activity } from './activity.ts';
import { type Asks, hashOf } from './asks.ts';
import type { Config } from './config.ts';
import type { Instance, Tool } from './core.ts';
import type { Message } from './notify.ts';
import { accessOf, rank, toolAccess } from './run.ts';

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
  /** a tab, by name as in layout */
  tab(name?: string): boolean;
  /** a page action */
  presses(inst: string, action: string): boolean;
  /** The config as this person's routes read it: the assistant is theirs (the owner's, narrowed) or absent. */
  config: Config;
  instances: Map<string, Instance>;
  /** who answers what their assistant asks first */
  approve: 'self' | 'owner';
}
interface SiteLike { config: Config; instances: Map<string, Instance>; placed: Set<string> }

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
  for (const b of KEPT) if (a.access[`valet.${b}`] === 'none' || mine[`valet.${b}`] === 'none') out[`valet.${b}`] = 'none';
  for (const d of DOCS) if (toolAccess(a, 'valet', d) >= rank.read && mine[`valet.${d}`] !== 'none') out[`valet.${d}`] = 'read';
  return out;
}

const built = new WeakMap<Map<string, Instance>, Map<string, View>>();

/** The view for one account on one site. Asked on every request; a profile's is built once per site. */
export function viewOf(site: SiteLike, name?: string): View {
  const id = profileOf(site.config, name);
  if (id === undefined) return { owner: true, name, sees: () => true, tab: () => true, presses: () => true, config: site.config, instances: site.instances, approve: 'self' };
  let views = built.get(site.instances);
  if (!views) built.set(site.instances, views = new Map());
  let view = views.get(id);
  if (!view) views.set(id, view = member(site, id));
  return { ...view, name };
}

function member({ config, instances, placed }: SiteLike, id: string): View {
  const p = Object.hasOwn(config.profiles, id) ? config.profiles[id] : undefined;
  const tabs = p?.tabs && new Set(p.tabs), acts = new Set(p?.actions ?? []);
  const tab = (name?: string) => !!p && (!tabs || (name != null && tabs.has(name)));
  const keys = new Set(tabs ? config.layout.filter(s => tab(s.tab ?? s.title)).flatMap(s => s.widgets.map(w => w.widget)) : p ? [...placed] : []);
  const sees = (key: string) => keys.has(key) && !OWN.has(key.split('.')[0]);
  const onTabs = (inst: string) => [...keys].some(k => k.startsWith(`${inst}.`) && sees(k));
  const mine = p?.assistant || undefined, a = config.assistant;
  const assistant = a && mine ? { ...a, access: narrowed(a, mine.access, instances, onTabs), suggestions: mine.suggestions, models: [], agent: undefined, telegram: undefined,
    instructions: [a.instructions, mine.instructions].filter(Boolean).join('\n') || undefined } : undefined;
  return {
    owner: false, profile: id, sees, tab,
    presses: (inst, action) => !OWN.has(inst) && acts.has(`${inst}.${action}`),
    // no assistant: nothing of the chat's is theirs, so nothing is searched either; an owner's commands and MCP servers stay the owner's
    config: { ...config, assistant, find: assistant ? config.find : false, chat: { ...config.chat, commands: {} }, mcp: {} },
    instances: new Map([...instances].filter(([i]) => i !== 'config' && i !== 'pins')),
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
