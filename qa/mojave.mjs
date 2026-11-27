/**
 * Mojave: eight colours, an army only for someone playing, and no computer
 * plays any. A general chooses a colour from tiles on the row (one nobody
 * serves begins a new army), commands all of it with whoever else serves it,
 * and may change sides at any moment; an army nobody serves for a minute is
 * gone, everything of it. They
 * mine, build (the building shown before it is placed, standing at once),
 * make units (the queue shown as pictures, with a bar on the one being
 * made), select and order them with the keys and the mouse, and fight. The
 * land is never dark, but an enemy shows only while in sight, and the map
 * keeps what was last seen. Pieces cost lithium, of one material, and stay
 * with the army they were built for; nobody watches. Needs the Gallop dev
 * server with Stripe test keys in .dev.vars. Run: npm run qa:mojave
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `mojave-${Date.now().toString(36)}`;
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, key, start = true) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}/mojave?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  if (start) { await page.click("#play-free"); await wait(1200); }
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const dev = (page, d) => sf(page, (d) => window.snapfort.net.sendWorld({ m: "dev", ...d }), d);
const until = async (page, fn, arg, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await sf(page, fn, arg); if (v || Date.now() > end) return v; await wait(120); } };
/** What a page knows of the war. */
const war = (page) => sf(page, () => {
  const s = window.snapfort, f = s.feature;
  const units = [...f.army.units.values()].map((u) => ({ id: u.id, kind: u.kind, owner: u.owner, x: u.x, y: u.y, z: u.z, hp: u.hp, flags: u.flags }));
  const buildings = [...f.army.buildings.values()].map((b) => ({ id: b.i, kind: b.kind, owner: b.o, x: b.x, z: b.z, printing: b.d > 0, q: b.q.length }));
  return { slot: f.slot, l: f.bank.l, p: f.bank.p, used: f.bank.used, max: f.bank.max, units, buildings, sel: [...f.selected], selB: [...f.selectedBuildings], mode: f.mode?.k ?? null, gens: f.generals, pos: [s.player.position.x, s.player.position.y, s.player.position.z], pieces: s.state.size };
});
/** Stands the builder somewhere and turns the crosshair onto a spot (the view is over the shoulder, so it takes a few frames to settle). */
async function aim(page, spot, from) {
  if (from) await sf(page, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), from);
  for (let i = 0; i < 4; i++) {
    await frames(page, 3);
    await sf(page, ([x, y, z]) => { const s = window.snapfort, p = s.rig.pivot; const dx = x - p.x, dy = y - p.y, dz = z - p.z; s.rig.yaw = Math.atan2(dx, dz); s.rig.pitch = Math.atan2(-dy, Math.hypot(dx, dz)); }, spot);
  }
  await frames(page, 3);
}
const click = async (page, button = "left") => { await page.mouse.down({ button }); await frames(page, 2); await page.mouse.up({ button }); await frames(page, 2); };
const centreOf = (b, size) => [(b.x + size / 2) * 5, (b.z + size / 2) * 5];

/** The tiles on the row now: the pieces, or a menu of Mojave's own. */
const row = (page) => sf(page, () => [...document.querySelectorAll("#hotbar .slot")].filter((x) => !x.hidden).map((x) => ({ label: x.querySelector(".label").firstChild?.textContent ?? "", key: x.querySelector(".key").textContent, sub: x.querySelector("small")?.textContent ?? "", off: x.classList.contains("off"), on: x.classList.contains("selected"), menu: x.classList.contains("menu") })));
const rowHas = (page, labels) => until(page, (labels) => { const have = [...document.querySelectorAll("#hotbar .slot")].filter((x) => !x.hidden).map((x) => x.querySelector(".label").firstChild?.textContent ?? ""); return labels.every((l) => have.includes(l)) ? true : null; }, labels, 3000);
/** Lets go of everything: nothing selected, no menu open (Backspace itself goes back one step at a time). */
const clear = (page) => sf(page, () => window.snapfort.feature.run("desel"));
const keysOf = (tiles) => Object.fromEntries(tiles.map((t) => [t.label, t.key]));

const [keyA, keyB] = [await paidKey(base, "/mojave"), await paidKey(base, "/mojave")];
check("(two Full Game keys, for two generals)", /^SNAP-/.test(keyA ?? "") && /^SNAP-/.test(keyB ?? ""));

// ── A general arrives, and chooses an army ───────────────────────────────
const a = await open("A", keyA);
await until(a, () => window.snapfort.feature.why === "choose" && window.snapfort.feature.generals.length === 8);
await rowHas(a, ["Red", "Blue", "Pink"]);
let tiles = await row(a);
check("arriving, the row offers the eight armies to serve, each with its number; nothing of the war is known yet", tiles.length === 8 && tiles.map((t) => t.key).join("") === "12345678" && tiles.every((t) => t.sub === "nobody") && await sf(a, () => window.snapfort.feature.slot === -1 && window.snapfort.feature.army.units.size === 0), tiles.map((t) => `${t.key}:${t.label} (${t.sub})`).join(" "));
check("each tile is in its army's colour", await sf(a, () => { const fills = [...document.querySelectorAll("#hotbar .slot svg path[style]")].map((p) => p.style.fill); return fills.length === 8 && new Set(fills).size === 8; }));
await a.screenshot({ path: "qa/shots/mojave-choose.png" });
await a.keyboard.press("1");
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
let wa = await war(a);
check("pressing its number, they serve that army at once, and command it as it stands: its Core and Haulers", wa.slot === 0 && wa.buildings.some((b) => b.kind === "core" && b.owner === 0) && wa.units.filter((u) => u.kind === "hauler" && u.owner === 0).length >= 4 && Math.hypot(wa.pos[0], wa.pos[2]) > 300, `slot ${wa.slot}, ${wa.buildings.length} buildings, ${wa.units.length} units, at ${wa.pos.map(Math.round)}`);
check("there are eight armies, and this general is the only one serving any", (await until(a, () => { const g = window.snapfort.feature.generals; return g.length === 8 && g.reduce((n, x) => n + x.pids.length, 0) === 1 && g[0].pids.length === 1; })) === true);
check("they are told whose all this is: the army's colour, by name", await sf(a, () => /You serve the red army/.test(document.getElementById("mj-notes").textContent)), await sf(a, () => document.getElementById("mj-notes").textContent.slice(0, 90)));
check("messages wrap: none is wider than is easy to read", await sf(a, () => [...document.querySelectorAll("#mj-notes div")].every((d) => d.getBoundingClientRect().width <= 341) && parseFloat(getComputedStyle(document.querySelector("#mj-notes div")).maxWidth) === 340));
const mine = await until(a, () => { const s = window.snapfort, f = s.feature; const g = f.generals.find((x) => x.slot === f.slot); const sw = document.querySelector("#material .sw"); if (!g || !sw) return null; const jacket = s.player.avatar.jacket.diffuseColor.toHexString().toLowerCase(); const css = getComputedStyle(sw).backgroundColor.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, "0")).join(""); return jacket === g.color.toLowerCase() ? { army: g.color, jacket, swatch: `#${css}` } : null; });
check("the general wears their army's colour while they serve it, and it is shown beside the bank", !!mine && mine.swatch === mine.army.toLowerCase(), JSON.stringify(mine));
check("they arrive facing their Core: the crosshair is on it", await sf(a, () => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "core"; }));
// (For the checks: this army as a war begins it.)
/** Begins a page's place afresh, and waits until the page has the new base (a new Core, four Haulers). */
const fresh = async (page) => {
  const old = await sf(page, () => [...window.snapfort.feature.army.buildings.keys()]);
  await dev(page, { do: "fresh" });
  await until(page, (old) => { const f = window.snapfort.feature; const mine = [...f.army.buildings.values()].filter((b) => b.o === f.slot); return mine.length === 1 && !old.includes(mine[0].i) && [...f.army.units.values()].filter((u) => u.owner === f.slot).length === 4; }, old);
};
await fresh(a);
wa = await war(a);
const core = wa.buildings[0];
const [coreX, coreZ] = centreOf(core, 3);
check("they stand by their Core, at one of the eight starts", Math.hypot(wa.pos[0] - coreX, wa.pos[2] - coreZ) < 40 && Math.hypot(coreX, coreZ) > 300, wa.pos.map(Math.round).join(","));
check("nothing is picked to build with at first (pieces cost lithium here)", await sf(a, () => !document.querySelector("#hotbar .selected")));
tiles = await row(a);
check("the row: the Wall, the Floor and the Ramp (no canopy), Remove, and Command where the siege engine is elsewhere", tiles.map((t) => t.label).join(",") === "Wall,Floor,Ramp,Remove,Command" && keysOf(tiles).Command === "C", tiles.map((t) => `${t.key}:${t.label}`).join(" "));
check("the bank is beside the row, where the material is elsewhere; there is no material to choose", await sf(a, () => { const m = document.getElementById("material"); const r = m.getBoundingClientRect(), h = document.getElementById("hotbar").getBoundingClientRect(); return /Lithium/.test(m.textContent) && /Supply/.test(m.textContent) && !m.querySelector(".swatch") && r.left >= h.right && r.width > 0 && Math.abs(r.bottom - h.bottom) < 30; }));
check("there is no command card, and the map is on screen", await sf(a, () => !document.getElementById("mj-card") && document.getElementById("mj-map").getBoundingClientRect().width > 100));
const before = wa.l;
await until(a, (l) => window.snapfort.feature.bank.l > l, before, 25000);
wa = await war(a);
check("the Haulers mine by themselves: lithium comes in", wa.l > before, `${before} → ${wa.l}`);
check("a Hauler is drawn carrying or digging", wa.units.some((u) => u.flags & 96));
check("a Hauler bringing a load back shows it: crystals in its bed", await until(a, () => { const f = window.snapfort.feature; const loaded = [...f.army.units.values()].filter((u) => u.kind === "hauler" && (u.flags & 32)).length; const drawn = window.snapfort.scene.getMeshByName("mojave-load").thinInstanceCount; return loaded > 0 && drawn === loaded ? true : null; }, null, 20000) === true);
await a.screenshot({ path: "qa/shots/mojave-load-bed.png" });
// Their wheels are wheels: drawn on their own, two steering at the front and four behind, rolling with the ground covered.
const wheels = await sf(a, () => new Promise((res) => { const s = window.snapfort, f = s.feature; const n = (name) => s.scene.getMeshByName(name)?.thinInstanceCount ?? 0; const h = [...f.army.units.values()].filter((u) => u.kind === "hauler"); const u = h.find((x) => x.speed > 3); if (!u) return res({ haulers: h.length }); let rolled = 0, went = 0, d = u.dist, x = u.x, z = u.z; const end = performance.now() + 600; const step = () => { rolled += Math.abs(u.dist - d); went += Math.hypot(u.x - x, u.z - z); d = u.dist; x = u.x; z = u.z; if (performance.now() < end) requestAnimationFrame(step); else res({ haulers: h.length, front: n("mojave-hauler-part-0"), back: n("mojave-hauler-part-1"), rolled, went }); }; requestAnimationFrame(step); }));
check("Haulers' wheels are wheels: six each, on their own, rolling with the ground they cover", wheels.front === wheels.haulers * 2 && wheels.back === wheels.haulers * 4 && wheels.went > 1 && Math.abs(wheels.rolled - wheels.went) < wheels.went * 0.1, JSON.stringify(wheels));
// Haulers work by themselves: one of the army's own is never picked or selected (one digging stands still to be aimed at).
const digger = await until(a, () => { const f = window.snapfort.feature; const u = [...f.army.units.values()].find((u) => u.kind === "hauler" && u.owner === f.slot && (u.flags & 64)); return u ? [u.x, u.y, u.z, u.id] : null; }, null, 20000);
await aim(a, [digger[0], digger[1] + 0.9, digger[2]], [digger[0] - 6, digger[2] - 6]);
const onIt = await sf(a, () => { const p = window.snapfort.feature.pick(); return p ? p.k + (p.u ? `:${p.u.kind}` : "") : null; });
await click(a);
wa = await war(a);
check("a click on one of its own Haulers selects nothing: Haulers are not selected, ordered, or ever idle", onIt !== "unit:hauler" && wa.sel.length === 0 && wa.selB.length === 0, `picked ${onIt}, ${wa.sel.length} selected`);
await a.screenshot({ path: "qa/shots/mojave-base.png" });

