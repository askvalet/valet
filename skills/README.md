# Agent skills for Valet

A skill that teaches a coding agent (Claude Code, Codex and others) how to set up and extend Valet: the config file, adding services, cards from any JSON API, plugins, background scripts, sign-in, profiles and the assistant's access.

`valet/SKILL.md` is the entry point: what Valet is, where its files live, its commands and the rules that always apply. It points to four reference files beside it:

| File | For |
|---|---|
| `config.md` | `config.yaml`: integrations, layout, look, assistant, sign-in, profiles, and every common option |
| `custom-card.md` | A card from any JSON API with `type: api`, no code |
| `plugin.md` | A plugin integration in `data/integrations/` |
| `background.md` | A background script in `data/backgrounds/` |

## Install

One command, which asks which agents you use (Claude Code, Codex, Cursor and many more):

```sh
npx skills add askvalet/valet
```

## Claude Code, by hand

Or copy or symlink the folder into your skills:

```sh
ln -s "$PWD/skills/valet" ~/.claude/skills/valet           # for you, everywhere
ln -s "$PWD/skills/valet" .claude/skills/valet             # for one project
```

Claude Code picks it up by its description when you ask it to set up or change Valet.

## Other agents

Point the agent at `skills/valet/SKILL.md`, for example from your `AGENTS.md`: "For anything about Valet, read skills/valet/SKILL.md first." It links to the rest.
