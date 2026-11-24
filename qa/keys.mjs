/**
 * Keys and devices: the button in the key email unlocks the device it is
 * opened on, a device remembers its key (a year-long cookie, should the
 * browser forget), one player at a time (the newest device takes the key,
 * "Use it here" takes it back), "Email me a link" unlocks another device, and
 * "Replace my key" retires a leaked key everywhere. Uses the emails the dev
 * server really sends (Cloudflare's local simulator writes each to a file).
 * Dev server running, with Stripe test keys in .dev.vars: npm run qa:keys
 */
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
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
/** A link from an email, pointed at this run's test world. */
const inWorld = (link) => link.replace(/^(https?:\/\/[^/]+\/(?:moon)?)/, `$1?world=${world}`);

/** A key paid for through Stripe's webhook, by `buyer`. */
async function paidKey() {
  const r = await api("/api/buy", { path: "/moon", testpay: true });
  const id = r.url.match(/cs_test_[A-Za-z0-9]+/)[0];
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((x) => x.json());
  const body = JSON.stringify({ id: "evt_keys", type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: session.client_reference_id, payment_status: "paid", livemode: false, customer_details: { email: buyer } } } });
  const t = Math.floor(Date.now() / 1000);
  await fetch(new URL("/api/stripe", base), { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}` }, body });
  return session.client_reference_id;
}

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

// ── One player at a time ────────────────────────────────────────────────
const b = await device("B");
await b.context().addInitScript((k) => localStorage.setItem("snapfort.key", k), key);
await go(b, moon);
await play(b);
await wait(800);
check("a second device with the same key builds, and takes it over: the first goes back to visiting", (await builder(b)) && !(await builder(a)));
check("…the first is told why, with 'Use it here'", (await a.isVisible("#visit-bar")) && (await a.textContent("#visit-bar")).includes("in use on another device") && (await a.textContent("#visit-buy")).includes("Use it here"));
await a.mouse.down(); await a.mouse.up(); await wait(300);
check("…trying to build there says how to take it back (not 'buy')", (await toast(a)).includes("press U") && !(await a.isVisible("#view-unlock")));
await a.keyboard.press("KeyU"); await wait(1200);
check("U ('Use it here') moves it back: the first builds, the second visits", (await builder(a)) && !(await builder(b)));
check("…and the second now shows 'Use it here'", (await b.textContent("#visit-buy")).includes("Use it here"));
await b.context().close();
await wait(800);

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
check("…and tapping it there unlocks that device (it takes the key over)", await builder(c));
await wait(800);
check("…the one that had it goes back to visiting (one player at a time)", !(await builder(a)));

// ── On a phone ──────────────────────────────────────────────────────────
{
  const { devices } = await import("playwright-core");
  const ctx = await browser.newContext({ ...devices["iPhone SE landscape"] });
  await ctx.addInitScript((k) => { localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.key", k); }, key);
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => errors.push(`[phone] ${e.message.slice(0, 200)}`));
  await go(ph, moon);
  await ph.tap("#play-free"); await wait(1000);
  check("a phone with the key takes it over from the computer", (await builder(ph)) && !(await builder(c)));
  // (The computer: out of the settings, playing, then U.)
  if (await c.isVisible("#settings-back")) await c.click("#settings-back");
  await c.click("#play-free"); await wait(1000);
  await c.keyboard.press("KeyU"); await wait(1200);
  const bar = await ph.evaluate(() => { const r = document.getElementById("visit-bar").getBoundingClientRect(); return { shown: r.width > 0, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0, text: document.getElementById("visit-buy").textContent }; });
  check("…the computer takes it back with U; the phone shows 'Use it here', fitting the smallest screen", (await builder(c)) && !(await builder(ph)) && bar.shown && bar.fits && bar.text.includes("Use it here"), JSON.stringify(bar));
  await ph.tap("#visit-buy"); await wait(1200);
  check("…one tap on 'Use it here' and the phone builds again", (await builder(ph)) && !(await builder(c)));
  await ph.tap("#t-settings"); await wait(700);
  const own = await ph.evaluate(() => { const o = document.getElementById("overlay"); const r = document.getElementById("store-replace").getBoundingClientRect(); return { fits: o.scrollHeight <= o.clientHeight + 1, replace: r.width > 0 && r.right <= innerWidth, copy: !!document.getElementById("store-copy").offsetWidth }; });
  check("…its settings (owning the Full Game) fit the smallest phone, with Copy and Replace my key", own.fits && own.replace && own.copy, JSON.stringify(own));
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

// ── The meadow needs none of it ─────────────────────────────────────────
await go(a, new URL(`/?world=${world}`, base).toString());
check("the meadow: everyone builds, key or not", await builder(a));

check("no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
