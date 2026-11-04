// Calendars from iCal links (Google, iCloud, Nextcloud, Outlook, Proton all publish one): what's coming up in the next
// days and a browsable month, with repeating events expanded. No account access, just the subscription URL.
// Online meetings get a ring before they start, a reminder, and a Join button: the link comes from the invitation.
import { z } from 'zod';
import { Every } from '../server/config.ts';
import { defineIntegration, fmt, type Reminder } from '../server/core.ts';
import { parseICS, type Event } from '../server/ics.ts';
import type { Activity, CalendarEvent, Card, ListItem } from '../shared/cards.ts';

export type { Event } from '../server/ics.ts';
export { parseICS };

const paint = (v?: string) => v && /^(#[0-9a-f]{3,8}|[a-z]{3,30})$/i.test(v.trim()) ? v.trim() : undefined;
const list = <T>(v: T | T[] | undefined) => v == null ? [] : Array.isArray(v) ? v : [v];

const dayOf = (t: number) => new Date(new Date(t).toDateString()).getTime();
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const whenText = (e: Event) => {
  const day = fmt.relativeDay(e.start);
  if (e.allDay) return day;
  return `${day} · ${fmt.time(e.start)}${e.end && e.end > e.start ? `–${fmt.time(e.end)}` : ''}`;
};

/** "with Alex Chen, Sam Lee +3" */
const withWhom = (people?: string[]) => !people?.length ? undefined : `with ${people.slice(0, 2).join(', ')}${people.length > 2 ? ` +${people.length - 2}` : ''}`;
/** "10:30–11:00 AM": the first half drops what the second says */
const span = (e: Event) => {
  const a = fmt.time(e.start), b = e.end && e.end > e.start ? fmt.time(e.end) : undefined;
  return b ? `${a.slice(-2) === b.slice(-2) ? a.slice(0, -3) : a}–${b}` : a;
};
const MEETING = 30 * 6e4;   // how long a meeting with no end is taken to last
const endOf = (e: Event) => e.end && e.end > e.start ? e.end : e.start + MEETING;

const Meetings = z.object({
  lead: Every.default(10 * 6e4),   // how long before an online meeting its ring appears, with a countdown and Join
  // when to remind you, before it starts: one time or a list, like [10m, 1m]; [] for none
  remind: z.union([Every, z.array(Every).max(5)]).default([6e4]).transform(v => list(v)),
  push: z.boolean().default(true),   // reminders also go to devices with notifications on (⌘K), not only notify.channels
  // your address (or a list): meetings you declined are left out, and so are you from who it's with
  me: z.union([z.string().email(), z.array(z.string().email())]).optional().transform(v => list(v)),
}).strict();

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
    // online meetings (Google Meet, Zoom, Teams, Webex…): a ring with a countdown and Join, and reminders. false turns it off
    meetings: z.union([z.literal(false), Meetings]).prefault({}),
  }),
  create(cfg, ctx) {
    const meet = cfg.meetings || undefined;
    // one download per calendar, parsed once over the whole browsable window, shared by every widget and tool; a calendar
    // that fails keeps what it last gave, so a flaky server doesn't empty the page or get retried by each of them
    let cache: { at: number; events: Event[]; from: number; to: number } | undefined, loading: Promise<Event[]> | undefined;
    const last = new Map<string, Event[]>();
    const load = async () => {
      const d = new Date(), from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      const to = Math.max(new Date(d.getFullYear(), d.getMonth() + cfg.months + 1, 1).getTime() - 1, dayOf(d.getTime()) + 61 * 864e5);
      const all = await Promise.all(cfg.calendars.map(async c => {
        try {
          const list = parseICS(await ctx.http<string>(c.url.replace(/^webcal:/, 'https:'), { as: 'text', timeout: 15_000 }), from, to, c.name ?? 'Calendar', { me: meet?.me })
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
    const join = (e: Event) => meet && !e.allDay ? e.join : undefined;
    const row = (e: Event): ListItem => {
      const j = join(e);
      return { title: e.title, subtitle: [j?.provider, e.location && e.location !== j?.href ? e.location : undefined, cfg.calendars.length > 1 ? e.calendar : undefined].filter(Boolean).join(' · ') || undefined, meta: whenText(e), href: undefined,
        tone: e.start <= Date.now() && (e.end ?? e.start + 36e5) >= Date.now() ? 'accent' : undefined, ...(j && endOf(e) > Date.now() ? { link: { label: 'Join', href: j.href, note: j.provider } } : {}) };
    };
    const on = (now: number) => (e: Event) => (e.end ?? e.start + (e.allDay ? 864e5 : 36e5)) >= now;
    // online meetings from `lead` before they start until they end, the one on now (or soonest) first
    const live = (all: Event[], now: number) => meet ? all.filter(e => join(e) && e.start - meet.lead <= now && endOf(e) > now) : [];
    const ring = (all: Event[], now: number): Activity | undefined => {
      const m = live(all, now), first = m[0];
      if (!first) return undefined;
      const j = join(first)!;
      return { title: first.title, subtitle: [span(first), withWhom(first.people)].filter(Boolean).join(' · '), icon: 'video', tone: 'accent',
        countdown: { from: first.start - meet!.lead, start: first.start, end: endOf(first) }, link: { label: 'Join', href: j.href, note: j.provider }, ...(m.length > 1 ? { count: m.length } : {}) };
    };
    const headline = (list: Event[], all: Event[], now: number) => {
      const next = list[0], today = list.filter(e => dayOf(e.start) === dayOf(now));
      return { summary: { label: cfg.title, icon: 'calendar', value: next ? next.title : 'Free', sub: next ? whenText(next) : `next ${cfg.days} days`, detail: today.length ? `${today.length} today` : undefined },
        // a ring shows the next online meeting from a little before it, or any event while it's on
        activity: ring(all, now) ?? (next && !next.allDay && next.start <= now ? { title: next.title, subtitle: `until ${fmt.time(next.end ?? next.start + 36e5)}`, icon: 'calendar' } : undefined) };
    };
    /** The online meeting on now or next, and the rest of today's. */
    const nextMeetings = async (now = Date.now()) => {
      const all = (await events()).filter(e => join(e) && endOf(e) > now);
      return { next: all[0], later: all.slice(1).filter(e => e.start < Math.max(dayOf(now) + 864e5, all[0] ? all[0].start + 864e5 : 0)).slice(0, 5) };
    };
    const brief = (e: Event) => ({ title: e.title, start: new Date(e.start).toISOString(), end: e.end ? new Date(e.end).toISOString() : undefined, allDay: e.allDay, location: e.location, calendar: e.calendar,
      ...(join(e) ? { join: join(e)!.href, provider: join(e)!.provider } : {}), ...(e.people?.length ? { with: e.people.slice(0, 8) } : {}) });
    const soon = (e: Event, now: number) => {
      if (e.start <= now) return `Now · ${Math.max(1, Math.round((endOf(e) - now) / 6e4))} min left`;
      const m = Math.round((e.start - now) / 6e4);
      return m < 1 ? 'Starting' : m < 60 ? `in ${m} min` : whenText(e);
    };
    return {
      widgets: {
        upcoming: {
          title: cfg.title, interval: meet ? 60_000 : 600_000,
          async fetch() {
            const now = Date.now(), all = await events(), list = (await coming()).filter(on(now)).slice(0, cfg.limit);
            return { type: 'list', title: cfg.title, icon: 'calendar', items: list.map(row), empty: `Nothing in the next ${cfg.days} days`, ...headline(list, all, now) };
          },
        },
        // the agenda and a month to browse: the browser does the rest, so paging through months asks nothing of anyone
        agenda: {
          title: cfg.title, interval: meet ? 60_000 : 600_000,
          async fetch(): Promise<Card> {
            const now = Date.now(), all = await events(), list = (await coming()).filter(on(now)).slice(0, cfg.limit);
            // a very busy calendar keeps the days nearest today, so the card stays small enough to push live
            const near = all.length > 600 ? [...all].sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now)).slice(0, 600).sort((a, b) => a.start - b.start) : all;
            const stamp = (t: number) => new Date(t).toISOString();
            const event = (e: Event): CalendarEvent => ({ title: e.title, start: e.allDay ? dateOf(e.start) : stamp(e.start), end: e.end == null ? undefined : e.allDay ? dateOf(e.end) : stamp(e.end),
              calendar: e.calendar, color: e.color, location: e.location, ...(join(e) ? { join: join(e) } : {}) });
            return { type: 'calendar', title: cfg.title, icon: 'calendar', events: near.map(event), from: dateOf(cache?.from ?? now), to: dateOf(cache?.to ?? now), empty: `Nothing in the next ${cfg.days} days`, ...headline(list, all, now) };
          },
        },
      },
      // a reminder for each online meeting at each `remind` before it, said once (Valet keeps count); the link opens it
      ...(meet && meet.remind.length ? {
        async reminders(): Promise<Reminder[]> {
          const now = Date.now(), most = Math.max(...meet.remind);
          return (await events()).filter(e => join(e) && e.start > now && e.start - most <= now + 6e4).flatMap(e => {
            const about = `${(e.uid ?? e.title).slice(0, 200)}@${e.start}`, j = join(e)!;
            return meet.remind.map(r => ({ id: `${about}:${r}`, about, at: e.start - r, until: e.start, title: `${e.title} at ${fmt.time(e.start)}`,
              text: [j.provider, withWhom(e.people)].filter(Boolean).join(' · '), link: j.href, device: meet.push }));
          });
        },
      } : {}),
      ...(meet ? {
        commands: [{ say: ['join meeting', 'join next meeting', 'join the meeting', 'join my meeting', 'join my next meeting', 'join the next meeting', 'join call', 'join the call'], run: 'tool:calendar_next_meeting' as const, input: {}, open: true, label: 'Join the next meeting' },
          { say: ['next meeting', 'my next meeting', 'what\'s my next meeting', 'when is my next meeting', 'meetings today'], run: 'tool:calendar_next_meeting' as const, input: {}, label: 'Next meeting' }],
      } : {}),
      tools: {
        calendar_upcoming: {
          find: 'query',
          label: 'Checked the calendar',
          followUps: ['What\'s on tomorrow?', 'Am I free this weekend?'],
          description: `What's on the person's calendar in the coming days (${cfg.calendars.map(c => c.name ?? 'a calendar').join(', ')}): title, start, end, location${meet ? ', and for an online meeting its service and join link' : ''}. Use for "what's on", "am I free", "when is…".`,
          access: 'read', input: z.object({ days: z.number().int().min(1).max(60).default(7), query: z.string().optional().describe('words to look for in titles') }),
          async run({ days, query }) {
            const q = query?.toLowerCase(), to = dayOf(Date.now()) + days * 864e5;
            const list = (await events()).filter(e => (e.end ?? e.start) >= dayOf(Date.now()) && e.start <= to && (!q || e.title.toLowerCase().includes(q)));
            return { data: list.map(brief),
              card: { type: 'list', title: q ? `Calendar · “${query}”` : `Next ${days} days`, icon: 'calendar', items: list.map(row), empty: 'Nothing scheduled' } };
          },
        },
        ...(meet ? {
          calendar_next_meeting: {
            label: 'Checked your meetings', live: true,
            followUps: ['What else is on today?', 'Am I free after that?'],
            description: 'The person\'s next online meeting (Google Meet, Zoom, Teams, Webex…), or the one on now: title, when, who it\'s with, the service and its join link, and the rest of today\'s. Use for "what\'s my next meeting", "when\'s my next call", "join my meeting". Meetings without a link aren\'t here: calendar_upcoming has everything.',
            access: 'read' as const, input: z.object({}),
            async run() {
              const now = Date.now(), { next, later } = await nextMeetings(now);
              if (!next) return { data: { next: null, note: 'No online meetings coming up' }, card: { type: 'list', title: 'Next meeting', icon: 'video', items: [], empty: 'No online meetings coming up' } satisfies Card };
              const top: ListItem = { ...row(next), subtitle: [join(next)!.provider, withWhom(next.people)].filter(Boolean).join(' · '), meta: `${soon(next, now)}${next.start > now && next.start - now < 36e5 ? ` · ${span(next)}` : ''}`, tone: next.start <= now ? 'accent' : undefined };
              return { data: { next: brief(next), later: later.map(brief) }, open: join(next)!.href,
                card: { type: 'list', title: next.start <= now ? 'On now' : 'Next meeting', icon: 'video', items: [top, ...later.map(e => ({ ...row(e), section: 'Later' }))] } satisfies Card };
            },
          },
        } : {}),
      },
    };
  },
});
