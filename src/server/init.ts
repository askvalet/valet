// `node dist/server.js init`: a first config.yaml from what's running here. It asks a read-only Docker socket proxy which
// containers there are (discover.ts), gives each app Valet knows its few lines with `${NAME}` where a secret goes, lays
// them out by kind, and says which names .env needs. With nothing found it's the starter config. A secret's value is
// never asked for and never written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { flags } from './cli.ts';
import { makeContext, type Integration } from './core.ts';
import { discover } from './discover.ts';
import { STARTER } from './starter.ts';
import apps from '../integrations/services/apps.ts';
import downloads from '../integrations/services/downloads.ts';
import infra from '../integrations/services/infra.ts';
import media from '../integrations/services/media.ts';
import network from '../integrations/services/network.ts';

// which section a service lands in: a service()'s family, and the full integrations by name
const of = (name: string, types: string) => types.split(' ').map(t => [t, name] as const);
const FAMILY = new Map<string, string>([
  ...([[media, 'Media'], [downloads, 'Downloads'], [network, 'Network'], [infra, 'Infrastructure'], [apps, 'Apps']] as const).flatMap(([list, name]) => list.map(s => [s.type, name] as const)),
  ...of('Media', 'arr tautulli jellyfin emby navidrome audiobookshelf seerr immich romm komga kavita'), ...of('Downloads', 'qbittorrent indexers'), ...of('Network', 'pihole speedtest-tracker'),
  ...of('Infrastructure', 'glances uptimekuma scrutiny ollama aimonitor proxmox backrest healthchecks syncthing'), ...of('Home', 'homeassistant mealie tandoor'),
]);
const ORDER = ['Services', 'Media', 'Downloads', 'Network', 'Infrastructure', 'Home', 'Apps'];

/** The cards worth a place on a first page: what's happening now before what's in the library, two at most. */
const FIRST = ['streams', 'playing', 'active', 'overview', 'upcoming', 'status', 'recent'];
export const worth = (widgets: string[]) => { const best = FIRST.filter(w => widgets.includes(w)).slice(0, 2); return best.length ? best : widgets.slice(0, 1); };

/** every `${NAME}` in a config, with the first place it's used */
export function namesIn(v: unknown, at = '', out = new Map<string, string>()) {
  if (typeof v === 'string') { for (const m of v.matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!out.has(m[1])) out.set(m[1], at); }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) namesIn(x, at ? `${at}.${k}` : k, out);
  return out;
}

const HEAD = (via: string) => `# Valet. Written by \`init\` from the containers ${via} can see. Save this file and the page updates by itself;
# a mistake is reported and the last good version keeps running.
# Each \${NAME} is a secret: its value goes in .env, never in this file. Every option: docs/configuration.md.
# To check this file and every service in it: node dist/server.js doctor

title: Home
# greeting: Sam                   # "Sam's homelab"
welcome: true                     # the getting-started card. Delete this line when you're done with it.

# Without sign-in Valet only shows things. To use its controls, turn on sign-in, or say your network is private:
# auth: { mode: local }           # also: oidc, proxy
# auth: { mode: none, trustNetwork: true }
`;

