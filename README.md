# SnapFort.io

Build and explore in one shared world: castles and trebuchets in the Meadow, rail guns and rovers on the Moon, a Starship between them. Free, in the browser: **https://snapfort.io**

- Snap big pieces together (walls, floors, ramps, roofs) with Fortnite-style building: aim with the crosshair, hold the mouse to keep placing, cut doors and windows, undo and redo.
- Everyone builds in one persistent world. What is built stays, for anyone who comes later.
- Metal builds up to storey 10, brick to 30, wood all the way to storey 80 (about 300 m), so tall towers have a strong base and a fragile top.
- Two worlds: the free **Meadow**, and **the Moon** (snapfort.io/moon): low gravity, space suits, domes, and building in lattice, regolith and titanium. The launcher fires big chunks of moon rock that arrive in under a second; a hit throws you into space and your rocket pack flies you back. There are rovers to sit in and drive, and off a ramp at speed a rover floats away turning over until its seat throws you clear. And there is a rail gun to build: a kit of 22 numbered parts, 175 m long, put together with the Railgun tool; whole, it throws whoever sits in its capsule 650 m above the Moon, to fly down on their rockets and land anywhere. Anyone can visit the Moon (and drive); building there comes with the **Full Game**, a one-time $7 unlock (Stripe Checkout; you get a SnapFort key that unlocks your other devices too, no account needed).
- **Mojave** (snapfort.io/mojave), also with the Full Game: a war between up to seven armies of people and one computer army on Earth, about 2080. The computer always plays pink (`src/worlds/mojave/ai.ts`, hard but fair: a person's income, prices, 200 supply and sight; it booms first, a new base as soon as it has saved for one on any free site (its natural, a start no colour in play holds, or a rich field in the middle), every base its turrets at once and its full defence soon after; once it has three guarded bases it builds Titan bays, Skyports and an Armory, makes Titans, Tanks and gunships, and attacks in waves that gather out of reach until stronger than what they have seen, then go in together); it is begun with the first person's army, as anyone's is (a Core and four Haulers), plays only while someone serves an army, and goes with the last. A general chooses one of the other seven colours (tiles on the row): one nobody serves begins a new army (a Core, four Haulers, 50 lithium), and one with generals they command with them; they may change sides at any moment. An army nobody serves for a minute disappears, everything built for it too, so someone who drops and comes back later begins again. Each commands from the ground in the usual view: Haulers mine lithium by themselves (always, for the nearest Core; they are never selected or ordered), tap plasma vents, build a base (buildings stand the moment they are paid for), make Troopers, tanks, artillery, drones and Titans (the queue is shown over the row), and command them with StarCraft's orders and keys (a click selects, a right click sends; attack is F and stop is X, since A and S walk the general). Units do only what they are told: they shoot whatever of the enemy's is in range (walls too), on the move as well, and never go after anything; a patrol stops to destroy what it meets; told to attack, they stop at the edge of their range to destroy whatever they meet, the target first, then go on, and end standing where it was with nothing left in range; a group marches at its slowest unit's pace. What the keys do now is on the row of tiles, as the pieces are. The land is never dark, but an enemy shows only while in sight, and the map keeps what was last seen. Generals are never hit; armies are destroyed. No shot gets through another army's wall, and walls and turrets go up only within 75 m of their own army's Core and never within 75 m of another's. Floors and ramps go up anywhere: a platform to command from above. Select with a click, a ring held on the ground, or ` (then ` again for the whole army, or a kind's key for all of that kind); with units selected a ring on the ground shows where an order would send them. No alliances, no siege engine, one material, and nobody watches. See the last sections of `PLAN.md`.
- **Starship**, in both worlds: a kit of 21 numbered parts, full size (a 146 m launch tower with its two catch arms, a mount, a 71 m booster and a 52 m ship), put together with the Starship tool, each part from within 12 m of where it goes, so the tower and rocket are climbed with scaffolding as they rise. Up to seven ride. The booster flies back and is caught by the tower's arms, to be used again; the ship flies on to the other world and lands there with its passengers, so it has to be built again for the next trip. Anything the rocket hits, and any shot that hits the rocket, blows it up and throws everyone in it clear.
- Nothing can be built into a trebuchet or launcher (they are nearly two storeys tall: no ceiling one storey over them), a rail gun or a Starship launch site, and none of them can be put where something is already built.
- Phones and tablets work too, in landscape, with Fortnite-style touch controls (joystick, drag to look, build buttons).
- Chat like building: press Enter to say something to everyone (a line at the top) or to builders nearby (a bubble over your head), and middle-click to ping a spot. Nothing scrolls and nothing is saved, except what a reported builder said. Settings while playing has **Players**: block someone (their chat is hidden on your device, every visit) or report them to the owner, who can ban a device.
- Trebuchets: build one on a floor, get on with H, aim through the scope, fire. Stones fly an exact arc and hit the first thing in their way; whatever loses its support falls as rubble, and anyone standing near the impact goes flying.

## How it is built

| Part | Where | What |
|---|---|---|
| Game rules | `src/game/` | Pieces, contact and collapse, materials, siege engine ballistics and damage, falls. Plain TypeScript, shared by the page and the server, unit tested. The same in every world, and frozen: add to it, never change it. |
| Worlds | `src/worlds/<id>/` | One folder per world, sharing no code with the others: `world.ts` (its numbers and names), `server.ts` (its own rules), `page/` (everything it draws and plays), its tests. `src/worlds/index.ts` lists them. |
| Page | `src/` | Babylon.js (WebGPU, WebGL fallback) with Havok physics; plain HTML/CSS overlay. |
| Networking | `src/net/` | One WebSocket; own changes apply at once and are reconciled with the server's order. |
| Server | `worker/` | A Cloudflare Worker serving the files; a Durable Object (`World`) per world that holds it, checks every change, decides every shot and fall, and saves to its SQLite database; the `Ledger` Durable Object holding SnapFort keys; the `Moderation` Durable Object holding reports and bans; `/api/*` for buying (Stripe Checkout, webhook) and checking keys. |

