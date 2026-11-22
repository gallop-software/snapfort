/**
 * Mobile QA: SnapFort on phones and tablets, with simulated multi-touch.
 *
 * 1. Fit: on several phones and tablets (landscape, and portrait), every menu,
 *    settings panel and on-screen control stays inside the screen, and the
 *    controls do not cover each other or the readouts.
 * 2. Play: on an iPhone held sideways, every control works with real touch
 *    events: joystick (and running), looking, placing (and holding to keep
 *    placing), jump, picking pieces, remove, edit, material, turn, undo/redo,
 *    trebuchets (get on, drag to aim, fire, zoom, get off), settings.
 *
 * Start the Gallop dev server first, then: npm run qa:mobile
 */
import { chromium, devices } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function open(device, world) {
  const ctx = await browser.newContext({ ...device });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`[${device.viewport.width}x${device.viewport.height}] ${e.message.slice(0, 200)}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && errors.push(m.text().slice(0, 200)));
  const url = new URL(base); url.searchParams.set("world", world);
  await p.goto(url.toString()); await p.waitForSelector("body.ready", { timeout: 30000 });
  const cdp = await ctx.newCDPSession(p);
  return { p, ctx, cdp };
}

/** Everything shown that goes off the screen, and shown controls that overlap. */
const layoutProblems = (p, ids) => p.evaluate((ids) => {
  const W = innerWidth, H = innerHeight, problems = [];
  const shown = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && el.closest("[hidden]") === null; };
  // Off screen: anything visible in the HUD, the touch controls or the menu panel.
  for (const el of document.querySelectorAll("#hud *, #touch *, #overlay .panel")) {
    if (!shown(el) || el.closest("#toast, #banner, #joy-base")) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) problems.push(`${el.id || el.className || el.tagName} off screen (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
  }
  // Overlaps between the controls and readouts that matter.
  const boxes = ids.map((id) => [id, document.getElementById(id)]).filter(([, el]) => shown(el)).map(([id, el]) => [id, el.getBoundingClientRect()]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, ra] = boxes[i], [b, rb] = boxes[j];
    if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) problems.push(`${a} overlaps ${b}`);
  }
  // The page itself must not scroll sideways.
  if (document.documentElement.scrollWidth > W + 1) problems.push(`page is ${document.documentElement.scrollWidth}px wide`);
  return problems;
}, ids);

const controlIds = ["hotbar-wrap", "online", "towers", "t-settings", "t-undo", "t-redo", "t-jump", "t-place", "t-remove", "t-edit", "t-turn", "t-material", "t-board", "t-fire", "t-zoom", "t-leave", "crew", "edit-hint"];

