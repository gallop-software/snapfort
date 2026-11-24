/**
 * The Starship, in the Meadow and on the Moon: the Starship tool, a kit of 21
 * numbered parts (the launch tower with its catch arms, the mount, the booster
 * and the ship) put on by aiming and clicking; the parts are solid and come
 * off from the top; up to seven ride; a countdown, lift-off, the ship away to
 * the other world with its passengers' pages following, the booster back into
 * the arms; the ship coming in to land in the other world and letting its
 * passengers out; the trip back; and a rocket that hits something blowing up
 * and throwing whoever is in it. Needs the Gallop dev server with Stripe test
 * keys in .dev.vars. Run: npm run qa:starship
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `starship-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(label, key, path = "/") {
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
/** Brings a page to the front and makes sure it is playing. */
async function front(page) {
  await page.bringToFront();
  for (let i = 0; i < 6 && !(await page.evaluate(() => window.snapfort?.input.locked)); i++) {
    if (await page.isVisible("#resume")) await page.click("#resume"); else await page.mouse.click(550, 200);
    await wait(400);
  }
}
const star = (page) => sf(page, () => { const f = window.snapfort.feature.starship; return { pads: [...f.pads.values()].map((s) => ({ ...s.pad, drawn: s.parts.size, solid: [...s.parts.values()].filter((h) => h.solid).length, boosterY: s.booster.position.y, shipY: s.ship.position.y })), ships: [...f.ships.values()].map((s) => ({ ...s.ship, y: s.node.position.y, tilt: s.node.rotation.x })), seated: f.seated, aboard: f.aboard, preview: f.preview }; });
const me = (page) => sf(page, () => { const s = window.snapfort; const p = s.player.position; return { x: p.x, y: p.y, z: p.z, down: s.player.knockedDown, tumbling: s.player.tumbling, locked: s.input.locked, env: s.env.id, chase: s.rig.chase }; });
const panel = (page) => sf(page, () => { const el = document.getElementById("world-panel"); return el.hidden ? "" : el.textContent; });
const toast = (page) => page.textContent("#toast");
const stand = (page, x, y, z) => sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]);
/** Turns the view to look at a spot. */
async function lookAt(page, x, y, z) {
  for (let i = 0; i < 2; i++) { await sf(page, ([x, y, z]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(x - e.x, z - e.z); s.rig.pitch = -Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)); }, [x, y, z]); await wait(110); }
}
const click = async (page) => { await page.mouse.down(); await page.mouse.up(); };
const shot = (page, name) => page.screenshot({ path: `qa/shots/${name}.png` });
const say = (page, msg) => sf(page, (m) => window.snapfort.net.sendWorld(m), msg);

const b = await open("builder");
const r = await open("rider", await paidKey(base, "/moon"));
// (The rider only rides: their Wall tool is put away, so none of their clicks builds anything.)
await front(r); await r.keyboard.press("KeyZ"); await wait(300);
await front(b);

// ── The Starship tool, and building a site ──────────────────────────────
const slots = await sf(b, () => [...document.querySelectorAll("#hotbar .slot .label")].map((e) => e.textContent));
check("Starship is on the Meadow's hotbar, after the trebuchet", slots.at(-1) === "Starship" && slots.at(-2) === "Trebuchet", slots.join(" · "));
// The tower at cell (-12, -4), the mount 20 m on along +z.
const TOWER = [-57.5, 0, -17.5], MOUNT = [-57.5, 0, 2.5];
await stand(b, -57.5, 0.95, -40); await wait(200);
await b.keyboard.press("KeyL"); await wait(300);
await lookAt(b, ...TOWER); await wait(250);
let s = await star(b);
check("picked, it offers a new launch site where the crosshair is, the whole plan shown", s.preview?.pad === null && s.preview.part === 1 && s.preview.ok && /New Starship launch site/.test(await panel(b)), `${JSON.stringify(s.preview)} ${await panel(b)}`);
await shot(b, "starship-plan");
await click(b); await wait(450);
s = await star(b);
check("a click starts it: tower section 1 stands", s.pads.length === 1 && s.pads[0].parts.join() === "1" && s.pads[0].drawn === 1, JSON.stringify(s.pads[0]?.parts));
// Aimed at the tower, the tower goes up, then its arms; aimed at the mount, the mount, the booster and the ship.
for (let i = 0; i < 11; i++) { await lookAt(b, TOWER[0], 6, TOWER[2]); await click(b); await wait(400); }
s = await star(b);
check("aimed at the tower: its eight sections, its top, both catch arms and the fuelling arm go on, in order", [...s.pads[0].parts].sort((x, y) => x - y).join() === "1,2,3,4,5,6,7,8,9,11,12,13", s.pads[0].parts.join());
await stand(b, -80, 0.95, 2.5); await wait(200);
await lookAt(b, MOUNT[0], 4, MOUNT[2]); await wait(200);
check("the next part shows in green, and the panel names it", (await star(b)).preview?.part === 10 && /12 of 21 parts.*10 · Launch mount/.test(await panel(b)), await panel(b));
for (let i = 0; i < 9; i++) { await lookAt(b, MOUNT[0], 4, MOUNT[2]); await click(b); await wait(400); }
s = await star(b);
const builtAt = Date.now();
check("aimed at the mount: the mount, the booster's four parts and the ship's four", s.pads[0].parts.length === 21 && s.pads[0].drawn === 21, s.pads[0].parts.join());
check("whole, it starts fuelling", /fuelling/.test(await panel(b)) && s.pads[0].readyAt > 0, await panel(b));
await b.keyboard.press("KeyL"); await wait(300);
await stand(b, 115, 0.95, -75); await sf(b, () => { const s = window.snapfort; s.rig.yaw = -Math.PI / 2 + 0.3; s.rig.pitch = -0.3; }); await wait(500);
await shot(b, "starship-whole");

