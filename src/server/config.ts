// config.yaml: one file, readable top to bottom. `${NAME}` anywhere is replaced from the environment (or a file,
// for Docker secrets: see `substitute`), so secrets never sit in the file. Unknown keys are errors, with the path.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { STARTER } from './starter.ts';

/** an IANA name Node knows, e.g. America/Toronto */
export function validZone(tz: string) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }

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
  // questions offered on an empty chat and in ⌘K
  // what it does on its own: a morning brief, and spotting a shared cause when several things break at once. These get
  // no tools, so they can only say something. perDay caps the model calls they make.
  background: z.object({ watch: z.boolean().default(true), brief: z.boolean().default(true), perDay: z.number().int().min(1).max(500).default(24) }).default({ watch: true, brief: true, perDay: 24 }),
  suggestions: z.array(z.string()).default(['Is anything down?', 'How are my downloads doing?', "What's playing on Plex?", 'Show me the GPU and Plex side by side']),
}).strict();

/** a duration: seconds as a number, or "30s" / "5m" / "2h" / "1d"; comes out in milliseconds */
export const Every = z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?\s*[smhd]?$/, 'a duration like 30s, 5m or 1h')])
  .transform(v => {
    if (typeof v === 'number') return v * 1000;
    const n = Number.parseFloat(v), unit = v.trim().slice(-1) as 's' | 'm' | 'h' | 'd';
    return n * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit] ?? 1e3);
  });

