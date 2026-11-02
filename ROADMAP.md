# Roadmap

Things that are planned but not built yet. Pick one up: each is meant to land as a generic mechanism (an option, a
card type, a toolkit addition) rather than a special case.

- **Voice.** A microphone button in the ask box and the chat composer: record in the browser, transcribe through any
  OpenAI-compatible speech-to-text endpoint (`/v1/audio/transcriptions`: a local Speaches/faster-whisper container,
  LocalAI, OpenAI, Groq), configured as `assistant.voice: { url, model, apiKey }`. The page's permissions policy
  already allows the microphone for Valet only.
- **Published image.** A GitHub Action that builds and pushes the Docker image on each release.
- **Kiosk mode.** A full-screen ambient layout for a wall tablet or TV: clock, weather, now playing, photos, with
  burn-in shifting.
- **Scenes.** One tap for several actions across integrations ("Movie night": dim the lights, open Plex), defined in YAML.
- **Read-only share links.** A view for family or a kitchen tablet: no controls, no documents.
- **Themes from the wallpaper.** Take the accent and glass tint from the wallpaper's colours.
