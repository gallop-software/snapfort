/**
 * Mars's Terraformer, the air it makes, and wings: starting one with the tool
 * and a click, building it part by part from close by (scaffolding stands in
 * for a builder's climb: the script puts the builder beside each part), the
 * machine running and the air thickening for everyone, nothing built into it,
 * a beacon's missile breaking a part and the air turning back, mending,
 * taking it apart from the top; then flying: no wings on red Mars, a long
 * glide and a flapped climb in thick air, seen by others, and a landing.
 * Needs the Gallop dev server with Stripe test keys in .dev.vars.
 * Run: npm run qa:terraformer
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `terra-${Date.now().toString(36)}`;
mkdirSync("qa/shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, path, key) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
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
const hover = async (page, x, y, z) => { await sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [x, y, z]); await wait(230); };
const send = (page, msg) => sf(page, (m) => window.snapfort.net.sendWorld(m), msg);
const terra = (page) => sf(page, () => { const s = [...window.snapfort.feature.terraformer.terras.values()][0]; return s ? { ...s.terra, lights: s.lights.isEnabled(), solid: s.parts.size, charred: [...s.parts.values()].filter((p) => p.mesh.material.name === "terra-broken").length } : null; });
const air = (page) => sf(page, () => window.snapfort.feature.terraformer.air());
const toast = (page) => sf(page, () => document.getElementById("toast").textContent);
const panel = (page) => sf(page, () => document.getElementById("world-panel").textContent);
const ids = (page) => sf(page, () => [...window.snapfort.state.all()].map((p) => p.id).sort().join(","));
const boxes = (page, site) => sf(page, async (site) => { const r = await import("/src/worlds/mars/terraformerRules.ts"); return Array.from({ length: r.PARTS }, (_, i) => r.boxOf(site, i + 1)); }, site);
const beside = (b) => [b[3] + 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
const look = (page, x, y, z) => sf(page, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]);

const key = await paidKey(base, "/mars");
const b = await open("builder", "/mars?sol=0.3", key);
const v = await open("visitor", "/mars?sol=0.3&testpay");

// ── Starting one, with the tool ──────────────────────────────────────────
check("the Terraformer is a tool on Mars's hotbar", await sf(b, () => [...document.querySelectorAll("#hotbar .slot")].some((s) => s.textContent.includes("Terraformer"))));
await hover(b, 22.5, 0.95, -20);
await sf(b, () => { const s = window.snapfort; s.rig.yaw = 0; s.rig.pitch = 0.5; });
await b.keyboard.press("KeyN"); await frames(b, 6);
const offer = await panel(b);
check("picked, it offers a new one where you aim, all 24 parts shown", offer.includes("New Terraformer") && offer.includes("Foundation") && (await sf(b, () => window.snapfort.scene.meshes.filter((m) => m.name === "terra-plan" && m.isEnabled()).length)) === 24, offer);
await b.screenshot({ path: "qa/shots/terra-plan.png" });
await b.mouse.down(); await b.mouse.up(); await wait(700);
let t = await terra(b);
check("a click starts it: the foundation is down, for everyone", t?.parts.length === 1 && t.solid === 1 && (await terra(v))?.parts.length === 1, JSON.stringify(t && { x: t.x, z: t.z }));
const site = { x: t.x, z: t.z };
const box = await boxes(b, site);
await frames(b, 6);
check("…and the tool now shows part 2, the first intake tower", (await panel(b)).includes("2 · Intake tower A"), await panel(b));

// A visitor cannot add to it; nor can a builder from far away.
await hover(v, ...beside(box[1]));
await send(v, { k: "terra-part", id: t.id, n: 2 }); await wait(500);
check("a visitor cannot put a part on", (await terra(b)).parts.length === 1);
await hover(b, site.x * 5 - 80, 0.95, site.z * 5);
await send(b, { k: "terra-part", id: t.id, n: 2 }); await wait(500);
check("nor can a builder from 80 m away", (await terra(b)).parts.length === 1 && (await toast(b)).includes("Too far"), await toast(b));

// Part 2 by aiming and clicking from beside it; the rest by the world's own message, from beside each.
await hover(b, ...beside(box[1]));
await look(b, (box[1][0] + box[1][3]) / 2, 8, (box[1][2] + box[1][5]) / 2); await frames(b, 6);
await b.mouse.down(); await b.mouse.up(); await wait(700);
check("from beside it, a click puts the tower on", (await terra(b)).parts.includes(2));
for (let n = 3; n <= 18; n++) { await hover(b, ...beside(box[n - 1])); await send(b, { k: "terra-part", id: t.id, n }); await wait(160); }
t = await terra(b);
check("the towers, reactor, ducts, fans, dome and collar go on, each from beside it", t.parts.length === 18, `${t.parts.length} parts`);
// From the ground the stack is out of reach, and the panel says how far.
await hover(b, site.x * 5 + 46, 0.95, site.z * 5 + 20);
await look(b, site.x * 5 + 20, 40, site.z * 5 + 20); await frames(b, 8);
const far = await panel(b);
check("from the ground the stack is out of reach, and the panel says how far up it is", far.includes("19 · Stack 1") && /\d+ m above you/.test(far) && far.includes("within 12 m"), far);
await b.screenshot({ path: "qa/shots/terra-half.png" });
// Nothing can be built into it.
const before = await ids(b);
await sf(b, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: x + 4, y: 0, z: z + 4, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); }, [site.x, site.z]);
await wait(600);
check("a wall cannot be built into it", (await ids(b)) === before);
await sf(b, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: x - 1, y: 0, z: z + 4, rot: 1, id: s.nextId(), material: "wood", edit: 0 } }); }, [site.x, site.z]);
await wait(600);
check("…but one can stand beside it (that is where the scaffolding goes)", (await ids(b)) !== before);
// Standing on it: the foundation is solid.
await hover(b, site.x * 5 + 20, 9, site.z * 5 + 5); await wait(1800);
const stood = await sf(b, () => window.snapfort.player.feetY);
check("its parts are solid: a builder dropped onto the control house stands on its roof", Math.abs(stood - 7) < 0.3, `feet at ${stood.toFixed(2)} m`);

for (let n = 19; n <= 24; n++) { await hover(b, ...beside(box[n - 1])); await send(b, { k: "terra-part", id: t.id, n }); await wait(160); }
await wait(600);
t = await terra(b);
const a1 = await air(b);
check("whole, it runs: lit, the air heading for thick, and everyone told", t.parts.length === 24 && t.lights && a1.to === 1 && (await air(v)).to === 1 && (await toast(v)).includes("thickening"), await toast(v));
await hover(b, site.x * 5 - 60, 0.95, site.z * 5 - 40);
await look(b, site.x * 5 + 20, 45, site.z * 5 + 20); await frames(b, 8);
check("…and the tool says so", (await panel(b)).includes("running"), await panel(b));
await b.addStyleTag({ content: "#tip, #toast { display: none !important; }" });
await b.screenshot({ path: "qa/shots/terra-whole.png" });
await wait(4000);
const rising = await sf(v, () => window.snapfort.scene.getMeshByName("growth").isEnabled());
const pct = await sf(v, async () => { const r = await import("/src/worlds/mars/page/air.ts"); return r.sky.air; });
check("the air creeps up, and lichen starts to spread from the machine", pct > 0.01 && pct < 0.1 && rising, `${(pct * 100).toFixed(1)}% after a few seconds`);

// ── A hit stops it; mending starts it again ──────────────────────────────
await hover(b, site.x * 5 - 77.5, 0.95, site.z * 5 + 22.5);
await sf(b, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: x - 16, y: 0, z: z + 4, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); }, [site.x, site.z]);
await wait(600);
await b.keyboard.press("KeyB"); await frames(b, 3);
await b.keyboard.press("KeyH"); await wait(600);
check("(the builder gets on a beacon 80 m from it)", !!(await sf(b, () => window.snapfort.crewOn)));
// Marked on an intake fan, the top of a tower.
const fan = box[12];
for (let i = 0; i < 4; i++) { await look(b, (fan[0] + fan[3]) / 2, fan[4] - 0.5, (fan[2] + fan[5]) / 2); await frames(b, 2); }
await b.mouse.down(); await b.mouse.up();
await wait(4200);
t = await terra(v);
const a2 = await air(v);
check("a missile on one of its fans breaks that part: the machine stops, charred, lights out, the air turning back", t.broken.length >= 1 && t.broken.includes(13) && t.charred === t.broken.length && !t.lights && a2.to === 0 && (await toast(v)).includes("thinning"), `broken: ${t.broken.join(", ")}`);
await b.keyboard.press("KeyH"); await wait(300);
await b.keyboard.press("KeyN"); await frames(b, 3);
await hover(b, ...beside(fan)); await frames(b, 8);
const mend = await panel(b);
check("the tool offers to mend it", mend.includes("stopped") && mend.includes("13 · Intake fan A") && mend.includes("mend"), mend);
for (const n of t.broken) { await hover(b, ...beside(box[n - 1])); await frames(b, 6); await b.mouse.down(); await b.mouse.up(); await wait(600); }
t = await terra(v);
check("a click from beside each broken part mends it, and it runs again", t.broken.length === 0 && t.lights && (await air(v)).to === 1, `broken: ${t.broken.join(", ")}`);

// ── Wings ────────────────────────────────────────────────────────────────
// Two more pages on the builder's own computer, their air held: red Mars, and thick air.
const red = await open("red", "/mars?sol=0.3&air=0", key);
const thick = await open("thick", "/mars?sol=0.3&air=1", key);
/** The jump key, held for a few frames (a builder's tap lasts that long; the game reads keys once a frame). */
const tap = async (page) => { await page.keyboard.down("Space"); await frames(page, 4); await page.keyboard.up("Space"); };
const flying = (page) => sf(page, () => window.snapfort.feature.wings.flying());
const at = (page) => sf(page, () => { const p = window.snapfort.player.position; return { x: p.x, y: p.y, z: p.z }; });
await hover(red, -150, 90, -150); await tap(red); await wait(400);
check("on red Mars the wings do not open, and the game says why", !(await flying(red)) && (await toast(red)).includes("too thin"), await toast(red));
await wait(4000);
const fell = await at(red);
check("…and the builder falls", fell.y < 60, `${fell.y.toFixed(0)} m up after 4 s`);

