# Configuration reference

Everything lives in one YAML file (`config.yaml`, or the path in `VALET_CONFIG`). [`config.example.yaml`](../config.example.yaml)
is a working starting point; this page lists every option. Anything you leave out takes the default shown.

`${NAME}` anywhere in the file is replaced from the environment, or from the file `NAME_FILE` points at (the Docker
secrets convention). `${secret:name}` reads `/run/secrets/name` and `${file:/path}` any file; `\${…}` is left alone.
Valet redacts every replaced secret from anything it sends out. A name ending in `_USER`, `_URL`, `_HOST`, `_PORT` (and
the like) isn't treated as one, unless it also says `TOKEN`, `KEY`, `SECRET`, `PASS` or `WEBHOOK`.

Edits to the file apply live (`reload: true`): a broken edit is reported and the last good config keeps running, and
open pages pick up the new layout. Sign-in settings and plugins are read once, so those need a restart. An unknown key
in the core config is an error with its path, and Valet names the closest match; an integration's unknown option is
reported and ignored. `node dist/server.js config check` lists every problem (unknown types, options and widget keys)
without starting the server, and `config schema` prints a JSON schema editors and agents can work from
(`# yaml-language-server: $schema=valet.schema.json`).

## Environment and commands

| Variable | Default | |
|---|---|---|
| `VALET_CONFIG` | `config.yaml` (`/config/config.yaml` in Docker) | the config file |
| `VALET_DATA` | `data` (`/app/data` in Docker) | wallpaper, icon cache, uploads, history, accounts, pins, the activity log, plugins |
| `PORT` / `HOST` | `7575` / `0.0.0.0` | where it listens |

```sh
node dist/server.js config check                            # every problem in config.yaml, or ✓
node dist/server.js config print                            # the effective config, defaults filled in, secrets redacted
node dist/server.js config schema > valet.schema.json      # JSON schema of the whole file, every integration included
node dist/server.js user add|passwd|remove|signout <name>   # local accounts (asks for the password)
node dist/server.js new-integration <name> [--full]         # scaffold a plugin in data/integrations/
node dist/server.js check-integration <file>                # run a plugin against the sample it carries
```

In Docker, prefix these with `docker exec -it valet`.

## Top level

| Option | Default | |
|---|---|---|
| `title` | `Home` | the page title |
| `greeting` | none | the name in "Sam's homelab". `hero` says whether and how it's shown |
| `notice` | none | a short line (120 characters at most) in a quiet pill above the greeting, e.g. "Interactive demo · simulated home" |
| `location` | none | gives the assistant local context |
| `timezone` | `TZ`, else the first browser's | an IANA name like `America/Toronto`. Times the server writes (assistant answers, watch history) use it; containers default to UTC |
| `allowedHosts` | `[]` | names Valet answers to besides localhost and IP addresses, e.g. `[valet.example.com, "*.home.example.com"]`. Others get 421 (DNS-rebinding protection) |
| `history` | `{ hours: 72, every: 5, background: true }` | remember headline numbers, so tiles can draw a graph and the assistant can say how they moved. `every` is minutes between samples; `background` keeps sampling while nobody has the page open; `false` turns it off |
| `plugins` | `[]` | npm packages of community integrations, or `{ packages, replace }` where `replace` lets a plugin take over a built-in type. Files in `data/integrations/` load on their own |
| `weather` | none | a widget key (e.g. `weather.now`) shown as a ring beside the clock |
| `calendar` | none | a calendar widget (e.g. `family.agenda`) whose events appear when you hover the clock |
| `search` | none | web search from ⌘K: `duckduckgo`, `google`, `kagi`, `brave`, `startpage`, `searxng`, or a URL with `{q}` |
| `links` | `{}` | bookmarks by group, each group a widget `links.<group-slug>`: `Media: [{ name, url, icon?, note? }]`. Without `icon`, the site's favicon (fetched by Valet) |
| `notify` | `{ channels: [] }` | where reminders go when you're not looking: see below. `insights: true` also pushes the shared-cause line. `webPush` is Valet's own notifications, to each device that turns them on in ⌘K |
| `reload` | `true` | watch the file and apply edits live |
| `sandbox` | `false` | for trying Valet out: nothing is saved, and each visitor gets a private copy of the site in memory, told apart by a cookie. At most 40 at once (a new visitor replaces the one idle longest), each dropped after 15 idle minutes. No file uploads, no config tools and no MCP server. It doesn't turn controls on, that's `auth`, and integrations still reach whatever they're pointed at, so use made-up services. The demo runs this way |
| `recap` | `true` | your year in review, at `#recap` and on the overview: the strongest slides first, then all the rest without a break, and a share card where you choose what shows |
| `welcome` | `false` | the getting-started card; a fresh starter config turns it on |

## Look and feel

Everything here is optional, and a config that says nothing gets the default look: graphite, with a brass accent. Options reach the page as
CSS variables on `:root` (`/api/page` carries them), so a saved edit shows up in open tabs at once, without a rebuild.
Sizes in px are plain numbers; where it says "size" you can also write `"40rem"`, `"80vw"` or `"70dvh"`. Colours are
anything CSS calls a colour: `"#0a84ff"`, `rgb(10 132 255)`, `oklch(.7 .2 250)`, `tomato`. Quote hex colours.

### `appearance`

