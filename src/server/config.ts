// config.yaml: one file, readable top to bottom. `${NAME}` anywhere is replaced from the environment (or a file,
// for Docker secrets: see `substitute`), so secrets never sit in the file. Unknown keys are errors, with the path.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { LABELS } from '../shared/labels.ts';
import { isPaint } from '../shared/look.ts';
import { Channel } from './notify.ts';
import { STARTER } from './starter.ts';

/** an IANA name Node knows, e.g. America/Toronto */
export function validZone(tz: string) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }

const validLocale = (l: string) => { try { new Intl.Locale(l); return true; } catch { return false; } };

const Access = z.enum(['none', 'read', 'write', 'control']);   // write: may add things (save a link, file a doc) without asking

export const AssistantConfig = z.object({
  // any OpenAI-compatible server (Ollama, llama.cpp, vLLM, OpenRouter, OpenAI…) or Anthropic
  provider: z.enum(['openai-compatible', 'anthropic']).default('openai-compatible'),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string(),
  name: z.string().default('Assistant'),
  instructions: z.string().optional(),     // extra system prompt
  // what the assistant may use: a default plus per-integration overrides, e.g. { default: read, lights: control }
  access: z.record(z.string(), Access).default({ default: 'read' }),
  maxSteps: z.number().int().min(1).max(20).default(6),
  // hand the chat to another agent (Hermes, say): anything with an OpenAI-compatible API. It runs its own tools, so
  // Valet's access levels and approvals don't apply to it, and a read-only page stays on Valet's own assistant.
  agent: z.object({ name: z.string(), baseURL: z.string().url(), apiKey: z.string().optional(), model: z.string() }).strict().optional(),
  // what it does on its own: a morning brief, and spotting a shared cause when several things break at once. These get
  // no tools, so they can only say something. perDay caps the model calls they make.
  background: z.object({ watch: z.boolean().default(true), brief: z.boolean().default(true), suggest: z.boolean().default(true), perDay: z.number().int().min(1).max(500).default(100) }).default({ watch: true, brief: true, suggest: true, perDay: 100 }),
  // questions offered on an empty chat and in ⌘K
  suggestions: z.array(z.string()).default(['Is anything down?', 'How are my downloads doing?', "What's playing on Plex?", 'Show me the GPU and Plex side by side']),
}).strict();

/** a duration: seconds as a number, or "30s" / "5m" / "2h" / "1d"; comes out in milliseconds */
export const Every = z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?\s*[smhd]?$/, 'a duration like 30s, 5m or 1h')])
  .transform(v => {
    if (typeof v === 'number') return v * 1000;
    const n = Number.parseFloat(v), unit = v.trim().slice(-1) as 's' | 'm' | 'h' | 'd';
    return n * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit] ?? 1e3);
  });

