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

<a href="https://askvalet.dev/film/valet.mp4"><img src="docs/images/film.webp" alt="Play the one-minute film: the main screen, asking what's playing and what to watch, approving a change, adding a card from chat, and the integrations" width="100%"></a>

<sub>▶ <a href="https://askvalet.dev/film/valet.mp4">Watch the one-minute film</a> · or <a href="https://demo.askvalet.dev">try the demo</a>, right in your browser</sub>

</div>

<br>

## Why Valet

Valet is a homepage for your homelab that can also do things.

### The front door to your homelab

Instead of opening five different tabs to work out what's going on, just open Valet.
It shows what's happening across all your services, and you can act on it right there. Instead of just being a page with
links and a status dot, Valet is meant to be powerful and actionable.

<p align="center"><img src="docs/images/front-door.webp" alt="Valet's main screen: a one-line summary of what's wrong and what's playing, an ask box, every service's status, a 3D floor plan and the PC" width="620"></p>

<br>

### AI-native, if you want it

Ask Valet anything about your homelab. Use a local model or a hosted one. Valet knows
its own documentation, so you can use it to build itself! Anything it changes waits for your approval, and Valet
works just fine with the AI switched off.

<table><tr>
<td width="50%" valign="top"><img src="docs/images/ask-chat.gif" alt="Asking who's watching shows the now-playing card, asking what to watch shows the most-watched list with posters, and pausing Pi-hole waits for approval, then shows its chart"><br><sub>"Who's watching?" "What should we watch tonight?" Then "Pause Pi-hole", which waits for your approval.</sub></td>
<td width="50%" valign="top"><img src="docs/images/ask-for-a-card.gif" alt="Asking for an internet speed card: Valet asks first, then the card appears on the page"><br><sub>"Add an internet speed card." Valet edits its own config, after asking first.</sub></td>
</tr></table>

<br>

### Updates in real time

Everything on the page is live. Progress bars move, numbers tick over, and new things appear as they happen, with no refreshing. Hover anything in the top bar for its details: what's playing, a download, the CPU or the weather.

<p align="center"><img src="docs/images/live.gif" alt="The top bar: hovering what's playing, a download, the CPU and the weather opens each one's live details" width="620"></p>

<br>

### Made to be enjoyed

Live cards, real artwork, smooth animations and 3D models. It's a page
you'll want to look at and use.

<p align="center"><img src="docs/images/home-3d.gif" alt="The 3D floor plan: picking the living room, turning its lights blue, and sending the vacuum, which drives through the house" width="620"><br><sub>Pick a room, change its lights, and send the vacuum, which drives through the house.</sub></p>

<br>

### Flexible, and light

One YAML file controls everything, with 185 integrations and a simple way to add your own. It
runs as one Node process, uses about 45 MB of RAM on a fresh install, and the image is 165 MB.
Add it to your phone's Home Screen and it's an app, with [its own notifications](https://askvalet.dev/start/app/).

<p align="center"><img src="docs/images/config-live.gif" alt="Editing config.yaml while Valet runs: the greeting, the wallpaper and its brightness change on the page as each line is saved" width="620"></p>

<br>

### Security first

Valet is read-only until you turn on sign-in or tell it your network is private. Your API keys stay on the server, so
neither the browser nor the AI ever sees them, and the assistant only gets the access you give it, one integration at a
time. Anything the assistant changes asks first. It runs on your own hardware, with no account and no telemetry. The
[security docs](https://askvalet.dev/security/) cover the rest.

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
