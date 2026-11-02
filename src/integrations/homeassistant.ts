// Home Assistant (REST API, long-lived token): cards of chosen entities as live controls, and tools to look up any
// entity and (with approval) control the ones you've put on the page or listed under `controllable`.
import { z } from 'zod';
import { defineIntegration, type Instance, type Widget } from '../server/core.ts';
import type { Control, ThermostatCard, ThermostatMode } from '../shared/cards.ts';

const PRESS = new Set(['scene', 'script', 'button', 'input_button', 'automation']);
const TOGGLE = new Set(['light', 'switch', 'input_boolean', 'fan', 'media_player', 'climate', 'humidifier', 'siren', 'remote']);

const rgb = (a: any) => Array.isArray(a?.rgb_color) ? `rgb(${a.rgb_color.join(',')})` : undefined;

export default defineIntegration({
  type: 'homeassistant',
  name: 'Home Assistant',
  config: z.object({
    url: z.string().url(),
    token: z.string(),
    href: z.string().optional(),
    // each entry becomes a homepage widget: `<instance>.<key>`
    // entities are ids, or { id, name } to rename one on the page
    cards: z.record(z.string(), z.object({ title: z.string(), icon: z.string().optional(),
      entities: z.array(z.union([z.string(), z.object({ id: z.string(), name: z.string() })])) })).default({}),
    controllable: z.array(z.string()).default([]),   // extra entities the assistant may control (cards' entities always may)
    // each entry becomes a schedule widget `<instance>.<key>`: timestamp sensors (bin days, a timetable) as a day's
    // timeline with the next one counting down; within `soon` minutes it also shows as a live ring
    schedules: z.record(z.string(), z.object({
      title: z.string(),
      icon: z.string().optional(),
      entities: z.array(z.object({ id: z.string(), name: z.string(), muted: z.boolean().default(false) })),
      sunset: z.string().optional(),   // which entity's name marks sunset, for the sky behind the card
      soon: z.number().int().min(0).max(240).default(15),
    })).default({}),
    // each entry becomes a thermostat widget `<instance>.<key>`: a dial for one climate entity. `modes` picks and orders
    // the buttons (HVAC modes and presets, by Home Assistant's names); leave it out for all of them. `unit` is only needed
    // if Home Assistant can't say which it uses
    thermostats: z.record(z.string(), z.object({
      entity: z.string().regex(/^climate\./, 'a climate entity'),
      title: z.string().optional(),
      modes: z.array(z.string()).optional(),
      unit: z.enum(['C', 'F']).optional(),
    })).default({}),
    // each entry becomes a 3D floor plan widget `<instance>.<key>`: rooms come from a robot vacuum's map camera
    // (e.g. Dreame's camera.*_map), lit by the lights you list per room; the robot and its dock sit where they are
    floorplans: z.record(z.string(), z.object({
      title: z.string().default('Home'),
      map: z.string(),                                   // camera entity whose attributes carry `rooms` (x0..y1 in mm)
      vacuum: z.string().optional(),                     // vacuum entity: drawn on the plan, controllable from it
      rooms: z.record(z.string(), z.array(z.string())).default({}),   // room name (as on the map) → its lights
      hide: z.array(z.string()).default([]),             // map rooms to leave out (balconies, say)
      rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
      flip: z.boolean().default(true),                   // mirror top-to-bottom (vacuum maps usually count y upwards)
      view: z.object({ turn: z.number().default(-40), tilt: z.number().default(-35) }).default({ turn: -40, tilt: -35 }),
    })).default({}),
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
    // every card and the floor plan read the same /api/states (all entities, can be MBs): share one download briefly
    let cached: { at: number; p: Promise<any[]> } | null = null;
    const states = () => {
      if (cached && Date.now() - cached.at < 2000) return cached.p;
      const p = ctx.http<any[]>(`${base}/api/states`, { headers });
      cached = { at: Date.now(), p };
      p.catch(() => { if (cached?.p === p) cached = null; });
      return p;
    };
    const call = (domain: string, service: string, data: Record<string, unknown>) =>
      ctx.http(`${base}/api/services/${domain}/${service}`, { method: 'POST', headers, body: JSON.stringify(data) });
    const ids = (c: (typeof cfg.cards)[string]) => c.entities.map(e => typeof e === 'string' ? e : e.id);
    const names = new Map(Object.values(cfg.cards).flatMap(c => c.entities).flatMap(e => typeof e === 'string' ? [] : [[e.id, e.name] as const]));
    const planEntities = Object.values(cfg.floorplans).flatMap(f => [...Object.values(f.rooms).flat(), ...(f.vacuum ? [f.vacuum] : [])]);
    const allowed = new Set([...Object.values(cfg.cards).flatMap(ids), ...cfg.controllable, ...planEntities, ...Object.values(cfg.thermostats).map(t => t.entity)]);
    // "L50 Ultra  L50 Ultra" → "L50 Ultra"; a configured name always wins
    const nameOf = (e: any) => names.get(e.entity_id) ?? String(e.attributes?.friendly_name ?? e.entity_id).replace(/\s+/g, ' ').replace(/^(.+?) \1$/, '$1');

    function control(e: any): Control {
      const [domain] = e.entity_id.split('.');
      const a = e.attributes ?? {};
      const label = nameOf(e);
      const off = e.state === 'unavailable' || e.state === 'unknown';
      if (PRESS.has(domain)) return { id: e.entity_id, label, kind: 'button', value: domain === 'automation' ? 'Trigger' : 'Run', action: 'press', args: { entity_id: e.entity_id } };
      if (domain === 'vacuum') {
        const docked = ['docked', 'idle'].includes(e.state);
        return { id: e.entity_id, label, sub: e.state, kind: 'button', value: docked ? 'Start' : 'Dock', action: 'press', args: { entity_id: e.entity_id, service: docked ? 'start' : 'return_to_base' } };
      }
      if ((domain === 'select' || domain === 'input_select') && Array.isArray(a.options) && !off)
        return { id: e.entity_id, label, kind: 'select', value: e.state, options: a.options, action: 'choose', args: { entity_id: e.entity_id } };
      if (TOGGLE.has(domain)) return {
        id: e.entity_id, label, kind: off ? 'value' : 'toggle', value: off ? 'Unavailable' : e.state !== 'off', color: e.state === 'on' ? rgb(a) : undefined,
        sub: domain === 'light' && e.state === 'on' && a.brightness != null ? `${Math.round(a.brightness / 2.55)}%` : domain === 'media_player' && e.state !== 'off' ? (a.media_title ?? e.state) : undefined,
        action: 'set', args: { entity_id: e.entity_id },
      };
      const unit = a.unit_of_measurement ? ` ${a.unit_of_measurement}` : '';
      const n = Number(e.state);
      return { id: e.entity_id, label, kind: 'value', value: Number.isFinite(n) && e.state !== '' ? `${Math.round(n * 10) / 10}${unit}` : e.state };
    }

    const widgets: Record<string, Widget> = {};
    for (const [key, card] of Object.entries(cfg.cards)) {
      widgets[key] = {
        title: card.title, interval: 5000,
        async fetch() {
          const byId = new Map((await states()).map(s => [s.entity_id, s]));
          return { type: 'controls', title: card.title, icon: card.icon ?? 'home', href: cfg.href,
            items: ids(card).map(id => byId.get(id) ? control(byId.get(id)) : { id, label: id, kind: 'value', value: 'not found' } as Control) };
        },
      };
    }

    // ── schedules: a day of timestamp sensors; times already past roll to tomorrow (same clock time) for "next"
    for (const [key, sch] of Object.entries(cfg.schedules)) {
      widgets[key] = {
        title: sch.title, interval: 60_000,
        async fetch() {
          const byId = new Map((await states()).map(s => [s.entity_id, s]));
          const items = sch.entities.map(e => ({ name: e.name, at: byId.get(e.id)?.state, muted: e.muted }))
            .filter((x): x is { name: string; at: string; muted: boolean } => !!x.at && !Number.isNaN(Date.parse(x.at)))
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
          const now = Date.now();
          const nexts = items.filter(x => !x.muted).map(x => ({ ...x, t: Date.parse(x.at) <= now ? Date.parse(x.at) + 864e5 : Date.parse(x.at) })).sort((a, b) => a.t - b.t);
          const next = nexts[0], mins = next ? Math.round((next.t - now) / 60_000) : 0;
          const left = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
          return { type: 'schedule', title: sch.title, icon: sch.icon ?? 'clock', sunset: sch.sunset, items: items.map(({ name, at }) => ({ name, at })), muted: items.filter(x => x.muted).map(x => x.name),
            summary: next && { label: sch.title, icon: sch.icon ?? 'clock', value: next.name, sub: new Date(next.t).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }), detail: `in ${left}` },
            activity: next && mins <= sch.soon ? { title: `${next.name} in ${left}`, subtitle: sch.title, icon: sch.icon ?? 'clock', tone: 'good', pct: 1 - mins / Math.max(1, sch.soon) } : undefined };
        },
      };
    }

    // ── floor plans: the vacuum's map (mm) → plan units; lights per room; the robot and its dock
    const hexOf = (c?: number[]) => Array.isArray(c) ? '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : undefined;
    for (const [key, plan] of Object.entries(cfg.floorplans)) {
      widgets[key] = {
        title: plan.title, interval: 5000,
        async fetch() {
          const all = await states(), byId = new Map(all.map(s => [s.entity_id, s]));
          const map = byId.get(plan.map)?.attributes;
          if (!map?.rooms) throw new Error(`${plan.map} has no rooms`);
          const turn = (x: number, y: number): [number, number] => {
            const [a, b] = plan.rotate === 90 ? [-y, x] : plan.rotate === 180 ? [-x, -y] : plan.rotate === 270 ? [y, -x] : [x, y];
            return [a, plan.flip ? -b : b];
          };
          const rect = (x0: number, y0: number, x1: number, y1: number) => {
            const [a, b] = turn(x0, y0), [c, d] = turn(x1, y1);
            return { x: Math.min(a, c), z: Math.min(b, d), w: Math.abs(c - a), d: Math.abs(d - b) };
          };
          const rooms = Object.values(map.rooms as Record<string, any>)
            .filter(r => r.visibility !== 'Hidden' && !plan.hide.includes(r.name))
            .map(r => ({ id: r.room_id as number, name: r.name as string, floor: /tile/i.test(r.floor_material ?? '') ? 'tile' : 'wood', ...rect(r.x0, r.y0, r.x1, r.y1) }));
          // fit the plan into ~560 units, centred on the origin
          const minX = Math.min(...rooms.map(r => r.x)), maxX = Math.max(...rooms.map(r => r.x + r.w));
          const minZ = Math.min(...rooms.map(r => r.z)), maxZ = Math.max(...rooms.map(r => r.z + r.d));
          const s = 560 / Math.max(maxX - minX, maxZ - minZ), mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
          const P = (r: { x: number; z: number; w: number; d: number }) => ({ x: (r.x - mx) * s, z: (r.z - mz) * s, w: r.w * s, d: r.d * s });
          const point = (p?: { x: number; y: number; a?: number }) => { if (!p) return undefined; const [x, z] = turn(p.x, p.y); return { x: (x - mx) * s, z: (z - mz) * s, a: ((p.a ?? 0) + plan.rotate) * (plan.flip ? -1 : 1) }; };
          const light = (id: string) => {
            const e = byId.get(id), a = e?.attributes ?? {};
            const modes: string[] = a.supported_color_modes ?? [];
            return { id, name: nameOf(e ?? { entity_id: id }), on: e?.state === 'on', available: !!e && e.state !== 'unavailable',
              color: hexOf(a.rgb_color), level: a.brightness != null ? Math.round(a.brightness / 2.55) : e?.state === 'on' ? 100 : 0,
              kelvin: a.color_temp_kelvin, canColor: modes.some(m => ['xy', 'hs', 'rgb', 'rgbw', 'rgbww'].includes(m)), canTemp: modes.includes('color_temp'),
              dims: modes.some(m => m !== 'onoff') };
          };
          const v = plan.vacuum ? byId.get(plan.vacuum) : undefined, va = v?.attributes ?? {};
          const sensor = (suffix: string) => { const id = plan.vacuum?.replace(/^vacuum\./, `sensor.`) + `_${suffix}`; const n = Number(byId.get(id)?.state); return Number.isFinite(n) ? n : undefined; };
          const cleaning = v && /clean|return|mop|pause/i.test(v.state) && v.state !== 'docked';
          const battery = sensor('battery_level') ?? va.battery_level;
          return {
            type: 'showcase', title: plan.title, icon: 'home', href: cfg.href, wide: true, items: [],
            activity: cleaning ? { title: 'Vacuum', subtitle: String(va.status ?? v.state).replace(/_/g, ' '), icon: 'home',
              pct: battery != null ? battery / 100 : undefined, trailing: battery != null ? `${battery}%` : undefined, paused: /pause/i.test(v.state) } : undefined,
            visual: { kind: 'home', data: {
              view: plan.view,
              rooms: rooms.map(r => ({ ...r, ...P(r), lights: (plan.rooms[r.name] ?? []).map(light) })),
              furniture: (map.furnitures ?? []).filter((f: any) => rooms.some(r => r.id === f.room_id)).map((f: any) => ({
                type: String(f.type), room: f.room_id, angle: f.angle ?? 0, ...P(rect(f.x0, f.y0, f.x0 + f.width, f.y0 + f.height)) })),
              dock: point(map.charger_position),
              robot: v && { ...point(map.vacuum_position), id: plan.vacuum, state: v.state, status: va.status, error: va.error !== 'No error' ? va.error : undefined,
                battery: sensor('battery_level') ?? va.battery_level, fanSpeed: va.fan_speed, fanSpeeds: va.fan_speed_list ?? [],
                cleaningMode: va.cleaning_mode, cleanedArea: va.cleaned_area, cleaningTime: va.cleaning_time,
                wear: [['Main brush', va.main_brush_left], ['Side brush', va.side_brush_left], ['Filter', va.filter_left]].filter(([, n]) => n != null) },
            } },
          };
        },
      };
    }

    // ── thermostats: a climate entity as a dial. Its numbers are in Home Assistant's own unit, so that's the one to show
    let system: 'C' | 'F' | undefined;
    const unitOf = async (a: any, chosen?: 'C' | 'F') => {
      if (chosen) return chosen;
      system ??= await ctx.http<any>(`${base}/api/config`, { headers }).then(c => /F/.test(c?.unit_system?.temperature ?? '') ? 'F' as const : /C/.test(c?.unit_system?.temperature ?? '') ? 'C' as const : undefined, () => undefined);
      return system ?? (Number(a.max_temp) > 50 ? 'F' : 'C');
    };
    const num = (v: unknown) => v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
    const worded = (s: string) => (s[0] ?? '').toUpperCase() + s.slice(1).replace(/_/g, ' ');
    async function thermostat(e: any, t: { title?: string; modes?: string[]; unit?: 'C' | 'F' } = {}): Promise<ThermostatCard> {
      const a = e.attributes ?? {}, id = e.entity_id, title = t.title ?? names.get(id) ?? nameOf(e), unit = await unitOf(a, t.unit);
      const away = e.state === 'unavailable' || e.state === 'unknown', hvac: string[] = a.hvac_modes ?? [], presets: string[] = a.preset_modes ?? [];
      const action = away ? undefined : a.hvac_action as string | undefined;
      const mode = away || e.state === 'off' || action === 'off' ? 'off' : action === 'heating' || e.state === 'heat' ? 'heat' : action === 'cooling' || e.state === 'cool' ? 'cool' : 'auto';
      const min = num(a.min_temp) ?? (unit === 'F' ? 45 : 7), max = Math.max(num(a.max_temp) ?? (unit === 'F' ? 95 : 35), min + 1), step = num(a.target_temp_step) || (unit === 'F' ? 1 : .5);
      const target = away || e.state === 'off' ? undefined : num(a.temperature), current = num(a.current_temperature);
      const low = num(a.target_temp_low), high = num(a.target_temp_high), range: [number, number] | undefined = !away && e.state !== 'off' && target == null && low != null && high != null ? [low, high] : undefined;
      const entry = (id_: string, label: string, on: boolean, args: Record<string, unknown>): ThermostatMode => ({ id: id_, label, on, action: 'climate', args: { entity_id: id, ...args } });
      const wake = hvac.find(m => m !== 'off');
      const all = away ? [] : [
        ...hvac.filter(m => m !== 'off' || wake).map(m => m === 'off' ? entry('off', e.state === 'off' ? 'Turn on' : 'Turn off', e.state === 'off', { hvac_mode: e.state === 'off' ? wake : 'off' }) : entry(m, worded(m), e.state === m, { hvac_mode: m })),
        // pressing the active preset clears it, where the entity has a "none" to go back to
        ...presets.filter(p => p !== 'none').map(p => entry(p, worded(p), a.preset_mode === p, { preset_mode: a.preset_mode === p && presets.includes('none') ? 'none' : p })),
      ];
      const modes = t.modes ? t.modes.flatMap(m => all.filter(x => x.id === m)) : all;
      const show = (n: number) => `${n.toFixed(step < 1 ? 1 : 0)}°`, shown = target ?? current;
      // Home Assistant's "auto" is a schedule by definition; a hold shows up as a preset on the thermostats that have one
      const note = away || e.state === 'off' ? undefined : /^(temp|temporary|hold_?temp|temporary_?hold)/i.test(a.preset_mode ?? '') ? 'Temporary hold' : /^(hold|perm)/i.test(a.preset_mode ?? '') ? 'Held until you change it' : e.state === 'auto' ? 'Following its schedule' : undefined;
      return { type: 'thermostat', title, icon: 'home', href: cfg.href, unit, state: away ? 'Unavailable' : worded(action ?? e.state), mode, current, target, range, min, max, step, note,
        set: target != null ? { action: 'climate', args: { entity_id: id } } : undefined, modes: modes.length ? modes : undefined,
        summary: { label: title, icon: 'thermometer', value: shown != null ? show(shown) : '–', sub: away ? 'Unavailable' : worded(action ?? e.state), detail: target != null && current != null ? `${show(current)} now` : undefined,
          pct: target != null ? Math.max(0, Math.min(1, (target - min) / (max - min))) : undefined } };
    }
    for (const [key, t] of Object.entries(cfg.thermostats)) {
      widgets[key] = {
        title: t.title ?? 'Thermostat', interval: 10_000,
        async fetch() {
          const e = (await states()).find(s => s.entity_id === t.entity);
          if (!e) throw new Error(`${t.entity} not found`);
          return thermostat(e, t);
        },
      };
    }
    // one way in for the page and the assistant: what the entity itself says it can do is the limit, not the request
    async function climate(entity_id: string, { temperature, hvac_mode, preset_mode }: { temperature?: number; hvac_mode?: string; preset_mode?: string }) {
      if (!allowed.has(entity_id) || !entity_id.startsWith('climate.')) throw new Error(`${entity_id} isn't a thermostat on the page`);
      if (temperature == null && !hvac_mode && !preset_mode) throw new Error('nothing to change');
      const a = (await states()).find(s => s.entity_id === entity_id)?.attributes;
      if (!a) throw new Error(`${entity_id} not found`);
      if (hvac_mode && !a.hvac_modes?.includes(hvac_mode)) throw new Error(`${entity_id} has no mode "${hvac_mode}"`);
      if (preset_mode && !a.preset_modes?.includes(preset_mode)) throw new Error(`${entity_id} has no preset "${preset_mode}"`);
      if (temperature != null) {
        if (num(a.min_temp) != null && temperature < a.min_temp || num(a.max_temp) != null && temperature > a.max_temp) throw new Error(`${temperature}° is outside ${a.min_temp}–${a.max_temp}°`);
        await call('climate', 'set_temperature', { entity_id, temperature });
      }
      if (hvac_mode) await call('climate', 'set_hvac_mode', { entity_id, hvac_mode });
      if (preset_mode) await call('climate', 'set_preset_mode', { entity_id, preset_mode });
    }

    async function set(entity_id: string, value: boolean) {
      if (!allowed.has(entity_id)) throw new Error(`${entity_id} isn't on the page or in controllable`);
      const [domain] = entity_id.split('.');
      await call(domain === 'switch' || domain === 'input_boolean' ? domain : 'homeassistant', value ? 'turn_on' : 'turn_off', { entity_id });
    }
    async function press(entity_id: string, service?: string) {
      if (!allowed.has(entity_id)) throw new Error(`${entity_id} isn't on the page or in controllable`);
      const [domain] = entity_id.split('.');
      const svc = service ?? (domain === 'automation' ? 'trigger' : domain === 'button' || domain === 'input_button' ? 'press' : 'turn_on');
      // only what the page's buttons do: never an arbitrary service (unlock, open_cover…) on something shown on a card
      const OK: Record<string, string[]> = { vacuum: ['start', 'pause', 'return_to_base', 'locate'], button: ['press'], input_button: ['press'],
        automation: ['trigger'], scene: ['turn_on'], script: ['turn_on'] };
      if (!OK[domain]?.includes(svc)) throw new Error(`${domain}.${svc} isn't something Valet's buttons do`);
      await call(domain, svc, { entity_id });
    }

    return {
      async recap(this: Instance) {
        const [key, plan] = Object.entries(cfg.floorplans).find(([, p]) => p.vacuum) ?? [];
        if (!key || !plan?.vacuum) return [];
        const all = await states(), name = plan.vacuum.replace(/^vacuum\./, 'sensor.'), read = (k: string) => all.find(e => e.entity_id === `${name}_${k}`)?.state;
        const area = Number(read('total_cleaned_area')), runs = Number(read('cleaning_count')), mins = Number(read('total_cleaning_time'));
        if (!area || !runs) return [];                   // not every robot reports its lifetime totals
        const since = new Date(read('first_cleaning_date') ?? NaN), hours = Math.round(mins / 60), card: any = await this.widgets[key].fetch();
        return [{ id: 'home.vacuum', theme: 'home', icon: 'home', kicker: 'Your robot has vacuumed', value: Math.round(area).toLocaleString('en'), unit: 'm²', stat: 'Floor vacuumed', score: 88, facts: { vacuumHours: hours },
          scope: Number.isNaN(+since) ? 'All time' : `Since ${since.toLocaleDateString('en', { month: 'short', year: 'numeric' })}`, visual: { kind: 'home', data: card.visual.data },
          line: `${runs.toLocaleString('en')} runs and ${hours.toLocaleString('en')} hours of work.`, trait: { name: 'The Delegator', line: 'Why do it yourself when a robot will do it and tell you about it afterwards?', strength: Math.min(.75, runs / 300) } }];
      },
      widgets: widgets satisfies Instance['widgets'],
      actions: {
        set: { description: 'Turn an entity on or off', input: z.object({ entity_id: z.string(), value: z.boolean() }), run: ({ entity_id, value }) => set(entity_id, value) },
        choose: { description: 'Pick an option of a select entity', input: z.object({ entity_id: z.string(), value: z.string() }),
          async run({ entity_id, value }) {
            if (!allowed.has(entity_id)) throw new Error(`${entity_id} isn't on the page or in controllable`);
            const domain = entity_id.split('.')[0];
            if (domain !== 'select' && domain !== 'input_select') throw new Error(`${entity_id} isn't a select`);
            await call(domain, 'select_option', { entity_id, option: value });
          } },
        press: { description: 'Run a scene/script, press a button, start/dock a vacuum', input: z.object({ entity_id: z.string(), service: z.string().optional() }),
          run: ({ entity_id, service }) => press(entity_id, service) },
        light: { description: 'Turn lights on/off, set brightness (0-100), colour (rgb) or warmth (kelvin)',
          input: z.object({ entity_id: z.union([z.string(), z.array(z.string())]), on: z.boolean().default(true),
            brightness: z.number().min(1).max(100).optional(), rgb: z.array(z.number().int().min(0).max(255)).length(3).optional(), kelvin: z.number().min(1500).max(9000).optional() }),
          async run({ entity_id, on, brightness, rgb: color, kelvin }) {
            const list = Array.isArray(entity_id) ? entity_id : [entity_id];
            for (const id of list) if (!allowed.has(id) || !id.startsWith('light.')) throw new Error(`${id} isn't a light on the page`);
            await call('light', on ? 'turn_on' : 'turn_off', { entity_id: list, ...(on && brightness != null ? { brightness_pct: brightness } : {}),
              ...(on && color ? { rgb_color: color } : {}), ...(on && kelvin ? { color_temp_kelvin: kelvin } : {}) });
          } },
        climate: { description: 'Set a thermostat: target temperature, HVAC mode or preset', input: z.object({ entity_id: z.string(), temperature: z.number().optional(), hvac_mode: z.string().optional(), preset_mode: z.string().optional() }),
          run: ({ entity_id, ...change }) => climate(entity_id, change) },
        vacuum: { description: 'Robot vacuum: start, pause, dock, locate, clean some rooms, or set suction',
          input: z.object({ entity_id: z.string(), command: z.enum(['start', 'pause', 'dock', 'locate', 'clean_rooms', 'fan_speed']),
            rooms: z.array(z.number().int()).optional(), fan_speed: z.string().optional() }),
          async run({ entity_id, command, rooms, fan_speed }) {
            if (!allowed.has(entity_id) || !entity_id.startsWith('vacuum.')) throw new Error(`${entity_id} isn't a vacuum on the page`);
            if (command === 'clean_rooms') {
              if (!rooms?.length) throw new Error('which rooms?');
              // Dreame's integration cleans map segments; other vacuums may not support this
              return call('dreame_vacuum', 'vacuum_clean_segment', { entity_id, segments: rooms });
            }
            if (command === 'fan_speed') return call('vacuum', 'set_fan_speed', { entity_id, fan_speed });
            const svc: Record<string, string> = { start: 'start', pause: 'pause', dock: 'return_to_base', locate: 'locate' };
            return call('vacuum', svc[command], { entity_id });
          } },
      },
      tools: {
        home_find: {
          find: 'query',
          label: 'Looked up the home',
          followUps: ['Which lights are on?', 'Turn off all lights'],
          description: 'Search Home Assistant entities (lights, switches, sensors, media players, scenes…) by name, area word or domain. Returns current state and key attributes. Use this before controlling anything.',
          access: 'read', input: z.object({ query: z.string().describe('words to match against names / entity ids, e.g. "office light" or "temperature"'), domain: z.string().optional() }),
          async run({ query, domain }) {
            const words: string[] = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            const hits = (await states()).filter(s => (!domain || s.entity_id.startsWith(domain + '.')) &&
              words.every(w => `${s.entity_id} ${s.attributes?.friendly_name ?? ''}`.toLowerCase().includes(w))).slice(0, 25);
            return {
              data: hits.map(s => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name, state: s.state, unit: s.attributes?.unit_of_measurement,
                brightnessPct: s.attributes?.brightness != null ? Math.round(s.attributes.brightness / 2.55) : undefined, controllable: allowed.has(s.entity_id),
                ...(s.entity_id.startsWith('climate.') ? { current: s.attributes?.current_temperature, target: s.attributes?.temperature, hvac_modes: s.attributes?.hvac_modes, preset_modes: s.attributes?.preset_modes } : {}) })),
              card: hits.length ? { type: 'controls', title: 'Home', icon: 'home', items: hits.slice(0, 12).map(control) } : { type: 'text', text: `Nothing matches “${query}”.` },
            };
          },
        },
        home_climate: {
          label: 'Changed the thermostat',
          async confirm({ entity_id, temperature, hvac_mode, preset_mode }) {
            const e = (await states()).find(x => x.entity_id === entity_id), name = e?.attributes?.friendly_name ?? entity_id;
            const to = [temperature != null ? `${temperature}°` : '', hvac_mode ? worded(String(hvac_mode)).toLowerCase() : '', preset_mode ? worded(String(preset_mode)).toLowerCase() : ''].filter(Boolean).join(', ');
            return { title: `Set ${name} to ${to || 'the same'}?`, detail: e ? `It's ${e.attributes?.temperature != null ? `set to ${e.attributes.temperature}°` : e.state} now` : undefined, icon: 'thermometer', verb: 'Set' };
          },
          followUps: ['How warm is it inside?'],
          description: 'Set a thermostat (a climate entity marked controllable by home_find): a target temperature in the unit Home Assistant uses, an HVAC mode (off, heat, cool, auto…) or a preset (home, sleep, away…).',
          access: 'control',
          input: z.object({ entity_id: z.string(), temperature: z.number().optional(), hvac_mode: z.string().optional(), preset_mode: z.string().optional() }),
          async run({ entity_id, temperature, hvac_mode, preset_mode }) {
            try { await climate(entity_id, { temperature, hvac_mode, preset_mode }); } catch (e) { return { data: { error: (e as Error).message } }; }
            await new Promise(r => setTimeout(r, 600));
            const s = (await states()).find(x => x.entity_id === entity_id);
            return { data: { entity_id, state: s?.state, temperature: s?.attributes?.temperature }, card: s ? await thermostat(s, Object.values(cfg.thermostats).find(t => t.entity === entity_id)) : undefined };
          },
        },
        home_control: {
          label: 'Changed the home',
          async confirm({ entity_id, action }) {
            const e = (await states()).find(x => x.entity_id === entity_id), name = e?.attributes?.friendly_name ?? entity_id;
            const verb = { turn_on: 'Turn on', turn_off: 'Turn off', toggle: 'Toggle', run: 'Run', start: 'Start', return_to_base: 'Send home' }[action as string] ?? 'Change';
            return { title: `${verb} ${name}?`, detail: e ? `It's ${e.state} now` : undefined, icon: 'home', verb };
          },
          followUps: ['Which lights are on?'],
          description: 'Control a Home Assistant entity: turn_on / turn_off / toggle (optionally brightness 0-100 and rgb colour for lights), or run a scene/script, or start/return_to_base a vacuum. Only entities marked controllable by home_find.',
          access: 'control',
          input: z.object({ entity_id: z.string(), action: z.enum(['turn_on', 'turn_off', 'toggle', 'run', 'start', 'return_to_base']),
            brightness: z.number().min(0).max(100).optional(), rgb: z.tuple([z.number(), z.number(), z.number()]).optional() }),
          async run({ entity_id, action, brightness, rgb: color }) {
            if (!allowed.has(entity_id)) return { data: { error: `${entity_id} is not controllable from Valet` } };
            const [domain] = entity_id.split('.');
            if (action === 'run') await press(entity_id);
            else if (action === 'start' || action === 'return_to_base') await press(entity_id, action);
            else await call(domain === 'light' ? 'light' : 'homeassistant', action, {
              entity_id, ...(domain === 'light' && brightness != null ? { brightness_pct: brightness } : {}), ...(domain === 'light' && color ? { rgb_color: color } : {}) });
            await new Promise(r => setTimeout(r, 600));
            const s = (await states()).find(x => x.entity_id === entity_id);
            return { data: { entity_id, state: s?.state }, card: s ? { type: 'controls', items: [control(s)] } : undefined };
          },
        },
      },
    };
  },
});
