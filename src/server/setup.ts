// Setting Valet up by talking to it. The assistant can read the config, look up what an integration accepts, try a
// change without saving (a diff, every problem, and the new card), and, with the person's approval, save it. Only with
// `assistant.access.config`. It can't touch sign-in, plugins, MCP or its own access, point at files on disk, or write a
// secret into the file: those stay in .env. The save before this one is kept, so a change can be undone. Saved edits go through the same hot reload as a person's.
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Config, parseConfig } from './config.ts';
import { makeContext, type Instance, type Integration, type Tool } from './core.ts';
import { check } from './site.ts';
import type { Card } from '../shared/cards.ts';
import { applyOps, diff, Op } from './yaml-edit.ts';

const EDITABLE = new Set(['integrations', 'layout', 'links', 'menubar', 'weather', 'live', 'nav', 'hero', 'chat', 'format', 'labels', 'title', 'greeting', 'location', 'timezone', 'search', 'history', 'welcome', 'appearance', 'calendar', 'recap', 'notice']);
// Of `assistant`, only how it comes across. Its access, model and prompt stay with the owner: it can't raise its own power.
const ASSISTANT = new Set(['name', 'suggestions']);
const SECRET_KEY = /^(api[-_]?key|token|password|secret|client[-_]?secret|authorization|x-api-key)$/i;


// Appearance can name files, and Valet serves those: the assistant may set looks, never point it at something on disk.
const LOCAL = /^(\/|\.{1,2}\/|~|file:)/;   // and `css`, which is served to the sign-in screen and can load things from anywhere
function namesAFile(o: Op): string | null {
  const walk = (v: unknown, key: string): string | null => {
    if (/file$|^css$/i.test(key)) return `"${key}" is something the owner sets by hand`;
    if (typeof v === 'string' && LOCAL.test(v)) return `"${v}" is a file on disk; use an image URL, a colour or a gradient, or the owner sets it by hand`;
    if (Array.isArray(v)) { for (const x of v) { const r = walk(x, key); if (r) return r; } }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const r = walk(x, k); if (r) return r; }
    return null;
  };
  return o.op === 'remove' ? null : walk(o.value, String(o.path.at(-1)));
}

/** Why these edits aren't allowed, if they aren't. */
export function refused(ops: Op[]): string | null {
  for (const o of ops) {
    const head = String(o.path[0]);
    if (head === 'assistant' ? !ASSISTANT.has(String(o.path[1])) : !EDITABLE.has(head)) return `"${o.path.slice(0, head === 'assistant' ? 2 : 1).join('.')}" isn't something the assistant may change; the owner edits that by hand`;
    if (head === 'appearance') { const why = namesAFile(o); if (why) return why; }
    const walk = (v: unknown, key: string): string | null => {
      if (typeof v === 'string' && v && (SECRET_KEY.test(key) || /^(bearer|token|basic)\s+\S/i.test(v)) && !/\$\{[^}]+\}/.test(v)) return `"${key}" looks like a secret: use \${SOME_NAME} and have the person add it to .env`;
      if (Array.isArray(v)) { for (const x of v) { const r = walk(x, key); if (r) return r; } }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const r = walk(x, k); if (r) return r; }
      return null;
    };
    const bad = walk(o.value, String(o.path.at(-1)));
    if (bad) return bad;
  }
  return null;
}

