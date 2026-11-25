/**
 * Starships and Mars: the pilot chooses where a ship goes. A launch site in
 * the Meadow; the first aboard is the pilot and picks Mars with the move keys;
 * a second rider sees the choice but cannot change it; it locks at the
 * countdown; both arrive on Mars aboard the ship as it comes in, and are let
 * out. Then a site built on Mars, whose pilot goes through the Meadow and the
 * Moon and flies to the Moon. (qa:starship covers building, lift-off, the
 * booster and explosions in the other two worlds.) Needs the Gallop dev
 * server with Stripe test keys in .dev.vars. Run: npm run qa:starship-mars
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";
import { perch, scaffold } from "./_scaffold.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `tomars-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(label, key, path = "/") {
  const context = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key ?? null);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_/.test(m.text())) errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}${path}?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(800);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
/** Brings a page to the front and makes sure it is playing. */
async function front(page) {
  await page.bringToFront();
  for (let i = 0; i < 6 && !(await page.evaluate(() => window.snapfort?.input.locked)); i++) {
    if (await page.isVisible("#resume")) await page.click("#resume"); else await page.mouse.click(550, 200);
    await wait(400);
  }
}
const star = (page) => sf(page, () => { const f = window.snapfort.feature.starship; return { pads: [...f.pads.values()].map((s) => ({ ...s.pad })), ships: [...f.ships.values()].map((s) => ({ ...s.ship })), seated: f.seated, aboard: f.aboard }; });
const me = (page) => sf(page, () => { const s = window.snapfort; const p = s.player.position; return { x: p.x, y: p.y, z: p.z, down: s.player.knockedDown, env: s.env.id, builder: s.builder, id: s.myId }; });
const panel = (page) => sf(page, () => { const el = document.getElementById("world-panel"); return el.hidden ? "" : el.textContent; });
const stand = (page, x, y, z) => sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]);
const click = async (page) => { await page.mouse.down(); await page.mouse.up(); };
const say = (page, msg) => sf(page, (m) => window.snapfort.net.sendWorld(m), msg);
/** A move key, held for a few frames (the game reads keys once a frame). */
const tap = async (page, code) => { await page.keyboard.down(code); await wait(120); await page.keyboard.up(code); await wait(500); };
/** A whole launch site with its tower in cell (-22, -28), built from scaffolding, part by part. */
const TX = -22, TZ = -28, FOOT = [-107.5, -137.5];
async function site(page) {
  await stand(page, FOOT[0] + 9, 0.95, FOOT[1]); await wait(300);
  await say(page, { k: "pad-new", x: TX, z: TZ, dir: 0 }); await wait(300);
  await scaffold(page, TX, TZ);
  for (let n = 2; n <= 21; n++) { await stand(page, ...perch(TX, TZ, n).at); await wait(240); await say(page, { k: "pad-part", id: 1, n }); await wait(90); }
  await wait(400);
  return Date.now();
}
const board = async (page) => { await front(page); await stand(page, FOOT[0] - 10, 0.95, FOOT[1] - 6); await wait(500); await page.keyboard.press("KeyH"); await wait(900); };

const p = await open("pilot", await paidKey(base, "/mars"));
const q = await open("passenger");
await front(p); await p.keyboard.press("KeyZ"); await wait(200);
await front(q); await q.keyboard.press("KeyZ"); await wait(200);

