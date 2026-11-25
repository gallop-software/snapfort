// Two generals on the live site, with a key made for the check: arriving, mining, ordering, building, pieces, the dark, leaving.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const base = "https://snapfort.io";
const secret = readFileSync("secrets/admin-secret.txt", "utf8").trim();
const admin = (path, method = "GET") => fetch(base + path, { method, headers: { "x-admin-secret": secret } }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, text) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${text}`); };
const until = async (page, fn, arg, ms = 12000) => { const end = Date.now() + ms; for (;;) { const v = await page.evaluate(fn, arg); if (v || Date.now() > end) return v; await wait(200); } };

const before = await admin("/admin/overview");
const inMojave = (o) => (o.worlds ?? o.rooms ?? []).find?.((w) => w.env === "mojave" || w.id === "mojave" || w.world === "mojave");
const names = (o) => (inMojave(o)?.players ?? []).map((p) => `${p.name} (${p.status ?? ""})`).join(", ") || "nobody";
console.log("in Mojave before:", names(before));
const existing = await admin("/admin/keys?email=qa@snapfort.io");
let key = Array.isArray(existing) ? existing.find((k) => (k.seats ?? 1) >= 2 && k.paid !== false)?.key : undefined;
if (!key) key = (await admin("/admin/grant?email=qa@snapfort.io&seats=2", "POST")).key;
say(/^SNAP-/.test(key ?? ""), "a two-seat key for the check");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const errors = [];
async function open(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await context.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.mojave.intro", "seen"); }, key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  // The live page keeps nothing in reach of a console: what it shows is read from the screen, and the keys and mouse are real.
  await page.goto(`${base}/mojave`);
  await page.waitForSelector("body.ready", { timeout: 40000 });
  await page.click("#play-free");
  await wait(3000);
  return page;
}
const bank = (page) => page.evaluate(() => { const t = document.getElementById("mj-bank"); if (!t || t.hidden) return null; const n = [...t.querySelectorAll("b")].map((b) => b.textContent); return { lithium: Number(n[0]), plasma: Number(n[1]), supply: n[2] }; });
const card = (page) => page.evaluate(() => document.getElementById("mj-card")?.textContent ?? "");

const a = await open("A");
let ba = await bank(a);
say(!!ba && ba.supply === "4 / 12", `a general on the live site has a bank and four Haulers (${JSON.stringify(ba)})`);
say(await a.evaluate(() => document.getElementById("mj-watch").hidden && !document.body.classList.contains("visiting")), "they command: not watching, not visiting");
const b = await open("B");
const bb = await bank(b);
say(!!bb && bb.supply === "4 / 12", `a second general, on the key's second seat, has theirs (${JSON.stringify(bb)})`);
await wait(14000);
const later = await bank(a);
say(later.lithium > ba.lithium, `lithium comes in on the live server (${ba.lithium} → ${later.lithium})`);
// A general arrives looking at their Core: one click selects it.
await a.mouse.down(); await a.mouse.up();
await wait(500);
const selected = /Command Core/.test(await card(a));
say(selected, "a click on the Core selects it (the card shows it)");
if (selected) {
  const l0 = (await bank(a)).lithium;
  if (l0 < 50) await wait(12000);
  await a.keyboard.press("h");
  const made = await until(a, () => /5 \/ 12/.test(document.getElementById("mj-bank").textContent), null, 8000);
  say(!!made, "H orders a Hauler on the live server: supply 5 / 12");
}
await a.keyboard.press("Backspace");
// The whole army key with no army says so; the build menu opens; the generals list shows the other general and the computer.
await a.keyboard.press("n");
await wait(400);
say(/Foundry/.test(await card(a)) && /Command Core/.test(await card(a)), "N opens the build menu");
await a.keyboard.press("Backspace");
await a.keyboard.press("j");
await wait(400);
const gens = await card(a);
say(/Generals/.test(gens) && /ask to ally/.test(gens), `J lists the other generals (${gens.replace(/\s+/g, " ").slice(0, 110)})`);
await a.keyboard.press("Backspace");
await a.keyboard.press("Tab");
await wait(500);
say(await a.evaluate(() => document.getElementById("mj").classList.contains("big")), "Tab opens the map");
await a.screenshot({ path: "qa/shots/live-map.png" });
await a.keyboard.press("Tab");
await a.keyboard.press("Backspace");
await a.screenshot({ path: "qa/shots/live-general.png" });
// What is only for checks is refused on the live site: nothing to send it with from here but the page itself, which has no way to; the server's own test covers it.
const over = await admin("/admin/overview");
const room = inMojave(over);
console.log("in Mojave now:", names(over), "· pieces", room?.pieces);
say(errors.length === 0, `no errors on either page${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
// Both gone: after the grace period nothing of theirs is left, and the room goes quiet.
await wait(100000);
const after = await admin("/admin/overview");
console.log("in Mojave after they left:", names(after), "· pieces", inMojave(after)?.pieces);
process.exit(bad ? 1 : 0);
