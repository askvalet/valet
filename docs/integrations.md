# Writing an integration

An integration turns one block of `config.yaml` into widgets for the homepage, actions for its controls, and tools
for the assistant. It's one file in `src/integrations/`, registered in `src/integrations/index.ts`.

Everything runs on the server. API keys and internal URLs never reach the browser.

## The smallest useful one

```ts
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'uptime-kuma',                 // `type:` in config.yaml
  name: 'Uptime Kuma',
  config: z.object({ url: z.string().url(), slug: z.string() }),
  create(cfg, ctx) {
    async function monitors() {
      const j = await ctx.http(`${cfg.url}/api/status-page/heartbeat/${cfg.slug}`);
      return Object.entries(j.heartbeatList).map(([id, beats]: [string, any]) => ({ id, up: beats.at(-1)?.status === 1 }));
    }
    return {
      widgets: {
        status: {
          title: 'Uptime', interval: 30_000,
          async fetch() {
            const m = await monitors();
            return { type: 'status', title: 'Uptime', items: m.map(x => ({ name: x.id, ok: x.up })) };
          },
        },
      },
      tools: {
        uptime: {
          description: 'Which monitors are up or down right now.',
          access: 'read', input: z.object({}),
          async run() { const m = await monitors(); return { data: m, card: { type: 'status', items: m.map(x => ({ name: x.id, ok: x.up })) } }; },
        },
      },
    };
  },
});
```

Then in `config.yaml`:

```yaml
integrations:
  uptime: { type: uptime-kuma, url: http://kuma:3001, slug: home }
layout:
  - widgets: [uptime.status]
```

## The parts

**`config`** is a Zod schema. Valet validates the user's block against it and reports errors with the path.

**`widgets`** each return a card from the catalog (`src/shared/cards.ts`). `interval` is how often it refreshes while
someone is looking (default 10 s). Widgets that aren't in the layout are never polled.

**`actions`** are what homepage controls call. A `controls` card item names an action and its args; when the person
flips a toggle, Valet runs the action and refreshes the integration's widgets right away. An action may return
`{ done: 'Archived a saved link' }`: that's what the activity log says it did, in place of the integration and action name.

**`tools`** are what the assistant may call. Write `description` for the model: what it returns and when to use it.
Return `data` (compact JSON the model reads) and optionally a `card` (what the person sees). Give it a `label`: what it
did, past tense, for its chip in chat ("Searched documents"); `followUps` offers a couple of next questions after an
answer that used it. Pick the narrowest `access`:

- `read`: only looks.
- `write`: adds something the person asked for (save a link, file a document). Every call asks first. That's what stops
  a web page from talking the assistant into acting.
- `control`: changes or removes something (pause, stop, turn off, request). Every call asks first, and it only exists
  for the assistant if the user grants `control`.

A tool can also carry:

- `confirm(input)`: what the approval card says, `{ title, detail, image, icon, verb, danger }`. `danger` makes the button
  red. It may look things up but never change them, and should show what the service says, not what the model typed.
- `undo`: the tool that reverses this one, given the same input. It adds Undo in the activity log.
- `find`: the input field that takes search words, which puts the tool in the assistant's `search_everything`.
- `live: true`, on a cheap look-only tool whose answer changes by itself: its card keeps itself current in chat.

**`commands`** are plain words for ⌘K that run an action or a tool by rule, with no model: "pause downloads",
"what's playing", "pause ads 10 min". Typing one exactly runs it; nothing else does. Each is
`{ say, run, input?, label? }`:

```ts
commands: [
  { say: ['pause downloads', 'pause {name}'], run: 'action:pause', label: 'Pause all downloads' },
  { say: ["what's downloading", 'downloads'], run: 'tool:downloads_status' },
  { say: ['pause ads {minutes} min'], run: 'action:pause', label: 'Pause ad blocking: {minutes} min' },
  { say: ['pause ads {hours} hour'], run: 'action:pause', input: ({ hours }) => ({ minutes: hours * 60 }) },
],
```

- `say` lists every phrasing you'd accept. Matching ignores case, punctuation, word order, plurals and filler ("the",
  "all", "please", "turn"), and treats a few words as one: off/disable, on/enable, pause/stop, resume/start/continue,
  min/minutes, h/hours. Nothing else is guessed, so write the variants out. `{name}` becomes the instance's name in
  `config.yaml` and the integration's own name.
