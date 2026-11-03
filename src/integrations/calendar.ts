// Calendars from iCal links (Google, iCloud, Nextcloud, Outlook, Proton all publish one): what's coming up in the next
// days and a browsable month, with simple repeating events expanded. No account access, just the subscription URL.
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';
import type { CalendarEvent, Card, ListItem } from '../shared/cards.ts';

export interface Event { title: string; start: number; end?: number; allDay: boolean; location?: string; calendar: string; color?: string }

const paint = (v?: string) => v && /^(#[0-9a-f]{3,8}|[a-z]{3,30})$/i.test(v.trim()) ? v.trim() : undefined;

/** Parse an .ics into the events that fall in [from, to], expanding DAILY/WEEKLY/MONTHLY/YEARLY rules with INTERVAL,
 *  COUNT, UNTIL and (for weekly) BYDAY. Anything fancier shows only its first occurrence. */
export function parseICS(ics: string, from: number, to: number, calendar = 'Calendar'): Event[] {
  const lines = ics.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');   // unfold continuation lines
  const out: Event[] = [];
  let feed: string | undefined;   // the colour the calendar gives itself: COLOR, or Apple's own property
  let ev: Record<string, { params: Record<string, string>; value: string }> | null = null;
  const when = (p?: { params: Record<string, string>; value: string }) => {
    if (!p) return undefined;
    const v = p.value, m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return undefined;
    const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
    const allDay = p.params.VALUE === 'DATE' || !m[4];
    // Z is UTC; a TZID or floating time is taken as local (good enough for a homepage)
    const t = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
    return { t, allDay };
  };
  const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT' && ev) {
      const start = when(ev.DTSTART), end = when(ev.DTEND);
      if (start) {
        const base = { title: unescape(ev.SUMMARY?.value ?? '(untitled)'), allDay: start.allDay, location: ev.LOCATION ? unescape(ev.LOCATION.value) : undefined, calendar, color: paint(ev.COLOR?.value) ?? feed };
        const len = end ? end.t - start.t : 0;
        const rule = Object.fromEntries((ev.RRULE?.value ?? '').split(';').filter(Boolean).map(kv => kv.split('=') as [string, string]));
        const exdates = new Set(Object.entries(ev).filter(([k]) => k === 'EXDATE').flatMap(([, p]) => p.value.split(',').map(v => when({ params: p.params, value: v })?.t)));
        const push = (t: number) => { if (t + len >= from && t <= to && !exdates.has(t)) out.push({ ...base, start: t, end: end ? t + len : undefined }); };
        if (!rule.FREQ) push(start.t);
        else {
          const interval = Number(rule.INTERVAL ?? 1), until = rule.UNTIL ? when({ params: {}, value: rule.UNTIL })?.t ?? Infinity : Infinity;
          let count = rule.COUNT ? Number(rule.COUNT) : Infinity, n = 0;
          const d = new Date(start.t);
          const byday = rule.FREQ === 'WEEKLY' && rule.BYDAY ? rule.BYDAY.split(',').map(x => DAYS.indexOf(x.slice(-2))) : null;
          // walk occurrences until past the window (or the rule ends); the cap keeps a runaway rule cheap, and is high
          // enough that a daily event started decades ago still reaches the months being browsed
          for (let guard = 0; guard < 40_000 && d.getTime() <= Math.min(to, until) && count > 0; guard++) {
            if (byday) {
              // a week at a time: every listed weekday in it
              const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
              for (const wd of byday) { const t = new Date(weekStart); t.setDate(weekStart.getDate() + wd); if (t.getTime() >= start.t && t.getTime() <= Math.min(to, until) && count > 0) { push(t.getTime()); count--; n++; } }
              d.setDate(d.getDate() + 7 * interval);
            } else {
              push(d.getTime()); count--; n++;
              if (rule.FREQ === 'DAILY') d.setDate(d.getDate() + interval);
              else if (rule.FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
              else if (rule.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + interval);
              else if (rule.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
              else break;
            }
          }
        }
      }
      ev = null; continue;
    }
    if (!ev) { const c = line.match(/^(?:X-APPLE-CALENDAR-COLOR|COLOR)(?:;[^:]*)?:(.+)$/)?.[1]; if (c) feed = paint(c) ?? feed; continue; }
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';');
    const params = Object.fromEntries(ps.map(p => p.split('=') as [string, string]));
    const key = name === 'EXDATE' && ev.EXDATE ? `EXDATE${Object.keys(ev).length}` : name;
    ev[key] = { params, value: line.slice(i + 1) };
  }
  return out.sort((a, b) => a.start - b.start);
}

const dayOf = (t: number) => new Date(new Date(t).toDateString()).getTime();
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const whenText = (e: Event) => {
  const day = fmt.relativeDay(e.start);
  if (e.allDay) return day;
  return `${day} · ${fmt.time(e.start)}${e.end && e.end > e.start ? `–${fmt.time(e.end)}` : ''}`;
};

