/**
 * Renders the pictures the site is shown by, from the game itself: each
 * world's menu card (worlds/<world>.jpg in the bucket snapfort-io, served at
 * cdn.snapfort.io) and the link preview (og.jpg there, the Meadow's picture
 * at 1200x630).
 *
 * The Meadow: a castle with its keep, corner towers, gate and wall walk,
 * trebuchets before it, and a Starship lifting off its launch tower behind.
 * The Moon: a base of domes and towers, a rail gun running the length of it, a
 * Starship on its mount, launchers, and a rover in front with the Earth above.
 * Mars: a base of ice, redbrick and iron under greenhouses, on the canyon
 * floor, as the sun sets blue behind it and the ice begins to glow.
 * Everything is built the way a builder builds it (pieces through the page,
 * parts by the world's own messages from close by), so the server agrees.
 *
 * Needs the Gallop dev server with Stripe test keys in .dev.vars (a paid key
 * is made through the webhook, to build on the Moon). Then:
 *
 *   node qa/world-images.mjs            every world
 *   node qa/world-images.mjs moon       only that one
 *   node qa/world-images.mjs meadow --still     the Meadow without waiting for lift-off
 *
 * The shots land in qa/shots/art-<world>-<n>.png (2400x1350; the Meadow's 0 is
 * before lift-off, 1 to 9 during it). Pick one of each and resize it to a
 * 960x540 JPEG for the card; the link preview is the top 2400x1260 of the
 * Meadow's, at 1200x630 (its bottom strip is only grass). Then put them in the
 * bucket: gallop studio upload <file> --to r2://snapfort-io/worlds/ --replace
 * (og.jpg to r2://snapfort-io/), and gallop studio purge for each.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const stamp = Date.now().toString(36);
mkdirSync("qa/shots", { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const key = await paidKey(base, "/moon", 4);

/** Every page open: closed when a world's pictures are taken, so the key's seats are free for the next. */
const contexts = [];
const closeAll = async () => { for (const c of contexts.splice(0)) await c.close(); };

async function open(path, world, viewport = { width: 1200, height: 675 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  contexts.push(ctx);
  await ctx.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message.slice(0, 200)));
  await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(900);
  return page;
}

// ── Pieces ───────────────────────────────────────────────────────────────

/** A plan of pieces: a later piece in the same place replaces an earlier one. */
class Plan {
  pieces = new Map();
  put(type, x, y, z, rot = 0, material = "wood", edit = 0) { this.pieces.set(`${type === "wall" ? "w" + rot : type === "trebuchet" || type === "ramp" || type === "roof" ? "c" : "f"},${x},${y},${z}`, { type, x, y, z, rot, material, edit }); }
  /** The four walls round the cells x0..x1, z0..z1 on one storey. `edit(side, i)` may cut one (side: "s", "n", "w", "e"). */
  ring(x0, x1, z0, z1, y, material, edit = () => 0) {
    for (let x = x0; x <= x1; x++) { this.put("wall", x, y, z0, 0, material, edit("s", x - x0)); this.put("wall", x, y, z1 + 1, 0, material, edit("n", x - x0)); }
    for (let z = z0; z <= z1; z++) { this.put("wall", x0, y, z, 1, material, edit("w", z - z0)); this.put("wall", x1 + 1, y, z, 1, material, edit("e", z - z0)); }
  }
  floors(x0, x1, z0, z1, y, material) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.put("floor", x, y, z, 0, material); }
  roofs(x0, x1, z0, z1, y, material) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.put("roof", x, y, z, 0, material); }
  /** Lowest first, walls before what lies on them, so everything has something to stand on when it arrives. */
  list() { const order = { wall: 0, ramp: 1, floor: 2, roof: 3, trebuchet: 4 }; return [...this.pieces.values()].sort((a, b) => a.y - b.y || order[a.type] - order[b.type]); }
}

/** Wall cuts (3 by 3 tiles, bit = row * 3 + col, row 0 at the bottom). */
const CUT = { battlement: 16 + 64 + 128 + 256, window: 16, gate: 63, slit: 2 + 16, arch: 2 + 16 + 1 + 4 + 8 + 32 };

