/**
 * Mars: its look through the sol (day, the blue sunset, night with what is
 * built of ice and glass glowing), its own materials, visitors and owners, and
 * its true 0.38 pull, the beacon (a mark, then a missile diving on it from above)
 * and the airbags that bring down whoever it hits. The meadow and the Moon stay as they were (qa:refs
 * checks their pictures). Needs the Gallop dev server with Stripe test keys in
 * .dev.vars. Run: npm run qa:mars
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `mars-${Date.now().toString(36)}`;
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
const ids = (page) => sf(page, () => [...window.snapfort.state.all()].map((p) => p.id).sort().join(","));
const stand = (page, x, z, yaw = 0, pitch = 0.1) => sf(page, ([x, z, yaw, pitch]) => { const s = window.snapfort; s.player.teleport(x, 0.95, z); s.rig.yaw = yaw; s.rig.pitch = pitch; }, [x, z, yaw, pitch]);
/** Highest the feet get during one jump. */
async function jumpHeight(page) {
  await frames(page, 30);
  const start = await sf(page, () => window.snapfort.player.feetY);
  await page.keyboard.down("Space"); await frames(page, 4); await page.keyboard.up("Space");
  return sf(page, (start) => new Promise((res) => { let top = start, t0 = performance.now(); const f = () => { top = Math.max(top, window.snapfort.player.feetY); if (performance.now() - t0 > 3500) res(top - start); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), start);
}
/** What the sky and the light are doing on a page. */
const sky = (page) => sf(page, () => {
  const s = window.snapfort.scene;
  const c = s.clearColor;
  const glow = (name) => { const m = s.materials.find((m) => m.diffuseTexture?.name === name); return m ? m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b : -1; };
  const up = (name) => { const m = s.getMeshByName(name); return m ? { on: m.isEnabled(), x: m.position.x, y: m.position.y } : null; };
  const halo = s.getMaterialByName("sun-halo").emissiveColor;
  return {
    horizon: [c.r, c.g, c.b], stars: s.getMaterialByName("sky").emissiveTexture.level, sun: up("sun-halo"), blue: halo.b > halo.r, sunLight: s.getLightByName("sun").intensity,
    ice: glow("piece-wall-wood"), brick: glow("piece-wall-brick"), roof: glow("piece-roof-brick"), phobos: up("phobos"), earth: up("earth"),
    ground: s.getMeshByName("ground")?.material?.diffuseTexture?.name, walls: s.meshes.filter((m) => m.name.startsWith("canyon")).length, clouds: s.getMeshByName("cloud")?.isEnabled() ?? false,
  };
});

const key = await paidKey(base, "/mars");
check("(a Full Game key for the builder)", /^SNAP-/.test(key ?? ""), key);

// ── The look, through the sol ────────────────────────────────────────────
// Each page is held at one hour (?sol= from sunrise, 0..1; the sun is up for the first 0.65).
const b = await open("builder", "/mars?sol=0.2", key);
const built = await sf(b, () => {
  const s = window.snapfort;
  let n = 0;
  const put = (type, x, y, z, rot, material) => { if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material, edit: 0 } })) n++; };
  for (const [x, m] of [[0, "wood"], [2, "brick"], [4, "metal"]]) {
    for (let y = 0; y < 2; y++) { put("wall", x, y, 3, 0, m); put("wall", x, y, 4, 0, m); put("wall", x, y, 3, 1, m); put("wall", x + 1, y, 3, 1, m); put("floor", x, y + 1, 3, 0, m); }
    put("roof", x, 2, 3, 0, m);
  }
  return n;
});
check("(a small base in ice, redbrick and iron, each under a greenhouse)", built === 33, `${built} pieces`);
await wait(1200);
const day = await sky(b);
const warm = day.horizon[0] > day.horizon[1] && day.horizon[1] > day.horizon[2] && day.horizon[0] > 0.7;
check("Mars by day: a butterscotch sky, the sun up, no stars, rust-red ground between two canyon walls, no clouds", warm && day.sun.on && day.sun.y > 0 && day.stars < 0.01 && day.ground === "mars-ground" && day.walls === 2 && !day.clouds, JSON.stringify(day.horizon.map((v) => +v.toFixed(2))));
check("…and by day nothing glows", day.ice === 0 && day.roof === 0 && day.brick === 0);
await stand(b, 12.5, -12, 0, -0.12);
await sf(b, () => { const s = window.snapfort; s.scene.onBeforeRenderObservable.add(() => { for (const m of s.scene.meshes) if (m.name.startsWith("ghost")) m.isVisible = false; }); });
await frames(b, 6);
await b.addStyleTag({ content: "#tip, #toast { display: none !important; }" });
await b.screenshot({ path: "qa/shots/mars-day.png" });

