import { chromium } from "playwright-core";
const world = `ex1-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const p = await ctx.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text().slice(0, 150)));
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(`${process.env.QA_BASE ?? "http://localhost:5173"}/?world=${world}`); await p.waitForSelector("body.ready");
// 2. Settings: change name, colour, sound, graphics, mouse speed; reload.
await p.fill("#player-name", "QA Tester"); await p.press("#player-name", "Enter");
await p.click("#player-colors button:nth-child(5)");
await p.click(".switch .track");
await p.selectOption("#graphics", "saver");
await p.$eval("#mouse-speed", (el) => { el.value = "1.5"; el.dispatchEvent(new Event("input")); });
await p.reload(); await p.waitForSelector("body.ready");
out("settings after reload", await p.evaluate(() => ({ name: document.getElementById("player-name").value, color: document.querySelector("#player-colors .selected")?.dataset.color, sound: document.getElementById("sound").checked, graphics: document.getElementById("graphics").value, speed: document.getElementById("mouse-speed").value })));
await p.selectOption("#graphics", "auto"); await p.click(".switch .track");
// 1. Remove a trebuchet by aiming at its frame.
await p.click("#play-free"); await wait(300);
await p.evaluate(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: 0, y: 0, z: 2, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); s.player.teleport(2.5, 0.95, 3); s.rig.yaw = 0; s.rig.pitch = 0; });
await wait(400);
await p.keyboard.press("KeyV"); await wait(150);
// Aim at the middle of the frame, 2 m up, from 9 m away.
await p.evaluate(() => { const s = window.snapfort; const pv = s.rig.pivot; s.rig.yaw = Math.atan2(2.5 - pv.x, 12.5 - pv.z); s.rig.pitch = -Math.atan2(2.5 - pv.y, Math.hypot(2.5 - pv.x, 12.5 - pv.z)); });
await wait(300);
await p.mouse.down(); await p.mouse.up(); await wait(300);
out("trebuchet removed by aiming at its frame", await p.evaluate(() => ![...window.snapfort.state.all()].some((q) => q.type === "trebuchet")));
// 3. Esc while scoped.
await p.evaluate(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: 0, y: 0, z: 2, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); s.player.teleport(2.5, 0.95, 8); });
await wait(300); await p.keyboard.press("KeyH"); await wait(500);
out("scoped", await p.evaluate(() => ({ crew: !!window.snapfort.crewOn, scoped: document.body.classList.contains("scoped") })));
await p.evaluate(() => document.exitPointerLock()); await wait(1300);
out("after Esc", await p.evaluate(() => ({ crew: !!window.snapfort.crewOn, settingsShown: !document.getElementById("view-paused").hidden, hotbarHidden: getComputedStyle(document.getElementById("hotbar")).display })));
await p.click("#resume"); await wait(500);
out("back from settings", await p.evaluate(() => ({ crew: !!window.snapfort.crewOn, scoped: document.body.classList.contains("scoped"), locked: window.snapfort.input.locked })));
await p.keyboard.press("KeyH"); await wait(300);
// 4. Server restart mid-game.
await p.evaluate(() => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 3, y: 0, z: 3, rot: 0, id: s.nextId(), material: "brick", edit: 0 } }); });
await wait(6500); // let it save
const before = await p.evaluate(() => window.snapfort.state.size);
const { execSync } = await import("node:child_process");
execSync("gallop dev restart >/dev/null 2>&1");
await wait(1500);
out("banner during restart", await p.textContent("#net"));
await wait(8000);
out("after restart", await p.evaluate(() => ({ online: window.snapfort.net.online, pieces: window.snapfort.state.size, banner: document.getElementById("net").hidden })));
out("pieces before", before);
out("errors", errors.filter((e) => !e.includes("WebSocket connection")).slice(0, 5));
await browser.close();
