# Configuration reference

Everything lives in one YAML file (`config.yaml`, or the path in `ATRIUM_CONFIG`). [`config.example.yaml`](../config.example.yaml)
is a working starting point; this page lists every option. Anything you leave out takes the default shown.

`${NAME}` anywhere in the file is replaced from the environment, or from the file `NAME_FILE` points at (the Docker
secrets convention). `${secret:name}` reads `/run/secrets/name` and `${file:/path}` any file; `\${…}` is left alone.
Atrium redacts every replaced value from anything it sends out.

Edits to the file apply live (`reload: true`): a broken edit is reported and the last good config keeps running, and
open pages pick up the new layout. Sign-in settings and plugins are read once, so those need a restart. A misspelt
top-level option is an error with its path; `node dist/server.js config check` lists every problem (unknown types,
options and widget keys) without starting the server, and `config schema` prints a JSON schema editors and agents can
work from (`# yaml-language-server: $schema=atrium.schema.json`).

## Environment and commands

| Variable | Default | |
|---|---|---|
| `ATRIUM_CONFIG` | `config.yaml` (`/config/config.yaml` in Docker) | the config file |
| `ATRIUM_DATA` | `data` (`/app/data` in Docker) | wallpaper, icon cache, uploads, history, accounts, plugins |
| `PORT` / `HOST` | `7575` / `0.0.0.0` | where it listens |

```sh
node dist/server.js config check                            # every problem in config.yaml, or ✓
node dist/server.js config print                            # the effective config, defaults filled in, secrets redacted
node dist/server.js config schema > atrium.schema.json      # JSON schema of the whole file, every integration included
node dist/server.js user add|passwd|remove|signout <name>   # local accounts (asks for the password)
node dist/server.js new-integration <name>                  # scaffold a plugin in data/integrations/
```

In Docker, prefix these with `docker exec -it atrium`.

## Top level

| Option | Default | |
|---|---|---|
| `title` | `Home` | the page title |
| `greeting` | none | the name in "Good evening, Sam" |
| `location` | none | gives the assistant local context |
| `timezone` | `TZ`, else the first browser's | an IANA name like `America/Toronto`. Times the server writes (assistant answers, watch history) use it; containers default to UTC |
| `appearance` | `{ dim: 0.35, blur: 0 }` | `wallpaper` (a file in the data folder or an image URL), `dim` 0–0.9, `blur` 0–40 px |
| `allowedHosts` | `[]` | names Atrium answers to besides localhost and IP addresses, e.g. `[atrium.example.com, "*.home.example.com"]`. Others get 421 (DNS-rebinding protection) |
| `history` | `{ hours: 24, every: 5, background: true }` | remember headline numbers so tiles can draw a graph. `every` is minutes between samples; `background` keeps sampling while nobody has the page open; `false` turns it off |
| `plugins` | `[]` | npm packages of community integrations, or `{ packages, replace }` where `replace` lets a plugin take over a built-in type. Files in `data/integrations/` load on their own |
| `menubar` | `[]` | widget keys whose headline numbers sit as small rings in the top bar |
| `weather` | none | a widget key (e.g. `weather.now`) shown as a ring beside the clock |
| `nav` | `{ side: left }` | where the tab buttons sit on wide screens: `left`, `right`, `top`, `bottom` (phones: bottom) |
| `search` | none | web search from ⌘K: `duckduckgo`, `google`, `kagi`, `brave`, `startpage`, `searxng`, or a URL with `{q}` |
| `links` | `{}` | bookmarks by group, each group a widget `links.<group-slug>`: `Media: [{ name, url, icon?, note? }]`. Without `icon`, the site's favicon (fetched by Atrium) |
| `reload` | `true` | watch the file and apply edits live |
| `welcome` | `false` | the getting-started card; a fresh starter config turns it on |

## `auth`

