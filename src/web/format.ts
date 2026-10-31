// How the page writes times, dates, numbers and its own words, as `format:` and `labels:` say. A module rather than
// React context, so a renderer swaps one call and needs nothing passed down; it's set before the page first draws, and
// a config reload redraws every card anyway.
import { LABELS, type Labels } from '../shared/labels.ts';

export interface Format { clock: 'auto' | '12h' | '24h'; date: 'short' | 'long' | 'numeric' | 'iso'; weekStart: 'auto' | 'monday' | 'sunday' | 'saturday'; locale: string }
let format: Format = { clock: 'auto', date: 'short', weekStart: 'auto', locale: 'auto' }, words: Labels = LABELS;
export const setFormat = (f: Format, l: Labels) => { format = f; words = l; };

const locale = () => format.locale === 'auto' ? undefined : format.locale;
export const label = (key: keyof Labels, fill: Record<string, string | number> = {}) => words[key].replace(/\{(\w+)\}/g, (m, k) => String(fill[k] ?? m));
export const num = (n: number, o?: Intl.NumberFormatOptions) => n.toLocaleString(locale(), o);

const hours: Record<string, Intl.DateTimeFormatOptions> = { '12h': { hour12: true }, '24h': { hour: '2-digit', hourCycle: 'h23' } };
export const clock = (t: Date | number) => new Date(t).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', ...hours[format.clock] });

const dates: Record<string, Intl.DateTimeFormatOptions> = {
  short: { weekday: 'short', month: 'short', day: 'numeric' }, long: { weekday: 'long', month: 'long', day: 'numeric' },
  numeric: { year: 'numeric', month: '2-digit', day: '2-digit' },
};
export const day = (t: Date | number) => {
  const d = new Date(t);
  if (format.date !== 'iso') return d.toLocaleDateString(locale(), dates[format.date]);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
};

/** The first column of a week, 0 for Sunday: for anything that draws one. */
export function firstDay() {
  if (format.weekStart !== 'auto') return { sunday: 0, monday: 1, saturday: 6 }[format.weekStart];
  const info = new Intl.Locale(locale() ?? navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } };
  return (info.getWeekInfo?.().firstDay ?? 7) % 7;
}
