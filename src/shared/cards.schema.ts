// The card catalog as a runtime schema (zod), kept in step with cards.ts. Tests check every integration's output
// against it, and a community integration can check its own cards the same way. Strict: an unknown field is an
// error, so typos don't silently vanish.
import { z } from 'zod';
import type { Card } from './cards.ts';

const Tone = z.enum(['neutral', 'good', 'warn', 'bad', 'accent']);
const unit = z.number().min(0).max(1.0001);
const finite = z.number().refine(Number.isFinite, 'not a finite number');
const nums = z.array(finite);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'not a date');
const when = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'not a date');

export const Summary = z.object({
  label: z.string(), value: z.union([z.string(), z.number()]), sub: z.string().optional(), detail: z.string().optional(),
  tone: Tone.optional(), icon: z.string().optional(), trend: nums.optional(), color: z.string().regex(/^#[0-9a-f]{3,8}$/i).optional(), pct: z.number().optional(), ring: z.string().optional(),
  image: z.string().optional(), marks: z.array(z.object({ pct: z.number().optional(), tone: Tone.optional(), label: z.string().optional() }).strict()).optional(),
  waffle: z.boolean().optional(), every: z.number().positive().optional(),
}).strict();
const https = z.string().max(2000).regex(/^https:\/\/[^\s]+$/i, 'not an https link');
const Link = z.object({ label: z.string(), href: https, note: z.string().optional() }).strict();
export const Activity = z.object({
  title: z.string(), subtitle: z.string().optional(), image: z.string().optional(), icon: z.string().optional(), pct: z.number().optional(),
  trailing: z.string().optional(), tone: Tone.optional(), count: z.number().optional(), paused: z.boolean().optional(),
  countdown: z.object({ from: finite.optional(), start: finite, end: finite.optional() }).strict().optional(), link: Link.optional(),
}).strict();
const base = {
  source: z.object({ name: z.string(), icon: z.string().optional() }).strict().optional(),
  title: z.string().optional(), icon: z.string().optional(), href: z.string().optional(), note: z.string().optional(),
  summary: Summary.optional(), summaries: z.array(Summary).optional(), wide: z.boolean().optional(), activity: Activity.optional(),
  buttons: z.array(z.object({ label: z.string(), action: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict()).optional(),
  banner: z.object({ text: z.string(), until: z.number().optional(), tone: Tone.optional(),
    button: z.object({ label: z.string(), action: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict().optional() }).strict().optional(),
};
const StatItem = z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional(), sub: z.string().optional(),
  tone: Tone.optional(), pct: z.number().optional(), trend: nums.optional() }).strict();
const ListItem = z.object({ id: z.string().optional(), detail: z.string().optional(), title: z.string(), href: z.string().optional(), dot: Tone.optional(), subtitle: z.string().optional(), meta: z.string().optional(), pct: unit.optional(), tone: Tone.optional(),
  image: z.string().optional(), badge: z.string().optional(), band: z.tuple([unit, unit]).optional(), section: z.string().optional(), trend: nums.optional(),
  buttons: z.array(z.object({ label: z.string(), action: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict()).max(3).optional(), link: Link.optional() }).strict();
const MediaItem = z.object({ title: z.string(), subtitle: z.string().optional(), image: z.string().optional(), backdrop: z.string().optional(), pct: unit.optional(),
  state: z.enum(['playing', 'paused', 'buffering']).optional(), user: z.string().optional(), device: z.string().optional(), detail: z.string().optional(),
  tags: z.array(z.string()).optional(), remaining: z.string().optional(), icon: z.string().optional(),
  stall: z.object({ word: z.string().optional(), since: z.number().optional(), why: z.string().optional(),
    next: z.object({ label: z.string(), href: z.string().optional(), action: z.string().optional(), args: z.record(z.string(), z.unknown()).optional() }).strict().optional() }).strict().optional() }).strict();
const pick = { id: z.string().optional(), headline: z.string(), blurb: z.string().optional(), site: z.string().optional(), image: z.string().optional(), link: z.string().optional(), saved: z.string().optional() };
const ShelfItem = z.object({ id: z.string().optional(), mark: z.string().optional(), at: z.string().regex(/^\d{4}-\d\d-\d\d/).optional(), backdrop: z.string().optional(), tone: Tone.optional(), title: z.string(), subtitle: z.string().optional(), note: z.string().optional(), image: z.string().optional(), badge: z.string().optional(), href: z.string().optional(),
  cta: z.object({ label: z.string(), href: z.string() }).strict().optional(), doc: z.object({ sender: z.string().optional(), date: z.string().optional(), type: z.string().optional() }).strict().optional() }).strict();
const StatusItem = z.object({ name: z.string(), ok: z.boolean(), ms: z.number().optional(), detail: z.string().optional(), href: z.string().optional(),
  icon: z.string().optional(), group: z.string().optional(), quiet: z.boolean().optional(), state: z.enum(['up', 'degraded', 'down', 'off']).optional() }).strict();
const Control = z.object({ id: z.string(), label: z.string(), kind: z.enum(['toggle', 'slider', 'select', 'button', 'value']),
  value: z.union([z.boolean(), z.number(), z.string()]).optional(), options: z.array(z.string()).optional(), min: z.number().optional(), max: z.number().optional(),
  step: z.number().optional(), color: z.string().optional(), action: z.string().optional(), sub: z.string().optional(), args: z.record(z.string(), z.unknown()).optional() }).strict();

const Detection = z.object({ label: z.string(), score: unit.optional(), box: z.tuple([unit, unit, unit, unit]).optional(), path: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).optional() }).strict();
const Camera = z.object({ id: z.string(), name: z.string(), image: z.string().optional(), video: z.string().optional(), poster: z.string().optional(), loop: z.number().positive().optional(),
  offline: z.boolean().optional(), detections: z.array(Detection).optional() }).strict();

export const CardSchema: z.ZodType<Card> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('cameras'), cameras: z.array(Camera), refresh: z.number().positive().optional(), empty: z.string().optional(), sample: z.boolean().optional(),
    events: z.array(z.object({ id: z.string().optional(), camera: z.string(), label: z.string(), at: z.number(), image: z.string().optional(), score: unit.optional() }).strict()).optional() }).strict(),
  z.object({ ...base, type: z.literal('stats'), items: z.array(StatItem), pie: z.array(z.object({ label: z.string(), value: z.number(), tone: Tone.optional() }).strict()).optional(), pieCenter: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('list'), items: z.array(ListItem), empty: z.string().optional(), limit: z.number().int().positive().optional(), log: z.boolean().optional(), layout: z.enum(['temps', 'chips', 'headlines']).optional() }).strict(),
  z.object({ ...base, type: z.literal('media'), items: z.array(MediaItem), empty: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('shelf'), layout: z.enum(['row', 'spotlight', 'week', 'tickets', 'desk', 'windows', 'coverflow']).optional(), items: z.array(ShelfItem), aspect: z.enum(['poster', 'square', 'wide']).optional(), empty: z.string().optional(), stack: z.boolean().optional(), archived: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('status'), items: z.array(StatusItem), layout: z.literal('wall').optional() }).strict(),
  z.object({ ...base, type: z.literal('links'), items: z.array(z.object({ name: z.string(), href: z.string(), icon: z.string().optional(), note: z.string().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('chart'), unit: z.string().optional(), headline: z.string().optional(), max: z.number().optional(), span: z.string().optional(), window: z.string().optional(), factsNote: z.string().optional(), from: z.number().optional(), to: z.number().optional(), style: z.enum(['line', 'bars', 'stream']).optional(), facts: z.array(z.object({ label: z.string(), value: z.string().optional() }).strict()).optional(), labels: z.array(z.string()).optional(),
    series: z.array(z.object({ name: z.string(), points: nums, tone: Tone.optional(), total: finite.optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('race'), span: z.string().optional(), unit: z.string().optional(), steps: z.array(z.string()),
    items: z.array(z.object({ title: z.string(), image: z.string().optional(), points: nums }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('heatmap'), from: date, days: nums, unit: z.string().optional(), headline: z.string().optional(), span: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('controls'), items: z.array(Control) }).strict(),
  z.object({ ...base, type: z.literal('showcase'), visual: z.object({ kind: z.string(), src: z.string().optional(), data: z.unknown().optional() }).strict(),
    items: z.array(StatItem), caption: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('forecast'),
    now: z.object({ temp: z.number(), feels: z.number(), words: z.string(), icon: z.string(), hi: z.number(), lo: z.number(), precip: z.number().optional() }).strict(),
    hours: z.array(z.object({ time: z.string(), temp: z.number(), icon: z.string(), pop: z.number().min(0).max(100), mm: z.number().optional() }).strict()),
    days: z.array(z.object({ name: z.string(), icon: z.string(), hi: z.number(), lo: z.number(), pop: z.number().min(0).max(100).optional() }).strict()).optional(),
    sun: z.object({ rise: z.string().regex(/^\d\d:\d\d$/), set: z.string().regex(/^\d\d:\d\d$/) }).strict().optional() }).strict(),
  z.object({ ...base, type: z.literal('photos'), style: z.enum(['flashback', 'mosaic', 'album']).optional(), empty: z.string().optional(),
    items: z.array(z.object({ image: z.string(), title: z.string().optional(), subtitle: z.string().optional(), badge: z.string().optional(), href: z.string().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('schedule'), sunset: z.string().optional(), muted: z.array(z.string()).optional(),
    items: z.array(z.object({ name: z.string(), at: z.string().refine(s => !Number.isNaN(Date.parse(s)), 'not a date') }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('article'), ...pick, more: z.array(z.object(pick).strict()).optional(), empty: z.string().optional(), archived: z.string().optional() }),
  z.object({ ...base, type: z.literal('calendar'), from: date.optional(), to: date.optional(), empty: z.string().optional(),
    events: z.array(z.object({ title: z.string(), start: when, end: when.optional(), calendar: z.string().optional(), location: z.string().optional(),
      color: z.string().regex(/^(#[0-9a-f]{3,8}|[a-z]{3,30})$/i, 'not a colour').optional(), join: z.object({ href: https, provider: z.string() }).strict().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('thermostat'), unit: z.enum(['C', 'F']), state: z.string(), mode: z.enum(['heat', 'cool', 'auto', 'off']).optional(), current: finite.optional(), target: finite.optional(),
    range: z.tuple([finite, finite]).optional(), min: finite, max: finite, step: z.number().positive(), set: z.object({ action: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict().optional(),
    modes: z.array(z.object({ id: z.string(), label: z.string(), on: z.boolean().optional(), action: z.string(), args: z.record(z.string(), z.unknown()).optional(), hint: z.string().optional() }).strict()).optional(), note: z.string().optional() }).strict(),
  z.object({ ...base, type: z.literal('embed'), src: z.string().url(), height: z.number(), scripts: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('ranked'), empty: z.string().optional(), items: z.array(z.object({ title: z.string(), subtitle: z.string().optional(), value: z.string().optional(), image: z.string().optional(), backdrop: z.string().optional(), pct: unit.optional(), href: z.string().optional() }).strict()) }).strict(),
  z.object({ ...base, type: z.literal('code'), lines: z.array(z.string()), diff: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('table'), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }).strict(),
  z.object({ ...base, type: z.literal('kv'), rows: z.array(z.tuple([z.string(), z.string()])) }).strict(),
  z.object({ ...base, type: z.literal('text'), text: z.string(), tone: Tone.optional() }).strict(),
  z.object({ ...base, type: z.literal('group'), cards: z.array(CardSchema), layout: z.enum(['row', 'column']).optional() }).strict(),
])) as z.ZodType<Card>;

/** Drop undefined values first (integrations build objects with optional fields set to undefined), then validate. */
export const checkCard = (card: unknown) => CardSchema.safeParse(JSON.parse(JSON.stringify(card)));
