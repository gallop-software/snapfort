/**
 * Keys and devices: the button in the key email unlocks the device it is
 * opened on, a device remembers its key (a year-long cookie, should the
 * browser forget), a player on every seat (with all seats in use one more
 * device waits; "Use it here" takes the seat of whoever has played longest,
 * "Add a seat" buys one more), keys with several seats, "Email me a link"
 * unlocks another device, and "Replace my key" retires a leaked key
 * everywhere. Uses the emails the dev
 * server really sends (Cloudflare's local simulator writes each to a file).
 * Dev server running, with Stripe test keys in .dev.vars: npm run qa:keys
 */
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? (process.env.QA_BASE ?? (process.env.QA_BASE ?? "http://localhost:5173")) + "/");
const world = `keys-${Date.now().toString(36)}`;
const buyer = `qa-keys-${Date.now().toString(36)}@example.com`;
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, body) => fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

function sentEmails() {
  const root = ".wrangler/tmp/email";
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((d) => {
    const dir = join(root, d, "email-text");
    return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  }).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).map((f) => readFileSync(f, "utf8"));
}
/** The newest email that matches, waiting a moment for it. */
async function email(match) {
  for (let i = 0; i < 20; i++) {
    const found = sentEmails().filter((m) => match.test(m)).pop();
    if (found) return found;
    await wait(250);
  }
  return null;
}
/** The newest matching email among those sent after the first `n`, waiting a moment for it. */
async function emailAfter(n, match) {
  for (let i = 0; i < 20; i++) {
    const found = sentEmails().slice(n).filter((m) => match.test(m)).pop();
    if (found) return found;
    await wait(250);
  }
  return null;
}
/** A link from an email, pointed at this run's test world. */
const inWorld = (link) => link.replace(/^(https?:\/\/[^/]+\/(?:moon)?)/, `$1?world=${world}`);

/** Pays for a checkout through Stripe's webhook, by `buyer`; returns the key it was for. */
async function pay(order, by = buyer) {
  const r = await api("/api/buy", { path: "/moon", testpay: true, ...order });
  const id = r.url.match(/cs_test_[A-Za-z0-9]+/)[0];
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((x) => x.json());
  const body = JSON.stringify({ id: "evt_keys", type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: session.client_reference_id, payment_status: "paid", livemode: false, customer_details: { email: by } } } });
  const t = Math.floor(Date.now() / 1000);
  await fetch(new URL("/api/stripe", base), { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}` }, body });
  return session.client_reference_id;
}
/** A key with so many seats, paid for. */
const paidKey = (seats = 1, by = buyer) => pay({ seats }, by);

/** A device: its own browser storage and cookies. */
async function device(label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message.slice(0, 200)}`));
  return page;
}
async function go(page, url) {
  await page.goto(url);
  await page.waitForSelector("body.ready", { timeout: 60000 });
  await wait(1500);
}
const moon = new URL(`/moon?world=${world}`, base).toString();
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const builder = (page) => sf(page, () => window.snapfort.builder);
const saved = (page) => sf(page, () => localStorage.getItem("snapfort.key"));
const toast = (page) => sf(page, () => document.getElementById("toast").textContent);
const play = async (page) => { await page.click("#play-free"); await wait(800); };
const cookieKey = async (page) => (await page.context().cookies()).find((c) => c.name === "snapfort_key")?.value;

