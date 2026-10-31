// Servers, storage and what watches over them. See media.ts for the shape of an entry.
import { z } from 'zod';
import { fmt, service, tally } from '../../server/service.ts';

// For services that run open by default and only sometimes ask for a sign-in, so nothing here can be required.
type Creds = { key?: string; username?: string; password?: string };
const key = { key: z.string().optional() }, userpass = { username: z.string().optional(), password: z.string().optional() }, creds = { ...key, ...userpass };
const basic = (o: Creds): Record<string, string> => o.username ? { Authorization: `Basic ${Buffer.from(`${o.username}:${o.password ?? ''}`).toString('base64')}` } : {};
const bearer = (o: Creds): Record<string, string> => o.key ? { Authorization: `Bearer ${o.key}` } : {};
const env = { env: z.union([z.number(), z.string()]) };   // the number in the app's own URL

const share = (used = 0, total = 0) => total > 0 ? Math.min(Math.max((used || 0) / total, 0), 1) : 0;
const meter = (label: string, used = 0, total = 0, sub?: string) => ({ label, value: fmt.pct(share(used, total)), pct: share(used, total), ...(sub ? { sub } : {}) });
const alarm = (label: string, n: number) => ({ label, value: n, tone: n ? 'bad' as const : 'good' as const });
const of = (some = 0, all = 0) => `${some} / ${all}`;
const sum = <T>(items: T[], pick: (i: T) => unknown) => items.reduce((n, i) => n + (Number(pick(i)) || 0), 0);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
// fmt.duration stops at 100 days, and servers go longer
const uptime = (s = 0) => s >= 86400 ? `${Math.floor(s / 86400)}d` : fmt.duration(s);
const ago = (t?: string | number | null) => {
  const when = t == null || t === '' ? NaN : new Date(t).getTime(), s = (Date.now() - when) / 1000;
  return Number.isNaN(when) ? 'Never' : s >= 0 && s < 8640000 ? `${fmt.duration(s)} ago` : fmt.day(when)!;
};
const kw = (w = 0) => Math.round(w / 10) / 100;

const PROXMOX_TYPES = ['qemu', 'lxc'];

