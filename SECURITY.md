# Security

Atrium talks to many of your services, so it holds keys to them. This page says what it does with them, how it limits
the damage if something goes wrong, and how to give it as little power as possible.

## What Atrium does with your keys

- **They stay on the server.** Keys live in `.env`; `config.yaml` refers to them as `${NAME}`. Only Atrium's server talks
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
  (`auth.mode: local` or `proxy`), or you set `auth.trustNetwork: true` because the network is the lock (a VPN or
  tailnet, or a sign-in proxy in front).
- **The assistant asks before it changes anything.** Each integration's access is set in `assistant.access`: `none`,
  `read`, `write` (may add things, like saving a link, without asking) or `control` (may change or remove things, and
  you approve each one). A document or web page the assistant reads can't talk it into acting: anything with
  consequences needs your click.
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
