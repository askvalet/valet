# Valet

**Talk to your homelab.** A fast, good-looking homepage with an assistant built in, and it only gets the keys you hand it.

Glance at what matters: what's playing, what's downloading, whether anything is down, how the server is doing. Control
things right from the page: lights, scenes, downloads. When you'd rather ask than look, ask: "how are my downloads
doing?", "is anything down?", "show me Plex and the GPU side by side". Answers come back as the same live cards the
homepage uses, not walls of text.

- **One YAML file.** Integrations, layout and the assistant live in `config.yaml`. Secrets come from the environment.
- **Light.** One Node process, about 35 MB of RAM, a 160 MB image. The page is ~95 KB gzipped; the assistant loads only when you ask
  something. Services are polled once, server-side, only while someone has the page open, and shared by every tab.
- **Your model, your rules.** Use a local model (Ollama, llama.cpp, vLLM, LM Studio) or a hosted one (OpenRouter,
  OpenAI, Anthropic). Decide per integration whether the assistant can read it, control it, or not touch it. Anything
  that changes something asks you first.
- **MCP.** Point Valet at any MCP server and its tools become available to the assistant, under the same rules.
- **Built to be extended.** An integration is one TypeScript file: config schema, widgets, actions, assistant tools.

## Quick start

```sh
docker run -d --name valet -p 127.0.0.1:7575:7575 \
  -v ./config:/config -v ./data:/app/data --env-file .env \
  ghcr.io/ibrahimirfan/valet:latest
```

On first start Valet writes a starter `config/config.yaml` and the page walks you through it; or copy
[`config.example.yaml`](config.example.yaml) there and keep the integrations you use. Copy
[`.env.example`](.env.example) to `.env` and fill in their keys: it says where each one is in that app's settings.
Then open http://localhost:7575. A [`docker-compose.example.yml`](docker-compose.example.yml) is there too, and
[docs/configuration.md](docs/configuration.md) lists every option. `./data` keeps the wallpaper, icon cache, history,
accounts and plugins. Publish the port on `127.0.0.1` (as above) when a reverse proxy on the same host fronts it.

Secrets never go in `config.yaml`: it refers to them as `${NAME}`, so you can share or commit your config safely.
`npm run test:live` (or the startup log) tells you which integrations can't reach their service, and why.

Config edits apply live, and `docker exec valet node dist/server.js config check` names every problem in the file.

From source (Node 22.18+):

```sh
npm install
npm run build
cp config.example.yaml config.yaml   # then edit
npm start
```

## Security

Valet holds keys to your services, so it's built to keep them: they never leave the server, they're redacted from
anything it sends out, it's read-only until you turn on sign-in (or trust your network), and the assistant asks before
changing anything. [SECURITY.md](SECURITY.md) has the details and the least-privilege key to give each service.

## Integrations

| Type | What you get |
|---|---|
| `glances` | CPU, memory, GPU, temperatures, uptime, disks |
| `http` | Up/down and response time for any list of URLs |
| `qbittorrent` | Active downloads with posters (matched through Sonarr/Radarr), speeds, pause/resume |
| `tautulli` | What's playing on Plex (with posters), recently added, watch history |
| `homeassistant` | Cards of entities as live controls; a 3D floor plan from a robot vacuum's map with lights per room; schedules (e.g. prayer times) from timestamp sensors; a thermostat dial for climate entities; search and control tools |
| `aimonitor` | GPU load, power, VRAM and model status for a local-AI monitor |
| `arr` | Sonarr/Radarr: episodes and movies coming up, as posters with the day |
| `seerr` | Search and request movies and shows from chat; your requests as posters |
| `immich` | Photo search by what's in a picture, by person, place or date; "On this day" flashbacks |
| `paperless` | Ask about your documents; paste or attach to file one; recent documents |
| `karakeep` | Send a link to save it; search what you've saved |
| `pihole` | Share of traffic blocked, a day of queries, pause/resume |
| `uptimekuma` | What's up or down, 30-day uptime, certificates about to expire |
| `scrutiny` | Drive health, temperatures, age |
| `romm` | Recently added games with box art |
| `indexers` | Prowlarr indexer health, Bazarr missing subtitles |
| `ollama` | Installed and loaded local models |
| `rgb-control` | A live 3D model of your PC with its lighting and temperatures |
| `weather` | Now, today's range and the next hours (Open-Meteo, no key) |
| `quran` | A verse of the day from a self-hosted Quran site |
| `rss` | Any RSS or Atom feeds (blogs, news, YouTube channels, podcasts), as a list or a shelf of thumbnails |
| `hackernews` | The front page |
| `reddit` | Posts from your subreddits |
| `releases` | Latest releases of the GitHub projects you run |
| `markets` | Stocks, indices, currencies, crypto, with the day's line |
| `calendar` | What's coming up and a month to browse, from any iCal link (Google, iCloud, Nextcloud, Outlook, Proton) |
| `links` | Bookmarks, grouped, with favicons |
| `docker` | Containers, why they stopped, logs, resource use and which have updates (with warnings from their release notes), through a read-only socket proxy |
| `host` | systemd services on any machine, with logs, through a small read-only agent |
| `api` | Any JSON API as a card, from YAML alone: numbers, a list, a table or up/down |

Writing one is covered in [docs/integrations.md](docs/integrations.md). Community integrations are single files you drop
into `data/integrations/`: see [docs/plugins.md](docs/plugins.md) and [`examples/hello-plugin.mjs`](examples/hello-plugin.mjs).

## Cards

Every widget and every assistant answer is built from one small catalog of cards (`stats`, `list`, `media`, `shelf`,
`status`, `links`, `chart`, `code`, `table`, `controls`, `showcase`, `forecast`, `photos`, `schedule`, `verse`, `kv`, `text`, `group`), defined
in [`src/shared/cards.ts`](src/shared/cards.ts). Each works as a small tile, a card, a wide card and inside the chat;
`/#gallery` shows them all.
Integrations return plain data in these shapes; Valet draws them. That's why a third-party integration looks native,
and why the assistant can lay out cards from different integrations side by side.

## Assistant access

```yaml
assistant:
  access: { default: read, home: control, downloads: none }
```

`read` tools fetch information. `write` tools add something (save a link, file a document), and `control` tools change
or remove something. Both wait for you to approve each call in the chat. Valet never hands the model your API keys;
tools run on the server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: `npm install`, `npm run dev`, and `npm test` before a pull
request.

## Licence

MIT. Geist (bundled via Fontsource) is under the SIL Open Font License.
