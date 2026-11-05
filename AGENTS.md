# AGENTS.md

How Valet is designed and built. Read this before changing anything; keep it current when a principle changes or a
new gotcha is learned. `CLAUDE.md`-style tools should treat this file as their instructions for this repo.

**Every change updates its docs.** A change isn't finished until the README, `docs/` and `website/src/content/docs/` match it, and anything the change makes out of date (screenshots, counts, examples, `CHANGELOG.md`) is updated in the same commit. Check before pushing; a change with nothing to update says so.

## What Valet is

A homepage for a homelab: live cards for the services you run, controls for the things you can change, and an
assistant that answers with the same cards. One Node process, one YAML file, about 45 MB of RAM on a fresh install. The public site is
https://askvalet.dev.

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
- **Secure by default** (the docs' security page is the contract). Keys stay on the server and pass through the redactor
  (`src/server/security.ts`) on the way out; without sign-in Valet is read-only unless `auth.trustNetwork`; strict CSP,
  so no inline scripts; image proxies validate every ref; new tools pick the narrowest access (`read` < `write` <
  `control`) and anything with consequences is `control`. Before committing: `npm audit --omit=dev` and the tests.
- **The assistant reads freely and changes nothing without asking.** Tools are `read`, `write` or `control`. Anything
  that isn't `read` needs the user's approval; `write` and `control` differ only in what's granted (adds, or changes and
  removes). Access is set per integration in YAML. Every tool has a `label` (its chip in chat) and may offer `followUps`.
- **A rule is the only standing approval** (`src/server/rules.ts`). Approved once, it runs one integration tool with no
  model, so what it may do lives in code, not in the card: never `config`, `valet` or `pins` tools, plans or MCP; its
  card is built from the widget's title and the action tool's own `confirm`, never the model's words; and before every
  run its access, its input and `site.acting` are checked again, and a refusal pauses it. Every call, chat, plan or
  rule, goes through `runTool` in `run.ts`. Anything new that acts unattended follows the same shape.

### Architecture
- **The card catalog is the contract** (`src/shared/cards.ts`). Integrations return plain data in these shapes; the web
  app renders them. Integrations never ship HTML, CSS or components. A new kind of display is a new card type in the
  catalog plus one renderer in `src/web/cards.tsx`, and then every integration and the assistant can use it.
- **An integration is one file** (`src/integrations/<name>.ts`): `defineIntegration` with a zod config schema,
  `widgets` (what the page shows), `actions` (what the page can do), `tools` (what the assistant can use), and optionally
  `image()` for proxied pictures, `recap()` for the year in review and `onChat()`, which names the widgets to refresh when
  someone asks the assistant something. Register it in `src/integrations/index.ts`. Nothing else should need to change.
- **Widgets summarise themselves.** A card may carry `summary`/`summaries` (label, value, tone, trend, pct) so the same
  data can appear as a tile, a ring in the menubar, or a full card, chosen in YAML.
- **Community integrations are plugins** (`src/server/plugins.ts`, docs/plugins.md): the same integration shape, one
  file in `data/integrations/` or an npm package, handed Valet's toolkit so it needs no imports. Their cards are
  checked against the catalog at runtime. A new built-in should be writable as a plugin too: if it needs something
  the toolkit or `Context` doesn't offer, add it there rather than special-casing the built-in.
- **Rich visuals are framework-free modules** (`src/web/visuals/*-model.ts`): a `createViewer(box, options)` that
  builds DOM, takes `update(data)` and `select(id)`, and owns its own camera and interaction. React wraps it with a
  thin panel. That's what lets the PC model run unchanged on another app (`npm run export:pc-model`). Edit the model
  here and re-export; never fork it.
- **Visuals are lazy**: registered in `VISUALS` in `cards.tsx` with `lazy(() => import(...))`, so a page without them
  never downloads them. A showcase card with no `items` hands the whole card to its visual.
- **Backups are one shape** (`BackupJob` in `core.ts`, `src/server/backups.ts`). An integration reports its jobs through
  `backups()` (a `service()` through `backups`/`backupGet`) and never judges them: Valet works out overdue, failing and
  odd sizes once, for the card, the tool, the timeline and the push, and tells each change once.
- **Server stays small.** Hono + node-server, bundled with esbuild (dependencies included, so the image ships no
  `node_modules`) into `dist/server/`. No database: state lives in the services Valet talks to.
- **A config is a Site** (`src/server/site.ts`): `check()` turns a config into instances and the list of problems
  (the CLI and tests use it alone); `buildSite()` adds the hub. `main.ts` keeps one `site` and swaps it when
  config.yaml changes, so routes read `site.x` at request time, never a captured copy.