// ── 1. Fit on many screens ───────────────────────────────────────────────
const screens = [
  ["iPhone 13 landscape", devices["iPhone 13 landscape"]],
  ["iPhone SE landscape", devices["iPhone SE landscape"]],
  ["iPhone 15 Pro Max landscape", devices["iPhone 15 Pro Max landscape"] ?? devices["iPhone 14 Pro Max landscape"]],
  ["Pixel 7 landscape", devices["Pixel 7 landscape"]],
  ["Galaxy S8 landscape (small)", devices["Galaxy S8 landscape"] ?? devices["Galaxy S9+ landscape"]],
  ["iPad Mini landscape", devices["iPad Mini landscape"]],
  ["iPad Pro 11 landscape", devices["iPad Pro 11 landscape"]],
].filter(([, d]) => d);
for (const [name, device] of screens) {
  const { p, ctx } = await open(device, `mfit-${Date.now().toString(36)}`);
  const size = `${device.viewport.width}x${device.viewport.height}`;
  const menu = await layoutProblems(p, []);
  const menuFits = await p.evaluate(() => { const o = document.getElementById("overlay"); return o.scrollHeight <= o.clientHeight + 1; });
  check(`${name} ${size}: the menu fits, nothing off screen`, menu.length === 0 && menuFits, [...menu, menuFits ? "" : "menu needs scrolling"].filter(Boolean).slice(0, 4).join("; "));
  await p.tap("#play-free"); await wait(800);
  // A tower in the world, so the tallest-towers board shows too.
  await p.evaluate(() => { const s = window.snapfort; for (let y = 0; y < 4; y++) s.history.do({ kind: "place", piece: { type: "wall", x: 8, y, z: 8, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
  await wait(2200);
  const play = await layoutProblems(p, controlIds);
  check(`${name}: playing, every control on screen and none overlapping`, play.length === 0, play.slice(0, 4).join("; "));
  // On a trebuchet.
  await p.evaluate(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); s.player.teleport(2.5, 0.95, -3); });
  await wait(400);
  const boardShown = await p.isVisible("#t-board");
  const board = await layoutProblems(p, controlIds);
  if (boardShown) { await p.tap("#t-board"); await wait(500); }
  const crew = await layoutProblems(p, controlIds);
  if (await p.isVisible("#t-board")) crew.push("Get on still shown on the trebuchet");
  check(`${name}: Get on button and trebuchet controls fit`, boardShown && board.length === 0 && crew.length === 0, [...board, ...crew].slice(0, 4).join("; ") || (boardShown ? "" : "no Get on button"));
  // Settings while playing.
  await p.tap("#t-settings"); await wait(600);
  const settings = await layoutProblems(p, []);
  const settingsFit = await p.evaluate(() => { const o = document.getElementById("overlay"); return !document.getElementById("view-paused").hidden && o.scrollHeight <= o.clientHeight + 1; });
  check(`${name}: the settings panel fits`, settings.length === 0 && settingsFit, settings.slice(0, 4).join("; ") || (settingsFit ? "" : "settings need scrolling or did not open"));
  await ctx.close();
}
// Portrait: turn sideways.
for (const [name, device] of [["iPhone 13 portrait", devices["iPhone 13"]], ["Pixel 7 portrait", devices["Pixel 7"]]]) {
  const { p, ctx } = await open(device, "mfit-portrait");
  check(`${name}: asks to turn the phone sideways`, await p.isVisible("#rotate"));
  await ctx.close();
}
// A computer is unchanged: no touch controls, keys listed.
{
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const url = new URL(base); url.searchParams.set("world", "mfit-desk");
  await p.goto(url.toString()); await p.waitForSelector("body.ready");
  check("a computer gets no touch controls, and the key list", !(await p.evaluate(() => document.body.classList.contains("touch") || !!document.getElementById("touch"))) && (await p.isVisible(".keys")));
  await p.context().close();
}

// ── 2. Play with touch on an iPhone ──────────────────────────────────────
const { p, cdp } = await open(devices["iPhone 13 landscape"], `mplay-${Date.now().toString(36)}`);
const sf = (fn, arg) => p.evaluate(fn, arg);
const frames = (n = 3) => p.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const touches = new Map();
const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...touches].map(([id, [x, y]]) => ({ x, y, id })) });
const down = async (id, x, y) => { touches.set(id, [x, y]); await send("touchStart"); };
const move = async (id, x, y) => { touches.set(id, [x, y]); await send("touchMove"); };
const up = async (id) => { const pt = touches.get(id); touches.delete(id); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [...touches].map(([i, [x, y]]) => ({ x, y, id: i })).concat([]) }); return pt; };
const centre = (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
const tap = async (sel) => { const [x, y] = await centre(sel); await down(90, x, y); await frames(2); await up(90); await frames(2); };
const W = 750, H = 342;
const pos = () => sf(() => { const q = window.snapfort.player.position; return { x: q.x, y: q.y, z: q.z }; });
const pieces = () => sf(() => [...window.snapfort.state.all()].map((q) => ({ type: q.type, x: q.x, y: q.y, z: q.z, material: q.material, edit: q.edit, id: q.id })));

await tap("#play-free"); await wait(500);
check("tapping Start building starts play on a phone", await sf(() => window.snapfort.input.locked) && !(await p.isVisible("#overlay")));
check("graphics default to battery saver on a phone", (await sf(() => window.snapfort.graphics.effective)) === "saver");
await sf(() => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -40); s.rig.yaw = 0; s.rig.pitch = 0.1; });
await wait(300);

