// Editing config.yaml as a person would: only the bytes an edit needs change, so comments, spacing and the order of
// everything else stay as they were. The assistant's config tools (setup.ts) and the page's editor (layout.ts) both write
// through here, and nothing here reads or writes a file, so the in-browser demo uses it too.
import { Document, isMap, isScalar, isSeq, parseDocument, stringify, visit, YAMLMap, YAMLSeq } from 'yaml';
import { z } from 'zod';

export const Op = z.object({
  op: z.enum(['set', 'append', 'remove']).describe('set a value, append to a list, or remove'),
  path: z.array(z.union([z.string(), z.number()])).min(1).describe('where, e.g. ["integrations", "kuma"] or ["layout", 2, "widgets"]'),
  value: z.unknown().optional(),
});
export type Op = z.infer<typeof Op>;

const YAML = { lineWidth: 0, flowCollectionPadding: false };
// `{ a: 1 }` or `{a: 1}`: whichever the file already uses
// and a file that lists short entries one to a line (`- { widget: a, size: large }`) gets new ones written that way too
const style = (text: string) => ({ ...YAML, flowCollectionPadding: (text.match(/[{[] \S/g)?.length ?? 0) > (text.match(/[{[][^\s}\]]/g)?.length ?? 0), short: /^\s*- \{/m.test(text) });
let house: typeof YAML & { short?: boolean } = YAML;
const flow = (v: unknown) => stringify(v, { ...house, collectionStyle: 'flow' }).trim();
/** Short list entries (a few plain values) on one line each, when that's the file's way. */
const tidy = (d: Document) => {
  if (house.short) visit(d, { Seq(_, seq) { for (const it of seq.items) if (isMap(it) && it.items.length <= 4 && it.items.every(p => isScalar(p.value))) it.flow = true; } });
  return d.toString(house);
};
const write = (v: unknown) => tidy(new Document(v));
const indented = (yaml: string, pad: string) => yaml.trimEnd().split('\n').map(l => l ? pad + l : l).join('\n') + '\n';
const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
/** Lines written where a node started. A list item's first key shares the line with its `- `, so that stays in front and
 *  the lines after line up under the key, not under the dash. */
const lead = (start: string, yaml: string) => start + indented(yaml, ' '.repeat(start.length)).slice(start.length);
/** The indentation of a key, for a new one beside it: a list item's `- ` is the item's, not the key's. */
const blank = (s: string) => s.replace(/\S/g, ' ');
/** Where a new line goes after a block collection: past the end of its last line, trailing comment included. */
const after = (text: string, end: number) => { if (text[end - 1] === '\n') return end; const nl = text.indexOf('\n', end); return nl < 0 ? text.length : nl + 1; };

/** Change just the bytes an edit needs, so a person's spacing and comments stay exactly as they were. Returns null for
 *  the shapes this doesn't cover. */
function splice(text: string, o: Op): string | null {
  const doc = parseDocument(text);
  // a parent that isn't there yet is created by the slow path below; falling back to the top would write the key in the wrong place
  const parent = o.path.length === 1 ? doc.contents : doc.getIn(o.path.slice(0, -1), true), target = doc.getIn(o.path, true) as any;
  if (!parent) return null;
  const put = (at: number, s: string) => text.slice(0, at) + s + text.slice(at);
  if (o.op === 'set' && target?.range && !(target.items && !target.flow)) return text.slice(0, target.range[0]) + flow(o.value) + text.slice(target.range[1]);
  // a whole block replaced: its lines and nothing else, so the file around it and the diff stay readable
  if (o.op === 'set' && target?.range && target.items?.length && !target.flow) {
    const start = lineStart(text, target.range[0]);
    return text.slice(0, start) + lead(text.slice(start, target.range[0]), write(o.value)) + text.slice(after(text, target.range[1]));
  }
  if (o.op === 'set' && target == null && isMap(parent) && !parent.flow && parent.items.length) {
    const first = (parent.items[0].key as any).range[0], pad = blank(text.slice(lineStart(text, first), first));
    return put(after(text, parent.range![1]), indented(write({ [o.path.at(-1)!]: o.value }), pad));
  }
  if (o.op === 'append' && isSeq(target)) {
    if (target.flow) return put(target.range![1] - 1, `${target.items.length ? ', ' : ''}${flow(o.value)}`);
    if (!target.items.length) return null;
    const pad = text.slice(lineStart(text, target.range![0])).match(/^\s*/)![0];
    return put(after(text, target.range![1]), indented(`- ${write(o.value).trimEnd().replace(/\n/g, '\n  ')}`, pad));
  }
  return null;
}

/** When an edit isn't one `splice` knows, the edited document is printed again, but only the one entry it touched:
 *  the deepest key or list item, under a block parent, that holds the change. The rest of the file keeps its bytes. */
function reprint(text: string, edited: Document, path: (string | number)[]): string | null {
  const old = parseDocument(text);
  const render = (node: any, seq: boolean) => {
    if (!seq && node.key && typeof node.key === 'object') node.key.commentBefore = undefined;   // the lines above stay where they are, so it would print twice
    const d = new Document(); d.contents = seq ? new YAMLSeq() : new YAMLMap(); (d.contents as any).items.push(node);
    return tidy(d);
  };
  for (let i = path.length; i >= 1; i--) {
    const up = path.slice(0, i - 1), key = path[i - 1];
    const was: any = i === 1 ? old.contents : old.getIn(up, true), now: any = i === 1 ? edited.contents : edited.getIn(up, true);
    if (!was || !now || was.flow || now.flow) continue;
    if (isMap(was) && isMap(now)) {
      const find = (m: any) => m.items.find((p: any) => String(p.key?.value ?? p.key) === String(key));
      const a = find(was), b = find(now);
      if (!a && !b) continue;
      if (!a) {
        if (!was.items.length) continue;
        const first = (was.items[0].key as any).range[0], pad = blank(text.slice(lineStart(text, first), first)), at = after(text, was.range![1]);
        return text.slice(0, at) + indented(render(b, false), pad) + text.slice(at);
      }
      const start = lineStart(text, a.key.range[0]), pad = text.slice(start, a.key.range[0]), end = after(text, (a.value?.range ?? a.key.range)[1]);
      if (b) return text.slice(0, start) + lead(pad, render(b, false)) + text.slice(end);
      if (pad.trim()) {   // the first key of a list item: the next key moves up beside the dash, or the item goes whole
        if (was.items.length < 2) continue;
        return text.slice(0, a.key.range[0]) + text.slice(end).replace(/^ +/, '');
      }
      return text.slice(0, start) + text.slice(end);
    }
    if (isSeq(was) && isSeq(now) && typeof key === 'number' && was.items[key] && i === path.length && now.items.length === was.items.length - 1) {
      const item: any = was.items[key];   // one entry out of a list: its lines go, and only those
      return text.slice(0, lineStart(text, item.range[0])) + text.slice(after(text, item.range[1]));
    }
    if (isSeq(was) && isSeq(now) && typeof key === 'number' && was.items[key] && now.items[key] && was.items.length === now.items.length) {
      const item: any = was.items[key], start = lineStart(text, item.range[0]), pad = text.slice(start).match(/^\s*/)![0];
      return text.slice(0, start) + indented(render(now.items[key], true), pad) + text.slice(after(text, item.range[1]));
    }
  }
  return null;
}

/** The edits applied to the file's text. Comments and order survive, and so does every line the edit doesn't touch. */
export function applyOps(text: string, ops: Op[]): string {
  let out = text;
  house = style(text);
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
    out = reprint(out, doc, o.path) ?? doc.toString(house);
  }
  return out;
}

/** Added and removed lines, in the shape people expect of a diff: each change with a line either side of it, and what
 *  didn't change between two changes folded to `…`. */
export function diff(a: string, b: string) {
  const x = a.split('\n'), y = b.split('\n');
  let start = 0; while (start < x.length && x[start] === y[start]) start++;
  let end = 0; while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  const xs = x.slice(start, x.length - end), ys = y.slice(start, y.length - end), n = xs.length, m = ys.length;
  if (n * m > 4e6) return [...xs.map(l => `- ${l}`), ...ys.map(l => `+ ${l}`)].join('\n');   // too big to line up: the whole middle
  // the longest run of lines both share, so what moved and what stayed are told apart
  const lcs = new Uint32Array((n + 1) * (m + 1)), at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[at(i, j)] = xs[i] === ys[j] ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)]);
  const walk: [' ' | '-' | '+', string][] = [];
  let i = 0, j = 0, gone: string[] = [], come: string[] = [];
  const flush = () => { walk.push(...gone.map(l => ['-', l] as ['-', string]), ...come.map(l => ['+', l] as ['+', string])); gone = []; come = []; };
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) { flush(); walk.push([' ', xs[i]]); i++; j++; }
    else if (j < m && (i === n || lcs[at(i, j + 1)] >= lcs[at(i + 1, j)])) come.push(ys[j++]);
    else gone.push(xs[i++]);
  }
  flush();
  const near = (k: number) => walk[k - 1]?.[0] !== ' ' && k > 0 || walk[k + 1]?.[0] !== ' ' && k < walk.length - 1;
  const out: string[] = [];
  walk.forEach(([t, l], k) => { if (t !== ' ') out.push(`${t} ${l}`); else if (near(k)) out.push(`  ${l}`); else if (out.at(-1) !== '  …') out.push('  …'); });
  if (start > 0 && out.length) out.unshift(`  ${x[start - 1]}`);
  if (end > 0 && out.length) out.push(`  ${x[x.length - end]}`);
  return out.join('\n');
}
