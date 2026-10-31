# Contributing

Thanks for helping. Valet stays small and calm on purpose, so read [AGENTS.md](AGENTS.md) first: it's the design and
code principles, and it's short.

## Setup

```sh
npm install
cp config.example.yaml config.yaml   # keep what you use; secrets go in .env as ${NAME}
npm run dev                          # server with --watch, plus Vite on :5173
```

`npm run check` type-checks the server and the web app. `npm test` runs every test (no network, no real services).
`npm run test:live` checks your config's widgets against your real services, and `npm run test:services` does the same for catalog entries. `/#gallery` shows every card type in
every size.

## Adding things

- **A service with a JSON API:** you may not need code: `type: api` maps it to a card from YAML
  ([docs/configuration.md](docs/configuration.md)).
- **An integration for a service:** usually about ten lines. Add a `service()` entry to the right family file in
  `src/integrations/services/`, with a `sample` of a real answer and what it should show in `expect`, and `npm test`
  checks it automatically (see [docs/plugins.md](docs/plugins.md)). Please paste a real response: samples written from
  memory are how integrations break for everyone. If it needs controls, write a full integration: one file in
  `src/integrations/`, registered in `index.ts`, with a test in `test/integrations.test.ts`.
  [docs/integrations.md](docs/integrations.md) covers widgets, actions, tools and access levels.
- **A card type:** the type in `src/shared/cards.ts`, its schema in `cards.schema.ts`, a renderer in `src/web/cards.tsx`,
  a sample in `src/web/samples.ts`. The tests then render it in every size.
- **An option:** a schema entry with a comment and a default, so existing configs keep working, and a line in
  [docs/configuration.md](docs/configuration.md).

## Before a pull request

- `npm run check`, `npm test` and `npm audit --omit=dev` pass.
- No personal data: no real hostnames, names, hardware or recorded API responses in code, tests or examples.
- New tools pick the narrowest access (`read` < `write` < `control`) and have a `label`.
- UI changes: look at them at desktop and phone widths, light and dark.
- One logical change per commit, with a short summary line.

Security problems: please report them privately (see [SECURITY.md](SECURITY.md)), not in an issue.
