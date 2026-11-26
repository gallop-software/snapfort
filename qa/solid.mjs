/**
 * Nothing passes through anything (user, 2026-11-26: "like Star Fox 64...
 * you didn't have these glitches where players and objects could intersect").
 * In the Meadow: two builders walking into each other are both shoved, and
 * neither stands inside the other; a piece is never built into somebody; a
 * builder thrown at a door cut in a wall flies through it, and one thrown at
 * the wall beside it does not; another builder drawn running round a corner
 * is never drawn inside the wall. On the Moon and Mars: a parked rover and a
 * parked helicopter are solid to a builder walking into them, and getting out
 * of either beside something built puts the builder on clear ground, never
 * inside it. Needs the Gallop dev server.
 * Run: npm run qa:solid
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `solid-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, path = "/", key = null) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_/.test(m.text())) errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(1200);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const at = (page) => sf(page, () => { const p = window.snapfort.player.position; return [p.x, p.y, p.z]; });
const put = (page, list) => sf(page, (list) => { const s = window.snapfort; let n = 0; for (const [type, x, y, z, rot, edit] of list) if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "wood", edit: edit ?? 0 } })) n++; return n; }, list);
const face = (page, yaw) => sf(page, (yaw) => { const s = window.snapfort; s.rig.yaw = yaw; s.rig.pitch = 0.1; }, yaw);
const teleport = (page, x, z) => sf(page, ([x, z]) => window.snapfort.player.teleport(x, 0.95, z), [x, z]);

const a = await open("A");
const b = await open("B");

// ── Two builders, one place ──────────────────────────────────────────────
// Out on open ground, away from where builders start.
const X = 120, Z = 120;
await teleport(a, X, Z);
await teleport(b, X + 6, Z);
await face(a, Math.PI / 2);
await face(b, -Math.PI / 2);
await wait(900);
// A walks into B, who stands still.
const bBefore = await at(b);
await a.keyboard.down("w");
let closest = Infinity;
for (let i = 0; i < 16; i++) {
  await wait(120);
  const [pa, pb] = [await at(a), await at(b)];
  closest = Math.min(closest, Math.hypot(pa[0] - pb[0], pa[2] - pb[2]));
}
await a.keyboard.up("w");
await wait(600);
const bAfter = await at(b);
check("walking into someone: neither stands inside the other", closest > 0.45, `closest ${closest.toFixed(2)} m between their middles`);
// (How far varies, 0.6 to 2 m: B's page sees A through the network's delay, so how long they overlap differs from run to run.)
check("…and the one walked into is shoved along", bAfter[0] - bBefore[0] > 0.4, `B moved ${(bAfter[0] - bBefore[0]).toFixed(2)} m`);

// ── Nothing is built into somebody ───────────────────────────────────────
// B stands in the middle of a cell.
await teleport(b, 132.5, 122.5);
await wait(900);
const cx = 26, cz = 24;
const ramp = await sf(a, ([cx, cz]) => { const s = window.snapfort; return s.placeable({ type: "ramp", x: cx, y: 0, z: cz, rot: 0 }); }, [cx, cz]);
check("a ramp aimed where someone stands is refused", ramp.ok === false && ramp.problem === "blocked", JSON.stringify(ramp));
const floor = await sf(a, ([cx, cz]) => window.snapfort.placeable({ type: "floor", x: cx, y: 0, z: cz, rot: 0 }), [cx, cz]);
check("…but a floor at their feet is not (it lifts them onto it)", floor.ok === true, JSON.stringify(floor));
// Sneaking one past the page: the server refuses it.
// (Straight to the build, past the page's own check, as a tampered page would.)
const sent = await sf(a, ([cx, cz]) => { const s = window.snapfort; const id = s.nextId(); s.history.do({ kind: "place", piece: { type: "roof", x: cx, y: 0, z: cz, rot: 0, id, material: "wood", edit: 0 } }); return id; }, [cx, cz]);
await wait(1200);
check("…and the world itself refuses it, whatever a page sends", !(await sf(b, (id) => !!window.snapfort.state.get(id), sent)));

// ── A throw through a door ───────────────────────────────────────────────
// Two walls side by side across x = 150 m: the near one with a door cut in it (tiles 1 and 4: its middle column, bottom two rows).
const W = 30, WZ = 20;
await put(a, [["wall", W, 0, WZ, 1, (1 << 1) | (1 << 4)], ["wall", W, 0, WZ + 1, 1, 0]]);
await wait(900);
const doorZ = (WZ + 0.5) * 5, wallZ = (WZ + 1.5) * 5;
const flights = await sf(a, ([wx, doorZ, wallZ]) => {
  const s = window.snapfort;
  // (Low: the door is 2.5 m tall, a builder 1.8.)
  const plan = (z) => s.planFall([wx * 5 - 2.5, 0.95, z], [16, 4, 0]);
  const door = plan(doorZ), wall = plan(wallZ);
  return { door: door.land[0] - wx * 5, wall: wall.land[0] - wx * 5 };
}, [W, doorZ, wallZ]);
check("a builder thrown at a door flies through it; one thrown at the wall beside it does not", flights.door > 1 && flights.wall < -0.3, JSON.stringify(flights));

// ── Another builder drawn running round a corner ─────────────────────────
// A wall's end at (175 m, 100..105 m): B runs past it; A watches, and every frame A draws B nowhere inside the wall.
await put(b, [["wall", 35, 0, 20, 1, 0]]);
await teleport(b, 172, 99);
await teleport(a, 165, 90);
await face(a, Math.atan2(172 - 165, 102 - 90));
await wait(900);
await sf(a, (id) => {
  window.inside = 0;
  window.frames = 0;
  const s = window.snapfort;
  const solids = new s.Solids(s.state, s.env);
  s.scene.onAfterRenderObservable.add(() => {
    const p = s.remotes.positionOf(id);
    if (!p) return;
    window.frames++;
    const hit = solids.touch(p, 0.32, 0.5, { stepUp: 0.3 });
    if (hit && hit.depth > 0.12) window.inside++;
  });
}, await sf(b, () => window.snapfort.myId));
await face(b, 0);
for (const key of ["d", "w", "a"]) {
  await b.keyboard.down("ShiftLeft");
  await b.keyboard.down(key);
  await wait(650);
  await b.keyboard.up(key);
  await b.keyboard.up("ShiftLeft");
}
await wait(800);
const seen = await sf(a, () => ({ frames: window.frames, inside: window.inside }));
check("another builder running round a wall's end is never drawn inside it", seen.frames > 30 && seen.inside === 0, JSON.stringify(seen));

await a.context().close();
await b.context().close();

// ── The Moon and Mars: what is parked is solid, and every way out is clear ──
/**
 * Walks a builder at a parked thing from `far` metres off to one side (its
 * side: across it, (cos yaw, -sin yaw)) for 2.4 s: how near its middle they
 * ever came, along the ground.
 */
