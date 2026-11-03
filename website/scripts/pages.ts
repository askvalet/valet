// Writes the pages that come from the code: one per integration, one per card type, the configuration reference, the
// sidebar. Run after `npm run shots`. Nothing here is typed by hand, so nothing here can fall out of step.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(root, '..');
for (const f of ['.cache/catalog.json', 'public/shots/manifest.json']) if (!existsSync(resolve(root, f))) { console.error(`${f} is missing: run npm run shots first`); process.exit(1); }
const catalog = JSON.parse(readFileSync(resolve(root, '.cache/catalog.json'), 'utf8')), manifest = JSON.parse(readFileSync(resolve(root, 'public/shots/manifest.json'), 'utf8'));
const load = async (f: string, name: string, fallback: any) => { try { return (await import(f))[name] ?? fallback; } catch { return fallback; } };
const ABOUT: Record<string, string> = await load('../samples/about.ts', 'ABOUT', {});
const NOTES: Record<string, string> = await load('../samples/notes.ts', 'NOTES', {});
const CARD_ABOUT: Record<string, string> = await load('../samples/about.ts', 'CARD_ABOUT', {});
const FORMAT: Record<string, string> = await load('../samples/formats.ts', 'FORMAT', {});

const docs = resolve(root, 'src/content/docs'), gen = resolve(root, 'src/generated');
for (const d of ['integrations', 'cards']) rmSync(join(docs, d), { recursive: true, force: true });
for (const d of ['integrations', 'cards', 'reference']) mkdirSync(join(docs, d), { recursive: true });
mkdirSync(gen, { recursive: true });