- A slot like `{minutes}` takes a whole number and is added to the input under its name. The target's schema still checks it.
- `run: 'action:<name>'` runs a page action, as its button would. `run: 'tool:<name>'` runs a tool: a `read` tool shows its
  card in the palette; anything else shows the tool's approval card (its `confirm`) first.
- `input` is fixed, or a function of the slots that may look things up (never change them) and may throw to say why it
  can't run now ("2 streams are playing").
- `label` is what the palette shows; `{slot}` in it is filled in. It defaults to the first phrase.
- `open: true` on a command for a `read` tool goes to the link its answer carries (`open`, https only) in a new tab, as
  "join meeting" does. Opening a link changes nothing, so it asks nothing first.
- `commands` may be a function, called each time the palette opens: Home Assistant uses that to name each light it may
  control ("desk lamp off").

A command goes through the same doors as the chat: a read-only page only looks, a tool needs the access
`assistant.access` gives that instance (with no assistant, only `read` tools and page actions), input is checked,
results are redacted, and anything that changes something goes in the activity log as `by command`. Two commands with
the same words are both shown, and Enter waits for you to pick one.

**`image(ref, range)`** serves images (posters, snapshots) through Valet so the browser never needs the service's key.
Put `ctx.image(ref)` in a card; validate `ref` before fetching.

