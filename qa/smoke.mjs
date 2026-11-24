/**
 * Smoke check of a built or live site: every world loads, connects, shows its
 * menu written from the list of worlds, and can be walked into, with no
 * errors. Works without the development handles, so it runs against a
 * production build (a preview of dist/) or the real site.
 *   node qa/smoke.mjs [base address]      (default https://snapfort.io)
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "https://snapfort.io";
const local = base.includes("localhost");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const first = await (await browser.newContext()).newPage();
await first.goto(base);
await first.waitForSelector("#worlds .world");
const worlds = await first.$$eval("#worlds .world", (list) => list.map((a) => ({ id: a.dataset.env, href: a.getAttribute("href"), name: a.querySelector("b").textContent, paid: a.classList.contains("paid") })));
check("the menu lists the worlds", worlds.length >= 2, worlds.map((w) => w.name).join(", "));
const build = await first.evaluate(() => fetch("/api/store").then((r) => r.json()).then((j) => j.build));
console.log(`build ${build}`);
await first.context().close();

for (const w of worlds) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`${base}${w.href}${local ? `${w.href.includes("?") ? "&" : "?"}world=smoke${Date.now().toString(36)}` : ""}`);
  await page.waitForSelector("body.ready", { timeout: 45000 });
  check(`${w.name}: loads and is marked as the world you are in`, (await page.evaluate(() => document.body.dataset.env)) === w.id && (await page.$eval(".world.current", (a) => a.dataset.env)) === w.id);
  check(`${w.name}: connected to its shared world`, !(await page.isVisible("#net")) || !/offline|reconnect/i.test(await page.textContent("#net")), await page.textContent("#play-free"));
  check(`${w.name}: the play button is ready`, await page.isEnabled("#play-free"), await page.textContent("#play-free"));
  const pages = requests.filter((u) => /\/assets\/page-[\w-]+\.js/.test(u));
  if (!local || base.includes("4173")) check(`${w.name}: fetched one world's drawing code, its own`, pages.length === 1, pages.map((u) => u.split("/").pop()).join(", "));
  await page.click("#play-free");
  await page.waitForTimeout(1500);
  await page.keyboard.down("KeyW"); await page.waitForTimeout(700); await page.keyboard.up("KeyW");
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  check(`${w.name}: playing (${w.paid ? "visiting" : "building"})`, (await page.isVisible("#hotbar")) && (await page.evaluate(() => document.body.classList.contains("visiting"))) === w.paid);
  const shot = await page.screenshot();
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(shot);
  const colours = new Set();
  for (let i = 0; i < png.data.length; i += 4 * 997) colours.add(`${png.data[i] >> 4},${png.data[i + 1] >> 4},${png.data[i + 2] >> 4}`);
  check(`${w.name}: draws a picture`, colours.size > 12, `${colours.size} colours`);
  check(`${w.name}: no errors`, errors.length === 0, errors.join(" | "));
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
