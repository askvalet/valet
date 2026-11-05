// Clocks: the time wherever your people are.
import { z } from 'zod';
import { validZone } from '../server/config.ts';
import { defineIntegration, fmt } from '../server/core.ts';

export default defineIntegration({
  type: 'clock',
  name: 'World clock',
  config: z.object({ title: z.string().default('Clocks'), clocks: z.array(z.object({ name: z.string(), zone: z.string().refine(validZone, 'an IANA time zone, like Asia/Tokyo') })).min(1) }),
  create: cfg => ({ widgets: { times: { title: cfg.title, interval: 30_000, async fetch() {
    const read = (zone: string) => fmt.time(Date.now(), zone), day = (zone: string) => fmt.weekday(Date.now(), { zone });
    return { type: 'stats', title: cfg.title, icon: 'clock', items: cfg.clocks.map(c => ({ label: c.name, value: read(c.zone), sub: day(c.zone) })), summary: { label: cfg.clocks[0].name, icon: 'clock', value: read(cfg.clocks[0].zone), sub: day(cfg.clocks[0].zone) } };
  } } } }),
});
