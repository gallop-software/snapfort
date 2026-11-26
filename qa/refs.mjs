/**
 * Reference pictures: each world drawn from fixed spots with the same small
 * build, a siege engine and two builders in view, compared with the pictures
 * saved in qa/refs/. A world that is finished should never change by accident:
 * this fails when it does.
 *
 *   node qa/refs.mjs            compare every world with its saved pictures
 *   node qa/refs.mjs --save     save new pictures (after a change that was meant)
 *   node qa/refs.mjs moon       only that world
 *
 * Needs the Gallop dev server with Stripe test keys in .dev.vars (a paid key is
 * made through the webhook, to build in paid worlds).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { paidKey } from "./_paid.mjs";

const base = (process.env.QA_BASE ?? "http://localhost:5173");
const save = process.argv.includes("--save");
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
mkdirSync("qa/refs", { recursive: true });
mkdirSync("qa/shots", { recursive: true });

/** Every world: [id, address]. Read from the page's own list when it has one. */
const WORLDS = [
  ["meadow", "/"],
  ["moon", "/moon"],
  // Mars has a day that passes: its pictures are taken at a fixed hour, mid-morning.
  ["mars", "/mars?sol=0.2"],
  // Mojave's middle is a crystal field under guard, and pieces cost lithium there: its pictures are
  // taken on open ground 90 m off (18 cells each way), by a general given the money to build with.
  ["mojave", "/mojave", [18, 18]],
];

/** Where the camera stands and what it looks at, for each picture. */
const SHOTS = [
  ["wide", [-22, 9, -16], [4, 9, 16]],
  ["close", [7, 3.2, 1], [1, 4, 14]],
  ["builders", [13.5, 2.2, 3.5], [13.5, 1.2, 9]],
  ["sky", [-30, 2, -30], [40, 60, 120]],
];

/** Most of a picture that may differ (fraction of pixels), and by how much a pixel must differ to count. */
const MAX_DIFFERENT = 0.004;
const PIXEL_TOLERANCE = 28;

/** Fraction of pixels that differ between two PNG files of the same size (1 when the sizes differ). */
function difference(a, b) {
  const x = PNG.sync.read(a), y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return 1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2]) > PIXEL_TOLERANCE) n++;
  }
  return n / (x.width * x.height);
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const key = await paidKey(base, "/moon");
let failed = 0;

async function open(path, world, name, color) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, name, color]) => {
    localStorage.setItem("snapfort.key", k);
    localStorage.setItem("snapfort.identity", JSON.stringify({ name, color }));
    localStorage.setItem("snapfort.tips", "done");
  }, [key, name, color]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => { failed++; console.log(`FAIL  page error in ${world}: ${e.message.slice(0, 200)}`); });
  await p.goto(`${base}${path}${path.includes("?") ? "&" : "?"}world=${world}`);
  await p.waitForSelector("body.ready", { timeout: 30000 });
  await p.click("#play-free");
  await p.waitForTimeout(700);
  return p;
}