// ── No dark ──────────────────────────────────────────────────────────────
const land = await sf(a, ([x, z]) => { const s = window.snapfort, t = s.feature.sight; return { home: t.sees(x, z), far: t.sees(0, 0), dark: s.scene.meshes.filter((m) => /dark/.test(m.name)).length, fields: s.feature.army.fields.size }; }, [coreX, coreZ]);
check("nothing is dark: no black on the ground or standing on it, and every field of the map is known", land.dark === 0 && land.fields > 20, JSON.stringify(land));
check("the base is in sight, the middle of the map is not", land.home && !land.far);

// ── Selecting, and making a unit ─────────────────────────────────────────
await aim(a, [coreX, 3, coreZ]);
await click(a);
wa = await war(a);
check("a click on the Core selects it", wa.selB.length === 1 && wa.selB[0] === core.id);
await rowHas(a, ["Hauler"]);
tiles = await row(a);
check("the row shows what it makes, with its key and its price, in the same boxes (a Core has no rally point: its Haulers go to work)", tiles.every((t) => t.menu) && keysOf(tiles).Hauler === "H" && tiles.find((t) => t.label === "Hauler").sub === "50" && !keysOf(tiles)["Rally point"], tiles.map((t) => `${t.key}:${t.label}`).join(" "));
check("what is selected is said over the row", await sf(a, () => /Command Core/.test(document.getElementById("world-panel").textContent)));
await until(a, () => window.snapfort.feature.bank.l >= 50, null, 20000);
await a.keyboard.press("h");
wa = await until(a, (id) => { const f = window.snapfort.feature; return f.army.buildings.get(id).q.length === 1 && document.querySelectorAll("#world-panel .mjq .q i").length === 1 && /Hauler · \d+ s/.test(document.getElementById("world-panel").textContent) ? true : null; }, core.id);
check("H orders a Hauler: it is in the Core's queue, and the row says so", wa === true);
await clear(a);
check("letting go of the selection, the pieces are back on the row", (await war(a)).selB.length === 0 && (await rowHas(a, ["Wall", "Command"])) === true);

