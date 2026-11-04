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
  color?: string;         // that graph's colour
  pct?: number;           // 0..1, for ring gauges
  ring?: string;          // the number shown inside a ring gauge, if different from `value` (e.g. "23%")
  image?: string;         // artwork that fills the tile, with the text over it
  marks?: Mark[];         // one small bar per thing the tile counts, e.g. a bar for each drive
  waffle?: boolean;       // draw `pct` as ten rows of ten squares: "14 in every 100" where a share is the whole story
  every?: number;         // ms between `trend` points, so the graph can say when each one was
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
  private?: boolean;       // names people, so it stays off the shareable card unless chosen
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
  race?: Race;             // the top titles overtaking each other, beside the words
  facts?: Record<string, number>;   // raw numbers, so slides can be written across services
}
export interface Recap { year: number; soFar: boolean; slides: RecapSlide[]; stats: { label: string; value: string }[]; wall: string[] }

/** What an action is about to do, in words a person would use, for the approval card. */
export interface Confirm { title: string; detail?: string; image?: string; icon?: string; verb?: string; danger?: boolean; logo?: string }

/** Something happening right now, for the rings at the top of the page: a stream, a download, a robot cleaning.
 *  A card carries one only while it's live; the rings show the live ones in the order the config lists them. */
export interface Activity {
  title: string;
  subtitle?: string;
  image?: string;         // artwork; otherwise `icon`
  icon?: string;
  pct?: number;           // 0..1 progress
  trailing?: string;      // short text on the right, e.g. "34m left"
  tone?: Tone;
  count?: number;         // more of the same (e.g. 3 streams): the ring says "+2"
  paused?: boolean;
  /** Something at a set time (ms since 1970), which the page counts down itself: before `start` "in 4 min", the ring
   *  filling from `from`; then "Now · 20 min left", filling to `end`, after which the ring is gone. */
  countdown?: { from?: number; start: number; end?: number };
  link?: Link;            // a button in its story, e.g. Join
}
/** A button that opens an https link in a new tab ("Join"); `note` is said beside it, e.g. the service it's on. */
export interface Link { label: string; href: string; note?: string }

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
  banner?: Banner;        // a state the person chose and should not forget, at the top of the card
}
/** "Blocking paused until 14:05", with the way out beside it. `until` (ms) is written in the viewer's own clock. */
export interface Banner { text: string; until?: number; tone?: Tone; button?: { label: string; action: string; args?: Record<string, unknown> } }

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
  id?: string;             // what makes it this row when its words change
  title: string;
  href?: string;           // the row opens this (a new tab)
  dot?: Tone;              // a status dot on the right, instead of a word
  detail?: string;         // a couple of lines under the title, e.g. a summary
  subtitle?: string;
  meta?: string;          // right-aligned, e.g. "8 min left"
  pct?: number;           // 0..1 progress bar
  tone?: Tone;
  image?: string;
  badge?: string;         // a small mark on a chip: "Major", "Read first"
  band?: [number, number];   // temps: the normal stretch of the track, 0..1 at each end
  section?: string;       // rows: a quiet heading wherever this changes, e.g. "Today" above "Earlier"
  trend?: number[];       // rows: a small line of recent values beside the meta, e.g. a backup's size run by run
  buttons?: { label: string; action: string; args?: Record<string, unknown> }[];   // rows: quiet actions on this row alone, e.g. Pause and Remove
  link?: Link;            // a small button on the row, e.g. Join a meeting
}
export interface ListCard extends Base { type: 'list'; items: ListItem[]; empty?: string; limit?: number; log?: boolean; layout?: 'temps' | 'chips' | 'headlines' }   // headlines: a grid of stories, each anchored by its site's favicon · temps: a reading per row (pct along the track, meta the number) · chips: pills, an icon by name · limit: chips show this many, "19 in all" opens the rest in place

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
  icon?: string;          // the glyph by the progress bar (default: a status dot), e.g. download
  stall?: Stall;          // a download getting nowhere: say so in words, and what to do next
}
/** Why a download isn't moving. `since` is when it last moved (ms); `next` is the step offered on its row. */
export interface Stall { word?: string; since?: number; why?: string; next?: { label: string; href?: string; action?: string; args?: Record<string, unknown> } }
export interface MediaCard extends Base { type: 'media'; items: MediaItem[]; empty?: string }