// Solid, and the Remove tool.
check("every part is solid", s.pads[0].solid === 21);
await stand(b, -57.5, 0.95, -32); await sf(b, () => { window.snapfort.rig.yaw = 0; window.snapfort.rig.pitch = 0.1; }); await wait(200);
await b.keyboard.down("KeyW"); await wait(1500); await b.keyboard.up("KeyW"); await wait(200);
check("a builder cannot walk through the tower", (await me(b)).z < -23, `z ${(await me(b)).z.toFixed(1)}`);
await b.keyboard.press("KeyV"); await wait(300);
await lookAt(b, TOWER[0], 5, TOWER[2]); await wait(300);
check("the Remove tool on the tower's foot says what has to come off first", /1 · Tower section 1.*take off 21 · Ship nose first/.test(await panel(b)), await panel(b));
await click(b); await wait(500);
check("...and a click there takes nothing off", (await star(b)).pads[0].parts.length === 21 && /Take off what stands/.test(await toast(b)), await toast(b));
await b.keyboard.press("KeyV"); await wait(300);

// ── Riding ───────────────────────────────────────────────────────────────
await front(r);
await stand(r, TOWER[0] + 10, 0.95, TOWER[2]); await wait(400);
check("at the foot of the tower, H rides the lift up", /ride the lift up/.test(await r.textContent("#hint")), await r.textContent("#hint"));
await r.keyboard.press("KeyH"); await wait(900);
let q = await me(r);
check("the rider sits in the ship's cabin, the camera pulled back to take the rocket in", (await star(r)).seated === 1 && q.y > 100 && q.chase > 50, `y ${q.y.toFixed(0)} chase ${q.chase}`);
check("everyone sees who is aboard", (await star(b)).pads[0].riders.filter((x) => x).length === 1);
await shot(r, "starship-seated");
await click(r); await wait(500);
check("it will not launch while it is fuelling", /Still fuelling/.test(await toast(r)), await toast(r));
await wait(Math.max(0, 20500 - (Date.now() - builtAt)));
check("fuelled, it says where it is going", /Starship ready · to the Moon/.test(await panel(r)), await panel(r));
// The builder stands by the mount, to be blown away.
await stand(b, MOUNT[0] + 11, 0.95, MOUNT[2]);
await click(r); await wait(700);
check("a click from a seat starts the countdown, for everyone to see", /Lift-off in \d+/.test(await panel(r)) && (await star(b)).pads[0].count > 0, await panel(r));
await wait(10200);
s = await star(b);
check("the engines light", !!s.pads[0].flight && s.pads[0].flight.to === "moon", JSON.stringify(s.pads[0].flight));
await wait(900);
check("whoever stands by the mount at lift-off is blown away", (await me(b)).down);
await stand(b, 130, 0.95, -90); await sf(b, () => { const s = window.snapfort; s.rig.yaw = -Math.PI / 2 + 0.4; s.rig.pitch = -0.55; });
await wait(7500);
await shot(b, "starship-liftoff"); await shot(r, "starship-riding");
s = await star(b); q = await me(r);
check("the stack climbs off the mount, the rider with it", s.pads[0].boosterY > 60 && s.pads[0].shipY > s.pads[0].boosterY + 60 && q.y > 200, `booster ${s.pads[0].boosterY.toFixed(0)} ship ${s.pads[0].shipY.toFixed(0)} rider ${q.y.toFixed(0)}`);
check("the parts are no longer solid where they stood", s.pads[0].solid === 13, `${s.pads[0].solid}`);
await r.waitForURL(/\/moon/, { timeout: 20000 }).catch(() => {});
check("the ship leaves this world, and the rider's page follows it to the Moon", /\/moon\?world=/.test(r.url()), r.url());
s = await star(b);
check("in the Meadow the ship's four parts are gone, and the booster is on its way back", s.pads[0].parts.length === 17 && s.pads[0].flight?.booster === true && s.pads[0].flight.ship === false, s.pads[0].parts.join());
await sf(b, () => { window.snapfort.rig.pitch = -0.9; }); await wait(4000);
await shot(b, "starship-booster-back");
for (let i = 0; i < 200 && (await star(b)).pads[0].flight; i++) await wait(100);
await wait(600);
s = await star(b);
check("the booster comes back down into the tower's arms, to be used again", s.pads[0].flight === null && s.pads[0].parts.filter((n) => n >= 14).join() === "14,15,16,17" && Math.abs(s.pads[0].boosterY - 18.75) < 0.1, `${s.pads[0].parts.join()} y ${s.pads[0].boosterY.toFixed(1)}`);
await sf(b, () => { window.snapfort.rig.pitch = -0.3; }); await wait(300);
await shot(b, "starship-caught");

