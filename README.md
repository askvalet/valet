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

[**Live demo**](https://demo.askvalet.dev) · [**Docs**](https://askvalet.dev) · [Quick start](#quick-start) · [Changelog](CHANGELOG.md)

<br>

<a href="https://askvalet.dev/film/valet.mp4"><img src="docs/images/film.webp" alt="Play the 70-second film: the main screen, asking why a service is down, approving a restart, adding a card from chat, and the integrations" width="100%"></a>

<sub>▶ <a href="https://askvalet.dev/film/valet.mp4">Watch the 70-second film</a> · or <a href="https://demo.askvalet.dev">try the demo</a>, right in your browser</sub>

</div>

<br>

## Why Valet

Valet is a homepage for your homelab that can also do things.

**Why another dashboard?** Most are a page of links with a status dot. Valet shows what's actually happening in your
services, like what's playing, what's downloading or what just went down and why. You can act on it from the same page:
pause a download, restart a service, turn off the lights.

**AI-native, if you want it.** Ask why something is down and it reads the logs, or ask for a new card and it edits the
config for you. Use a local model or a hosted one. Every change waits for your approval, and Valet works fine with the AI
switched off.

**Made to be enjoyed.** Live cards, real artwork, smooth animations and 3D models of your house and PC. It's a page
you'll want to look at and use.

**Flexible, and light.** One YAML file controls everything, with 185 integrations and a simple way to add your own. It
runs as one Node process, uses about 45 MB of RAM on a fresh install, and the image is 166 MB.

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
