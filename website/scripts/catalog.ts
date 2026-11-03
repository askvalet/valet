// Runs every integration against made-up data, the way Valet would run it, and writes what it finds to .cache/catalog.json:
// its options, its widgets and each widget's cards, its tools and actions, its recap. Everything else on the site reads
// that file. It never opens config.yaml or .env and has no way to reach a real service: ctx.http here is a fake.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const here = resolve(process.env.VALET_DOCS_ROOT ?? '.'), repo = resolve(here, '..');
process.env.VALET_DATA = mkdtempSync(join(tmpdir(), 'valet-docs-'));   // the to-do list writes a file; never into data/
delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;

const { registry } = await import('../../src/integrations/index.ts');
const { fakeContext, sampleConfig } = await import('../../src/server/service-check.ts');
const { session } = await import('../../src/server/core.ts');
const { checkCard } = await import('../../src/shared/cards.schema.ts');
const { SAMPLES } = await import('../../src/web/samples.ts');
const { fixtures } = await import('../samples/index.ts');
const { CATEGORY, CATEGORIES, FAMILY_NAMES, UNSUPPORTED } = await import('../samples/categories.ts');
const { Config } = await import('../../src/server/config.ts');
const { LABELS } = await import('../../src/shared/labels.ts');
const media = (await import('../../src/integrations/services/media.ts')).default, downloads = (await import('../../src/integrations/services/downloads.ts')).default,
  network = (await import('../../src/integrations/services/network.ts')).default, infra = (await import('../../src/integrations/services/infra.ts')).default, apps = (await import('../../src/integrations/services/apps.ts')).default;
const familyOf: Record<string, string> = {};
for (const [name, list] of Object.entries({ media, downloads, network, infra, apps })) for (const s of list as any[]) familyOf[s.type] = name;

// Nothing goes to the network from here. Even a bug in a fixture can't touch a real address.
globalThis.fetch = (async (u: unknown) => { throw new Error(`refused: the catalog never uses the network (${String(u)})`); }) as typeof fetch;

/** Images in the catalog: drawn or from demo/art, never anywhere remote. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const SEEDED: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^(front|street|shed)$/, m => `/art/cameras/${{ front: 'driveway', street: 'street', shed: 'backyard' }[m[1]]}.jpg`],
  [/^e1$/, () => '/art/cameras/ev-person.jpg'],
  [/^(?:f|m|ph)(\d)$/, m => `/art/photos/${Number(m[1]) % 4}.jpg`],
  [/^d(\d)$/, m => `/art/docs/${Number(m[1]) % 8}.jpg`],
  [/^l$/, () => '/art/docs/1.jpg'],
  [/^cam$/, () => '/art/cameras/gate.jpg'],
];
const local = (url: string) => {
  const seed = /^https:\/\/picsum\.photos\/seed\/([^/]+)\//.exec(url)?.[1];
  if (seed) { for (const [re, to] of SEEDED) { const m = re.exec(seed); if (m) return to(m); } return `/img/${seed}`; }
  return `/img/${hash(url).toString(36)}`;
};
const PICTURE = /^(image|backdrop|poster|src|images|art|wall)$/;
function clean<T>(v: T, key = ''): T {
  if (typeof v === 'string') return (PICTURE.test(key) && /^https?:\/\//.test(v) ? local(v) : v) as T;
  if (Array.isArray(v)) return v.map(x => clean(x, key)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)])) as T;
  return v;
}

/** The test suite's fake context: a function in place of the network. */
function fake(answer: (url: string, init: any) => unknown, image: (r: string) => string, id: string) {
  return {
    id, log() {}, image, upload: async () => ({ name: 'f.txt', type: 'text/plain', data: Buffer.from('') }), session,
    async http(url: string, init: any = {}) {
      const out = await answer(url, init);
      if (out === undefined) throw new Error(`fixture has no answer for ${url}`);
      if (init.as === 'response') return out instanceof Response ? out : new Response(typeof out === 'string' ? out : JSON.stringify(out));
      if (out instanceof Response) { if (!out.ok) throw new Error(`${new URL(url).host} answered ${out.status}`); return init.as === 'text' ? out.text() : out.json(); }
      return out;
    },
  } as any;
}

