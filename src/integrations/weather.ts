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
    units: z.enum(['metric', 'imperial']).default('metric'),
    interval: z.number().default(600_000),
  }),
  create(cfg, ctx) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.latitude}&longitude=${cfg.longitude}&timezone=auto&forecast_days=1`
      + '&current=temperature_2m,apparent_temperature,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min'
      + (cfg.units === 'imperial' ? '&temperature_unit=fahrenheit' : '');
    const get = () => ctx.http<any>(url, { timeout: 8000 });
    return {
      widgets: {
        now: {
          title: 'Weather', interval: cfg.interval,
          async fetch() {
            const w = await get(), t = w.current.temperature_2m, lo = w.daily.temperature_2m_min[0], hi = w.daily.temperature_2m_max[0];
            const [, words, icon] = describe(w.current.weather_code), night = !w.current.is_day && (icon === 'sun' || icon === 'cloud-sun');
            const c = cfg.units === 'imperial' ? (t - 32) / 1.8 : t;
            return { type: 'stats', title: 'Weather', icon: 'sun', items: [{ label: 'Now', value: `${Math.round(t)}°` }, { label: 'High', value: `${Math.round(hi)}°` }, { label: 'Low', value: `${Math.round(lo)}°` }],
              summary: { label: words, icon: night ? (icon === 'sun' ? 'moon' : 'cloud-moon') : icon, value: `${Math.round(t)}°`,
                detail: `H ${Math.round(hi)}° · L ${Math.round(lo)}° · feels ${Math.round(w.current.apparent_temperature)}°`,
                pct: hi > lo ? (t - lo) / (hi - lo) : 0.5,
                tone: c < 0 ? 'accent' : c < 18 ? 'good' : c < 28 ? 'warn' : 'bad' } };
          },
        },
      },
      tools: {
        weather: {
          description: 'Current weather and today\'s high/low at home.', access: 'read', input: z.object({}),
          async run() { const w = await get(); return { data: { current: w.current, today: w.daily, words: describe(w.current.weather_code)[1] } }; },
        },
      },
    };
  },
});
