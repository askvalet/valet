// The machines and what watches them. Container and service names are the usual ones; everything they report is made up.
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { DAY, HOUR, MIN, ago, route, sleep, ticker, wave, ymd } from './helpers.ts';
import type { Fixture } from './types.ts';

// ── Docker
const container = (name: string, project: string, Status: string, Image: string, o: Record<string, unknown> = {}) => ({ Id: `${name}0000`, Names: [`/${name}`], State: /^Exited/.test(Status) ? 'exited' : /^Created/.test(Status) ? 'created' : 'running', Status, Image, Labels: { 'com.docker.compose.project': project, ...o } });
const fleet = [
  container('caddy', 'edge', 'Up 9 days', 'caddy:2.9.1'), container('plex', 'media', 'Up 9 days (healthy)', 'lscr.io/linuxserver/plex:1.41.3'), container('sonarr', 'media', 'Up 9 days', 'lscr.io/linuxserver/sonarr:4.0.11'), container('radarr', 'media', 'Up 3 hours', 'lscr.io/linuxserver/radarr:5.16.3'),
  container('prowlarr', 'media', 'Up 9 days', 'lscr.io/linuxserver/prowlarr:1.28.2'), container('qbittorrent', 'media', 'Up 9 days', 'lscr.io/linuxserver/qbittorrent:5.0.3'),
  container('immich_server', 'immich', 'Up 2 days (healthy)', 'ghcr.io/immich-app/immich-server:v1.120.2'), container('immich_postgres', 'immich', 'Up 2 days (healthy)', 'ghcr.io/immich-app/postgres:14'), container('immich_redis', 'immich', 'Up 2 days (healthy)', 'redis:7.4.1'),
  container('paperless', 'docs', 'Up 5 days (healthy)', 'ghcr.io/paperless-ngx/paperless-ngx:2.13.5'), container('karakeep', 'docs', 'Up 5 days', 'ghcr.io/karakeep-app/karakeep:0.23.0'), container('homeassistant', 'home', 'Up 12 days', 'ghcr.io/home-assistant/home-assistant:2026.9.3'),
  container('pihole', 'network', 'Up 12 days (healthy)', 'pihole/pihole:2025.3.0'), container('uptime-kuma', 'network', 'Up 12 days (healthy)', 'louislam/uptime-kuma:1.23.16'), container('backup-job', 'ops', 'Exited (0) 6 hours ago', 'restic/restic:0.17.3'),
];
const sick = [...fleet.map(c => c.Names[0] === '/karakeep' ? { ...c, Status: 'Up 5 days (unhealthy)' } : c.Names[0] === '/radarr' ? { ...c, State: 'exited', Status: 'Exited (137) 40 minutes ago' } : c)];
const tags = (...list: string[]) => ({ tags: list });
const dockerRoutes = (list: unknown[]) => route([
  ['/containers/json', list],
  ['linuxserver/plex/tags', tags('1.41.3', '1.41.4')], ['linuxserver/sonarr/tags', tags('4.0.11', '4.0.12')], ['linuxserver/radarr/tags', tags('5.16.3', '5.17.0')], ['linuxserver/qbittorrent/tags', tags('5.0.3', '5.1.0')],
  ['immich-server/tags', tags('v1.120.2', 'v1.121.0', 'v2.0.0')], ['pihole/pihole/tags', tags('2025.3.0', '2025.4.1')], ['paperless-ngx/tags', tags('2.13.5', '2.14.0')],
  ['/repos/immich-app/immich-server/releases', [{ tag_name: 'v2.0.0', published_at: ago(3 * DAY), body: '## Breaking changes\n- The database image must be updated first: action required before you pull.' }]],
  ['/repos/', []], [/\/v2\/.*\/tags\/list/, tags()],
]);