// Values that end up in CSS. Each is one value of one property, set through setProperty, and none may reach outside it.
const unsafeCss = /[;{}<>\\@]|\/\*|url\(|expression\(|javascript:/i;
const Color = z.string().regex(/^#[0-9a-f]{3,8}$|^[a-z]+$|^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\)$/i, 'a colour, like #0a84ff, rgb(10 132 255) or tomato')
  .refine(v => !unsafeCss.test(v), 'a colour, with nothing else in it');
const Gradient = z.string().regex(/^(repeating-)?(linear|radial|conic)-gradient\(.+\)$/i).refine(v => !unsafeCss.test(v));
/** a size: pixels as a number, or "90%", "40rem", "80vw", "70dvh" */
const Length = z.union([z.number().min(0).max(4000), z.string().regex(/^\d+(\.\d+)?(px|rem|em|%|vw|vh|dvw|dvh)$/, 'a size, like 480, 40rem or 80vw')])
  .transform(v => typeof v === 'number' ? `${v}px` : v);
/** a family, or a fallback list, as CSS writes them */
const Family = z.string().regex(/^[\w\s,"'-]+$/, 'a font name, like Inter, or a list: "Inter, sans-serif"');
const Scale = z.number().min(.6).max(2);       // relative to the usual size: 1.2 is a fifth bigger
const CARD_SIZES = ['small', 'wide', 'medium', 'tall', 'large'] as const;
const Columns = z.number().int().min(1).max(6);

const Section = z.object({
  title: z.string().optional(),
  // "instance.widget", or { widget, size } to pick a size: small (its headline as a tile), wide (that tile at twice the
  // width), medium (the card), tall (the card over two rows), large (the card across two columns, with room for more)
  // `every` overrides how often it refreshes while someone's looking: seconds, or "30s", "5m", "1h"
  // title, icon, header: false, and for its surface tint, opacity 0..1, blur in px, background (an image URL)
  tabColumns: z.number().int().min(1).max(6).optional(),   // columns on its own tab, when that should differ from the overview
  widgets: z.array(z.union([z.string(), z.object({
    widget: z.string(), size: z.enum(CARD_SIZES).default('medium'), every: Every.optional(),
    title: z.string().optional(), icon: z.string().optional(), header: z.boolean().optional(),
    tint: Color.optional(), opacity: z.number().min(0).max(1).optional(), blur: z.number().min(0).max(80).optional(),
    background: z.string().regex(/^(https:\/\/|\/api\/)[^\s"'()<>\\]+$/, 'an image URL: https://… or /api/icon/name').optional(),
  }).strict()]))
    .transform(ws => ws.map(w => typeof w === 'string' ? { widget: w, size: 'medium' as const } : w)),
  // a number (from tablet width up), or per screen: { phone: 1, tablet: 2, desktop: 3 }
  columns: z.union([z.number().int().min(1).max(4), z.object({ phone: Columns.optional(), tablet: Columns.optional(), desktop: Columns.optional() }).strict()]).optional(),
  gap: z.number().min(0).max(64).optional(),   // px between its cards
  // tiles: headline tiles with live graphs · rings: the same as ring gauges coloured by health · cards: full cards
  // media: every item of the section's media cards (streams, downloads…) as artwork tiles in one grid
  display: z.enum(['cards', 'tiles', 'rings', 'media']).default('cards'),
  // left / right: a sidebar beside the rest of the page (on wide screens), e.g. services as a tall list.
  // `columns` then sets how many columns its list uses.
  place: z.enum(['main', 'left', 'right']).default('main'),
  overview: z.boolean().default(true),    // false: only on its own tab in the rail, not on the overview
  variant: z.enum(['full', 'minimal']).default('full'),    // minimal: smaller rows, just the essentials (e.g. services: icon, name, dot)
  header: z.boolean().default(true),      // false: the cards in this section drop their title bar (on the overview)
  heading: z.boolean().default(true),     // false: no section title above it on the page (it still names the tab)
  icon: z.string().optional(),            // its tab's icon, when the first card's isn't right
  tab: z.string().optional(),             // which tab in the rail it belongs to (default: its title); sections can share one
  chat: z.boolean().default(false),       // its tab also holds the assistant, full page
  favorites: z.array(z.string()).min(1).optional(),   // on the overview, a status card shows only these services (and whatever's down), with a link to the rest
}).strict();

// An MCP server whose tools the assistant may use. `access: read` offers only the tools the server marks read-only
// (plus any listed in readOnly); `control` offers all of them, and anything not read-only asks the person first.
export const McpServer = z.object({
  url: z.string().url(),
  transport: z.enum(['http', 'sse']).default('http'),
  headers: z.record(z.string(), z.string()).optional(),
  access: Access.default('read'),
  readOnly: z.array(z.string()).default([]),
  name: z.string().optional(),
}).strict();

// One wallpaper, however it's written: a file (served by Valet), an image URL, a colour or a gradient
const Wall = z.string().refine(v => !isPaint(v) || Color.safeParse(v).success || Gradient.safeParse(v).success, 'a file, an image URL, a colour or a gradient');
const Walls = z.union([Wall, z.array(Wall).min(1)]);    // a list takes turns: see `rotate`
const Font = z.string().refine(v => /^https?:\/\//.test(v) ? URL.canParse(v) : /\.(woff2?|ttf|otf)$/i.test(v), 'a stylesheet or font URL, or a local .woff2, .woff, .ttf or .otf file');

// Look and feel. Every option here becomes a CSS variable or a class on the page (src/shared/look.ts), so a change
// shows up without a rebuild; left out, it sets nothing and the stylesheet's own value stands.
export const Appearance = z.object({
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),   // auto: the system's, or dark glass over a wallpaper; the others also drop the switch
  colors: z.object({ accent: Color.optional(), good: Color.optional(), warn: Color.optional(), bad: Color.optional(), card: Color.optional() }).strict().optional(),
  font: z.object({
    family: Family.optional(),             // the UI's font, which must be installed or come from `url`
    url: Font.optional(),                  // a stylesheet (Google Fonts, Bunny Fonts), a font file, or a local font file served by Valet
    mono: Family.optional(),
    scale: z.number().min(.7).max(1.5).optional(),             // every size of text; 1 is as designed
    headingWeight: z.number().int().min(100).max(900).optional(),
  }).strict().refine(f => !f.url || f.family, { message: 'name the font the url provides in appearance.font.family', path: ['family'] }).optional(),
  shape: z.object({
    radius: z.number().min(0).max(40).optional(),              // px; everything rounded follows, and 0 squares off the pills too
    border: z.number().min(0).max(8).optional(),               // px around cards
    borderColor: Color.optional(),
    shadow: z.enum(['none', 'soft', 'deep']).optional(),
  }).strict().optional(),
  // the frost: how much of the card's tint shows (0..1), and how hard the page behind blurs in px. 0 turns blur off everywhere.
  glass: z.object({ opacity: z.number().min(0).max(1).optional(), blur: z.number().min(0).max(80).optional() }).strict().optional(),
  wallpaper: Walls.optional(),             // local file path (served by Valet), image URL, colour or gradient; any of them turns cards to glass
  wallpapers: z.record(z.string(), Walls).default({}),         // a different one per tab, by the tab's name
  rotate: Every.optional(),                // how long each wallpaper in a list stays
  dim: z.number().min(0).max(0.9).default(0.35),
  blur: z.number().min(0).max(40).default(0),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),   // scales all spacing at once
  gap: z.number().min(0).max(64).optional(),                   // px between cards
  sectionGap: z.number().min(0).max(120).optional(),           // px between sections
  maxWidth: Length.optional(),             // of the page: 1320px, or 1720px with a sidebar
  rowHeight: z.number().min(60).max(600).optional(),           // px, the least a row in a section with sizes takes; rows otherwise fit their tallest card
  // what the sizes mean, in a grid of 2, 4 or 6 columns as the screen widens: { tall: { rows: 3 }, large: { cols: 6 } }
  sizes: z.partialRecord(z.enum(CARD_SIZES), z.object({ cols: z.number().int().min(1).max(6).optional(), rows: z.number().int().min(1).max(6).optional() }).strict()).default({}),
  rim: z.number().min(0).max(1).optional(),   // a lit bevel on the edge of dark glass, 0 to 1; left out, or 0, there's none
  motion: z.enum(['full', 'reduced', 'none']).default('full'),   // reduced: nothing moves or settles in; none: not even fades. A system's reduce-motion always counts.
  css: z.string().optional(),              // your own CSS, loaded after everything else
  cssFile: z.string().regex(/\.css$/i, 'a path to a .css file').optional(),   // the same from a file; css comes after it
}).strict();

// The top of the overview.
export const Hero = z.object({
  greeting: z.union([z.boolean(), z.string()]).default(true),  // text replaces "Good evening, Sam"; {name} is `greeting`
  status: z.boolean().default(true),       // the sentence under it
  search: z.boolean().default(true),       // the ask box (the search box without an assistant)
  review: z.boolean().default(true),       // the year in review link; `recap` turns off the review itself
  align: z.enum(['center', 'left', 'right']).default('center'),
  // the ask box names what it can help with ("Ask about downloads, lights, what to watch…"): true works it out from the
  // integrations present; a list says it yourself
  scope: z.union([z.boolean(), z.array(z.string().min(1)).min(1).max(6)]).optional(),
}).strict();

// The assistant's window on the page. What it knows and may do is `assistant`; this is how it looks.
export const ChatView = z.object({
  open: z.enum(['center', 'right', 'left', 'bottom', 'page']).default('center'),   // phones always get the full sheet
  width: Length.optional(),
  height: Length.optional(),
  overview: z.boolean().default(true),     // false: no ask box or chips on the overview; it's a tab or button away
  placeholder: z.string().optional(),      // in the ask box; {name} is the assistant's name
  suggestions: z.enum(['ai', 'fixed', 'off']).default('ai'),   // ai: written for what's happening, no model calls with fixed (assistant.suggestions as they are) or off
  steps: z.boolean().default(true),        // the tool calls it made; approvals and result cards show either way
  thinking: z.enum(['collapsed', 'open', 'hidden']).default('collapsed'),
  send: z.enum(['enter', 'mod-enter']).default('enter'),       // mod-enter: ⌘/Ctrl+Enter sends and Enter starts a line
  bubble: Color.optional(),                // your messages
  beam: z.enum(['off', 'always', 'focus', 'thinking']).default('off'),   // a light travelling around the chat box: all the time, while typing, or while it answers
  beamColor: z.enum(['colorful', 'mono', 'ocean', 'sunset']).default('colorful'),
  beamStrength: z.number().min(0).max(1).default(.45),   // how bright: a hint by default
  icon: z.string().optional(),             // an icon name, or an image path or URL, on its buttons and header
}).strict();

// How things are written. auto follows the browser.
export const Format = z.object({
  clock: z.enum(['auto', '12h', '24h']).default('auto'),
  date: z.enum(['short', 'long', 'numeric', 'iso']).default('short'),   // Sat, Oct 31 · Saturday, October 31 · 10/31/2026 · 2026-10-31
  weekStart: z.enum(['auto', 'monday', 'sunday', 'saturday']).default('auto'),
  temperature: z.enum(['auto', 'c', 'f']).default('auto'),     // converts what services report; auto leaves it alone
  distance: z.enum(['auto', 'km', 'mi']).default('auto'),
  locale: z.string().refine(v => v === 'auto' || validLocale(v), 'a language tag, like en-GB or de-DE').default('auto'),   // sets numbers (1.234,5) and month names
}).strict();

export const Auth = z.object({
  // like other dashboards, no sign-in by default: keep it on a private network/VPN or behind your proxy's auth.
  // local: built-in accounts · proxy: trust the user header from an auth proxy (Authelia, Authentik…) · none
  mode: z.enum(['none', 'local', 'proxy', 'oidc']).default('none'),
  sessionDays: z.number().int().min(1).max(365).default(30),   // how long "keep me signed in" lasts
  secureCookie: z.boolean().default(true),                     // false only when serving over plain http
  // with mode: none, Valet is read-only (no buttons, no assistant tools that add or change things) unless you say the
  // network itself is the lock, e.g. it's only reachable over your VPN/tailnet or behind a sign-in proxy
  trustNetwork: z.boolean().default(false),
  // mode: oidc. Register Valet at your provider with the redirect URL https://<valet>/api/auth/oidc/callback
  oidc: z.object({
    issuer: z.string().url(),                                  // e.g. https://auth.example.com (it must serve /.well-known/openid-configuration)
    clientId: z.string(),
    clientSecret: z.string(),
    name: z.string().default('SSO'),                           // on the sign-in button
    claim: z.string().default('preferred_username'),           // which claim is the person's name here
    scope: z.string().default('openid profile email'),
    allow: z.array(z.string()).default([]),                    // only these names or emails may sign in (empty: anyone the provider lets through)
    redirectUrl: z.string().url().optional(),                  // if Valet can't tell its own address (an odd proxy setup)
  }).optional(),
  proxy: z.object({
    header: z.string().default('Remote-User'),                 // the header your proxy puts the signed-in user in
    trusted: z.array(z.string()).default(['127.0.0.1']),       // proxy addresses whose header is believed
  }).default({ header: 'Remote-User', trusted: ['127.0.0.1'] }),
}).default({ mode: 'none', sessionDays: 30, secureCookie: true, trustNetwork: false, proxy: { header: 'Remote-User', trusted: ['127.0.0.1'] } })
  .refine(a => a.mode !== 'oidc' || a.oidc, { message: 'auth.oidc (issuer, clientId, clientSecret) is needed for mode: oidc', path: ['oidc'] });

export const Config = z.object({
  auth: Auth,
  // the names Valet answers to besides localhost and IP addresses, e.g. [valet.example.com, "*.home.example.com"].
  // Anything else is refused, so a web page elsewhere can't reach it through your browser (DNS rebinding).
  allowedHosts: z.array(z.string()).default([]),
  // community integrations: npm packages to load (files in data/integrations/ load on their own);
  // `replace` lets a plugin take over a built-in type
  plugins: z.union([z.array(z.string()), z.object({ packages: z.array(z.string()).default([]), replace: z.array(z.string()).default([]) })])
    .default([]).transform(p => Array.isArray(p) ? { packages: p, replace: [] as string[] } : p),
  // remember each widget's headline numbers so tiles can show a graph even for services that only report "now".
  // `background` keeps sampling while nobody has the page open (one quiet request per widget per `every` minutes).
  history: z.union([z.literal(false), z.object({
    hours: z.number().min(1).max(336).default(72),
    every: z.number().min(1).max(60).default(5),            // minutes between samples
    background: z.boolean().default(true),
  })]).default({ hours: 72, every: 5, background: true }),
  title: z.string().default('Home'),
  greeting: z.string().optional(),         // name to greet, e.g. "Sam"
  notice: z.string().max(120).optional(),  // a quiet pill above the greeting, e.g. "Demo · simulated home"
  location: z.string().optional(),
  timezone: z.string().refine(validZone, 'an IANA time zone, like America/Toronto').optional(),   // default: TZ, or else the first browser's
  appearance: Appearance.prefault({}),
  hero: Hero.prefault({}),
  chat: ChatView.prefault({}),
  format: Format.prefault({}),
  // the words on the page, for another language or your own: { overview: Accueil, thinking: Réflexion }
  labels: z.object(Object.fromEntries(Object.keys(LABELS).map(k => [k, z.string().optional()])) as Record<keyof typeof LABELS, z.ZodOptional<z.ZodString>>).strict().prefault({}),
  assistant: AssistantConfig.optional(),
  integrations: z.record(z.string(), z.object({ type: z.string() }).loose()).default({}),
  mcp: z.record(z.string(), McpServer).default({}),
  layout: z.array(Section).default([]),
  // widget keys whose headline numbers sit as small rings in the top bar; or the object, to say more about the bar
  menubar: z.union([z.array(z.string()), z.object({
    widgets: z.array(z.string()).default([]),
    position: z.enum(['left', 'center', 'right']).default('right'),   // wide screens; below that it's centred
    labels: z.boolean().default(true),      // the words under the rings
    clock: z.boolean().default(true), date: z.boolean().default(true), theme: z.boolean().default(true),   // theme: the light/dark switch
    size: Scale.default(1),
  }).strict()]).prefault([]).transform(m => Array.isArray(m) ? { widgets: m, position: 'right' as const, labels: true, clock: true, date: true, theme: true, size: 1 } : m),
  nav: z.object({
    side: z.enum(['left', 'right', 'top', 'bottom']).default('left'),   // where the tab buttons sit (wide screens; phones always bottom)
    style: z.enum(['icons', 'labels', 'both']).default('icons'),        // wide screens; phones have room for icons
    hide: z.array(z.string()).default([]),   // tabs to leave out, by name; also Overview, and the assistant's name for its button
    order: z.array(z.string()).default([]),  // tabs in this order, by name; the rest follow in layout order
    size: Scale.default(1),
  }).strict().prefault({}),
  // the island: a black notch at the top that comes alive with whatever's happening (plays, downloads, a robot
  // cleaning), in this order of importance. idle: keep a small empty notch, or hide it when nothing's live.
  island: z.object({
    activities: z.array(z.string()).default([]), idle: z.enum(['hide', 'notch']).default('hide'),
    position: z.enum(['top', 'top-left', 'top-right', 'bottom']).default('top'),   // wide screens; a notch only hangs from the top
    label: z.boolean().default(true),       // false: artwork and progress only, until it's opened
    size: Scale.default(1),
    // short notices when things change, e.g. { widget: downloads.active, on: end, text: "{title} finished" }:
    // start/end of a widget's live activity, a service going down/up (status cards). {title}, {name} fill in.
    // push: true sends it to your notification channels as well
    notify: z.array(z.object({ widget: z.string(), on: z.enum(['start', 'end', 'down', 'up']), text: z.string().optional(), push: z.boolean().default(false) }).strict()).default([]),
  }).strict().optional(),
  weather: z.string().optional(),               // a widget key (e.g. weather.now) shown as a ring beside the clock
  calendar: z.string().optional(),              // a calendar widget (e.g. family.agenda) whose events appear when you hover the clock
  // web search from ⌘K: a provider name, or a URL with {q} for the words
  search: z.union([z.enum(['duckduckgo', 'google', 'kagi', 'brave', 'startpage', 'searxng']), z.string().url()]).optional(),
  // links on the page, grouped: `links.<group>` is a widget key, e.g. links: { Media: [{ name: Plex, url: https://… }] }
  links: z.record(z.string(), z.array(z.object({ name: z.string(), url: z.string().url(), icon: z.string().optional(), note: z.string().optional() }))).default({}),
  // where "tell me when" reminders go when you're not looking (ntfy, gotify, telegram, discord, slack, pushover, apprise,
  // webhook). insights: also push the assistant's shared-cause line.
  notify: z.object({ channels: z.array(Channel).default([]), insights: z.boolean().default(false) }).default({ channels: [], insights: false }),
  recap: z.boolean().default(true),             // the year in review
  welcome: z.boolean().default(false),          // the getting-started card (a fresh config turns it on)
  reload: z.boolean().default(true),            // watch config.yaml and apply edits live (a bad edit keeps the last good one)
}).strict();
export type Config = z.infer<typeof Config>;
export type Format = z.infer<typeof Format>;

/** every value a ${…} was replaced with: Valet redacts these from anything it sends out */
export const usedSecrets: string[] = [];
const readSecret = (path: string, what: string) => {
  try { return readFileSync(path, 'utf8').trim(); }
  catch { throw new Error(`config: ${what}: can't read ${path}`); }
};
/** `${NAME}` from the environment (or the file `NAME_FILE` points at, the Docker convention); `${secret:name}` from
 *  /run/secrets/name; `${file:/path}` from any file. `\${…}` is left alone. */
export function substitute(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/(\\?)\$\{(?:(secret|file):([^}]+)|([A-Z0-9_]+))\}/g, (m, esc, kind, arg, name) => {
    if (esc) return m.slice(1);
    let value: string;
    if (kind === 'secret') value = readSecret(`/run/secrets/${arg.trim()}`, m);
    else if (kind === 'file') value = readSecret(arg.trim(), m);
    else if (process.env[name] !== undefined) value = process.env[name]!;
    else if (process.env[`${name}_FILE`]) value = readSecret(process.env[`${name}_FILE`]!, m);
    else throw new Error(`config: environment variable ${name} is not set (nor ${name}_FILE)`);
    // a user name, an address or a port isn't a secret, and blanking one mangles real text ("sam" inside "samantha")
    if (kind || !/USER|LOGIN|URL|HOST|PORT|ADDR/.test(name)) usedSecrets.push(value);
    return value;
  });
  if (Array.isArray(v)) return v.map(substitute);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x)]));
  return v;
}

