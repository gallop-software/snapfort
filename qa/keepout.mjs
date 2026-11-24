/**
 * Nothing is built into a siege engine (the Meadow's trebuchet, the Moon's
 * launcher), a rail gun or a Starship launch site, and none of those can be
 * put where something is built. Every kind of piece is tried in every slot in
 * and around each of them, twice over: what the page says before a click
 * (`placeable`, what turns the ghost red), and what the server does with a
 * piece sent anyway. Both must agree with where each thing really is, worked
 * out here from its sizes. Needs the Gallop dev server with Stripe test keys
 * in .dev.vars. Run: npm run qa:keepout
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";
import { perch, scaffold } from "./_scaffold.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `keepout-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(label, path, key) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key ?? null);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_/.test(m.text())) errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}${path}?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(800);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const say = (page, msg) => sf(page, (m) => window.snapfort.net.sendWorld(m), msg);
const stand = (page, x, y, z) => sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]);
const toast = (page) => page.textContent("#toast");
/** What the page says about putting each piece there (before any click). */
const asks = (page, specs) => sf(page, (specs) => specs.map(([type, x, y, z, rot]) => { const c = window.snapfort.placeable({ type, x, y, z, rot }); return c.ok ? "ok" : c.problem; }), specs);
/** Sends each piece to the server whatever the page thinks, and says which of them are still there a moment later. */
async function sends(page, specs, material = "wood") {
  const ids = await sf(page, ([specs, material]) => specs.map(([type, x, y, z, rot]) => { const s = window.snapfort; const id = s.nextId(); s.history.do({ kind: "place", piece: { type, x, y, z, rot, id, material, edit: 0 } }); return id; }), [specs, material]);
  await wait(500 + specs.length * 6);
  return { ids, kept: await sf(page, (ids) => ids.map((id) => !!window.snapfort.state.get(id)), ids) };
}
const takeAway = async (page, ids) => { await sf(page, (ids) => { for (const id of ids) if (window.snapfort.state.get(id)) window.snapfort.history.do({ kind: "remove", id }); }, ids); await wait(400 + ids.length * 3); };

// ── Where things are, worked out here (not asked of the game) ────────────
const CELL = 5, LEVEL = 3.75;
/** The space a piece fills, in metres: [x0, y0, z0, x1, y1, z1]. */
function solid([type, x, y, z, rot]) {
  if (type === "wall") return rot === 0 ? [x * CELL, y * LEVEL, z * CELL - 0.15, (x + 1) * CELL, (y + 1) * LEVEL, z * CELL + 0.15] : [x * CELL - 0.15, y * LEVEL, z * CELL, x * CELL + 0.15, (y + 1) * LEVEL, (z + 1) * CELL];
  if (type === "floor") return [x * CELL, y * LEVEL - 0.15, z * CELL, (x + 1) * CELL, y * LEVEL + 0.15, (z + 1) * CELL];
  // (A siege engine: in from its cell's edges, from just over its floor to 7 m.)
  if (type === "trebuchet") return [x * CELL + 0.3, y * LEVEL + 0.3, z * CELL + 0.3, (x + 1) * CELL - 0.3, y * LEVEL + 7, (z + 1) * CELL - 0.3];
  return [x * CELL, y * LEVEL, z * CELL, (x + 1) * CELL, (y + 1) * LEVEL, (z + 1) * CELL];
}
const cuts = (a, b, graze) => Math.min(a[3], b[3]) - Math.max(a[0], b[0]) > graze && Math.min(a[4], b[4]) - Math.max(a[1], b[1]) > graze && Math.min(a[5], b[5]) - Math.max(a[2], b[2]) > graze;
const KINDS = [["wall", 0], ["wall", 1], ["floor", 0], ["ramp", 0], ["roof", 0], ["trebuchet", 0]];
const name = (s) => `${s[0]}${s[0] === "wall" ? (s[4] ? "|" : "—") : ""} ${s[1]},${s[2]},${s[3]}`;

/**
 * Tries every kind of piece in every one of `cells` (on the ground), one kind
 * at a time: the page's answer and the server's must both be "no" exactly
 * where `inside(spec)` says the piece would cut into the thing.
 */
