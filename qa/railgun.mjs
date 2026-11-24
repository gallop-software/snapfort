/**
 * The Moon's rail gun: the Railgun tool beside the Launcher, a kit of 22
 * numbered parts put on by aiming at where each goes, any number of guns;
 * the rising end needs holding up with ordinary pieces; a launcher's shot
 * knocks parts out and something built on the rail blocks it; whole, it
 * charges, and whoever sits in the capsule (visitors too) is thrown high above
 * the Moon, to fly down on their rockets to wherever they choose. Needs the Gallop dev server
 * with Stripe test keys in .dev.vars. Run: npm run qa:railgun
 */
import { chromium, devices } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = (process.env.QA_BASE ?? "http://localhost:5173");
const world = `railgun-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(label, key, device) {
  const context = await browser.newContext(device ?? { viewport: { width: 1100, height: 680 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key ?? null);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}/moon?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  if (device) await page.tap("#play-free"); else await page.click("#play-free");
  await wait(800);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
/** Brings a page to the front and makes sure it is playing (a browser lets go of the mouse when another window takes over; a click on the game takes it back). */
async function front(page) {
  await page.bringToFront();
  for (let i = 0; i < 5 && !(await page.evaluate(() => window.snapfort.input.locked)); i++) {
    if (await page.isVisible("#resume")) await page.click("#resume"); else await page.mouse.click(550, 200);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const guns = (page) => sf(page, () => [...window.snapfort.feature.railgun.guns.values()].map((s) => ({ ...s.gun, drawn: s.meshes.size })));
const panel = (page) => page.textContent("#world-panel");
const toast = (page) => page.textContent("#toast");
const AHEAD = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** Where part `n` of a gun goes: its middle on the ground or floor it stands on, in metres. */
function spot(g, n) {
  const [ax, az] = AHEAD[g.dir];
  const along = n <= 4 || n === 22 ? (n === 1 ? 0 : 1) : n === 21 ? 34 : 2.5 + 2 * (n - 5);
  const side = n === 3 ? -1 : n === 4 ? 1 : 0;
  const up = n === 21 ? 3 : n >= 18 && n <= 20 ? n - 18 : 0;
  return [(g.x + 0.5 + ax * along + az * side) * 5, (g.y + up) * 3.75, (g.z + 0.5 + az * along - ax * side) * 5];
}
/** Stands a builder a little to the side of part `n` and aims the crosshair at where it goes. */
async function aimAt(page, g, n) {
  const [mx, my, mz] = spot(g, n);
  const [ax, az] = AHEAD[g.dir];
  await sf(page, ([x, y, z]) => window.snapfort.player.teleport(x, y, z), [mx - az * 7 - ax * 2, my + 0.95 + (my > g.y * 3.75 ? 0.3 : 0), mz + ax * 7 - az * 2]);
  await wait(120);
  for (let i = 0; i < 2; i++) { await sf(page, ([x, y, z]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(x - e.x, z - e.z); s.rig.pitch = -Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)); }, [mx, my + 0.2, mz]); await wait(110); }
  return sf(page, () => window.snapfort.feature.railgun.preview);
}
/** Puts part `n` on by aiming and clicking; true when it went on. */
async function place(page, g, n) {
  for (let tries = 0; tries < 3; tries++) {
    await aimAt(page, g, n);
    await page.mouse.down(); await page.mouse.up(); await wait(380);
    if ((await guns(page)).find((x) => x.id === g.id)?.parts.includes(n)) return true;
  }
  return false;
}
const pick = async (page) => { if ((await sf(page, () => document.querySelector("#hotbar .slot.selected .label")?.textContent)) !== "Railgun") { await page.keyboard.press("KeyN"); await wait(300); } };
const putAway = async (page) => { if ((await sf(page, () => document.querySelector("#hotbar .slot.selected .label")?.textContent)) === "Railgun") { await page.keyboard.press("KeyN"); await wait(300); } };

const b = await open("builder", await paidKey(base, "/moon"));
// A second builder with the Full Game (their own key), who does the riding; and a visitor without it.
const v = await open("rider", await paidKey(base, "/moon"));
const w = await open("visitor");
const vId = await sf(v, () => window.snapfort.myId);
// (The rider only rides: they put their Wall tool away, so none of their clicks builds anything.)
await front(v); await v.keyboard.press("KeyZ"); await wait(300); await front(b);

// ── The Railgun tool ─────────────────────────────────────────────────────
const slots = await sf(b, () => [...document.querySelectorAll("#hotbar .slot .label")].map((e) => e.textContent));
check("Railgun is on the Moon's hotbar, next to Launcher", slots.indexOf("Railgun") === slots.indexOf("Launcher") + 1 && slots.includes("Launcher"), slots.join(" · "));
await front(w);
await w.keyboard.press("KeyN"); await wait(1200);
check("a visitor picking it is offered the Full Game (building needs it)", await w.isVisible("#view-unlock"));
await w.click("#unlock-later"); await wait(1300);
await front(b);

await sf(b, () => { const s = window.snapfort; s.player.teleport(-60, 0.95, 60); s.rig.yaw = Math.PI / 2; s.rig.pitch = 0.35; });
await pick(b);
const fresh = await sf(b, () => window.snapfort.feature.railgun.preview);
check("picked, it shows where a new rail gun would start, pointing the way you face", /New rail gun/.test(await panel(b)) && fresh?.gun === null && fresh.part === 1 && fresh.ok && fresh.base.dir === 1, await panel(b));
// Facing the edge from near it: the whole gun would not fit.
await sf(b, () => { const s = window.snapfort; s.player.teleport(200, 0.95, 60); s.rig.yaw = Math.PI / 2; s.rig.pitch = 0.35; });
await wait(400);
check("…and says so where the whole of it would not fit", /no room/.test(await panel(b)) && !(await sf(b, () => window.snapfort.feature.railgun.preview.ok)), await panel(b));
await b.mouse.down(); await b.mouse.up(); await wait(500);
check("…where a click starts nothing", (await guns(b)).length === 0);
await sf(b, () => { const s = window.snapfort; s.player.teleport(-60, 0.95, 60); s.rig.yaw = Math.PI / 2; s.rig.pitch = 0.35; });
await wait(400);
await b.mouse.down(); await b.mouse.up(); await wait(700);
const g = (await guns(b))[0];
check("a click puts down the base: a rail gun is begun, for everyone", !!g && g.parts.length === 1 && g.drawn === 1 && (await guns(v))[0]?.parts.length === 1 && /1 of 22/.test(await panel(b)), JSON.stringify(g));

// ── Putting it together ──────────────────────────────────────────────────
const next = await aimAt(b, g, 2);
check("aim at where a part goes and it is offered, by number and name", next?.part === 2 && next.ok && /2 · Breech/.test(await panel(b)), await panel(b));
const far = await aimAt(b, g, 12);
check("…but not a part with nothing to join to yet", far && (far.part !== 12 || !far.ok), JSON.stringify(far));
let on = 0;
for (const n of [2, 22, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) if (await place(b, g, n)) on++;
check("the breech, the capsule, both capacitor banks and the rails on the ground go on one by one", on === 18 && (await guns(b))[0].parts.length === 19, `${on} of 18`);
check("…and everyone sees every part", (await guns(v))[0].drawn === 19);
const high = await aimAt(b, g, 19);
const mark = await sf(b, () => { const m = window.snapfort.scene.meshes.find((x) => x.name === "gun-need" && x.isEnabled()); return m ? [m.position.x, m.position.y, m.position.z] : null; });
check("the rising rails need holding up: it says a floor is needed one storey up, and marks where", high?.part === 19 && !high.ok && /needs a floor one storey up at the yellow mark/.test(await panel(b)) && !!mark && Math.abs(mark[1] - 3.75) < 0.01 && Math.hypot(mark[0] - (spot(g, 19)[0] - 2.5), mark[2] - spot(g, 19)[2]) < 0.1, `${await panel(b)} | mark ${JSON.stringify(mark)}`);
// A floor on the ground under it is not enough (it stands a storey up).
await putAway(b);
await sf(b, ([x, z]) => { const s = window.snapfort; window.__low = s.nextId(); s.history.do({ kind: "place", piece: { type: "floor", x: Math.floor(x / 5), y: 0, z: Math.floor(z / 5), rot: 0, id: window.__low, material: "wood", edit: 0 } }); }, [spot(g, 19)[0] - 2.5, spot(g, 19)[2]]);
await wait(600); await pick(b);
const still = await aimAt(b, g, 19);
check("…a floor laid on the ground there does not count: it still asks for one a storey up", still?.part === 19 && !still.ok && /one storey up/.test(await panel(b)), await panel(b));
await sf(b, () => window.snapfort.history.do({ kind: "remove", id: window.__low }));
await wait(500);
await putAway(b);
await sf(b, (g) => { const s = window.snapfort; const A = [[0, 1], [1, 0], [0, -1], [-1, 0]][g.dir]; const put = (type, x, y, z) => s.history.do({ kind: "place", piece: { type, x, y, z, rot: 0, id: s.nextId(), material: "metal", edit: 0 } }); for (const [along, level] of [[30, 1], [32, 2], [34, 3]]) { const x = g.x + A[0] * along, z = g.z + A[1] * along; for (let y = 0; y < level; y++) put("wall", x, y, z); put("floor", x, level, z); } }, g);
await wait(900);
await pick(b);
on = 0;
for (const n of [19, 20, 21]) if (await place(b, g, n)) on++;
const whole = (await guns(b))[0];
check("with pillars and floors built under them, the last three go on: all 22", on === 3 && whole.parts.length === 22 && whole.drawn === 22);
check("whole, it starts to charge", /charging/.test(await panel(b)) && whole.readyAt > 0, await panel(b));

// ── Any number of them ───────────────────────────────────────────────────
await sf(b, () => { const s = window.snapfort; s.player.teleport(-60, 0.95, -120); s.rig.yaw = Math.PI / 2; s.rig.pitch = 0.35; });
await wait(500);
await b.mouse.down(); await b.mouse.up(); await wait(700);
check("another can be started anywhere there is room", (await guns(v)).length === 2);
await putAway(b);

// ── Solid, and taken apart with the Remove tool ──────────────────────────
// Walking straight at the rail from the side: it stops them (they do not pass through).
const wall = spot(g, 10);
await sf(b, ([x, z]) => { const s = window.snapfort; s.player.teleport(x - 2.5, 0.95, z - 9); s.rig.yaw = 0; s.rig.pitch = 0.1; }, [wall[0], wall[2]]);
await wait(400);
await b.keyboard.down("KeyW"); await wait(1500); await b.keyboard.up("KeyW"); await wait(300);
const stopped = await sf(b, () => ({ z: window.snapfort.player.position.z, feet: window.snapfort.player.feetY }));
check("the rail gun is solid: walking at the rail, a builder is stopped by it (or climbs onto it), not through it", stopped.z < wall[2] - 0.9 || stopped.feet > 0.5, `stopped ${(wall[2] - stopped.z).toFixed(1)} m short of its middle, feet at ${stopped.feet.toFixed(2)} m`);
// And a capacitor bank cannot be walked through at all.
const bank = spot(g, 3);
await sf(b, ([x, z]) => { const s = window.snapfort; s.player.teleport(x, 0.95, z + 8); s.rig.yaw = Math.PI; s.rig.pitch = 0.1; }, [bank[0], bank[2]]);
await wait(400);
await b.keyboard.down("KeyW"); await wait(1500); await b.keyboard.up("KeyW"); await wait(300);
const blockedAt = await sf(b, () => window.snapfort.player.position.z);
check("…a capacitor bank stops them dead", blockedAt > bank[2] + 1.9, `${(blockedAt - bank[2]).toFixed(1)} m from its middle`);
// The Remove tool on a part: it shows which, and a click takes it off.
await sf(b, ([x, z]) => { const s = window.snapfort; s.player.teleport(x - 2.5, 0.95, z - 7); }, [wall[0], wall[2]]);
await wait(300);
await b.keyboard.press("KeyV"); await wait(300);
for (let i = 0; i < 3; i++) { await sf(b, ([x, y, z]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(x - e.x, z - e.z); s.rig.pitch = -Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)); }, [wall[0] - 2.5, 0.7, wall[2]]); await wait(120); }
check("with the Remove tool on a part, it says which one a click will take off", /10 · Rail 6/.test(await panel(b)) && /to take it off/.test(await panel(b)), await panel(b));
await b.mouse.down(); await b.mouse.up(); await wait(600);
const taken = (await guns(v))[0];
check("…a click takes that part off, for everyone, and the gun no longer works", !taken.parts.includes(10) && taken.parts.length === 21 && taken.drawn === 21 && taken.readyAt === 0);
// The right button does the same, whatever is picked.
await pick(b);
for (let i = 0; i < 3; i++) { await sf(b, ([x, y, z]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(x - e.x, z - e.z); s.rig.pitch = -Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)); }, [spot(g, 11)[0] - 2.5, 0.7, spot(g, 11)[2]]); await wait(120); }
await b.mouse.down({ button: "right" }); await b.mouse.up({ button: "right" }); await wait(600);
check("…the right button takes a part off too", !(await guns(v))[0].parts.includes(11));
// A visitor cannot take anything off.
await front(w);
await sf(w, ([x, z]) => { const s = window.snapfort; s.player.teleport(x - 2.5, 0.95, z - 7); }, [spot(g, 12)[0], spot(g, 12)[2]]);
await wait(300);
for (let i = 0; i < 3; i++) { await sf(w, ([x, y, z]) => { const s = window.snapfort; const e = s.rig.pivot; s.rig.yaw = Math.atan2(x - e.x, z - e.z); s.rig.pitch = -Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)); }, [spot(g, 12)[0] - 2.5, 0.7, spot(g, 12)[2]]); await wait(120); }
await w.mouse.down({ button: "right" }); await w.mouse.up({ button: "right" }); await wait(1300);
check("…a visitor cannot", (await guns(b))[0].parts.includes(12));
if (await w.isVisible("#view-unlock")) { await w.click("#unlock-later"); await wait(1300); }
// Nor get in the capsule: riding it comes with the Full Game, and pressing H offers that.
await sf(w, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
for (let i = 0; i < 20 && !/capsule/.test(await w.textContent("#hint")); i++) await wait(150);
await w.keyboard.press("KeyH"); await wait(1300);
check("…nor get in the capsule: H offers the Full Game", (await w.isVisible("#view-unlock")) && (await sf(w, () => window.snapfort.feature.railgun.seated)) === null && (await guns(b))[0].rider === null);
if (await w.isVisible("#view-unlock")) { await w.click("#unlock-later"); await wait(1300); }
await sf(w, () => window.snapfort.player.teleport(-150, 0.95, -150));
await front(b);
// Put the two back.
await pick(b);
for (const n of [10, 11]) await place(b, g, n);
check("…and the parts go back on with the Railgun tool", (await guns(b))[0].parts.length === 22);
await putAway(b);

// ── Nothing is built into it, and shot at ────────────────────────────────
const jam = spot(g, 9);
await sf(b, ([x, z, across]) => { const s = window.snapfort; const cx = Math.floor(x / 5) , cz = Math.floor(z / 5); window.__jam = [s.nextId(), s.nextId(), s.nextId()]; window.__jamCell = [cx, cz]; s.history.do({ kind: "place", piece: { type: "floor", x: cx, y: 0, z: cz, rot: 0, id: window.__jam[0], material: "wood", edit: 0 } }); s.history.do({ kind: "place", piece: { type: "roof", x: cx, y: 0, z: cz, rot: 0, id: window.__jam[1], material: "wood", edit: 0 } }); s.history.do({ kind: "place", piece: { type: "wall", x: cx, y: 0, z: cz, rot: across, id: window.__jam[2], material: "wood", edit: 0 } }); }, [jam[0] - 2.5, jam[2], g.dir % 2 === 1 ? 1 : 0]);
await wait(900);
const jammed = await sf(b, () => window.__jam.map((id) => !!window.snapfort.state.get(id)));
check("a dome, or a wall across it, cannot be built into the rail (the server takes them back); a floor on the ground under it can", jammed.join() === "true,false,false", jammed.join());
await front(v);
await sf(v, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
for (let i = 0; i < 30 && !(await panel(v)); i++) await wait(150);
check("…so the gun is never blocked: it is charging or ready", /charging|ready/.test(await panel(v)) && (await guns(v))[0].parts.length === 22, await panel(v));
await front(b);
await sf(b, () => { const s = window.snapfort; s.history.do({ kind: "remove", id: window.__jam[0] }); });
await wait(500);
// A launcher 60 m to the side, aimed at rail 8.
const target = spot(g, 12);
await sf(b, ([x, z]) => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: Math.floor(x / 5), y: 0, z: Math.floor(z / 5) - 12, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); s.player.teleport(x + 1.5, 1.4, z - 59); }, [target[0], target[2]]);
await wait(700); await b.keyboard.press("KeyH"); await wait(700);
for (let i = 0; i < 4; i++) { await sf(b, ([x, y, z]) => { const s = window.snapfort; const p = s.rig.pivot; s.rig.yaw = Math.atan2(x - p.x, z - p.z); s.rig.pitch = -Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z)); }, [target[0], target[1] + 0.5, target[2]]); await wait(80); }
const aimed = await sf(b, () => window.snapfort.target);
check("the launcher's crosshair lands on a rail gun part", !!aimed && Math.hypot(aimed[0] - target[0], aimed[2] - target[2]) < 3 && aimed[1] > 0.3, JSON.stringify(aimed?.map((n) => +n.toFixed(1))));
// The rider is sitting in the capsule, 50 m from where the shot will land.
await front(v);
await sf(v, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
await wait(700);
await v.keyboard.press("KeyH"); await wait(900);
check("(a builder sits in the capsule)", (await sf(v, () => window.snapfort.feature.railgun.seated)) === g.id, JSON.stringify(await sf(v, () => { const s = window.snapfort; const q = s.player.position; return { at: [q.x, q.y, q.z].map((n) => +n.toFixed(1)), locked: s.input.locked, builder: s.builder, down: s.player.knockedDown, hint: document.getElementById("hint").textContent, toast: document.getElementById("toast").textContent, view: document.querySelector("#overlay .panel > div:not([hidden])")?.id, rider: [...s.feature.railgun.guns.values()][0]?.gun.rider }; })));
await front(b);
await b.mouse.down(); await b.mouse.up();
let flailed = false, flungTo = 0;
for (let i = 0; i < 60; i++) { await wait(100); const q = await sf(v, () => ({ tumbling: window.snapfort.player.tumbling, y: window.snapfort.player.position.y, seated: window.snapfort.feature.railgun.seated })); flailed ||= q.tumbling && q.seated === null; flungTo = Math.max(flungTo, q.y); if (flailed && flungTo > 120) break; }
const hit = (await guns(v))[0];
check("…and the shot takes the part it lands on clean away, for everyone (one hit is all a part takes)", hit.parts.length < 22 && !hit.parts.includes(12) && hit.drawn === hit.parts.length && hit.readyAt === 0 && !(await sf(v, () => window.snapfort.scene.meshes.some((m) => m.name === "gun-1-12"))), `${22 - hit.parts.length} part(s) gone`);
check("…and whoever was sitting in the gun is thrown up into space, flailing, however far from the hit", flailed && flungTo > 120 && hit.rider === null, `thrown to ${flungTo.toFixed(0)} m`);
for (let i = 0; i < 150 && (await sf(v, () => window.snapfort.player.knockedDown)); i++) await wait(100);
await sf(v, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
await b.keyboard.press("KeyH"); await wait(400);
await pick(b);
for (let n = 5; n <= 20; n++) if (!hit.parts.includes(n)) await place(b, g, n);
check("…they are put back on, and it charges again from the start", (await guns(b))[0].parts.length === 22 && /charging · (2[5-9]|30) s/.test(await panel(b)), await panel(b));
await putAway(b);

// ── The ride ─────────────────────────────────────────────────────────────
await front(v);
await wait(600);
check("beside the capsule: H gets in", /get in the rail gun's capsule/.test(await v.textContent("#hint")), await v.textContent("#hint"));
await v.keyboard.press("KeyH"); await wait(900);
check("a builder sits in the capsule, and everyone sees them there", (await sf(v, () => window.snapfort.feature.railgun.seated)) === g.id && (await sf(v, () => !!window.snapfort.player.riding)) && (await guns(b))[0].rider === vId);
await v.mouse.down(); await v.mouse.up(); await wait(500);
check("it will not fire while it is charging", /Still charging/.test(await toast(v)) && !(await sf(v, () => window.snapfort.player.knockedDown)), await toast(v));
// Everyone sits still while it charges (long enough for the Moon's room to sleep and wake).
for (let i = 0; i < 40 && !/ready/.test(await panel(v)); i++) await wait(1000);
check("charged: ready, click to launch", /Rail gun ready/.test(await panel(v)) && /to launch/.test(await panel(v)), await panel(v));
// A tall platform far off to fly to: 12 storeys up, the other side of the Moon from the gun.
const PAD = { x: 30, z: -30, level: 12 };
await sf(b, (pad) => {
  const s = window.snapfort;
  const put = (type, x, y, z) => s.history.do({ kind: "place", piece: { type, x, y, z, rot: 0, id: s.nextId(), material: "wood", edit: 0 } });
  for (let y = 0; y < pad.level; y++) put("wall", pad.x, y, pad.z);
  for (let ring = 0; ring <= 1; ring++) for (let x = pad.x - ring; x <= pad.x + ring; x++) for (let z = pad.z - ring; z <= pad.z + ring; z++) if (Math.max(Math.abs(x - pad.x), Math.abs(z - pad.z)) === ring) put("floor", x, pad.level, z);
}, PAD);
await wait(900);
const padTop = PAD.level * 3.75 + 0.15, padAt = [(PAD.x + 0.5) * 5, (PAD.z + 0.5) * 5];
await front(v);
await v.mouse.down(); await v.mouse.up();
const t0 = Date.now();
let onRail = false, top = 0, seenHigh = 0, seenCapsuleRun = false, seenFlying = false, cams = new Set(), flyingAt = 0, flames = false;
const from = spot(g, 22);
const state = () => sf(v, () => { const s = window.snapfort; return { x: s.player.position.x, y: s.player.position.y, z: s.player.position.z, feet: s.player.feetY, down: s.player.knockedDown, flying: s.feature.railgun.flying, aloft: s.player.aloft, cam: s.scene.activeCamera.name, locked: s.input.locked, flames: s.scene.meshes.some((m) => m.name === "flame" && m.isEnabled() && m.parent?.parent === s.player.avatar.root) }; });
for (let i = 0; i < 90; i++) {
  await wait(100);
  const t = (Date.now() - t0) / 1000;
  const q = await state();
  cams.add(q.cam);
  if (t < 1.4 && q.down && q.x > from[0] + 15 && q.y < 20) onRail = true;
  top = Math.max(top, q.y);
  const seen = await sf(b, (id) => { const s = window.snapfort; const p = s.remotes.positionOf(id); const cap = [...s.feature.railgun.guns.values()][0].meshes.get(22).mesh; return { y: p ? p[1] : -1, capX: cap.position.x }; }, vId);
  seenHigh = Math.max(seenHigh, seen.y);
  if (t < 1.4 && seen.capX > from[0] + 10) seenCapsuleRun = true;
  if (q.flying) { flyingAt = t; break; }
}
check("a click fires it: down the rail", onRail && seenCapsuleRun);
check("…and very high above the Moon: about 650 m, in about 5 seconds", top > 600 && top < 700 && flyingAt > 4.5 && flyingAt < 8, `${top.toFixed(0)} m up after ${flyingAt.toFixed(1)} s`);
const start = await state();
check("…where the rockets are the rider's own: flying, the view still theirs, and just two things to know", start.flying && start.aloft && start.locked && cams.size === 1 && start.cam === "camera" && /Arrows steer · Space slow the fall$/.test(await panel(v)) && /Rockets · \d+ m up/.test(await panel(v)), await panel(v));
// Hands off: straight down, steadily.
await wait(2000);
const sunk = await state();
check("hands off, they come straight down at a steady 14 m a second", start.y - sunk.y > 20 && start.y - sunk.y < 36 && Math.hypot(sunk.x - start.x, sunk.z - start.z) < 3 && sunk.flames, `${((start.y - sunk.y) / 2).toFixed(1)} m/s`);
// Holding Space slows the fall.
await v.keyboard.down("Space"); await wait(2000); await v.keyboard.up("Space");
const held = await state();
check("…slower with Space held, about 3 m a second", sunk.y - held.y < 12, `${((sunk.y - held.y) / 2).toFixed(1)} m/s`);
// Looking up or down changes nothing, and nor does Shift: only the move keys steer.
await sf(v, () => { window.snapfort.rig.pitch = 1.2; });
await v.keyboard.down("ShiftLeft"); await wait(1500);
const looked = await state();
await v.keyboard.up("ShiftLeft");
check("…looking down and holding Shift change nothing: the same steady fall", held.y - looked.y > 14 && held.y - looked.y < 28 && Math.hypot(looked.x - held.x, looked.z - held.z) < 3, `${((held.y - looked.y) / 1.5).toFixed(1)} m/s`);
// Now fly to the top of that far platform: face it and hold the up arrow until over it, then let go and come down onto it.
let landedOn = null, others = 0, fastest = 0, last = looked, lastAt = Date.now();
for (let i = 0; i < 900; i++) {
  const q = await state();
  if (!q.flying) { landedOn = q; break; }
  const now = Date.now();
  if (now - lastAt > 400) { fastest = Math.max(fastest, Math.hypot(q.x - last.x, q.z - last.z) / ((now - lastAt) / 1000)); last = q; lastAt = now; }
  const dx = padAt[0] - q.x, dz = padAt[1] - q.z, flat = Math.hypot(dx, dz);
  await sf(v, (yaw) => { const s = window.snapfort; s.rig.yaw = yaw; s.rig.pitch = 0.3; }, Math.atan2(dx, dz));
  if (flat > 2.5) await v.keyboard.down("ArrowUp"); else await v.keyboard.up("ArrowUp");
  if (i % 10 === 0) { const seen = await sf(b, (id) => { const s = window.snapfort; const p = s.remotes.positionOf(id); return { y: p ? p[1] : -1, flames: s.scene.meshes.some((m) => m.name === "flame" && m.isEnabled() && m.parent?.parent !== s.player.avatar.root) }; }, vId); others = Math.max(others, seen.y); seenFlying ||= seen.flames && seen.y > 60; }
  await wait(50);
}
await v.keyboard.up("ArrowUp");
const flew = (Date.now() - t0) / 1000;
check("the arrow keys carry them across the Moon, the way they face, at about 50 m a second", !!landedOn && fastest > 35 && fastest < 60, `up to ${fastest.toFixed(0)} m/s` + " · " + `landed after ${flew.toFixed(0)} s at ${landedOn?.x.toFixed(0)}, ${landedOn?.z.toFixed(0)}`);
check("…and set down on top of a tower 12 storeys up, far from the gun", !!landedOn && Math.abs(landedOn.feet - padTop) < 0.3 && Math.hypot(landedOn.x - padAt[0], landedOn.z - padAt[1]) < 8 && Math.hypot(padAt[0] - from[0], padAt[1] - from[2]) > 200, `feet at ${landedOn?.feet.toFixed(1)} m (the platform is at ${padTop.toFixed(1)} m), ${Math.hypot(padAt[0] - from[0], padAt[1] - from[2]).toFixed(0)} m from the gun`);
check("…while everyone below sees them up there, rockets burning", others > 300 && seenFlying, `seen ${others.toFixed(0)} m up`);
await wait(500);
const walk = await state();
await v.keyboard.down("KeyW"); await wait(350); await v.keyboard.up("KeyW");
const walked = await state();
const panelGone = await sf(v, () => document.getElementById("world-panel").hidden);
check("…on their feet, rockets off, walking again", !walk.flying && !walk.aloft && !walk.flames && !walk.down && Math.hypot(walked.x - walk.x, walked.z - walk.z) > 0.5 && panelGone, JSON.stringify({ flying: walk.flying, aloft: walk.aloft, flames: walk.flames, down: walk.down, walked: +Math.hypot(walked.x - walk.x, walked.z - walk.z).toFixed(1), panelGone }));
const after = (await guns(b))[0];
check("…the capsule is back, empty, and the gun is charging or ready for the next", after.rider === null && after.parts.length === 22);

// ── Something built in the way of the launch ─────────────────────────────
// A wall across the gun's line, 5 m beyond the muzzle and taller than the rider is there.
await front(b);
await sf(b, (g) => { const s = window.snapfort; const A = [[0, 1], [1, 0], [0, -1], [-1, 0]][g.dir]; for (let y = 0; y <= 14; y++) s.history.do({ kind: "place", piece: { type: "wall", x: g.x + A[0] * 36, y, z: g.z + A[1] * 36, rot: g.dir % 2 === 1 ? 1 : 0, id: s.nextId(), material: "wood", edit: 0 } }); }, g);
await wait(900);
await front(v);
await sf(v, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
for (let i = 0; i < 20 && !/capsule/.test(await v.textContent("#hint")); i++) await wait(150);
// (A moment for the server to hear where they now are: nobody really arrives by teleport.)
await wait(700);
await v.keyboard.press("KeyH"); await wait(900);
for (let i = 0; i < 45 && !/ready/.test(await panel(v)); i++) await wait(1000);
check("(the rider is back in the capsule and it has charged again)", (await sf(v, () => window.snapfort.feature.railgun.seated)) === g.id && /ready/.test(await panel(v)), `${await panel(v)} | ${JSON.stringify(await sf(v, () => { const s = window.snapfort; const q = s.player.position; return { at: [q.x, q.y, q.z].map((n) => +n.toFixed(1)), locked: s.input.locked, hint: document.getElementById("hint").textContent, toast: document.getElementById("toast").textContent, tool: document.querySelector("#hotbar .slot.selected .label")?.textContent ?? null }; }))}`);
await v.mouse.down(); await v.mouse.up();
let tumbled = false, peak = 0, everFlew = false;
for (let i = 0; i < 160; i++) {
  await wait(100);
  const q = await sf(v, () => { const s = window.snapfort; return { y: s.player.position.y, tumbling: s.player.tumbling, down: s.player.knockedDown, flying: s.feature.railgun.flying }; });
  tumbled ||= q.tumbling; peak = Math.max(peak, q.y); everFlew ||= q.flying;
  if (tumbled && !q.down && i > 30) break;
}
const stopped2 = await sf(v, () => ({ feet: window.snapfort.player.feetY, down: window.snapfort.player.knockedDown, flying: window.snapfort.feature.railgun.flying }));
check("with a wall built across its line, the launch is stopped there and the rider thrown up, flailing", tumbled && peak > 100 && peak < 300, `flailing: ${tumbled}; got ${peak.toFixed(0)} m up (a clear launch goes to 650 m)`);
check("…they never get to fly: their rockets bring them back to the ground", !everFlew && !stopped2.down && !stopped2.flying && Math.abs(stopped2.feet) < 0.3, `feet at ${stopped2.feet.toFixed(2)} m`);
await front(b);

// ── Still there for whoever arrives ──────────────────────────────────────
await b.reload(); await b.waitForSelector("body.ready"); await b.click("#play-free"); await wait(1000);
const again = await guns(b);
check("a builder who arrives later finds every rail gun as it is", again.length === 2 && again[0].parts.length === 22 && again[0].drawn === 22 && again[1].parts.length === 1);

// ── On a phone ───────────────────────────────────────────────────────────
{
  const ph = await open("phone", await paidKey(base, "/moon"), { ...devices["iPhone 13 landscape"] });
  const fits = (sel) => ph.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }, sel);
  check("on a phone the hotbar still fits with Railgun on it", (await fits("#hotbar")) && (await ph.evaluate(() => [...document.querySelectorAll("#hotbar .slot .label")].some((e) => e.textContent === "Railgun"))));
  await ph.bringToFront();
  await sf(ph, ([x, y, z]) => window.snapfort.player.teleport(x, y + 0.95, z + 2.5), spot(g, 22));
  for (let i = 0; i < 30 && (await ph.evaluate(() => document.getElementById("t-board").hidden)); i++) await wait(150);
  const button = await ph.evaluate(() => { const e = document.getElementById("t-board"); return { shown: !e.hidden, text: e.textContent }; });
  check("…beside the capsule there is a Get in button, and the gun's state fits on screen", button.shown && button.text === "Get in" && (await fits("#world-panel")), JSON.stringify(button));
  await ph.context().close();
}

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
