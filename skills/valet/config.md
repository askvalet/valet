# Valet: config.yaml

Valet is a homelab homepage. Everything personal lives in one YAML file. Edit that file, check it, and say what needs a restart.

## Where things are

| | Docker (the usual) | From source |
|---|---|---|
| Config | `./config/config.yaml` on the host, `/config/config.yaml` in the container | `config.yaml` in the repo |
| Secrets | `.env` beside `docker-compose.yml` (`env_file: .env`) | `.env` in the repo |
| Data (plugins, backgrounds, wallpapers, accounts) | `./data` on the host, `/app/data` in the container | `data/` |
| CLI | `docker exec valet node dist/server.js <command>` | `node dist/server.js <command>` after `npm run build` |

The container is usually called `valet`. Check with `docker ps` if a command can't find it.

## How to work

1. Read the whole config first. Run `config check` before you change anything, so you know which problems were already there.
2. Make the smallest edit that does the job. Keep the user's comments and order.
3. Run `config check` again and fix every `✗` line.
4. After adding or changing a service, run `doctor`. It tries each widget once and says what's wrong.
5. Tell the user what you changed, and whether anything needs a restart (see [Live or restart](#live-or-restart)).

```sh
docker exec valet node dist/server.js config check   # every problem, or a tick
docker exec valet node dist/server.js config print   # what Valet made of it, secrets redacted
docker exec valet node dist/server.js doctor         # tries every widget, the model, notifications
```

`config check` exits 1 on any problem. `doctor` takes `--json`, `--send-test` (one test message per notification channel) and `--timeout <seconds>`. It never presses a button or runs a tool.

For editor autocomplete, `config schema` prints a JSON schema of the whole file, every integration included.

## The shape of the file

```yaml
title: Home
greeting: Sam                          # "Sam's homelab"

integrations:                          # what you run: a name you choose → a type and its options
  dns:
    type: pihole
    url: http://pihole                 # as the Valet container reaches it
    password: ${PIHOLE_PASSWORD}       # from .env, never typed here

links:                                 # bookmarks; each group is a widget: links.<group>
  Media:
    - { name: Plex, url: https://plex.example.com }

layout:                                # the page, top to bottom: a list of sections
  - title: Network                     # a title makes it a tab too
    widgets:
      - dns.stats                      # <instance>.<widget>
      - { widget: links.media, size: small }

menubar: [dns.stats]                   # headline rings in the top bar

appearance: { wallpaper: /app/data/wallpaper.jpg, dim: 0.3 }

assistant:                             # leave out for no assistant
  baseURL: http://ollama:11434/v1
  model: qwen3:8b
  access: { default: read, dns: control }

auth: { mode: local }                  # none (default, read-only), local, proxy, oidc
allowedHosts: [valet.example.com]      # names besides localhost and IPs
```

Every option agents reach for is in [the reference below](#reference). The generated reference is `website/src/content/docs/reference/configuration.mdx` in the repo, or https://askvalet.dev/reference/configuration/.

## Adding a service

1. **Find its type.** Each integration has a page at `https://askvalet.dev/integrations/<type>/` (in the repo: `website/src/content/docs/integrations/<type>.mdx`, and `docs/services.md`). The page lists its options, its widget keys and its tools. The type is the page's file name: `pihole`, `tautulli`, `qbittorrent`, `homeassistant`, `arr`.
2. **Put its key in `.env`**: `PIHOLE_PASSWORD=...`. Then `docker compose up -d`, because the container only reads `.env` when it's created.
3. **Add the block** under `integrations:`. The name (`dns`) is yours: letters, digits, `-` and `_`. `valet`, `pins` and `config` are taken.
   - `url` is the address **from inside the Valet container**: a Docker service name (`http://pihole`) or a LAN IP. `localhost` there is Valet itself.
   - `href` is where the card links in the browser, when that differs.
   - `insecure: true` accepts a self-signed certificate, for that service only, where its page lists it.
4. **Place a widget**: add `dns.stats` to a section's `widgets`. A widget that isn't placed isn't drawn or polled.
5. Run `config check`, then `doctor`.

Several instances of one type are fine (`nas` and `office-pc`, both `type: glances`).

No integration for it?

- `type: http`: up or down for anything with a web page.
- `type: api`: any JSON API as a card, from YAML. See [custom-card.md](custom-card.md).
- `type: iframe`: a page inside a card.
- A plugin, one file in `data/integrations/`. See [plugin.md](plugin.md).

Starting from scratch, two commands write a config for you:

```sh
docker compose run --rm valet node dist/server.js init              # from the containers it finds (--print to preview)
docker exec valet node dist/server.js import homepage /config/homepage --out /config/config.yaml --env /config/.env.import
```

`import` takes `homepage`, `dashy`, `homarr` or `heimdall`. Neither writes a key into the config, and neither overwrites a file without `--force`.

## Secrets

Never write a key, token or password into `config.yaml`. Write `${NAME}` and put the value in `.env`:

```yaml
password: ${PIHOLE_PASSWORD}
```

```sh
# .env
PIHOLE_PASSWORD=an-app-password
```

- Names are capitals, digits and underscores.
- `${NAME}` also reads the file in `NAME_FILE`. `${secret:name}` reads `/run/secrets/name`. `${file:/path}` reads any file. `\${NAME}` is a literal.
- An unset name stops the config loading, with an error that names it.
- Only values that came from a `${NAME}` are redacted from logs, the assistant and the page. A key typed inline isn't, so it can leak. Move it.
- The `secrets:` block adds a folder of files, Vault or 1Password as places a `${NAME}` can come from.

## Layout in brief

```yaml
layout:
  - title: Now
    columns: 2
    widgets: [plex.streams, downloads.active]
  - title: Services
    place: right                 # a sidebar on wide screens
    variant: minimal
    widgets: [services.status]
  - title: Library
    overview: false              # only on its own tab
    widgets:
      - { widget: plex.recent, size: tall, title: New on Plex }
      - { widget: dns.stats, size: small, every: 5m }
```

- A section with a `title` (or `tab`) gets a tab. Sections can share a tab with `tab: Name`.
- `display`: `cards` (default), `tiles`, `rings` or `media`.
- Widget sizes: `small`, `wide`, `medium` (default), `tall`, `large`.
- `every` on a widget: how often it refreshes while the page is open (`30s`, `5m`, or seconds).
- `view` redraws a widget: charts (`line`, `bars`, `race`…) or galleries (`row`, `focus`, `coverflow`…). `config check` says which views a card can take.
- `live.activities` lists widgets whose live things (a stream, a download) show as rings in the top bar. `live.notify` adds toasts on `start`, `end`, `down` or `up`.

## The assistant and its access

```yaml
assistant:
  baseURL: http://ollama:11434/v1      # any OpenAI-compatible server; default is http://localhost:11434/v1
  model: qwen3:8b                      # it must support tool calling
  access:
    default: read                      # every instance not named
    downloads: control                 # by instance name, not type
    docs: write
    cameras: none
    plex.plex_stop_stream: control     # one tool: <instance>.<tool>, as the integration's page lists it
```

For Anthropic: `provider: anthropic`, `apiKey: ${ANTHROPIC_API_KEY}`, `model: ...`.

| Level | Allows | Asks first? |
|---|---|---|
| `none` | nothing; its tools aren't offered | |
| `read` | tools that look | no |
| `write` | also tools that add something | always |
| `control` | also tools that change or remove something | always |

- Left out, `access` is `{ default: read }`.
- `config` turns on the assistant's config-editing tools. Without the key, they don't exist.
- `valet` is Valet's own tools (reminders, rules). It defaults to `control`; `valet: write` turns rules off.
- A key that names no instance, or a dotted key that names no tool, is a config problem.
- **Without sign-in the assistant is capped at `read`**, whatever `access` says. See below.

## Sign-in, read-only and allowed hosts

With the default `auth.mode: none`, Valet is **read-only**: no buttons, actions answer 403, and the assistant only reads. To act, either turn on sign-in or say the network is the lock:

```yaml
auth: { mode: local }                       # accounts: docker exec -it valet node dist/server.js user add sam
# or
auth: { mode: none, trustNetwork: true }    # only if nothing but a VPN, tailnet or sign-in proxy reaches Valet
```

- `local`: built-in accounts. The first account needs the setup code from `docker logs valet`, or make it with `user add`. `user list | add | passwd | remove | signout <name>`.
- `proxy`: trust a header from Authelia, Authentik or similar: `proxy: { header: Remote-User, trusted: [10.0.0.5] }`. Exact addresses, no ranges.
- `oidc`: `oidc: { issuer, clientId, clientSecret: ${OIDC_SECRET} }`. The redirect URL is `https://<valet>/api/auth/oidc/callback`.
- Served over plain http? Set `auth.secureCookie: false`, or sign-in appears to do nothing.

Any name Valet is reached by, other than `localhost` and IP addresses, must be in `allowedHosts`, or the page gets a **421** saying what to add. `*.home.example.com` doesn't match `home.example.com` itself; list both.

## People and profiles

With sign-in on, everyone is an owner. A profile gives someone less:

```yaml
profiles:
  kids:
    tabs: [Media]                      # by tab name; left out: all
    actions: [downloads.pause]         # <instance>.<action> they may press; left out: none
    assistant:                         # left out: no assistant for them
      access: { default: none, requests: write }
      approve: owner                   # owner (default) or self
users: { sam: kids, alex: kids }       # account → profile; anyone not listed is an owner
```

A profile only narrows: its assistant gets the lower of `assistant.access` and its own `access`. Without sign-in, profiles do nothing and `config check` says so. Check who is what with `user list`.

`people: { sam: samantha }` on a Tautulli, Jellyfin, Emby, Seerr or Audiobookshelf block maps each Valet account to their user there, so they see their own activity.

## Live or restart

| Change | Takes effect |
|---|---|
| Almost everything in `config.yaml`, including `allowedHosts`, `profiles`, `users`, layout and assistant | On save. Open pages update. |
| `auth` | Restart Valet: `docker restart valet` |
| `plugins`, or any file in `data/integrations/` | Restart Valet |
| A new or changed variable in `.env` | Recreate the container: `docker compose up -d` |

A broken edit doesn't take the page down: Valet logs it, shows it on the page, and keeps the last good config. `reload: false` stops it watching the file.

## Mistakes to look for

- **An unknown key in the core config is an error.** The edit isn't applied, and `config check` names the closest match: `unknown option "wallpapr" (did you mean "wallpaper"?)`.
- **An unknown option in an integration block is reported and ignored**: `integrations.dns: unknown option "pasword" (ignored)`. The rest of the block still loads, so the card may fail for another reason.
- **A widget key that doesn't exist**: `layout: no widget "dns.status" (dns has: stats)`. Use a key the integration's page lists.
- **`url` is the browser's address.** It must work from inside the container.
- **No buttons, or the assistant won't act.** That's read-only mode: `auth.mode: none` without `trustNetwork`.
- **421 from a reverse proxy name.** Add it to `allowedHosts`.
- **`access` keyed by type** (`qbittorrent: control`) instead of the instance name (`downloads: control`).
- **A new `.env` variable that "isn't set"** after only a restart. Run `docker compose up -d`.
- **YAML quoting.** Quote values with `{`, `: `, `#` or a leading `*`, `&`, `!`, `@`.
- **The assistant can't edit `auth`, `profiles`, `users` or `appearance.background`.** Those are the owner's, by hand.

## Owner-only on purpose

Don't turn on `trustNetwork`, open the port beyond `127.0.0.1`, give the assistant `config` access, or raise access to `control` unless the user asked for it. Say what each one allows when you suggest it.

## Reference

The options agents reach for most, taken from the schema in `src/server/config.ts`. The full list, every default included, is `website/src/content/docs/reference/configuration.mdx` (https://askvalet.dev/reference/configuration/). When in doubt, run `config check`: it names every unknown key and what it should be.

### Top level

| Key | What it is |
|---|---|
| `title` | The page's name. `Home` by default. |
| `greeting` | Whose homelab: `Sam` gives "Sam's homelab". |
| `location`, `timezone` | Context for the assistant; an IANA zone like `America/Toronto`. |
| `integrations` | Instance name → `{ type, ...options }`. |
| `links` | Group → list of `{ name, url, icon?, note? }`. Each group is the widget `links.<group>`, the name lower-cased with spaces as `-` (`Home Lab` is `links.home-lab`). |
| `layout` | A list of sections. See below. |
| `menubar` | A list of widget keys, or `{ widgets, position, labels, clock, date, theme, size }`. |
| `weather` | A widget key shown as a ring beside the clock, like `weather.now`. |
| `calendar` | A calendar widget whose events show when you hover the clock. |
| `live` | `{ activities: [widget keys], notify: [{ widget, on: start\|end\|down\|up, text?, push? }] }`. |
| `appearance` | The look. See below. |
| `hero` | The top of the overview: `greeting`, `status`, `search`, `review`, `align`, `scope`. |
| `chat` | The chat window: `open`, `width`, `height`, `overview`, `placeholder`, `suggestions`, `commands`… |
| `nav` | The tab rail: `side`, `style`, `hide`, `order`, `size`. |
| `format` | `clock`, `date`, `weekStart`, `temperature`, `distance`, `locale`. |
| `labels` | The page's words, for another language. |
| `assistant` | The model and what it may use. See below. |
| `voice` | Speech in and out: `stt`, `tts`, `speakReplies`, `autoSend`. |
| `mcp` | MCP servers the assistant may use: name → `{ url, transport, headers, access, readOnly }`. |
| `mcpServer` | Valet as an MCP server: `{ token, access }`. |
| `auth` | Sign-in. Read once: restart after changing. |
| `allowedHosts` | Names Valet answers to besides localhost and IPs. |
| `profiles`, `users` | Narrower Valets for some accounts. |
| `secrets` | More places a `${NAME}` can come from: `files`, `vault`, `onepassword`, `refresh`. |
| `plugins` | npm packages to load, or `{ packages, replace }`. Read once: restart. |
| `notify` | `{ channels: [...], insights, webPush }`: where reminders and pushes go. |
| `history` | `false`, or `{ hours, every, background }`. |
| `backups` | `false`, or `{ overdue, expect, every, notify }`. |
| `wall` | The wall display at `/wall`. |
| `hooks`, `events` | Webhooks in; events out to a webhook or MQTT. |
| `search` | ⌘K web search: `duckduckgo`, `google`, `kagi`, `brave`, `startpage`, `searxng`, or a URL with `{q}`. |
| `find` | ⌘K searches inside services: `true`, `false`, or a list of instances. |
| `recap`, `welcome`, `reload`, `sandbox`, `notice` | Booleans and a demo pill. |

### A section (`layout[]`)

| Key | Values |
|---|---|
| `title` | Its heading, and its tab's name. |
| `tab` | The tab it belongs to, when not its title. Sections can share one. |
| `widgets` | Widget keys, or entries (below). |
| `display` | `cards` (default), `tiles`, `rings`, `media`. |
| `columns` | 1 to 4, or `{ phone, tablet, desktop, wide }` up to 8. |
| `tabColumns` | Columns on its own tab, 1 to 6. |
| `gap` | px between its cards. |
| `place` | `main` (default), `left`, `right` (a sidebar). |
| `overview` | `false`: only on its own tab. |
| `variant` | `full` (default), `minimal`. |
| `header` | `false`: its cards drop their title bars. |
| `heading` | `false`: no title above it; it still names its tab. |
| `icon` | Its tab's icon. |
| `chat` | `true`: its tab holds the assistant, full page. |
| `favorites` | On the overview, a status card shows only these names, and whatever's down. |
| `open` | Tiles: `false` means a tap opens nothing. |

### A widget entry

A plain key (`dns.stats`) or an object. Only `widget` is needed.

| Key | Values |
|---|---|
| `widget` | `<instance>.<widget>` |
| `size` | `small`, `wide`, `medium` (default), `tall`, `large` |
| `every` | Seconds, or `30s`, `5m`, `1h` |
| `view` | Charts: `line`, `bars`, `stream`, `race`, `heatmap`, `ranked`, `pie`. Galleries: `row`, `spotlight`, `focus`, `coverflow`, `masonry`, `cards`, `desk`, `windows`, `tickets`, `mosaic`, `flashback`, `album`. Calendar: `week`, `agenda`. |
| `rows`, `cols` | How many rows (1–6) or columns (1–8) it spans. `cols` needs a grid: sizes in the section, or `columns` per screen. |
| `title`, `icon` | Its own name and icon. |
| `header` | `false` drops its title bar. |
| `tint`, `opacity`, `blur` | Its surface: a colour, 0–1, px. |
| `background` | An image: `https://…` or `/api/icon/<name>` (a file at `data/icons/<name>.png`). |
| `open` | As a tile: `false`, or another widget key whose card a tap opens. |

`valet.activity` is Valet's own widget: the log of what the page and assistant did. `valet.backups` is the Backups card.

### Appearance

| Key | Values |
|---|---|
| `theme` | `auto` (default), `system`, `light`, `dark` |
| `wallpaper` | A file path (`/app/data/wall.jpg`), an image URL, a colour, a gradient, a list (with `rotate`), or `{ light, dark }` |
| `wallpapers` | Tab name → wallpaper |
| `rotate` | How long each wallpaper in a list stays: `30m` |
| `background` | A script in `data/backgrounds/<name>.js`, by name, or `{ light, dark }`. Owner only. See [background.md](background.md). |
| `backgrounds` | Tab name → script name, or `none` |
| `dim` | 0 to 0.9 (default 0.35), or `{ light, dark }` |
| `blur` | 0 to 40 px, or `{ light, dark }` |
| `glass` | `{ opacity, blur, material: frosted\|liquid }` |
| `colors` | `{ accent, good, warn, bad, card }` |
| `font` | `{ family, url, mono, scale, headingWeight }`. A `url` needs a `family`. |
| `shape` | `{ radius, border, borderColor, shadow: none\|soft\|deep }` |
| `density` | `compact`, `comfortable` (default), `spacious` |
| `gap`, `sectionGap`, `maxWidth`, `rowHeight` | Spacing and page size |
| `sizes` | What a size means: `{ tall: { rows: 3 }, large: { cols: 6 } }` |
| `motion` | `full` (default), `reduced`, `none` |
| `sounds` | `{ enabled, volume }` |
| `rim` | 0 to 1: a lit edge on dark glass |
| `css`, `cssFile` | Your own CSS, loaded last |

### Assistant

| Key | Values |
|---|---|
| `provider` | `openai-compatible` (default) or `anthropic` |
| `baseURL` | The server. Default `http://localhost:11434/v1`, which inside the container is the container itself. |
| `apiKey` | `${NAME}` |
| `model` | Required. Must support tool calling. |
| `name` | Shown on the page. `Assistant` by default. |
| `instructions` | Extra system prompt. |
| `access` | `{ default: read, <instance>: none\|read\|write\|control, <instance>.<tool>: ..., config: ..., valet: ... }` |
| `maxSteps` | 1 to 20, default 6. |
| `reasoning` | `auto`, `off`, `low`, `medium`, `high` |
| `tools` | `all` (default), `lazy`, `auto` |
| `contextWindow`, `compact`, `vision`, `options` | Model details. |
| `models` | More models for the chat's menu, or `auto`. |
| `background` | `{ watch, brief, suggest, perDay }`: what it does unasked. |
| `suggestions` | Questions on an empty chat. |
| `webSearch` | `{ provider: searxng, url }` or `{ provider: brave\|tavily, apiKey }`. |
| `telegram` | `{ token, users: [id, { id, as: account }] }` |
| `agent` | Hand the chat to another agent with an OpenAI-compatible API. Valet's access levels don't apply to it. |

### Auth

| Key | Values |
|---|---|
| `mode` | `none` (default), `local`, `proxy`, `oidc` |
| `trustNetwork` | `true` lets a page with `mode: none` act. Only behind a VPN, tailnet or sign-in proxy. |
| `secureCookie` | `false` when serving over plain http. |
| `sessionDays` | "Keep me signed in", default 30. |
| `proxy` | `{ header: Remote-User, trusted: [addresses] }` |
| `oidc` | `{ issuer, clientId, clientSecret, name, claim, scope, allow, redirectUrl }` |

### Profiles

| Key | Values |
|---|---|
| `tabs` | Tab names they see. Left out: all. |
| `actions` | `<instance>.<action>` they may press. Left out: none. |
| `assistant` | `false` (default), or `{ access, instructions, suggestions, approve: owner\|self }`. Its `access` defaults to `{ default: none }`. |

`users` maps an account name (case-insensitive) to a profile. A name whose profile doesn't exist sees nothing. If every local account has a profile, nobody is an owner; `config check` and `user list` say so.

### Commands

All run as `docker exec valet node dist/server.js <command>` (add `-it` for `user add` and `user passwd`, which prompt).

| Command | What it does |
|---|---|
| `config check` | Every problem, or a tick. Exits 1 on any. |
| `config print` | The parsed config, secrets redacted. |
| `config schema` | JSON schema of the whole file. Save as `valet.schema.json` and add `# yaml-language-server: $schema=valet.schema.json` as the first line. |
| `doctor [--json] [--send-test] [--timeout <s>]` | Tries every placed widget, the model and each notification channel once. |
| `user list` | Accounts, and who is an owner or has a profile. |
| `user add\|passwd\|remove\|signout <name>` | Local accounts. |
| `init [--docker <url>] [--print] [--force]` | A config from the running containers. Replaces only the untouched starter. |
| `import <homepage\|dashy\|homarr\|heimdall> <path> [--out <file>] [--env <file>] [--force]` | Another dashboard's config as Valet's. |
| `new-integration <name> [--full]` | A plugin to start from, in `data/integrations/`. |
| `check-integration <file>` | Runs a `service()` plugin against its sample. |

`docker logs valet` shows startup problems, reloads and plugin loading.
