/**
 * Mojave: building with something selected. A general who has clicked their
 * Core (its ring round it) and then tries to build anything else: a piece by
 * its key, its tile or the wheel, a building from the menu. Each way is
 * tried from a fresh selection, and what the page shows after each step is
 * printed (the mode, what is selected, the row, the piece's preview, the
 * building's preview, the line over the row). Needs the Gallop dev server
 * with Stripe test keys in .dev.vars. Run: npm run qa:mojave-select
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `mjsel-${Date.now().toString(36)}`;
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const dev = (page, d) => sf(page, (d) => window.snapfort.net.sendWorld({ m: "dev", ...d }), d);
const until = async (page, fn, arg, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await sf(page, fn, arg); if (v || Date.now() > end) return v; await wait(120); } };
async function aim(page, spot, from) {
  if (from) await sf(page, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), from);
  for (let i = 0; i < 4; i++) {
    await frames(page, 3);
    await sf(page, ([x, y, z]) => { const s = window.snapfort, p = s.rig.pivot; const dx = x - p.x, dy = y - p.y, dz = z - p.z; s.rig.yaw = Math.atan2(dx, dz); s.rig.pitch = Math.atan2(-dy, Math.hypot(dx, dz)); }, spot);
  }
  await frames(page, 4);
}
const click = async (page, button = "left") => { await page.mouse.down({ button }); await frames(page, 2); await page.mouse.up({ button }); await frames(page, 3); };

/** Everything the page shows that matters here. */
const look = (page) => sf(page, () => {
  const s = window.snapfort, f = s.feature;
  const pieceGhost = s.scene.meshes.some((m) => m.isEnabled() && /^ghost-/.test(m.material?.name ?? "") && !/^mojave/.test(m.name));
  const buildingGhost = s.scene.meshes.find((m) => m.isEnabled() && /^mojave-ghost-/.test(m.name))?.name.replace("mojave-ghost-", "") ?? null;
  const slots = [...document.querySelectorAll("#hotbar .slot")].filter((x) => !x.hidden);
  return {
    mode: f.mode ? f.mode.k + (f.mode.kind ? `:${f.mode.kind}` : f.mode.page !== undefined ? `:${f.mode.page}` : f.mode.what ? `:${f.mode.what}` : "") : null,
    selB: f.selectedBuildings.size,
    selU: f.selected.size,
    busy: f.busy(),
    row: slots.map((x) => `${x.querySelector(".key").textContent}:${x.querySelector(".label").firstChild?.textContent ?? ""}${x.classList.contains("selected") ? "*" : ""}`).join(" "),
    pieceGhost,
    buildingGhost,
    panel: document.getElementById("world-panel").textContent.slice(0, 90),
    q: [...f.army.buildings.values()].filter((b) => b.o === f.slot && b.kind === "core").map((b) => b.q.length)[0],
    pieces: s.state.size,
    buildings: [...f.army.buildings.values()].filter((b) => b.o === f.slot).length,
  };
});
const say = (label, v) => console.log(`   ${label.padEnd(34)} mode=${v.mode} sel=${v.selB}b/${v.selU}u busy=${v.busy} pieceGhost=${v.pieceGhost} bldGhost=${v.buildingGhost} q=${v.q} pieces=${v.pieces} bld=${v.buildings}\n   ${"".padEnd(34)} row[${v.row}] panel="${v.panel}"`);

