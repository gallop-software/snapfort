# SnapFort.io — Plan

This is the original brief, saved so the plan outlives the chat. Progress notes are at the bottom.

## Brief

Build SnapFort.io, an original 3D browser game that is a building-only sandbox: the player runs around a world and quickly snaps large pieces together to make buildings, castles and other structures. There is no fighting, no weapons, no health and no enemies; the whole game is building. It borrows the fast snap-building feel of the build-battle genre, but it must be its own game with its own name, look, art and sound, and must not copy any existing game's assets, characters, maps or visual style.

FIRST STEP: save this whole brief as PLAN.md in the project root so the plan outlives this chat, then build phase 1.

## Stack (already decided with the user, do not swap it)

- Vite + TypeScript (strict) + Babylon.js with the Havok physics plugin, deployed to Cloudflare Workers as static assets (wrangler).
- This is an empty project, not a template, so scaffold it yourself.
- Do NOT use Next.js, and do NOT use React or React Three Fiber for the game world: the game runs its own Babylon render loop, with a light plain HTML/CSS overlay for the hotbar, menus and settings.
- Use Babylon's WebGPU engine where the browser supports it and fall back to WebGL.
- The user does not care about SEO; the goal is the best in-browser game experience: smooth frame rate, fast load, responsive controls.
- Keep game logic (piece definitions, grid and snapping rules, build state, undo history, save format) in plain typed modules separate from rendering so it can be unit tested and later shared with a multiplayer server.
- Run and preview the game only with Gallop's dev server (gallop dev start / status / logs), never npm run dev directly.

## Design picks (decided)

- Third-person camera following a simple original character, with a first-person toggle later.
- Big grid-snapped pieces (wall-sized, not small voxels) placed with a translucent ghost preview that shows green when valid and red when not.
- Each piece type on a quick key and a hotbar so building is fast.
- Solo play first, multiplayer last.

## Phase 1 — core sandbox

A flat world with sky and lighting, a character that walks, runs and jumps using Havok's character controller and can stand on and climb what it builds, mouse look with pointer lock, the four basic pieces (wall, floor, ramp, roof/cone) snapping to a shared grid with rotation, the ghost preview, place, delete, undo and redo, and thin instances or equivalent so thousands of pieces stay smooth. Show an FPS readout in development.

## Phase 2 — castle kit

More pieces (round and square towers, arches, battlements, doors, windows, stairs, pillars, half walls), materials (wood, stone, brick, glass) with a colour picker, piece editing that cuts a window or door opening into a placed piece, and a fly mode for working on tall structures.

## Phase 3 — save and share

Builds saved in the browser (a versioned, validated JSON format), named save slots, export and import, a share link that opens someone else's build, and a small gallery of starter structures to load and modify.

## Phase 4 — building together (optional, only when the user asks)

Friends building in the same world in real time, using Cloudflare Durable Objects with WebSockets on the same Cloudflare account as the game. Design the build state in phases 1 to 3 as a list of piece operations so this can be added without a rewrite.

## Other facts

- The name is SnapFort.io.
- The domain snapfort.io was unregistered when checked on 2026-11-21 and again on 2026-11-22 (no whois record, no zone in the Cloudflare account), so do not assume it is connected; do not buy anything without asking.
- Work phase by phase, show the user each phase running in the dev server before starting the next, and ask before any choice that changes the design picks above.

## Change of direction (user, 2026-11-21, after trying phase 1)

The user asked for two things that replace parts of the brief above:

1. The build-battle feel of the game at https://snowroad.io/2v2io, but building only, no shooting. Taken from it: quick piece keys beside WASD (Z wall, X ramp, C roof; F floor added). Nothing of its look, names or maps is used.
2. A theme and a way to lose: a massive army charges, and the player must build a fortress to keep it out. If a soldier reaches the player they are captured and taken to prison, and the game is over.

So "no enemies" no longer holds. Still true: no weapons, no shooting, no health, nobody gets hurt. The army only batters pieces down and captures. Free build (no army) stays as a second mode on the menu.

