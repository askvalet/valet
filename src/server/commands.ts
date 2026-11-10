// ⌘K's plain commands: an integration's words for its own actions and tools, run by rule with no model anywhere on the
// way. The same doors as the chat: a read-only page only looks, a tool needs the access the assistant would need, input
// is checked by the tool's schema, results are redacted, and anything that changes something is in the activity log.
// Without an assistant there's no access to go by, so commands run page actions (which the page could run anyway) and
// tools that only look.
import type { Context } from 'hono';
import type { Activity } from './activity.ts';
import type { Config } from './config.ts';
import type { Action, Command, Instance, Tool } from './core.ts';
import type { Hub } from './hub.ts';
import { match, type Phrase } from '../shared/commands.ts';
import { httpsOnly } from './webpush.ts';
import { toolAccess } from './run.ts';

const RANK = { none: 0, read: 1, write: 2, control: 3 } as const;
// Valet's own parts (its setup tools above all) never answer to a command, whatever they declare. Valet's own tools
// that only look (the backups) may, since anyone who can open the page could see the same card.
const OWN = new Set(['config', 'valet', 'pins']);
const looks = (inst: string, kind: string, target: Action | Tool | undefined) => inst === 'valet' && kind === 'tool' && (target as Tool | undefined)?.access === 'read';

export interface CommandSite {
  config: Config; instances: Map<string, Instance>; meta: Map<string, { type: string; name: string }>;
  acting: boolean; redact: (s: string) => string; activity: Activity; hub?: Pick<Hub, 'refreshInstance'>;
  /** someone with a profile (people.ts): `config` is already theirs, and these are the page actions they were given */
  member?: { presses(inst: string, action: string): boolean; approve: 'self' | 'owner' };
}
interface Entry extends Phrase { inst: string; name: string; cmd: Command; target: Action | Tool }

/** Every command this site declares, with `{name}` filled in. A broken list leaves out its own commands, nothing else. */
export async function commandsOf(site: CommandSite): Promise<Entry[]> {
  const types = [...site.meta.values()].map(m => m.type);
  const lists = await Promise.all([...site.instances].map(async ([inst, i]) => {
    if ((OWN.has(inst) && inst !== 'valet') || !i.commands) return [];
    const list = await Promise.resolve(typeof i.commands === 'function' ? i.commands() : i.commands).catch(() => [] as Command[]);
    const m = site.meta.get(inst), names = [...new Set([inst.replace(/[-_]+/g, ' '), m?.name ?? inst])];
    const service = m && types.filter(t => t === m.type).length > 1 ? `${m.name} · ${inst}` : m?.name ?? inst;
    return (Array.isArray(list) ? list : []).flatMap((cmd, n): Entry[] => {
      const [kind, name] = String(cmd?.run ?? '').split(':') as ['action' | 'tool', string];
      const target = kind === 'action' ? i.actions?.[name] : kind === 'tool' ? i.tools?.[name] : undefined;
      if (!target || !Array.isArray(cmd.say) || (OWN.has(inst) && !looks(inst, kind, target))) return [];
      const say = [...new Set(cmd.say.flatMap(s => typeof s !== 'string' ? [] : s.includes('{name}') ? names.map(x => s.replaceAll('{name}', x)) : [s]))];
      const label = cmd.label ?? say[0] ?? name;
      return say.length ? [{ id: `${inst}:${n}`, say, label: label[0].toUpperCase() + label.slice(1), service, kind, access: kind === 'action' ? 'control' : (target as Tool).access, inst, name, cmd, target }] : [];
    });
  }));
  return lists.flat();
}

/** Whether this page may run it, and why not. */
export function refusal(site: CommandSite, e: Entry): string | null {
  // a profile: the page actions it lists, and tools its own assistant could use. Nothing of Valet's own, nothing at all
  // without an assistant, and nothing an owner would have to approve: that goes through the chat, where it can wait
  const m = site.member;
  if (m && (OWN.has(e.inst) || (e.kind === 'action' ? !m.presses(e.inst, e.name) : !site.config.assistant))) return 'that isn\'t part of your profile';
  if (m && e.kind === 'tool' && (e.target as Tool).access !== 'read' && m.approve === 'owner') return 'an owner has to approve that: ask the assistant for it';
  if (OWN.has(e.inst) && !looks(e.inst, e.kind, e.target)) return 'that isn\'t something a command can do';
  if (OWN.has(e.inst)) return site.config.assistant?.access.valet === 'none' ? 'assistant.access gives valet none'
    : site.config.assistant?.access[`${e.inst}.${e.name}`] === 'none' ? `assistant.access turns ${e.inst}.${e.name} off` : null;
  if (e.kind === 'action') return site.acting ? null : 'Valet is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)';
  const a = site.config.assistant, t = e.target as Tool;
  // no assistant: only looking. With one, what the assistant may use here, capped at looking on a read-only page
  // a dotted key (`plex.plex_stop_stream: control`) sets one tool's level, over its integration's
  const granted = a ? toolAccess(a, e.inst, e.name) : RANK.read;
  if (a && granted === RANK.none) return `assistant.access turns ${e.inst}.${e.name} off`;
  const level = Math.min(granted, site.acting ? RANK.control : RANK.read);
  if (RANK[t.access] <= level) return null;
  if (!site.acting) return 'Valet is read-only: sign-in is off (set auth.mode, or auth.trustNetwork if the network is private)';
  return a ? `assistant.access gives ${a.access[`${e.inst}.${e.name}`] ? `${e.inst}.${e.name}` : e.inst} ${a.access[`${e.inst}.${e.name}`] ?? a.access[e.inst] ?? a.access.default ?? 'read'}; this needs ${t.access}` : 'without an assistant, commands only look; this one changes something';
}

