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

const docs = resolve(root, 'src/content/docs'), gen = resolve(root, 'src/generated');
for (const d of ['integrations', 'cards']) rmSync(join(docs, d), { recursive: true, force: true });
for (const d of ['integrations', 'cards', 'reference']) mkdirSync(join(docs, d), { recursive: true });
mkdirSync(gen, { recursive: true });

/** Text for MDX: code spans stay as they are, everything else can't open a tag or an expression. */
const md = (s: unknown) => String(s ?? '').split(/(`[^`]*`)/).map((p, i) => i % 2 ? p : p.replace(/\\/g, '\\\\').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`).replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('');
const cell = (s: unknown) => md(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const q = (s: string) => JSON.stringify(s);
const code = (v: unknown) => typeof v === 'string' ? `\`${v.replace(/`/g, "'")}\`` : `\`${JSON.stringify(v)}\``;
const firstSentence = (s = '') => { const m = /^.*?[.!?](?=\s|$)/s.exec(s); return (m?.[0] ?? s).trim(); };
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const page = (front: Record<string, unknown>, imports: string, body: string) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : JSON.stringify(v)}`).join('\n')}\n---\n${imports}\n\n${body.trim()}\n`;
const COMP = "import Sizes from '~/components/Sizes.astro';\nimport Shot from '~/components/Shot.astro';\nimport Row from '~/components/Row.astro';";
const hasShots = (base: string) => Object.values<any>(manifest).some(e => e.file && (e.id.startsWith(`${base}-`) || e.id === base));
const every = (ms?: number) => !ms ? '10 seconds' : ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} minute${ms === 60_000 ? '' : 's'}` : `${Math.round(ms / 3_600_000)} hour${ms === 3_600_000 ? '' : 's'}`;
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
    parts.push(`## Assistant tools\n\nWhat the assistant can use, once its [access level](/assistant/access/) allows it. Read tools run freely. Control tools [ask first](/assistant/approvals/).`);
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
const logos: Record<string, boolean> = {};
for (const it of catalog.integrations) {
  const slug = it.icon.replace('/api/icon/', ''), src = [join(repo, 'demo/icons', `${slug}.png`), join(root, '.cache/icons', `${slug}.png`)].find(existsSync);
  if (src && sharp) { await sharp(src).resize(72, 72, { fit: 'inside' }).webp({ quality: 80 }).toFile(join(iconDir, `${it.type}.webp`)); logos[it.type] = true; }
}

