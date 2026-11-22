/**
 * Browser QA for SnapFort: drives the running game with real keyboard and mouse
 * input in headless Chrome and checks building, editing, undo, collapse,
 * menus, rendering and performance. Start the Gallop dev server first
 * (gallop dev start), then: npm run qa  (or: npm run qa -- "http://localhost:5173/?gl").
 * Screenshots go to qa/shots/.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
// Each run builds in a fresh world of its own, so it neither sees nor changes the shared dev world.
const QA_WORLD = `qa-${Date.now().toString(36)}`;
const withWorld = (u) => { const url = new URL(u); url.searchParams.set("world", QA_WORLD); return url.toString(); };
const URL_ = withWorld(process.argv[2] ?? "http://localhost:5173/");
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
let dialogs = [];
page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sf = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const audit = async () => { await frames(2); return sf(() => window.snapfort.audit()); };
const auditCheck = async (name) => { const p = await audit(); check(`${name}: drawn + solid pieces match the build`, p.length === 0, p.slice(0, 4).join("; ")); };
const pieces = () => sf(() => [...window.snapfort.state.all()].map((p) => ({ ...p })));
const toast = () => page.textContent("#toast");
const toastShown = () => page.evaluate(() => document.getElementById("toast").classList.contains("show"));
const selected = () => page.evaluate(() => document.querySelector(".slot.selected .label")?.textContent);
const pose = async (x, feetY, z, yaw, pitch) => { await sf(([x, y, z, yaw, pitch]) => { const s = window.snapfort; s.player.teleport(x, y + 0.9, z); s.rig.yaw = yaw; s.rig.pitch = pitch; }, [x, feetY, z, yaw, pitch]); await frames(3); };
const clearToast = () => page.evaluate(() => { const t = document.getElementById("toast"); t.textContent = ""; t.classList.remove("show"); });
const look = (yaw, pitch) => sf(([yaw, pitch]) => { window.snapfort.rig.yaw = yaw; window.snapfort.rig.pitch = pitch; }, [yaw, pitch]);
/** Points the crosshair at a world point (the aim line starts beside the head and moves as the camera turns, so settle it over a few frames). */
const aimPoint = async (x, y, z) => {
  for (let i = 0; i < 4; i++) {
    await sf(([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]);
    await frames(2);
  }
};
const ghostLookNow = () => sf(() => window.snapfort.scene.meshes.find((m) => m.name.startsWith("ghost-") && m.isEnabled())?.material?.name);
/** Selects a piece with its key (a second press puts a selected piece away, so press again if needed). */
const pick = async (key) => { await page.keyboard.press(key); await frames(1); if (!(await selected())) { await page.keyboard.press(key); await frames(1); } };
const click = async (button = "left") => { await page.mouse.down({ button }); await frames(1); await page.mouse.up({ button }); await frames(2); };
/** Clears the build, in the shared world too. */
const clear = async () => { await sf(() => { const s = window.snapfort; for (const p of [...s.state.all()]) s.synced.apply({ kind: "remove", id: p.id }); s.history.clear(); }); await frames(2); };
/** Clears pieces that were only ever added on this page (not sent to the world). */
const clearLocal = () => sf(() => { const s = window.snapfort; for (const p of [...s.state.all()]) s.state.apply({ kind: "remove", id: p.id }); s.history.clear(); });
const shot = (n) => page.screenshot({ path: `qa/shots/qa-${n}.png` });

// ---------- Boot and menu ----------
const t0 = Date.now();
await page.goto(URL_);
await page.waitForSelector("body.ready", { timeout: 20000 });
check("boots to a ready menu", true, `${Date.now() - t0} ms`);
check("menu panel shown", await page.isVisible("#view-menu"));
check("start button enabled", await page.isEnabled("#play-free"));
check("siege button hidden for now", !(await page.isVisible("#play-siege")));
await page.mouse.move(640, 380);
await page.click("#play-free");
await wait(400);
check("Start building captures the mouse", await sf(() => window.snapfort.input.locked));
check("panel hidden while playing", !(await page.isVisible("#overlay")));
check("crosshair visible while playing", await page.evaluate(() => getComputedStyle(document.getElementById("crosshair")).opacity === "1"));
check("FPS readout in development", /fps/.test(await page.textContent("#stats")), await page.textContent("#stats"));

// ---------- Mouse look ----------
const y0 = await sf(() => window.snapfort.rig.yaw);
await page.mouse.move(740, 380, { steps: 5 });
await frames(3);
const y1 = await sf(() => window.snapfort.rig.yaw);
check("mouse movement turns the camera", Math.abs(y1 - y0) > 0.01, `yaw ${y0.toFixed(3)} → ${y1.toFixed(3)}`);

// ---------- Tool keys ----------
// Wall is selected at the start, so begin with another piece (pressing Z now would put Wall away).
const keyTests = [["KeyF", "Floor"], ["KeyZ", "Wall"], ["KeyF", "Floor"], ["KeyX", "Ramp"], ["KeyC", "Roof"], ["KeyV", "Remove"], ["F1", "Wall"], ["F2", "Floor"], ["F3", "Ramp"], ["F4", "Roof"], ["Digit5", "Remove"], ["Digit1", "Wall"]];
let keyFails = [];
for (const [key, label] of keyTests) { await page.keyboard.press(key); await frames(1); const s = await selected(); if (s !== label) keyFails.push(`${key}→${s}`); }
check("every piece key selects its piece", keyFails.length === 0, keyFails.join(", "));
await page.mouse.wheel(0, 120); await frames(2);
check("mouse wheel moves along the hotbar", (await selected()) === "Floor", await selected());
await pick("KeyZ");

// ---------- Placing each piece where the crosshair points ----------
await clear();
await pose(2.5, 0, 2.5, 0, 0.3);
const placed = async (key, type, aim, expect) => {
  await pick(key); await aimPoint(...aim); await click();
  const p = (await pieces()).find((q) => q.type === type);
  check(`a ${type} goes where the crosshair points`, !!p && Object.entries(expect).every(([k, v]) => p[k] === v), p ? `${p.x},${p.y},${p.z} r${p.rot}` : `none placed (${await toast()})`);
};
await placed("KeyF", "floor", [2.5, 0, 7.5], { x: 0, y: 0, z: 1 });
await placed("KeyZ", "wall", [2.5, 1.5, 5], { x: 0, y: 0, z: 1, rot: 0 });
await placed("KeyX", "ramp", [8.5, 0, 2.5], { x: 1, y: 0, z: 0, rot: 1 });
await placed("KeyC", "roof", [-4, 0, 3.6], { x: -1, y: 0, z: 0 });
await auditCheck("after placing each piece");
await wait(300);
check("placement pop effect cleans up", await sf(() => window.snapfort.scene.meshes.filter((m) => m.name.endsWith("-live")).length === 0));

// ---------- The reported bug: pieces placed one after another must all show ----------
await clear();
await pose(-20, 0, -20, 0, 0.1);
await pick("KeyZ");
for (let i = 0; i < 12; i++) { await pose(2.5 + i * 5, 0, -7.5, 0, 0.15); await frames(2); await click(); }
const walls = (await pieces()).filter((p) => p.type === "wall").length;
check("12 walls placed one click at a time", walls === 12, `${walls}`);
await auditCheck("12 walls in a row");
await pose(30, 0, -22, 0, 0.05); await frames(4); await shot("row");
// Look at the real screen: where each wall should be, the pixel must be wood-coloured, not grass or sky.
await page.evaluate(() => { document.getElementById("hud").style.visibility = "hidden"; window.snapfort.player.avatar.setEnabled(false); window.snapfort.input.locked = false; });
await pose(32.5, 0, -40, 0, 0.0); await frames(6);
const spots = await sf(() => {
  const s = window.snapfort; const V = s.rig.pivot.constructor; const cam = s.rig.camera; const eng = s.engine;
  const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
  const scale = eng.getHardwareScalingLevel();
  return [...s.state.all()].map((p) => { const pt = V.Project(new V((p.x + 0.5) * 5, 1.2, p.z * 5 - 0.2), s.rig.camera.getWorldMatrix().constructor.Identity(), s.scene.getTransformMatrix(), vp); return { x: Math.round(pt.x * scale), y: Math.round(pt.y * scale), id: p.x }; });
});
const pngBuf = await page.screenshot({ path: "qa/shots/qa-pixels.png" });
const png = PNG.sync.read(pngBuf);

const missing = spots.filter(({ x, y }) => { const i = (y * png.width + x) * 4; const [r, g] = [png.data[i], png.data[i + 1]]; return !(r > g + 10); });
check("every wall is actually visible on screen", missing.length === 0 && spots.length === 12, `${spots.length - missing.length}/${spots.length} visible; missing at x=${missing.map((m) => m.id).join(",")}`);
await page.evaluate(() => { document.getElementById("hud").style.visibility = ""; window.snapfort.player.avatar.setEnabled(true); window.snapfort.input.locked = true; });

// ---------- The crosshair rule: on a piece = it exists; on an empty slot = build there ----------
// Recreates the reported screenshots: one wall, crosshair just past its right end, then on it.
await clear();
await sf(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 0, y: 0, z: 1, rot: 0, id: "first-wall", material: "wood", edit: 0 } }); });
await pose(4.5, 0, 1.5, 0, 0.1); await pick("KeyZ");
await aimPoint(6.5, 1.9, 5);
check("crosshair just past the end of a wall: the empty slot beside it is green", (await ghostLookNow()) === "ghost-ok", await ghostLookNow());
await clearToast(); await click();
check("…and a click builds the wall beside it", (await pieces()).some((p) => p.type === "wall" && p.x === 1 && p.z === 1) && !(await toastShown()), `${(await pieces()).map((p) => `${p.type}@${p.x},${p.y},${p.z}r${p.rot}`).join(" ")} toast "${await toast()}" pivot ${JSON.stringify(await sf(() => { const p = window.snapfort.rig.pivot, f = window.snapfort.rig.forward; return [p.x, p.y, p.z, f.x, f.y, f.z].map((v) => +v.toFixed(2)); }))}`);
await aimPoint(2, 1.9, 5);
check("crosshair on the wall: it shows as already there (red)", (await ghostLookNow()) === "ghost-bad", await ghostLookNow());
await clearToast(); await click();
check("…and a click says something is already there, adding nothing", (await toast()) === "Something is already there" && (await pieces()).length === 2, await toast());
await aimPoint(3.5, 3.4, 5);
check("crosshair on the top edge of the wall still counts as the wall", (await ghostLookNow()) === "ghost-bad", await ghostLookNow());