// ── Glances
const tock = ticker();
const glances = (o: { cpu?: number; temp?: number; percent?: number; gpuTemp?: number; full?: number } = {}) => route([
  [/\/api\/4\/cpu$/, () => ({ total: o.cpu ?? wave(tock(), 9, 38) })], [/\/api\/4\/mem$/, () => ({ total: 64 * 2 ** 30, used: 27.4 * 2 ** 30, percent: o.percent ?? wave(tock(), 41, 47) })],
  [/\/api\/4\/sensors$/, [{ label: 'CPU', value: o.temp ?? 47 }]],
  [/\/api\/4\/gpu$/, () => [{ name: 'NVIDIA GeForce RTX 4070', temperature: o.gpuTemp ?? 44, proc: (o.gpuTemp ?? 0) > 80 ? 96 : wave(tock(), 2, 19), mem: 26 }]],
  [/\/api\/4\/uptime$/, '9 days, 4:12:33'], [/\/api\/4\/quicklook$/, { cpu_name: 'AMD Ryzen 9 5900X 12-Core Processor' }],
  [/\/api\/4\/network$/, () => [{ interface_name: 'eth0', bytes_recv_rate_per_sec: wave(tock(), 2e5, 2.2e7), bytes_sent_rate_per_sec: wave(tock(), 1e5, 3e6) }]],
  [/\/api\/4\/fs$/, [
    { device_name: '/dev/nvme0n1p2', mnt_point: '/', size: 1e12, used: 412e9, free: 588e9, percent: 41.2 },
    { device_name: '/dev/sda1', mnt_point: '/mnt/media', size: 18e12, used: 14.8e12, free: 3.2e12, percent: o.full ?? 82.2 },
    { device_name: '/dev/sdb1', mnt_point: '/mnt/backup', size: 8e12, used: 3.1e12, free: 4.9e12, percent: 38.7 },
  ]],
]);

// ── Host (the agent)
const unit = (name: string, state: string, o: Record<string, unknown> = {}) => ({ unit: `${name}.service`, name, state, sub: state === 'active' ? 'running' : 'dead', restarts: 0, since: ago(9 * DAY), ...o });
const units = [unit('valet-agent', 'active'), unit('tailscaled', 'active'), unit('smbd', 'active'), unit('nfs-server', 'active'), unit('sshd', 'active'), unit('cron', 'active'), unit('restic-backup', 'inactive')];
const hostAnswer = (list: unknown[]) => route([['/services', { host: 'nas', services: list }]]);

// ── http: answers vary by what each target is doing, as a real check's timing does
const targets = [['Plex', 'http://plex:32400/identity', 'Media', 200], ['Radarr', 'http://radarr:7878/ping', 'Media', 200], ['Sonarr', 'http://sonarr:8989/ping', 'Media', 200], ['Immich', 'http://immich:2283/api/server/ping', 'Photos', 200], ['Paperless', 'http://paperless:8000/', 'Docs', 200], ['Karakeep', 'http://karakeep:3000/', 'Docs', 200], ['Home Assistant', 'http://homeassistant:8123/', 'Home', 200], ['Pi-hole', 'http://pihole/admin/', 'Network', 200]] as const;
const delayed = (status: (url: string) => number) => async (url: string) => { await sleep(4 + url.length % 19); return new Response('', { status: status(url) }); };

