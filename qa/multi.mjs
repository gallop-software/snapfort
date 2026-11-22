/**
 * Multiplayer QA for SnapFort: two browser pages build in the same (fresh) world
 * and must always agree with each other. Start the Gallop dev server first,
 * then: npm run qa:multi  (or: npm run qa:multi -- "http://localhost:5173/").
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const world = `multi-${Date.now().toString(36)}`;
const base = new URL(process.argv[2] ?? "http://localhost:5173/");
base.searchParams.set("world", world);
mkdirSync("qa/shots", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

async function open(label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${label} ${m.type()}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`[${label} pageerror] ${e.message.slice(0, 300)}`));
  await page.goto(base.toString());
  await page.waitForSelector("body.ready", { timeout: 20000 });
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const dump = (page) => sf(page, () => [...window.snapfort.state.all()].map((p) => `${p.id}:${p.type}:${p.x},${p.y},${p.z},${p.rot}:${p.material}:${p.edit}`).sort().join("\n"));
const count = (page) => sf(page, () => window.snapfort.state.size);
/** Waits until both pages have sent and heard everything, then compares. */
async function settle(...pages) {
  for (let i = 0; i < 40; i++) {
    await Promise.all(pages.map((p) => frames(p, 2)));
    const busy = await Promise.all(pages.map((p) => sf(p, () => window.snapfort.synced.inFlight)));
    if (busy.every((n) => n === 0)) break;
  }
  await new Promise((r) => setTimeout(r, 300));
  await Promise.all(pages.map((p) => frames(p, 2)));
}
const put = (page, list) => sf(page, (list) => { const s = window.snapfort; let n = 0; for (const [type, x, y, z, rot] of list) if (s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material: "brick", edit: 0 } })) n++; return n; }, list);

const a = await open("A");
const b = await open("B");
check("both pages join the world", await sf(a, () => window.snapfort.net.online) && await sf(b, () => window.snapfort.net.online));
await new Promise((r) => setTimeout(r, 300));
check("each sees two builders online", (await a.textContent("#online")) === "2 builders online" && (await b.textContent("#online")) === "2 builders online", `${await a.textContent("#online")} / ${await b.textContent("#online")}`);

// A builds a small fort: 50 pieces.
const fort = [];
for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) fort.push(["floor", x, 0, z, 0]);
for (let x = 0; x < 5; x++) { fort.push(["wall", x, 0, 0, 0], ["wall", x, 0, 5, 0]); }
for (let z = 0; z < 5; z++) { fort.push(["wall", 0, 0, z, 1], ["wall", 5, 0, z, 1]); }
fort.push(["ramp", 2, 0, 2, 0], ["roof", 3, 0, 3, 0], ["floor", 2, 1, 2, 0], ["floor", 3, 1, 2, 0], ["floor", 2, 1, 3, 0]);
const placed = await put(a, fort);
await settle(a, b);
check(`B sees all ${placed} pieces A built`, (await count(b)) === placed && (await dump(a)) === (await dump(b)), `${await count(b)} of ${placed}`);
const audit = await sf(b, () => window.snapfort.audit());
check("…and draws them all, solid", audit.length === 0, audit.slice(0, 3).join("; "));

// A walks; B sees A's builder near where A is.
await sf(a, () => { const s = window.snapfort; s.player.teleport(12, 0.95, -8); s.rig.yaw = 1.2; });
for (let i = 0; i < 4; i++) { await sf(a, (i) => window.snapfort.player.teleport(12 + i, 0.95, -8), i); await frames(a, 8); }
await new Promise((r) => setTimeout(r, 700));
await frames(b, 4);
const seen = await sf(b, () => { const r = [...window.snapfort.remotes.remotes.values()][0]; return r && { x: r.x, z: r.z, name: r.player.name, full: !!r.avatar }; });
const posA = await sf(a, () => ({ x: window.snapfort.player.position.x, z: window.snapfort.player.position.z }));
check("B sees A's builder where A is", !!seen && Math.hypot(seen.x - posA.x, seen.z - posA.z) < 1.5, seen ? `B sees ${seen.x.toFixed(1)},${seen.z.toFixed(1)}; A is at ${posA.x.toFixed(1)},${posA.z.toFixed(1)}` : "nobody");
check("…with the full animated body up close", !!seen?.full);

