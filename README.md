# Atrium

A fast, good-looking homepage for your homelab, with an assistant built in.

Glance at what matters: what's playing, what's downloading, whether anything is down, how the server is doing. Control
things right from the page: lights, scenes, downloads. When you'd rather ask than look, ask: "how are my downloads
doing?", "is anything down?", "show me Plex and the GPU side by side". Answers come back as the same live cards the
homepage uses, not walls of text.

- **One YAML file.** Integrations, layout and the assistant live in `config.yaml`. Secrets come from the environment.
- **Light.** One Node process, about 100 MB of RAM. The page is ~75 KB gzipped; the assistant loads only when you ask
  something. Services are polled once, server-side, only while someone has the page open, and shared by every tab.
- **Your model, your rules.** Use a local model (Ollama, llama.cpp, vLLM, LM Studio) or a hosted one (OpenRouter,
  OpenAI, Anthropic). Decide per integration whether the assistant can read it, control it, or not touch it. Anything
  that changes something asks you first.
- **MCP.** Point Atrium at any MCP server and its tools become available to the assistant, under the same rules.
- **Built to be extended.** An integration is one TypeScript file: config schema, widgets, actions, assistant tools.

## Quick start

```sh
docker run -d --name atrium -p 7575:7575 \
  -v ./config:/config --env-file .env \
  ghcr.io/OWNER/atrium:latest
```

Copy [`config.example.yaml`](config.example.yaml) to `config/config.yaml` and keep the integrations you use. Copy
[`.env.example`](.env.example) to `.env` and fill in their keys: it says where each one is in that app's settings.
Then open http://localhost:7575. A [`docker-compose.example.yml`](docker-compose.example.yml) is there too.

Secrets never go in `config.yaml`: it refers to them as `${NAME}`, so you can share or commit your config safely.
`npm run test:live` (or the startup log) tells you which integrations can't reach their service, and why.

From source (Node 22.18+):

```sh
npm install
npm run build
cp config.example.yaml config.yaml   # then edit
npm start
```

## Integrations

| Type | What you get |
|---|---|
| `glances` | CPU, memory, GPU, temperatures, uptime, disks |
| `http` | Up/down and response time for any list of URLs |
| `qbittorrent` | Active downloads with posters (matched through Sonarr/Radarr), speeds, pause/resume |
| `tautulli` | What's playing on Plex (with posters), recently added, watch history |
| `homeassistant` | Cards of entities as live controls; a 3D floor plan from a robot vacuum's map with lights per room; schedules (e.g. prayer times) from timestamp sensors; search and control tools |
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

Writing one is covered in [docs/integrations.md](docs/integrations.md). Community integrations are single files you drop
into `data/integrations/`: see [docs/plugins.md](docs/plugins.md) and [`examples/hello-plugin.mjs`](examples/hello-plugin.mjs).

## Cards

Every widget and every assistant answer is built from one small catalog of cards (`stats`, `list`, `media`,
`status`, `chart`, `controls`, `kv`, `text`, `group`), defined in [`src/shared/cards.ts`](src/shared/cards.ts).
Integrations return plain data in these shapes; Atrium draws them. That's why a third-party integration looks native,
and why the assistant can lay out cards from different integrations side by side.

## Assistant access

```yaml
assistant:
  access: { default: read, home: control, downloads: none }
```

`read` tools fetch information. `control` tools change something, and each call waits for you to approve it in the
chat. Atrium never hands the model your API keys; tools run on the server.

## Licence

MIT. Geist (bundled via Fontsource) is under the SIL Open Font License.