Siege rules as built (all in `src/game/siege.ts`, numbers at the top of the file):
- 40 s to build, then a wave every 35 s. Wave n adds 10 + 8n soldiers; soldiers never leave, so the army keeps growing (cap 600). Later waves come from several sides.
- Soldiers stay on the ground and walk straight at the player. A wall, ramp or roof in the way gets battered: 24 hits for a wall or roof, 16 for a ramp, with only about four soldiers able to hit one piece at a time.
- A player standing higher than 1.7 m is out of reach, so the army goes for the nearest piece standing on the ground instead. In siege mode any piece that no longer connects to the ground falls, so the fort comes down from the bottom.
- A soldier within 1.1 m of a reachable player captures them: game over, with time held, waves and pieces placed.
- Building is unlimited and instant; there are no resources yet.

## Second change of direction (user, 2026-11-21)

The user asked for the game to be "as close to Fortnite as possible", building mode only for now, to get the building right before anything else. Agreed scope: match how Fortnite-style building plays; keep SnapFort's own name, art, character and sound (no Fortnite assets, characters or look).

Built:
- Pieces land in front of the builder based on where they stand and look, not on what the crosshair touches (`src/game/targeting.ts`). Walls go on the first grid line ahead, floors, ramps and roofs in the cell ahead or underfoot, a storey up when looking up. Running up a ramp, the next ramp continues a storey higher (ramp rushing). Holding the mouse keeps placing as you move (turbo building), and a click right after a piece key places the new piece.
- Bigger grid: 5 m cells, 3.75 m storeys (same 4:3 proportion, about 37 degree ramps).
- Editing (G): walls split 3 x 3 and floors 2 x 2; click or drag tiles to cut windows and doors, G or Enter confirms, right click resets. Stored as an `edit` operation, so undo, saves and multiplayer handle it.
- Materials: wood, brick and metal, cycled with T.
- Structural collapse in build mode: removing a piece drops everything no longer connected to the ground, and one undo brings it all back.
- Keys: Z/F1 wall, F/F2 floor, X/F3 ramp, C/F4 roof, V remove tool, G edit, T material, R turn ramp, Q/E undo/redo.
- Human-proportioned original builder with arm and leg swing; closer over-the-shoulder camera.

Siege mode is still in the code (`src/game/siege.ts`, tested) but its menu button is hidden until the user asks for it again.

## Phase 4 as built: one shared world (user, 2026-11-22)

The user asked for the whole build to live on Cloudflare, so anyone opening snapfort.io sees what has been built and builds with everyone else in real time: one large world, sized for 100 builders online at once. Decided with the user:
- Anyone can remove or edit any piece. Vandalism is undone with the admin rollback.
- Each browser gets a random name and jacket colour (saved in localStorage, `src/identity.ts`), changeable on the menu and pause panel. Name tags float over nearby builders.
- No Start over button; the world is only wiped through the admin endpoint.
- Siege (still hidden) is played alone on a private copy of the world and never touches the shared one.

How it works:
- `worker/index.ts` serves the game files and sends `/ws` to the one `World` Durable Object (`worker/world.ts`, `idFromName("main")`). On a local dev server, `?world=<name>` opens a separate test world (QA uses this); elsewhere it is ignored.
- The World holds the build in memory with the same `BuildState` rules as the game. Each action is checked by `applyAction` (`src/net/authority.ts`): every op in order, then new pieces must be supported once the whole action is in, then whatever lost its connection to the ground falls (`findLooseAfterRemoval`, which only searches near the removed pieces).
- Saving: one SQLite row per 16×16-cell chunk, written 5 s after the first unsaved change and when the last builder leaves; a change log (with inverses, kept 7 days) is written the same way. The pending save timer keeps the object from hibernating with unsaved changes. Rows are capped (8,000 pieces per chunk, 4,000 log entries per row) to stay under SQLite's 2 MB limit.
- Movement: each page sends its position at most every 100 ms and only when it changed; the World sends one combined message of everyone who moved 10 times a second, and stops the timer when nobody moves (so it can hibernate).
- Limits: 120 connections, 60,000 pieces, 5,000 ops per action, 40 placements/edits per second per builder with a burst of 2,000 (removes cost 0.1), 60 messages per second, 64 KB per message.
- In the page, `SyncedState` (`src/net/sync.ts`) applies own changes at once (building never waits for the network) and sends each frame's changes as one action. When a change from someone else, or the server's answer, clashes with own changes still in flight, those are rolled back, the server's version applied, and they are applied again on top, so every page ends up with the server's order. Undo history stays per player. Joining or reconnecting replaces the build with the server's, changing only what differs.
- Other builders (`src/render/remotePlayers.ts`) are shown 200 ms behind, blended between position updates. How they are drawn depends on their size on screen, as in big shooters, never on how many players there are (user, 2026-11-22): big enough (about 120 m away without zoom, much further through the scope) gets the full animated body (`src/render/avatar.ts`, shared with the local builder), with a name tag from about 50 m; smaller ones are stand-ins, a flipbook of frozen poses of the same builder (standing, two running strides, in the air) in their colour, one thin-instance mesh per pose (`src/render/standIns.ts`). Someone being thrown always gets the full body.
- Admin (needs the `ADMIN_SECRET` Worker secret, sent as an `x-admin-secret` header): `POST /admin/reset` clears the world, `POST /admin/rollback?minutes=N` undoes every change of the last N minutes (up to 7 days), `GET /admin/stats` shows pieces and builders.
- Measured locally (2026-11-22): 100 bot builders walking and building for a minute, with no dropped connections, actions answered in 19 ms at p95, and a real page at 60 fps among them (`npm run qa:load`). An 18,000-piece world joins in about 0.6 s and draws at 60 fps.

