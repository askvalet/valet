// `init` and `import`: a first config from what's running, and another dashboard's config as Valet's. Neither writes over
// a file, and neither writes a secret into a config.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { Config, parseConfig } from '../src/server/config.ts';
import { check } from '../src/server/site.ts';
import { registry } from '../src/integrations/index.ts';
import { initCommand, starting } from '../src/server/init.ts';
import { convert, importCommand, SOURCES } from '../src/server/import.ts';
import { STARTER } from '../src/server/starter.ts';

const dir = () => mkdtemp(join(tmpdir(), 'valet-cli-'));
/** runs a command with its output caught: what went to stdout, and what to stderr */
async function quietly(run: () => Promise<number>) {
  const out: string[] = [], err: string[] = [], log = console.log, error = console.error;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); }; console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try { return { code: await run(), out: out.join('\n'), err: err.join('\n') }; } finally { console.log = log; console.error = error; }
}
/** A config with every ${NAME} given a stand-in, through Valet's own loader and checker: what `config check` would say once .env is filled. */
function checks(yaml: string) {
  for (const m of yaml.matchAll(/\$\{([A-Z0-9_]+)\}/g)) process.env[m[1]] ??= /URL$/.test(m[1]) ? 'http://filled.test' : 'filled-in-value';
  const config = parseConfig(yaml);
  return check(config, registry).problems;
}

// ── init ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CONTAINERS = [
  { Names: ['/plex'], Image: 'plexinc/pms-docker', Ports: [{ PrivatePort: 32400, Type: 'tcp' }] },
  { Names: ['/sonarr'], Image: 'lscr.io/linuxserver/sonarr', Ports: [{ PrivatePort: 8989, Type: 'tcp' }] },
  { Names: ['/radarr'], Image: 'lscr.io/linuxserver/radarr', Ports: [{ PrivatePort: 7878, Type: 'tcp' }] },
  { Names: ['/pihole'], Image: 'pihole/pihole', Ports: [{ PrivatePort: 80, Type: 'tcp' }] },
  { Names: ['/glances'], Image: 'nicolargo/glances', Ports: [{ PrivatePort: 61208, Type: 'tcp' }] },
  { Names: ['/homeassistant'], Image: 'ghcr.io/home-assistant/home-assistant', Ports: [{ PrivatePort: 8123, Type: 'tcp' }] },
  { Names: ['/redis'], Image: 'redis:7', Ports: [{ PrivatePort: 6379, Type: 'tcp' }] },
];
const offline = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
const proxy = (list: unknown[]) => (async (url: any) => { if (String(url) === 'http://proxy.test:2375/containers/json') return Response.json(list); throw new TypeError('fetch failed'); }) as typeof fetch;

test('init: what is running becomes integrations, laid out by kind, with a ${NAME} for every secret', async () => {
  const made = await starting(registry, { docker: 'http://proxy.test:2375', fetch: proxy(CONTAINERS) });
  assert.equal(made.via, 'http://proxy.test:2375');
  assert.deepEqual(made.added, ['Sonarr', 'Radarr', 'Pi-hole', 'Glances', 'Home Assistant', 'Plex']);
  assert.deepEqual(made.bare, ['Home Assistant']);                       // it needs its entities named before it has a card
  const config = parse(made.yaml);
  assert.deepEqual(Object.keys(config.integrations).sort(), ['coming', 'docker', 'glances', 'homeassistant', 'pihole', 'plex', 'services']);
  assert.deepEqual(config.integrations.coming.radarr, { url: 'http://radarr:7878', apiKey: '${RADARR_KEY}' });
  assert.equal(config.integrations.services.targets.length, 6);         // up or down before any key is filled in
  assert.deepEqual(config.layout.map((s: any) => s.title), ['Services', 'Media', 'Network', 'Infrastructure', 'Start']);
  assert.deepEqual([...made.names.keys()].sort(), ['HOMEASSISTANT_TOKEN', 'PIHOLE_PASSWORD', 'PLEX_KEY', 'RADARR_KEY', 'SONARR_KEY']);
  // every value that isn't an address, a type or a word of Valet's is a reference
  const values = (v: unknown, key = ''): [string, string][] => typeof v === 'string' ? [[key, v]] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => values(x, k)) : [];
  for (const [key, v] of values(config.integrations)) if (/key|token|password|username/i.test(key)) assert.match(v, /^\$\{[A-Z0-9_]+\}$/, key);
  assert.deepEqual(checks(made.yaml), []);
});