const names = await sf(b, () => `${document.getElementById("material")?.textContent ?? ""} · ${document.getElementById("materials-note")?.textContent ?? ""}`);
check("its three materials are ice, redbrick and iron", ["ice", "redbrick", "iron"].every((n) => names.toLowerCase().includes(n)), names);

const d = await open("dusk", "/mars?sol=0.645", key);
await wait(1200);
const dusk = await sky(d);
check("at sunset the sun is low in the west and the sky round it has turned blue", dusk.sun.on && dusk.sun.x < 0 && dusk.sun.y > 0 && dusk.sun.y < 300 && dusk.blue && !day.blue, `sun ${dusk.sun.y.toFixed(0)} m up`);
check("…and the day is fading: the sky greyer and darker than at noon", dusk.horizon[0] < day.horizon[0] - 0.15);
await stand(d, 12.5, 60, -Math.PI / 2, -0.16); await frames(d, 6);
await d.addStyleTag({ content: "#tip, #toast { display: none !important; }" });
await d.screenshot({ path: "qa/shots/mars-sunset.png" });

const n = await open("night", "/mars?sol=0.8", key);
await wait(1500);
const night = await sky(n);
check("at night the sky is dark and full of stars, the sun gone", night.horizon[0] + night.horizon[1] + night.horizon[2] < 0.4 && night.stars > 0.9 && !night.sun.on);
check("…there is still a little light to build by", night.sunLight > 0.2 && night.sunLight < 0.4, night.sunLight.toFixed(2));
check("…and what is built of ice glows blue, and every greenhouse glows; redbrick walls do not", night.ice > 0.3 && night.roof > 0.3 && night.brick === 0, `ice ${night.ice.toFixed(2)}, roof ${night.roof.toFixed(2)}`);
await stand(n, 12.5, -12, 0, -0.16); await frames(n, 6);
await n.addStyleTag({ content: "#tip, #toast { display: none !important; }" });
await n.screenshot({ path: "qa/shots/mars-night.png" });
check("the same base is there at every hour", (await ids(n)) === (await ids(b)) && (await ids(d)) === (await ids(b)));

// With no hour held, the sol runs off the clock: the sky's objects move.
const live = await open("live", "/mars", key);
const p0 = await sf(live, () => { const m = window.snapfort.scene.getMeshByName("phobos"); return [m.position.x, m.position.y]; });
await wait(4000);
const p1 = await sf(live, () => { const m = window.snapfort.scene.getMeshByName("phobos"); return [m.position.x, m.position.y]; });
check("left to itself the sol passes: Phobos moves across the sky", Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 5, `${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(0)} m in 4 s`);
await live.close();

// ── Owners build; visitors watch ─────────────────────────────────────────
const v = await open("visitor", "/mars?sol=0.2&testpay");
const m = await open("meadow", "/");
check("with the Full Game you build on Mars; without, you visit", (await sf(b, () => window.snapfort.builder)) && !(await sf(v, () => window.snapfort.builder)));
await wait(600);
check("a visitor sees what owners built", (await ids(v)) === (await ids(b)));
const before = await ids(b);
await sf(v, () => window.snapfort.history.do({ kind: "place", piece: { type: "wall", x: 9, y: 0, z: 9, rot: 0, id: window.snapfort.nextId(), material: "wood", edit: 0 } }));
await wait(900);
check("the server refuses a visitor's piece sent straight to it", (await ids(b)) === before && (await ids(v)) === before);

// ── The pull ─────────────────────────────────────────────────────────────
await stand(b, 40, -40); await stand(m, 40, -40);
const marsJump = await jumpHeight(b), meadowJump = await jumpHeight(m);
check("a jump on Mars goes about 6.2 m, half as high again as in the meadow", marsJump > 5.6 && marsJump < 6.9 && meadowJump > 3.9 && meadowJump < 4.8, `Mars ${marsJump.toFixed(2)} m, meadow ${meadowJump.toFixed(2)} m`);