// ── Command, and building ────────────────────────────────────────────────
await dev(a, { do: "rich" });
await until(a, () => window.snapfort.feature.bank.l > 10000);
const inX = -Math.sign(coreX), inZ = -Math.sign(coreZ);
const site = [coreX + inX * 32, coreZ + inZ * 32];
await a.keyboard.press("c");
await rowHas(a, ["Select"]);
tiles = await row(a);
check("C (the Command tile) opens the general's own menu on the row", tiles.map((t) => t.label).join(",") === "Build,Select,Map,Change army,Back" && keysOf(tiles).Build === "B" && keysOf(tiles).Map === "Tab", tiles.map((t) => `${t.key}:${t.label}`).join(" "));
await a.keyboard.press("b");
await rowHas(a, ["Foundry"]);
tiles = await row(a);
check("N opens the buildings, each with its key and price; one that cannot be built yet is faded, and says what it needs", (await war(a)).mode === "menu" && keysOf(tiles).Foundry === "F" && tiles.find((t) => t.label === "Foundry").sub === "150" && keysOf(tiles).Advanced === "V" && tiles.find((t) => t.label === "Sentry turret").sub === "needs Foundry" && tiles.find((t) => t.label === "Sentry turret").off && !tiles.find((t) => t.label === "Foundry").off, tiles.map((t) => `${t.key}:${t.label}`).join(" "));
await a.keyboard.press("f");
check("F picks the Foundry to place", (await war(a)).mode === "place");
// Backspace goes back one step at a time: to the buildings, to the general's own menu, to the pieces.
await a.keyboard.press("Backspace");
const step1 = (await war(a)).mode === "menu" && (await rowHas(a, ["Foundry", "Advanced"])) === true;
await a.keyboard.press("Backspace");
const step2 = (await rowHas(a, ["Select", "Build"])) === true;
await a.keyboard.press("Backspace");
const step3 = (await war(a)).mode === null && (await rowHas(a, ["Wall", "Command"])) === true;
check("Backspace goes back one step: from placing to the buildings, to the general's own menu, to the pieces", step1 && step2 && step3, `${step1} ${step2} ${step3}`);
await a.keyboard.press("b");
await a.keyboard.press("f");
await frames(a, 3);
await aim(a, [site[0], 0, site[1]], [coreX + inX * 18, coreZ + inZ * 18]);
await frames(a, 4);
const ghost = await sf(a, () => { const m = window.snapfort.scene.getMeshByName("mojave-ghost-foundry"); return m ? { on: m.isEnabled(), x: m.position.x, z: m.position.z, verts: m.getTotalVertices(), green: m.material.name === "mojave-ghost-ok", alpha: m.material.alpha } : null; });
check("the Foundry itself shows where it would go, see-through and green", !!ghost && ghost.on && ghost.green && ghost.alpha < 1 && ghost.verts > 100 && Math.hypot(ghost.x - site[0], ghost.z - site[1]) < 8, JSON.stringify(ghost));
await a.screenshot({ path: "qa/shots/mojave-place.png" });
// Onto the Core: red.
await aim(a, [coreX, 0, coreZ + inZ * 6]);
await frames(a, 4);
check("where it may not go it shows red, and the row says why", await sf(a, () => window.snapfort.scene.getMeshByName("mojave-ghost-foundry").material.name === "mojave-ghost-bad" && /in the way|built there/.test(document.getElementById("world-panel").textContent)));
await aim(a, [site[0], 0, site[1]]);
await click(a);
const foundry = await until(a, () => [...window.snapfort.feature.army.buildings.values()].find((b) => b.kind === "foundry")?.i ?? null);
wa = await war(a);
check("a click puts it down, and it stands there finished at once; the preview goes", !!foundry && !wa.buildings.find((b) => b.id === foundry).printing && wa.mode === null && await sf(a, () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(!window.snapfort.scene.getMeshByName("mojave-ghost-foundry").isEnabled()))))));
check("a building is solid: the crosshair lands on it", await sf(a, () => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "foundry"; }));
await a.keyboard.press("b");
await a.keyboard.press("v");
await rowHas(a, ["Armory", "Basic"]);
tiles = await row(a);
check("V turns to the advanced buildings; with the Foundry standing, the Armory can be built straight away", !tiles.find((t) => t.label === "Armory").off && tiles.find((t) => t.label === "Titan bay").off, tiles.map((t) => `${t.label}${t.off ? " (off)" : ""}`).join(", "));
await clear(a);
await aim(a, [site[0] + inX * 5, 3, site[1] + inZ * 5]);
await click(a);
await rowHas(a, ["Trooper"]);
await a.keyboard.press("t");
await a.keyboard.down("Shift"); await a.keyboard.press("t"); await a.keyboard.up("Shift");
wa = await until(a, (id) => (window.snapfort.feature.army.buildings.get(id)?.q.length ?? 0) >= 2 ? true : null, foundry);
// What it is making is shown as pictures over the row, the first with a bar that fills.
const queue1 = await until(a, () => { const q = [...document.querySelectorAll("#world-panel .mjq .q i")]; const bar = document.querySelector("#world-panel .mjq .q i.now u"); return q.length >= 2 && bar && q.every((i) => i.querySelector("svg path")) ? { n: q.length, width: parseFloat(bar.style.width), words: document.querySelector("#world-panel .mjq small").textContent } : null; });
await wait(2500);
const queue2 = await sf(a, () => parseFloat(document.querySelector("#world-panel .mjq .q i.now u")?.style.width ?? "0"));
check("the queue is shown as pictures over the row, one for each unit, with a bar on the first that fills as it is made", !!queue1 && queue1.n === (await sf(a, (id) => window.snapfort.feature.army.buildings.get(id).q.length, foundry)) && queue2 > queue1.width + 5 && /Trooper · \d+ s/.test(queue1.words), `${JSON.stringify(queue1)} then ${queue2}%`);
await a.screenshot({ path: "qa/shots/mojave-queue.png" });
check("T at the Foundry orders a Trooper; Shift orders several", wa === true, `queue ${(await war(a)).buildings.find((b) => b.id === foundry).q}`);
await clear(a);

// Supply full: the tiles for making units are faded, and the row says why and what to do about it.
await aim(a, [site[0] + inX * 5, 3, site[1] + inZ * 5]);
await click(a);
await rowHas(a, ["Trooper"]);
await dev(a, { do: "spawn", kind: "titan", n: 2 });
await until(a, () => { const f = window.snapfort.feature; return f.bank.used >= f.bank.max; });
const fullRow = await until(a, () => { const t = [...document.querySelectorAll("#hotbar .slot")].find((x) => /Tank/.test(x.textContent)); return t && t.classList.contains("off") && /no supply/.test(t.textContent) && /Supply is full \(\d+ \/ \d+\): build a Relay mast/.test(document.getElementById("world-panel").textContent) ? true : null; });
check("with supply full the units' tiles are faded, and the row says why and what to build", fullRow === true, await sf(a, () => document.getElementById("world-panel").textContent));
const qFull = await sf(a, (id) => window.snapfort.feature.army.buildings.get(id).q.length, foundry);
await a.keyboard.press("k");
await wait(700);
check("and nothing more can be queued until there is room", (await sf(a, (id) => window.snapfort.feature.army.buildings.get(id).q.length, foundry)) === qFull);
await sf(a, () => { const f = window.snapfort.feature; for (const b of f.selectedBuildings) for (let i = 0; i < 8; i++) window.snapfort.net.sendWorld({ m: "cancel", id: b }); });
await dev(a, { do: "kill" });
await clear(a);
await wait(800);

