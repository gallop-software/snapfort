// Renders the link-preview picture (public/og-flag.jpg) from the game: dev server running, then
// node qa/og-image.mjs, and resize /tmp/og/shot.png (2400x1260) to 1200x630.
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const p = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })).newPage();
await p.goto(`${process.env.QA_BASE ?? "http://localhost:5173"}/?world=og${Date.now().toString(36)}`); await p.waitForSelector("body.ready");
await p.click("#play-free"); await p.waitForTimeout(500);
await p.evaluate(() => {
  const s = window.snapfort;
  const put = (type, x, y, z, rot, material) => s.history.do({ kind: "place", piece: { type, x, y, z, rot, id: s.nextId(), material, edit: 0 } });
  // A box tower one cell across, 15 storeys: metal to 10, then brick.
  const box = (x, z, levels, mat) => { for (let y = 0; y < levels; y++) { const m = mat(y); put("wall", x, y, z, 0, m); put("wall", x, y, z + 1, 0, m); put("wall", x, y, z, 1, m); put("wall", x + 1, y, z, 1, m); } };
  box(0, 14, 15, (y) => (y < 10 ? "metal" : "brick"));
  box(-6, 9, 6, (y) => (y < 3 ? "brick" : "wood"));
  box(6, 10, 4, () => "wood");
  put("trebuchet", -3, 0, 3, 0, "wood");
  put("trebuchet", 2, 0, 4, 1, "wood");
});
await p.waitForTimeout(3000);
await p.addStyleTag({ content: "#hud, #hotbar-wrap, #stats, #online, #crosshair { display: none !important; }" });
await p.evaluate(() => { const s = window.snapfort; s.player.teleport(30, 0.95, -60); });
await p.waitForTimeout(800);
const names = await p.evaluate(() => {
  const s = window.snapfort;
  const cam = s.scene.activeCamera;
  const V = cam.position.constructor;
  const hide = new Set(["ghost-wall", "thigh", "kneecap", "shin", "boot", "torso", "stripe", "belt", "pack", "pack-flap", "upper-arm", "forearm", "hand", "neck", "head", "eye", "hat", "brim", "crest"]);
  s.scene.onBeforeRenderObservable.add(() => {
    cam.position.copyFromFloats(-5, 3, 0);
    cam.setTarget(new V(1.5, 30, 75));
    for (const m of s.scene.meshes) if (hide.has(m.name) || m.name.startsWith("ghost")) m.isVisible = false;
  });
  return "";
});
await p.waitForTimeout(1500);
console.log(names);
console.log(await p.evaluate(() => { const s = window.snapfort; return [s.flag.text, s.flag.at, ...s.scene.meshes.filter((m) => m.name.startsWith("flag")).map((m) => [m.name, m.isEnabled(), m.isVisible, m.getAbsolutePosition().asArray().map((v) => +v.toFixed(1))])]; }));
await p.screenshot({ path: "/tmp/og/shot.png" });
await browser.close();
