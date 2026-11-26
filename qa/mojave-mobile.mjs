/**
 * Mojave on phones and tablets: its own controls (the bank, the map, the row
 * with its menus, the line of what is selected, and the five buttons by the
 * right thumb) fit every screen with nothing covering anything else, and a
 * general can do everything by touch: select, order a unit made, put a
 * building down, pick the army, send it.
 * Needs the Gallop dev server with Stripe test keys in .dev.vars.
 * Run: npm run qa:mojave-mobile
 */
import { chromium, devices } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `mojm-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = await paidKey(base, "/mojave");

/** What did not fit while each page was choosing its army. */
const choosing = [];
async function open(device, n) {
  const ctx = await browser.newContext({ ...device });
  await ctx.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && errors.push(m.text().slice(0, 200)));
  await p.goto(`${base}/mojave?world=${world}${n}`);
  await p.waitForSelector("body.ready", { timeout: 30000 });
  await p.tap("#play-free");
  // Arriving: the eight armies to choose from, as tiles along the top. A tap on one serves it.
  await p.waitForFunction(() => window.snapfort.feature.why === "choose" && document.querySelectorAll('#hotbar .slot[data-id^="serve:"]').length === 8, null, { timeout: 15000 });
  await wait(300);
  choosing.push(await layoutProblems(p));
  await p.tap('#hotbar .slot[data-id="serve:0"]');
  await p.waitForFunction(() => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4, null, { timeout: 15000 });
  // (For the checks: this army as a war begins it.)
  const old = await p.evaluate(() => [...window.snapfort.feature.army.buildings.keys()]);
  await p.evaluate(() => window.snapfort.net.sendWorld({ m: "dev", do: "fresh" }));
  await p.waitForFunction((old) => { const f = window.snapfort.feature; const mine = [...f.army.buildings.values()].filter((b) => b.o === f.slot); return mine.length === 1 && !old.includes(mine[0].i) && [...f.army.units.values()].filter((u) => u.owner === f.slot).length === 4; }, old, { timeout: 15000 });
  await wait(600);
  return { p, ctx };
}
const frames = (p, n = 3) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const until = async (p, fn, arg, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await p.evaluate(fn, arg); if (v || Date.now() > end) return v; await wait(120); } };
async function aim(p, spot) {
  for (let i = 0; i < 4; i++) {
    await frames(p, 3);
    await p.evaluate(([x, y, z]) => { const s = window.snapfort, c = s.rig.pivot; const dx = x - c.x, dy = y - c.y, dz = z - c.z; s.rig.yaw = Math.atan2(dx, dz); s.rig.pitch = Math.atan2(-dy, Math.hypot(dx, dz)); }, spot);
  }
  await frames(p, 3);
}

/** Everything shown that goes off the screen, and shown controls that overlap. */
const layoutProblems = (p) => p.evaluate(() => {
  const W = innerWidth, H = innerHeight, problems = [];
  const shown = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && el.closest("[hidden]") === null; };
  for (const el of document.querySelectorAll("#hud *, #touch *")) {
    if (!shown(el) || el.closest("#toast, #banner, #joy-base, #mj-notes")) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) problems.push(`${el.id || el.dataset.id || el.className || el.tagName} off screen (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
  }
  const ids = ["hotbar-wrap", "online", "t-chat", "t-ping", "t-settings", "t-undo", "t-redo", "t-jump", "t-place", "t-remove", "t-edit", "t-turn", "t-material", "t-board", "mj-bank", "mj-status", "mj-map", "mj-touch", "world-panel"];
  const boxes = ids.map((id) => [id, document.getElementById(id)]).filter(([, el]) => shown(el)).map(([id, el]) => [id, el.getBoundingClientRect()]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, ra] = boxes[i], [b, rb] = boxes[j];
    if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) problems.push(`${a} overlaps ${b}`);
  }
  if (document.documentElement.scrollWidth > W + 1) problems.push(`page is ${document.documentElement.scrollWidth}px wide`);
  return problems;
});