/** Places a plan through the page, as a builder's own pieces; says how many the server kept. */
async function build(page, plan) {
  const list = plan.list();
  for (let i = 0; i < list.length; i += 50) {
    await page.evaluate((chunk) => { const s = window.snapfort; for (const p of chunk) s.history.do({ kind: "place", piece: { ...p, id: s.nextId() } }); }, list.slice(i, i + 50));
    await wait(350);
  }
  await wait(1500);
  const kept = await page.evaluate(() => [...window.snapfort.state.all()].length);
  console.log(`  ${kept} of ${list.length} pieces stand`);
}

// ── Starships and rail guns (parts go on only from close by) ─────────────

const send = (page, msg) => page.evaluate((m) => window.snapfort.net.sendWorld(m), msg);
const hover = async (page, x, y, z) => { await page.evaluate(([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]); await wait(230); };

/** A whole launch site: its tower in cell (x, z), the rocket `dir` from it. Gives back its id. */
async function starship(page, world, x, z, dir) {
  const boxes = await page.evaluate(async ([world, x, z, dir]) => { const r = await import(`/src/worlds/${world}/starshipRules.ts`); return Array.from({ length: r.PARTS }, (_, i) => r.boxOf({ x, z, dir }, i + 1)); }, [world, x, z, dir]);
  const pads = () => page.evaluate(() => [...window.snapfort.feature.starship.pads.values()].map((s) => s.pad));
  const mine = async () => (await pads()).find((p) => p.x === x && p.z === z);
  const beside = (b) => [[b[3] + 5, 0], [b[0] - 5, 0], [0, b[5] + 5], [0, b[2] - 5]].map(([px, pz]) => [px || (b[0] + b[3]) / 2, (b[1] + b[4]) / 2 + 1, pz || (b[2] + b[5]) / 2]);
  await hover(page, ...beside(boxes[0])[0]);
  await send(page, { k: "pad-new", x, z, dir });
  await wait(500);
  const id = (await mine())?.id;
  if (id === undefined) throw new Error("no launch site: " + (await page.textContent("#toast")));
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 10, 14, 15, 16, 17, 18, 19, 20, 21]) {
    let on = false;
    for (const at of beside(boxes[n - 1])) {
      await hover(page, ...at);
      await send(page, { k: "pad-part", id, n });
      await wait(260);
      if ((on = (await mine()).parts.includes(n))) break;
    }
    if (!on) throw new Error(`part ${n} would not go on: ${await page.textContent("#toast")}`);
  }
  console.log(`  Starship ${id} is whole`);
  return id;
}

/** A whole rail gun: its base in cell (x, z) on the ground, the rail `dir` from it, the rising end held up. */
async function railgun(page, x, z, dir, material = "metal") {
  const A = [[0, 1], [1, 0], [0, -1], [-1, 0]][dir];
  const spot = (n) => {
    const along = n <= 4 || n === 22 ? (n === 1 ? 0 : 1) : n === 21 ? 34 : 2.5 + 2 * (n - 5);
    const side = n === 3 ? -1 : n === 4 ? 1 : 0, up = n === 21 ? 3 : n >= 18 && n <= 20 ? n - 18 : 0;
    return [(x + 0.5 + A[0] * along + A[1] * side) * 5, up * 3.75, (z + 0.5 + A[1] * along - A[0] * side) * 5];
  };
  const guns = () => page.evaluate(() => [...window.snapfort.feature.railgun.guns.values()].map((s) => s.gun));
  const mine = async () => (await guns()).find((g) => g.x === x && g.z === z);
  const near = (n) => { const [mx, my, mz] = spot(n); return [mx - A[1] * 6, my + 1.3, mz + A[0] * 6]; };
  // What holds the rising rails up: a pillar and a floor under each, a storey higher each time.
  const plan = new Plan();
  for (const [along, level] of [[30, 1], [32, 2], [34, 3]]) {
    const cx = x + A[0] * along, cz = z + A[1] * along;
    for (let y = 0; y < level; y++) plan.ring(cx, cx, cz, cz, y, material);
    plan.put("floor", cx, level, cz, 0, material);
  }
  await build(page, plan);
  await hover(page, ...near(1));
  await send(page, { k: "gun-new", x, y: 0, z, dir });
  await wait(500);
  const id = (await mine())?.id;
  if (id === undefined) throw new Error("no rail gun: " + (await page.textContent("#toast")));
  for (const n of [2, 22, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]) {
    let on = false;
    for (let tries = 0; tries < 3 && !on; tries++) {
      await hover(page, ...near(n));
      await send(page, { k: "gun-part", id, n });
      await wait(260);
      on = (await mine()).parts.includes(n);
    }
    if (!on) throw new Error(`rail gun part ${n} would not go on: ${await page.textContent("#toast")}`);
  }
  console.log(`  rail gun ${id} is whole`);
  return id;
}

