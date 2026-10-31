// Weather from Open-Meteo: free, no key. The ring shows where now sits between today's low and high.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

// WMO weather codes → [words, icon]
const CODES: [number, string, string][] = [
  [0, 'Clear', 'sun'], [2, 'Partly cloudy', 'cloud-sun'], [3, 'Cloudy', 'cloud'], [48, 'Fog', 'fog'], [57, 'Drizzle', 'rain'],
  [67, 'Rain', 'rain'], [77, 'Snow', 'snow'], [82, 'Showers', 'rain'], [86, 'Snow showers', 'snow'], [99, 'Thunderstorm', 'storm'],
];
const describe = (code: number) => CODES.find(([max]) => code <= max) ?? CODES.at(-1)!;

export default defineIntegration({
  type: 'weather',
  name: 'Weather',
  config: z.object({
    latitude: z.number(),
    longitude: z.number(),
    units: z.enum(['metric', 'imperial']).optional(),   // default: format.temperature, or metric
    interval: z.number().default(600_000),
  }),
  create(cfg, ctx) {
    const units = cfg.units ?? (ctx.format?.temperature === 'f' ? 'imperial' : 'metric');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.latitude}&longitude=${cfg.longitude}&timezone=auto&forecast_days=2`
      + '&current=temperature_2m,apparent_temperature,weather_code,is_day,precipitation&daily=temperature_2m_max,temperature_2m_min'
      + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day&forecast_hours=13'
      + (units === 'imperial' ? '&temperature_unit=fahrenheit' : '');
    const get = () => ctx.http<any>(url, { timeout: 8000 });
    return {
      widgets: {
        now: {
          title: 'Weather', interval: cfg.interval,
          async fetch() {
            const w = await get(), t = w.current.temperature_2m, lo = w.daily.temperature_2m_min[0], hi = w.daily.temperature_2m_max[0];
            const look = (code: number, day: number) => { const [, w, i] = describe(code); return { words: w, icon: !day && i === 'sun' ? 'moon' : !day && i === 'cloud-sun' ? 'cloud-moon' : i }; };
            const { words, icon } = look(w.current.weather_code, w.current.is_day);
            const c = units === 'imperial' ? (t - 32) / 1.8 : t;
            const h = w.hourly;
            const hours = h.time.slice(1, 13).map((iso: string, i: number) => ({
              time: new Date(iso).toLocaleTimeString('en', { hour: 'numeric', timeZone: w.timezone, ...(ctx.format?.clock === '24h' ? { hourCycle: 'h23' as const } : {}) }).replace(' ', '').toLowerCase(),
              temp: Math.round(h.temperature_2m[i + 1]), icon: look(h.weather_code[i + 1], h.is_day[i + 1]).icon,
              pop: h.precipitation_probability[i + 1] ?? 0, mm: h.precipitation[i + 1] ?? 0,
            }));
            return { type: 'forecast', title: 'Weather', icon,
              now: { temp: Math.round(t), feels: Math.round(w.current.apparent_temperature), words, icon, hi: Math.round(hi), lo: Math.round(lo), precip: w.current.precipitation },
              hours,
              summary: { label: words, icon, value: `${Math.round(t)}°`,
                detail: `H ${Math.round(hi)}° · L ${Math.round(lo)}° · feels ${Math.round(w.current.apparent_temperature)}°`,
                pct: hi > lo ? (t - lo) / (hi - lo) : 0.5,
                tone: c < 0 ? 'accent' : c < 18 ? 'good' : c < 28 ? 'warn' : 'bad' } };
          },
        },
      },
      tools: {
        weather: {
          label: 'Checked the weather',
          description: 'Current weather and today\'s high/low at home.', access: 'read', input: z.object({}),
          async run() { const w = await get(); return { data: { current: w.current, today: w.daily, words: describe(w.current.weather_code)[1] } }; },
        },
      },
    };
  },
});
