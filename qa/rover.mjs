/**
 * The Moon's rovers: six on pads, anyone drives (visitors too), one driver
 * each, everyone sees them move; off a ramp at speed the rover lifts off and
 * its driver is thrown clear high up and flown back on their rockets, the same
 * past the edge of the building area; the empty rover drifts off and comes
 * home. Needs the Gallop dev server with Stripe test keys in .dev.vars.
 * Run: npm run qa:rover
 */
import { chromium, devices } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = "http://localhost:5173";
const world = `rover-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, key) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key ?? null);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}/moon?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(700);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const rovers = (page) => sf(page, () => [...window.snapfort.feature.rovers].map(([id, r]) => ({ id, pose: [...r.pose], rider: r.rider, lost: !!r.lost })));
const me = (page) => sf(page, () => { const s = window.snapfort; return { sitting: !!s.player.riding, tilt: s.feature.mine === null ? 0 : Math.abs(s.feature.rovers.get(s.feature.mine).pose[4]) + Math.abs(s.feature.rovers.get(s.feature.mine).pose[5]), x: s.player.position.x, y: s.player.position.y, z: s.player.position.z, mine: s.feature.mine, speed: s.feature.speed, floating: s.feature.floating, gliding: s.player.gliding, down: s.player.knockedDown, flames: s.scene.meshes.some((m) => m.name === "flame" && m.isEnabled() && m.parent?.parent === s.player.avatar.root) }; });
/** Stands a builder beside rover `id`, looking the way `yaw`. */
const standBy = async (page, id, yaw = 0) => { const r = (await rovers(page)).find((x) => x.id === id); await sf(page, ([x, y, z, yaw]) => { const s = window.snapfort; s.player.teleport(x - 2.5, y + 0.95, z); s.rig.yaw = yaw; s.rig.pitch = 0.15; }, [r.pose[0], r.pose[1], r.pose[2], yaw]); await wait(500); };

const key = await paidKey(base, "/moon");
const a = await open("visitor");
const b = await open("builder", key);
const aId = await sf(a, () => window.snapfort.myId);

// ── Six rovers, for everyone ─────────────────────────────────────────────
const start = await rovers(a);
check("six rovers stand on pads near where builders arrive", start.length === 6 && start.every((r) => r.rider === null && !r.lost && Math.hypot(r.pose[0] - 2.5, r.pose[2] + 7.5) < 30), start.map((r) => `${r.pose[0]},${r.pose[2]}`).join(" "));
check("…the same six for everyone", JSON.stringify(await rovers(b)) === JSON.stringify(start));
check("…and a builder who is not near one is not offered a ride", !/rover/.test(await a.textContent("#hint")));

// ── Getting on (visitors too), one driver each ───────────────────────────
await standBy(a, 0);
check("next to a rover: H drives it", /H\s*drive the rover/.test(await a.textContent("#hint")), await a.textContent("#hint"));
await a.keyboard.press("KeyH"); await wait(700);
check("a visitor gets on and sits in its seat", (await me(a)).mine === 0 && (await me(a)).sitting && Math.abs((await me(a)).y - (start[0].pose[1] + 1.62)) < 0.1, JSON.stringify(await me(a)));
check("…everyone else sees them sitting in it too", await sf(b, (id) => { const r = window.snapfort.scene.transformNodes.filter((n) => n.name === "builder").find((n) => Math.abs(n.rotation.x) < 0.01 && n.getChildTransformNodes(false).some((c) => c.name === "hip" && c.rotation.x < -1.2)); return !!r && !!window.snapfort.remotes.positionOf(id); }, aId));
check("…everyone sees who is driving", (await rovers(b)).find((r) => r.id === 0).rider === aId);
await standBy(b, 0);
check("…and nobody else is offered a rover that has a driver", !/drive the rover/.test(await b.textContent("#hint")));
await b.keyboard.press("KeyH"); await wait(600);
check("…or gets on it", (await me(b)).mine === null && /Someone else is driving/.test(await b.textContent("#toast")), await b.textContent("#toast"));
await a.mouse.down(); await a.mouse.up(); await wait(300);
check("on a rover a click builds nothing and offers nothing to buy", !(await a.isVisible("#view-unlock")) && (await sf(a, () => window.snapfort.state.size)) === 0);

// ── Driving ──────────────────────────────────────────────────────────────
await sf(a, () => { window.snapfort.rig.yaw = Math.PI / 2; });
await a.keyboard.down("KeyW"); await wait(3000);
const cruising = await me(a);
check("forward drives where you look, up to about 36 m/s", cruising.speed > 30 && cruising.speed < 37 && cruising.x > start[0].pose[0] + 40, `${cruising.speed.toFixed(1)} m/s`);
const seen = (await rovers(b)).find((r) => r.id === 0);
const driverSeen = await sf(b, (id) => window.snapfort.remotes.positionOf(id), aId);
check("…everyone else sees the rover move, its driver on it", Math.hypot(seen.pose[0] - cruising.x, seen.pose[2] - cruising.z) < 22 && !!driverSeen && Math.hypot(driverSeen[0] - seen.pose[0], driverSeen[2] - seen.pose[2]) < 8, `rover ${seen.pose[0].toFixed(0)}, driver ${driverSeen?.[0].toFixed(0)}`);
await a.keyboard.down("ShiftLeft"); await wait(2000);
check("the run key goes flat out, about 60 m/s", (await me(a)).speed > 50 && (await me(a)).speed < 61, `${(await me(a)).speed.toFixed(1)} m/s`);
await a.keyboard.up("ShiftLeft"); await a.keyboard.up("KeyW");
await a.keyboard.down("KeyS"); await wait(3200); await a.keyboard.up("KeyS");
check("back brakes, then reverses", (await me(a)).speed < 0, `${(await me(a)).speed.toFixed(1)} m/s`);
await wait(2500);
check("let go, it rolls to a stop", Math.abs((await me(a)).speed) < 1.5, `${(await me(a)).speed.toFixed(1)} m/s`);

// ── Getting off ──────────────────────────────────────────────────────────
const before = await me(a);
await a.keyboard.press("KeyH"); await wait(800);
const off = await me(a);
const left = (await rovers(b)).find((r) => r.id === 0);
check("H gets off beside it, standing; the rover stays where it was left, free for anyone", off.mine === null && !off.sitting && Math.hypot(off.x - before.x, off.z - before.z) < 4 && left.rider === null && Math.hypot(left.pose[0] - before.x, left.pose[2] - before.z) < 2.5);
await a.keyboard.down("KeyW"); await wait(500); await a.keyboard.up("KeyW");
check("…and the driver walks away", Math.hypot((await me(a)).x - off.x, (await me(a)).z - off.z) > 1.5);

// ── Off a ramp: lift-off, thrown clear in space, rockets back, rover home ─
// The builder lays two ramps in a row, well clear of everything, along +x.
await sf(b, () => { const s = window.snapfort; const put = (type, x, y, z, rot) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "metal", edit: 0 } }); put("floor", 0, 0, -20, 0); put("ramp", 0, 0, -20, 1); put("ramp", 1, 1, -20, 1); });
await wait(800);
await standBy(b, 1);
await b.keyboard.press("KeyH"); await wait(700);
check("(the builder takes another rover)", (await me(b)).mine === 1);
// Line up on the ramps from 60 m back (steering at a point a little ahead on their line), then flat out at them.
const LINE_Z = -97.5;
const steer = (page, ahead) => sf(page, ([z, ahead]) => { const s = window.snapfort; s.rig.yaw = Math.atan2(ahead, z - s.player.position.z); }, [LINE_Z, ahead]);
for (let i = 0; i < 150; i++) {
  const p = await me(b);
  if (Math.hypot(p.x + 60, p.z - LINE_Z) < 2.5) break;
  await sf(b, ([tx, tz]) => { const s = window.snapfort; s.rig.yaw = Math.atan2(tx - s.player.position.x, tz - s.player.position.z); }, [-60, LINE_Z]);
  await b.keyboard.down("KeyW"); await wait(100);
  if (Math.hypot(p.x + 60, p.z - LINE_Z) < 14) { await b.keyboard.up("KeyW"); await wait(250); }
}
await b.keyboard.up("KeyW"); await wait(2500);
await steer(b, 12);
await b.keyboard.down("KeyW"); await b.keyboard.down("ShiftLeft");
let floated = false, floatedAt = 0, ejectedAt = 0, tilt = 0, satFloating = false, climbed = 0, tookOffAt = null, glided = false, flames = false, lostSeen = false, seenTilt = 0;
for (let i = 0; i < 260; i++) {
  await wait(100);
  // Keep pointing along the ramps until it is off them.
  const p = await me(b);
  if (p.mine !== null && !p.floating) await steer(b, 12);
  if (p.floating && !floated) { floated = true; floatedAt = Date.now(); tookOffAt = p.y; }
  if (p.floating) { tilt = Math.max(tilt, p.tilt); satFloating ||= p.sitting; climbed = Math.max(climbed, p.y - tookOffAt); }
  if (floated && p.mine === null && !ejectedAt) ejectedAt = Date.now();
  glided ||= p.gliding; flames ||= p.gliding && p.flames;
  const other = (await rovers(a)).find((r) => r.id === 1);
  lostSeen ||= other.lost;
  if (floated && !ejectedAt) seenTilt = Math.max(seenTilt, Math.abs(other.pose[4]) + Math.abs(other.pose[5]));
  if (ejectedAt && glided && !p.down) break;
}
await b.keyboard.up("KeyW"); await b.keyboard.up("ShiftLeft");
const floatedFor = (ejectedAt - floatedAt) / 1000;
check("flat out up a ramp, the rover lifts off and floats away", floated && climbed > 15, `left the ramp at ${tookOffAt?.toFixed(1)} m, floated ${climbed.toFixed(0)} m higher`);
check("…turning over slowly every which way, its driver still in the seat", tilt > 2 && satFloating, `turned ${tilt.toFixed(1)} rad`);
check("…and everyone else sees it turning over too", seenTilt > 1.5, `${seenTilt.toFixed(1)} rad`);
// (Five seconds of the game's time: a little longer by the clock when this computer is busy with three pages.)
check("…after about 5 seconds the seat throws its driver clear", ejectedAt > 0 && floatedFor > 4.3 && floatedFor < 7.5, `${floatedFor.toFixed(1)} s`);
check("…and their rocket pack flies them back down", glided && flames);
const landed = await me(b);
check("…gently onto their feet on the Moon, inside the building area", !landed.down && !landed.sitting && Math.abs(landed.y - 0.9) < 0.3 && Math.abs(landed.x) <= 240 && Math.abs(landed.z) <= 240, `at ${landed.x.toFixed(0)}, ${landed.z.toFixed(0)}`);
check("…while everyone sees the empty rover drift off", lostSeen);
await wait(5500);
const home = (await rovers(a)).find((r) => r.id === 1);
check("…and a little later it is back on its pad", !home.lost && home.rider === null && Math.hypot(home.pose[0] - start[1].pose[0], home.pose[2] - start[1].pose[2]) < 0.5 && JSON.stringify((await rovers(b)).find((r) => r.id === 1).pose.map((n) => Math.round(n))) === JSON.stringify(home.pose.map((n) => Math.round(n))));

// ── Past the edge of the building area ───────────────────────────────────
await standBy(a, 2);
await a.keyboard.press("KeyH"); await wait(700);
await sf(a, () => { window.snapfort.rig.yaw = -Math.PI / 2; });
await a.keyboard.down("KeyW"); await a.keyboard.down("ShiftLeft");
let far = 0, over = false, back = false;
for (let i = 0; i < 200; i++) {
  await wait(100);
  const p = await me(a);
  far = Math.min(far, p.x);
  if (p.mine === null) over = true;
  back ||= over && p.gliding;
  if (over && back && !p.down) break;
}
await a.keyboard.up("KeyW"); await a.keyboard.up("ShiftLeft");
const edge = await me(a);
check("driving off the edge of the building area throws the driver clear too", over && far < -240, `reached ${far.toFixed(0)} m`);
check("…and the rockets set them down back inside it", back && !edge.down && Math.abs(edge.x) <= 240 && Math.abs(edge.y - 0.9) < 0.3, `at ${edge.x.toFixed(0)}, ${edge.z.toFixed(0)}`);

// ── Still right after a reload ───────────────────────────────────────────
await wait(5600);
await b.reload(); await b.waitForSelector("body.ready"); await b.click("#play-free"); await wait(900);
const again = await rovers(b);
const truth = await rovers(a);
check("a builder who arrives later sees every rover where it is", again.length === 6 && again.every((r, i) => Math.hypot(r.pose[0] - truth[i].pose[0], r.pose[2] - truth[i].pose[2]) < 0.5 && r.rider === truth[i].rider));
check("…with the first one still where its driver left it, and the others at home", Math.hypot(again[0].pose[0] - left.pose[0], again[0].pose[2] - left.pose[2]) < 1 && [1, 2, 3, 4, 5].every((i) => Math.hypot(again[i].pose[0] - start[i].pose[0], again[i].pose[2] - start[i].pose[2]) < 0.5));

// ── On a phone: a button ─────────────────────────────────────────────────
{
  const context = await browser.newContext({ ...devices["iPhone 13 landscape"] });
  await context.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const ph = await context.newPage();
  ph.on("pageerror", (e) => errors.push(`[phone] ${e.message.slice(0, 200)}`));
  await ph.goto(`${base}/moon?world=${world}`);
  await ph.waitForSelector("body.ready", { timeout: 30000 });
  await ph.tap("#play-free"); await wait(900);
  const button = () => ph.evaluate(() => { const b = document.getElementById("t-board"); const r = b.getBoundingClientRect(); return { shown: !b.hidden && r.width > 0, text: b.textContent, fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
  check("on a phone, away from a rover there is no button for one", !(await button()).shown);
  await standBy(ph, 3);
  const drive = await button();
  check("…next to one, a Drive button, on screen", drive.shown && drive.text === "Drive" && drive.fits, JSON.stringify(drive));
  await ph.tap("#t-board"); await wait(800);
  const riding = await button();
  check("…tapping it gets on, and the button becomes Get off", (await me(ph)).mine === 3 && riding.shown && riding.text === "Get off" && riding.fits, JSON.stringify(riding));
  await ph.tap("#t-board"); await wait(800);
  check("…and tapping that gets off", (await me(ph)).mine === null && (await rovers(a)).find((r) => r.id === 3).rider === null);
  await context.close();
}

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