// Joystick: push up = forward; all the way = run.
let a = await pos();
await down(1, 120, 230); await move(1, 120, 205); await wait(700);
let b = await pos();
await move(1, 120, 160); await wait(700);
const c = await pos();
await up(1); await wait(200);
const walk = b.z - a.z, run = c.z - b.z;
check("the joystick walks forward, and runs when pushed all the way", walk > 3 && run > walk * 1.2, `walked ${walk.toFixed(1)} m, then ran ${run.toFixed(1)} m in the same time`);
check("the joystick disappears when let go", !(await p.isVisible("#joy-base")));

// Look: drag on the right.
const yaw0 = await sf(() => window.snapfort.rig.yaw);
await down(2, 450, 170); for (let i = 1; i <= 5; i++) await move(2, 450 + i * 20, 170); await up(2); await frames(3);
const yaw1 = await sf(() => window.snapfort.rig.yaw);
check("dragging on the right turns the view", yaw1 - yaw0 > 0.1, `yaw ${yaw0.toFixed(2)} → ${yaw1.toFixed(2)}`);
// Both thumbs at once.
a = await pos();
await down(1, 120, 230); await move(1, 120, 200); await down(2, 450, 170);
for (let i = 1; i <= 6; i++) { await move(2, 450 + i * 12, 170); await wait(80); }
await up(2); await up(1); await frames(3);
b = await pos();
check("moving and looking at the same time (two thumbs)", Math.hypot(b.x - a.x, b.z - a.z) > 2 && (await sf(() => window.snapfort.rig.yaw)) - yaw1 > 0.05);

// Place: tap builds the piece under the crosshair.
await sf(() => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -6); s.rig.yaw = 0; s.rig.pitch = 0.1; });
await wait(300);
const n0 = (await pieces()).length;
await tap("#t-place"); await wait(300);
check("tapping Place builds a wall", (await pieces()).length === n0 + 1 && (await pieces()).some((q) => q.type === "wall"), `${(await pieces()).length - n0} placed`);
// Hold Place while walking: keeps placing.
await sf(() => { const s = window.snapfort; s.player.teleport(-30, 0.95, -40); s.rig.yaw = 0; s.rig.pitch = 0.35; });
await tap("#hotbar .slot:nth-child(2)"); await wait(200);
check("tapping the hotbar picks a piece", (await p.textContent(".slot.selected .label")) === "Floor");
const n1 = (await pieces()).length;
const [px, py] = await centre("#t-place");
await down(3, px, py); await down(1, 120, 230); await move(1, 120, 195); await wait(1600); await up(1); await up(3); await wait(300);
check("holding Place while walking keeps placing floors", (await pieces()).length - n1 >= 3, `${(await pieces()).length - n1} floors`);

// Jump.
await sf(() => window.snapfort.player.teleport(40, 0.95, -40)); await wait(300);
const y0 = (await pos()).y;
const [jx, jy] = await centre("#t-jump");
await down(4, jx, jy); await wait(120); await up(4);
let peak = y0; for (let i = 0; i < 8; i++) { await wait(50); peak = Math.max(peak, (await pos()).y); }
check("Jump jumps", peak - y0 > 1, `rose ${(peak - y0).toFixed(1)} m`);

// Material and Turn.
const mat0 = await p.textContent("#t-material .name");
await tap("#t-material");
check("Material changes the material", (await p.textContent("#t-material .name")) !== mat0, `${mat0} → ${await p.textContent("#t-material .name")}`);
await tap("#t-material"); await tap("#t-material");

// Remove: aim at the wall built earlier.
await sf(() => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -6); s.rig.yaw = 0; s.rig.pitch = 0.05; });
await tap("#hotbar .slot:nth-child(1)"); await wait(300);
const walls0 = (await pieces()).filter((q) => q.type === "wall").length;
await tap("#t-remove"); await wait(300);
check("Remove takes away the piece under the crosshair", (await pieces()).filter((q) => q.type === "wall").length === walls0 - 1);
await tap("#t-undo"); await wait(300);
check("Undo puts it back", (await pieces()).filter((q) => q.type === "wall").length === walls0);
await tap("#t-redo"); await wait(300); await tap("#t-undo"); await wait(300);