**`recap(range)`** adds slides to the year in review: see [plugins.md](plugins.md#the-year-in-review).

**`backups()`** returns its backup jobs for Valet's Backups card: `{ name, source?, lastSuccess?, lastRun?, result?, error?,
size?, sizes?, next?, every?, href? }`, times in ms or ISO dates, only `name` required (`BackupJob` in `src/server/core.ts`).
Valet works out what's overdue or oddly sized; a job that doesn't fit is left out. In a `service()`, `backups: (d, o) => [...]`
reads the card's answers and `backupGet` adds calls made only for backups.

**`reminders()`** returns what to tell the owner at a set time, like a meeting about to start: `{ id, at, until, about?,
title, text?, link?, device? }` (`Reminder` in `src/server/core.ts`). Valet asks every half minute, says each `id` once when
its `at` comes (a notice, `notify.channels`, and devices unless `device: false`), and keeps what it said in
`data/reminders.json`. Past `until` it's not said, nor if `until` came before Valet started; of several due together with
the same `about`, only the latest is said. `link` must be https: tapping the notification opens it.

**`onChat()`** is called when someone asks the assistant something. It returns the widgets to refresh right away, for a
service that shows the assistant at work.

## Context

`ctx.http(url, init)` fetches with a timeout (8 s, or `timeout`) and a readable error, and parses JSON unless you pass
`as: 'text'` or `as: 'response'`; `insecure: true` accepts a self-signed certificate. `ctx.id` is the instance's name and
`ctx.format` the config's `format:`. `ctx.log` prefixes output with the instance name. `ctx.session(login)` shares one sign-in between
parallel requests (call `.get()` for the token, `.reset()` after a 401). `ctx.upload(id)` reads a file the person
attached in chat. `fmt` (from `core.ts`) formats bytes, rates, speeds, percentages, times (`fmt.time`, `fmt.range`:
"8:25–8:50 AM", `fmt.stamp`: "Fri 8:25 AM"), days (`fmt.day`, `fmt.relativeDay`: "Today", "Tomorrow", "Fri") and
lengths of time (`fmt.span(ms)`: "2h 37m", `{ style: 'long' }`: "2 hr 37 min"; `fmt.ago`: "5m ago") the way the page
does, in the house's `format` and language, so never write these by hand (`src/shared/format.ts` says how).

Icons in cards are names: `camera video cpu gpu memory wifi disk download pulse play film search bulb home shield chat image
clock crescent game book coins text file bookmark rss news reddit tag chart calendar sun moon cloud cloud-sun cloud-moon
rain snow fog storm thermometer`, or an image URL or path.

## Guidelines

- Keep `data` small: the model's context is precious. Summarise; don't dump the raw API response.
- One request per widget refresh if you can. If several widgets share data, fetch once and cache briefly.
- Fail with a clear message (`throw new Error('qBittorrent login failed')`); Valet shows it on the widget.
- Don't invent card types. If the catalog is missing something you need, open an issue: new types get added for everyone.

## Cards

A widget returns one card from the catalog in `src/shared/cards.ts`. Pick the one that fits what the data *is*; a person
can still draw it another way with a widget's [`view`](configuration.md#layout).

| Card | For | Notes |
|---|---|---|
| `stats` | a few numbers, one leading | first item is the hero; `trend` draws a sparkline, `pct` a meter |
| `list` | rows of things with a status | `pct` adds a progress bar; `tone` colours a row; `layout` is `temps`, `chips` or `headlines` (one column of stories, each with a small mark: its `image`, the site's icon, else its first letter; then the title and `subtitle · meta`. A card made two rows tall shows as many as fit, any other eight) |
| `status` | services that are up or down | `group` sections them; `quiet` for things that sleep on purpose. `layout: wall` is one icon per app (by `group`, or the name up to its first `-` or `_`), with a count when it has several, its worst state on the dot and what's wrong on hover |
| `media` | what's playing or downloading | full-bleed artwork; `tags`, progress, time left |
| `shelf` | a row of artwork | `aspect` poster/square/wide; `stack: true` piles them up (documents, photos); `layout` is `row`, `spotlight`, `focus`, `coverflow`, `masonry`, `cards`, `desk`, `windows`, `tickets` or `week` |
| `photos` | photos to look at | `style`: `flashback` crossfades, `mosaic` (or size large) tiles them, `album` is a carousel of large photos, each at its own shape, the one you're on captioned and counted; `masonry` is a wall that scrolls sideways |
| `ranked` | who or what comes top | the leader gets its artwork, the rest a bar; `aspect: square` keeps album covers square, as rows and in any gallery view |
| `race` | titles overtaking each other, each bar in its poster's colour | `steps`, and each item's `points` as running totals (and an `image` for its poster) |
| `heatmap` | a year of days | `from`, and a count per day in `days` |
| `article` | one thing to read | the page behind it and a few lines; `more` is the pile to step through |
| `links` | bookmarks | `name`, `href`, `icon`, `note` |
| `cameras` | live cameras | a big view, a pill per camera, `events` as a strip; each camera has an `image` (refreshed every `refresh` seconds, 1 by default) or a `video`, and `detections` draw a box that flashes as it lands. Goes full screen on a tap |
| `schedule` | a day's times | next one counts down live; `muted` times show but are never "next" |
| `forecast` | weather | a large glyph and temperature, high/low, the next `days`; more room adds the hours and range bars |
| `calendar` | an agenda and a month, or a week | `events` with ISO times, or plain dates for all day; browsing a month or a week happens in the browser, within `from`..`to`. Wide, it's the month beside the day; narrower and tall enough, a few days side by side with the hours down the side. `view` (`week` or `agenda`) holds it to one |
| `thermostat` | a dial | `target`, `current`, `min`, `max`, `step`, `unit`; `set` names the action for a new target, `modes` the buttons |
| `controls` | switches, sliders, choices | each control names an action of the same integration; `icon` puts a small picture before a row and `tone` colours its value |
| `chart` | a graph | `style` is `line`, `bars` or `stream`; a series' `color` (`#hex` or `var(--token)`) gives it a colour of its own, say yellow for solar, where otherwise only the first line is coloured |
| `kv`, `text` | key–value rows, a sentence | |
| `code` | logs or config | numbered lines, copy, and `diff: true` colours lines starting `+` and `-` |
| `table` | rows and columns | `columns` and `rows`; numbers line up, and a tap on a heading sorts |
| `embed` | a page inside a card | sandboxed; only addresses the `iframe` integration allowed can load |
| `showcase` | a custom visual with its panel | renderers live in `src/web/visuals/` |
| `group` | cards side by side | mostly for the assistant |

Any card can also carry:

- `summary` (or `summaries`): its headline, shown when the widget is placed with `size: small`, in the menubar, or as a
  tile. `trend` draws a graph behind it and `color` (a hex colour) tints that graph; `pct` fills a ring, `waffle` draws it
  as ten rows of ten squares, `marks` is a row of small bars, and `image` fills the tile.
- `activity`: set only while something is happening; it shows as a ring in the top bar. `countdown: { from, start, end }`
  (ms) lets the page count it down itself: "in 4m" filling from `from`, then "Now · 20m left" until `end`, when the
  ring goes. `link: { label, href, note }` puts a button in its story (an https link, opened in a new tab, its host shown).
  With a countdown, `count` shows as "+1" on the ring.
- `buttons`: quick actions along the bottom (`{ label, action, args }`), run through the integration's `actions`.
- `banner`: a state the person chose and shouldn't forget, at the top of the card: `{ text, until, tone, button }`, as in
  "Blocking paused until 14:05" with Resume beside it. `until` is in milliseconds.

