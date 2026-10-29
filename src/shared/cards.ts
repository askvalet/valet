// The card catalog: every widget on the homepage and every generative card in chat is one of these plain objects.
// Integrations (built-in or community) only ever return data in these shapes, so everything renders natively,
// on-theme and safely, and the assistant can compose cards from any integration side by side.

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

interface Base {
  title?: string;
  icon?: string;          // icon name from the built-in set, or a URL
  href?: string;          // "open the app" link
  note?: string;          // small footer text, e.g. "updated 3 s ago" is added by the UI
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
  image?: string;
  pct?: number;           // playback position 0..1
  state?: 'playing' | 'paused' | 'buffering';
  user?: string;
  device?: string;
  detail?: string;        // e.g. "4K · direct play · 36 Mbps"
}
export interface MediaCard extends Base { type: 'media'; items: MediaItem[]; empty?: string }

export interface StatusItem { name: string; ok: boolean; ms?: number; detail?: string; href?: string }
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
  kind: 'toggle' | 'slider' | 'select' | 'button';
  value?: boolean | number | string;
  options?: string[];
  min?: number; max?: number; step?: number;
  color?: string;         // swatch, e.g. a light's current colour
  action: string;         // action name on the same integration instance
  args?: Record<string, unknown>;
}
export interface ControlsCard extends Base { type: 'controls'; items: Control[] }

export interface KVCard extends Base { type: 'kv'; rows: [string, string][] }

export interface TextCard extends Base { type: 'text'; text: string; tone?: Tone }

export interface GroupCard extends Base { type: 'group'; cards: Card[]; layout?: 'row' | 'column' }

export type Card = StatsCard | ListCard | MediaCard | StatusCard | ChartCard | ControlsCard | KVCard | TextCard | GroupCard;

/** One widget slot's live state, as pushed to the browser. */
export interface WidgetState { key: string; card?: Card; error?: string; at: number; source?: string }
