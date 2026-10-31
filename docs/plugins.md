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
- **Tools say what they need.** `access: 'read'` to look, `'write'` to add something (it runs without asking), `'control'`
  to change or remove something (the person approves first). Write descriptions for the model: what it returns and
  when to use it.
- **Images go through `ctx.image(ref)`** and your `image(ref)` handler, so the browser never needs your service's key.
- **A built-in type can't be replaced** unless the config lists it: `plugins: { replace: [tautulli] }`.

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