/** A horizontal shelf of artwork (posters, albums, photos), like a row in the Apple TV app. */
export interface ShelfItem { id?: string; mark?: string; at?: string; title: string; subtitle?: string; note?: string; image?: string; badge?: string; href?: string; backdrop?: string; tone?: Tone; cta?: { label: string; href: string }; doc?: { sender?: string; date?: string; type?: string } }   // cta: the next step, which the whole tile then opens · doc: a document's columns in list view
export interface ShelfCard extends Base { type: 'shelf'; items: ShelfItem[]; aspect?: 'poster' | 'square' | 'wide'; empty?: string; stack?: boolean; archived?: string; layout?: 'row' | 'spotlight' | 'week' | 'tickets' | 'desk' | 'windows' | 'coverflow' }   // stack: a pile of pages that fans out · archived: where archived things can be found, with an `unarchive` action beside `archive`

export type ServiceState = 'up' | 'degraded' | 'down' | 'off';
export interface StatusItem { name: string; ok: boolean; ms?: number; detail?: string; href?: string; icon?: string; group?: string; quiet?: boolean; state?: ServiceState }   // quiet: being down is expected, never an alert · state: up, up but unwell, down, or off by choice; left out, it follows from ok and quiet
/** What a status item's dot should say. Anything counting "services running" should use this, not `ok` alone. */
export const stateOf = (i: Pick<StatusItem, 'ok' | 'quiet' | 'state'>): ServiceState => i.state ?? (i.ok ? 'up' : i.quiet ? 'off' : 'down');
export interface StatusCard extends Base { type: 'status'; items: StatusItem[]; layout?: 'wall' }   // wall: a grid of icons, only trouble gets words

export interface LinkItem { name: string; href: string; icon?: string; note?: string }
export interface LinksCard extends Base { type: 'links'; items: LinkItem[] }   // bookmarks: a tidy list of places to go

