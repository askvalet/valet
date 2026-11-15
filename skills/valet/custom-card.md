# Valet: a card from any JSON API

`type: api` turns a JSON response into a card from YAML alone. Use it before writing a plugin. [config.md](config.md) covers where the file is and how to check it.

## The steps

1. Look at the JSON first (below). Don't guess field names.
2. Pick **one source**: `url` (fetch it) or `from` (another widget's card).
3. Pick **one shape**: `stats`, `list`, `rows`, `status` or `table`.
4. Write the fields as paths into the response.
5. Place `<name>.data` in the layout. The widget is always called `data`.
6. Run `config check`, then `doctor`.

Exactly one source and exactly one shape, or `config check` says `say where the data comes from with exactly one of url or from` / `say how to show it with exactly one of stats, list, rows, status or table`.

## Look at the JSON first

Ask from inside the container, so you see what Valet will see, through its network:

```sh
docker exec valet node -e "fetch(process.argv[1]).then(r => r.text()).then(console.log)" http://speedtest:8080/api/latest
```

With a key from `.env` (the container has it in its environment):

```sh
docker exec valet node -e "fetch(process.argv[1], { headers: { Authorization: 'Bearer ' + process.env.SPEEDTEST_TOKEN } }).then(r => r.text()).then(console.log)" http://speedtest:8080/api/latest
```

Pipe through `jq` on the host to read it (`| jq .`). Note where the list of rows is (`$`, `data.items`…) and which field says up or down. Don't paste the key into the command or the chat; read it from the environment as above.

For `from`, the source card's fields are on its type's page: `https://askvalet.dev/cards/<type>/` (in the repo, `website/src/content/docs/cards/<type>.mdx`). The integration's page says which card type each widget returns. A list card's rows are `items` with `title`, `subtitle`, `meta`, `pct`; a status card's are `items` with `name`, `ok`, `detail`, `group`. With no sign-in, you can also watch the live cards: `curl -sN --max-time 5 http://localhost:7575/api/events | grep '"key":"docker.containers"'`.

## A first card

```yaml
integrations:
  speed:
    type: api
    url: http://speedtest:8080/api/latest
    title: Speedtest
    icon: wifi
    about: The last internet speed test.      # tells the assistant what it is
    every: 5m                                 # default 1m, while someone's looking
    headers:
      Authorization: Bearer ${SPEEDTEST_TOKEN}   # secrets in .env, never inline
    stats:
      - { label: Down, value: "download|round:0", unit: Mbps, max: 1000 }
      - { label: Up, value: "upload|round:0", unit: Mbps, max: 1000 }
      - { label: Ping, value: ping, unit: ms, warn: 30, bad: 80 }
      - { label: Last run, value: "at|ago" }

layout:
  - title: Network
    widgets: [speed.data]
```

Other options: `method: POST` with `body` (text, or anything else as JSON), `href` (where the card links), `icon`.

## Fields

Every field is one of three things.

**A path** into the response: `download`, `data.speed`, `items[0].name`, `$['odd key']`, or `$` for the whole of it. Only the data's own properties are read.

**A path with formats**, after `|`, applied left to right: `size|bytes`, `ratio|pct`, `started|ago`, `speed|round:1`, `ms|divide:1000|round:1`.

| Format | Does |
|---|---|
| `bytes` | `1610612736` → `1.5 GB` |
| `rate` | bytes per second → `1.5 MB/s` |
| `duration` | seconds → `3h 12m` |
| `pct` | 0 to 1 → `42%` |
| `round:N` | N decimals (0 if left out) |
| `divide:N` | divide by N |
| `day`, `time`, `ago` | a timestamp → a date, a time, `5m ago` |
| `upper`, `lower` | case |
| `count` | how many items in a list or keys in an object |

Timestamps can be ISO text or seconds or milliseconds since 1970. An unknown format is a config problem that lists the real ones.

**A template**, with braces, always text: `"{used|bytes} of {total|bytes}"`. **Quote anything with a brace**, or YAML reads it as a map.

**An expression**, starting with `=`, keeps its type: `"=mem / maxmem|pct"`. Inside a template, `{=…}`: `"{=used / total|pct} used"`.

| | |
|---|---|
| Values | `42`, `0.8`, `'text'`, `true`, `false`, `null` |
| Paths | `name`, `disk.used`, `items[0].name`, `$['odd key']` |
| Arithmetic | `+ - * / %`; `+` joins text when either side is text |
| Comparing | `== != < <= > >=`; a number written as text compares as a number |
| Logic | `and`, `or`, `not`, brackets |
| Functions | `len(x)`, `lower(x)`, `upper(x)`, `contains(text, 'part')`, `min(a, b)`, `max(a, b)`, `round(x, 1)`, `abs(x)`, `num('42%')`, `hours(when)`, `days(when)` |

`contains` ignores case on text; on a list it looks for a whole item. `hours` and `days` say how long ago a timestamp was. A missing value stays missing, so `used / total` with no `total` shows a dash. Expressions are parsed by Valet, never run as code: there are no other functions, and each is at most 500 characters.

Quote every expression and template. Bare paths and `path|format` can go unquoted, but quoting them never hurts.

## The five shapes

**`stats`**: a list of numbers. Each has `label` and `value`, and optionally `unit`, `sub` (a second line, same form as `value`), `max` (draws a meter), `warn` and `bad`. Past `warn` it turns orange, past `bad` red. If `warn` is higher than `bad`, lower is worse, as with free space. The first four become the tile's headlines.

**`list`**: rows. `title` is required; `subtitle`, `meta` (right side), `image`, `href` and `pct` (0 to 1, a bar) are optional. `items` says where the rows are (default `$`).

**`rows`**: a key-value table, label → field: `rows: { Version: version, Uptime: "uptime|duration" }`.

**`status`**: up-or-down rows. `name` and `ok` are required; `detail`, `href` and `group` are optional. `ok` counts as up for `true`, a number from 1 to 399, or text `up`, `ok`, `okay`, `healthy`, `running`, `online`, `active`, `true`, `connected`, `success`, `1` or a `2xx` code. Anything else is down. The tile says `All up` or `2 down`.

**`table`**: `columns` maps each heading to a field: `{ Name: name, CPU: "cpu|pct" }`.

## Which rows, in what order

`list`, `status` and `table` also take:

- `items`: where the rows are. `$` is the whole response. It must be a list.
- `where`: an expression; a row is kept when it's true. `"online and not contains(name, 'test')"`.
- `sort`: a path or expression to order by. `-` first for largest first: `-cpu`. Rows with no value go last.
- `limit`: how many to show after `where` and `sort`, 1 to 100, default 10.

Paths inside these are relative to each row, not the whole response. A list's tile counts every row `where` kept, before `limit`.

```yaml
integrations:
  busy:
    type: api
    url: http://nodes.example:9000/nodes
    title: Busiest nodes
    table:
      items: $
      where: "online and not contains(name, 'test')"
      sort: -cpu
      limit: 5
      columns: { Node: name, CPU: "cpu|pct", Memory: "=mem / maxmem|pct", Up: "=round(days(booted)) + ' days'" }
```

## From a card Valet already has

`from: <instance>.<widget>` instead of `url` makes the card from another widget's latest card. No request, no keys, nothing new to allow; it refreshes when its source does.

```yaml
integrations:
  bigvms:
    type: api
    from: proxmox.guests
    title: Over 80% memory
    icon: memory
    list:
      items: items
      where: "pct > 0.8 and not contains(id, 'node/')"
      sort: -pct
      title: title
      subtitle: subtitle
      meta: "=pct|pct"
      pct: pct
  trouble:
    type: api
    from: docker.containers
    title: Needs a look
    status: { items: items, where: "not ok and not quiet", name: name, ok: ok, detail: detail, group: group }
```

- `from` can't name another `from` card. Point at the one that fetches.
- Someone with a profile sees it only if they see the source too.
- The assistant may read it no more than it may read the source.

## More examples

Containers started in the last day, from the Docker socket proxy the `docker` integration uses (no key):

```yaml
integrations:
  restarted:
    type: api
    url: http://socket-proxy:2375/containers/json
    title: Started today
    every: 5m
    status:
      items: $
      where: "hours(Created) < 24"
      sort: -Created
      name: "Names[0]"
      ok: State
      detail: Status
```

A version and uptime as a key-value card:

```yaml
integrations:
  nasinfo:
    type: api
    url: http://nas:8080/api/system
    title: NAS
    rows:
      Version: version
      Uptime: "uptime|duration"
      Disks: "disks|count"
      Free: "{free|bytes} of {total|bytes}"
```

A list with progress, from a POST:

```yaml
integrations:
  jobs:
    type: api
    url: http://worker:9000/rpc
    method: POST
    body: { method: jobs.list, params: { active: true } }
    title: Jobs
    list:
      items: result.jobs
      sort: -progress
      limit: 5
      title: name
      subtitle: "{done} of {total} files"
      meta: "=progress|pct"
      pct: progress
```

Free space that turns orange under 100 GB and red under 20 GB (`warn` above `bad`, so lower is worse):

```yaml
    stats:
      - { label: Free, value: "=free / 1073741824|round:0", unit: GB, warn: 100, bad: 20 }
```

## What else you get

- The widget `<name>.data`, refreshed every `every` while the page is open.
- A tile for `small` and `wide` sizes, from the first stats or the row count.
- One assistant tool, `read` (dotted key `<name>.read` in `assistant.access`), which returns what the card shows. `about` is its description.

## When it's wrong

- `"items" isn't a list in the response`: the `items` path points at an object, or the wrong level. Look at the JSON again.
- Every value is `–`: the paths don't match. Paths are case-sensitive.
- `didn't send JSON` or `answered 401`: the url is a login page, or the key is wrong or missing. Check it with the `node -e` command above.
- A mistake in an expression is reported by `config check` with where it is.

When you need sign-in sessions, several calls, buttons or tools that change things, write a plugin instead: [plugin.md](plugin.md).