async function walkInto(page, pose) {
  const side = [Math.cos(pose[3]), -Math.sin(pose[3])];
  await sf(page, ([x, z, sx, sz]) => window.snapfort.player.teleport(x + sx * 7, 0.95, z + sz * 7), [pose[0], pose[2], ...side]);
  await sf(page, ([sx, sz]) => { const s = window.snapfort; s.rig.yaw = Math.atan2(-sx, -sz); s.rig.pitch = 0.1; }, side);
  await wait(700);
  let nearest = Infinity;
  await page.keyboard.down("w");
  for (let i = 0; i < 20; i++) {
    await wait(120);
    const p = await at(page);
    nearest = Math.min(nearest, Math.hypot(p[0] - pose[0], p[2] - pose[2]));
  }
  await page.keyboard.up("w");
  return nearest;
}
/**
 * Gets in a parked thing (H) and out again (H): whether the builder ended up
 * inside anything built or inside the thing itself (its body: `w` across, `d`
 * long). Then the question every way out now asks (PageGame.clearSpot), put
 * at a spot inside a wall built beside it and at its own middle: the answers
 * must be clear of both.
 */
async function outBeside(page, pose, w, d) {
  await sf(page, ([x, z, sx, sz]) => { const s = window.snapfort; s.player.teleport(x + sx * 3, 0.95, z + sz * 3); s.rig.yaw = Math.atan2(-sx, -sz); }, [pose[0], pose[2], Math.cos(pose[3]), -Math.sin(pose[3])]);
  await wait(500);
  await page.keyboard.press("KeyH"); await wait(900);
  const got = await sf(page, () => !!window.snapfort.player.riding);
  await page.keyboard.press("KeyH"); await wait(900);
  // Where they got out, judged before anything else is built.
  const out = await sf(page, ([pose, w, d]) => {
    const s = window.snapfort, p = s.player.position;
    const hit = new s.Solids(s.state, s.env, () => s.feature.solids?.() ?? []).touch([p.x, p.y, p.z], 0.36, 0.5, { stepUp: 0.3 });
    const dx = p.x - pose[0], dz = p.z - pose[2], c = Math.cos(pose[3]), sn = Math.sin(pose[3]);
    const inThing = Math.abs(dx * c - dz * sn) < w / 2 + 0.3 && Math.abs(dx * sn + dz * c) < d / 2 + 0.3;
    return { depth: hit ? +hit.depth.toFixed(2) : 0, inThing, at: [p.x, p.y, p.z].map((v) => +v.toFixed(1)) };
  }, [pose, w, d]);
  // (Stepped well away first: the world builds nothing into somebody.)
  await sf(page, ([x, z]) => window.snapfort.player.teleport(x - 12, 0.95, z - 12), [pose[0], pose[2]]);
  await wait(600);
  // A wall on the edge of its cell, along z.
  const wx = Math.floor(pose[0] / 5) + 1, wz = Math.floor(pose[2] / 5);
  const kept = await sf(page, async ([wx, wz]) => { const s = window.snapfort; const id = s.nextId(); s.history.do({ kind: "place", piece: { type: "wall", x: wx, y: 0, z: wz, rot: 1, id, material: "wood", edit: 0 } }); await new Promise((r) => setTimeout(r, 900)); return !!s.state.get(id); }, [wx, wz]);
  return { got, kept, ...(await sf(page, ([pose, w, d, wallX, out]) => {
    const s = window.snapfort;
    const solids = new s.Solids(s.state, s.env, () => s.feature.solids?.() ?? []);
    const where = (p) => {
      const hit = solids.touch(p, 0.36, 0.5, { stepUp: 0.3 });
      const dx = p[0] - pose[0], dz = p[2] - pose[2], c = Math.cos(pose[3]), sn = Math.sin(pose[3]);
      const across = dx * c - dz * sn, along = dx * sn + dz * c;
      const inThing = Math.abs(across) < w / 2 + 0.3 && Math.abs(along) < d / 2 + 0.3 && p[1] - 0.9 < pose[1] + 1.5;
      return { depth: hit ? +hit.depth.toFixed(2) : 0, inThing, at: p.map((v) => +v.toFixed(1)) };
    };
    return {
      riding: !!s.player.riding,
      out,
      fromWall: where(s.clearSpot(wallX, 0.95, pose[2])),
      fromMiddle: where(s.clearSpot(pose[0], 0.95, pose[2])),
    };
  }, [pose, w, d, wx * 5, out])) };
}
const clean = (o) => o.got && o.kept && !o.riding && [o.out, o.fromWall, o.fromMiddle].every((p) => p.depth < 0.08 && !p.inThing);

