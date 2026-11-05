// How Valet writes a time, a date, a length of time and a number with its unit, for the page and the server alike, so
// a card the server wrote and a ring the page drew say the same thing the same way. Each takes the `format:` settings
// it should follow; the page passes its own (web/format.ts) and the server the house's (core.ts `fmt`).
//
//   time      "8:25 AM" / "08:25", by `format.clock` and the locale
//   range     "8:25–8:50 AM", "20:30–Fri 01:00": an en dash with no spaces, the shared AM/PM said once
//   date      "Thu, Nov 5" / "Thu 5 Nov" for meta and chips (`format.date`), "Thursday 5 November" for headings;
//             the year only when it isn't this one; no ordinals unless the locale writes them
//   duration  short "2h 37m", "50m", "3d 4h", "45s" (rings, chips, "ago", "left", "in")
//             long  "2 hr 37 min", "50 min", "3 days", "1.5 years" (sentences and headings)
//   units     no space before ° and %, a space before a word ("58 GB", "1.2 MB/s"); on screen the page draws
//             that space thin. A temperature keeps its letter ("42°C"), weather alone writes a bare "5°".

export interface Style {
  clock?: 'auto' | '12h' | '24h';
  date?: 'short' | 'long' | 'numeric' | 'iso';
  locale?: string;           // a language tag, or 'auto' (undefined) for the runtime's own
  zone?: string;             // a time zone to read the clock in, when it isn't this machine's
}