const byCategory = catalog.categories.map((c: string) => [c, catalog.integrations.filter((i: any) => i.category === c)]).filter(([, l]: any) => l.length);
const stray = catalog.integrations.filter((i: any) => !catalog.categories.includes(i.category));
if (stray.length) throw new Error(`no category for: ${stray.map((i: any) => i.type).join(', ')}`);
const counts = { integrations: catalog.integrations.length, widgets: catalog.integrations.reduce((n: number, i: any) => n + i.widgets.length, 0), tools: catalog.integrations.reduce((n: number, i: any) => n + i.tools.length, 0) };
writeFileSync(join(docs, 'integrations/index.mdx'), page({ title: 'Integrations', description: `All ${counts.integrations} integrations: what each shows, how to set it up, and what the assistant can do with it.` }, "import Grid from '~/components/IntegrationGrid.astro';", `
Valet has ${counts.integrations} integrations, with ${counts.widgets} widgets and ${counts.tools} assistant tools between them. Every page here is generated from the code. Every screenshot is the real card, drawn from made-up data.

Use the search box to find one. If yours isn't here, [\`api\`](/integrations/api/) turns any JSON API into a card from YAML, and [writing an integration](/build/integrations/) is usually about ten lines.

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
for (const m of src.matchAll(/(?:\/\*\*([^]*?)\*\/\n)?(?:export )?interface (\w+)(?: extends ([\w, ]+))? \{(.*)$/gm)) {
  const [, doc, name, ext, rest] = m;
  let body = rest, note: string | undefined;
  if (/^\s*$/.test(rest)) { const at = m.index! + m[0].length, end = src.indexOf('\n}', at); body = src.slice(at, end); note = /^\}[^\n]*\/\/(.*)$/m.exec(src.slice(end + 1))?.[1]?.trim(); }
  else { let depth = 1, i = 0; for (; i < rest.length && depth; i++) { if (rest[i] === '{') depth++; if (rest[i] === '}') depth--; } body = rest.slice(0, i - 1); note = /\/\/(.*)$/.exec(rest.slice(i))?.[1]?.trim(); }
  interfaces[name] = { extend: (ext ?? '').split(',').map(s => s.trim()).filter(Boolean), fields: fieldsOf(body), note, doc: doc?.trim().replace(/^\s*\*\s?/gm, '') };
}
const fieldTable = (fields: ReturnType<typeof fieldsOf>) => table(['Field', 'Type', 'What it does'], fields.map(f => [`\`${f.name}${f.optional ? '?' : ''}\``, `\`${f.type.replace(/\|/g, '\\|').replace(/`/g, '')}\``, cell(f.about ?? '')]));
const cardTypes = Object.entries(interfaces).flatMap(([name, i]) => { const t = i.fields.find(f => f.name === 'type' && /^'/.test(f.type)); return t ? [{ name, type: t.type.replace(/'/g, ''), i }] : []; });
const referenced = (fields: ReturnType<typeof fieldsOf>, seen = new Set<string>()) => { for (const f of fields) for (const m of f.type.matchAll(/\b([A-Z]\w+)\b/g)) if (interfaces[m[1]] && !['Card', 'Summary', 'Activity', 'Banner', 'Mark', 'RecapSlide'].includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); referenced(interfaces[m[1]].fields, seen); } return seen; };
const slugOf = (n: string) => `card/${n.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
const shotsOf = (g: any) => { const b = slugOf(g.name); return `<Sizes base=${q(b)} name=${q(g.name)} chat light ring />`; };
const TITLE = (t: string) => t[0].toUpperCase() + t.slice(1);
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

<Grid items={${JSON.stringify([...cardTypes.map(c => ({ type: c.type, title: TITLE(c.type), id: `${slugOf((catalog.gallery.find((g: any) => g.card.type === c.type && !g.name.startsWith('tile')) ?? { name: c.type }).name)}` })), { type: 'tile', title: 'Tiles and rings', id: slugOf(tiles[0]?.name ?? '') }])}} />

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
  ['Page', ['title', 'greeting', 'notice', 'location', 'timezone', 'weather', 'calendar', 'search', 'recap', 'welcome', 'reload', 'links'], 'The top level of `config.yaml`.'],
  ['Appearance', ['appearance'], 'Look and feel. Every option becomes a CSS variable or a class, so a change shows without a rebuild. Left out, it sets nothing and the stylesheet\'s own value stands.'],
  ['Hero', ['hero'], 'The top of the overview.'], ['Chat', ['chat'], 'The assistant\'s window on the page. What it knows and may do is under `assistant`.'],
  ['Nav', ['nav'], 'The tab buttons.'], ['Menubar', ['menubar'], 'The rings in the top bar. A plain list of widget keys works too.'], ['Island', ['island'], 'The notch at the top that shows what\'s happening.'],
  ['Format', ['format'], 'How things are written. `auto` follows the browser.'], ['Labels', ['labels'], 'The words on the page. `{name}`, `{year}`, `{n}` and `{scope}` fill in.'],
  ['Notify', ['notify'], 'Where "tell me when" reminders go when you\'re not looking.'], ['Auth', ['auth', 'allowedHosts'], 'Sign-in, and the names Valet answers to. See [sign-in and network safety](/start/sign-in/).'],
  ['History', ['history'], 'Each widget\'s headline numbers over time, so tiles can show a graph. Set to `false` to turn it off.'], ['Plugins', ['plugins'], 'Community integrations. A plain list of npm packages works too. See [the plugin toolkit](/build/plugins/).'],
  ['Assistant', ['assistant'], 'Left out, there is no assistant and the page loses nothing. See [models](/assistant/models/).'], ['MCP', ['mcp'], 'MCP servers the assistant may use. See [MCP](/assistant/mcp/).'],
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
