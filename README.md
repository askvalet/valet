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

### The front door to your homelab

Instead of opening five different tabs to work out what's going on, just open Valet.
It shows what's happening across all your services, and you can act on it right there. Instead of being a page with
links and a status dot, Valet is meant to be powerful and actionable.

<p align="center"><img src="docs/images/front-door.webp" alt="Valet's main screen: a one-line summary of what's wrong and what's playing, an ask box, every service's status, a 3D floor plan and the PC" width="620"></p>

<br>

### AI-native, if you want it

Ask Valet anything about your homelab. Use a local model or a hosted one. Valet knows
its own documentation, so you can use it to build itself! Every change waits for your approval, and Valet
works just fine with the AI switched off.

<table><tr>
<td width="50%" valign="top"><img src="docs/images/ask-whats-down.gif" alt="Asking what's down: Valet checks the services, reads Mealie's logs to explain why, and restarts it after a one-click approval"><br><sub>"What's down right now?" Valet checks, reads the logs, and restarts Mealie once you approve.</sub></td>
<td width="50%" valign="top"><img src="docs/images/ask-for-a-card.gif" alt="Asking for an internet speed card: Valet asks first, then the card appears on the page"><br><sub>"Add an internet speed card." Valet edits its own config, after asking first.</sub></td>
</tr></table>

<br>

### Made to be enjoyed

Live cards, real artwork, smooth animations and 3D models of your house and PC. It's a page
you'll want to look at and use.

<p align="center"><img src="docs/images/home-3d.gif" alt="The 3D floor plan: picking the living room, turning its lights blue, and sending the vacuum, which drives through the house" width="620"><br><sub>Pick a room, change its lights, and send the vacuum, which drives through the house.</sub></p>

<br>

### Flexible, and light

One YAML file controls everything, with 185 integrations and a simple way to add your own. It
runs as one Node process, uses about 45 MB of RAM on a fresh install, and the image is 166 MB.

<p align="center"><img src="docs/images/config-live.gif" alt="Editing config.yaml while Valet runs: the greeting, the wallpaper and its brightness change on the page as each line is saved" width="620"></p>

<br>

<br>

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