// ── The camera ───────────────────────────────────────────────────────────

/** Fixes the camera, hides everything that is not the world, and draws at full sharpness. */
async function frame(page, camera, target, fov) {
  await page.addStyleTag({ content: "#hud, #hotbar-wrap, #stats, #online, #crosshair, #visit-bar, #tip, #touch { display: none !important; }" });
  await page.evaluate(([camera, target, fov]) => {
    const s = window.snapfort;
    const cam = s.scene.activeCamera;
    const V = cam.position.constructor;
    window.__view = { camera, target };
    s.scene.onBeforeRenderObservable.add(() => {
      if (s.engine.getHardwareScalingLevel() !== 0.5) s.engine.setHardwareScalingLevel(0.5);
      const c = s.scene.activeCamera;
      if (fov) c.fov = fov;
      c.position.copyFromFloats(...window.__view.camera);
      c.setTarget(new V(...window.__view.target));
      for (const m of s.scene.meshes) if (m.name.startsWith("ghost") || m.name.startsWith("gun-need") || m.name.startsWith("star-plan") || m.name.startsWith("tag")) m.isVisible = false;
    });
  }, [camera, target, fov ?? 0]);
  await wait(1200);
}
const view = (page, camera, target) => page.evaluate(([camera, target]) => { window.__view = { camera, target }; }, [camera, target]);
const shoot = async (page, name) => { await page.screenshot({ path: `qa/shots/art-${name}.png` }); console.log(`  qa/shots/art-${name}.png`); };

// ── The Meadow ───────────────────────────────────────────────────────────

function castle() {
  const p = new Plan();
  const X0 = -11, X1 = -3, Z0 = 6, Z1 = 14, mid = -7;
  // The curtain wall: two storeys of brick, a gate in the front, battlements and a wall walk on top.
  for (let y = 0; y < 2; y++) p.ring(X0, X1, Z0, Z1, y, "brick", (side, i) => (side === "s" && y === 0 && i === mid - X0 ? CUT.gate : y === 1 && i % 2 === 1 ? CUT.slit : 0));
  p.floors(X0, X1, Z0, Z0, 2, "wood"); p.floors(X0, X1, Z1, Z1, 2, "wood"); p.floors(X0, X0, Z0, Z1, 2, "wood"); p.floors(X1, X1, Z0, Z1, 2, "wood");
  p.ring(X0, X1, Z0, Z1, 2, "brick", () => CUT.battlement);
  // The gatehouse: a storey above the gate, roofed.
  p.ring(mid, mid, Z0, Z0, 2, "brick", (side) => (side === "s" ? CUT.window : 0));
  p.put("roof", mid, 3, Z0, 0, "wood");
  // Corner towers: five storeys, windows high up, a roof each.
  for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) {
    for (let y = 0; y < 5; y++) p.ring(cx, cx, cz, cz, y, "brick", () => (y === 3 ? CUT.window : 0));
    p.put("floor", cx, 5, cz, 0, "wood");
    p.ring(cx, cx, cz, cz, 5, "brick", () => CUT.battlement);
    p.put("roof", cx, 5, cz, 0, "wood");
  }
  // Steps from the courtyard up to the wall walk.
  p.put("ramp", X0 + 1, 0, Z0 + 2, 0, "wood"); p.put("ramp", X0 + 1, 1, Z0 + 3, 0, "wood"); p.put("floor", X0 + 1, 2, Z0 + 4, 0, "wood");
  // The keep: three cells square, metal below and brick above, a turret on top.
  const K0 = mid - 1, K1 = mid + 1, L0 = 9, L1 = 11;
  for (let y = 0; y < 7; y++) p.ring(K0, K1, L0, L1, y, "metal", (side, i) => (y === 0 && side === "s" && i === 1 ? CUT.arch : y >= 2 && y % 2 === 0 && i === 1 ? CUT.window : 0));
  p.floors(K0, K1, L0, L1, 7, "wood");
  p.ring(K0, K1, L0, L1, 7, "metal", () => CUT.battlement);
  for (let y = 7; y < 9; y++) p.ring(mid, mid, 10, 10, y, "wood", () => (y === 8 ? CUT.window : 0));
  p.put("roof", mid, 9, 10, 0, "wood");
  return p;
}