async function sweep(page, label, cells, inside) {
  const wrong = { page: [], server: [] };
  let tried = 0, refused = 0;
  for (const [type, rot] of KINDS) {
    const specs = cells.map(([x, z]) => [type, x, 0, z, rot]);
    const said = await asks(page, specs);
    const { ids, kept } = await sends(page, specs);
    specs.forEach((s, i) => {
      const no = inside(s);
      tried++;
      if (no) refused++;
      if ((said[i] === "blocked") !== no) wrong.page.push(`${name(s)}: ${said[i]}`);
      if (kept[i] === no) wrong.server.push(`${name(s)}: ${kept[i] ? "kept" : "refused"}`);
    });
    await takeAway(page, ids);
  }
  check(`${label}: the page refuses exactly the pieces that would cut into it (${refused} of ${tried} tried)`, wrong.page.length === 0 && refused > 0 && refused < tried, wrong.page.slice(0, 6).join(" · "));
  check(`${label}: the server refuses exactly the same ones, sent anyway`, wrong.server.length === 0, wrong.server.slice(0, 6).join(" · "));
}

/** The siege engine of a world: walls round it, no ceiling a storey up, none under one. */
async function engine(page, label, at) {
  const [x, z] = at;
  const walls = (cx, y) => [["wall", cx, y, z + 1, 0], ["wall", cx, y, z, 1], ["wall", cx + 1, y, z, 1]];
  let r = await sends(page, [["trebuchet", x, 0, z, 0], ...walls(x, 0)]);
  check(`${label}: it stands on the ground, with walls round its cell`, r.kept.every(Boolean), r.kept.join());
  const over = [["floor", x, 1, z, 0], ["roof", x, 1, z, 0], ["ramp", x, 1, z, 0]];
  check(`${label}: the page refuses a ceiling one storey over it, and anything standing in the cell above`, (await asks(page, over)).every((a) => a === "blocked" || a === "unsupported") && (await asks(page, over))[0] === "blocked", (await asks(page, over)).join());
  r = await sends(page, over);
  check(`${label}: the server refuses them too`, r.kept.every((k) => !k), r.kept.join());
  r = await sends(page, [...walls(x, 1), ["floor", x, 2, z, 0]]);
  check(`${label}: walls a storey higher and a ceiling two storeys up are clear of it`, r.kept.every(Boolean), r.kept.join());
  // The other way round: a room with a ceiling one storey up, then the engine.
  r = await sends(page, [...walls(x + 4, 0), ["floor", x + 4, 1, z, 0]]);
  check(`${label}: (a one-storey room with a ceiling is built)`, r.kept.every(Boolean));
  check(`${label}: the page refuses one inside a one-storey room`, (await asks(page, [["trebuchet", x + 4, 0, z, 0]]))[0] === "blocked");
  r = await sends(page, [["trebuchet", x + 4, 0, z, 0]]);
  check(`${label}: the server refuses it too`, !r.kept[0]);
  r = await sends(page, [...walls(x + 8, 0), ...walls(x + 8, 1), ["floor", x + 8, 2, z, 0], ["trebuchet", x + 8, 0, z, 0]]);
  check(`${label}: a room two storeys high has room for one`, r.kept.every(Boolean), r.kept.join());
  // With the real controls: the engine's key, aimed at the ground inside the one-storey room, and a click.
  await page.bringToFront();
  for (let i = 0; i < 6 && !(await sf(page, () => window.snapfort.input.locked)); i++) { await page.mouse.click(550, 200); await wait(400); }
  await stand(page, (x + 4.5) * CELL, 0.95, z * CELL - 2.5); await wait(3200);
  await page.keyboard.press("KeyB"); await wait(250);
  for (let i = 0; i < 2; i++) { await sf(page, ([tx, tz]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(tx - e.x, tz - e.z); s.rig.pitch = Math.atan2(e.y, Math.hypot(tx - e.x, tz - e.z)); }, [(x + 4.5) * CELL, (z + 0.5) * CELL]); await wait(120); }
  const before = await sf(page, () => window.snapfort.state.size);
  await page.mouse.down(); await page.mouse.up(); await wait(500);
  check(`${label}: aimed inside that room with its own key, a click builds nothing and says why`, (await sf(page, () => window.snapfort.state.size)) === before && /clear space over it/.test(await toast(page)), `${await toast(page)} · ${JSON.stringify(await sf(page, () => { const s = window.snapfort; const p = s.player.position; return { locked: s.input.locked, tool: document.querySelector("#hotbar .slot.selected .label")?.textContent, at: [p.x, p.z].map(Math.round) }; }))}`);
  await page.screenshot({ path: `qa/shots/keepout-${label.toLowerCase().replace(/\W+/g, "-")}.png` });
  await page.keyboard.press("KeyB"); await wait(200);
}