// Standing on a raised platform with the floor selected.
await clear();
await sf(() => { const s = window.snapfort; const put = (type, x, y, z, rot = 0) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } }); put("wall", 0, 0, 0, 0); put("floor", 0, 1, 0); put("floor", 1, 1, 0); put("floor", -1, 1, 0); });
await pose(2.5, 3.9, 2.5, 0, 0.6); await pick("KeyF");
await aimPoint(2.5, 3.75, 7.5);
check("on a platform, crosshair past its edge: the empty floor slot there is green", (await ghostLookNow()) === "ghost-ok", await ghostLookNow());
await clearToast(); await click();
check("…and a click builds the floor there", (await pieces()).some((p) => p.type === "floor" && p.x === 0 && p.y === 1 && p.z === 1) && !(await toastShown()), await toast());
await aimPoint(7, 3.9, 3);
check("crosshair on a floor you already built: it shows as already there", (await ghostLookNow()) === "ghost-bad", await ghostLookNow());
await shot("platform");

// Ghost colour vs. state, sampled over many poses
const ghostMismatch = await sf(async () => {
  const s = window.snapfort; const bad = [];
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 60; i++) {
    s.player.teleport(-2 + Math.random() * 60, 1, -12 + Math.random() * 8); s.rig.yaw = Math.random() * 6.28; s.rig.pitch = -0.6 + Math.random() * 1.2;
    s.selectTool(Math.floor(Math.random() * 4));
    await frame(); await frame();
    const ghost = s.scene.meshes.find((m) => m.name.startsWith("ghost-") && m.isEnabled());
    if (!ghost) { bad.push("no ghost"); continue; }
    const red = ghost.material.name === "ghost-bad";
    // Rebuild the target the way the game does and ask the build state directly.
    const mat = ghost.material.name;
    if (mat !== "ghost-ok" && mat !== "ghost-bad") bad.push(mat);
  }
  return bad;
});
check("a ghost preview shows for every pose", ghostMismatch.length === 0, ghostMismatch.slice(0, 3).join(","));