/** Text for MDX: code spans stay as they are, everything else can't open a tag or an expression. */
const md = (s: unknown) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/^(import|export)\b/, w => `&#${w.charCodeAt(0)};${w.slice(1)}`).split(/(`[^`]*`)/).map((p, i) => i % 2 ? p : p.replace(/\\/g, '\\\\').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`).replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('');
const cell = (s: unknown) => md(s).replace(/\|/g, '\\|');
const q = (s: string) => JSON.stringify(s);
const code = (v: unknown) => typeof v === 'string' ? `\`${v.replace(/`/g, "'")}\`` : `\`${JSON.stringify(v)}\``;
const firstSentence = (s = '') => { const m = /^.*?(?<!\be\.g|\bi\.e|\bvs)[.!?](?=\s|$)/s.exec(s); return (m?.[0] ?? s).trim(); };
// the wrapper lets a phone stack these rows: they're long, and a sideways scroll hides the words that matter
const table = (head: string[], rows: string[][]) => `<div class="opts">\n\n${[`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')}\n\n</div>`;
const page = (front: Record<string, unknown>, imports: string, body: string) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : JSON.stringify(v)}`).join('\n')}\n---\n${imports}\n\n${body.trim()}\n`;
const COMP = "import Sizes from '~/components/Sizes.astro';\nimport Shot from '~/components/Shot.astro';\nimport Row from '~/components/Row.astro';";
const hasShots = (base: string) => Object.values<any>(manifest).some(e => e.file && (e.id.startsWith(`${base}-`) || e.id === base));
const every = (ms?: number) => !ms ? '10 seconds' : ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : ms === 60_000 ? 'minute' : ms === 3_600_000 ? 'hour' : ms < 3_600_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 3_600_000)} hours`;
const ACCESS: Record<string, string> = { read: 'read', write: 'write', control: 'control' };
const AUTH: Record<string, string> = { none: 'None.', bearer: 'An API key, sent as a bearer token.', token: 'An API key, sent as `Authorization: Token`.', basic: 'A username and password.', header: 'An API key, sent in a header.', query: 'An API key, sent in the URL.', login: 'Signs in with the credentials below and keeps the session.', handshake: 'A session id the service hands out; a username and password if you set one.' };

function integrationPage(it: any) {
  const about = ABOUT[it.type] ?? it.about ?? `Shows ${it.name} on your homepage.`;
  const parts: string[] = [md(about)];
  const flagged = it.problems?.length || !it.widgets.some((w: any) => hasShots(`int/${it.type}/${w.key}`));
  if (flagged) parts.push(`:::caution[No screenshot]\nThis integration has no renderable sample, so nothing is shown here. ${md((it.problems ?? []).join(' '))}\n:::`);
  // options
  const yaml = stringify({ integrations: { [it.type]: { type: it.type, ...it.config } } }, { lineWidth: 0 });
  const first = it.widgets[0]?.key;
  parts.push(`## Set it up`);
  if (it.auth) parts.push(`**Sign-in:** ${AUTH[it.auth] ?? it.auth}${it.authOptional ? ' Optional: nothing is sent unless you set it.' : ''}`);
  parts.push(`\`\`\`yaml title="config.yaml"\n${yaml}${first ? `\nlayout:\n  - title: ${it.category.replace(/ .*/, '')}\n    widgets:\n      - ${it.type}.${first}\n` : ''}\`\`\``);
  if (it.options.length) parts.push(table(['Option', 'Type', 'Default', 'What it does'], it.options.map((o: any) => [`\`${o.name}\``, cell(o.type), o.required ? 'required' : o.default !== undefined ? code(o.default) : 'optional', cell([NOTES[`${it.type}.${o.name}`] ?? o.about, o.range && `Range ${o.range}.`].filter(Boolean).join(' '))])));
  if (it.note) parts.push(`:::note\n${md(it.note)}\n:::`);
  if (FORMAT[it.type]) parts.push(FORMAT[it.type]);
  // widgets
  if (it.widgets.length) {
    parts.push(`## Widgets`);
    parts.push(it.widgets.length === 1 ? `One widget. Its key is \`${it.type}.${first}\`, using the instance name from your config.` : `${it.widgets.length} widgets. Each key starts with your instance name, here \`${it.type}\`.`);
    for (const w of it.widgets) {
      const base = `int/${it.type}/${w.key}`, type = w.type;
      parts.push(`### ${md(w.title)}\n\n\`${it.type}.${w.key}\` · ${type ? `[${type}](/cards/${type}/) card · ` : ''}refreshes every ${every(w.interval)} while the page is open.`);
      if (w.cards.some((c: any) => c.state === 'normal')) parts.push(`<Sizes base=${q(base)} name=${q(`${it.name}, ${w.title}`)} />`);
      const others = w.cards.filter((c: any) => c.state !== 'normal');
      if (others.length) parts.push(`#### States\n\n<Row>\n${others.map((c: any) => `<Shot id=${q(`${base}-${c.state}`)} label=${q(c.label)} alt=${q(`${it.name} ${w.title}: ${c.label}`)} />`).join('\n')}\n</Row>`);
    }
  }
  // the assistant
  if (it.tools.length) {
    parts.push(`## Assistant tools\n\nWhat the assistant can use, once its [access level](/assistant/access/) allows it. Read tools run freely. Everything else asks first.`);
    parts.push(table(['Tool', 'Access', 'What it does'], it.tools.map((t: any) => [`\`${t.name}\``, ACCESS[t.access] ?? t.access, cell(firstSentence(t.about))])));
  }
  if (it.actions.length) parts.push(`## Actions\n\nWhat the page's own buttons and controls can do. They need a [signed-in person or a trusted network](/start/sign-in/).\n\n${table(['Action', 'What it does'], it.actions.map((a: any) => [`\`${a.name}\``, cell(firstSentence(a.about))]))}`);
  if (it.recap?.length) {
    parts.push(`## Year in review\n\nSlides this integration adds to the [recap](/concepts/recap/).`);
    parts.push(`<Row wide>\n${it.recap.map((s: any, i: number) => `<Shot id=${q(`int/${it.type}/recap-${i}`)} label=${q(`${s.kicker} ${s.value}${s.unit ? ` ${s.unit}` : ''}`)} alt=${q(`Recap slide: ${s.kicker} ${s.value} ${s.unit ?? ''}. ${s.line}`)} />`).join('\n')}\n</Row>`);
  }
  return page({ title: it.name, description: firstSentence(about).replace(/`/g, '') }, COMP, parts.join('\n\n'));
}
for (const it of catalog.integrations) writeFileSync(join(docs, 'integrations', `${it.type}.mdx`), integrationPage(it));

// the icons on the index, small: the same dashboard-icons Valet shows
const iconDir = resolve(root, 'public/shots/icons'); mkdirSync(iconDir, { recursive: true });
let sharp: any; try { sharp = (await import('sharp')).default; } catch { /* the page does without */ }
const { LOGO } = await import('../../src/server/core.ts');
// Valet's own building blocks have no brand, so they get a drawn tile: the same glyph the app uses for them
const GLYPH: Record<string, string> = {
  aimonitor: 'Cpu', api: 'Braces', atsumeru: 'BookOpen', calendar: 'CalendarDays', camera: 'Cctv', clock: 'Clock', coinmarketcap: 'Bitcoin',
  host: 'Server', http: 'Activity', iframe: 'AppWindow', links: 'Link', lobsters: 'Newspaper', markets: 'ChartLine', opendtu: 'SunMedium',
  'rgb-control': 'Lightbulb', rss: 'Rss', todo: 'ListChecks', weather: 'CloudSun',
};
const glyph = async (name: string) => {
  const [{ createElement }, { renderToStaticMarkup }, lucide] = await Promise.all([import('react'), import('react-dom/server'), import('lucide-react')]);
  const Icon = (lucide as any)[name]; if (!Icon) return null;
  const inner = renderToStaticMarkup(createElement(Icon, { size: 40, color: '#f5f5f7', strokeWidth: 1.9, x: 16, y: 16 }));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="16" fill="#3a3f4b"/>${inner}</svg>`);
};
mkdirSync(resolve(root, '.cache/icons'), { recursive: true });
/** How bright a logo is where it's drawn: the average of the pixels that aren't see-through, or null for a full square. */
const ink = async (file: string) => {
  const { data, info } = await sharp(file).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) { const a = data[i + 3] / 255; if (a < .5) continue; sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; n++; }
  return n > 40 && n < 48 * 48 * .97 ? sum / n : null;
};
const logos: Record<string, boolean> = {};
for (const it of catalog.integrations) {
  const slug = LOGO[it.type] ?? it.icon.replace('/api/icon/', ''), cached = join(root, '.cache/icons', `${slug}.png`);
  let src = [join(repo, 'demo/icons', `${slug}.png`), cached].find(existsSync);
  if (!src && !GLYPH[it.type]) {   // the same icon set Valet uses, fetched once
    const r = await fetch(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`).catch(() => null);
    if (r?.ok) { writeFileSync(cached, Buffer.from(await r.arrayBuffer())); src = cached; }
  }
  if (!sharp) continue;
  const drawn = !src && GLYPH[it.type] ? await glyph(GLYPH[it.type]) : null;
  if (src || drawn) {
    let img = sharp(src ?? drawn).resize(72, 72, { fit: 'inside' });
    // a black logo (GitHub, Ollama) disappears on the dark theme, so it sits on a light tile, which reads in both;
    // and a white one on the light theme, so that one gets a dark tile
    const lum = src ? await ink(src) : null, tile = lum == null ? null : lum < 55 ? '#f4f4f5' : lum > 215 ? '#3a3f4b' : null;
    if (src && tile) img = sharp({ create: { width: 72, height: 72, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="16" fill="${tile}"/></svg>`) }, { input: await sharp(src).resize(50, 50, { fit: 'inside' }).png().toBuffer() }]);
    await img.webp({ quality: 80 }).toFile(join(iconDir, `${it.type}.webp`)); logos[it.type] = true;
  }
  else console.log(`no icon for ${it.type}`);
}

