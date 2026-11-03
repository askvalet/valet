<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="Valet">

# Valet

**Talk to your homelab.**

A self-hosted, open-source, AI-native homepage.

[![CI](https://github.com/askvalet/valet/actions/workflows/ci.yml/badge.svg)](https://github.com/askvalet/valet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE)
[![Node 22.18+](https://img.shields.io/badge/node-22.18%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![185 integrations](https://img.shields.io/badge/integrations-185-d9b56c)](docs/services.md)

[**Live demo**](https://demo.askvalet.dev) · [**Docs**](https://askvalet.dev) · [Quick start](#quick-start) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)

<br>

<a href="https://askvalet.dev/film/valet.mp4"><img src="docs/images/film.webp" alt="Play the 70-second film: the main screen, asking why a service is down, approving a restart, adding a card from chat, and the integrations" width="100%"></a>

<sub>▶ <a href="https://askvalet.dev/film/valet.mp4">Watch the 70-second film</a> · or <a href="https://demo.askvalet.dev">try the demo</a>, right in your browser</sub>

</div>

<br>

## Why Valet

Valet is a homepage for your homelab that can also do things. Here's what it's good at, and where it's still rough.

**It shows what's going on, not just links.** What's playing, what's downloading, what's down and why, with real
artwork and graphs. The 3D floor plan and PC model are there if you want them, and easy to leave out if you'd rather
have a denser page.

**You can act from it.** Pause a download, restart a service or turn off the lights without opening each app. How much
you can do depends on the integration: some only read.

**It's one YAML file.** Every section, card and wallpaper lives in `config.yaml`. That's nice if you like config files
and less nice if you don't, because there's no visual editor yet. There are 185 integrations, some more battle-tested
than others, and anything with a JSON API works through `type: api`.

**The AI is optional.** Turn it on and you can ask why something is down and get an answer from the logs, or ask for a
new card and it edits the config for you. It works with a local model or a hosted one, it never sees your API keys, and
every change waits for your approval. Leave it off and you still have a complete homepage.

**It's light.** One Node process, about 45 MB of RAM on a fresh install, a 166 MB image. MIT licensed, runs on your own
hardware, no account, no telemetry.

**It's new.** The first release was in November 2026, so expect rough edges, and please open an issue when you hit one.
The demo shows a fully set-up homelab. A fresh install starts nearly empty and fills in as you connect your services.

## Screenshots

From the [demo](https://demo.askvalet.dev), which runs on made-up data. Yours shows whatever you connect.

<table>
<tr>
<td width="50%"><img src="docs/images/chat.webp" alt="The assistant reads Mealie's logs, explains the crash and asks before restarting it"><br>Asking why Mealie is down. Restarting it waits for approval.</td>
<td width="50%"><img src="docs/images/models.webp" alt="A 3D floor plan with live lights beside a 3D PC with lighting presets"><br>Home Assistant lights on a floor plan, and PC lighting.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/services.webp" alt="Services tab with Pi-hole, drive temperatures, containers and updates"><br>Pi-hole, drives, containers and pending updates.</td>
<td width="50%"><img src="docs/images/media.webp" alt="Media tab with a bar chart race of the year, most watched and a viewing heatmap"><br>Watch history from Tautulli.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/home.webp" alt="Home tab with a live camera view with detections, a thermostat and daylight"><br>Cameras with detections, and a thermostat.</td>
<td width="50%"><img src="docs/images/library.webp" alt="Library tab with a photo album of sliding strips and a Cover Flow of books"><br>Photos from Immich and books.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/recap-race.webp" alt="Year in review screen showing the most watched title with a race chart"><br>The year in review, built from your services' numbers.</td>
<td width="50%"><img src="docs/images/phones.webp" alt="Valet on three phones: overview, home and library"><br>The phone layout.</td>
</tr>
</table>

## Quick start

```sh
mkdir valet && cd valet && touch .env   # secrets go in .env, as ${NAME} in the config
docker run -d --name valet -p 127.0.0.1:7575:7575 \
  -v ./config:/config -v ./data:/app/data --env-file .env \
  ghcr.io/askvalet/valet:latest
```

Open <http://localhost:7575> and the page walks you through the rest. The [install guide](https://askvalet.dev/start/install/) covers Docker Compose and running from source.

## Documentation

Everything else lives at **[askvalet.dev](https://askvalet.dev)**:

- [Your first config](https://askvalet.dev/start/first-config/)
- [185 integrations](https://askvalet.dev/integrations/), each with screenshots
- [The assistant](https://askvalet.dev/assistant/)
- [Security](https://askvalet.dev/security/)
- [Configuration reference](https://askvalet.dev/reference/configuration/)
- [Build an integration](https://askvalet.dev/build/)

## Contributing

Contributions are welcome, and new integrations are the easiest place to start. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE). Product names and logos belong to their owners, and Valet isn't affiliated with any of them.