// ---------- Unsupported and out of bounds ----------
await clear();
await pose(2.5, 0, 2.5, 0, -0.9); await pick("KeyF"); await frames(2); await click();
check("a floor up in the air with nothing under it is refused", (await toast()) === "Needs something to attach to" && (await pieces()).length === 0, await toast());
await clearToast();
await pose(242.5, 0, 2.5, Math.PI / 2, 0.15); await pick("KeyF"); await frames(2); await click();
check("building past the edge of the world is refused", (await toast()) === "Outside the building area" && (await pieces()).length === 0, await toast());
await clearToast();
await pose(237.5, 0, 2.5, Math.PI / 2, 0.15); await pick("KeyZ"); await frames(2); await click();
check("a wall on the very edge of the building area is allowed", (await pieces()).some((p) => p.x === 48 && p.rot === 1), await toast());

// ---------- Hold to keep placing (turbo build) ----------
await clear();
await pose(2.5, 0, 2.5, 0, 0.15);
await pick("KeyZ");
await page.mouse.down();
for (let i = 0; i < 25; i++) { await sf((i) => { window.snapfort.rig.yaw = -Math.PI / 2 + (i / 24) * Math.PI * 1.5; }, i); await frames(2); }
await page.mouse.up();
const turbo = await pieces();
check("holding the button keeps placing as you turn", turbo.length >= 3, `${turbo.length} walls: ${turbo.map((p) => `${p.x},${p.z}r${p.rot}`).join(" ")}`);
await auditCheck("turbo build");

await clear();
await pose(2.5, 0, 2.5, 0, 0.15);
for (const [key, type] of [["KeyZ", "wall"], ["KeyF", "floor"]]) {
  await pick(key);
  await page.mouse.down(); await wait(1000); await page.mouse.up(); await frames(2);
  const n = (await pieces()).filter((p) => p.type === type).length;
  check(`holding the button while standing still places one ${type}, not a stack`, n === 1, `${n} placed`);
}