// ── Arriving on the Moon ─────────────────────────────────────────────────
await r.waitForSelector("body.ready", { timeout: 30000 });
let aboard = null;
for (let i = 0; i < 80 && !aboard; i++) { await wait(100); aboard = (await star(r).catch(() => null))?.aboard ?? null; }
q = await me(r);
check("on the Moon the rider is aboard the ship as it comes in, high up", !!aboard && q.env === "moon" && q.y > 150, `aboard ${aboard} y ${q.y?.toFixed(0)}`);
await shot(r, "starship-moon-arriving");
check("the panel counts the landing down", /Coming in to land/.test(await panel(r)), await panel(r));
for (let i = 0; i < 300 && (await star(r)).aboard; i++) await wait(100);
await wait(700);
s = await star(r); q = await me(r);
check("it lands on the Moon and lets the rider out beside it, on their feet", s.ships.length === 1 && s.ships[0].down && q.y < 3 && !q.down && Math.hypot(q.x - s.ships[0].x, q.z - s.ships[0].z) < 14, `y ${q.y.toFixed(1)} ${JSON.stringify(s.ships[0])}`);
await front(r);
await sf(r, () => { const s = window.snapfort; s.rig.pitch = -0.5; }); await wait(400);
await shot(r, "starship-moon-landed");

// ── The trip back: a Starship built on the Moon ──────────────────────────
const slotsMoon = await sf(r, () => [...document.querySelectorAll("#hotbar .slot .label")].map((e) => e.textContent));
check("Starship is on the Moon's hotbar too", slotsMoon.includes("Starship") && slotsMoon.includes("Railgun"), slotsMoon.join(" · "));
await stand(r, -100, 0.95, -120); await wait(300);
await say(r, { k: "pad-new", x: -22, z: -28, dir: 1 }); await wait(300);
for (let n = 2; n <= 21; n++) { await say(r, { k: "pad-part", id: 1, n }); await wait(90); }
await wait(400);
s = await star(r);
check("a builder with the Full Game builds one on the Moon", s.pads[0]?.parts.length === 21, JSON.stringify(s.pads[0]?.parts));
await stand(r, -107.5 + 10, 0.95, -137.5 - 6); await wait(21000);
await r.keyboard.press("KeyH"); await wait(900);
check("...and rides it", (await star(r)).seated === 1, await toast(r));
await click(r); await wait(600);
check("its countdown is for the Meadow", /Lift-off in/.test(await panel(r)) && (await star(r)).pads[0].to === "meadow", await panel(r));
await r.waitForURL((u) => !/\/moon/.test(u.pathname), { timeout: 50000 }).catch(() => {});
check("the rider's page follows the ship back to the Meadow", !/\/moon/.test(r.url()), r.url());
// The builder, who never left the Meadow, watches it come in on its belly.
let seen = null;
for (let i = 0; i < 120 && !seen; i++) { await wait(100); seen = (await star(b)).ships[0] ?? null; }
check("builders in the Meadow see a ship from the Moon in their sky", !!seen && seen.from === "moon", JSON.stringify(seen));
if (seen) {
  await stand(b, seen.x + 150, 0.95, seen.z - 100); await lookAt(b, seen.x, 350, seen.z);
  for (let i = 0; i < 100 && (await star(b)).ships[0]?.y > 700; i++) await wait(100);
  await lookAt(b, seen.x, (await star(b)).ships[0].y, seen.z); await wait(200);
  await shot(b, "starship-belly");
  check("it falls on its belly", Math.abs((await star(b)).ships[0].tilt - Math.PI / 2) < 0.05, `${(await star(b)).ships[0].tilt}`);
}
await r.waitForSelector("body.ready", { timeout: 30000 });
aboard = null;
for (let i = 0; i < 80 && !aboard; i++) { await wait(100); aboard = (await star(r).catch(() => null))?.aboard ?? null; }
check("the rider is aboard it", !!aboard, `${aboard}`);
check("the builder sees the rider in it", (await star(b)).ships[0]?.riders.length === 1);
for (let i = 0; i < 300 && (await star(r)).aboard; i++) await wait(100);
await wait(700);
s = await star(r); q = await me(r);
check("it swings upright, lands in the Meadow and lets the rider out", s.ships[0]?.down && Math.abs(s.ships[0].tilt) < 0.01 && q.y < 3 && !q.down && q.env === "meadow", `y ${q.y.toFixed(1)} ${JSON.stringify(s.ships[0])}`);
if (seen) { await lookAt(b, seen.x, 25, seen.z); await wait(300); await shot(b, "starship-meadow-landed"); }