// A renames; B's name list follows.
await sf(a, () => { document.getElementById("player-name").value = "Captain Test"; document.getElementById("player-name").dispatchEvent(new Event("change")); });
await new Promise((r) => setTimeout(r, 400));
check("a new name reaches the other builder", (await sf(b, () => [...window.snapfort.remotes.remotes.values()][0]?.player.name)) === "Captain Test");

// Both build in the same spot at the same moment: one wins, both agree.
await Promise.all([put(a, [["floor", 8, 0, 8, 0]]), put(b, [["floor", 8, 0, 8, 0]])]);
await settle(a, b);
const winners = (await dump(a)).split("\n").filter((l) => l.includes(":floor:8,0,8,"));
check("a race for one spot ends with one piece, the same for both", winners.length === 1 && (await dump(a)) === (await dump(b)), winners.join(" "));

// B knocks out the walls holding up a raised floor A built; both see it fall.
await put(a, [["wall", 10, 0, 0, 0], ["floor", 10, 1, 0, 0], ["wall", 10, 1, 0, 0]]);
await settle(a, b);
const before = await count(a);
await sf(b, () => { const s = window.snapfort; const w = [...s.state.all()].find((p) => p.type === "wall" && p.x === 10 && p.y === 0 && p.z === 0); s.removePiece(w.id); });
await settle(a, b);
check("removing a support brings down what it held, for everyone", (await count(a)) === before - 3 && (await dump(a)) === (await dump(b)), `${before} → ${await count(a)}`);

// B undoes; A sees it come back.
await sf(b, () => window.snapfort.history.undo());
await settle(a, b);
check("undo puts the collapse back for everyone", (await count(a)) === before && (await dump(a)) === (await dump(b)));

// Random building on both pages at once.
const fuzz = (page, seed) => sf(page, async (seed) => {
  const s = window.snapfort; const types = ["wall", "floor", "ramp", "roof"];
  let r0 = seed; const r = () => ((r0 = (r0 * 16807) % 2147483647) - 1) / 2147483646;
  const frame = () => new Promise((res) => requestAnimationFrame(res));
  for (let step = 0; step < 300; step++) {
    const roll = r(); const all = [...s.state.all()];
    if (roll < 0.55) { const spec = { type: types[Math.floor(r() * 4)], x: 14 + Math.floor(r() * 5), y: Math.floor(r() * 2), z: Math.floor(r() * 5), rot: Math.floor(r() * 4) }; if (s.state.canPlace(spec).ok) s.history.do({ kind: "place", piece: { ...spec, id: s.nextId(), material: "wood", edit: 0 } }); }
    else if (roll < 0.7 && all.length) { const near = all.filter((p) => p.x >= 14); if (near.length) s.removePiece(near[Math.floor(r() * near.length)].id); }
    else if (roll < 0.8 && all.length) { const p = all.find((p) => p.type === "wall" && p.x >= 14); if (p) s.history.do({ kind: "edit", id: p.id, edit: Math.floor(r() * 511) }); }
    else if (roll < 0.9) s.history.undo(); else s.history.redo();
    if (step % 3 === 0) await frame();
  }
}, seed);
await Promise.all([fuzz(a, 11), fuzz(b, 23)]);
await settle(a, b);
check("300 random actions on each page at once: both end the same", (await dump(a)) === (await dump(b)), `${await count(a)} vs ${await count(b)} pieces`);

// A fresh page (or a reload) gets the same world.
await b.reload();
await b.waitForSelector("body.ready", { timeout: 20000 });
await settle(a, b);
check("after a reload, the world is all still there", (await dump(a)) === (await dump(b)), `${await count(a)} vs ${await count(b)}`);
await b.screenshot({ path: "qa/shots/multi-b.png" });

// B leaves; A's count drops.
await b.context().close();
await new Promise((r) => setTimeout(r, 500));
check("when a builder leaves, the others see it", (await a.textContent("#online")) === "1 builder online", await a.textContent("#online"));

check("no errors or warnings in the console", errors.length === 0, errors.slice(0, 5).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
