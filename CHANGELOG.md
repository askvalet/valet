# Changelog

Notable changes to Valet. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-05

### Added

- Home Assistant cards have icons and colour. Each row gets a small icon from what the entity is (a lock, a garage door, a person, energy, money, temperature), and the ones that say how things stand are coloured: locked, closed and at home in green, unlocked or left open in amber. `locked` and `not_home` read as Locked and Away. An entity in `cards` can be `{ id, icon }` to choose its icon.
- A widget can span columns: `cols` (1 to 8) on a widget entry, beside `rows`, in a section with sizes or with `columns` per screen. It never reaches past the last column, so `cols: 2` in a grid of three is two thirds of a computer's row and the whole row on a phone.
- Wide pages have room for more: past 1760px the size grid has eight columns instead of six, and a section's `columns` takes a `wide` count (`{ phone: 1, tablet: 2, desktop: 3, wide: 4 }`, up to 8 each), which keeps the `desktop` count when left out.
- A section without a heading carries on the grid above it, with the cards' gap between them rather than a section's, so rows of different shapes read as one page.
- With `hero.align: left`, the greeting sits at the top left, level with the top bar, and each tab shows its own name in the same place.
- A tile can draw its share as a pie (`summary.pie`, coloured by `color`). Pi-hole's ads blocked uses it, in red.
- A line chart's series can have a `color` of its own (`#hex` or `var(--token)`), so two lines that mean different things, like power used and solar, read apart.