`PLAN.md` has the design decisions and their history in detail.

## Running it

```sh
npm install
npm run dev        # Vite with the Cloudflare plugin: the game and the World object, locally
```

On a local dev server, `?world=<name>` opens a separate test world; `?gl` forces WebGL; `?stats` shows the frame rate anywhere.

## Testing

```sh
npm run typecheck
npm test                # unit tests (rules, sync, contact, trebuchets, falls)
npm run qa              # browser QA with real keyboard and mouse (dev server running)
npm run qa:multi        # two pages building together
npm run qa:trebuchet    # trebuchets, throws, sleeping tabs
npm run qa:chaos -- 180 # random input from two players
npm run qa:load -- 100  # 100 bot builders and a real page
npm run qa:mobile       # phones and tablets: fit on screen, and every touch control
npm run qa:chat         # chat: nearby, everyone, pings, limits, the filter
npm run qa:moderation   # block, report and ban: the Players panel, blocks that last, reports with what was said, a banned device refused
npm run qa:moon         # the Moon: look, visitors, low gravity, the launcher, thrown into space and back
npm run qa:rover        # the Moon's rovers: driving, lift-off, thrown clear, rockets back
npm run qa:mojave       # Mojave: choosing an army, mining, the row's menus, building with a preview, the queue, orders, Troopers, fighting, turrets, reports on the map, pieces, two generals in one army, changing sides
npm run qa:mojave-mobile  # Mojave on seven phones and tablets, and played by touch
npm run qa:mojave-load  # Mojave at full size: 1,700 units, the server's step time and two pages' frame rates
npm run qa:mojave-chaos # Mojave: two generals pressing random keys and buttons; afterwards everyone must agree
npm run qa:railgun      # the Moon's rail gun: the 22-part kit, damage, the launch and flying down
npm run qa:starship     # Starship in both worlds: the 21-part kit, seats, lift-off, the booster caught, landing in the other world and flying back, blowing up
npm run qa:keepout      # nothing can be built into a trebuchet, launcher, rail gun or rocket (every piece in every slot round them), nor they into what is built
npm run qa:landing      # a landing spot shot away mid-flight
npm run qa:smoke        # a built or live site: every world loads, connects and draws
npm run qa:pay          # buying the Full Game in Stripe's test mode, keys, webhooks
npm run qa:menu         # the menu, the Moon's unlock, first-game tips
npm run qa:presence     # exact builder counts, no ghosts, new-version restart (3 min)
npm run qa:keys         # email unlock links, remembered devices, seats (a player on every seat of a key, the meadow too), replacing a key, removing one from a device
npm run qa:refs         # every world compared with its reference pictures (-- --save after a change that was meant)
```

`npm run qa:chaos -- 180 7 /moon` runs the random-input test in another world. When the dev server is not at `localhost:5173`, set `QA_BASE` (for example `QA_BASE=http://localhost:5174 npm run qa`).

## Adding a world

1. Copy the folder of the closest world, `src/worlds/<id>/`, under a new id (its folder name, its `id`, and a new `path` and `room`). Say in `world.ts` which world it was copied from.
2. Add it to the list in `src/worlds/index.ts`, and put its menu picture in the bucket at `worlds/<id>.jpg` (`https://cdn.snapfort.io/worlds/<id>.jpg`; `qa/world-images.mjs` renders them from the game, and the link preview `og.jpg`, and says how to upload them).
3. Change anything inside the folder: the numbers in `world.ts`, the look and sound in `page/`, rules of its own in `server.ts`. Nothing outside the folder needs to change, and nothing inside may import from another world.
4. `npm test` checks the world is complete and keeps to itself. When it is finished, `npm run qa:refs -- --save <id>` saves its reference pictures, so later work elsewhere cannot change it unnoticed.

A world that needs something the shared code does not offer gets a new optional door (`src/game/environments.ts`, `src/worlds/pageDoors.ts`, `src/worlds/serverDoors.ts`), with every existing world keeping the old behaviour.

## Deploying

```sh
npm run deploy          # build, then wrangler deploy (snapfort.io and workers.dev)
```

The owner's admin panel is a project of its own (admin.snapfort.io). It reaches the game only through `AdminApi` (`worker/admin.ts`), a Worker entrypoint with no address: a service binding to `snapfort` with `entrypoint: "AdminApi"`. `/admin/overview` answers the same as its `overview()`.

The admin endpoints (`/admin/overview`, `/admin/stats`, `/admin/reset`, `/admin/rollback?minutes=N`, each with `&env=moon` for the Moon, `/admin/keys?email=` to find a lost key, and `POST /admin/grant?email=` to give someone a key without a purchase, `&send=1` to email it to them) need the `ADMIN_SECRET` Worker secret in an `x-admin-secret` header.

Buying needs the Worker secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (and `STRIPE_PRICE_ID` in `wrangler.jsonc`, the live price). Locally all three go in `.dev.vars` (never committed), with Stripe's sandbox key, webhook secret and price, so development never touches real money; with a test key the Unlock button only shows with `?testpay`.
