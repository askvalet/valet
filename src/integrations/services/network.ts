// DNS, proxies, tunnels, routers, speed tests and sign-in. See media.ts for the shape of an entry.
import { z } from 'zod';
import { fmt, service } from '../../server/service.ts';

const num = (v: unknown) => Number(v ?? 0) || 0;                       // some of these send numbers as strings
const sum = (xs: any[] | null | undefined, f: (x: any) => unknown) => (xs ?? []).reduce((n, x) => n + num(f(x)), 0);
const of = (part: number, whole: number) => `${part.toLocaleString('en')} / ${whole.toLocaleString('en')}`;
const percent = (v: unknown) => v == null || !Number.isFinite(Number(v)) ? undefined : `${Math.round(Number(v))}%`;
const share = (part: number, whole: number) => whole ? part / whole : undefined;
const mbps = (v: unknown) => v == null ? undefined : `${Math.round(Number(v))} Mbps`;
const ms = (v: unknown) => v == null ? undefined : `${Math.round(Number(v))} ms`;
const blocked = (n: number, total: number) => ({ label: 'Blocked', value: n, sub: total ? `${fmt.pct(n / total)} of queries` : undefined });
// a service in someone else's cloud: nothing to fill in but the credentials
const hosted = (url: string, href: string) => ({ url: z.string().url().default(url), href: z.string().default(href) });

