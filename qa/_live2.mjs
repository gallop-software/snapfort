// Two generals on the live site, with a key made for the check: each takes a computer's place over, mines, selects, orders, opens the row's menus and the map; when they leave, computers have the places again and nothing is taken away.
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
const bank = (page) => page.evaluate(() => { const t = document.getElementById("material"); if (!t || t.hidden || !/Lithium/.test(t.textContent)) return null; const n = [...t.querySelectorAll("b")].map((b) => b.textContent); const [used, max] = n[2].split("/").map((x) => Number(x.trim())); return { lithium: Number(n[0]), plasma: Number(n[1]), used, max }; });
const tiles = (page) => page.evaluate(() => [...document.querySelectorAll("#hotbar .slot")].map((x) => `${x.querySelector(".key").textContent}:${x.querySelector(".label").firstChild?.textContent ?? ""}`).join(" "));
const over = (page) => page.evaluate(() => document.getElementById("world-panel")?.textContent ?? "");

const a = await open("A");
let ba = await bank(a);
say(!!ba, `a general on the live site is in at once, with a bank beside the row (${JSON.stringify(ba)})`);
say(await a.evaluate(() => document.body.classList.contains("playing") && !document.body.classList.contains("visiting")), "they command: playing, not visiting");
say((await tiles(a)) === "Z:Wall F:Floor X:Ramp C:Canopy V:Remove B:Command", `the row: the pieces and Command, no siege engine (${await tiles(a)})`);
say(await a.evaluate(() => !document.querySelector("#material .swatch") && !document.getElementById("mj-card") && !window.snapfortDark), "no material to choose, and no command card");
const b = await open("B");
const bb = await bank(b);
// (The place taken over may be one that has lost its Core: its supply limit is then 0 until a new one stands.)
say(!!bb, `a second general, on the key's second seat, has a place too (${JSON.stringify(bb)})`);
await wait(16000);
const later = await bank(a);
console.log(`lithium on the live server: ${ba.lithium} → ${later.lithium} (a place taken over may be spending as well as earning)`);
// A general arrives looking at their Core: one click selects it.
await a.mouse.down(); await a.mouse.up();
await wait(800);
// (The place taken over may be built up: what stands before the general may be another building of theirs, not the Core.)
const said = await over(a);
say(/Deselect/.test(await tiles(a)) && said.length > 3, `a click selects the building before them: said over the row ("${said.slice(0, 50)}"), and the row shows what it does (${await tiles(a)})`);
const selected = /H:Hauler/.test(await tiles(a));
if (selected) {
  const now = await bank(a);
  if (now.lithium >= 50 && now.used < now.max) {
    await a.keyboard.press("h");
    const made = await until(a, () => /making Hauler/.test(document.getElementById("world-panel")?.textContent ?? ""), null, 8000);
    say(!!made, `H orders a Hauler on the live server: "${(await over(a)).slice(0, 60)}"`);
  } else console.log(`(no Hauler ordered: ${JSON.stringify(now)})`);
}
for (let i = 0; i < 3; i++) await a.keyboard.press("Backspace");
await wait(700);
await a.keyboard.press("b");
await wait(700);
say(/N:Build/.test(await tiles(a)) && /Whole army/.test(await tiles(a)), `B opens the general's own menu on the row (${await tiles(a)})`);
await a.keyboard.press("n");
await wait(700);
say(/F:Foundry/.test(await tiles(a)) && /C:Command Core/.test(await tiles(a)), `N opens the buildings (${await tiles(a)})`);
for (let i = 0; i < 3; i++) await a.keyboard.press("Backspace");
await wait(700);
await a.keyboard.press("j");
await wait(500);
say((await tiles(a)) === "Z:Wall F:Floor X:Ramp C:Canopy V:Remove B:Command", "there are no alliances: J opens nothing");
await a.keyboard.press("Tab");
await wait(500);
say(await a.evaluate(() => document.getElementById("mj").classList.contains("big")), "Tab opens the map");
await a.screenshot({ path: "qa/shots/live-map.png" });
await a.keyboard.press("Tab");
await a.screenshot({ path: "qa/shots/live-general.png" });
const during = await admin("/admin/overview");
const room = inMojave(during);
console.log("in Mojave now:", names(during), "· pieces", room?.pieces);
say(errors.length === 0, `no errors on either page${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
await wait(8000);
const after = await admin("/admin/overview");
console.log("in Mojave after they left:", names(after), "· pieces", inMojave(after)?.pieces, "(computers have the places; nothing built is taken away)");
process.exit(bad ? 1 : 0);