const byCategory = catalog.categories.map((c: string) => [c, catalog.integrations.filter((i: any) => i.category === c)]).filter(([, l]: any) => l.length);
const stray = catalog.integrations.filter((i: any) => !catalog.categories.includes(i.category));
if (stray.length) throw new Error(`no category for: ${stray.map((i: any) => i.type).join(', ')}`);
const counts = { integrations: catalog.integrations.length, widgets: catalog.integrations.reduce((n: number, i: any) => n + i.widgets.length, 0), tools: catalog.integrations.reduce((n: number, i: any) => n + i.tools.length, 0) };
writeFileSync(join(docs, 'integrations/index.mdx'), page({ title: 'Integrations', description: `All ${counts.integrations} integrations: what each shows, how to set it up, and what the assistant can do with it.` }, "import Grid from '~/components/IntegrationGrid.astro';", `
Valet has ${counts.integrations} integrations, with ${counts.widgets} widgets and ${counts.tools} assistant tools between them. Every page here is generated from the code. Every screenshot is the real card, drawn from made-up data.

Use the search box to find one. If yours isn't here, [\`api\`](/integrations/api/) turns any JSON API into a card from YAML, and [writing an integration](/build/) is usually about ten lines.

${byCategory.map(([c, l]: any) => `## ${c}\n\n<Grid items={${JSON.stringify(l.map((i: any) => ({ type: i.type, name: i.name, logo: !!logos[i.type] })))}} />`).join('\n\n')}

## Not supported

${table(['What', 'Why'], catalog.unsupported.map((u: any) => [cell(u.what), cell(u.why)]))}
`));
writeFileSync(join(gen, 'sidebar.json'), JSON.stringify(byCategory.map(([c, l]: any) => ({ label: c, collapsed: true, items: l.map((i: any) => ({ label: i.name, link: `/integrations/${i.type}/` })) }))));

// card pages: the catalog's own interfaces, read from src/shared/cards.ts
const src = readFileSync(join(repo, 'src/shared/cards.ts'), 'utf8');
function fieldsOf(body: string) {
  const out: { name: string; type: string; optional: boolean; about?: string }[] = [];
  for (const line of body.split('\n')) {
    const cm = line.indexOf(' //'), comment = cm >= 0 ? line.slice(cm + 3).trim() : undefined, text = (cm >= 0 ? line.slice(0, cm) : line).trim();
    let depth = 0, cur = ''; const parts: string[] = [];
    for (const c of text) { if ('{([<'.includes(c)) depth++; if ('})]>'.includes(c) && !(c === '>' && cur.endsWith('='))) depth--; if (c === ';' && !depth) { parts.push(cur); cur = ''; } else cur += c; }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) { const m = /^\s*(\w+)(\?)?:\s*(.+?)\s*$/s.exec(p); if (m) out.push({ name: m[1], optional: !!m[2], type: m[3], about: parts.length === 1 ? comment : undefined }); }
  }
  return out;
}
const interfaces: Record<string, { extend: string[]; fields: ReturnType<typeof fieldsOf>; note?: string; doc?: string }> = {};
for (const m of src.matchAll(/(?:\/\*\*((?:(?!\*\/)[^])*)\*\/\n)?(?:export )?interface (\w+)(?: extends ([\w, ]+))? \{(.*)$/gm)) {
  const [, doc, name, ext, rest] = m;
  let body = rest, note: string | undefined;
  if (/^\s*$/.test(rest)) { const at = m.index! + m[0].length, end = src.indexOf('\n}', at); body = src.slice(at, end); note = /^\}[^\n]*?\/\/(.*)$/.exec(src.slice(end + 1).split('\n')[0])?.[1]?.trim(); }
  else { let depth = 1, i = 0; for (; i < rest.length && depth; i++) { if (rest[i] === '{') depth++; if (rest[i] === '}') depth--; } body = rest.slice(0, i - 1); note = /\/\/(.*)$/.exec(rest.slice(i))?.[1]?.trim(); }
  interfaces[name] = { extend: (ext ?? '').split(',').map(s => s.trim()).filter(Boolean), fields: fieldsOf(body), note, doc: doc?.trim().replace(/^\s*\*\s?/gm, '') };
}
const fieldTable = (fields: ReturnType<typeof fieldsOf>) => table(['Field', 'Type', 'What it does'], fields.map(f => [`\`${f.name}${f.optional ? '?' : ''}\``, `\`${f.type.replace(/\|/g, '\\|').replace(/`/g, '')}\``, cell(f.about ?? '')]));
const cardTypes = Object.entries(interfaces).flatMap(([name, i]) => { const t = i.fields.find(f => f.name === 'type' && /^'/.test(f.type)); return t ? [{ name, type: t.type.replace(/'/g, ''), i }] : []; });
const referenced = (fields: ReturnType<typeof fieldsOf>, seen = new Set<string>()) => { for (const f of fields) for (const m of f.type.matchAll(/\b([A-Z]\w+)\b/g)) if (interfaces[m[1]] && !['Card', 'Summary', 'Activity', 'Banner', 'Mark', 'RecapSlide'].includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); referenced(interfaces[m[1]].fields, seen); } return seen; };
const slugOf = (n: string) => `card/${n.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
const shotsOf = (g: any) => { const b = slugOf(g.name); return `<Sizes base=${q(b)} name=${q(g.name)} chat light ring />`; };
const TITLE = (t: string) => t === 'kv' ? 'Key-value' : t[0].toUpperCase() + t.slice(1);
const FACE: Record<string, string> = { shelf: 'shelf · poster' };
const faceOf = (type: string) => { const all = catalog.gallery.filter((g: any) => g.card.type === type && !g.name.startsWith('tile')); return (all.find((g: any) => g.name === (FACE[type] ?? type)) ?? all[0] ?? { name: type }).name; };
const tiles = catalog.gallery.filter((g: any) => g.name.startsWith('tile'));
const usedBy = (type: string) => catalog.integrations.filter((i: any) => i.widgets.some((w: any) => w.type === type));
for (const c of cardTypes) {
  const samples = catalog.gallery.filter((g: any) => g.card.type === c.type && !g.name.startsWith('tile'));
  const users = usedBy(c.type), extra = [...referenced(c.i.fields)];
  const about = CARD_ABOUT[c.type] ?? c.i.doc ?? c.i.note ?? `The ${c.type} card.`;
  const parts = [md(about), `## Variations\n\n${samples.length} sample${samples.length === 1 ? '' : 's'}, each at every size that draws differently, then in chat, in the light theme, and as a ring where it has a headline.`];
  for (const g of samples) parts.push(`### ${md(g.name)}\n\n${shotsOf(g)}`);
  parts.push(`## Fields\n\nEvery card also takes the [fields all cards share](/cards/#fields-all-cards-share).\n\n${fieldTable(c.i.fields)}`);
  if (c.i.note) parts.push(md(c.i.note));
  for (const x of extra) parts.push(`### ${x}\n\n${interfaces[x].doc ? `${md(interfaces[x].doc)}\n\n` : ''}${fieldTable(interfaces[x].fields)}${interfaces[x].note ? `\n\n${md(interfaces[x].note)}` : ''}`);
  if (users.length) parts.push(`## Used by\n\n${users.map((u: any) => `[${md(u.name)}](/integrations/${u.type}/)`).join(' · ')}`);
  writeFileSync(join(docs, 'cards', `${c.type}.mdx`), page({ title: `${TITLE(c.type)} card`, description: firstSentence(about).replace(/`/g, '') }, COMP, parts.join('\n\n')));
}
writeFileSync(join(docs, 'cards/tile.mdx'), page({ title: 'Tiles and rings', description: 'The headline any card can carry, drawn as a tile, a ring or a row of bars.' }, COMP, `
Any card can carry a \`summary\`, or several in \`summaries\`. That's what the small and wide sizes show, and what the \`tiles\` and \`rings\` section displays and the menubar use. Integrations write a good summary; the layout chooses how it's shown.

## Variations

${tiles.map((g: any) => `### ${md(g.name)}\n\n${shotsOf(g)}`).join('\n\n')}

## Fields

${fieldTable(interfaces.Summary.fields)}

### Mark

${md(interfaces.Mark.doc ?? '')}

${fieldTable(interfaces.Mark.fields)}
`));
writeFileSync(join(docs, 'cards/index.mdx'), page({ title: 'Card gallery', description: 'Every card type Valet can draw, with every layout and variation.' }, "import Grid from '~/components/CardGrid.astro';", `
Integrations return plain data in these shapes and the page draws them. A new kind of display is one new card type, and then every integration and the assistant can use it. See [cards](/concepts/cards/) for the idea.

Everything here is the real renderer, drawn from \`src/web/samples.ts\`, the same samples the tests check.

<Grid items={${JSON.stringify([...cardTypes.map(c => ({ type: c.type, title: TITLE(c.type), id: slugOf(faceOf(c.type)) })), { type: 'tile', title: 'Tiles and rings', id: slugOf(tiles[0]?.name ?? '') }])}} />

## Fields all cards share

${fieldTable(interfaces.Base.fields)}

### Banner

${md(interfaces.Banner.doc ?? '')}

${fieldTable(interfaces.Banner.fields)}

### Activity

${md(interfaces.Activity.doc ?? '')}

${fieldTable(interfaces.Activity.fields)}
`));
writeFileSync(join(gen, 'cards.json'), JSON.stringify([{ label: 'Card gallery', link: '/cards/' }, { label: 'Tiles and rings', link: '/cards/tile/' }, ...cardTypes.map(c => ({ label: TITLE(c.type), link: `/cards/${c.type}/` }))]));

// the configuration reference: every key in the schema, in the order config.ts has them
const SECTIONS: [string, string[], string][] = [
  ['Page', ['title', 'greeting', 'notice', 'location', 'timezone', 'weather', 'calendar', 'search', 'recap', 'welcome', 'reload', 'sandbox', 'links'], 'The top level of `config.yaml`.'],
  ['Appearance', ['appearance'], 'Look and feel. Every option becomes a CSS variable or a class, so a change shows without a rebuild. Left out, it sets nothing and the stylesheet\'s own value stands.'],
  ['Hero', ['hero'], 'The top of the overview.'], ['Chat', ['chat'], 'The assistant\'s window on the page. What it knows and may do is under `assistant`.'],
  ['Nav', ['nav'], 'The tab buttons.'], ['Menubar', ['menubar'], 'The rings in the top bar. A plain list of widget keys works too.'], ['Live', ['live'], 'Rings in the top bar for what\'s happening.'],
  ['Format', ['format'], 'How things are written. `auto` follows the browser.'], ['Labels', ['labels'], 'The words on the page. `{name}`, `{year}`, `{n}` and `{scope}` fill in.'],
  ['Notify', ['notify'], 'Where "tell me when" reminders go when you\'re not looking.'], ['Auth', ['auth', 'allowedHosts'], 'Sign-in, and the names Valet answers to. See [sign-in and network safety](/start/sign-in/).'],
  ['History', ['history'], 'Each widget\'s headline numbers over time, so tiles can show a graph. Set to `false` to turn it off.'], ['Plugins', ['plugins'], 'Community integrations. A plain list of npm packages works too. See [the plugin toolkit](/build/plugins/).'],
  ['Assistant', ['assistant'], 'Left out, there is no assistant and the page loses nothing. See [models](/assistant/models/).'], ['MCP', ['mcp'], 'MCP servers the assistant may use. See [MCP](/assistant/mcp/).'], ['MCP server', ['mcpServer'], 'Valet as a read-only MCP server for an AI client you use. See [MCP](/assistant/mcp/#valet-as-an-mcp-server).'],
  ['Layout', ['layout'], 'The sections of the page, in order. See [sections and layout](/concepts/layout/).'], ['Integrations', ['integrations'], 'One block per instance. The options depend on `type`: see [integrations](/integrations/).'],
];
const placed = new Set(SECTIONS.flatMap(s => s[1]));
const lost = catalog.config.filter((r: any) => !placed.has(r.top));
if (lost.length) throw new Error(`config options with no section: ${lost.map((r: any) => r.path).join(', ')}`);
const about = (r: any) => NOTES[r.path] ?? r.about ?? (r.path.startsWith('labels.') ? `Default: "${catalog.labels[r.path.slice(7)]}"` : '');
const row = (r: any) => [`\`${r.path}\``, cell(r.type), r.required ? 'required' : r.default !== undefined ? cell(code(r.default)) : 'optional', cell([about(r), r.range && `Range ${r.range}.`].filter(Boolean).join(' '))];
const missing = catalog.config.filter((r: any) => !about(r));
writeFileSync(join(docs, 'reference/configuration.mdx'), page({ title: 'Configuration reference', description: 'Every option in config.yaml, with its default. Generated from the schema.', tableOfContents: { maxHeadingLevel: 2 } }, '', `
Every option in \`config.yaml\`, generated from the schema in \`src/server/config.ts\`, so it can't drift. Unknown keys are errors, and Valet names the closest match. \`\${NAME}\` anywhere is replaced from the environment: see [secrets](/security/secrets/).

${SECTIONS.map(([title, tops, intro]) => `## ${title}\n\n${intro}\n\n${table(['Option', 'Type', 'Default', 'What it does'], catalog.config.filter((r: any) => tops.includes(r.top)).map(row))}`).join('\n\n')}
`));
writeFileSync(join(gen, 'counts.json'), JSON.stringify({ ...counts, cards: cardTypes.length, options: catalog.config.length, pictures: Object.values<any>(manifest).filter(e => e.file).length }));
console.log(`pages: ${catalog.integrations.length} integrations, ${cardTypes.length + 2} card pages, ${catalog.config.length} options${missing.length ? ` (${missing.length} with no description)` : ''}`);
if (missing.length) console.log(`  undescribed: ${missing.slice(0, 120).map((r: any) => r.path).join(' ')}`);