// ── An army: selecting and orders ────────────────────────────────────────
// Open ground for a parade, a march and a fight: three spots in a row, each well clear of every field and building,
// and far enough from the middle of the map that its sentries (who shoot 28 m) take no interest.
const { field, dest, enemyAt, back } = await sf(a, ([cx, cz]) => {
  const f = window.snapfort.feature;
  const taken = [...f.army.fields.values()].map((x) => [(x.cx + 0.5) * 5, (x.cz + 0.5) * 5]).concat([...f.army.buildings.values()].map((b) => [b.x * 5, b.z * 5]));
  const clear = (x, z, r) => Math.abs(x) < 440 && Math.abs(z) < 440 && Math.hypot(x, z) > 255 && taken.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > r);
  const toMid = Math.atan2(-cx, -cz);
  for (const far of [95, 110, 80, 125]) {
    for (const turn of [0.75, -0.75, 0.5, -0.5, 1, -1, 0.25, -0.25]) {
      const x = cx + Math.sin(toMid + turn) * far, z = cz + Math.cos(toMid + turn) * far;
      // The march goes sideways, round the middle of the map, not into it (the middle is guarded).
      for (const side of [1, -1]) {
        const tx = Math.cos(toMid) * side, tz = -Math.sin(toMid) * side;
        const spots = [[x, z], [x + tx * 36, z + tz * 36], [x + tx * 82, z + tz * 82]];
        if (spots.every(([sx, sz]) => clear(sx, sz, 48))) return { field: spots[0], dest: spots[1], enemyAt: spots[2], back: [-tx, -tz] };
      }
    }
  }
  return null;
}, [coreX, coreZ]);
await dev(a, { do: "spawn", kind: "trooper", n: 12, at: [field[0], 0, field[1]] });
await dev(a, { do: "spawn", kind: "tank", n: 4, at: [field[0] - back[1] * 16, 0, field[1] + back[0] * 16] });
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [field[0] + back[0] * 34, field[1] + back[1] * 34]);
await until(a, () => [...window.snapfort.feature.army.units.values()].filter((u) => u.kind === "trooper").length >= 12);
wa = await war(a);
const trooper = wa.units.filter((u) => u.kind === "trooper").sort((p, q) => Math.hypot(p.x - wa.pos[0], p.z - wa.pos[2]) - Math.hypot(q.x - wa.pos[0], q.z - wa.pos[2]))[0];
await aim(a, [trooper.x, 1, trooper.z]);
await click(a);
wa = await war(a);
check("a click on a unit selects it", wa.sel.length === 1 && wa.units.find((u) => u.id === wa.sel[0])?.kind === "trooper", `selected ${wa.sel.length}`);
await click(a);
wa = await war(a);
check("a second click selects all of its kind nearby", wa.sel.length >= 12, `selected ${wa.sel.length}`);
await a.keyboard.down("Control"); await a.keyboard.press("1"); await a.keyboard.up("Control");
await clear(a);
check("(nothing selected)", (await war(a)).sel.length === 0);
await a.keyboard.press("1");
check("Ctrl + 1 saves the group and 1 brings it back", (await war(a)).sel.length >= 12);
await a.keyboard.press("Backquote");
await rowHas(a, ["Whole army"]);
tiles = await row(a);
check("` opens the select menu: the whole army on ` again, and a tile for each kind of unit, with its key and how many", (await war(a)).mode === "menu" && keysOf(tiles)["Whole army"] === "`" && keysOf(tiles).Troopers === "T" && keysOf(tiles).Tanks === "K", tiles.map((t) => `${t.key}:${t.label} ${t.sub ?? ""}`).join(" "));
await a.keyboard.press("t");
wa = await war(a);
check("…and T there selects every Trooper, wherever it is", wa.sel.length >= 12 && wa.sel.length === wa.units.filter((u) => u.owner === wa.slot && u.kind === "trooper").length && wa.sel.every((id) => wa.units.find((u) => u.id === id).kind === "trooper"), `selected ${wa.sel.length}`);
await a.keyboard.press("Backquote");
await a.keyboard.press("Backquote");
wa = await war(a);
check("` twice selects the whole army, wherever it is (not the Haulers)", wa.sel.length >= 16 && wa.sel.length === wa.units.filter((u) => u.owner === wa.slot && u.kind !== "hauler").length && wa.sel.every((id) => wa.units.find((u) => u.id === id).kind !== "hauler"), `selected ${wa.sel.length}`);
await rowHas(a, ["Attack"]);
tiles = await row(a);
check("the bank is still wholly on the screen beside the longer row", await sf(a, () => { const r = document.getElementById("material").getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth - 4 && r.left >= document.getElementById("hotbar").getBoundingClientRect().right; }), await sf(a, () => { const r = document.getElementById("material").getBoundingClientRect(); return `${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}`; }));
check("the row lists the orders with StarCraft's keys, attack on F and stop on X", (() => { const k = keysOf(tiles); return k.Move === "M" && k.Attack === "F" && k.Stop === "X" && k.Hold === "H" && k.Patrol === "P" && k.Build === "B" && tiles.every((t) => t.menu); })(), tiles.map((t) => `${t.key}:${t.label}`).join(" "));
// C is the general's own menu and B the buildings, with units selected as without; Backspace goes up one level
// however the row was reached (placing an advanced building → advanced → basic → Command → the selection).
await a.keyboard.press("c");
const bCmd = (await rowHas(a, ["Select", "Change army"])) === true && (await war(a)).sel.length >= 16;
await a.keyboard.press("c");
await a.keyboard.press("b"); await a.keyboard.press("v"); await a.keyboard.press("k");
const placing = (await war(a)).mode === "place";
await a.keyboard.press("c");
const bFromPlace = (await rowHas(a, ["Select", "Change army"])) === true;
await a.keyboard.press("b"); await a.keyboard.press("v"); await a.keyboard.press("k");
const ups = [];
for (const want of [["Skyport", "Basic"], ["Foundry", "Advanced"], ["Select", "Change army"], ["Move", "Deselect"]]) {
  await a.keyboard.press("Backspace");
  ups.push((await rowHas(a, want)) === true);
}
check("C opens Command (C again closes it) and B the buildings with units selected too; C while placing a building is Command again; Backspace goes up a level each time", bCmd && placing && bFromPlace && ups.every(Boolean) && (await war(a)).sel.length >= 16, `${bCmd} ${placing} ${bFromPlace} ${ups}`);
check("with units selected the keys are orders; Z, which is none, lets go of them and picks a Wall", await (async () => { await a.keyboard.press("z"); return (await until(a, () => window.snapfort.feature.selected.size === 0 && /Wall/.test(document.querySelector("#hotbar .slot:not(.menu).selected")?.textContent ?? ""), null, 2000)) === true; })());
// (The army again, with nothing in hand, for what follows.)
await a.keyboard.press("z");
await a.keyboard.press("Backquote");
await a.keyboard.press("Backquote");
await until(a, () => window.snapfort.feature.selected.size >= 16);
// Troopers are people: drawn in poses, standing now.
const drawn = (page) => sf(page, () => { const count = (re) => window.snapfort.scene.meshes.filter((m) => re.test(m.name) && m.isEnabled()).reduce((n, m) => n + (m.thinInstanceCount || 0), 0); return { stand: count(/^mojave-trooper-stand$/), run: count(/^mojave-trooper-run-\d+$/), aim: count(/^mojave-trooper-aim$/), flail: count(/^mojave-trooper-flail-\d+$/), down: count(/^mojave-trooper-down$/), flinch: count(/^mojave-trooper-flinch$/) }; });
let poses = await drawn(a);
check("Troopers standing are drawn standing, each a person", poses.stand >= 12 && poses.run === 0, JSON.stringify(poses));
// Right click on the ground: they go there.
await aim(a, [dest[0], 0, dest[1]]);
await click(a, "right");
await wait(1500);
poses = await drawn(a);
// Their feet keep to the ground: a stride cycle for every 4.3 m or so a Trooper is drawn covering, at a Trooper's own speed.
const gait = await sf(a, () => new Promise((res) => { const f = window.snapfort.feature; const t = [...f.army.units.values()].filter((u) => u.kind === "trooper" && u.speed > 4); const s0 = new Map(t.map((u) => [u.id, [u.stride, u.x, u.z]])); setTimeout(() => { let cycles = 0, metres = 0, speed = 0, n = 0; for (const u of t) { const b = s0.get(u.id); if (!b || u.speed < 4) continue; cycles += u.stride - b[0]; metres += Math.hypot(u.x - b[1], u.z - b[2]); speed += u.speed; n++; } res({ n, perCycle: cycles > 0 ? metres / cycles : 0, speed: n ? speed / n : 0 }); }, 800); }));
check("their feet keep to the ground they cover: a stride cycle every 4 m or so, at their own speed (7 m/s), not on a clock", gait.n >= 3 && gait.perCycle > 3.6 && gait.perCycle < 5 && gait.speed > 5 && gait.speed < 9, JSON.stringify(gait));
check("on the move they run, arms and legs swinging: spread over the frames of a stride", poses.run >= 10 && poses.stand <= 2 && await sf(a, () => window.snapfort.scene.meshes.filter((m) => /^mojave-trooper-run-\d+$/.test(m.name) && m.isEnabled() && m.thinInstanceCount > 0).length >= 3), JSON.stringify(poses));
await a.screenshot({ path: "qa/shots/mojave-run.png" });
await wait(7500);
wa = await war(a);
const centre = (list) => [list.reduce((s, u) => s + u.x, 0) / list.length, list.reduce((s, u) => s + u.z, 0) / list.length];
const armyNow = wa.units.filter((u) => wa.sel.includes(u.id));
const c = centre(armyNow);
check("a right click on the ground sends them there", Math.hypot(c[0] - dest[0], c[1] - dest[1]) < 14, `${Math.round(Math.hypot(c[0] - dest[0], c[1] - dest[1]))} m off`);
check("they stand apart, not in each other", armyNow.every((u) => armyNow.every((o) => o === u || Math.hypot(u.x - o.x, u.z - o.z) > 0.6)));
check("the walk keys still walk the general with units selected", await (async () => { const p0 = (await war(a)).pos; await a.keyboard.down("w"); await wait(500); await a.keyboard.up("w"); const p1 = (await war(a)).pos; return Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 2; })());
await a.screenshot({ path: "qa/shots/mojave-army.png" });

