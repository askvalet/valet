// Valet's own abilities, shaped like an integration so the chat treats them like any other: what happened, what it
// changed, and "tell me when". Access defaults to write (see chat.ts), so these work without any config.
import { z } from 'zod';
import type { Activity } from './activity.ts';
import type { Hub } from './hub.ts';
import type { History } from './history.ts';
import type { Instance } from './core.ts';
import type { Recap } from '../shared/cards.ts';
import type { Timeline } from './timeline.ts';
import type { Watches } from './watches.ts';

const when = (t: number) => new Date(t).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function ownInstance(o: { timeline: Timeline; activity: Activity; watches: Watches; hub: () => Hub; widgets: string[]; history?: History; recap: (year?: number) => Promise<Recap>; undo: (id: number) => Promise<string> }): Instance {
  const log = () => {
    const list = o.activity.recent(12), undoable = list.find(e => e.undo && !e.undone);
    return { type: 'list' as const, title: 'Activity', icon: 'pulse', empty: 'Nothing changed yet',
      items: list.map(e => ({ title: e.what, subtitle: `${e.who} · ${e.via}${e.undone ? ' · undone' : ''}${e.error ? ` · ${e.error}` : ''}`, meta: when(e.at), tone: e.ok ? undefined : 'bad' as const })),
      buttons: undoable ? [{ label: `Undo: ${undoable.what}`, action: 'undo', args: { id: undoable.id } }] : undefined };
  };
  return {
    widgets: { activity: { title: 'Activity', interval: 15_000, fetch: async () => log() } },
    actions: { undo: { description: 'Undo something from the activity log', input: z.object({ id: z.number() }), run: ({ id }: { id: number }) => o.undo(id) } },
    tools: {
      year_in_review: {
        label: 'Looked back over the year', followUps: ['What was my most watched thing?'],
        description: 'The year in review: the headline numbers from every service, and who that makes the person this year. Use for "my year", "wrapped", "year in review".',
        access: 'read', input: z.object({ year: z.number().int().optional() }),
        async run({ year }) {
          const r = await o.recap(year);
          return { data: { year: r.year, soFar: r.soFar, persona: r.persona.name, numbers: r.stats, moments: r.slides.map(s => `${s.kicker} ${s.value}${s.unit ? ` ${s.unit}` : ''}`) },
            card: { type: 'stats', title: `Your ${r.year} in review`, icon: 'chart', href: '#recap', note: r.persona.name, items: r.stats.slice(0, 6).map(s => ({ label: s.label, value: s.value })) } };
        },
      },
      timeline: {
        label: 'Checked what happened', followUps: ['What should I do about it?'],
        description: 'What happened over a period: things starting and finishing, services going down and coming back, problems appearing and clearing, changes made, and how each headline number moved (lowest, highest, now). Use for "what happened overnight", "what changed since yesterday", "why was it slow at 3am". Check this, then the logs, before explaining a past problem. A time here is when Valet saw it happen; trust a service\'s own timestamps over it.',
        access: 'read', input: z.object({ hours: z.number().min(1).max(336).default(24), about: z.string().optional().describe('only events mentioning this') }),
        async run({ hours, about }) {
          const q = about?.toLowerCase();
          const events = o.timeline.since(hours * 36e5).filter(e => !q || `${e.text} ${e.widget ?? ''}`.toLowerCase().includes(q));
          const metrics = o.history?.overview(hours * 36e5) ?? [];
          return { data: { events: events.slice(-60).map(e => ({ when: when(e.at), kind: e.kind, what: e.text })), totalEvents: events.length, metrics: metrics.slice(0, 40) },
            card: { type: 'list', title: `Last ${hours} hours`, icon: 'clock', empty: 'Nothing recorded', items: events.slice(-12).reverse().map(e => ({ title: e.text, subtitle: e.kind, meta: when(e.at) })) } };
        },
      },
      metric_chart: {
        live: true,
        label: 'Drew a graph', followUps: ['What caused the peak?'],
        description: 'A graph of any headline number Valet tracks, over time: CPU, memory, GPU, disk, network, power, requests. Use for "graph", "chart", "show me X over the last day". The person can scrub across it. Use the unit it returns exactly; never assume one.',
        access: 'read', input: z.object({ name: z.string().describe('what to graph, e.g. "memory" or "GPU"'), hours: z.number().min(1).max(336).default(24) }),
        async run({ name, hours }) {
          const found = o.history?.points(name, hours * 36e5) ?? [];
          if (!found.length) return { data: { error: `nothing tracked called "${name}"`, tracked: (o.history?.overview(hours * 36e5) ?? []).map(m => m.name).slice(0, 30) } };
          const from = Math.min(...found.map(s => s.points[0][0])), to = Math.max(...found.map(s => s.points.at(-1)![0]));
          return { data: found.map(s => { const v = s.points.map(p => p[1]); return { name: s.name, unit: s.unit ?? 'not known: state the numbers without a unit', now: v.at(-1), low: Math.min(...v), high: Math.max(...v) }; }),
            card: { type: 'chart', title: found[0].name, unit: found.every(s => s.unit === found[0].unit) ? found[0].unit : undefined, from, to, span: hours === 1 ? 'last hour' : hours % 24 ? `last ${hours} hours` : hours === 24 ? 'last 24 hours' : `last ${hours / 24} days`, series: found.map(s => ({ name: s.name, points: s.points.map(p => p[1]) })) } };
        },
      },
      activity_log: {
        label: 'Checked what changed', followUps: ['Undo the last one'],
        description: 'What Valet itself changed recently: who asked, from where (chat, a plan, a card), what it did and whether it worked. Use for "did you do that", "what did you change", "who turned that on".',
        access: 'read', input: z.object({}),
        async run() { return { data: o.activity.recent(25).map(e => ({ id: e.id, when: when(e.at), who: e.who, via: e.via, what: e.what, ok: e.ok, error: e.error, canUndo: !!e.undo && !e.undone })), card: log() }; },
      },
      watch_add: {
        label: 'Set a reminder', followUps: ['What am I waiting on?'],
        description: `Tell the person later when something happens, even with the page closed. Use for "tell me when…", "let me know if…", "warn me if…". on: ends / starts (a download or stream; name = part of its title), down / up (a service; name = its name), above / below (a number; name = its label, value = the limit, minutes = how long it must hold). say is the message they'll get. Widgets: ${o.widgets.join(', ') || 'see the page'}.`,
        access: 'write',
        input: z.object({ widget: z.string().describe('widget key, e.g. downloads.active'), on: z.enum(['ends', 'starts', 'down', 'up', 'above', 'below']), name: z.string().optional(), value: z.number().optional(), minutes: z.number().min(0).max(1440).default(0), say: z.string().max(200), hours: z.number().min(1).max(720).default(48).describe('give up after this long') }),
        async run({ widget, on, name, value, minutes, say, hours }) {
          if (!o.hub().widget(widget)) return { data: { error: `no widget ${widget} on the page` } };
          if ((on === 'above' || on === 'below') && value == null) return { data: { error: 'above and below need a value' } };
          const w = await o.watches.add({ widget, on, name, value, minutes, say, until: Date.now() + hours * 36e5 });
          return { data: { set: true, id: w.id, expires: when(w.until) }, card: { type: 'text', tone: 'good', text: `I'll tell you: ${say}` } };
        },
      },
      watch_list: {
        label: 'Checked reminders', access: 'read', input: z.object({}),
        description: 'What the person asked to be told about that hasn\'t happened yet.',
        async run() { return { data: o.watches.list.map(w => ({ id: w.id, widget: w.widget, on: w.on, name: w.name, value: w.value, say: w.say, expires: when(w.until) })) }; },
      },
      watch_remove: {
        label: 'Cancelled a reminder', access: 'write', input: z.object({ id: z.string() }),
        description: 'Cancel a reminder by id.',
        async run({ id }) { return { data: { removed: await o.watches.remove(id) } }; },
      },
    },
  };
}