## Trebuchets and the tallest tower (user, 2026-11-22)

The goal is the tallest structure. There are no teams: anyone builds on any structure and attacks any other, with trebuchets. Decided with the user: damage by material, range grows with height, things in the stone's path block it, 6 s reload.

- A trebuchet is a piece (`PIECE_TYPES` "trebuchet", B or 6). It stands on the ground or on a floor in its own cell, holds nothing else up, and falls with its platform (`src/game/structure.ts`). Anyone can remove one, even with someone on it.
- H gets on or off one within 6 m, standing on its turntable base (its own floor), right of the frame; walking or being thrown away from it lets go. On it, the crosshair is the target (aim and shoot, user 2026-11-22: no right click): the ring and arc follow it live, green in range and red not, and a click fires. The server checks every shot (`worker/world.ts`): the builder must be its crew, reloaded, and the target 25 m to 120 m + 1 m per metre of height away.
- Rules in `src/game/trebuchet.ts`, shared by the server and the game: the stone flies an exact arc through the target (`planFlight`); the first piece it touches on the way takes the hit (`findImpact`); every piece within 2.2 m takes one hit, and wood breaks in 2, brick in 4, metal in 6, a trebuchet in 1 (`strike`; doubled from 1, 2, 3 on 2026-11-22). What breaks goes, and what that strands falls. The server re-checks when the stone arrives, so it flies on if its target was taken away mid-flight.
- Aiming is through a scope (user, 2026-11-22: the frame and the builder were in the way): on a trebuchet the camera sits just above where the stone is released and looks freely all the way round; the trebuchet and the builder are hidden from their own view (others still see them); the wheel zooms (1× to about 5×, with slower mouse look when zoomed); the crosshair becomes a scope reticle and the hotbar goes away (`CameraRig.scope`).
- Collapses look the same however they start (2026-11-22): a stone hit, or a builder removing a support by hand. Whatever loses its support falls as rubble on every page (on remote pages, in a batch of removals the first is the piece taken away and the rest fall). A fallen trebuchet tumbles with its frame and arm.
- Falling and broken pieces become rubble in every page (`src/render/debris.ts`): real physics for 5 s, then they fade; broken pieces burst away from the impact. At most 140 pieces of rubble (40 in battery saver).
- Towers (`src/game/towers.ts`): every structure of 3+ pieces that reaches the ground, trebuchets excluded. Pieces that touch or stand within one cell of each other count as one structure (user, 2026-11-22: walls standing inside a fort were ranked as separate towers); collapse still needs pieces to touch. Towers are measured by the server 1.5 s after changes. Only the tallest gets a flag: one gold flag in the whole world, with its height, at twice the first size (user, 2026-11-22: no tower board on screen, one flag).
- Builders within 7 m of an impact are thrown, and builders left standing on nothing (a stone or anyone removed what held them) fall (user, 2026-11-22). The server plans every such flight (`planFall` in `src/game/fall.ts`: gravity, sliding down walls in the way, landing on the first surface below) from where it last knew the builder was, and sends it to everyone as a "thrown" message; every page plays the same flight, so it happens even when the builder's own tab is asleep, and waking up puts them where they came down. They land flat on their back for 1.5 s, then take 0.7 s to get up; no control or building until then, and a crewed trebuchet is let go.
- Trebuchet frames and arms are two thin-instance meshes (`src/render/trebuchetView.ts`); the frame turns toward the target and the arm swings over on a throw and winds back during the reload.
- Messages: protocol version 2 (an open page from before asks to reload). `npm run qa:trebuchet` checks it all with two pages.

