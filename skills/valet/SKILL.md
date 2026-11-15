---
name: valet
description: "Set up, configure and extend Valet, the self-hosted homelab dashboard. Covers installing it, editing config.yaml (integrations, layout, tabs, look), adding a service, making a card from any JSON API with `type: api`, writing a plugin integration, writing a background script, sign-in, people and profiles, the assistant's access levels, and fixing what `config check` or `doctor` reports."
---

# Valet

Valet is a homepage for a homelab: live cards for the services someone runs, controls for what they can change, and an optional assistant that answers with the same cards. One Node process in one container, configured by one YAML file. Docs: https://askvalet.dev (in a checkout of the repo, `website/src/content/docs/`).

## Where things live

| | Docker (usual) | In the container | From source |
|---|---|---|---|
| The config | `./config/config.yaml` | `/config/config.yaml` | `config.yaml` |
| Secrets | `./.env`, read through `env_file: .env` | the environment | `.env` |
| Data | `./data` | `/app/data` | `data/` |
| Plugins | `./data/integrations/<name>.mjs` | `/app/data/integrations/` | `data/integrations/` |
| Background scripts | `./data/backgrounds/<name>.js` | `/app/data/backgrounds/` | `data/backgrounds/` |

The container is usually named `valet` and listens on port 7575, published on `127.0.0.1` by default. Check with `docker ps`. Startup problems, reloads and plugin loading are in `docker logs valet`.

## Commands

In Docker: `docker exec valet node dist/server.js <command>`. From source: `node dist/server.js <command>` after `npm run build`.

| Command | What it does |
|---|---|
| `config check` | Every problem in the file, or a tick. Exits 1 on any. Run it after every edit. |
| `config print` | What Valet made of the file, secrets redacted. |
| `config schema` | A JSON schema of the whole file, every integration included. |
| `doctor` | Tries every placed widget, the model and each notification channel once, and says how to fix each problem. `--json`, `--send-test`, `--timeout <s>`. Never presses a button. |
| `user list`, `user add <name>` | Local accounts (`passwd`, `remove`, `signout` too). Use `docker exec -it` for `add` and `passwd`, which prompt. |
| `init` | A config from the containers it finds. `--print` to preview. Never replaces a config someone changed. |
| `import <homepage\|dashy\|homarr\|heimdall> <path> --out <file> --env <file>` | Another dashboard's config as Valet's, keys moved out to the env file. |
| `new-integration <name> [--full]` | A working plugin to start from, in `data/integrations/`. |
| `check-integration <file>` | Runs a `service()` plugin against its own sample, with no service running. |

## Rules that always apply

- **Secrets are `${NAME}` in config.yaml, with the value in `.env`.** Never write a key, token or password into the file. Only values that came from a `${NAME}` are redacted from logs, the assistant and the page. A new `.env` variable needs `docker compose up -d`, because the container reads `.env` only when it's created.
- **`url` is the address from inside the Valet container**: a Docker service name or a LAN address. `localhost` there is Valet itself. `href` is where the card links in the browser.
- **Most edits apply live.** Save config.yaml and open pages update; a broken edit is logged and the last good config keeps running.
- **Two things need a restart** (`docker restart valet`): `auth`, and plugins (the `plugins:` list or any file in `data/integrations/`). A background script needs only a page reload.
- **Without sign-in, Valet is read-only.** With `auth.mode: none` (the default) there are no buttons and the assistant only reads, unless `auth.trustNetwork: true`. Don't turn that on, open the port wider, or raise access levels unless the user asked; say what it allows.
- **Names Valet is reached by go in `allowedHosts`**, or the page gets a 421. `localhost` and IP addresses always work.
- **Plugins and background scripts aren't sandboxed.** They run with Valet's own reach and the keys they're given. Only install ones the user wrote or has read, and say so.
- **Unknown keys are reported.** In the core config, an unknown key rejects the edit and names the closest match. In an integration block, it's reported and ignored.
- **Check against the source, not memory.** Widget keys, options and tools are on each integration's page. The schema is `src/server/config.ts`; the card catalog is `src/shared/cards.ts`.

## How to work

1. Read the current config. Run `config check` first, so you know what was already wrong.
2. Make the smallest change that does it, keeping the user's comments and order.
3. Run `config check` and fix every `✗`. After adding a service or plugin, run `doctor`.
4. Tell the user what changed, what needs a restart, and any key they must add to `.env`.

## Which file to read

| The task | Read |
|---|---|
| Install, first config, add a service, layout, tabs, the look, the assistant and its access levels, sign-in, allowed hosts, profiles and `users`, live reload, the common mistakes, and a reference of every option | [config.md](config.md) |
| A card from a JSON API or from another widget's card, with no code: `type: api`, paths, formats, templates, expressions, `where`/`sort`/`limit`, stats, list, rows, status, table | [custom-card.md](custom-card.md) |
| A plugin integration: `service()` or `defineIntegration`, widgets and cards, actions, tools and `confirm`, commands, the `add` line, pictures, `.web.js` visuals, testing | [plugin.md](plugin.md) |
| A background script behind the cards: the `mount`/`update`/`destroy` contract, theme colours, performance, reduced motion | [background.md](background.md) |

Pick the smallest tool for a new service: an existing integration first, then `type: http` (up or down) or `type: api` (numbers and rows), then a `service()` plugin, then `defineIntegration`.
