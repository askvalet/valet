// config.yaml: one file, readable top to bottom. `${NAME}` anywhere is replaced from the environment, so secrets
// can live in .env / docker secrets instead of the file. Unknown keys are errors, with the path in the message.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

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
}).strict();

const Section = z.object({
  title: z.string().optional(),
  // "instance.widget", or { widget, size } to pick a size: small (its headline as a tile), medium (the card),
  // large (the card across two columns, with room for more)
  widgets: z.array(z.union([z.string(), z.object({ widget: z.string(), size: z.enum(['small', 'medium', 'large']).default('medium') })]))
    .transform(ws => ws.map(w => typeof w === 'string' ? { widget: w, size: 'medium' as const } : w)),
  columns: z.number().int().min(1).max(4).optional(),
  // tiles: headline tiles with live graphs · rings: the same as ring gauges coloured by health · cards: full cards
  // media: every item of the section's media cards (streams, downloads…) as artwork tiles in one grid
  display: z.enum(['cards', 'tiles', 'rings', 'media']).default('cards'),
  // left / right: a sidebar beside the rest of the page (on wide screens), e.g. services as a tall list.
  // `columns` then sets how many columns its list uses.
  place: z.enum(['main', 'left', 'right']).default('main'),
  overview: z.boolean().default(true),    // false: only on its own tab in the rail, not on the overview
  variant: z.enum(['full', 'minimal']).default('full'),
  header: z.boolean().default(true),      // false: the cards in this section drop their title bar (on the overview)
  heading: z.boolean().default(true),     // false: no section title above it on the page (it still names the tab)
  tab: z.string().optional(),             // which tab in the rail it belongs to (default: its title); sections can share one
  chat: z.boolean().default(false),       // its tab also holds the assistant, full page   // minimal: smaller rows, just the essentials (e.g. services: icon, name, dot)
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
  mode: z.enum(['none', 'local', 'proxy']).default('none'),
  sessionDays: z.number().int().min(1).max(365).default(30),   // how long "keep me signed in" lasts
  secureCookie: z.boolean().default(true),                     // false only when serving over plain http
  proxy: z.object({
    header: z.string().default('Remote-User'),                 // the header your proxy puts the signed-in user in
    trusted: z.array(z.string()).default(['127.0.0.1']),       // proxy addresses whose header is believed
  }).default({ header: 'Remote-User', trusted: ['127.0.0.1'] }),
}).default({ mode: 'none', sessionDays: 30, secureCookie: true, proxy: { header: 'Remote-User', trusted: ['127.0.0.1'] } });

export const Config = z.object({
  auth: Auth,
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
  greeting: z.string().optional(),         // name to greet, e.g. "Ibrahim"
  location: z.string().optional(),
  appearance: Appearance.default({ dim: 0.35, blur: 0 }),
  assistant: AssistantConfig.optional(),
  integrations: z.record(z.string(), z.object({ type: z.string() }).loose()).default({}),
  mcp: z.record(z.string(), McpServer).default({}),
  layout: z.array(Section).default([]),
  menubar: z.array(z.string()).default([]),
  nav: z.object({ side: z.enum(['left', 'right', 'top', 'bottom']).default('left') }).default({ side: 'left' }),   // where the tab buttons sit (wide screens; phones always bottom)
  // the island: a black notch at the top that comes alive with whatever's happening (plays, downloads, a robot
  // cleaning), in this order of importance. idle: keep a small empty notch, or hide it when nothing's live.
  island: z.object({
    activities: z.array(z.string()).default([]), idle: z.enum(['hide', 'notch']).default('hide'),
    // short notices when things change, e.g. { widget: downloads.active, on: end, text: "{title} finished" }:
    // start/end of a widget's live activity, a service going down/up (status cards). {title}, {name} fill in.
    notify: z.array(z.object({ widget: z.string(), on: z.enum(['start', 'end', 'down', 'up']), text: z.string().optional() })).default([]),
  }).optional(),
  weather: z.string().optional(),               // a widget key (e.g. weather.now) shown as a ring beside the clock   // widget keys whose headline numbers sit as small rings in the top bar
}).strict();
export type Config = z.infer<typeof Config>;

function substitute(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    if (process.env[k] === undefined) throw new Error(`config: environment variable ${k} is not set`);
    return process.env[k]!;
  });
  if (Array.isArray(v)) return v.map(substitute);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x)]));
  return v;
}

export function loadConfig(path: string): Config {
  const raw = substitute(parse(readFileSync(path, 'utf8')) ?? {});
  const r = Config.safeParse(raw);
  if (!r.success) throw new Error('config.yaml:\n' + r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  return r.data;
}
