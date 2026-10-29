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
    presets: z.boolean().default(true),        // show the lighting presets when no part is selected
    controls: z.boolean().default(true),       // allow changing lights from the card (false: look, don't touch)
    view: z.object({                           // the model's starting angle; drag to look around
      turn: z.number().default(-15),           // degrees left/right
      tilt: z.number().default(12),            // degrees up/down
      draggable: z.boolean().default(true),
    }).default({ turn: -15, tilt: 12, draggable: true }),
  }),
  create(cfg, ctx) {
    const get = () => ctx.http<any>(`${cfg.url}/api/state`, { timeout: 5000 });
    const deg = (v?: number | null) => v == null ? undefined : Math.round(v);
    const heat = (v?: number | null) => v == null ? undefined : v >= 90 ? 'bad' as const : v >= 80 ? 'warn' as const : undefined;
    return {
      widgets: {
        pc: {
          title: 'Desktop', interval: cfg.interval,
          async fetch() {
            const s = await get(), t = s.telemetry ?? {}, hub: number[] = t.hub_rpm ?? [];
            const parts = s.cards.filter((c: any) => !c.error && c.zones)
              .map((c: any) => ({ id: c.id, title: c.title, sub: c.sub, modes: c.modes, zones: c.zones.map((z: any) => z.state) }));
            const fans = Object.fromEntries(hub.map((rpm, i) => [`fans${i}`, rpm]));
            const m = (label: string, value: string | number | undefined, unit: string, pct: number, tone?: 'warn' | 'bad') =>
              value == null ? null : { label, value, unit, pct, tone };
            const range = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
            // what each part of the model shows when you select it, as rings: how far along its range, coloured by health
            const metrics: Record<string, unknown[]> = {
              pump: [m('CPU', deg(t.cpu_temp), '°C', range(t.cpu_temp, 25, 95), heat(t.cpu_temp)),
                m('Coolant', t.liquid_temp?.toFixed(1), '°C', range(t.liquid_temp, 20, 50), t.liquid_temp > 45 ? 'warn' : undefined),
                m('Pump', t.pump_rpm != null ? (t.pump_rpm / 1000).toFixed(1) + 'k' : undefined, 'rpm', t.pump_rpm / 3200)],
              gpu: [m('Temp', deg(t.gpu_temp), '°C', range(t.gpu_temp, 25, 90), heat(t.gpu_temp)),
                m('Power', t.gpu_power != null ? Math.round(t.gpu_power) : undefined, 'W', t.gpu_power / 575)],
              ram: [m('In use', t.ram_used != null ? Math.round(t.ram_used) : undefined, 'GB', t.ram_used / t.ram_total, t.ram_used / t.ram_total > .9 ? 'warn' : undefined),
                m('Free', t.ram_total != null ? Math.round(t.ram_total - t.ram_used) : undefined, 'GB', 1 - t.ram_used / t.ram_total)],
              ...Object.fromEntries(hub.map((rpm, i) => [`fans${i}`, [m('Speed', rpm.toLocaleString(), 'rpm', rpm / 2100),
                m('Coolant', t.liquid_temp?.toFixed(1), '°C', range(t.liquid_temp, 20, 50))]])),
            };
            for (const k in metrics) metrics[k] = metrics[k].filter(Boolean);
            return {
              type: 'showcase', title: 'Desktop', icon: 'cpu', href: cfg.href ?? cfg.url, wide: true,
              // the screen preview changes every minute; the minute in the ref busts the browser cache
              visual: { kind: 'pc-case', data: { parts, layout: s.layout, fans, metrics, view: cfg.view, controls: cfg.controls,
                presets: cfg.presets && cfg.controls ? s.presets : undefined, screen: ctx.image(`lcd:${Math.floor(Date.now() / 60_000)}`) } },
              items: [],
            };
          },
        },
      },
      actions: {
        preset: {
          description: 'Apply a lighting preset to the whole PC',
          input: z.object({ id: z.string() }),
          async run({ id }) {
            if (!cfg.controls) throw new Error('controls are off');
            const r = await fetch(`${cfg.url}/api/preset`, { method: 'POST', headers: { 'X-RGB': '1', 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }), signal: AbortSignal.timeout(8000) });
            if (!r.ok && r.status !== 207) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
            return r.json();
          },
        },
        light: {
          description: "Set one part's lighting: colour, effect and brightness",
          input: z.object({
            part: z.string(),
            state: z.object({ mode: z.string().optional(), color: z.array(z.number().int().min(0).max(255)).length(3).optional(), brightness: z.number().min(0).max(100).optional() }),
          }),
          async run({ part, state }) {
            if (!cfg.controls) throw new Error('controls are off');
            const s = await get(), c = s.cards.find((c: any) => c.id === part && c.zones);
            if (!c) throw new Error(`no part ${part}`);
            const r = await fetch(`${cfg.url}/api/zones`, { method: 'POST', headers: { 'X-RGB': '1', 'Content-Type': 'application/json' },
              body: JSON.stringify({ zones: c.zones.map((z: any) => z.id), state }), signal: AbortSignal.timeout(8000) });
            if (!r.ok && r.status !== 207) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
            return r.json();
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
