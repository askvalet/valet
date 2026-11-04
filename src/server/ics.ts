// iCalendar (RFC 5545), as far as a homepage needs it: the events in a window, repeating ones expanded, each in its own
// time zone, with what was moved, cancelled or declined taken out, and the meeting link found if there is one. A calendar
// feed is other people's invitations, so everything here is a stranger's text: it's scanned by hand, never by a
// backtracking regex, and only a link to a known meeting service on https gets through.

export interface Event {
  title: string; start: number; end?: number; allDay: boolean; location?: string; calendar: string; color?: string;
  uid?: string;
  join?: { href: string; provider: string };   // an online meeting's link, and whose it is
  people?: string[];                             // who else is invited, by name
}
export interface Options { me?: string[] }       // the owner's addresses: what they declined is left out

interface Prop { name: string; params: Record<string, string>; value: string }
interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; date: boolean; zone: string }   // zone: 'utc', 'local' or IANA

const paint = (v?: string) => v && /^(#[0-9a-f]{3,8}|[a-z]{3,30})$/i.test(v.trim()) ? v.trim() : undefined;
const unescape = (s: string) => s.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

/** One content line: its name, parameters (quoted values may hold ; : and ,) and value. */
export function contentLine(line: string): Prop | null {
  let i = 0, quoted = false;
  const take = (stops: string) => { let out = ''; for (; i < line.length; i++) { const c = line[i]; if (c === '"') { quoted = !quoted; continue; } if (!quoted && stops.includes(c)) break; out += c; } return out; };
  const name = take(';:').toUpperCase();
  const params: Record<string, string> = {};
  while (line[i] === ';') {
    i++;
    const k = take('=;:').toUpperCase();
    if (line[i] === '=') { i++; params[k] = take(';:'); } else params[k] = '';
  }
  if (line[i] !== ':' || !name) return null;
  return { name, params, value: line.slice(i + 1) };
}

// ── time zones: a TZID is a place, so a meeting set in another zone lands at the right moment here

// what Outlook and Exchange call the zones people meet in most
const WINDOWS: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'E. South America Standard Time': 'America/Sao_Paulo', UTC: 'UTC',
};
const zones = new Map<string, Intl.DateTimeFormat | null>();
function zoneFormat(zone: string) {
  if (!zones.has(zone)) {
    let f: Intl.DateTimeFormat | null = null;
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch { /* not a zone this runtime knows */ }
    if (zones.size > 200) zones.clear();
    zones.set(zone, f);
  }
  return zones.get(zone)!;
}
const zoneOf = (tzid?: string) => {
  if (!tzid) return 'local';
  const name = WINDOWS[tzid] ?? tzid.replace(/^\/+/, '');
  return zoneFormat(name) ? name : 'local';
};
/** How far `zone` is ahead of UTC at instant t. */
function offset(zone: string, t: number) {
  const parts = zoneFormat(zone)!.formatToParts(t), n = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(t / 1000) * 1000;
}
/** A wall-clock time as an instant. */
export function instant(w: Wall) {
  if (w.zone === 'utc') return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  if (w.zone === 'local' || w.date) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
  const naive = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const first = naive - offset(w.zone, naive);
  return naive - offset(w.zone, first);   // twice, so a time near a change of offset settles on the right side
}
function wallOf(p?: Prop): Wall | undefined {
  if (!p) return undefined;
  const v = p.value.trim();
  if (!/^\d{8}(T\d{4}(\d{2})?Z?)?$/.test(v)) return undefined;
  const n = (a: number, b: number) => Number(v.slice(a, b) || 0);
  const date = p.params.VALUE === 'DATE' || v.length === 8;
  return { y: n(0, 4), mo: n(4, 6), d: n(6, 8), h: date ? 0 : n(9, 11), mi: date ? 0 : n(11, 13), s: date ? 0 : n(13, 15), date, zone: v.endsWith('Z') ? 'utc' : zoneOf(p.params.TZID) };
}
const fake = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);   // wall time as if it were UTC: for stepping days and months
/** "PT30M", "P1D", "-PT15M" */
export function duration(v?: string) {
  const m = v?.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return undefined;
  const ms = (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 864e5 + +(m[4] ?? 0) * 36e5 + +(m[5] ?? 0) * 6e4 + +(m[6] ?? 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}

// ── meeting links

const PROVIDERS: [string, string][] = [
  ['meet.google.com', 'Google Meet'], ['zoom.us', 'Zoom'], ['zoomgov.com', 'Zoom'], ['teams.microsoft.com', 'Microsoft Teams'], ['teams.live.com', 'Microsoft Teams'],
  ['webex.com', 'Webex'], ['whereby.com', 'Whereby'], ['meet.jit.si', 'Jitsi'], ['8x8.vc', 'Jitsi'], ['gotomeeting.com', 'GoTo'], ['goto.com', 'GoTo'], ['gotomeet.me', 'GoTo'],
  ['around.co', 'Around'], ['discord.gg', 'Discord'], ['discord.com', 'Discord'], ['facetime.apple.com', 'FaceTime'], ['chime.aws', 'Amazon Chime'], ['bluejeans.com', 'BlueJeans'],
];
const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
/** Which meeting service a link is for, if it's https and on one. */
export function providerOf(href: string): { href: string; provider: string } | undefined {
  if (href.length > 2000) return undefined;
  const u = URL.parse(href);
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const hit = PROVIDERS.find(([d]) => under(u.hostname, d));
  if (!hit || u.pathname.length < 2) return undefined;   // the service's home page isn't a meeting
  if (hit[1] === 'Discord' && u.hostname !== 'discord.gg' && !/^\/(channels|invite)\//.test(u.pathname)) return undefined;
  if (hit[1] === 'GoTo' && u.hostname === 'goto.com') return undefined;   // GoTo's own site; its meetings are on meet. and app.
  return { href: u.href, provider: hit[1] };
}
const STOP = new Set([' ', '\t', '\n', '\r', '"', '\'', '<', '>', '`', '\\', '{', '}', '|', '^', '[', ']']);
/** Every https link in some text, in order: scanned, so a long hostile string costs one pass. */
export function linksIn(text: string, most = 50) {
  const out: string[] = [], low = text.toLowerCase();
  for (let at = low.indexOf('https://'); at >= 0 && out.length < most; at = low.indexOf('https://', at + 8)) {
    let end = at + 8;
    while (end < text.length && end - at < 2000 && !STOP.has(text[end])) end++;
    let link = text.slice(at, end);
    while (link.length > 8 && '.,;:!?)'.includes(link[link.length - 1])) link = link.slice(0, -1);
    out.push(link.replaceAll('&amp;', '&'));
  }
  return out;
}
/** The meeting link: Google's conference property first, then the event's URL, its location and its description. */
export function meetingOf(ev: { conference?: string; url?: string; location?: string; description?: string }) {
  for (const text of [ev.conference, ev.url, ev.location, ev.description]) {
    if (!text) continue;
    for (const l of linksIn(text)) { const p = providerOf(l); if (p) return p; }
  }
  return undefined;
}

// ── repeating events

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();   // mo is 1-based
/** The days (as [y, mo, d]) a rule picks in one period that starts at `p` (wall time, as fake UTC). */
function candidates(rule: Record<string, string>, p: Date, first: Wall, wkst: number): [number, number, number][] {
  const y = p.getUTCFullYear(), mo = p.getUTCMonth() + 1;
  const byday = (rule.BYDAY ?? '').split(',').filter(Boolean).map(x => ({ n: x.length > 2 ? Number(x.slice(0, -2)) : 0, wd: DAYS.indexOf(x.slice(-2).toUpperCase()) })).filter(x => x.wd >= 0 && Number.isFinite(x.n));
  switch (rule.FREQ) {
    case 'DAILY': return byday.length && !byday.some(b => b.wd === p.getUTCDay()) ? [] : [[y, mo, p.getUTCDate()]];
    case 'WEEKLY': {
      const start = new Date(p); start.setUTCDate(p.getUTCDate() - ((p.getUTCDay() - wkst + 7) % 7));
      const wds = byday.length ? byday.map(b => b.wd) : [new Date(Date.UTC(first.y, first.mo - 1, first.d)).getUTCDay()];
      return wds.map(wd => { const t = new Date(start); t.setUTCDate(start.getUTCDate() + ((wd - wkst + 7) % 7)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as [number, number, number]; })
        .sort((a, b) => Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2]));
    }
    case 'MONTHLY': {
      const len = daysIn(y, mo), out: number[] = [];
      if (rule.BYMONTHDAY) for (const x of rule.BYMONTHDAY.split(',').map(Number)) { const d = x < 0 ? len + 1 + x : x; if (d >= 1 && d <= len) out.push(d); }
      else if (byday.length) for (const b of byday) {
        const all = Array.from({ length: len }, (_, i) => i + 1).filter(d => new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.wd);
        if (!b.n) out.push(...all); else { const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (d) out.push(d); }
      }
      else if (first.d <= len) out.push(first.d);   // a 31st skips the shorter months, as the RFC says
      return [...new Set(out)].sort((a, b) => a - b).map(d => [y, mo, d]);
    }
    case 'YEARLY': return first.d <= daysIn(y, first.mo) ? [[y, first.mo, first.d]] : [];
    default: return [];
  }
}
function step(p: Date, freq: string, n: number) {
  const d = new Date(p);
  if (freq === 'DAILY') d.setUTCDate(d.getUTCDate() + n);
  else if (freq === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (freq === 'MONTHLY') { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); }
  else { d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + n); }
  return d;
}

/** Every start of an event in [from, to] (with `len` to reach back), as instants. DAILY, WEEKLY, MONTHLY and YEARLY,
 *  with INTERVAL, COUNT, UNTIL, BYDAY (weekly, monthly with an ordinal like 2TU or -1FR, daily as a filter), BYMONTHDAY
 *  and WKST. Anything fancier shows only its first occurrence. */
export function occurrences(first: Wall, rrule: string | undefined, from: number, to: number, len: number) {
  const start = instant(first);
  const rule = Object.fromEntries((rrule ?? '').split(';').filter(Boolean).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i).toUpperCase(), kv.slice(i + 1)]; }));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.FREQ)) return start + len >= from && start <= to ? [start] : [];
  const interval = Math.max(1, Number(rule.INTERVAL) || 1), wkst = Math.max(0, DAYS.indexOf((rule.WKST ?? 'MO').toUpperCase()));
  const untilWall = rule.UNTIL ? wallOf({ name: 'UNTIL', params: {}, value: rule.UNTIL }) : undefined;
  const until = untilWall ? (untilWall.date ? instant({ ...untilWall, zone: 'local' }) + 864e5 - 1 : untilWall.zone === 'utc' ? instant(untilWall) : instant({ ...untilWall, zone: first.zone })) : Infinity;
  let count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const out: number[] = [], firstFake = fake(first), slack = 2 * 864e5;
  let period = new Date(firstFake);
  // walk period by period until past the window (or the rule ends); the cap keeps a runaway rule cheap, and is high
  // enough that a daily event started decades ago still reaches the months being browsed
  for (let guard = 0; guard < 40_000 && count > 0; guard++) {
    if (+period - slack > Math.min(to, until)) break;
    for (const [y, mo, d] of candidates(rule, period, first, wkst)) {
      const w: Wall = { ...first, y, mo, d }, f = fake(w);
      if (f < firstFake || count <= 0) continue;
      // far from the window the wall time is close enough; near it, the real instant in its own zone
      if (f - slack > Math.min(to, until)) { count = 0; break; }
      const t = f + slack + len < from ? f : instant(w);
      if (t > until) { count = 0; break; }
      count--;
      if (t + len >= from && t <= to) out.push(t);
    }
    period = step(period, rule.FREQ, interval);
  }
  return out;
}