async function meadow() {
  console.log("Meadow");
  const world = `art-m-${stamp}`;
  const page = await open("/", world);
  await build(page, castle());
  // Siege engines before the gate, and a wooden lookout off to the side.
  const more = new Plan();
  more.put("trebuchet", 0, 0, 2); more.put("trebuchet", 3, 0, 5);
  for (let y = 0; y < 12; y++) more.ring(-17, -17, 20, 20, y, "wood", () => (y === 11 ? CUT.window : 0));
  more.put("roof", -17, 12, 20, 0, "wood");
  await build(page, more);
  const pad = await starship(page, "meadow", 12, 34, 3);
  // Builders: one in front looking on, one on a trebuchet, one up on the wall walk.
  await hover(page, -29, 0.95, 21);
  await page.evaluate(() => { const s = window.snapfort; s.rig.yaw = 0.9; s.rig.pitch = 0.1; });
  const crew = await open("/", world, { width: 600, height: 400 });
  await hover(crew, 3.5, 0.95, 9);
  await crew.keyboard.press("KeyH");
  const guard = await open("/", world, { width: 600, height: 400 });
  await hover(guard, 18.5, 0.95, 24);
  await guard.keyboard.press("KeyH");
  await frame(page, [16, 5, -34], [0, 34, 60]);
  await shoot(page, "meadow-0");
  if (process.argv.includes("--still")) return;
  // A rider, so it can fly: seated, fuelled (20 s), then the countdown (10 s) and lift-off.
  const rider = await open("/", world, { width: 600, height: 400 });
  const foot = await page.evaluate(async ([x, z, dir]) => (await import("/src/worlds/meadow/starshipRules.ts")).mountFoot({ x, z, dir }), [12, 34, 3]);
  await hover(rider, foot[0], 0.95, foot[2] - 11);
  await send(rider, { k: "pad-sit", id: pad, on: true });
  await wait(21500);
  await send(rider, { k: "pad-launch" });
  await wait(10300);
  for (let i = 1; i <= 9; i++) { await wait(900); await shoot(page, `meadow-${i}`); }
}

// ── The Moon ─────────────────────────────────────────────────────────────

function moonBase() {
  const p = new Plan();
  const win = (y, rows) => (side, i) => (rows.includes(y) ? CUT.window : 0);
  // The hub: four storeys of titanium, two cells square, domed.
  for (let y = 0; y < 4; y++) p.ring(-4, -3, 12, 13, y, "metal", win(y, [1, 3]));
  p.floors(-4, -3, 12, 13, 4, "metal"); p.roofs(-4, -3, 12, 13, 4, "metal");
  // A tunnel east to a regolith pod, and one south to the airlock.
  p.ring(-2, 0, 12, 12, 0, "brick"); p.roofs(-2, 0, 12, 12, 1, "brick");
  for (let y = 0; y < 2; y++) p.ring(1, 2, 12, 13, y, "brick", win(y, [1]));
  p.roofs(1, 2, 12, 13, 2, "brick");
  p.ring(-4, -4, 9, 11, 0, "brick"); p.roofs(-4, -4, 9, 11, 1, "brick");
  p.ring(-4, -4, 8, 8, 0, "metal", (side) => (side === "s" ? CUT.arch : 0)); p.put("roof", -4, 1, 8, 0, "metal");
  // A tall lattice mast with a dome on top, and a lattice store behind the pod.
  for (let y = 0; y < 11; y++) p.ring(-7, -7, 14, 14, y, "wood");
  p.put("roof", -7, 11, 14, 0, "wood");
  for (let y = 0; y < 3; y++) p.ring(1, 2, 16, 16, y, "wood");
  p.roofs(1, 2, 16, 16, 3, "wood");
  // Launchers.
  p.put("trebuchet", -1, 0, 8); p.put("trebuchet", 2, 0, 9);
  return p;
}

