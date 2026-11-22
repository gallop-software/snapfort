/**
 * Rendering cost check: builds a 1,500-piece town in a fresh world, stands in
 * it on a Retina-sized page, and reports what each frame costs: pixels drawn,
 * shadow map size and CPU time per frame.
 * Start the Gallop dev server first, then: node qa/perf.mjs [label]
 */
import { chromium } from "playwright-core";
const label = process.argv[2] ?? "";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:5173/?world=perf-${Date.now().toString(36)}`);
await page.waitForSelector("body.ready");
await page.click("#play-free");
const out = await page.evaluate(async () => {
  const s = window.snapfort; const mats = ["wood", "brick", "metal"]; let n = 0;
  for (let x = -12; x < 12; x++) for (let z = 0; z < 20; z++) for (const [type, y, rot] of [["floor", 0, 0], ["wall", 0, (x + z) & 1], ["floor", 1, 0]]) if ((x + z) % 3 !== 0 && s.state.apply({ kind: "place", piece: { type, x, y, z, rot, id: `perf-${n}`, material: mats[(x + z + 99) % 3], edit: 0 } })) n++;
  s.player.teleport(2.5, 8.5, -6); s.rig.yaw = 0.3; s.rig.pitch = 0.35;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < 120; i++) await frame();
  const e = s.engine, scene = s.scene;
  let cpu = 0; const frames = 120;
  const before = scene.onBeforeRenderObservable.add(() => (scene._t0 = performance.now()));
  const after = scene.onAfterRenderObservable.add(() => { cpu += performance.now() - scene._t0; });
  for (let i = 0; i < frames; i++) await frame();
  scene.onBeforeRenderObservable.remove(before); scene.onAfterRenderObservable.remove(after);
  const sg = scene.lights.flatMap((l) => (l._shadowGenerators ? [...l._shadowGenerators.values()] : []))[0];
  return { pieces: n, render: `${e.getRenderWidth()}x${e.getRenderHeight()}`, megapixels: +(e.getRenderWidth() * e.getRenderHeight() / 1e6).toFixed(2), fps: +e.getFps().toFixed(0), cpuMsPerFrame: +(cpu / frames).toFixed(2), shadowMap: sg ? `${sg.getShadowMap().getSize().width}² × ${sg.numCascades ?? 1}` : "none", activeMeshes: scene.getActiveMeshes().length };
});
console.log(label, JSON.stringify(out));
await browser.close();
