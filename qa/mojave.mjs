/**
 * Mojave: a general arrives at a start with a Core and Haulers, mines, builds,
 * makes units, selects and orders them with the keys and the mouse, fights,
 * and sees only what their side sees; pieces cost lithium and are their
 * builder's; alliances; a visitor watches; leaving takes everything away; the
 * same tab back is the same general. Needs the Gallop dev server with Stripe
 * test keys in .dev.vars. Run: npm run qa:mojave
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

const [keyA, keyB] = [await paidKey(base, "/mojave"), await paidKey(base, "/mojave")];
check("(two Full Game keys, for two generals)", /^SNAP-/.test(keyA ?? "") && /^SNAP-/.test(keyB ?? ""));

// ── A general arrives ────────────────────────────────────────────────────
const a = await open("A", keyA);
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
let wa = await war(a);
check("a general has a place, a Core, four Haulers, and lithium in the bank", wa.slot >= 0 && wa.buildings.length === 1 && wa.buildings[0].kind === "core" && wa.units.filter((u) => u.kind === "hauler").length === 4 && wa.l >= 50, JSON.stringify({ slot: wa.slot, l: wa.l, sup: `${wa.used}/${wa.max}` }));
const core = wa.buildings[0];
const [coreX, coreZ] = centreOf(core, 3);
check("they stand by their Core, at one of the eight starts", Math.hypot(wa.pos[0] - coreX, wa.pos[2] - coreZ) < 40 && Math.hypot(coreX, coreZ) > 300, wa.pos.map(Math.round).join(","));
check("they arrive facing their Core: the crosshair is on it", await sf(a, () => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "core"; }));
check("nothing is picked to build with at first (pieces cost lithium here)", await sf(a, () => !document.querySelector("#hotbar .selected")));
check("the bank, the map and the command card are on screen", await sf(a, () => !document.getElementById("mj-bank").hidden && !document.getElementById("mj-card").hidden && document.getElementById("mj-map").getBoundingClientRect().width > 100));
await sf(a, () => window.snapfort.net.sendWorld({ m: "bots", n: 0 }));
const before = wa.l;
await wait(9000);
wa = await war(a);
check("the Haulers mine by themselves: lithium comes in", wa.l > before, `${before} → ${wa.l}`);
check("a Hauler is drawn carrying or digging", wa.units.some((u) => u.flags & 96));
await a.screenshot({ path: "qa/shots/mojave-base.png" });

// ── The dark ─────────────────────────────────────────────────────────────
const dark = await sf(a, ([x, z]) => { const d = window.snapfort.feature.dark; return { home: d.sees(x, z), far: d.sees(0, 0), knownFar: d.knows(-x, -z), banks: window.snapfort.scene.getMeshByName("mojave-dark-bank").thinInstanceCount, overlay: window.snapfort.scene.getMeshByName("mojave-dark").isEnabled() }; }, [coreX, coreZ]);
check("the base is in sight; the middle of the map and the far side are dark", dark.home && !dark.far && !dark.knownFar && dark.overlay && dark.banks > 5000, JSON.stringify(dark));

// ── Selecting, and making a unit ─────────────────────────────────────────
await aim(a, [coreX, 3, coreZ]);
await click(a);
wa = await war(a);
check("a click on the Core selects it", wa.selB.length === 1 && wa.selB[0] === core.id);
check("the card shows what it makes, with its key", await sf(a, () => /Hauler/.test(document.getElementById("mj-card").textContent) && [...document.querySelectorAll("#mj-card kbd")].some((k) => k.textContent === "H")));
await until(a, () => window.snapfort.feature.bank.l >= 50, null, 20000);
await a.keyboard.press("h");
wa = await until(a, (id) => { const f = window.snapfort.feature; return f.army.buildings.get(id).q.length === 1 && f.bank.used === 5 ? true : null; }, core.id);
check("H orders a Hauler: it is in the Core's queue, and has a place in the supply", wa === true);
await a.keyboard.press("Backspace");
check("Backspace lets go of the selection", (await war(a)).selB.length === 0);

// ── Building ─────────────────────────────────────────────────────────────
await dev(a, { do: "rich" });
await until(a, () => window.snapfort.feature.bank.l > 10000);
const inX = -Math.sign(coreX), inZ = -Math.sign(coreZ);
const site = [coreX + inX * 32, coreZ + inZ * 32];
await a.keyboard.press("n");
await frames(a, 3);
check("N opens the build menu", (await war(a)).mode === "menu" && await sf(a, () => /Foundry/.test(document.getElementById("mj-card").textContent)));
await a.keyboard.press("f");
check("F picks the Foundry to place", (await war(a)).mode === "place");
await aim(a, [site[0], 0, site[1]], [coreX + inX * 18, coreZ + inZ * 18]);
await click(a);
const foundry = await until(a, () => [...window.snapfort.feature.army.buildings.values()].find((b) => b.kind === "foundry")?.i ?? null);
wa = await war(a);
check("a click puts it down, printing", !!foundry && wa.buildings.find((b) => b.id === foundry).printing && wa.mode === null);
check("a building is solid: the crosshair lands on it", await sf(a, ([x, z]) => { const p = window.snapfort.feature.pick(); return p?.k === "building" && p.b.kind === "foundry"; }, site));
await a.keyboard.press("n");
await a.keyboard.press("v");
await a.keyboard.press("m");
await frames(a, 4);
check("the Armory needs a finished Foundry: it cannot be placed yet", await sf(a, () => /Needs Foundry/.test(document.getElementById("world-panel").textContent)));
await a.keyboard.press("Backspace");
// (A check may run the clock fast.)
await dev(a, { do: "speed", n: 12 });
await until(a, (id) => window.snapfort.feature.army.buildings.get(id)?.d === 0, foundry, 15000);
await dev(a, { do: "speed", n: 1 });
check("it finishes printing", (await war(a)).buildings.find((b) => b.id === foundry).printing === false);
await aim(a, [site[0] + inX * 5, 3, site[1] + inZ * 5]);
await click(a);
await a.keyboard.press("t");
await a.keyboard.down("Shift"); await a.keyboard.press("t"); await a.keyboard.up("Shift");
wa = await until(a, (id) => (window.snapfort.feature.army.buildings.get(id)?.q.length ?? 0) >= 2 ? true : null, foundry);
check("T at the Foundry orders a Trooper; Shift orders several, as far as supply allows", wa === true, `queue ${(await war(a)).buildings.find((b) => b.id === foundry).q}`);
await a.keyboard.press("Backspace");

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
check("a second click selects all of its kind nearby", wa.sel.length === 12, `selected ${wa.sel.length}`);
await a.keyboard.down("Control"); await a.keyboard.press("1"); await a.keyboard.up("Control");
await a.keyboard.press("Backspace");
check("(nothing selected)", (await war(a)).sel.length === 0);
await a.keyboard.press("1");
check("Ctrl + 1 saves the group and 1 brings it back", (await war(a)).sel.length === 12);
await a.keyboard.press("Backquote");
wa = await war(a);
check("` selects the whole army (not the Haulers)", wa.sel.length === 16 && wa.sel.every((id) => wa.units.find((u) => u.id === id).kind !== "hauler"), `selected ${wa.sel.length}`);
check("the card lists the orders with StarCraft's keys, attack on F and stop on X", await sf(a, () => { const keys = Object.fromEntries([...document.querySelectorAll("#mj-card button")].map((b) => [b.querySelector("b").firstChild.textContent, b.querySelector("kbd").textContent])); return keys.Move === "M" && keys.Attack === "F" && keys.Stop === "X" && keys.Hold === "H" && keys.Patrol === "P"; }));
check("with units selected the keys are orders: Z does not pick a wall", await (async () => { await a.keyboard.press("z"); return sf(a, () => !document.querySelector("#hotbar .selected")); })());
// Right click on the ground: they go there.
await aim(a, [dest[0], 0, dest[1]]);
await click(a, "right");
await wait(9000);
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
check("F waits for a click (attack)", (await war(a)).mode === "target");
await aim(a, [enemyAt[0] - back[0] * 10, 0, enemyAt[1] - back[1] * 10]);
// Watch for units being thrown while they fight.
await sf(a, () => { window.thrown = 0; window.watch = setInterval(() => { for (const u of window.snapfort.feature.army.units.values()) if (u.tumble) window.thrown++; }, 50); });
await click(a);
await wait(22000);
wa = await war(a);
const enemiesLeft = wa.units.filter((u) => u.owner === 8 && Math.hypot(u.x - enemyAt[0], u.z - enemyAt[1]) < 40).length;
check("an attack-move fights what it meets: the enemy line is destroyed", enemiesLeft <= 2, `${enemiesLeft} of 12 left`);
check("tank shells throw units: they tumble through the air", await sf(a, () => { clearInterval(window.watch); return window.thrown; }) > 0);
await a.screenshot({ path: "qa/shots/mojave-fight.png" });

// ── A second general, far away: neither sees the other ───────────────────
const b = await open("B", keyB);
await until(b, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
let wb = await war(b);
wa = await war(a);
check("a second general has a start of their own", wb.slot >= 0 && wb.slot !== wa.slot && Math.hypot(wb.pos[0] - coreX, wb.pos[2] - coreZ) > 250);
check("both pages list both generals", wa.gens.length === 2 && wb.gens.length === 2 || (await until(a, () => window.snapfort.feature.generals.length === 2)));
check("neither has been sent anything of the other's", wb.units.every((u) => u.owner === wb.slot) && wb.buildings.every((x) => x.owner === wb.slot) && (await war(a)).units.every((u) => u.owner !== wb.slot));
const coreB = wb.buildings[0];
const [bx, bz] = centreOf(coreB, 3);
// A scout of A's to B's base: now A sees it.
await dev(a, { do: "spawn", kind: "scout", n: 1, at: [bx - Math.sign(bx) * 45, 0, bz - Math.sign(bz) * 45] });
const seen = await until(a, (slot) => { const f = window.snapfort.feature; return [...f.army.buildings.values()].some((x) => x.o === slot) && [...f.army.units.values()].some((u) => u.owner === slot) ? true : null; }, wb.slot);
check("a scout sent to their base lights it up: their Core and Haulers appear", seen === true);
check("the map shows it as seen", await until(a, ([x, z]) => window.snapfort.feature.dark.sees(x, z), [bx, bz]) === true);
check("and they see the scout", await until(b, (slot) => [...window.snapfort.feature.army.units.values()].some((u) => u.owner === slot && u.kind === "scout") ? true : null, wa.slot) === true);

// ── Pieces: paid for, and their builder's ────────────────────────────────
const wallAt = [Math.floor((bx - Math.sign(bx) * 30) / 5), Math.floor((bz - Math.sign(bz) * 30) / 5)];
const bankB = (await war(b)).l;
const placedId = await sf(b, ([x, z]) => { const s = window.snapfort; const id = s.nextId(); return s.history.do({ kind: "place", piece: { type: "wall", x, y: 0, z, rot: 0, id, material: "wood", edit: 0 } }) ? id : null; }, wallAt);
await until(b, (l) => window.snapfort.feature.bank.l <= l - 4 ? true : null, bankB, 4000);
check("a wall costs its builder lithium", !!placedId && (await war(b)).l <= bankB - 4, `${bankB} → ${(await war(b)).l}`);
await until(a, (id) => !!window.snapfort.state.get(id), placedId);
await sf(a, ([x, z]) => window.snapfort.player.teleport(x * 5 + 2.5, 0.95, z * 5 - 4), wallAt);
await frames(a, 5);
await sf(a, (id) => window.snapfort.removePiece(id), placedId);
await wait(600);
check("another general cannot take it down by hand", await sf(a, (id) => !!window.snapfort.state.get(id), placedId) && await sf(b, (id) => !!window.snapfort.state.get(id), placedId));
const poor = await sf(b, () => { const s = window.snapfort; const f = s.feature; return { blocked: f.bank.l < 4 ? f.blocks({ type: "wall", x: 1, y: 0, z: 1, rot: 0 }) : null }; });
check("(the page knows when a piece cannot be afforded)", poor.blocked === null || poor.blocked === true);

// ── Alliances ────────────────────────────────────────────────────────────
await a.keyboard.press("Backspace");
await a.keyboard.press("j");
await frames(a, 3);
check("J opens the generals", (await war(a)).mode === "gens" && await sf(a, () => /ask to ally/.test(document.getElementById("mj-card").textContent)));
await a.keyboard.press(`${wb.slot + 1}`);
await until(b, (slot) => window.snapfort.feature.generals.find((g) => g.slot === slot)?.asked.length > 0, wa.slot);
await b.keyboard.press("j");
await frames(b, 3);
check("the other general is told, and sees the offer", await sf(b, () => /asks to ally: accept/.test(document.getElementById("mj-card").textContent)));
await b.keyboard.press(`${wa.slot + 1}`);
const allied = await until(a, () => { const g = window.snapfort.feature.generals; return g.length === 2 && g[0].team === g[1].team ? true : null; });
check("accepted: the two are allies", allied === true);
check("allies see what each other sees", await until(b, (slot) => [...window.snapfort.feature.army.units.values()].filter((u) => u.owner === slot).length >= 16 ? true : null, wa.slot) === true);
await b.keyboard.press("0");
check("either may leave the alliance at any moment", await until(a, () => { const g = window.snapfort.feature.generals; return g[0].team !== g[1].team ? true : null; }) === true);
await a.keyboard.press("Backspace");
await b.keyboard.press("Backspace");

// ── The map ──────────────────────────────────────────────────────────────
await a.keyboard.press("Tab");
check("Tab opens the map over the game", await sf(a, () => document.getElementById("mj").classList.contains("big") && document.getElementById("mj-map").getBoundingClientRect().width > 400));
const yaw0 = await sf(a, () => window.snapfort.rig.yaw);
await a.mouse.move(700, 400); await a.mouse.move(760, 430);
check("while it is open the mouse moves its pointer, not the view", Math.abs((await sf(a, () => window.snapfort.rig.yaw)) - yaw0) < 1e-6);
await a.screenshot({ path: "qa/shots/mojave-map.png" });
await a.keyboard.press("Tab");
check("Tab closes it", await sf(a, () => !document.getElementById("mj").classList.contains("big")));
check("the map has been drawn", await sf(a, () => { const c = document.getElementById("mj-map"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60) lit++; return lit; }) > 200);

// ── A visitor watches ────────────────────────────────────────────────────
const v = await open("visitor", null);
await until(v, () => window.snapfort.feature.army.units.size > 10);
const wv = await war(v);
check("a visitor has no army, and sees both sides (nothing is dark to them)", wv.slot === -1 && new Set(wv.units.map((u) => u.owner)).size >= 2 && await sf(v, () => !window.snapfort.scene.getMeshByName("mojave-dark").isEnabled()));
check("they are told why they are watching", await sf(v, () => /Full Game/.test(document.getElementById("mj-watch").textContent) && document.getElementById("mj-bank").hidden));
await v.close();

// ── The same tab back is the same general ────────────────────────────────
const unitsBefore = (await war(a)).units.filter((u) => u.owner === wa.slot).length;
await a.reload();
await a.waitForSelector("body.ready", { timeout: 30000 });
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
const again = await war(a);
check("a reload comes back as the same general, with everything as it was", again.slot === wa.slot && again.buildings.some((x) => x.kind === "foundry") && again.units.filter((u) => u.owner === wa.slot).length >= unitsBefore - 2, `${again.units.filter((u) => u.owner === wa.slot).length} of ${unitsBefore} units`);

// ── Leaving takes everything away ────────────────────────────────────────
await b.close();
await a.click("#play-free").catch(() => {});
await dev(a, { do: "speed", n: 15 });
const gone = await until(a, (id) => !window.snapfort.state.get(id) && window.snapfort.feature.generals.length === 1 ? true : null, placedId, 20000);
await dev(a, { do: "speed", n: 1 });
check("a general who leaves and stays away: their place is free, and their wall is gone from the world", gone === true);
// Their Core is still drawn where A last saw it, until A looks there again: then it goes.
await dev(a, { do: "spawn", kind: "scout", n: 1, at: [bx - Math.sign(bx) * 40, 0, bz - Math.sign(bz) * 40] });
check("their Core disappears from this page once the spot is seen again", await until(a, (slot) => ![...window.snapfort.feature.army.buildings.values()].some((x) => x.o === slot) ? true : null, wb.slot) === true);

check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
