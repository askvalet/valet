# Supported services

Generated from the code by `npm run docs:services`: please don't edit by hand.

186 integrations. If yours isn't here, `type: api` turns any JSON API into a card from YAML, and a new integration is
usually about ten lines ([docs/plugins.md](plugins.md)).

**How these are tested:** every service below runs in `npm test` against a sample of its API, which proves the card, the
sign-in flow and failure handling. A sample can't prove the service still answers that way, so if one misbehaves on your
version, please open an issue with the response it sent. `npm run test:services` runs them against your real services.

Self-signed certificate (Proxmox, TrueNAS and friends)? Add `insecure: true` to that integration.

## Full integrations

| Service | `type:` |
|---|---|
| APC UPS | `apcups` |
| Calendar | `calendar` |
| Camera | `camera` |
| Custom API | `api` |
| Docker | `docker` |
| Embedded page | `iframe` |
| Feeds | `rss` |
| GitHub repositories | `repository` |
| Glances | `glances` |
| Hacker News | `hackernews` |
| Home Assistant | `homeassistant` |
| Host | `host` |
| Immich | `immich` |
| Karakeep | `karakeep` |
| Links | `links` |
| Lobsters | `lobsters` |
| Local AI | `aimonitor` |
| Markets | `markets` |
| Minecraft | `minecraft` |
| Ollama | `ollama` |
| Paperless | `paperless` |
| PC lighting | `rgb-control` |
| Pi-hole | `pihole` |
| Plex (Tautulli) | `tautulli` |
| Prowlarr / Bazarr | `indexers` |
| qBittorrent | `qbittorrent` |
| Quran | `quran` |
| Reddit | `reddit` |
| Releases | `releases` |
| RomM | `romm` |
| Scrutiny | `scrutiny` |
| Seerr | `seerr` |
| Service status | `http` |
| Sonarr / Radarr | `arr` |
| To-do list | `todo` |
| Twitch | `twitch` |
| Uptime Kuma | `uptimekuma` |
| Weather | `weather` |
| World clock | `clock` |

## Catalog

Each needs `url:` plus what's listed, and gives a card, a tile and a read-only tool for the assistant.

