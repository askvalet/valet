# Community integrations (plugins)

Anyone can add a service to Atrium without forking it. A plugin is an integration, exactly like the built-in ones in
`src/integrations/` (read [integrations.md](integrations.md) for the parts and the card catalog), packaged as a
single file.

## Install one

1. Put the file in `data/integrations/` (with Docker, that's the `./data` folder you mounted).
2. Add its block to `config.yaml` under `integrations:` with the `type:` the plugin declares, and place its widgets in
   the layout like any other (`<your id>.<widget>`). Secrets go in `.env` as usual.
3. Restart Atrium. The log lists the plugins it loaded, and why any were skipped.

Plugins run inside Atrium with the same access as the built-in integrations. **Only install plugins you trust.**

From source you can also install a plugin from npm and list it: `plugins: [atrium-integration-something]`.

## Write one

A plugin's default export is either an integration object, or a function that receives Atrium's toolkit
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

- **Return cards from the catalog.** Atrium checks a plugin's cards against it; a mismatch shows as the widget's error
  (naming the field), not a broken page. Run `checkCard(card)` in your own tests.
- **Give every card a `summary`**, so it works at size small, in the menubar and as a tile.
- **Tools say what they need.** `access: 'read'` to look, `'write'` to add something (it runs without asking), `'control'`
  to change or remove something (the person approves first). Write descriptions for the model: what it returns and
  when to use it.
- **Images go through `ctx.image(ref)`** and your `image(ref)` handler, so the browser never needs your service's key.
- **A built-in type can't be replaced** unless the config lists it: `plugins: { replace: [tautulli] }`.