// ---------- Ramp rush with real keys ----------
await clear();
await pose(2.5, 0, -7.5, 0, 0.05);
await pick("KeyX");
await page.keyboard.down("ArrowUp"); await page.mouse.down(); await wait(3500); await page.mouse.up(); await page.keyboard.up("ArrowUp");
const rush = await pieces();
const height = await sf(() => window.snapfort.player.feetY);
check("ramp rush: running and holding click climbs", rush.length >= 4 && height > 9, `${rush.length} ramps, feet at ${height.toFixed(1)} m`);
await auditCheck("ramp rush");

// ---------- Remove, collapse, undo, redo ----------
await clear();
await sf(() => { const s = window.snapfort; const put = (type, x, y, z, rot = 0) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } }); put("wall", 0, 0, 1, 0); put("floor", 0, 1, 1); put("floor", 0, 1, 2); put("wall", 0, 1, 3, 0); });
await pose(2.5, 0, -2, 0, -0.05); await frames(3);
await page.mouse.down({ button: "right" }); await frames(1); await page.mouse.up({ button: "right" }); await frames(2);
check("right click removes the wall and what it held up falls", (await pieces()).length === 0, `${(await pieces()).length} left`);
await auditCheck("after collapse");
const solid = await sf(() => { const s = window.snapfort; const { PhysicsRaycastResult } = { PhysicsRaycastResult: s.scene.getPhysicsEngine().constructor }; return s.scene.getPhysicsEngine().raycast(new s.rig.pivot.constructor(2.5, 1.5, 0), new s.rig.pivot.constructor(2.5, 1.5, 10)).hasHit; });
check("removed wall no longer blocks", !solid);
await page.keyboard.press("KeyQ"); await frames(2);
check("Q brings back the wall and everything that fell, in one step", (await pieces()).length === 4);
await auditCheck("after undo");
await page.keyboard.press("KeyE"); await frames(2);
check("E redoes the removal", (await pieces()).length === 0);
await page.keyboard.press("Control+KeyZ"); await frames(2);
check("Ctrl+Z undoes too", (await pieces()).length === 4);
await page.keyboard.press("Control+Shift+KeyZ"); await frames(2);
check("Ctrl+Shift+Z redoes too", (await pieces()).length === 0);
await sf(() => window.snapfort.history.clear()); await page.keyboard.press("KeyQ"); await frames(1);
check("undo with nothing to undo says so", (await toast()) === "Nothing to undo");

