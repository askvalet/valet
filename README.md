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

<a href="https://askvalet.dev/film/valet.mp4"><img src="docs/images/film.webp" alt="Play the film: the main screen, ⌘K opening a service, answering a question and finding a page in the docs, the Services, Home, Media and Library tabs, asking what's playing and what to watch, approving a change, adding a card from chat, and the integrations" width="100%"></a>

<sub>▶ <a href="https://askvalet.dev/film/valet.mp4">Watch the film</a> · or <a href="https://demo.askvalet.dev">try the demo</a>, right in your browser</sub>

</div>

<br>

## Why Valet

Valet is a homepage for your homelab that can also do things.

### The front door to your homelab

Instead of opening five different tabs to work out what's going on, just open Valet.
It shows what's happening across all your services, and you can act on it right there. Instead of just being a page with
links and a status dot, Valet is meant to be powerful and actionable.

<p align="center"><img src="docs/images/front-door.webp" alt="Valet's main screen: the greeting at the top left with a one-line summary of what's wrong and what's playing, an ask box, every service's status, then the 3D house, the PC and a week of the calendar side by side" width="620"></p>

<br>

### AI-native, if you want it

Ask Valet anything about your homelab. Use a local model or a hosted one. Valet knows
its own documentation, so you can use it to build itself! Anything it changes waits for your approval, and Valet
works just fine with the AI switched off. You can [talk to it, too](https://askvalet.dev/assistant/voice/), with a speech server
on your own network or OpenAI's.

<table><tr>
<td width="50%" valign="top"><img src="docs/images/ask-chat.webp" alt="Asking who's watching shows the now-playing card, asking what to watch shows the most-watched list with posters, and pausing Pi-hole waits for approval, then shows its chart"><br><sub>"Who's watching?" "What should we watch tonight?" Then "Pause Pi-hole", which waits for your approval.</sub></td>
<td width="50%" valign="top"><img src="docs/images/ask-for-a-card.webp" alt="Asking for an internet speed card: Valet asks first, then the card appears on the page"><br><sub>"Add an internet speed card." Valet edits its own config, after asking first.</sub></td>
</tr></table>

<p align="center"><img src="docs/images/rule.webp" alt="Asking Valet to say when Oppenheimer finishes downloading: it asks first, then a notice arrives on the page when the download is done" width="620"><br><sub>"Tell me when Oppenheimer finishes downloading." Set once in plain words, and the notice comes when it's done.</sub></p>

<br>

### Updates in real time

Everything on the page is live. Progress bars move, numbers tick over, and new things appear as they happen, with no refreshing. Hover anything in the top bar for its details: what's playing, a download, the CPU or the weather.

<p align="center"><img src="docs/images/live.webp" alt="The top bar: hovering a meeting, what's playing, a download, the CPU, memory, the network, the weather and the calendar opens each one's live details" width="620"></p>

<br>

### Wall display mode

Open `/wall` on a tablet or a spare monitor for a page made to be read from across the room. The wall is its own page: you
pick exactly which cards it shows, several pages can take turns, and it dims at night. Nothing on it can be pressed, and
chat never shows.

<p align="center"><img src="docs/images/wall-services.webp" alt="The wall display: a large clock, the date and the weather, with every service's status below" width="620"><br><img src="docs/images/wall-house.webp" alt="The wall display's House page: the cameras, the thermostat, who's home, the doors, the energy and the weather" width="620"><br><sub>Two wall pages taking turns: the services, then the house.</sub></p>


<br>

### Made to be enjoyed

Live cards, real artwork, smooth animations and 3D models. It's a page
you'll want to look at and use.

<p align="center"><img src="docs/images/home-3d.webp" alt="The 3D floor plan: picking the living room, turning its lights blue, and sending the vacuum, which drives through the house" width="620"><br><sub>Pick a room, change its lights, and send the vacuum, which drives through the house.</sub></p>

<p align="center"><img src="docs/images/year-in-review.webp" alt="The year in review, full screen: the race of what was watched most, the house the vacuum cleaned, the ads blocked and the uptime, one screen at a time" width="620"><br><sub>Your year in review, told from your services' own numbers.</sub></p>

<br>

### Flexible, and light

One YAML file controls everything, with 185 integrations and a simple way to add your own. It
runs as one Node process, uses about 45 MB of RAM on a fresh install, and the image is 165 MB.
Add it to your phone's Home Screen and it's an app, with [its own notifications](https://askvalet.dev/start/app/).

<p align="center"><img src="docs/images/config-live.webp" width="100%" alt="Editing config.yaml while Valet runs, ten times over: the greeting, the wallpaper, liquid glass, light mode, the greeting's place, a labelled dock at the bottom, two columns, the full services list, no ask box and a serif font, each on the page as soon as the line is saved"></p>

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
