/**
 * The view moves only when the player moves it. In every world: standing
 * still, clicking, a trackpad's two-finger scrolls and swipes and pinches,
 * and the connection dropping and coming back never turn the view or move
 * the builder; small movements turn it smoothly and in proportion; a glitch
 * (one huge jump between small ones) is ignored. Needs the Gallop dev server
 * with Stripe test keys in .dev.vars. Run: npm run qa:look
 */
import { chromium } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const stamp = Date.now().toString(36);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const view = (page) => page.evaluate(() => { const s = window.snapfort; return { yaw: s.rig.yaw, pitch: s.rig.pitch, x: s.player.position.x, y: s.player.position.y, z: s.player.position.z, locked: s.input.locked }; });
const deg = (r) => (r * 180) / Math.PI;
const turned = (a, b) => Math.max(Math.abs(deg(a.yaw - b.yaw)), Math.abs(deg(a.pitch - b.pitch)));
const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fmt = (a, b) => `turned ${turned(a, b).toFixed(2)}°, moved ${moved(a, b).toFixed(2)} m`;
/** Mouse movement as the browser reports it under pointer lock. */
const move = (page, steps) => page.evaluate(async (steps) => {
  for (const [dx, dy] of steps) {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: dy, bubbles: true }));
    await new Promise((r) => setTimeout(r, 8));
  }
}, steps);
const wheel = (page, events) => page.evaluate(async (events) => {
  const c = document.querySelector("canvas");
  for (const e of events) {
    c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaMode: 0, ...e }));
    await new Promise((r) => setTimeout(r, 12));
  }
}, events);

async function open(label, path, key) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await context.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.mojave.intro", "seen"); }, key);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}world=look-${label}-${stamp}`);
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await page.click("#play-free");
  await wait(1500);
  return { page, errors };
}

for (const [label, path] of [["meadow", "/"], ["moon", "/moon"], ["mars", "/mars"], ["mojave", "/mojave"]]) {
  console.log(`\n── ${label}`);
  const key = label === "meadow" ? null : await paidKey(base, path);
  const { page, errors } = await open(label, path, key);
  if (label === "mojave") {
    await page.waitForFunction(() => window.snapfort.feature?.why === "choose" || window.snapfort.feature?.slot >= 0, null, { timeout: 15000 });
    if (await page.evaluate(() => window.snapfort.feature.slot < 0)) await page.keyboard.press("1");
    await page.waitForFunction(() => window.snapfort.feature.slot >= 0 && window.snapfort.feature.army.units.size > 0, null, { timeout: 15000 });
  }
  // (Settled: on the ground, the arrival's own turning done.)
  await wait(2500);
  let a = await view(page);
  check(`${label}: playing, the mouse captured`, a.locked);

  // Standing still: nothing turns the view.
  await wait(6000);
  let b = await view(page);
  check(`${label}: six seconds standing still, the view does not turn and the builder does not move`, turned(a, b) < 0.01 && moved(a, b) < 0.05, fmt(a, b));

  // Clicks (a trackpad's tap or press), with nothing moving.
  a = b;
  for (const button of ["left", "left", "right"]) { await page.mouse.down({ button }); await frames(page, 2); await page.mouse.up({ button }); await frames(page, 4); }
  b = await view(page);
  check(`${label}: clicks do not turn the view`, turned(a, b) < 0.01, fmt(a, b));

  // A trackpad's two-finger scroll: many small deltas, up and down.
  a = b;
  await wheel(page, [...Array(40)].map((_, i) => ({ deltaY: i < 20 ? 3 : -3 })));
  // A sideways swipe, and a pinch (ctrl + wheel, as a browser reports it).
  await wheel(page, [...Array(30)].map(() => ({ deltaX: 9, deltaY: 0 })));
  await wheel(page, [...Array(20)].map((_, i) => ({ deltaY: i < 10 ? -2 : 2, ctrlKey: true })));
  await frames(page, 6);
  b = await view(page);
  check(`${label}: two-finger scrolls, swipes and pinches do not turn the view`, turned(a, b) < 0.01 && moved(a, b) < 0.05, fmt(a, b));
  check(`${label}: …and the page is not zoomed`, await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1 && devicePixelRatio === 1));

  // Small movements turn the view smoothly, in proportion.
  a = b;
  await move(page, [...Array(40)].map(() => [3, 0]));
  await frames(page, 3);
  b = await view(page);
  const per = deg(b.yaw - a.yaw) / 120;
  await move(page, [...Array(40)].map(() => [-3, 0]));
  await frames(page, 3);
  const c = await view(page);
  check(`${label}: a steady sweep turns the view, and the same sweep back returns it`, Math.abs(per) > 0.02 && Math.abs(per) < 1 && turned(a, c) < 0.2, `${per.toFixed(3)}° a pixel; back within ${turned(a, c).toFixed(2)}°`);

  // A glitch: one huge jump between small movements is ignored, as browsers sometimes report under pointer lock.
  for (const spike of [70, 120, 180, 240, 600]) {
    a = await view(page);
    await wait(150);
    await move(page, [[1, 0], [1, 0], [spike, -spike / 3], [1, 0], [1, 0]]);
    await frames(page, 3);
    b = await view(page);
    check(`${label}: a ${spike}-pixel jump among one-pixel movements is ignored`, turned(a, b) < Math.abs(per) * 6 + 0.05, fmt(a, b));
  }

  // A real fast flick builds up and dies down over several events: all of it counts.
  {
    const flick = [4, 12, 30, 70, 140, 200, 160, 90, 40, 12, 3];
    a = await view(page);
    await move(page, flick.map((d) => [d, 0]));
    await frames(page, 3);
    b = await view(page);
    const want = flick.reduce((s, d) => s + d, 0) * per;
    check(`${label}: a fast flick, starting from stillness, turns the view all the way`, Math.abs(deg(b.yaw - a.yaw) - want) < Math.abs(per) * 2, `${deg(b.yaw - a.yaw).toFixed(1)}° of ${want.toFixed(1)}°`);
    await move(page, flick.map((d) => [-d, 0]));
    // And from stillness, a quick one whose first event is already big.
    await wait(200);
    a = await view(page);
    await move(page, [[90, 10], [110, 12], [80, 8], [20, 2]]);
    await frames(page, 3);
    b = await view(page);
    check(`${label}: a quick flick whose first report is big still counts in full`, Math.abs(deg(b.yaw - a.yaw) - 300 * per) < Math.abs(per) * 2, `${deg(b.yaw - a.yaw).toFixed(1)}° of ${(300 * per).toFixed(1)}°`);
  }

  // The connection drops and comes back: the view and the builder stay where they are.
  a = await view(page);
  await page.evaluate(() => window.snapfort.net.ws?.close());
  await page.waitForFunction(() => window.snapfort.net.online === false, null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.snapfort.net.online, null, { timeout: 20000 });
  await wait(3000);
  b = await view(page);
  check(`${label}: the connection dropping and coming back does not turn the view or move the builder`, turned(a, b) < 0.01 && moved(a, b) < 0.3, fmt(a, b));
  check(`${label}: no errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.context().close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
