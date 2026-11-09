# The Valet demo

Real Valet, made-up homelab. The page runs the published code; the only stand-ins are one plugin
(`integrations/homelab.mjs`, the invented house) and a scripted model (`mock-model.mjs`, the assistant).

- **Nothing real:** no secrets, no real services. Every name and title is invented and every picture is drawn in code,
  except the camera footage, which is free and credited in `art/cameras/CREDITS.md`: no private homes, faces or plates.
- **Sealed:** Valet and the model sit on an internal Docker network with no route to the internet, the LAN or the host.
  The small proxy is the only way in.
- **No AI bill:** the chat calls the scripted model, so it costs nothing and can't be talked into anything. It never
  repeats what's typed into it.
- **Scripted, and says so:** it can explain why Mealie is down from its logs (and say, honestly, that Valet can't restart it), pause Pi-hole, stop a stream, turn a room's lights on or
  off, suggest what to watch, sum up last night and report on the downloads, the drives and the server. It also takes
  plain orders for the thermostat and the vacuum. Anything that changes the house needs a plain instruction ("pause
  pi-hole"), never a question or a mention, and whatever it can't do it says so, with what a real Valet would do instead.
- **One set of numbers:** Plays, Most watched and Who's watching add up one table, and everything Pi-hole shows adds up
  one day of queries. Change the table, not the cards.
- **Self-healing:** whatever a visitor changes lapses after ten minutes, and restarting wipes everything else.

```sh
docker compose build                       # in the repo root: builds local/valet:dev
cd demo && docker compose up -d            # http://172.17.0.1:7580
```

The pages under `art/docs/` are the documents card's own drawings as JPEGs, because Valet won't serve an SVG: if you
change `PAPERS`, render the card's images again with `rsvg-convert` and keep the numbering.

It is **not public**: the port is on the Docker bridge address only, for a reverse proxy on the same machine. To open it
later, add the public name to `allowedHosts` in `config.yaml` and point a proxy or tunnel at that port.

## Static version

The public demo needs no server. `npm run demo:static` builds it into `demo/static/dist`, ready for any static host. Valet's page
runs unchanged, and `static/backend.ts` answers its `/api` calls in the browser: the same made-up homelab and scripted model, and
Valet's real chat, tools and approvals. Each visitor's changes live in their tab and are gone on reload. The layout and the year
in review are saved from a real server at build time.

One change to the page works from chat, to show what the real assistant does: "Add an internet speed card" asks first, then the card appears, and "undo" takes it away. It's scripted and lives in the tab, like everything else.

Voice works without a server too. The mic is there but only says where voice is set up: it never records or asks for the
microphone. The speaker under an answer plays a clip recorded ahead from `voices/`, found by a hash of the words Valet would
read (`src/shared/speech.ts`), and an answer with live numbers in it (the downloads, what's playing, the server's load, the
next meeting) is read by the browser's own voice. After changing what the script says, record the clips again:

```sh
SPEECH_VIA=valet npm run demo:voices                   # from inside a container that can reach the speech server
SPEECH_URL=http://localhost:8000/v1 npm run demo:voices   # or straight to any OpenAI-compatible /audio/speech
```

It keeps clips whose words haven't changed and removes ones no answer uses; `test/demo-voice.test.tsx` fails if an answer
has no clip. Kokoro's `af_heart` by default (`SPEECH_MODEL`, `SPEECH_VOICE`), mono MP3 at 32 kbps, about 2 MB in all.