- **A sandbox is a Site per visitor** (`sandbox: true`, `src/server/sandbox.ts`, `main.ts`). A cookie picks the visitor's own
  copy, `site` reads it through `AsyncLocalStorage`, and at most 40 live, each dropped after 15 idle minutes. Anything that
  saves must check `sandbox.on` and stay in memory instead; uploads and the config tools are off.

- **The service worker keeps one page** (`src/web/sw.js`, versioned by the build in `vite.config.ts`): "Valet can't be
  reached". Never the page, `/api/` or anything behind sign-in, so an update is never stale and a signed-out visitor sees
  nothing cached. Its other job is push. Valet's own notifications (`webpush.ts`, Node's crypto, no library) go wherever
  `site.push` goes; anything new that tells the owner something calls that, with `where` set to its widget.

- **AI is everywhere and required nowhere.** Without an `assistant:` block the page loses nothing. Rules decide when a
  model is worth asking; if a rule can do the job, no model runs. The status sentence is one of those rules (`sayHow` and
  `oneLine` in `format.ts`): two things at most, what needs someone first, and services off by choice don't count. What it does unasked (`src/server/insight.ts`, through
  `brain.ts`) gets no tools. What it builds (pins, config edits in `setup.ts`, rules) runs without it afterwards.
- **Valet stays in its box; agents go on the machines.** The container never gets the host. Anything from outside it
  comes through a narrow read-only door: a socket proxy for Docker, `agent/valet-agent.py` for systemd. Keep the agent one
  file of Python's standard library, and keep it unable to change anything: `test/agent.test.ts` enforces that.
- **Personal things live in config, never in code.** Hardware builds (`build:`), rooms and lights, services, layout,
  angles: the repo ships generic defaults and a documented `config.example.yaml`. Before committing, grep for anything
  that names the author's hardware, hosts or people.
- **The look is data too.** `src/shared/look.ts` turns the config into CSS variables and classes, `/api/page` carries them
  and `src/web/look.ts` applies them; `public/theme.js` restores them before first paint. An option left out adds nothing,
  so an empty result *is* the design, and `test/look.test.ts` holds that. A new visual option is a variable with a fallback
  in `styles.css`, never a value in a component. `format.ts` writes times, dates, numbers and `labels`: renderers call it
  instead of `toLocale…`, and new words the page writes go in `src/shared/labels.ts`.
  Light or dark is decided in two places that must agree: `applyTheme`/`forcedBy` in `look.ts` and its ES5 twin in
  `theme.js`, which reads the theme and whether there was a wallpaper from what `look.ts` last remembered.
- **The wall is its own page** (`wall:`, `src/server/wall.ts`, `src/web/wall.tsx`): pages written like `layout`, drawn read-only (no
  `run`, no pointer on cards, no palette or chat) and scaled to fill the screen. `wallReads` is everything a screen paired with
  `wall.token` may hear; main.ts holds it to that on `/api/page`, `/api/events` and `/api/image`, and refuses it everywhere else.
- **Layout is data.** Sections choose how they draw (`display`), where they sit (`place`), how dense they are
  (`variant`, `header`, `columns`) and whether they're on the overview (`overview`); the tab buttons' side is `nav.side`.
  A new arrangement is a new option with a default, never a fork of the page.
- **Sizes are the layout's job.** Every card works small (its `summary` as a tile), medium, large (four of six tracks, more room)
  and dense in chat. Integrations give a good `summary`; they don't pick sizes.
- **Live things announce themselves.** A card sets `activity` only while something's happening; the live ones are rings in
  the top bar, in the config's order, and they're gone when nothing is live. Notices from `live.notify` are toasts.

- **Charts are one plain module** (`src/web/charts.tsx`): the race, the stream, the year of days and the waffle, in SVG and CSS with
  no chart or animation library. Each draws from a card's numbers and says it's empty through `chartless`, which `isEmpty` reads, so
  a chart with nothing in it gives up its slot. The race's render is its final frame; one rAF loop writes `transform` and `opacity`
  straight to the DOM, stops when the rows settle, runs once a visit, and reads `calm()` itself because the central motion rule can't
  reach JavaScript. Line charts stay in `Chart`, columns in `Columns`.

- **What a card holds and how it's drawn are separate** (`src/shared/views.ts`). A widget's `view` turns numbers into any chart
  and pictures into any gallery, and what can't honestly become that view stays as it was. `asView` gives the same object for the
  same card, so memoised renderers stay still.