export default [
  // DNS
  service({
    type: 'adguard', name: 'AdGuard Home', icon: 'shield', logo: 'adguard-home', auth: 'basic',
    get: { stats: '/control/stats' },
    stats: d => {
      const s = d.stats, queries = num(s?.num_dns_queries);
      return [{ label: 'Queries', value: queries }, blocked(num(s?.num_blocked_filtering), queries),
        { label: 'Filtered', value: num(s?.num_replaced_safebrowsing) + num(s?.num_replaced_safesearch) + num(s?.num_replaced_parental) },
        { label: 'Latency', value: ms(num(s?.avg_processing_time) * 1000) }];              // sent in seconds
    },
    sample: { stats: { num_dns_queries: 48210, num_blocked_filtering: 9642, num_replaced_safebrowsing: 12, num_replaced_safesearch: 30, num_replaced_parental: 3, avg_processing_time: 0.0184 } },
    expect: { Queries: '48,210', Blocked: '9,642', Filtered: 45, Latency: '18 ms' },
  }),
  service<{ profile: string }>({
    type: 'nextdns', name: 'NextDNS', icon: 'shield', auth: { header: 'X-Api-Key' },
    options: { ...hosted('https://api.nextdns.io', 'https://my.nextdns.io'), profile: z.string() },
    get: o => ({ status: `/profiles/${o.profile}/analytics/status` }),
    stats: d => {
      const rows = d.status?.data ?? [], queries = sum(rows, r => r.queries);
      const count = (status: string) => num(rows.find((r: any) => r.status === status)?.queries);
      return [{ label: 'Queries', value: queries }, blocked(count('blocked'), queries), { label: 'Allowed', value: count('allowed') }];
    },
    sample: { status: { data: [{ status: 'default', queries: 80000 }, { status: 'blocked', queries: 20000 }, { status: 'allowed', queries: 500 }] } },
    sampleOptions: { profile: 'abc123' },
    expect: { Queries: '100,500', Blocked: '20,000', Allowed: 500 },
  }),
  service({
    type: 'technitium', name: 'Technitium DNS', icon: 'shield', auth: { query: 'token' },
    get: { dash: '/api/dashboard/stats/get?type=LastDay&utc=true' },
    stats: d => {
      if (d.dash?.status !== 'ok') throw new Error(`Technitium DNS said ${d.dash?.status ?? 'nothing'}`);     // a bad token still answers 200
      const s = d.dash.response?.stats, queries = num(s?.totalQueries);
      return [{ label: 'Queries', value: queries }, blocked(num(s?.totalBlocked), queries),
        { label: 'Cached', value: num(s?.totalCached) }, { label: 'Clients', value: num(s?.totalClients) }];
    },
    sample: { dash: { status: 'ok', response: { stats: { totalQueries: 31000, totalBlocked: 3100, totalCached: 12000, totalClients: 14 } } } },
    expect: { Queries: '31,000', Blocked: '3,100', Cached: '12,000', Clients: 14 },
  }),

  // Reverse proxies
  service({
    type: 'caddy', name: 'Caddy', icon: 'wifi',                        // the admin API, :2019 by default
    get: { upstreams: '/reverse_proxy/upstreams' },
    stats: d => {
      const fails = sum(d.upstreams, u => u.fails);
      return [{ label: 'Upstreams', value: d.upstreams?.length ?? 0 }, { label: 'Active requests', value: sum(d.upstreams, u => u.num_requests) },
        { label: 'Failures', value: fails, tone: fails ? 'bad' : undefined }];
    },
    sample: { upstreams: [{ address: '10.0.0.5:8080', num_requests: 3, fails: 0 }, { address: '10.0.0.6:3000', num_requests: 1, fails: 2 }] },
    expect: { Upstreams: 2, 'Active requests': 4, Failures: 2 },
  }),
  service({
    type: 'nginx-proxy-manager', name: 'Nginx Proxy Manager', icon: 'wifi',
    auth: { login: '/api/tokens', body: c => ({ identity: c.username, secret: c.password }), token: r => r.token },
    get: { hosts: '/api/nginx/proxy-hosts' },
    stats: d => {
      const hosts = d.hosts ?? [], on = hosts.filter((h: any) => h.enabled).length;
      return [{ label: 'Enabled', value: on }, { label: 'Disabled', value: hosts.length - on }, { label: 'Hosts', value: hosts.length }];
    },
    sample: { hosts: [{ id: 1, domain_names: ['a.example.com'], enabled: 1 }, { id: 2, domain_names: ['b.example.com'], enabled: 1 }, { id: 3, domain_names: ['c.example.com'], enabled: 0 }] },
    expect: { Enabled: 2, Disabled: 1, Hosts: 3 },
  }),
  service({
    type: 'swag', name: 'SWAG', icon: 'wifi',                          // the dashboard mod, port 81
    get: { overview: '/?stats=true' },
    stats: d => [{ label: 'Proxied', value: num(d.overview?.proxied) }, { label: 'With auth', value: num(d.overview?.auth) },
      { label: 'Outdated', value: num(d.overview?.outdated) }, { label: 'Banned', value: num(d.overview?.banned) }],
    sample: { overview: { proxied: 14, auth: 9, outdated: 1, banned: 37 } },
    expect: { Proxied: 14, 'With auth': 9, Outdated: 1, Banned: 37 },
  }),
  service({
    type: 'traefik', name: 'Traefik', icon: 'wifi',
    get: { overview: '/api/overview' },
    stats: d => {
      const http = d.overview?.http, parts = [http?.routers, http?.services, http?.middlewares], errors = sum(parts, p => p?.errors), warnings = sum(parts, p => p?.warnings);
      return [{ label: 'Routers', value: num(http?.routers?.total) }, { label: 'Services', value: num(http?.services?.total) }, { label: 'Middlewares', value: num(http?.middlewares?.total) },
        { label: 'Errors', value: errors, tone: errors ? 'bad' : undefined }, { label: 'Warnings', value: warnings, tone: warnings ? 'warn' : undefined }];
    },
    sample: { overview: { http: { routers: { total: 18, warnings: 1, errors: 0 }, services: { total: 20, warnings: 0, errors: 1 }, middlewares: { total: 6, warnings: 0, errors: 0 } }, tcp: { routers: { total: 0, warnings: 0, errors: 0 } } } },
    expect: { Routers: 18, Services: 20, Middlewares: 6, Errors: 1, Warnings: 1 },
  }),

  // Tunnels and mesh VPNs
  service<{ account: string; tunnel: string }>({
    type: 'cloudflared', name: 'Cloudflare Tunnel', icon: 'wifi', logo: 'cloudflare', auth: 'bearer',
    options: { ...hosted('https://api.cloudflare.com/client/v4', 'https://one.dash.cloudflare.com'), account: z.string(), tunnel: z.string() },
    get: o => ({ tunnel: `/accounts/${o.account}/cfd_tunnel/${o.tunnel}`, connections: `/accounts/${o.account}/cfd_tunnel/${o.tunnel}/connections` }),
    stats: d => {
      const status: string = d.tunnel?.result?.status ?? 'unknown', connectors = d.connections?.result ?? [];
      const conns = connectors.flatMap((c: any) => c.conns ?? []);
      return [{ label: 'Status', value: status[0].toUpperCase() + status.slice(1), tone: status === 'healthy' ? 'good' : status === 'degraded' ? 'warn' : 'bad' },
        { label: 'Connectors', value: connectors.length }, { label: 'Connections', value: conns.length },
        { label: 'Data centers', value: [...new Set(conns.map((c: any) => c.colo_name).filter(Boolean))].join(', ') || undefined }];
    },
    sample: { tunnel: { success: true, result: { id: 't1', name: 'home', status: 'healthy' } },
      connections: { success: true, result: [{ id: 'c1', conns: [{ colo_name: 'lhr01', origin_ip: '203.0.113.5' }, { colo_name: 'lhr01', origin_ip: '203.0.113.5' }, { colo_name: 'man01', origin_ip: '203.0.113.5' }, { colo_name: 'man01', origin_ip: '203.0.113.5' }] }] } },
    sampleOptions: { account: 'a1', tunnel: 't1' },
    expect: { Status: 'Healthy', Connectors: 1, Connections: 4, 'Data centers': 'lhr01, man01' },
  }),
  service({
    type: 'headscale', name: 'Headscale', icon: 'wifi', auth: 'bearer',
    get: { nodes: '/api/v1/node', users: { path: '/api/v1/user', optional: true } },
    stats: d => {
      const nodes = d.nodes?.nodes ?? [];
      return [{ label: 'Online', value: of(nodes.filter((n: any) => n.online).length, nodes.length) }, ...(d.users ? [{ label: 'Users', value: d.users.users?.length ?? 0 }] : [])];
    },
    sample: { nodes: { nodes: [{ id: '1', givenName: 'nas', online: true }, { id: '2', givenName: 'phone', online: true }, { id: '3', givenName: 'laptop', online: false }] }, users: { users: [{ id: '1', name: 'me' }, { id: '2', name: 'them' }] } },
    expect: { Online: '2 / 3', Users: 2 },
  }),
  service({
    type: 'netbird', name: 'NetBird', icon: 'wifi', auth: 'token',
    get: { peers: '/api/peers', users: '/api/users' },
    stats: d => {
      const peers = d.peers ?? [], expired = peers.filter((p: any) => p.login_expired).length;
      return [{ label: 'Online', value: of(peers.filter((p: any) => p.connected).length, peers.length) },
        { label: 'Users', value: (d.users ?? []).filter((u: any) => !u.is_service_user).length },
        { label: 'Login expired', value: expired, tone: expired ? 'warn' : undefined }];
    },
    sample: { peers: [{ id: 'p1', connected: true, login_expired: false }, { id: 'p2', connected: false, login_expired: true }], users: [{ id: 'u1', is_service_user: false }, { id: 'u2', is_service_user: true }] },
    expect: { Online: '1 / 2', Users: 1, 'Login expired': 1 },
  }),
  service({
    type: 'tailscale', name: 'Tailscale', icon: 'wifi', auth: 'bearer',
    options: hosted('https://api.tailscale.com/api/v2', 'https://login.tailscale.com/admin/machines'),
    get: { list: '/tailnet/-/devices' },                               // "-" is the tailnet the key belongs to
    stats: d => {
      const devices = d.list?.devices ?? [], recent = Date.now() - 5 * 60_000;
      return [{ label: 'Devices', value: devices.length }, { label: 'Seen in last 5 min', value: devices.filter((x: any) => new Date(x.lastSeen).getTime() > recent).length },
        { label: 'Updates available', value: devices.filter((x: any) => x.updateAvailable).length }];
    },
    sample: { list: { devices: [{ name: 'nas.tail1234.ts.net', lastSeen: new Date().toISOString(), updateAvailable: true }, { name: 'phone.tail1234.ts.net', lastSeen: '2026-01-02T03:04:05Z', updateAvailable: false }] } },
    expect: { Devices: 2, 'Seen in last 5 min': 1, 'Updates available': 1 },
  }),
  service({
    type: 'wg-easy', name: 'wg-easy', icon: 'wifi', logo: 'wireguard', auth: 'basic',       // v15 onwards
    get: { clients: '/api/client' },
    stats: d => {
      const clients = d.clients ?? [], on = clients.filter((c: any) => c.enabled).length, recent = Date.now() - 3 * 60_000;      // peers shake hands every two minutes
      return [{ label: 'Connected', value: clients.filter((c: any) => c.latestHandshakeAt && new Date(c.latestHandshakeAt).getTime() > recent).length },
        { label: 'Enabled', value: on }, { label: 'Disabled', value: clients.length - on },
        { label: 'Received', value: fmt.bytes(sum(clients, c => c.transferRx)) }, { label: 'Sent', value: fmt.bytes(sum(clients, c => c.transferTx)) }];
    },
    sample: { clients: [{ name: 'phone', enabled: true, latestHandshakeAt: new Date(Date.now() - 30_000).toISOString(), transferRx: 1048576, transferTx: 3145728 }, { name: 'laptop', enabled: true, latestHandshakeAt: null, transferRx: 0, transferTx: 0 }, { name: 'old', enabled: false, latestHandshakeAt: '2026-01-02T03:04:05.000Z', transferRx: 1048576, transferTx: 0 }] },
    expect: { Connected: 1, Enabled: 2, Disabled: 1, Received: '2.0 MB', Sent: '3.0 MB' },
  }),
  service<{ org: string }>({
    type: 'pangolin', name: 'Pangolin', icon: 'wifi', auth: 'bearer',
    options: { org: z.string() },
    get: o => ({ sites: `/v1/org/${o.org}/sites`, resources: `/v1/org/${o.org}/resources?pageSize=200` }),
    stats: d => {
      const sites = d.sites?.data?.sites ?? [], resources = d.resources?.data?.resources ?? [];
      const targets = resources.flatMap((r: any) => r.targets ?? []), bad = targets.filter((t: any) => t.healthStatus === 'unhealthy').length;
      return [{ label: 'Sites online', value: of(sites.filter((s: any) => s.online).length, sites.length) }, { label: 'Resources', value: resources.length },
        { label: 'Unhealthy targets', value: bad, tone: bad ? 'bad' : undefined },
        { label: 'Traffic in', value: fmt.bytes(sum(sites, s => s.megabytesIn) * 1e6) }, { label: 'Traffic out', value: fmt.bytes(sum(sites, s => s.megabytesOut) * 1e6) }];
    },
    sample: { sites: { data: { sites: [{ name: 'home', online: true, megabytesIn: 1073.741824, megabytesOut: 2147.483648 }, { name: 'cabin', online: false, megabytesIn: 0, megabytesOut: 0 }] } },
      resources: { data: { resources: [{ name: 'app', targets: [{ healthStatus: 'healthy' }, { healthStatus: 'unhealthy' }] }, { name: 'files', targets: [] }] } } },
    sampleOptions: { org: 'home' },
    expect: { 'Sites online': '1 / 2', Resources: 2, 'Unhealthy targets': 1, 'Traffic in': '1.0 GB', 'Traffic out': '2.0 GB' },
  }),

  // Routers, firewalls and what's on the network
  service({
    type: 'mikrotik', name: 'MikroTik', icon: 'wifi', auth: 'basic',
    get: { system: '/rest/system/resource', leases: { path: '/rest/ip/dhcp-server/lease?.proplist=address', optional: true } },
    stats: d => {
      const s = d.system, total = num(s?.['total-memory']), used = share(total - num(s?.['free-memory']), total), cpu = num(s?.['cpu-load']);
      return [{ label: 'CPU', value: percent(cpu), pct: cpu / 100 }, { label: 'Memory', value: used == null ? undefined : fmt.pct(used), pct: used },
        { label: 'Uptime', value: s?.uptime }, ...(d.leases ? [{ label: 'DHCP leases', value: d.leases.length }] : [])];
    },
    sample: { system: { uptime: '2w3d4h5m6s', 'cpu-load': '7', 'free-memory': '805306368', 'total-memory': '1073741824' }, leases: [{ '.id': '*1', address: '192.168.88.10' }, { '.id': '*2', address: '192.168.88.11' }] },
    expect: { CPU: '7%', Memory: '25%', Uptime: '2w3d4h5m6s', 'DHCP leases': 2 },
  }),
  service<{ wan: string }>({
    type: 'opnsense', name: 'OPNsense', icon: 'shield', auth: 'basic',   // username and password are the API key and secret
    options: { wan: z.string().default('wan') },
    get: { activity: '/api/diagnostics/activity/getActivity', traffic: '/api/diagnostics/traffic/interface' },
    stats: (d, o) => {
      const top = (d.activity?.headers ?? []).join('\n'), idle = top.match(/([\d.]+)% idle/)?.[1], wan = d.traffic?.interfaces?.[o.wan];
      return [{ label: 'CPU', value: percent(idle == null ? undefined : 100 - Number(idle)) }, { label: 'Memory', value: top.match(/Mem: (\S+) Active/)?.[1] },
        { label: 'WAN received', value: wan ? fmt.bytes(num(wan['bytes received'])) : undefined }, { label: 'WAN sent', value: wan ? fmt.bytes(num(wan['bytes transmitted'])) : undefined }];
    },
    sample: { activity: { headers: ['last pid: 74125;  load averages:  0.21,  0.19,  0.18  up 12+03:45:10    12:00:00', '52 processes:  1 running, 51 sleeping',
      'CPU:  2.0% user,  0.0% nice,  1.5% system,  0.5% interrupt, 96.0% idle', 'Mem: 322M Active, 1024M Inact, 612M Wired, 5900M Free', 'Swap: 8192M Total, 8192M Free'] },
    traffic: { interfaces: { wan: { name: 'WAN', 'bytes received': '5368709120', 'bytes transmitted': '1073741824' } } } },
    expect: { CPU: '4%', Memory: '322M', 'WAN received': '5.0 GB', 'WAN sent': '1.0 GB' },
  }),
  service<{ wan: string }>({
    type: 'pfsense', name: 'pfSense', icon: 'shield', auth: { header: 'X-API-Key' },         // needs the pfSense REST API package, v2
    options: { wan: z.string().default('wan') },                       // the interface's name, or its device such as igb0
    get: { system: '/api/v2/status/system', interfaces: '/api/v2/status/interfaces?limit=0&offset=0' },
    stats: (d, o) => {
      const s = d.system?.data, wan = (d.interfaces?.data ?? []).find((i: any) => i.hwif === o.wan || i.name === o.wan);
      return [{ label: 'WAN', value: wan ? (wan.status === 'up' ? 'Up' : 'Down') : undefined, tone: wan ? (wan.status === 'up' ? 'good' : 'bad') : undefined },
        { label: 'Load', value: s?.cpu_load_avg?.[0] }, { label: 'Memory', value: percent(s?.mem_usage) }, { label: 'Disk', value: percent(s?.disk_usage) },
        { label: 'Temperature', value: s?.temp_c == null ? undefined : `${Math.round(s.temp_c)}°C` }];
    },
    sample: { system: { code: 200, status: 'ok', data: { cpu_load_avg: [0.32, 0.28, 0.25], mem_usage: 18.4, disk_usage: 6.1, temp_c: 47.2 } }, interfaces: { code: 200, status: 'ok', data: [{ name: 'wan', hwif: 'igb0', status: 'up', ipaddr: '203.0.113.5' }, { name: 'lan', hwif: 'igb1', status: 'up', ipaddr: '192.168.1.1' }] } },
    expect: { WAN: 'Up', Load: 0.32, Memory: '18%', Disk: '6%', Temperature: '47°C' },
  }),
  service<{ site: string }>({
    type: 'unifi', name: 'UniFi', icon: 'wifi', auth: { header: 'X-API-KEY' },              // a key from UniFi OS; older controllers have none
    options: { site: z.string().default('default') },
    get: { sites: '/proxy/network/api/stat/sites' },
    stats: (d, o) => {
      const site = d.sites?.data?.find((s: any) => s.name === o.site || s.desc === o.site), health = site?.health ?? [];
      const part = (name: string) => health.find((h: any) => h.subsystem === name), wan = part('wan'), up = wan?.['gw_system-stats']?.uptime;
      const known = wan?.status && wan.status !== 'unknown';
      return [{ label: 'WAN', value: known ? (wan.status === 'ok' ? 'Up' : 'Down') : undefined, tone: known ? (wan.status === 'ok' ? 'good' : 'bad') : undefined },
        { label: 'Wi-Fi clients', value: num(part('wlan')?.num_user) }, { label: 'Wired clients', value: num(part('lan')?.num_user) },
        { label: 'Devices', value: sum(health, h => h.num_adopted) }, { label: 'Uptime', value: up == null ? undefined : fmt.duration(num(up)) }];
    },
    sample: { sites: { meta: { rc: 'ok' }, data: [{ name: 'default', desc: 'Default', health: [{ subsystem: 'wan', status: 'ok', num_adopted: 1, 'gw_system-stats': { uptime: '187200' } }, { subsystem: 'lan', status: 'ok', num_user: 6, num_adopted: 2 }, { subsystem: 'wlan', status: 'ok', num_user: 21, num_adopted: 3 }] }] } },
    expect: { WAN: 'Up', 'Wi-Fi clients': 21, 'Wired clients': 6, Devices: 6, Uptime: '2d 4h' },
  }),
  service({
    type: 'netalertx', name: 'NetAlertX', icon: 'wifi', auth: 'bearer',  // the backend port, 20212 by default
    get: { totals: '/devices/totals' },
    stats: d => {
      const [total, connected, , fresh, down] = (d.totals ?? []).map(num);          // all, connected, favourites, new, down, archived
      return [{ label: 'Devices', value: total ?? 0 }, { label: 'Connected', value: connected ?? 0 }, { label: 'New', value: fresh ?? 0 },
        { label: 'Down', value: down ?? 0, tone: down ? 'bad' : undefined }];
    },
    sample: { totals: [42, 31, 5, 2, 1, 0] },
    expect: { Devices: 42, Connected: 31, New: 2, Down: 1 },
  }),
  service({
    type: 'gatus', name: 'Gatus', icon: 'pulse',
    get: { endpoints: '/api/v1/endpoints/statuses' },
    status: d => (d.endpoints ?? []).filter((e: any) => e.results?.length).map((e: any) => {
      const last = e.results.at(-1);                                   // oldest first; an endpoint with none hasn't been checked yet
      return { name: e.name, ok: last.success === true, ms: last.duration == null ? undefined : Math.round(last.duration / 1e6), group: e.group || undefined };   // nanoseconds
    }),
    sample: { endpoints: [{ name: 'Website', group: 'public', key: 'public_website', results: [{ status: 200, duration: 90000000, success: false }, { status: 200, duration: 120000000, success: true }] },
      { name: 'Database', group: '', key: '_database', results: [{ status: 0, duration: 5000000000, success: false }] }, { name: 'New', key: '_new', results: [] }] },
    expect: { Website: 'true', Database: 'false' },
  }),

  // Speed tests
  service<{ password?: string }>({
    type: 'myspeed', name: 'MySpeed', icon: 'chart',
    options: { password: z.string().optional() },                      // only if the instance has one
    get: o => ({ latest: { path: '/api/speedtests?limit=1', headers: o.password ? { Password: o.password } : undefined } }),
    stats: d => { const t = d.latest?.[0]; return [{ label: 'Download', value: mbps(t?.download) }, { label: 'Upload', value: mbps(t?.upload) }, { label: 'Ping', value: ms(t?.ping) }]; },
    sample: { latest: [{ id: 412, ping: 14, download: 512.34, upload: 48.9, time: 18, type: 'auto', created: '2026-10-30T12:00:00.000Z' }] },
    expect: { Download: '512 Mbps', Upload: '49 Mbps', Ping: '14 ms' },
  }),
  service({
    type: 'speedtest-tracker', name: 'Speedtest Tracker', icon: 'chart', auth: 'bearer',
    get: { latest: '/api/v1/results/latest' },
    stats: d => {
      const t = d.latest?.data, bits = (v: unknown) => v == null ? undefined : mbps(num(v) * 8 / 1e6);   // bytes a second
      return [{ label: 'Download', value: bits(t?.download) }, { label: 'Upload', value: bits(t?.upload) }, { label: 'Ping', value: ms(t?.ping) }];
    },
    sample: { latest: { message: 'ok', data: { id: 88, ping: 11.8, download: 117500000, upload: 12500000, status: 'completed' } } },
    expect: { Download: '940 Mbps', Upload: '100 Mbps', Ping: '12 ms' },
  }),

  // Sign-in and intrusion
  service({
    type: 'authentik', name: 'authentik', icon: 'shield', auth: 'bearer',
    get: { users: '/api/v3/core/users/?page_size=1', events: { path: '/api/v3/events/events/volume/?actions=login&actions=login_failed&actions=authorize_application&history_days=1', optional: true } },
    stats: d => {
      const count = (action: string) => sum(d.events?.filter((e: any) => e.action === action), e => e.count), failed = count('login_failed');
      return [{ label: 'Users', value: num(d.users?.pagination?.count) }, ...(d.events ? [{ label: 'Logins, 24h', value: count('login') },
        { label: 'Failed, 24h', value: failed, tone: failed ? 'warn' as const : undefined }, { label: 'Authorizations, 24h', value: count('authorize_application') }] : [])];
    },
    sample: { users: { pagination: { count: 12, current: 1, total_pages: 12 }, results: [{ pk: 1, username: 'akadmin' }] },
      events: [{ action: 'login', time: '2026-10-30T10:00:00Z', count: 5 }, { action: 'login', time: '2026-10-30T11:00:00Z', count: 2 }, { action: 'login_failed', time: '2026-10-30T11:00:00Z', count: 1 }, { action: 'authorize_application', time: '2026-10-30T11:00:00Z', count: 9 }] },
    expect: { Users: 12, 'Logins, 24h': 7, 'Failed, 24h': 1, 'Authorizations, 24h': 9 },
  }),
  service({
    type: 'authelia', name: 'Authelia', icon: 'shield',                // no stats API: the url is its metrics listener, :9959 once telemetry is enabled
    about: "Authelia's sign-in and request counts since it last restarted.",
    get: { metrics: { path: '/metrics', as: 'text' } },
    stats: d => {
      const count = (metric: string, label?: string) => [...String(d.metrics ?? '').matchAll(new RegExp(`^authelia_${metric}(?:_total)?(?:\\{([^}]*)\\})? (\\S+)$`, 'gm'))]
        .filter(m => !label || m[1]?.includes(label)).reduce((n, m) => n + num(m[2]), 0);
      const failed = count('authn', 'success="false"');
      return [{ label: 'Logins', value: count('authn', 'success="true"') }, { label: 'Failed logins', value: failed, tone: failed ? 'warn' : undefined },
        { label: 'Second factors', value: count('authn_second_factor', 'success="true"') }, { label: 'Requests', value: count('request') }];
    },
    sample: { metrics: ['# TYPE authelia_authn counter', 'authelia_authn{banned="false",success="false"} 3', 'authelia_authn{banned="false",success="true"} 40', 'authelia_authn{banned="true",success="false"} 1',
      'authelia_authn_second_factor{banned="false",success="true",type="totp"} 12', 'authelia_request{code="200",method="GET"} 1500', 'authelia_request{code="401",method="GET"} 20'].join('\n') },
    expect: { Logins: 40, 'Failed logins': 4, 'Second factors': 12, Requests: '1,520' },
  }),
  service({
    type: 'crowdsec', name: 'CrowdSec', icon: 'shield',                // username and password are a machine's id and password
    auth: { login: '/v1/watchers/login', body: c => ({ machine_id: c.username, password: c.password, scenarios: [] }), token: r => r.token },
    get: {
      alerts: '/v1/alerts?limit=500&since=24h&with_decisions=false&include_capi=false',
      bans: '/v1/alerts?decision_type=ban&include_capi=false&has_active_decision=1&with_decisions=false',
    },
    stats: d => {
      const alerts = d.alerts?.length ?? 0;                            // both are a literal null when empty
      return [{ label: 'Alerts, 24h', value: alerts >= 500 ? '500+' : alerts }, { label: 'Active bans', value: d.bans?.length ?? 0 }];
    },
    sample: { alerts: [{ id: 901, scenario: 'crowdsecurity/ssh-bf' }, { id: 902, scenario: 'crowdsecurity/http-probing' }, { id: 903, scenario: 'crowdsecurity/ssh-bf' }], bans: [{ id: 901, scenario: 'crowdsecurity/ssh-bf' }] },
    expect: { 'Alerts, 24h': 3, 'Active bans': 1 },
  }),
  service({
    type: 'openwrt', name: 'OpenWrt', icon: 'wifi',
    auth: { login: '/ubus', token: r => r?.result?.[1]?.ubus_rpc_session, use: () => ({}), expired: a => a?.error?.code === -32002,
      body: c => ({ jsonrpc: '2.0', id: 1, method: 'call', params: ['00000000000000000000000000000000', 'session', 'login', { username: c.username, password: c.password }] }) },
    get: o => ({ info: { path: '/ubus', method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'call', params: [o.session, 'system', 'info', {}] } } }),
    stats: d => { const i = d.info?.result?.[1] ?? {}, m = i.memory ?? {}; return [{ label: 'Up for', value: fmt.duration(i.uptime ?? 0) }, { label: 'Load', value: ((i.load?.[0] ?? 0) / 65536).toFixed(2) }, { label: 'Memory used', value: fmt.pct(m.total ? 1 - (m.free ?? 0) / m.total : 0) }]; },
    sample: { info: { result: [0, { uptime: 7200, load: [32768, 0, 0], memory: { total: 1000, free: 250 } }] } },
    loginSample: { result: [0, { ubus_rpc_session: 'abc' }] },
    expect: { Load: '0.50', 'Memory used': fmt.pct(.75) },
  }),
  service({
    type: 'unifi-drive', name: 'UniFi Drive', logo: 'unifi', icon: 'disk', auth: { login: '/api/auth/login' },
    get: { storage: '/proxy/drive/api/v2/storage' },
    stats: d => { const p = (d.storage?.pools ?? []) as any[], total = p.reduce((s, x) => s + (x.capacity ?? 0), 0), used = p.reduce((s, x) => s + (x.usage ?? 0), 0); return [{ label: 'Used', value: fmt.bytes(used), pct: total ? used / total : 0 }, { label: 'Free', value: fmt.bytes(Math.max(0, total - used)) }, { label: 'Total', value: fmt.bytes(total) }]; },
    sample: { storage: { pools: [{ capacity: 2000, usage: 500 }] } },
    expect: { Used: fmt.bytes(500), Total: fmt.bytes(2000) },
  }),
];
