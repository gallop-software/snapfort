/**
 * Trebuchet QA: two pages in a fresh world. A builds a wooden tower; B builds a
 * trebuchet 60 m away, gets on with H, aims with a right click and fires. Both
 * pages must see the same damage, collapse and tower heights.
 * Start the Gallop dev server first, then: npm run qa:trebuchet
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const world = `treb-${Date.now().toString(36)}`;
const base = new URL(process.argv[2] ?? "http://localhost:5173/");
base.searchParams.set("world", world);
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`[${label} pageerror] ${e.message.slice(0, 300)}`));
  await page.goto(base.toString());
  await page.waitForSelector("body.ready", { timeout: 20000 });
  await page.click("#play-free");
  await wait(300);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const ids = (page) => sf(page, () => [...window.snapfort.state.all()].map((p) => p.id).sort().join(","));
const put = (page, list) => sf(page, (list) => { const s = window.snapfort; let n = 0; for (const [type, x, y, z, rot, material] of list) if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: material ?? "wood", edit: 0 } })) n++; return n; }, list);

const a = await open("A");
const b = await open("B");

// A: a slim wooden tower 6 storeys high: one column of walls facing south, a floor behind each storey.
const towerPieces = [];
for (let y = 0; y < 6; y++) {
  towerPieces.push(["wall", 0, y, 12, 0]);
  if (y > 0) towerPieces.push(["floor", 0, y, 12, 0]);
}
const built = await put(a, towerPieces);
await wait(2200); // towers are measured 1.5 s after changes
check(`A's ${built}-piece tower is on B's page`, (await ids(a)) === (await ids(b)));
check("both see it as the tallest tower", (await a.textContent("#towers")).includes("23 m") && (await b.textContent("#towers")).includes("23 m"), (await b.textContent("#towers")).replace(/\s+/g, " "));

// B: a trebuchet on the ground 60 m south of the tower.
await sf(b, () => { const s = window.snapfort; s.player.teleport(2.5, 0.95, 12 * 5 - 60 - 4); s.rig.yaw = 0; s.rig.pitch = 0.1; });
await frames(b, 4);
const placedT = await put(b, [["trebuchet", 0, 0, 0, 0]]);
await frames(b, 3);
check("B builds a trebuchet on the ground", placedT === 1);
await sf(b, () => window.snapfort.player.teleport(2.5, 0.95, -2.5));
await frames(b, 4);
check("standing beside it shows the get-on hint", (await b.textContent("#hint")).includes("get on"), await b.textContent("#hint"));
await b.keyboard.press("KeyH");
await wait(500);
check("H gets B on the trebuchet", !!(await sf(b, () => window.snapfort.crewOn)));
check("…and shows the trebuchet panel", await b.isVisible("#crew"), await b.textContent("#crew"));

// Aim: point the camera at the tower's base and right click.
const aimAt = async (x, y, z) => {
  for (let i = 0; i < 4; i++) {
    await sf(b, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]);
    await frames(b, 2);
  }
};
await aimAt(2.5, 1.5, 60);
await b.mouse.down({ button: "right" }); await b.mouse.up({ button: "right" }); await frames(b, 3);
const target = await sf(b, () => window.snapfort.target);
check("right click sets a target on the tower", !!target && Math.abs(target[2] - 60) < 1.5, JSON.stringify(target?.map((v) => +v.toFixed(1))));
check("the panel says it is in range and ready", (await b.textContent("#crew")).includes("ready"), await b.textContent("#crew"));
await b.screenshot({ path: "qa/shots/trebuchet-aim.png" });

// A stands right in front of the target wall.
await sf(a, () => { const s = window.snapfort; s.player.teleport(2.5, 0.95, 57.5); s.rig.yaw = Math.PI; });
await wait(400);
const startA = await sf(a, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));

// Fire, and watch the stone land on A's page too.
const before = (await ids(a)).split(",").length;
await b.mouse.down(); await b.mouse.up();
await wait(300);
check("the panel shows the reload", (await b.textContent("#crew")).includes("reloading"), await b.textContent("#crew"));
await b.mouse.down(); await b.mouse.up(); await wait(150);
check("firing again too soon is refused", (await b.textContent("#toast")).includes("reloading"), await b.textContent("#toast"));
// Follow A through the air after the impact (the stone flies about 2.8 s).
let peak = 0, sawTumble = false;
const t0 = Date.now();
while (Date.now() - t0 < 6500) {
  const y = await sf(a, () => window.snapfort.player.feetY);
  peak = Math.max(peak, y);
  if (!sawTumble) sawTumble = await sf(b, () => [...window.snapfort.remotes.remotes.values()].some((r) => r.tumbling));
  await wait(60);
}
const endA = await sf(a, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z, tumbling: window.snapfort.player.tumbling }));
const thrownFar = Math.hypot(endA.x - startA.x, endA.z - startA.z);
check("a builder standing at the impact is thrown high into the air", peak > 12, `peak ${peak.toFixed(1)} m`);
check("…lands far away and back on their feet", thrownFar > 30 && !endA.tumbling, `${thrownFar.toFixed(0)} m away`);
check("…and the other builder saw them tumbling", sawTumble);
await frames(a, 3);
const after = (await ids(a)).split(",").length;
check("the stone breaks the bottom of the tower, and what it held falls", after <= before - 9, `${before} → ${after} pieces`);
check("both pages agree on what is left", (await ids(a)) === (await ids(b)));
check("rubble is falling on A's page", (await sf(a, () => window.snapfort.debris.count)) > 0, `${await sf(a, () => window.snapfort.debris.count)} pieces of rubble`);
await a.screenshot({ path: "qa/shots/trebuchet-collapse.png" });
await wait(6000);
check("the rubble is gone after a few seconds", (await sf(a, () => window.snapfort.debris.count)) === 0);
await wait(1000);
check("the tower board drops the fallen tower", !(await a.textContent("#towers")).includes("23 m"), (await a.textContent("#towers")).replace(/\s+/g, " ") || "(empty)");

// Too close: aim at the ground right in front.
await aimAt(2.5, 0, 12);
await b.mouse.down({ button: "right" }); await b.mouse.up({ button: "right" }); await frames(b, 3);
check("a target nearer than the minimum shows as too close", (await b.textContent("#crew")).includes("too close"), await b.textContent("#crew"));

// A removes the trebuchet while B is on it.
await sf(a, () => { const s = window.snapfort; const t = [...s.state.all()].find((p) => p.type === "trebuchet"); s.removePiece(t.id); });
await wait(800);
check("removing a manned trebuchet takes its crew off", !(await sf(b, () => window.snapfort.crewOn)) && !(await b.isVisible("#crew")));

check("no errors or warnings in the console", errors.length === 0, errors.slice(0, 5).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