// ── Fighting ─────────────────────────────────────────────────────────────
await dev(a, { do: "spawn", kind: "trooper", n: 8, slot: 8, at: [enemyAt[0], 0, enemyAt[1]] });
await dev(a, { do: "spawn", kind: "scout", n: 4, slot: 8, at: [enemyAt[0] - back[0] * 7, 0, enemyAt[1] - back[1] * 7] });
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [dest[0] + back[0] * 22, dest[1] + back[1] * 22]);
await until(a, () => [...window.snapfort.feature.army.units.values()].filter((u) => u.owner === 8).length >= 10);
// F, then a click on the ground beyond them: attack-move.
await a.keyboard.press("f");
check("F waits for a click (attack), and the row shows it", (await war(a)).mode === "target" && (await rowHas(a, ["Attack", "Cancel"])) === true);
await a.keyboard.press("Backspace");
const kept = (await war(a)).mode === null && (await war(a)).sel.length >= 16 && (await rowHas(a, ["Move", "Deselect"])) === true;
await a.keyboard.press("f");
check("Backspace from there goes back to the orders, with the army still selected", kept && (await war(a)).mode === "target");
await aim(a, [enemyAt[0] - back[0] * 10, 0, enemyAt[1] - back[1] * 10]);
// Watch what is drawn while they fight: who is thrown, and how Troopers are posed.
await sf(a, () => {
  window.seen = { thrownTroopers: 0, thrownOthers: 0, flail: 0, down: 0, aim: 0, flinch: 0, bulletThrows: 0, maxPuffs: 0, maxChunks: 0, tankAim: 0, tracers: 0, muzzleOk: 0 };
  // Every shot drawn: does it leave the shooter's muzzle (not its middle)?
  const army = window.snapfort.feature.army;
  const shots = army.shots.bind(army);
  army.shots = (list, now) => {
    const before = army.tracers.length;
    shots(list, now);
    for (let i = 0; i + 10 <= list.length; i += 10) {
      const by = (list[i + 6] >> 3) - 1, u = army.units.get(by);
      if (!u || u.tumble || (list[i + 6] & 7) !== 0) continue;
      const t = army.tracers[army.tracers.length - 1];
      if (!t || army.tracers.length === before) continue;
      window.seen.tracers++;
      const middle = Math.hypot(t.fx - u.x, t.fz - u.z) > 0.6 || t.fy - u.y > 1.0;
      if (middle) window.seen.muzzleOk++;
    }
  };
  const count = (re) => window.snapfort.scene.meshes.filter((m) => re.test(m.name) && m.isEnabled()).reduce((n, m) => n + (m.thinInstanceCount || 0), 0);
  window.watch = setInterval(() => {
    for (const u of window.snapfort.feature.army.units.values()) if (u.tumble) u.kind === "trooper" ? window.seen.thrownTroopers++ : window.seen.thrownOthers++;
    window.seen.flail += count(/^mojave-trooper-flail-\d+$/);
    window.seen.down += count(/^mojave-trooper-down$/);
    window.seen.aim += count(/^mojave-trooper-aim$/);
    window.seen.flinch += count(/^mojave-trooper-flinch$/);
    const f = window.snapfort.feature;
    window.seen.maxPuffs = Math.max(window.seen.maxPuffs, f.army.puffs.length);
    window.seen.maxChunks = Math.max(window.seen.maxChunks, f.army.chunks.length);
    for (const u of f.army.units.values()) if (u.kind === "tank" && !u.tumble && Math.abs(Math.atan2(Math.sin(u.a - u.h), Math.cos(u.a - u.h))) > 0.35) window.seen.tankAim++;
  }, 50);
});
await click(a);
// While they fight: nobody runs on the spot. A Trooper drawn running is one that is covering ground.
let ranInPlace = 0, firingStill = 0, before1 = [];
for (let i = 0; i < 22; i++) {
  await wait(1000);
  const seen = await sf(a, () => { const f = window.snapfort.feature, now = performance.now(); const still = []; let firing = 0; for (const u of f.army.units.values()) { if (u.kind !== "trooper" || u.tumble) continue; const told = (u.flags & 1) !== 0, covering = Math.hypot(u.tx - u.fx, u.tz - u.fz) > 0.3 && now - u.at < 450; if (told && !covering && (u.flags & 2)) { firing++; if (u.going && now - u.at < 450) still.push(u.id); } } return { still, firing }; });
  // (One sighting is the last stride of a Trooper coming to a stand; the same one a second later would be running on the spot.)
  ranInPlace += seen.still.filter((id) => before1.includes(id)).length; firingStill += seen.firing; before1 = seen.still;
  if (i === 6) {
    // (A close look, from beside one of them.)
    await sf(a, () => { const s = window.snapfort, f = s.feature; const t = [...f.army.units.values()].find((u) => u.kind === "trooper" && u.owner === f.slot && (u.flags & 2) && !u.tumble); if (!t) return; window.backTo = [s.player.position.x, s.player.position.z, s.rig.yaw, s.rig.pitch]; s.player.teleport(t.x - Math.cos(t.h) * 7, 0.95, t.z + Math.sin(t.h) * 7); s.rig.yaw = Math.atan2(t.x - s.player.position.x, t.z - s.player.position.z); s.rig.pitch = 0.12; });
    await wait(350);
    await a.screenshot({ path: "qa/shots/mojave-firing.png" });
    await sf(a, () => { const s = window.snapfort, b = window.backTo; if (b) { s.player.teleport(b[0], 0.95, b[1]); s.rig.yaw = b[2]; s.rig.pitch = b[3]; } });
  }
}
check("a Trooper standing to fire on the way somewhere holds the rifle up: nobody runs on the spot", ranInPlace === 0, `${firingStill} sightings of a Trooper firing from where it stood while told to go on, ${ranInPlace} drawn running`);
wa = await war(a);
const enemiesLeft = wa.units.filter((u) => u.owner === 8 && Math.hypot(u.x - enemyAt[0], u.z - enemyAt[1]) < 40).length;
check("an attack-move fights what it meets: the enemy line is destroyed", enemiesLeft <= 2, `${enemiesLeft} of 12 left`);
const look = await sf(a, () => { const f = window.snapfort.feature; return { puffs: f.army.puffs.length + window.seen.maxPuffs, chunks: window.seen.maxChunks, scorches: f.army.scorches.length, tankAim: window.seen.tankAim, tracersFromMuzzle: window.seen.muzzleOk, tracers: window.seen.tracers }; });
check("explosions leave smoke rising, pieces thrown out, and scorch marks on the ground", look.puffs > 5 && look.chunks > 3 && look.scorches > 0, JSON.stringify(look));
check("a tank's turret turns on its own: laid on its target while its hull points elsewhere", look.tankAim > 0, JSON.stringify(look));
check("shots leave the end of the barrel or rifle, not the middle of the body", look.tracers > 10 && look.tracersFromMuzzle / look.tracers > 0.9, JSON.stringify(look));
const fought = await sf(a, () => { clearInterval(window.watch); return window.seen; });
check("tank shells throw units through the air; thrown Troopers fly flailing, and lie a moment where they land", fought.thrownTroopers > 0 && fought.flail > 0 && fought.down > 0, JSON.stringify(fought));
check("Troopers bring their rifles up to fire, and flinch when a bullet finds them", fought.aim > 0 && fought.flinch > 0, JSON.stringify(fought));
await a.screenshot({ path: "qa/shots/mojave-fight.png" });

// ── A turret turns to what it fires on ───────────────────────────────────
// (A turret goes up only near a Core of its own army: by the Core, at the first clear spot.)
const tryAt = [[-6, 6], [6, -6], [-6, -6], [6, 6], [0, 8], [8, 0], [0, -8], [-8, 0], [-10, 4], [4, -10]];
let post = null;
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [coreX - inX * 10, coreZ - inZ * 10]);
check("a turret is refused far from its army's Core", await sf(a, ([x, z]) => new Promise((res) => { const s = window.snapfort; const p = s.player; p.teleport(x, 0.95, z); s.net.sendWorld({ m: "build", kind: "sentry", x: Math.round(x / 5) + 3, z: Math.round(z / 5) + 3 }); setTimeout(() => res(![...s.feature.army.buildings.values()].some((b) => b.kind === "sentry") && /within 75 m of your Command Core/.test(document.getElementById("toast")?.textContent ?? "")), 1200); }), [coreX + inX * 90, coreZ + inZ * 90]));
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [coreX - inX * 10, coreZ - inZ * 10]);
for (const [dx, dz] of tryAt) {
  const at = [Math.round(coreX / 5 + dx), Math.round(coreZ / 5 + dz)];
  await sf(a, ([x, z]) => window.snapfort.net.sendWorld({ m: "build", kind: "sentry", x, z }), at);
  await wait(600);
  if (await sf(a, () => [...window.snapfort.feature.army.buildings.values()].some((b) => b.kind === "sentry"))) { post = [at[0] * 5 + 2.5, at[1] * 5 + 2.5]; break; }
}
const sentryId = await until(a, () => [...window.snapfort.feature.army.buildings.values()].find((b) => b.kind === "sentry")?.i ?? null);
await until(a, (id) => window.snapfort.feature.army.buildings.get(id)?.d === 0, sentryId, 5000);
const turned = [];
for (const [dx, dz] of [[24, 0], [-17, 17]]) {
  await dev(a, { do: "spawn", kind: "tank", n: 1, slot: 8, at: [post[0] + dx, 0, post[1] + dz] });
  const want = Math.atan2(dx, dz);
  turned.push(await until(a, ([id, want, x, z]) => { const s = window.snapfort, b = s.feature.army.buildings.get(id); const off = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q))); const tracer = s.scene.getMeshByName("mojave-tracer"); return b && off(b.aim, want) < 0.25 && off(b.yaw, b.aim) < 0.08 && s.scene.getMeshByName("mojave-sentry-head-body").thinInstanceCount >= 1 ? { aim: b.aim, yaw: b.yaw, tracers: tracer.thinInstanceCount } : null; }, [sentryId, want, post[0], post[1]], 9000));
  if (dx > 0) await a.screenshot({ path: "qa/shots/mojave-turret.png" });
  await dev(a, { do: "kill", slot: 8 });
  await wait(1200);
}
check("a turret's head turns to face what it fires on, one way and then another", turned.every((t) => !!t), JSON.stringify(turned));
const muzzle = await sf(a, ([id, x, z]) => new Promise((res) => { const s = window.snapfort, f = s.feature; const shots = f.army.shots.bind(f.army); let found = null; f.army.shots = (list, now) => { shots(list, now); const t = f.army.tracers[f.army.tracers.length - 1]; if (t && Math.hypot(t.fx - x, t.fz - z) < 4) found = { fromCentre: Math.hypot(t.fx - x, t.fz - z), up: t.fy }; }; s.net.sendWorld({ m: "dev", do: "spawn", kind: "tank", n: 1, slot: 8, at: [x + 20, 0, z + 12] }); setTimeout(() => { f.army.shots = shots; res(found); }, 4000); }), [sentryId, post[0], post[1]]);
check("its shots are drawn from the ends of its barrels, not from its middle", !!muzzle && muzzle.fromCentre > 2 && muzzle.fromCentre < 3 && Math.abs(muzzle.up - 2.75) < 0.1, JSON.stringify(muzzle));
await dev(a, { do: "kill", slot: 8 });

