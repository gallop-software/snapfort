/**
 * Chaos QA: two pages in one fresh world press random keys and mouse buttons
 * for a few minutes (moving, jumping, every tool, placing, removing, editing,
 * materials, undo/redo, trebuchets, zoom, Esc). Afterwards both pages must
 * agree, every piece must be drawn and solid, and nothing may have thrown.
 * Start the Gallop dev server first, then: node qa/chaos.mjs [seconds]
 */
import { chromium } from "playwright-core";
const SECONDS = Number(process.argv[2] ?? 180);
const world = `chaos-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
const errors = [];
const open = async (label) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 620 } })).newPage();
  p.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && errors.push(`[${label}] ${m.text().slice(0, 200)}`));
  await p.goto(`http://localhost:5173/?world=${world}`); await p.waitForSelector("body.ready"); await p.click("#play-free");
  return p;
};
const pages = [await open("A"), await open("B")];
await pages[1].evaluate(() => window.snapfort.player.teleport(12.5, 0.95, 2.5));
let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(r() * list.length)];
const keys = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyZ", "KeyF", "KeyX", "KeyC", "KeyV", "KeyB", "KeyG", "KeyT", "KeyR", "KeyQ", "KeyE", "KeyH", "Enter", "Digit1", "Digit6", "ShiftLeft"];
const counts = {};
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  const p = pick(pages);
  const roll = r();
  try {
    if (roll < 0.35) { const k = pick(keys); counts[k] = (counts[k] ?? 0) + 1; await p.keyboard.down(k); await p.waitForTimeout(30 + r() * 300); await p.keyboard.up(k); }
    else if (roll < 0.6) { counts.click = (counts.click ?? 0) + 1; await p.mouse.down(); await p.waitForTimeout(r() * 400); await p.mouse.up(); }
    else if (roll < 0.7) { counts.right = (counts.right ?? 0) + 1; await p.mouse.down({ button: "right" }); await p.mouse.up({ button: "right" }); }
    else if (roll < 0.85) { await p.mouse.move(500 + (r() - 0.5) * 600, 310 + (r() - 0.5) * 300, { steps: 3 }); }
    else if (roll < 0.9) { await p.mouse.wheel(0, r() < 0.5 ? 120 : -120); }
    else if (roll < 0.92) { counts.esc = (counts.esc ?? 0) + 1; await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(1200); if (await p.isVisible("#resume")) await p.click("#resume"); else await p.mouse.click(500, 310); }
    else if (roll < 0.94) { // keep the builders near each other and the building
      await p.evaluate(() => { const s = window.snapfort; if (Math.hypot(s.player.position.x, s.player.position.z) > 40) s.player.teleport(2.5, 1.2, -5); });
    } else await p.waitForTimeout(100);
    if (!(await p.evaluate(() => window.snapfort.input.locked)) && (await p.isVisible("#resume"))) await p.click("#resume");
  } catch (e) { errors.push(`driver: ${String(e).slice(0, 120)}`); }
}
// Settle and compare.
for (let i = 0; i < 40; i++) {
  await Promise.all(pages.map((p) => p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))));
  if ((await Promise.all(pages.map((p) => p.evaluate(() => window.snapfort.synced.inFlight)))).every((n) => n === 0)) break;
}
await new Promise((res) => setTimeout(res, 1500));
const dump = (p) => p.evaluate(() => [...window.snapfort.state.all()].map((q) => `${q.id}:${q.type}:${q.x},${q.y},${q.z},${q.rot}:${q.material}:${q.edit}`).sort().join("\n"));
const [da, db] = [await dump(pages[0]), await dump(pages[1])];
const audits = await Promise.all(pages.map((p) => p.evaluate(() => window.snapfort.audit())));
console.log(`actions: ${JSON.stringify(counts)}`);
console.log(`pieces: ${da.split("\n").filter(Boolean).length} | pages agree: ${da === db} | audit A: ${audits[0].length ? audits[0].slice(0, 3).join("; ") : "ok"} | audit B: ${audits[1].length ? audits[1].slice(0, 3).join("; ") : "ok"}`);
console.log(`errors: ${errors.length ? errors.slice(0, 8).join(" | ") : "none"}`);
await browser.close();
process.exit(da === db && audits.every((a) => a.length === 0) && errors.length === 0 ? 0 : 1);
