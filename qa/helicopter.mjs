/**
 * Mars's helicopters: three on pads, getting in (the first flies, the second
 * rides), flying on red Mars (a low ceiling, a battery that runs down), and in
 * thick air (higher, faster), getting out in the air, a missile throwing one,
 * and a late joiner. Needs the Gallop dev server with Stripe test keys in
 * .dev.vars. Run: npm run qa:helicopter
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `heli-${Date.now().toString(36)}`;
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, path, key) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  const url = new URL(path, base);
  url.searchParams.set("world", world);
  await page.goto(url.toString());
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(500);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const hover = async (page, x, y, z) => { await sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]); await wait(230); };
const helis = (page) => sf(page, () => [...window.snapfort.feature.helicopter.helis.entries()].map(([id, h]) => ({ id, pose: [...h.pose], riders: [...h.riders], charge: h.charge, falling: !!h.falling, spin: h.spin })));
const mine = (page) => sf(page, () => ({ id: window.snapfort.feature.helicopter.mine, seat: window.snapfort.feature.helicopter.seat }));
const hint = (page) => sf(page, () => document.getElementById("hint")?.textContent ?? "");
const panel = (page) => sf(page, () => document.getElementById("world-panel").textContent);
const toast = (page) => sf(page, () => document.getElementById("toast").textContent);

const key = await paidKey(base, "/mars");
const a = await open("pilot", "/mars?sol=0.3&air=0", key);
const b = await open("passenger", "/mars?sol=0.3&air=0&testpay");

let list = await helis(a);
check("three helicopters stand on pads near where builders arrive, batteries full", list.length === 3 && list.every((h) => h.pose[1] === 0 && h.charge === 1 && Math.hypot(h.pose[0] - 2.5, h.pose[2] + 7.5) < 45), list.map((h) => h.pose.slice(0, 3).map(Math.round).join(",")).join(" · "));
const pad = list[0].pose;
await hover(a, pad[0] + 2.5, 0.95, pad[2]); await frames(a, 6);
check("beside one, the game offers to fly it", (await hint(a)).includes("fly the helicopter"), await hint(a));
await a.addStyleTag({ content: "#tip { display: none !important; }" });
await sf(a, ([x, z]) => { const s = window.snapfort; s.rig.yaw = Math.atan2(x - s.player.position.x, z - s.player.position.z) + 0.5; s.rig.pitch = 0.12; }, [pad[0], pad[2]]);
await frames(a, 6);
await a.screenshot({ path: "qa/shots/heli-parked.png" });
await a.keyboard.press("KeyH"); await wait(600);
check("H gets in: the pilot's seat", (await mine(a)).id === 0 && (await mine(a)).seat === 0 && (await helis(b))[0].riders[0] !== null);
await hover(b, pad[0] - 2.5, 0.95, pad[2]); await frames(b, 6);
check("a second builder (a visitor here) is offered a ride", (await hint(b)).includes("ride in the helicopter"), await hint(b));
await b.keyboard.press("KeyH"); await wait(600);
check("…and rides beside the pilot", (await mine(b)).id === 0 && (await mine(b)).seat === 1 && (await helis(a))[0].riders[1] !== null);

// Flying on red Mars: Space climbs, to a low ceiling; W carries it forward.
await sf(a, () => { window.snapfort.rig.yaw = 0.6; window.snapfort.rig.pitch = 0.2; });
await a.keyboard.down("Space"); await wait(4000);
const up1 = (await helis(a))[0];
check("Space lifts it off, rotors turning", up1.pose[1] > 6 && up1.spin > 0.8, `${up1.pose[1].toFixed(1)} m up after 4 s`);
await a.keyboard.down("KeyW"); await wait(4000); await a.keyboard.up("KeyW");
const along = (await helis(a))[0];
const flew = Math.hypot(along.pose[0] - pad[0], along.pose[2] - pad[2]);
check("W carries it forward, the way the pilot looks", flew > 25 && Math.abs(Math.atan2(along.pose[0] - pad[0], along.pose[2] - pad[2]) - 0.6) < 0.35, `${flew.toFixed(0)} m`);
const seen = (await helis(b))[0];
check("…the passenger goes with it, and sees it where the pilot does", Math.hypot(seen.pose[0] - along.pose[0], seen.pose[1] - along.pose[1], seen.pose[2] - along.pose[2]) < 12 && (await sf(b, () => window.snapfort.player.position.y)) > 5, `passenger ${(await sf(b, () => window.snapfort.player.position.y)).toFixed(1)} m up`);
await a.screenshot({ path: "qa/shots/heli-flying.png" });
await wait(9000);
const top = (await helis(a))[0];
check("on red Mars it climbs no higher than about 40 m, however long Space is held", top.pose[1] > 30 && top.pose[1] < 42, `${top.pose[1].toFixed(1)} m`);
await a.keyboard.up("Space");
check("the battery is running down, and the panel shows it", top.charge < 0.75 && (await panel(a)).includes("battery"), await panel(a));
await wait(1500);
const hovering = (await helis(a))[0];
check("with no keys held it hovers", Math.abs(hovering.pose[1] - top.pose[1]) < 3);

// The pilot gets out in the air: both are out, and it comes down empty.
await a.keyboard.press("KeyH"); await wait(900);
const after = (await helis(b))[0];
check("the pilot gets out in the air: nobody is flying, so the passenger is out too and it comes down empty", (await mine(a)).id === null && (await mine(b)).id === null && after.riders.every((r) => r === null) && after.falling);
await wait(9000);
const landed = (await helis(a))[0];
check("…and stands on the ground where it came down, for the next pilot", !landed.falling && landed.pose[1] < 0.2 && landed.spin < 0.3, `${landed.pose[1].toFixed(2)} m up`);
check("…while both builders came down too", (await sf(a, () => window.snapfort.player.feetY)) < 1 && (await sf(b, () => window.snapfort.player.feetY)) < 1);

// Thick air: the same machine goes far higher.
const t = await open("thick", "/mars?sol=0.3&air=1", key);
list = await helis(t);
const pad2 = list[1].pose;
await hover(t, pad2[0] + 2.5, 0.95, pad2[2]); await frames(t, 6);
await t.keyboard.press("KeyH"); await wait(600);
await t.keyboard.down("Space"); await wait(7000); await t.keyboard.up("Space");
const high = (await helis(t))[1];
check("in thick air it climbs twice as fast and well past red Mars's ceiling", high.pose[1] > 50, `${high.pose[1].toFixed(0)} m up after 7 s`);
check("…and the panel says how high and how long it can fly in this air", /as high as 330 m and for 180 s/.test(await panel(t)), await panel(t));

// A missile beside a parked one throws it.
list = await helis(a);
const parked = list[2].pose;
await hover(a, parked[0] + 60, 0.95, parked[2] - 2.5);
await sf(a, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: Math.floor((x + 60) / 5), y: 0, z: Math.floor(z / 5), rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); }, [parked[0], parked[2]]);
await wait(600);
await a.keyboard.press("KeyH"); await wait(600);
check("(the builder gets on a beacon 60 m from a parked helicopter)", !!(await sf(a, () => window.snapfort.crewOn)));
for (let i = 0; i < 4; i++) { await sf(a, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [parked[0] + 2, 0.1, parked[2]]); await frames(a, 2); }
await a.mouse.down(); await a.mouse.up();
await wait(3800);
const tossed = (await helis(b))[2];
check("a missile landing beside a helicopter throws it tumbling through the air", tossed.falling);
await wait(5500);
const settled = (await helis(b))[2];
check("…and it comes down some way off, the right way up", !settled.falling && Math.hypot(settled.pose[0] - parked[0], settled.pose[2] - parked[2]) > 12 && Math.abs(settled.pose[4]) < 0.01 && Math.abs(settled.pose[5]) < 0.01, `${Math.hypot(settled.pose[0] - parked[0], settled.pose[2] - parked[2]).toFixed(0)} m away`);
await a.keyboard.press("KeyH");

// A late joiner sees them where they are.
const late = await open("late", "/mars?sol=0.3&testpay");
await wait(800);
const theirs = await helis(late);
check("someone joining now sees all three where they stand", theirs.length === 3 && Math.hypot(theirs[2].pose[0] - settled.pose[0], theirs[2].pose[2] - settled.pose[2]) < 1 && theirs[1].riders[0] !== null);

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