// ── Nothing walks through anything ───────────────────────────────────────
const parked = await sf(a, () => { const f = window.snapfort.feature; const t = [...f.army.units.values()].find((u) => u.kind === "tank" && u.owner === f.slot && !u.tumble); return t ? [t.x, t.z, t.id] : null; });
if (parked) {
  // Out on its own first, 25 m off: tanks stand in groups, and the general would walk into the one beside it.
  const lone = await sf(a, ([x, z]) => {
    const f = window.snapfort.feature;
    for (const r of [25, 35, 45]) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const crowd = [...f.army.units.values()].some((u) => Math.hypot(u.x - px, u.z - pz) < 14);
      const built = (f.solids?.() ?? []).some((b) => px > b[0] - 14 && px < b[3] + 14 && pz > b[2] - 14 && pz < b[5] + 14);
      if (!crowd && !built) return [px, pz];
    }
    return [x + 25, z];
  }, parked);
  await sf(a, ([id, x, z]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "move", at: [x, 0, z] }), [parked[2], ...lone]);
  await wait(5000);
  await sf(a, ([, , id]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "hold" }), parked);
  await wait(1500);
  const t = await sf(a, (id) => { const u = window.snapfort.feature.army.units.get(id); return [u.x, u.z, u.h]; }, parked[2]);
  // Coming at it from its side, square on.
  const sx = Math.cos(t[2]), sz = -Math.sin(t[2]);
  await sf(a, ([x, z, sx, sz]) => { const s = window.snapfort; s.player.teleport(x - sx * 8, 0.95, z - sz * 8); s.rig.yaw = Math.atan2(sx, sz); s.rig.pitch = 0.1; }, [t[0], t[1], sx, sz]);
  await wait(500);
  // Walking at it, measured every frame in the tank's own frame: never inside its box (allowing for the general's own width).
  await sf(a, ([x, z, h]) => {
    window.inTank = 0;
    window.nearest = Infinity;
    const s = window.snapfort;
    window.tankWatch = s.scene.onAfterRenderObservable.add(() => {
      const p = s.player.position, dx = p.x - x, dz = p.z - z;
      const lx = dx * Math.cos(h) - dz * Math.sin(h), lz = dx * Math.sin(h) + dz * Math.cos(h);
      window.nearest = Math.min(window.nearest, Math.hypot(dx, dz));
      if (Math.abs(lx) < 1.7 - 0.05 && Math.abs(lz) < 2.1 - 0.05) window.inTank++;
    });
  }, t);
  await a.keyboard.down("w");
  await wait(2200);
  await a.keyboard.up("w");
  const walked = await sf(a, ([x, z]) => {
    const s = window.snapfort;
    s.scene.onAfterRenderObservable.remove(window.tankWatch);
    const p = s.player.position;
    // (What else stood near, should it be stopped short: buildings' boxes and units within 10 m of the tank.)
    const near = [...(s.feature.solids?.() ?? [])].filter((b) => Math.hypot((b[0] + b[3]) / 2 - x, (b[2] + b[5]) / 2 - z) < 14).map((b) => b.map((v) => Math.round(v)));
    const units = [...s.feature.army.units.values()].filter((u) => Math.hypot(u.x - x, u.z - z) < 10).map((u) => `${u.kind}@${Math.round(u.x)},${Math.round(u.z)}`);
    return { inside: window.inTank, nearest: window.nearest, at: [p.x, p.z].map(Math.round), tank: [x, z].map(Math.round), near, units };
  }, t);
  check("a general walking into a tank is stopped against it, never inside it", walked.inside === 0 && walked.nearest < 3.2, JSON.stringify(walked));
}

// ── A second general, far away: neither sees the other ───────────────────
const b = await open("B", keyB);
await until(b, () => window.snapfort.feature.why === "choose" && window.snapfort.feature.generals.length === 8);
await rowHas(b, ["Red", "Blue"]);
check("a second person is shown who serves which army already", (await row(b)).find((t) => t.label === "Red").sub === "1 general" && (await row(b)).find((t) => t.label === "Blue").sub === "nobody");
await b.keyboard.press("2");
await until(b, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
await fresh(b);
let wb = await war(b);
wa = await war(a);
check("they chose blue: an army of their own, a long way off", wb.slot === 1 && Math.hypot(wb.pos[0] - coreX, wb.pos[2] - coreZ) > 250, `A ${wa.slot}, B ${wb.slot}`);
check("both pages list the eight armies, with one general in red and one in blue", (await until(a, () => { const g = window.snapfort.feature.generals; return g.length === 8 && g[0].pids.length === 1 && g[1].pids.length === 1 && g.slice(2).every((x) => x.pids.length === 0); })) && (await until(b, () => { const g = window.snapfort.feature.generals; return g[0].pids.length === 1 && g[1].pids.length === 1; })));
check("each sees the other general in that general's army colour, not their own jacket's", await until(a, () => { const s = window.snapfort; const g = s.feature.generals[1]; return g.pids[0] && s.remotes.worn.get(g.pids[0]) === g.color ? true : null; }) === true && await until(b, () => { const s = window.snapfort; const g = s.feature.generals[0]; return g.pids[0] && s.remotes.worn.get(g.pids[0]) === g.color ? true : null; }) === true);
check("neither has been sent anything of the other's", wb.units.every((u) => u.owner === wb.slot || u.owner === 8) && wb.buildings.every((x) => x.owner === wb.slot) && (await war(a)).units.every((u) => u.owner !== wb.slot));
const coreB = wb.buildings[0];
const [bx, bz] = centreOf(coreB, 3);
// A scout of A's to B's base: now A sees it.
const scoutAt = [bx - Math.sign(bx) * 45, bz - Math.sign(bz) * 45];
await dev(a, { do: "spawn", kind: "scout", n: 1, at: [scoutAt[0], 0, scoutAt[1]] });
const seen = await until(a, (slot) => { const f = window.snapfort.feature; return [...f.army.buildings.values()].some((x) => x.o === slot) && [...f.army.units.values()].some((u) => u.owner === slot) ? true : null; }, wb.slot);
check("a scout sent to their base finds it: their Core and Haulers appear", seen === true);
check("the base is in sight on the map", await until(a, ([x, z]) => window.snapfort.feature.sight.sees(x, z), [bx, bz]) === true);
check("and they see the scout", await until(b, (slot) => [...window.snapfort.feature.army.units.values()].some((u) => u.owner === slot && u.kind === "scout") ? true : null, wa.slot) === true);

// ── The map is a scout's report ──────────────────────────────────────────
const scoutId = await sf(a, ([x, z]) => { const f = window.snapfort.feature; return [...f.army.units.values()].filter((u) => u.owner === f.slot && u.kind === "scout").sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))[0]?.id ?? 0; }, scoutAt);
const away = [bx - Math.sign(bx) * 190, bz - Math.sign(bz) * 190];
await sf(a, ([id, x, z]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "move", at: [x, 0, z] }), [scoutId, away[0], away[1]]);
const reported = await until(a, (slot) => { const f = window.snapfort.feature; const reports = [...f.reports.values()].filter((r) => r.owner === slot); const core = [...f.army.buildings.values()].find((x) => x.o === slot); return reports.length >= 4 && ![...f.army.units.values()].some((u) => u.owner === slot) && core?.stale && core.staleAt > 0 ? reports.length : null; }, wb.slot, 15000);
check("the scout gone, what it saw stays on the map as it was last seen: their Haulers as reports, their Core as it stood", reported >= 4, `${reported} reports`);
check("the reports are where the Haulers were, by their base", await sf(a, ([slot, x, z]) => [...window.snapfort.feature.reports.values()].filter((r) => r.owner === slot).every((r) => Math.hypot(r.x - x, r.z - z) < 90), [wb.slot, bx, bz]));
await sf(a, () => document.getElementById("mj-map").dataset.shot = "1");
await a.keyboard.press("Tab");
await wait(400);
await a.screenshot({ path: "qa/shots/mojave-report.png" });
await a.keyboard.press("Tab");
// Looked at again: the report is replaced by what is there now.
await sf(a, ([id, x, z]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "move", at: [x, 0, z] }), [scoutId, scoutAt[0], scoutAt[1]]);
check("looked at again, the reports give way to what is there now", await until(a, (slot) => { const f = window.snapfort.feature; return [...f.reports.values()].filter((r) => r.owner === slot).length === 0 && [...f.army.units.values()].some((u) => u.owner === slot) ? true : null; }, wb.slot, 20000) === true);

