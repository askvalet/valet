# Changelog

Notable changes to Valet. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `appearance.theme: system` follows the device over a wallpaper too: light glass when the phone or computer is in light mode, dark glass in dark mode, and the page turns when the device does (at sunset, say), without a reload. The light/dark switch in the top bar shows over a wallpaper then, and overrides it in that browser only; switching back to what the device says follows the device again. The wall display follows the screen with `system` and stays dark otherwise. `auto` is unchanged: dark glass over a wallpaper, as before.
- A wallpaper for each theme: `appearance.wallpaper: { light: …, dark: … }` (and the same in `wallpapers`, per tab). `dim` and `blur` take `{ light, dark }` too. The plain forms work as they did.
- The demo follows the visitor's device.

### Changed

- Light mode over a wallpaper is light on every card. A card over a darker part of the wallpaper used to turn dark with light text in liquid glass; now it keeps its light glass and dark text and thickens its white tint (and, in liquid glass, its blur) until the words read. Frosted light glass does the same.

### Fixed

- No flash of light before dark glass over a wallpaper on load: the page remembers whether it had a wallpaper and decides its theme before the first paint.

## [0.1.8] - 2026-11-04

### Added

- Liquid glass, to try: `appearance.glass.material: liquid` swaps the frosted glass for a clearer one. The blur is lighter and keeps the wallpaper's colour, the edge is lit from the top left, there's a soft shadow and a sheen inside, and hovering a card brightens its glass. In light, a card over a dark part of the wallpaper turns dark with light text, and the cards in a row decide together. Frosted stays the default. Any browser can flip between the two in ⌘K (**Liquid glass**, under This device), and the demo can too.
- With liquid glass, asking your system for reduced transparency or high contrast makes every surface solid.

## [0.1.7] - 2026-11-04

### Added

- Online meetings from your calendar. Valet finds the meeting link in each event (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo and a few more), and from ten minutes before a meeting until it ends the calendar's ring counts down ("in 4 min", then "Now · 20 min left") with a **Join** button. Two at once: the one on now leads and the ring says "+1".
- Meeting reminders: a minute before (or any list of times), one notification per meeting to your channels and to devices with notifications on. Tapping it on a device opens the meeting. Each is sent once, kept in `data/reminders.json`, so a restart never sends it again.
- Calendar rows show the meeting's service and a small Join button. ⌘K has **join meeting** (opens the next or current one) and **next meeting**; the assistant has `calendar_next_meeting`, and `calendar_upcoming` returns join links.
- `calendar.meetings`: `lead`, `remind`, `push` and `me` (your address, so meetings you declined are left out), or `false`. It works with no config.
- Calendars read time zones (a meeting set in New York lands at the right time anywhere), moved and cancelled occurrences of a repeating event, `DURATION`, monthly rules like "second Tuesday" or "last Friday", and leave cancelled events out.
- Integrations and plugins can say things at a set time with `reminders()`; a command can open a link with `open: true`; an activity can carry a `countdown` and a `link`, and a list row a `link`.
- The demo has an online meeting a few minutes away.
- Valet's docs in ⌘K: type what you're looking for ("wallpaper", "backups", "sonarr") and a **Docs** group under everything else offers the pages and sections about it, opening on askvalet.dev at the right heading. "docs" or "help" alone offers the main pages. The search runs on Valet's own copy of the docs, so it works offline, and on a read-only page too.

### Security

- Calendar text is other people's invitations: only an https link on a known meeting service becomes a Join button, its host is always shown, and the link is scanned without a backtracking regex. A notification opens a link only if it's https.

## [0.1.6] - 2026-11-04

### Fixed

- A config with a `notify:` block from before 0.1.5 (channels or insights, and no `webPush`) loads again. In 0.1.5 it stopped Valet from starting.

## [0.1.5] - 2026-11-04

### Added

