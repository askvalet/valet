// Setting Atrium up by talking to it. The assistant can read the config, look up what an integration accepts, try a
// change without saving (a diff, every problem, and the new card), and, with the person's approval, save it. Only with
// `assistant.access.config`. It can't touch sign-in, plugins, MCP or its own access, and it can't write a secret into
// the file: those stay in .env. Saved edits go through the same hot reload as a person's.
import { readFile, writeFile } from 'node:fs/promises';
import { isMap, isSeq, parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { parseConfig } from './config.ts';
import { makeContext, type Instance, type Integration, type Tool } from './core.ts';
import { check } from './site.ts';
import type { Card } from '../shared/cards.ts';

const EDITABLE = new Set(['integrations', 'layout', 'links', 'menubar', 'weather', 'island', 'nav', 'title', 'greeting', 'location', 'timezone', 'search', 'history', 'welcome']);
const SECRET_KEY = /^(api[-_]?key|token|password|secret|client[-_]?secret|authorization|x-api-key)$/i;

const Op = z.object({
  op: z.enum(['set', 'append', 'remove']).describe('set a value, append to a list, or remove'),
  path: z.array(z.union([z.string(), z.number()])).min(1).describe('where, e.g. ["integrations", "kuma"] or ["layout", 2, "widgets"]'),
  value: z.unknown().optional(),
});
export type Op = z.infer<typeof Op>;

/** Why these edits aren't allowed, if they aren't. */
export function refused(ops: Op[]): string | null {
  for (const o of ops) {
    if (!EDITABLE.has(String(o.path[0]))) return `"${o.path[0]}" isn't something the assistant may change; the owner edits that by hand`;
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

const YAML = { lineWidth: 0, flowCollectionPadding: false } as const;
const flow = (v: unknown) => stringify(v, { ...YAML, collectionStyle: 'flow' }).trim();
const indented = (yaml: string, pad: string) => yaml.trimEnd().split('\n').map(l => l ? pad + l : l).join('\n') + '\n';
const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
/** Where a new line goes after a block collection: past the end of its last line, trailing comment included. */
const after = (text: string, end: number) => { if (text[end - 1] === '\n') return end; const nl = text.indexOf('\n', end); return nl < 0 ? text.length : nl + 1; };

/** Change just the bytes an edit needs, so a person's spacing and comments stay exactly as they were. Returns null for
 *  the shapes this doesn't cover. */
function splice(text: string, o: Op): string | null {
  const doc = parseDocument(text);
  const parent = doc.getIn(o.path.slice(0, -1), true) ?? doc.contents, target = doc.getIn(o.path, true) as any;
  const put = (at: number, s: string) => text.slice(0, at) + s + text.slice(at);
  if (o.op === 'set' && target?.range && !(target.items && !target.flow)) return text.slice(0, target.range[0]) + flow(o.value) + text.slice(target.range[1]);
  if (o.op === 'set' && target == null && isMap(parent) && !parent.flow && parent.items.length) {
    const first = (parent.items[0].key as any).range[0], pad = text.slice(lineStart(text, first), first);
    return put(after(text, parent.range![1]), indented(stringify({ [o.path.at(-1)!]: o.value }, YAML), pad));
  }
  if (o.op === 'append' && isSeq(target)) {
    if (target.flow) return put(target.range![1] - 1, `${target.items.length ? ', ' : ''}${flow(o.value)}`);
    if (!target.items.length) return null;
    const pad = text.slice(lineStart(text, target.range![0])).match(/^\s*/)![0];
    return put(after(text, target.range![1]), indented(`- ${stringify(o.value, YAML).trimEnd().replace(/\n/g, '\n  ')}`, pad));
  }
  return null;
}

/** The edits applied to the file's text. Comments and order survive. */
export function applyOps(text: string, ops: Op[]): string {
  let out = text;
  for (const o of ops) {
    const done = splice(out, o);
    if (done != null) { out = done; continue; }
    const doc = parseDocument(out);
    if (o.op === 'remove') doc.deleteIn(o.path);
    else if (o.op === 'set') {
      // create the parents a new path needs
      for (let i = 1; i < o.path.length; i++) if (!doc.hasIn(o.path.slice(0, i))) doc.setIn(o.path.slice(0, i), doc.createNode({}));
      doc.setIn(o.path, doc.createNode(o.value));
    } else {
      const at = doc.getIn(o.path);
      if (at == null) doc.setIn(o.path, doc.createNode([o.value]));
      else if (isSeq(at)) at.add(doc.createNode(o.value));
      else throw new Error(`${o.path.join('.')} isn't a list`);
    }
    out = doc.toString(YAML);
  }
  return out;
}

/** Added and removed lines: the changed middle of the file, in the shape people expect of a diff. */
export function diff(a: string, b: string) {
  const x = a.split('\n'), y = b.split('\n');
  let start = 0; while (start < x.length && x[start] === y[start]) start++;
  let end = 0; while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return [...x.slice(start, x.length - end).map(l => `- ${l}`), ...y.slice(start, y.length - end).map(l => `+ ${l}`)].join('\n');
}

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

export function setupTools(path: string, registry: Record<string, Integration>): Record<string, Tool<any>> {
  const edits = z.object({ ops: z.array(Op).min(1), summary: z.string().describe('in plain words, what this changes') });
  const trial = async (ops: Op[]) => {
    const why = refused(ops); if (why) throw new Error(why);
    const before = await readFile(path, 'utf8'), after = applyOps(before, ops);
    return { before, after, ...validate(after, registry) };
  };
  return {
    config_read: {
      label: 'Read the config', access: 'read', input: z.object({}),
      description: 'The config file as it stands (secrets appear as ${NAME}), and every integration type available. Start here when asked to add or change something on the page.',
      async run() { return { data: { config: await readFile(path, 'utf8'), types: Object.values(registry).map(i => `${i.type} (${i.name})`) } }; },
    },
    config_options: {
      label: 'Looked up the options', access: 'read', input: z.object({ type: z.string() }),
      description: 'What an integration type accepts, as JSON schema. Look before writing a block. For a service with no type of its own, use type "api"; its fields are paths like data.speed or items[0].name, with formats like size|bytes. Icons: cpu gpu memory wifi disk download pulse play film bulb home shield chat image clock crescent game book coins text file bookmark rss news reddit tag chart calendar sun moon cloud, or an image URL.',
      async run({ type }) {
        const i = registry[type]; if (!i) return { data: { error: `no type ${type}` } };
        return { data: z.toJSONSchema(i.config, { io: 'input', unrepresentable: 'any' }) };
      },
    },
    api_sample: {
      label: 'Looked at the API', access: 'write', fromPerson: ['url'],
      description: 'Fetch a JSON URL the person gave you and return the start of the response, to write a `type: api` block from: which paths hold the numbers. Headers may use ${NAME}.',
      input: z.object({ url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }),
      async run({ url, headers }) {
        const ctx = makeContext('setup');
        const filled = Object.fromEntries(Object.entries((headers ?? {}) as Record<string, string>).map(([k, v]) => [k, v.replace(/\$\{(\w+)\}/g, (_: string, n: string) => process.env[n] ?? '')]));
        try { return { data: { sample: (await ctx.http<string>(url, { as: 'text', headers: filled, timeout: 15_000 })).slice(0, 6000) } }; }
        catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_preview: {
      label: 'Tried the change', access: 'read', input: edits,
      description: 'Try edits WITHOUT saving: returns the diff, any problems, env variables it still needs, and shows the person the new card. Always do this before config_apply, and fix what it reports. New cards go in `layout` too, or they won\'t appear. Secrets are never written: use ${NAME}.',
      async run({ ops }) {
        try {
          const t = await trial(ops);
          // the first new integration, really fetched: the person sees the card before agreeing to it
          const added = (ops as Op[]).find(o => o.op === 'set' && o.path[0] === 'integrations' && o.path.length === 2);
          const inst = added && t.instances.get(String(added.path[1]));
          const w = inst && Object.values(inst.widgets)[0];
          let card, fetchError: string | undefined;
          if (w && !t.missing.length) { try { card = await w.fetch(); } catch (e) { fetchError = (e as Error).message; } }
          // what the card really shows, so a wrong path is caught here and not on the page
          const change: Card = { type: 'code', title: 'What changes', diff: true, lines: diff(t.before, t.after).split('\n') };
          return { data: { diff: diff(t.before, t.after), problems: t.problems, fetchError, cardShows: card ? JSON.stringify(card).slice(0, 900) : undefined, needsInEnv: t.missing, widgets: inst ? Object.keys(inst.widgets) : undefined }, card: card ? { type: 'group', layout: 'column', cards: [card, change] } : change };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
    config_apply: {
      label: 'Changed the config', access: 'control', input: edits,
      description: 'Save edits you already previewed, once the problems list is empty. The page updates by itself. Asks the person first.',
      async run({ ops }) {
        try {
          const t = await trial(ops);
          if (t.missing.length) return { data: { error: `add ${t.missing.join(', ')} to .env and recreate the container first` } };
          if (t.problems.length) return { data: { error: 'not saved', problems: t.problems } };
          try { await writeFile(path, t.after); }
          catch { return { data: { error: 'the config folder is read-only to Atrium, so nothing was saved; give the person this to paste in', diff: diff(t.before, t.after) } }; }
          return { data: { saved: true } };
        } catch (e) { return { data: { error: (e as Error).message } }; }
      },
    },
  };
}