| Option | Default | |
|---|---|---|
| `theme` | `auto` | `auto` follows the device and the switch in the top bar, or dark glass over a wallpaper. `system` follows the device over a wallpaper too: light glass when the phone or computer is in light mode, dark glass in dark mode, turning when the device does (at sunset, say). The switch in the top bar overrides it in that browser, and choosing what the device says goes back to following it. `light` and `dark` hold it there, over a wallpaper too, and drop the switch. The wall display is dark whatever this says, except with `system`, where it follows the screen |
| `motion` | `full` | `reduced`: nothing moves or settles in. `none`: no animation at all, not even fades. A system's reduce-motion setting always counts |
| `sounds` | `{ enabled: false, volume: 0.4 }` | quiet sounds, made in the browser with no files: a tap for a switch, two rising notes when something's done, a falling one for "not now" or a failure, a bell for a notice, a lift when you send a message, and a puff when something's taken off the page. `volume` is 0–1. Each browser can turn them on or off in ⌘K ("Turn sounds on"), which wins over this and is remembered there. Nothing plays until you've touched the page |
| `density` | `comfortable` | `compact` or `spacious`: scales every margin, padding and control together |
| `gap` | 16 | px between cards (12 between tiles until you set this) |
| `sectionGap` | 32 | px between sections |
| `maxWidth` | `1320px`, or `1720px` with a sidebar | a size: how wide the page gets |
| `rowHeight` | fits the tallest card | px, the least a row takes in a section that uses `size`; a card that needs more still gets it |
| `sizes` | see below | what each card size means |
| `css` | none | your own CSS, loaded after everything else. See [Your own CSS](#your-own-css) |
| `cssFile` | none | the same from a `.css` file; `css` comes after it |

`colors`

| Option | Default | |
|---|---|---|
| `accent` | brass | buttons, focus rings, chat. Text on it turns black or white to suit, for a hex colour |
| `good`, `warn`, `bad` | green, orange, red, toned down | status tones |
| `card` | white, `#19191b`, or a dark tint over a wallpaper | the card's tint |

`font`

| Option | Default | |
|---|---|---|
| `family` | Geist | the UI font, or a fallback list: `"Inter, sans-serif"`. Must be installed, or come from `url` |
| `url` | none | where it comes from: a stylesheet (Google Fonts, Bunny Fonts), a font file URL, or a local `.woff2`, `.woff`, `.ttf` or `.otf` that Valet serves itself. Needs `family` |
| `mono` | the system's | code and tool arguments |
| `scale` | `1` | 0.7–1.5, every size of text |
| `headingWeight` | as designed | 100–900: card titles, section titles and the greeting |

A remote `url`'s origin is added to the page's content-security policy for styles and fonts, and only that origin (plus
`fonts.gstatic.com` for Google Fonts, which is where it keeps the files). A local file needs no change at all and works
offline, so it's the choice if you'd rather no browser talks to a font CDN.

`shape`

| Option | Default | |
|---|---|---|
| `radius` | 14 | px, 0–40. Everything rounded follows, and at `0` the pills square off too |
| `border` | 1 | px around cards, 0–8 |
| `borderColor` | a hairline | |
| `shadow` | as designed | `none`, `soft` or `deep` |

`glass`, and the wallpaper

| Option | Default | |
|---|---|---|
| `glass.opacity` | `1`; `0.56` over a wallpaper | how much of the card's tint shows, 0–1 |
| `glass.blur` | 36 | px behind cards; bars and popovers keep in proportion. `0` turns blur off everywhere, and floating sheets go nearly solid so they stay readable |
| `glass.material` | `frosted` | `frosted` is the heavy blur. `liquid` is clearer glass: a lighter blur that keeps the wallpaper's colour, an edge lit from the top left and a soft shadow. In light, a card over a darker part of the wallpaper keeps its light glass and dark text, with a thicker white tint so the words read (frosted glass does the same). Each browser can try the other in ⌘K (**Liquid glass**, under This device). With reduced transparency or high contrast asked for, it goes solid |
| `rim` | none | a fixed bevel of light on the edge of cards, bars and the ask box, 0–1: bright along the top, dark down the sides. It shows on dark frosted glass only, so not without a wallpaper, in light, with `glass.material: liquid` (which lights its own edge) or with `glass.blur: 0` |
| `wallpaper` | none | a file (a path Valet can read: it serves it), an image URL, a colour, or a gradient like `"linear-gradient(135deg, #0f2027, #2c5364)"`. Any of them turns cards to glass. A list takes turns. `{ light: …, dark: … }` gives one for each theme (both, each of them any of the above) |
| `rotate` | none | how long each one in a list stays: `10m`, `1h` |
| `wallpapers` | `{}` | a different one per tab, by the tab's name: `{ Media: /data/film.jpg, Home: "#102030" }`. A value can be a list, or `{ light, dark }`, too. Other tabs and the overview use `wallpaper` |
| `dim` | `0.35` | 0–0.9, darkens it (lightens it, in light). `{ light: 0.2, dark: 0.4 }` sets one for each theme |
| `blur` | `0` | px, 0–40, blurs it. `{ light, dark }` works here too |

`sizes` redefines the card sizes in layout sections. Those sections sit on a grid of 2 columns on a phone, 4 on a tablet
and 6 on a wide screen, and a size can't overrun the last column:

| Size | Columns | Rows | |
|---|---|---|---|
| `small` | 1 | 1 | its headline as a tile |
| `wide` | 2 | 1 | that tile at twice the width |
| `medium` | 2 | 1 | the card |
| `tall` | 2 | 2 | the card over two rows |
| `large` | 4 (all of them below 6) | 1 | the card with more room |

```yaml
appearance:
  sizes: { tall: { rows: 3 }, large: { cols: 6 } }
```

### Your own CSS

For whatever the options don't cover. `css` and `cssFile` are served as one stylesheet from `/api/custom.css`, last in
the page, so they win ties. Anything that could close a `<style>` tag or start a tag is escaped, and values Valet knows to
be secrets are redacted. The page's CSP still applies: no remote `@import` beyond your font's origin. Every variable above
is yours to set, and surfaces can be found by `[data-slot="card"]`, `.glass-bar`, `.glass-round` and `.chat-pop`. These
hooks aren't a stable API: read your CSS again after an upgrade. Saving `cssFile` applies on the next page load; saving
`css` applies at once.

### `hero`

The top of the overview.

| Option | Default | |
|---|---|---|
| `greeting` | `true` | `false` hides it; text replaces "Sam's homelab": `{name}` fills in the top-level `greeting`, `{greeting}` the time of day |
| `status` | `true` | one sentence under it, two things at most: "All 30 services are running and Sam is watching Dune." or "Everything's running except Mealie." What needs someone comes first, and services off by choice aren't counted. If the assistant finds what several problems share, that's the sentence. Hover it for the assistant's brief |
| `search` | `true` | the ask box, or the search box without an assistant |
| `review` | `true` | the year in review link, on its own line under the suggested questions. It can be dismissed for the visit. `end` adds a card closing the overview as well as the link; `false` is neither. `recap: false` turns off the review itself |
| `align` | `center` | `left`, `right` |
| `scope` | none | what the ask box names instead of "anything": `true` works it out from your integrations ("Ask about downloads, lights, what to watch…"), a list of up to 6 says it yourself. `chat.placeholder` wins over it |

### `nav`

| Option | Default | |
|---|---|---|
| `order` | | tabs in this order, by name; the rest follow in layout order |
| `side` | `left` | `left`, `right`, `top`, `bottom`, on wide screens. Phones always have it at the bottom |
| `style` | `icons` | `labels` or `both`, on wide screens. Phones have room for icons. The page moves over to clear a wider rail |
| `hide` | `[]` | tabs to leave out, by name; also `Overview`, and the assistant's name for its button |
| `size` | `1` | 0.6–2, relative to the usual size |

### `menubar`

A list of widget keys, or this, to say more about the bar:

| Option | Default | |
|---|---|---|
| `widgets` | `[]` | widget keys whose headline numbers sit as small rings |
| `position` | `right` | `left`, `center`, on wide screens; below that it's centred at the top of the page |
| `labels` | `true` | the words under the rings |
| `clock`, `date`, `theme` | `true` | the time, the date, and the light/dark switch |
| `size` | `1` | 0.6–2 |

### `format`

| Option | Default | |
|---|---|---|
| `clock` | `auto` | `12h`, `24h`; `auto` follows the browser |
| `emby` | `url`, `key`, `user` (whose shelves; the first administrator by default) | the same as `jellyfin` |
| `date` | `short` | `short` (Sat, Oct 31), `long` (Saturday, October 31), `numeric` (10/31/2026), `iso` (2026-10-31) |
| `locale` | `auto` | a language tag like `en-GB` or `de-DE`: sets month names and how numbers are written (`1.234,5`) on what Valet formats itself. Values a service writes out in full stay as they are |
| `temperature` | `auto` | `c`, `f`: converts anything a service reports as `°C` or `°F` on any card, and is the default for the `weather` integration's `units`. `auto` leaves everything as reported |
| `distance` | `auto` | `km`, `mi`: the same for distances |
| `weekStart` | `auto` | `monday`, `sunday`, `saturday`: the first column of the calendar card's month and the year-of-days heatmap. `auto` follows the locale. Integrations read it as `ctx.format`, the page as `firstDay()` |

### `labels`

The words Valet itself writes, for another language or a voice of your own. `{name}`, `{year}`, `{n}` and `{scope}` fill in. What
services and the assistant write is theirs, and the status sentence is built from English grammar, so turn that off with
`hero.status: false` on a page in another language.

| Key | Default |
|---|---|
| `homelab` | {name}'s homelab |
| `yourHomelab` | Your homelab |
| `goodMorning` | Good morning |
| `goodAfternoon` | Good afternoon |
| `goodEvening` | Good evening |
| `goodNight` | Good night |
| `overview` | Overview |
| `search` | Type a command, or search services |
| `review` | Your {year} in review |
| `reviewMore` | What your homelab got up to this year, in a few screens |
| `reviewGo` | Play |
| `ask` | Ask {name} |
| `askAnything` | Ask {name} anything |
| `askAbout` | Ask about {scope} |
| `allOf` | All {n} |
| `dismiss` | Dismiss |
| `message` | Message {name} |
| `messageHint` | Message {name}, paste a link or drop a file |
| `chatTitle` | Talk to your homelab |
| `thinking` | Thinking |
| `writing` | Writing |
| `thought` | Thought |
| `thoughtFor` | Thought for {n}s |
| `steps` | {n} steps |
| `worked` | Worked for {n}s |
| `allow` | Allow |
| `notNow` | Not now |
| `context` | {used} of {total} tokens |
| `contextUsed` | {used} tokens so far |
| `contextFull` | Long chats get slower and lose track of how they started. |
| `newChat` | Start a new chat |

### A full example

Every option at once, which no real page would want:

```yaml
appearance:
  theme: light
  wallpaper: [/config/walls/dawn.jpg, /config/walls/dusk.jpg, "linear-gradient(135deg, #ffd6e8, #c9f0ff)"]
  rotate: 30m
  wallpapers: { Media: /config/walls/film.jpg, Home: "#fff6e0" }
  dim: 0.1
  blur: 12
  colors: { accent: "#e6007e", good: "#00a36c", warn: "#ff6a00", bad: "#c8102e", card: "#fff7e6" }
  font: { family: Inter, url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800", mono: Fira Code, scale: 1.05, headingWeight: 800 }
  shape: { radius: 6, border: 2, borderColor: "#111111", shadow: soft }
  glass: { opacity: 0.8, blur: 20 }
  density: compact
  gap: 20
  sectionGap: 40
  maxWidth: 1200
  rowHeight: 180
  sizes: { tall: { rows: 3 }, large: { cols: 6 } }
  motion: reduced
  sounds: { enabled: true, volume: 0.25 }
  cssFile: /config/valet.css
  css: "main h2 { text-transform: uppercase; }"

hero: { greeting: "{greeting}, {name}", status: true, search: true, review: false, align: left }

chat:
  open: right
  width: 520
  height: 90vh
  overview: true
  placeholder: "What's up, {name}?"
  suggestions: fixed
  steps: false
  followUps: ["Is anything down?", "What's new?"]
  thinking: hidden
  send: mod-enter
  bubble: "#ffd400"
  beam: once
  beamColor: ocean
  beamStrength: 0.6
  icon: bulb

nav: { side: top, style: both, order: [Lately], hide: [Reading], size: 0.9 }
menubar: { widgets: [system.tiles], position: left, labels: false, clock: true, date: false, theme: false, size: 1.2 }
live: { activities: [plex.streams] }
format: { clock: 24h, date: iso, weekStart: monday, temperature: f, distance: mi, locale: en-GB }
labels: { overview: Everything, goodMorning: Morning }

layout:
  - title: Lately
    gap: 24
    columns: { phone: 2, tablet: 4, desktop: 6 }
    widgets:
      - { widget: plex.recent, size: tall, title: New on Plex, icon: film, header: false }
      - { widget: dns.stats, size: small, tint: "#0a7d4f", opacity: 0.8, blur: 12 }
      - { widget: drives.health, size: wide, background: "https://example.com/rack.jpg" }
      - { widget: plex.top, size: tall, view: coverflow, rows: 3 }
```

## `auth`

| Option | Default | |
|---|---|---|
| `mode` | `none` | `none`, `local` (built-in accounts), `proxy` (trust a sign-in proxy's user header) or `oidc` (OpenID Connect) |
| `oidc` | — | for `mode: oidc`: `issuer`, `clientId`, `clientSecret`, `name` (on the button), `claim` (`preferred_username`), `scope`, `allow` (names or emails; empty: anyone the provider admits), `redirectUrl`. Register `https://<valet>/api/auth/oidc/callback` at the provider |
| `trustNetwork` | `false` | with `mode: none`, Valet is read-only unless this is true (only your VPN/tailnet or a sign-in proxy reaches it) |
| `sessionDays` | `30` | how long "keep me signed in" lasts |
| `secureCookie` | `true` | `false` only when serving over plain http |
| `proxy.header` | `Remote-User` | the header your proxy puts the user in |
| `proxy.trusted` | `[127.0.0.1]` | proxy addresses whose header is believed (and whose `X-Forwarded-For` is used for sign-in throttling) |

## `assistant`

| Option | Default | |
|---|---|---|
| `provider` | `openai-compatible` | or `anthropic` |
| `baseURL` | `http://localhost:11434/v1` | any OpenAI-compatible server (Ollama, llama.cpp, vLLM, LM Studio, OpenRouter, OpenAI) |
| `apiKey` | none | for hosted providers; use `${NAME}` |
| `model` | required | |
| `name` | `Assistant` | what it's called on the page |
| `instructions` | none | added to the system prompt |
| `access` | `{ default: read }` | per integration (by its id): `none`, `read`, `write` (adds things, like saving a link) or `control` (changes or removes things). Both ask you every time. `config: control` lets it edit this file: see below. `valet` (Valet's own tools) defaults to `control`; `write` keeps reminders and turns rules off |
| `maxSteps` | `6` | tool calls per answer, 1–20 |
| `contextWindow` | known Claude models | how many tokens the model can hold, for the meter beside its name in the chat. Claude models fill it in (a million from Opus and Sonnet 4.6 and Haiku 5 on, 200k before); for anything else Valet reads it from the server's `/models` list (`max_model_len`, `context_length` and the like) when the server says, and otherwise set it from your server's context length (Ollama's `num_ctx`, say), or the meter shows only what's used |
| `agent` | none | hand the chat to another agent: `{ name, baseURL, apiKey, model }`, anything OpenAI-compatible (Hermes Agent's API server, say). Remove it to go back. It runs its own tools, so access levels and approvals don't apply; it gets only the conversation, answers are plain text, and a read-only page stays on Valet's assistant. The brief and shared causes stay on `model` |
| `suggestions` | four examples | questions offered until the model has written its own, or if `background.suggest` is off |
| `background` | `{ watch: true, brief: true, suggest: true, perDay: 100 }` | what it does unasked. `watch`: when two or more things break, say what they share, if the data shows it. `brief`: a short summary, shown when you hover the status sentence and rewritten every half hour while the page is in use. `suggest`: write the suggested questions from what's on the page, every half hour or when something changes (`suggestions` is the fallback). `perDay` caps the model calls all three make in a day. None of them get tools |

What `assistant` sets is what it knows and may do. How it looks on the page is `chat`, below, apart from its name.

**Setting up by talking.** With `access: { config: control }` you can change the page from chat: "move Plex above the
weather", "make the cards more compact", "add a card for http://box/status". It reads this file and what a section or
integration accepts, checks the change without saving or contacting anything (a diff and any problems; a real card only if you allow the fetch), and saves only when
you approve; hot reload does the rest, and it can undo the last save. It changes only the lines it must. It can't touch
`auth`, `allowedHosts`, `mcp`, `mcpServer`, `plugins`, `notify`, `sandbox` or `reload`, and of `assistant` only its `name` and
`suggestions`, never its access, model or instructions; it can't
point `appearance` at a file on disk or write its `css`, it refuses to write a secret (it asks you to put `${NAME}` in `.env`),
and a secret only ever goes to hosts it already goes to.
Mount the config folder read-only and it hands you the diff to paste instead.

**It knows Valet.** Whatever its access, the assistant searches these docs to answer questions about Valet, and
`report_issue` writes up a bug, an idea or a missing integration as a filled-in GitHub issue for you to read and submit.
It sends nothing itself.

**Commands, with no model.** ⌘K runs plain commands that integrations declare ("pause downloads", "lights off",
"pause ads 10 min") without asking the model. They follow `access` like the chat: a command that uses a `control` tool
needs `control` for that integration and still shows the approval card. With no `assistant` block, commands run page
actions and tools that only look. See [integrations.md](integrations.md#the-parts) for writing them.

**On the page, not in chat:** A summary when you hover the status sentence, ⌘K answers and approvals in
place, and pin on a chat card to keep it on the page. A pin re-runs the same tool, so no model is involved after that;
pins live in `data/pins.json`.

**Tell me when.** "Tell me when Dune finishes" or "warn me if the drive stays above 55° for 10 minutes" sets a one-off
reminder. A plain rule checks it every half minute, with no model, even with the page closed. Add `valet.activity` to the
layout for a card of everything Valet changed, with Undo where a change can be reversed.

**Standing instructions.** "When a download finishes, pause the rest", "if the GPU stays over 85° for 10 minutes, unload
the model", "every morning at 7, if anything is down, tell me" set up a rule: a trigger on one of your cards or a time of
day (in `timezone`), optionally only if something else is true, one integration tool and a message. You approve it once
and it runs with no model from then on, at most once per cooldown (30 minutes by default). A rule can't use the config,
Valet's own tools, plans, pins or MCP; before each run its action is checked again against `assistant.access` and whether
Valet may act, so lowering access stops it, and `access: { valet: write }` turns rules off. Three failures in a row pause
it. `valet.rules` lists them with Pause and Remove; they live in `data/rules.json`. See the docs site's Rules page.

**Several changes at once.** The assistant can propose a plan: every step listed, one approval, stopping at the first
failure. Each step is still a tool its access level allows.

## `chat`

The assistant's window. Its name is `assistant.name`.

| Option | Default | |
|---|---|---|
| `open` | `center` | where it opens: `center`, `right` or `left` (a panel, and the page stays usable beside it), `bottom`, `page` (the whole window). Phones always get the full sheet. A section with `chat: true` holds it on its own tab as well |
| `width`, `height` | suit `open` | sizes, never past the window: `520`, `40rem`, `80vh` |
| `overview` | `true` | `false`: no ask box or chips on the overview. It's still in ⌘K, the tab or the rail's button |
| `placeholder` | `Ask {name} anything` | in the ask box and ⌘K; `{name}` is the assistant's name |
| `suggestions` | `ai` | `ai`: questions written from what's happening (`assistant.background.suggest`), with the cards' own and `assistant.suggestions` to fall back on. `fixed`: exactly `assistant.suggestions`, and no model call. `off`: none, here or in the empty chat |
| `followUps` | none | a list of your own, offered under each answer in place of what the tool it used suggests. One already asked drops out, and so does one about a service that's fine again |
| `steps` | `true` | `false` hides the list of tool calls. Approvals and result cards always show |
| `thinking` | `collapsed` | a model's reasoning: `collapsed` (a line that opens), `open`, `hidden` |
| `send` | `enter` | `mod-enter`: ⌘/Ctrl+Enter sends, Enter starts a new line |
| `bubble` | the accent | your messages; for a hex colour, the text turns black or white to suit |
| `beam` | `off` | a light travelling around the chat box: `always`, `focus` (while typing) or `thinking` (one band, only while it answers), or `once`: one lap as the page opens, then while typing |
| `beamColor` | `mono` | `colorful`, `mono`, `ocean` or `sunset`. With `thinking`, `colorful` is the accent |
| `beamStrength` | `0.45` | how bright the beam is, 0 to 1 |
| `icon` | a speech bubble | an icon name from docs/integrations.md, or an image path or URL, on its buttons and header |

## `notify`

```yaml
notify:
  channels:
    - { type: ntfy, url: https://ntfy.sh/my-topic, token: "${NTFY_TOKEN}" }
    - { type: gotify, url: http://gotify:8080, token: "${GOTIFY_TOKEN}" }
    - { type: telegram, token: "${TELEGRAM_TOKEN}", chat: "${TELEGRAM_CHAT}" }
    - { type: discord, url: "${DISCORD_WEBHOOK}" }
    - { type: slack, url: "${SLACK_WEBHOOK}" }
    - { type: pushover, token: "${PUSHOVER_TOKEN}", user: "${PUSHOVER_USER}" }
    - { type: apprise, url: http://apprise:8000/notify/mykey }     # reaches dozens more services
    - { type: webhook, url: http://anything/hook, headers: { X-Key: "${KEY}" } }
  webPush:                                                        # Valet's own notifications (on by default)
    contact: mailto:you@example.com
```

Everything that goes to the channels also goes to each browser that turned on **Notifications on this device** in ⌘K. That
needs HTTPS (or localhost), and a page that may act. On iPhone and iPad, Valet must be on the Home Screen first.

| `notify.webPush` | Default | |
|---|---|---|
| `enabled` | `true` | lets each browser turn notifications on. Nothing is sent until one does; `false` sends nothing and refuses new devices |
| `contact` | `https://askvalet.dev` | how a push service can reach whoever runs this Valet: a `mailto:` address or an `https://` URL, sent signed with each push |
| `services` | Google, Mozilla, Apple, Microsoft | the push services Valet will post to: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`. A host means HTTPS; add an origin like `http://10.0.0.5:8080` only for a push server of your own |

The signing key is made the first time a browser asks and kept in `data/vapid.json`; subscriptions are in
`data/push.json`. Both are readable only by Valet's user. Delete both to start over: every device then turns notifications
on again.

## `backups`

Every backup job the integrations report (Backrest, Kopia, Duplicati, Proxmox VE and Backup Server, Home Assistant,
TrueNAS, Healthchecks checks named for a backup, and plugins), gathered on Valet's own card `valet.backups`. A job going
wrong and coming right is told once each: a notice, a line on the timeline, and a push to `notify.channels`.

```yaml
backups:
  overdue: 26h
  expect: { Offsite copy: 8d }
  every: 15m
  notify: true
```

| Option | Default | |
|---|---|---|
| `overdue` | `26h` | how long a job may go without a success when its service doesn't say its schedule |
| `expect` | none | that, per job, by name (any case) |
| `every` | `15m` | how often it checks with nobody looking |
| `notify` | `true` | also push failures, overdue jobs and recoveries to `notify.channels` |

`backups: false` turns it off. What it has told, and the sizes it has seen, live in `data/backups.json`.

## `mcp`

Each entry is an MCP server whose tools the assistant may use, under the same rules.

| Option | Default | |
|---|---|---|
| `url` | required | |
| `transport` | `http` | or `sse` |
| `headers` | none | e.g. `{ Authorization: "Bearer ${TOKEN}" }` |
| `access` | `read` | `read` offers only tools the server marks read-only; `control` offers all, and anything not read-only asks first; `none` turns it off |
| `readOnly` | `[]` | tool names to treat as read-only even if the server doesn't mark them |
| `name` | the key | |

## `mcpServer`

Valet as a read-only MCP server, so an AI client you already use (Claude Desktop, an editor) can look at your homelab
through the same tools Valet's assistant has. Off unless set. It answers at `/mcp` (Streamable HTTP) to its own bearer
token, offers only tools that look, never one that adds or changes something, and never Valet's config tools. Results go
through the same redactor as the chat's, and every call is in the activity log.

| Option | Default | |
|---|---|---|
| `token` | required | at least 32 characters; keep it in `.env`, e.g. `token: ${VALET_MCP_TOKEN}` |
| `access` | `{ default: read }` | per integration, `none` or `read`. `{ default: none, plex: read }` opens only Plex |

## `live`

What's happening right now, as rings in the top bar: what's playing, what's downloading, the vacuum, an event in progress.
They share the plate with the `menubar` rings, to their left with a thin divider. Artwork inside, progress around. Hover
or tap one for the story, like every other ring. On phones they share the top row, up to two of them, and the clock steps aside to make room. When
nothing is live, they're not there.

| Option | Default | |
|---|---|---|
| `activities` | `[]` | widget keys, most important first |
| `notify` | `[]` | a short toast at the bottom of the page when something changes: `{ widget, on: start\|end\|down\|up, text, push }`; `{title}` and `{name}` fill in; `push: true` also sends it to your channels |

## `layout`

A list of sections; each is a tab in the rail. Sections appear in this order, top to bottom, and tabs follow it unless
`nav.order` sets their own.

| Option | Default | |
|---|---|---|
| `title` | none | |
| `tabColumns` | same as `columns` | columns on the section's own tab, when you want more room there than on the overview |
| `widgets` | required | `instance.widget`, or an entry with its own settings: below |
| `display` | `cards` | `cards`, `tiles`, `rings` or `media` |
| `columns` | auto | cards per row, 1 to 4, from tablet width up (in a sidebar: the list's columns); or per screen, up to 6: `{ phone: 1, tablet: 2, desktop: 3 }` |
| `gap` | `appearance.gap` | px between its cards |
| `place` | `main` | `left` or `right` makes it a sidebar |
| `variant` | `full` | `minimal`: tighter rows, just the essentials |
| `header` | `true` | `false`: its cards drop their title bar |
| `heading` | `true` | `false`: no title above it (it still names its tab) |
| `overview` | `true` | `false`: only on its own tab |
| `tab` | its title | share a tab with other sections |
| `icon` | its first card's | its tab's icon |
| `chat` | `false` | its tab also holds the assistant, full page |
| `favorites` | none | service names: on the overview, a status card shows only these, plus anything that's down, with a link to all of them on the section's tab |

A widget entry takes these, all optional but `widget`:

| Option | Default | |
|---|---|---|
| `widget` | required | `instance.widget` |
| `size` | `medium` | `small`, `wide`, `medium`, `tall`, `large`: see [sizes](#appearance) |
| `every` | the widget's own | how often it refreshes: seconds, or `30s`, `5m`, `1h` |
| `view` | the widget's own | how it's drawn, whatever the data: below |
| `rows` | the size's own | how many rows it spans, 1 to 6, so smaller cards can stack beside it |
| `title`, `icon` | the card's | its name and icon; on a tile, its label and icon |
| `header` | the section's | `false` drops its title bar, `true` keeps it in a section that drops them |
| `tint` | `colors.card` | a colour for its surface |
| `opacity` | `glass.opacity` | how much of the tint shows, 0–1; `0.45` over a `background` |
| `blur` | `glass.blur` | px behind it |
| `background` | none | an image behind it, under the tint: an `https://` URL or a Valet path. A file at `data/icons/rack.png` is `/api/icon/rack` |

`view` picks how a widget is drawn, separately from its data:

```yaml
widgets:
  - { widget: plex.top, view: coverflow }
  - { widget: plex.plays, view: bars }
```

| Views | Work on |
|---|---|
| Charts: `line`, `bars`, `stream`, `race`, `heatmap`, `ranked`, `pie` | anything with numbers: a chart, race, heatmap or ranked card, or a stats card with a pie |
| Galleries: `row`, `spotlight`, `coverflow`, `desk`, `windows`, `tickets`, `mosaic`, `flashback`, `album` | anything with pictures: a shelf, photos, ranked, race or media card |

`heatmap` needs dates. A view that doesn't fit leaves the card as it was. It changes the card, so a small or wide tile keeps
showing the headline.

## `wall`

A full-screen page at `/wall` for a wall tablet or a spare monitor: the time and weather large across the top, then the
cards you choose, sized to fill the screen. It's its own page, written like `layout`, so the main page doesn't change
what it shows. It only shows: no chat, no ⌘K, no buttons or links, whoever is signed in. Left out, it shows the main
page's services and what's playing or downloading.

```yaml
wall:
  every: 1m                         # how long each page stays
  pages:
    - title: Now
      layout:
        - widgets: [plex.streams, qbit.downloads]
          columns: 2
    - title: House
      every: 30s
      layout:
        - widgets:
            - { widget: frigate.cameras, size: large, rows: 2 }
            - { widget: ha.thermostat, size: medium }
```

| Option | Default | |
|---|---|---|
| `pages` | the default page | pages that take turns; each has `layout` (sections, as in [`layout`](#layout)), and optionally `title`, `every` and `clock: false` to drop the time and weather |
| `layout` | none | one page, written straight here instead of `pages` |
| `every` | `1m` | how long each page stays: seconds, or `45s`, `2m` |
| `pause` | `2m` | after a touch, how long it stays on that page (and how long the night's dimming lifts) |
| `scale` | grows with the screen | how big everything is, 0.6 to 3 |
| `night` | sunset to sunrise | `{ from, to, dim }`: times like `22:00`, or `sunset`/`sunrise` from the weather (21:00 and 07:00 if it doesn't know); `dim` 0 to 0.95, default 0.9. `false`: never |
| `awake` | `true` | keep the screen on while it's open, where the browser allows it (https or localhost) |
| `token` | none | for a screen that can't sign in: at least 32 characters, from `.env`. Open `/wall#key=<token>` once and that browser can read the wall's cards and nothing else. Change it to unpair every screen |

`/wall?page=House` keeps one page on screen. A section's `chat` and the main page's `tab`, `place`, `overview` and
`favorites` mean nothing here. A card that isn't there is a problem `config check` names.

## Integrations

Each entry under `integrations:` has an id (what you use in widget keys and `assistant.access`) and a `type`. Most take
`url` (where Valet reaches the service) and `href` (where its cards link to, if different).

| Type | Options | Widgets |
|---|---|---|
| `aimonitor` | `url` | `usage`, `gpu` |
| `apcups` | `host`, `port` (3551), `title` | `status` |
| `arr` | `sonarr`, `radarr` (each `{ url, apiKey, href }`), `days` (14), `plex` (its web address, so what's ready opens there) | `upcoming` |
| `backrest` | `url`, `username`, `password` (only if Backrest has users), `insecure` | `plans`, `status` |
| `audiobookshelf` | `url`, `key` (an API token; an administrator's to see what's playing now) | `status`, `progress` (books in progress), `playing`, `recent` (new on the shelf), `week` (listening, last 7 days) |
| `camera` | `cameras` (`{ name, url, video }`), `title`, `href`, `refresh` (seconds), `username`, `password`, `insecure` | `cameras` |
| `frigate` | `url` (the port that needs no sign-in), `cameras` (names, in order), `go2rtc` (for smooth video), `every`, `insecure` | `status`, `cameras` |
| `clock` | `clocks` (`{ name, zone }`), `title` | `times` |
| `glances` | `url`, `disks` (mounts, or `{ mount, name, sub }`), `network` (interface), `cpuSensor` (`CPU`) | `tiles`, `overview`, `disks` |
| `healthchecks` | `url` (`https://healthchecks.io` or your own), `key` (the read-only key is enough to look; pausing needs the full one), `insecure` | `checks`, `status` |
| `homeassistant` | `url`, `token`, `cards`, `schedules`, `floorplans`, `thermostats` (`{ entity, title, modes, unit }`), `controllable` (extra entities the assistant may control) | one per entry in `cards`, `schedules`, `floorplans`, `thermostats` |
| `http` | `targets` (`name`, `url`, `href`, `icon`, `group`, `quiet`, `expect`), `interval` (30000 ms) | `status` |
| `iframe` | `url`, `title`, `height` (360), `scripts` (`true`) | `page` |
| `immich` | `url`, `apiKey` | `memories` |
| `jellyfin` | `url`, `key` (an API key), `user` (whose continue watching and recently added; the first administrator by default) | `status`, `streams` (now playing), `resume` (continue watching), `recent`, `library` |
| `indexers` | `prowlarr`, `bazarr` (each `{ url, apiKey }`) | `health` |
| `changedetection` | `url`, `key`, `limit` (8) | `watches`, `status` |
| `karakeep` | `url`, `apiKey` | `recent`, `digest`, `reading` |
| `kavita` | `url`, `username` and `password`, or `key` (an auth key) | `reading` (what you're in the middle of), `recent`, `status` |
| `komga` | `url`, `username` and `password`, or `key` (an API key, Komga 1.20+) | `reading` (in progress, with how far along), `ondeck` (next in a series you've started), `recent`, `status` |
| `mealie` | `url`, `key`, `version` (`2`; `1` before households) | `week` (the meal plan from today), `today` (a recipe of the day), `recent`, `status` |
| `miniflux` | `url`, `key` | `unread` (a pile to step through; archiving marks read), `feeds` (unread per feed), `starred`, `status` |
| `lobsters` | `tags`, `sort` (`hottest`, `newest`), `limit` (8) | `stories` |
| `minecraft` | `host`, `port` (25565), `title` | `status` |
| `navidrome` | `url`, `username`, `password` | `status`, `playing`, `recent` (recently played), `added` (new music), `top` (most played), `rediscover` |
| `ollama` | `url` | `models` |
| `paperless` | `url`, `token` | `recent` |
| `pihole` | `url`, `password` (an app password) | `stats` |
| `proxmox` | `url`, `key` (an API token, `user@realm!tokenid=secret`), `insecure` (Proxmox's certificate is self-signed), `node` (only this one), `vmid` (the status card shows just this guest) | `guests`, `storage`, `status` |
| `qbittorrent` | `url`, `username`, `password`, `arr` (Sonarr/Radarr `{ type, url, apiKey }` for titles and posters) | `active` |
| `repository` | `repos` (`owner/name`), `token`, `title` | `repos` |
| `rgb-control` | `url`, `build`, `view` (`turn`, `tilt`, `draggable`), `presets`, `controls`, `interval` | `pc` |
| `romm` | `url`, `username`, `password` | `recent` |
| `scrutiny` | `url`, `hotC` (55) | `drives` |
| `tandoor` | `url`, `key` (read scope; write to add to the shopping list) | `week` (the meal plan from today), `today` (a recipe of the day), `recent`, `status` |
| `seerr` | `url`, `apiKey`, `downloads` (where "See progress" goes) | `requests` |
| `speedtest-tracker` | `url`, `key` (an API token that can read results, and run tests if you want that from chat), `days` (7, how far back the chart goes), `insecure` | `speed`, `status` |
| `syncthing` | `url`, `key` (its API key), `insecure` | `sync`, `status` |
| `tautulli` | `url`, `apiKey` | `streams`, `recent`, `top`, `people`, `library`, `plays` (a stream of 30 days), `race` (the year's titles overtaking each other; refreshes every few hours), `viewing` (a year of days) |
| `todo` | `title` | `list` |
| `twitch` | `clientId`, `clientSecret`, `channels`, `limit` (8) | `channels`, `games` |
| `uptimekuma` | `url`, `username` (empty with an API key), `password` (or the key), `certWarnDays` (14) | `monitors` |
| `weather` | `latitude`, `longitude`, `units` (from `format.temperature`, else `metric`), `interval` (600000 ms) | `now` |
| `rss` | `feeds` (URLs, or `{ url, name }`; YouTube channels via `youtube.com/feeds/videos.xml?channel_id=…`), `limit` (12), `style` (`list` or `shelf` for thumbnails), `title`, `every` (900 s) | `latest` |
| `hackernews` | `sort` (`top`, `new`, `best`), `limit` (10), `comments` (rows open the discussion) | `stories` |
| `reddit` | `subreddits`, `sort` (`hot`), `limit` (10), `style` (`list` or `shelf`) | `posts` |
| `releases` | `repos` (`owner/name`), `token` (optional, raises GitHub's rate limit), `limit`, `prereleases` | `latest` |
| `markets` | `symbols` (`AAPL`, `BTC-USD`, `^GSPC`, `EURUSD=X`, or `{ symbol, name }`), `range` (`1d`), `title` | `quotes` |
| `docker` | `url` (a read-only socket proxy, never the raw socket), `hide` (names to leave out, e.g. containers that are meant to stay stopped), `sources` (container → GitHub `owner/repo` for release notes, when its image doesn't say), `github` (a token, past 60 requests an hour) | `containers`, `updates` |
| `host` | `url` (the Valet agent), `token`, `title`, `quiet` (services often off on purpose) | `services` |
| `api` | `url`, `headers`, `method`, `body`, `every` (60s), `title`, `icon`, `href`, `about`, and one of `stats`, `list`, `rows`, `status` (see below) | `data` |
| `calendar` | `calendars` (iCal URLs, or `{ url, name, color }`), `days` (14), `limit` (10), `title`, `months` (6, how far ahead the month browses), `meetings` (see below) | `upcoming`, `agenda` (place it `wide` or `large` for the month beside it) |
| `links` | (from the top-level `links:` block) | one per group |

### Online meetings: `calendar.meetings`

A calendar finds the meeting link in each event (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo, Around,
Discord, FaceTime, Chime, BlueJeans), from Google's conference property, the event's URL, its location or its description.
Only https links on those services count. From `lead` before a meeting until it ends, the calendar's ring (add the widget to
`live.activities`) counts down with a Join button; each `remind` sends one notification, once, to `notify.channels` and
to devices with notifications on. Rows get a Join button, ⌘K gets **join meeting** and **next meeting**, and the assistant
gets `calendar_next_meeting`. Works with no config; `meetings: false` turns it all off.

```yaml
integrations:
  work:
    type: calendar
    calendars: ["${GOOGLE_ICAL_URL}"]   # Google Calendar: Settings → your calendar → Secret address in iCal format
    meetings: { lead: 10m, remind: [10m, 1m], push: true, me: you@example.com }
live:
  activities: [work.agenda]
```

| Option | Default | |
|---|---|---|
| `lead` | `10m` | how long before a meeting its ring appears |
| `remind` | `[1m]` | when to remind you before it starts: one time or a list; `[]` for none |
| `push` | `true` | reminders also go to devices with notifications on (⌘K), not only `notify.channels` |
| `me` | none | your address, or a list: meetings you declined are left out, and so are you from who it's with |

Cancelled events are always left out. A reminder is never sent twice (what was sent is kept in `data/reminders.json`), nor
for a meeting already under way when Valet started. The feed is read every 10 minutes, and Google can take a while to
update its secret address, so a meeting added at the last minute may come late.

### Services outside Docker: `type: host`

Valet runs in a locked-down container, so it can't see the machine it's on, or any other. For systemd services, run the
Valet agent on each machine: [`agent/valet-agent.py`](../agent/valet-agent.py), one file of Python's standard library
with nothing to install. It needs a token, answers only about the services you list, and can only look.

```sh
# on each machine
install -m 755 agent/valet-agent.py ~/.local/bin/
install -Dm 644 agent/valet-agent.service ~/.config/systemd/user/valet-agent.service
mkdir -p ~/.config/valet-agent && install -m 600 /dev/null ~/.config/valet-agent/env
cat >> ~/.config/valet-agent/env <<X
VALET_AGENT_TOKEN=$(openssl rand -hex 32)
VALET_AGENT_UNITS=radarr,sonarr,plexmediaserver,user:myjob
VALET_AGENT_BIND=172.17.0.1:7576
X
systemctl --user enable --now valet-agent
loginctl enable-linger $USER
```

```yaml
integrations:
  nas:
    type: host
    url: http://172.17.0.1:7576     # or the machine's tailnet address
    token: ${NAS_AGENT_TOKEN}
    title: NAS
```

Bind it to the Docker bridge for the machine Valet is on, or a tailnet address for another; never a public one. Reading
system services' logs needs your user in the `systemd-journal` group.

### Any JSON API: `type: api`

For a service Valet doesn't know, name a URL and say where the numbers are. No code, and the assistant can read it too
(`about` tells it what it's for).

```yaml
integrations:
  speedtest:
    type: api
    url: http://speedtest:8080/api/speedtest/latest
    headers: { Authorization: "Bearer ${SPEEDTEST_TOKEN}" }
    every: 5m
    title: Speedtest
    icon: wifi
    about: Internet speed, measured every hour.
    stats:
      - { label: Down, value: data.download|round, unit: " Mbps", warn: 200, bad: 50 }   # warn > bad: lower is worse
      - { label: Ping, value: data.ping|round, unit: " ms", warn: 40, bad: 100 }
      - { label: Disk, value: data.used, max: 100 }                                       # max draws a bar
  jobs:
    type: api
    url: http://ci:8080/api/jobs
    title: Jobs
    list: { items: results, limit: 8, title: name, subtitle: "{status} · {size|bytes}", meta: started|ago, href: "http://ci:8080/job/{id}" }
  cluster:
    type: api
    url: http://nodes:9000/nodes
    title: Nodes
    status: { items: $, name: hostname, ok: state, detail: message }   # up, ok, healthy, running, online, true or a 2xx count as up
  box:
    type: api
    url: http://box/info
    title: Box
    rows: { Version: version, Uptime: uptime|duration, Used: "{used|bytes} of {total|bytes}" }
```

A field is a path into the response (`data.speed`, `items[0].name`, `$` for the whole thing), or a template when it has
braces. Paths can pass through formats: `bytes`, `rate`, `duration` (seconds), `pct` (0 to 1), `round:1`, `divide:1000`,
`day`, `time`, `ago`, `upper`, `lower`, `count`. Quote anything with `{` so YAML reads it as text. Secrets go in `headers`
or the `url` as `${NAME}`.

The comments in each integration's schema (`src/integrations/<type>.ts`, the `config:` block) explain the nested
options (Home Assistant's `cards`, `schedules`, `thermostats` and `floorplans`; the PC `build`). `/#gallery` shows every card type.
