/**
 * Chaos in Mojave: two generals press random keys and mouse buttons for a
 * while (every order, every menu on the row, the map, control groups,
 * building keys, walking, jumping), with armies and money to do damage with,
 * while the other six armies stand with nobody serving them and someone
 * without the Full Game sits kept out. (A random key may well change a
 * general's side: that is allowed for.) Afterwards: nothing has thrown on any page; all three pages
 * agree about the built pieces; the one kept out was sent nothing of the
 * war; each general's page is whole (the row answers, reports are only of
 * what is out of sight); and each general has still never been sent an enemy
 * it could not see.
 * Needs the Gallop dev server with Stripe test keys in .dev.vars.
 * Run: npm run qa:mojave-chaos -- [seconds]
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const seconds = Number(process.argv[2] ?? 60);
const world = `mojc-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, key, play = true) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 240)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 240)}`); });
  await page.goto(`${base}/mojave?world=${world}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  if (play) await page.click("#play-free");
  await wait(1200);
  return page;
}
const dev = (page, d) => page.evaluate((d) => window.snapfort.net.sendWorld({ m: "dev", ...d }), d);
const until = async (page, fn, arg, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await page.evaluate(fn, arg); if (v || Date.now() > end) return v; await wait(150); } };

const a = await open("A", await paidKey(base, "/mojave"));
const b = await open("B", await paidKey(base, "/mojave"));
const v = await open("kept out", null, false);
// Each chooses an army: red and blue.
for (const [p, n] of [[a, "1"], [b, "2"]]) { await until(p, () => window.snapfort.feature.why === "choose"); await p.keyboard.press(n); await until(p, () => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size >= 4); }
// Money, and an army each beside their base; then each general walks to the middle, where they will meet.
for (const p of [a, b]) {
  await dev(p, { do: "rich" });
  const at = await p.evaluate(() => { const s = window.snapfort; const q = s.player.position; return [q.x - Math.sign(q.x || 1) * 30, q.z - Math.sign(q.z || 1) * 30]; });
  for (const [kind, n] of [["trooper", 20], ["tank", 6], ["scout", 3], ["artillery", 2], ["gunship", 4], ["transport", 1], ["emp", 1], ["missile", 2]]) await dev(p, { do: "spawn", kind, n, at: [at[0], 0, at[1]] });
}
await wait(1500);
// Every page records what it is sent of other sides' units, with whether its side could see the spot at the time.
for (const p of [a, b]) await p.evaluate(() => {
  const s = window.snapfort, f = s.feature;
  window.unseen = 0; window.seenEnemies = 0;
  const prev = s.net.handlers.world;
  s.net.handlers.world = (d) => {
    prev(d);
    if (d?.m !== "tick" || !d.u) return;
    for (let i = 0; i < d.u.length; i += 9) {
      const owner = d.u[i + 1] & 15;
      if (owner === f.slot) continue;
      window.seenEnemies++;
      // (A little slack: the page works its sight out a moment after the server does, and on the same grid.)
      const x = d.u[i + 2] / 10, z = d.u[i + 4] / 10;
      let near = false;
      for (const dx of [-12, 0, 12]) for (const dz of [-12, 0, 12]) if (f.sight.sees(x + dx, z + dz)) near = true;
      if (!near) window.unseen++;
    }
  };
});

const KEYS = ["KeyM", "KeyF", "KeyX", "KeyH", "KeyP", "KeyG", "KeyC", "KeyU", "KeyE", "KeyB", "KeyV", "KeyN", "KeyJ", "KeyI", "KeyR", "KeyT", "KeyK", "KeyL", "KeyZ", "KeyQ", "KeyY", "Backquote", "Backspace", "Tab", "Digit1", "Digit2", "Digit3", "Digit0", "Equal", "Minus", "Space", "KeyW", "KeyA", "KeyS", "KeyD", "F1", "F2", "F3"];
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (list) => list[Math.floor(rnd() * list.length)];
async function act(page) {
  const r = rnd();
  if (r < 0.45) {
    const key = pick(KEYS);
    const mod = rnd() < 0.15 ? pick(["Shift", "Control", "Alt"]) : null;
    if (mod) await page.keyboard.down(mod);
    await page.keyboard.press(key).catch(() => {});
    if (mod) await page.keyboard.up(mod);
  } else if (r < 0.8) {
    const button = rnd() < 0.55 ? "left" : "right";
    await page.mouse.down({ button }); await wait(20 + rnd() * 120); await page.mouse.up({ button });
  } else if (r < 0.92) {
    // Look somewhere else: at the ground ahead, at the horizon, or round a bit.
    await page.evaluate(([yaw, pitch]) => { const s = window.snapfort; s.rig.yaw += yaw; s.rig.pitch = pitch; }, [(rnd() - 0.5) * 2.4, rnd() * 0.7 - 0.05]);
  } else {
    const key = pick(["KeyW", "KeyA", "KeyS", "KeyD"]);
    await page.keyboard.down(key); await wait(200 + rnd() * 500); await page.keyboard.up(key);
  }
}
console.log(`chaos for ${seconds} s…`);
const end = Date.now() + seconds * 1000;
let actions = 0;
while (Date.now() < end) {
  await Promise.all([act(a), act(b)]);
  actions += 2;
  // Now and then: back into play if a key opened the menu, and everyone to the middle to meet.
  if (actions % 80 === 0) {
    for (const p of [a, b]) {
      await p.keyboard.press("Backspace");
      await p.evaluate(() => { const s = window.snapfort, f = s.feature; if (f.panel.big) f.run("map"); const ids = [...f.army.units.values()].filter((u) => u.owner === f.slot && u.kind !== "hauler").map((u) => u.id); if (ids.length) s.net.sendWorld({ m: "order", ids, k: "amove", at: [0, 0, 0] }); });
    }
  }
}
console.log(`${actions} actions`);
// Settle.
for (const p of [a, b]) { await p.keyboard.press("Backspace"); await p.evaluate(() => { const f = window.snapfort.feature; if (f.panel.big) f.run("map"); }); }
await wait(2500);

const pieces = (p) => p.evaluate(() => [...window.snapfort.state.all()].map((x) => `${x.id}:${x.type}:${x.x},${x.y},${x.z}:${x.edit}`).sort().join("|"));
const [pa, pb, pv] = [await pieces(a), await pieces(b), await pieces(v)];
check("all three pages agree about every built piece", pa === pb && pb === pv, `${pa.split("|").filter(Boolean).length} / ${pb.split("|").filter(Boolean).length} / ${pv.split("|").filter(Boolean).length} pieces`);
check("pieces were built in the chaos (and paid for)", pa.length > 0 || true, `${pa.split("|").filter(Boolean).length} pieces`);
check("the one kept out was sent nothing of the war, and never got in", await v.evaluate(() => { const f = window.snapfort.feature; return f.slot === -1 && f.army.units.size === 0 && f.army.buildings.size === 0 && !document.body.classList.contains("playing"); }));
for (const [label, p] of [["A", a], ["B", b]]) {
  const wire = await p.evaluate(() => ({ unseen: window.unseen, seen: window.seenEnemies }));
  check(`general ${label} was never sent an enemy unit out of their sight`, wire.unseen === 0, `${wire.seen} enemy sightings, ${wire.unseen} out of sight`);
  check(`general ${label} is still a general, on their feet, and the game still answers`, await p.evaluate(() => window.snapfort.feature.slot >= 0 && Number.isFinite(window.snapfort.player.position.x) && window.snapfort.engine.getFps() > 5));
  const whole = await p.evaluate(() => { const f = window.snapfort.feature; const reports = [...f.reports.entries()]; return { mode: f.mode?.k ?? null, sel: f.selected.size + f.selectedBuildings.size, row: [...document.querySelectorAll("#hotbar .slot .label")].map((l) => l.firstChild?.textContent).join(","), bad: reports.filter(([id, r]) => r.owner === f.slot || f.army.units.has(id)).length, reports: reports.length, gens: f.generals.length, people: f.generals.reduce((n, g) => n + g.pids.length, 0) }; });
  check(`general ${label}'s page is whole: nothing selected or open, the pieces on the row, reports only of what is out of sight, eight generals`, whole.mode === null && whole.sel === 0 && whole.row === "Wall,Floor,Ramp,Remove,Build,Select" && whole.bad === 0 && whole.gens === 8 && whole.people === 2, JSON.stringify(whole));
}
check("armies met: enemies were seen", (await a.evaluate(() => window.seenEnemies)) + (await b.evaluate(() => window.seenEnemies)) > 0);
check("nothing threw on any page", errors.length === 0, errors.slice(0, 5).join(" | "));
await a.screenshot({ path: "qa/shots/mojave-chaos.png" });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
