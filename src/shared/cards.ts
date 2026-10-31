// The card catalog: every widget on the homepage and every generative card in chat is one of these plain objects.
// Integrations (built-in or community) only ever return data in these shapes, so everything renders natively,
// on-theme and safely, and the assistant can compose cards from any integration side by side.

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

/** A headline number for the overview's top row ("Services · 10/10 · all up"). Any card may carry one. */
export interface Summary {
  label: string;
  value: string | number;
  sub?: string;           // under the label, e.g. "Ryzen 9"
  detail?: string;        // bottom right, e.g. "39°C"
  tone?: Tone;
  icon?: string;
  trend?: number[];       // recent values, drawn as a live area graph behind the tile
  pct?: number;           // 0..1, for ring gauges
  ring?: string;          // the number shown inside a ring gauge, if different from `value` (e.g. "23%")
  image?: string;         // artwork that fills the tile, with the text over it
  marks?: Mark[];         // one small bar per thing the tile counts, e.g. a bar for each drive
}

/** One thing in a tile's row of bars: `pct` sets the height, `tone` the colour, `label` the tooltip. */
export interface Mark { pct?: number; tone?: Tone; label?: string }

/** One moment of the year in review. Use real numbers only: a service that can't say something should leave it out. */
export interface RecapSlide {
  id: string;
  kicker: string;          // the small line above, "You watched"
  value: string;           // the big one; a plain number counts up
  unit?: string;
  line: string;            // a sentence that says why it's interesting
  items?: { name: string; value?: string; image?: string }[];   // a top five
  scope?: string;          // 'year', or what it covers when that isn't this year: "All time", "Last 30 days"
  score?: number;          // higher comes earlier; 50 by default
  stat?: string;           // its label on the shareable card, if it belongs there
  private?: boolean;       // names people, so it stays off the shareable card
  trait?: { name: string; line: string; strength: number };     // who this makes you, 0..1: the strongest wins
  icon?: string;
  backdrop?: string;       // wide artwork, full bleed behind the slide
  wall?: boolean;          // the drifting wall of posters behind it
  art?: string[];          // posters to add to that wall
  theme?: string;          // media, music, reading, food, home, network, reach, security, files, ops, code, ai, hardware, games: neighbours never share one
  show?: { images: string[]; shape?: 'poster' | 'square'; soft?: boolean };   // a wall of this slide's own pictures
  icons?: string[];        // a wall of app icons
  logo?: string;           // the app's own icon, large, tinting the slide with its colours
  visual?: { kind: 'home' | 'pc-case'; data: unknown };         // a live 3D model beside the words
  bars?: { label: string; value: number; show?: string }[];     // a small chart of what the number is made of
  chart?: { pct: number; from: string; to: string; mark: string };  // how far along, its two ends, and what's at the marker
  facts?: Record<string, number>;   // raw numbers, so slides can be written across services
}
export interface Recap { year: number; soFar: boolean; slides: RecapSlide[]; persona: { name: string; line: string }; stats: { label: string; value: string }[]; wall: string[] }

/** What an action is about to do, in words a person would use, for the approval card. */
export interface Confirm { title: string; detail?: string; image?: string; icon?: string; verb?: string; danger?: boolean }

/** Something happening right now, for the island at the top of the page: a stream, a download, a robot cleaning.
 *  A card carries one only while it's live; the island shows the live ones in the order the config lists them. */
export interface Activity {
  title: string;
  subtitle?: string;
  image?: string;         // artwork; otherwise `icon`
  icon?: string;
  pct?: number;           // 0..1 progress
  trailing?: string;      // short text on the right, e.g. "34m left"
  tone?: Tone;
  count?: number;         // more of the same (e.g. 3 streams)
  paused?: boolean;
}

