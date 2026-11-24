/**
 * Renders the world pictures for the menu's world cards (public/worlds/*.jpg)
 * from the game itself: dev server running (with Stripe test keys in
 * .dev.vars, to build on the Moon), then node qa/world-images.mjs, then resize
 * /tmp/worlds/<world>.png to 960x540 JPEGs.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = (process.env.QA_BASE ?? "http://localhost:5173");
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
mkdirSync("/tmp/worlds", { recursive: true });

/** A paid key through the webhook, so the Moon can be built on. */
async function paidKey() {
  const r = await fetch(`${base}/api/buy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "/moon", testpay: true }) }).then((x) => x.json());
  const id = r.url.match(/cs_test_[A-Za-z0-9]+/)[0];
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((x) => x.json());
  const body = JSON.stringify({ id: "evt_art", type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: session.client_reference_id, payment_status: "paid", livemode: false, customer_details: { email: "art@example.com" } } } });
  const t = Math.floor(Date.now() / 1000);
  await fetch(`${base}/api/stripe`, { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}` }, body });
  return session.client_reference_id;
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const key = await paidKey();
// Each world: its address, where the camera stands and looks, and (the Moon) where a rover stands
// in the foreground and which way it points: x, z, and the turn about the vertical.
for (const [name, path, camera, target, rover] of [
  ["meadow", "/", [-9, 4, 2], [3, 24, 75]],
  ["moon", "/moon", [-14, 3, 6], [17, 21, 75], [-5.5, 17.5, -1.9]],
]) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((k) => localStorage.setItem("snapfort.key", k), key);
  const p = await ctx.newPage();
  await p.goto(`${base}${path}?world=art${Date.now().toString(36)}`);
  await p.waitForSelector("body.ready");
  await p.click("#play-free");
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const s = window.snapfort;
    const put = (type, x, y, z, rot, material) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material, edit: 0 } });
    const box = (x, z, levels, mat) => { for (let y = 0; y < levels; y++) { const m = mat(y); put("wall", x, y, z, 0, m); put("wall", x, y, z + 1, 0, m); put("wall", x, y, z, 1, m); put("wall", x + 1, y, z, 1, m); } };
    box(0, 14, 13, (y) => (y < 9 ? "metal" : "brick"));
    box(-6, 10, 6, (y) => (y < 3 ? "brick" : "wood"));
    box(6, 11, 4, () => "wood");
    put("trebuchet", -3, 0, 4, 0, "wood");
    put("trebuchet", 3, 0, 5, 1, "wood");
  });
  await p.waitForTimeout(3500);
  await p.addStyleTag({ content: "#hud, #hotbar-wrap, #stats, #online, #crosshair, #visit-bar, #tip { display: none !important; }" });
  await p.evaluate(() => window.snapfort.player.teleport(40, 0.95, -60));
  await p.waitForTimeout(600);
  if (rover) {
    // Stand a rover in the foreground with this builder in its seat (drawn there for the picture; nobody drives it).
    await p.evaluate(([x, z, yaw]) => {
      const s = window.snapfort;
      const r = s.feature.rover.rovers.get(5);
      r.pose = [x, 0, z, yaw, 0, 0];
      r.target = [...r.pose];
      // The seat: 1.02 m up and half a metre behind the rover's middle.
      s.player.riding = { x: x - Math.sin(yaw) * 0.5, y: 1.02, z: z - Math.cos(yaw) * 0.5, yaw, pitch: 0, roll: 0 };
    }, rover);
    await p.waitForTimeout(600);
  }
  await p.evaluate(([camera, target]) => {
    const s = window.snapfort;
    const cam = s.scene.activeCamera;
    const V = cam.position.constructor;
    s.scene.onBeforeRenderObservable.add(() => {
      // Full sharpness, however busy the computer.
      if (s.engine.getHardwareScalingLevel() !== 0.5) s.engine.setHardwareScalingLevel(0.5);
      cam.position.copyFromFloats(...camera);
      cam.setTarget(new V(...target));
      for (const m of s.scene.meshes) if (m.name.startsWith("ghost")) m.isVisible = false;
    });
  }, [camera, target]);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `/tmp/worlds/${name}.png` });
  console.log(name, "ok");
  await ctx.close();
}
await browser.close();
