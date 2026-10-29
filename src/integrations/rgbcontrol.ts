// rgb-control: a PC's case lighting and cooler, drawn as a live 3D model with its
// temperatures, pump and fan speeds beside it.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'rgb-control',
  name: 'PC lighting',
  config: z.object({
    url: z.string().url(),                     // where Atrium reaches it, e.g. http://host:8098
    href: z.string().optional(),               // where the card links to
    interval: z.number().default(10_000),
  }),
  create(cfg, ctx) {
    const get = () => ctx.http<any>(`${cfg.url}/api/state`, { timeout: 5000 });
    const deg = (v?: number | null) => v == null ? undefined : Math.round(v);
    const heat = (v?: number | null) => v == null ? undefined : v >= 90 ? 'bad' as const : v >= 80 ? 'warn' as const : undefined;
    const NAMES: Record<string, string> = { ffffff: 'white', ffd2a1: 'warm white', ff3b30: 'red', ff9500: 'orange', ffd60a: 'yellow', '34c759': 'green',
      '00e0c6': 'teal', '0a84ff': 'blue', '5e5ce6': 'indigo', bf5af2: 'purple', ff2d92: 'pink' };
    const words = (st: any) => {
      if (!st || st.mode === 'Off') return 'off';
      if (/rainbow|spectrum|wave|cycle/i.test(st.mode)) return st.mode.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const hex = st.color.map((v: number) => v.toString(16).padStart(2, '0')).join('');
      return `${NAMES[hex] ?? '#' + hex}${(st.brightness ?? 100) < 100 ? ` at ${st.brightness}%` : ''}`;
    };
    return {
      widgets: {
        pc: {
          title: 'Desktop', interval: cfg.interval,
          async fetch() {
            const s = await get(), t = s.telemetry ?? {}, fans = (t.hub_rpm ?? []).filter((v: number) => v);
            const parts = s.cards.filter((c: any) => !c.error && c.zones).map((c: any) => ({ id: c.id, title: c.title, zones: c.zones.map((z: any) => z.state) }));
            const lit = parts.find((p: any) => p.zones[0]?.mode !== 'Off');
            return {
              type: 'showcase', title: 'Desktop', icon: 'cpu', href: cfg.href ?? cfg.url, wide: true,
              // the screen preview changes every minute; the minute in the ref busts the browser cache
              visual: { kind: 'pc-case', data: { parts, layout: s.layout, screen: ctx.image(`lcd:${Math.floor(Date.now() / 60_000)}`) } },
              items: [
                t.cpu_temp != null && { label: 'CPU', value: deg(t.cpu_temp)!, unit: '°C', tone: heat(t.cpu_temp) },
                t.gpu_temp != null && { label: 'GPU', value: deg(t.gpu_temp)!, unit: '°C', sub: t.gpu_power != null ? `${Math.round(t.gpu_power)} W` : undefined, tone: heat(t.gpu_temp) },
                t.liquid_temp != null && { label: 'Coolant', value: t.liquid_temp.toFixed(1), unit: '°C' },
                t.pump_rpm != null && { label: 'Pump', value: t.pump_rpm.toLocaleString(), unit: 'rpm' },
                fans.length && { label: 'Fans', value: Math.round(fans.reduce((a: number, b: number) => a + b, 0) / fans.length).toLocaleString(), unit: 'rpm' },
                t.ram_used != null && { label: 'Memory', value: Math.round(t.ram_used), unit: 'GB', sub: `of ${Math.round(t.ram_total)} GB` },
              ].filter(Boolean),
              caption: lit ? `Lights · ${words(lit.zones[0])}` : 'Lights off',
            };
          },
        },
      },
      tools: {
        pc_status: {
          description: "The desktop's temperatures (CPU, GPU, coolant), pump and fan speeds, and what its lights are set to.",
          access: 'read', input: z.object({}),
          async run() {
            const s = await get();
            return { data: { telemetry: s.telemetry, lights: s.cards.filter((c: any) => c.zones).map((c: any) => ({ part: c.title, state: c.zones[0].state })) } };
          },
        },
      },
      image(ref) {
        if (!/^lcd:\d+$/.test(ref)) throw new Error('bad image ref');
        return fetch(`${cfg.url}/api/lcd/preview`, { signal: AbortSignal.timeout(8000) });
      },
    };
  },
});