| Service | `type:` | Sign-in |
|---|---|---|
| AdGuard Home | `adguard` | username, password |
| Arcane | `arcane` | key |
| Argo CD | `argocd` | key |
| Atsumeru | `atsumeru` | username, password |
| Audiobookshelf | `audiobookshelf` | key |
| Authelia | `authelia` | none |
| authentik | `authentik` | key |
| autobrr | `autobrr` | key |
| Azure DevOps | `azure-devops` | none |
| Backrest | `backrest` | none |
| Bazarr | `bazarr` | key |
| Beszel | `beszel` | username, password |
| BookLore | `booklore` | username, password |
| BookOrbit | `bookorbit` | username, password |
| BookStack | `bookstack` | key |
| Caddy | `caddy` | none |
| Calibre-Web | `calibre-web` | username, password |
| changedetection.io | `changedetection` | key |
| Channels DVR | `channels-dvr` | none |
| Checkmk | `checkmk` | none |
| Cloudflare Tunnel | `cloudflared` | key |
| CoinMarketCap | `coinmarketcap` | key |
| CrowdSec | `crowdsec` | username, password |
| Deluge | `deluge` | password |
| DeveLanCacheUI | `develancache-ui` | none |
| DiskStation | `diskstation` | username, password |
| Dispatcharr | `dispatcharr` | username, password |
| Dockhand | `dockhand` | none |
| Download Station | `download-station` | username, password |
| Duplicati | `duplicati` | password |
| Emby | `emby` | key |
| ESPHome | `esphome` | none |
| evcc | `evcc` | none |
| File Browser | `filebrowser` | username, password |
| FileFlows | `fileflows` | none |
| Firefly III | `firefly` | key |
| Flood | `flood` | username, password |
| Forgejo | `forgejo` | key |
| FreshRSS | `freshrss` | username, password |
| Frigate | `frigate` | none |
| Gatus | `gatus` | none |
| Ghostfolio | `ghostfolio` | key |
| Gitea | `gitea` | key |
| GitLab | `gitlab` | key |
| Gluetun | `gluetun` | none |
| Gotify | `gotify` | key |
| Grafana | `grafana` | username, password |
| HDHomeRun | `hdhomerun` | none |
| Headscale | `headscale` | key |
| Healthchecks | `healthchecks` | key |
| Homebox | `homebox` | username, password |
| Homebridge | `homebridge` | username, password |
| Jackett | `jackett` | none |
| Jellyfin | `jellyfin` | key |
| Jellystat | `jellystat` | key |
| Kavita | `kavita` | username, password |
| Komga | `komga` | username, password |
| Komodo | `komodo` | key |
| Kopia | `kopia` | none |
| Kubernetes | `kubernetes` | key |
| Lidarr | `lidarr` | key |
| Linkwarden | `linkwarden` | key |
| LubeLogger | `lubelogger` | username, password |
| Mailcow | `mailcow` | key |
| Maintainerr | `maintainerr` | none |
| Mastodon | `mastodon` | none |
| Mealie | `mealie` | key |
| Medusa | `medusa` | none |
| MikroTik | `mikrotik` | username, password |
| Miniflux | `miniflux` | key |
| MinIO | `minio` | none |
| Moonraker | `moonraker` | none |
| Mylar3 | `mylar` | key |
| MySpeed | `myspeed` | none |
| n8n | `n8n` | key |
| Navidrome | `navidrome` | none |
| NetAlertX | `netalertx` | key |
| NetBird | `netbird` | key |
| Netdata | `netdata` | none |
| Nextcloud | `nextcloud` | none |
| NextDNS | `nextdns` | key |
| Nginx Proxy Manager | `nginx-proxy-manager` | username, password |
| ntfy | `ntfy` | none |
| NZBGet | `nzbget` | username, password |
| OctoPrint | `octoprint` | key |
| Ombi | `ombi` | none |
| Open WebUI | `open-webui` | key |
| OpenDTU | `opendtu` | none |
| OpenMediaVault | `openmediavault` | username, password |
| OpenWrt | `openwrt` | username, password |
| OPNsense | `opnsense` | username, password |
| Outline | `outline` | key |
| Pangolin | `pangolin` | key |
| PeaNUT | `peanut` | none |
| pfSense | `pfsense` | key |
| PhotoPrism | `photoprism` | username, password |
| Plant-it | `plant-it` | key |
| Plex | `plex` | key |
| Portainer | `portainer` | key |
| Portainer | `portainer-kubernetes` | key |
| Prometheus | `prometheus` | none |
| Prometheus | `prometheus-metric` | none |
| Prowlarr | `prowlarr` | key |
| Proxmox | `proxmox` | key |
| Proxmox Backup Server | `proxmox-backup` | key |
| Pterodactyl | `pterodactyl` | key |
| Pulse | `pulse` | key |
| pyLoad | `pyload` | key |
| qui | `qui` | key |
| Readarr | `readarr` | key |
| ruTorrent | `rutorrent` | username, password (optional) |
| SABnzbd | `sabnzbd` | key |
| slskd | `slskd` | key |
| SparkyFitness | `sparkyfitness` | key |
| Speedtest Tracker | `speedtest-tracker` | key |
| Spoolman | `spoolman` | none |
| Sportarr | `sportarr` | key |
| Stash | `stash` | none |
| Stirling-PDF | `stirling-pdf` | none |
| Suwayomi | `suwayomi` | none |
| SWAG | `swag` | none |
| Syncthing | `syncthing` | key |
| Syncthing Relay | `syncthing-relay` | none |
| Tailscale | `tailscale` | key |
| Tandoor | `tandoor` | key |
| Tdarr | `tdarr` | none |
| Technitium DNS | `technitium` | key |
| Tracearr | `tracearr` | key |
| Traefik | `traefik` | none |
| Transmission | `transmission` | username, password (optional) |
| Trilium | `trilium` | key |
| TrueNAS | `truenas` | key |
| Tube Archivist | `tube-archivist` | key |
| UniFi | `unifi` | key |
| UniFi Drive | `unifi-drive` | username, password |
| Unmanic | `unmanic` | none |
| Unraid | `unraid` | key |
| UptimeRobot | `uptimerobot` | key |
| Vaultwarden | `vaultwarden` | none |
| Vikunja | `vikunja` | key |
| Wallos | `wallos` | key |
| Watchtower | `watchtower` | key |
| wg-easy | `wg-easy` | username, password |
| What's Up Docker | `whatsupdocker` | none |
| xTeVe | `xteve` | none |
| Your Spotify | `your-spotify` | key |
| Zabbix | `zabbix` | key |

## Not supported yet

FRITZ!Box (SOAP), QNAP (XML sign-in), Omada, UrBackup and JDownloader (signed or multi-step sign-in), and GameDig (many game
protocols). Help welcome.