- **The house's cards measure themselves** (`src/web/home-cards.tsx`: `forecast`, `calendar`, `thermostat`). They're glass
  edge to edge with no header, pick their layout from their own box rather than a size name, and must never set a row's
  height by how much they have to show: anything that can grow scrolls inside or spreads out, so a bento row ends flush.

### Design
- **Quiet chrome, rich content.** System tokens (`styles.css`): graphite neutrals, one accent (brass), green/orange/red only for
  status, monochrome icons. Geist for text; tabular numerals for numbers.
- **Glass over a wallpaper.** With a wallpaper, every surface is frosted glass (`has-wallpaper`): translucent graphite,
  heavy blur, saturation near 1 so surfaces stay neutral, a hairline light edge. Floating chrome (top bars,
  popovers) is frostier than cards so it stays legible over content while scrolling.
- **Liquid glass is a second material, not a second design** (`glass-liquid`, `appearance.glass.material` or ⌘K per browser).
  It only swaps the `--glass-*`, `--card`, `--bar-*` tokens and adds a sheen; a surface that wants glass uses the tokens and gets
  both. `ink.ts` thickens a card's white tint in steps in light glass (liquid or frosted) over a darker patch of wallpaper (sampled
  once per settle, never per frame). Light mode never turns a card dark: light means light glass everywhere. The spec's SVG rim lens was tried and left out: over a 10px blur it barely shows and it cost
  ~20% of scroll frames.
- **The accent is rare.** In a chart one thing leads in the accent and the rest are neutral steps; a colour that isn't a
  status or the leader doesn't belong in the chrome. Posters, the house and photos carry the colour.
- **The title says whose homelab it is, not hello.** `hero.greeting: "{greeting}, {name}"` brings the time of day back.
- **One weight of emphasis.** `font-semibold` is mapped to 500 in `@theme` and `tracking-tight` to 0, so hierarchy comes from size
  and colour. Corners follow `--radius` (controls `* .6`, tags `* .4`); only things that hold no words stay round.
- **Numbers as shapes.** Health reads at a glance: rings coloured by tone, area graphs behind tiles. Values sit inside
  the shape; labels stay quiet.
- **Motion follows one vocabulary** (`styles.css`, after Emil Kowalski's skills): `--ease-out` for arriving/leaving,
  `--ease-in-out` for moving on screen, never ease-in; `--dur-press`, `--dur-pop`, `--dur-move` for UI (under ~300ms),
  `--dur-scene` for what isn't UI (a wallpaper, a photo, a room's light); animate transform,
  opacity and small blurs only, so a bar that ticks with every poll moves by `translateX`, not `width`; `scale(0.97)` press
  feedback; hover effects gated by `(hover: hover)`; nothing animates on keyboard actions. Name transitioned properties,
  never `transition: all`. Reduced motion lives in one rule near the top of `styles.css`, not beside each animation: new
  motion needs nothing, and hover or press movement scales by `--move`. `stage.css` and `pc-case.css` keep their own
  media rule because they ship with the exported model.
- **Feel lives in `feel.tsx`** (rewritten from Arc UI's free MIT items; nothing is imported, and the Pro items are unlicensed
  here). `Row` + `RowArrows` (same `id`): every row of artwork is a Blossom Carousel, a native scroller with CSS snapping, so
  touch keeps the phone's momentum and vertical scroll and a mouse can throw it; slides carry `data-blossom-slide`, the
  arrows are the only part that hears it move, and the slides sit in a `memo` so a live update doesn't redraw them.
  `focus.tsx` is the `focus` view (`coverflow` is its old name): sizes come from a scroll-driven animation; `Pile`: the reading card;
  `ElasticSlider`: Radix's slider with give at the ends; `Counter`: every number that changes, still on first paint and
  faster than 1.5 s (`flap` makes it a departures board, for a countdown); `useRows` + `RowSlot`: a list whose rows come and go, never
  on first paint or when the whole list is another list; `Tick`: draws itself only for what was seen unfinished; `toast(key, note)`: the page's stack, only for what piles up or a note whose place is out of view, with
  `by` to stay beside the action on a large screen, and swipeable sideways. A note beside its control stays there. A gesture writes transform and
  opacity directly and hands off to a CSS transition, so it can be caught mid-flight; `still()` reads `--move` for what JS moves.
- **What someone takes off the page leaves as dust** (`dust.ts`): `dissolve(el)` puts a copy where it was, masks it away from the
  left and blows a canvas of specks (coloured from a rough sketch of the element) up and to the right, ~700 ms, while the real one
  goes at once and its list closes (`RowSlot dust`, `useSettle`). Only for what someone just did: `acted()` marks an action or an
  approval and `justActed()` asks; a list that changed by itself keeps its quiet ways. Held still, it's a quick fade.