const who = (c: Context) => (c.get as (k: string) => string | undefined)('user') ?? 'you';
const clean = <T>(site: CommandSite, x: T): T => JSON.parse(site.redact(JSON.stringify(x ?? null)));

/** GET /api/commands: what this page may run, for the palette to match as you type. */
export async function listCommands(c: Context, site: CommandSite) {
  const list = (await commandsOf(site)).filter(e => !refusal(site, e));
  return c.json(clean(site, { commands: list.map(({ id, say, label, service, kind, access }) => ({ id, say, label, service, kind, access })) }));
}

/** POST /api/command { text, id, go }: runs the command `id` if `text` is exactly its words. A tool that changes something
 *  answers with its approval words first, and runs only when asked again with `go`. */
export async function runCommand(c: Context, site: CommandSite) {
  const body = await c.req.json().catch(() => ({})) as { text?: unknown; id?: unknown; go?: unknown };
  if (typeof body.text !== 'string' || typeof body.id !== 'string' || body.text.length > 200) return c.json({ error: 'bad command' }, 400);
  const list = await commandsOf(site);
  // the server matches again: what runs is what was typed, never just an id the page sent
  const hit = match(list, body.text).find(m => m.exact && m.id === body.id), e = hit && list.find(x => x.id === hit.id);
  if (!hit || !e) return c.json({ error: 'no command matches that' }, 404);
  const no = refusal(site, e);
  if (no) return c.json({ error: no }, 403);

  let raw: unknown;
  try {
    raw = typeof e.cmd.input === 'function' ? await e.cmd.input(hit.slots) : { ...e.cmd.input, ...hit.slots };
  } catch (err) { return c.json({ error: site.redact((err as Error).message) }, 409); }
  const args = e.target.input.safeParse(raw ?? {});
  if (!args.success) return c.json({ error: args.error.issues[0]?.message ?? 'bad input' }, 400);
  const label = e.label.replace(/\{(\w+)\}/g, (_, k) => String(hit.slots[k] ?? '…'));
  const service = site.meta.get(e.inst)?.name ?? e.inst, logo = site.meta.get(e.inst) && `/api/icon/${site.meta.get(e.inst)!.type}`;

  if (e.kind === 'action') {
    const a = e.target as Action, what = `${service}: ${a.description ?? e.name}`;
    try {
      const result = await a.run(args.data) as { done?: string } | undefined;
      setTimeout(() => site.hub?.refreshInstance(e.inst), 300);
      const done = result?.done ?? label;
      site.activity.add({ who: who(c), via: 'command', what, action: done, input: args.data, ok: true });
      return c.json(clean(site, { done }));
    } catch (err) {
      const error = site.redact((err as Error).message);
      site.activity.add({ who: who(c), via: 'command', what, action: `${service}: ${e.name}`, input: args.data, ok: false, error });
      return c.json({ error }, 502);
    }
  }

  const t = e.target as Tool, tool = `${e.inst}__${e.name}`;
  if (t.access !== 'read' && body.go !== true) {
    // the tool's own words for what's about to happen: it may look things up, never change them
    const said = await Promise.resolve(t.confirm?.(args.data)).catch(() => undefined);
    return c.json(clean(site, { confirm: { logo, ...(said ?? { title: `${label}?` }) } }));
  }
  const log = (ok: boolean, error?: string) => { if (t.access !== 'read') site.activity.add({ who: who(c), via: 'command', what: t.label ?? label, input: args.data, ok, error, undo: t.undo ? { tool: `${e.inst}__${t.undo}`, input: args.data } : undefined }); };
  try {
    const out = await t.run(args.data), failed = (out?.data as { error?: unknown } | undefined)?.error;
    log(!failed, failed ? site.redact(String(failed)) : undefined);
    if (t.access !== 'read') setTimeout(() => site.hub?.refreshInstance(e.inst), 300);
    if (failed) return c.json({ error: site.redact(String(failed)) }, 502);
    // a link to go to, only from a tool that looks, only when the command asks for it, and only https
    const open = e.cmd.open && t.access === 'read' ? httpsOnly(out.open) : undefined;
    return c.json(clean(site, { tool, input: args.data, card: out.card, done: out.card ? undefined : t.label ?? label, ...(open ? { open } : {}) }));
  } catch (err) {
    const error = site.redact((err as Error).message);
    log(false, error);
    return c.json({ error }, 502);
  }
}