/** Startup: the config, or on a fresh install a starter one, written next to where it belongs if the folder allows
 *  (a read-only mount doesn't, and then it runs from memory and the welcome card says so). */
export function startConfig(path: string): { config: Config; saved: boolean } {
  if (existsSync(path)) return { config: loadConfig(path), saved: true };
  let saved = false;
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, STARTER, { flag: 'wx', mode: 0o600 }); saved = true; console.log(`config: no ${path} yet, wrote a starter one`); }
  catch { console.log(`config: no ${path}, and that folder can't be written: running a starter config from memory`); }
  return { config: parseConfig(STARTER), saved };
}

export function loadConfig(path: string): Config { return parseConfig(readFileSync(path, 'utf8')); }

/** The options at a path in the schema, reaching through defaults and unions, to say what a misspelt key should be. */
function optionsAt(path: PropertyKey[]) {
  const inner = (s: any): any[] => { const d = s?._zod?.def; return !d ? [] : d.type === 'union' ? d.options.flatMap(inner) : d.innerType || d.in ? inner(d.innerType ?? d.in) : [s]; };
  let at = inner(Config);
  for (const k of path) at = at.flatMap(s => { const d = s._zod.def; return inner(typeof k === 'number' ? d.element : d.shape?.[k] ?? d.valueType); });
  return [...new Set<string>(at.flatMap(s => Object.keys(s._zod.def.shape ?? {})))];
}
const distance = (a: string, b: string) => {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next; }
  return row[b.length];
};
/** A problem as a person would want it: an unknown key names what's closest, or what's there. */
function explain(i: z.core.$ZodIssue) {
  if (i.code !== 'unrecognized_keys') return i.message;
  const known = optionsAt(i.path);
  return i.keys.map(k => {
    const near = known.map(o => [o, distance(k.toLowerCase(), o.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0];
    return `unknown option "${k}"${near && near[1] <= Math.max(2, k.length / 3) ? ` (did you mean "${near[0]}"?)` : known.length ? ` (it takes: ${known.join(', ')})` : ''}`;
  }).join('; ');
}

export function parseConfig(yaml: string): Config {
  const raw = substitute(parse(yaml) ?? {});
  const r = Config.safeParse(raw);
  if (!r.success) throw new Error('config.yaml:\n' + r.error.issues.map(i => `  ${i.path.join('.')}: ${explain(i)}`).join('\n'));
  return r.data;
}