- **Sounds are opt-in and made, not loaded** (`sound.ts`): `play('tap' | 'done' | 'no' | 'notice' | 'send' | 'dust')` synthesises
  a few soft notes with Web Audio. `appearance.sounds` is the default, ⌘K's per-browser choice (localStorage) wins, and nothing plays
  before the first pointer or key press. A new sound goes in `SCORE`, short and quiet, and only on an event that means something.
- **Alive, not busy.** Motion explains a change. The chat shows work happening (a shimmering label with a timer, tool
  calls as chips that settle into a collapsed "n steps"), words fade in as they stream. Live numbers change digit by digit (`Counter`). Anything
  that happens many times a day stays still: no loops on status elements, no entrances on a load, no charts redrawing. The
  page holds itself hidden until 80% of the overview's widgets have reported, 0.9 s at most, and appears whole (`settled`,
  `main[data-settling]`). A tab change is a quick fade that each card does for itself, because fading the page around it
  would cut its glass off from what's behind. A card fades up only from its skeleton. What must loop (a model's fans, a chat.beam someone asked for) rests
  off screen (`useOnScreen`, `.is-away`).
- **Motion is short and purposeful.** ~200 ms fades and scales for popovers, growing from their trigger; ~900 ms ease-out
  for a camera flying to a part. Finished entrances use `backwards`, not `both`: a held fill stays in the page's
  animation list and keeps the element in its own stacking context.
- **Things don't jump.** Controls that change with a selection live in fixed-height rows; panels never resize their card.
- **The rim is painted once** (`appearance.rim`, feel.css): one `::after` under the content on every pane, on dark glass only, so `z-index: -1`
  needs its pane to be a stacking context (the rule isolates it) and full-bleed art covers it. A pane's corners aren't known to CSS: `--lit` is
  where to expect them.
- **Pointer on everything clickable** (global rule in `styles.css`); hover gives a slight lift, never a jump.
- **3D models are faithful to the real thing.** Model from photos of the user's hardware, keep proportions honest, and
  light parts in the colours they really are. If a state can't be read, draw what the hardware ships as and say so.

## Working on it

- **Every card type is tested.** `src/shared/cards.schema.ts` is the catalog as a strict schema; `src/web/samples.ts` has
  a made-up sample of every type. `npm test` validates the samples, renders each in every size (medium, large, chat)
  and as a tile, and runs integration logic against made-up responses (`test/integrations.test.ts`: a fake `ctx.http`).
  Adding a card type means: the type in `cards.ts`, its schema, a renderer, a sample, and the type in the test's list.
  `test/server.test.ts` covers sign-in, the hub, config loading and plugin card checks. `test/chat.test.ts` drives the
  chat with a scripted model: what it's offered, what asks first, what's redacted, what's logged. New safety rule, new test.
- `npm run eval:chat` asks a real model real questions against a made-up homelab (`test/chat.eval.ts`), so nothing real is
  touched. It catches what scripted tests can't: the wrong tool, a claim it can't back up, a poisoned document. When the
  assistant gets something wrong in real use, add it as a case. Run it after changing a tool description or the prompt.
- `npm run test:exposure` runs the real build (`npm run build` first) in every sign-in mode and attacks it from outside: every route in `main.ts` without a session, forged cookies, spoofed identity headers, raw path tricks. A new route needs nothing: it's found and it's locked. A route that must be open goes in `PUBLIC` in that file with its reason, and nothing with data qualifies.
- `npm run test:hostile` (after a build) gives Valet a model that is entirely the attacker's, in a made-up homelab with a
  fake secret and a stand-in for the attacker's server (`test/lab/`). Nothing may change without approval, and no secret
  may leave or power grow even with every approval clicked. A new tool that changes something gets a case there, and a
  rule that could use it is covered by `test/rules.test.ts`'s forbidden list.
- `npm run eval:inject` runs poisoned pages, feeds and bookmarks past your real model (from your config), blatant and
  hidden in what you ask for. It fails only on a guardrail, never on what the model chose; `EVAL_APPROVE=1` clicks every
  approval too.
- `npm run test:live` checks every widget in your `config.yaml` against your real services. `/#gallery` shows the whole
  library, including the live rings.
- Integration tests use made-up data only. Never commit recorded responses from real services (they carry personal data).

- A new option goes in the schema with a comment and default, in `config.example.yaml` if it's common, and in
  `docs/configuration.md`. `docs/services.md` is generated (`npm run docs:services`), and a test fails if it's out of date.