// ── The beacon, and airbags ──────────────────────────────────────────────
await stand(b, 152.5, -179); await wait(200);
await sf(b, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: 30, y: 0, z: -36, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await stand(b, 152.5, -177.5); await wait(500);
await b.keyboard.press("KeyH"); await wait(600);
check("(the owner gets on a beacon)", !!(await sf(b, () => window.snapfort.crewOn)));
const aimAt = async (x, y, z) => { for (let i = 0; i < 4; i++) { await sf(b, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [x, y, z]); await frames(b, 2); } };
// The visitor stands 110 m off, to be hit.
await stand(v, 152.5, -67.5, Math.PI); await wait(600);
await aimAt(152.5, 0.2, -66);
const panel = await b.textContent("#crew");
check("the beacon is ready, its mark about 110 m away", panel.includes("ready") && /Target 11\d m/.test(panel), panel);
await b.screenshot({ path: "qa/shots/mars-beacon.png" });
const vStart = await sf(v, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));
const vId = await sf(v, () => window.snapfort.myId);
const fired = Date.now();
await b.mouse.down(); await b.mouse.up();
let hitAt = 0, beam = false, beamSeenByAll = false, top = 0, dived = false;
for (let i = 0; i < 80 && !hitAt; i++) {
  await wait(50);
  const now = await sf(b, () => { const s = window.snapfort.scene; const m = s.meshes.find((m) => m.name === "missile" && m.isEnabled()); const beam = s.meshes.find((m) => m.name === "beacon-beam" && m.isEnabled()); return { y: m ? m.position.y : 0, x: m ? m.position.x : 0, z: m ? m.position.z : 0, beam: beam ? [beam.position.x, beam.position.z] : null }; });
  top = Math.max(top, now.y);
  beam ||= !!now.beam && Math.hypot(now.beam[0] - 152.5, now.beam[1] + 66) < 3;
  dived ||= now.y > 10 && now.y < 60 && Math.hypot(now.x - 152.5, now.z + 66) < 3;
  beamSeenByAll ||= await sf(v, () => window.snapfort.scene.meshes.some((m) => m.name === "beacon-beam" && m.isEnabled()));
  if (await sf(v, () => window.snapfort.player.tumbling)) hitAt = Date.now();
}
const took = (hitAt - fired) / 1000;
check("a red beam stands on the mark while the missile is on its way, for everyone to see", beam && beamSeenByAll);
check("the missile climbs about 60 m above the beacon, then comes straight down on the mark", top > 55 && top < 72 && dived, `${top.toFixed(0)} m up`);
check("it is there about three seconds after the click", hitAt > 0 && took > 2.2 && took < 4.2, `${took.toFixed(1)} s`);
// Airbags: bouncing away, seen by everyone, then on their feet.
let highs = 0, rising = false, last = 0, bags = false, bagsSeen = false, peak = 0;
for (let i = 0; i < 260; i++) {
  await wait(60);
  const now = await sf(v, () => { const s = window.snapfort; return { y: s.player.position.y, down: s.player.knockedDown, bags: s.scene.meshes.some((m) => m.name.startsWith("airbags-") && m.isEnabled()) }; });
  bags ||= now.bags; peak = Math.max(peak, now.y);
  if (rising && now.y < last - 0.02) { highs++; rising = false; } else if (now.y > last + 0.02) rising = true;
  last = now.y;
  bagsSeen ||= await sf(b, (id) => window.snapfort.scene.meshes.some((m) => m.name === `airbags-${id}` && m.isEnabled()), vId);
  if (i > 30 && !now.down) break;
}
check("a builder by the hit is wrapped in airbags and thrown up (visitors too)", bags && peak > 8, `${peak.toFixed(0)} m up`);
check("…and comes down bouncing: three bounces or more", highs >= 3, `${highs} times up and down`);
check("…and everyone else sees the bags", bagsSeen);
await wait(400);
const vEnd = await sf(v, () => { const s = window.snapfort; return { x: s.player.position.x, z: s.player.position.z, feet: s.player.feetY, down: s.player.knockedDown, bags: s.scene.meshes.some((m) => m.name.startsWith("airbags-") && m.isEnabled()) }; });
const carried = Math.hypot(vEnd.x - vStart.x, vEnd.z - vStart.z);
check("…then the bags let go and they are on their feet, some way off", !vEnd.down && !vEnd.bags && carried > 8 && Math.abs(vEnd.feet) < 0.3, `${carried.toFixed(0)} m away, feet at ${vEnd.feet.toFixed(2)} m`);
await v.keyboard.down("KeyW"); await wait(600); await v.keyboard.up("KeyW");
const walked = await sf(v, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));
check("…and walk away from it", Math.hypot(walked.x - vEnd.x, walked.z - vEnd.z) > 2);
await b.keyboard.press("KeyH");

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
