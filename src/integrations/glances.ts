// Glances (https://nicolargo.github.io/glances/) API v4: CPU, memory, temperatures, GPU, disks, network.
import { z } from 'zod';
import { defineIntegration, fmt, type Instance } from '../server/core.ts';
import type { StatItem } from '../shared/cards.ts';

const heat = (c?: number) => c == null ? 'neutral' : c >= 85 ? 'bad' : c >= 75 ? 'warn' : 'neutral';

export default defineIntegration({
  type: 'glances',
  name: 'Glances',
  config: z.object({
    url: z.string().url(),
    disks: z.array(z.string()).optional(),         // mount points to show; default: every real disk
    network: z.string().optional(),                // interface to show, e.g. "eth0"
    cpuSensor: z.string().default('CPU'),          // label of the CPU temperature sensor
  }),
  create(cfg, ctx) {
    const api = (p: string) => ctx.http(`${cfg.url.replace(/\/$/, '')}/api/4/${p}`);
    const hist = { cpu: [] as number[], mem: [] as number[], gpu: [] as number[] };
    const push = (a: number[], v: number) => { a.push(Math.round(v)); if (a.length > 40) a.shift(); };

    async function overview() {
      const [cpu, mem, sensors, gpus, uptime] = await Promise.all([
        api('cpu'), api('mem'), api('sensors').catch(() => []), api('gpu').catch(() => []), api('uptime').catch(() => ''),
      ]);
      const temp = (sensors as any[]).find(s => s.label === cfg.cpuSensor)?.value as number | undefined;
      const gpu = (gpus as any[]).filter(g => g.temperature != null).sort((a, b) => (b.mem ?? 0) - (a.mem ?? 0))[0];
      push(hist.cpu, cpu.total); push(hist.mem, mem.percent); if (gpu) push(hist.gpu, gpu.proc ?? 0);
      return { cpu, mem, temp, gpu, uptime: String(uptime) };
    }

    async function disks() {
      const fs = (await api('fs')) as any[];
      const seen = new Set<string>();
      return fs.filter(d => {
        if (cfg.disks) return cfg.disks.includes(d.mnt_point);
        if (seen.has(d.device_name) || !d.device_name.startsWith('/dev/')) return false;   // bind mounts repeat devices
        seen.add(d.device_name); return true;
      });
    }

    const widgets = {
        overview: {
          title: 'System', interval: 5000,
          async fetch() {
            const o = await overview();
            const items: StatItem[] = [
              { label: 'CPU', value: Math.round(o.cpu.total), unit: '%', pct: o.cpu.total / 100, trend: [...hist.cpu],
                sub: o.temp != null ? `${o.temp}°C` : undefined, tone: heat(o.temp) },
              { label: 'Memory', value: Math.round(o.mem.percent), unit: '%', pct: o.mem.percent / 100, trend: [...hist.mem],
                sub: `${fmt.bytes(o.mem.used, 0)} of ${fmt.bytes(o.mem.total, 0)}` },
            ];
            if (o.gpu) items.push({ label: 'GPU', value: Math.round(o.gpu.proc ?? 0), unit: '%', pct: (o.gpu.proc ?? 0) / 100,
              trend: [...hist.gpu], sub: `${o.gpu.temperature}°C · VRAM ${Math.round(o.gpu.mem)}%`, tone: heat(o.gpu.temperature) });
            items.push({ label: 'Uptime', value: o.uptime.replace(/:\d\d$/, '').replace(' days, ', 'd ') });
            return { type: 'stats', title: 'System', icon: 'cpu', items };
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
        system_status: {
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