/** A whole Starship launch site with its tower in cell (tx, tz), the rocket along +z; then everything round it. */
async function rocket(page, label, tx, tz) {
  const cx = (tx + 0.5) * CELL, cz = (tz + 0.5) * CELL;
  await stand(page, cx, 0.95, cz - 14); await wait(400);
  await say(page, { k: "pad-new", x: tx, z: tz, dir: 0 }); await wait(300);
  // (Parts go on only from close by: scaffolding to climb while it is built, taken down again before anything is tried.)
  const poles = await scaffold(page, tx, tz);
  for (let n = 2; n <= 21; n++) { await stand(page, ...perch(tx, tz, n).at); await wait(240); await say(page, { k: "pad-part", id: 1, n }); await wait(80); }
  await wait(500);
  await stand(page, cx, 0.95, cz - 30);
  await takeAway(page, poles);
  const pad = await sf(page, () => [...window.snapfort.feature.starship.pads.values()][0]?.pad.parts.length);
  check(`${label}: (a whole launch site is built)`, pad === 21, `${pad}`);
  // The tower is 12 m square; the mount 15 m square, 20 m on. (Both go a little into the ground: no floor under them.)
  const tower = [cx - 6, -1, cz - 6, cx + 6, 146, cz + 6], mount = [cx - 7.5, -1, cz + 12.5, cx + 7.5, 18.75, cz + 27.5];
  const cells = [];
  for (let x = tx - 3; x <= tx + 3; x++) for (let z = tz - 3; z <= tz + 7; z++) cells.push([x, z]);
  await sweep(page, label, cells, (s) => cuts(solid(s), tower, 0.2) || cuts(solid(s), mount, 0.2));
  // A part cannot go on where something is built: a second site, with a wall where its mount goes.
  await stand(page, cx + 100, 0.95, cz - 14); await wait(400);
  await say(page, { k: "pad-new", x: tx + 20, z: tz, dir: 0 }); await wait(300);
  const wall = await sends(page, [["wall", tx + 20, 0, tz + 4, 0]]);
  await stand(page, cx + 100 + 9, 0.95, cz + 20); await wait(400);
  await say(page, { k: "pad-part", id: 2, n: 10 }); await wait(500);
  const second = () => sf(page, () => [...window.snapfort.feature.starship.pads.values()].find((s) => s.pad.id === 2)?.pad.parts.join());
  check(`${label}: a part cannot go on where something is built`, wall.kept[0] && (await second()) === "1" && /built in the way/.test(await toast(page)), `${await second()} · ${await toast(page)}`);
  await takeAway(page, wall.ids);
  await say(page, { k: "pad-part", id: 2, n: 10 }); await wait(500);
  check(`${label}: ...cleared, it goes on, and then nothing can be built there`, (await second()) === "1,10" && (await asks(page, [["wall", tx + 20, 0, tz + 4, 0]]))[0] === "blocked", await second());
}

// ── The Meadow: the trebuchet, and the rocket ────────────────────────────
const m = await open("meadow", "/");
await engine(m, "Trebuchet", [10, 10]);
await rocket(m, "Rocket (Meadow)", -20, -20);

// ── The Moon: the launcher, the rail gun, and the rocket ─────────────────
const n = await open("moon", "/moon", await paidKey(base, "/moon"));
await engine(n, "Launcher", [10, 10]);

