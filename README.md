# SnapFort.io

Build the tallest tower in one shared world, and knock the competition down with trebuchets. Free, in the browser: **https://snapfort.io**

- Snap big pieces together (walls, floors, ramps, roofs) with Fortnite-style building: aim with the crosshair, hold the mouse to keep placing, cut doors and windows, undo and redo.
- Everyone builds in one persistent world. What is built stays, for anyone who comes later.
- Metal builds up to storey 10, brick to 30, wood all the way to storey 80 (about 300 m), so the tallest towers have a strong base and a fragile top.
- Two worlds: the free **Meadow**, and **the Moon** (snapfort.io/moon): low gravity, storey-high jumps, trebuchets that throw much further and send builders flying. Anyone can visit the Moon; building there comes with the **Full Game**, a one-time $7 unlock (Stripe Checkout; you get a SnapFort key that unlocks your other devices too, no account needed).
- Phones and tablets work too, in landscape, with Fortnite-style touch controls (joystick, drag to look, build buttons).
- Chat like building: press Enter to say something to everyone (a line at the top) or to builders nearby (a bubble over your head), and middle-click to ping a spot. Nothing scrolls and nothing is saved.
- Trebuchets: build one on a floor, get on with H, aim through the scope, fire. Stones fly an exact arc and hit the first thing in their way; whatever loses its support falls as rubble, and anyone standing near the impact goes flying.

## How it is built

| Part | Where | What |
|---|---|---|
| Game rules | `src/game/` | Pieces, contact and collapse, materials, trebuchet ballistics and damage, falls, towers. Plain TypeScript, shared by the page and the server, unit tested. |
| Page | `src/` | Babylon.js (WebGPU, WebGL fallback) with Havok physics; plain HTML/CSS overlay. |
| Networking | `src/net/` | One WebSocket; own changes apply at once and are reconciled with the server's order. |
| Server | `worker/` | A Cloudflare Worker serving the files; a Durable Object (`World`) per world that holds it, checks every change, decides every shot and fall, and saves to its SQLite database; the `Ledger` Durable Object holding SnapFort keys; `/api/*` for buying (Stripe Checkout, webhook) and checking keys. |

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
npm run qa:moon         # the Moon: look, visitors, low gravity, long throws
npm run qa:pay          # buying the Full Game in Stripe's test mode, keys, webhooks
```

## Deploying

```sh
npm run deploy          # build, then wrangler deploy (snapfort.io and workers.dev)
```

The admin endpoints (`/admin/stats`, `/admin/reset`, `/admin/rollback?minutes=N`, each with `&env=moon` for the Moon, and `/admin/keys?email=` to find a lost key) need the `ADMIN_SECRET` Worker secret in an `x-admin-secret` header.

Buying needs the Worker secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (and `STRIPE_PRICE_ID` in `wrangler.jsonc`, the live price). Locally all three go in `.dev.vars` (never committed), with Stripe's sandbox key, webhook secret and price, so development never touches real money; with a test key the Unlock button only shows with `?testpay`.