const key = await paidKey(base, "/mojave");
const key2 = await paidKey(base, "/mojave");
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
await context.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.mojave.intro", "seen"); }, key);
const a = await context.newPage();
a.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
a.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await a.goto(`${base}/mojave?world=${world}`);
await a.waitForSelector("body.ready", { timeout: 30000 });
await a.click("#play-free");
await wait(1200);
await until(a, () => window.snapfort.feature.why === "choose" && window.snapfort.feature.generals.length === 8);
await a.keyboard.press("1");
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
await dev(a, { do: "rich" });
// (No Haulers walking into the crosshair: these checks are of the general's own clicks.)
await dev(a, { do: "kill" });
await until(a, () => window.snapfort.feature.bank.l > 10000);
const core = await sf(a, () => { const f = window.snapfort.feature; const b = [...f.army.buildings.values()].find((x) => x.o === f.slot && x.kind === "core"); return { x: (b.x + 1.5) * 5, z: (b.z + 1.5) * 5 }; });
const inX = -Math.sign(core.x), inZ = -Math.sign(core.z);
const stand = [core.x + inX * 16, core.z + inZ * 16];
/** Ground near the Core, clear of it, to build on. */
const ground = [core.x + inX * 24, 0, core.z + inZ * 9];
let site = 0;
/** Somewhere new each time a building goes down. */
const nextSite = () => { site++; return [core.x + inX * (28 + 16 * (site % 3)), 0, core.z + inZ * (30 + 16 * Math.floor(site / 3))]; };

/** From nothing: the Core clicked, so it is selected with its ring. */
async function selectCore(label) {
  await sf(a, () => window.snapfort.feature.run("desel"));
  await aim(a, [core.x, 3, core.z], stand);
  await click(a);
  const v = await look(a);
  console.log(`\n── ${label}`);
  say("Core clicked", v);
  return v;
}

// ── 0. A piece in hand by the Core: a click builds where its preview is green, and selects the Core where it is not ──
console.log("\n── 0: a Wall picked, aimed at the ground by the Core's foot, clicked");
await sf(a, () => window.snapfort.feature.run("desel"));
await aim(a, [core.x + inX * 7.9, 0, core.z], [core.x + inX * 14, core.z]);
await a.keyboard.press("z");
await frames(a, 4);
let v = await look(a);
say("Z (Wall picked)", v);
const hands0 = await sf(a, () => ({ pick: window.snapfort.feature.pick()?.k ?? null }));
const pieces0 = v.pieces;
await click(a);
await wait(500);
v = await look(a);
say("click by the Core", v);
check("0. with a Wall picked, a click on the ground by the Core's foot builds the wall (the Core is not selected)", v.selB === 0 && v.pieces === pieces0 + 1 && v.pieceGhost, `crosshair on ${hands0.pick}; pieces ${pieces0} → ${v.pieces}, selected ${v.selB}`);
// (From another side: the wall just built stands between them and the Core on this one.)
await aim(a, [core.x, 6, core.z], [core.x, core.z + inZ * 16]);
v = await look(a);
say("aimed at the Core itself", v);
await click(a);
v = await look(a);
say("click on the Core", v);
check("0. …and a click on the Core itself selects it, a Wall in hand or not", v.selB === 1 && v.pieces === pieces0 + 1, JSON.stringify(v));
await a.keyboard.press("z");
await frames(a, 4);
v = await look(a);
say("then Z", v);
check("0. …and Z lets go of it and has the Wall back in hand, its preview showing (not put away)", v.selB === 0 && v.pieceGhost && /Z:Wall\*/.test(v.row), v.row);

// ── 1. Core selected, the piece keys ──
for (const [k, name] of [["z", "Wall"], ["F1", "Wall"]]) {
  const before = await selectCore(`1: Core selected, then ${name}'s key (${k})`);
  await aim(a, ground);
  await a.keyboard.press(k);
  await frames(a, 5);
  const v = await look(a);
  say(`after ${k}`, v);
  check(`1. Core selected, ${k}: lets go of the Core and picks the ${name}, its preview showing`, v.pieceGhost && v.selB === 0 && new RegExp(`:${name}\\*`).test(v.row), `ghost ${v.pieceGhost}, sel ${v.selB}, row ${v.row}`);
  if (v.q !== before.q) check(`1. …and ${k} does not touch the Core's queue`, false, `${before.q} → ${v.q}`);
}

