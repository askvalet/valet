// For integrations that read an endpoint you run yourself: the shape Valet expects, so anyone can serve it. Written in
// MDX and placed after the options on the integration's page.
export const FORMAT: Record<string, string> = {
  api: `## Fields

Each field is a path into the response: \`data.speed\`, \`items[0].name\`, or \`$\` for the whole of it. A path can go
through formats: \`size|bytes\`, \`ratio|pct\`, \`started|ago\`, \`speed|round:1\`. The formats are \`bytes\`, \`rate\`,
\`duration\` (seconds), \`pct\` (0 to 1), \`round:1\`, \`divide:1000\`, \`day\`, \`time\`, \`ago\`, \`upper\`, \`lower\` and \`count\`.

A field with braces is a template, which is always text: \`"{used|bytes} of {total|bytes}"\`. Quote anything with a brace,
so YAML reads it as text.

## Expressions

A field that starts with \`=\` is an expression, and keeps its type: \`value: "=mem / maxmem|pct"\`. Inside a template, it
goes in braces: \`"{=used / total|pct} used"\`.

| | |
|---|---|
| Values | \`42\`, \`0.8\`, \`'text'\`, \`true\`, \`false\`, \`null\` |
| Paths | \`name\`, \`disk.used\`, \`items[0].name\`, \`$['odd key']\` |
| Arithmetic | \`+ - * / %\`. \`+\` joins text when either side is text. |
| Comparing | \`== != < <= > >=\`. A number written as text compares as a number. |
| Logic | \`and\`, \`or\`, \`not\`, and brackets |
| Functions | \`len(x)\`, \`lower(x)\`, \`upper(x)\`, \`contains(text, 'part')\` (ignores case; in a list, the whole item), \`min(a, b)\`, \`max(a, b)\`, \`round(x, 1)\`, \`abs(x)\`, \`num('42%')\`, \`hours(when)\` and \`days(when)\`: how long ago a timestamp was |

A value that isn't there stays missing, so \`used / total\` with no \`total\` shows a dash rather than a wrong number.
Timestamps can be ISO text, or seconds or milliseconds since 1970.

Expressions are read by Valet itself, never run as code. They can only read the data's own fields, the functions above
are all there is, and one is at most 500 characters. A mistake is a problem in \`config check\`, which says where it is.

## Which rows, in what order

\`list\`, \`status\` and \`table\` take three more options:

- \`where\`: an expression. A row is kept when it's true.
- \`sort\`: a path or an expression to order by. Put \`-\` first for the largest first. Rows without one go last.
- \`limit\`: how many to show, after \`where\` and \`sort\`.

\`\`\`yaml title="config.yaml"
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
      columns: { Node: name, CPU: cpu|pct, Memory: "=mem / maxmem|pct", Up: "=round(days(booted)) + ' days'" }
\`\`\`

A list counts every row \`where\` kept, so its tile says how many match.

## From a card Valet already has

Use \`from\` instead of \`url\`, and the card is made from another widget's latest card: the one Valet already fetched,
with that integration's own keys. There's no request and no secret here, and nothing new to allow. The card refreshes
when its source does.

Paths go into that card. The [card gallery](/cards/) shows each type's fields; a list's rows are \`items\`, each with
\`title\`, \`subtitle\`, \`meta\` and \`pct\`, and a status card's are \`items\` with \`name\`, \`ok\` and \`detail\`.

Proxmox guests that use more than 80% of their memory. The Proxmox card lists nodes and guests together, so the nodes
are left out by their id:

\`\`\`yaml title="config.yaml"
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

layout:
  - title: Servers
    widgets: [bigvms.data]
\`\`\`

Containers that aren't running as they should, from the Docker card:

\`\`\`yaml title="config.yaml"
integrations:
  trouble:
    type: api
    from: docker.containers
    title: Needs a look
    status: { items: items, where: "not ok and not quiet", name: name, ok: ok, detail: detail, group: group }
\`\`\`

- A card made with \`from\` is seen only by someone who sees its source too. With [profiles](/start/people/), put the
  source on one of their tabs as well, or the card stays hidden from them.
- The assistant reads it no more than it may read the source: \`proxmox: none\` in \`assistant.access\` keeps both.
- \`from\` can't name another card made with \`from\`: point at the one that fetches. \`config check\` says so.

## Containers that started today

Docker's own list says how long each container has been up, which the Containers card doesn't carry. Read it from the
same socket proxy the \`docker\` integration uses; it takes no key:

\`\`\`yaml title="config.yaml"
integrations:
  restarted:
    type: api
    url: http://socket-proxy:2375/containers/json
    title: Started today
    icon: disk
    every: 5m
    status:
      items: $
      where: "contains(Status, 'Up') and not (contains(Status, 'day') or contains(Status, 'week') or contains(Status, 'month'))"
      sort: -Created
      name: Names[0]
      ok: State
      detail: Status
\`\`\`

\`Status\` reads like \`Up 3 hours\`, so anything up for less than a day is kept. To count only the ones that were
recreated, by an update or \`docker compose up\`, use \`where: "hours(Created) < 24"\` instead.

## Asking for it

With [\`assistant.access.config\`](/assistant/cards/), you can describe a card in the chat ("a card of my Proxmox VMs over
80% memory") and the assistant writes this block, shows you the card, and saves it when you say so.`,
  aimonitor: `## Your endpoint

This reads JSON from your own endpoint, so it works with any GPU and any model server once something answers in this
shape. [\`examples/local-ai/valet-local-ai.py\`](https://github.com/askvalet/valet/tree/master/examples/local-ai)
is a small server that does it from \`nvidia-smi\` and Ollama, using only Python's standard library.

**\`GET /api/live\`** is the only one that's required:

\`\`\`json
{
  "gpu": { "util": 34, "power": 182.5, "temp": 61, "mem": 18240, "mem_total": 24576 },
  "model": { "name": "qwen3:14b", "swapping": null },
  "running": [{ "app": "Open WebUI" }],
  "today": { "requests": 212, "tokens": 481200, "kwh": 0.42, "cost": 0.06 },
  "last_query": { "app": "Open WebUI" }
}
\`\`\`

- \`gpu\`: load in %, power in W, temperature in °C, memory used and total in MiB.
- \`model.swapping\`: the name of a model that's loading, or null.
- \`running\`: what's generating right now. An empty list means idle.
- \`today.kwh\`, \`today.cost\` and \`last_query\` are optional.

Two more add the day's graphs and the electricity cost, and are used when they answer:

- **\`GET /api/history\`**: \`{ "gpu": [...], "requests": [...], "totals": { "avg_tok_s": 41, "prompt_tokens": 920000 } }\`.
  Each \`gpu\` row is \`{ "at", "util", "power", "mem", "temp" }\` and each \`requests\` row is
  \`{ "at", "app", "requests", "tokens" }\`, with \`at\` in Unix seconds and the same times in both. Arrays in that order
  work too.
- **\`GET /api/cost\`**: \`{ "days": [{ "day": "2026-11-03", "tokens": 481200, "cost": 0.06, "kwh": 0.42 }], "month": 0.31 }\`.

To check your endpoint, open it in a browser or run \`curl http://your-host:8097/api/live\`. If something doesn't fit,
the card says which field.`,

  'rgb-control': `## Your endpoint

This reads JSON from your own endpoint, so it works with whatever controls your lights (OpenRGB, a vendor tool, your own
script) once something answers in this shape.

**\`GET /api/state\`**:

\`\`\`json
{
  "cards": [
    { "id": "fans0", "title": "Top fans", "modes": ["Static", "Breathing", "Rainbow", "Off"],
      "zones": [{ "id": "fan-1", "name": "Fan 1", "state": { "mode": "Static", "color": [255, 140, 40], "brightness": 100 } }] },
    { "id": "pump", "title": "Pump head", "zones": [{ "id": "pump-ring", "state": { "mode": "Rainbow" } }] }
  ],
  "presets": [{ "id": "warm", "name": "Warm", "swatch": ["#ffaa5a"] }],
  "layout": { "fans0": "top" },
  "telemetry": { "cpu_temp": 52, "gpu_temp": 47, "gpu_power": 96, "ram_used": 21.4, "ram_total": 64,
                 "liquid_temp": 31.5, "pump_rpm": 2460, "hub_rpm": [980, 0] }
}
\`\`\`

- \`cards\` are the parts of the PC. These ids light up on the model: \`fans0\` to \`fans9\` (fan groups),
  \`coolerfans\`, \`pump\`, \`ram\`, \`gpu\` and \`strip\`. A card with \`"error"\` is shown as unavailable.
- \`state.color\` is red, green and blue, 0 to 255, and \`brightness\` is 0 to 100.
- \`presets\`, \`layout\` and \`telemetry\` are optional, and so is every field in \`telemetry\` (temperatures in °C,
  memory in GB). \`hub_rpm\` is one speed per fan group.
- Add \`"lcd": true\` if **\`GET /api/lcd/preview\`** serves a picture of a screen on the cooler.

To let Valet change the lights, answer two POSTs. Each comes with the header \`X-RGB: 1\`:

- **\`POST /api/zones\`** with \`{ "zones": ["fan-1", "fan-2"], "state": { "mode": "Static", "color": [0, 132, 255], "brightness": 80 } }\`
- **\`POST /api/preset\`** with \`{ "id": "warm" }\`

Leave them out, or set \`controls: false\`, and the card only looks.`,
};
