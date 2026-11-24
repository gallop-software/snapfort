/**
 * The Moon: its look, visitors (walk, chat, watch; no building, enforced by the
 * server), and how it plays for Full Game owners: low gravity (a storey-high
 * jump), trebuchets reaching further with slow lobs, builders thrown far. The
 * meadow stays as it was. Needs the Gallop dev server with Stripe test keys in
 * .dev.vars (a paid key is made through
 * the same webhook Stripe uses). Run: npm run qa:moon
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
const world = `moon-${Date.now().toString(36)}`;
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Full Game key, paid for through the webhook (no browser checkout needed here; qa:pay covers that). */
async function paidKey() {
  const r = await fetch(new URL("/api/buy", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/moon", testpay: true }) }).then((x) => x.json());
  const id = r.url.match(/cs_test_[A-Za-z0-9]+/)[0];
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((x) => x.json());
  const body = JSON.stringify({ id: "evt_moon_qa", type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: session.client_reference_id, payment_status: "paid", livemode: false, customer_details: { email: "qa-moon@example.com" } } } });
  const t = Math.floor(Date.now() / 1000);
  await fetch(new URL("/api/stripe", base), { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}` }, body });
  return session.client_reference_id;
}

async function open(label, path, key) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  if (key) await context.addInitScript((k) => localStorage.setItem("snapfort.key", k), key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  const url = new URL(path, base);
  url.searchParams.set("world", world);
  await page.goto(url.toString());
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(500);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const ids = (page) => sf(page, () => [...window.snapfort.state.all()].map((p) => p.id).sort().join(","));
const put = (page, list) => sf(page, (list) => { const s = window.snapfort; let n = 0; for (const [type, x, y, z, rot] of list) if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: 0 } })) n++; return n; }, list);
const toast = (page) => sf(page, () => document.getElementById("toast").textContent);
const stand = (page, x, z, yaw = 0) => sf(page, ([x, z, yaw]) => { const s = window.snapfort; s.player.teleport(x, 0.95, z); s.rig.yaw = yaw; s.rig.pitch = 0.1; }, [x, z, yaw]);
/** Highest the feet get during one jump. */
async function jumpHeight(page) {
  await frames(page, 30);
  const start = await sf(page, () => window.snapfort.player.feetY);
  await page.keyboard.down("Space"); await frames(page, 4); await page.keyboard.up("Space");
  return sf(page, (start) => new Promise((res) => { let top = start, t0 = performance.now(); const f = () => { top = Math.max(top, window.snapfort.player.feetY); if (performance.now() - t0 > 3500) res(top - start); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), start);
}

const key = await paidKey();
check("(a Full Game key for the builder)", /^SNAP-/.test(key ?? ""), key);
const b = await open("builder", "/moon", key);
const v = await open("visitor", "/moon?testpay");
const m = await open("meadow", "/");

// ── The look ─────────────────────────────────────────────────────────────
const look = (page) => sf(page, () => { const s = window.snapfort.scene; const c = s.clearColor; return { dark: c.r + c.g + c.b < 0.4, earth: !!s.getMeshByName("earth"), clouds: s.getMeshByName("cloud")?.isEnabled() ?? false, ground: s.getMeshByName("ground")?.material?.diffuseTexture?.name }; });
const moonLook = await look(b), meadowLook = await look(m);
check("the Moon: black sky, the Earth above, no clouds, grey cratered ground", moonLook.dark && moonLook.earth && !moonLook.clouds && moonLook.ground === "moon-ground", JSON.stringify(moonLook));
check("the meadow looks as it did", !meadowLook.dark && !meadowLook.earth && meadowLook.clouds && meadowLook.ground === "ground", JSON.stringify(meadowLook));
await sf(b, () => { window.snapfort.rig.pitch = -0.2; }); await frames(b, 4);
await b.screenshot({ path: "qa/shots/moon.png" });

// ── Owners build; visitors watch ─────────────────────────────────────────
check("with the Full Game you build on the Moon; without, you visit", (await sf(b, () => window.snapfort.builder)) && !(await sf(v, () => window.snapfort.builder)));
check("…and in the meadow everyone builds", await sf(m, () => window.snapfort.builder));
await stand(b, 2.5, -10); await stand(v, 12.5, -10); await wait(400);
const built = await put(b, [["wall", 0, 0, 0, 0], ["wall", 0, 1, 0, 0], ["wall", 1, 0, 0, 0]]);
await wait(800);
check("an owner's building appears for the visitor", built === 3 && (await ids(b)) === (await ids(v)) && (await ids(v)).split(",").length === 3);
await v.mouse.down(); await v.mouse.up(); await frames(v, 2);
await wait(400);
check("a visitor clicking to build gets the unlock panel, with a big Unlock · $7 button", (await v.isVisible("#view-unlock")) && (await v.isVisible("#unlock-buy")) && (await v.textContent("#unlock-buy")).includes("$7"));
await v.click("#unlock-later"); await wait(1300);
check("…'Keep visiting' goes straight back to the Moon", await sf(v, () => window.snapfort.input.locked));
check("…and while visiting, a bar with Unlock · $7 stays in sight", await v.isVisible("#visit-buy"));
await v.keyboard.press("Digit1"); await wait(500);
check("…a piece key does not pick a piece: it offers the unlock too", (await sf(v, () => document.querySelector("#hotbar .slot.selected"))) === null && (await v.isVisible("#view-unlock")));
await v.click("#unlock-later"); await wait(1300);
// Straight to the server, past the page's own check: refused.
const before = await ids(b);
await sf(v, () => window.snapfort.history.do({ kind: "place", piece: { type: "wall", x: 4, y: 0, z: 4, rot: 0, id: window.snapfort.nextId(), material: "wood", edit: 0 } }));
await wait(900);
check("the server refuses a visitor's piece sent straight to it, and the visitor's page takes it back", (await ids(b)) === before && (await ids(v)) === before);
// Chat is for everyone.
await stand(v, 12.5, -10, -Math.PI / 2); await wait(300);
await v.keyboard.press("Enter"); await frames(v, 2);
if ((await v.textContent("#chat-to")) !== "Nearby") await v.keyboard.press("Tab");
await v.keyboard.type("can I visit?"); await v.keyboard.press("Enter"); await wait(600);
check("visitors can chat", await sf(b, () => [...document.querySelectorAll(".chat-bubble span")].some((s) => s.textContent === "can I visit?")));

// ── Low gravity ──────────────────────────────────────────────────────────
await stand(b, 40, -40); await stand(m, 40, -40);
const moonJump = await jumpHeight(b), meadowJump = await jumpHeight(m);
check("in the meadow a jump clears a wall (3.75 m tall); on the Moon about 1.6 times as high", meadowJump > 3.9 && meadowJump < 4.8 && moonJump > 6.2 && moonJump < 7.6 && Math.abs(moonJump / meadowJump - 1.62) < 0.15, `meadow ${meadowJump.toFixed(2)} m, Moon ${moonJump.toFixed(2)} m`);
/** Stands just in front of a wall, jumps, presses forward near the top: over it, or not? */
async function overWall(page, x, z) {
  await sf(page, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x, y: 0, z, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); }, [x, z]);
  await wait(500);
  const wallZ = z * 5;
  await sf(page, ([x, wallZ]) => { const s = window.snapfort; s.player.teleport(x * 5 + 2.5, 0.95, wallZ - 1.4); s.rig.yaw = 0; s.rig.pitch = 0.1; }, [x, wallZ]);
  await frames(page, 30);
  await page.keyboard.down("Space"); await frames(page, 3); await page.keyboard.up("Space");
  await wait(330);
  await page.keyboard.down("KeyW"); await wait(900); await page.keyboard.up("KeyW");
  await wait(1500);
  const p = await sf(page, () => ({ z: window.snapfort.player.position.z, feet: window.snapfort.player.feetY }));
  return { over: p.z > wallZ + 0.5 && p.feet < 1, z: p.z - wallZ };
}
const meadowOver = await overWall(m, 8, -8);
check("in the meadow: jump next to a wall, press forward, and you are over it", meadowOver.over, `${meadowOver.z.toFixed(1)} m past the wall`);
const moonOver = await overWall(b, 8, -8);
check("…on the Moon too, easily", moonOver.over, `${moonOver.z.toFixed(1)} m past the wall`);

// ── Trebuchets ───────────────────────────────────────────────────────────
// A wall about 350 m away: beyond any ground trebuchet's reach in the meadow (300 m), within it on the Moon (480 m).
await sf(b, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 30, y: 0, z: 34, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await stand(b, 152.5, -179); await wait(200);
await put(b, [["trebuchet", 30, 0, -36, 0]]);
await stand(b, 152.5, -177.5); await wait(400);
await b.keyboard.press("KeyH"); await wait(600);
check("(the owner gets on a trebuchet)", !!(await sf(b, () => window.snapfort.crewOn)));
const aimAt = async (x, y, z) => { for (let i = 0; i < 4; i++) { await sf(b, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]); await frames(b, 2); } };
await aimAt(152.5, 1.5, 170);
const panel = await b.textContent("#crew");
check("a trebuchet on the Moon reaches a target about 350 m away (the meadow's limit is 300 m)", panel.includes("ready") && /Target 34\d m/.test(panel), panel);
// The visitor stands by the target, to be thrown.
await stand(v, 152.5, 167.5, Math.PI); await wait(600);
const vStart = await sf(v, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));
const fired = Date.now();
await b.mouse.down(); await b.mouse.up();
let hitAt = 0;
for (let i = 0; i < 220 && !hitAt; i++) {
  await wait(100);
  if ((await sf(b, () => [...window.snapfort.damage.values()].length)) > 0 || (await sf(v, () => window.snapfort.player.tumbling))) hitAt = Date.now();
}
const flight = (hitAt - fired) / 1000;
check("the stone flies a slow, floaty lob: about 14.5 s to 350 m (about 8.5 s in the meadow)", hitAt > 0 && flight > 13 && flight < 16.5, `${flight.toFixed(1)} s`);
await wait(9000);
const vEnd = await sf(v, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z, down: window.snapfort.player.knockedDown }));
const thrown = Math.hypot(vEnd.x - vStart.x, vEnd.z - vStart.z);
check("a builder by the impact is thrown far (visitors too)", thrown > 60, `${thrown.toFixed(0)} m`);
await b.keyboard.press("KeyH");

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