// Walls only: F, X and C (the other pieces' keys elsewhere) pick nothing, and the Core stays selected.
for (const k of ["f", "x", "c"]) {
  await selectCore(`1: Core selected, then ${k} (no such piece here)`);
  await a.keyboard.press(k);
  await frames(a, 4);
  const v = await look(a);
  check(`1. Core selected, ${k}: no piece of that kind here, the Core stays selected`, v.selB === 1 && !v.pieceGhost, JSON.stringify(v));
}
await sf(a, () => window.snapfort.feature.run("desel"));
await frames(a, 4);
// (With the Wall in hand, for what follows.)
if (!/Z:Wall\*/.test((await look(a)).row)) await a.keyboard.press("z");
await frames(a, 4);
v = await look(a);
check("1. the row has the Wall and no other piece", /Z:Wall\*/.test(v.row) && !/Floor|Ramp|Canopy/.test(v.row), v.row);

// ── 2. Core selected, the wheel ──
const held2 = await sf(a, () => document.querySelector("#hotbar .slot:not(.menu).selected .label")?.firstChild?.textContent ?? null);
await selectCore("2: Core selected, then the mouse wheel");
await aim(a, ground);
await a.mouse.wheel(0, 120);
await frames(a, 5);
v = await look(a);
say("after wheel", v);
check("2. Core selected, the wheel (a trackpad brushed) does nothing: the Core stays selected", v.selB === 1 && !v.pieceGhost, JSON.stringify(v));
await sf(a, () => window.snapfort.feature.run("desel"));
await frames(a, 4);
v = await look(a);
say("after Deselect", v);
check("2. …and letting go of the Core, the piece in hand is the one from before (the wheel did not change it out of sight)", new RegExp(`:${held2}\\*`).test(v.row), `${held2} then ${v.row}`);

// ── 3. Core selected, a building from the menu (B, N: through Command; or N straight) ──
for (const [path, keys] of [["B, N then F", ["b", "n", "f"]], ["N then F", ["n", "f"]], ["N then T (Tap)", ["n", "t"]], ["N then E (Sentry)", ["n", "e"]]]) {
  await selectCore(`3: Core selected, ${path}`);
  for (const k of keys) {
    await a.keyboard.press(k);
    await frames(a, 3);
    say(`after ${k}`, await look(a));
  }
  const spot = nextSite();
  await aim(a, spot);
  v = await look(a);
  say("aimed at clear ground", v);
  check(`3. Core selected, ${path}: the building's preview shows`, !!v.buildingGhost, JSON.stringify(v));
  const n = v.buildings;
  await click(a);
  await wait(600);
  v = await look(a);
  say("clicked", v);
  if (keys[1] !== "t") check(`3. …and a click puts it down`, v.buildings === n + 1, `${n} → ${v.buildings}`);
  await a.keyboard.press("z");
  await frames(a, 4);
  v = await look(a);
  say("then Z (wanting a Wall)", v);
  check(`3. …then Z picks the Wall, with its preview`, v.pieceGhost && v.selB === 0, JSON.stringify(v));
}

// ── 4. Core selected, a building picked, then a piece key instead ──
await selectCore("4: Core selected, N, F (placing a Foundry), then Z instead");
await a.keyboard.press("n"); await a.keyboard.press("f");
await aim(a, ground);
say("placing", await look(a));
const q4 = (await look(a)).q;
await a.keyboard.press("z");
await frames(a, 4);
v = await look(a);
say("Z", v);
check("4. placing a building, Z gives up on it for the Wall, with its preview", v.pieceGhost && v.mode === null && v.selB === 0, JSON.stringify(v));
check("4. …and does not cancel what the Core is making", v.q === q4, `${q4} → ${v.q}`);

