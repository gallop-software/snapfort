/**
 * Seats on the page, where a real payment cannot be made by a script: the
 * thank-you after paying (the claim answered by this script), and the unlock
 * panel's count of players on the smallest phone.
 * Dev server running: node qa/seats-page.mjs
 */
import { chromium, devices } from "playwright-core";
import { paidKey } from "./_paid.mjs";

const base = process.env.QA_BASE ?? "http://localhost:5173";
const world = `seats-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = await paidKey(base, "/moon");

async function back(claim, options = {}) {
  const context = await browser.newContext(options.device ?? { viewport: { width: 1100, height: 800 } });
  await context.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await page.route("**/api/claim?*", (route) => route.fulfill({ json: claim }));
  await page.goto(`${base}/moon?world=${world}&testpay${claim ? "&paid=cs_test_qa" : ""}`);
  await page.waitForSelector("body.ready", { timeout: 60000 });
  await wait(1500);
  return page;
}
const thanks = (page) => page.evaluate(() => ({ shown: !document.getElementById("thanks").hidden, title: document.getElementById("thanks-title").textContent, seats: document.getElementById("thanks-seats").hidden ? "" : document.getElementById("thanks-seats").textContent, switched: !document.getElementById("thanks-switched").hidden, key: document.getElementById("thanks-key").textContent, builder: window.snapfort.builder }));

let page = await back({ status: "paid", key, seats: 1, added: false, emailed: true });
let t = await thanks(page);
check("back from paying for one player: the usual thank-you, nothing about seats", t.shown && t.title === "Thanks! The Full Game is yours." && t.seats === "" && t.key === key && t.builder, JSON.stringify(t));
await page.context().close(); await wait(600);

page = await back({ status: "paid", key, seats: 3, added: false, emailed: true });
t = await thanks(page);
check("…for 3 players: says so, and that all play with the one key", t.shown && t.title === "Thanks! The Full Game is yours, for 3 players." && t.seats.includes("All 3 of you play with this same key"), JSON.stringify(t));
await page.screenshot({ path: "qa/shots/seats-thanks.png" });
await page.context().close(); await wait(600);

page = await back({ status: "paid", key, seats: 4, added: true, emailed: true });
t = await thanks(page);
check("…after adding a seat: 'Your key now has 4 seats', and how the new player gets in", t.shown && t.title === "Thanks! Your key now has 4 seats." && t.seats.includes("new player") && !t.switched, JSON.stringify(t));
await page.context().close(); await wait(600);

// The smallest phone: the unlock panel with its count, and set to adding.
// (Held upright the game asks for the phone to be turned, so sideways is the only layout.)
for (const [name, device] of [["iPhone SE landscape", devices["iPhone SE landscape"]], ["iPhone 13 landscape", devices["iPhone 13 landscape"]]]) {
  const context = await browser.newContext(device);
  await context.addInitScript((k) => { localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.key", k); }, key);
  const ph = await context.newPage();
  ph.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await ph.goto(`${base}/moon?world=${world}&testpay`);
  await ph.waitForSelector("body.ready", { timeout: 60000 });
  await wait(1500);
  const fits = () => ph.evaluate(() => {
    const o = document.getElementById("overlay");
    const seen = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; };
    return { scrolls: o.scrollHeight > o.clientHeight + 1, less: seen("seats-less"), more: seen("seats-more"), buy: seen("unlock-buy"), later: seen("unlock-later"), text: document.getElementById("unlock-buy").textContent };
  });
  // (Owning a key, the menu has no offer: open the panel the way "Add seats" does.)
  await ph.evaluate(() => window.snapfort.store.onAddSeats());
  await wait(500);
  for (let i = 0; i < 9; i++) await ph.tap("#seats-more");
  const add = await fits();
  await ph.screenshot({ path: `qa/shots/seats-add-${name.replace(/ /g, "-")}.png` });
  check(`${name}: 'Add seats' fits without scrolling, at its widest ('Add 10 seats · $70'), + stops at 10`, !add.scrolls && add.less && add.more && add.buy && add.later && add.text === "Add 10 seats · $70" && (await ph.evaluate(() => document.getElementById("seats-more").disabled)), JSON.stringify(add));
  await context.close(); await wait(500);

  const fresh = await browser.newContext(device);
  await fresh.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const p2 = await fresh.newPage();
  p2.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await p2.goto(`${base}/moon?world=${world}&testpay`);
  await p2.waitForSelector("body.ready", { timeout: 60000 });
  await wait(1500);
  await p2.tap("#offer-more"); await wait(500);
  for (let i = 0; i < 9; i++) await p2.tap("#seats-more");
  const buy = await p2.evaluate(() => {
    const o = document.getElementById("overlay");
    const seen = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; };
    return { scrolls: o.scrollHeight > o.clientHeight + 1, less: seen("seats-less"), more: seen("seats-more"), buy: seen("unlock-buy"), later: seen("unlock-later"), text: document.getElementById("unlock-buy").textContent };
  });
  await p2.screenshot({ path: `qa/shots/seats-buy-${name.replace(/ /g, "-")}.png` });
  check(`${name}: the unlock panel with Players fits without scrolling ('Unlock for 10 players · $70')`, !buy.scrolls && buy.less && buy.more && buy.buy && buy.later && buy.text === "Unlock for 10 players · $70", JSON.stringify(buy));
  await fresh.close(); await wait(500);
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
