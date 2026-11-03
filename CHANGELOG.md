# Changelog

Notable changes to Valet. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Mealie and Tandoor are full integrations: this week's meal plan from today, a recipe of the day with its photo, and new recipes. The assistant searches and reads recipes and adds to the shopping list, asking first.
- Komga and Kavita: continue reading with covers and how far along, what's next in a series (Komga) and what was added lately. The assistant searches the library and says what you're reading.
- Miniflux: the unread articles as a pile to step through (archiving one marks it read), unread per feed, and starred. The assistant searches and reads entries, and marks them read or stars them, asking first.

### Changed

- Turning a light on or off, or sending the vacuum, from chat answers with the floor plan as it is now. Pausing or resuming downloads answers with the downloads card.

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

[Unreleased]: https://github.com/askvalet/valet/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/askvalet/valet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/askvalet/valet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/askvalet/valet/releases/tag/v0.1.0