// ── 1. Fit on many screens, in every state the row has ───────────────────
const screens = ["iPhone 13 landscape", "iPhone SE landscape", "iPhone 14 Pro Max landscape", "Pixel 5 landscape", "Galaxy S9+ landscape", "iPad Mini landscape", "iPad Pro 11 landscape"];
let n = 0;
for (const name of screens) {
  const device = devices[name];
  if (!device) { check(`(${name} is known to the browser)`, false); continue; }
  const { p, ctx } = await open(device, n++);
  check(`${name}: it is a phone or tablet to the game, playing`, await p.evaluate(() => document.body.classList.contains("touch") && document.body.classList.contains("playing")));
  const states = [];
  states.push(["choosing an army", choosing[choosing.length - 1]]);
  states.push(["nothing selected", await layoutProblems(p)]);
  check(`${name}: there is no material button (one material), and the bank is on screen`, await p.evaluate(() => getComputedStyle(document.getElementById("t-material")).display === "none" && /Lithium/.test(document.getElementById("mj-bank").textContent) && document.getElementById("mj-bank").getBoundingClientRect().width > 50));
  await p.evaluate(() => window.snapfort.feature.run("menu:0"));
  await wait(700);
  states.push(["the build menu", await layoutProblems(p)]);
  const most = await p.evaluate(() => document.querySelectorAll("#hotbar .slot").length);
  check(`${name}: the build menu's eight tiles fit across the top`, most === 8 && await p.evaluate(() => { const b = document.getElementById("hotbar").getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }), `${most} tiles`);
  await p.evaluate(() => { const f = window.snapfort.feature; f.run("desel"); for (const u of f.army.units.values()) f.selected.add(u.id); f.run("o:move"); f.run("desel"); for (const u of f.army.units.values()) f.selected.add(u.id); });
  await wait(700);
  states.push(["Haulers selected", await layoutProblems(p)]);
  await p.evaluate(() => { const f = window.snapfort.feature; f.run("desel"); f.selectedBuildings.add([...f.army.buildings.keys()][0]); });
  await wait(700);
  states.push(["the Core selected", await layoutProblems(p)]);
  await p.evaluate(() => { const f = window.snapfort.feature; f.run("desel"); f.run("menu:cmd"); });
  await wait(700);
  states.push(["the general's own menu", await layoutProblems(p)]);
  await p.evaluate(() => window.snapfort.feature.run("b:foundry"));
  await wait(700);
  states.push(["placing a building", await layoutProblems(p)]);
  check(`${name}: the row's tiles are all on the screen, none under another`, await p.evaluate(() => { const r = [...document.querySelectorAll("#hotbar .slot")].map((x) => x.getBoundingClientRect()); return r.length >= 2 && r.every((b, i) => b.width > 20 && b.left >= 0 && b.right <= innerWidth && (i === 0 || b.left >= r[i - 1].right - 1)); }));
  const bad = states.filter(([, list]) => list.length > 0);
  check(`${name}: everything fits, nothing covers anything else`, bad.length === 0, bad.map(([s, list]) => `${s}: ${list.slice(0, 3).join("; ")}`).join(" | "));
  if (name === "iPhone 13 landscape") await p.screenshot({ path: "qa/shots/mojave-phone.png" });
  await ctx.close();
}