- The calendar has a week. A calendar card that's narrower than the month and day side by side but tall enough, like a third of the overview's row or a phone, shows a few days side by side with the hours down the side: only the hours in use, squeezed to the card so it never scrolls up and down, events as blocks in their calendar's colour, all-day ones in a strip on top, today shaded with a line at the time now. Swipe or use the arrows for more days; Today brings it back. A meeting has a small Join button on its block, and tapping any event shows its time, place, calendar and Join, over the week so nothing moves. `view: week` or `view: agenda` on the widget holds it to one.
- `appearance.theme: system` follows the device over a wallpaper too: light glass when the phone or computer is in light mode, dark glass in dark mode, and the page turns when the device does (at sunset, say), without a reload. The light/dark switch in the top bar shows over a wallpaper then, and overrides it in that browser only; switching back to what the device says follows the device again. The wall display follows the screen with `system` and stays dark otherwise. `auto` is unchanged: dark glass over a wallpaper, as before.
- A wallpaper for each theme: `appearance.wallpaper: { light: …, dark: … }` (and the same in `wallpapers`, per tab). `dim` and `blur` take `{ light, dark }` too. The plain forms work as they did.
- Three more views for anything with pictures, chosen per widget with `view`. `coverflow` is Cover Flow again, rebuilt: the one in the middle faces you and the rest turn away in 3D, with reflections. `masonry` is a wall of pictures three rows high that you throw sideways; Immich's On this day uses it. `cards` is a stack of cards to deal through; Paperless's recent documents (each with its first page, title, sender and date) and Karakeep's saved links use it, and a saved link keeps its Archive button. All three follow the browser's own scrolling, with nothing redrawn as they move, have Previous and Next buttons and the arrow keys, and are a plain row when you ask for reduced motion.
- A reading pile (Karakeep's From your reading) can take any gallery view, and archiving still works from it.
- `config check` names a `view` a widget's card can't take, and the views it can.
- The demo's Home tab has the week's meal plan from Mealie under the house and the PC: real food photos, today first. Mealie is down in the demo's story, so the row is the plan it last sent, marked stale.
- The demo's Media tab has music: Navidrome's most played albums as a cover flow beside The year so far, in place of Requested. The ten albums are real ones whose covers are free to share (CC0, CC BY-SA or public domain), credited on the Credits page.
- The demo sets reminders. Ask it to tell you when Oppenheimer finishes downloading: it asks first, and after your OK the download finishes within a few seconds and the notice arrives, as a real one would.
- Long chats compact themselves instead of breaking. When the model's window is known, what's sent stays under about 70% of it: the oldest turns become a short summary (one tool-less call, cached for the next turns), the latest question always goes whole, and a quiet line in the chat says "Earlier messages summarised to make room". The page keeps the whole conversation. Within one answer, earlier lookups' results shrink when they pile up, and a request the model's server rejects as too long is sent once more cut right down, then answered in plain words instead of an error. `assistant.compact: false` turns it off.

### Changed

- Hacker News and RSS headlines are one column to scan: a small mark for where each story is from (its picture, the site's icon, else its first letter), the title on up to two lines, then the points, comments, site or source and how long ago. A card made two rows tall fills its height with as many stories as fit, so nothing is left empty at the foot.
- The thermostat's colour says what it's doing: warm orange for heat, blue for cool, teal for auto, a quieter shade while it's idle, grey when off. It used to be the page's accent colour for heat.
- `view: masonry` on a photos card, like an Immich album, keeps each photo's own shape and caption in the collage.
- A narrow calendar's day is its title: "Thursday 5 November" sits on the header line at the size of every card's title, with the arrows at the right where other cards keep theirs, so the cards in a row line up. Wide, the month and the day are title-sized on that line too. In the plain agenda the arrows step a day at a time.
- Mealie's meal plan (`week`) shows its photos landscape, the way food is photographed.
- Navidrome's Most played keeps album covers square: as a list, each row's cover is square instead of cut to a poster, and as any gallery view (`row`, `coverflow` and the rest) the covers stay square. It brings up to 10 albums, so a gallery has some to flip through; the list still shows the top five. A ranked card can say `aspect: square` for this.
- A widget that can't reach a service the page already shows as down is one problem, not two: with Mealie down and its meal plan stale, the line under the title says "Everything's running except Mealie" and asks "Why is Mealie down?" once, without "1 widget can't reach its service" or "What's wrong with Meal plan?" beside it.
- Liquid glass is clearer and reads as thick glass. The blur behind cards is 4px instead of 10, so the wallpaper shows through sharp and in colour; words stay readable because the tint thickens where they need it, now in dark too (a dark card over a bright part of the wallpaper gets a deeper smoky tint, as a light card over a dark part already got a whiter one). The edge has a bevel, soft light just inside the top and left and a faint shade at the bottom, in place of the sheen. Material after kubai087's glasswork (MIT).
- The page has one set of design foundations, and every card uses them. Chips and small buttons are one chip (32 high, one corner, 13px words; tonal, outline, chosen or quiet) and one button (28 or 36 high; quiet, tonal or solid), where there were a dozen styles: room and desktop part chips, All off, the vacuum, Pause, Updates, the suggestions on the overview and the AI tab, the camera tabs, a calendar's Join and the chat's Try again and New chat. Text sizes are eight steps instead of 26, card titles are bolder than the text under them again, corners follow one scale by role (cards and popovers, controls, chips, and artwork by its size), status dots are one size (legends a little larger), icons are 14, 16 or 18, and everything a keyboard reaches shows the same accent ring, the top bar's rings, the phone's dock and the chips included.
- Every widget is the same card. Whatever it shows, it sits in one glass card with the same background, corners, edge, shadow and padding, and its title row is the first thing inside it: the icon, the title, the note and the card's buttons at the far right, at one height, so titles line up across a row. Nothing floats on the wallpaper any more: Now playing, Recently added, On this day, an album, books, games, documents and From your reading are cards with their artwork inside, and their Previous and Next (and See archived, and the reading pile's tools) are small quiet buttons in the title row instead of over the picture or the wallpaper. A row of artwork scrolls to the card's edges and fades there, its first poster lined up with everything else. Pictures that should feel big (the stream playing, a flashback photo, a saved page, Daylight's sky) are a panel inside the card; the weather keeps only a faint tint of the sky. Coming up and other tiles with artwork are glass tiles with the poster beside the words. Tiles and cards are the same distance apart. Downloading is a card like Hacker News, each download a row inside its padding whose progress fills it from the left, round at the ends. Titles are one size and weight everywhere, in chat and on tiles too; a calendar's date and the weather's sky are headlines, not titles. Weather and the calendar keep their title for screen readers only, and start at the same padding as the cards beside them (the calendar's date no longer touches the card's edge); the thermostat names its room.
- Cards fill the height their row gives them instead of leaving an empty foot: Daylight's sky sits right under the next time and grows to fill the card, On this day's photos grow with a tall card, Downloading's rows share the height, a camera's picture grows a little into a taller card, and a stack of cards or a cover flow sits in the middle. A list (Updates, Most watched, Scheduled jobs and the like) keeps its own height instead of stretching to its row and growing an empty foot; the row lines up their tops. A row of photos fades at the card's edge rather than looking cut off. Cover flow opens with the one in the middle centred at every width (it used to sit off to the right). A stack of cards keeps its fan the right way round in a narrow card or on a phone, leans so the stack sits in the middle, and its Open and Archive buttons sit at the card's foot beside the words instead of over the page. Recent documents shows Paperless's icon.
- The top bar's popovers have the same padding as a card: the calendar's date and Today no longer touch the edge. A calendar wide enough for the month beside the day (the popover, or a large card) puts the month on the left, so a meeting's Join sits at the right edge instead of in the middle. The forecast, a ring's graph and a live activity take the same padding.
- An empty or unavailable card is the same card with a quiet middle: an icon and a line, centred, at about the height it has when full. Lists, cameras, the calendar, a thermostat that isn't reporting, the reading pile, Now playing, shelves and photos all say it this way.
- Chat speaks the page's language: its cards have the page's title and corners with a little less padding, replies are the size of a list's words, the suggestions under an answer are the same chips as on the overview and the AI tab, and drives in chat read "58°C now" as they do on the page.
- The numbers beside the chat are the overview's tiles, the same inset, size and graph. Big numbers (stats, charts, the thermostat, a schedule's next time) use the three number sizes.
- `header: false` on a section drops its cards' title bars on its own tab too, not only on the overview, so the house and the desktop look the same in both places.
- A meeting is the same blue everywhere: its ring, its countdown, the popover's Join and now the calendar's Join for the same meeting, a blue-tinted chip instead of a grey one. The blue is a little deeper in light mode so it reads on white glass, and the forecast's rain bars have their own named colour too.
- Artwork corners follow its size: small thumbnails (downloads, Most watched, the year so far, camera stills) are 6px, posters, covers, photos and reading cards in a row 12px, and a picture that fills a card (spotlight, an album, the photo mosaic, a camera) 16px. A thumbnail is no longer rounder than the poster beside it.
- In light mode, dark artwork panels (Now playing, a photo, reading cards) take the same lit edge and soft shadow as the white glass around them, so a row reads as one set rather than a checkerboard. From your reading turns light: the saved page fades to white under dark words.
- The top bar's rings are evenly spaced: every ring has the same room whatever its label says (a long one is cut short inside it), and the line between what's live and the system's rings takes no room of its own.
- A ring's graph popover looks as it did before: the bigger number, and the graph as wide as it was, with the card's padding and the newer times.
- An album (`view: album`, Immich's albums) is a carousel of its photos: large, each at its own shape, with the next one peeking. The one you're on is lit and says where and when, the title row counts where you are ("3 / 9") beside Previous and Next, and it moves by dragging, throwing, a finger or the arrow keys, each photo drifting a little inside its frame as it passes. With reduced motion it's a plain row with every caption showing. It fills its card at any width and grows with a taller row.
- A year heatmap (Viewing) in half a page or on a phone folds into two lines, half a year each with its months above, so the days stay big enough to read and the card fills.
- The wall's tiles keep their graph between the name and the number, so it no longer runs through "20 of 64 GB" or "37°C" at any screen size.
- Light mode keeps its chips and quiet buttons: Pi-hole's Most blocked and Pause, Updates, the container plates, the chat's Try again and New chat and the first-run choices had a white fill that vanished on white glass. Fills now follow the theme's ink, and a healthy status dot reads green in light mode.
- Times, dates and lengths of time read one way everywhere, and follow `format` and your language on what the server writes too (calendar times, "next" runs, "paused till", weather hours), not only on the page. A range is "8:25–8:50 AM" in the calendar and the meeting's ring alike; a heading date is in words with no "5th" ("Thursday 5 November"); small print uses `format.date`. A length of time is short in rings, chips and lists ("2h 37m", "50m", "3d", "5m ago", "41m left", the same on a stream's card and its ring) and long in sentences ("Powered on 3 years"). With `format.locale: auto`, the server follows the first browser to open the page, as it does for the time zone.
- A number and its unit are drawn one way: no space before ° and %, a thin one before a word, the unit muted and smaller in step with the number ("18%", "20.0°C", "58 GB"). Temperatures keep their letter (a PC part's chip says "42°C"); the weather's own degrees stay bare. The wall's forecast says "High 5° · Low -4°" like the page.
- Every progress bar on the page is drawn the same way now, where there were a dozen styles: fully rounded on one faint track, in three thicknesses, and coloured by one rule (a status or the thing's own colour first, then the leader of a set in the accent and the rest grey). Most watched takes its posters' colours like the race beside it, Who's watching and the activity popovers have thicker bars, the race's timeline matches its bars, and downloads keep their row-wide fill with a clear edge. The year in review, drive temperatures, the forecast's ranges and a schedule's day line follow the same sizes and track, and the day line now shows in light mode too.
- The context meter's hint past three quarters says Valet summarises the oldest messages by itself; a new chat is optional.
- A meeting's popover is plainer and compact: the title with "In 4m" or "Now · 20m left" beside it, the time, small initials and names on one line, a progress bar only while it's on, and one button that names the service ("Join Google Meet"). No icon tile.
- Rankings say how much, not how far along: the race and Most watched draw their bars with no track and squarer ends, the others in a quiet grey and only the leader in its poster's colour, and the race's names sit inside taller bars. Its month and what it measures moved to the title row.
- The race card has more presence: thicker rounded bars on a faint track, each in its poster's colour (the leader's the strongest; posters without much colour keep grey bars and the accent leader), larger posters and bolder names. Its timeline is a proper scrubber that fills as the year plays, with a clear play and pause button, and the arrow keys step a month at a time (Home and End jump to the ends).
- The chat's header is one line: the assistant's name, then the model and its context meter, whose place is kept so nothing moves when the numbers arrive.
- The context meter knows a local model's window by itself when its server's model list says it (`max_model_len`, `context_length`, as vLLM and llama.cpp do), so `assistant.contextWindow` is only needed when it doesn't.
- Shelves of covers use `focus`, a modern carousel, where they used Cover Flow or a spotlight: the artwork large in the middle, the ones either side peeking in smaller and dimmer, and the middle one's colours softly lit behind it. It snaps, a mouse can throw it, and a click on one at the side brings it to the middle. Recently added (Plex through Tautulli, Jellyfin, Emby), games, books, audiobooks and music use it.
- Rows of artwork (shelves, the documents desk, the row beside a spotlight) are built on Blossom Carousel: the browser's own scrolling and snapping, a throw with momentum on a mouse, Previous and Next buttons that name the row, and the arrow keys. Asking for reduced motion makes them jump instead of glide, and turns `focus` into a plain row.
- A live update that brings back the same things no longer redraws a row of artwork.
- Every carousel is now the same Blossom Carousel row, including the cameras' strip of events, which gains Previous and Next buttons on a larger screen, arrow keys, a mouse throw and a fade at whichever edge has more. `focus`, `coverflow` and `cards` share one way of moving by one; nothing about how any of them look or which `view` names work has changed.
- In light mode, the selected tab is a dark pill with a white icon, like dark mode's white one, instead of the accent colour.
- Light mode over a wallpaper is light on every card. A card over a darker part of the wallpaper used to turn dark with light text in liquid glass; now it keeps its light glass and dark text and thickens its white tint (and, in liquid glass, its blur) until the words read. Frosted light glass does the same.

### Fixed

- Light mode's service icons no longer vanish: a white logo (Karakeep) is drawn in the page's ink, and a pale one with colours of its own (Uptime Kuma) sits on a small dark plate. The same goes the other way in dark mode for black logos (Miniflux, Tailscale, Vaultwarden). It works for your own icons too, in the service list, Services, Updates, Containers and ⌘K.
- Scrolling past the house and the PC on a phone no longer stutters. The models look the same but ask far less of the browser: about 680 layers instead of 1,760 when both are on screen, none while they're off screen, and the house only draws the sides of furniture that face you. A live update that changes nothing the model shows no longer touches it.
- The house is simpler underneath, so scrolling past it is smoother still, on a phone and on a computer. It has half the pieces it had (about 240 drawn instead of 480): the small things on furniture (cushions, a duvet and pillows, a keyboard, a basin, a counter top) are drawn on its surface, legs and screens are single panels, plants are a pot and a bush, a wall two rooms share is drawn once, and a lamp's beam is one sheet that faces you. It looks the same at a glance, and rooms, lights and the robot work as before.
- The demo answers every question its page suggests, including "What's Spider-Man: Brand New Day about?", and a test keeps it that way.
- No flash of light before dark glass over a wallpaper on load: the page remembers whether it had a wallpaper and decides its theme before the first paint.
- On the day the clocks go forward or back, "Tomorrow" no longer shows as "Today" (or the day after as a weekday) on upcoming episodes, films and other dates.
- Two saves of the rules at once could leave rules.json half-written for a moment, and a config reload right then would start with no rules. Saves of the rules and the timeline now go one at a time.

## [0.1.8] - 2026-11-04

### Added

- Liquid glass, to try: `appearance.glass.material: liquid` swaps the frosted glass for a clearer one. The blur is lighter and keeps the wallpaper's colour, the edge is lit from the top left, there's a soft shadow and a sheen inside, and hovering a card brightens its glass. In light, a card over a dark part of the wallpaper turns dark with light text, and the cards in a row decide together. Frosted stays the default. Any browser can flip between the two in ⌘K (**Liquid glass**, under This device), and the demo can too.
- With liquid glass, asking your system for reduced transparency or high contrast makes every surface solid.

## [0.1.7] - 2026-11-04

### Added

- Online meetings from your calendar. Valet finds the meeting link in each event (Google Meet, Zoom, Microsoft Teams, Webex, Whereby, Jitsi, GoTo and a few more), and from ten minutes before a meeting until it ends the calendar's ring counts down ("in 4 min", then "Now · 20 min left") with a **Join** button. Two at once: the one on now leads and the ring says "+1".
- Meeting reminders: a minute before (or any list of times), one notification per meeting to your channels and to devices with notifications on. Tapping it on a device opens the meeting. Each is sent once, kept in `data/reminders.json`, so a restart never sends it again.
- Calendar rows show the meeting's service and a small Join button. ⌘K has **join meeting** (opens the next or current one) and **next meeting**; the assistant has `calendar_next_meeting`, and `calendar_upcoming` returns join links.
- `calendar.meetings`: `lead`, `remind`, `push` and `me` (your address, so meetings you declined are left out), or `false`. It works with no config.
- Calendars read time zones (a meeting set in New York lands at the right time anywhere), moved and cancelled occurrences of a repeating event, `DURATION`, monthly rules like "second Tuesday" or "last Friday", and leave cancelled events out.
- Integrations and plugins can say things at a set time with `reminders()`; a command can open a link with `open: true`; an activity can carry a `countdown` and a `link`, and a list row a `link`.
- The demo has an online meeting a few minutes away.
- Valet's docs in ⌘K: type what you're looking for ("wallpaper", "backups", "sonarr") and a **Docs** group under everything else offers the pages and sections about it, opening on askvalet.dev at the right heading. "docs" or "help" alone offers the main pages. The search runs on Valet's own copy of the docs, so it works offline, and on a read-only page too.

### Security

- Calendar text is other people's invitations: only an https link on a known meeting service becomes a Join button, its host is always shown, and the link is scanned without a backtracking regex. A notification opens a link only if it's https.

## [0.1.6] - 2026-11-04

### Fixed

- A config with a `notify:` block from before 0.1.5 (channels or insights, and no `webPush`) loads again. In 0.1.5 it stopped Valet from starting.

## [0.1.5] - 2026-11-04

### Added

- Backup health: one **Backups** card (`valet.backups`) with every backup job your services report, failed and overdue ones first, then the rest with when they last worked, their size and a small line of it run by run. A sudden drop or jump in size is flagged as worth a look. Overdue means no success within the job's schedule, `backups.expect`, or `backups.overdue` (26 hours). Going wrong and coming right are told once each, on the page, on the timeline and through `notify.channels`, checked every 15 minutes even with the page closed. Ask "are my backups ok?", or type **backups** in ⌘K.
- Backrest, Kopia, Duplicati, Proxmox VE, Proxmox Backup Server, Home Assistant (its automatic backups), TrueNAS (cloud sync and replication) and Healthchecks (checks named for a backup) report their jobs to it. Integrations and plugins join with `backups()`, and a `service()` with `backups` and `backupGet`.
- A wall display at `/wall` (and **Wall display** in ⌘K): a full-screen page for a wall tablet or a spare monitor, with the time and weather large across the top and the cards you pick below, sized to fill the screen. It's its own page in the config, `wall:`, written like `layout`, with pages that take turns (`every`, a touch holds one for `pause`). Left out, it shows your services and what's playing or downloading. It never acts, whoever is signed in: no chat, ⌘K, buttons or links. It dims nearly to black from sunset to sunrise (or set times), keeps the screen awake where the browser allows, and hides the pointer.
- `wall.token`: pair a screen that can't sign in by opening `/wall#key=<token>` once. That browser can read the wall's cards and nothing else.
- The weather card knows today's sunrise and sunset (`sun`), which the wall dims by.
- The demo has three wall pages.
- Valet as an app: add it to a phone's Home Screen or install it on a computer, and it opens in its own window with Valet's icon and your title. When the server can't be reached it says so, instead of the browser's error page. See [Valet as an app](https://askvalet.dev/start/app/).
- Notifications on this device, from ⌘K: Valet's own push notifications, with no ntfy or Telegram needed. Everything that goes to your channels (reminders, rules, `live.notify` with `push: true`, insights) goes to these devices too, and a notification opens the tab it's about. On iPhone and iPad it needs Valet on the Home Screen, and the switch says so. `notify.webPush` sets the contact and push services; it's on by default and sends nothing until a device turns it on.

### Security

- The service worker caches only the "can't be reached" page, never the page, its data or anything behind sign-in. Turning notifications on needs what a button needs. Each notification is encrypted for its browser and signed with Valet's own key, kept in `data/vapid.json` (0600), and Valet posts only to the browsers' push services. The CSP names `worker-src 'self'` and `manifest-src 'self'`.

## [0.1.4] - 2026-11-04

### Security

- The copy of the config kept for undo (`config.yaml.previous`) is readable only by Valet's user, like the config itself.

### Added

- What you take off the page leaves as dust: archiving a saved link, clearing finished to-dos, removing a rule or a torrent, unpinning a card, **Not now** on an approval and dismissing the year in review. It comes apart from the left and drifts off while its room closes. Lists that change by themselves still just change, and reduced motion gets a plain fade.
- A context meter in the chat: a small pie beside the model's name, from the tokens the model reported for its last step, with the numbers on hover and a fresh chat offered when it's nearly full. Known Claude models know their window; `assistant.contextWindow` sets it for anything else.
- Sounds, off by default: `appearance.sounds: { enabled, volume }`, made in the browser with no files, for a switch, something done, a "not now", a notice, a message sent and something taken off. ⌘K turns them on or off for one browser.
- Small touches: switches on a spring, a tick on an approval's button, the send arrow lifting out as the stop square arrives, notices that swipe away, the copy icon drawing its tick, posters that lean from the pointer, and Desk and List sliding their pill.
- GitHub repositories: a `traffic` widget and tool for your own repos, with views, visitors, clones and where visitors came from over GitHub's last 14 days. It needs a token that can push to the repo.

### Changed

- The chat's working orbs: a sphere of orbiting particles while it waits for the first words, a sweeping globe while it thinks, a constellation for a lookup and a rolling wave for an action.
- A config diff, the assistant's included, shows each change with a line either side and folds what's unchanged between two changes, rather than every line from the first change to the last. A list written one short entry to a line (`- { widget: a, size: large }`) gets new entries written the same way.

### Fixed

- To-do list: ticking something off on the page works: the switch now says which item it is.
- The chat's send button over a wallpaper is a white square with a dark arrow again; the arrow had gone white on white.
- "Thinking" no longer starts at -0.0s.
- A config edit that replaced or removed the first key of a list entry (a section's `title`, say) no longer drops its `- `, which turned the entry into part of the one above.

## [0.1.3] - 2026-11-03

### Added

- Proxmox VE, Speedtest Tracker, Syncthing, Backrest and Healthchecks.io are full integrations. Proxmox shows every node and guest with its CPU, memory and uptime and the storage pools by fill, and can start, shut down or reboot one guest. Speedtest Tracker charts the last days and can run a test. Syncthing shows folders and devices, out of sync first, and can rescan a folder. Backrest shows each plan's last backup and the next, and can run one now. Healthchecks shows each check with its last ping, and can pause and resume one. Everything that changes something asks first, and their old `status` widget and settings still work.
- Mealie and Tandoor are full integrations: this week's meal plan from today, a recipe of the day with its photo, and new recipes. The assistant searches and reads recipes and adds to the shopping list, asking first.
- Komga and Kavita: continue reading with covers and how far along, what's next in a series (Komga) and what was added lately. The assistant searches the library and says what you're reading.
- Miniflux: the unread articles as a pile to step through (archiving one marks it read), unread per feed, and starred. The assistant searches and reads entries, and marks them read or stars them, asking first.
- Jellyfin, Emby, Navidrome and Audiobookshelf are full integrations: what's playing (with its ring in the top bar), what you're partway through and what's new, with posters and covers. Navidrome adds recently and most played and albums to rediscover; Audiobookshelf, books in progress and your listening this week. The assistant can search each library, and stop a Jellyfin or Emby stream after asking. Existing configs keep working, `status` widget included.
- Rules: standing instructions like "when a download finishes, tell me and pause the rest" or "every morning at 7, if anything is down, tell me". Set up in chat with one approval, whose card names the trigger by the card's title and the action in its tool's own words, then run every half minute with no model. A rule runs one integration tool (never the config, Valet's own tools, plans, pins or MCP), is checked again against `assistant.access` before every run, waits out a cooldown, and pauses itself after three failures. Every run goes in the activity log, the timeline and your notifications. `valet.rules` lists them with Pause and Remove.
- List rows can carry their own buttons.
- Plain commands in ⌘K, run by rule with no model: "pause downloads", "lights off", "what's playing", "pause ads 10 min", "stop plex". Typed exactly, Enter runs one at once: something that looks shows its card, anything that changes something shows the approval card first. A half-typed command is offered below Ask, two that match are both shown, and when nothing matches Enter asks the assistant. They follow the chat's access levels and are logged as `by command`; with no assistant they run page actions and tools that only look. qBittorrent, Pi-hole, Plex (Tautulli), Home Assistant (every light, switch and scene it may control, by name), Seerr, the PC's presets, Sonarr and Radarr, Prowlarr, changedetection.io, Docker and the to-do list have them, and plugins can add their own (`commands`).
- Pi-hole's and Prowlarr's status tools answer with their cards.

### Changed

- `assistant.access.valet` defaults to `control`, which setting up a rule needs. `valet: write` keeps reminders and turns rules off.
- Turning a light on or off, or sending the vacuum, from chat answers with the floor plan as it is now. Pausing or resuming downloads answers with the downloads card.
- The docs say what the code does: which `${NAME}` values are redacted, which keys the config tools leave alone, that a sandbox has no MCP server, which integrations take `insecure`, and Frigate's options.

## [0.1.2] - 2026-11-03

### Changed

- Pausing Pi-hole from chat answers with its chart, now showing the pause and its countdown.
- A config edit that can't be applied is flagged on read-only pages too, without the error itself, which stays with people who can change things.
- The MCP server reports Valet's real version.
- The image no longer carries the README's pictures: 165 MB again.

## [0.1.1] - 2026-11-03

### Added

- Valet as a read-only MCP server (`mcpServer`): your own AI client can look at your homelab through Valet's read tools, behind its own token and access, with results redacted and every call logged.
- The welcome card lists the services it recognises running on the machine, through a read-only Docker socket proxy, each with the lines it takes. With an assistant that may edit the config, one click or "What do you run?" sets them up in chat.

### Changed

- A config edit that can't be applied now says so on the page, with the error, until the next good save. Before, only the log said.
- The top of the overview takes less room.
- The demo is honest about what Valet can do: it explains why a service is down but doesn't pretend to restart it (Valet reads Docker through a read-only proxy). Approvals are shown with pausing Pi-hole and stopping a stream instead, which real Valet does.
- The docs and README no longer claim actions Valet doesn't have, and say plainly which changes ask first: anything the assistant does.
- Saving the config no longer flashes the page empty: cards keep what they show until the new answers arrive.
- A new wallpaper always shows after a save, even when the new file has the same timestamp as the old one.
- Local AI and PC read a published JSON format, so they work with your own endpoint: only `/api/live` is needed for Local AI, the PC's screen preview is optional, and a field that doesn't fit is named in the error. `examples/local-ai/` serves Local AI's format from nvidia-smi and Ollama.
- ROADMAP.md is gone; the changelog says what shipped.
- The year-in-review link waits until there's a story: a near-empty install doesn't offer it.
- The quick start creates `.env` before `docker run` needs it.
- The demo's model shows "(demo)" beside its name, since it's scripted.

## [0.1.0] - 2026-11-03

The first public version.

### Security

From an audit before the first release. Everyone signed in has to sign in once more, because sessions are signed differently now.

- OpenID Connect: the cookie that starts a sign-in could be used as a session, which gave anyone full access. Everything signed now says what it's for.
- Previewing a config edit could send a `${NAME}` to any address without asking. A preview now contacts nothing; `config_try` fetches, and asks first.
- A secret now only goes to hosts it already goes to, judged on the resulting file.
- Approvals are signed by the server. Plan cards use each tool's own words, and a vague name is refused rather than matched to the first thing it fits.
- `/api/confirm` checks input and the read-only rule. The image proxy passes an exact list of types and keeps its own policy.
- Hostile feeds, oversized replies and redirects to another host can no longer stall Valet, fill its memory or carry a key away.
- An unverified email can't be who signs in through OpenID Connect, however the name is picked. A redirect to another host never carries a body. A card's link doesn't count as somewhere its key may go.
- A config edit that reaches a new address (a wallpaper, an embed, a service) says so on its approval card. A key under a section that didn't exist yet no longer lands at the top of the file.
- Sign-ins and failures are logged. Passwords are hashed to OWASP's floor for scrypt, and older ones are rehashed at the next sign-in. HSTS is sent. Release images carry provenance and an SBOM.

### Added

- Live cards, tabs and layout from one YAML file, with 185 integrations.
- An optional assistant with per-integration access and an approval for every change.
- `view`, to draw any numbers as any chart and any pictures as any gallery, including `coverflow` and `album`.
- `rows`, so a widget can span rows.
- A year in review, written from your services' own numbers.
- `sandbox: true`, which saves nothing and gives each visitor a private copy.
- A demo that runs entirely in the browser, built with `npm run demo:static`.
- Docker images for amd64 and arm64, published on each release.
- The year in review ends on your card: no more "The Generous Seeder" style personalities.
- A config edit from chat that has to reprint only rewrites the entry it changes, in the file's own brace style; it used to reformat the whole file.
- Live activities as rings in the top bar, configured under `live`.
- `npm run test:hostile`, in CI: a model that is entirely the attacker's, against every guardrail. `npm run eval:inject` runs poisoned content past your own model.
- `npm run test:exposure`, in CI with `npm audit`, a secret scan of all of history, and CodeQL once the repo is public.
- The assistant answers from Valet's own docs, can change the look as well as the page from chat, undoes its last save, and writes up a bug as a filled-in GitHub issue.
- changedetection.io as a full integration: each watch with what it last saw and what changed, failures first, and assistant tools to read, add, check and remove watches.
- Plain-English approval cards for every action that changes something.
- 3D models of the home and the PC, cameras, a thermostat and a calendar.
- MCP servers as assistant tools, and single-file community integrations.

[Unreleased]: https://github.com/askvalet/valet/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/askvalet/valet/compare/v0.1.8...v0.2.0
[0.1.8]: https://github.com/askvalet/valet/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/askvalet/valet/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/askvalet/valet/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/askvalet/valet/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/askvalet/valet/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/askvalet/valet/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/askvalet/valet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/askvalet/valet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/askvalet/valet/releases/tag/v0.1.0
