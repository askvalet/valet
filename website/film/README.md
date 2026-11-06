# The film and the GIFs

How the moving pictures on askvalet.dev and in the README are made: the film (`website/public/film/valet.mp4`,
`valet-mobile.mp4` and their posters, not in git) and the animations (GIFs, saved as animated WebP) in `docs/images`.

Everything is filmed from the demo, frame by frame. The page runs on a virtual clock (`record/vc.js`): time only moves
when the recorder steps it, by exactly 1/60 s, and every step is a full screenshot. Timers, animation frames, CSS
transitions, the 3D models and the streamed answers all move on that clock, so a slow screenshot can never drop or
double a frame, and an eased scroll or pointer glide is exact.

## Footage

Serve the static demo (`npm run demo:static`, then any static server on `demo/static/dist`) on port 7863, or change
the URL at the top of each script. Chrome must be installed.

```sh
cd website/film/record
node desktop.mjs out/desktop          # overview, ⌘K, services, home, media, library, chat, self: 1600x900 at 2x
node gifs.mjs out/gif                 # live, home3d, chat, card, recap, rule: 1600x900 at 1.5x, side by side
node stills.mjs out/cards             # the cards for the "185 integrations" reel, at 2x
```

Each clip gets a `.json` beside it with the frame count and the rectangles of the cards that matter at each mark, so
the film's camera can frame a whole card instead of guessing. Pass a comma list to record only some beats
(`node desktop.mjs out/desktop chat,self`); separate lists can run at once, each in its own browser
(`overview,kbar`, `tabs` and `chat,self` take a few minutes each side by side).

The `rule` GIF needs the demo's reminder story (ask to be told when Oppenheimer finishes downloading, approve, and the
notice arrives about ten seconds later). Point the recorder at another server with `DEMO_URL=http://localhost:7872/`.

`config-live` needs a real server that watches its config: run `dist/server.js` on port 7867 (`VALET_CONFIG`,
`VALET_DATA`, `PORT`) with a copy of `demo/config.yaml` (with `reload: true`, `sandbox: false`, and `art:
demo/art/cameras`, run from a copy of the repo so `demo/art` and the second wallpaper are found), then `node cfglive.mjs
out/gif <that config.yaml> walls/lake.jpg`. It makes ten edits one after another, each typed into a config.yaml panel,
saved, and seen on the page; `ONLY=3,4` records some of them. The file is put back when it's done.

## GIFs

Every GIF shows the page at its full desktop width. The camera is added like the film's: `compose/valet-gifs` is one
Stageshow scene (1440x810) that plays a clip with eased glides from the rectangles marked while recording: wide, in on
what matters (the chat while it talks, a card while it's used), and back out. Pick the GIF with `?gif=`:
`node .tools/render.mjs "valet-gifs&gif=chat" chat.mp4`, with the clips in `examples/valet-gifs/assets/clips`.

`./gif.sh <clip.mp4> <out.gif> <width> [crop,]` then makes a 15 fps GIF: one palette for the whole clip, ordered
dither, a light temporal denoise so still glass stays the same from frame to frame, and held frames merged (their
delay keeps the time). With the camera moving, a GIF has to store most of every frame again (15-20 MB for 20
seconds), so the README and the site use animated WebP instead: `./webp.sh chat.mp4 ask-chat.webp 960` (24 fps,
quality 78; `config-live` at 1200 so the YAML reads). `webp.py` encodes with Pillow: every frame whole and a keyframe
each second, because ffmpeg's `libwebp_anim` stores partial lossy updates that pile up into blocky patches in blurred
glass. GitHub and every current browser play it like a GIF.

## The film

`compose/` holds the two films as scenes for the Stageshow kit (the React kit that ships with the Stageshow skill): `valet-film` (1920x1080) and
`valet-film-mobile` (1080x1350), which is the same story, beats and footage framed for a tall screen. Copy a folder into a Stageshow checkout's `examples/`, put the clips and their
`.json` in its `assets/clips`, the stills in `assets/cards` and app icons in `assets/icons`, start its playground
on port 7868, copy `compose/render.mjs` into its `.tools/`, and render with `node .tools/render.mjs <example>
<master.mp4>` (frame-exact, PNG frames into x264 at CRF 10). Then encode:

```sh
ffmpeg -i master.mp4 -c:v libx264 -preset veryslow -crf 24 -tune animation -pix_fmt yuv420p -movflags +faststart valet.mp4
ffmpeg -i mobile-master.mp4 -c:v libx264 -preset veryslow -crf 23 -tune animation -pix_fmt yuv420p -movflags +faststart valet-mobile.mp4
```

The desktop film's footage fills the frame. The camera only moves while the page holds still, glides with an eased
zoom, and frames a whole card (or a row) clear of the caption, which is a small glass pill in the bottom-left corner
that leaves after a few seconds. The tall film puts the caption above the footage: wide, the whole page sits at full
width in a band under it; close, the band opens to the bottom of the frame and one part of the page fills it.

`record/smooth.py <video>` checks a result: every frame 1/60 s apart, no frozen frame in the middle of a move, and
the big frame-to-frame changes listed (cuts, and the app's own instant changes) to look at by eye. Window scrolls are
moved on the device-pixel grid (the recorder carries the part of a pixel the browser won't scroll), so eased scrolls
don't stall at their ends or step unevenly.