export async function starting(registry: Record<string, Integration>, o: { docker?: string; fetch?: typeof fetch } = {}) {
  const { via, found } = await discover(registry, o.docker ? [{ type: 'docker', url: o.docker }] : [], { fetch: o.fetch, fresh: true });
  const added: string[] = [], left: { name: string; why: string }[] = [], bare: string[] = [];
  if (!via || !found.length) return { yaml: STARTER, via, added, left, bare, names: new Map<string, string>() };
  const integrations: Record<string, Record<string, unknown>> = {}, sections = new Map<string, Set<string>>(ORDER.map(s => [s, new Set<string>()]));
  const targets: { name: string; url: string }[] = [];
  for (const f of found) {
    const [[id, block]] = Object.entries(parse(f.yaml) as Record<string, Record<string, unknown>>);
    targets.push({ name: f.name, url: f.url });   // up or down needs no key, so the page says something before .env is filled
    // Sonarr and Radarr share one integration: what's coming up
    const key = block.type === 'arr' ? 'coming' : id, whole = block.type === 'arr' ? { ...integrations.coming, ...block } : block;
    const integration = registry[block.type as string], { type, ...rest } = whole;
    try {
      const parsed = integration.config.safeParse(rest);
      if (!parsed.success) { left.push({ name: f.name, why: parsed.error.issues[0].message }); continue; }
      const widgets = worth(Object.keys(integration.create(parsed.data, makeContext(key)).widgets));
      integrations[key] = whole; added.push(f.name);
      if (!widgets.length) bare.push(f.name);
      for (const w of widgets) sections.get(FAMILY.get(block.type as string) ?? 'Apps')!.add(`${key}.${w}`);
    } catch (e) { left.push({ name: f.name, why: (e as Error).message }); }
  }
  integrations.services = { type: 'http', targets };
  integrations.docker = { type: 'docker', url: via };
  sections.set('Services', new Set(['services.status', 'docker.containers']));
  const layout = [...sections].filter(([, w]) => w.size).map(([title, w]) => `  - title: ${title}\n    widgets: [${[...w].join(', ')}]`).join('\n');
  const yaml = `${HEAD(via)}\n${stringify({ integrations }, { lineWidth: 0 })}\nlinks:\n  Start:\n    - { name: Valet docs, url: https://askvalet.dev }\n\nlayout:\n${layout}\n  - title: Start\n    widgets: [links.start]\n`;
  return { yaml, via, added, left, bare, names: namesIn({ integrations }) };
}

const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('');

export async function initCommand(args: string[], path: string, registry: Record<string, Integration>, get?: typeof fetch) {
  const f = flags(args, ['force', 'print'], ['docker']), print = f.on.has('print');
  if (f.bad || f.rest.length) { console.error(`${f.bad ?? 'usage'}: init [--docker <socket proxy url>] [--print] [--force]`); return 1; }
  // the starter Valet wrote itself on first start holds nothing of anyone's, so it isn't an overwrite to replace it
  const there = existsSync(path), untouched = there && readFileSync(path, 'utf8') === STARTER;
  if (!print && there && !untouched && !f.on.has('force')) { console.error(`${path} is already there, and init won't write over it. --print shows what it would write; --force replaces the file.`); return 1; }
  const made = await starting(registry, { docker: f.given.docker, fetch: get });
  const say = print ? console.error : console.log;   // with --print, stdout is the file and nothing else
  if (print) console.log(made.yaml);
  else {
    try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, made.yaml, { mode: 0o600, flag: there ? 'w' : 'wx' }); }
    catch (e) { console.error(`${path} can't be written (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). --print shows the config instead.`); return 1; }
  }
  const wrote = print ? 'This is' : `Wrote ${path}:`;
  if (!made.via) say(`${wrote} the starter config, a page that needs no keys: no Docker socket proxy answered. --docker <url> says where yours is.`);
  else if (!made.added.length) say(`${wrote} the starter config: ${made.via} answered, and none of its containers is an app Valet knows.`);
  else say(`${wrote} ${list(made.added)}, found through ${made.via}.`);
  if (made.bare.length) say(`${list(made.bare)} ${made.bare.length > 1 ? 'have' : 'has'} no card until you say what to show (docs/services.md has each one's options).`);
  if (made.left.length) say(`Left for you to add (docs/services.md): ${made.left.map(l => `${l.name} (${l.why})`).join('; ')}.`);
  if (made.names.size) {
    const width = Math.max(...[...made.names.keys()].map(n => n.length));
    say(`\nPut these in .env, then restart Valet (it won't start until each has a value):\n${[...made.names].map(([n, at]) => `  ${`${n}=`.padEnd(width + 3)}# ${at}`).join('\n')}`);
  }
  say('\nTo check it and every service in it: node dist/server.js doctor');
  return 0;
}