// ── 4b. Core selected, H then Q: Q cancels the last Hauler (Z no longer does) ──
await selectCore("4b: Core selected, H, then Q");
await a.keyboard.press("h");
await until(a, () => { const f = window.snapfort.feature; return [...f.army.buildings.values()].some((b) => b.o === f.slot && b.kind === "core" && b.q.length > 0); });
const q4b = (await look(a)).q;
say("H", await look(a));
check("4b. the Core's row shows Cancel last on Q", /Q:Cancel last/.test((await look(a)).row), (await look(a)).row);
await a.keyboard.press("q");
const q4c = await until(a, (n) => { const f = window.snapfort.feature; const q = [...f.army.buildings.values()].find((b) => b.o === f.slot && b.kind === "core")?.q.length; return q < n ? q + 1 : null; }, q4b);
check("4b. Q cancels the last Hauler ordered", !!q4c, `${q4b} → ${q4c ? q4c - 1 : "unchanged"}`);

// ── 4c. Units selected: order keys are orders; a piece key that is no order builds ──
await sf(a, () => window.snapfort.feature.run("desel"));
await dev(a, { do: "spawn", kind: "trooper", n: 4 });
await until(a, () => [...window.snapfort.feature.army.units.values()].filter((u) => u.kind === "trooper").length >= 4, null, 10000);
await a.keyboard.press("Backquote");
await frames(a, 3);
v = await look(a);
console.log("\n── 4c: units selected");
say("` (whole army)", v);
await a.keyboard.press("f");
await frames(a, 3);
v = await look(a);
say("F", v);
check("4c. with Troopers selected, F is Attack (waits for a click)", v.mode === "target:amove" && v.selU > 0, JSON.stringify(v));
await a.keyboard.press("Backspace");
await a.keyboard.press("c");
await frames(a, 4);
v = await look(a);
say("C (no Haulers: not an order)", v);
check("4c. with only Troopers selected, C (Return cargo, a Hauler's order) does nothing: no Canopy here, the Troopers stay selected", v.selU > 0 && !v.pieceGhost, JSON.stringify(v));
await a.keyboard.press("Backquote");
await a.keyboard.press("z");
await frames(a, 4);
v = await look(a);
say("` then Z", v);
check("4c. with Troopers selected, Z lets go of them and picks the Wall", v.selU === 0 && v.pieceGhost && /Z:Wall\*/.test(v.row), v.row);

// ── 4d. Remove in hand: a click on your own building takes it down, never selects it ──
await sf(a, () => window.snapfort.feature.run("desel"));
const relayAt = nextSite();
await a.keyboard.press("n"); await a.keyboard.press("r");
await aim(a, relayAt, [relayAt[0] - inX * 10, relayAt[2] - inZ * 10]);
await click(a);
const relay = await until(a, () => { const f = window.snapfort.feature; return [...f.army.buildings.values()].find((b) => b.o === f.slot && b.kind === "relay")?.i ?? null; });
await a.keyboard.press("v");
await aim(a, [relayAt[0] + 2.5, 4, relayAt[2] + 2.5]);
v = await look(a);
console.log("\n── 4d: Remove picked, aimed at a Relay mast");
say("V (Remove)", v);
await click(a);
const gone = await until(a, (id) => !window.snapfort.feature.army.buildings.has(id), relay);
v = await look(a);
say("click", v);
check("4d. with Remove in hand, a click on your own Relay mast takes it down (it is not selected)", !!relay && gone === true && v.selB === 0, JSON.stringify(v));
await a.keyboard.press("v");

// ── 5. Core selected, the row's tiles: is there any way to a piece? ──
await selectCore("5: Core selected, the row's tiles");
const tiles = await sf(a, () => [...document.querySelectorAll("#hotbar .slot")].filter((x) => !x.hidden).map((x) => x.querySelector(".label").firstChild?.textContent));
check("5. with the Core selected the row still offers a way back to the pieces (Deselect)", tiles.includes("Deselect"), tiles.join(","));

// ── 6. Core selected, a click on the ground ──
await selectCore("6: Core selected, a click on the ground");
await aim(a, ground);
await click(a);
v = await look(a);
say("click on ground", v);
check("6. a click on empty ground lets go of the Core", v.selB === 0, JSON.stringify(v));
await frames(a, 4);
say("a moment later", await look(a));