for (const [id, path, shift = [0, 0]] of WORLDS) {
  if (only && only !== id) continue;
  const world = `refs${Date.now().toString(36)}`;
  const p = await open(path, world, "Ada", "#f07356");
  const [sx, sz] = shift;
  if (id === "mojave") {
    // A general in a place begun afresh, the computers doing nothing new (so every picture is the same), with lithium to spare; then to where the pictures are taken, so it is in sight.
    await p.waitForFunction(() => window.snapfort.feature.why === "choose", null, { timeout: 15000 });
    await p.evaluate(() => window.snapfort.net.sendWorld({ m: "serve", slot: 0 }));
    await p.waitForFunction(() => window.snapfort.feature.slot >= 0, null, { timeout: 15000 });
    await p.evaluate(() => { const n = window.snapfort.net; n.sendWorld({ m: "dev", do: "fresh" }); n.sendWorld({ m: "dev", do: "rich" }); });
    await p.evaluate(([x, z]) => window.snapfort.player.teleport(12.5 + x * 5, 0.95, 9 + z * 5), shift);
    await p.waitForFunction(() => window.snapfort.feature.bank.l > 10000, null, { timeout: 15000 });
    await p.waitForTimeout(600);
  }
  // The same small build everywhere: every piece, every material, an edited wall, a siege engine.
  await p.evaluate(([sx, sz]) => {
    const s = window.snapfort;
    const put = (type, x, y, z, rot, material, edit = 0) => {
      const id = s.nextId();
      if (s.history.do({ kind: "place", piece: { type, x: x + sx, y, z: z + sz, rot, id, material, edit: 0 } }) && edit) s.history.do({ kind: "edit", id, edit });
    };
    const box = (x, z, levels, mat) => {
      for (let y = 0; y < levels; y++) {
        const m = mat(y);
        put("wall", x, y, z, 0, m); put("wall", x, y, z + 1, 0, m); put("wall", x, y, z, 1, m); put("wall", x + 1, y, z, 1, m);
        put("floor", x, y + 1, z, 0, m);
      }
    };
    box(0, 3, 3, (y) => ["metal", "brick", "wood"][y]);
    put("roof", 0, 3, 3, 0, "wood");
    box(-2, 3, 1, () => "brick");
    put("roof", -2, 1, 3, 0, "metal");
    put("floor", 1, 0, 2, 0, "wood"); put("ramp", 1, 0, 2, 0, "wood");
    put("floor", 2, 0, 2, 0, "brick"); put("ramp", 2, 0, 2, 1, "brick");
    put("floor", 3, 0, 2, 0, "metal"); put("ramp", 3, 0, 2, 2, "metal");
    put("wall", -1, 0, 2, 0, "wood", 0b000010010);
    put("wall", -2, 0, 2, 0, "metal", 0b000111000);
    put("floor", -4, 0, 4, 0, "wood"); put("trebuchet", -4, 0, 4, 0, "wood");
    put("trebuchet", 5, 0, 5, 0, "wood");
  }, shift);
  // A second builder, standing still in view.
  const q = await open(path, world, "Bo", "#3f8fd6");
  // (In Mojave the second builder serves the blue army.)
  if (id === "mojave") { await q.waitForFunction(() => window.snapfort.feature.why === "choose", null, { timeout: 15000 }); await q.evaluate(() => window.snapfort.net.sendWorld({ m: "serve", slot: 1 })); await q.waitForFunction(() => window.snapfort.feature.slot >= 0, null, { timeout: 15000 }); }
  await q.evaluate(([x, z]) => { const s = window.snapfort; s.player.teleport(14.5 + x * 5, 0.95, 9 + z * 5); s.rig.yaw = Math.PI; s.rig.pitch = 0.1; }, shift);
  await p.evaluate(([x, z]) => { const s = window.snapfort; s.player.teleport(12.5 + x * 5, 0.95, 9 + z * 5); s.rig.yaw = Math.PI; s.rig.pitch = 0.1; }, shift);
  await p.waitForTimeout(3500);
  await p.addStyleTag({ content: "#hud, #hotbar-wrap, #stats, #online, #crosshair, #visit-bar, #tip, #overlay, .chat-tag { display: none !important; }" });
  for (const [shot, camera, target] of SHOTS) {
    await p.evaluate(([camera, target, sx, sz]) => {
      const s = window.snapfort;
      const cam = s.scene.activeCamera;
      const V = cam.position.constructor;
      if (window.__ref) s.scene.onBeforeRenderObservable.remove(window.__ref);
      window.__ref = s.scene.onBeforeRenderObservable.add(() => {
        // Always at full sharpness: the game draws fewer pixels on a busy computer, which would differ at every edge.
        if (s.engine.getHardwareScalingLevel() !== 1) s.engine.setHardwareScalingLevel(1);
        cam.position.copyFromFloats(camera[0] + sx * 5, camera[1], camera[2] + sz * 5);
        cam.setTarget(new V(target[0] + sx * 5, target[1], target[2] + sz * 5));
        for (const m of s.scene.meshes) if (m.name.startsWith("ghost") || m.name === "cloud") m.isVisible = false;
      });
    }, [camera, target, sx, sz]);
    await p.waitForTimeout(1200);
    const file = `qa/refs/${id}-${shot}.png`;
    const now = await p.screenshot();
    if (save || !existsSync(file)) {
      writeFileSync(file, now);
      console.log(`SAVED ${file}`);
      continue;
    }
    const d = difference(readFileSync(file), now);
    const ok = d <= MAX_DIFFERENT;
    if (!ok) {
      failed++;
      writeFileSync(`qa/shots/refs-${id}-${shot}.png`, now);
    }
    console.log(`${ok ? "PASS" : "FAIL"}  ${id} ${shot}  — ${(d * 100).toFixed(2)}% of pixels differ${ok ? "" : ` (new picture: qa/shots/refs-${id}-${shot}.png)`}`);
  }
  await p.context().close();
  await q.context().close();
}
await browser.close();
process.exit(failed ? 1 : 0);