export interface ChartCard extends Base {
  type: 'chart';
  unit?: string;
  max?: number;
  series: { name: string; points: number[]; tone?: Tone; total?: number }[];   // total: the service's own figure, when summing the points would disagree with the headline
  headline?: string;      // the big number, when the latest point isn't it ("31 plays")
  span?: string;          // e.g. "last 10 min"
  window?: string;        // what the columns cover, under them: "last 24 h"
  from?: number;          // when the first point is (ms), so scrubbing can say when
  to?: number;            // when the last point is
  labels?: string[];      // or a name per point, for charts that aren't over time
  style?: 'line' | 'bars' | 'stream';   // bars: a column per point, the series stacked in order · stream: the same parts flowing around a centre line
  facts?: { label: string; value?: string }[];   // quiet chips under the chart: what the number is made of
  factsNote?: string;     // what those chips are: "Most blocked · last 24 h"
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

/** Weather: now, today's range, the next hours and, if it knows them, the next days. */
export interface ForecastCard extends Base {
  type: 'forecast';
  now: { temp: number; feels: number; words: string; icon: string; hi: number; lo: number; precip?: number };
  hours: { time: string; temp: number; icon: string; pop: number; mm?: number }[];   // pop: chance of precipitation, 0..100
  days?: { name: string; icon: string; hi: number; lo: number; pop?: number }[];     // from tomorrow, name as "Tue"
  sun?: { rise: string; set: string };     // today's sunrise and sunset where the weather is, as "06:52": the wall dims by them
}

/** Photos to look at, not browse: a slow crossfading flashback, or a mosaic. */
export interface PhotosCard extends Base {
  type: 'photos';
  items: { image: string; title?: string; subtitle?: string; badge?: string; href?: string }[];
  style?: 'flashback' | 'mosaic' | 'album';
  empty?: string;
}

/** A day's times (a timetable, tides, opening hours): the next one large with a live countdown, the rest on a timeline. */
export interface ScheduleCard extends Base {
  type: 'schedule';
  items: { name: string; at: string }[];   // ISO times, in order
  muted?: string[];                         // shown on the timeline but never "next" (e.g. sunrise)
  sunset?: string;                          // which item marks sunset, when none is called that
}

/** One thing on a calendar. All-day events use plain dates, so they land on their day in any time zone. */
export interface CalendarEvent {
  title: string;
  start: string;          // ISO time, or YYYY-MM-DD for all day
  end?: string;           // the same form; an all-day end is the day after the last, as in iCal
  calendar?: string;      // which calendar: gives it a stable colour when `color` isn't set
  color?: string;         // #hex or a CSS colour name
  location?: string;
  join?: { href: string; provider: string };   // an online meeting: its https link and the service, e.g. Google Meet
}
/** An agenda beside a month you can browse. `from` and `to` are the dates the events cover, so browsing stops there. */
export interface CalendarCard extends Base { type: 'calendar'; events: CalendarEvent[]; from?: string; to?: string; empty?: string }

/** A thermostat's mode button. Set `on` for the active one; pressing runs `action` with `args`. */
export interface ThermostatMode { id: string; label: string; on?: boolean; action: string; args?: Record<string, unknown>; hint?: string }   // hint: what it does, in one line
/** A dial. `set` is the action that takes a new target: it's called with its `args` plus `{ temperature }`. No `target`
 *  (a heat-cool range, a fan-only mode) draws the room with no handle; no `set` leaves it read-only. */
export interface ThermostatCard extends Base {
  type: 'thermostat';
  unit: 'C' | 'F';
  state: string;          // the word in the middle: "Idle", "Heating"
  mode?: 'heat' | 'cool' | 'auto' | 'off';   // sets the dial's colour
  current?: number;       // the room now
  target?: number;
  range?: [number, number];                  // low and high setpoints instead of a target
  min: number; max: number; step: number;
  set?: { action: string; args?: Record<string, unknown> };
  modes?: ThermostatMode[];
  note?: string;          // whether what it's holding is temporary or on a schedule, when the device says
}


/** One thing to read: the page itself behind it, and what it says in a few lines. */
export interface ArticlePick { id?: string; headline: string; blurb?: string; site?: string; image?: string; link?: string; saved?: string }
export interface ArticleCard extends Base, ArticlePick { type: 'article'; more?: ArticlePick[]; empty?: string; archived?: string }   // more: the pile to step through, `archive` and `unarchive` actions take an id · archived: where archived things can be found
export interface KVCard extends Base { type: 'kv'; rows: [string, string][] }

export interface TextCard extends Base { type: 'text'; text: string; tone?: Tone }

export interface GroupCard extends Base { type: 'group'; cards: Card[]; layout?: 'row' | 'column' }

/** Who or what comes top: the leader gets its artwork, the rest a bar. */
export interface RankedItem { title: string; subtitle?: string; value?: string; image?: string; backdrop?: string; pct?: number; href?: string }
export interface RankedCard extends Base { type: 'ranked'; items: RankedItem[]; empty?: string }

/** A page inside a card, sandboxed. Only addresses the iframe integration allowed can load. */
export interface EmbedCard extends Base { type: 'embed'; src: string; height: number; scripts?: boolean }

/** Something a camera sees: `box` is [x, y, w, h] in fractions of the picture. A `path` moves it instead, as [t, x, y, w, h]
 *  keyframes in seconds of the clock (or of the camera's loop), so the box glides between updates. */
export interface Detection { label: string; score?: number; box?: [number, number, number, number]; path?: [number, number, number, number, number][] }
export interface Camera {
  id: string;
  name: string;
  image?: string;         // the current picture, fetched again about once a second while it's on screen
  video?: string;         // a stream or file to play instead, muted; if it can't play, `image` takes over
  poster?: string;        // a still for the pill, and to show until the video starts
  loop?: number;          // `video` is a loop of this many seconds, kept in step with the clock
  offline?: boolean;
  detections?: Detection[];   // what it sees right now
}
export interface CameraEvent { id?: string; camera: string; label: string; at: number; image?: string; score?: number }   // camera: a Camera's id; at: ms
/** A live view, a pill per camera, and what they've noticed lately. */
export interface CamerasCard extends Base { type: 'cameras'; cameras: Camera[]; events?: CameraEvent[]; refresh?: number; empty?: string; sample?: boolean }   // refresh: seconds between pictures, 1 by default; sample: recorded footage, never called live

/** A year of titles overtaking each other. `points` are running totals, one per step, so the last step is the final order. */
export interface RaceItem { title: string; image?: string; points: number[] }
export interface Race { steps: string[]; items: RaceItem[]; unit?: string }   // unit: 'h' reads as hours and minutes
export interface RaceCard extends Base, Race { type: 'race'; span?: string }

/** A year of days as a grid of squares, a column a week. `days` starts at `from`, a count for each day. */
export interface HeatmapCard extends Base { type: 'heatmap'; from: string; days: number[]; unit?: string; headline?: string; span?: string }   // unit: what's counted, singular: 'play'

export type Card = RaceCard | HeatmapCard | CamerasCard | ThermostatCard | CalendarCard | EmbedCard | RankedCard | CodeCard | TableCard | LinksCard | ArticleCard | ScheduleCard | PhotosCard | ForecastCard | ShowcaseCard | StatsCard | ListCard | MediaCard | ShelfCard | StatusCard | ChartCard | ControlsCard | KVCard | TextCard | GroupCard;

/** One widget slot's live state, as pushed to the browser. */
export interface WidgetState { key: string; card?: Card; error?: string; at: number; source?: string }