await hover(thick, -150, 90, -150);
await sf(thick, () => { const s = window.snapfort; s.rig.yaw = Math.PI / 4; s.rig.pitch = 0.05; });
await wait(250);
await tap(thick); await wait(300);
check("in thick air, Space in the air spreads them", await flying(thick));
const start = await at(thick);
await wait(5000);
const glided = await at(thick);
const went = Math.hypot(glided.x - start.x, glided.z - start.z), lost = start.y - glided.y;
check("…and they carry: a long way forward for a little height", went > 55 && lost > 0 && lost < 16 && (await flying(thick)), `${went.toFixed(0)} m forward, ${lost.toFixed(1)} m down in 5 s`);
check("…everyone else sees a builder gliding, wings out", await sf(b, () => window.snapfort.scene.meshes.some((m) => m.name === "wing-sail" && m.isEnabled())));
await thick.screenshot({ path: "qa/shots/wings.png" });
await thick.keyboard.down("Space"); await wait(3000); await thick.keyboard.up("Space");
const climbed = await at(thick);
check("holding Space flaps them: up it goes", climbed.y > glided.y + 8, `${(climbed.y - glided.y).toFixed(1)} m up in 3 s`);
// Dive and land.
await sf(thick, () => { window.snapfort.rig.pitch = 0.9; });
let landed = false;
for (let i = 0; i < 80 && !landed; i++) { await wait(250); landed = !(await flying(thick)); }
const down = await sf(thick, () => ({ feet: window.snapfort.player.feetY, wings: window.snapfort.scene.meshes.some((m) => m.name === "wing-sail" && m.isEnabled() && m.parent?.parent === window.snapfort.player.avatar.root) }));
check("looking down dives; touching the ground folds them, and the builder is standing", landed && Math.abs(down.feet) < 0.4, `feet at ${down.feet.toFixed(2)} m`);
await thick.keyboard.down("KeyW"); await wait(600); await thick.keyboard.up("KeyW");
const walked = await at(thick);
check("…and walks on", Math.abs(walked.y - 0.9) < 0.4);