// ── Uptime Kuma
const monitor = (id: number, name: string, status: number, ms: number, day: number, month: number, cert?: number) => [`monitor_status{monitor_id="${id}",monitor_name="${name}"} ${status}`, `monitor_response_time{monitor_id="${id}",monitor_name="${name}"} ${ms}`, `monitor_uptime_ratio{monitor_id="${id}",monitor_name="${name}",window="1d"} ${day}`, `monitor_uptime_ratio{monitor_id="${id}",monitor_name="${name}",window="30d"} ${month}`, ...(cert != null ? [`monitor_cert_days_remaining{monitor_id="${id}",monitor_name="${name}"} ${cert}`] : [])].join('\n');
const kuma = (...o: [string, number, number?, number?][]) => { const set = new Map(o.map(x => [x[0], x])); return route([['/metrics', ([['Plex', 1, 22, 1, .9998, 62], ['Home Assistant', 1, 14, 1, 1, 41], ['Immich', 1, 38, 1, .9991, 62], ['Paperless', 1, 19, 1, .9976, 62], ['Router', 1, 2, 1, 1], ['Pi-hole', 1, 4, 1, .9999], ['Website', 1, 210, 1, .9984, 88]] as [string, number, number, number, number, number?][]).map(([name, st, ms, day, month, cert], i) => { const c = set.get(name); return monitor(i + 1, name, c?.[1] ?? st, ms, day, c?.[3] ?? month, c?.[2] ?? cert); }).join('\n')]]); };

// ── Scrutiny
const drive = (device_name: string, model_name: string, temp: number, power_on_hours: number, capacity: number, device_status = 0, wwn = device_name) => ({ device: { device_name, model_name, device_status, wwn, capacity }, smart: { temp, power_on_hours } });
const scrutiny = (...list: unknown[]) => route([['/api/summary', { data: { summary: Object.fromEntries(list.map((d, i) => [i, d])) } }]]);
const DRIVES = [drive('sda', 'WD Red Plus 18TB', 38, 27_100, 18e12), drive('sdb', 'WD Red Plus 18TB', 39, 27_080, 18e12), drive('sdc', 'Seagate IronWolf 8TB', 41, 41_200, 8e12), drive('sdd', 'Seagate IronWolf 8TB', 42, 41_180, 8e12), drive('nvme0', 'Samsung 980 Pro 1TB', 47, 11_900, 1e12)];

// ── Ollama
const installed = [['llama3.2:8b', 4.9e9, '8.0B', 'Q4_K_M'], ['qwen2.5-coder:14b', 9e9, '14.0B', 'Q4_K_M'], ['mistral-nemo:12b', 7.1e9, '12.0B', 'Q4_0'], ['nomic-embed-text:latest', 2.7e8, '137M', 'F16'], ['gemma3:9b', 5.8e9, '9.0B', 'Q4_K_M']].map(([name, size, parameter_size, quantization_level]) => ({ name, size, details: { parameter_size, quantization_level } }));
const ollama = (models: unknown[], ps: unknown[]) => route([['/api/tags', { models }], ['/api/ps', { models: ps }]]);

// ── Pi-hole
const dayStart = Date.now() - DAY;
const dnsHistory = Array.from({ length: 144 }, (_, i) => { const total = Math.round(wave(i / 3, 30, 240)); return { timestamp: Math.floor((dayStart + i * 10 * MIN) / 1000), total, blocked: Math.round(total * .14) }; });
const pihole = (blocking: unknown) => route([
  ['/api/auth', { session: { valid: true, sid: 'sample' } }], ['stats/summary', { queries: { total: 18_412, blocked: 2_577, percent_blocked: 14 }, clients: { active: 23 } }], ['/history', { history: dnsHistory }],
  ['dns/blocking', blocking], ['stats/database/summary', { sum_blocked: 1_204_118, percent_blocked: 14.2, total_clients: 23 }],
  ['stats/top_domains', { domains: [['ads.example.net', 412], ['telemetry.example.com', 318], ['metrics.example.org', 201], ['tracker.example.io', 96], ['pixel.example.co', 41]].map(([domain, count]) => ({ domain, count })) }],
]);

