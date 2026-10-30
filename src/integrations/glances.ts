// Glances (https://nicolargo.github.io/glances/) API v4: CPU, memory, temperatures, GPU, disks, network.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { StatItem, Summary } from '../shared/cards.ts';

const heat = (c?: number) => c == null ? 'neutral' : c >= 85 ? 'bad' : c >= 75 ? 'warn' : 'neutral';

export default defineIntegration({
  type: 'glances',
  name: 'Glances',
  config: z.object({
    url: z.string().url(),
    // mount points to show (default: every real disk); { mount, name, sub } to label a tile, e.g. { mount: /ssd, name: SSD }
    disks: z.array(z.union([z.string(), z.object({ mount: z.string(), name: z.string(), sub: z.string().optional() })])).optional(),
    network: z.string().optional(),                // interface to show, e.g. "eth0"
    cpuSensor: z.string().default('CPU'),          // label of the CPU temperature sensor
  }),
  create(cfg, ctx) {
    const api = (p: string) => ctx.http(`${cfg.url.replace(/\/$/, '')}/api/4/${p}`);
    const hist = { cpu: [] as number[], mem: [] as number[], gpu: [] as number[], rx: [] as number[] };
    let lastPoint = 0;
    const diskHist = new Map<string, number[]>();
    const mounts = (cfg.disks ?? []).map(d => typeof d === 'string' ? { mount: d, name: d, sub: undefined } : d);
    let cpuName: string | undefined;
    const push = (a: number[], v: number) => { a.push(Math.round(v)); if (a.length > 40) a.shift(); };

    async function overview() {
      const [cpu, mem, sensors, gpus, uptime] = await Promise.all([
        api('cpu'), api('mem'), api('sensors').catch(() => []), api('gpu').catch(() => []), api('uptime').catch(() => ''),
      ]);
      const temp = (sensors as any[]).find(s => s.label === cfg.cpuSensor)?.value as number | undefined;
      const gpu = (gpus as any[]).filter(g => g.temperature != null).sort((a, b) => (b.mem ?? 0) - (a.mem ?? 0))[0];
      // several widgets read this; record a graph point at most every ~3 s so the graphs keep an even pace
      if (Date.now() - lastPoint >= 2500) { lastPoint = Date.now(); push(hist.cpu, cpu.total); push(hist.mem, mem.percent); if (gpu) push(hist.gpu, gpu.proc ?? 0); }
      return { cpu, mem, temp, gpu, uptime: String(uptime) };
    }

    async function disks() {
      const fs = (await api('fs')) as any[];
      const seen = new Set<string>();
      return fs.filter(d => {
        if (cfg.disks) return mounts.some(m => m.mount === d.mnt_point);
        if (seen.has(d.device_name) || !d.device_name.startsWith('/dev/')) return false;   // bind mounts repeat devices
        seen.add(d.device_name); return true;
      });
    }

    async function network() {
      if (!cfg.network) return undefined;
      const nets = (await api('network').catch(() => [])) as any[];
      return nets.find(n => n.interface_name === cfg.network);
    }

    const widgets = {
        // headline tiles like a classic homelab dashboard: CPU, memory, GPU, network, then one per disk
        tiles: {
          title: 'System', interval: 3000,
          async fetch() {
            const [o, net, d] = await Promise.all([overview(), network(), disks()]);
            cpuName ??= await api('quicklook').then(q => String(q.cpu_name ?? '').replace(/ \d+-Core Processor$/, '').replace(/^AMD /, '')).catch(() => undefined);
            const tiles: Summary[] = [
              { label: 'CPU', icon: 'cpu', sub: cpuName, value: `${Math.round(o.cpu.total)}%`, detail: o.temp != null ? `${o.temp}°C` : undefined, trend: [...hist.cpu],
                pct: o.cpu.total / 100, tone: o.cpu.total > 90 ? 'warn' : heat(o.temp) === 'neutral' ? 'good' : heat(o.temp) },
              { label: 'Memory', icon: 'memory', sub: fmt.bytes(o.mem.total, 0), value: `${Math.round(o.mem.percent)}%`, detail: `${fmt.bytes(o.mem.used, 1)} used`, trend: [...hist.mem],
                pct: o.mem.percent / 100, tone: o.mem.percent > 95 ? 'bad' : o.mem.percent > 85 ? 'warn' : 'good' },
            ];
            if (net) {
              push(hist.rx, net.bytes_recv_rate_per_sec ?? 0);
              const peak = Math.max(...hist.rx, 1);
              tiles.push({ label: 'Network', icon: 'wifi', sub: net.interface_name, value: fmt.speed(net.bytes_recv_rate_per_sec ?? 0), detail: `↑ ${fmt.speed(net.bytes_sent_rate_per_sec ?? 0)}`, trend: [...hist.rx],
                pct: (net.bytes_recv_rate_per_sec ?? 0) / peak, tone: 'accent', ring: fmt.speed(net.bytes_recv_rate_per_sec ?? 0).replace('/s', '') });
            }
            if (o.gpu) tiles.push({ label: 'GPU', icon: 'gpu', sub: String(o.gpu.name).replace(/^NVIDIA GeForce /, ''), value: `${Math.round(o.gpu.proc ?? 0)}%`,
              detail: `${o.gpu.temperature}°C · VRAM ${Math.round(o.gpu.mem)}%`, trend: [...hist.gpu], pct: (o.gpu.proc ?? 0) / 100,
              tone: heat(o.gpu.temperature) === 'neutral' ? 'good' : heat(o.gpu.temperature) });
            for (const x of d) {
              const m = mounts.find(m => m.mount === x.mnt_point);
              const h = diskHist.get(x.mnt_point) ?? []; push(h, x.percent); diskHist.set(x.mnt_point, h);
              tiles.push({ label: m?.name ?? x.mnt_point, icon: 'disk', sub: m?.sub ?? fmt.bytes(x.size, 0), value: `${fmt.bytes(x.free, 1)} free`,
                detail: `${Math.round(x.percent)}% used`, trend: [...h], pct: x.percent / 100, ring: `${Math.round(x.percent)}%`,
                tone: x.percent > 90 ? 'bad' : x.percent > 80 ? 'warn' : 'good' });
            }
            return { type: 'stats', title: 'System', icon: 'cpu', items: [], summaries: tiles };
          },
        },

        overview: {
          title: 'System', interval: 5000,
          async fetch() {
            const o = await overview();
            cpuName ??= await api('quicklook').then(q => String(q.cpu_name ?? '').replace(/ \d+-Core Processor$/, '').replace(/^AMD /, '')).catch(() => undefined);
            const items: StatItem[] = [
              { label: 'CPU', value: Math.round(o.cpu.total), unit: '%', pct: o.cpu.total / 100, trend: [...hist.cpu],
                sub: o.temp != null ? `${o.temp}°C` : undefined, tone: heat(o.temp) },
              { label: 'Memory', value: Math.round(o.mem.percent), unit: '%', pct: o.mem.percent / 100, trend: [...hist.mem],
                sub: `${fmt.bytes(o.mem.used, 0)} of ${fmt.bytes(o.mem.total, 0)}` },
            ];
            if (o.gpu) items.push({ label: 'GPU', value: Math.round(o.gpu.proc ?? 0), unit: '%', pct: (o.gpu.proc ?? 0) / 100,
              trend: [...hist.gpu], sub: `${o.gpu.temperature}°C · VRAM ${Math.round(o.gpu.mem)}%`, tone: heat(o.gpu.temperature) });
            items.push({ label: 'Uptime', value: o.uptime.replace(/:\d\d$/, '').replace(' days, ', 'd ') });
            return { type: 'stats', title: 'System', icon: 'cpu', items,
              summary: { label: 'CPU', icon: 'cpu', value: `${Math.round(o.cpu.total)}%`, sub: cpuName, trend: [...hist.cpu],
                detail: [o.temp != null ? `${o.temp}°C` : '', `RAM ${Math.round(o.mem.percent)}%`].filter(Boolean).join(' · '), tone: heat(o.temp) } };
          },
        },
        disks: {
          title: 'Storage', interval: 60_000,
          async fetch() {
            const d = await disks();
            return { type: 'list', title: 'Storage', icon: 'disk', items: d.map(x => ({
              title: x.mnt_point, meta: `${fmt.bytes(x.free, 1)} free`, pct: x.percent / 100,
              subtitle: `${fmt.bytes(x.used, 1)} of ${fmt.bytes(x.size, 1)}`,
              tone: x.percent > 90 ? 'bad' : x.percent > 80 ? 'warn' : 'neutral' })) };
          },
        },
    } satisfies Instance['widgets'];

    return {
      widgets,
      tools: {
        top_programs: {
          label: "Checked what's running",
          description: 'What is using the server right now: the programs using the most CPU or memory (grouped by program name). Use for "why is the fan loud", "what is eating my RAM".',
          access: 'read', input: z.object({ by: z.enum(['cpu', 'memory']).default('cpu'), limit: z.number().int().min(1).max(20).default(8) }),
          async run({ by, limit }) {
            const list = (await api('programlist') as any[]).map(p => ({ name: p.name, cpu: Math.round(p.cpu_percent * 10) / 10, memPct: Math.round((p.memory_percent ?? 0) * 10) / 10,
              mem: p.memory_info?.rss ?? 0, procs: p.nprocs })).sort((a, b) => by === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem).slice(0, limit);
            return { data: list.map(p => ({ ...p, mem: fmt.bytes(p.mem) })),
              card: { type: 'list', title: by === 'cpu' ? 'Using the CPU' : 'Using memory', icon: by === 'cpu' ? 'cpu' : 'memory',
                items: list.map(p => ({ title: p.name, subtitle: `${p.procs} process${p.procs > 1 ? 'es' : ''}`, meta: by === 'cpu' ? `${p.cpu}%` : fmt.bytes(p.mem), pct: by === 'cpu' ? Math.min(1, p.cpu / 100) : Math.min(1, p.memPct / 100) })) } };
          },
        },
        system_status: {
          live: true,
          label: 'Checked the server',
          description: 'Current CPU, memory, CPU/GPU temperatures, GPU load and uptime of the server, plus disk usage.',
          access: 'read', input: z.object({}),
          async run() {
            const [o, d] = await Promise.all([overview(), disks()]);
            return {
              data: { cpuPercent: o.cpu.total, cpuTempC: o.temp, memPercent: o.mem.percent, memUsed: fmt.bytes(o.mem.used),
                      memTotal: fmt.bytes(o.mem.total), uptime: o.uptime,
                      gpu: o.gpu && { name: o.gpu.name, loadPercent: o.gpu.proc, tempC: o.gpu.temperature, vramPercent: Math.round(o.gpu.mem) },
                      disks: d.map(x => ({ mount: x.mnt_point, percent: x.percent, free: fmt.bytes(x.free) })) },
              card: { type: 'group', layout: 'column', cards: [await widgets.overview.fetch(), await widgets.disks.fetch()] },
            };
          },
        },
      },
    };
  },
});