| Option | Default | |
|---|---|---|
| `mode` | `none` | `none`, `local` (built-in accounts), `proxy` (trust a sign-in proxy's user header) or `oidc` (OpenID Connect) |
| `oidc` | — | for `mode: oidc`: `issuer`, `clientId`, `clientSecret`, `name` (on the button), `claim` (`preferred_username`), `scope`, `allow` (names or emails; empty: anyone the provider admits), `redirectUrl`. Register `https://<atrium>/api/auth/oidc/callback` at the provider |
| `trustNetwork` | `false` | with `mode: none`, Atrium is read-only unless this is true (only your VPN/tailnet or a sign-in proxy reaches it) |
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
| `access` | `{ default: read }` | per integration (by its id): `none`, `read`, `write` (adds things, like saving a link) or `control` (changes or removes things; asks you every time). `config: control` lets it edit this file: see below |
| `maxSteps` | `6` | tool calls per answer, 1–20 |
| `agent` | none | hand the chat to another agent: `{ name, baseURL, apiKey, model }`, anything OpenAI-compatible (Hermes Agent's API server, say). Remove it to go back. It runs its own tools, so access levels and approvals don't apply; it gets only the conversation, answers are plain text, and a read-only page stays on Atrium's assistant. "Why?", the brief and shared causes stay on `model` |
| `suggestions` | four examples | questions offered until the model has written its own, or if `background.suggest` is off |
| `background` | `{ watch: true, brief: true, suggest: true, perDay: 24 }` | what it does unasked. `watch`: when two or more things break, say what they share, if the data shows it. `brief`: one line each morning. `suggest`: write the suggested questions from what's on the page (when it changes, at most every five minutes; `suggestions` is the fallback). `perDay` caps the first two. None of them get tools |

**Setting up by talking.** With `access: { config: control }` you can say "add a card for http://box/status". It reads
this file and the integration's options, tries the change without saving (a diff, problems, and the real card in chat),
and saves only when you approve; hot reload does the rest. It changes only the lines it must. It can't touch `auth`,
`assistant`, `mcp`, `plugins` or `allowedHosts`, and it refuses to write a secret: it asks you to put `${NAME}` in `.env`.
Mount the config folder read-only and it hands you the diff to paste instead.

**On the page, not in chat:** "Why?" on anything in trouble, a line under the greeting, ⌘K answers and approvals in
place, and pin on a chat card to keep it on the page. A pin re-runs the same tool, so no model is involved after that;
pins live in `data/pins.json`.

## `mcp`

Each entry is an MCP server whose tools the assistant may use, under the same rules.

| Option | Default | |
|---|---|---|
| `url` | required | |
| `transport` | `http` | or `sse` |
| `headers` | none | e.g. `{ Authorization: "Bearer ${TOKEN}" }` |
| `access` | `read` | `read` offers only tools the server marks read-only; `control` offers all, and anything not read-only asks first |
| `readOnly` | `[]` | tool names to treat as read-only even if the server doesn't mark them |
| `name` | the key | |

## `island`

The black notch at the top that shows what's happening.

| Option | Default | |
|---|---|---|
| `activities` | `[]` | widget keys, most important first |
| `idle` | `hide` | `notch` keeps a small empty notch when nothing is live |
| `notify` | `[]` | short notices: `{ widget, on: start\|end\|down\|up, text }`; `{title}` and `{name}` fill in |

## `layout`

A list of sections; each is a tab in the rail.

| Option | Default | |
|---|---|---|
| `title` | none | |
| `widgets` | required | `instance.widget`, or `{ widget, size: small\|medium\|large, every: 30s }` (`every` overrides how often it refreshes: seconds, or `30s`, `5m`, `1h`) |
| `display` | `cards` | `cards`, `tiles`, `rings` or `media` |
| `columns` | auto | cards per row (in a sidebar: the list's columns) |
| `place` | `main` | `left` or `right` makes it a sidebar |
| `variant` | `full` | `minimal`: tighter rows, just the essentials |
| `header` | `true` | `false`: its cards drop their title bar |
| `heading` | `true` | `false`: no title above it (it still names its tab) |
| `overview` | `true` | `false`: only on its own tab |
| `tab` | its title | share a tab with other sections |
| `chat` | `false` | its tab also holds the assistant, full page |

## Integrations

Each entry under `integrations:` has an id (what you use in widget keys and `assistant.access`) and a `type`. Most take
`url` (where Atrium reaches the service) and `href` (where its cards link to, if different).

| Type | Options | Widgets |
|---|---|---|
| `aimonitor` | `url` | `usage`, `gpu` |
| `arr` | `sonarr`, `radarr` (each `{ url, apiKey }`), `days` (14) | `upcoming` |
| `glances` | `url`, `disks` (mounts, or `{ mount, name, sub }`), `network` (interface), `cpuSensor` (`CPU`) | `tiles`, `overview`, `disks` |
| `homeassistant` | `url`, `token`, `cards`, `schedules`, `floorplans`, `controllable` (extra entities the assistant may control) | one per entry in `cards`, `schedules`, `floorplans` |
| `http` | `targets` (`name`, `url`, `href`, `icon`, `group`, `quiet`, `expect`), `interval` (30000 ms) | `status` |
| `immich` | `url`, `apiKey` | `memories` |
| `indexers` | `prowlarr`, `bazarr` (each `{ url, apiKey }`) | `health` |
| `karakeep` | `url`, `apiKey` | `recent` |
| `ollama` | `url` | `models` |
| `paperless` | `url`, `token` | `recent` |
| `pihole` | `url`, `password` (an app password) | `stats` |
| `qbittorrent` | `url`, `username`, `password`, `arr` (Sonarr/Radarr `{ type, url, apiKey }` for titles and posters) | `active` |
| `quran` | `url` | `today` |
| `rgb-control` | `url`, `build`, `view` (`turn`, `tilt`, `draggable`), `presets`, `controls`, `interval` | `pc` |
| `romm` | `url`, `username`, `password` | `recent` |
| `scrutiny` | `url`, `hotC` (55) | `drives` |
| `seerr` | `url`, `apiKey` | `requests` |
| `tautulli` | `url`, `apiKey` | `streams`, `recent` |
| `uptimekuma` | `url`, `username` (empty with an API key), `password` (or the key), `certWarnDays` (14) | `monitors` |
| `weather` | `latitude`, `longitude`, `units` (`metric`), `interval` (600000 ms) | `now` |
| `rss` | `feeds` (URLs, or `{ url, name }`; YouTube channels via `youtube.com/feeds/videos.xml?channel_id=…`), `limit` (12), `style` (`list` or `shelf` for thumbnails), `title`, `every` (900 s) | `latest` |
| `hackernews` | `sort` (`top`, `new`, `best`), `limit` (10), `comments` (rows open the discussion) | `stories` |
| `reddit` | `subreddits`, `sort` (`hot`), `limit` (10), `style` (`list` or `shelf`) | `posts` |
| `releases` | `repos` (`owner/name`), `token` (optional, raises GitHub's rate limit), `limit`, `prereleases` | `latest` |
| `markets` | `symbols` (`AAPL`, `BTC-USD`, `^GSPC`, `EURUSD=X`, or `{ symbol, name }`), `range` (`1d`), `title` | `quotes` |
| `api` | `url`, `headers`, `method`, `body`, `every` (60s), `title`, `icon`, `href`, `about`, and one of `stats`, `list`, `rows`, `status` (see below) | `data` |
| `calendar` | `calendars` (iCal URLs, or `{ url, name }`), `days` (14), `limit` (10), `title` | `upcoming` |
| `links` | (from the top-level `links:` block) | one per group |

### Any JSON API: `type: api`

For a service Atrium doesn't know, name a URL and say where the numbers are. No code, and the assistant can read it too
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
options (Home Assistant's `cards`, `schedules` and `floorplans`; the PC `build`). `/#gallery` shows every card type.