// ── Pieces: paid for, of one material, and their place's ─────────────────
const wallAt = [Math.floor((bx - Math.sign(bx) * 30) / 5), Math.floor((bz - Math.sign(bz) * 30) / 5)];
const bankB = (await war(b)).l;
const placedId = await sf(b, ([x, z]) => { const s = window.snapfort; const id = s.nextId(); return s.history.do({ kind: "place", piece: { type: "wall", x, y: 0, z, rot: 0, id, material: "brick", edit: 0 } }) ? id : null; }, wallAt);
await until(b, (l) => window.snapfort.feature.bank.l <= l - 8 ? true : null, bankB, 4000);
check("a wall costs its builder 8 lithium", !!placedId && (await war(b)).l <= bankB - 8, `${bankB} → ${(await war(b)).l}`);
check("T changes no material: there is one", await (async () => { await b.keyboard.press("t"); await frames(b, 3); return sf(b, () => !document.querySelector("#material .swatch") && /Lithium/.test(document.getElementById("material").textContent)); })());
await until(a, (id) => !!window.snapfort.state.get(id), placedId);
await sf(a, ([x, z]) => window.snapfort.player.teleport(x * 5 + 2.5, 0.95, z * 5 - 4), wallAt);
await frames(a, 5);
// Walking into it and jumping: a general jumps a wall (it stops shots, not generals).
await sf(a, () => { window.snapfort.rig.yaw = 0; window.snapfort.rig.pitch = 0; });
await a.keyboard.down("w");
await a.keyboard.down("Space"); await wait(2400); await a.keyboard.up("Space");
await a.keyboard.up("w");
const overZ = await sf(a, () => window.snapfort.player.position.z);
check("walking into a wall and jumping, a general gets over it", overZ > wallAt[1] * 5 + 0.5, `${overZ.toFixed(2)} vs the wall at ${wallAt[1] * 5}`);
const floorId = await sf(b, ([x, z]) => { const s = window.snapfort; const id = s.nextId(); s.history.do({ kind: "place", piece: { type: "floor", x: x + 2, y: 0, z: z + 2, rot: 0, id, material: "brick", edit: 0 } }); return id; }, wallAt);
await wait(900);
const farId = await sf(b, () => { const s = window.snapfort, f = s.feature; const c = [...f.army.buildings.values()].find((x) => x.o === f.slot && x.kind === "core"); const x = c.x + (c.x > 0 ? -24 : 24), z = c.z + (c.z > 0 ? -24 : 24); const id = s.nextId(); s.history.do({ kind: "place", piece: { type: "wall", x, y: 0, z, rot: 0, id, material: "brick", edit: 0 } }); return id; });
await wait(900);
check("a wall far from its army's Core (120 m out) is refused, as a turret is", await sf(b, (id) => !window.snapfort.state.get(id), farId));
check("a floor goes up anywhere (a platform to command from), and both pages have it", await until(a, (id) => !!window.snapfort.state.get(id) || null, floorId, 3000) === true && await sf(b, (id) => !!window.snapfort.state.get(id), floorId));
await sf(a, ([x, z]) => window.snapfort.player.teleport(x * 5 + 2.5, 0.95, z * 5 - 4), wallAt);
await frames(a, 5);
await sf(a, (id) => window.snapfort.removePiece(id), placedId);
await wait(600);
check("another general cannot take it down by hand", await sf(a, (id) => !!window.snapfort.state.get(id), placedId) && await sf(b, (id) => !!window.snapfort.state.get(id), placedId));
// With units selected, aiming at the enemy's wall outlines that section of it, to be shot down (on the ground beside it: the plain ring).
await sf(a, () => { const f = window.snapfort.feature; f.run("desel"); const u = [...f.army.units.values()].find((x) => x.owner === f.slot && x.kind !== "hauler"); if (u) f.selected.add(u.id); });
const ringsAt = async (spot) => { await aim(a, spot); await frames(a, 4); return sf(a, () => window.snapfort.scene.getMeshByName("mojave-ring").thinInstanceCount); };
const onGround = await ringsAt([wallAt[0] * 5 + 2.5, 0, wallAt[1] * 5 - 2]);
const onWall = await ringsAt([wallAt[0] * 5 + 2.5, 1.8, wallAt[1] * 5]);
await a.screenshot({ path: "qa/shots/mojave-wall-target.png" });
check("with units selected, aiming at the enemy's wall outlines that section of it, to be shot down", onWall >= onGround + 20, `${onGround} rings on the ground, ${onWall} on the wall`);
await sf(a, () => window.snapfort.feature.run("desel"));
const engine = await sf(b, ([x, z]) => { const s = window.snapfort; const id = s.nextId(); s.history.do({ kind: "place", piece: { type: "trebuchet", x: x + 3, y: 0, z: z + 3, rot: 0, id, material: "brick", edit: 0 } }); return id; }, wallAt);
await wait(900);
check("nobody builds a siege engine: the world refuses one", await sf(a, (id) => !window.snapfort.state.get(id), engine) && await sf(b, (id) => !window.snapfort.state.get(id), engine));

// ── No alliances ─────────────────────────────────────────────────────────
await clear(a);
await a.keyboard.press("j");
await frames(a, 3);
check("there are no alliances: J opens nothing, and the two generals' armies are enemies", (await war(a)).mode === null && (await row(a)).every((t) => !/all/i.test(t.label) || t.label === "Wall"));

// ── The map ──────────────────────────────────────────────────────────────
await a.keyboard.press("Tab");
check("Tab opens the map over the game", await sf(a, () => document.getElementById("mj").classList.contains("big") && document.getElementById("mj-map").getBoundingClientRect().width > 400));
const yaw0 = await sf(a, () => window.snapfort.rig.yaw);
await a.mouse.move(700, 400); await a.mouse.move(760, 430);
check("while it is open the mouse moves its pointer, not the view", Math.abs((await sf(a, () => window.snapfort.rig.yaw)) - yaw0) < 1e-6);
await a.screenshot({ path: "qa/shots/mojave-map.png" });
await a.keyboard.press("Tab");
check("Tab closes it", await sf(a, () => !document.getElementById("mj").classList.contains("big")));
check("the whole of the land is drawn on the map: none of it is black", await sf(a, () => { const c = document.getElementById("mj-map"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let black = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) black++; return black / (d.length / 4); }) < 0.02);