// Edit: cut the middle bottom tile (a door), Done.
const wall = (await pieces()).find((q) => q.type === "wall" && q.y === 0);
await tap("#t-edit"); await wait(300);
check("Edit starts editing, and the buttons become Cut / Reset / Done", await sf(() => !!window.snapfort.editing) && (await p.textContent("#t-place")) === "Cut" && (await p.textContent("#t-edit")) === "Done");
check("…with an edit hint in touch words, on screen", (await p.isVisible("#edit-hint .mobile")) && (await layoutProblems(p, controlIds)).length === 0);
await sf(([x, z]) => { const s = window.snapfort; const pv = s.rig.pivot; const tx = (x + 0.5) * 5, ty = 0.6, tz = z * 5; s.rig.yaw = Math.atan2(tx - pv.x, tz - pv.z); s.rig.pitch = -Math.atan2(ty - pv.y, Math.hypot(tx - pv.x, tz - pv.z)); }, [wall.x, wall.z]);
await frames(4);
await tap("#t-place"); await wait(200);
await tap("#t-edit"); await wait(400);
const edited = (await pieces()).find((q) => q.id === wall.id);
check("Cut and Done cut a tile out of the wall", edited && edited.edit !== 0, `edit bits ${edited?.edit}`);

// Trebuchet: build, Get on, drag to aim, fire, zoom, get off.
await sf(() => { const s = window.snapfort; s.player.teleport(32.5, 0.95, 12); s.rig.yaw = 0; s.rig.pitch = 0.1; for (let y = 0; y < 4; y++) s.history.do({ kind: "place", piece: { type: "wall", x: 6, y, z: 16, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await tap("#hotbar .slot:nth-child(6)"); await wait(200);
await sf(() => { const s = window.snapfort; s.rig.pitch = 0.5; }); await frames(4);
await tap("#t-place"); await wait(400);
const treb = (await pieces()).find((q) => q.type === "trebuchet");
check("the trebuchet piece is built with Place", !!treb);
await wait(300);
check("standing by it shows a Get on button", await p.isVisible("#t-board"));
await tap("#t-board"); await wait(500);
check("Get on puts the builder on it, with Fire, Zoom and Get off", !!(await sf(() => window.snapfort.crewOn)) && (await p.isVisible("#t-fire")) && (await p.isVisible("#t-zoom")) && (await p.isVisible("#t-leave")) && !(await p.isVisible("#t-place")) && !(await p.isVisible("#t-jump")));
// Look at open ground about 60 m ahead, then drag a little to aim (staying in range).
await sf(() => { const s = window.snapfort; const pv = s.rig.pivot; s.rig.yaw = Math.atan2(32.5 - pv.x, 72 - pv.z) - 0.05; s.rig.pitch = -Math.atan2(0 - pv.y, Math.hypot(32.5 - pv.x, 72 - pv.z)); });
await frames(3);
await down(2, 450, 170); for (let i = 1; i <= 3; i++) await move(2, 450 + i * 3, 170); await up(2); await frames(4);
const tgt = await sf(() => window.snapfort.target);
check("dragging aims the trebuchet (the crosshair is the target)", !!tgt, JSON.stringify(tgt?.map((v) => Math.round(v))));
const z0 = await sf(() => window.snapfort.rig.zoom);
await tap("#t-zoom");
check("Zoom zooms", (await sf(() => window.snapfort.rig.zoom)) === z0 + 1);
await tap("#t-zoom"); await tap("#t-zoom"); await tap("#t-zoom");
check("…and wraps back to no zoom", (await sf(() => window.snapfort.rig.zoom)) === 0);
await tap("#t-fire"); await wait(400);
check("Fire throws a stone", (await p.textContent("#crew")).includes("reloading"), await p.textContent("#crew"));
await tap("#t-leave"); await wait(300);
check("Get off returns to building", !(await sf(() => window.snapfort.crewOn)) && (await p.isVisible("#t-place")));

// Settings and back.
await tap("#t-settings"); await wait(500);
check("the gear opens the settings, and the controls hide", await p.isVisible("#view-paused") && !(await p.isVisible("#t-place")));
await tap("#resume"); await wait(500);
check("Back to building returns to play", await sf(() => window.snapfort.input.locked) && (await p.isVisible("#t-place")));
// Nothing scrolled or zoomed the page.
check("the page never scrolled or zoomed", await sf(() => scrollX === 0 && scrollY === 0 && (visualViewport?.scale ?? 1) === 1));

check("no errors on any phone or tablet", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
