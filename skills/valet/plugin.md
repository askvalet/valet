# Valet: writing a plugin

A plugin is an integration in one file in `data/integrations/` (`/app/data/integrations` in the container). It's the same shape as Valet's built-ins, with no imports and no build step.

Pick the smallest form that does the job:

| Form | Use it when |
|---|---|
| `type: api` in YAML | A JSON API and some numbers or rows. No code. See [custom-card.md](custom-card.md). |
| `service()` | One or two endpoints, numbers, a list or up/down rows, read-only. About ten lines. |
| `defineIntegration` | Several widgets, buttons, tools that change things, commands, pictures. |

**Plugins aren't sandboxed.** A plugin runs inside Valet with the keys its block is given. Only its cards are checked. Install only plugins you wrote or have read, and tell the user that.

## The file

```js
// data/integrations/my-thing.mjs
export default ({ z, fmt, defineIntegration, service, checkCard, People, jsonrpc }) => /* an integration, or a list of them */;
```

- The default export is a function that receives the toolkit. Use only what it hands you: no `import`, no `require`.
- Every `.js` and `.mjs` file in the folder loads, in name order. `*.web.js` files are visuals and aren't loaded as plugins.
- `type` must not be a built-in type, or it's skipped with a message (unless the config lists it under `plugins.replace`).
- A plugin without `type`, `config` and `create` is skipped with a message in the log.
- **Valet reads plugins once, at start.** After adding or editing the file: `docker restart valet`, then `docker logs valet` shows `plugins: my-thing` or why it was skipped.

Start from a template:

```sh
docker exec valet node dist/server.js new-integration my-thing          # a service() that passes its own check
docker exec valet node dist/server.js new-integration my-thing --full   # defineIntegration, plus my-thing.web.js
```

The name is lowercase letters, digits and dashes. It never overwrites a file. The file's first lines show the config block to add.

## The short form: service()

```js
// data/integrations/speedbox.mjs
export default ({ service, fmt }) => service({
  type: 'speedbox',
  name: 'Speedbox',
  icon: 'wifi',
  auth: { header: 'X-Api-Key' },
  get: { latest: '/api/results/latest' },
  stats: d => [
    { label: 'Down', value: d.latest.down, unit: ' Mbps' },
    { label: 'Up', value: d.latest.up, unit: ' Mbps' },
    { label: 'Ping', value: d.latest.ping, unit: ' ms' },
    { label: 'Last run', value: fmt.day(d.latest.at) },
  ],
  sample: { latest: { down: 940, up: 41, ping: 11, at: '2026-10-29T08:00:00Z' } },
  expect: { Down: 940, Up: 41, Ping: 11 },
});
```

```yaml
integrations:
  speed:
    type: speedbox
    url: http://speedbox:8080
    key: ${SPEEDBOX_KEY}
layout:
  - widgets: [speed.status]
```

From that you get a strict config (`url`, `href`, `every`, `insecure`, and the credentials `auth` asks for), sign-in with retries, a widget called **`status`** with a tile, one `read` tool called `<type>_status` (dashes as `_`), and errors that never show the key.

| Field | |
|---|---|
| `type`, `name` | Required. `type` is the `type:` in config.yaml. |
| `get` | Required. Name → path, or `{ path, method: 'POST', body, headers, as: 'text'\|'headers', optional }`. Or a function of the options. Answers arrive as `d.<name>`. |
| `then` | `d => ({ more: '/path/' + d.first.id })`: a second round of calls. |
| `stats` | `d => [{ label, value, unit, sub, tone, pct, trend }]` |
| `list` | `d => [{ title, subtitle, meta, ... }]`, used when there's no `stats` |
| `status` | `d => [{ name, ok, detail }]`: a status card that counts up and down itself |
| `card` | `d => card`: any catalog card, when the three above can't say it |
| `headline` | The tile. The first stat by default. |
| `auth` | `'none'` (default), `'bearer'`, `'token'`, `'basic'`, `{ header, prefix }`, `{ query }`, `{ login, body, token, use, ... }`, `{ handshake }`. See below. |
| `authOptional` | Send credentials only if they're set. |
| `options` | Extra settings as zod fields: `{ limit: z.number().int().default(5) }`. Passed as the second argument, `(d, o) => ...`. |
| `every` | `'5m'` or seconds. A minute by default. |
| `icon`, `logo`, `about` | Card icon, app icon (dashboard-icons name), a sentence for the assistant. |
| `sample` | Required. A real answer per `get`, with anything personal taken out. |
| `expect` | Label → expected value in the card. The check asks for it. |
| `sampleOptions`, `loginSample`, `recap`, `backups` | For the check, sign-in, the year in review, the Backups card. |

