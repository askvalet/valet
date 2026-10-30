// The card catalog as a runtime schema (zod), kept in step with cards.ts. Tests check every integration's output
// against it, and a community integration can check its own cards the same way. Strict: an unknown field is an
// error, so typos don't silently vanish.
import { z } from 'zod';
import type { Card } from './cards.ts';

const Tone = z.enum(['neutral', 'good', 'warn', 'bad', 'accent']);
const unit = z.number().min(0).max(1.0001);
const nums = z.array(z.number().refine(Number.isFinite, 'not a finite number'));

export const Summary = z.object({
  label: z.string(), value: z.union([z.string(), z.number()]), sub: z.string().optional(), detail: z.string().optional(),
  tone: Tone.optional(), icon: z.string().optional(), trend: nums.optional(), pct: z.number().optional(), ring: z.string().optional(),
}).strict();
export const Activity = z.object({
  title: z.string(), subtitle: z.string().optional(), image: z.string().optional(), icon: z.string().optional(), pct: z.number().optional(),
  trailing: z.string().optional(), tone: Tone.optional(), count: z.number().optional(), paused: z.boolean().optional(),
}).strict();
const base = {
  title: z.string().optional(), icon: z.string().optional(), href: z.string().optional(), note: z.string().optional(),
  summary: Summary.optional(), summaries: z.array(Summary).optional(), wide: z.boolean().optional(), activity: Activity.optional(),
  buttons: z.array(z.object({ label: z.string(), action: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict()).optional(),
};
const StatItem = z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional(), sub: z.string().optional(),
  tone: Tone.optional(), pct: z.number().optional(), trend: nums.optional() }).strict();
const ListItem = z.object({ title: z.string(), subtitle: z.string().optional(), meta: z.string().optional(), pct: unit.optional(), tone: Tone.optional(),
  image: z.string().optional(), badge: z.string().optional() }).strict();
const MediaItem = z.object({ title: z.string(), subtitle: z.string().optional(), image: z.string().optional(), backdrop: z.string().optional(), pct: unit.optional(),
  state: z.enum(['playing', 'paused', 'buffering']).optional(), user: z.string().optional(), device: z.string().optional(), detail: z.string().optional(),
  tags: z.array(z.string()).optional(), remaining: z.string().optional(), icon: z.string().optional() }).strict();
const ShelfItem = z.object({ title: z.string(), subtitle: z.string().optional(), image: z.string().optional(), badge: z.string().optional(), href: z.string().optional() }).strict();
const StatusItem = z.object({ name: z.string(), ok: z.boolean(), ms: z.number().optional(), detail: z.string().optional(), href: z.string().optional(),
  icon: z.string().optional(), group: z.string().optional(), quiet: z.boolean().optional() }).strict();
const Control = z.object({ id: z.string(), label: z.string(), kind: z.enum(['toggle', 'slider', 'select', 'button', 'value']),
  value: z.union([z.boolean(), z.number(), z.string()]).optional(), options: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional(),
  step: z.number().optional(), color: z.string().optional(), action: z.string().optional(), sub: z.string().optional(), args: z.record(z.string(), z.unknown()).optional() }).strict();

export const CardSchema: z.ZodType<Card> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('stats'), items: z.array(StatItem) }).strict(),
  z.object({ ...base, type: z.literal('list'), items: z.array(ListItem), empty: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('media'), items: z.array(MediaItem), empty: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('shelf'), items: z.array(ShelfItem), aspect: z.enum(['poster', 'square', 'wide']).optional(), empty: z.string().optional(), stack: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('status'), items: z.array(StatusItem) }).strict(),
  z.object({ ...base, type: z.literal('chart'), unit: z.string().optional(), max: z.number().optional(), span: z.string().optional(),
    series: z.array(z.object({ name: z.string(), points: nums, tone: Tone.optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('controls'), items: z.array(Control) }).strict(),
  z.object({ ...base, type: z.literal('showcase'), visual: z.object({ kind: z.string(), src: z.string().optional(), data: z.unknown().optional() }).strict(),
    items: z.array(StatItem), caption: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('forecast'),
    now: z.object({ temp: z.number(), feels: z.number(), words: z.string(), icon: z.string(), hi: z.number(), lo: z.number(), precip: z.number().optional() }).strict(),
    hours: z.array(z.object({ time: z.string(), temp: z.number(), icon: z.string(), pop: z.number().min(0).max(100), mm: z.number().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('photos'), style: z.enum(['flashback', 'mosaic']).optional(), empty: z.string().optional(),
    items: z.array(z.object({ image: z.string(), title: z.string().optional(), subtitle: z.string().optional(), badge: z.string().optional(), href: z.string().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('schedule'), muted: z.array(z.string()).optional(),
    items: z.array(z.object({ name: z.string(), at: z.string().refine(s => !Number.isNaN(Date.parse(s)), 'not a date') }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('verse'), arabic: z.string().optional(), english: z.string(), reference: z.string(), meaning: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('kv'), rows: z.array(z.tuple([z.string(), z.string()])) }).strict(),
  z.object({ ...base, type: z.literal('text'), text: z.string(), tone: Tone.optional() }).strict(),
  z.object({ ...base, type: z.literal('group'), cards: z.array(CardSchema), layout: z.enum(['row', 'column']).optional() }).strict(),
])) as z.ZodType<Card>;

/** Drop undefined values first (integrations build objects with optional fields set to undefined), then validate. */
export const checkCard = (card: unknown) => CardSchema.safeParse(JSON.parse(JSON.stringify(card)));
