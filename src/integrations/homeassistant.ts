// Home Assistant (REST API, long-lived token): cards of chosen entities as live controls, and tools to look up any
// entity and (with approval) control the ones you've put on the page or listed under `controllable`.
import { z } from 'zod';
import { defineIntegration, type Instance, type Widget } from '../server/core.ts';
import type { Control } from '../shared/cards.ts';

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
    cards: z.record(z.string(), z.object({ title: z.string(), icon: z.string().optional(), entities: z.array(z.string()) })).default({}),
    controllable: z.array(z.string()).default([]),   // extra entities the assistant may control (cards' entities always may)
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
    const states = () => ctx.http<any[]>(`${base}/api/states`, { headers });
    const call = (domain: string, service: string, data: Record<string, unknown>) =>
      ctx.http(`${base}/api/services/${domain}/${service}`, { method: 'POST', headers, body: JSON.stringify(data) });
    const allowed = new Set([...Object.values(cfg.cards).flatMap(c => c.entities), ...cfg.controllable]);

    function control(e: any): Control {
      const [domain] = e.entity_id.split('.');
      const a = e.attributes ?? {};
      const label = a.friendly_name ?? e.entity_id;
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
            items: card.entities.map(id => byId.get(id) ? control(byId.get(id)) : { id, label: id, kind: 'value', value: 'not found' } as Control) };
        },
      };
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
      if (!/^[a-z_]+$/.test(svc)) throw new Error('bad service');
      await call(domain, svc, { entity_id });
    }

    return {
      widgets: widgets satisfies Instance['widgets'],
      actions: {
        set: { description: 'Turn an entity on or off', input: z.object({ entity_id: z.string(), value: z.boolean() }), run: ({ entity_id, value }) => set(entity_id, value) },
        choose: { description: 'Pick an option of a select entity', input: z.object({ entity_id: z.string(), value: z.string() }),
          async run({ entity_id, value }) {
            if (!allowed.has(entity_id)) throw new Error(`${entity_id} isn't on the page or in controllable`);
            await call(entity_id.split('.')[0], 'select_option', { entity_id, option: value });
          } },
        press: { description: 'Run a scene/script, press a button, start/dock a vacuum', input: z.object({ entity_id: z.string(), service: z.string().optional() }),
          run: ({ entity_id, service }) => press(entity_id, service) },
      },
      tools: {
        home_find: {
          description: 'Search Home Assistant entities (lights, switches, sensors, media players, scenes…) by name, area word or domain. Returns current state and key attributes. Use this before controlling anything.',
          access: 'read', input: z.object({ query: z.string().describe('words to match against names / entity ids, e.g. "office light" or "temperature"'), domain: z.string().optional() }),
          async run({ query, domain }) {
            const words: string[] = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            const hits = (await states()).filter(s => (!domain || s.entity_id.startsWith(domain + '.')) &&
              words.every(w => `${s.entity_id} ${s.attributes?.friendly_name ?? ''}`.toLowerCase().includes(w))).slice(0, 25);
            return {
              data: hits.map(s => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name, state: s.state, unit: s.attributes?.unit_of_measurement,
                brightnessPct: s.attributes?.brightness != null ? Math.round(s.attributes.brightness / 2.55) : undefined, controllable: allowed.has(s.entity_id) })),
              card: hits.length ? { type: 'controls', title: 'Home', icon: 'home', items: hits.slice(0, 12).map(control) } : { type: 'text', text: `Nothing matches “${query}”.` },
            };
          },
        },
        home_control: {
          description: 'Control a Home Assistant entity: turn_on / turn_off / toggle (optionally brightness 0-100 and rgb colour for lights), or run a scene/script, or start/return_to_base a vacuum. Only entities marked controllable by home_find.',
          access: 'control',
          input: z.object({ entity_id: z.string(), action: z.enum(['turn_on', 'turn_off', 'toggle', 'run', 'start', 'return_to_base']),
            brightness: z.number().min(0).max(100).optional(), rgb: z.tuple([z.number(), z.number(), z.number()]).optional() }),
          async run({ entity_id, action, brightness, rgb: color }) {
            if (!allowed.has(entity_id)) return { data: { error: `${entity_id} is not controllable from Atrium` } };
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