## Ramp rushing and Turn (user reports, 2026-11-22)

Reported: sometimes a ramp could not be built up the way you ran (on the phone, and at times on desktop); a refresh fixed it. Confirmed two causes: the Turn setting (R / the Turn button) stayed on across pieces and menus with no sign of it, so ramps went sideways or backwards and could not join; and near a diagonal the ramp direction flipped between two ways, which (ramps joining only ramps that climb the same way) broke the staircase.
- Turn is used once: it goes back to straight after a turned ramp is placed, and when switching pieces. R shows "Ramp turned: right/back/left"; the phone's Turn button lights up with the direction, and sits in the top-left column, away from Place.
- Standing on a ramp and facing within about 60 degrees up it, the next ramp continues that staircase (one cell on, one storey up, same way) when it fits there. While ramps keep being placed (within 1.5 s), the next keeps the last one's direction if the builder still faces within 60 degrees of it. A deliberate bigger turn, or Turn, still changes it.
- Touch buttons lose their pressed look when the controls hide (the gear used to stay orange).

## Phones and tablets (user, 2026-11-22: "follow the conventions of Fortnite for mobile")

Touch-only devices (no mouse: `(pointer: coarse)` and not `(any-pointer: fine)`; `?touch` forces it on a computer) get on-screen controls (`src/ui/touch.ts`); computers are unchanged. There is no pointer lock on touch: `Input.locked` means "playing", and the controls feed `Input.axis` (joystick), `addLook` (dragging) and the game's own mouse and key handlers (buttons).
- Left thumb: a joystick appears where it lands (left 42% of the screen); pushed to its edge, the builder runs. Right thumb: drag to look and aim. Both at once work.
- Buttons: Jump and Place (hold to keep placing) bottom right; Remove, Edit, Turn beside them; gear (settings), Undo, Redo and the Material button top left; the hotbar along the top picks pieces. Editing turns them into Cut / Reset / Done. Near a trebuchet a Get on button appears; on it, drag to aim, Fire, Zoom (cycles) and Get off; the trebuchet panel moves to the bottom left.
- Landscape only: in portrait a "turn your phone sideways" screen. Phones default to battery saver. The menu and settings are two compact columns on short screens; the tower board is one line; everything respects the notch and home bar (safe areas). No page zoom, scroll, bounce, selection or long-press menus.
- Added to the home screen it opens full screen (`public/manifest.webmanifest`, icons made from `favicon.svg`).
- `npm run qa:mobile`: on seven phones and tablets, nothing off screen and no controls overlapping (menu, play, trebuchet, settings); portrait; and every control driven with multi-touch on an iPhone.

## Chat (user, 2026-11-22)

Decided with the user: typed messages only (no quick-chat wheel, no voice for now), no groups (everyone builds in one world, so there is no side to talk to privately), no muting, no admin silencing for now, and nothing ever saved. Talking works like building: aim, then say.

