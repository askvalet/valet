// The card catalog: every widget on the homepage and every generative card in chat is one of these plain objects.
// Integrations (built-in or community) only ever return data in these shapes, so everything renders natively,
// on-theme and safely, and the assistant can compose cards from any integration side by side.

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

/** A headline number for the overview's top row ("Services · 10/10 · all up"). Any card may carry one. */
export interface Summary {
  label: string;
  value: string | number;
  sub?: string;           // under the label, e.g. "Ryzen 9 9950X3D"
  detail?: string;        // bottom right, e.g. "39°C"
  tone?: Tone;
  icon?: string;
  trend?: number[];       // recent values, drawn as a live area graph behind the tile
  pct?: number;           // 0..1, for ring gauges
  ring?: string;          // the number shown inside a ring gauge, if different from `value` (e.g. "23%")
}

interface Base {
  title?: string;
  icon?: string;          // icon name from the built-in set, or a URL
  href?: string;          // "open the app" link
  note?: string;          // small text in the card header, e.g. "↓ 4 MB/s"
  summary?: Summary;
  summaries?: Summary[];  // several headline tiles from one card (e.g. CPU, memory, network, each disk)
  wide?: boolean;         // take two columns (and two rows) on wide screens
}

export interface StatItem {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;           // secondary line, e.g. "of 123 GB"
  tone?: Tone;
  pct?: number;           // 0..1 → a slim meter under the value
  trend?: number[];       // recent values → sparkline
}

export interface StatsCard extends Base { type: 'stats'; items: StatItem[] }

export interface ListItem {
  title: string;
  subtitle?: string;
  meta?: string;          // right-aligned, e.g. "8 min left"
  pct?: number;           // 0..1 progress bar
  tone?: Tone;
  image?: string;
  badge?: string;
}
export interface ListCard extends Base { type: 'list'; items: ListItem[]; empty?: string }

export interface MediaItem {
  title: string;
  subtitle?: string;      // episode / artist
  image?: string;         // poster / cover
  backdrop?: string;      // wide artwork shown full-bleed behind the item
  pct?: number;           // playback position 0..1
  state?: 'playing' | 'paused' | 'buffering';
  user?: string;
  device?: string;
  detail?: string;        // e.g. "4K · direct play · 36 Mbps"
  tags?: string[];        // small labels shown as chips, e.g. ["4K", "Transcode", "40 Mbps"]
  remaining?: string;     // e.g. "41 min left"
}
export interface MediaCard extends Base { type: 'media'; items: MediaItem[]; empty?: string }

/** A horizontal shelf of artwork (posters, albums, photos), like a row in the Apple TV app. */
export interface ShelfItem { title: string; subtitle?: string; image?: string; badge?: string; href?: string }
export interface ShelfCard extends Base { type: 'shelf'; items: ShelfItem[]; aspect?: 'poster' | 'square' | 'wide'; empty?: string }

export interface StatusItem { name: string; ok: boolean; ms?: number; detail?: string; href?: string; icon?: string; group?: string; quiet?: boolean }   // quiet: being down is expected, never an alert
export interface StatusCard extends Base { type: 'status'; items: StatusItem[] }

export interface ChartCard extends Base {
  type: 'chart';
  unit?: string;
  max?: number;
  series: { name: string; points: number[]; tone?: Tone }[];
  span?: string;          // e.g. "last 10 min"
}

export interface Control {
  id: string;
  label: string;
  kind: 'toggle' | 'slider' | 'select' | 'button' | 'value';   // value: read-only, e.g. a sensor reading
  value?: boolean | number | string;
  options?: string[];
  min?: number; max?: number; step?: number;
  color?: string;         // swatch, e.g. a light's current colour
  action?: string;        // action name on the same integration instance (not needed for 'value')
  sub?: string;           // second line under the label, e.g. "Office · 80%"
  args?: Record<string, unknown>;
}
export interface ControlsCard extends Base { type: 'controls'; items: Control[] }

/** A hero visual with its numbers beside it: a device, a room, a camera. `visual.kind` picks a renderer
 *  from the web app's visuals (e.g. "pc-case"), or "image" for a plain picture. */
export interface ShowcaseCard extends Base {
  type: 'showcase';
  visual: { kind: string; src?: string; data?: unknown };
  items: StatItem[];
  caption?: string;       // a quiet line under the numbers, e.g. "Lights · white at 100%"
}

/** Weather: now, today's range, and the next hours. */
export interface ForecastCard extends Base {
  type: 'forecast';
  now: { temp: number; feels: number; words: string; icon: string; hi: number; lo: number; precip?: number };
  hours: { time: string; temp: number; icon: string; pop: number; mm?: number }[];   // pop: chance of precipitation, 0..100
}

export interface KVCard extends Base { type: 'kv'; rows: [string, string][] }

export interface TextCard extends Base { type: 'text'; text: string; tone?: Tone }

export interface GroupCard extends Base { type: 'group'; cards: Card[]; layout?: 'row' | 'column' }

export type Card = ForecastCard | ShowcaseCard | StatsCard | ListCard | MediaCard | ShelfCard | StatusCard | ChartCard | ControlsCard | KVCard | TextCard | GroupCard;

/** One widget slot's live state, as pushed to the browser. */
export interface WidgetState { key: string; card?: Card; error?: string; at: number; source?: string }
