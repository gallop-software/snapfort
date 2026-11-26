/**
 * Mojave: there are always eight generals. A person takes a computer's place
 * over as it stands, mines, builds (with the building shown before it is
 * placed), makes units, selects and orders them with the keys and the mouse
 * (what the keys mean is on the row, in the same boxes as the pieces), and
 * fights. The land is never dark, but an enemy shows only while in sight, and
 * the map keeps a report of what was last seen. Pieces cost lithium, of one
 * material, and stay with their place; nobody watches; a computer takes over
 * from whoever leaves; the same tab back has its place again. Needs the
 * Gallop dev server with Stripe test keys in .dev.vars. Run: npm run qa:mojave
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

// ── A general arrives: in a computer's place, as it stands ───────────────
const a = await open("A", keyA);
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
let wa = await war(a);
check("a general has a place at once: a computer's, with its Core and Haulers", wa.slot >= 0 && wa.buildings.some((b) => b.kind === "core" && b.owner === wa.slot) && wa.units.filter((u) => u.kind === "hauler" && u.owner === wa.slot).length >= 4, `slot ${wa.slot}, ${wa.buildings.length} buildings, ${wa.units.length} units`);
check("there are eight generals, and this is the only person", (await until(a, () => window.snapfort.feature.generals.length === 8)) && (await war(a)).gens.filter((g) => !g.ai).length === 1, JSON.stringify((await war(a)).gens.map((g) => g.ai)));
check("they are told whose all this is: the army's colour, by name", await sf(a, () => /You command the (red|blue|yellow|green|purple|orange|teal|pink) army/.test(document.getElementById("mj-notes").textContent)), await sf(a, () => document.getElementById("mj-notes").textContent.slice(0, 90)));
const mine = await until(a, () => { const s = window.snapfort, f = s.feature; const g = f.generals.find((x) => x.slot === f.slot); const sw = document.querySelector("#material .sw"); if (!g || !sw) return null; const jacket = s.player.avatar.jacket.diffuseColor.toHexString().toLowerCase(); const css = getComputedStyle(sw).backgroundColor.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, "0")).join(""); return jacket === g.color.toLowerCase() ? { army: g.color, jacket, swatch: `#${css}`, own: s.feature && JSON.parse(localStorage.getItem("snapfort.identity") ?? "{}").color } : null; });
check("the general wears their army's colour while they command it, and it is shown beside the bank", !!mine && mine.swatch === mine.army.toLowerCase(), JSON.stringify(mine));
check("they arrive facing their Core: the crosshair is on it", await sf(a, () => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "core"; }));
// (For the checks: the computers do nothing new, and this place is as a war begins it.)
await dev(a, { do: "quiet" });
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
let tiles = await row(a);
check("the row: the four pieces, Remove, and Command where the siege engine is elsewhere", tiles.map((t) => t.label).join(",") === "Wall,Floor,Ramp,Canopy,Remove,Command" && keysOf(tiles).Command === "B", tiles.map((t) => `${t.key}:${t.label}`).join(" "));
check("the bank is beside the row, where the material is elsewhere; there is no material to choose", await sf(a, () => { const m = document.getElementById("material"); const r = m.getBoundingClientRect(), h = document.getElementById("hotbar").getBoundingClientRect(); return /Lithium/.test(m.textContent) && /Supply/.test(m.textContent) && !m.querySelector(".swatch") && r.left >= h.right && r.width > 0 && Math.abs(r.bottom - h.bottom) < 30; }));
check("there is no command card, and the map is on screen", await sf(a, () => !document.getElementById("mj-card") && document.getElementById("mj-map").getBoundingClientRect().width > 100));
const before = wa.l;
await until(a, (l) => window.snapfort.feature.bank.l > l, before, 25000);
wa = await war(a);
check("the Haulers mine by themselves: lithium comes in", wa.l > before, `${before} → ${wa.l}`);
check("a Hauler is drawn carrying or digging", wa.units.some((u) => u.flags & 96));
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
check("the row shows what it makes, with its key and its price, in the same boxes", tiles.every((t) => t.menu) && keysOf(tiles).Hauler === "H" && tiles.find((t) => t.label === "Hauler").sub === "50" && !!keysOf(tiles)["Rally point"], tiles.map((t) => `${t.key}:${t.label}`).join(" "));
check("what is selected is said over the row", await sf(a, () => /Command Core/.test(document.getElementById("world-panel").textContent)));
await until(a, () => window.snapfort.feature.bank.l >= 50, null, 20000);
await a.keyboard.press("h");
wa = await until(a, (id) => { const f = window.snapfort.feature; return f.army.buildings.get(id).q.length === 1 && /making Hauler/.test(document.getElementById("world-panel").textContent) ? true : null; }, core.id);
check("H orders a Hauler: it is in the Core's queue, and the row says so", wa === true);
await clear(a);
check("letting go of the selection, the pieces are back on the row", (await war(a)).selB.length === 0 && (await rowHas(a, ["Wall", "Command"])) === true);

// ── Command, and building ────────────────────────────────────────────────
await dev(a, { do: "rich" });
await until(a, () => window.snapfort.feature.bank.l > 10000);
const inX = -Math.sign(coreX), inZ = -Math.sign(coreZ);
const site = [coreX + inX * 32, coreZ + inZ * 32];
await a.keyboard.press("b");
await rowHas(a, ["Whole army"]);
tiles = await row(a);
check("B (the Command tile) opens the general's own menu on the row", tiles.map((t) => t.label).join(",") === "Build,Whole army,Idle Hauler,Map,Back" && keysOf(tiles).Build === "N" && keysOf(tiles).Map === "Tab", tiles.map((t) => `${t.key}:${t.label}`).join(" "));
await a.keyboard.press("n");
await rowHas(a, ["Foundry"]);
tiles = await row(a);
check("N opens the buildings, each with its key and price; one that cannot be built yet is faded, and says what it needs", (await war(a)).mode === "menu" && keysOf(tiles).Foundry === "F" && tiles.find((t) => t.label === "Foundry").sub === "150" && keysOf(tiles).Advanced === "V" && tiles.find((t) => t.label === "Sentry turret").sub === "needs Foundry" && tiles.find((t) => t.label === "Sentry turret").off && !tiles.find((t) => t.label === "Foundry").off, tiles.map((t) => `${t.key}:${t.label}`).join(" "));
await a.keyboard.press("f");
check("F picks the Foundry to place", (await war(a)).mode === "place");
// Backspace goes back one step at a time: to the buildings, to the general's own menu, to the pieces.
await a.keyboard.press("Backspace");
const step1 = (await war(a)).mode === "menu" && (await rowHas(a, ["Foundry", "Advanced"])) === true;
await a.keyboard.press("Backspace");
const step2 = (await rowHas(a, ["Whole army", "Build"])) === true;
await a.keyboard.press("Backspace");
const step3 = (await war(a)).mode === null && (await rowHas(a, ["Wall", "Command"])) === true;
check("Backspace goes back one step: from placing to the buildings, to the general's own menu, to the pieces", step1 && step2 && step3, `${step1} ${step2} ${step3}`);
await a.keyboard.press("n");
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
check("a click puts it down, printing; the preview goes", !!foundry && wa.buildings.find((b) => b.id === foundry).printing && wa.mode === null && await sf(a, () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(!window.snapfort.scene.getMeshByName("mojave-ghost-foundry").isEnabled()))))));
check("a building is solid: the crosshair lands on it", await sf(a, () => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "foundry"; }));
await a.keyboard.press("n");
await a.keyboard.press("v");
await rowHas(a, ["Armory", "Basic"]);
await a.keyboard.press("m");
await frames(a, 4);
check("V turns to the advanced buildings; the Armory needs a finished Foundry: it cannot be placed yet", await sf(a, () => /Needs Foundry/.test(document.getElementById("world-panel").textContent)));
await clear(a);
// (A check may run the clock fast.)
await dev(a, { do: "speed", n: 12 });
await until(a, (id) => window.snapfort.feature.army.buildings.get(id)?.d === 0, foundry, 15000);
await dev(a, { do: "speed", n: 1 });
check("it finishes printing", (await war(a)).buildings.find((b) => b.id === foundry).printing === false);
await aim(a, [site[0] + inX * 5, 3, site[1] + inZ * 5]);
await click(a);
await rowHas(a, ["Trooper"]);
await a.keyboard.press("t");
await a.keyboard.down("Shift"); await a.keyboard.press("t"); await a.keyboard.up("Shift");
wa = await until(a, (id) => (window.snapfort.feature.army.buildings.get(id)?.q.length ?? 0) >= 2 ? true : null, foundry);
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
wa = await war(a);
check("` selects the whole army (not the Haulers)", wa.sel.length >= 16 && wa.sel.every((id) => wa.units.find((u) => u.id === id).kind !== "hauler"), `selected ${wa.sel.length}`);
await rowHas(a, ["Attack"]);
tiles = await row(a);
check("the bank is still wholly on the screen beside the longer row", await sf(a, () => { const r = document.getElementById("material").getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth - 4 && r.left >= document.getElementById("hotbar").getBoundingClientRect().right; }), await sf(a, () => { const r = document.getElementById("material").getBoundingClientRect(); return `${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}`; }));
check("the row lists the orders with StarCraft's keys, attack on F and stop on X", (() => { const k = keysOf(tiles); return k.Move === "M" && k.Attack === "F" && k.Stop === "X" && k.Hold === "H" && k.Patrol === "P" && k.Build === "B" && tiles.every((t) => t.menu); })(), tiles.map((t) => `${t.key}:${t.label}`).join(" "));
check("with units selected the keys are orders: Z does not pick a wall", await (async () => { await a.keyboard.press("z"); return sf(a, () => !document.querySelector("#hotbar .slot:not(.menu).selected")); })());
// Troopers are people: drawn in poses, standing now.
const drawn = (page) => sf(page, () => { const count = (re) => window.snapfort.scene.meshes.filter((m) => re.test(m.name) && m.isEnabled()).reduce((n, m) => n + (m.thinInstanceCount || 0), 0); return { stand: count(/^mojave-trooper-stand$/), run: count(/^mojave-trooper-run-\d+$/), aim: count(/^mojave-trooper-aim$/), flail: count(/^mojave-trooper-flail-\d+$/), down: count(/^mojave-trooper-down$/), flinch: count(/^mojave-trooper-flinch$/) }; });
let poses = await drawn(a);
check("Troopers standing are drawn standing, each a person", poses.stand >= 12 && poses.run === 0, JSON.stringify(poses));
// Right click on the ground: they go there.
await aim(a, [dest[0], 0, dest[1]]);
await click(a, "right");
await wait(1500);
poses = await drawn(a);
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
  window.seen = { thrownTroopers: 0, thrownOthers: 0, flail: 0, down: 0, aim: 0, flinch: 0, bulletThrows: 0 };
  const count = (re) => window.snapfort.scene.meshes.filter((m) => re.test(m.name) && m.isEnabled()).reduce((n, m) => n + (m.thinInstanceCount || 0), 0);
  window.watch = setInterval(() => {
    for (const u of window.snapfort.feature.army.units.values()) if (u.tumble) u.kind === "trooper" ? window.seen.thrownTroopers++ : window.seen.thrownOthers++;
    window.seen.flail += count(/^mojave-trooper-flail-\d+$/);
    window.seen.down += count(/^mojave-trooper-down$/);
    window.seen.aim += count(/^mojave-trooper-aim$/);
    window.seen.flinch += count(/^mojave-trooper-flinch$/);
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
const fought = await sf(a, () => { clearInterval(window.watch); return window.seen; });
check("tank shells throw units through the air; thrown Troopers fly flailing, and lie a moment where they land", fought.thrownTroopers > 0 && fought.flail > 0 && fought.down > 0, JSON.stringify(fought));
check("Troopers bring their rifles up to fire, and flinch when a bullet finds them", fought.aim > 0 && fought.flinch > 0, JSON.stringify(fought));
await a.screenshot({ path: "qa/shots/mojave-fight.png" });

// ── A turret turns to what it fires on ───────────────────────────────────
const post = await sf(a, () => { const s = window.snapfort; const p = s.player.position; const x = Math.round(p.x / 5) + 3, z = Math.round(p.z / 5) + 3; s.net.sendWorld({ m: "build", kind: "sentry", x, z }); return [x * 5 + 2.5, z * 5 + 2.5]; });
const sentryId = await until(a, () => [...window.snapfort.feature.army.buildings.values()].find((b) => b.kind === "sentry")?.i ?? null);
await dev(a, { do: "speed", n: 12 });
await until(a, (id) => window.snapfort.feature.army.buildings.get(id)?.d === 0, sentryId, 15000);
await dev(a, { do: "speed", n: 1 });
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

// ── A second general, far away: neither sees the other ───────────────────
const b = await open("B", keyB);
await until(b, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
await fresh(b);
let wb = await war(b);
wa = await war(a);
check("a second person has a place of their own: the next computer's, in turn", wb.slot >= 0 && wb.slot !== wa.slot && Math.hypot(wb.pos[0] - coreX, wb.pos[2] - coreZ) > 250, `A ${wa.slot}, B ${wb.slot}`);
check("both pages list eight generals, two of them people", (await until(a, () => { const g = window.snapfort.feature.generals; return g.length === 8 && g.filter((x) => !x.ai).length === 2; })) && (await until(b, () => { const g = window.snapfort.feature.generals; return g.length === 8 && g.filter((x) => !x.ai).length === 2; })));
check("each sees the other general in that general's army colour, not their own jacket's", await until(a, (slot) => { const s = window.snapfort; const g = s.feature.generals.find((x) => x.slot === slot); return g?.pid && s.remotes.worn.get(g.pid) === g.color ? true : null; }, wb.slot) === true && await until(b, (slot) => { const s = window.snapfort; const g = s.feature.generals.find((x) => x.slot === slot); return g?.pid && s.remotes.worn.get(g.pid) === g.color ? true : null; }, wa.slot) === true);
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
await sf(a, (id) => window.snapfort.removePiece(id), placedId);
await wait(600);
check("another general cannot take it down by hand", await sf(a, (id) => !!window.snapfort.state.get(id), placedId) && await sf(b, (id) => !!window.snapfort.state.get(id), placedId));
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
check("the generals do not see them standing about", await sf(a, () => { const s = window.snapfort; const gens = new Set(s.feature.generals.map((g) => g.pid)); return s.remotes.list().filter((p) => !gens.has(p.id)).every((p) => s.remotes.concealed.has(p.id)); }));
await v.close();

// ── The same tab back has its place again ────────────────────────────────
const unitsBefore = (await war(a)).units.filter((u) => u.owner === wa.slot).length;
await a.reload();
await a.waitForSelector("body.ready", { timeout: 30000 });
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
const again = await war(a);
check("a reload comes back to the same place, with everything as it was", again.slot === wa.slot && again.buildings.some((x) => x.kind === "foundry") && again.units.filter((u) => u.owner === wa.slot).length >= unitsBefore - 2, `${again.units.filter((u) => u.owner === wa.slot).length} of ${unitsBefore} units`);

// ── A computer takes over from whoever leaves; nothing is taken away ─────
await b.close();
await a.click("#play-free").catch(() => {});
const handed = await until(a, (slot) => { const g = window.snapfort.feature.generals.find((x) => x.slot === slot); return g && g.ai && g.pid === "" ? g.name : null; }, wb.slot, 10000);
check("a general who leaves: a computer has their place at once", !!handed, `now ${handed}`);
await dev(a, { do: "speed", n: 15 });
await wait(7000);
await dev(a, { do: "speed", n: 1 });
check("long after, their wall still stands and there are still eight generals", await sf(a, (id) => !!window.snapfort.state.get(id) && window.snapfort.feature.generals.length === 8, placedId));
await dev(a, { do: "spawn", kind: "scout", n: 1, at: [bx - Math.sign(bx) * 40, 0, bz - Math.sign(bz) * 40] });
check("and their Core is still there when looked at again", await until(a, (slot) => { const f = window.snapfort.feature; const core = [...f.army.buildings.values()].find((x) => x.o === slot && x.kind === "core"); return core && !core.stale ? true : null; }, wb.slot) === true);
// The next person is given the next computer in turn (not the place just left, nor A's).
const c2 = await open("C", keyB);
await until(c2, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
const wc = await war(c2);
check("the next person in takes the next computer's place in turn, with what it had", wc.slot >= 0 && wc.slot !== wa.slot && wc.slot !== wb.slot && wc.buildings.some((x) => x.kind === "core"), `C ${wc.slot}`);
await c2.close();

check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