Credentials by `auth`: `bearer`, `token`, `{ header }` and `{ query }` take `key:`; `basic` and `login` take `username:` and `password:`. The config key is `key`, not `apiKey`.

Check it with no service running:

```sh
docker exec valet node dist/server.js check-integration /app/data/integrations/speedbox.mjs
# ✓ Speedbox: card, tile, assistant tool and failure handling all good
```

It checks the sample parses, the card is valid and has a headline, every `expect` lands, no stat is empty, the tool only reads, a 500 fails, and the failure doesn't show the key. It exits 1 on any problem.

## The full form: defineIntegration

```js
// data/integrations/shelf-light.mjs
export default ({ z, defineIntegration }) => defineIntegration({
  type: 'shelf-light',
  name: 'Shelf light',
  config: z.object({ url: z.string().url(), token: z.string(), href: z.string().optional() }).strict(),
  create(cfg, ctx) {
    const headers = { Authorization: `Bearer ${cfg.token}` };
    const state = () => ctx.http(`${cfg.url}/state`, { headers });
    const set = on => ctx.http(`${cfg.url}/state`, { method: 'POST', headers, body: JSON.stringify({ on }), as: 'text' });
    return {
      widgets: {
        light: {
          title: 'Shelf light', interval: 30_000,
          async fetch() {
            const s = await state();
            return {
              type: 'controls', title: 'Shelf light', icon: 'bulb', href: cfg.href,
              items: [{ id: 'power', label: 'Power', kind: 'toggle', value: s.on, action: 'power' }],
              summary: { label: 'Shelf light', icon: 'bulb', value: s.on ? 'On' : 'Off', tone: s.on ? 'good' : 'neutral' },
            };
          },
        },
      },
      actions: {
        power: {
          description: 'Turn the shelf light on or off', input: z.object({ value: z.boolean() }),
          run: async ({ value }) => { await set(value); return { done: value ? 'Turned the shelf light on' : 'Turned the shelf light off' }; },
        },
      },
      tools: {
        light_status: {
          description: 'Whether the shelf light is on.', label: 'Checked the shelf light',
          access: 'read', input: z.object({}),
          async run() { return { data: await state() }; },
        },
        light_set: {
          description: 'Turn the shelf light on or off.', label: 'Changed the shelf light',
          access: 'control', input: z.object({ on: z.boolean() }),
          confirm: ({ on }) => ({ title: `Turn the shelf light ${on ? 'on' : 'off'}?`, icon: 'bulb', verb: on ? 'Turn on' : 'Turn off' }),
          async run({ on }) { await set(on); return { data: { on }, card: { type: 'text', tone: 'good', text: `Turned it ${on ? 'on' : 'off'}.` } }; },
        },
      },
      commands: [
        { say: ['shelf light on', '{name} on'], run: 'tool:light_set', input: { on: true }, label: 'Turn the shelf light on' },
        { say: ['shelf light', '{name} status'], run: 'tool:light_status' },
      ],
    };
  },
});
```

`config` is a zod schema; use `.strict()` so typos are refused. `create(cfg, ctx)` returns the instance:

| Instance field | |
|---|---|
| `widgets` | Required, even `{}`. Name → `{ title, interval?, fetch() }`. `interval` is ms, 10 s by default. The widget key is `<instance>.<name>`. |
| `actions` | What the page's buttons do: `{ description, input, run(args) }`. `run` may return `{ done: 'What it did' }` for the activity log. |
| `tools` | What the assistant can use. See below. |
| `commands` | Plain words for ⌘K that run an action or tool with no model. A list, or a function returning one. |
| `image(ref, range)` | Serves pictures through Valet. See below. |
| `recap(range)`, `backups()`, `onChat()`, `reminders()` | The year in review, the Backups card, widgets to refresh when someone asks the assistant, timed reminders. |

### Widgets and cards

`fetch()` returns a plain object in one of the catalog's shapes. Never HTML. The catalog is `src/shared/cards.ts`; each type has a page at `https://askvalet.dev/cards/<type>/`. The common ones are listed at the end of this file.