// A whole rail gun from cell (-10, -40), pointing along +z: its rising end held up as it has to be.
const gx = -10, gz = -40;
await stand(n, (gx + 0.5) * CELL, 0.95, (gz + 0.5) * CELL - 4); await wait(400);
await say(n, { k: "gun-new", x: gx, y: 0, z: gz, dir: 0 }); await wait(300);
const props = [];
for (const [along, level] of [[30, 1], [32, 2], [34, 3]]) { for (let y = 0; y < level; y++) props.push(["wall", gx, y, gz + along, 0]); props.push(["floor", gx, level, gz + along, 0]); }
const held = await sends(n, props, "metal");
check("Rail gun: (the pillars and floors that hold up its rising end are built)", held.kept.every(Boolean), held.kept.join());
const along = (k) => (k <= 4 || k === 22 ? 1 : k === 21 ? 34 : 2.5 + 2 * (k - 5));
for (const k of [2, 3, 4, 22, ...Array.from({ length: 17 }, (_, i) => 5 + i)]) {
  await stand(n, (gx + 0.5) * CELL + 6, 0.95 + (k >= 19 ? (k - 18) * LEVEL : 0), (gz + 0.5 + along(k)) * CELL); await wait(260);
  await say(n, { k: "gun-part", id: 1, n: k }); await wait(120);
}
await wait(500);
const gun = await sf(n, () => [...window.snapfort.feature.railgun.guns.values()][0]?.gun.parts.length);
check("Rail gun: (a whole rail gun is built)", gun === 22, `${gun}`);
{
  // Its level part: the base (cell 0), the breech (1) with a capacitor bank each side, and rails in cells 2 to 27.
  const cells = [];
  for (let x = gx - 2; x <= gx + 2; x++) for (let z = gz - 1; z <= gz + 27; z++) cells.push([x, z]);
  const onLine = (x, z) => x === gx && z >= gz && z <= gz + 27;
  const bank = (x, z) => Math.abs(x - gx) === 1 && z === gz + 1;
  const inside = ([type, x, , z, rot]) => {
    // Anything that fills a cell: not in a cell the gun stands in.
    if (type === "ramp" || type === "roof" || type === "trebuchet") return onLine(x, z) || bank(x, z);
    // A floor on the ground lies under it, as its own floor would.
    if (type === "floor") return false;
    // A wall across (on a cell's low z edge): not across the gun's line anywhere, the back of the base and of the banks included.
    if (rot === 0) return (x === gx && z >= gz && z <= gz + 28) || (Math.abs(x - gx) === 1 && (z === gz + 1 || z === gz + 2));
    // A wall along its side: fine, but for the two sides of the breech, where the banks feed it.
    return z === gz + 1 && (x === gx || x === gx + 1);
  };
  await sweep(n, "Rail gun", cells, inside);
  const up = [["wall", gx, 1, gz + 31, 0], ["roof", gx, 1, gz + 30, 0], ["floor", gx, 1, gz + 10, 0]];
  const r = await sends(n, up);
  check("Rail gun: no wall or dome up through a rising rail; a floor a storey over the level rail is clear of it", !r.kept[0] && !r.kept[1], r.kept.join());
}
// With the real controls: the Wall tool aimed across the rail, and a click.
await n.bringToFront();
for (let i = 0; i < 6 && !(await sf(n, () => window.snapfort.input.locked)); i++) { await n.mouse.click(550, 200); await wait(400); }
await stand(n, (gx + 0.5) * CELL, 0.95, (gz + 12) * CELL + 2.5 - 9); await wait(300);
await sf(n, () => { const s = window.snapfort; s.rig.yaw = 0; s.rig.pitch = 0.12; }); await wait(200);
await n.keyboard.press("KeyZ"); await wait(300);
const piecesBefore = await sf(n, () => window.snapfort.state.size);
await n.mouse.down(); await n.mouse.up(); await wait(500);
check("Rail gun: the Wall tool aimed across the rail builds nothing, and says something stands in the way", (await sf(n, () => window.snapfort.state.size)) === piecesBefore && /stands in the way/.test(await toast(n)), await toast(n));
await n.screenshot({ path: "qa/shots/keepout-railgun.png" });
await n.keyboard.press("KeyZ"); await wait(200);

await rocket(n, "Rocket (Moon)", 12, -30);

check("no errors in any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
