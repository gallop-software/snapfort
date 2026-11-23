/**
 * Who is really here, and new versions: builder counts stay exact (a silent
 * connection is dropped, the same tab joining again replaces itself, a reload
 * leaves no ghost), a page from an older build is told to restart (it can
 * watch, not move or build) and comes back where it was, Esc out of the chat
 * line does not open the settings, and restarting the server (as a deploy
 * does) tells open pages to restart. Takes about three minutes.
 * Dev server running: npm run qa:presence
 */
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
const world = `pres-${Date.now().toString(36)}`;
const wsUrl = `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/ws?world=${world}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(path = "/", play = true) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const url = new URL(path, base);
  url.searchParams.set("world", world);
  await page.goto(url.toString());
  await page.waitForSelector("body.ready", { timeout: 60000 });
  if (play) { await page.click("#play-free"); await wait(500); }
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const online = (page) => sf(page, () => window.snapfort.remotes.count + 1);
/** A bare connection: joins as a bot, then (unless pinging) goes silent like a crashed tab. */
function bot(name, tab, ping = false) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let timer = null;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", v: 3, name, color: "#4a8fe0", ...(tab ? { tab } : {}) }));
      if (ping) timer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 15000);
    };
    ws.onmessage = (e) => { if (String(e.data).includes('"welcome"')) resolve(ws); };
    ws.onclose = (e) => { ws.closedWith = e.code; clearInterval(timer); };
  });
}

const watcher = await open("/");
check("one builder: the count says 1", (await online(watcher)) === 1);

// ── The same tab joining twice ──────────────────────────────────────────
const first = await bot("Tab Twin", "tabtwin00001");
await wait(500);
check("a second builder joins: 2", (await online(watcher)) === 2);
const second = await bot("Tab Twin", "tabtwin00001");
await wait(700);
check("the same tab joining again replaces its old connection: still 2, not 3", (await online(watcher)) === 2 && first.closedWith === 4000, `count ${await online(watcher)}, old closed with ${first.closedWith}`);
second.close(); await wait(700);
check("leaving properly: back to 1 at once", (await online(watcher)) === 1);

// ── A reload leaves no ghost ────────────────────────────────────────────
const reloader = await open("/");
await wait(500);
const names = () => sf(watcher, () => [...window.snapfort.remotes.remotes.values()].map((r) => r.player.name));
const before = await names();
for (let i = 0; i < 3; i++) { await reloader.reload(); await reloader.waitForSelector("body.ready"); await wait(400); }
await wait(800);
const after = await names();
check("a builder who reloads three times is still one builder to the others", (await online(watcher)) === 2 && after.length === 1, `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
// World switch and back.
await reloader.goto(new URL(`/moon?world=${world}`, base).toString()); await reloader.waitForSelector("body.ready"); await wait(800);
check("…switching to the Moon leaves the meadow at once", (await online(watcher)) === 1);
await reloader.goto(new URL(`/?world=${world}`, base).toString()); await reloader.waitForSelector("body.ready"); await wait(800);
check("…and coming back counts once", (await online(watcher)) === 2);
await reloader.context().close();
await wait(800);

// ── A connection that goes silent (a crashed tab, a laptop asleep) ──────
const ghost = await bot("Ghost");
const alive = await bot("Alive", null, true);
await wait(600);
check("(a silent connection and a live one join: 3)", (await online(watcher)) === 3);
let gone = 0;
const t0 = Date.now();
while (Date.now() - t0 < 170_000) {
  await wait(5000);
  if ((await online(watcher)) === 2) { gone = (Date.now() - t0) / 1000; break; }
}
check("the silent connection is dropped within about two minutes, the live one stays", gone > 0 && (await names()).includes("Alive") && ghost.readyState !== 1, gone ? `after ${gone.toFixed(0)} s` : "still counted");
alive.close();
await wait(700);