const loc = (s: Style) => !s.locale || s.locale === 'auto' ? undefined : s.locale;
const zone = (s: Style) => s.zone ? { timeZone: s.zone } : {};
const CYCLE: Record<string, Intl.DateTimeFormatOptions> = { '12h': { hour12: true }, '24h': { hour: '2-digit', hourCycle: 'h23' } };
const cache = new Map<string, Intl.DateTimeFormat>();
const dtf = (s: Style, o: Intl.DateTimeFormatOptions) => {
  const key = `${loc(s) ?? ''}|${JSON.stringify(o)}|${s.zone ?? ''}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(loc(s), { ...o, ...zone(s) }); if (cache.size > 200) cache.clear(); cache.set(key, f); }
  return f;
};
const at = (t: Date | number | string) => typeof t === 'object' ? t : new Date(t);
const CLOCK = (s: Style): Intl.DateTimeFormatOptions => ({ hour: 'numeric', minute: '2-digit', ...CYCLE[s.clock ?? 'auto'] });

/** "8:25 AM", "08:25" */
export const time = (t: Date | number | string, s: Style = {}) => dtf(s, CLOCK(s)).format(at(t));

/** Just the hour, for a strip of hours: "4 PM", "16" */
export const hour = (t: Date | number | string, s: Style = {}) => dtf(s, { hour: 'numeric', ...(s.clock === '24h' ? { hourCycle: 'h23' } : s.clock === '12h' ? { hour12: true } : {}) }).format(at(t));

/** "Thu", "Thursday" */
export const weekday = (t: Date | number | string, s: Style = {}, long = false) => dtf(s, { weekday: long ? 'long' : 'short' }).format(at(t));

/** "November", "Nov 2024" */
export const month = (t: Date | number | string, s: Style = {}, o: { short?: boolean; year?: boolean } = {}) =>
  dtf(s, { month: o.short ? 'short' : 'long', ...(o.year ? { year: 'numeric' } : {}) }).format(at(t));

const yearOf = (d: Date, s: Style) => s.zone ? Number(dtf(s, { year: 'numeric' }).format(d).replace(/\D/g, '')) : d.getFullYear();
const DATES: Record<'short' | 'long', Intl.DateTimeFormatOptions> = {
  short: { weekday: 'short', month: 'short', day: 'numeric' }, long: { weekday: 'long', month: 'long', day: 'numeric' },
};
/** A day. `meta` (the default) follows `format.date`: "Thu, Nov 5" / "Thu 5 Nov", "05/11/2026", "2026-11-05". A heading
 *  is always words: "Thursday 5 November". `bare` leaves the weekday out ("5 Nov"), for a day that isn't this week. A year
 *  that isn't this one is added. */
export function date(t: Date | number | string, s: Style = {}, o: { as?: 'meta' | 'heading'; bare?: boolean; now?: number } = {}) {
  const d = at(t), style = o.as === 'heading' ? 'long' : s.date ?? 'short';
  if (style === 'iso') return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
  if (style === 'numeric') return dtf(s, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const year = yearOf(d, s) !== yearOf(new Date(o.now ?? Date.now()), s) ? { year: 'numeric' as const } : {};
  const { weekday: w, ...plain } = DATES[style];
  return dtf(s, { ...(o.bare ? plain : { weekday: w, ...plain }), ...year }).format(d);
}

const sameDay = (a: Date, b: Date, s: Style) => dtf(s, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(a) === dtf(s, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(b);

/** From one time to another, one way everywhere: "8:25–8:50 AM", "11:30 AM–1:00 PM", "08:25–08:50", and across midnight
 *  "8:30 PM–Fri 1:00 AM". An en dash, no spaces; a shared AM/PM is said once, after the second. */
export function range(a: Date | number | string, b: Date | number | string, s: Style = {}) {
  const x = at(a), y = at(b), f = dtf(s, CLOCK(s));
  if (+y <= +x) return f.format(x);
  if (!sameDay(x, y, s)) return `${f.format(x)}–${weekday(y, s)} ${f.format(y)}`;
  const px = f.formatToParts(x), py = f.formatToParts(y), period = (p: Intl.DateTimeFormatPart[]) => p.find(q => q.type === 'dayPeriod')?.value;
  if (!period(px) || period(px) !== period(py)) return `${f.format(x)}–${f.format(y)}`;
  // drop the period (and the space beside it) from the side it repeats on: the first when it trails, the second when it leads
  const lead = px.findIndex(p => p.type === 'dayPeriod') < px.findIndex(p => p.type === 'hour');
  const without = (p: Intl.DateTimeFormatPart[]) => p.filter(q => q.type !== 'dayPeriod').map(q => q.value).join('').trim();
  return lead ? `${f.format(x)}–${without(py)}` : `${without(px)}–${f.format(y)}`;
}

/** "Today", "Tonight", "Tomorrow", "Yesterday", "Fri", else the date ("Thu 12 Nov"). Calendar days, so a day with a clock
 *  change still counts as one. */
export function relativeDay(t: Date | number | string, s: Style = {}, now = Date.now()) {
  const d = at(t), start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date(now))) / 864e5);
  if (diff === -1) return 'Yesterday';
  if (diff === 0) return d.getHours() >= 17 ? 'Tonight' : 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return weekday(d, s);
  return date(d, s, { bare: true, now });
}

/** When something happened or will: the time today ("8:25 AM"), else with its day ("Fri 8:25 AM", "3 Nov 8:25 AM"). */
export function stamp(t: Date | number | string, s: Style = {}, now = Date.now()) {
  const d = at(t), n = new Date(now);
  if (sameDay(d, n, s)) return time(d, s);
  return `${Math.abs(+d - now) < 6 * 864e5 ? weekday(d, s) : date(d, s, { bare: true, now })} ${time(d, s)}`;
}

// ── Lengths of time
const UNITS = [
  { ms: 365 * 864e5, short: 'y', one: 'year', many: 'years' },
  { ms: 864e5, short: 'd', one: 'day', many: 'days' },
  { ms: 36e5, short: 'h', one: 'hr', many: 'hr' },
  { ms: 6e4, short: 'm', one: 'min', many: 'min' },
  { ms: 1e3, short: 's', one: 'sec', many: 'sec' },
] as const;

/** How long, one way everywhere. Short: "2h 37m", "50m", "3d 4h", "45s". Long: "2 hr 37 min", "50 min", "3 days".
 *  The second part comes only while the first is under 10 and isn't seconds ("9h 40m", "14h"); `parts: 1` keeps just the
 *  first, rounded ("3h"). Years carry one decimal under 10 ("1.5y"). Under a minute is seconds. */
export function duration(ms: number, o: { style?: 'short' | 'long'; parts?: 1 | 2 } = {}): string {
  const long = o.style === 'long';
  if (!Number.isFinite(ms)) return '∞';
  ms = Math.max(0, ms);
  const word = (n: number, u: typeof UNITS[number]) => long ? `${n} ${n === 1 ? u.one : u.many}` : `${n}${u.short}`;
  if (Math.round(ms / 1e3) < 60) return word(Math.round(ms / 1e3), UNITS[4]);
  const i = UNITS.findIndex(u => ms >= u.ms), u = UNITS[i < 0 ? 3 : i];
  // rounding can carry a unit up (59.6 minutes is "1h", 23.99 hours "1d"): then it's said in that unit
  const up = (n: number) => i > 0 && n * u.ms >= UNITS[i - 1].ms ? duration(n * u.ms, o) : undefined;
  if (u.short === 'y') { const y = ms / u.ms; return word(y < 10 ? Math.round(y * 10) / 10 : Math.round(y), u); }
  const next = UNITS[i + 1], whole = Math.floor(ms / u.ms);
  if ((o.parts ?? 2) === 1 || whole >= 10 || next.short === 's') { const n = Math.round(ms / u.ms); return up(n) ?? word(n, u); }
  const rest = Math.round((ms - whole * u.ms) / next.ms);
  if (rest * next.ms >= u.ms) return up(whole + 1) ?? word(whole + 1, u);
  return rest ? `${word(whole, u)} ${word(rest, next)}` : word(whole, u);
}

/** "just now", "5m ago", "2h ago", "3d ago" */
export const ago = (t: number | string | Date, now = Date.now()) => {
  const ms = now - +at(t);
  return ms < 6e4 ? 'just now' : `${duration(ms, { parts: 1 })} ago`;
};

// ── Numbers with units
/** A value and its unit as text: "14%", "42°C", "58 GB". No space before ° or %, one before a word. */
export const withUnit = (value: string | number, unit?: string) => {
  const u = unit?.trim();
  return !u ? String(value) : /^[°%′″]/.test(u) ? `${value}${u}` : `${value} ${u}`;
};

/** The day's range, the same on the page, the wall and in chat: "High 5° · Low -4°". Weather's degrees go bare, as
 *  every forecast writes them. */
export const highLow = (hi: number, lo: number) => `High ${hi}° · Low ${lo}°`;

/** A value written as text back into its number and unit: "20.0 °C" → ["20.0", "°C"], "1.2 MB/s" → ["1.2", "MB/s"],
 *  "14%" → ["14", "%"]. What isn't a number with a unit comes back whole with no unit. */
export function splitUnit(value: string | number): [string, string | undefined] {
  const m = String(value).match(/^\s*([−+-]?[\d][\d.,\s]*?)\s*(°[CFK]?|%|[A-Za-zµ][\w/µ²³]*(?:\/[a-z]+)?)\s*$/);
  return m ? [m[1], m[2]] : [String(value), undefined];
}