test('init: with no socket proxy, or nothing it knows, it is the starter config', async () => {
  const none = await starting(registry, { docker: 'http://nothing.test:2375', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
  assert.equal(none.via, null); assert.equal(none.yaml, STARTER);
  const unknown = await starting(registry, { docker: 'http://proxy.test:2375', fetch: proxy([CONTAINERS.at(-1)]) });
  assert.equal(unknown.via, 'http://proxy.test:2375'); assert.equal(unknown.yaml, STARTER);
  assert.deepEqual(checks(STARTER), []);
});

test('init: never writes over a config, only over the untouched starter, and --print writes nothing', async () => {
  const d = await dir(), path = join(d, 'config.yaml');
  await writeFile(path, 'title: Mine\n');
  const refused = await quietly(() => initCommand(['--docker', 'http://nothing.test:9'], path, registry, offline));
  assert.equal(refused.code, 1); assert.match(refused.err, /already there, and init won't write over it/);
  assert.equal(await readFile(path, 'utf8'), 'title: Mine\n');
  const shown = await quietly(() => initCommand(['--print', '--docker', 'http://nothing.test:9'], path, registry, offline));
  assert.equal(shown.code, 0); assert.equal(shown.out.trim(), STARTER.trim()); assert.match(shown.err, /no Docker socket proxy answered/);
  assert.equal(await readFile(path, 'utf8'), 'title: Mine\n');
  const forced = await quietly(() => initCommand(['--force', '--docker', 'http://nothing.test:9'], path, registry, offline));
  assert.equal(forced.code, 0); assert.equal(await readFile(path, 'utf8'), STARTER);
  // the starter Valet wrote on its first start is no one's work, so it may be replaced; a new file is private
  const fresh = join(d, 'sub', 'config.yaml');
  assert.equal((await quietly(() => initCommand(['--docker', 'http://nothing.test:9'], fresh, registry, offline))).code, 0);
  assert.equal((await stat(fresh)).mode & 0o777, 0o600);
  assert.equal((await quietly(() => initCommand(['--docker', 'http://nothing.test:9'], fresh, registry, offline))).code, 0);
  assert.equal((await quietly(() => initCommand(['--wat'], fresh, registry, offline))).code, 1);
});

// ── import ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SECRETS = ['plex-token-made-up-1234', 'seerr-key-made-up-5678', 'pihole-app-pw-made-up', 'hunter2pass', 'abc12345', 'dashy-pihole-made-up', 'qbit-pass-made-up', 'sonarr-made-up-key-0001'];

async function samples() {
  const d = await dir(), hp = join(d, 'homepage');
  await mkdir(hp);
  await writeFile(join(hp, 'services.yaml'), `
- Media:
    - Plex:
        icon: plex.png
        href: https://plex.example.com
        description: Movies and shows
        widget: { type: plex, url: "http://plex:32400", key: plex-token-made-up-1234 }
    - Sonarr:
        href: http://sonarr.local:8989
        widget: { type: sonarr, url: "http://sonarr:8989", key: "{{HOMEPAGE_VAR_SONARR_KEY}}" }
    - Jellyseerr:
        href: http://requests.local
        widget: { type: jellyseerr, url: "http://seerr:5055", key: seerr-key-made-up-5678 }
- Network:
    - Pi-hole:
        href: http://pihole.local/admin
        widget: { type: pihole, url: "http://pihole", version: 6, key: pihole-app-pw-made-up }
    - Router:
        href: http://admin:hunter2pass@192.168.1.1/?token=abc12345
        siteMonitor: http://192.168.1.1
    - Odd thing:
        href: "javascript:alert(1)"
- Lab:
    - Inner:
        - Notes: { href: "https://notes.example.com", icon: mdi-note }
`);
  await writeFile(join(hp, 'bookmarks.yaml'), '- Developer:\n    - Code:\n        - { abbr: CO, href: "https://code.example.com/" }\n');
  await writeFile(join(hp, 'widgets.yaml'), '- openmeteo: { latitude: 43.6, longitude: -79.4 }\n- search: { provider: duckduckgo }\n- resources: { cpu: true }\n');
  await writeFile(join(hp, 'settings.yaml'), 'title: Lab home\n');
  await writeFile(join(d, 'conf.yml'), `
pageInfo: { title: Lab Board }
sections:
  - name: Media
    items:
      - { title: Jellyfin, url: "http://jellyfin.local:8096", icon: hl-jellyfin, statusCheckUrl: "http://jellyfin:8096/health" }
      - { title: Radarr, url: "http://radarr:7878", icon: "fas fa-film" }
  - name: System
    widgets:
      - { type: gl-current-cpu, options: { hostname: "http://glances:61208" } }
      - { type: pi-hole-stats, options: { hostname: "http://pihole", apiKey: dashy-pihole-made-up } }
      - { type: crypto-price-chart }
    items: [{ title: Nested, subItems: [{ title: Sub, url: "https://sub.example.com" }] }]
`);
  await writeFile(join(d, 'homarr.json'), JSON.stringify({
    categories: [{ id: 'c1', name: 'Downloads' }],
    apps: [
      { id: 'a1', name: 'qBittorrent', url: 'http://qbit:8080', behaviour: { externalUrl: 'https://qbit.example.com' }, area: { type: 'category', properties: { id: 'c1' } },
        integration: { type: 'qBittorrent', properties: [{ field: 'username', value: 'admin' }, { field: 'password', value: 'qbit-pass-made-up' }] } },
      { id: 'a2', name: 'Wiki', url: 'https://wiki.example.com', area: { type: 'wrapper', properties: { id: 'w' } } },
      { id: 'a3' },
    ],
    widgets: [{ type: 'weather', properties: { location: { latitude: 51.5, longitude: -0.1 } } }, { type: 'rss' }],
    settings: { customization: { pageTitle: 'Our board' } },
  }));
  await writeFile(join(d, 'heimdall.json'), JSON.stringify([
    { title: 'Sonarr', url: 'http://sonarr.local:8989', class: 'App\\SupportedApps\\Sonarr\\Sonarr', description: JSON.stringify({ apikey: 'sonarr-made-up-key-0001', override_url: 'http://sonarr:8989' }), appdescription: 'TV' },
    { title: 'NAS', url: 'https://nas.local:5001', description: 'The storage box', tag: 'Storage' },
    { title: 'Broken', url: 5 }, 'nonsense', null, { title: { nested: true } },
  ]));
  return { d, hp };
}

test('import: Homepage: widgets become integrations, the rest links with an up/down check, and every secret is taken out', async () => {
  const { hp } = await samples(), r = convert(SOURCES.homepage.read(hp), registry, 'Homepage'), c = r.config as any;
  assert.equal(c.title, 'Lab home'); assert.equal(c.search, 'duckduckgo'); assert.equal(c.weather, 'weather.now');
  assert.deepEqual(c.integrations.plex, { type: 'plex', url: 'http://plex:32400', key: '${PLEX_KEY}', href: 'https://plex.example.com' });
  assert.deepEqual(c.integrations.coming, { type: 'arr', sonarr: { url: 'http://sonarr:8989', apiKey: '${HOMEPAGE_VAR_SONARR_KEY}' } });   // Homepage's own variable keeps its name
  assert.equal(c.integrations.jellyseerr.type, 'seerr');
  assert.equal(c.integrations['pi-hole'].password, '${PI_HOLE_PASSWORD}');
  assert.deepEqual(Object.keys(c.links), ['Network', 'Inner', 'Developer']);
  const router = c.links.Network[0];
  assert.equal(router.url, 'http://192.168.1.1/');                       // the password in front and the token behind are gone
  assert.deepEqual(c.integrations.status.targets.find((t: any) => t.name === 'Router'), { name: 'Router', url: 'http://192.168.1.1', href: 'http://192.168.1.1/', group: 'Network' });
  assert.deepEqual(c.layout.map((s: any) => s.title), ['Status', 'Media', 'Network', 'Inner', 'Developer']);
  assert.deepEqual(r.made.skipped.map(s => s.what), ['the resources widget', 'Odd thing']);
  assert.ok(r.made.notes.some(n => n.startsWith('Router')));
  assert.deepEqual(r.env.map(e => [e.name, e.value]), [['PLEX_KEY', 'plex-token-made-up-1234'], ['HOMEPAGE_VAR_SONARR_KEY', ''], ['JELLYSEERR_API_KEY', 'seerr-key-made-up-5678'], ['PI_HOLE_PASSWORD', 'pihole-app-pw-made-up']]);
  for (const s of SECRETS) assert.ok(!r.yaml.includes(s), s);
  assert.deepEqual(checks(r.yaml), []);
});

test('import: Dashy, Homarr and Heimdall, each from its own format', async () => {
  const { d } = await samples(), read = (s: keyof typeof SOURCES, f: string) => convert(SOURCES[s].read(join(d, f)), registry, SOURCES[s].name);
  const dashy = read('dashy', 'conf.yml'), dc = dashy.config as any;
  assert.equal(dc.title, 'Lab Board');
  assert.deepEqual(Object.keys(dc.integrations).sort(), ['glances', 'pihole', 'status']);   // two widgets; the items hold no keys, so they stay links
  assert.equal(dc.integrations.pihole.password, '${PIHOLE_PASSWORD}');
  assert.deepEqual(dc.links.Media.map((l: any) => [l.name, l.icon]), [['Jellyfin', 'jellyfin'], ['Radarr', undefined]]);
  assert.ok(dashy.made.links.some(l => /Jellyfin \(Valet has a Jellyfin integration; add its key/.test(l)));
  assert.equal(dc.integrations.status.targets[0].url, 'http://jellyfin:8096/health');
  assert.deepEqual(dashy.made.skipped.map(s => s.what), ['Nested', 'crypto-price-chart']);
  const homarr = read('homarr', 'homarr.json'), hc = homarr.config as any;
  assert.equal(hc.title, 'Our board');
  assert.deepEqual(hc.integrations.qbittorrent, { type: 'qbittorrent', url: 'http://qbit:8080', username: '${QBITTORRENT_USERNAME}', password: '${QBITTORRENT_PASSWORD}', href: 'https://qbit.example.com' });
  assert.deepEqual(hc.layout.find((s: any) => s.title === 'Downloads').widgets, ['qbittorrent.active']);
  assert.deepEqual(hc.integrations.weather, { type: 'weather', latitude: 51.5, longitude: -0.1 });
  const heimdall = read('heimdall', 'heimdall.json'), mc = heimdall.config as any;
  assert.deepEqual(mc.integrations.coming.sonarr, { url: 'http://sonarr:8989', apiKey: '${SONARR_KEY}' });
  assert.deepEqual(mc.links.Storage, [{ name: 'NAS', url: 'https://nas.local:5001', note: 'The storage box' }]);
  assert.equal(heimdall.made.skipped.length, 4);                        // a bad address, two that aren't apps and one with no title
  for (const r of [dashy, homarr, heimdall]) {
    for (const s of SECRETS) assert.ok(!r.yaml.includes(s), s);
    assert.deepEqual(checks(r.yaml), []);
  }
});

test('import: a malformed or hostile file is a clear message, never a crash or a hang', async () => {
  const d = await dir(), file = async (name: string, text: string) => { const p = join(d, name); await writeFile(p, text); return p; };
  const bad: [keyof typeof SOURCES, string, RegExp][] = [
    ['heimdall', await file('a.json', '{"a":'), /isn't valid JSON/],
    ['homarr', await file('b.json', '{"apps": 3}'), /no `apps` list/],
    ['dashy', await file('c.yml', 'sections: 5'), /no `sections:` list/],
    ['dashy', await file('d.yml', 'a: [unclosed'), /isn't valid YAML/],
    ['homepage', await file('e.yml', 'Media: {}'), /should be a list of groups/],
    ['homepage', d, /no services\.yaml/],
    ['homepage', join(d, 'missing'), /can't be read/],
  ];
  for (const [s, p, why] of bad) assert.throws(() => SOURCES[s].read(p), why, `${s} ${p}`);
  // the wrong shapes deep inside are skipped, a group may be called anything, and a long line of junk doesn't crawl
  const odd = await file('f.yml', `- __proto__:\n    - X: { href: "https://x.example.com" }\n    - Y: 3\n    - [1, 2]\n- constructor: 5\n- Z:\n    - W: { href: "${'{{'.repeat(20_000)}x" }\n`);
  const t0 = performance.now(), r = convert(SOURCES.homepage.read(odd), registry, 'Homepage');
  assert.ok(performance.now() - t0 < 2000);
  assert.deepEqual((r.config as any).links.__proto__, [{ name: 'X', url: 'https://x.example.com' }]);
  assert.ok(Config.safeParse(parse(r.yaml)).success);
  const long = await file('g.json', JSON.stringify([{ title: 'a'.repeat(100_000), url: `https://x.example.com/${'a'.repeat(100_000)}`, description: '{'.repeat(50_000) }]));
  assert.doesNotThrow(() => convert(SOURCES.heimdall.read(long), registry, 'Heimdall'));
});

test('import: the command writes only where it is told, never over a file, and secrets go to a private file of their own', async () => {
  const { d, hp } = await samples(), out = join(d, 'valet.yaml'), env = join(d, '.env.import');
  const shown = await quietly(() => importCommand(['homepage', hp], registry));
  assert.equal(shown.code, 0);
  assert.ok(parse(shown.out).integrations.plex);                         // stdout is the config alone
  assert.match(shown.err, /4 integrations: Plex[^]*3 links[^]*2 skipped[^]*PLEX_KEY=plex-token-made-up-1234/);
  const wrote = await quietly(() => importCommand(['homepage', hp, '--out', out, '--env', env], registry));
  assert.equal(wrote.code, 0);
  assert.equal((await stat(env)).mode & 0o777, 0o600); assert.equal((await stat(out)).mode & 0o777, 0o600);
  const secrets = await readFile(env, 'utf8'), config = await readFile(out, 'utf8');
  assert.match(secrets, /^PLEX_KEY=plex-token-made-up-1234$/m); assert.match(secrets, /^PI_HOLE_PASSWORD=pihole-app-pw-made-up$/m);
  for (const s of SECRETS) assert.ok(!config.includes(s) && !wrote.out.includes(s), s);
  const again = await quietly(() => importCommand(['homepage', hp, '--out', out], registry));
  assert.equal(again.code, 1); assert.match(again.err, /won't write over it/);
  assert.equal(await readFile(out, 'utf8'), config);
  assert.equal((await quietly(() => importCommand(['homepage', hp, '--out', out, '--env', env, '--force'], registry))).code, 0);
  for (const args of [['nope', hp], ['homepage'], ['homepage', join(d, 'missing')]]) assert.equal((await quietly(() => importCommand(args, registry))).code, 1, args.join(' '));
});