// ── the feed

interface Raw { props: Prop[]; one: (name: string) => Prop | undefined; all: (name: string) => Prop[] }
const raw = (props: Prop[]): Raw => ({ props, one: n => props.find(p => p.name === n), all: n => props.filter(p => p.name === n) });
const mail = (v = '') => v.replace(/^mailto:/i, '').trim().toLowerCase();

/** Parse an .ics into the events that touch [from, to]. */
export function parseICS(ics: string, from: number, to: number, calendar = 'Calendar', opts: Options = {}): Event[] {
  const lines = ics.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');   // unfold continuation lines
  const me = new Set((opts.me ?? []).map(mail));
  let feed: string | undefined;   // the colour the calendar gives itself: COLOR, or Apple's own property
  const events: Raw[] = [];
  let cur: Prop[] | null = null, inner: string | null = null;   // inner: an alarm (or anything else) inside an event, skipped whole
  for (const line of lines) {
    if (inner) { if (line.toUpperCase() === `END:${inner}`) inner = null; continue; }
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(raw(cur)); cur = null; continue; }
    if (cur && line.startsWith('BEGIN:')) { inner = line.slice(6).toUpperCase(); continue; }
    if (!cur) { const p = /^(X-APPLE-CALENDAR-COLOR|COLOR)[;:]/i.test(line) ? contentLine(line) : null; if (p) feed = paint(p.value) ?? feed; continue; }
    if (cur.length < 500) { const p = contentLine(line); if (p) cur.push(p); }
  }

  const status = (e: Raw) => e.one('STATUS')?.value.trim().toUpperCase();
  const declined = (e: Raw) => me.size > 0 && e.all('ATTENDEE').some(a => me.has(mail(a.value)) && a.params.PARTSTAT?.toUpperCase() === 'DECLINED');
  // a moved or cancelled occurrence of a repeating event is its own VEVENT, with the master's UID and the time it replaces
  const moved = new Map<string, Set<number>>();
  for (const e of events) {
    const uid = e.one('UID')?.value, rid = wallOf(e.one('RECURRENCE-ID'));
    if (uid && rid) moved.set(uid, (moved.get(uid) ?? new Set()).add(instant(rid)));
  }

  const out: Event[] = [];
  for (const e of events) {
    const first = wallOf(e.one('DTSTART'));
    if (!first || status(e) === 'CANCELLED' || declined(e)) continue;
    const startAt = instant(first), endWall = wallOf(e.one('DTEND'));
    const len = endWall ? Math.max(0, instant(endWall) - startAt) : duration(e.one('DURATION')?.value) ?? (first.date ? 864e5 : 0);
    const hasEnd = !!endWall || !!e.one('DURATION') || first.date;
    const uid = e.one('UID')?.value, isOverride = !!e.one('RECURRENCE-ID');
    const text = (n: string) => { const p = e.one(n); return p ? unescape(p.value) : undefined; };
    const location = text('LOCATION');
    const join = meetingOf({ conference: e.one('X-GOOGLE-CONFERENCE')?.value, url: e.one('URL')?.value, location, description: text('DESCRIPTION') });
    // who else: by the names their invitations give (an address alone stays off the page), not rooms, not who said no
    const people = [...new Set([...e.all('ORGANIZER'), ...e.all('ATTENDEE')].filter(a => !me.has(mail(a.value)) && !['ROOM', 'RESOURCE'].includes(a.params.CUTYPE?.toUpperCase() ?? '') && a.params.PARTSTAT?.toUpperCase() !== 'DECLINED')
      .map(a => a.params.CN?.trim() ?? '').filter(n => n && !n.includes('@')).map(n => n.slice(0, 60)))].slice(0, 20);
    const base = { title: text('SUMMARY')?.trim() || '(untitled)', allDay: first.date, location, calendar, color: paint(e.one('COLOR')?.value) ?? feed, uid,
      ...(join ? { join } : {}), ...(people.length ? { people } : {}) };
    const skip = new Set<number>();
    for (const x of e.all('EXDATE')) for (const v of x.value.split(',')) { const w = wallOf({ ...x, value: v }); if (w) skip.add(instant(w)); }
    if (!isOverride && uid) for (const t of moved.get(uid) ?? []) skip.add(t);
    for (const t of occurrences(first, isOverride ? undefined : e.one('RRULE')?.value, from, to, len)) {
      if (!skip.has(t)) out.push({ ...base, start: t, end: hasEnd ? t + len : undefined });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