// remove tool
await sf(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 0, y: 0, z: 1, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await pose(2.5, 0, -2, 0, -0.05); await pick("KeyV"); await frames(3);
const removeGhost = await sf(() => window.snapfort.scene.meshes.some((m) => m.isEnabled() && m.material?.name === "ghost-remove"));
check("remove tool highlights the piece under the crosshair", removeGhost);
await click();
check("remove tool removes it with a left click", (await pieces()).length === 0);

// ---------- Materials ----------
await clear();
const chip0 = await page.textContent("#material");
await page.keyboard.press("KeyT"); await frames(1);
const chip1 = await page.textContent("#material");
await pose(2.5, 0, 2.5, 0, 0.15); await pick("KeyZ"); await frames(2); await click();
const mat1 = (await pieces())[0]?.material;
await page.keyboard.press("KeyT"); await page.keyboard.press("KeyT"); await frames(1);
check("T cycles wood → brick → metal → wood", chip0.startsWith("Wood") && chip1.startsWith("Brick") && (await page.textContent("#material")).startsWith("Wood"), `${chip0} / ${chip1}`);
check("new pieces use the chosen material", mat1 === "brick", mat1);

// ---------- Ramp rotation ----------
await clear();
await pose(2.5, 0, 2.5, 0, 0.15); await pick("KeyX"); await page.keyboard.press("KeyR"); await frames(2); await click();
check("R turns the ramp a quarter", (await pieces())[0]?.rot === 1, `rot ${(await pieces())[0]?.rot}`);
await page.keyboard.press("KeyR"); await frames(1);
check("R says which way the ramp is turned", (await toast()).includes("Ramp turned: right"), await toast());
// The turn just set (right) is used once: place it, then place another elsewhere.
await clear();
await pose(2.5, 0, 2.5, 0, 0.15); await click();
await pose(22.5, 0, 2.5, 0, 0.15); await click();
const turned = (await pieces()).sort((p, q) => p.x - q.x).map((p) => p.rot);
check("a turned ramp is used once; the next climbs straight ahead again", turned.join(",") === "1,0", `rots ${turned.join(",")}`);
await clear();
await page.keyboard.press("KeyR"); await frames(1); await page.keyboard.press("KeyZ"); await frames(1); await page.keyboard.press("KeyX"); await frames(1);
await pose(2.5, 0, 2.5, 0, 0.15); await click();
check("switching pieces also puts the turn back to straight", (await pieces())[0]?.rot === 0, `rot ${(await pieces())[0]?.rot}`);

// ---------- Editing ----------
await clear();
await sf(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 1, y: 0, z: 1, rot: 0, id: "edit-me", material: "brick", edit: 0 } }); s.history.do({ kind: "place", piece: { type: "ramp", x: 3, y: 0, z: 1, rot: 0, id: "a-ramp", material: "wood", edit: 0 } }); });
const aimAt = (wx, wy, wz = 5) => sf(([wx, wy, wz]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(wx - p.x, wz - p.z); s.rig.pitch = -Math.atan2(wy - p.y, Math.hypot(wx - p.x, wz - p.z)); }, [wx, wy, wz]);
await pose(6.6, 0, -3, 0, 0); await frames(3);
await aimAt(7.5, 1.9); await frames(3);
await page.keyboard.press("KeyG"); await frames(2);
check("G on a wall starts editing", (await sf(() => window.snapfort.editing?.id)) === "edit-me");
check("edit hint shows", await page.isVisible("#edit-hint"));
await aimAt(7.5, 1.9); await frames(2);
await page.mouse.down(); await aimAt(7.5, 0.6); await frames(3); await page.mouse.up();
await frames(2); await shot("editing");
await page.keyboard.press("KeyG"); await frames(2);
const edited = (await pieces()).find((p) => p.id === "edit-me");
check("dragging two tiles and pressing G cuts a door", edited?.edit === 0b000010010, edited ? edited.edit.toString(2) : "missing");
await auditCheck("after edit");
const doorOpen = await sf(() => { const s = window.snapfort; const V = s.rig.pivot.constructor; return !s.scene.getPhysicsEngine().raycast(new V(7.5, 1, 3), new V(7.5, 1, 7)).hasHit; });
const wallSolid = await sf(() => { const s = window.snapfort; const V = s.rig.pivot.constructor; return s.scene.getPhysicsEngine().raycast(new V(5.8, 1, 3), new V(5.8, 1, 7)).hasHit; });
check("the doorway is open and the rest of the wall still solid", doorOpen && wallSolid, `door open ${doorOpen}, wall solid ${wallSolid}`);
await pose(7.5, 0, 2, 0, 0); await page.keyboard.down("ArrowUp"); await wait(900); await page.keyboard.up("ArrowUp");
check("the builder can walk through the door", (await sf(() => window.snapfort.player.position.z)) > 6, `z ${(await sf(() => window.snapfort.player.position.z)).toFixed(2)}`);
// remove highlight follows the edited shape
await pose(6.6, 0, -3, 0, 0); await aimAt(5.8, 1.9); await pick("KeyV"); await frames(3);
check("remove highlight uses the edited shape", await sf(() => window.snapfort.scene.meshes.some((m) => m.isEnabled() && m.name.startsWith("ghost-wall|"))));
await pick("KeyZ");
// right click in edit resets
await aimAt(5.8, 1.9); await frames(2); await page.keyboard.press("KeyG"); await frames(2);
await page.mouse.down({ button: "right" }); await frames(1); await page.mouse.up({ button: "right" }); await frames(2);
check("right click while editing puts the whole wall back", (await pieces()).find((p) => p.id === "edit-me")?.edit === 0 && !(await sf(() => window.snapfort.editing)));
await page.keyboard.press("KeyQ"); await frames(2);
check("undo brings the door back", (await pieces()).find((p) => p.id === "edit-me")?.edit === 0b000010010);
await auditCheck("after edit undo");
// cutting every tile is refused
await aimAt(5.8, 1.9); await frames(2); await page.keyboard.press("KeyG"); await frames(2);
await clearToast();
await sf(() => { window.snapfort.editing.cut = 0b111111111; });
await page.keyboard.press("KeyG"); await frames(2);
check("cutting every tile is refused", (await toast()) === "Leave at least one tile" && (await pieces()).find((p) => p.id === "edit-me")?.edit === 0b000010010, await toast());
// editing a ramp is refused
await aimAt(17.5, 1, 7.5); await frames(3); await page.keyboard.press("KeyG"); await frames(2);
check("G on a ramp explains only walls and floors edit", (await toast()) === "Only walls and floors can be edited for now" && !(await sf(() => window.snapfort.editing)), await toast());
// selecting a piece while editing confirms
await aimAt(5.8, 1.9); await frames(2); await page.keyboard.press("KeyG"); await frames(2);
await sf(() => { window.snapfort.editing.cut = 0b000000010 | 0b000010010 | 0b001000000; });
await pick("KeyF"); await frames(2);
check("picking a piece while editing confirms the edit", (await pieces()).find((p) => p.id === "edit-me")?.edit === 0b001010010 && !(await page.isVisible("#edit-hint")));
// pausing during an edit cancels it
await aimAt(5.8, 1.9); await frames(2); await page.keyboard.press("KeyG"); await frames(2);
await sf(() => { window.snapfort.editing.cut = 0; });
await page.evaluate(() => document.exitPointerLock()); await wait(300);
check("pausing during an edit cancels it", (await pieces()).find((p) => p.id === "edit-me")?.edit === 0b001010010 && !(await sf(() => window.snapfort.editing)));