export default defineIntegration({
  type: 'calendar',
  name: 'Calendar',
  config: z.object({
    calendars: z.array(z.union([z.string().url(), z.object({ url: z.string().url(), name: z.string().optional(), color: z.string().optional() })])).min(1)
      .transform(c => c.map(x => typeof x === 'string' ? { url: x } : x)),
    days: z.number().int().min(1).max(60).default(14),
    limit: z.number().int().min(1).max(50).default(10),
    title: z.string().default('Coming up'),
    months: z.number().int().min(1).max(24).default(6),   // how far ahead the month view browses (it always reaches one month back)
  }),
  create(cfg, ctx) {
    // one download per calendar, parsed once over the whole browsable window, shared by every widget and tool; a calendar
    // that fails keeps what it last gave, so a flaky server doesn't empty the page or get retried by each of them
    let cache: { at: number; events: Event[]; from: number; to: number } | undefined, loading: Promise<Event[]> | undefined;
    const last = new Map<string, Event[]>();
    const load = async () => {
      const d = new Date(), from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      const to = Math.max(new Date(d.getFullYear(), d.getMonth() + cfg.months + 1, 1).getTime() - 1, dayOf(d.getTime()) + 61 * 864e5);
      const all = await Promise.all(cfg.calendars.map(async c => {
        try {
          const list = parseICS(await ctx.http<string>(c.url.replace(/^webcal:/, 'https:'), { as: 'text', timeout: 15_000 }), from, to, c.name ?? 'Calendar')
            .map(e => c.color && paint(c.color) ? { ...e, color: paint(c.color) } : e);
          last.set(c.url, list);
          return list;
        } catch (e) { ctx.log(`${c.name ?? 'a calendar'}: ${(e as Error).message}`); return last.get(c.url) ?? []; }
      }));
      const list = all.flat().sort((a, b) => a.start - b.start);
      cache = { at: Date.now(), events: list, from, to };
      return list;
    };
    async function events() {
      if (cache && Date.now() - cache.at < 600_000) return cache.events;
      return loading ??= load().finally(() => { loading = undefined; });
    }
    const coming = async () => { const from = dayOf(Date.now()), to = from + cfg.days * 864e5; return (await events()).filter(e => (e.end ?? e.start) >= from && e.start <= to); };
    const row = (e: Event): ListItem => ({ title: e.title, subtitle: [e.location, cfg.calendars.length > 1 ? e.calendar : undefined].filter(Boolean).join(' · ') || undefined, meta: whenText(e), href: undefined, tone: e.start <= Date.now() && (e.end ?? e.start + 36e5) >= Date.now() ? 'accent' : undefined });
    const on = (now: number) => (e: Event) => (e.end ?? e.start + (e.allDay ? 864e5 : 36e5)) >= now;
    const headline = (list: Event[], now: number) => {
      const next = list[0], today = list.filter(e => dayOf(e.start) === dayOf(now));
      return { summary: { label: cfg.title, icon: 'calendar', value: next ? next.title : 'Free', sub: next ? whenText(next) : `next ${cfg.days} days`, detail: today.length ? `${today.length} today` : undefined },
        // a ring shows an event while it's on
        activity: next && !next.allDay && next.start <= now ? { title: next.title, subtitle: `until ${fmt.time(next.end ?? next.start + 36e5)}`, icon: 'calendar' } : undefined };
    };
    return {
      widgets: {
        upcoming: {
          title: cfg.title, interval: 600_000,
          async fetch() {
            const now = Date.now(), list = (await coming()).filter(on(now)).slice(0, cfg.limit);
            return { type: 'list', title: cfg.title, icon: 'calendar', items: list.map(row), empty: `Nothing in the next ${cfg.days} days`, ...headline(list, now) };
          },
        },
        // the agenda and a month to browse: the browser does the rest, so paging through months asks nothing of anyone
        agenda: {
          title: cfg.title, interval: 600_000,
          async fetch(): Promise<Card> {
            const now = Date.now(), all = await events(), list = (await coming()).filter(on(now)).slice(0, cfg.limit);
            // a very busy calendar keeps the days nearest today, so the card stays small enough to push live
            const near = all.length > 600 ? [...all].sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now)).slice(0, 600).sort((a, b) => a.start - b.start) : all;
            const stamp = (t: number) => new Date(t).toISOString();
            const event = (e: Event): CalendarEvent => ({ title: e.title, start: e.allDay ? dateOf(e.start) : stamp(e.start), end: e.end == null ? undefined : e.allDay ? dateOf(e.end) : stamp(e.end),
              calendar: e.calendar, color: e.color, location: e.location });
            return { type: 'calendar', title: cfg.title, icon: 'calendar', events: near.map(event), from: dateOf(cache?.from ?? now), to: dateOf(cache?.to ?? now), empty: `Nothing in the next ${cfg.days} days`, ...headline(list, now) };
          },
        },
      },
      tools: {
        calendar_upcoming: {
          find: 'query',
          label: 'Checked the calendar',
          followUps: ['What\'s on tomorrow?', 'Am I free this weekend?'],
          description: `What's on the person's calendar in the coming days (${cfg.calendars.map(c => c.name ?? 'a calendar').join(', ')}): title, start, end, location. Use for "what's on", "am I free", "when is…".`,
          access: 'read', input: z.object({ days: z.number().int().min(1).max(60).default(7), query: z.string().optional().describe('words to look for in titles') }),
          async run({ days, query }) {
            const q = query?.toLowerCase(), to = dayOf(Date.now()) + days * 864e5;
            const list = (await events()).filter(e => (e.end ?? e.start) >= dayOf(Date.now()) && e.start <= to && (!q || e.title.toLowerCase().includes(q)));
            return { data: list.map(e => ({ title: e.title, start: new Date(e.start).toISOString(), end: e.end ? new Date(e.end).toISOString() : undefined, allDay: e.allDay, location: e.location, calendar: e.calendar })),
              card: { type: 'list', title: q ? `Calendar · “${query}”` : `Next ${days} days`, icon: 'calendar', items: list.map(row), empty: 'Nothing scheduled' } };
          },
        },
      },
    };
  },
});
