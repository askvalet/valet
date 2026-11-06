# The film and the GIFs

How the moving pictures on askvalet.dev and in the README are made: the film (`website/public/film/valet.mp4`,
`valet-mobile.mp4` and their posters, not in git) and the GIFs in `docs/images`.

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
node phone.mjs out/phone              # main, tabs, ask, self: a 402x620 phone at 3x
node gifs.mjs out/gif                 # live, home3d, chat, card
node stills.mjs out/cards             # the cards for the "185 integrations" reel, at 2x
```

Each clip gets a `.json` beside it with the frame count and the rectangles of the cards that matter at each mark, so
the film's camera can frame a whole card instead of guessing. Pass a comma list to record only some beats
(`node desktop.mjs out/desktop chat,self`).

`config-live` needs a real server that watches its config: run `dist/server.js` on port 7867 with a copy of
`demo/config.yaml` (with `reload: true`, `sandbox: false`), then `node cfglive.mjs out/gif <that config.yaml> <a
second wallpaper>`. The file is put back when it's done.

## GIFs

`./gif.sh <clip.mp4> <out.gif> <width> [crop,]` makes a 15 fps GIF: one palette for the whole clip, ordered dither,
a light temporal denoise so still glass stays the same from frame to frame, and held frames merged (their delay
keeps the time). The house is cropped to its card: `./gif.sh home3d.mp4 home-3d.gif 800 "crop=900:880:0:0,"`.

## The film

`compose/` holds the two films as scenes for the Stageshow kit (the React kit that ships with the Stageshow skill): `valet-film` (1920x1080) and
`valet-film-mobile` (1080x1350). Copy a folder into a Stageshow checkout's `examples/`, put the clips and their
`.json` in its `assets/clips`, the stills in `assets/cards` and app icons in `assets/icons`, start its playground
on port 7868, copy `compose/render.mjs` into its `.tools/`, and render with `node .tools/render.mjs <example>
<master.mp4>` (frame-exact, PNG frames into x264 at CRF 10). Then encode:

```sh
ffmpeg -i master.mp4 -c:v libx264 -preset veryslow -crf 24 -tune animation -pix_fmt yuv420p -movflags +faststart valet.mp4
ffmpeg -i mobile-master.mp4 -c:v libx264 -preset veryslow -crf 23 -tune animation -pix_fmt yuv420p -movflags +faststart valet-mobile.mp4
```

The desktop film's footage fills the frame. The camera only moves while the page holds still, glides with an eased
zoom, and frames a whole card (or a row) clear of the caption, which is a small glass pill in the bottom-left corner
that leaves after a few seconds. The phone film always shows the whole phone screen under a one-line caption.

`record/smooth.py <video>` checks a result: every frame 1/60 s apart, no frozen frame in the middle of a move, and
the big frame-to-frame changes listed (cuts, and the app's own instant changes) to look at by eye. Window scrolls are
moved on the device-pixel grid (the recorder carries the part of a pixel the browser won't scroll), so eased scrolls
don't stall at their ends or step unevenly.
