<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="Valet">

# Valet

**Talk to your homelab.**

A fast, beautiful, self-hosted homepage with an optional assistant that only gets the keys you hand it.

[![CI](https://github.com/IbrahimIrfan/valet/actions/workflows/ci.yml/badge.svg)](https://github.com/IbrahimIrfan/valet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE)
[![Node 22.18+](https://img.shields.io/badge/node-22.18%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![186 integrations](https://img.shields.io/badge/integrations-186-d9b56c)](docs/services.md)

[**Live demo**](https://demo.askvalet.dev) · [**Docs**](https://askvalet.dev) · [Quick start](#quick-start) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)

<br>

<a href="https://demo.askvalet.dev"><img src="docs/images/overview.webp" alt="The Valet overview: a one-line summary, an ask box, service status, a 3D floor plan and a 3D model of the PC" width="100%"></a>

</div>

<br>

## Why Valet

### Beautiful, and proud of it

Your homelab deserves better than a grid of links. Valet has live cards, real artwork, charts that tell a story, a 3D floor plan from your robot vacuum's map and a 3D model of your PC. It feels like an app you'd pay for, on your desk and on your phone.

### One place for everything

Stop opening ten tabs to do one thing. Pause a download, restart a container, dim the lights, check the cameras, read what's playing and see what needs an update, all from one page. With 186 integrations, your services stop being separate apps and start being one home.

### Fully customizable and extensible

One YAML file controls every section, size, colour and wallpaper. Draw any numbers as any chart and any pictures as any gallery. Add a service with about ten lines, or drop a single file into `data/integrations/`. Nothing is locked behind a theme.

### Built for the AI age

Talk to your homelab. Ask why something is down and it reads the logs, explains what happened and offers the fix, with answers arriving as live cards instead of walls of text. Bring a local model (Ollama, llama.cpp, vLLM, LM Studio) or a hosted one (OpenRouter, OpenAI, Anthropic), and connect any MCP server.

It works like a valet key, which drives the car but can't open the boot. You choose what the assistant can reach, it never sees your API keys, and every change waits for your approval. Prefer no AI? Leave it off, and Valet is still a complete homepage.

**And it stays light:** one Node process, about 65 MB of RAM, a 165 MB image, MIT licensed and running on your own hardware.

## A look around

<table>
<tr>
<td width="50%"><img src="docs/images/chat.webp" alt="The assistant reads Mealie's logs, explains the crash and asks before restarting it"><br><b>Talk to it.</b> It reads freely and asks before it changes anything.</td>
<td width="50%"><img src="docs/images/models.webp" alt="A 3D floor plan with live lights beside a 3D PC with lighting presets"><br><b>Run the house.</b> Lights, rooms, vacuum and PC lighting, in 3D.</td>
</tr>
<tr>
<td><img src="docs/images/services.webp" alt="Services tab with Pi-hole, drive temperatures, containers and updates"><br><b>Keep an eye on things.</b> Traffic, drives, containers and which updates need reading first.</td>
<td><img src="docs/images/media.webp" alt="Media tab with a bar chart race of the year, most watched and a viewing heatmap"><br><b>See what you watched.</b> A race through the year, who's watching and a year of days.</td>
</tr>
<tr>
<td><img src="docs/images/home.webp" alt="Home tab with a live camera view with detections, a thermostat and daylight"><br><b>Check the cameras.</b> Live views and what they noticed, with the thermostat beside them.</td>
<td><img src="docs/images/library.webp" alt="Library tab with a photo album of sliding strips and a Cover Flow of books"><br><b>Enjoy your library.</b> Albums that slide open and Cover Flow for anything with a cover.</td>
</tr>
<tr>
<td><img src="docs/images/recap-race.webp" alt="Year in review screen showing the most watched title with a race chart"><br><b>Relive the year.</b> A story of your homelab, written from real numbers with no model.</td>
<td><img src="docs/images/phones.webp" alt="Valet on three phones: overview, home and library"><br><b>Take it with you.</b> Built for phones, not squeezed onto them.</td>
</tr>
</table>

## Quick start

```sh
mkdir valet && cd valet
docker run -d --name valet -p 127.0.0.1:7575:7575 \
  -v ./config:/config -v ./data:/app/data --env-file .env \
  ghcr.io/ibrahimirfan/valet:latest
```

Open <http://localhost:7575> and the page walks you through the rest. The [install guide](https://askvalet.dev/start/install/) covers Docker Compose and running from source.

## Documentation

Everything else lives at **[askvalet.dev](https://askvalet.dev)**:

- [Your first config](https://askvalet.dev/start/first-config/)
- [186 integrations](https://askvalet.dev/integrations/), each with screenshots
- [The assistant](https://askvalet.dev/assistant/)
- [Security](https://askvalet.dev/security/)
- [Configuration reference](https://askvalet.dev/reference/configuration/)
- [Build an integration](https://askvalet.dev/build/)

## Contributing

Contributions are welcome, and new integrations are the easiest place to start. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE). Product names and logos belong to their owners, and Valet isn't affiliated with any of them.