const REF = /(\\?)\$\{(?:(secret|file):[^}]+|([A-Z0-9_]+))\}/g;
const refsIn = (s: string) => [...s.matchAll(REF)].filter(m => !m[1]).map(m => m[0]);
const walkStrings = (v: unknown, key: string, see: (s: string, key: string) => void) => {
  if (typeof v === 'string') see(v, key);
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, key, see);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, k, see);
};
/** Which secrets go where: each `${NAME}` in an integration, and the hosts that block talks to. */
export function bindings(text: string) {
  const doc = (parseYaml(text) ?? {}) as Record<string, unknown>, hosts = new Map<string, Set<string>>(), outside = new Set<string>();
  for (const [id, block] of Object.entries((doc.integrations ?? {}) as Record<string, unknown>)) {
    const names = new Set<string>(), at = new Set<string>();
    walkStrings(block, id, (s, key) => {
      for (const r of refsIn(s)) names.add(r);
      // keys called …url are what an integration fetches; href, links and pictures are only shown, so they vouch for nothing
      if (!/url$/i.test(key)) return;
      if (/^https?:\/\//.test(s)) { try { at.add(new URL(s.replace(REF, 'x')).host); } catch { at.add(s); } }
      else at.add(s);
    });
    for (const n of names) { const set = hosts.get(n) ?? new Set<string>(); for (const h of at) set.add(h); hosts.set(n, set); }
  }
  for (const [k, v] of Object.entries(doc)) if (k !== 'integrations') walkStrings(v, k, s => { for (const r of refsIn(s)) outside.add(r); });
  return { hosts, outside, doc };
}
/** Every host the config mentions anywhere: what Valet fetches, and what the browser loads or embeds. */
export function addresses(text: string) {
  const out = new Set<string>();
  walkStrings(parseYaml(text) ?? {}, '', s => { for (const m of s.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/g)) { try { out.add(new URL(m[0].replace(REF, 'x')).host); } catch { /* not an address */ } } });
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Did anything owner-only change, whatever the edit looked like? Judged on the parsed result, not the paths asked for. */
function ownerChanged(before: Record<string, any>, after: Record<string, any>) {
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'assistant') {
      const strip = (a: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(a).filter(([x]) => !ASSISTANT.has(x)));
      if (!same(strip(before[k]), strip(after[k]))) return 'assistant';
    } else if (!EDITABLE.has(k) && !same(before[k], after[k])) return k;
  }
  for (const k of ['css', 'cssFile']) if (!same(before.appearance?.[k], after.appearance?.[k])) return `appearance.${k}`;
  return null;
}
/** The rule that keeps secrets home: a secret only ever goes to hosts it already goes to, and none moves into the page.
 *  One check for every way of getting there: pointing an integration somewhere new, copying a reference into a new
 *  block, or putting one in a title or a wallpaper the browser would fetch. */