// The comments beside the options are the best descriptions there are: they sit in the source next to the schema.
const SRC = resolve(repo, 'src/integrations');
const sources = [...readdirSync(SRC).filter(f => f.endsWith('.ts')).map(f => join(SRC, f)), ...readdirSync(join(SRC, 'services')).map(f => join(SRC, 'services', f))].map(f => ({ f, text: readFileSync(f, 'utf8') }));
const sourceOf = (type: string) => sources.find(s => s.text.includes(`type: '${type}'`))?.text ?? '';
function blockOf(type: string) {
  const text = sourceOf(type), at = text.indexOf(`type: '${type}'`);
  if (at < 0) return '';
  const rest = text.slice(at + 1), next = rest.search(/\n\s*(service\(\{|service<[^>]*>\(\{)|\n\s*type: '[a-z0-9-]+', name:/);
  return rest.slice(0, next < 0 ? undefined : next);
}
function commentFor(block: string, key: string) {
  const line = block.split('\n').find(l => new RegExp(`(^|[\\s{,])${key}: *z\\.`).test(l) && l.includes('//'));
  return line ? line.slice(line.lastIndexOf('//') + 2).trim() : undefined;
}

const COMMON: Record<string, string> = {
  url: 'Where the service answers, from Valet\'s side.', href: 'Where the card links to, when that differs from `url`.', every: 'How often to refresh while someone is looking: seconds, or `30s`, `5m`, `1h`.',
  insecure: 'Accept a self-signed certificate for this service only.', key: 'Its API key or token. Use `${VAR}`, so it stays out of the file.', username: 'The account to sign in with.', password: 'That account\'s password. Use `${VAR}`.',
};
const typeName = (s: any): string => {
  if (!s) return 'any';
  if (s.anyOf ?? s.oneOf) return (s.anyOf ?? s.oneOf).map(typeName).join(' or ');
  if (s.enum) return s.enum.map((v: unknown) => `\`${v}\``).join(', ');
  if (s.const !== undefined) return `\`${s.const}\``;
  if (s.type === 'array') return `list of ${typeName(s.items)}`;
  if (s.type === 'object') return s.additionalProperties && !s.properties ? `map of ${typeName(s.additionalProperties)}` : 'object';
  if (Array.isArray(s.type)) return s.type.join(' or ');
  return s.type === 'integer' ? 'whole number' : s.format === 'uri' ? 'URL' : s.type ?? 'any';
};
function optionsOf(schema: any, block: string, prefix = ''): any[] {
  return Object.entries<any>(schema.properties ?? {}).flatMap(([k, s]) => {
    const name = prefix + k;
    const nested = s.type === 'object' && s.properties ? s : s.type === 'array' && s.items?.type === 'object' && s.items.properties ? s.items : (s.anyOf ?? []).find((x: any) => x.type === 'object' && x.properties);
    const min = s.minimum, max = s.maximum;
    const self = { name, type: typeName(s), required: (schema.required ?? []).includes(k) && s.default === undefined, default: s.default, about: s.description ?? commentFor(block, k) ?? (prefix ? undefined : COMMON[k]), range: min !== undefined && max !== undefined ? `${min} to ${max}` : undefined };
    return [self, ...(nested ? optionsOf(nested, block, `${name}${s.type === 'array' ? '[].' : '.'}`) : [])];
  });
}

const envName = (type: string, k: string) => `${type.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_${k === 'key' ? 'KEY' : k.toUpperCase()}`;
const dressConfig = (type: string, c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k,
  k === 'url' && v === 'http://svc' ? `http://${type}:8080` : ['key', 'apiKey', 'token', 'password', 'secret'].includes(k) && typeof v === 'string' ? `\${${envName(type, k)}}` : k === 'username' ? `\${${envName(type, 'user')}}` : v]));
const checkOf = (card: unknown) => { const r = checkCard(card); return r.success ? undefined : r.error.issues.slice(0, 2).map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '); };

/** Polls as an open page would, on a pretend clock, so what a widget builds up over time (a graph's line) is there. */
async function warmUp(w: any, times = 0) {
  const real = Date.now, end = real();
  try { for (let i = times; i > 0; i--) { Date.now = () => end - i * 5000; await w.fetch().catch(() => {}); } }
  finally { Date.now = real; }
}

async function widgetsFrom(type: string, def: any, cfg: any, make: () => any, states: any[], problems: string[], warm = 0) {
  const inst = make(), out: any[] = [];
  for (const [key, w] of Object.entries<any>(inst.widgets ?? {})) {
    const entry: any = { key, title: w.title, interval: w.interval, cards: [] };
    await warmUp(w, warm);
    try { const card = await w.fetch(); const bad = checkOf(card); if (bad) problems.push(`${key}: its card isn't valid: ${bad}`); entry.cards.push({ state: 'normal', label: 'Normal', card: clean(card) }); }
    catch (e) { problems.push(`${key}: couldn't render from its sample: ${(e as Error).message}`); }
    for (const s of states.filter(s => (s.widget ?? key) === key)) {
      try {
        const stateful = s.make().widgets[key]; await warmUp(stateful, s.state === 'down' ? 0 : warm);
        const card = await stateful.fetch(), bad = checkOf(card);
        if (bad) problems.push(`${key} (${s.state}): its card isn't valid: ${bad}`);
        // a widget that never touches the network has no "can't reach it"; drawing its normal card under that name would be a lie
        if (s.state === 'down' && JSON.stringify(clean(card)) === JSON.stringify(entry.cards[0]?.card)) continue;
        entry.cards.push({ state: s.state, label: s.label, card: clean(card) });
      }
      catch (e) { if (s.state === 'down') entry.cards.push({ state: 'down', label: 'Can\'t reach it', error: (e as Error).message }); else problems.push(`${key} (${s.state}): ${(e as Error).message}`); }
    }
    if (entry.cards.length) entry.type = entry.cards[0].card?.type;
    out.push(entry);
  }
  return { widgets: out, inst };
}

const describe = (t: any) => { try { return z.toJSONSchema(t, { unrepresentable: 'any', io: 'input' }); } catch { return {}; } };
const toolsOf = (inst: any) => Object.entries<any>(inst.tools ?? {}).map(([name, t]) => ({ name, label: t.label, access: t.access, about: t.description, confirms: !!t.confirm, undo: t.undo, followUps: t.followUps, input: Object.keys((describe(t.input) as any).properties ?? {}) }));
const actionsOf = (inst: any) => Object.entries<any>(inst.actions ?? {}).map(([name, a]) => ({ name, about: a.description, input: Object.keys((describe(a.input) as any).properties ?? {}) }));
// ⌘K's commands: a list, or a function a few integrations answer from their service (the fake here); what fails lists none
const commandsOf = async (inst: any) => {
  try {
    const list = typeof inst.commands === 'function' ? await inst.commands() : inst.commands ?? [];
    return (list as any[]).map(c => ({ say: c.say, run: c.run, label: c.label, ...(typeof inst.commands === 'function' ? { made: true } : {}) }));
  } catch { return []; }
};
const recapOf = async (inst: any, problems: string[]) => {
  if (!inst.recap) return [];
  try { return clean(await inst.recap({ year: new Date().getFullYear(), from: Date.UTC(new Date().getFullYear(), 0, 1), to: Date.now() })); }
  catch (e) { problems.push(`recap: ${(e as Error).message}`); return []; }
};

// The configuration reference: every key in the schema, with the comment beside it in config.ts. The schema is the truth.
function configRows() {
  const text = readFileSync(resolve(repo, 'src/server/config.ts'), 'utf8') + '\n' + readFileSync(resolve(repo, 'src/server/notify.ts'), 'utf8');
  const lines = text.split('\n');
  const MARK: Record<string, string> = { appearance: 'export const Appearance', hero: 'export const Hero', chat: 'export const ChatView', format: 'export const Format', auth: 'export const Auth', assistant: 'export const AssistantConfig', layout: 'const Section', mcp: 'export const McpServer', notify: 'export const Config' };
  const blockFor = (top: string) => { const from = lines.findIndex(l => l.startsWith(MARK[top] ?? 'export const Config')), to = lines.findIndex((l, i) => i > from && (/^\}\)/.test(l) || /^export type Config/.test(l))); return lines.slice(from, to < 0 ? undefined : to + 1); };
  const commentAt = (block: string[], key: string) => {
    const at = block.findIndex(l => new RegExp(`(^|[\\s{,(])${key}: `).test(l));
    if (at < 0) return undefined;
    const line = block[at], same = line.lastIndexOf(' // ');
    if (same > 0 && line.indexOf(`${key}:`) < same) return line.slice(same + 4).trim();
    const above: string[] = [];
    for (let i = at - 1; i >= 0 && /^\s*\/\//.test(block[i]); i--) above.unshift(block[i].replace(/^\s*\/\/\s?/, ''));
    return above.length ? above.join(' ') : undefined;
  };
  const rows: any[] = [];
  const walk = (s: any, path: string, top: string, required: boolean) => {
    const variants = (s.anyOf ?? s.oneOf ?? []).filter((v: any) => v.type === 'object' && v.properties);
    const obj = s.type === 'object' && s.properties ? [s] : s.type === 'array' && s.items?.type === 'object' && s.items.properties ? [s.items] : variants.length ? variants : (s.anyOf ?? s.oneOf ?? []).filter((v: any) => v.type === 'array' && v.items?.properties).map((v: any) => v.items);
    if (s.type === 'array' && (s.items?.anyOf ?? s.items?.oneOf)?.some((v: any) => v.properties)) { const u = s.items.anyOf ?? s.items.oneOf; obj.push(...u.filter((v: any) => v.properties)); }
    const leaf = path.split(/[.[\]]+/).filter(Boolean).at(-1)!;
    if (path) rows.push({ path, top, type: typeName(s), required, default: s.default, range: s.minimum !== undefined && s.maximum !== undefined ? `${s.minimum} to ${s.maximum}` : undefined, about: s.description ?? commentAt(blockFor(top), leaf) });
    const open = s.type === 'array' && (s.items?.properties || s.items?.anyOf || s.items?.oneOf) || (s.anyOf ?? []).some((v: any) => v.type === 'array' && v.items?.properties);
    for (const o of obj) {
      const tag = o.properties.type?.const, base = tag ? `${path}[${tag}]` : open ? `${path}[]` : path;
      for (const [k, v] of Object.entries<any>(o.properties)) { if (tag && k === 'type') continue; walk(v, base ? `${base}.${k}` : k, top || k, (o.required ?? []).includes(k) && v.default === undefined); }
    }
    if (s.type === 'object' && s.additionalProperties?.properties) for (const [k, v] of Object.entries<any>(s.additionalProperties.properties)) walk(v, `${path}.<name>.${k}`, top, (s.additionalProperties.required ?? []).includes(k) && v.default === undefined);
  };
  walk(z.toJSONSchema(Config, { unrepresentable: 'any', io: 'input' }), '', '', false);
  return rows;
}

const catalog: any[] = [];
for (const [type, i] of Object.entries<any>(registry).sort(([a], [b]) => a.localeCompare(b))) {
  const def = i.def, problems: string[] = [], fx = fixtures[type], block = blockOf(type);
  const schema = describe(i.config);
  const base: any = { type, name: i.name, kind: def ? 'service' : 'integration', category: CATEGORY[type] ?? FAMILY_NAMES[familyOf[type]] ?? 'Other', icon: `/api/icon/${def?.logo ?? type}`, options: optionsOf(schema, block), about: def?.about, auth: def ? (typeof def.auth === 'object' ? Object.keys(def.auth)[0] : def.auth ?? 'none') : undefined, authOptional: def?.authOptional };
  try {
    if (def && !fx) {
      const parsed = i.config.parse(sampleConfig(def));
      const make = (status = 200) => i.create(parsed, fakeContext(def, status));
      const { widgets, inst } = await widgetsFrom(type, def, parsed, make, [{ state: 'down', label: 'Can\'t reach it', make: () => make(500) }], problems);
      // a list says so when it's empty: the same card with nothing in it, as toCard writes it
      for (const w of widgets) { const first = w.cards[0]?.card; if (first?.type === 'list') w.cards.splice(1, 0, { state: 'empty', label: 'Empty', card: { ...first, items: [] } }); }
      base.widgets = widgets; base.tools = toolsOf(inst); base.actions = actionsOf(inst); base.commands = await commandsOf(inst); base.recap = await recapOf(inst, problems);
      base.config = dressConfig(type, sampleConfig(def)); base.sample = 'service';
    } else if (fx) {
      const undo = await fx.before?.();
      const image = fx.image ?? ((r: string) => `/img/${hash(r).toString(36)}`);
      const parsed = i.config.parse(fx.config);
      const states = (fx.states ?? []).map((s: any) => ({ ...s, make: () => i.create(i.config.parse({ ...fx.config, ...s.config }), fake(s.http ?? fx.http ?? (() => { throw new Error('no fake network'); }), image, type)) }));
      const make = () => i.create(parsed, fake(fx.http ?? (() => { throw new Error('no fake network'); }), image, type));
      const { widgets, inst } = await widgetsFrom(type, def, parsed, make, [...states, ...(states.some((s: any) => s.state === 'down') ? [] : [{ state: 'down', label: 'Can\'t reach it', make: () => i.create(parsed, fake(() => new Response('nope', { status: 500 }), image, type)) }])], problems, fx.warm);
      base.widgets = widgets; base.tools = toolsOf(inst); base.actions = actionsOf(inst); base.commands = await commandsOf(inst); base.recap = await recapOf(inst, problems);
      base.config = dressConfig(type, fx.config); base.sample = 'fixture'; base.note = fx.note;
      if (typeof undo === 'function') undo();
    } else {
      // no sample: say so, and still document what can be read without running it
      problems.push('no sample yet');
      base.widgets = []; base.tools = []; base.actions = []; base.commands = []; base.recap = []; base.config = {}; base.sample = 'none';
      try { const inst = i.create(i.config.parse({}), fake(() => { throw new Error('no fake'); }, r => `/img/${r}`, type)); base.tools = toolsOf(inst); base.actions = actionsOf(inst); base.widgets = Object.entries<any>(inst.widgets ?? {}).map(([key, w]) => ({ key, title: w.title, interval: w.interval, cards: [] })); } catch {}
    }
  } catch (e) { problems.push(`it wouldn't start: ${(e as Error).message}`); base.widgets ??= []; base.tools ??= []; base.actions ??= []; base.commands ??= []; base.recap ??= []; base.config ??= {}; }
  base.problems = problems;
  catalog.push(base);
}

mkdirSync(join(here, '.cache'), { recursive: true });
const gallery = SAMPLES.map(({ name, card }: any) => ({ name, card: clean(card) }));
writeFileSync(join(here, '.cache/catalog.json'), JSON.stringify({ integrations: catalog, gallery, unsupported: UNSUPPORTED, categories: CATEGORIES, config: configRows(), labels: LABELS }));
const flagged = catalog.filter(c => c.problems.length);
console.log(`catalog: ${catalog.length} integrations, ${catalog.reduce((n, c) => n + c.widgets.length, 0)} widgets, ${catalog.reduce((n, c) => n + c.tools.length, 0)} tools, ${gallery.length} card samples`);
if (flagged.length) console.log(`flagged ${flagged.length}:\n${flagged.map(c => `  ${c.type}: ${c.problems.join(' · ')}`).join('\n')}`);
