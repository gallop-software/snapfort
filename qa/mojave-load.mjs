/**
 * Mojave at full size: all eight armies (two with a general, six with nobody)
 * with about 210 units each, 1,700 in all, three in eight of them Troopers,
 * sent to fight in the middle of the map. Measured: how long the server takes
 * over each step of the war, the frame rate of a real page that commands one
 * of the armies, and the frame rate of a phone-sized page in battery saver
 * that commands another and, for this test, is sent every unit in the world
 * whether it sees it or not (the most a page could ever be asked to draw).
 * Needs the Gallop dev server with Stripe test keys in .dev.vars.
 * Run: npm run qa:mojave-load -- [seconds]
 */
import { chromium, devices } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const seconds = Number(process.argv[2] ?? 60);
const world = `mojl-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = await paidKey(base, "/mojave"), key2 = await paidKey(base, "/mojave");

async function open(label, device, k) {
  const ctx = await browser.newContext(device);
  await ctx.addInitScript((k) => { if (k) localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); }, k);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text().slice(0, 200)}`));
  await p.goto(`${base}/mojave?world=${world}`);
  await p.waitForSelector("body.ready", { timeout: 30000 });
  if (device.hasTouch) await p.tap("#play-free"); else await p.click("#play-free");
  await wait(1500);
  return p;
}
/**
 * Frames the game really drew each second (counted as the scene finishes each one: in battery saver the game
 * draws 30 a second whatever the browser's own clock does), sampled for a while: the mean, the worst second,
 * and the longest any one frame took to work out and draw, ms.
 */
const frameRate = (p, ms) => p.evaluate((ms) => new Promise((res) => {
  const scene = window.snapfort.scene;
  const counts = []; let n = 0, mark = performance.now(), began = 0, longest = 0; const start = mark;
  const before = scene.onBeforeRenderObservable.add(() => { began = performance.now(); });
  const after = scene.onAfterRenderObservable.add(() => {
    n++;
    const now = performance.now();
    longest = Math.max(longest, now - began);
    if (now - mark >= 1000) { counts.push(n); n = 0; mark = now; }
    if (now - start >= ms) {
      scene.onBeforeRenderObservable.remove(before);
      scene.onAfterRenderObservable.remove(after);
      res({ mean: Math.round(counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length)), worst: Math.min(...counts), longest: Math.round(longest * 10) / 10 });
    }
  });
}), ms);
const perf = async (p) => {
  await p.evaluate(() => { window.perfNote = null; const f = window.snapfort.feature; const old = f.message; if (!f.tapped) { f.tapped = true; const hook = window.snapfort.net; const prev = hook.handlers.world; hook.handlers.world = (d) => { if (d?.m === "note" && String(d.text).startsWith("perf ")) window.perfNote = JSON.parse(d.text.slice(5)); prev(d); }; } window.snapfort.net.sendWorld({ m: "dev", do: "perf" }); });
  for (let i = 0; i < 40; i++) { const v = await p.evaluate(() => window.perfNote); if (v) return v; await wait(100); }
  return null;
};

const a = await open("general", { viewport: { width: 1280, height: 760 } }, key);
const phone = await open("phone", { ...devices["iPhone 13 landscape"] }, key2);
// Each chooses an army: red and blue.
for (const [p, slot] of [[a, 0], [phone, 1]]) { await p.waitForFunction(() => window.snapfort.feature.why === "choose"); await p.evaluate((slot) => window.snapfort.net.sendWorld({ m: "serve", slot }), slot); await p.waitForFunction(() => window.snapfort.feature.slot >= 0); }
await phone.evaluate(() => window.snapfort.net.sendWorld({ m: "dev", do: "all" }));
check("the phone-sized page is in battery saver, a general, and is sent everything for this test", await phone.evaluate(() => window.snapfort.graphics.effective === "saver" && window.snapfort.feature.slot >= 0));
const calm = { desk: await frameRate(a, 4000), phone: await frameRate(phone, 4000) };
console.log(`before: desktop ${calm.desk.mean} fps, phone ${calm.phone.mean} fps`);

await a.evaluate(() => window.snapfort.net.sendWorld({ m: "dev", do: "stress" }));
await wait(3000);
await perf(a);
const counts = async (p) => p.evaluate(() => { const f = window.snapfort.feature; return { units: f.army.units.size, gens: f.generals.length }; });
const atStart = await counts(phone);
check("eight generals and about 1,700 units are in the world, and the phone is sent them all", atStart.gens === 8 && atStart.units >= 1600, JSON.stringify(atStart));
// The general goes to the middle of the map, where the armies meet, and watches from a tower's height.
for (const p of [a, phone]) await p.evaluate(() => { const s = window.snapfort; s.player.teleport(-40, 30, -40); s.rig.yaw = Math.PI / 4; s.rig.pitch = 0.5; });
await a.evaluate(() => window.snapfort.net.sendWorld({ m: "dev", do: "spawn", kind: "scout", n: 4, at: [-30, 0, -30] }));

const samples = [];
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  const [desk, ph] = await Promise.all([frameRate(a, 5000), frameRate(phone, 5000)]);
  const server = await perf(a);
  const seen = await counts(a), all = await counts(phone);
  samples.push({ desk, ph, server, seen: seen.units, all: all.units });
  console.log(`  desktop ${desk.mean} fps (worst ${desk.worst}, longest frame ${desk.longest} ms) seeing ${seen.units} · phone ${ph.mean} fps (worst ${ph.worst}, longest frame ${ph.longest} ms) seeing ${all.units} · server ${server?.mean} ms a step (worst ${server?.worst}), ${server?.units} units, ${Math.round((server?.sentKb ?? 0) / 5 / (server?.viewers ?? 1))} KB/s a page`);
}
const people = await phone.evaluate(() => window.snapfort.scene.meshes.filter((m) => /^mojave-trooper-/.test(m.name) && !/-marks$/.test(m.name) && m.isEnabled()).reduce((n, m) => n + (m.thinInstanceCount || 0), 0));
check("hundreds of Troopers are drawn as people, in their poses, on the phone", people >= 200, `${people} Troopers drawn at the end`);
await a.screenshot({ path: "qa/shots/mojave-load.png" });
await phone.screenshot({ path: "qa/shots/mojave-load-phone.png" });

const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
const serverMean = mean(samples.map((s) => s.server?.mean ?? 0)), serverWorst = Math.max(...samples.map((s) => s.server?.worst ?? 0));
const deskMean = mean(samples.map((s) => s.desk.mean)), phoneMean = mean(samples.map((s) => s.ph.mean));
check("the server takes a small part of each 100 ms step", serverMean < 30, `mean ${serverMean.toFixed(1)} ms, worst ${serverWorst} ms`);
check("no step ever takes longer than a step lasts three times over", serverWorst < 300, `worst ${serverWorst} ms`);
check("the general's page stays smooth", deskMean >= 45, `${Math.round(deskMean)} fps (it was ${calm.desk.mean} with nothing going on)`);
check("the phone-sized page keeps its battery-saver 30 frames a second", phoneMean >= 26, `${Math.round(phoneMean)} fps (it was ${calm.phone.mean})`);
const longest = Math.max(...samples.map((s) => s.ph.longest));
check("…with time to spare in every frame (a frame at 30 a second lasts 33 ms)", longest < 25, `the longest frame took ${longest} ms to work out and draw, with every unit in the world sent to it`);
check("the armies fought: units were destroyed", samples[samples.length - 1].all < atStart.units - 100, `${atStart.units} → ${samples[samples.length - 1].all}`);
check("no errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