const Section = z.object({
  title: z.string().optional(),
  // "instance.widget", or { widget, size } to pick a size: small (its headline as a tile), medium (the card),
  // large (the card across two columns, with room for more)
  // `every` overrides how often it refreshes while someone's looking: seconds, or "30s", "5m", "1h"
  widgets: z.array(z.union([z.string(), z.object({ widget: z.string(), size: z.enum(['small', 'medium', 'large']).default('medium'), every: Every.optional() })]))
    .transform(ws => ws.map(w => typeof w === 'string' ? { widget: w, size: 'medium' as const } : w)),
  columns: z.number().int().min(1).max(4).optional(),
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
  tab: z.string().optional(),             // which tab in the rail it belongs to (default: its title); sections can share one
  chat: z.boolean().default(false),       // its tab also holds the assistant, full page
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

// Look and feel. A wallpaper turns every card into frosted glass over it.
export const Appearance = z.object({
  wallpaper: z.string().optional(),        // local file path (served by Atrium) or an image URL
  dim: z.number().min(0).max(0.9).default(0.35),
  blur: z.number().min(0).max(40).default(0),
}).strict();

export const Auth = z.object({
  // like other dashboards, no sign-in by default: keep it on a private network/VPN or behind your proxy's auth.
  // local: built-in accounts · proxy: trust the user header from an auth proxy (Authelia, Authentik…) · none
  mode: z.enum(['none', 'local', 'proxy', 'oidc']).default('none'),
  sessionDays: z.number().int().min(1).max(365).default(30),   // how long "keep me signed in" lasts
  secureCookie: z.boolean().default(true),                     // false only when serving over plain http
  // with mode: none, Atrium is read-only (no buttons, no assistant tools that add or change things) unless you say the
  // network itself is the lock, e.g. it's only reachable over your VPN/tailnet or behind a sign-in proxy
  trustNetwork: z.boolean().default(false),
  // mode: oidc. Register Atrium at your provider with the redirect URL https://<atrium>/api/auth/oidc/callback
  oidc: z.object({
    issuer: z.string().url(),                                  // e.g. https://auth.example.com (it must serve /.well-known/openid-configuration)
    clientId: z.string(),
    clientSecret: z.string(),
    name: z.string().default('SSO'),                           // on the sign-in button
    claim: z.string().default('preferred_username'),           // which claim is the person's name here
    scope: z.string().default('openid profile email'),
    allow: z.array(z.string()).default([]),                    // only these names or emails may sign in (empty: anyone the provider lets through)
    redirectUrl: z.string().url().optional(),                  // if Atrium can't tell its own address (an odd proxy setup)
  }).optional(),
  proxy: z.object({
    header: z.string().default('Remote-User'),                 // the header your proxy puts the signed-in user in
    trusted: z.array(z.string()).default(['127.0.0.1']),       // proxy addresses whose header is believed
  }).default({ header: 'Remote-User', trusted: ['127.0.0.1'] }),
}).default({ mode: 'none', sessionDays: 30, secureCookie: true, trustNetwork: false, proxy: { header: 'Remote-User', trusted: ['127.0.0.1'] } })
  .refine(a => a.mode !== 'oidc' || a.oidc, { message: 'auth.oidc (issuer, clientId, clientSecret) is needed for mode: oidc', path: ['oidc'] });

export const Config = z.object({
  auth: Auth,
  // the names Atrium answers to besides localhost and IP addresses, e.g. [atrium.example.com, "*.home.example.com"].
  // Anything else is refused, so a web page elsewhere can't reach it through your browser (DNS rebinding).
  allowedHosts: z.array(z.string()).default([]),
  // community integrations: npm packages to load (files in data/integrations/ load on their own);
  // `replace` lets a plugin take over a built-in type
  plugins: z.union([z.array(z.string()), z.object({ packages: z.array(z.string()).default([]), replace: z.array(z.string()).default([]) })])
    .default([]).transform(p => Array.isArray(p) ? { packages: p, replace: [] as string[] } : p),
  // remember each widget's headline numbers so tiles can show a graph even for services that only report "now".
  // `background` keeps sampling while nobody has the page open (one quiet request per widget per `every` minutes).
  history: z.union([z.literal(false), z.object({
    hours: z.number().min(1).max(168).default(24),
    every: z.number().min(1).max(60).default(5),            // minutes between samples
    background: z.boolean().default(true),
  })]).default({ hours: 24, every: 5, background: true }),
  title: z.string().default('Home'),
  greeting: z.string().optional(),         // name to greet, e.g. "Sam"
  location: z.string().optional(),
  timezone: z.string().refine(validZone, 'an IANA time zone, like America/Toronto').optional(),   // default: TZ, or else the first browser's
  appearance: Appearance.default({ dim: 0.35, blur: 0 }),
  assistant: AssistantConfig.optional(),
  integrations: z.record(z.string(), z.object({ type: z.string() }).loose()).default({}),
  mcp: z.record(z.string(), McpServer).default({}),
  layout: z.array(Section).default([]),
  menubar: z.array(z.string()).default([]),     // widget keys whose headline numbers sit as small rings in the top bar
  nav: z.object({ side: z.enum(['left', 'right', 'top', 'bottom']).default('left') }).default({ side: 'left' }),   // where the tab buttons sit (wide screens; phones always bottom)
  // the island: a black notch at the top that comes alive with whatever's happening (plays, downloads, a robot
  // cleaning), in this order of importance. idle: keep a small empty notch, or hide it when nothing's live.
  island: z.object({
    activities: z.array(z.string()).default([]), idle: z.enum(['hide', 'notch']).default('hide'),
    // short notices when things change, e.g. { widget: downloads.active, on: end, text: "{title} finished" }:
    // start/end of a widget's live activity, a service going down/up (status cards). {title}, {name} fill in.
    notify: z.array(z.object({ widget: z.string(), on: z.enum(['start', 'end', 'down', 'up']), text: z.string().optional() })).default([]),
  }).optional(),
  weather: z.string().optional(),               // a widget key (e.g. weather.now) shown as a ring beside the clock
  // web search from ⌘K: a provider name, or a URL with {q} for the words
  search: z.union([z.enum(['duckduckgo', 'google', 'kagi', 'brave', 'startpage', 'searxng']), z.string().url()]).optional(),
  // links on the page, grouped: `links.<group>` is a widget key, e.g. links: { Media: [{ name: Plex, url: https://… }] }
  links: z.record(z.string(), z.array(z.object({ name: z.string(), url: z.string().url(), icon: z.string().optional(), note: z.string().optional() }))).default({}),
  welcome: z.boolean().default(false),          // the getting-started card (a fresh config turns it on)
  reload: z.boolean().default(true),            // watch config.yaml and apply edits live (a bad edit keeps the last good one)
}).strict();
export type Config = z.infer<typeof Config>;

/** every value a ${…} was replaced with: Atrium redacts these from anything it sends out */
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

export function parseConfig(yaml: string): Config {
  const raw = substitute(parse(yaml) ?? {});
  const r = Config.safeParse(raw);
  if (!r.success) throw new Error('config.yaml:\n' + r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  return r.data;
}
