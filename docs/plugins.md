# Community integrations (plugins)

Anyone can add a service to Valet without forking it. A plugin is an integration, exactly like the built-in ones in
`src/integrations/` (read [integrations.md](integrations.md) for the parts and the card catalog), packaged as a
single file.

## Install one

1. Put the file in `data/integrations/` (with Docker, that's the `./data` folder you mounted).
2. Add its block to `config.yaml` under `integrations:` with the `type:` the plugin declares, and place its widgets in
   the layout like any other (`<your id>.<widget>`). Secrets go in `.env` as usual.
3. Restart Valet. The log lists the plugins it loaded, and why any were skipped.

Plugins run inside Valet with the same access as the built-in integrations. **Only install plugins you trust.**

From source you can also install a plugin from npm and list it: `plugins: [valet-integration-something]`.

## The ten-line version

Most services are one or two API calls and a few numbers. `service()` needs nothing more, and the rest comes free: the
config, sign-in, a card with a headline tile, and a tool so the assistant can answer questions about it.

```js
// data/integrations/speedtest.mjs
export default ({ service }) => service({
  type: 'speedtest', name: 'Speedtest', icon: 'wifi', auth: 'bearer',
  get: { latest: '/api/v1/results/latest' },
  stats: d => [{ label: 'Down', value: d.latest.data.download, unit: ' Mbps' }, { label: 'Ping', value: d.latest.data.ping, unit: ' ms' }],
  sample: { latest: { data: { download: 940, ping: 11 } } },
  expect: { Down: 940, Ping: 11 },
});
```

`sample` is a real answer from the service and `expect` is what it should show. Check it without the service running:

```sh
node dist/server.js new-integration speedtest      # writes a commented starting point
node dist/server.js check-integration data/integrations/speedtest.mjs
```

That runs what Valet's own tests run: the card is valid, the numbers land where you said, an outage fails cleanly and
the key never appears in an error. To ship it for everyone, move it into a family file in `src/integrations/services/`
and open a pull request: `npm test` picks it up by itself.

`auth` is `'none'`, `'bearer'`, `'token'`, `'basic'`, `{ header: 'X-Api-Key' }`, `{ query: 'apikey' }`, or
`{ login: '/api/login', token: r => r.jwt }` to trade a password for a session (add `expired`, `ttl`, `text` or `needs` for
the awkward ones, and `authOptional: true` where many installs run without a login). `then` is a second step that uses the
first's answers, and `every: '5m'` slows down heavy calls. [docs/services.md](services.md) lists what's supported. Use `list` or `status` instead of
`stats` for rows, `options` for settings of its own, and `recap` to join the year in review.

For controls, write tools or several widgets: use the full form below (`new-integration <name> --full`).

## Write one

A plugin's default export is either an integration object, or a function that receives Valet's toolkit
(`{ z, fmt, defineIntegration, checkCard }`) and returns one. The function form needs no imports and no build step:

```js
// data/integrations/hello.mjs
export default ({ z, defineIntegration }) => defineIntegration({
  type: 'hello',
  name: 'Hello',
  config: z.object({ who: z.string().default('world') }),
  create: (cfg) => ({
    widgets: {
      greeting: { title: 'Hello', fetch: async () => ({ type: 'text', text: `Hello, ${cfg.who}!` }) },
    },
  }),
});
```

[`examples/hello-plugin.mjs`](../examples/hello-plugin.mjs) is a fuller one: a widget, a summary for small sizes, and
a tool for the assistant.

Rules of the road:

- **Return cards from the catalog.** Valet checks a plugin's cards against it; a mismatch shows as the widget's error
  (naming the field), not a broken page. Run `checkCard(card)` in your own tests.
- **Give every card a `summary`**, so it works at size small, in the menubar and as a tile.
- **Tools say what they need.** `access: 'read'` to look, `'write'` to add something, `'control'` to change or
  remove something. Anything but `read` waits for the person to approve it. Write descriptions for the model: what it returns and
  when to use it.
- **Say what you're about to do.** A tool that asks can have `confirm(input)`, returning `{ title, detail, image, icon, verb, danger }`
  for its approval card: `Request The Mob?`, with a button that says Request. It may look things up but never change them, and
  it should show what the service says rather than what the model typed.
- **Images go through `ctx.image(ref)`** and your `image(ref)` handler, so the browser never needs your service's key.
- **A built-in type can't be replaced** unless the config lists it: `plugins: { replace: [tautulli] }`.

## Cards for the house

Three cards draw their own glass and fill whatever row they land in. Give `forecast` a `days` array for the row along
the bottom. Give `calendar` the events the browser may page through, and say what they cover with `from` and `to`:

```js
{ type: 'calendar', title: 'Family', from: '2026-09-01', to: '2027-03-31', events: [
  { title: 'Daycare', start: '2026-10-05T08:30:00-04:00', end: '2026-10-05T09:00:00-04:00', calendar: 'Family' },
  { title: 'Long weekend', start: '2026-10-09', end: '2026-10-13', color: '#ff9f6b' },   // plain dates are all day; the end is exclusive
], summary: { label: 'Family', icon: 'calendar', value: 'Daycare', sub: 'Mon · 8:30 AM' } }
```

A `thermostat`'s buttons are your own actions, run like any other, so the same permissions apply:

```js
{ type: 'thermostat', title: 'Hallway', unit: 'C', state: 'Idle', mode: 'heat', current: 19.5, target: 20, min: 7, max: 30, step: .5,
  set: { action: 'climate' },                                      // called with { temperature }
  modes: [{ id: 'sleep', label: 'Sleep', action: 'climate', args: { preset: 'sleep' } }],
  summary: { label: 'Hallway', icon: 'thermometer', value: '20.0°', sub: 'Idle' } }
```

`mode` (`heat`, `cool`, `auto`, `off`) colours the dial; `id` picks a mode's icon (`off`, `heat`, `cool`, `auto`,
`heat_cool`, `dry`, `fan_only`, `home`, `sleep`, `night`, `away`, `eco`, `boost`, `comfort`, `activity`), and anything
else shows its first letters. The dial moves at once and sends one request when you let go, then waits for your next
card to agree, so return the new `target` on the next fetch. Leave out `target` when there isn't one, and it's a read-out.

