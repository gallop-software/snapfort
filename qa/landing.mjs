/**
 * What a builder was going to land on is shot away while they are in the air:
 * they must not be left standing on nothing where it used to be. On the Moon
 * (thrown into space from a platform, the platform removed during the flight)
 * the rockets carry them on down to the ground. Needs the Gallop dev server
 * with Stripe test keys in .dev.vars. Run: node qa/landing.mjs
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = "http://localhost:5173";
const world = `landing-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(label, key) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key ?? null);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  await page.goto(`${base}/moon?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free"); await wait(700);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);

const b = await open("builder", await paidKey(base, "/moon"));
const v = await open("visitor");
const vId = await sf(v, () => window.snapfort.myId);
// A wide platform two storeys up (on a ring of walls), 60 m from a launcher.
const TOP = 2 * 3.75 + 0.15;
await sf(b, () => {
  const s = window.snapfort; window.__floors = [];
  const put = (type, x, y, z, rot) => { const id = s.nextId(); if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id, material: "wood", edit: 0 } }) && type === "floor") window.__floors.push(id); };
  for (let y = 0; y < 2; y++) put("wall", 20, y, 20, 0);
  for (let ring = 0; ring <= 4; ring++) for (let x = 20 - ring; x <= 20 + ring; x++) for (let z = 20 - ring; z <= 20 + ring; z++) if (Math.max(Math.abs(x - 20), Math.abs(z - 20)) === ring) put("floor", x, 2, z, 0);
  put("trebuchet", 8, 0, 20, 0);
});
await wait(1200);
await sf(v, (top) => { const s = window.snapfort; s.player.teleport(83, top + 0.95, 102.5); }, TOP);
await sf(b, () => { const s = window.snapfort; s.player.teleport(42.5, 1.4, 104); s.rig.yaw = Math.PI / 2; s.rig.pitch = 0; });
await wait(700);
await b.keyboard.press("KeyH"); await wait(700);
check("(the builder is on the launcher, the visitor on the platform)", !!(await sf(b, () => window.snapfort.crewOn)) && Math.abs((await sf(v, () => window.snapfort.player.feetY)) - TOP) < 0.3);
// Aim at the platform just beside the visitor, and fire.
for (let i = 0; i < 4; i++) { await sf(b, (top) => { const s = window.snapfort; const p = s.rig.pivot; const [x, y, z] = [80, top - 0.15, 102.5]; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, TOP); await wait(60); }
if (process.env.TRACE) console.log("target", JSON.stringify(await sf(b, () => window.snapfort.target)), "| panel:", (await b.textContent("#crew")).slice(0, 50), "| visitor", JSON.stringify(await sf(v, () => { const q = window.snapfort.player.position; return [q.x, q.y, q.z].map((n) => +n.toFixed(1)); })), "| pieces", await sf(b, () => window.snapfort.state.size));
await b.mouse.down(); await b.mouse.up();
let thrown = false;
for (let i = 0; i < 40 && !thrown; i++) { await wait(100); thrown = await sf(v, () => window.snapfort.player.tumbling); }
check("the visitor is thrown into space from the platform", thrown);
await wait(2500);
// While they are up there, the whole platform is taken away.
await b.keyboard.press("KeyH"); await wait(300);
await sf(b, () => { const s = window.snapfort; for (const id of window.__floors) s.history.do({ kind: "remove", id }); });
await wait(600);
check("(the platform is gone while they are in the air)", (await sf(v, () => [...window.snapfort.state.all()].filter((p) => p.type === "floor").length)) === 0 && (await sf(v, () => window.snapfort.player.knockedDown)));
let glidedOn = false, lowest = 99;
for (let i = 0; i < 200; i++) {
  await wait(100);
  const p = await sf(v, () => ({ feet: window.snapfort.player.feetY, down: window.snapfort.player.knockedDown, gliding: window.snapfort.player.gliding }));
  lowest = Math.min(lowest, p.feet);
  if (p.feet < 6.5 && p.feet > 1 && p.gliding) glidedOn = true;
  if (!p.down && i > 80) break;
}
const end = await sf(v, () => ({ feet: window.snapfort.player.feetY, down: window.snapfort.player.knockedDown }));
check("they are not left standing where the platform was: the rockets carry them on down", glidedOn, `lowest ${lowest.toFixed(1)} m`);
check("…to the ground, on their feet", !end.down && Math.abs(end.feet) < 0.3, `feet at ${end.feet.toFixed(2)} m`);
const seen = await sf(b, (id) => window.snapfort.remotes.positionOf(id), vId);
check("…and that is where everyone else sees them", !!seen && Math.abs(seen[1] - 0.9) < 0.4, `seen at ${seen?.[1].toFixed(1)} m`);
check("no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
