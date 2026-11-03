// On a fresh install, what's already running on this machine: the containers a read-only Docker socket proxy can see,
// matched to Valet's integrations by image and name, each with the few lines of config it would take. Nothing is
// written here. The welcome card offers them, and the person (or the assistant, with their approval) adds them.
import { stringify } from 'yaml';
import { z } from 'zod';
import { iconFor, type Integration } from './core.ts';

export type Found = { type: string; name: string; icon: string; container: string; url: string; yaml: string };

// types that aren't a program you'd find in a container, or that every page has anyway
const NOT_APPS = new Set(['api', 'http', 'links', 'clock', 'iframe', 'rss', 'todo', 'markets', 'weather', 'calendar', 'host', 'sockets', 'releases', 'repository', 'hackernews', 'lobsters', 'reddit', 'twitch', 'camera', 'docker', 'aimonitor', 'rgbcontrol']);
// one integration for several apps
const ARR = new Set(['sonarr', 'radarr', 'lidarr', 'readarr']);
// the port people browse to, where a container offers several
const WEB = [80, 8080, 3000, 8000, 5000, 8096, 32400, 2283, 8123, 8989, 7878, 9696, 6767, 8686, 5055, 3001, 9000, 8443, 443];
const PROXIES = ['http://valet-dockerproxy:2375', 'http://dockerproxy:2375', 'http://docker-socket-proxy:2375', 'http://socket-proxy:2375'];

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "lscr.io/linuxserver/sonarr:latest" → "sonarr"; "ghcr.io/immich-app/immich-server" → "immich" */
export const appOf = (image: string) => flat(image.split('/').pop()!.split(/[:@]/)[0].replace(/[-_](server|app|web|ce|ee|ui|frontend|backend)$/i, ''));
const secret = (type: string, key: string) => `\${${`${type}_${key}`.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}}`;

/** The lines one service takes: its type, its address, and a `${NAME}` for each secret it needs, to go in .env. */
export function block(i: Integration, url: string, app: string): Record<string, unknown> {
  if (i.type === 'arr') return { type: 'arr', [app]: { url, apiKey: secret(app, 'key') } };
  const schema = z.toJSONSchema(i.config as z.ZodType, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, any>; required?: string[] };
  const out: Record<string, unknown> = { type: i.type };
  for (const key of schema.required ?? []) {
    if (key === 'type') continue;
    out[key] = /url$/i.test(key) ? url : schema.properties?.[key]?.type === 'string' ? secret(i.type, key) : undefined;
  }
  if (!('url' in out) && schema.properties?.url) out.url = url;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/** Which integration a container is, if any: by its image first, then by its name. */
export function match(registry: Record<string, Integration>, image: string, name: string) {
  const by = new Map<string, Integration>();
  for (const i of Object.values(registry)) if (!NOT_APPS.has(i.type)) { by.set(flat(i.type), i); by.set(flat(i.name), i); }
  for (const key of [appOf(image), flat(name)]) {
    if (ARR.has(key)) return { i: registry.arr, app: key };
    const i = by.get(key); if (i) return { i, app: key };
  }
  return null;
}

let held: { at: number; out: { via: string | null; found: Found[] } } | undefined;
export async function discover(registry: Record<string, Integration>, configured: { type: string; url?: string }[]) {
  if (held && Date.now() - held.at < 60_000) return held.out;
  const have = new Set(configured.map(c => c.type));
  const tries = [...configured.filter(c => c.type === 'docker' && c.url).map(c => c.url!), ...(process.env.VALET_DOCKER ? [process.env.VALET_DOCKER] : []), ...PROXIES];
  let via: string | null = null, list: any[] = [];
  for (const base of tries) {
    try { const r = await fetch(`${base.replace(/\/$/, '')}/containers/json`, { signal: AbortSignal.timeout(1500) }); if (r.ok) { list = await r.json(); via = base; break; } } catch { /* not this one */ }
  }
  const found: Found[] = [], seen = new Set<string>();
  // a container named after its app wins over another running the same image (a second instance, a test copy)
  const named = (c: any) => { const n = String(c.Names?.[0] ?? '').replace(/^\//, ''); return flat(n) === appOf(String(c.Image ?? '')) ? 0 : 1; };
  for (const c of [...list].sort((a, b) => named(a) - named(b))) {
    const name = String(c.Names?.[0] ?? '').replace(/^\//, ''), m = match(registry, String(c.Image ?? ''), name);
    if (!m || (have.has(m.i.type) && m.i.type !== 'arr') || seen.has(m.app)) continue;
    const ports = [...new Set<number>((c.Ports ?? []).filter((p: any) => p.Type === 'tcp').map((p: any) => p.PrivatePort))].sort((a, b) => a - b);
    const port = ports.find(p => WEB.includes(p)) ?? ports[0];
    const url = `http://${name}${port && port !== 80 ? `:${port}` : ''}`, id = m.i.type === 'arr' ? m.app : m.i.type;
    seen.add(m.app);
    const label = m.i.type === 'arr' ? m.app[0].toUpperCase() + m.app.slice(1) : m.i.name;
    found.push({ type: m.i.type === 'arr' ? m.app : m.i.type, name: label, icon: iconFor(m.i.type === 'arr' ? m.app : label), container: name, url, yaml: stringify({ [id]: block(m.i, url, m.app) }, { lineWidth: 0 }).trimEnd() });
  }
  held = { at: Date.now(), out: { via, found } };
  return held.out;
}