## Start from a template

```sh
docker exec valet node dist/server.js new-integration my-service     # from source: node dist/server.js new-integration my-service
```

writes `data/integrations/my-service.mjs` (a widget with a summary and a button, an action, a read tool and a control
tool) and `my-service.web.js` (its visual), commented line by line. Point it at your service, add it to `config.yaml`
(the file's first lines show how), restart, and it's on the page and in the assistant.

## The year in review

Valet's year in review is built from what each integration offers, and yours can join in. Return a `recap` next to
`widgets`. It gets the period and answers with slides:

```js
async recap({ year, from, to }) {
  const n = await countThings(from, to);
  if (!n) return [];                               // nothing to say? say nothing
  return [{ id: 'things', kicker: 'You made', value: n.toLocaleString('en'), unit: 'things', scope: 'year',
    line: 'One sentence on why that matters.', stat: 'Things made', score: 60,
    trait: { name: 'The Maker', line: 'Who this makes them.', strength: 0.6 } }];
}
```

- **Only real numbers.** If your service can't really know something, leave it out. Set `scope` to what the number
  covers (`'year'`, `'All time'`, `'Last 30 days'`).
- `score` orders the story (higher comes earlier, 50 by default), and `stat` puts the number on the shareable card.
- `items` is a top five, with an optional `image`. Mark a slide `private: true` if it names people.
- `trait` is a personality: the strongest across all services becomes who the person was this year.
- `backdrop` is wide artwork behind the slide, `wall: true` puts the drifting wall of posters behind it, and `art` adds
  posters to that wall. `bars` is a small chart of what the number is made of, `chart` a progress bar.
- `logo` is the app's icon, shown large with its colours across the slide. A `service()` gets its own without asking.
- In a `service()`, `tally(count, slide)` makes the usual slide from one number, and nothing at all when it's zero.
- No model writes any of this: a recap of real numbers can't have one inventing a few.

## Visuals of your own

The catalog covers most things, but a plugin can draw anything. Return a `showcase` card whose `visual.kind` is the
plugin's name, and put a browser module next to it as `<kind>.web.js`. Valet loads it and calls:

```js
export default function mount(box, data, { run }) {
  // draw into `box` (plain DOM, canvas, SVG…); `run(action, args)` calls one of your actions
  return { update(data) { /* new data arrived */ }, destroy() { /* the card went away */ } };
}
```

It's the same contract as Valet's own 3D models. Use the page's CSS variables (`var(--foreground)`, `var(--good)`,
`var(--primary)`, `var(--muted-foreground)`) so it fits light and dark, and keep motion soft (see AGENTS.md). In
chat, the assistant shows your visual whenever one of your tools returns that card, so generative UI comes for free.
