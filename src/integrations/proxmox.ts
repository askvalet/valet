// Proxmox VE: every node and guest (VMs and containers) with its state, CPU, memory and uptime, and the storage pools
// and how full they are, with trouble first. The assistant can read one guest and, with control, start, shut down or
// reboot it. Everything comes from /cluster/resources, which shows only what the token may see.
import { z } from 'zod';
import { bounded, defineIntegration, fmt } from '../server/core.ts';
import { tally } from '../server/service.ts';
import { Every } from '../server/config.ts';
import type { ListItem, StatItem, Tone } from '../shared/cards.ts';

type Kind = 'qemu' | 'lxc';
interface Node { name: string; online: boolean; cpu: number; maxcpu: number; mem: number; maxmem: number; uptime: number }
interface Guest { vmid: number; name: string; type: Kind; node: string; status: string; cpu: number; maxcpu: number; mem: number; maxmem: number; uptime: number; template: boolean; lock?: string; hastate?: string }
interface Pool { id: string; name: string; node: string; status: string; used: number; size: number; plugin?: string; shared: boolean }

// Names that go into a path: the service's own answer is checked too, since it's a stranger's text as far as a URL goes.
const NODE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const share = (used = 0, total = 0) => total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
const uptime = (s = 0) => s >= 86400 ? `${Math.floor(s / 86400)}d` : fmt.duration(s);
const kindOf = (g: Pick<Guest, 'type'>) => g.type === 'qemu' ? 'VM' : 'CT';
const label = (g: Guest) => `${g.name} (${kindOf(g)} ${g.vmid} on ${g.node})`;
const n = (v: unknown) => Number(v) || 0;

/** What's wrong with a guest, in a word, or nothing. Stopped isn't trouble: that's usually on purpose. */
function trouble(g: Guest, nodes: Map<string, Node>): { word: string; tone: Tone } | undefined {
  if (nodes.get(g.node)?.online === false) return { word: 'node offline', tone: 'bad' };
  if (g.hastate === 'error' || g.hastate === 'fence') return { word: `HA ${g.hastate}`, tone: 'bad' };
  if (!['running', 'stopped'].includes(g.status)) return { word: g.status || 'unknown', tone: 'warn' };
  if (g.lock && g.lock !== 'backup') return { word: `locked (${g.lock})`, tone: 'warn' };
  if (g.status === 'running' && share(g.mem, g.maxmem) >= 0.95) return { word: 'memory full', tone: 'warn' };
  return undefined;
}

