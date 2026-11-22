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
- Other builders (`src/render/remotePlayers.ts`) are shown 200 ms behind, blended between position updates. The nearest 24 within 70 m get the full animated body (`src/render/avatar.ts`, shared with the local builder) and a name tag within 45 m; the rest are simple figures in their colour, all one thin-instance mesh.
- Admin (needs the `ADMIN_SECRET` Worker secret, sent as an `x-admin-secret` header): `POST /admin/reset` clears the world, `POST /admin/rollback?minutes=N` undoes every change of the last N minutes (up to 7 days), `GET /admin/stats` shows pieces and builders.
- Measured locally (2026-11-22): 100 bot builders walking and building for a minute, with no dropped connections, actions answered in 19 ms at p95, and a real page at 60 fps among them (`npm run qa:load`). An 18,000-piece world joins in about 0.6 s and draws at 60 fps.

## Trebuchets and the tallest tower (user, 2026-11-22)

The goal is the tallest structure. There are no teams: anyone builds on any structure and attacks any other, with trebuchets. Decided with the user: damage by material, range grows with height, things in the stone's path block it, 6 s reload.

- A trebuchet is a piece (`PIECE_TYPES` "trebuchet", B or 6). It stands on the ground or on a floor in its own cell, holds nothing else up, and falls with its platform (`src/game/structure.ts`). Anyone can remove one, even with someone on it.
- H gets on or off one within 6 m. On it: right click sets the target under the crosshair, click fires. The server checks every shot (`worker/world.ts`): the builder must be its crew, reloaded, and the target 25 m to 120 m + 1 m per metre of height away.
- Rules in `src/game/trebuchet.ts`, shared by the server and the game: the stone flies an exact arc through the target (`planFlight`); the first piece it touches on the way takes the hit (`findImpact`); every piece within 2.2 m takes one hit, and wood breaks in 1, brick in 2, metal in 3, a trebuchet in 2 (`strike`). What breaks goes, and what that strands falls. The server re-checks when the stone arrives, so it flies on if its target was taken away mid-flight.
- Falling and broken pieces become rubble in every page (`src/render/debris.ts`): real physics for 5 s, then they fade; broken pieces burst away from the impact. At most 140 pieces of rubble (40 in battery saver).
- Towers (`src/game/towers.ts`): every grounded group of 3+ pieces, trebuchets excluded, measured by the server 1.5 s after changes. The top five show top right; the top three get gold, silver and bronze flags with their height.
- Trebuchet frames and arms are two thin-instance meshes (`src/render/trebuchetView.ts`); the frame turns toward the target and the arm swings over on a throw and winds back during the reload.
- Messages: protocol version 2 (an open page from before asks to reload). `npm run qa:trebuchet` checks it all with two pages.

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
- Placement rule: slot free, inside the building area, and on the ground or touching an existing piece. Removing a piece makes anything no longer connected to the ground fall.
- Keys: arrow keys or WASD (both always work, user 2026-11-22), Shift run, Space jump, Z/F1 wall, F/F2 floor, X/F3 ramp, C/F4 roof, V remove tool (1-5 also work), click place (hold to keep placing), right click remove, G edit, T material, R turn ramp, Q/E undo/redo, the selected piece's key again puts it away (nothing selected, just run; user 2026-11-22), mouse wheel cycles the hotbar, Esc pause.
- The army is drawn by `src/render/soldierView.ts` as one thin-instance mesh; soldiers are plain data in the siege logic, not physics bodies.
- Movement is fast on purpose (user, 2026-11-21): walk 16 m/s, Shift run 26 m/s, jump 2.6 m (`src/render/player.ts`). The character controller's `maxCharacterSpeedForSolver` must stay above the run speed or running gets capped at 10 m/s.
- Mouse look: 0.0045 rad per pixel at speed 1 (`src/render/cameraRig.ts`), with a Mouse speed slider (0.25× to 3×, default 2× since 2026-11-22) on the menu and pause panel, saved in localStorage (`src/settings.ts`). Raw mouse input is requested, so the operating system's mouse acceleration does not apply.
- Crosshair aiming (user, 2026-11-22, replaces the next-free-spot rule): the target is the slot under the crosshair, pixel accurate (`src/game/aim.ts`). A line runs from beside the builder's head along the crosshair; walls use the vertical panes on grid lines facing the builder, floors the horizontal panes at each storey height (the ground is storey 0), ramps the cell just in front of whatever the crosshair touches, roofs the highest buildable cell the crosshair passes through (best supported among equally high ones, so looking up past a two-storey wall caps it; user 2026-11-22), unless the touched spot is as high. A piece of the same kind under the crosshair (or a wall seen through its own cut door) means "already there" (red). Solid things block the line. Only when no slot is in reach (12 m for walls and floors, 8 m for ramps and roofs) does the piece go right in front of the builder (`buildTarget`), which keeps building on the run and ramp rushing working.
- Character animation (`src/render/player.ts`): knees and elbows bend in a running cycle. The legs hang from an upright pelvis that turns up to about 70 degrees toward the direction of travel, so strafing is a sideways run and moving backwards is a backpedal. The chest turns a quarter of the way with the legs, the head keeps facing where the camera looks, and the body leans into the direction of travel.
- Switching windows (user, 2026-11-22): the browser always releases the mouse, but the game shows no pause panel then, only a small "Click to keep building" note; one click on the canvas captures the mouse again without placing a piece. Esc (mouse released while the window keeps focus) still opens the pause panel. The resume click listens for `pointerdown`, because Babylon cancels pointerdown while the mouse is free and no `mousedown` follows.
- Camera in tight spaces (user report, 2026-11-22, `src/render/cameraRig.ts`): five collision lines around the view instead of one, snap in at once but ease back out only after the view has been clear for 0.35 s, and the over-the-shoulder point slides toward the head when a wall is beside the builder. Mouse events reporting a jump over 250 px are ignored (a known pointer-lock glitch). The character controller adds the builder's capsule to the physics world, so it is in its own collision group (`src/render/physicsGroups.ts`) and every camera and crosshair raycast skips it; before that fix the camera zoomed into the builder's head when running sideways.
- `?gl` in the address forces WebGL instead of WebGPU.
- Keeping laptops cool (user report, 2026-11-22: the fan came on for snapfort.io but not for similar games): no `powerPreference` is requested, so dual-GPU Macs stay on the built-in chip; shadows are two 1024 cascades (was three 2048, a sixth of the shadow work); the drawing resolution adapts (`src/render/resolution.ts`: up to 1.25x CSS pixels, stepping down when the frame rate stays under 50); no `backdrop-filter` blur anywhere (it recomposites every frame over a live canvas). `node qa/perf.mjs` reports pixels drawn, shadow map size and CPU time per frame.
- Aiming at a slot that is already built (user, 2026-11-22): keep the Fortnite-style rule. The ghost turns red, a click adds nothing, and the piece never jumps to another grid line. To double a wall, step back a tile; to change it, edit it (G).
- Battery saver (user's old laptop still ran its fan, 2026-11-22): a Graphics setting (Auto / Sharp / Battery saver, saved with the other settings; `src/render/graphics.ts`). Battery saver draws 30 fps (a custom frame requester, so Babylon's frame timing and the game's speed stay right), at most 1x CSS pixels, without live shadows. Auto picks it for integrated Intel, software and phone graphics chips, or 4 or fewer processor cores. With the processor slowed 6x a frame still takes about 1.2 ms of processor time, so the heat comes from the graphics chip. `?stats` on the live site shows fps, engine, mode, resolution and chip.
- The game never pauses (user, 2026-11-22): the world is always live, so Esc opens a settings panel over the still-moving world ("Back to building"), not a pause. Esc again, or a click beside the panel, goes back to building; when the browser will not recapture the mouse from Esc, the "Click to keep building" note shows instead.
- Multiplayer QA: `npm run qa:multi` (two pages building in one fresh world must always agree: races, collapse, undo, random play, reload) and `npm run qa:load -- <bots> <seconds>` (bot builders over WebSockets plus a real page). The dev server runs the Worker and the World Durable Object through `@cloudflare/vite-plugin`, so `/ws` works locally; local world data lives in `.wrangler/`.
- Browser QA: with the Gallop dev server running, `npm run qa` drives the game in headless Chrome with real keyboard and mouse input (71 checks, including an on-screen pixel check that every placed piece is visible, and 1,500 random actions with a draw/collision audit). `npm run qa -- "http://localhost:5173/?gl"` runs it on WebGL. In development, `snapfort.audit()` in the browser console lists any piece that is recorded but not drawn or not solid.
- Thin instances: set `thinInstanceCount` before `thinInstanceBufferUpdated`, because Babylon uploads only the first `thinInstanceCount` entries. Getting this backwards made newly placed pieces invisible while still blocking their spot (fixed 2026-11-21).
- Deploying the shared world: `npm run build` writes `dist/client` (the game) and `dist/snapfort` (the Worker and its generated wrangler config), and `wrangler deploy` picks that up. Before the first deploy with the World, set the admin secret with `npx wrangler secret put ADMIN_SECRET`.
- Deployed (user asked, 2026-11-22) to Cloudflare Workers static assets on the webplant.media Cloudflare account: https://snapfort.webplantmedia.workers.dev. `npm run deploy` builds and publishes. Once the user owns snapfort.io and its zone is on that account, add it as a Workers custom domain (`routes` with `custom_domain: true` in `wrangler.jsonc`) and redeploy.