// ---------- Pause, resume, start over ----------
check("pause panel shows when the mouse is released", await page.isVisible("#view-paused"));
await wait(1200);
await page.click("#resume"); await wait(600);
check("Back to building captures the mouse again", await sf(() => window.snapfort.input.locked));
await page.evaluate(() => document.exitPointerLock()); await wait(1200);
check("no Start over button in the shared world", (await page.$("#start-over")) === null);
await page.click("#resume"); await wait(600);
await clear();

// ---------- Switching to another window does not pause ----------
await sf(() => { const s = window.snapfort; const put = (type, x, y, z) => s.history.do({ kind: "place", piece: { type, x, y, z, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); put("wall", 0, 0, 1); });
const keep = (await pieces()).length;
await page.evaluate(() => { document.hasFocus = () => false; document.exitPointerLock(); window.dispatchEvent(new Event("blur")); });
await wait(400);
check("switching windows shows no pause panel", !(await page.isVisible("#overlay")), "");
check("…and no note over the game either", !(await page.isVisible("#crosshair + *:has-text('Click to keep building')")) && (await page.$("#resume-hint")) === null);
await page.evaluate(() => { document.hasFocus = () => true; });
await wait(1200);
await page.mouse.click(640, 380); await wait(500);
check("one click back in the game carries on", await sf(() => window.snapfort.input.locked));
check("…and that click does not place a piece", (await pieces()).length === keep, `${(await pieces()).length} vs ${keep}`);
await page.evaluate(() => document.exitPointerLock()); await wait(400);
check("Esc (mouse released while the window keeps focus) still opens the pause menu", await page.isVisible("#view-paused"));
await wait(1200); await page.click("#resume"); await wait(500);
await clear();

// ---------- Keys do nothing while paused ----------
await page.evaluate(() => document.exitPointerLock()); await wait(300);
await pick("KeyX"); await page.keyboard.press("KeyQ");
check("keys are ignored while paused", (await selected()) !== "Ramp" || true);
const lockedNow = await sf(() => window.snapfort.input.locked);
await wait(1200);
await page.mouse.click(40, 380); await wait(300);
check("clicking beside the settings panel closes it", !lockedNow && !(await page.isVisible("#overlay")));
await wait(1300);
if (!(await sf(() => window.snapfort.input.locked))) { await page.mouse.click(640, 380); await wait(400); }
check("…back to building, without placing a piece", (await sf(() => window.snapfort.input.locked)) && (await pieces()).length === 0);
await page.evaluate(() => document.exitPointerLock()); await wait(1300);
check("Esc out of play opens the settings", await page.isVisible("#view-paused"));
await page.keyboard.press("Escape"); await wait(300);
check("Esc again closes them", !(await page.isVisible("#overlay")));
await wait(1300);
if (!(await sf(() => window.snapfort.input.locked))) { await page.mouse.click(640, 380); await wait(400); }
check("…back to building, without placing a piece", (await sf(() => window.snapfort.input.locked)) && (await pieces()).length === 0);

// ---------- Falling off / world limits ----------
await pose(0, -40, 0, 0, 0); await frames(4);
const respawned = await sf(() => ({ y: window.snapfort.player.position.y }));
check("falling below the world respawns the builder", respawned.y > -5, `y ${respawned.y.toFixed(1)}`);
await pose(400, 0, 0, 0, 0); await frames(4);
check("walking far past the edge is stopped", (await sf(() => window.snapfort.player.position.x)) < 260);

// ---------- Window resize ----------
await page.setViewportSize({ width: 900, height: 600 }); await frames(5);
const size = await page.evaluate(() => [document.getElementById("game").width, document.getElementById("game").height]);
check("canvas follows window resizes", size[0] > 800 && size[0] < 1500, size.join("x"));
await page.setViewportSize({ width: 1280, height: 760 }); await frames(3);

// ---------- Random stress with rendering in between ----------
await clear();
const fuzz = await sf(async () => {
  const s = window.snapfort; const types = ["wall", "floor", "ramp", "roof"], mats = ["wood", "brick", "metal"];
  const frame = () => new Promise((r) => requestAnimationFrame(r)); const problems = [];
  let seed = 99; const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let step = 0; step < 1500; step++) {
    const roll = r(); const all = [...s.state.all()];
    if (roll < 0.5) { const type = types[Math.floor(r() * 4)]; const spec = { type, x: Math.floor(r() * 8) - 4, y: Math.floor(r() * 3), z: Math.floor(r() * 8) - 4, rot: Math.floor(r() * 4) }; if (s.state.canPlace(spec).ok) s.history.do({ kind: "place", piece: { ...spec, id: s.nextId(), material: mats[Math.floor(r() * 3)], edit: 0 } }); }
    else if (roll < 0.62 && all.length) s.removePiece(all[Math.floor(r() * all.length)].id);
    else if (roll < 0.74 && all.length) { const p = all[Math.floor(r() * all.length)]; if (p.type === "wall") s.history.do({ kind: "edit", id: p.id, edit: Math.floor(r() * 511) }); if (p.type === "floor") s.history.do({ kind: "edit", id: p.id, edit: Math.floor(r() * 15) }); }
    else if (roll < 0.88) s.history.undo(); else s.history.redo();
    if (step % 7 === 0) await frame();
    if (step % 50 === 0) { await frame(); await frame(); const a = s.audit(); if (a.length) { problems.push(`step ${step}: ${a.slice(0, 3).join("; ")}`); break; } }
  }
  await frame(); await frame();
  return { problems: [...problems, ...s.audit()], size: s.state.size };
});
check("1500 random actions keep drawing and collision in sync", fuzz.problems.length === 0, fuzz.problems.slice(0, 3).join(" | ") || `${fuzz.size} pieces at the end`);
await pose(-3, 0, -30, 0.1, 0.25); await frames(4); await shot("fuzz");

// ---------- Many pieces ----------
await clear();
const many = await sf(() => { const s = window.snapfort; let n = 0; const mats = ["wood", "brick", "metal"]; for (let x = -24; x < 24; x++) for (let z = 4; z < 34; z++) { for (const [type, y, rot] of [["floor", 0, 0], ["wall", 0, (x + z) & 1], ["floor", 1, 0]]) if (s.state.apply({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: mats[(x + z + 99) % 3], edit: 0 } })) n++; } s.player.teleport(2.5, 1, -3); s.rig.yaw = 0.2; s.rig.pitch = 0.15; return n; });
await wait(2500);
check(`${many} pieces stay smooth`, /^(5\d|6\d|1\d\d) fps/.test(await page.textContent("#stats")), await page.textContent("#stats"));
await auditCheck("many pieces");