- Backup health: one **Backups** card (`valet.backups`) with every backup job your services report, failed and overdue ones first, then the rest with when they last worked, their size and a small line of it run by run. A sudden drop or jump in size is flagged as worth a look. Overdue means no success within the job's schedule, `backups.expect`, or `backups.overdue` (26 hours). Going wrong and coming right are told once each, on the page, on the timeline and through `notify.channels`, checked every 15 minutes even with the page closed. Ask "are my backups ok?", or type **backups** in ⌘K.
- Backrest, Kopia, Duplicati, Proxmox VE, Proxmox Backup Server, Home Assistant (its automatic backups), TrueNAS (cloud sync and replication) and Healthchecks (checks named for a backup) report their jobs to it. Integrations and plugins join with `backups()`, and a `service()` with `backups` and `backupGet`.
- A wall display at `/wall` (and **Wall display** in ⌘K): a full-screen page for a wall tablet or a spare monitor, with the time and weather large across the top and the cards you pick below, sized to fill the screen. It's its own page in the config, `wall:`, written like `layout`, with pages that take turns (`every`, a touch holds one for `pause`). Left out, it shows your services and what's playing or downloading. It never acts, whoever is signed in: no chat, ⌘K, buttons or links. It dims nearly to black from sunset to sunrise (or set times), keeps the screen awake where the browser allows, and hides the pointer.
- `wall.token`: pair a screen that can't sign in by opening `/wall#key=<token>` once. That browser can read the wall's cards and nothing else.
- The weather card knows today's sunrise and sunset (`sun`), which the wall dims by.
- The demo has three wall pages.
- Valet as an app: add it to a phone's Home Screen or install it on a computer, and it opens in its own window with Valet's icon and your title. When the server can't be reached it says so, instead of the browser's error page. See [Valet as an app](https://askvalet.dev/start/app/).
- Notifications on this device, from ⌘K: Valet's own push notifications, with no ntfy or Telegram needed. Everything that goes to your channels (reminders, rules, `live.notify` with `push: true`, insights) goes to these devices too, and a notification opens the tab it's about. On iPhone and iPad it needs Valet on the Home Screen, and the switch says so. `notify.webPush` sets the contact and push services; it's on by default and sends nothing until a device turns it on.

### Security

- The service worker caches only the "can't be reached" page, never the page, its data or anything behind sign-in. Turning notifications on needs what a button needs. Each notification is encrypted for its browser and signed with Valet's own key, kept in `data/vapid.json` (0600), and Valet posts only to the browsers' push services. The CSP names `worker-src 'self'` and `manifest-src 'self'`.

## [0.1.4] - 2026-11-04

### Security

- The copy of the config kept for undo (`config.yaml.previous`) is readable only by Valet's user, like the config itself.

### Added

- What you take off the page leaves as dust: archiving a saved link, clearing finished to-dos, removing a rule or a torrent, unpinning a card, **Not now** on an approval and dismissing the year in review. It comes apart from the left and drifts off while its room closes. Lists that change by themselves still just change, and reduced motion gets a plain fade.
- A context meter in the chat: a small pie beside the model's name, from the tokens the model reported for its last step, with the numbers on hover and a fresh chat offered when it's nearly full. Known Claude models know their window; `assistant.contextWindow` sets it for anything else.
- Sounds, off by default: `appearance.sounds: { enabled, volume }`, made in the browser with no files, for a switch, something done, a "not now", a notice, a message sent and something taken off. ⌘K turns them on or off for one browser.
- Small touches: switches on a spring, a tick on an approval's button, the send arrow lifting out as the stop square arrives, notices that swipe away, the copy icon drawing its tick, posters that lean from the pointer, and Desk and List sliding their pill.
- GitHub repositories: a `traffic` widget and tool for your own repos, with views, visitors, clones and where visitors came from over GitHub's last 14 days. It needs a token that can push to the repo.

### Changed

- The chat's working orbs: a sphere of orbiting particles while it waits for the first words, a sweeping globe while it thinks, a constellation for a lookup and a rolling wave for an action.
- A config diff, the assistant's included, shows each change with a line either side and folds what's unchanged between two changes, rather than every line from the first change to the last. A list written one short entry to a line (`- { widget: a, size: large }`) gets new entries written the same way.

### Fixed

- To-do list: ticking something off on the page works: the switch now says which item it is.
- The chat's send button over a wallpaper is a white square with a dark arrow again; the arrow had gone white on white.
- "Thinking" no longer starts at -0.0s.
- A config edit that replaced or removed the first key of a list entry (a section's `title`, say) no longer drops its `- `, which turned the entry into part of the one above.

## [0.1.3] - 2026-11-03

### Added

- Proxmox VE, Speedtest Tracker, Syncthing, Backrest and Healthchecks.io are full integrations. Proxmox shows every node and guest with its CPU, memory and uptime and the storage pools by fill, and can start, shut down or reboot one guest. Speedtest Tracker charts the last days and can run a test. Syncthing shows folders and devices, out of sync first, and can rescan a folder. Backrest shows each plan's last backup and the next, and can run one now. Healthchecks shows each check with its last ping, and can pause and resume one. Everything that changes something asks first, and their old `status` widget and settings still work.
- Mealie and Tandoor are full integrations: this week's meal plan from today, a recipe of the day with its photo, and new recipes. The assistant searches and reads recipes and adds to the shopping list, asking first.
- Komga and Kavita: continue reading with covers and how far along, what's next in a series (Komga) and what was added lately. The assistant searches the library and says what you're reading.
- Miniflux: the unread articles as a pile to step through (archiving one marks it read), unread per feed, and starred. The assistant searches and reads entries, and marks them read or stars them, asking first.
- Jellyfin, Emby, Navidrome and Audiobookshelf are full integrations: what's playing (with its ring in the top bar), what you're partway through and what's new, with posters and covers. Navidrome adds recently and most played and albums to rediscover; Audiobookshelf, books in progress and your listening this week. The assistant can search each library, and stop a Jellyfin or Emby stream after asking. Existing configs keep working, `status` widget included.
- Rules: standing instructions like "when a download finishes, tell me and pause the rest" or "every morning at 7, if anything is down, tell me". Set up in chat with one approval, whose card names the trigger by the card's title and the action in its tool's own words, then run every half minute with no model. A rule runs one integration tool (never the config, Valet's own tools, plans, pins or MCP), is checked again against `assistant.access` before every run, waits out a cooldown, and pauses itself after three failures. Every run goes in the activity log, the timeline and your notifications. `valet.rules` lists them with Pause and Remove.
- List rows can carry their own buttons.
- Plain commands in ⌘K, run by rule with no model: "pause downloads", "lights off", "what's playing", "pause ads 10 min", "stop plex". Typed exactly, Enter runs one at once: something that looks shows its card, anything that changes something shows the approval card first. A half-typed command is offered below Ask, two that match are both shown, and when nothing matches Enter asks the assistant. They follow the chat's access levels and are logged as `by command`; with no assistant they run page actions and tools that only look. qBittorrent, Pi-hole, Plex (Tautulli), Home Assistant (every light, switch and scene it may control, by name), Seerr, the PC's presets, Sonarr and Radarr, Prowlarr, changedetection.io, Docker and the to-do list have them, and plugins can add their own (`commands`).
- Pi-hole's and Prowlarr's status tools answer with their cards.

### Changed

- `assistant.access.valet` defaults to `control`, which setting up a rule needs. `valet: write` keeps reminders and turns rules off.
- Turning a light on or off, or sending the vacuum, from chat answers with the floor plan as it is now. Pausing or resuming downloads answers with the downloads card.
- The docs say what the code does: which `${NAME}` values are redacted, which keys the config tools leave alone, that a sandbox has no MCP server, which integrations take `insecure`, and Frigate's options.

## [0.1.2] - 2026-11-03

### Changed

- Pausing Pi-hole from chat answers with its chart, now showing the pause and its countdown.
- A config edit that can't be applied is flagged on read-only pages too, without the error itself, which stays with people who can change things.
- The MCP server reports Valet's real version.
- The image no longer carries the README's pictures: 165 MB again.

## [0.1.1] - 2026-11-03

### Added

- Valet as a read-only MCP server (`mcpServer`): your own AI client can look at your homelab through Valet's read tools, behind its own token and access, with results redacted and every call logged.
- The welcome card lists the services it recognises running on the machine, through a read-only Docker socket proxy, each with the lines it takes. With an assistant that may edit the config, one click or "What do you run?" sets them up in chat.

### Changed

- A config edit that can't be applied now says so on the page, with the error, until the next good save. Before, only the log said.
- The top of the overview takes less room.
- The demo is honest about what Valet can do: it explains why a service is down but doesn't pretend to restart it (Valet reads Docker through a read-only proxy). Approvals are shown with pausing Pi-hole and stopping a stream instead, which real Valet does.
- The docs and README no longer claim actions Valet doesn't have, and say plainly which changes ask first: anything the assistant does.
- Saving the config no longer flashes the page empty: cards keep what they show until the new answers arrive.
- A new wallpaper always shows after a save, even when the new file has the same timestamp as the old one.
- Local AI and PC read a published JSON format, so they work with your own endpoint: only `/api/live` is needed for Local AI, the PC's screen preview is optional, and a field that doesn't fit is named in the error. `examples/local-ai/` serves Local AI's format from nvidia-smi and Ollama.
- ROADMAP.md is gone; the changelog says what shipped.
- The year-in-review link waits until there's a story: a near-empty install doesn't offer it.
- The quick start creates `.env` before `docker run` needs it.
- The demo's model shows "(demo)" beside its name, since it's scripted.

## [0.1.0] - 2026-11-03

The first public version.

### Security

From an audit before the first release. Everyone signed in has to sign in once more, because sessions are signed differently now.

- OpenID Connect: the cookie that starts a sign-in could be used as a session, which gave anyone full access. Everything signed now says what it's for.
- Previewing a config edit could send a `${NAME}` to any address without asking. A preview now contacts nothing; `config_try` fetches, and asks first.
- A secret now only goes to hosts it already goes to, judged on the resulting file.
- Approvals are signed by the server. Plan cards use each tool's own words, and a vague name is refused rather than matched to the first thing it fits.
- `/api/confirm` checks input and the read-only rule. The image proxy passes an exact list of types and keeps its own policy.
- Hostile feeds, oversized replies and redirects to another host can no longer stall Valet, fill its memory or carry a key away.
- An unverified email can't be who signs in through OpenID Connect, however the name is picked. A redirect to another host never carries a body. A card's link doesn't count as somewhere its key may go.
- A config edit that reaches a new address (a wallpaper, an embed, a service) says so on its approval card. A key under a section that didn't exist yet no longer lands at the top of the file.
- Sign-ins and failures are logged. Passwords are hashed to OWASP's floor for scrypt, and older ones are rehashed at the next sign-in. HSTS is sent. Release images carry provenance and an SBOM.

### Added

- Live cards, tabs and layout from one YAML file, with 185 integrations.
- An optional assistant with per-integration access and an approval for every change.
- `view`, to draw any numbers as any chart and any pictures as any gallery, including `coverflow` and `album`.
- `rows`, so a widget can span rows.
- A year in review, written from your services' own numbers.
- `sandbox: true`, which saves nothing and gives each visitor a private copy.
- A demo that runs entirely in the browser, built with `npm run demo:static`.
- Docker images for amd64 and arm64, published on each release.
- The year in review ends on your card: no more "The Generous Seeder" style personalities.
- A config edit from chat that has to reprint only rewrites the entry it changes, in the file's own brace style; it used to reformat the whole file.
- Live activities as rings in the top bar, configured under `live`.
- `npm run test:hostile`, in CI: a model that is entirely the attacker's, against every guardrail. `npm run eval:inject` runs poisoned content past your own model.
- `npm run test:exposure`, in CI with `npm audit`, a secret scan of all of history, and CodeQL once the repo is public.
- The assistant answers from Valet's own docs, can change the look as well as the page from chat, undoes its last save, and writes up a bug as a filled-in GitHub issue.
- changedetection.io as a full integration: each watch with what it last saw and what changed, failures first, and assistant tools to read, add, check and remove watches.
- Plain-English approval cards for every action that changes something.
- 3D models of the home and the PC, cameras, a thermostat and a calendar.
- MCP servers as assistant tools, and single-file community integrations.

[Unreleased]: https://github.com/askvalet/valet/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/askvalet/valet/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/askvalet/valet/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/askvalet/valet/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/askvalet/valet/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/askvalet/valet/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/askvalet/valet/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/askvalet/valet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/askvalet/valet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/askvalet/valet/releases/tag/v0.1.0
