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

**`config`** is a Zod schema. Valet validates the user's block against it and reports errors with the path.

**`widgets`** each return a card from the catalog (`src/shared/cards.ts`). `interval` is how often it refreshes while
someone is looking (default 10 s). Widgets that aren't in the layout are never polled.

**`actions`** are what homepage controls call. A `controls` card item names an action and its args; when the person
flips a toggle, Valet runs the action and refreshes the integration's widgets right away.

**`tools`** are what the assistant may call. Write `description` for the model: what it returns and when to use it.
Return `data` (compact JSON the model reads) and optionally a `card` (what the person sees). Give it a `label`: what it
did, past tense, for its chip in chat ("Searched documents"); `followUps` offers a couple of next questions after an
answer that used it. Pick the narrowest `access`:

- `read`: only looks.
- `write`: adds something the person asked for (save a link, file a document). List the inputs that must come from the
  person's own message in `fromPerson` (`['url']`): when they do, it runs without asking; when a page or document the
  assistant read put them there, it asks. That's what stops a web page from talking the assistant into acting.
- Set `live: true` on a cheap look-only tool whose answer changes by itself, and its card keeps itself current in chat.
- `control`: changes or removes something (pause, stop, turn off, request). Every call asks first, and it only exists
  for the assistant if the user grants `control`.

**`image(ref)`** serves images (posters, snapshots) through Valet so the browser never needs the service's key. Put
`ctx.image(ref)` in a card; validate `ref` before fetching.

## Context

`ctx.http(url, init)` fetches with a timeout and a readable error, and parses JSON unless you pass `as: 'text'` or
`as: 'response'`. `ctx.log` prefixes output with the instance name. `ctx.session(login)` shares one sign-in between
parallel requests (call `.get()` for the token, `.reset()` after a 401). `ctx.upload(id)` reads a file the person
attached in chat. `fmt` (from `core.ts`) formats bytes, rates, speeds, durations, percentages, days (`fmt.day`,
`fmt.relativeDay`: "Today", "Tomorrow", "Fri") and times consistently.

Icons in cards are names: `cpu gpu memory wifi disk download pulse play film bulb home shield chat image clock crescent
game book coins text file bookmark sun moon cloud cloud-sun cloud-moon rain snow fog storm`, or an image URL.

## Guidelines

- Keep `data` small: the model's context is precious. Summarise; don't dump the raw API response.
- One request per widget refresh if you can. If several widgets share data, fetch once and cache briefly.
- Fail with a clear message (`throw new Error('qBittorrent login failed')`); Valet shows it on the widget.
- Don't invent card types. If the catalog is missing something you need, open an issue: new types get added for everyone.

## Cards

A widget returns one card from the catalog in `src/shared/cards.ts`. Pick the one that fits what the data *is*:

| Card | For | Notes |
|---|---|---|
| `stats` | a few numbers, one leading | first item is the hero; `trend` draws a sparkline, `pct` a meter |
| `list` | rows of things with a status | `pct` adds a progress bar; `tone` colours a row |
| `status` | services that are up or down | `group` sections them; `quiet` for things that sleep on purpose |
| `media` | what's playing or downloading | full-bleed artwork; `tags`, progress, time left |
| `shelf` | a row of artwork | `aspect` poster/square/wide; `stack: true` piles them up (documents, photos) |
| `photos` | photos to look at | `flashback` crossfades; `mosaic` (or size large) tiles them |
| `schedule` | a day's times | next one counts down live; `muted` times show but are never "next" |
| `forecast` | weather | now, high/low, the next hours with rain chance |
| `verse` | a verse or quote | original (right-to-left if Arabic), translation, reference |
| `controls` | switches, sliders, choices | each control names an action of the same integration |
| `chart`, `kv`, `text` | a graph, key–value rows, a sentence | |
| `code` | Logs or config: numbered lines, copy, and `diff: true` colours lines starting `+` and `-` | |
| `table` | `columns` and `rows`; numbers line up, and a tap on a heading sorts | |
| `showcase` | a custom visual with its panel | renderers live in `src/web/visuals/` |
| `group` | cards side by side | mostly for the assistant |

Any card can also carry:

- `summary` (or `summaries`): its headline, shown when the widget is placed with `size: small`, in the menubar, or as a tile.
- `activity`: set only while something is happening; the island shows it.
- `buttons`: quick actions along the bottom (`{ label, action, args }`), run through the integration's `actions`.

Sizes are the layout's business, not the integration's: every card works as small (its summary), medium and large,
and in chat (dense). Give a card a `summary` so the small size has something to show.

## Testing

- `checkCard(card)` from `src/shared/cards.schema.ts` validates a card against the catalog (strictly: unknown fields
  are errors). Use it in your integration's tests.
- `npm test` renders every sample card in every size and runs the integration tests, which feed each integration
  made-up responses (see `test/integrations.test.ts` for the pattern: a fake `ctx.http`).
- `npm run test:live` fetches every widget in your `config.yaml` from your real services and validates each card.
- `/#gallery` shows every sample card in every size. Add a sample to `src/web/samples.ts` when you add a card type.