// ── What thick air looks like ────────────────────────────────────────────
const wet = await sf(thick, () => { const s = window.snapfort.scene; const c = s.clearColor; return { blue: c.b > c.r, clouds: s.getMeshByName("cloud").isEnabled(), growth: s.getMeshByName("growth").scaling.x, pools: s.getMeshByName("pool").isEnabled() }; });
const dry = await sf(red, () => { const s = window.snapfort.scene; const c = s.clearColor; return { blue: c.b > c.r, clouds: s.getMeshByName("cloud").isEnabled(), growth: s.getMeshByName("growth").isEnabled(), pools: s.getMeshByName("pool").isEnabled() }; });
check("thick air: a blue sky, clouds, green over the whole plain, pools of water", wet.blue && wet.clouds && wet.growth > 1500 && wet.pools, JSON.stringify(wet));
check("red Mars: butterscotch, no clouds, bare ground, dry", !dry.blue && !dry.clouds && !dry.growth && !dry.pools, JSON.stringify(dry));
await hover(thick, site.x * 5 - 70, 0.95, site.z * 5 - 50);
await look(thick, site.x * 5 + 20, 40, site.z * 5 + 20); await frames(thick, 8);
await thick.addStyleTag({ content: "#tip, #toast, #hud, #hotbar-wrap, #stats, #online, #crosshair, #world-panel { display: none !important; }" });
await wait(500);
await thick.screenshot({ path: "qa/shots/terra-green.png" });
const night = await open("night", "/mars?sol=0.82&air=1", key);
await hover(night, site.x * 5 - 70, 0.95, site.z * 5 - 50);
await look(night, site.x * 5 + 20, 60, site.z * 5 + 20); await frames(night, 8);
check("at night, with thick air, the aurora is out", await sf(night, () => window.snapfort.scene.getMeshByName("aurora").isEnabled()));
await night.addStyleTag({ content: "#tip, #toast, #hud, #hotbar-wrap, #stats, #online, #crosshair, #world-panel { display: none !important; }" });
await wait(500);
await night.screenshot({ path: "qa/shots/terra-aurora.png" });

// ── Taking it apart ──────────────────────────────────────────────────────
await hover(b, ...beside(box[22]));
await send(b, { k: "terra-take", id: t.id, n: 23 }); await wait(500);
check("the crown cannot be taken off while the igniter stands on it", (await terra(b)).parts.includes(23) && (await toast(b)).includes("take that off first"), await toast(b));
await hover(b, ...beside(box[23]));
await send(b, { k: "terra-take", id: t.id, n: 24 }); await wait(600);
t = await terra(v);
check("the igniter comes off: no longer whole, so it stops and the air turns back", !t.parts.includes(24) && !t.lights && (await air(v)).to === 0);
// A late joiner sees it as it is.
const late = await open("late", "/mars?sol=0.3&testpay");
await wait(800);
const seen = await terra(late);
check("someone joining now sees the machine as it stands, 23 parts, and the air as it is", seen?.parts.length === 23 && seen.solid === 23 && (await air(late)).to === 0);

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
