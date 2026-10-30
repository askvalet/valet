# Security

Atrium talks to many of your services, so it holds keys to them. This page says what it does with them, how it limits
the damage if something goes wrong, and how to give it as little power as possible.

## What Atrium does with your keys

- **They stay on the server.** Keys live in `.env` or Docker/Kubernetes secret files; `config.yaml` refers to them as
  `${NAME}` (or `${secret:name}`, `${file:/path}`). Only Atrium's server talks
  to your services. The page gets finished cards, and pictures (posters, document pages, photos) come through Atrium's
  own image proxy, which only fetches the kinds of things each integration expects (it checks every request).
- **They're scrubbed from everything that leaves the server.** Every value a `${NAME}` stood for is redacted from
  widget errors, live updates, action errors and assistant tool results, in case a service echoes one back.
- **The assistant never sees them.** It calls tools; the server makes the requests.
- **Nothing is stored that you didn't put there.** Chat attachments are kept for a day (to file them) and never served
  back out. Sign-in accounts, if you turn sign-in on, are scrypt hashes.

## What the page may do

- **Read-only unless you say otherwise.** With sign-in off (the default), Atrium only shows things: card buttons and
  controls are off, and the assistant only gets tools that look. It can change things only when sign-in is on
  (`auth.mode: local`, `oidc` or `proxy`), or you set `auth.trustNetwork: true` because the network is the lock (a VPN or
  tailnet, or a sign-in proxy in front).
- **The assistant asks before it changes anything.** Each integration's access is set in `assistant.access`: `none`,
  `read`, `write` (may add things, like saving a link, without asking) or `control` (may change or remove things, and
  you approve each one). A document or web page the assistant reads can't talk it into acting: anything with
  consequences needs your click.
- **What the assistant does unasked can only talk.** The morning brief, the shared-cause line and "Why?" call the model
  with no tools at all, so a poisoned feed title can at worst make it say something odd. They have a daily budget, and
  the model is only consulted when rules say it's worth it (one problem never is).
- **Suggestions can't carry a stranger's words.** A tapped suggestion is sent as your own message, so the model writes
  them without seeing feeds, Hacker News or Reddit, and any suggestion containing a link is thrown away.
- **It can't give itself more power.** Editing the config needs `assistant.access.config`, and each save needs your
  approval. Sign-in, plugins, MCP, allowed hosts and its own access are off limits, and secrets can't be written.
- **Another agent is its own thing.** If `assistant.agent` hands the chat to one (Hermes, say), it gets the conversation
  and nothing else from Atrium: no tools, no keys. But it runs its own tools, so everything above about access levels and
  approvals is about Atrium's assistant, not it. The chat says so, and a read-only page stays on Atrium's assistant.
- **Docker is read-only, and it has to be.** Point the integration at a socket proxy with `POST=0`, on a network only
  Atrium shares, as in `docker-compose.example.yml`; never mount the socket itself. Know what that still reads: the proxy
  allows GET on `/containers`, which includes each container's environment, so a compromised Atrium could read secrets kept
  there. Logs go to the model, so a hosted model sees them. Restarts aren't offered, because this proxy can't allow them
  without allowing container creation, which is root on the host.
- **The agent can only look.** `agent/atrium-agent.py` is one short file you can read. It runs on your machines so the
  container doesn't need access to them. It needs a token, answers only about the services you list, has no way to
  start or stop anything, and passes nothing unchecked to `journalctl`. Bind it to a private address.
- **Everything it changes is written down.** `data/activity.json` records who asked, how, what it did and whether it
  worked, with secrets redacted. Plans run only tools its access level allows, after you've seen every step.
- **Reminders can only tell you things.** A reminder fires a message; it can't run a tool.
- **Pins only look.** Only `read` tools can be pinned, and no model runs after that.
- **Browser hardening.** A strict content-security policy (only Atrium's own scripts run), no framing, same-origin
  referrers, microphone only for Atrium, and every request that changes something must come from Atrium's own origin.
- **The container is locked down** in the example compose file: not root, read-only filesystem, no Linux capabilities,
  no privilege escalation. Production dependencies are pinned (`package-lock.json`) and `npm audit` is clean.

## Give it as little as possible

Each service decides what its keys can do. Prefer the narrowest kind it offers:

| Service | Least-privilege option |
|---|---|
| Immich | An API key with only read permissions (asset, album, person, memory, timeline) |
| Home Assistant | A separate non-admin user for Atrium, and its long-lived token. Expose only the entities you want to Assist for MCP |
| Paperless-ngx | A separate user with view permissions (add "add document" only if you want filing from chat) |
| Pi-hole | An app password (Settings → Web interface/API), not your admin password |
| Uptime Kuma | An API key (Settings → API Keys); it only reads metrics |
| Sonarr / Radarr / Prowlarr / Bazarr | These apps only have full API keys. Keep `assistant.access` at `read` for them unless you want "search for missing" |
| qBittorrent | Its web login can do everything; keep `assistant.access` at `read` unless you want pause/resume from chat |
| Seerr | Its API key acts as the admin; requests from chat ask you first |
| Tautulli | Its API key; stopping a stream from chat asks you first |
| Karakeep | An API key (it can add bookmarks; saving from chat is `write`) |

And the general rules:

- **Don't expose Atrium to the internet.** Reach it over a VPN or tailnet, or put a sign-in proxy in front, or turn on
  `auth.mode: local`. It's a control panel for your home.
- Keep `.env` readable only by you (`chmod 600 .env`). Never commit it; `config.yaml` is safe to share.
- Turn on only the integrations you use, and only give the assistant the access you want it to have.

## Plugins

Community integrations (see [docs/plugins.md](docs/plugins.md)) run inside Atrium with the same access as the built-in
ones, including the keys you give them. Install only plugins you trust, and read them first: they're single files.
Their cards are checked against the card catalog, but their code isn't sandboxed: anyone who can write to
`data/integrations/` can run code as Atrium, so keep that folder (and the data volume) writable only by you.

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this
repository ("Security" → "Report a vulnerability"). You'll get a reply within a few days.