// ── 7. Placing a building, a right click ──
await selectCore("7: Core selected, N, F, right click");
await a.keyboard.press("n"); await a.keyboard.press("f");
await aim(a, ground);
await click(a, "right");
v = await look(a);
say("right click", v);

// ── 8. Placing a building, the Command tile (B) again ──
await selectCore("8: Core selected, N, F, then B");
await a.keyboard.press("n"); await a.keyboard.press("f");
await aim(a, ground);
await a.keyboard.press("b");
await frames(a, 3);
v = await look(a);
say("B while placing", v);
check("8. B while placing a building opens Command, as B does everywhere, the Core still selected", v.mode === "menu:cmd" && v.selB === 1, JSON.stringify(v));
await a.keyboard.press("z");
await frames(a, 4);
v = await look(a);
say("then Z", v);
check("8. …and Z from Command picks the Wall, letting go of all of it", v.mode === null && v.selB === 0 && v.pieceGhost && /Z:Wall\*/.test(v.row), JSON.stringify(v));

// ── 9. A building planned over a general: red, and the line says why ──
console.log("\n── 9: a Foundry planned over a general");
await sf(a, () => window.snapfort.feature.run("desel"));
const spot9 = nextSite();
await a.keyboard.press("n"); await a.keyboard.press("f");
await aim(a, spot9, [spot9[0] - inX * 14, spot9[2] - inZ * 14]);
const ghost9 = () => sf(a, () => { const m = window.snapfort.scene.getMeshByName("mojave-ghost-foundry"); return { on: m?.isEnabled() ?? false, red: m?.material.name === "mojave-ghost-bad", line: document.getElementById("world-panel").textContent }; });
let g9 = await ghost9();
check("9. on clear ground, the Foundry's preview is green", g9.on && !g9.red, JSON.stringify(g9));
// A second general of the same army stands right where it would go.
const b = await context.browser().newContext({ viewport: { width: 900, height: 600 } }).then(async (cb) => {
  await cb.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.mojave.intro", "seen"); }, key2);
  return cb.newPage();
});
await b.goto(`${base}/mojave?world=${world}`);
await b.waitForSelector("body.ready", { timeout: 30000 });
await b.click("#play-free");
await until(b, () => window.snapfort.feature.why === "choose" || window.snapfort.feature.slot >= 0, null, 15000);
if (await sf(b, () => window.snapfort.feature.slot !== 0)) await b.keyboard.press("1");
await until(b, () => window.snapfort.feature.slot === 0, null, 15000);
await sf(b, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [spot9[0], spot9[2]]);
g9 = await until(a, () => { const m = window.snapfort.scene.getMeshByName("mojave-ghost-foundry"); return m?.material.name === "mojave-ghost-bad" ? { line: document.getElementById("world-panel").textContent } : null; }, [spot9[0], spot9[2]], 8000);
check("9. with a general standing there, the preview turns red and says so", !!g9 && /A general is standing there/.test(g9.line), JSON.stringify(g9));
const n9 = (await look(a)).buildings;
await click(a);
await wait(800);
check("9. …and a click there builds nothing", (await look(a)).buildings === n9);
await b.context().close();
await frames(a, 6);
g9 = await ghost9();
check("9. once they have gone, it is green again", g9.on && !g9.red, JSON.stringify(g9));
// Over the general themselves.
await aim(a, [spot9[0], 0, spot9[2]], [spot9[0] + 1, spot9[2] + 1]);
g9 = await ghost9();
check("9. planned over the general's own feet, it is red: they are standing there", g9.red && /You are standing there/.test(g9.line), JSON.stringify(g9));
await a.keyboard.press("Backspace"); await a.keyboard.press("Backspace"); await a.keyboard.press("Backspace");