- **Give every card a `summary`**: `{ label, value, sub?, tone?, icon?, pct?, trend? }`. It's what the small and wide sizes, tiles, rings and the menubar show.
- Throw a plain `Error('Shelfy refused its key')` when something fails. The card shows the message.
- Set `activity` on a card only while something is live (a stream, a download).
- A card that doesn't match the catalog becomes that widget's error, naming the field. The check is strict: unknown fields are errors.
- `tone` is `good`, `warn`, `bad`, `accent` or `neutral`. Icons are names (`cpu`, `disk`, `film`, `bulb`, `wifi`) or image URLs.

### Tools

| Field | |
|---|---|
| `description` | Required. For the model: what it returns, when to use it. |
| `access` | Required. `read` (looks), `write` (adds something), `control` (changes or removes something). Pick the narrowest. Anything but `read` asks the person first, every call. |
| `input` | Required. A zod schema. |
| `run(args)` | Required. Returns `{ data, card? }`. `data` goes to the model, so keep it small; `card` is what the person sees. |
| `label` | Past tense, for its chip: `Searched documents`. |
| `confirm(input)` | The approval card: `{ title, detail?, verb?, danger?, image?, icon? }`. |
| `followUps`, `find`, `nearest`, `live`, `undo` | Next questions; search field for ⌘K; likeness search; keep the card live; the tool that reverses this one. |

`confirm` rules: it may look things up and must never change anything (it can run more than once, before the yes). Show what the service says, not what the model typed: look the id up and name the real title. Write a question, name the button for the action (`Pause`, not `OK`), and keep `danger: true` for what's hard to undo.

The user grants tools per instance in `assistant.access`, or one tool with `<instance>.<tool>`. Without sign-in the assistant is capped at `read`.

### Commands

```js
commands: [
  { say: ['pause downloads', 'pause {name}'], run: 'action:pause', label: 'Pause all downloads' },
  { say: ['pause ads {minutes} min'], run: 'action:pause', label: 'Pause ad blocking: {minutes} min' },
  { say: ['add {text} to {name}'], run: 'action:add', label: 'Add {text} to the list' },
],
```

`{name}` is the instance's name. Another slot such as `{minutes}` takes a whole number into the input under that key. `{text}` takes words, as `text`, and needs words before it. `run` is `action:<name>` or `tool:<name>`; a non-read tool still asks with its `confirm`. Matching ignores case, punctuation, word order, plurals and filler words, so write out every real variant.

### A line to type into (`add`)

A `list` or `controls` card can end with a text field. Enter runs one of your actions with the words:

```js
fetch: async () => ({ type: 'list', title: 'Groceries', items, summary: { label: 'Groceries', value: items.length },
  add: { placeholder: 'Add to the list…', action: 'add', args: { list: 'groceries' }, max: 100 } }),
// ...
actions: {
  add: {
    description: 'Put something on the list',
    input: z.object({ list: z.string(), text: z.string().trim().min(1, 'Type something to add').max(100) }),
    run: async ({ list, text }) => { /* add it */ return { done: `Added “${text}”` }; },
  },
},
```

`placeholder` and `action` are required; `arg` (default `text`), `args` and `max` (default 200) are optional. The action's schema is what's checked, so trim and limit there, with error messages a person can read. It's drawn only where a button would be: not on a read-only page, not in chat, not on a tile.

### Pictures

```js
image(ref) {
  if (!/^\d+$/.test(ref)) throw new Error('bad image ref');   // ref comes from the browser: accept only your shape
  return ctx.http(`${cfg.url}/covers/${ref}.jpg`, { as: 'response', headers });
},
```

Put `ctx.image(ref)` in the card. The browser never sees the key. Add `Cache-Control: no-store` for a picture that changes.

### Context

`ctx.id` (the instance name), `ctx.http(url, { as: 'json'|'text'|'response', timeout, insecure, ...fetch options })` (8 s timeout; JSON by default; throws `host answered 401` on an error status), `ctx.log(...)` (redacted), `ctx.image(ref)`, `ctx.session(login)` (one shared sign-in: `.get()`, `.reset()` after a 401), `ctx.upload(id)`, `ctx.format`, and `ctx.as` in a person's own copy when the block has `people:`.

