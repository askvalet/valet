# Configuration reference

Everything lives in one YAML file (`config.yaml`, or the path in `ATRIUM_CONFIG`). [`config.example.yaml`](../config.example.yaml)
is a working starting point; this page lists every option. Anything you leave out takes the default shown.

`${NAME}` anywhere in the file is replaced from the environment, and Atrium redacts each replaced value from anything
it sends out. A misspelt top-level option stops startup with the path; an option an integration doesn't know is logged
and ignored.

## Environment and commands

| Variable | Default | |
|---|---|---|
| `ATRIUM_CONFIG` | `config.yaml` (`/config/config.yaml` in Docker) | the config file |
| `ATRIUM_DATA` | `data` (`/app/data` in Docker) | wallpaper, icon cache, uploads, history, accounts, plugins |
| `PORT` / `HOST` | `7575` / `0.0.0.0` | where it listens |

```sh
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
| `appearance` | `{ dim: 0.35, blur: 0 }` | `wallpaper` (a file in the data folder or an image URL), `dim` 0–0.9, `blur` 0–40 px |
| `allowedHosts` | `[]` | names Atrium answers to besides localhost and IP addresses, e.g. `[atrium.example.com, "*.home.example.com"]`. Others get 421 (DNS-rebinding protection) |
| `history` | `{ hours: 24, every: 5, background: true }` | remember headline numbers so tiles can draw a graph. `every` is minutes between samples; `background` keeps sampling while nobody has the page open; `false` turns it off |
| `plugins` | `[]` | npm packages of community integrations, or `{ packages, replace }` where `replace` lets a plugin take over a built-in type. Files in `data/integrations/` load on their own |
| `menubar` | `[]` | widget keys whose headline numbers sit as small rings in the top bar |
| `weather` | none | a widget key (e.g. `weather.now`) shown as a ring beside the clock |
| `nav` | `{ side: left }` | where the tab buttons sit on wide screens: `left`, `right`, `top`, `bottom` (phones: bottom) |

## `auth`

| Option | Default | |
|---|---|---|
| `mode` | `none` | `none`, `local` (built-in accounts) or `proxy` (trust a sign-in proxy's user header) |
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
| `access` | `{ default: read }` | per integration (by its id): `none`, `read`, `write` (adds things, like saving a link) or `control` (changes or removes things; asks you every time) |
| `maxSteps` | `6` | tool calls per answer, 1–20 |
| `suggestions` | four examples | questions offered on an empty chat and in ⌘K |

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
| `widgets` | required | `instance.widget`, or `{ widget, size: small\|medium\|large }` |
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

The comments in each integration's schema (`src/integrations/<type>.ts`, the `config:` block) explain the nested
options (Home Assistant's `cards`, `schedules` and `floorplans`; the PC `build`). `/#gallery` shows every card type.
