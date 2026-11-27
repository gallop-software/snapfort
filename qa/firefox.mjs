/**
 * Firefox: clicks reach the game. Babylon cancels every pointerdown on the
 * canvas, and Firefox (keeping to the standard) then sends no mousedown, so
 * the game reads its buttons from pointer events. Here, in Playwright's own
 * Firefox: that is still so, the mouse is captured on Play, and in Mojave a
 * Foundry is put down with a click. Needs the Gallop dev server, and
 * Playwright's Firefox (npx playwright-core install firefox).
 * Run: npm run qa:firefox   (npm run qa:firefox -- headed, to watch it)
 */
import { firefox } from "playwright-core";
import { paidKey } from "./_paid.mjs";
const headless = process.argv[2] !== "headed";
const shots = "qa/shots";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await firefox.launch({ headless });
console.log("firefox", b.version(), headless ? "headless" : "headed");
// 1. The cause: does Firefox send mousedown after a cancelled pointerdown?
{
  const p = await b.newPage();
  await p.setContent(`<canvas id=c width=300 height=200></canvas><script>window.log=[];const c=document.getElementById('c');c.addEventListener('pointerdown',e=>{log.push('pointerdown');e.preventDefault();});c.addEventListener('mousedown',()=>log.push('mousedown'));</script>`);
  await p.mouse.move(100, 100); await p.mouse.down(); await p.mouse.up();
  const log = await p.evaluate(() => window.log);
  check("Firefox sends no mousedown after a cancelled pointerdown (why the game reads pointer events)", JSON.stringify(log) === '["pointerdown"]', JSON.stringify(log));
  await p.close();
}
// 2. The game: a Foundry placed with a click.
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await sf(page, fn, arg); if (v || Date.now() > end) return v; await wait(150); } };
const base = "http://localhost:5173";
const key = await paidKey(base, "/mojave");
const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
await ctx.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
const a = await ctx.newPage();
const errors = [];
a.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
await a.goto(`${base}/mojave?world=mojave-ff-${Date.now().toString(36)}`);
await a.waitForSelector("body.ready", { timeout: 60000 });
await a.click("#play-free");
await wait(1500);
check("Play captures the mouse", await sf(a, () => window.snapfort.input.locked));
await until(a, () => window.snapfort.feature?.why === "choose");
await a.keyboard.press("1");
await until(a, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4);
await sf(a, () => window.snapfort.net.sendWorld({ m: "dev", do: "rich" }));
await until(a, () => window.snapfort.feature.bank.l > 10000);
// Count presses as the game hears them.
await sf(a, () => { const s = window.snapfort, i = s.input, d = i.onMouseDown, f = s.feature, m = f.mouse, n = s.net.sendWorld.bind(s.net); window.heard = []; window.sent = []; window.toasts = []; i.onMouseDown = (btn) => { window.heard.push("game:" + btn); d(btn); }; f.mouse = (b, down, t) => { const r = m(b, down, t); window.heard.push(`mojave:${b}:${down}->${r}`); return r; }; s.net.sendWorld = (msg) => { window.sent.push(msg.m + (msg.kind ? ":" + msg.kind : "")); return n(msg); }; const t = document.getElementById("toast"); if (t) new MutationObserver(() => window.toasts.push(t.textContent)).observe(t, { childList: true, subtree: true, characterData: true }); });
const core = await sf(a, () => { const f = window.snapfort.feature; const c = [...f.army.buildings.values()].find((x) => x.o === f.slot && x.kind === "core"); return [(c.x + 1.5) * 5, (c.z + 1.5) * 5]; });
const inX = -Math.sign(core[0]), inZ = -Math.sign(core[1]);
const site = [core[0] + inX * 30, core[1] + inZ * 30];
await sf(a, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [core[0] + inX * 16, core[1] + inZ * 16]);
await a.mouse.move(640, 380);
await wait(300);
await a.keyboard.press("b");
await a.keyboard.press("f");
for (let i = 0; i < 5; i++) { await wait(80); await sf(a, ([x, y, z]) => { const s = window.snapfort, p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = Math.atan2(-(y - p.y), Math.hypot(x - p.x, z - p.z)); }, [site[0], 0, site[1]]); }
await wait(300);
const before = { mode: await sf(a, () => window.snapfort.feature.mode?.k ?? null), locked: await sf(a, () => window.snapfort.input.locked), hint: await sf(a, () => document.getElementById("world-panel").textContent.slice(0, 60)) };
check("B, F: the Foundry is ready to place, and may go there", before.mode === "place" && /click to put it here/.test(before.hint), JSON.stringify(before));
await a.mouse.down(); await wait(80); await a.mouse.up();
const foundry = await until(a, () => [...window.snapfort.feature.army.buildings.values()].some((b) => b.kind === "foundry") || null, null, 5000);
const heard = await sf(a, () => window.heard), sent = await sf(a, () => window.sent);
await a.screenshot({ path: `${shots}/firefox-placed.png` });
check("a click is heard by the game and by Mojave", heard.includes("game:0") && heard.includes("mojave:0:true->true"), JSON.stringify(heard));
check("and puts the Foundry down", !!foundry && sent.includes("build:foundry") && (await sf(a, () => window.snapfort.feature.mode?.k ?? null)) === null, `${JSON.stringify(sent)} toasts ${JSON.stringify(await sf(a, () => window.toasts))}`);
check("no errors on the page", errors.length === 0, errors.join(" | "));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`${passed} of ${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
