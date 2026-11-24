/**
 * Trebuchet QA: two pages in a fresh world. A builds a wooden tower; B builds a
 * trebuchet 60 m away, gets on with H, aims with a right click and fires. Both
 * pages must see the same damage, collapse and tower heights.
 * Start the Gallop dev server first, then: npm run qa:trebuchet
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const world = `treb-${Date.now().toString(36)}`;
const base = new URL(process.argv[2] ?? (process.env.QA_BASE ?? (process.env.QA_BASE ?? "http://localhost:5173")) + "/");
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
const flagOf = (p) => sf(p, () => ({ text: window.snapfort.flag.text, at: window.snapfort.flag.at, n: window.snapfort.scene.meshes.filter((m) => m.name === "flag-banner").length, board: !!document.getElementById("towers") }));
const flagA = await flagOf(a), flagB = await flagOf(b);
check("both see the one flag on it, with its height, and no tower board", flagA.text === "Tallest · 23 m" && flagB.text === flagA.text && flagA.n === 1 && !flagA.board && Math.abs(flagB.at[1] - 23) < 1, JSON.stringify(flagB));

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

// Aim: point the crosshair at the tower's base; the crosshair is the target.
const aimAt = async (x, y, z) => {
  for (let i = 0; i < 4; i++) {
    await sf(b, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]);
    await frames(b, 2);
  }
};
await aimAt(2.5, 1.5, 60);
await frames(b, 3);
const target = await sf(b, () => window.snapfort.target);
check("aiming at the tower makes it the target (no right click needed)", !!target && Math.abs(target[2] - 60) < 1.5, JSON.stringify(target?.map((v) => +v.toFixed(1))));
check("the panel says it is in range and ready", (await b.textContent("#crew")).includes("ready"), await b.textContent("#crew"));
await b.screenshot({ path: "qa/shots/trebuchet-aim.png" });

// Wood takes two hits: a first stone cracks the bottom wall and nothing falls.
await sf(a, () => window.snapfort.player.teleport(-40, 0.95, 20));
await wait(300);
const beforeSoften = (await ids(a)).split(",").length;
await b.mouse.down(); await b.mouse.up();
await wait(6800); // the flight, then the reload
check("one stone only cracks a wood wall: nothing falls yet", (await ids(a)).split(",").length === beforeSoften && (await ids(a)) === (await ids(b)), `${beforeSoften} → ${(await ids(a)).split(",").length} pieces`);
await aimAt(2.5, 1.5, 60);
await frames(b, 3);
check("…and the trebuchet is ready again after the reload", (await b.textContent("#crew")).includes("ready"), await b.textContent("#crew"));

// A stands right in front of the target wall, then their tab "goes to sleep" (the game stops drawing, as in a background tab).
await sf(a, () => { const s = window.snapfort; s.player.teleport(2.5, 0.95, 57.5); s.rig.yaw = Math.PI; });
await wait(400);
const startA = await sf(a, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));
await sf(a, () => window.snapfort.engine.stopRenderLoop());

// Fire, and watch the stone land on A's page too.
const before = (await ids(a)).split(",").length;
await b.mouse.down(); await b.mouse.up();
await wait(300);
const armNow = () => sf(b, () => { const t = window.snapfort.trebuchets; const e = [...t.engines.values()][0]; return t.armAngle((performance.now() - e.thrownAt) / 1000); });
check("the panel shows the reload", (await b.textContent("#crew")).includes("reloading"), await b.textContent("#crew"));
await b.mouse.down(); await b.mouse.up(); await wait(150);
check("firing again too soon is refused", (await b.textContent("#toast")).includes("reloading"), await b.textContent("#toast"));
// Watch A from B's page: A's own page is asleep, but the server's flight plays anyway.
let peak = 0, sawTumble = false, sawDown = false, flips = new Set(), plainFigure = false, rubbleOnB = 0;
const t0 = Date.now();
while (Date.now() - t0 < 10000) {
  const r = await sf(b, () => { const r = [...window.snapfort.remotes.remotes.values()][0]; return r && { y: r.y, tumbling: r.tumbling, down: r.down, full: !!r.avatar, flip: r.avatar ? +r.avatar.root.rotation.x.toFixed(1) : null }; });
  if (r) {
    peak = Math.max(peak, r.y - 0.9); sawTumble ||= r.tumbling; sawDown ||= r.down > 0.9;
    if (r.tumbling) { if (!r.full) plainFigure = true; else flips.add(r.flip); }
  }
  rubbleOnB = Math.max(rubbleOnB, await sf(b, () => window.snapfort.debris.count));
  await wait(60);
}
const seenByB = await sf(b, () => { const r = [...window.snapfort.remotes.remotes.values()][0]; return { x: r.x, z: r.z }; });
check("a builder at the impact is thrown high, even with their tab asleep (as others see it)", peak > 12 && sawTumble, `peak ${peak.toFixed(1)} m`);
check("…comes down flat on their back for a moment", sawDown);
check("…and the onlooker sees the full body flipping the whole way, however far it flies", !plainFigure && flips.size > 5, `${flips.size} different flip angles${plainFigure ? ", drawn as a plain figure at some point" : ""}`);
// A's tab wakes up: they are where they came down.
await sf(a, () => { const s = window.snapfort; s.engine.runRenderLoop(() => s.scene.render()); });
await wait(500);
const endA = await sf(a, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z, down: window.snapfort.player.knockedDown }));
const thrownFar = Math.hypot(endA.x - startA.x, endA.z - startA.z);
check("…and on waking up, their own page has them where they landed, back on their feet", thrownFar > 30 && Math.hypot(endA.x - seenByB.x, endA.z - seenByB.z) < 1.5 && !endA.down, `${thrownFar.toFixed(0)} m away; B sees them ${Math.hypot(endA.x - seenByB.x, endA.z - seenByB.z).toFixed(1)} m from there`);
await frames(a, 3);
const after = (await ids(a)).split(",").length;
check("the second stone breaks the bottom of the tower, and what it held falls", after <= before - 9, `${before} → ${after} pieces`);
check("both pages agree on what is left", (await ids(a)) === (await ids(b)));
check("rubble falls on the watching page", rubbleOnB > 0, `${rubbleOnB} pieces of rubble`);
await a.screenshot({ path: "qa/shots/trebuchet-collapse.png" });
await wait(6000);
check("the rubble is gone after a few seconds, also on the page that slept through it", (await sf(a, () => window.snapfort.debris.count)) === 0 && (await sf(b, () => window.snapfort.debris.count)) === 0);
await wait(1000);
check("the flag leaves the fallen tower", (await flagOf(a)).text !== "Tallest · 23 m", JSON.stringify(await flagOf(a)));

// B fires at open ground, and their tab sleeps right away; it wakes after the reload.
await aimAt(-30, 0, 30);
await frames(b, 3);
await b.mouse.down(); await b.mouse.up();
await wait(250);
const swung = await armNow();
await sf(b, () => window.snapfort.engine.stopRenderLoop());
await wait(7000);
await sf(b, () => { const s = window.snapfort; s.engine.runRenderLoop(() => s.scene.render()); });
await wait(200);
check("a trebuchet whose tab slept through the reload is wound and ready the moment it wakes", swung > -2.2 && Math.abs((await armNow()) - -2.3) < 0.01 && (await b.textContent("#crew")).includes("ready"), `arm ${swung.toFixed(2)} → ${(await armNow()).toFixed(2)}; ${await b.textContent("#crew")}`);

// Too close: aim at the ground right in front.
await aimAt(2.5, 0, 12);
await frames(b, 3);
check("a target nearer than the minimum shows as too close", (await b.textContent("#crew")).includes("too close"), await b.textContent("#crew"));

// Open sky: nothing under the crosshair, and it still fires, at a point in the air the way B looks.
await sf(b, () => { const s = window.snapfort; s.rig.yaw = Math.PI / 2; s.rig.pitch = -0.5; });
await frames(b, 4);
const skyTarget = await sf(b, () => window.snapfort.target);
check("looking at open sky still gives a target, up in the air", !!skyTarget && skyTarget[1] > 50 && skyTarget[0] > 100, JSON.stringify(skyTarget?.map((v) => +v.toFixed(1))));
check("…and the panel says open air, ready", /Open air · ready/.test(await b.textContent("#crew")), await b.textContent("#crew"));
await b.mouse.down(); await b.mouse.up();
await wait(400);
const skyShot = await sf(b, () => { const t = window.snapfort.trebuchets; const st = [...t.stones.values()].at(-1); return st && { n: t.stones.size, y: st.mesh.position.y, vy: st.flight.v[1] }; });
check("…and a click throws the stone up into it", !!skyShot && skyShot.vy > 20 && (await b.textContent("#crew")).includes("reloading"), `${JSON.stringify(skyShot)}; ${await b.textContent("#crew")}`);

// A removes the trebuchet while B is on it.
await sf(a, () => { const s = window.snapfort; const t = [...s.state.all()].find((p) => p.type === "trebuchet"); s.removePiece(t.id); });
await wait(800);
check("removing a manned trebuchet takes its crew off", !(await sf(b, () => window.snapfort.crewOn)) && !(await b.isVisible("#crew")));
check("…and gives them their normal view and body back", await sf(b, () => !document.body.classList.contains("scoped") && window.snapfort.rig.scope === null && window.snapfort.player.avatar.root.isEnabled()));

// B builds a ramp run up four storeys, one floor at the top and a trebuchet on it, then gets on with H.
await put(b, [["ramp", -10, 0, 0, 0], ["ramp", -10, 1, 1, 0], ["ramp", -10, 2, 2, 0], ["ramp", -10, 3, 3, 0], ["floor", -10, 4, 4, 0], ["trebuchet", -10, 4, 4, 0]]);
await wait(600);
const towerTop = 4 * 3.75 + 0.15;
await sf(b, (y) => { const s = window.snapfort; s.player.teleport(-47.5, y + 0.95, 18.5); s.rig.yaw = 0; }, towerTop);
await wait(500);
await b.keyboard.press("KeyH");
await wait(1800);
const onTop = await sf(b, () => ({ crew: !!window.snapfort.crewOn, feet: window.snapfort.player.feetY }));
check("H on a lone floor up a ramp tower puts the builder on the trebuchet, up there", onTop.crew && Math.abs(onTop.feet - (towerTop + 0.5)) < 0.6, `crew ${onTop.crew}, feet at ${onTop.feet.toFixed(1)} m (floor ${towerTop.toFixed(1)} m)`);
await b.keyboard.press("KeyH");
await wait(300);

// A stands on a raised floor; B knocks out the wall holding it up. A falls to the ground, tab asleep or not.
await put(a, [["wall", 20, 0, 20, 0], ["wall", 20, 1, 20, 0], ["floor", 20, 2, 20, 0]]);
await wait(600);
await sf(a, () => { const s = window.snapfort; s.player.teleport(102.5, 2 * 3.75 + 0.15 + 0.9, 102.5); });
await wait(600);
await sf(a, () => window.snapfort.engine.stopRenderLoop());
await sf(b, () => { const s = window.snapfort; const w = [...s.state.all()].find((p) => p.type === "wall" && p.x === 20 && p.y === 0); s.removePiece(w.id); });
let lowest = 99;
const t1 = Date.now();
while (Date.now() - t1 < 4500) { const y = await sf(b, () => { const r = [...window.snapfort.remotes.remotes.values()][0]; return r?.y ?? 99; }); lowest = Math.min(lowest, y); await wait(80); }
check("a builder whose floor is knocked out falls to the ground (as others see it, tab asleep)", lowest < 1.5, `lowest ${lowest.toFixed(1)} m`);
await sf(a, () => { const s = window.snapfort; s.engine.runRenderLoop(() => s.scene.render()); });
await wait(400);
check("…and is on the ground when their tab wakes up", (await sf(a, () => window.snapfort.player.feetY)) < 0.6, `${(await sf(a, () => window.snapfort.player.feetY)).toFixed(1)} m`);

// A is in mid-air far away while B removes a piece: A must not be knocked down.
await put(b, [["wall", 30, 0, 30, 0]]);
await wait(400);
await sf(a, () => window.snapfort.player.teleport(-150, 6, -150));
await wait(250);
await sf(b, () => { const s = window.snapfort; const w = [...s.state.all()].find((p) => p.type === "wall" && p.x === 30); s.removePiece(w.id); });
await wait(1200);
check("someone mid-jump elsewhere is not knocked down when a piece is removed", !(await sf(a, () => window.snapfort.player.knockedDown)) && !(await sf(b, () => [...window.snapfort.remotes.remotes.values()][0]?.fall)));

// Walking onto a trebuchet needs no jump, and the Remove tool takes it down when aimed at its frame.
await put(a, [["trebuchet", -20, 0, -20, 0]]);
await wait(500);
await sf(a, () => { const s = window.snapfort; s.player.teleport(-97.5, 0.95, -105); s.rig.yaw = 0; s.rig.pitch = 0; });
await a.keyboard.down("KeyW"); await wait(1100); await a.keyboard.up("KeyW"); await wait(200);
check("a builder walks straight onto and over a trebuchet", (await sf(a, () => window.snapfort.player.position.z)) > -95, `reached z ${(await sf(a, () => window.snapfort.player.position.z)).toFixed(1)}`);
await sf(a, () => { const s = window.snapfort; s.player.teleport(-97.5, 0.95, -110); });
await wait(300);
await a.keyboard.press("KeyV");
await sf(a, () => { const s = window.snapfort; const pv = s.rig.pivot; s.rig.yaw = Math.atan2(-97.5 - pv.x, -97.5 - pv.z); s.rig.pitch = -Math.atan2(2.5 - pv.y, Math.hypot(-97.5 - pv.x, -97.5 - pv.z)); });
await wait(300);
await a.mouse.down(); await a.mouse.up(); await wait(400);
check("the Remove tool takes a trebuchet down when aimed at its frame", !(await sf(a, () => [...window.snapfort.state.all()].some((q) => q.type === "trebuchet" && q.x === -20))));

// A world with a great many trebuchets draws every one (once, only the first 256 were drawn).
const crowd = [];
for (let i = 0; i < 300; i++) crowd.push(["trebuchet", 30 + (i % 20), 0, 30 + Math.floor(i / 20), 0]);
const crowded = await put(a, crowd);
await wait(1500);
await frames(a, 3); await frames(b, 3);
const drawn = (p) => sf(p, () => { const s = window.snapfort; const m = s.scene.getMeshByName("trebuchet-frame"); return { all: [...s.state.all()].filter((q) => q.type === "trebuchet").length, drawn: m.isEnabled() ? m.thinInstanceCount : 0, audit: s.audit() }; });
const crowdA = await drawn(a), crowdB = await drawn(b);
check(`${crowded} more trebuchets: every one is drawn on both pages`, crowdA.all > 256 && crowdA.drawn === crowdA.all && crowdB.drawn === crowdB.all && crowdA.audit.length === 0 && crowdB.audit.length === 0, JSON.stringify([crowdA, crowdB]).slice(0, 300));

check("no errors or warnings in the console", errors.length === 0, errors.slice(0, 5).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
