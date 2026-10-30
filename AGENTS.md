# AGENTS.md

How Atrium is designed and built. Read this before changing anything; keep it current when a principle changes or a
new gotcha is learned. `CLAUDE.md`-style tools should treat this file as their instructions for this repo.

## What Atrium is

A homepage for a homelab: live cards for the services you run, controls for the things you can change, and an
assistant that answers with the same cards. One Node process, one YAML file, about 100 MB of RAM.

## Principles

### Product
- **Less is more.** Every element and every word earns its place. If a number, label or border doesn't help someone
  glance and know, it goes. Prefer one strong number to five weak ones.
- **Configurable by everyone, in one YAML file.** Anything personal (which services, which entities, where cards go,
  how they look) is config, never code. Every new option lands in `config.example.yaml` with a one-line comment and a
  sensible default, so a config that doesn't mention it keeps working.
- **Secrets never reach the browser.** Tokens live in the environment (`${VAR}` in YAML). The server talks to services;
  images go through `/api/image/:instance`, icons through `/api/icon/:slug`.
- **Light by default.** Only widgets placed on the page are polled, only while someone has it open, once for all tabs.
  Heavy things (the assistant, the AI SDK, MCP, 3D visuals) load on first use.
- **The assistant reads freely and changes nothing without asking.** Tools are `read` or `control`; control tools need
  the user's approval, and access is set per integration in YAML.

### Architecture
- **The card catalog is the contract** (`src/shared/cards.ts`). Integrations return plain data in these shapes; the web
  app renders them. Integrations never ship HTML, CSS or components. A new kind of display is a new card type in the
  catalog plus one renderer in `src/web/cards.tsx`, and then every integration and the assistant can use it.
- **An integration is one file** (`src/integrations/<name>.ts`): `defineIntegration` with a zod config schema,
  `widgets` (what the page shows), `actions` (what the page can do), `tools` (what the assistant can use), and optionally
  `image()` for proxied pictures. Register it in `src/integrations/index.ts`. Nothing else should need to change.
- **Widgets summarise themselves.** A card may carry `summary`/`summaries` (label, value, tone, trend, pct) so the same
  data can appear as a tile, a ring in the menubar, or a full card, chosen in YAML.
- **Rich visuals are framework-free modules** (`src/web/visuals/*-model.ts`): a `createViewer(box, options)` that
  builds DOM, takes `update(data)` and `select(id)`, and owns its own camera and interaction. React wraps it with a
  thin panel. That's what lets the PC model run unchanged on another app (`npm run export:pc-model`). Edit the model
  here and re-export; never fork it.
- **Visuals are lazy**: registered in `VISUALS` in `cards.tsx` with `lazy(() => import(...))`, so a page without them
  never downloads them. A showcase card with no `items` hands the whole card to its visual.
- **Server stays small.** Hono + node-server, bundled with esbuild into `dist/server.js`. No database: state lives in
  the services Atrium talks to.

- **Personal things live in config, never in code.** Hardware builds (`build:`), rooms and lights, services, layout,
  angles: the repo ships generic defaults and a documented `config.example.yaml`. Before committing, grep for anything
  that names the author's hardware, hosts or people.
- **Layout is data.** Sections choose how they draw (`display`), where they sit (`place`), how dense they are
  (`variant`, `header`, `columns`) and whether they're on the overview (`overview`); the tab buttons' side is `nav.side`.
  A new arrangement is a new option with a default, never a fork of the page.
- **Live things announce themselves.** A card sets `activity` only while something's happening; the island shows the
  live ones in the config's order and disappears when nothing is live.

### Design
- **Apple-grade restraint.** System tokens (`styles.css`): one accent (system blue), green/orange/red only for
  status, monochrome icons. Geist for text; tabular numerals for numbers.
- **Glass over a wallpaper.** With a wallpaper, every surface is frosted glass (`has-wallpaper`): translucent tint,
  heavy blur with boosted saturation, a hairline light edge, a sheen from the top. Floating chrome (top bars,
  popovers) is frostier than cards so it stays legible over content while scrolling.
- **Numbers as shapes.** Health reads at a glance: rings coloured by tone, area graphs behind tiles. Values sit inside
  the shape; labels stay quiet.
- **Motion is short and purposeful.** ~300 ms fades and scales for popovers; ~900 ms ease-out for a camera flying to
  a part. Respect `prefers-reduced-motion`.
- **Things don't jump.** Controls that change with a selection live in fixed-height rows; panels never resize their card.
- **Pointer on everything clickable** (global rule in `styles.css`); hover gives a slight lift, never a jump.
- **3D models are faithful to the real thing.** Model from photos of the user's hardware, keep proportions honest, and
  light parts in the colours they really are. If a state can't be read, draw what the hardware ships as and say so.

## Working on it

- `npm run dev` (server with `--watch` + Vite), `npm run check` (both tsconfigs), `npm run build`, `npm start`.
- Verify UI changes by looking at them: build, run, and screenshot the page (a headless Chrome over CDP works; set
  `Emulation.setEmulatedMedia` `hover: hover` to test hover states). Check desktop and phone widths.
- Keep comments sparse and about *why*. Match the surrounding code's density and idiom.
- Commits: one logical change each, a short summary line, a few bullets for anything non-obvious. No AI co-author trailers.

## Gotchas

- **CSS minifier vs `backdrop-filter`.** Lightning CSS treats `backdrop-filter` and `-webkit-backdrop-filter` as one
  property and keeps the *last*. Write only the unprefixed one (it adds the prefix); writing both left Chrome with no
  blur at all.
- **Chrome backdrop roots.** An ancestor with `opacity < 1`, `filter`, `mask` or its own `backdrop-filter` stops
  descendants from blurring the page. Put the frost on the element that fades (popovers), or on a `::before` of a bar
  (`.glass-bar`) so things inside can still blur.
- **`filter` flattens 3D** and tinted the model's glows. Dim 3D parts with an overlay (`::after`) and by lowering the
  light variable (`--lo`), not with `filter`.
- **Unlayered CSS beats Tailwind utilities.** A `position: relative` in `styles.css` overrode a `fixed` utility. Keep
  layout in utilities; custom classes style surfaces only.
- **Full-size layers in 3D** (cable SVGs the size of the case) cover everything behind them; exclude them from
  per-face overlays.
- **TypeScript 7**: no `baseUrl` (paths are relative); Node's type stripping needs `erasableSyntaxOnly` (no parameter
  properties, no enums).
- **SSE keeps pages busy**: headless tools waiting for network idle never finish; wait a fixed time instead.
