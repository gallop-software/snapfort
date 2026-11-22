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

## Progress

- [x] Phase 1 — core sandbox (built 2026-11-21)
- [x] Siege mode, first version (built 2026-11-21, hidden for now)
- [x] Fortnite-style build mode: build-in-front placement, ramp rushing, editing, materials, collapse (built 2026-11-21, waiting for the user to try it)
- [ ] Phase 2 — castle kit
- [ ] Phase 3 — save and share
- [ ] Phase 4 — building together (only when asked)

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
- Browser QA: with the Gallop dev server running, `npm run qa` drives the game in headless Chrome with real keyboard and mouse input (71 checks, including an on-screen pixel check that every placed piece is visible, and 1,500 random actions with a draw/collision audit). `npm run qa -- "http://localhost:5173/?gl"` runs it on WebGL. In development, `snapfort.audit()` in the browser console lists any piece that is recorded but not drawn or not solid.
- Thin instances: set `thinInstanceCount` before `thinInstanceBufferUpdated`, because Babylon uploads only the first `thinInstanceCount` entries. Getting this backwards made newly placed pieces invisible while still blocking their spot (fixed 2026-11-21).
- Deployed (user asked, 2026-11-22) to Cloudflare Workers static assets on the webplant.media Cloudflare account: https://snapfort.webplantmedia.workers.dev. `npm run deploy` builds and publishes. Once the user owns snapfort.io and its zone is on that account, add it as a Workers custom domain (`routes` with `custom_domain: true` in `wrangler.jsonc`) and redeploy.