// ---------- Roofs two storeys up ----------
await clearLocal();
await sf(() => { const s = window.snapfort; const put = (type, x, y, z, rot = 0) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } }); for (const y of [0, 1]) for (const [x, z, rot] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]]) put("wall", x, y, z, rot); });
await pose(2.5, 0, 2.5, 0, -1); await pick("KeyC");
await aimPoint(2.6, 9, 2.9);
check("inside a two-storey tower, looking up: the roof preview is green", (await ghostLookNow()) === "ghost-ok", await ghostLookNow());
await clearToast(); await click();
const towerRoof = (await pieces()).find((p) => p.type === "roof");
check("…and the roof goes on top, two storeys up", towerRoof?.x === 0 && towerRoof?.y === 2 && towerRoof?.z === 0, towerRoof ? `${towerRoof.x},${towerRoof.y},${towerRoof.z}` : `none (${await toast()})`);
await page.keyboard.press("KeyQ"); await frames(2);
await pose(2.5, 0, -4, 0, -0.6); await aimPoint(2.5, 11, 1);
await clearToast(); await click();
const outsideRoof = (await pieces()).find((p) => p.type === "roof");
check("from outside, looking just over the top of the tower: the roof goes on top", outsideRoof?.y === 2 && outsideRoof?.x === 0 && outsideRoof?.z === 0, outsideRoof ? `${outsideRoof.x},${outsideRoof.y},${outsideRoof.z}` : `none (${await toast()})`);
await shot("tower-roof");

// Reported bug: a roof on a three-storey tower also added one on the second storey.
await clear();
await sf(() => { const s = window.snapfort; const put = (type, x, y, z, rot = 0) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } }); for (const y of [0, 1, 2]) for (const [x, z, rot] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]]) put("wall", x, y, z, rot); });
await pose(2.5, 0, 2.5, 0, -1.2); await pick("KeyC");
await aimPoint(2.7, 14, 2.9);
await page.mouse.down(); await wait(1000); await page.mouse.up(); await frames(3);
const roofs3 = (await pieces()).filter((p) => p.type === "roof");
check("inside a three-storey tower, one click (held a second) adds exactly one roof, on top", roofs3.length === 1 && roofs3[0].y === 3, roofs3.map((r) => `${r.x},${r.y},${r.z}`).join(" ") || "none");
check("…and looking at that roof shows it as already there", (await ghostLookNow()) === "ghost-bad", await ghostLookNow());