Some cards and rows take a little more:

| Field | On | What it does |
|---|---|---|
| `state` | `status` item | `up`, `degraded`, `down` or `off`, when `ok` and `quiet` can't say it. Anything that counts running services should use `stateOf`, not `ok` |
| `window` | `chart` | what the columns cover, under them: "last 24 hours" |
| `factsNote` | `chart` | what the chips under it are: "Most blocked · last 24 hours" |
| `series[].total` | `chart` | the service's own figure, when summing the points would disagree with the headline |
| `limit` | `list`, `layout: chips` | how many chips show; "19 in all" opens the rest in place |
| `band` | `list` item, `layout: temps` | the normal stretch of the track, `[low, high]`, each 0..1 |
| `section` | `list` item | a quiet heading wherever it changes: "Watching now" above "Last 30 days" |
| `link` | `list` item | a small button on the row that opens an https link in a new tab: `{ label: 'Join', href, note }` |
| `join` | `calendar` event | an online meeting: `{ href, provider }`; the agenda shows the service and a Join button |
| `cta` | `shelf` item | its next step, `{ label, href }`, which the whole tile then opens: "Open in Plex", "See progress" |
| `doc` | `shelf` item | a document's `{ sender, date, type }`: its columns in list view |
| `archived` | `shelf`, `article` | a link to where archived things go |
| `stall` | `media` item | a download getting nowhere: `{ word, since, why, next }`. `since` is when it last moved, in milliseconds; `next` is the step offered on its row, a link or an action |
| `sample` | `cameras` | recorded footage: the card never calls it live |

An `article` card with an `archive` action needs an `unarchive` one too, both taking `{ id }`: Undo calls it.

Weather icons (`sun`, `moon`, `cloud`, `cloud-sun`, `cloud-moon`, `rain`, `snow`, `storm`, `fog`) are drawn as glyphs on
`forecast` cards and on tiles. A `calendar` event's colour is its `color`, or a stable one picked from `calendar`'s name.
A `thermostat` with no `target` draws the room and no handle, and one with no `set` is read-only.

Sizes are the layout's business, not the integration's: every card works as small (its summary), medium and large,
and in chat (dense). Give a card a `summary` so the small size has something to show.

## Cameras

`cameras` is the card for anything with a picture and a name. Two integrations ship with it:

```yaml
integrations:
  nvr:
    type: frigate                 # nvr.status is its stats, nvr.cameras the live view
    url: http://frigate:5000      # the port that needs no sign-in
    cameras: [front, drive]       # optional: which ones, in this order
    go2rtc: http://frigate:1984   # optional: smooth video instead of snapshots, if your cameras send H.264
  yard:
    type: camera                  # any camera that hands over a JPEG: Scrypted, ZoneMinder, Shinobi, an RTSP-to-JPEG bridge
    title: Yard                   # optional, also: href, refresh (seconds), username, password, insecure
    cameras:
      - { name: Shed, url: http://192.168.1.20/snapshot.jpg }
      - { name: Gate, url: http://192.168.1.21/snapshot.jpg, video: http://192.168.1.21/stream.mp4 }
```

Put it where it can be big: `{ widget: nvr.cameras, size: large }`, or a section of its own with `columns: 1`. Pictures
come through Valet, so the browser never needs a camera's address or password, and they stop when the tab is hidden or the
card scrolls away. `image()` answers only to cameras and events it already knows: a `ref` is a name or a position, never
an address. The assistant gets `camera_events` for "was anyone at the door?".

For a camera of your own, return a `cameras` card: `image` for a picture that's fetched again every `refresh` seconds,
and `Cache-Control: no-store` on what your `image()` answers so the browser doesn't keep it. `detections` are the boxes,
`box: [x, y, w, h]` in fractions of the picture; `events` are the strip below.

## Testing

- `checkCard(card)` from `src/shared/cards.schema.ts` validates a card against the catalog (strictly: unknown fields
  are errors). Use it in your integration's tests.
- `npm test` renders every sample card in every size and runs the integration tests, which feed each integration
  made-up responses (see `test/integrations.test.ts` for the pattern: a fake `ctx.http`).
- `npm run test:live` fetches every widget in your `config.yaml` from your real services and validates each card.
- `/#gallery` shows every sample card in every size. Add a sample to `src/web/samples.ts` when you add a card type.