async function moon() {
  console.log("Moon");
  const world = `art-n-${stamp}`;
  const page = await open("/moon", world);
  await build(page, moonBase());
  await railgun(page, 5, 3, 0);
  await starship(page, "moon", -9, 40, 1);
  // A rover in front, this builder in its seat (drawn there for the picture; nobody drives it).
  await hover(page, 40, 0.95, -60);
  await page.evaluate(([x, z, yaw]) => {
    const s = window.snapfort;
    const r = s.feature.rover.rovers.get(5);
    r.pose = [x, 0, z, yaw, 0, 0];
    r.target = [...r.pose];
    // The seat: 1.02 m up and half a metre behind the rover's middle.
    s.player.riding = { x: x - Math.sin(yaw) * 0.5, y: 1.02, z: z - Math.cos(yaw) * 0.5, yaw, pitch: 0, roll: 0 };
  }, [0, 10, -1.9]);
  // Builders: one on a launcher, one by the rail gun's breech.
  const crew = await open("/moon", world, { width: 600, height: 400 });
  await hover(crew, -1.5, 0.95, 44);
  await crew.keyboard.press("KeyH");
  const hand = await open("/moon", world, { width: 600, height: 400 });
  await hover(hand, 19, 0.95, 17);
  await hand.evaluate(() => { window.snapfort.rig.yaw = 2.4; });
  await frame(page, [10, 4, -10], [10, 27, 90]);
  await shoot(page, "moon-0");
}

// ── Mars ─────────────────────────────────────────────────────────────────

function marsBase() {
  const p = new Plan();
  const win = (y, rows) => () => (rows.includes(y) ? CUT.window : 0);
  // The hall: three storeys of iron, two cells square, under four greenhouses.
  for (let y = 0; y < 3; y++) p.ring(-4, -3, 2, 3, y, "metal", win(y, [1]));
  p.floors(-4, -3, 2, 3, 3, "metal"); p.roofs(-4, -3, 2, 3, 3, "metal");
  // An ice spire beside it, nine storeys, a greenhouse on top; and a shorter one further off.
  for (let y = 0; y < 9; y++) p.ring(-6, -6, 3, 3, y, "wood");
  p.put("roof", -6, 9, 3, 0, "wood");
  for (let y = 0; y < 5; y++) p.ring(-8, -8, 6, 6, y, y < 3 ? "brick" : "wood");
  p.put("roof", -8, 5, 6, 0, "wood");
  // Redbrick wings: one east to the airlock, one north, two storeys.
  p.ring(-2, 0, 2, 2, 0, "brick", (side) => (side === "e" ? CUT.arch : 0)); p.roofs(-2, 0, 2, 2, 1, "brick");
  for (let y = 0; y < 2; y++) p.ring(-4, -4, 4, 6, y, "brick", win(y, [1]));
  p.roofs(-4, -4, 4, 6, 2, "brick");
  // A row of ice greenhouses out front, and a low iron store.
  p.ring(-1, 1, 5, 6, 0, "wood"); p.roofs(-1, 1, 5, 6, 1, "wood");
  p.ring(-7, -6, 0, 0, 0, "metal"); p.roofs(-7, -6, 0, 0, 1, "metal");
  // Beacons.
  p.put("trebuchet", 2, 0, 0); p.put("trebuchet", -1, 0, 9);
  return p;
}

async function mars() {
  console.log("Mars");
  const world = `art-r-${stamp}`;
  // The hour is held: late in the day, at sunset, and just after it (see ?sol= in the world's scenery).
  const hours = [["0", 0.56], ["1", 0.625], ["2", 0.64], ["3", 0.658]];
  let first = true;
  for (const [n, sol] of hours) {
    const page = await open(`/mars?sol=${sol}`, world);
    if (first) await build(page, marsBase());
    first = false;
    // Builders: one on a beacon, one walking in from the east.
    const crew = await open(`/mars?sol=${sol}`, world, { width: 600, height: 400 });
    await hover(crew, 12.5, 0.95, -1.5);
    await crew.keyboard.press("KeyH");
    const hand = await open(`/mars?sol=${sol}`, world, { width: 600, height: 400 });
    await hover(hand, 16, 0.95, 20);
    await hand.evaluate(() => { window.snapfort.rig.yaw = -1.9; });
    await hover(page, 60, 0.95, 60);
    await wait(1500);
    // From the east, looking west past the base to where the sun goes down.
    await frame(page, [44, 3.4, 30], [-40, 17, 12]);
    await shoot(page, `mars-${n}`);
    await closeAll();
    await wait(1200);
  }
}

if (!only || only === "meadow") { await meadow(); await closeAll(); await wait(1500); }
if (!only || only === "mars") { await mars(); await closeAll(); await wait(1500); }
if (!only || only === "moon") { await moon(); await closeAll(); }
await browser.close();