export function guard(beforeText: string, afterText: string): string | null {
  const a = bindings(beforeText), b = bindings(afterText), owner = ownerChanged(a.doc, b.doc);
  if (owner) return `"${owner}" isn't something the assistant may change; the owner edits that by hand`;
  for (const r of b.outside) if (!a.outside.has(r)) return `${r} can't go outside an integration: the page would show it`;
  for (const [r, hosts] of b.hosts) {
    if (/^\$\{(file|secret):/.test(r) && !a.hosts.has(r)) return `${r} reads a file; the owner adds those by hand`;
    const known = a.hosts.get(r);
    if (known) for (const h of hosts) if (!known.has(h)) return `${r} goes to ${[...known].join(', ') || 'nowhere yet'}, and this would send it to ${h} as well. The owner has to make that change by hand`;
  }
  return null;
}

export { applyOps, diff, type Op } from './yaml-edit.ts';

/** Would this text work? Problems by name, and ${NAMES} it needs that aren't set yet (those aren't its fault). */
export function validate(text: string, registry: Record<string, Integration>) {
  const missing: string[] = [];
  let t = text;
  for (let i = 0; i < 20; i++) {
    try { return { ...check(parseConfig(t), registry), missing }; }
    catch (e) {
      const m = (e as Error).message.match(/variable (\w+) is not set/);
      if (!m) return { problems: [(e as Error).message], instances: new Map<string, Instance>(), missing };
      missing.push(m[1]); t = t.replaceAll(`\${${m[1]}}`, 'not-set-yet');
    }
  }
  return { problems: ['too many unset variables'], instances: new Map<string, Instance>(), missing };
}

// the one save before this, for undo. It's the config itself, so only Valet's user may read it, whatever the folder's default
const previousOf = (path: string) => `${path}.previous`;
/** Save a new config, keeping the one it replaces for undo. Throws if the folder is read-only to Valet. */
export async function save(path: string, before: string, after: string) {
  const previous = previousOf(path);
  await writeFile(previous, before, { mode: 0o600 }); await chmod(previous, 0o600);
  await writeFile(path, after);
}
/** Put the config back as it was before the last save, if `blocked` (given now, then) has no objection and it still works. */
export async function undoSave(path: string, registry: Record<string, Integration>, blocked: (now: string, old: string) => string | null): Promise<{ undone: true } | { error: string; problems?: string[] }> {
  const old = await readFile(previousOf(path), 'utf8').catch(() => null);
  if (old == null) return { error: 'nothing to undo' };
  const now = await readFile(path, 'utf8'), why = blocked(now, old);
  if (why) return { error: why };
  const { problems } = validate(old, registry);
  if (problems.length) return { error: 'the earlier version no longer works', problems };
  await save(path, now, old);
  return { undone: true };
}

export function setupTools(path: string, registry: Record<string, Integration>): Record<string, Tool<any>> {
  const previous = previousOf(path);
  const edits = z.object({ ops: z.array(Op).min(1), summary: z.string().describe('in plain words, what this changes') });
  const newIntegration = (ops: Op[]) => { const o = ops.find(o => o.op === 'set' && o.path[0] === 'integrations' && o.path.length === 2); return o ? String(o.path[1]) : undefined; };
  const trial = async (ops: Op[]) => {
    const why = refused(ops); if (why) throw new Error(why);
    const before = await readFile(path, 'utf8'), after = applyOps(before, ops);
    const blocked = guard(before, after); if (blocked) throw new Error(blocked);
    return { before, after, ...validate(after, registry) };
  };
  return {
    config_read: {
      label: 'Read the config', access: 'read', input: z.object({}),
      description: 'The config file as it stands (secrets appear as ${NAME}), every integration type available, and the widgets each instance really offers, named as `layout` wants them. Start here when asked to add or change anything on the page.',
      async run() {
        const config = await readFile(path, 'utf8');
        return { data: { config, types: Object.values(registry).map(i => `${i.type} (${i.name})`), sections: Object.keys(Config.shape),
          widgets: Object.fromEntries([...validate(config, registry).instances].map(([id, inst]) => [id, Object.keys(inst.widgets).map(w => `${id}.${w}`)])),
          changeable: [...EDITABLE, ...[...ASSISTANT].map(k => `assistant.${k}`)], ownerOnly: ['auth', 'profiles', 'users', 'allowedHosts', 'plugins', 'mcp', 'notify', 'sandbox', 'the rest of assistant'] } };
      },
    },
    config_options: {
      label: 'Looked up the options', access: 'read', input: z.object({ type: z.string() }),
      description: 'What an integration type, or a section of the config such as layout, appearance, hero, nav or chat, accepts, as JSON schema. Look before writing a block. For a service with no type of its own, use type "api"; its fields are paths like data.speed or items[0].name, with formats like size|bytes. Icons: cpu gpu memory wifi disk download pulse play film bulb home shield chat image clock crescent game book coins text file bookmark rss news reddit tag chart calendar sun moon cloud, or an image URL.',
      async run({ type }) {
        const part = (Config.shape as Record<string, z.ZodType>)[type];
        if (part && !registry[type]) return { data: z.toJSONSchema(part, { io: 'input', unrepresentable: 'any' }) };
        const i = registry[type]; if (!i) return { data: { error: `no type or section ${type}` } };
        return { data: z.toJSONSchema(i.config, { io: 'input', unrepresentable: 'any' }) };
      },
    },
    api_sample: {
      label: 'Looked at the API', access: 'write',
      confirm: async ({ url, headers }) => {
        const sends = Object.entries((headers ?? {}) as Record<string, string>).map(([k, v]) => `${k}${refsIn(v).length ? ` (${refsIn(v).join(', ')})` : ''}`);
        return { title: `Fetch from ${new URL(url).host}?`, detail: `${url}${sends.length ? ` · sends ${sends.join(', ')}` : ''}`, icon: 'pulse', verb: 'Fetch' };
      },
      description: 'Fetch a JSON URL the person gave you and return the start of the response, to write a `type: api` block from: which paths hold the numbers. Headers may use a ${NAME} only if the config already sends it to that same host.',
      input: z.object({ url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }),
      async run({ url, headers }) {
        const given = (headers ?? {}) as Record<string, string>, { hosts } = bindings(await readFile(path, 'utf8')), host = new URL(url).host;
        for (const r of Object.values(given).flatMap(refsIn)) if (!hosts.get(r)?.has(host)) return { data: { error: `${r} doesn't go to ${host}, so it isn't sent` } };
        const filled = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v.replace(/\$\{(\w+)\}/g, (_: string, n: string) => process.env[n] ?? '')]));
        try {
          const r = await makeContext('setup').http<Response>(url, { as: 'response', headers: filled, timeout: 15_000, redirect: 'manual' });
          if (r.status >= 300 && r.status < 400) return { data: { error: `it redirects to ${r.headers.get('location')}, which wasn't followed; ask them for that address` } };
          return { data: { status: r.status, sample: (await r.text()).slice(0, 6000) } };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_preview: {
      label: 'Tried the change', access: 'read', input: edits,
      description: 'Check edits WITHOUT saving and without contacting anything: returns the diff, any problems, the env variables it still needs and which widgets a new integration offers. Always do this before config_apply, and fix what it reports. Edit the smallest path that does the job: one widget or section, by index, never the whole of `layout`. New cards go in `layout` too, or they won\'t appear. Secrets are never written: use ${NAME}. To see a new card with real data, config_try.',
      async run({ ops }) {
        try {
          const t = await trial(ops), id = newIntegration(ops), inst = id ? t.instances.get(id) : undefined;
          return { data: { diff: diff(t.before, t.after), problems: t.problems, needsInEnv: t.missing, widgets: inst ? Object.keys(inst.widgets) : undefined },
            card: { type: 'code', title: 'What changes', diff: true, lines: diff(t.before, t.after).split('\n') } satisfies Card };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_try: {
      label: 'Tried the card', access: 'write', input: edits,
      // a card really fetched is a request really sent, with its keys, so it's shown first and asked about
      confirm: async ({ ops }) => {
        const id = newIntegration(ops), block = (ops as Op[]).find(o => o.path[1] === id)?.value as Record<string, any> | undefined, where: string[] = [], keys: string[] = [];
        walkStrings(block, 'url', s => { keys.push(...refsIn(s)); if (/^https?:/.test(s)) where.push(s.replace(/\?.*/, '')); });
        return { title: `Fetch ${id ?? 'this card'} to try it?`, detail: `${String(block?.method ?? 'GET')} ${where.join(', ') || 'its address'}${keys.length ? ` · sends ${[...new Set(keys)].join(', ')}` : ''}`, icon: 'pulse', verb: 'Fetch' };
      },
      description: 'Really fetch a new integration from edits you previewed, once, so the person sees its card before saving and you can see whether the paths are right. Nothing is saved. Asks first, because it sends a request.',
      async run({ ops }) {
        try {
          const t = await trial(ops), id = newIntegration(ops), w = id && Object.values(t.instances.get(id)?.widgets ?? {})[0];
          if (!w) return { data: { error: 'that adds no integration to try' } };
          if (t.problems.length || t.missing.length) return { data: { error: 'fix these first', problems: t.problems, needsInEnv: t.missing } };
          const card = await w.fetch();
          return { data: { cardShows: JSON.stringify(card).slice(0, 900) }, card };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_apply: {
      label: 'Changed the config', access: 'control', input: edits, undo: 'config_undo',
      // a page, wallpaper or embed somewhere new is how poisoned content would reach out, so the card names any first contact
      confirm: async ({ ops }) => {
        const t = await trial(ops), fresh = [...addresses(t.after)].filter(h => !addresses(t.before).has(h));
        return { title: 'Save this change to your config?', icon: 'file', danger: fresh.length > 0 || undefined,
          detail: fresh.length ? `First time Valet or your browser would contact ${fresh.join(', ')}. Only allow it if you know that address.` : undefined };
      },
      description: 'Save edits you already previewed, once the problems list is empty. The page updates by itself. Asks the person first.',
      async run({ ops }) {
        try {
          const t = await trial(ops);
          if (t.missing.length) return { data: { error: `add ${t.missing.join(', ')} to .env and recreate the container first` } };
          if (t.problems.length) return { data: { error: 'not saved', problems: t.problems } };
          try { await save(path, t.before, t.after); }
          catch { return { data: { error: 'the config folder is read-only to Valet, so nothing was saved; give the person this to paste in', diff: diff(t.before, t.after) } }; }
          return { data: { saved: true } };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_undo: {
      label: 'Undid the last config change', access: 'control', input: z.object({}),
      confirm: async () => {
        const [old, now] = await Promise.all([readFile(previous, 'utf8').catch(() => null), readFile(path, 'utf8')]);
        if (old == null) return { title: 'There is nothing to undo.', icon: 'pulse' };
        const change = diff(now, old);
        return { title: 'Undo the last config change?', detail: change.length > 1200 ? `${change.slice(0, 1200)}\n… and ${change.length - 1200} characters more` : change, icon: 'pulse', verb: 'Undo' };
      },
      description: 'Put the config back as it was before the last save. Undoing twice puts the change back.',
      async run() {
        // a hand edit made since then stays yours
        const owner = (now: string, old: string) => { const k = ownerChanged(parseYaml(now) ?? {}, parseYaml(old) ?? {}); return k && `${k} has been changed by hand since then, so the owner undoes this`; };
        return { data: await undoSave(path, registry, owner) };
      },
    },
  };
}