`fmt` has `bytes`, `rate`, `speed`, `duration` (seconds), `span` (ms), `pct`, `day`, `time`, `hour`, `weekday`, `month`, `range`, `relativeDay`, `stamp` and `ago`.

## Visuals: my-thing.web.js

For a picture the catalog can't draw, return a `showcase` card whose `visual.kind` is the file's name, and put a browser module beside the plugin as `data/integrations/<kind>.web.js`. `kind` is lowercase letters, digits and dashes.

```js
return { type: 'showcase', title: 'My thing', visual: { kind: 'my-thing', data: { pct: 0.42 } }, items: [],
  summary: { label: 'My thing', value: '42%', pct: 0.42 } };
```

```js
// data/integrations/my-thing.web.js
export default function mount(box, data, { run }) {
  box.innerHTML = '<div class="v"></div>';
  const el = box.querySelector('.v');
  const update = d => { el.textContent = `${Math.round(d.pct * 100)}%`; el.style.color = 'var(--good)'; };
  update(data);
  return { update, destroy() { box.innerHTML = ''; } };
}
```

- Plain DOM, canvas or SVG. No React, no imports from elsewhere: the page's policy allows scripts and fetches from Valet only.
- Colours from CSS variables (`var(--foreground)`, `var(--muted-foreground)`, `var(--primary)`, `var(--good)`, `var(--warn)`, `var(--bad)`), so it fits light and dark.
- `run(action, args)` calls one of your actions. It's passed when the showcase has no `items`; with `items`, the visual is drawn beside them and gets no `run`.
- `destroy` must remove everything it added and stop any timers.
- The visual runs on the page with Valet's own reach. The same trust rule applies.

## Testing

1. `service()`: `check-integration <file>` (above).
2. Any plugin: `docker restart valet`, then `docker logs valet` for `plugins: ...`.
3. `config check` loads the plugin, checks its config block and that its widget keys exist.
4. `doctor` fetches every placed widget once, through the same card check the page uses, and names a bad field.
5. While writing, `checkCard(card)` from the toolkit returns a zod result: `checkCard(card).success`, and `.error.issues` says what's wrong. Log it with `ctx.log` and remove it after.

Use made-up data in samples. Never commit a recorded answer from a real service.

## Card shapes you'll use most

Every card can also have `title`, `icon`, `href`, `note`, `source`, `summary`, `summaries`, `activity`, `banner`, `buttons: [{ label, action, args? }]`.

| `type` | Required | Useful optional |
|---|---|---|
| `stats` | `items: [{ label, value }]` | item `unit`, `sub`, `tone`, `pct`, `trend`; card `pie` |
| `list` | `items: [{ title }]` | item `subtitle`, `meta`, `pct`, `tone`, `dot`, `image`, `href`, `buttons`; card `empty`, `add`, `layout: temps\|chips\|headlines` |
| `status` | `items: [{ name, ok }]` | item `detail`, `href`, `icon`, `group`, `quiet`, `state` |
| `controls` | `items: [{ id, label, kind }]` | `kind`: `toggle`, `check`, `slider`, `select`, `button`, `value`; item `value`, `action`, `options`, `min`, `max`, `step`, `sub`, `tone`; card `add` |
| `table` | `columns: [..]`, `rows: [[..]]` | |
| `kv` | `rows: [[label, value]]` | |
| `text` | `text` | `tone` |
| `chart` | `series: [{ name, points }]` | `unit`, `max`, `labels`, `from`, `to`, `style: line\|bars\|stream`, `headline` |
| `media` | `items: [{ title }]` | `subtitle`, `image`, `pct`, `state`, `user`, `remaining` |
| `shelf` | `items: [{ title }]` | `subtitle`, `image`, `href`, `badge`; card `aspect: poster\|square\|wide` |
| `links` | `items: [{ name, href }]` | `icon`, `note` |
| `showcase` | `visual: { kind }`, `items` | `visual.data`, `caption` |

Others: `photos`, `ranked`, `schedule`, `calendar`, `forecast`, `thermostat`, `cameras`, `article`, `code`, `group`, `race`, `heatmap`, `embed`, `map`. Read `src/shared/cards.ts` for their fields.

## Sharing

Give the GitHub repository the topic `valet-plugin`. To make it a built-in, move a `service()` into `src/integrations/services/` and open a pull request.