// ── From the Meadow: the pilot picks Mars ────────────────────────────────
await front(p);
const built = await site(p);
let s = await star(p);
check("(a launch site stands in the Meadow)", s.pads[0]?.parts.length === 21, JSON.stringify(s.pads[0]?.parts));
await board(p);
await board(q);
s = await star(p);
const pilot = (await me(p)).id;
check("the first aboard is the pilot", s.pads[0].pilot === pilot && s.pads[0].riders.filter((r) => r).length === 2 && s.pads[0].to === "", JSON.stringify({ pilot: s.pads[0].pilot, me: pilot }));
await front(p); await wait(400);
check("the pilot is told where it is bound, and how to change it", /Bound for the Moon · you are the pilot/.test(await panel(p)), await panel(p));
check("the other rider is told the pilot chooses", /Bound for the Moon: the pilot chooses/.test(await panel(q)), await panel(q));
await front(q); await tap(q, "KeyD");
check("the passenger's keys change nothing", (await star(p)).pads[0].to === "");
await front(p); await tap(p, "KeyD");
s = await star(q);
check("the pilot's D key turns it to Mars, for everyone to see", s.pads[0].to === "mars" && /Bound for Mars · you are the pilot/.test(await panel(p)) && /Bound for Mars: the pilot chooses/.test(await panel(q)), `${s.pads[0].to} · ${await panel(q)}`);
await tap(p, "KeyD");
check("…again, and it is back to the Moon; A goes the other way", (await star(q)).pads[0].to === "moon");
await tap(p, "KeyA");
check("…and so to Mars again", (await star(q)).pads[0].to === "mars");
await wait(Math.max(0, 21000 - (Date.now() - built)));
check("fuelled, it says it is ready for Mars (not \"the Mars\")", /Starship ready · to Mars/.test(await panel(p)), await panel(p));
await p.screenshot({ path: "qa/shots/starship-to-mars.png" });
await click(p); await wait(700);
check("a click starts the countdown", /Lift-off in \d+/.test(await panel(p)) && (await star(q)).pads[0].count > 0, await panel(p));
await tap(p, "KeyD");
check("once it is counting the choice is fixed", (await star(q)).pads[0].to === "mars");
await wait(10500);
s = await star(q);
check("the engines light, for Mars", s.pads[0].flight?.to === "mars", JSON.stringify(s.pads[0].flight));
await Promise.all([p.waitForURL(/\/mars/, { timeout: 40000 }).catch(() => {}), q.waitForURL(/\/mars/, { timeout: 40000 }).catch(() => {})]);
check("both riders' pages follow the ship to Mars", /\/mars\?world=/.test(p.url()) && /\/mars\?world=/.test(q.url()), `${p.url()} ${q.url()}`);

// ── Arriving on Mars ─────────────────────────────────────────────────────
await wait(3500);
await front(p);
let a = await me(p);
s = await star(p);
check("on Mars both are aboard the ship as it comes in, high up", a.env === "mars" && !!s.aboard && a.y > 150 && s.ships[0]?.from === "meadow" && s.ships[0].riders.length === 2, `y ${a.y?.toFixed(0)} ${JSON.stringify(s.ships[0])}`);
await p.screenshot({ path: "qa/shots/starship-mars-arriving.png" });
for (let i = 0; i < 300 && !(await star(p)).ships[0]?.down; i++) await wait(200);
await wait(1500);
a = await me(p);
const b2 = await me(q);
s = await star(p);
check("it lands on Mars and lets them out beside it, on their feet", s.ships[0]?.down && a.y < 3 && !a.down && b2.y < 3 && !b2.down && Math.hypot(a.x - s.ships[0].x, a.z - s.ships[0].z) < 14, `pilot y ${a.y.toFixed(1)}, passenger y ${b2.y.toFixed(1)}`);
check("the one with the Full Game can build on Mars; the other is visiting", a.builder && !b2.builder);
await sf(p, ([x, z]) => { const s = window.snapfort; s.player.teleport(x + 40, 0.95, z - 30); s.rig.yaw = Math.atan2(-40, 30); s.rig.pitch = -0.35; }, [s.ships[0].x, s.ships[0].z]);
await wait(600);
await p.screenshot({ path: "qa/shots/starship-mars-landed.png" });

// ── From Mars: a site built there, and on to the Moon ────────────────────
const slots = await sf(p, () => [...document.querySelectorAll("#hotbar .slot .label")].map((e) => e.textContent));
check("Starship is on Mars's hotbar, with the Terraformer", slots.includes("Starship") && slots.includes("Terraformer"), slots.join(" · "));
const builtOnMars = await site(p);
s = await star(p);
check("a builder with the Full Game builds a launch site on Mars", s.pads[0]?.parts.length === 21, JSON.stringify(s.pads[0]?.parts));
await board(p);
check("…and is its pilot", (await star(p)).seated === 1 && (await star(p)).pads[0].pilot === (await me(p)).id);
await wait(400);
check("from Mars it is bound for the Meadow until the pilot says otherwise", /Bound for the Meadow · you are the pilot/.test(await panel(p)), await panel(p));
await tap(p, "KeyD");
check("D turns it to the Moon", (await star(p)).pads[0].to === "moon" && /Bound for the Moon/.test(await panel(p)), await panel(p));
await wait(Math.max(0, 21000 - (Date.now() - builtOnMars)));
await click(p); await wait(700);
check("its countdown is for the Moon", /Lift-off in/.test(await panel(p)) && (await star(p)).pads[0].to === "moon", await panel(p));
await p.waitForURL(/\/moon/, { timeout: 50000 }).catch(() => {});
check("the pilot's page follows the ship to the Moon", /\/moon\?world=/.test(p.url()), p.url());
await wait(3500);
a = await me(p);
s = await star(p);
check("on the Moon the pilot is aboard a ship from Mars", a.env === "moon" && !!s.aboard && s.ships[0]?.from === "mars", JSON.stringify(s.ships[0]));

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