export default defineIntegration({
  type: 'proxmox',
  name: 'Proxmox',
  config: z.object({
    url: z.string().url(), href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(),
    insecure: z.boolean().optional(),               // Proxmox ships a self-signed certificate
    key: z.string(),                                // an API token: user@realm!tokenid=secret
    node: z.string().optional(),                    // only this node
    vmid: z.number().optional(),                    // the status card shows just this VM or container
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true;
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    const source = { name: 'Proxmox', icon: '/api/icon/proxmox' };
    async function api<T = any>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
      const r = await ctx.http<Response>(`${base}/api2/json${path}`, { as: 'response', method, insecure, timeout: 15_000, headers: { Accept: 'application/json', Authorization: `PVEAPIToken=${cfg.key}` } });
      if (!r.ok) throw new Error(`Proxmox answered ${r.status}${r.status === 401 ? ': is the token right?' : r.status === 403 ? ': the token lacks a permission for that' : ''}`);
      return (JSON.parse(await bounded(r) || '{}') as { data: T }).data;
    }

    let cached: { at: number; p: Promise<{ nodes: Node[]; guests: Guest[]; pools: Pool[] }> } | undefined;
    function load() {
      if (cached && Date.now() - cached.at < 5000) return cached.p;
      const p = api<any[]>('/cluster/resources').then(raw => {
        const all = (Array.isArray(raw) ? raw : []).filter(r => !cfg.node || r.node === cfg.node);
        const nodes = all.filter(r => r.type === 'node').map(r => ({ name: String(r.node ?? r.id), online: r.status === 'online', cpu: n(r.cpu), maxcpu: n(r.maxcpu), mem: n(r.mem), maxmem: n(r.maxmem), uptime: n(r.uptime) }));
        const guests = all.filter(r => r.type === 'qemu' || r.type === 'lxc').map(r => ({ vmid: n(r.vmid), name: String(r.name ?? r.vmid), type: r.type as Kind, node: String(r.node), status: String(r.status ?? 'unknown'), cpu: n(r.cpu), maxcpu: n(r.maxcpu),
          mem: n(r.mem), maxmem: n(r.maxmem), uptime: n(r.uptime), template: !!n(r.template), lock: r.lock || undefined, hastate: r.hastate || undefined }));
        // a shared pool is listed once per node; it's one pool
        const seen = new Set<string>(), pools: Pool[] = [];
        for (const r of all.filter(r => r.type === 'storage')) {
          const shared = !!n(r.shared), key = shared ? `shared/${r.storage}` : r.id;
          if (seen.has(key)) continue;
          seen.add(key);
          pools.push({ id: key, name: String(r.storage), node: String(r.node), status: String(r.status ?? 'unknown'), used: n(r.disk), size: n(r.maxdisk), plugin: r.plugintype || undefined, shared });
        }
        return { nodes: nodes.sort((a, b) => a.name.localeCompare(b.name)), guests: guests.sort((a, b) => a.vmid - b.vmid), pools };
      });
      cached = { at: Date.now(), p };
      p.catch(() => { if (cached?.p === p) cached = undefined; });
      return p;
    }

    // ── the status card, as the old service() drew it
    const meter = (label: string, used = 0, total = 0, sub?: string): StatItem => ({ label, value: fmt.pct(share(used, total)), pct: share(used, total), ...(sub ? { sub } : {}) });
    const of = (a: number, b: number) => `${a} / ${b}`;
    async function statusCard() {
      const { nodes, guests } = await load();
      let items: StatItem[];
      if (cfg.vmid != null) {
        const vm = guests.find(g => g.vmid === cfg.vmid), on = vm?.status === 'running';
        items = !vm ? [{ label: 'Status', value: 'Not found' }] : [{ label: 'Status', value: vm.status, tone: on ? 'good' : 'neutral', sub: vm.name },
          ...(on ? [meter('CPU', vm.cpu, 1), meter('Memory', vm.mem, vm.maxmem, `of ${fmt.bytes(vm.maxmem)}`), { label: 'Uptime', value: uptime(vm.uptime) }] : [])];
      } else {
        const real = guests.filter(g => !g.template), vms = real.filter(g => g.type === 'qemu'), cts = real.filter(g => g.type === 'lxc'), running = (l: Guest[]) => l.filter(g => g.status === 'running').length;
        const online = nodes.filter(x => x.online), memory = online.reduce((s, x) => s + x.maxmem, 0);
        items = [{ label: 'VMs', value: of(running(vms), vms.length) }, { label: 'Containers', value: of(running(cts), cts.length) },
          meter('CPU', online.reduce((s, x) => s + x.cpu * x.maxcpu, 0), online.reduce((s, x) => s + x.maxcpu, 0)), meter('Memory', online.reduce((s, x) => s + x.mem, 0), memory, `of ${fmt.bytes(memory)}`),
          { label: 'Nodes', value: of(online.length, nodes.length), tone: online.length < nodes.length ? 'bad' : 'good' }];
      }
      return { type: 'stats' as const, title: 'Proxmox', icon: 'cpu', href, source, items, summary: { label: 'Proxmox', icon: 'cpu', value: items[0].value, sub: items[0].label } };
    }

    // ── nodes and guests, a section per node, trouble first
    function guestRows(nodes: Node[], guests: Guest[]) {
      const byName = new Map(nodes.map(x => [x.name, x])), real = guests.filter(g => !g.template);
      const rank = (g: Guest) => trouble(g, byName) ? 0 : g.status === 'running' ? 1 : 2;
      const names = [...new Set([...nodes.map(x => x.name), ...real.map(g => g.node)])];
      // an offline node or a broken guest before one that only needs a look
      const weight = (t?: { tone: Tone }) => t?.tone === 'bad' ? 2 : t ? 1 : 0;
      const bad = (name: string) => byName.get(name)?.online === false ? 2 : Math.max(0, ...real.filter(g => g.node === name).map(g => weight(trouble(g, byName))));
      const rows: ListItem[] = [];
      for (const name of names.sort((a, b) => bad(b) - bad(a) || a.localeCompare(b))) {
        const node = byName.get(name), section = name;
        if (node) rows.push({ id: `node/${name}`, section, title: name, subtitle: node.online ? `Node · up ${uptime(node.uptime)}` : 'Node · offline', dot: node.online ? undefined : 'bad', tone: node.online ? undefined : 'bad',
          ...(node.online ? { meta: `CPU ${fmt.pct(node.cpu)} · ${fmt.bytes(node.mem)} of ${fmt.bytes(node.maxmem)}`, pct: share(node.mem, node.maxmem) } : {}) });
        for (const g of real.filter(x => x.node === name).sort((a, b) => rank(a) - rank(b) || a.vmid - b.vmid)) {
          const t = trouble(g, byName), on = g.status === 'running';
          rows.push({ id: `${g.type}/${g.vmid}`, section, title: g.name, subtitle: `${kindOf(g)} ${g.vmid} · ${t ? t.word : on ? `up ${uptime(g.uptime)}` : g.status}`,
            dot: t?.tone, tone: t?.tone, ...(on ? { meta: `CPU ${fmt.pct(g.cpu)} · ${fmt.bytes(g.mem)} of ${fmt.bytes(g.maxmem)}`, pct: share(g.mem, g.maxmem) } : {}) });
        }
      }
      return rows;
    }
    async function guestsCard() {
      const { nodes, guests } = await load(), byName = new Map(nodes.map(x => [x.name, x])), real = guests.filter(g => !g.template);
      const offline = nodes.filter(x => !x.online), sick = real.filter(g => trouble(g, byName)), running = real.filter(g => g.status === 'running').length;
      const worst: Tone = offline.length || sick.some(g => trouble(g, byName)!.tone === 'bad') ? 'bad' : sick.length ? 'warn' : 'good';
      return { type: 'list' as const, title: 'Proxmox', icon: 'cpu', href, source, items: guestRows(nodes, guests), empty: 'No nodes or guests this token can see',
        summary: { label: 'Proxmox', icon: 'cpu', tone: worst,
          value: offline.length ? `${offline.length} node${offline.length > 1 ? 's' : ''} offline` : sick.length ? `${sick.length} need a look` : `${running} running`,
          sub: offline.length ? offline.map(x => x.name).join(', ') : sick.length ? sick.slice(0, 3).map(g => g.name).join(', ') : `of ${real.length} guests · ${nodes.length} node${nodes.length === 1 ? '' : 's'}` } };
    }

    // ── storage, fullest and broken first
    const fill = (p: Pool): Tone | undefined => p.status !== 'available' ? 'bad' : share(p.used, p.size) >= 0.95 ? 'bad' : share(p.used, p.size) >= 0.85 ? 'warn' : undefined;
    async function storageCard() {
      const { pools } = await load(), order = [...pools].sort((a, b) => Number(b.status !== 'available') - Number(a.status !== 'available') || share(b.used, b.size) - share(a.used, a.size));
      const top = order[0], tone = top ? fill(top) : undefined;
      return { type: 'list' as const, title: 'Storage', icon: 'disk', href, source, empty: 'No storage this token can see',
        items: order.map(p => ({ id: p.id, title: p.name, subtitle: [p.shared ? 'shared' : p.node, p.plugin, p.status !== 'available' && p.status].filter(Boolean).join(' · '),
          ...(p.size ? { pct: share(p.used, p.size), meta: `${fmt.bytes(p.used)} of ${fmt.bytes(p.size)}` } : {}), tone: fill(p), dot: fill(p) })),
        summary: top ? { label: 'Storage', icon: 'disk', value: top.status !== 'available' ? `${top.name} ${top.status}` : fmt.pct(share(top.used, top.size)), pct: share(top.used, top.size), tone: tone ?? 'good',
          sub: top.status !== 'available' ? undefined : `${top.name} is fullest`, marks: order.map(p => ({ pct: share(p.used, p.size), tone: fill(p), label: `${p.name} · ${fmt.pct(share(p.used, p.size))}` })) } : { label: 'Storage', icon: 'disk', value: 'None' } };
    }

    // ── one guest, by name or id; an answer that could be two is refused, never guessed
    async function find(q: string) {
      const all = (await load()).guests.filter(g => !g.template), s = q.trim().toLowerCase().replace(/^(?:vm|ct)\s*(?=\d+$)/, '');   // "VM 100" is 100
      if (!s) throw new Error('say which guest, by name or id');
      const byId = /^\d+$/.test(s) ? all.filter(g => String(g.vmid) === s) : [];
      const exact = all.filter(g => g.name.toLowerCase() === s);
      const hits = byId.length ? byId : exact.length ? exact : all.filter(g => g.name.toLowerCase().includes(s));
      if (hits.length === 1) {
        const g = hits[0];
        if (!NODE.test(g.node) || !Number.isInteger(g.vmid) || g.vmid < 1 || g.vmid > 999_999_999 || !['qemu', 'lxc'].includes(g.type)) throw new Error(`Proxmox sent an id Valet won't put in an address: ${g.node}/${g.vmid}`);
        return g;
      }
      if (!hits.length) throw new Error(`no guest like "${q}". There are: ${all.map(g => `${g.name} (${g.vmid})`).join(', ') || 'none this token can see'}`);
      throw new Error(`"${q}" could be ${hits.map(label).join(', ')}. Say which by its id`);
    }
    const brief = (g: Guest) => ({ name: g.name, vmid: g.vmid, kind: kindOf(g), node: g.node, status: g.status, ...(g.status === 'running' ? { cpu: fmt.pct(g.cpu), memory: `${fmt.bytes(g.mem)} of ${fmt.bytes(g.maxmem)}`, uptime: uptime(g.uptime) } : {}), ...(g.lock ? { lock: g.lock } : {}), ...(g.hastate ? { ha: g.hastate } : {}) });
    const VERB = { start: 'Start', shutdown: 'Shut down', reboot: 'Reboot' } as const;
    const Power = z.object({ guest: z.string().min(1).max(80).describe('its name or numeric id'), action: z.enum(['start', 'shutdown', 'reboot']) });

    return {
      async recap() {
        return tally((await load()).guests.length, { id: 'proxmox.guests', theme: 'hardware', icon: 'cpu', kicker: 'Proxmox is running', unit: 'machines', stat: 'Virtual machines', line: 'Whole computers inside your computer.' });
      },
      widgets: {
        status: { title: 'Proxmox', interval: every, fetch: statusCard },
        guests: { title: 'Proxmox', interval: Math.min(every, 30_000), fetch: guestsCard },
        storage: { title: 'Storage', interval: Math.max(every, 300_000), fetch: storageCard },
      },
      tools: {
        proxmox_status: {
          label: 'Checked Proxmox', live: true, followUps: ['Which guest uses the most memory?', 'How full is the storage?'],
          description: 'Every Proxmox node, VM and container: state, CPU, memory, uptime, HA state and locks; and each storage pool with how full it is. Use for "is everything running", "what\'s using the memory on the server", "is the pool full". A stopped guest is usually stopped on purpose.',
          access: 'read', input: z.object({}),
          async run() {
            const { nodes, guests, pools } = await load();
            return { data: { nodes: nodes.map(x => ({ name: x.name, online: x.online, ...(x.online ? { cpu: fmt.pct(x.cpu), memory: `${fmt.bytes(x.mem)} of ${fmt.bytes(x.maxmem)}`, uptime: uptime(x.uptime) } : {}) })),
              guests: guests.filter(g => !g.template).map(brief), storage: pools.map(p => ({ name: p.name, node: p.shared ? 'shared' : p.node, status: p.status, used: fmt.pct(share(p.used, p.size)), free: fmt.bytes(p.size - p.used) })) },
            card: await guestsCard() };
          },
        },
        guest_status: {
          label: 'Checked a guest', followUps: ['Restart it'],
          description: 'One Proxmox VM or container by name or id: whether it\'s running, its CPU, memory, uptime, HA state and lock, as Proxmox reports it right now.',
          access: 'read', input: z.object({ guest: z.string().min(1).max(80).describe('its name or numeric id') }),
          async run({ guest }) {
            const g = await find(guest);
            const now = await api<any>(`/nodes/${g.node}/${g.type}/${g.vmid}/status/current`).catch(() => undefined);
            const status = String(now?.qmpstatus ?? now?.status ?? g.status), on = status === 'running';
            const mem = now ? n(now.mem) : g.mem, maxmem = now ? n(now.maxmem) || g.maxmem : g.maxmem;
            const rows: [string, string][] = [['State', status], ['Where', `${kindOf(g)} ${g.vmid} on ${g.node}`],
              ...(on ? [['CPU', fmt.pct(now ? n(now.cpu) : g.cpu)], ['Memory', `${fmt.bytes(mem)} of ${fmt.bytes(maxmem)}`], ['Uptime', uptime(now ? n(now.uptime) : g.uptime)]] as [string, string][] : []),
              ...(now?.ha?.managed ? [['HA', String(now.ha.state ?? 'managed')]] as [string, string][] : []), ...(now?.lock ?? g.lock ? [['Lock', String(now?.lock ?? g.lock)]] as [string, string][] : [])];
            return { data: { ...brief(g), status }, card: { type: 'kv', title: g.name, icon: 'cpu', href, source, rows } };
          },
        },
        guest_power: {
          label: 'Changed a guest\'s power',
          description: 'Start, shut down (a clean ACPI shutdown) or reboot one Proxmox VM or container, by name or id. Check guest_status first if you are not sure which one is meant; an ambiguous name is refused. Proxmox runs it as a task and it takes a little while: check guest_status afterwards.',
          access: 'control', input: Power,
          async confirm({ guest, action }: z.infer<typeof Power>) {
            try {
              const g = await find(guest);
              return { title: `${VERB[action]} ${g.name}?`, detail: `${kindOf(g) === 'VM' ? 'VM' : 'Container'} ${g.vmid} on ${g.node}, ${g.status === 'running' ? `running for ${uptime(g.uptime)}` : g.status} now.`, verb: VERB[action], danger: action !== 'start', logo: '/api/icon/proxmox' };
            } catch (e) { return { title: `Can't ${VERB[action].toLowerCase()} "${guest}"`, detail: (e as Error).message, logo: '/api/icon/proxmox' }; }
          },
          async run({ guest, action }: z.infer<typeof Power>) {
            const g = await find(guest);
            if (action === 'start' && g.status === 'running') return { data: { name: g.name, note: 'already running; nothing done' } };
            if (action !== 'start' && g.status === 'stopped') return { data: { name: g.name, note: 'already stopped; nothing done' } };
            const task = await api<string>(`/nodes/${g.node}/${g.type}/${g.vmid}/status/${action}`, 'POST');
            cached = undefined;
            return { data: { name: g.name, vmid: g.vmid, node: g.node, action, task }, card: { type: 'text', tone: 'good', text: `${{ start: 'Starting', shutdown: 'Shutting down', reboot: 'Rebooting' }[action]} ${g.name}.` } };
          },
        },
      },
    };
  },
});