// ── Local AI monitor
const hourly = Array.from({ length: 24 }, (_, i) => Date.now() - (23 - i) * HOUR);
const aiLive = (o: { running?: unknown[]; swapping?: string | null; temp?: number } = {}) => { const t = ticker(); return () => { const i = t(); return { gpu: { util: o.running?.length ? wave(i, 55, 92) : wave(i, 0, 6), power: o.running?.length ? wave(i, 140, 210) : wave(i, 24, 38), temp: o.temp ?? 49, mem: 7300, mem_total: 12288 }, model: { name: 'llama3.2:8b', swapping: o.swapping ?? null }, running: o.running ?? [], today: { requests: 214, tokens: 1_480_000, cost: .31, kwh: 1.92 } }; }; };
const ai = (live: () => unknown) => route([
  ['/api/live', live], ['/api/history', { gpu: hourly.map((t, i) => [t, wave(i, 2, 60), wave(i, 30, 180)]), requests: hourly.map((t, i) => [t, 'llama3.2:8b', Math.round(wave(i, 0, 24)), Math.round(wave(i, 0, 110_000))]), totals: { avg_tok_s: 41, prompt_tokens: 2_140_000 } }],
  ['/api/cost', { month: 7.4, days: Array.from({ length: 30 }, (_, i) => ({ day: ymd((i - 29) * DAY), cost: Math.round(wave(i, 8, 42)) / 100, tokens: Math.round(wave(i, 3e5, 2.4e6)), kwh: wave(i, .6, 3) })) }],
]);

// ── The two that don't speak HTTP: real sockets on 127.0.0.1, so sockets.ts runs its own protocol code
const varint = (n: number) => { const out: number[] = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const packet = (...parts: Buffer[]) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };
const record = (s: string) => { const b = Buffer.from(s, 'latin1'), n = Buffer.alloc(2); n.writeUInt16BE(b.length); return Buffer.concat([n, b]); };
const nis = (lines: string[]) => Buffer.concat([...lines.map(record), Buffer.from([0, 0])]);
/** Stands in for a server on a socket: connections to these hosts reach a local one that answers with `reply(host)`; any other host is refused. */
const socketServer = (reply: (host: string) => Buffer | undefined) => async () => {
  const net = createRequire(import.meta.url)('node:net'), real = net.connect;
  let asked = '';
  const server = createServer(s => { s.once('data', () => s.write(reply(asked) ?? Buffer.alloc(0))); s.on('error', () => {}); });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', () => ok()));
  const port = (server.address() as { port: number }).port;
  net.connect = (o: { host: string; timeout?: number }) => { asked = o.host; return real({ ...o, host: '127.0.0.1', port: reply(o.host) ? port : 1 }); };
  syncBuiltinESMExports();
  return () => { net.connect = real; syncBuiltinESMExports(); server.close(); };
};
const minecraftReply = (online: number) => { const j = Buffer.from(JSON.stringify({ version: { name: '1.21.4' }, players: { online, max: 20 }, description: { text: 'Back garden' } })); return packet(varint(0), varint(j.length), j); };
const ups = (status: string, charge: string, left: string, load: string) => nis([`STATUS   : ${status}`, `BCHARGE  : ${charge} Percent`, `TIMELEFT : ${left} Minutes`, `LOADPCT  : ${load} Percent`, 'MODEL    : Back-UPS 1500']);