// ── 2. Playing by touch, on an iPhone held sideways ──────────────────────
const { p, ctx } = await open(devices["iPhone 13 landscape"], "play");
const core = await p.evaluate(() => { const b = [...window.snapfort.feature.army.buildings.values()][0]; return { id: b.i, x: (b.x + 1.5) * 5, z: (b.z + 1.5) * 5 }; });
await aim(p, [core.x, 3, core.z]);
await p.tap('[data-id="t-select"]');
check("Select, with the crosshair on the Core, selects it", await until(p, (id) => window.snapfort.feature.selectedBuildings.has(id), core.id));
await until(p, () => window.snapfort.feature.bank.l >= 50, null, 20000);
await frames(p, 30);
await p.tap('#hotbar .slot[data-id="make:hauler"]');
check("a tap on the row's Hauler tile orders one", await until(p, (id) => window.snapfort.feature.army.buildings.get(id).q.length === 1, core.id));
await p.evaluate(() => window.snapfort.net.sendWorld({ m: "dev", do: "rich" }));
await until(p, () => window.snapfort.feature.bank.l > 10000);
await p.tap('[data-id="t-menu"]');
await frames(p, 4);
await wait(600);
check("Build opens the build menu on the row", await p.evaluate(() => !!document.querySelector('#hotbar .slot[data-id="b:foundry"]')));
await p.tap('#hotbar .slot[data-id="b:foundry"]');
await frames(p, 4);
check("picking a building turns the main button into Place", await p.evaluate(() => document.querySelector('[data-id="t-select"]').textContent === "Place"));
const site = [core.x - Math.sign(core.x || 1) * 30, core.z - Math.sign(core.z || 1) * 30];
await p.evaluate(([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [site[0] + Math.sign(core.x || 1) * 14, site[1] + Math.sign(core.z || 1) * 14]);
await aim(p, [site[0], 0, site[1]]);
await p.tap('[data-id="t-select"]');
check("Place puts the Foundry down", await until(p, () => [...window.snapfort.feature.army.buildings.values()].some((b) => b.kind === "foundry")));
// An army, picked with one button and sent with another.
await p.evaluate(([x, z]) => window.snapfort.net.sendWorld({ m: "dev", do: "spawn", kind: "trooper", n: 8, at: [x, 0, z] }), [site[0] - Math.sign(core.x || 1) * 30, site[1]]);
await until(p, () => [...window.snapfort.feature.army.units.values()].filter((u) => u.kind === "trooper").length >= 8);
await p.tap('[data-id="t-army"]');
check("Army picks every fighting unit", await until(p, () => window.snapfort.feature.selected.size === 8));
await wait(600);
check("the row shows their orders as tiles to tap, and what is selected is said under the bank", await p.evaluate(() => ["o:move", "o:amove", "o:stop", "o:hold"].every((id) => document.querySelector(`#hotbar .slot[data-id="${id}"]`)) && /8 selected/.test(document.getElementById("mj-status").textContent)));
const from = await p.evaluate(() => { const f = window.snapfort.feature; const us = [...f.army.units.values()].filter((u) => f.selected.has(u.id)); return [us.reduce((s, u) => s + u.x, 0) / us.length, us.reduce((s, u) => s + u.z, 0) / us.length]; });
const dest = [from[0], from[1] - Math.sign(core.z || 1) * 30];
await p.evaluate(([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [from[0] + 12, from[1] + Math.sign(core.z || 1) * 14]);
await aim(p, [dest[0], 0, dest[1]]);
await p.tap('[data-id="t-order"]');
const moved = await until(p, ([x, z]) => { const f = window.snapfort.feature; const us = [...f.army.units.values()].filter((u) => f.selected.has(u.id)); const cx = us.reduce((s, u) => s + u.x, 0) / us.length, cz = us.reduce((s, u) => s + u.z, 0) / us.length; return Math.hypot(cx - x, cz - z) < 10; }, dest, 12000);
check("Order, with the crosshair on the ground, sends them there", moved === true);
await p.tap('#hotbar .slot[data-id="back"]');
check("Deselect lets go, and the pieces are back on the row", await until(p, () => window.snapfort.feature.selected.size === 0) && await until(p, () => [...document.querySelectorAll("#hotbar .slot .label")].some((l) => l.textContent === "Wall")));
await p.tap("#hotbar .slot:last-child");
check("a tap on Command opens the general's own menu", await until(p, () => !!document.querySelector('#hotbar .slot[data-id="army"]')));
await p.tap('#hotbar .slot[data-id="back"]');
await p.tap('[data-id="t-map"]');
check("Map opens the map", await until(p, () => document.getElementById("mj").classList.contains("big")));
await p.tap('[data-id="t-map"]');
check("the walking joystick still works", await (async () => {
  const p0 = await p.evaluate(() => [window.snapfort.player.position.x, window.snapfort.player.position.z]);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 120, y: 240, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 120, y: 180, id: 1 }] });
  await wait(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const p1 = await p.evaluate(() => [window.snapfort.player.position.x, window.snapfort.player.position.z]);
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 2;
})());
await ctx.close();

check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