// ── 10. An upgrade being worked on is shown as a picture with a bar, as a unit being made is ──
console.log("\n── 10: an Armory working on weapons");
await sf(a, () => window.snapfort.feature.run("desel"));
const spot10 = nextSite();
await a.keyboard.press("n"); await a.keyboard.press("v"); await a.keyboard.press("m");
await aim(a, spot10, [spot10[0] - inX * 16, spot10[2] - inZ * 16]);
await click(a);
const armory = await until(a, () => { const f = window.snapfort.feature; return [...f.army.buildings.values()].find((b) => b.o === f.slot && b.kind === "armory")?.i ?? null; });
await aim(a, [spot10[0] + 2.5, 3, spot10[2] + 2.5]);
await click(a);
await a.keyboard.press("e");
const work = () => until(a, () => { const q = document.querySelector("#world-panel .mjq"); const bar = q?.querySelector(".q i.now u"); return q && bar && q.querySelector(".q i.now svg path") ? { width: parseFloat(bar.style.width), words: q.querySelector("small").textContent, title: q.querySelector("b").textContent } : null; }, null, 6000);
const w1 = await work();
await wait(2500);
const w2 = await work();
check("10. an Armory working on weapons shows it as a picture with a bar, and the bar fills", !!armory && !!w1 && /Weapons 1 · \d+ s/.test(w1.words) && /Armory/.test(w1.title) && !!w2 && w2.width > w1.width, `${JSON.stringify(w1)} then ${JSON.stringify(w2)}`);
await a.screenshot({ path: "qa/shots/mojave-research.png" });
await a.keyboard.press("q");
await sf(a, () => window.snapfort.feature.run("desel"));

// ── 11. Patrol takes two clicks, one for each end, and they go back and forth between them ──
console.log("\n── 11: Patrol, two ends");
await sf(a, () => window.snapfort.feature.run("desel"));
const endA = [core.x + inX * 12, 0, core.z + inZ * 30], endB = [core.x + inX * 12, 0, core.z + inZ * 55];
const from11 = [core.x, core.z + inZ * 42];
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), from11);
await a.keyboard.press("Backquote");
await a.keyboard.press("p");
await frames(a, 3);
const pat = () => sf(a, () => { const f = window.snapfort.feature; return { mode: f.mode?.k === "target" ? f.mode.what : null, from: !!f.mode?.from, line: document.getElementById("world-panel").textContent }; });
let p11 = await pat();
check("11. P waits for the first end", p11.mode === "patrol" && !p11.from && /click one end/.test(p11.line), JSON.stringify(p11));
await aim(a, endA);
await click(a);
p11 = await pat();
check("11. …after one click Patrol is still in hand, asking for the other end", p11.mode === "patrol" && p11.from && /click the other end/.test(p11.line), JSON.stringify(p11));
await aim(a, endB);
await click(a);
p11 = await pat();
check("11. …and the second click sends it", p11.mode === null, JSON.stringify(p11));
const middle = () => sf(a, () => { const f = window.snapfort.feature; const t = [...f.army.units.values()].filter((u) => u.owner === f.slot && u.kind === "trooper"); return t.length ? [t.reduce((s, u) => s + u.x, 0) / t.length, t.reduce((s, u) => s + u.z, 0) / t.length] : null; });
const near = (end) => until(a, ([x, z]) => { const f = window.snapfort.feature; const t = [...f.army.units.values()].filter((u) => u.owner === f.slot && u.kind === "trooper"); if (!t.length) return false; const mx = t.reduce((s, u) => s + u.x, 0) / t.length, mz = t.reduce((s, u) => s + u.z, 0) / t.length; return Math.hypot(mx - x, mz - z) < 8; }, [end[0], end[2]], 40000);
const atA = await near(endA);
check("11. the Troopers go to the first end", atA === true, JSON.stringify(await middle()));
const atB = await near(endB);
check("11. …then to the other", atB === true, JSON.stringify(await middle()));
const backA = await near(endA);
check("11. …and back again", backA === true, JSON.stringify(await middle()));
await sf(a, () => window.snapfort.feature.run("desel"));

await a.screenshot({ path: "qa/shots/mojave-select.png" });
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