- Chat in sight (user, 2026-11-23: "is Enter intuitive? I think you need a chat icon"): on computers a chip in the bottom-left corner (bubble, Enter, Chat; clickable when the mouse is free), "/" opens chat too, the chip (or the phone's chat button) glows when someone else talks, and the first time a hint says how to reply; the first-game tips end with "Press Enter to chat".
- Enter (or the Chat button on phones) opens one text line, Everyone or Nearby (Tab or a tap switches). It starts on Everyone, and whichever was picked last stays for the rest of the visit (user, 2026-11-22), not saved between visits. At most 80 characters. There is no message list and nothing scrolls.
- Nearby: a bubble over the speaker's head for 8 s, for builders within 80 m; off screen it waits at the edge with an arrow (behind you: along the bottom). Said while the crosshair is on a built piece within 60 m, the message is also pinned there.
- Ping: middle click (Ping button on phones) marks the spot under the crosshair for builders nearby, with the pinger's name and distance, for 8 s. One pin per builder.
- Everyone: up to three lines at the top that fade after 8 s (a newer one pushes the oldest out), and no bubble over the speaker (user, 2026-11-22: one place per message is enough). Someone arriving sees the lines from the last 30 s.
- No wait between messages (user, 2026-11-22: "don't put a limit on back to back messages"), the same words twice included. Only a flood is held back, on the server and mirrored in the page: more than 5 messages or pings within 5 s ("Slow down a little"; the message waits in the line). Typing by hand does not reach it; it stops one script from filling the lines for everyone.
- Filter on the server (`src/net/chat.ts`, unit tested): swear words and slurs (with look-alike characters, stretched letters and dots between letters folded), links, email addresses and phone numbers become ♥♥♥; control characters, invisible formatting and stacked accents are stripped.
- Architecture: no new Durable Object. The World object already has every connection and every builder's position, so chat is two more messages (`say` in, `said` / `hush` out) on the same socket. It keeps only in memory when each builder last talked and the last three lines to everyone; nothing touches SQLite.

## The Full Game and the Moon (user, 2026-11-23)

Decided with the user: one way to pay, a **one-time $7 "Full Game"** (no subscriptions: simplest to build and to understand), tax included in the price, Stripe as merchant of record (Managed Payments), support email dev@webplant.media. A separate Stripe account "SnapFort" (organization Web Plant Media, alongside the other Web Plant Media LLC brands) keeps its customers, keys, statement name (SNAPFORT.IO) and disputes apart from the other businesses.

- **Paid worlds**: the meadow stays free; the Full Game unlocks building in every paid world. Anyone can *visit* a paid world (walk, look, chat, watch, be thrown): the best advert for it. The first is **the Moon** (`snapfort.io/moon`): a third of the gravity (a jump clears a storey and floats down; falls knock you down only from 4 m), trebuchets reach 1.6× as far with slow lobs of the same shape, builders hit fly about 100 m, rubble drifts; black starry sky, the Earth above the horizon, a low white sun, grey cratered ground. Same building rules, its own flag and chat.
- Worlds are `src/game/environments.ts` (gravity, jump, stone flight, range, throws, knockdown drop, rubble). Rules that depend on the world take it as an argument (two worlds can share a server process). Each world is its own World object ("main", "moon"); the Worker tells a world which it is on connect and it saves that.
- **No accounts: a SnapFort key** (SNAP-XXXX-XXXX-XXXX, about 59 bits) is made just before checkout, shown after paying with Copy, saved in the browser, and typed in (Settings, Have a key?) on other devices. Lost keys: `/admin/keys?email=` (ADMIN_SECRET). Email sign-in can come later.
- **Ledger** Durable Object: every key, pending or paid, with the session and the buyer's email. Paid when the page comes back from checkout (`/api/claim` asks Stripe) or when Stripe's webhook says so (`/api/stripe`, signature checked with Web Crypto), whichever is first. Keys bought in test mode only work while the site is in test mode.
- The World checks the key on hello (and on a `key` message, so buying opens building without rejoining); visitors' `act`, `board` and `fire` are refused (`denied: "locked"`); the page fades the hotbar and explains.
- **Live since 2026-11-23**: the SnapFort Stripe account is activated (charges and payouts on) with Managed Payments on by default, so Stripe is the merchant of record; Checkout sessions show `managed_payments.enabled`. Managed Payments refuses `custom_text`, so the checkout page has no note of ours. Live product "SnapFort Full Game" with a $7 tax-included price (`STRIPE_PRICE_ID` in `wrangler.jsonc`), live webhook to snapfort.io/api/stripe, live key and webhook secret as Worker secrets. Local development stays on the sandbox (key, webhook secret and price in `.dev.vars`; the QA reads them from there); with a test key the Unlock button only shows with `?testpay`. Keys bought in the sandbox stopped working at the switch, as intended.
- **Keys by email** (user, 2026-11-23: "they should just have to be sent an email"): Cloudflare Email Service (binding `EMAIL`, from keys@snapfort.io, replies to dev@webplant.media; snapfort.io onboarded for sending on 2026-11-23 through the API, `POST /zones/{zone}/email/sending/subdomains` with `{"name":"snapfort.io"}`; Cloudflare added the cf-bounce MX/SPF/DKIM and a `_dmarc p=reject` record itself; Workers Paid). The key is emailed once when a purchase is first marked paid (return from checkout or webhook, whichever is first). "Lost your key?" in Settings takes an email and sends that address its keys; the page never shows them and answers the same whether or not the email bought anything. Limits: one email per address every 5 minutes (5 a day), 20 requests a day per connection. The email is branded like the game (`worker/mail.ts`, plain-text copy too).
- `/terms`: what the Full Game is, refunds (14 days, by email), support, privacy (the purchase email is kept only to find lost keys; Stripe holds card details; chat is not stored).

## A calmer menu, and selling the Moon (user, 2026-11-23: "too much info, hard to scroll"; "make paying very clear, simple and easy")

- The start screen only picks a world and plays: two world cards with pictures rendered from the game (`public/worlds/*.jpg`, made with `qa/world-images.mjs`), "You're here" on the current one, one big button, "Playing as Name ●" (opens Settings), and links to Controls, Settings, Terms. Controls (the key list or the touch help, and the building rules) and Settings are panels of their own; Esc while playing shows the settings as before.
- On the Moon without the Full Game: **Unlock the Moon · $7** is the big button on the menu, above Visit the Moon; while visiting, a bar at the top keeps **Unlock · $7** in sight (U on a keyboard, a tap on phones); trying to build (click, a piece key, H, G) opens the unlock panel: the Moon's picture, four things you get, **Unlock · $7**, Have a key?, Terms, Keep visiting.
- Switching world while playing (user, 2026-11-23: "when on the moon, I can't switch back"): the Esc / gear panel has Meadow and Moon buttons with their pictures, the current one marked; one tap goes there.
- First-game tips, one at a time, each moving on once done: move, place a wall, try another piece, hold to keep placing, pieces need support. Never shown again in that browser (`snapfort.tips`); a ✕ hides them.

## Progress

- [x] Phase 1 — core sandbox (built 2026-11-21)
- [x] Siege mode, first version (built 2026-11-21, hidden for now)
- [x] Fortnite-style build mode: build-in-front placement, ramp rushing, editing, materials, collapse (built 2026-11-21, waiting for the user to try it)
- [ ] Phase 2 — castle kit
- [ ] Phase 3 — save and share
- [x] Phase 4 — one shared world for up to 100 builders (user asked 2026-11-22; built 2026-11-22, not deployed yet)

## Notes for whoever picks this up

- Grid: cells are 5 m wide, storeys 3.75 m high (`src/game/constants.ts`). Walls sit on cell edges, floors on cell bottoms, ramps and roofs fill a cell.
- `src/game/` is pure TypeScript with no Babylon imports: pieces and materials, build state (changed only through place/remove/edit operations), undo history (one entry can hold several operations), build-in-front targeting, edit tiles, collapse, siege. Unit tests in `tests/`, run with `npm test`.
- `src/render/` draws that state: one thin-instance mesh per piece type, one static Havok body per piece, the ghost, the character and the camera. `src/game.ts` wires input, logic and rendering together.
- All art and sound are generated in code (canvas textures, Web Audio); there are no asset files.
- Contact (user, 2026-11-22: ramps were hanging off each other in a V): pieces hold each other up only where they share a stretch of edge, or an edge lies flat against a wall (`src/game/contact.ts`); a single corner point no longer counts. Ramps join ramps only when both climb the same way (end to end or side by side); to turn, a staircase needs a floor, which takes ramps from all four sides. Straight ramp towers are fine. When the world loads, anything that no longer stands under the current rules comes down (`World.load`).
- Placement rule: slot free, inside the building area, and on the ground or touching an existing piece. Removing a piece makes anything no longer connected to the ground fall.
- Keys: arrow keys or WASD (both always work, user 2026-11-22), Shift run, Space jump, Z/F1 wall, F/F2 floor, X/F3 ramp, C/F4 roof, V remove tool (1-5 also work), click place (hold to keep placing), right click remove, G edit, T material, R turn ramp, Q/E undo/redo, the selected piece's key again puts it away (nothing selected, just run; user 2026-11-22), mouse wheel cycles the hotbar, Esc pause.
- The army is drawn by `src/render/soldierView.ts` as one thin-instance mesh; soldiers are plain data in the siege logic, not physics bodies.
- Movement is fast on purpose (user, 2026-11-21): walk 16 m/s, Shift run 26 m/s, jump 2.6 m (`src/render/player.ts`). The character controller's `maxCharacterSpeedForSolver` must stay above the run speed or running gets capped at 10 m/s.
- Mouse look: 0.0045 rad per pixel at speed 1 (`src/render/cameraRig.ts`), with a Mouse speed slider (0.25× to 3×, default 2× since 2026-11-22) on the menu and pause panel, saved in localStorage (`src/settings.ts`). Raw mouse input is requested, so the operating system's mouse acceleration does not apply.
- Crosshair aiming (user, 2026-11-22, replaces the next-free-spot rule): the target is the slot under the crosshair, pixel accurate (`src/game/aim.ts`). A line runs from beside the builder's head along the crosshair; walls use the vertical panes on grid lines facing the builder, floors the horizontal panes at each storey height (the ground is storey 0), ramps the cell just in front of whatever the crosshair touches, roofs the highest buildable cell the crosshair passes through (best supported among equally high ones, so looking up past a two-storey wall caps it; user 2026-11-22), unless the touched spot is as high. A piece of the same kind under the crosshair (or a wall seen through its own cut door) means "already there" (red). Solid things block the line. Only when no slot is in reach (12 m for walls and floors, 8 m for ramps and roofs) does the piece go right in front of the builder (`buildTarget`), which keeps building on the run and ramp rushing working.
- Character animation (`src/render/player.ts`): knees and elbows bend in a running cycle. The legs hang from an upright pelvis that turns up to about 70 degrees toward the direction of travel, so strafing is a sideways run and moving backwards is a backpedal. The chest turns a quarter of the way with the legs, the head keeps facing where the camera looks, and the body leans into the direction of travel.
- Switching windows (user, 2026-11-22): the browser always releases the mouse, but the game shows no pause panel then, no note either (user, 2026-11-22: they disliked it); one click on the canvas captures the mouse again without placing a piece. Esc (mouse released while the window keeps focus) still opens the pause panel. The resume click listens for `pointerdown`, because Babylon cancels pointerdown while the mouse is free and no `mousedown` follows.
- Camera in tight spaces (user report, 2026-11-22, `src/render/cameraRig.ts`): five collision lines around the view instead of one, snap in at once but ease back out only after the view has been clear for 0.35 s, and the over-the-shoulder point slides toward the head when a wall is beside the builder. Mouse events reporting a jump over 250 px are ignored (a known pointer-lock glitch). The character controller adds the builder's capsule to the physics world, so it is in its own collision group (`src/render/physicsGroups.ts`) and every camera and crosshair raycast skips it; before that fix the camera zoomed into the builder's head when running sideways.
- Height (user, 2026-11-22): storeys 0 to 80 (`MAX_LEVEL`), so the tallest pieces top out at about 304 m. The server accepts positions up to 3 storeys above that. Fog and the shadows' reach grow with the camera's height, so the view down from the top stays clear. Trebuchet range is deliberately not capped: at the top it reaches 120 + 300 = 420 m, most of the 480 m world.
- Materials by height (user, 2026-11-22, instead of a weight system): metal on storeys 1–10, brick on 1–30, wood anywhere (`MATERIAL_MAX_LEVEL`, `materialFor` in `src/game/pieces.ts`). Building above a material's limit uses the strongest material allowed there, and the material badge says so ("Brick · Metal only to storey 10"). The server refuses anything over the limit. Trebuchets are not limited. Towers end up with a strong base and a fragile wooden top. The game never ends: no win state, the lead just changes hands.
- `?gl` in the address forces WebGL instead of WebGPU.
- Keeping laptops cool (user report, 2026-11-22: the fan came on for snapfort.io but not for similar games): no `powerPreference` is requested, so dual-GPU Macs stay on the built-in chip; shadows are two 1024 cascades (was three 2048, a sixth of the shadow work); the drawing resolution adapts (`src/render/resolution.ts`: up to 1.25x CSS pixels, stepping down when the frame rate stays under 50); no `backdrop-filter` blur anywhere (it recomposites every frame over a live canvas). `node qa/perf.mjs` reports pixels drawn, shadow map size and CPU time per frame.
- Aiming at a slot that is already built (user, 2026-11-22): keep the Fortnite-style rule. The ghost turns red, a click adds nothing, and the piece never jumps to another grid line. To double a wall, step back a tile; to change it, edit it (G).
- Battery saver (user's old laptop still ran its fan, 2026-11-22): a Graphics setting (Auto / Sharp / Battery saver, saved with the other settings; `src/render/graphics.ts`). Battery saver draws 30 fps (a custom frame requester, so Babylon's frame timing and the game's speed stay right), at most 1x CSS pixels, without live shadows. Auto picks it for integrated Intel, software and phone graphics chips, or 4 or fewer processor cores. With the processor slowed 6x a frame still takes about 1.2 ms of processor time, so the heat comes from the graphics chip. `?stats` on the live site shows fps, engine, mode, resolution and chip.
- The World Durable Object sleeps (hibernates) when nothing has happened for a few seconds, and its memory is wiped (user saw "That trebuchet is gone" while aiming, 2026-11-22). Anything that must survive goes with the player's socket (`serializeAttachment`: trebuchet crew and reload) or into SQLite (the build, the log, and the damage of pieces still standing, in the `state` table). If the server ever forgets a crew whose trebuchet still stands, the game quietly boards it again.
- No pause state, ever (user, 2026-11-22): a tab is either open (and up to date) or closed. The browser stops drawing a hidden tab, so nothing may depend on frames being drawn: anything others see is decided by the server (building, impacts, throws and falls), and anything animated locally runs on the clock (`performance.now()` timestamps: the trebuchet arm's swing and reload, stones, rubble, dust, other builders' positions and flights), so a tab that comes back shows the present moment at once. New features must follow this.
- The game never pauses (user, 2026-11-22): the world is always live, so Esc opens a settings panel over the still-moving world ("Back to building"), not a pause. Esc again, or a click beside the panel, goes back to building; when the browser will not recapture the mouse from Esc, one click on the game does.
- Chaos QA: `npm run qa:chaos -- <seconds>`: two pages press random keys and mouse buttons (every tool, edit, undo/redo, trebuchets, zoom, Esc); afterwards both must agree, every piece must be drawn and solid, and nothing may have thrown.
- Multiplayer QA: `npm run qa:multi` (two pages building in one fresh world must always agree: races, collapse, undo, random play, reload) and `npm run qa:load -- <bots> <seconds>` (bot builders over WebSockets plus a real page). The dev server runs the Worker and the World Durable Object through `@cloudflare/vite-plugin`, so `/ws` works locally; local world data lives in `.wrangler/`.
- Browser QA: with the Gallop dev server running, `npm run qa` drives the game in headless Chrome with real keyboard and mouse input (71 checks, including an on-screen pixel check that every placed piece is visible, and 1,500 random actions with a draw/collision audit). `npm run qa -- "http://localhost:5173/?gl"` runs it on WebGL. In development, `snapfort.audit()` in the browser console lists any piece that is recorded but not drawn or not solid.
- Thin instances: set `thinInstanceCount` before `thinInstanceBufferUpdated`, because Babylon uploads only the first `thinInstanceCount` entries. Getting this backwards made newly placed pieces invisible while still blocking their spot (fixed 2026-11-21).
- Deploying the shared world: `npm run build` writes `dist/client` (the game) and `dist/snapfort` (the Worker and its generated wrangler config), and `wrangler deploy` picks that up. Before the first deploy with the World, set the admin secret with `npx wrangler secret put ADMIN_SECRET`.
- Deployed (user asked, 2026-11-22) to Cloudflare Workers static assets on the webplant.media Cloudflare account: https://snapfort.webplantmedia.workers.dev. `npm run deploy` builds and publishes. Once the user owns snapfort.io and its zone is on that account, add it as a Workers custom domain (`routes` with `custom_domain: true` in `wrangler.jsonc`) and redeploy.