const moonKey = await paidKey(base, "/moon");
const moon = await open("moon", "/moon", moonKey);
const rover = await sf(moon, () => { const [id, r] = [...window.snapfort.feature.rover.rovers][0]; return { id, pose: [...r.pose] }; });
const nearRover = await walkInto(moon, rover.pose);
check("Moon: a builder walking into a parked rover is stopped at its side", nearRover > 1.3, `came within ${nearRover.toFixed(2)} m of its middle (it is 2.3 m across)`);
const roverOut = await outBeside(moon, rover.pose, 2.3, 3.0);
check("Moon: getting out of a rover puts the builder on clear ground, and a way out blocked by a wall or the rover itself moves them clear of both", clean(roverOut), JSON.stringify(roverOut));

const marsKey = await paidKey(base, "/mars");
const mars = await open("mars", "/mars?sol=0.3&air=0", marsKey);
const heli = await sf(mars, () => { const [id, h] = [...window.snapfort.feature.helicopter.helis][0]; return { id, pose: [...h.pose] }; });
const nearHeli = await walkInto(mars, heli.pose);
check("Mars: a builder walking into a parked helicopter is stopped at its side", nearHeli > 1.5, `came within ${nearHeli.toFixed(2)} m of its middle (it is 2.6 m across)`);
const heliOut = await outBeside(mars, heli.pose, 2.6, 6.5);
check("Mars: getting out of a helicopter puts the builder on clear ground, and a way out blocked by a wall or the helicopter itself moves them clear of both", clean(heliOut), JSON.stringify(heliOut));

check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