// ── Buying: the key email's button ──────────────────────────────────────
const key = await paidKey();
const bought = await email(new RegExp(key));
const link = bought?.match(/https?:\/\/\S+\/moon#key=[A-Z0-9-]+/)?.[0];
check("the purchase email has an 'Unlock SnapFort on this device' link with the key (after the #)", !!link && bought.includes("Unlock SnapFort on this device") && link.endsWith(`#key=${key}`), link);

const a = await device("A");
await go(a, inWorld(link));
check("tapping it unlocks the device it is opened on: building on the Moon at once", (await builder(a)) && (await saved(a)) === key, await toast(a));
check("…the key is wiped from the address bar straight away", !(await sf(a, () => location.href)).includes("key="));
check("…and the device remembers it in a year-long cookie too", (await cookieKey(a)) === key);
await sf(a, () => localStorage.removeItem("snapfort.key"));
await go(a, moon);
check("if the browser forgets what the site saved (Safari after 7 days), the cookie keeps it unlocked", (await builder(a)) && (await saved(a)) === key);
await play(a);

// ── One seat: one player at a time ──────────────────────────────────────
const b = await device("B");
await b.context().addInitScript((k) => localStorage.setItem("snapfort.key", k), key);
await go(b, `${moon}&testpay`);
await play(b);
await wait(800);
check("a second device with the same one-seat key waits as a visitor; the first keeps building", !(await builder(b)) && (await builder(a)));
check("…it is told why, with 'Use it here' and 'Add a seat'", (await b.isVisible("#visit-bar")) && (await b.textContent("#visit-bar")).includes("in use on another device") && (await b.textContent("#visit-buy")).includes("Use it here") && (await b.isVisible("#visit-own")) && (await b.textContent("#visit-own")).includes("Add a seat · $7"), await b.textContent("#visit-bar"));
await b.mouse.down(); await b.mouse.up(); await wait(300);
check("…trying to build there says how to take the seat (not 'buy')", (await toast(b)).includes("press U") && !(await b.isVisible("#view-unlock")), await toast(b));
await b.keyboard.press("KeyO"); await wait(1500);
const addPanel = await b.evaluate(() => ({ shown: !document.getElementById("view-unlock").hidden, title: document.getElementById("unlock-title").textContent, buy: document.getElementById("unlock-buy").textContent, about: document.getElementById("unlock-add").textContent, perks: getComputedStyle(document.getElementById("unlock-perks")).display, label: document.getElementById("seats-label").textContent }));
check("O ('Add a seat') opens the panel set to adding: 'Add 1 seat · $7', and what the key has now", addPanel.shown && addPanel.title === "Add seats to your key" && addPanel.buy === "Add 1 seat · $7" && addPanel.about.includes("1 seat") && addPanel.perks === "none" && addPanel.label === "Seats to add", JSON.stringify(addPanel));
await b.click("#seats-more"); await b.click("#seats-more");
check("…its + counts up: 'Add 3 seats · $21'", (await b.textContent("#unlock-buy")) === "Add 3 seats · $21" && (await b.textContent("#seats-count")) === "3");
await b.click("#unlock-later"); await wait(600);
await b.keyboard.press("KeyU"); await wait(1200);
check("U ('Use it here') takes the seat: the second builds, the first visits", (await builder(b)) && !(await builder(a)));
check("…the first is told its seat was taken, with 'Use it here'", (await a.textContent("#visit-bar")).includes("seat was taken") && (await a.textContent("#visit-buy")).includes("Use it here"), await a.textContent("#visit-bar"));
await b.context().close();
{
  let back = false;
  for (let i = 0; i < 40 && !back; i++) { await wait(500); back = await builder(a); }
  check("when the other device leaves, the seat is free and the first builds again by itself", back);
}

// ── Email me a link ─────────────────────────────────────────────────────
const c = await device("C");
await go(c, moon);
check("a new device without the key visits", !(await builder(c)));
await c.click("#offer-key");
await c.click("#store-lost-open");
await c.fill("#store-lost-email", buyer.toUpperCase());
const sentBefore = sentEmails().length;
await c.click("#store-lost button[type=submit]"); await wait(800);
check("'Email me a link' says a link is on its way, without showing the key", (await c.textContent("#store-message")).includes("link is on its way") && !(await c.textContent("#store-message")).includes(key));
const asked = await email(/Here's your link to SnapFort/);
const askedLink = asked?.match(/https?:\/\/\S+\/moon#key=[A-Z0-9-]+/)?.[0];
check("…the email arrives with the unlock button", sentEmails().length > sentBefore && askedLink?.endsWith(`#key=${key}`), askedLink);
await go(c, inWorld(askedLink));
check("…and tapping it there gives that device the key; with its one seat in use, it waits", (await saved(c)) === key && !(await builder(c)) && (await builder(a)));
// (The link only changed what is after the #, so the settings are still open.)
if (await c.isVisible("#settings-back")) await c.click("#settings-back");
await play(c);
await c.keyboard.press("KeyU"); await wait(1200);
check("…'Use it here' there takes the seat (the one that had it goes back to visiting)", (await builder(c)) && !(await builder(a)));
await c.evaluate(() => document.exitPointerLock()); await wait(1300);

// ── On a phone ──────────────────────────────────────────────────────────
{
  const { devices } = await import("playwright-core");
  const ctx = await browser.newContext({ ...devices["iPhone SE landscape"] });
  await ctx.addInitScript((k) => { localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.key", k); }, key);
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => errors.push(`[phone] ${e.message.slice(0, 200)}`));
  await go(ph, moon);
  await ph.tap("#play-free"); await wait(1000);
  check("a phone with the key waits while the computer has its seat", !(await builder(ph)) && (await builder(c)));
  const bar = await ph.evaluate(() => { const r = document.getElementById("visit-bar").getBoundingClientRect(); return { shown: r.width > 0, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0, text: document.getElementById("visit-buy").textContent }; });
  check("…the phone shows 'Use it here', fitting the smallest screen", bar.shown && bar.fits && bar.text.includes("Use it here"), JSON.stringify(bar));
  await ph.tap("#visit-buy"); await wait(1200);
  check("…one tap on 'Use it here' and the phone builds; the computer visits", (await builder(ph)) && !(await builder(c)));
  await ph.tap("#t-settings"); await wait(700);
  const inside = () => { const o = document.getElementById("overlay"); const box = document.getElementById("full-game").getBoundingClientRect(); const ok = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= box.left && r.right <= box.right + 1; }; return { fits: o.scrollHeight <= o.clientHeight + 1, switch: ok(document.getElementById("store-other-key")), copy: ok(document.getElementById("store-copy")), replace: ok(document.querySelector("#store-lost-link .store-replace")) }; };
  const own = await ph.evaluate(inside);
  check("…its settings (owning the Full Game) fit the smallest phone, with Copy and Switch key", own.fits && own.switch && own.copy, JSON.stringify(own));
  await ph.tap("#store-other-key"); await wait(400);
  const open = await ph.evaluate(inside);
  await ph.screenshot({ path: "qa/shots/keys-phone-settings.png" });
  check("…'Switch key' opens the key box there, with Replace my key, all fitting", open.fits && open.replace && (await ph.isVisible("#store-key-input")), JSON.stringify(open));
  await ph.tap("#store-enter-cancel"); await wait(300);
  await ctx.close();
  await wait(800);
}

// ── Replace my key ──────────────────────────────────────────────────────
// (Back to the menu, then Settings.)
await go(c, moon);
await c.click("#open-settings"); await wait(300);
check("an unlocked device has 'Replace my key' in Settings", await c.isVisible("#store-replace"));
await c.click("#store-replace"); await wait(800);
const masked = await c.textContent("#store-message");
check("…it emails a link to the buyer (address shown masked), and changes nothing yet", masked.includes("q***@example.com") && (await api("/api/key", { key })).valid === true, masked);
const confirm = await email(/Replace your SnapFort key\?/);
const replaceLink = confirm?.match(/https?:\/\/\S+\/#replace=[0-9a-f]+/)?.[0];
check("…the email asks first, with a one-time link", !!replaceLink && confirm.includes("ignore this email"), replaceLink);
await go(c, inWorld(replaceLink).replace("/?world", `/moon?world`));
const newKey = await saved(c);
check("tapping it gives this device a new key, and says the old one no longer works", !!newKey && newKey !== key && (await toast(c)).includes("old one no longer works") && (await builder(c)), `${newKey} · ${await toast(c)}`);
check("…the old key no longer works anywhere; the new one does", (await api("/api/key", { key })).valid === false && (await api("/api/key", { key: newKey })).valid === true);
const replaced = await email(new RegExp(`Here's your new key[\\s\\S]*${newKey}`));
check("…and the new key is emailed, with its unlock button", !!replaced && replaced.includes(`#key=${newKey}`));
await go(a, moon);
check("a device still holding the old key is back to visiting, and forgets it (storage and cookie)", !(await builder(a)) && (await saved(a)) === null && !(await cookieKey(a)));
check("the replace link works only once", !!(await api("/api/replace/confirm", { token: replaceLink.split("#replace=")[1] })).error);
await go(a, inWorld(link));
check("an email link with the old key says it no longer works", !(await builder(a)) && (await toast(a)).includes("no longer works"), await toast(a));

// ── Switching keys: sharing a friend's key, then getting your own ───────
{
  const friends = await paidKey();
  const own = await paidKey();
  const d = await device("D");
  const e = await device("E");
  for (const page of [d, e]) await page.context().addInitScript((k) => { if (!sessionStorage.getItem("qa.seeded")) { sessionStorage.setItem("qa.seeded", "1"); localStorage.setItem("snapfort.key", k); } }, friends);
  await go(e, moon); await play(e); await wait(800);
  await go(d, `${moon}&testpay`); await play(d); await wait(800);
  check("sharing a one-seat key: the friend plays, so this device visits", (await builder(e)) && !(await builder(d)), await d.textContent("#visit-bar"));
  await d.keyboard.press("KeyU"); await wait(1200);
  // (Esc: out of play, the mouse free again, the settings showing.)
  await d.evaluate(() => document.exitPointerLock()); await wait(1300);
  check("Settings on a device with a key: its seats, 'Add seats', 'Switch key' and 'Buy my own · $7' under the key", (await builder(d)) && (await d.textContent("#store-seats")) === "1 seat" && (await d.isVisible("#store-owned .store-add-seats")) && (await d.isVisible("#store-own-buy")) && (await d.isVisible("#store-other-key")), await d.textContent("#store-owned"));
  await d.click("#store-other-key");
  await d.fill("#store-key-input", own.toLowerCase());
  await d.click("#store-enter button[type=submit]"); await wait(1200);
  check("typing their own key switches the device to it (saved, cookie, shown in Settings)", (await saved(d)) === own && (await cookieKey(d)) === own && (await d.textContent("#store-key")) === own && (await d.textContent("#store-message")).includes("Switched"), await d.textContent("#store-message"));
  {
    let back = false;
    for (let i = 0; i < 40 && !back; i++) { await wait(500); back = await builder(e); }
  }
  check("…and now both build at once: the friend with theirs, this device with its own", (await builder(d)) && (await builder(e)));
  await d.context().close(); await e.context().close();
  await wait(500);
}

// ── A key with several seats ────────────────────────────────────────────
{
  // (Its own buyer: "Replace my key" emails an address at most once every two minutes.)
  const family = await paidKey(2, `family-${buyer}`);
  const mail = await email(new RegExp(family));
  check("a key bought with 2 seats: the email says 2 can play, with the one key", !!mail && mail.includes("2 players at a time") && mail.includes("2 of you can now build"), mail?.slice(0, 200));
  check("…and the server says it has 2 seats", (await api("/api/key", { key: family })).seats === 2);
  const open = async (label) => {
    const page = await device(label);
    await page.context().addInitScript((k) => localStorage.setItem("snapfort.key", k), family);
    await go(page, `${moon}&testpay`);
    await play(page);
    return page;
  };
  const k1 = await open("kid 1");
  const k2 = await open("kid 2");
  await wait(800);
  check("two devices build with it at the same time", (await builder(k1)) && (await builder(k2)));
  await k1.evaluate(() => document.exitPointerLock()); await wait(1300);
  check("…Settings shows '2 seats' beside the key", (await k1.textContent("#store-seats")) === "2 seats", await k1.textContent("#store-owned"));
  await k1.click("#settings-back").catch(() => {});
  const k3 = await open("kid 3");
  await wait(800);
  check("a third device waits: 'All 2 seats on your key are in use'", !(await builder(k3)) && (await k3.textContent("#visit-bar")).includes("All 2 seats on your key are in use") && (await builder(k1)) && (await builder(k2)), await k3.textContent("#visit-bar"));
  await k3.reload(); await k3.waitForSelector("body.ready", { timeout: 60000 }); await wait(1500);
  check("…still waiting after a reload", !(await builder(k3)));
  await k2.reload(); await k2.waitForSelector("body.ready", { timeout: 60000 }); await wait(1500);
  check("a seated device that reloads keeps its seat (the waiting one does not slip in)", (await builder(k2)) && (await builder(k1)) && !(await builder(k3)));
  await play(k3);
  await k3.keyboard.press("KeyU"); await wait(1200);
  check("'Use it here' takes the seat of whoever has played longest (the first device), nobody else's", (await builder(k3)) && !(await builder(k1)) && (await builder(k2)));
  // One more seat, bought for the key afterwards.
  const again = await pay({ seats: 1, key: family }, "someone-else@example.com");
  const added = await email(new RegExp(`Your key now has 3 seats[\\s\\S]*${family}`));
  check("adding a seat afterwards: the same key, now with 3 seats, and an email saying so", again === family && (await api("/api/key", { key: family })).seats === 3 && !!added && added.includes(`#key=${family}`), added?.slice(0, 160));
  {
    let back = false;
    for (let i = 0; i < 40 && !back; i++) { await wait(500); back = await builder(k1); }
    check("…the device that was waiting gets the new seat by itself: all three build", back && (await builder(k2)) && (await builder(k3)));
  }
  check("seats cannot be added to a key that is not paid for, nor more than 10 at once", !!(await api("/api/buy", { path: "/moon", testpay: true, seats: 1, key: "SNAP-2222-2222-2222" })).error && !!(await api("/api/buy", { path: "/moon", testpay: true, seats: 11 })).error && !!(await api("/api/buy", { path: "/moon", testpay: true, seats: 0 })).error);
  // Replacing the key keeps its seats, and sends everyone playing with it back to visiting.
  const sentSoFar = sentEmails().length;
  const link = (await api("/api/replace", { key: family }));
  const confirm = await emailAfter(sentSoFar, /Replace your SnapFort key\?/);
  const token = confirm?.match(/#replace=([0-9a-f]+)/)?.[1];
  const fresh = await api("/api/replace/confirm", { token });
  await wait(1000);
  check("replacing a key with seats: the new key has them too, and everyone on the old one visits", !!link.ok && !!confirm && fresh.seats === 3 && (await api("/api/key", { key: fresh.key })).seats === 3 && !(await builder(k1)) && !(await builder(k2)) && !(await builder(k3)), JSON.stringify(fresh));
  for (const page of [k1, k2, k3]) await page.context().close();
  await wait(500);
}

// ── The meadow needs none of it ─────────────────────────────────────────
await go(a, new URL(`/?world=${world}`, base).toString());
check("the meadow: everyone builds, key or not", await builder(a));

check("no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