// ── A page from an older version ────────────────────────────────────────
const old = await open("/?build=20000101000000", false);
// (Playing, as someone would be when a new version goes live.)
await sf(old, () => window.snapfort.startMode("free"));
await wait(800);
check("an outdated page is told at once: SnapFort was updated, with a Restart button", (await old.isVisible("#view-update")) && (await old.isVisible("#update-restart")));
check("…it still joins the world, so the others see it", (await online(watcher)) === 2);
const n0 = await sf(watcher, () => window.snapfort.state.size);
await sf(watcher, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 3, y: 0, z: 3, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await wait(900);
check("…and the world keeps going on it (it sees a piece someone just placed)", (await sf(old, () => window.snapfort.state.size)) === n0 + 1);
const p0 = await sf(old, () => window.snapfort.player.position.asArray());
await old.keyboard.down("KeyW"); await wait(600); await old.keyboard.up("KeyW");
const p1 = await sf(old, () => window.snapfort.player.position.asArray());
check("…but it cannot move", Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) < 0.05);
await sf(old, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 6, y: 0, z: 6, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await wait(900);
check("…nor build (the server refuses it)", (await sf(watcher, () => window.snapfort.state.size)) === n0 + 1 && (await sf(old, () => window.snapfort.state.size)) === n0 + 1);
await old.keyboard.press("Escape"); await wait(300);
check("…and the notice cannot be closed: only Restart", await old.isVisible("#view-update"));
// Restart: the new version (the address without ?build=20000101000000) puts it back where it was.
await sf(old, () => { const s = window.snapfort; s.player.teleport(17.5, 0.95, 22.5); s.rig.yaw = 1.2; });
await wait(300);
await sf(old, () => history.replaceState(null, "", location.pathname + "?world=" + new URLSearchParams(location.search).get("world")));
await old.click("#update-restart");
await old.waitForSelector("body.ready", { timeout: 60000 }); await wait(1200);
const back = await sf(old, () => ({ p: window.snapfort.player.position.asArray(), yaw: window.snapfort.rig.yaw, away: document.body.classList.contains("away"), update: !document.getElementById("view-update").hidden, menu: !document.getElementById("view-menu").hidden }));
check("Restart reloads the latest version and puts the builder back where they were, facing the same way", Math.hypot(back.p[0] - 17.5, back.p[2] - 22.5) < 1 && Math.abs(back.yaw - 1.2) < 0.01 && !back.update && !back.menu, JSON.stringify(back));
check("…on a computer, a note says a click or any key carries on (the browser needs one for the mouse)", back.away && (await old.isVisible("#away-note")) && (await old.textContent("#away-note")).includes("any key"));
await old.mouse.click(550, 350); await wait(1300);
const q0 = await sf(old, () => window.snapfort.player.position.asArray());
await old.keyboard.down("KeyW"); await wait(500); await old.keyboard.up("KeyW");
const q1 = await sf(old, () => window.snapfort.player.position.asArray());
check("…one click and they are building again", (await sf(old, () => window.snapfort.input.locked)) && Math.hypot(q1[0] - q0[0], q1[2] - q0[2]) > 1);
check("…still one builder to the others after all that", (await online(watcher)) === 2);

// ── Esc out of the chat line ────────────────────────────────────────────
await old.keyboard.press("Enter"); await wait(300);
await old.keyboard.type("hello");
await old.keyboard.press("Escape"); await wait(800);
check("Esc in the chat line closes it, without opening the settings", !(await sf(old, () => !document.getElementById("chat-box").hidden)) && !(await old.isVisible("#view-paused")) && !(await old.isVisible("#settings")));
check("…the world stays in view: still playing, or (where the browser let go of the mouse) a note that a click or key carries on", (await sf(old, () => window.snapfort.input.locked)) || (await old.isVisible("#away-note")));
// As a real browser does on Esc: the mouse let go while the line was open. Then just press W.
await old.keyboard.press("Enter"); await wait(300);
await sf(old, () => document.exitPointerLock()); await wait(400);
const awayNow = await sf(old, () => document.body.classList.contains("away") && !window.snapfort.input.locked);
const w0 = await sf(old, () => window.snapfort.player.position.asArray());
await old.keyboard.down("KeyW"); await wait(2000); await old.keyboard.up("KeyW"); await wait(200);
const w1 = await sf(old, () => window.snapfort.player.position.asArray());
check("after Esc out of the chat, pressing W takes the mouse back and walks on: no click needed", awayNow && (await sf(old, () => window.snapfort.input.locked)) && Math.hypot(w1[0] - w0[0], w1[2] - w0[2]) > 1, `away ${awayNow}, moved ${Math.hypot(w1[0] - w0[0], w1[2] - w0[2]).toFixed(1)} m`);
await old.context().close();

// ── The same on a phone ─────────────────────────────────────────────────
{
  const { devices } = await import("playwright-core");
  const ctx = await browser.newContext({ ...devices["iPhone SE landscape"] });
  await ctx.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const url = new URL("/moon?build=20000101000000", base); url.searchParams.set("world", world);
  await ph.goto(url.toString()); await ph.waitForSelector("body.ready", { timeout: 60000 });
  await sf(ph, () => window.snapfort.startMode("free")); await wait(800);
  const fitsUpdate = await sf(ph, () => { const o = document.getElementById("overlay"); return !document.getElementById("view-update").hidden && o.scrollHeight <= o.clientHeight + 1; });
  check("on a phone: the update notice shows and fits the smallest screen", fitsUpdate);
  await sf(ph, () => { const s = window.snapfort; s.player.teleport(-12.5, 0.95, 7.5); s.rig.yaw = -0.7; });
  await sf(ph, () => history.replaceState(null, "", "/moon?world=" + new URLSearchParams(location.search).get("world")));
  await ph.tap("#update-restart");
  await ph.waitForSelector("body.ready", { timeout: 60000 }); await wait(1200);
  const r = await sf(ph, () => ({ p: window.snapfort.player.position.asArray(), env: window.snapfort.env.id, playing: window.snapfort.input.locked }));
  check("…Restart puts them back on the Moon where they stood, playing straight away (no click needed on touch)", r.env === "moon" && r.playing && Math.hypot(r.p[0] + 12.5, r.p[2] - 7.5) < 1, JSON.stringify(r));
  await ctx.close();
}

// (A real deploy telling open pages is checked on the live site after deploying: a dev
// server reloads its pages by itself when it restarts, so it cannot stand in for one.)
await watcher.context().close();

const relevant = errors.filter((e) => !/WebSocket|Failed to fetch/.test(e));
check("no errors", relevant.length === 0, relevant.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
