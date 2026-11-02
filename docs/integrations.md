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

**`image(ref, range)`** serves images (posters, snapshots) through Valet so the browser never needs the service's key.
Put `ctx.image(ref)` in a card; validate `ref` before fetching.

**`recap(range)`** adds slides to the year in review: see [plugins.md](plugins.md#the-year-in-review).

**`onChat()`** is called when someone asks the assistant something. It returns the widgets to refresh right away, for a
service that shows the assistant at work.

## Context

`ctx.http(url, init)` fetches with a timeout (8 s, or `timeout`) and a readable error, and parses JSON unless you pass
`as: 'text'` or `as: 'response'`; `insecure: true` accepts a self-signed certificate. `ctx.id` is the instance's name and
`ctx.format` the config's `format:`. `ctx.log` prefixes output with the instance name. `ctx.session(login)` shares one sign-in between
parallel requests (call `.get()` for the token, `.reset()` after a 401). `ctx.upload(id)` reads a file the person
attached in chat. `fmt` (from `core.ts`) formats bytes, rates, speeds, durations, percentages, days (`fmt.day`,
`fmt.relativeDay`: "Today", "Tomorrow", "Fri") and times consistently.

Icons in cards are names: `camera cpu gpu memory wifi disk download pulse play film search bulb home shield chat image
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
| `list` | rows of things with a status | `pct` adds a progress bar; `tone` colours a row; `layout` is `temps`, `chips` or `headlines` |
| `status` | services that are up or down | `group` sections them; `quiet` for things that sleep on purpose. `layout: wall` is one icon per app (by `group`, or the name up to its first `-` or `_`), with a count when it has several, its worst state on the dot and what's wrong on hover |
| `media` | what's playing or downloading | full-bleed artwork; `tags`, progress, time left |
| `shelf` | a row of artwork | `aspect` poster/square/wide; `stack: true` piles them up (documents, photos); `layout` is `row`, `spotlight`, `coverflow`, `desk`, `windows`, `tickets` or `week` |
| `photos` | photos to look at | `style`: `flashback` crossfades, `mosaic` (or size large) tiles them, `album` is tall strips, and the one under the pointer slides open |
| `ranked` | who or what comes top | the leader gets its artwork, the rest a bar |
| `race` | titles overtaking each other | `steps`, and each item's `points` as running totals |
| `heatmap` | a year of days | `from`, and a count per day in `days` |
| `article` | one thing to read | the page behind it and a few lines; `more` is the pile to step through |
| `links` | bookmarks | `name`, `href`, `icon`, `note` |
| `cameras` | live cameras | a big view, a pill per camera, `events` as a strip; each camera has an `image` (refreshed every `refresh` seconds, 1 by default) or a `video`, and `detections` draw a box that flashes as it lands. Goes full screen on a tap |
| `schedule` | a day's times | next one counts down live; `muted` times show but are never "next" |
| `forecast` | weather | a large glyph and temperature, high/low, the next `days`; more room adds the hours and range bars |
| `calendar` | an agenda and a month | `events` with ISO times, or plain dates for all day; browsing a month happens in the browser, within `from`..`to` |
| `thermostat` | a dial | `target`, `current`, `min`, `max`, `step`, `unit`; `set` names the action for a new target, `modes` the buttons |
| `verse` | a verse or quote | original (right-to-left if Arabic), translation, reference |
| `controls` | switches, sliders, choices | each control names an action of the same integration |
| `chart` | a graph | `style` is `line`, `bars` or `stream` |
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
- `activity`: set only while something is happening; the island shows it.
- `buttons`: quick actions along the bottom (`{ label, action, args }`), run through the integration's `actions`.
- `banner`: a state the person chose and shouldn't forget, at the top of the card: `{ text, until, tone, button }`, as in
  "Blocking paused until 14:05" with Resume beside it. `until` is in milliseconds.

Some cards and rows take a little more:

| Field | On | What it does |
|---|---|---|
| `state` | `status` item | `up`, `degraded`, `down` or `off`, when `ok` and `quiet` can't say it. Anything that counts running services should use `stateOf`, not `ok` |
| `window` | `chart` | what the columns cover, under them: "last 24 h" |
| `factsNote` | `chart` | what the chips under it are: "Most blocked · last 24 h" |
| `series[].total` | `chart` | the service's own figure, when summing the points would disagree with the headline |
| `limit` | `list`, `layout: chips` | how many chips show; "19 in all" opens the rest in place |
| `band` | `list` item, `layout: temps` | the normal stretch of the track, `[low, high]`, each 0..1 |
| `section` | `list` item | a quiet heading wherever it changes: "Watching now" above "Last 30 days" |
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