export const infra: Record<string, Fixture> = {
  docker: {
    config: { url: 'http://valet-dockerproxy:2375', sources: { immich_server: 'immich-app/immich-server' } },
    http: dockerRoutes(fleet),
    states: [
      { widget: 'containers', state: 'trouble', label: 'One down, one unhealthy', http: dockerRoutes(sick) },
      { widget: 'updates', state: 'current', label: 'Everything current', http: route([['/containers/json', fleet.slice(0, 2)], [/\/v2\/.*\/tags\/list/, tags()]]) },
    ],
  },
  glances: {
    config: { url: 'http://glances:61208', network: 'eth0', cpuSensor: 'CPU', disks: [{ mount: '/', name: 'System', sub: 'NVMe' }, { mount: '/mnt/media', name: 'Media' }, { mount: '/mnt/backup', name: 'Backup' }] },
    http: glances(), warm: 40,
    states: [
      { widget: 'tiles', state: 'hot', label: 'Running hot', http: glances({ cpu: 94, temp: 88, percent: 91, gpuTemp: 86, full: 93 }) },
      { widget: 'overview', state: 'hot', label: 'Running hot', http: glances({ cpu: 94, temp: 88, percent: 91, gpuTemp: 86 }) },
      { widget: 'disks', state: 'full', label: 'A disk filling up', http: glances({ full: 93 }) },
    ],
  },
  host: {
    config: { url: 'http://10.0.0.5:7576', token: 'x', title: 'Services', quiet: ['restic-backup'] },
    http: hostAnswer(units),
    states: [{ widget: 'services', state: 'failed', label: 'A service failed', http: hostAnswer(units.map(u => u.name === 'smbd' ? { ...u, state: 'failed', result: 'exit-code', exitStatus: 1 } : u)) }],
  },
  http: {
    config: { interval: 30000, targets: targets.map(([name, url, group]) => ({ name, url, group })) },
    http: delayed(() => 200), warm: 20,
    states: [{ widget: 'status', state: 'trouble', label: 'One down', http: delayed(u => u.includes('paperless') ? 503 : 200) }],
  },
  uptimekuma: {
    config: { url: 'http://uptime-kuma:3001', username: '', password: 'x', certWarnDays: 14 },
    http: kuma(),
    states: [
      { widget: 'monitors', state: 'trouble', label: 'One down', http: kuma(['Paperless', 0, undefined, .9712]) },
      { widget: 'monitors', state: 'cert', label: 'A certificate expiring', http: kuma(['Website', 1, 9]) },
      { widget: 'monitors', state: 'maintenance', label: 'Pending and in maintenance', http: kuma(['Immich', 2], ['Plex', 3]) },
    ],
  },
  scrutiny: {
    config: { url: 'http://scrutiny:8080', hotC: 55 },
    http: scrutiny(...DRIVES),
    states: [
      { widget: 'drives', state: 'hot', label: 'A drive running hot', http: scrutiny(...DRIVES.slice(0, 2), drive('sdc', 'Seagate IronWolf 8TB', 58, 41_200, 8e12), ...DRIVES.slice(3)) },
      { widget: 'drives', state: 'failing', label: 'A drive failing', http: scrutiny(...DRIVES.slice(0, 3), drive('sdd', 'Seagate IronWolf 8TB', 44, 41_180, 8e12, 2), DRIVES[4]) },
    ],
  },
  ollama: {
    config: { url: 'http://ollama:11434' },
    http: ollama(installed, [{ name: 'llama3.2:8b', size_vram: 5.4e9 }]),
    states: [
      { widget: 'models', state: 'idle', label: 'Nothing loaded', http: ollama(installed, []) },
      { widget: 'models', state: 'empty', label: 'No models', http: ollama([], []) },
    ],
  },
  pihole: {
    config: { url: 'http://pihole', password: 'x', href: 'https://dns.example.com/admin' },
    http: pihole({ blocking: 'enabled', timer: null }),
    states: [
      { widget: 'stats', state: 'paused', label: 'Paused', http: pihole({ blocking: 'disabled', timer: 300 }) },
      { widget: 'stats', state: 'off', label: 'Blocking off', http: pihole({ blocking: 'disabled', timer: null }) },
    ],
  },
  aimonitor: {
    config: { url: 'http://ai-monitor:9000' },
    http: ai(aiLive({ running: [{ app: 'Valet' }] })), warm: 40,
    states: [
      { widget: 'gpu', state: 'idle', label: 'Idle', http: ai(aiLive()) },
      { widget: 'gpu', state: 'loading', label: 'Loading a model', http: ai(aiLive({ swapping: 'qwen2.5-coder:14b' })) },
      { widget: 'gpu', state: 'hot', label: 'Running hot', http: ai(aiLive({ running: [{ app: 'Valet' }, { app: 'Notes' }], temp: 87 })) },
    ],
  },
  api: {
    config: { url: 'http://speedtest.example.com/api/latest', title: 'Speedtest', icon: 'wifi', about: 'The last internet speed test.', headers: { Authorization: 'Bearer ${SPEEDTEST_TOKEN}' },
      stats: [{ label: 'Down', value: 'download|round:0', unit: 'Mbps', max: 1000 }, { label: 'Up', value: 'upload|round:0', unit: 'Mbps', max: 1000 }, { label: 'Ping', value: 'ping', unit: 'ms', warn: 30, bad: 80 }, { label: 'Last run', value: 'at|ago' }] },
    http: route([['/api/latest', { download: 912.4, upload: 41.8, ping: 12, at: ago(42 * MIN), lastRun: ago(42 * MIN), server: 'Example ISP', jobs: [{ name: 'Nightly backup', took: '14 min', state: 'ok', done: .96, group: 'Storage' }, { name: 'Photo sync', took: '3 min', state: 'ok', done: .88, group: 'Storage' }, { name: 'Certificate renewal', took: '40 s', state: 'ok', done: 1, group: 'Network' }, { name: 'Off-site copy', took: 'failed', state: 'error', done: .3, group: 'Storage' }, { name: 'Log rotation', took: '2 s', state: 'ok', done: 1, group: 'System' }] }]]),
    states: [
      { widget: 'data', state: 'list', label: 'As a list', config: { title: 'Jobs', stats: undefined, list: { items: 'jobs', title: 'name', subtitle: 'group', meta: 'took', pct: 'done' } } },
      { widget: 'data', state: 'status', label: 'As a status list', config: { title: 'Jobs', stats: undefined, status: { items: 'jobs', name: 'name', ok: 'state', detail: 'took', group: 'group' } } },
      { widget: 'data', state: 'rows', label: 'As a table', config: { title: 'Last test', stats: undefined, rows: { Server: 'server', Download: '{download|round:0} Mbps', Upload: '{upload|round:0} Mbps', When: 'at|ago' } } },
    ],
  },
  iframe: { config: { url: 'https://grafana.example.com/d/abc/overview?kiosk', title: 'Grafana', height: 320 } },
  links: {
    config: { groups: {
      Media: [{ name: 'Plex', url: 'https://plex.example.com', icon: 'plex', note: 'watch' }, { name: 'Sonarr', url: 'https://sonarr.example.com', icon: 'sonarr' }, { name: 'Radarr', url: 'https://radarr.example.com', icon: 'radarr' }, { name: 'qBittorrent', url: 'https://torrents.example.com', icon: 'qbittorrent' }],
      Reading: [{ name: 'Hacker News', url: 'https://news.ycombinator.com', note: 'news' }, { name: 'Lobsters', url: 'https://lobste.rs' }, { name: 'The small web', url: 'https://blog.example.net', note: 'a long list of personal sites' }],
    } },
  },
  apcups: {
    config: { host: 'ups.example', title: 'UPS' },
    before: socketServer(h => h === 'ups.example' ? ups('ONLINE', '100.0', '42.5', '18.0') : h === 'battery.example' ? ups('ONBATT', '74.0', '21.0', '31.0') : undefined),
    states: [
      { widget: 'status', state: 'battery', label: 'On battery', config: { host: 'battery.example' } },
      { widget: 'status', state: 'down', label: 'Can\'t reach it', config: { host: 'gone.example' } },
    ],
  },
  minecraft: {
    config: { host: 'mc.example', title: 'Minecraft' },
    before: socketServer(h => h === 'mc.example' ? minecraftReply(3) : h === 'quiet.example' ? minecraftReply(0) : undefined),
    states: [
      { widget: 'status', state: 'empty', label: 'Nobody on', config: { host: 'quiet.example' } },
      { widget: 'status', state: 'down', label: 'Can\'t reach it', config: { host: 'gone.example' } },
    ],
  },
};