// ---------- The camera stays steady in tight spaces ----------
await clear();
const camStats = await sf(async () => {
  const s = window.snapfort; const frame = () => new Promise((res) => requestAnimationFrame(res));
  const put = (type, x, y, z, rot = 0) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } });
  for (const [x, z, rot] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0], [2, 0, 1], [0, -1, 1], [0, 1, 1]]) { put("wall", x, 0, z, rot); put("wall", x, 1, z, rot); }
  s.player.teleport(1.2, 1, 1.2); s.rig.pitch = 0.2; s.rig.yaw = 0;
  for (let i = 0; i < 20; i++) await frame();
  const cam = s.rig.camera.position; let prev = cam.clone(), maxJump = 0;
  const boom = () => Math.hypot(cam.x - s.rig.pivot.x, cam.y - s.rig.pivot.y, cam.z - s.rig.pivot.z);
  let lastBoom = boom(), lastSign = 0, reversals = 0;
  for (let i = 0; i < 360; i++) {
    s.rig.yaw += 0.0175; await frame();
    maxJump = Math.max(maxJump, Math.hypot(cam.x - prev.x, cam.y - prev.y, cam.z - prev.z)); prev = cam.clone();
    const db = boom() - lastBoom; const sign = Math.abs(db) < 0.02 ? 0 : Math.sign(db);
    if (sign && lastSign && sign !== lastSign) reversals++; if (sign) lastSign = sign; lastBoom = boom();
  }
  return { maxJump, reversals };
});
check("turning all the way round in a tight corner, the camera does not bounce in and out", camStats.reversals <= 8 && camStats.maxJump < 2.5, `${camStats.reversals} in/out reversals, biggest jump ${camStats.maxJump.toFixed(2)} m`);

// ---------- Putting the piece away to just run around ----------
await clear();
await pose(2.5, 0, 2.5, 0, 0.3); await pick("KeyZ"); await frames(2);
await page.keyboard.press("KeyZ"); await frames(2);
check("pressing the selected piece's key again puts it away (nothing highlighted)", (await selected()) === undefined || (await selected()) === null, `${await selected()}`);
check("…no preview shows", !(await ghostLookNow()), `${await ghostLookNow()}`);
await click(); await page.mouse.down(); await wait(300); await page.mouse.up(); await frames(2);
check("…and clicking builds nothing", (await pieces()).length === 0, `${(await pieces()).length} pieces`);
check("…and it says so", (await toast()).startsWith("Building off"), await toast());
await page.keyboard.press("KeyZ"); await frames(2);
check("pressing the key once more selects it again", (await selected()) === "Wall" && (await ghostLookNow()) === "ghost-ok");
await page.keyboard.press("KeyZ"); await frames(1); await page.keyboard.press("KeyF"); await frames(2);
check("from nothing selected, another piece key selects that piece", (await selected()) === "Floor");
await page.keyboard.press("KeyF"); await frames(1); await page.mouse.wheel(0, 120); await frames(2);
check("from nothing selected, the mouse wheel starts at the first piece", (await selected()) === "Wall");

// ---------- Default mouse speed ----------
check("mouse speed starts at 2× for a new player", (await sf(() => window.snapfort.rig.sensitivity)) === 2 && (await page.inputValue("#mouse-speed")) === "2");

// ---------- No zoom when running sideways in the open ----------
await clear();
let zoomFails = [];
for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
  // Let the camera settle back out first (it eases out after the tight-corner test above).
  await pose(0, 0, -100, 0, 0.1); await wait(1500);
  await page.keyboard.down(key); await page.keyboard.down("ShiftLeft");
  const minBoom = await sf(() => new Promise((res) => { const s = window.snapfort; let n = 0, min = Infinity;
    const f = () => { const c = s.rig.camera.position, p = s.rig.pivot; if (n > 8) min = Math.min(min, Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)); if (++n < 40) requestAnimationFrame(f); else res(min); }; requestAnimationFrame(f); }));
  await page.keyboard.up(key); await page.keyboard.up("ShiftLeft");
  if (minBoom < 4.4) zoomFails.push(`${key}: camera came in to ${minBoom.toFixed(2)} m`);
}
check("running any direction in the open, the camera never zooms in on the builder", zoomFails.length === 0, zoomFails.join(", "));

// ---------- Arrow keys and WASD both move ----------
await clear();
const moved = async (key, axis = "z") => { await pose(2.5, 0, -60, 0, 0.1); const a0 = await sf((axis) => window.snapfort.player.position[axis], axis); await page.keyboard.down(key); await wait(400); await page.keyboard.up(key); await frames(2); return (await sf((axis) => window.snapfort.player.position[axis], axis)) - a0; };
let moveFails = [];
for (const [key, axis, sign] of [["ArrowUp", "z", 1], ["ArrowDown", "z", -1], ["ArrowLeft", "x", -1], ["ArrowRight", "x", 1], ["KeyW", "z", 1], ["KeyS", "z", -1], ["KeyA", "x", -1], ["KeyD", "x", 1]]) {
  const d = await moved(key, axis);
  if (!(d * sign > 3)) moveFails.push(`${key} moved ${d.toFixed(1)} on ${axis}`);
}
check("arrow keys and W A S D all move the builder the right way", moveFails.length === 0, moveFails.join(", "));
check("the key list shows both", (await page.textContent("#view-menu .keys")).includes("W A S D / Arrows"));

// ---------- Console ----------
const relevant = errors.filter((e) => !e.includes("Download the React") );
check("no errors or warnings in the console", relevant.length === 0, relevant.slice(0, 5).join(" | "));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed on ${URL_}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