// ── Hitting something: it blows up ───────────────────────────────────────
await front(b);
await stand(b, TOWER[0] + 10, 0.95, TOWER[2]); await wait(300);
for (const n of [18, 19, 20, 21]) { await say(b, { k: "pad-part", id: 1, n }); await wait(120); }
const rebuilt = Date.now();
check("in the Meadow only the ship has to be built again", (await star(b)).pads[0].parts.length === 21);
// Nothing can be built into the rocket itself any more, so: something in its way over its nose. A
// column of walls up the outside of the mount, and a floor from its top out over the rocket.
await sf(b, ([x, z]) => { const s = window.snapfort; const mx = Math.floor(x / 5), mz = Math.floor(z / 5); const put = (type, x, y, z, rot) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } }); for (let y = 0; y < 39; y++) put("wall", mx + 2, y, mz, 1); put("floor", mx + 1, 39, mz, 0); window.__over = s.nextId(); s.history.do({ kind: "place", piece: { type: "floor", x: mx, y: 39, z: mz, rot: 0, id: window.__over, material: "wood", edit: 0 } }); }, [MOUNT[0], MOUNT[2]]);
await wait(1500);
check("(a floor is built out over the rocket's nose)", await sf(b, () => !!window.snapfort.state.get(window.__over)));
await wait(1500);
await b.keyboard.press("KeyH"); await wait(900);
check("(the builder rides this time)", (await star(b)).seated === 1, await toast(b));
check("the panel warns that something is built in its way", /built in its way/.test(await panel(b)), await panel(b));
await wait(Math.max(0, 20500 - (Date.now() - rebuilt)));
await click(b); await wait(10400);
let thrown = false, high = 0, boomSeen = false;
for (let i = 0; i < 80; i++) {
  await wait(100);
  const m = await me(b);
  thrown ||= m.tumbling; high = Math.max(high, m.y);
  boomSeen ||= await sf(b, () => window.snapfort.scene.meshes.some((x) => x.name === "star-boom"));
  if (i === 32) await shot(b, "starship-boom");
}
s = await star(b);
check("the rocket hits it and blows up: booster and ship are gone, the tower stands", s.pads[0].parts.length === 13 && s.pads[0].flight === null && boomSeen, `${s.pads[0].parts.join()} boom ${boomSeen}`);
check("whoever was in it is thrown out, flailing", thrown && high > 130 && (await star(b)).seated === null, `tumbling ${thrown} high ${high.toFixed(0)}`);
for (let i = 0; i < 200 && (await me(b)).down; i++) await wait(100);
q = await me(b);
check("...and lands, and gets up", !q.down && q.y < 25, `y ${q.y.toFixed(1)}`);
check("the camera is back over their shoulder", q.chase === null);

// ── Someone arriving later ───────────────────────────────────────────────
const late = await open("late");
s = await star(late);
check("someone arriving later sees the launch site as it stands, and the landed ship", s.pads.length === 1 && s.pads[0].drawn === 13 && s.ships.length === 1 && s.ships[0].down, JSON.stringify({ pads: s.pads.map((p) => p.parts.length), ships: s.ships.length }));

check("no errors in any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
