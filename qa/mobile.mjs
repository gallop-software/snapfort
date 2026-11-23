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

const controlIds = ["hotbar-wrap", "online", "t-chat", "t-ping", "t-settings", "t-undo", "t-redo", "t-jump", "t-place", "t-remove", "t-edit", "t-turn", "t-material", "t-board", "t-fire", "t-zoom", "t-leave", "crew", "edit-hint"];

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
  // A tower in the world, so its flag is up too.
  await p.evaluate(() => { const s = window.snapfort; for (let y = 0; y < 4; y++) s.history.do({ kind: "place", piece: { type: "wall", x: 8, y, z: 8, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
  await wait(2200);
  const play = await layoutProblems(p, controlIds);
  check(`${name}: playing, every control on screen and none overlapping`, play.length === 0, play.slice(0, 4).join("; "));
  // The chat line open, with a line for everyone showing.
  await p.evaluate(() => { const s = window.snapfort; s.chat.show({ by: "x", name: "Somebody Long Named", color: "#55aaff", text: "a long message to everyone that goes on and on to the limit of eighty chars", to: "all" }, s.myId, performance.now()); });
  await p.tap("#t-chat"); await wait(300);
  const chatting = await layoutProblems(p, [...controlIds.filter((id) => !["t-undo", "t-redo"].includes(id)), "chat-box", "chat-feed"]);
  const focused = await p.evaluate(() => document.activeElement?.id === "chat-input" && !document.getElementById("chat-box").hidden);
  check(`${name}: the chat line opens focused, and it and the lines fit with the controls`, focused && chatting.length === 0, chatting.slice(0, 4).join("; ") || (focused ? "" : "not open or not focused"));
  await p.tap("#chat-close"); await wait(200);
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

// ── Ramps ──
const ramps = () => sf(() => [...window.snapfort.state.all()].filter((q) => q.type === "ramp").map((q) => ({ x: q.x, y: q.y, z: q.z, rot: q.rot })));
const clearAll = () => sf(() => { const s = window.snapfort; for (const q of [...s.state.all()]) s.synced.apply({ kind: "remove", id: q.id }); s.history.clear(); });
await tap("#hotbar .slot:nth-child(3)"); await wait(150); // Ramp
// Turn lights up, shows the way, and is used once.
await clearAll(); await wait(300);
await sf(() => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -60); s.rig.yaw = 0; s.rig.pitch = 0.1; }); await wait(300);
await tap("#t-turn");
check("Turn lights up and says which way", (await p.evaluate(() => document.getElementById("t-turn").classList.contains("on"))) && (await p.textContent("#t-turn")).includes("Right"), await p.textContent("#t-turn"));
await tap("#t-place"); await wait(300);
const first = (await ramps())[0];
check("…the next ramp is turned", first?.rot === 1, `rot ${first?.rot}`);
check("…and Turn goes back to straight after it is placed", !(await p.evaluate(() => document.getElementById("t-turn").classList.contains("on"))) && (await p.textContent("#t-turn")) === "Turn");
await tap("#t-turn"); await tap("#hotbar .slot:nth-child(1)"); await tap("#hotbar .slot:nth-child(3)");
check("switching pieces also puts Turn back to straight", (await p.textContent("#t-turn")) === "Turn");
// Ramp rush: hold Place and run, with the view held, wobbling, or near a diagonal.
const rush = async (label, yaw, wobble, seconds = 4) => {
  await clearAll(); await wait(400);
  await sf(([yaw]) => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -60); s.rig.yaw = yaw; s.rig.pitch = 0.1; }, [yaw]); await wait(300);
  if (wobble) await sf(([yaw, w]) => { let t = 0; window.__wob = setInterval(() => { t += 0.05; window.snapfort.rig.yaw = yaw + Math.sin(t * 6) * w; }, 50); }, [yaw, wobble]);
  const [qx, qy] = await centre("#t-place");
  await down(3, qx, qy); await down(1, 120, 230); await move(1, 120, 168);
  let top = 0; for (let i = 0; i < seconds * 10; i++) { await wait(100); top = Math.max(top, await sf(() => window.snapfort.player.feetY)); }
  await up(1); await up(3);
  await sf(() => clearInterval(window.__wob)); await wait(300);
  const list = await ramps();
  // In the staircase, each ramp a storey up from another next to it climbs the same way.
  const mixed = list.filter((r) => list.some((o) => o.y === r.y - 1 && Math.abs(o.x - r.x) + Math.abs(o.z - r.z) === 1 && o.rot !== r.rot)).length;
  return { n: list.length, top, mixed };
};
let r = await rush("straight", 0, 0);
check("ramp rushing straight up: a tall staircase", r.n >= 12 && r.top > 40, `${r.n} ramps, feet at ${r.top.toFixed(0)} m`);
r = await rush("wobbly", 0, 0.25);
check("ramp rushing with a wobbly thumb (±14°) still climbs", r.n >= 12 && r.top > 40 && r.mixed === 0, `${r.n} ramps, feet at ${r.top.toFixed(0)} m, mixed ${r.mixed}`);
r = await rush("near diagonal", 0.72, 0.12);
check("near a diagonal with a wobbly thumb, the staircase never mixes directions", r.mixed === 0 && r.n >= 3, `${r.n} ramps, feet at ${r.top.toFixed(0)} m, mixed ${r.mixed}`);

// Chat with real touches: open, type, switch to everyone and back, send; ping.
await sf(() => { const s = window.snapfort; s.player.teleport(2.5, 0.95, -40); s.rig.yaw = 0; s.rig.pitch = 0.1; }); await wait(300);
await tap("#t-chat"); await wait(200);
check("the Chat button opens the line, focused for the keyboard", await sf(() => !document.getElementById("chat-box").hidden && document.activeElement?.id === "chat-input"));
const chatFont = await sf(() => parseFloat(getComputedStyle(document.getElementById("chat-input")).fontSize));
check("…with text big enough that iPhones do not zoom into it", chatFont >= 16, `${chatFont}px`);
check("…and no keyboard hints (they are for computers)", await sf(() => document.getElementById("chat-note").hidden));
check("…to everyone at first", (await p.textContent("#chat-to")) === "Everyone");
await p.keyboard.type("hi from my phone");
await tap("#chat-to");
check("tapping Everyone switches to Nearby and keeps the keyboard up", (await p.textContent("#chat-to")) === "Nearby" && (await sf(() => document.activeElement?.id === "chat-input")));
await tap("#chat-to"); await tap("#chat-to");
check("…and taps go back and forth", (await p.textContent("#chat-to")) === "Nearby");
await tap("#chat-send"); await wait(500);
const ownBubble = await sf(() => [...document.querySelectorAll(".chat-bubble.mine span")].map((x) => x.textContent));
check("Send sends: the message shows over the builder's own head, and the line closes", ownBubble.includes("hi from my phone") && (await sf(() => document.getElementById("chat-box").hidden && document.activeElement?.id !== "chat-input")), JSON.stringify(ownBubble));
check("…and the touch controls work again", await sf(() => !window.snapfort.input.typing));
check("…and the bubble stays clear of the pieces bar at the top", await sf(() => { const b = document.querySelector(".chat-bubble.mine")?.getBoundingClientRect(); const bar = document.getElementById("hotbar-wrap").getBoundingClientRect(); return !!b && b.top >= bar.bottom - 1; }));
await tap("#t-chat"); await wait(200);
check("the line opens to whoever it talked to last (nearby)", (await p.textContent("#chat-to")) === "Nearby");
await p.keyboard.type("draft");
await tap("#chat-close"); await wait(200);
check("✕ closes the line", await sf(() => document.getElementById("chat-box").hidden));
await wait(1800);
await sf(() => { window.snapfort.rig.pitch = 0.5; }); await frames(3);
await tap("#t-ping"); await wait(500);
check("Ping marks the spot the crosshair is on", await sf(() => document.querySelectorAll(".chat-pin").length === 1), await p.textContent("#toast"));
await p.screenshot({ path: "qa/shots/mobile-chat.png" });
check("chatting never scrolled or zoomed the page", await sf(() => scrollX === 0 && scrollY === 0 && (visualViewport?.scale ?? 1) === 1));

// Settings and back.
await tap("#t-settings"); await wait(500);
check("the gear opens the settings, and the controls hide", await p.isVisible("#view-paused") && !(await p.isVisible("#t-place")));
await tap("#resume"); await wait(500);
check("Back to building returns to play", await sf(() => window.snapfort.input.locked) && (await p.isVisible("#t-place")));
check("the gear does not stay stuck looking pressed", !(await p.evaluate(() => document.getElementById("t-settings").classList.contains("pressed"))));
// Pinching (on the hotbar, a button, the open screen and the menu) never zooms the page.
const zoomOff = await sf(() => ["#hotbar", "#t-jump", "#touch-layer", "canvas"].every((sel) => getComputedStyle(document.querySelector(sel)).touchAction === "none") && getComputedStyle(document.body).touchAction === "pan-x pan-y");
check("touch zoom is switched off on every control and the page", zoomOff);
for (const sel of ["#hotbar", "#t-jump", "#t-place"]) {
  const [x, y] = await centre(sel);
  await cdp.send("Input.synthesizePinchGesture", { x, y, scaleFactor: 2.5, relativeSpeed: 1600, gestureSourceType: "touch" }).catch(() => {});
  await wait(200);
}
await tap("#t-settings"); await wait(400);
await cdp.send("Input.synthesizePinchGesture", { x: W / 2, y: H / 2, scaleFactor: 2.5, relativeSpeed: 1600, gestureSourceType: "touch" }).catch(() => {});
await wait(200);
await tap("#resume"); await wait(400);
check("pinching the hotbar, the buttons or the menu leaves the page at its size", await sf(() => (visualViewport?.scale ?? 1) === 1), `scale ${await sf(() => visualViewport?.scale)}`);
// Nothing scrolled or zoomed the page.
check("the page never scrolled or zoomed", await sf(() => scrollX === 0 && scrollY === 0 && (visualViewport?.scale ?? 1) === 1));

check("no errors on any phone or tablet", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