- `npm run dev` (server with `--watch` + Vite), `npm run check` (both tsconfigs), `npm run build`, `npm start`.
- Verify UI changes by looking at them: build, run, and screenshot the page (a headless Chrome over CDP works; set
  `Emulation.setEmulatedMedia` `hover: hover` to test hover states). Check desktop and phone widths.
- Keep comments sparse and about *why*. Match the surrounding code's density and idiom.
- The docs site is `website/`, its own package (Astro with Starlight), so nothing there touches Valet's dependencies. `npm run all` in
  it re-shoots and rebuilds; pages under `integrations/`, `cards/` and `reference/` are generated from the code, so edit `website/samples/`
  and `website/scripts/` rather than those. A new `service()` needs nothing; a new full integration needs a fixture in `website/samples/`,
  or `npm run check` there fails. Screenshots use invented data only, and the check greps the output for anything of the owner's.
- Commits: one logical change each, a short summary line, a few bullets for anything non-obvious. No AI co-author trailers.

## Gotchas

- **Text scales in the build.** A PostCSS step in `vite.config.ts` rewrites every `font-size` as a multiple of
  `--font-scale`, so `text-[13px]` follows `font.scale`. `em`, `%` and `inherit` are left alone, being relative already.
  Inline `fontSize` in a component doesn't scale.
- **`--spacing` is density.** Tailwind's spacing utilities all multiply it, so `top-24` shrinks with `compact`. Anything
  that must clear a fixed-size thing (the top nav under the bar) needs a literal `rem`, not a spacing utility.
- **CSS that reads a variable needs a fallback.** An unset `var()` without one is invalid at computed time, and the
  property falls back to its initial value: `border-width: var(--x)` is 0, not "whatever Tailwind said".
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
  per-face overlays. Better, don't make them: a cable's face is its own bounds (`cables()` in pc-model.ts).
- **Every 3D face is a compositor layer** the phone holds and draws on every frame, so the count is the cost (the house
  was 1,760 layers and stuttered on an iPhone). Faces are flat (`stage.css`), so what's drawn on them adds no layers;
  only a face whose children must sort in 3D opts back into `preserve-3d` (the robot, the PC's lit parts). The house hides
  box sides that face away and one face of each post (`turned`), and `.stage` has `content-visibility: auto` so a model
  off screen costs nothing. Count layers (DevTools Layers, or CDP `LayerTree`) before and after adding geometry.
- **TypeScript 7**: no `baseUrl` (paths are relative); Node's type stripping needs `erasableSyntaxOnly` (no parameter
  properties, no enums).
- **Video through the image proxy needs ranges.** Phones won't play a video from a server that ignores `Range`; `image(ref, range)`
  gets the header and `served()` passes the answer on. A picture that changes needs `Cache-Control: no-store` on the
  handler's response, or the browser keeps it for a day.
- **`create()` must have no side effects.** Config checks build instances for configs that never go live, so anything global belongs to the built site (`Instance.frame` is how an embed reaches the CSP).
- **Nothing that parses a stranger's text uses a backtracking regex.** A feed is linear by construction (`xml.ts`); `test/audit.test.ts` holds it to that.
- **Every signature names its purpose** (`signFor` in `auth.ts`). Two things signed by one key must not be interchangeable.
- **Glass traps `position: fixed`.** `backdrop-filter` makes a card the containing block for anything fixed inside it. Full-screen
  things go through a portal to the body (the cameras' theatre does).
- **SSE keeps pages busy**: headless tools waiting for network idle never finish; wait a fixed time instead.

- **cmdk 1.1.1 doesn't reorder groups.** Its `filter` orders the items inside a group and never the groups themselves, so
  `palette.tsx` scores each group with `rank` and sorts them itself. A new group goes in that list, not straight into the JSX.
- **Two small libraries from libraries.dev are in on purpose**, pinned exactly: `thinking-orbs` (the chat's working states and the
  recap's loading) and `border-beam` (`chat.beam` and the approval card). All MIT, no dependencies, no network. Left out:
  `img-fx` needs three.js; `liquid-gooey`, `bot-avatars` and `voice-glow` have no job here yet.
- **Blossom Carousel is pinned to `@blossom-carousel/react` 1.7.1** (MIT; its core comes with it). 1.8's `onCommand` and
  `onOverscroll` props don't exist in 1.7, so listen on the element instead. Its stylesheet sits in `@layer blossom-carousel`,
  declared first in `styles.css` so ours wins; it toggles `has-snap` while a throw glides, and its drag engine loads only for
  a fine pointer, so headless checks of dragging need one emulated.
