# Configuration reference

Everything lives in one YAML file (`config.yaml`, or the path in `VALET_CONFIG`). [`config.example.yaml`](../config.example.yaml)
is a working starting point; this page lists every option. Anything you leave out takes the default shown.

`${NAME}` anywhere in the file is replaced from the environment, or from the file `NAME_FILE` points at (the Docker
secrets convention), or from a folder of secret files, Vault or 1Password if [`secrets`](#secrets) says so.
`${secret:name}` reads `/run/secrets/name` and `${file:/path}` any file; `\${…}` is left alone.
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
node dist/server.js doctor [--json] [--send-test]           # what's wrong with this install, and how to fix each thing
node dist/server.js init [--docker <url>] [--print] [--force]   # a first config.yaml from the containers running here
node dist/server.js import <homepage|homarr|dashy|heimdall> <path> [--out <file>] [--env <file>] [--force]
node dist/server.js user add|passwd|remove|signout <name>   # local accounts (asks for the password)
node dist/server.js user list                               # every account: an owner, or which profile
node dist/server.js new-integration <name> [--full]         # scaffold a plugin in data/integrations/
node dist/server.js check-integration <file>                # run a plugin against the sample it carries
```

In Docker, prefix these with `docker exec -it valet`.

`doctor` only reads. It checks the file (every unset `${NAME}` at once), fetches each placed widget once (eight at a
time, 10 seconds each, `--timeout <seconds>` to change that), asks the assistant's server for its model list and the voice
and agent addresses whether they answer, checks each notification channel's shape and that its host answers, and looks at
the data and config folders, sign-in and `allowedHosts`. A failure says what to look at: the address, the key, the path or
the certificate. It never presses a button, runs a tool or sends a notification; `--send-test` sends one message to each
channel, saying it's a test. Everything it prints passes the redactor. It exits 1 when something is wrong, and `--json`
prints the list as `{ ok, checks: [{ group, status, check, problem, fix, ms }] }`.

`init` writes a first `config.yaml`. It asks a read-only Docker socket proxy (`--docker`, `VALET_DOCKER`, or the usual
names) what's running, gives each app Valet knows its block with `${NAME}` for each secret, an up/down check for all of
them and the Docker card, lays them out by kind, and lists the names `.env` needs. With no proxy, or nothing it knows,
it's the starter config. It won't write over a config (`--force` does; the untouched starter doesn't count), and
`--print` only shows it.

`import` turns another dashboard's config into Valet's: Homepage (its config folder, or `services.yaml`; `bookmarks.yaml`,
`widgets.yaml` and `settings.yaml` beside it are read too), Dashy (`conf.yml`), Homarr (a board's JSON export) or
Heimdall (its JSON export). A service with a widget Valet has an integration for becomes that integration; everything
else becomes a link in its group, with an up/down check on a Status card, and groups become sections. A key, token or
password it finds never goes in the config: it writes `${NAME}` and prints the names and values for `.env`, or writes
them to a file only you can read with `--env`. Homepage's `{{HOMEPAGE_VAR_X}}` stays `${HOMEPAGE_VAR_X}`. The config goes
to stdout unless `--out` says where (never over a file without `--force`), and it ends with what became an integration,
what became a link, and what was skipped and why.

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
| `find` | `true` | ⌘K also searches inside your services as you type (documents, saved links, the library, photos…). `false` turns it off; a list keeps it to those integrations, e.g. `[docs, bookmarks]` |
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
| `glass.material` | `frosted` | `frosted` is the heavy blur. `liquid` is clear glass: a light blur that keeps the wallpaper's colour, an edge lit from the top left with a bevel inside it, and a soft shadow. The tint thickens where a card's words need it: in light, a card over a darker part of the wallpaper keeps its light glass and dark text with a whiter tint (frosted glass does the same); in dark, a card over a brighter part gets a deeper smoky one. Each browser can try the other in ⌘K (**Liquid glass**, under This device). With reduced transparency or high contrast asked for, it goes solid |
| `rim` | none | a fixed bevel of light on the edge of cards, bars and the ask box, 0–1: bright along the top, dark down the sides. It shows on dark frosted glass only, so not without a wallpaper, in light, with `glass.material: liquid` (which lights its own edge) or with `glass.blur: 0` |
| `wallpaper` | none | a file (a path Valet can read: it serves it), an image URL, a colour, or a gradient like `"linear-gradient(135deg, #0f2027, #2c5364)"`. Any of them turns cards to glass. A list takes turns. `{ light: …, dark: … }` gives one for each theme (both, each of them any of the above) |
| `rotate` | none | how long each one in a list stays: `10m`, `1h` |
| `wallpapers` | `{}` | a different one per tab, by the tab's name: `{ Media: /data/film.jpg, Home: "#102030" }`. A value can be a list, or `{ light, dark }`, too. Other tabs and the overview use `wallpaper` |
| `dim` | `0.35` | 0–0.9, darkens it (lightens it, in light). `{ light: 0.2, dark: 0.4 }` sets one for each theme |
| `blur` | `0` | px, 0–40, blurs it. `{ light, dark }` works here too |

`sizes` redefines the card sizes in layout sections. Those sections sit on a grid of 2 columns on a phone, 4 on a tablet,
6 on a computer and 8 on a page wider than 1760px, and a size can't overrun the last column:

| Size | Columns | Rows | |
|---|---|---|---|
| `small` | 1 | 1 | its headline as a tile |
| `wide` | 2 | 1 | that tile at twice the width |
| `medium` | 2 | 1 | the card |
| `tall` | 2 | 2 | the card over two rows |
| `large` | 4 (all of them below 6) | 1 | the card with more room |

A widget's own `cols` and `rows` (in [`layout`](#layout)) win over its size.

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
| `align` | `center` | `left`, `right`. `left` puts the greeting at the top left, level with the top bar, and each tab then shows its own name there too |
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
| `clock` | `auto` | `12h`, `24h`; `auto` follows the language (the browser's, or `locale`) |
| `emby` | `url`, `key`, `user` (whose shelves; the first administrator by default) | the same as `jellyfin` |
| `date` | `short` | how a date reads in a card's small print: `short` (Sat, Oct 31), `long` (Saturday, October 31), `numeric` (10/31/2026), `iso` (2026-10-31). Headings (the calendar's day, the wall) are always in words. A year is added only when it isn't this one |
| `locale` | `auto` | a language tag like `en-GB` or `de-DE`: sets month and day names, whether the clock is 12 or 24 hours under `auto`, and how numbers are written (`1.234,5`) on what Valet formats itself. `auto` follows the browser; what the server writes (a card's "next 8:25", "Tonight") follows the first browser to open the page, as the time zone does. Values a service writes out in full stay as they are |
| `temperature` | `auto` | `c`, `f`: converts anything a service reports as `°C` or `°F` on any card, and is the default for the `weather` integration's `units`. `auto` leaves everything as reported |
| `distance` | `auto` | `km`, `mi`: the same for distances |
| `weekStart` | `auto` | `monday`, `sunday`, `saturday`: the first column of the calendar card's month and the year-of-days heatmap. `auto` follows the locale. Integrations read it as `ctx.format`, the page as `firstDay()` |

Whatever the settings, Valet writes things one way: a time range is `8:25–8:50 AM` (an en dash, no spaces, AM/PM once);
a length of time is short in rings, chips and lists (`2h 37m`, `50m`, `3d`, `5m ago`, `41m left`) and long in sentences
(`Powered on 3 years`, `2 hr 37 min`); a number takes no space before `°` or `%` (`42°C`, `14%`) and one before a word
(`58 GB`), and a temperature keeps its letter except in the weather, which writes `5°` like every forecast.

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
| `message` | Type / for commands |
| `messageHint` | Type / for commands |
| `chatTitle` | Talk to your homelab |
| `working` | Working |
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
| `contextAuto` | When it fills up, the oldest messages are summarised to make room. A new chat starts clean and answers faster. |
| `compacted` | Earlier messages summarised to make room |
| `compactedOut` | Earlier messages left out to make room |
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
    columns: { phone: 2, tablet: 4, desktop: 6, wide: 8 }
    widgets:
      - { widget: plex.recent, size: tall, title: New on Plex, icon: film, header: false }
      - { widget: dns.stats, size: small, tint: "#0a7d4f", opacity: 0.8, blur: 12 }
      - { widget: drives.health, size: wide, background: "https://example.com/rack.jpg" }
      - { widget: plex.top, size: tall, view: focus, rows: 3 }
      - { widget: family.agenda, cols: 3, view: week }
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

## `secrets`

Where a `${NAME}` comes from when the environment doesn't have it. Valet looks in this order and takes the first that
has it: the environment, the file `NAME_FILE` points at, `files`, `vault`, `onepassword`. So an install that keeps
everything in `.env` behaves as it always did. A name nothing has stops the config from loading, with an error that
says where Valet looked.

```yaml
secrets:
  files: /run/secrets                # Docker and Kubernetes secrets: a file called NAME, or name
  vault:
    url: https://vault.example.com:8200
    token: ${VAULT_TOKEN}            # from the environment or VAULT_TOKEN_FILE; or tokenFile: /run/secrets/vault_token
  refresh: 1h
## `profiles` and `users`

What each signed-in person may see and do. An account `users` doesn't name is an owner, exactly as without these. Both need sign-in on (`config check` says so with `auth.mode: none`), reload live, and are the owner's to edit by hand: the assistant's setup tools can't change them. [People and profiles](https://askvalet.dev/start/people/) has the whole story.

```yaml
profiles:
  kids:
    tabs: [Media]
    actions: [requests.request]
    assistant: { access: { default: none, requests: write }, instructions: "Only suggest shows rated TV-Y7 or below.", approve: owner }
users: { sam: kids, alex: kids }
```

| Option | Default | |
|---|---|---|
| `files` | none | a folder of files named after the variable: `${SONARR_KEY}` reads `SONARR_KEY`, or else `sonarr_key`. The last newline is trimmed. A file over 64 KB, or a link that leads out of the folder, is refused |
| `vault` | none | HashiCorp Vault, KV version 2: `{ url, token or tokenFile, mount, path, namespace }`. Valet reads one secret, and its keys are the names |
| `vault.mount` | `secret` | where the KV engine is mounted |
| `vault.path` | `valet` | the secret in it, so `secret/valet` by default |
| `vault.namespace` | none | for Vault Enterprise and HCP |
| `onepassword` | none | a 1Password Connect server: `{ url, token or tokenFile, vault, item }`. Valet reads one item, and its field labels are the names |
| `onepassword.vault` | required | the vault's name or ID |
| `onepassword.item` | `Valet` | the item's title or ID |
| `refresh` | none | how often to ask again, `1m` to `7d`, e.g. `1h`. The page is rebuilt only when a value changed. It needs `reload` (on by default). Left out, values are read when Valet starts and when `config.yaml` changes |

A key in Vault or a field label in 1Password is the variable's name, or the same in lower case. 1Password is asked only
for names Vault didn't have, and neither is asked when nothing needs them.

**A provider's own token** comes from the environment or a file and from nowhere else: write `token: ${VAULT_TOKEN}`
(which also reads `VAULT_TOKEN_FILE`) or `tokenFile: /path`. Inside `secrets`, `${NAME}` never reads `files`, Vault or
1Password. A token typed into the file still works, and `config check` reports it as a problem.

**What Valet does with them.** Each provider is a few `GET` requests over `http` or `https`, with a 10 second limit and
an answer of at most 512 KB. No redirect is followed, so the token only goes to the address you wrote. Values are kept
in memory and never written to disk or the log, and they're redacted from everything Valet sends out, `config print`
included, whatever the variable is called. An error names the variable and the provider, never a value or the token.

When a provider can't be reached, a reload fails whole and the last good config keeps running, as with any broken
edit. At startup there is no last good config, so Valet doesn't start. A failed `refresh` is logged and changes nothing.

The assistant can't see this block or change it, and a provider's token can't be used anywhere else in the file by it.
| `users` | `{}` | account name → profile. The name is a local account's, the proxy header's or the OIDC `claim`'s, compared without case. A name whose profile doesn't exist sees nothing |
| `profiles.<name>.tabs` | all | the tabs they see, by name as in `layout`. Only the cards on those tabs reach them, by any route. Valet's own cards (activity, rules, backups, pins) never do |
| `profiles.<name>.actions` | none | page buttons they may press, as `<instance>.<action>`; pressed straight away. Never Valet's own |
| `profiles.<name>.assistant` | `false` | no assistant for them, or: |
| `….assistant.access` | `{ default: none }` | as `assistant.access`, and never more: each integration and tool gets the lower of the two. `default` covers integrations with a card on their tabs; others must be named. Setup tools, rules, reminders, the activity log, timeline, plans, pins, MCP servers, other models and your chat commands are never theirs; `show`, `present`, `search_everything` and the docs are, within what they may read |
| `….assistant.instructions` | — | added to the assistant's instructions for them. Guidance only: what holds is `access` |
| `….assistant.suggestions` | `[]` | questions offered on their empty chat |
| `….assistant.approve` | `owner` | `owner`: what would ask them waits for an owner's yes on the page (with a notification), one exact call, once, logged as "sam, approved by pat". `self`: they get the approval card themselves |

If every local account has a profile, nobody is an owner: Valet says so in its log, `config check` and `user list`, and promotes nobody. Take a name out of `users`, or `user add` an account of your own.

## `assistant`

| Option | Default | |
|---|---|---|
| `provider` | `openai-compatible` | or `anthropic` |
| `baseURL` | `http://localhost:11434/v1` | any OpenAI-compatible server (Ollama, llama.cpp, vLLM, LM Studio, OpenRouter, OpenAI) |
| `apiKey` | none | for hosted providers; use `${NAME}` |
| `model` | required | |
| `name` | `Assistant` | what it's called on the page |
| `instructions` | none | added to the system prompt |
| `access` | `{ default: read }` | per integration (by its id): `none`, `read`, `write` (adds things, like saving a link) or `control` (changes or removes things). Both ask you every time. `config: control` lets it edit this file: see below. `valet` (Valet's own tools) defaults to `control`; `write` keeps reminders and turns rules off. A key with a dot names one tool and wins over its integration's level: `plex.plex_stop_stream: control` under `plex: read`, or `valet.report_issue: none`. `none` takes that tool from the chat, commands, rules and plans; a dotted key that names no tool is a config problem |
| `maxSteps` | `6` | tool calls per answer, 1–20 |
| `reasoning` | `auto` | how much the model thinks before answering in the chat: `auto`, `off`, `low`, `medium` or `high`. `off` sends an OpenAI-compatible server `chat_template_kwargs: { enable_thinking: false }` (Qwen-style templates; ignored by servers that don't know it), `low`, `medium` and `high` send `reasoning_effort`; Anthropic maps them to its thinking budget. The chat's Reasoning menu overrides it for one chat. Background calls keep the model's default |
| `options` | none | sampling passed to the model: `temperature` (0–2), `topP` (above 0, up to 1), `maxOutputTokens` (64–200,000) |
| `tools` | `all` | which tools each request carries. `all`: every tool it may use. `lazy`: only Valet's own, plus one line per integration made from its tool names; it loads an integration's tools (the `tools` tool) when a question needs them, and keeps the ones a chat already used. Far smaller prompts on a big setup, for one more step on most questions. `auto`: `lazy` once all the tools come to about 6k tokens. Approvals don't change |
| `contextWindow` | known Claude models | how many tokens the model can hold, for the meter under the chat's message box. Claude models fill it in (a million from Opus and Sonnet 4.6 and Haiku 5 on, 200k before); for anything else Valet reads it from the server's `/models` list (`max_model_len`, `context_length` and the like) when the server says, and otherwise set it from your server's context length (Ollama's `num_ctx`, say), or the meter shows only what's used |
| `compact` | `true` | keep long chats inside the model's window. When the window is known, what's sent stays under about 70% of it, and the oldest turns become a short summary (one call with no tools, cached); the page keeps the whole chat. If the summary fails or the window isn't known, the last 24 messages go. `false` always sends the last 24 |
| `agent` | none | hand the chat to another agent: `{ name, baseURL, apiKey, model }`, anything OpenAI-compatible (Hermes Agent's API server, say). Remove it to go back. It runs its own tools, so access levels and approvals don't apply; it gets only the conversation, answers are plain text, and a read-only page stays on Valet's assistant. The brief and shared causes stay on `model` |
| `models` | none | more models to switch to under the chat's message box, for that chat: each `{ name, model, provider, baseURL, apiKey, contextWindow, reasoning, options }`, with only `model` required. What an entry leaves out comes from the settings above, except that `baseURL` goes only to the same provider, `apiKey` only to the same server, and `contextWindow` is the model's own. `name` is what the menu shows (default: the model id) and must be unique. The main `model` stays the default, and background calls always use it. `auto` as an item (or `models: auto` alone) also offers every model the main server lists at `GET /models`, asked by Valet with the main settings and kept five minutes; `{ auto: true, name, provider, baseURL, apiKey, reasoning, options }` does the same for another server (filled in by the same rules; Anthropic's `GET /v1/models` with `provider: anthropic`), its models run on that server with its key, and one whose id another choice already has is offered as `<name or host>/<id>`. Models that clearly aren't chat models (embeddings, speech, image, moderation, rerankers) are left out. Past eight choices the menu is searchable, with a heading per server. Without `models` there's no menu |
| `telegram` | none | the same chat in Telegram: `{ token, users }`, a bot's token from @BotFather (in `.env`) and the numeric Telegram user ids that may talk to it, in a private chat only. Same access and approvals as the page; approvals are two buttons. Valet polls Telegram, so nothing needs to reach it from outside. Anyone not listed gets no answer; the log names the id it ignored, which is how you find yours |
| `webSearch` | none | web search for the assistant, off unless set: see [below](#assistantwebsearch) |
| `telegram` | none | the same chat in Telegram: `{ token, users }`, a bot's token from @BotFather (in `.env`) and the numeric Telegram user ids that may talk to it, in a private chat only. Same access and approvals as the page; approvals are two buttons. Valet polls Telegram, so nothing needs to reach it from outside. Anyone not listed gets no answer; the log names the id it ignored, which is how you find yours. An id may be `{ id, as: <account> }`: that person is that account here too, [profile](#profiles-and-users) and all; a plain id is an owner |
| `suggestions` | four examples | questions offered until the model has written its own, or if `background.suggest` is off |
| `background` | `{ watch: true, brief: true, suggest: true, perDay: 100 }` | what it does unasked. `watch`: when two or more things break, say what they share, if the data shows it. `brief`: a short summary, shown when you hover the status sentence and rewritten every half hour while the page is in use. `suggest`: write the suggested questions from what's on the page, every half hour or when something changes (`suggestions` is the fallback). `perDay` caps the model calls all three make in a day. None of them get tools |

What `assistant` sets is what it knows and may do. How it looks on the page is `chat`, below, apart from its name.

### `assistant.webSearch`

Lets the assistant look things up on the web when the homelab's own tools can't answer. Off unless set. It adds two tools
that only look: `web_search` (titles, addresses, snippets) and `web_read` (the text of one page a search returned). This
is not the top-level `search`, which is a link ⌘K opens in your browser.

```yaml
assistant:
  webSearch: { provider: searxng, url: "http://searxng:8080" }      # your own; needs `search: { formats: [html, json] }` in its settings.yml
  # webSearch: { provider: brave, apiKey: "${BRAVE_SEARCH_KEY}" }
  # webSearch: { provider: tavily, apiKey: "${TAVILY_KEY}" }
```

| Option | Default | |
|---|---|---|
| `provider` | required | `searxng`, `brave` or `tavily` |
| `url` | none | SearXNG: where yours is. Its JSON format must be on |
| `apiKey` | none | Brave and Tavily: the key; use `${NAME}` |
| `results` | `5` | results per search, 1–10 |
| `safe` | `moderate` | `off`, `moderate` or `strict` (SearXNG and Brave) |
| `language` | none | two letters, like `en` (SearXNG and Brave) |
| `region` | none | a two-letter country, like `CA` (Brave; SearXNG with `language`) |
| `read` | `true` | `false` leaves out `web_read` |
| `perDay` | `100` | searches sent to the provider in a day; the same search within an hour isn't sent again |

What's searched for leaves your network for the provider (with SearXNG, for the engines it asks). The model is told to
search only for what the homelab can't answer and to keep anything private out of a query. Results and pages are text
written by strangers: nothing in them can change anything without your approval. `web_read` opens only an address a
search returned, only on the public internet, with no cookies or keys; it can't reach your own network. Turn either tool
off with `access: { valet.web_search: none }` or `valet.web_read: none`. Neither is offered to an MCP client, and both
are off in a sandbox.

**Setting up by talking.** With `access: { config: control }` you can change the page from chat: "move Plex above the
weather", "make the cards more compact", "add a card for http://box/status". It reads this file and what a section or
integration accepts, checks the change without saving or contacting anything (a diff and any problems; a real card only if you allow the fetch), and saves only when
you approve; hot reload does the rest, and it can undo the last save. It changes only the lines it must. It can't touch
`auth`, `allowedHosts`, `mcp`, `mcpServer`, `plugins`, `notify`, `sandbox` or `reload`, and of `assistant` only its `name` and
`suggestions`, never its access, model or instructions; it can't
point `appearance` at a file on disk or write its `css`, it refuses to write a secret (it asks you to put `${NAME}` in `.env`), it never sees or changes `secrets`,
and a secret only ever goes to hosts it already goes to.
Mount the config folder read-only and it hands you the diff to paste instead.

**It knows Valet.** Whatever its access, the assistant searches these docs to answer questions about Valet, and
`report_issue` writes up a bug, an idea or a missing integration as a filled-in GitHub issue for you to read and submit.
It sends nothing itself.

**Commands, with no model.** ⌘K runs plain commands that integrations declare ("pause downloads", "lights off",
"pause ads 10 min") without asking the model. They follow `access` like the chat: a command that uses a `control` tool
needs `control` for that integration and still shows the approval card. With no `assistant` block, commands run page
actions and tools that only look. See [integrations.md](integrations.md#the-parts) for writing them.

**Search, with no model.** As you type in ⌘K, Valet also asks every service that can be searched (documents, saved
links, the library, photos, games, recipes, feeds, the calendar, the house), all at once, and lists what each found in
its own group as it answers. A row with an address opens it; one without shows the service's card in place. It uses the
tools the assistant would (`find` on a tool that only looks), so `access: none` for an integration or for one tool takes
it out of the search too, and with no `assistant` block every searchable service is included. Nothing is asked until
the typing rests, two letters at least, and an answer is kept for half a minute. `find: false` turns it off.

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

## `voice`

Talk to the chat and hear it answer, through the OpenAI audio API: OpenAI itself, or a speech server on your own network
([Speaches](https://github.com/speaches-ai/speaches), LocalAI, anything with `/audio/transcriptions` and `/audio/speech`).
Off unless set; either half works alone. It needs an `assistant`.

```yaml
voice:
  stt: { baseURL: http://speaches:8000/v1, model: Systran/faster-distil-whisper-small.en, language: en }   # the mic
  tts: { model: speaches-ai/Kokoro-82M-v1.0-ONNX, voice: af_heart }                                    # answers read aloud
  speakReplies: false
```

| Option | Default | |
|---|---|---|
| `stt` | off | speech to text, `POST {baseURL}/audio/transcriptions`: a mic in the chat's message box. `baseURL`, `apiKey` (use `${NAME}`), `model` (`whisper-1`), `language` (a code like `en`; default: the server works it out) |
| `tts` | off | text to speech, `POST {baseURL}/audio/speech`, MP3: a speaker under each answer. `baseURL`, `apiKey`, `model` (`tts-1`), `voice` (`alloy`), `speed` (0.25–4, `1`) |
| `speakReplies` | `false` | read each finished answer aloud without a press (every answer has its own speaker either way) |
| `autoSend` | `false` | send what was heard straight away. Off, the words go in the box for you to check and send |

A half without `baseURL` uses the other half's, then the assistant's (an OpenAI-compatible one); `apiKey` only ever goes to
the address it was written for. Valet calls the speech server itself, so the address and key never reach the browser.
A recording is at most two minutes (10 MB), a reading at most 2,000 characters (the page sends the start of an answer, up
to 1,500, without markdown, tables or code), and each person gets 20 recordings and 30 readings a minute. Nothing is
stored: audio passes through memory, and the log gets sizes and timings only. Voice changes no permissions: a spoken
question is a typed one, with the same access and approvals, and an approval still takes a click. The demo (`sandbox`)
has no voice.

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
| `commands` | none | your own `/commands`: a name and the prompt it sends. See below |

### `chat.commands`

Your own commands for the chat. Each appears in the `/` menu, in ⌘K and in `/help`, and sends its prompt through the chat as
if you'd typed it: the same access, the same approvals. The chat shows what you typed; the model reads the prompt.

```yaml
chat:
  commands:
    morning-brief:
      description: Last night, today's calendar and Hacker News
      prompt: >-
        Give me my morning brief: what happened overnight (anything that went down, downloads that finished,
        new episodes), what's on my calendar today, and the Hacker News stories worth reading. Keep it short,
        problems first.
    watch: { prompt: "Add {input} to my watchlist and tell me when it's out", reasoning: low }
    lab: { prompt: "Full health check of the lab, worst problems first", model: Deep, reasoning: high }
    blocks: { prompt: "Who's blocking the most today?", tools: [dns] }
```

| Field | | |
|---|---|---|
| `prompt` | required | what it sends. A plain string is the prompt. `{input}` is what's typed after the command (`/watch Dune`); without `{input}`, anything typed after goes on the end |
| `description` | the prompt | beside it in the menu and `/help`, up to 80 characters |
| `model` | the chat's | a choice from `assistant.models`, by name, for that question only |
| `reasoning` | the chat's | `off`, `low`, `medium`, `high` or `auto`, for that question only |
| `tools` | none | integration ids whose tools it uses from the first step, as an `@mention` does. They must be ones `assistant.access` lets it use: a command never grants more |

Names are lowercase letters, digits and dashes, and can't be a built-in's (`model`, `reasoning`, `new`, `clear`, `compact`,
`help`). `config check` also names a `model` that isn't a choice, an integration in `tools` that isn't there or that the
assistant may not use, and commands without an `assistant` block. The assistant can add one for you
("make me a /morning-brief command that…"): it's a config edit like any other, shown first and saved only once you approve.

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

Valet as an MCP server, so an AI client you already use (Claude Desktop, an editor) can look at your homelab through the
same tools Valet's assistant has. Off unless set. It answers at `/mcp` (Streamable HTTP) to its own bearer token. Left at
`read` it offers only tools that look. With `write` or `control` for an integration it also offers that integration's
tools that add or change things, and each call waits for a signed-in person to approve it on the page (the card says it
in the tool's own words, and a notification goes out): one exact call, once. The client waits about 45 seconds, then is
told to ask again; an answer keeps for ten minutes; five can wait at a time. Never Valet's config, rules or pins, and
never anything past looking on a read-only page. Results go through the same redactor as the chat's, and every call is in
the activity log.

| Option | Default | |
|---|---|---|
| `token` | required | at least 32 characters; keep it in `.env`, e.g. `token: ${VALET_MCP_TOKEN}` |
| `access` | `{ default: read }` | per integration: `none`, `read`, `write` or `control`. `{ default: none, plex: read }` opens only Plex; `{ default: read, downloads: control }` also lets it ask to change downloads, with your approval each time |

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
| `columns` | auto | cards per row, 1 to 4, from tablet width up (in a sidebar: the list's columns); or per screen, up to 8: `{ phone: 1, tablet: 2, desktop: 3, wide: 4 }`. `wide` is a page wider than 1760px, and falls back to `desktop` |
| `gap` | `appearance.gap` | px between its cards |
| `place` | `main` | `left` or `right` makes it a sidebar |
| `variant` | `full` | `minimal`: tighter rows, just the essentials |
| `header` | `true` | `false`: its cards drop their title bar, on the overview and its tab (a screen reader still hears it) |
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
| `cols` | the size's own | how many of the section's columns it spans, 1 to 8, never more than there are: a calendar across two of three, say. It needs a grid: a section with sizes or with `columns` per screen |
| `title`, `icon` | the card's | its name and icon; on a tile, its label and icon |
| `header` | the section's | `false` drops its title bar, `true` keeps it in a section that drops them |
| `tint` | `colors.card` | a colour for its surface |
| `opacity` | `glass.opacity` | how much of the tint shows, 0–1; `0.45` over a `background` |
| `blur` | `glass.blur` | px behind it |
| `background` | none | an image behind it, under the tint: an `https://` URL or a Valet path. A file at `data/icons/rack.png` is `/api/icon/rack` |

`view` picks how a widget is drawn, separately from its data:

```yaml
widgets:
  - { widget: plex.top, view: focus }
  - { widget: plex.plays, view: bars }
```

| Views | Work on |
|---|---|
| Charts: `line`, `bars`, `stream`, `race`, `heatmap`, `ranked`, `pie` | anything with numbers: a chart, race, heatmap or ranked card, or a stats card with a pie |
| Galleries: `row`, `spotlight`, `focus`, `coverflow`, `masonry`, `cards`, `desk`, `windows`, `tickets`, `mosaic`, `flashback`, `album` | anything with pictures: a shelf, photos, ranked, race or media card, or a reading pile (an article card) |
| Calendar: `week`, `agenda` | a calendar card. On its own it picks by its size: the month beside the day when it's wide, a week of days side by side when it's narrower and tall enough, the day's list when it's small. `week` always shows the week; `agenda` never does |

| Gallery | What it looks like | Used by default for |
|---|---|---|
| `row` | a plain row of artwork | most shelves |
| `focus` | the artwork large, one at a time, the ones either side peeking in smaller and dimmer | recently added (Plex through Tautulli, Jellyfin, Emby), continue reading and listening, new music, games |
| `coverflow` | Cover Flow: the one in the middle faces you, the rest turn away either side in 3D, each with a reflection | nothing; pick it for a shelf of covers |
| `masonry` | a wall of pictures three rows high, some larger, that scrolls sideways. Photos keep their own shapes and captions | Immich's On this day, an album |
| `cards` | a stack of cards: the one in front square on, the next ones fanned out behind | Paperless documents, Karakeep's saved links |
| `spotlight`, `desk`, `windows`, `tickets` | one large with a row beside it; documents on a desk; saved pages as small browser windows; what's coming as tickets | |
| `mosaic`, `flashback`, `album` | photos as a mosaic, a slow crossfade, or an album: a carousel of large photos, the one you're on captioned | |

`focus`, `coverflow` and `cards` move one at a time: swipe them, drag them with a mouse, use their Previous and Next
buttons or the arrow keys, or click one at the side to bring it to the middle. `masonry` and `row` scroll a screenful at a
time. All of them are the browser's own scrolling, and the 3D follows it on the graphics card, with nothing redrawn as
they move. Asked for reduced motion (by the system or `appearance.motion`), each is a plain row. In `cards`, a Karakeep
link has its Archive button and every card opens its page.

A view a widget's card can't take is a problem in `config check`, which names the views it can take.

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
        - columns: { phone: 1, tablet: 2, desktop: 4 }
          widgets:
            - { widget: frigate.cameras, cols: 2, rows: 2 }
            - { widget: ha.thermostat, rows: 2 }
            - ha.people
            - ha.doors
```

| Option | Default | |
|---|---|---|
| `pages` | the default page | pages that take turns; each has `layout` (sections, as in [`layout`](#layout), with `columns` per screen and a card's `cols` and `rows`), and optionally `title`, `every` and `clock: false` to drop the time and weather |
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
| `homeassistant` | `url`, `token`, `cards` (each `{ title, icon, entities }`; an entity is its id, or `{ id, name, icon }`), `schedules`, `floorplans`, `thermostats` (`{ entity, title, modes, unit }`), `controllable` (extra entities the assistant may control). A card's rows get a small icon from the entity (a lock, a garage door, a person, energy, money, temperature), and a lock that's locked, a garage door that's closed and someone at home read green, unlocked or open amber | one per entry in `cards`, `schedules`, `floorplans`, `thermostats` |
| `http` | `targets` (`name`, `url`, `href`, `icon`, `group`, `quiet`, `expect`), `interval` (30000 ms) | `status` |
| `iframe` | `url`, `title`, `height` (360), `scripts` (`true`) | `page` |
| `immich` | `url`, `apiKey` | `memories` |
| `jellyfin` | `url`, `key` (an API key), `user` (whose continue watching and recently added; the first administrator by default) | `status`, `streams` (now playing), `resume` (continue watching), `recent`, `library` |
| `indexers` | `prowlarr`, `bazarr` (each `{ url, apiKey }`) | `health` |
| `changedetection` | `url`, `key`, `limit` (8) | `watches`, `status` |
| `karakeep` | `url`, `apiKey` | `recent`, `digest`, `reading` |
| `kavita` | `url`, `username` and `password`, or `key` (an auth key) | `reading` (what you're in the middle of), `recent`, `status` |
| `komga` | `url`, `username` and `password`, or `key` (an API key, Komga 1.20+) | `reading` (in progress, with how far along), `ondeck` (next in a series you've started), `recent`, `status` |
| `mealie` | `url`, `key`, `version` (`2`; `1` before households) | `week` (the meal plan from today, its photos landscape), `today` (a recipe of the day), `recent`, `status` |
| `miniflux` | `url`, `key` | `unread` (a pile to step through; archiving marks read), `feeds` (unread per feed), `starred`, `status` |
| `lobsters` | `tags`, `sort` (`hottest`, `newest`), `limit` (8) | `stories` |
| `minecraft` | `host`, `port` (25565), `title` | `status` |
| `navidrome` | `url`, `username`, `password` | `status`, `playing`, `recent` (recently played), `added` (new music), `top` (most played: up to 10 albums with square covers, as a list or any gallery `view`), `rediscover` |
| `ollama` | `url` | `models` |
| `paperless` | `url`, `token` | `recent` |
| `pihole` | `url`, `password` (an app password) | `stats` (the last 24 hours as columns, the blocked share in red; as a tile, the ads blocked with the share as a pie) |
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
| `rss` | `feeds` (URLs, or `{ url, name }`; YouTube channels via `youtube.com/feeds/videos.xml?channel_id=…`), `limit` (12), `style` (`list` or `shelf` for thumbnails), `title`, `every` (900 s) | `latest` (a list is one column of headlines: each story's mark, its title, then the source and how long ago) |
| `hackernews` | `sort` (`top`, `new`, `best`), `limit` (10), `comments` (rows open the discussion) | `stories` (one column of headlines; made two rows tall, it fills with as many as fit) |
| `reddit` | `subreddits`, `sort` (`hot`), `limit` (10), `style` (`list` or `shelf`) | `posts` |
| `releases` | `repos` (`owner/name`), `token` (optional, raises GitHub's rate limit), `limit`, `prereleases` | `latest` |
| `markets` | `symbols` (`AAPL`, `BTC-USD`, `^GSPC`, `EURUSD=X`, or `{ symbol, name }`), `range` (`1d`), `title` | `quotes` |
| `docker` | `url` (a read-only socket proxy, never the raw socket), `hide` (names to leave out, e.g. containers that are meant to stay stopped), `sources` (container → GitHub `owner/repo` for release notes, when its image doesn't say), `github` (a token, past 60 requests an hour) | `containers`, `updates` |
| `host` | `url` (the Valet agent), `token`, `title`, `quiet` (services often off on purpose) | `services` |
| `api` | `url`, `headers`, `method`, `body`, `every` (60s), `title`, `icon`, `href`, `about`, and one of `stats`, `list`, `rows`, `status` (see below) | `data` |
| `calendar` | `calendars` (iCal URLs, or `{ url, name, color }`), `days` (14), `limit` (10), `title`, `months` (6, how far ahead the month browses), `meetings` (see below) | `upcoming`, `agenda` (place it `wide` or `large` for the month beside it; narrower and tall enough, it's a week you scroll sideways: `view: week` or `view: agenda` holds it to one) |
| `links` | (from the top-level `links:` block) | one per group |

### Online meetings: `calendar.meetings`

A calendar finds the meeting link in each event (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo, Around,
Discord, FaceTime, Chime, BlueJeans, and Preply lessons), from Google's conference property, the event's URL, its location or its description.
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