interface Base {
  source?: { name: string; icon?: string };   // where this comes from, shown beside the title: Plex, Seerr, RomM…
  title?: string;
  icon?: string;          // icon name from the built-in set, or a URL
  href?: string;          // "open the app" link
  note?: string;          // small text in the card header, e.g. "↓ 4 MB/s"
  summary?: Summary;
  summaries?: Summary[];  // several headline tiles from one card (e.g. CPU, memory, network, each disk)
  wide?: boolean;         // take two columns (and two rows) on wide screens
  activity?: Activity;    // set only while something's live
  buttons?: { label: string; action: string; args?: Record<string, unknown> }[];   // quick actions along the bottom
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

export interface StatsCard extends Base { type: 'stats'; items: StatItem[]; pie?: { label: string; value: number; tone?: Tone }[]; pieCenter?: string }   // pie: parts of a whole, drawn as a ring instead

export interface ListItem {
  title: string;
  href?: string;           // the row opens this (a new tab)
  dot?: Tone;              // a status dot on the right, instead of a word
  detail?: string;         // a couple of lines under the title, e.g. a summary
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
  icon?: string;          // the glyph by the progress bar (default: play/pause), e.g. download
}
export interface MediaCard extends Base { type: 'media'; items: MediaItem[]; empty?: string }

/** A horizontal shelf of artwork (posters, albums, photos), like a row in the Apple TV app. */
export interface ShelfItem { title: string; subtitle?: string; image?: string; badge?: string; href?: string; backdrop?: string; tone?: Tone }
export interface ShelfCard extends Base { type: 'shelf'; items: ShelfItem[]; aspect?: 'poster' | 'square' | 'wide'; empty?: string; stack?: boolean; layout?: 'row' | 'spotlight' | 'week' | 'tickets' }   // stack: a pile of pages that fans out

export interface StatusItem { name: string; ok: boolean; ms?: number; detail?: string; href?: string; icon?: string; group?: string; quiet?: boolean }   // quiet: being down is expected, never an alert
export interface StatusCard extends Base { type: 'status'; items: StatusItem[] }

export interface LinkItem { name: string; href: string; icon?: string; note?: string }
export interface LinksCard extends Base { type: 'links'; items: LinkItem[] }   // bookmarks: a tidy list of places to go

export interface ChartCard extends Base {
  type: 'chart';
  unit?: string;
  max?: number;
  series: { name: string; points: number[]; tone?: Tone }[];
  headline?: string;      // the big number, when the latest point isn't it ("31 plays")
  span?: string;          // e.g. "last 10 min"
  from?: number;          // when the first point is (ms), so scrubbing can say when
  to?: number;            // when the last point is
  labels?: string[];      // or a name per point, for charts that aren't over time
}

export interface CodeCard extends Base { type: 'code'; lines: string[]; diff?: boolean }   // logs, config: diff colours lines starting + and -
export interface TableCard extends Base { type: 'table'; columns: string[]; rows: (string | number)[][] }

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

/** Photos to look at, not browse: a slow crossfading flashback, or a mosaic. */
export interface PhotosCard extends Base {
  type: 'photos';
  items: { image: string; title?: string; subtitle?: string; badge?: string; href?: string }[];
  style?: 'flashback' | 'mosaic';
  empty?: string;
}

/** A day's times (prayers, a timetable): the next one large with a live countdown, the rest on a timeline. */
export interface ScheduleCard extends Base {
  type: 'schedule';
  items: { name: string; at: string }[];   // ISO times, in order
  muted?: string[];                         // shown on the timeline but never "next" (e.g. sunrise)
}

/** A verse or a quote: the original (right-to-left if Arabic), its translation, where it's from. */
export interface VerseCard extends Base { type: 'verse'; arabic?: string; english: string; reference: string; meaning?: string }

export interface KVCard extends Base { type: 'kv'; rows: [string, string][] }

export interface TextCard extends Base { type: 'text'; text: string; tone?: Tone }

export interface GroupCard extends Base { type: 'group'; cards: Card[]; layout?: 'row' | 'column' }

/** Who or what comes top: the leader gets its artwork, the rest a bar. */
export interface RankedItem { title: string; subtitle?: string; value?: string; image?: string; backdrop?: string; pct?: number; href?: string }
export interface RankedCard extends Base { type: 'ranked'; items: RankedItem[]; empty?: string }

/** A page inside a card, sandboxed. Only addresses the iframe integration allowed can load. */
export interface EmbedCard extends Base { type: 'embed'; src: string; height: number; scripts?: boolean }

export type Card = EmbedCard | RankedCard | CodeCard | TableCard | LinksCard | VerseCard | ScheduleCard | PhotosCard | ForecastCard | ShowcaseCard | StatsCard | ListCard | MediaCard | ShelfCard | StatusCard | ChartCard | ControlsCard | KVCard | TextCard | GroupCard;

/** One widget slot's live state, as pushed to the browser. */
export interface WidgetState { key: string; card?: Card; error?: string; at: number; source?: string }