export default [
  // Virtual machines
  service<{ node?: string; vmid?: number }>({
    type: 'proxmox', name: 'Proxmox', icon: 'cpu', auth: { header: 'Authorization', prefix: 'PVEAPIToken=' },   // key: user@pam!tokenid=secret
    options: { node: z.string().optional(), vmid: z.number().optional() },   // one node, or just one VM or container
    get: { resources: '/api2/json/cluster/resources' },
    stats: (d, o) => {
      const all = list(d.resources?.data).filter(r => !o.node || r.node === o.node);
      if (o.vmid != null) {
        const vm = all.find(r => PROXMOX_TYPES.includes(r.type) && r.vmid === o.vmid);
        if (!vm) return [{ label: 'Status', value: 'Not found' }];
        const on = vm.status === 'running';
        return [{ label: 'Status', value: vm.status ?? 'unknown', tone: on ? 'good' : 'neutral', sub: vm.name },
          ...(on ? [meter('CPU', vm.cpu, 1), meter('Memory', vm.mem, vm.maxmem, `of ${fmt.bytes(vm.maxmem ?? 0)}`), { label: 'Uptime', value: uptime(vm.uptime) }] : [])];
      }
      const guests = (type: string) => all.filter(r => r.type === type && !r.template), running = (g: any[]) => g.filter(r => r.status === 'running').length;
      const vms = guests('qemu'), lxc = guests('lxc'), hosts = all.filter(r => r.type === 'node'), online = hosts.filter(r => r.status === 'online');
      const memory = sum(online, n => n.maxmem);
      return [{ label: 'VMs', value: of(running(vms), vms.length) }, { label: 'Containers', value: of(running(lxc), lxc.length) },
        meter('CPU', sum(online, n => n.cpu * n.maxcpu), sum(online, n => n.maxcpu)), meter('Memory', sum(online, n => n.mem), memory, `of ${fmt.bytes(memory)}`),
        { label: 'Nodes', value: of(online.length, hosts.length), tone: online.length < hosts.length ? 'bad' : 'good' }];
    },
    recap: (d, o) => tally(list(d.resources?.data).filter(r => PROXMOX_TYPES.includes(r.type) && (!o.node || r.node === o.node)).length, { id: 'proxmox.guests', theme: 'hardware', icon: 'cpu', kicker: 'Proxmox is running', unit: 'machines', stat: 'Virtual machines', line: 'Whole computers inside your computer.' }),
    sample: { resources: { data: [
      { id: 'node/pve', type: 'node', node: 'pve', status: 'online', cpu: 0.25, maxcpu: 16, mem: 34359738368, maxmem: 68719476736, uptime: 1209600 },
      { id: 'node/pve2', type: 'node', node: 'pve2', status: 'offline' },
      { id: 'qemu/100', type: 'qemu', vmid: 100, name: 'haos', node: 'pve', status: 'running', cpu: 0.04, mem: 2147483648, maxmem: 4294967296, uptime: 86400, template: 0 },
      { id: 'qemu/101', type: 'qemu', vmid: 101, name: 'windows', node: 'pve', status: 'stopped', cpu: 0, mem: 0, maxmem: 8589934592, uptime: 0, template: 0 },
      { id: 'qemu/9000', type: 'qemu', vmid: 9000, name: 'debian-template', node: 'pve', status: 'stopped', template: 1 },
      { id: 'lxc/200', type: 'lxc', vmid: 200, name: 'pihole', node: 'pve', status: 'running', cpu: 0.01, mem: 268435456, maxmem: 536870912, uptime: 86400, template: 0 },
      { id: 'storage/pve/local', type: 'storage', node: 'pve', status: 'available' }] } },
    expect: { VMs: '1 / 2', Containers: '1 / 1', CPU: '25%', Memory: '50%', Nodes: '1 / 2' },
  }),
  service<{ datastore?: string }>({
    type: 'proxmox-backup', name: 'Proxmox Backup Server', icon: 'shield', logo: 'proxmox', auth: { header: 'Authorization', prefix: 'PBSAPIToken=' },   // key: user@pbs!tokenid:secret
    options: { datastore: z.string().optional() },
    get: () => ({ stores: '/api2/json/status/datastore-usage', host: '/api2/json/nodes/localhost/status',
      failed: `/api2/json/nodes/localhost/tasks?errors=true&limit=100&since=${Math.floor(Date.now() / 1000) - 86400}` }),
    stats: (d, o) => {
      const stores = list(d.stores?.data).filter(s => !o.datastore || s.store === o.datastore), used = sum(stores, s => s.used), total = sum(stores, s => s.total);
      const failed = d.failed?.total ?? list(d.failed?.data).length;
      return [meter('Datastore', used, total, `${fmt.bytes(total - used)} free`), { label: 'Failed today', value: failed >= 100 ? '99+' : failed, tone: failed ? 'bad' : 'good' },
        meter('CPU', d.host?.data?.cpu, 1), meter('Memory', d.host?.data?.memory?.used, d.host?.data?.memory?.total)];
    },
    sample: { stores: { data: [{ store: 'main', total: 4000000000000, used: 1000000000000, avail: 3000000000000 }, { store: 'offsite', total: 1000000000000, used: 250000000000, avail: 750000000000 }] },
      host: { data: { cpu: 0.12, memory: { used: 4294967296, total: 17179869184 } } }, failed: { data: [{ upid: 'UPID:pbs:1', status: 'error' }], total: 1 } },
    expect: { Datastore: '25%', 'Failed today': 1, CPU: '12%', Memory: '25%' },
  }),
  service({
    type: 'pulse', name: 'Pulse', icon: 'pulse', auth: { header: 'X-API-Token' },
    get: { summary: { path: '/api/state/summary', optional: true }, resources: { path: '/api/resources', optional: true } },   // v6 has the first, older ones the second
    stats: d => {
      if (d.summary) return [{ label: 'Nodes', value: d.summary.nodes ?? 0 }, { label: 'VMs', value: d.summary.vms ?? 0 }, { label: 'Containers', value: d.summary.containers ?? 0 }];
      if (!d.resources) throw new Error('Pulse refused both of its endpoints');
      const all = list(d.resources.resources), up = (type: string) => all.filter(r => r.type === type && ['online', 'running'].includes(r.status)).length;
      const count = (type: string) => d.resources.stats?.byType?.[type] ?? all.filter(r => r.type === type).length;
      return [{ label: 'Nodes', value: of(up('node'), count('node')) }, { label: 'VMs', value: of(up('vm'), count('vm')) }, { label: 'Containers', value: of(up('container'), count('container')) }];
    },
    sample: { summary: { nodes: 2, vms: 7, containers: 12 }, resources: { resources: [{ type: 'node', status: 'online' }], stats: { byType: { node: 1 } } } },
    expect: { Nodes: 2, VMs: 7, Containers: 12 },
  }),

  // Containers
  service<{ env: number | string }>({
    type: 'portainer', name: 'Portainer', icon: 'cpu', auth: { header: 'X-API-Key' }, options: env,
    get: o => ({ containers: `/api/endpoints/${o.env}/docker/containers/json?all=1` }),
    stats: d => {
      const all = list(d.containers), running = all.filter(c => c.State === 'running').length, sick = all.filter(c => /unhealthy/.test(c.Status ?? '')).length;
      return [{ label: 'Running', value: running }, { label: 'Stopped', value: all.length - running }, { label: 'Total', value: all.length }, alarm('Unhealthy', sick)];
    },
    sampleOptions: { env: 2 },
    sample: { containers: [{ State: 'running', Status: 'Up 2 hours (healthy)' }, { State: 'running', Status: 'Up 2 days (unhealthy)' }, { State: 'exited', Status: 'Exited (0) 3 days ago' }] },
    expect: { Running: 2, Stopped: 1, Total: 3, Unhealthy: 1 },
  }),
  service<{ env: number | string }>({
    type: 'portainer-kubernetes', name: 'Portainer', icon: 'cpu', logo: 'portainer', auth: { header: 'X-API-Key' }, options: env,
    get: o => ({ applications: `/api/kubernetes/${o.env}/applications/count`, services: `/api/kubernetes/${o.env}/services/count`, namespaces: `/api/kubernetes/${o.env}/namespaces/count` }),
    stats: d => [{ label: 'Applications', value: d.applications ?? 0 }, { label: 'Services', value: d.services ?? 0 }, { label: 'Namespaces', value: d.namespaces ?? 0 }],
    sampleOptions: { env: 3 },
    sample: { applications: 14, services: 22, namespaces: 6 },
    expect: { Applications: 14, Services: 22, Namespaces: 6 },
  }),
  service<{ env: number | string }>({
    type: 'arcane', name: 'Arcane', icon: 'cpu', auth: { header: 'X-API-Key' }, options: env,
    get: o => ({ containers: `/api/environments/${o.env}/containers/counts`, images: `/api/environments/${o.env}/images/counts`, updates: `/api/environments/${o.env}/image-updates/summary` }),
    stats: d => [{ label: 'Running', value: d.containers?.data?.runningContainers ?? 0 }, { label: 'Stopped', value: d.containers?.data?.stoppedContainers ?? 0 },
      { label: 'Images', value: d.images?.data?.totalImages ?? 0 }, { label: 'Updates', value: d.updates?.data?.imagesWithUpdates ?? 0 }],
    sampleOptions: { env: '0' },
    sample: { containers: { success: true, data: { runningContainers: 18, stoppedContainers: 2, totalContainers: 20 } }, images: { success: true, data: { totalImages: 41, imagesInuse: 20, imagesUnused: 21 } },
      updates: { success: true, data: { imagesWithUpdates: 3 } } },
    expect: { Running: 18, Stopped: 2, Images: 41, Updates: 3 },
  }),
  service<Creds>({
    type: 'dockhand', name: 'Dockhand', icon: 'cpu', options: key,
    get: o => ({ stats: { path: '/api/dashboard/stats', headers: bearer(o) } }),
    stats: d => {
      const envs = list(d.stats), running = sum(envs, e => e?.containers?.running), total = sum(envs, e => e?.containers?.total);
      return [{ label: 'Running', value: running }, { label: 'Total', value: total }, { label: 'Updates', value: sum(envs, e => e?.containers?.pendingUpdates) },
        meter('CPU', sum(envs, e => e?.metrics?.cpuPercent) / (envs.length || 1), 100), meter('Memory', sum(envs, e => e?.metrics?.memoryPercent) / (envs.length || 1), 100)];
    },
    sample: { stats: [{ id: 1, name: 'local', containers: { running: 12, total: 14, pendingUpdates: 2 }, metrics: { cpuPercent: 10, memoryPercent: 40 } },
      { id: 2, name: 'nas', containers: { running: 5, total: 5, pendingUpdates: 0 }, metrics: { cpuPercent: 30, memoryPercent: 60 } }] },
    expect: { Running: 17, Total: 19, Updates: 2, CPU: '20%', Memory: '50%' },
  }),
  service<{ secret: string }>({
    type: 'komodo', name: 'Komodo', icon: 'cpu', auth: { header: 'X-API-Key' }, options: { secret: z.string() },
    // one endpoint for every read; the body picks what, and the query is only there so each has an address of its own
    get: o => Object.fromEntries(Object.entries({ servers: 'GetServersSummary', stacks: 'GetStacksSummary', containers: 'GetDockerContainersSummary' })
      .map(([k, type]) => [k, { path: `/read?for=${k}`, method: 'POST' as const, body: { type, params: {} }, headers: { 'X-API-Secret': o.secret } }])),
    stats: d => [{ label: 'Servers', value: of(d.servers?.healthy, d.servers?.total) }, { label: 'Stacks', value: of(d.stacks?.running, d.stacks?.total) },
      { label: 'Containers', value: of(d.containers?.running, d.containers?.total) }, alarm('Unhealthy', (d.stacks?.unhealthy ?? 0) + (d.containers?.unhealthy ?? 0))],
    sampleOptions: { secret: 's' },
    sample: { servers: { total: 3, healthy: 2, unhealthy: 1, disabled: 0 }, stacks: { total: 9, running: 8, stopped: 1, down: 0, unhealthy: 0 }, containers: { total: 40, running: 37, stopped: 2, unhealthy: 1 } },
    expect: { Servers: '2 / 3', Stacks: '8 / 9', Containers: '37 / 40', Unhealthy: 1 },
  }),
  service({
    type: 'kubernetes', name: 'Kubernetes', icon: 'cpu', auth: 'bearer',   // url: the API server; key: a service account token
    get: { nodes: '/api/v1/nodes', pods: '/api/v1/pods', deployments: { path: '/apis/apps/v1/deployments', optional: true } },
    stats: d => {
      const nodes = list(d.nodes?.items), pods = list(d.pods?.items), deployments = list(d.deployments?.items), phase = (p: string) => pods.filter(i => i.status?.phase === p).length;
      const ready = nodes.filter(n => list(n.status?.conditions).some(c => c.type === 'Ready' && c.status === 'True')).length;
      return [{ label: 'Nodes ready', value: of(ready, nodes.length), tone: ready < nodes.length ? 'bad' : 'good' }, { label: 'Pods running', value: phase('Running') }, alarm('Pods stuck', phase('Pending') + phase('Failed')),
        { label: 'Deployments ready', value: of(deployments.filter(x => (x.status?.readyReplicas ?? 0) >= (x.spec?.replicas ?? 1)).length, deployments.length) }];
    },
    sample: { nodes: { items: [{ status: { conditions: [{ type: 'MemoryPressure', status: 'False' }, { type: 'Ready', status: 'True' }] } }, { status: { conditions: [{ type: 'Ready', status: 'False' }] } }] },
      pods: { items: [{ status: { phase: 'Running' } }, { status: { phase: 'Running' } }, { status: { phase: 'Pending' } }, { status: { phase: 'Succeeded' } }] },
      deployments: { items: [{ spec: { replicas: 2 }, status: { readyReplicas: 2 } }, { spec: { replicas: 1 }, status: {} }] } },
    expect: { 'Nodes ready': '1 / 2', 'Pods running': 2, 'Pods stuck': 1, 'Deployments ready': '1 / 2' },
  }),
  service({
    type: 'argocd', name: 'Argo CD', icon: 'cpu', logo: 'argo-cd', auth: 'bearer',
    get: { apps: '/api/v1/applications?fields=items.status.sync.status,items.status.health.status' },
    stats: d => {
      const apps = list(d.apps?.items), sync = (s: string) => apps.filter(a => a.status?.sync?.status === s).length, health = (s: string) => apps.filter(a => a.status?.health?.status === s).length;
      return [{ label: 'Apps', value: apps.length }, { label: 'Synced', value: sync('Synced') }, { label: 'Out of sync', value: sync('OutOfSync'), tone: sync('OutOfSync') ? 'warn' : 'good' },
        { label: 'Healthy', value: health('Healthy') }, alarm('Degraded', health('Degraded'))];
    },
    sample: { apps: { items: [{ status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } } }, { status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } } },
      { status: { sync: { status: 'OutOfSync' }, health: { status: 'Degraded' } } }] } },
    expect: { Apps: 3, Synced: 2, 'Out of sync': 1, Healthy: 2, Degraded: 1 },
  }),

  // NAS
  service({
    type: 'truenas', name: 'TrueNAS', icon: 'disk', auth: 'bearer',
    get: { info: '/api/v2.0/system/info', alerts: '/api/v2.0/alert/list', pools: { path: '/api/v2.0/pool', optional: true } },
    stats: d => {
      const pools = list(d.pools), healthy = pools.filter(p => p.healthy).length, used = sum(pools, p => p.allocated), total = sum(pools, p => p.size);
      return [{ label: 'Pools healthy', value: of(healthy, pools.length), tone: healthy < pools.length ? 'bad' : 'good' }, meter('Pools used', used, total, `of ${fmt.bytes(total)}`),
        alarm('Alerts', list(d.alerts).filter(a => !a.dismissed).length), { label: 'Load', value: d.info?.loadavg?.[0] ?? 0 }, { label: 'Uptime', value: uptime(d.info?.uptime_seconds) }];
    },
    sample: { info: { hostname: 'nas', version: 'TrueNAS-SCALE-24.10.2', loadavg: [0.42, 0.5, 0.48], uptime_seconds: 864000.5 },
      alerts: [{ level: 'WARNING', dismissed: false }, { level: 'INFO', dismissed: true }],
      pools: [{ name: 'tank', healthy: true, status: 'ONLINE', size: 8000000000000, allocated: 2000000000000, free: 6000000000000 }, { name: 'fast', healthy: true, status: 'ONLINE', size: 2000000000000, allocated: 500000000000, free: 1500000000000 }] },
    expect: { 'Pools healthy': '2 / 2', 'Pools used': '25%', Alerts: 1, Load: 0.42, Uptime: '10d' },
  }),
  service({
    type: 'unraid', name: 'Unraid', icon: 'disk', auth: { header: 'X-API-Key' },
    get: { api: { path: '/graphql', method: 'POST', body: { query: `{
      array { state capacity { kilobytes { free total used } } caches { name fsType fsSize fsFree fsUsed } }
      metrics { cpu { percentTotal } memory { percentTotal } }
      notifications { overview { unread { total } } } }` } } },
    stats: d => {
      if (!d.api?.data && d.api?.errors?.length) throw new Error(`Unraid refused: ${d.api.errors[0]?.message}`);
      const { array, metrics, notifications } = d.api?.data ?? {}, disks = array?.capacity?.kilobytes ?? {};
      const caches = list(array?.caches).filter(c => c.fsType), started = array?.state === 'STARTED';
      return [{ label: 'Array', value: array?.state ?? 'unknown', tone: started ? 'good' : 'warn' }, meter('Used', Number(disks.used), Number(disks.total), `${fmt.bytes(Number(disks.free) * 1024)} free`),
        ...(caches.length ? [meter('Cache', sum(caches, c => c.fsUsed), sum(caches, c => c.fsSize), `${fmt.bytes(sum(caches, c => c.fsFree) * 1024)} free`)] : []),
        meter('CPU', metrics?.cpu?.percentTotal, 100), meter('Memory', metrics?.memory?.percentTotal, 100),
        { label: 'Notifications', value: notifications?.overview?.unread?.total ?? 0 }];
    },
    sample: { api: { data: {
      array: { state: 'STARTED', capacity: { kilobytes: { free: '12000000000', total: '16000000000', used: '4000000000' } },
        caches: [{ name: 'cache', fsType: 'btrfs', fsSize: 1000000000, fsFree: 750000000, fsUsed: 250000000 }, { name: 'parity', fsType: null, fsSize: null, fsFree: null, fsUsed: null }] },
      metrics: { cpu: { percentTotal: 12.4 }, memory: { percentTotal: 48.2 } },
      notifications: { overview: { unread: { total: 3 } } } } } },
    expect: { Array: 'STARTED', Used: '25%', Cache: '25%', CPU: '12%', Memory: '48%', Notifications: 3 },
  }),
  service<{ volume?: string }>({
    type: 'diskstation', name: 'DiskStation', icon: 'disk', logo: 'synology',
    auth: { login: '/webapi/entry.cgi', expired: a => a?.success === false && [105, 106, 107, 119].includes(a?.error?.code), body: c => new URLSearchParams({ api: 'SYNO.API.Auth', version: '6', method: 'login', account: c.username ?? '', passwd: c.password ?? '', format: 'sid' }),
      token: r => { if (r.success === false) throw new Error(`DiskStation refused the sign-in (code ${r.error?.code})`); return r.data?.sid; }, use: sid => ({ Cookie: `id=${sid}` }) },
    options: { volume: z.string().optional() },
    get: { info: '/webapi/entry.cgi?api=SYNO.Core.System&version=1&method=info',
      storage: '/webapi/entry.cgi?api=SYNO.Core.System&version=1&method=info&type=%22storage%22',
      load: '/webapi/entry.cgi?api=SYNO.Core.System.Utilization&version=1&method=get' },
    stats: (d, o) => {
      // it says no with a 200, session expired included
      const no = [d.info, d.storage, d.load].find(r => r?.success === false);
      if (no) throw new Error(`DiskStation refused the request (code ${no.error?.code})`);
      const volumes = list(d.storage?.data?.vol_info), volume = o.volume ? volumes.find(v => v.name === o.volume) : volumes[0];
      const used = Number(volume?.used_size) || 0, total = Number(volume?.total_size) || 0, cpu = d.load?.data?.cpu, memory = d.load?.data?.memory;
      const memoryUsed = memory?.real_usage != null ? Number(memory.real_usage) : 100 - share(Number(memory?.avail_real) + Number(memory?.cached), Number(memory?.total_real)) * 100;
      const [h = 0, m = 0] = String(d.info?.data?.up_time ?? '').split(':').map(Number);
      return [meter('Volume', used, total, `${fmt.bytes(total - used)} free`), meter('CPU', (Number(cpu?.user_load) || 0) + (Number(cpu?.system_load) || 0), 100), meter('Memory', memoryUsed, 100),
        { label: 'Uptime', value: uptime(h * 3600 + m * 60) }];
    },
    sample: { info: { success: true, data: { model: 'DS920+', up_time: '1248:12:45' } },
      storage: { success: true, data: { vol_info: [{ name: 'volume_1', used_size: '4000000000000', total_size: '16000000000000' }] } },
      load: { success: true, data: { cpu: { user_load: 7, system_load: 5, other_load: 1 }, memory: { real_usage: 34, total_real: 8066484 } } } },
    expect: { Volume: '25%', CPU: '12%', Memory: '34%', Uptime: '52d' },
  }),
  service({
    type: 'openmediavault', name: 'OpenMediaVault', icon: 'disk',
    auth: { login: '/rpc.php?session', body: c => ({ service: 'session', method: 'login', params: { username: c.username, password: c.password } }) },
    get: { services: { path: '/rpc.php', method: 'POST', body: { service: 'services', method: 'getStatus', params: { limit: -1, start: 0 } } } },
    stats: d => {
      const all = list(d.services?.response?.data), running = all.filter(s => s.running).length;
      return [{ label: 'Running', value: running }, { label: 'Stopped', value: all.length - running }, { label: 'Total', value: all.length }];
    },
    sample: { services: { response: { data: [{ name: 'nfs', title: 'NFS', enabled: true, running: true }, { name: 'ssh', title: 'SSH', enabled: true, running: true }, { name: 'smb', title: 'SMB/CIFS', enabled: false, running: false }], total: 3 }, error: null } },
    expect: { Running: 2, Stopped: 1, Total: 3 },
  }),

  // Files and mail
  service<Creds>({
    type: 'nextcloud', name: 'Nextcloud', icon: 'file', options: creds,   // key: the serverinfo token; or the username and password of an admin
    get: o => ({ info: { path: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json', headers: { 'OCS-APIRequest': 'true', ...(o.key ? { 'NC-Token': o.key } : basic(o)) } } }),
    stats: d => {
      const { nextcloud, activeUsers } = d.info?.ocs?.data ?? {}, free = nextcloud?.system?.freespace;
      return [{ label: 'Active today', value: activeUsers?.last24hours ?? 0 }, { label: 'Users', value: nextcloud?.storage?.num_users ?? 0 }, { label: 'Files', value: nextcloud?.storage?.num_files ?? 0 },
        { label: 'Shares', value: nextcloud?.shares?.num_shares ?? 0 }, ...(typeof free === 'number' && free >= 0 ? [{ label: 'Free space', value: fmt.bytes(free) }] : [])];
    },
    sampleOptions: { key: 'k' },
    recap: d => tally(d.info?.ocs?.data?.nextcloud?.storage?.num_files, { id: 'cloud.files', theme: 'files', icon: 'file', kicker: 'Your own cloud holds', unit: 'files', stat: 'Files', scope: 'All time', line: 'Same convenience, and the only person with the keys is you.' }),
    sample: { info: { ocs: { meta: { status: 'ok', statuscode: 200 }, data: {
      nextcloud: { system: { version: '31.0.2.1', freespace: 1099511627776, cpuload: [0.3, 0.2, 0.2], mem_total: 16000000, mem_free: 9000000 }, storage: { num_users: 6, num_files: 182340 }, shares: { num_shares: 41 } },
      activeUsers: { last5minutes: 1, last1hour: 2, last24hours: 4 } } } } },
    expect: { 'Active today': 4, Users: 6, Files: '182,340', Shares: 41, 'Free space': '1.0 TB' },
  }),
  service({
    type: 'mailcow', name: 'Mailcow', icon: 'text', auth: { header: 'X-API-Key' },
    get: { domains: '/api/v1/get/domain/all' },
    stats: d => {
      const domains = list(d.domains);   // an empty object when there are none
      return [{ label: 'Domains', value: domains.length }, { label: 'Mailboxes', value: sum(domains, x => x.mboxes_in_domain) }, { label: 'Messages', value: sum(domains, x => x.msgs_total) }, { label: 'Storage', value: fmt.bytes(sum(domains, x => x.bytes_total)) }];
    },
    sample: { domains: [{ domain_name: 'example.org', mboxes_in_domain: 4, msgs_total: 1200, bytes_total: '1073741824' }, { domain_name: 'example.net', mboxes_in_domain: '2', msgs_total: 300, bytes_total: 1073741824 }] },
    expect: { Domains: 2, Mailboxes: 6, Messages: '1,500', Storage: '2.0 GB' },
  }),

  // Backups
  service<Creds>({
    type: 'kopia', name: 'Kopia', icon: 'shield', options: userpass,
    get: o => ({ status: { path: '/api/v1/sources', headers: basic(o) } }),
    stats: d => {
      const sources = list(d.status?.sources), last = sources.map(s => s.lastSnapshot).filter(Boolean), latest = last.map(s => s.startTime).sort().at(-1);
      const next = sources.map(s => s.nextSnapshotTime).filter(Boolean).sort()[0];
      return [{ label: 'Sources', value: sources.length }, { label: 'Size', value: fmt.bytes(sum(last, s => s.stats?.totalSize)) }, { label: 'Last snapshot', value: ago(latest) }, alarm('Errors', sum(last, s => s.stats?.errorCount)),
        ...(next ? [{ label: 'Next', value: `${fmt.relativeDay(next)}, ${fmt.time(next)}` }] : [])];
    },
    sample: { status: { sources: [
      { source: { host: 'nas', userName: 'root', path: '/data' }, lastSnapshot: { startTime: '2026-10-30T02:00:00Z', stats: { totalSize: 2147483648, errorCount: 0 } }, nextSnapshotTime: '2026-10-31T02:00:00Z' },
      { source: { host: 'nas', userName: 'root', path: '/home' }, lastSnapshot: { startTime: '2026-10-29T02:00:00Z', stats: { totalSize: 1073741824, errorCount: 2 } } },
      { source: { host: 'nas', userName: 'root', path: '/new' } }] } },
    expect: { Sources: 3, Size: '3.0 GB', Errors: 2 },
  }),
  service<Creds>({
    type: 'backrest', name: 'Backrest', icon: 'shield', options: userpass,
    get: o => ({ summary: { path: '/v1.Backrest/GetSummaryDashboard', method: 'POST', body: {}, headers: basic(o) } }),
    stats: d => {
      const plans = list(d.summary?.planSummaries), latest = (s: string) => plans.filter(p => p.recentBackups?.status?.[0] === s).length;
      return [{ label: 'Plans', value: plans.length }, { label: 'Latest fine', value: latest('STATUS_SUCCESS') }, alarm('Latest failed', latest('STATUS_ERROR')),
        alarm('Failed, 30 days', sum(plans, p => p.backupsFailed30days)), { label: 'Added, 30 days', value: fmt.bytes(sum(plans, p => p.bytesAddedLast30days)) }];
    },
    sample: { summary: { planSummaries: [   // int64s arrive as strings
      { id: 'daily', backupsSuccessLast30days: '30', backupsFailed30days: '1', bytesAddedLast30days: '1073741824', recentBackups: { status: ['STATUS_SUCCESS', 'STATUS_ERROR'] } },
      { id: 'photos', backupsSuccessLast30days: '4', backupsFailed30days: '0', bytesAddedLast30days: '1073741824', recentBackups: { status: ['STATUS_ERROR'] } },
      { id: 'fresh' }] } },
    expect: { Plans: 3, 'Latest fine': 1, 'Latest failed': 1, 'Failed, 30 days': 1, 'Added, 30 days': '2.0 GB' },
  }),
  service({
    type: 'duplicati', name: 'Duplicati', icon: 'shield',
    auth: { login: '/api/v1/auth/login', needs: ['password'], body: c => ({ Password: c.password, RememberMe: true }), token: r => r.AccessToken },
    get: { backups: '/api/v1/backups', state: '/api/v1/serverstate', notifications: '/api/v1/notifications', progress: { path: '/api/v1/progressstate', optional: true } },   // 404 until a job has run
    stats: d => {
      const backups = list(d.backups), notes = list(d.notifications).filter(n => n.BackupID), kind = (t: string) => notes.filter(n => n.Type === t).length;
      const stamp = (s = '') => s.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z');   // 20261030T020000Z
      const last = backups.map(b => stamp(b?.Backup?.Metadata?.LastBackupFinished)).filter(Boolean).sort().at(-1);
      return [{ label: 'Jobs', value: backups.length }, { label: 'Stored', value: fmt.bytes(sum(backups, b => b?.Backup?.Metadata?.TargetFilesSize)) }, { label: 'Last backup', value: ago(last) },
        { label: 'Running', value: d.state?.ActiveTask && d.progress?.BackupID ? 1 : 0 }, alarm('Errors', kind('Error')), { label: 'Warnings', value: kind('Warning'), tone: kind('Warning') ? 'warn' : 'good' }];
    },
    sample: { backups: [{ Backup: { ID: '1', Metadata: { LastBackupFinished: '20261030T020000Z', TargetFilesSize: '2147483648' } }, Schedule: { Time: '2026-10-31T02:00:00Z' } },
      { Backup: { ID: '2', Metadata: { TargetFilesSize: '1073741824' } } }],
      state: { ActiveTask: { Item1: 3, Item2: '2' } }, progress: { BackupID: '2', Phase: 'Backup_ProcessingFiles' },
      notifications: [{ BackupID: '1', Type: 'Error' }, { BackupID: '2', Type: 'Warning' }, { BackupID: '2', Type: 'Warning' }, { Type: 'Information' }] },
    expect: { Jobs: 2, Stored: '3.0 GB', Running: 1, Errors: 1, Warnings: 2 },
  }),

  // Monitoring
  service({
    type: 'grafana', name: 'Grafana', icon: 'chart', auth: 'basic',   // /api/admin/stats wants a server admin
    get: { stats: '/api/admin/stats', alerts: { path: '/api/alertmanager/grafana/api/v2/alerts', optional: true } },
    stats: d => [{ label: 'Dashboards', value: d.stats?.dashboards ?? 0 }, { label: 'Data sources', value: d.stats?.datasources ?? 0 }, { label: 'Users', value: d.stats?.users ?? 0 },
      alarm('Firing', list(d.alerts).filter(a => (a.status?.state ?? 'active') === 'active').length)],
    recap: d => tally(d.stats?.dashboards, { id: 'grafana', theme: 'ops', icon: 'chart', kicker: 'You built', unit: 'dashboards', stat: 'Dashboards', scope: 'All time', line: `Fed by ${d.stats?.datasources ?? 0} data sources. Some of them you even look at.` }),
    sample: { stats: { dashboards: 24, datasources: 5, users: 3, orgs: 1 }, alerts: [{ status: { state: 'active' } }, { status: { state: 'suppressed' } }] },
    expect: { Dashboards: 24, 'Data sources': 5, Firing: 1 },
  }),
  service({
    type: 'prometheus', name: 'Prometheus', icon: 'chart',
    get: { targets: '/api/v1/targets?state=active' },
    stats: d => {
      const all = list(d.targets?.data?.activeTargets), up = all.filter(t => t.health === 'up').length;
      return [{ label: 'Targets up', value: up }, alarm('Targets down', all.filter(t => t.health === 'down').length), { label: 'Targets', value: all.length }];
    },
    sample: { targets: { status: 'success', data: { activeTargets: [{ health: 'up' }, { health: 'up' }, { health: 'down' }, { health: 'unknown' }] } } },
    expect: { 'Targets up': 2, 'Targets down': 1, Targets: 4 },
  }),
  service<{ metrics: { label: string; query: string; format?: 'number' | 'bytes' | 'rate' | 'duration' | 'ratio'; unit?: string }[] }>({
    type: 'prometheus-metric', name: 'Prometheus', icon: 'chart', logo: 'prometheus',
    options: { metrics: z.array(z.object({ label: z.string(), query: z.string(), format: z.enum(['number', 'bytes', 'rate', 'duration', 'ratio']).optional(), unit: z.string().optional() })).min(1).max(6) },
    get: o => Object.fromEntries(o.metrics.map((m, i) => [`m${i}`, `/api/v1/query?query=${encodeURIComponent(m.query)}`])),
    stats: (d, o) => o.metrics.map((m, i) => {
      const r = d[`m${i}`]?.data, n = Number(r?.resultType === 'scalar' ? r.result?.[1] : r?.result?.[0]?.value?.[1] ?? NaN);
      const value = !Number.isFinite(n) ? undefined : m.format === 'bytes' ? fmt.bytes(n) : m.format === 'rate' ? fmt.rate(n) : m.format === 'duration' ? fmt.duration(n) : m.format === 'ratio' ? fmt.pct(n) : n;
      return { label: m.label, value, ...(m.unit ? { unit: m.unit } : {}) };
    }),
    about: 'Reads the Prometheus queries set in the config and shows their current values.',
    sampleOptions: { metrics: [{ label: 'Requests', query: 'sum(rate(http_requests_total[5m]))', unit: '/s' }, { label: 'Disk free', query: 'node_filesystem_free_bytes{mountpoint="/"}', format: 'bytes' }, { label: 'Scalar', query: 'scalar(up)' }] },
    sample: { m0: { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1793400000, '12.5'] }] } },
      m1: { status: 'success', data: { resultType: 'vector', result: [{ metric: { mountpoint: '/' }, value: [1793400000, '1073741824'] }] } },
      m2: { status: 'success', data: { resultType: 'scalar', result: [1793400000, '1'] } } },
    expect: { Requests: 12.5, 'Disk free': '1.0 GB', Scalar: 1 },
  }),
  service({
    type: 'netdata', name: 'Netdata', icon: 'chart',
    get: { info: '/api/v1/info' },
    stats: d => [alarm('Critical', d.info?.alarms?.critical ?? 0), { label: 'Warnings', value: d.info?.alarms?.warning ?? 0, tone: d.info?.alarms?.warning ? 'warn' : 'good' }, { label: 'Normal', value: d.info?.alarms?.normal ?? 0 }],
    sample: { info: { version: 'v2.2.6', alarms: { normal: 182, warning: 2, critical: 1 } } },
    expect: { Critical: 1, Warnings: 2, Normal: 182 },
  }),
  service({
    type: 'zabbix', name: 'Zabbix', icon: 'chart', auth: 'bearer',
    get: { triggers: { path: '/api_jsonrpc.php', method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'trigger.get', params: { output: ['priority'], filter: { value: 1 }, monitored: true } } } },
    stats: d => {
      if (d.triggers?.error) throw new Error(`Zabbix refused: ${d.triggers.error.data ?? d.triggers.error.message}`);
      const count = (p: string) => list(d.triggers?.result).filter(t => t.priority === p).length;
      return [alarm('Disaster', count('5')), alarm('High', count('4')), { label: 'Average', value: count('3') }, { label: 'Warning', value: count('2') }];
    },
    sample: { triggers: { jsonrpc: '2.0', id: 1, result: [{ triggerid: '1', priority: '5' }, { triggerid: '2', priority: '4' }, { triggerid: '3', priority: '4' }, { triggerid: '4', priority: '2' }, { triggerid: '5', priority: '1' }] } },
    expect: { Disaster: 1, High: 2, Average: 0, Warning: 1 },
  }),
  service<{ site: string; username: string; password: string }>({
    type: 'checkmk', name: 'Checkmk', icon: 'chart', options: { site: z.string(), username: z.string(), password: z.string() },   // password: the automation secret
    get: o => {
      const notOk = `columns=state&query=${encodeURIComponent('{"op": "!=", "left": "state", "right": "0"}')}`, headers = { Authorization: `Bearer ${o.username} ${o.password}` };
      return { hosts: { path: `/${o.site}/check_mk/api/1.0/domain-types/host/collections/all?${notOk}`, headers }, services: { path: `/${o.site}/check_mk/api/1.0/domain-types/service/collections/all?${notOk}`, headers } };
    },
    stats: d => [alarm('Host problems', list(d.hosts?.value).length), alarm('Service problems', list(d.services?.value).length)],
    sampleOptions: { site: 'cmk', username: 'automation', password: 's' },
    sample: { hosts: { value: [{ id: 'web1', extensions: { state: 1 } }] }, services: { value: [{ id: 'web1-CPU', extensions: { state: 2 } }, { id: 'web2-Disk', extensions: { state: 1 } }] } },
    expect: { 'Host problems': 1, 'Service problems': 2 },
  }),
  service({
    type: 'healthchecks', name: 'Healthchecks', icon: 'pulse', auth: { header: 'X-Api-Key' },
    get: { checks: '/api/v3/checks/' },
    stats: d => {
      const count = (s: string) => list(d.checks?.checks).filter(c => c.status === s).length;
      return [{ label: 'Up', value: count('up') }, alarm('Down', count('down')), { label: 'Late', value: count('grace'), tone: count('grace') ? 'warn' : 'good' }, { label: 'Paused', value: count('paused') }];
    },
    sample: { checks: { checks: [{ name: 'Backups', status: 'up' }, { name: 'Certs', status: 'up' }, { name: 'Sync', status: 'down' }, { name: 'Cron', status: 'grace' }, { name: 'Old', status: 'paused' }, { name: 'Fresh', status: 'new' }] } },
    expect: { Up: 2, Down: 1, Late: 1, Paused: 1 },
  }),
  service({
    type: 'uptimerobot', name: 'UptimeRobot', icon: 'pulse', auth: { query: 'api_key' },   // url: https://api.uptimerobot.com
    get: { monitors: { path: '/v2/getMonitors', method: 'POST', body: { format: 'json' } } },
    stats: d => {
      if (d.monitors?.stat === 'fail') throw new Error(`UptimeRobot refused: ${d.monitors.error?.message ?? 'no reason given'}`);
      const all = list(d.monitors?.monitors), count = (...s: number[]) => all.filter(m => s.includes(m.status)).length;
      return [{ label: 'Up', value: of(count(2), all.length) }, alarm('Down', count(8, 9)), { label: 'Paused', value: count(0) }];
    },
    sample: { monitors: { stat: 'ok', pagination: { total: 4 }, monitors: [{ id: 1, status: 2 }, { id: 2, status: 2 }, { id: 3, status: 9 }, { id: 4, status: 0 }] } },
    expect: { Up: '2 / 4', Down: 1, Paused: 1 },
  }),

  // Notifications
  service({
    type: 'gotify', name: 'Gotify', icon: 'text', auth: { header: 'X-Gotify-Key' },   // a client token: app tokens can only send
    get: { apps: '/application', clients: '/client', messages: '/message' },
    stats: d => {
      const shown = list(d.messages?.messages).length;
      return [{ label: 'Messages', value: d.messages?.paging?.next ? `${shown}+` : shown }, { label: 'Apps', value: list(d.apps).length }, { label: 'Clients', value: list(d.clients).length }];
    },
    sample: { apps: [{ id: 1, name: 'Sonarr' }, { id: 2, name: 'Backups' }], clients: [{ id: 1, name: 'Phone' }], messages: { messages: [{ id: 9, title: 'Done' }, { id: 8, title: 'Started' }], paging: { limit: 100, size: 2, since: 0 } } },
    expect: { Messages: 2, Apps: 2, Clients: 1 },
  }),
  service<Creds & { topic: string }>({
    type: 'ntfy', name: 'ntfy', icon: 'text', options: { topic: z.string(), ...creds },
    get: o => ({ messages: { path: `/${encodeURIComponent(o.topic)}/json?poll=1&since=24h`, as: 'text', headers: { ...basic(o), ...bearer(o) } } }),
    stats: d => {
      const messages = String(d.messages ?? '').split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(m => m.event === 'message'), last = messages.at(-1);
      return [{ label: 'Last 24 hours', value: messages.length }, { label: 'Latest', value: last?.title ?? last?.message ?? 'Nothing yet' }, ...(last ? [{ label: 'Received', value: ago(last.time * 1000) }] : [])];
    },
    sampleOptions: { topic: 'alerts' },
    sample: { messages: '{"id":"a1","time":1793300000,"event":"message","topic":"alerts","message":"Disk 80% full"}\n{"id":"b2","time":1793310000,"event":"message","topic":"alerts","title":"Backup finished","message":"All good","priority":3}\n' },
    expect: { 'Last 24 hours': 2, Latest: 'Backup finished' },
  }),

  // Smart home and energy
  service({
    type: 'frigate', name: 'Frigate', icon: 'image',   // the unauthenticated port, 5000
    get: { stats: '/api/stats' },
    stats: d => {
      const speeds = Object.values<any>(d.stats?.detectors ?? {}).map(x => x?.inference_speed).filter(Number.isFinite);
      return [{ label: 'Cameras', value: Object.keys(d.stats?.cameras ?? {}).length }, { label: 'Detections', value: d.stats?.detection_fps ?? 0, unit: 'fps' },
        ...(speeds.length ? [{ label: 'Inference', value: Math.min(...speeds), unit: 'ms' }] : []), { label: 'Uptime', value: uptime(d.stats?.service?.uptime) }];
    },
    sample: { stats: { detection_fps: 3.4, cameras: { door: { camera_fps: 5 }, garden: { camera_fps: 5 } }, detectors: { coral: { inference_speed: 8.5 } }, service: { uptime: 90000, version: '0.15.1' } } },
    expect: { Cameras: 2, Detections: 3.4, Inference: 8.5, Uptime: '1d' },
  }),
  service({
    type: 'homebridge', name: 'Homebridge', icon: 'home', auth: { login: '/api/auth/login', token: r => r.access_token },
    get: { status: '/api/status/homebridge', version: '/api/status/homebridge-version', plugins: '/api/plugins', bridges: { path: '/api/status/homebridge/child-bridges', optional: true } },
    stats: d => {
      const updates = (d.version?.updateAvailable ? 1 : 0) + list(d.plugins).filter(p => p.updateAvailable).length, bridges = list(d.bridges);
      return [{ label: 'Status', value: d.status?.status ?? 'unknown', tone: d.status?.status === 'up' ? 'good' : 'bad' }, { label: 'Updates', value: updates, tone: updates ? 'warn' : 'good' },
        ...(bridges.length ? [{ label: 'Child bridges', value: of(bridges.filter(b => b.status === 'ok').length, bridges.length) }] : [])];
    },
    sample: { status: { status: 'up' }, version: { updateAvailable: true }, plugins: [{ name: 'homebridge-hue', updateAvailable: true }, { name: 'homebridge-ring', updateAvailable: false }], bridges: [{ status: 'ok' }, { status: 'down' }] },
    expect: { Status: 'up', Updates: 2, 'Child bridges': '1 / 2' },
  }),
  service<Creds>({
    type: 'esphome', name: 'ESPHome', icon: 'bulb', options: userpass,
    get: o => ({ devices: { path: '/ping', headers: basic(o) } }),
    stats: d => {
      const seen = Object.values<unknown>(d.devices ?? {}), online = seen.filter(v => v === true).length;
      return [{ label: 'Online', value: online }, alarm('Offline', seen.filter(v => v === false).length), { label: 'Unknown', value: seen.filter(v => v == null).length }, { label: 'Total', value: seen.length }];
    },
    sample: { devices: { 'desk-lamp.yaml': true, 'plug-1.yaml': true, 'sensor.yaml': false, 'new.yaml': null } },
    expect: { Online: 2, Offline: 1, Unknown: 1, Total: 4 },
  }),
  service({
    type: 'evcc', name: 'evcc', icon: 'bulb',
    get: { state: '/api/state' },
    stats: d => {
      const s = d.state?.result ?? d.state ?? {};   // before v0.207 it came wrapped in `result`
      return [{ label: 'Solar', value: kw(s.pvPower), unit: 'kW' }, { label: 'Home', value: kw(s.homePower), unit: 'kW' }, { label: 'Grid', value: kw(s.grid?.power ?? s.gridPower), unit: 'kW' },
        { label: 'Charging', value: kw(sum(list(s.loadpoints), l => l.chargePower)), unit: 'kW' }];
    },
    sample: { state: { pvPower: 4200, homePower: 650, grid: { power: -1250 }, loadpoints: [{ chargePower: 2300 }, {}] } },
    expect: { Solar: 4.2, Home: 0.65, Grid: -1.25, Charging: 2.3 },
  }),
  service({
    type: 'opendtu', name: 'OpenDTU', icon: 'bulb',
    get: { live: '/api/livedata/status' },
    stats: d => {
      const inverters = list(d.live?.inverters), power = d.live?.total?.Power, today = d.live?.total?.YieldDay;
      return [{ label: 'Power', value: Math.round(power?.v ?? 0), unit: power?.u ?? 'W' }, { label: 'Today', value: Math.round(today?.v ?? 0), unit: today?.u ?? 'Wh' },
        meter('Of limit', power?.v, sum(inverters, i => i.limit_absolute)), { label: 'Inverters', value: of(inverters.filter(i => i.reachable).length, inverters.length) }];
    },
    sample: { live: { inverters: [{ serial: '114180000001', reachable: true, producing: true, limit_absolute: 800 }, { serial: '114180000002', reachable: false, producing: false, limit_absolute: 400 }],
      total: { Power: { v: 300.4, u: 'W', d: 1 }, YieldDay: { v: 1850.2, u: 'Wh', d: 0 }, YieldTotal: { v: 412.3, u: 'kWh', d: 3 } } } },
    expect: { Power: 300, Today: '1,850', 'Of limit': '25%', Inverters: '1 / 2' },
  }),
  service<Creds & { ups: string }>({
    type: 'peanut', name: 'PeaNUT', icon: 'bulb', options: { ups: z.string(), ...userpass },   // ups: its name in NUT
    get: o => ({ ups: { path: `/api/v1/devices/${encodeURIComponent(o.ups)}`, headers: basic(o) } }),
    stats: d => {
      const read = (dotted: string) => d.ups?.[dotted] ?? d.ups?.[dotted.replace('.', '_')];   // v1 used underscores
      const flags = String(read('ups.status') ?? '').split(' '), battery = parseFloat(read('battery.charge')), load = parseFloat(read('ups.load')), runtime = parseFloat(read('battery.runtime'));
      const status = flags.includes('LB') ? 'Low battery' : flags.includes('OB') ? 'On battery' : flags.includes('OL') ? 'Online' : flags.join(' ') || 'unknown';
      return [{ label: 'Status', value: status, tone: flags.includes('OL') ? 'good' : 'bad' }, ...(Number.isFinite(battery) ? [meter('Battery', battery, 100)] : []), ...(Number.isFinite(load) ? [meter('Load', load, 100)] : []), ...(runtime ? [{ label: 'Runtime', value: fmt.duration(runtime) }] : [])];
    },
    sampleOptions: { ups: 'ups' },
    sample: { ups: { 'battery.charge': 100, 'battery.runtime': 3120, 'ups.load': 18, 'ups.status': 'OL CHRG' } },
    expect: { Status: 'Online', Battery: '100%', Load: '18%', Runtime: '52m' },
  }),

  // 3D printing
  service<Creds>({
    type: 'moonraker', name: 'Moonraker', icon: 'cpu', options: key,
    get: o => ({ status: { path: '/printer/objects/query?print_stats&display_status&webhooks', headers: { ...(o.key ? { 'X-Api-Key': o.key } : {}) } } }),
    stats: d => {
      const { print_stats: job, display_status: display, webhooks } = d.status?.result?.status ?? {}, busy = job?.state && job.state !== 'standby';
      const current = job?.info?.current_layer, total = job?.info?.total_layer;
      return [{ label: 'Printer', value: webhooks?.state ?? 'unknown', tone: webhooks?.state === 'ready' ? 'good' : 'bad' }, { label: 'Job', value: job?.state ?? 'unknown' },
        ...(busy ? [meter('Progress', display?.progress, 1)] : []), ...(busy && current != null && total != null ? [{ label: 'Layer', value: of(current, total) }] : [])];
    },
    sample: { status: { result: { status: { print_stats: { state: 'printing', filename: 'benchy.gcode', info: { current_layer: 42, total_layer: 120 } }, display_status: { progress: 0.35 }, webhooks: { state: 'ready' } } } } },
    expect: { Printer: 'ready', Job: 'printing', Progress: '35%', Layer: '42 / 120' },
  }),
  service({
    type: 'octoprint', name: 'OctoPrint', icon: 'cpu', auth: { header: 'X-Api-Key' },
    get: { job: '/api/job', printer: { path: '/api/printer', optional: true } },   // 409 while the printer is off
    stats: d => {
      const temp = d.printer?.temperature, done = d.job?.progress?.completion;
      return [{ label: 'State', value: d.printer?.state?.text ?? d.job?.state ?? 'unknown' }, ...(typeof done === 'number' ? [meter('Progress', done, 100)] : []),
        ...(temp?.tool0 ? [{ label: 'Tool', value: temp.tool0.actual ?? 0, unit: '°C' }] : []), ...(temp?.bed ? [{ label: 'Bed', value: temp.bed.actual ?? 0, unit: '°C' }] : [])];
    },
    sample: { job: { state: 'Printing', job: { file: { name: 'benchy.gcode' } }, progress: { completion: 42.5, printTimeLeft: 3600 } }, printer: { state: { text: 'Printing' }, temperature: { tool0: { actual: 214.8, target: 215 }, bed: { actual: 60.1, target: 60 } } } },
    expect: { State: 'Printing', Progress: '43%', Tool: 214.8, Bed: 60.1 },
  }),
  service({
    type: 'spoolman', name: 'Spoolman', icon: 'disk',
    get: { spools: '/api/v1/spool' },
    stats: d => {
      const spools = list(d.spools).filter(s => s.remaining_weight != null), full = (s: any) => s.initial_weight ?? s.filament?.weight ?? 0;
      const lowest = spools.filter(full).sort((a, b) => share(a.remaining_weight, full(a)) - share(b.remaining_weight, full(b)))[0];
      return [{ label: 'Spools', value: list(d.spools).length }, { label: 'Left', value: Math.round(sum(spools, s => s.remaining_weight)), unit: 'g' },
        ...(lowest ? [{ ...meter('Lowest', lowest.remaining_weight, full(lowest)), sub: lowest.filament?.name }] : [])];
    },
    sample: { spools: [{ id: 1, filament: { name: 'PLA Black', weight: 1000 }, initial_weight: 1000, remaining_weight: 750.4 }, { id: 2, filament: { name: 'PETG Blue', weight: 1000 }, remaining_weight: 100 }, { id: 3, filament: { name: 'ASA' } }] },
    expect: { Spools: 3, Left: 850, Lowest: '10%' },
  }),

  // Everything else
  service({
    type: 'pterodactyl', name: 'Pterodactyl', icon: 'game', auth: 'bearer',
    get: { nodes: '/api/application/nodes?include=servers' },
    stats: d => {
      const nodes = list(d.nodes?.data);
      return [{ label: 'Servers', value: sum(nodes, n => n.attributes?.relationships?.servers?.data?.length) }, { label: 'Nodes', value: nodes.length }];
    },
    sample: { nodes: { object: 'list', data: [{ attributes: { name: 'one', relationships: { servers: { data: [{ attributes: { name: 'mc' } }, { attributes: { name: 'rust' } }] } } } }, { attributes: { name: 'two' } }] } },
    expect: { Servers: 2, Nodes: 2 },
  }),
  service<{ key: string; definitionId: number | string; branchName?: string; repositoryId?: string; email?: string }>({
    type: 'azure-devops', name: 'Azure DevOps', icon: 'chart',   // url: https://dev.azure.com/<organization>/<project>; key: a personal access token
    options: { key: z.string(), definitionId: z.union([z.number(), z.string()]), branchName: z.string().optional(), repositoryId: z.string().optional(), email: z.string().optional() },
    get: o => {
      const headers = { Authorization: `Basic ${Buffer.from(`:${o.key}`).toString('base64')}` }, branch = o.branchName ? `&branchName=${encodeURIComponent(o.branchName)}` : '';
      return { builds: { path: `/_apis/build/builds?definitions=${o.definitionId}${branch}&queryOrder=queueTimeDescending&$top=1&api-version=7.0`, headers },
        ...(o.repositoryId ? { prs: { path: `/_apis/git/repositories/${o.repositoryId}/pullrequests?api-version=7.0`, headers } } : {}) };
    },
    stats: (d, o) => {
      const build = d.builds?.value?.[0], result = build?.result ?? build?.status ?? 'No builds', prs = list(d.prs?.value);
      const mine = prs.filter(p => p.createdBy?.uniqueName?.toLowerCase() === o.email?.toLowerCase());
      return [{ label: 'Last build', value: result, tone: result === 'succeeded' ? 'good' : result === 'failed' ? 'bad' : 'neutral' }, ...(d.prs ? [{ label: 'Pull requests', value: d.prs.count ?? prs.length }] : []),
        ...(d.prs && o.email ? [{ label: 'Mine', value: mine.length }, { label: 'Approved', value: mine.filter(p => list(p.reviewers).some(r => [5, 10].includes(r.vote))).length }] : [])];
    },
    sampleOptions: { key: 'k', definitionId: 12, repositoryId: 'r', email: 'me@example.org' },
    sample: { builds: { count: 1, value: [{ status: 'completed', result: 'succeeded' }] },
      prs: { count: 3, value: [{ createdBy: { uniqueName: 'Me@example.org' }, reviewers: [{ vote: 10 }] }, { createdBy: { uniqueName: 'me@example.org' }, reviewers: [{ vote: 0 }] }, { createdBy: { uniqueName: 'them@example.org' } }] } },
    expect: { 'Last build': 'succeeded', 'Pull requests': 3, Mine: 2, Approved: 1 },
  }),
  service({
    type: 'filebrowser', name: 'File Browser', icon: 'file', auth: { login: '/api/login', text: true, token: t => t.trim(), use: t => ({ 'X-Auth': t }), ttl: 3600 },
    get: { usage: '/api/usage/' },
    stats: d => { const t = d.usage?.total ?? 0, u = d.usage?.used ?? 0; return [{ label: 'Used', value: fmt.bytes(u), pct: t ? u / t : 0 }, { label: 'Free', value: fmt.bytes(Math.max(0, t - u)) }, { label: 'Total', value: fmt.bytes(t) }]; },
    sample: { usage: { total: 2000, used: 500 } },
    loginSample: 'jwt-token',
    expect: { Used: fmt.bytes(500), Total: fmt.bytes(2000) },
  }),
  service({
    type: 'beszel', name: 'Beszel', icon: 'cpu', every: '2m',
    auth: { login: '/api/collections/users/auth-with-password', body: c => ({ identity: c.username, password: c.password }), token: r => r?.token, use: t => ({ Authorization: t }), ttl: 3600 },
    get: { systems: '/api/collections/systems/records?perPage=100' },
    status: d => ((d.systems?.items ?? []) as any[]).map(s => ({ name: s.name, ok: s.status === 'up', detail: s.status === 'up' ? undefined : s.status })),
    sample: { systems: { items: [{ name: 'desktop', status: 'up' }, { name: 'pi', status: 'down' }] } },
    loginSample: { token: 'abc' },
    expect: { desktop: 'true', pi: 'false' },
  }),
];
