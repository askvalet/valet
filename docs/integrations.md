# Writing an integration

An integration turns one block of `config.yaml` into widgets for the homepage, actions for its controls, and tools
for the assistant. It's one file in `src/integrations/`, registered in `src/integrations/index.ts`.

Everything runs on the server. API keys and internal URLs never reach the browser.

## The smallest useful one

```ts
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'uptime-kuma',                 // `type:` in config.yaml
  name: 'Uptime Kuma',
  config: z.object({ url: z.string().url(), slug: z.string() }),
  create(cfg, ctx) {
    async function monitors() {
      const j = await ctx.http(`${cfg.url}/api/status-page/heartbeat/${cfg.slug}`);
      return Object.entries(j.heartbeatList).map(([id, beats]: [string, any]) => ({ id, up: beats.at(-1)?.status === 1 }));
    }
    return {
      widgets: {
        status: {
          title: 'Uptime', interval: 30_000,
          async fetch() {
            const m = await monitors();
            return { type: 'status', title: 'Uptime', items: m.map(x => ({ name: x.id, ok: x.up })) };
          },
        },
      },
      tools: {
        uptime: {
          description: 'Which monitors are up or down right now.',
          access: 'read', input: z.object({}),
          async run() { const m = await monitors(); return { data: m, card: { type: 'status', items: m.map(x => ({ name: x.id, ok: x.up })) } }; },
        },
      },
    };
  },
});
```

Then in `config.yaml`:

```yaml
integrations:
  uptime: { type: uptime-kuma, url: http://kuma:3001, slug: home }
layout:
  - widgets: [uptime.status]
```

## The parts

**`config`** is a Zod schema. Atrium validates the user's block against it and reports errors with the path.

**`widgets`** each return a card from the catalog (`src/shared/cards.ts`). `interval` is how often it refreshes while
someone is looking (default 10 s). Widgets that aren't in the layout are never polled.

**`actions`** are what homepage controls call. A `controls` card item names an action and its args; when the person
flips a toggle, Atrium runs the action and refreshes the integration's widgets right away.

**`tools`** are what the assistant may call. Write `description` for the model: what it returns and when to use it.
Return `data` (compact JSON the model reads) and optionally a `card` (what the person sees). Mark anything that changes
state `access: 'control'`: it only exists for the assistant if the user grants control, and every call asks first.

**`image(ref)`** serves images (posters, snapshots) through Atrium so the browser never needs the service's key. Put
`ctx.image(ref)` in a card; validate `ref` before fetching.

## Context

`ctx.http(url, init)` fetches with a timeout and a readable error, and parses JSON unless you pass `as: 'text'` or
`as: 'response'`. `ctx.log` prefixes output with the instance name. `fmt` (from `core.ts`) formats bytes, rates,
durations and percentages consistently.

## Guidelines

- Keep `data` small: the model's context is precious. Summarise; don't dump the raw API response.
- One request per widget refresh if you can. If several widgets share data, fetch once and cache briefly.
- Fail with a clear message (`throw new Error('qBittorrent login failed')`); Atrium shows it on the widget.
- Don't invent card types. If the catalog is missing something you need, open an issue: new types get added for everyone.