// ── Nobody watches ───────────────────────────────────────────────────────
const v = await open("visitor", null, false);
await until(v, () => window.snapfort.feature.why === "visitor", null, 6000);
await v.click("#play-free");
await wait(900);
const wv = await sf(v, () => { const s = window.snapfort, f = s.feature; return { slot: f.slot, why: f.why, units: f.army.units.size, buildings: f.army.buildings.size, playing: document.body.classList.contains("playing"), unlock: !document.getElementById("view-unlock").hidden, note: document.getElementById("touch-note").textContent }; });
check("someone without the Full Game is not let in: the button to play opens the offer, and no game starts", wv.slot === -1 && wv.why === "visitor" && !wv.playing && wv.unlock && /Full Game/.test(wv.note), JSON.stringify(wv));
check("and they are sent nothing of the war", wv.units === 0 && wv.buildings === 0);
check("the generals do not see them standing about", await sf(a, () => { const s = window.snapfort; const gens = new Set(s.feature.generals.flatMap((g) => g.pids)); return s.remotes.list().filter((p) => !gens.has(p.id)).every((p) => s.remotes.concealed.has(p.id)); }));
await v.close();

// ── The same tab back is in its army again ───────────────────────────────
const unitsBefore = (await war(a)).units.filter((u) => u.owner === wa.slot).length;
await a.reload();
await a.waitForSelector("body.ready", { timeout: 30000 });
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
const again = await war(a);
check("a reload comes back to the army it served, without being asked to choose again, with everything as it was", again.slot === wa.slot && again.buildings.some((x) => x.kind === "foundry") && again.units.filter((u) => u.owner === wa.slot).length >= unitsBefore - 2, `${again.units.filter((u) => u.owner === wa.slot).length} of ${unitsBefore} units`);
await a.click("#play-free").catch(() => {});
await wait(1200);

// ── Two generals, one army ───────────────────────────────────────────────
const c2 = await open("C", await paidKey(base, "/mojave"));
await until(c2, () => window.snapfort.feature.why === "choose");
await c2.keyboard.press("1");
await until(c2, () => window.snapfort.feature.slot === 0 && window.snapfort.feature.army.units.size >= 4);
const shared = await until(c2, (n) => { const f = window.snapfort.feature; const mine = [...f.army.units.values()].filter((u) => u.owner === 0).length; return mine >= n - 2 && f.generals[0].pids.length === 2 ? { units: mine, bank: f.bank.l } : null; }, unitsBefore);
check("a second general serving the same army commands all of it: the same units, the same bank", !!shared && Math.abs(shared.bank - (await war(a)).l) < 400, JSON.stringify(shared));
const tankId = await sf(c2, () => [...window.snapfort.feature.army.units.values()].find((u) => u.owner === 0 && u.kind === "tank")?.id ?? 0);
const tankAt = await sf(a, (id) => { const u = window.snapfort.feature.army.units.get(id); return u ? [u.x, u.z] : null; }, tankId);
await sf(c2, ([id, x, z]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "move", at: [x + 30, 0, z] }), [tankId, tankAt[0], tankAt[1]]);
check("what one orders, the other sees done", await until(a, ([id, x]) => { const u = window.snapfort.feature.army.units.get(id); return u && u.x > x + 12 ? true : null; }, [tankId, tankAt[0]], 10000) === true);
check("they see each other, both in the army's colour", await until(a, () => { const s = window.snapfort, g = s.feature.generals[0]; const other = g.pids.find((id) => id !== s.myId); return other && s.remotes.worn.get(other) === g.color && !s.remotes.concealed.has(other) ? true : null; }) === true);

// ── Changing sides ───────────────────────────────────────────────────────
await c2.keyboard.press("c");
await rowHas(c2, ["Change army"]);
await c2.keyboard.press("j");
await rowHas(c2, ["Red", "Green", "Back"]);
tiles = await row(c2);
check("Command, then Change army: the eight armies again, the one served marked, and who serves each", tiles.find((t) => t.label === "Red").on && tiles.find((t) => t.label === "Red").sub === "you + 1" && tiles.find((t) => t.label === "Blue").sub === "1 general" && tiles.find((t) => t.label === "Green").sub === "nobody", tiles.map((t) => `${t.key}:${t.label} (${t.sub})`).join(" "));
const posBefore = (await war(c2)).pos;
await c2.keyboard.press("4");
const sided = await until(c2, () => { const f = window.snapfort.feature; const p = window.snapfort.player.position; return f.slot === 3 && [...f.army.units.values()].filter((u) => u.owner === 3).length >= 4 && ![...f.army.units.values()].some((u) => u.owner === 0) ? [p.x, p.z] : null; });
check("pressing 4, they serve green from that moment: stood before its Core, commanding its units, sent nothing more of red", !!sided && Math.hypot(sided[0] - posBefore[0], sided[1] - posBefore[2]) > 200, JSON.stringify(sided));
check("they wear green now, and are told so", await until(c2, () => { const s = window.snapfort; return s.player.avatar.jacket.diffuseColor.toHexString().toLowerCase() === s.feature.generals[3].color.toLowerCase() && /You serve the green army/.test(document.getElementById("mj-notes").textContent) ? true : null; }) === true);
check("red stands as it was, with the general who stayed", await until(a, () => { const g = window.snapfort.feature.generals; return g[0].pids.length === 1 && g[3].pids.length === 1 ? true : null; }) === true && (await war(a)).units.filter((u) => u.owner === 0).length >= unitsBefore - 2);

// ── Leaving: the army is kept a minute (a reload comes back to it), then everything of it is gone ───
await b.close();
const leftAt = Date.now();
check("a general who leaves: their army has nobody, and stands for now", await until(a, () => window.snapfort.feature.generals[1].pids.length === 0 ? true : null, null, 10000) === true);
check("inside the minute, their wall still stands", await sf(a, (id) => !!window.snapfort.state.get(id), placedId));
// (The minute is the clock's, not the game's: speeding the game up does not hurry it.)
await wait(Math.max(0, leftAt + 63_000 - Date.now()));
check("a minute on, everything of it is gone: the wall they built too", await until(a, (id) => !window.snapfort.state.get(id) ? true : null, placedId, 10000) === true);
await dev(a, { do: "spawn", kind: "scout", n: 1, at: [bx - Math.sign(bx) * 40, 0, bz - Math.sign(bz) * 40] });
check("looked at again, their base is gone: no Core, nothing of theirs; no computer plays blue", await until(a, () => { const f = window.snapfort.feature; return [...f.army.buildings.values()].every((x) => x.o !== 1) && ![...f.army.units.values()].some((u) => u.owner === 1) ? true : null; }, null, 15000) === true);
await c2.close();

// ── A Titan walks on its legs ───────────────────────────────────────────
{
  const me = await sf(a, () => { const p = window.snapfort.player.position; return [p.x, p.z]; });
  await dev(a, { do: "spawn", kind: "titan", n: 1, at: [me[0] + 12, 0, me[1] + 12] });
  const titanId = await until(a, () => { const f = window.snapfort.feature; return [...f.army.units.values()].find((u) => u.kind === "titan" && u.owner === f.slot)?.id ?? null; });
  await sf(a, ([id, x, z]) => window.snapfort.net.sendWorld({ m: "order", ids: [id], k: "move", at: [x, 0, z] }), [titanId, me[0] + 12, me[1] + 60]);
  await wait(1500);
  // Each foot, frame by frame: where it is while it is down, and how far the Titan goes meanwhile.
  const walk = await sf(a, (id) => new Promise((res) => { const f = window.snapfort.feature, u = f.army.units.get(id), feet = f.army.titanLegs[2]; let slid = 0, planted = 0, lifted = 0, last = null, x0 = u.x, z0 = u.z, frames = 0; const step = () => { const m = feet.matrices; const now = [[m[12], m[14]], [m[28], m[30]]]; if (last) for (const side of [0, 1]) { if (u.feet & (side ? 2 : 1) && last.feet & (side ? 2 : 1)) { slid = Math.max(slid, Math.hypot(now[side][0] - last.at[side][0], now[side][1] - last.at[side][1])); planted++; } else lifted++; } last = { at: now, feet: u.feet }; if (++frames < 90) requestAnimationFrame(step); else res({ slid, planted, lifted, went: Math.hypot(u.x - x0, u.z - z0), legs: f.army.titanLegs.map((l) => l.count) }); }; requestAnimationFrame(step); }), titanId);
  check("a Titan walks on its legs: each foot planted while it goes on over it (never sliding), then lifted and swung ahead", walk.went > 4 && walk.planted > 40 && walk.lifted > 20 && walk.slid < 0.12 && walk.legs.every((n) => n >= 2), JSON.stringify(walk));
}

check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
