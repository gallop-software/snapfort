/**
 * Buying the Full Game, in Stripe's test mode: a real checkout in a real
 * browser (test card 4242…), the key coming back and unlocking the Moon, the
 * key on another device, and the server's checks (keys, claims, webhooks).
 * Needs the Gallop dev server with STRIPE_SECRET_KEY (a test key) and
 * STRIPE_WEBHOOK_SECRET in .dev.vars, and STRIPE_API_KEY (the same test key)
 * in the environment. Run: npm run qa:pay
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
const world = `pay-${Date.now().toString(36)}`;
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, body) => fetch(new URL(path, base), body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const stripeGet = (path) => fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_API_KEY}` } }).then((r) => r.json());
const sign = (body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
const webhook = (body, signature) => fetch(new URL("/api/stripe", base), { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body });

async function open(path, { key, viewport = { width: 1100, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport });
  if (key) await context.addInitScript((k) => localStorage.setItem("snapfort.key", k), key);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const url = new URL(path, base);
  url.searchParams.set("world", world);
  await page.goto(url.toString());
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await wait(600);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const builder = (page) => sf(page, () => window.snapfort.builder);

// ── The server's checks ─────────────────────────────────────────────────
check("the store says buying is set up, in test mode", (await api("/api/store")).ready === true && (await api("/api/store")).live === false);
check("in test mode, buying without ?testpay is refused (the public never meets a test checkout)", (await api("/api/buy", { path: "/moon" })).status === 403);
check("a made-up key is not valid", (await api("/api/key", { key: "SNAP-2345-6789-ABCD" })).valid === false);
check("…nor is rubbish", (await api("/api/key", { key: "hello" })).valid === false);
check("claiming a made-up session is refused", (await api("/api/claim?session=nope")).status === 400);
// A purchase started but not paid: its key is not valid, until Stripe's webhook says it was paid.
const started = await api("/api/buy", { path: "/moon", testpay: true });
const sessionId = started.url?.match(/cs_test_[A-Za-z0-9]+/)?.[0];
const session = sessionId ? await stripeGet(`checkout/sessions/${sessionId}`) : {};
const pendingKey = session.client_reference_id;
check("starting to buy opens a Stripe checkout for a new key", !!sessionId && /^SNAP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(pendingKey ?? ""), `${sessionId?.slice(0, 16)}… ${pendingKey}`);
check("…the key is not valid before paying", (await api("/api/key", { key: pendingKey })).valid === false);
check("…and claiming the unpaid session says so", (await api(`/api/claim?session=${sessionId}`)).status === "unpaid");
const event = JSON.stringify({ id: "evt_qa", type: "checkout.session.completed", livemode: false, data: { object: { id: sessionId, client_reference_id: pendingKey, payment_status: "paid", livemode: false, customer_details: { email: "qa-webhook@example.com" } } } });
check("a webhook with a wrong signature is refused", (await webhook(event, sign(event).replace(/v1=(.)/, (_, c) => `v1=${c === "0" ? "1" : "0"}`))).status === 400);
check("…so is an old one (a replay)", (await webhook(event, sign(event, Math.floor(Date.now() / 1000) - 3600))).status === 400);
check("…and one with no signature", (await webhook(event, "")).status === 400);
check("a genuine 'paid' webhook makes the key valid (a buyer who closed the tab still gets it)", (await webhook(event, sign(event))).status === 200 && (await api("/api/key", { key: pendingKey })).valid === true);
check("keys can be typed loosely (lower case, spaces, no SNAP-)", (await api("/api/key", { key: ` ${pendingKey.slice(5).toLowerCase().replace(/-/g, " ")} ` })).valid === true);
check("finding keys by email is for the admin only", (await fetch(new URL("/admin/keys?email=qa-webhook@example.com", base))).status === 403);

// ── Visiting and buying in the browser ───────────────────────────────────
const plain = await open("/moon");
check("on the Moon without the Full Game, you visit: no building", (await builder(plain)) === false && (await plain.textContent("#play-free")) === "Visit the Moon");
check("…and while Stripe is in test mode the public sees 'Opens soon', no buy button", (await plain.isVisible("#store-soon")) && !(await plain.isVisible("#store-buy-button")));
await plain.context().close();

const page = await open("/moon?testpay");
check("with ?testpay the Unlock button shows", await page.isVisible("#store-buy-button"));
await page.click("#store-buy-button");
await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
check("Unlock opens Stripe's checkout", true, new URL(page.url()).host);
const frameWith = async (sel) => { for (let i = 0; i < 80; i++) { for (const f of page.frames()) if (await f.$(sel).catch(() => null)) return f; await wait(250); } throw new Error(`no ${sel} on the checkout page`); };
const email = await frameWith("#linkAuthentication-emailInput");
// A fresh address each run: one Stripe has seen with Link (its saved-card service) asks for a Link sign-in.
await email.fill("#linkAuthentication-emailInput", `qa-buyer-${Date.now().toString(36)}@example.com`);
for (const f of page.frames()) {
  const card = f.getByText("Card", { exact: true });
  if (await card.count().catch(() => 0)) { await card.first().click(); break; }
}
const form = await frameWith("#payment-numberInput");
await form.fill("#payment-numberInput", "4242 4242 4242 4242");
await form.fill("#payment-expiryInput", "12 / 34");
await form.fill("#payment-cvcInput", "123");
await form.fill("#payment-nameInput", "QA Buyer");
const zip = (await form.$("#payment-postalCodeInput")) ? "#payment-postalCodeInput" : "#payment-nameInput";
if (zip === "#payment-postalCodeInput") await form.fill(zip, "10001");
// Not saving the card with Link (it would ask for a phone number). Stripe ticks it a moment
// after the card is filled, so look again until it stays off.
for (let i = 0; i < 6; i++) {
  await wait(400);
  if (await form.locator("#payment-linkMobilePhoneInput").isVisible().catch(() => false)) await form.getByText("Save my information for faster checkout").click();
}
await form.press(zip, "Enter");
let boughtKey = null;
const back = await page.waitForURL((u) => u.host === base.host, { timeout: 30000 }).then(() => true, () => false);
const captcha = !back && page.frames().some((f) => /newassets\.hcaptcha\.com/.test(f.url()));
if (!back) await page.screenshot({ path: "qa/shots/pay-stuck.png", fullPage: true });
if (captcha) {
  // Stripe's bot protection challenges automated checkouts after many runs. Not a fault of the
  // game, and not something to get around: this step is skipped, and the rest uses a key paid
  // through the webhook instead.
  console.log("SKIP  paying through Stripe's checkout page — Stripe asked for a bot check (hCaptcha) this run");
} else {
  check("paying on Stripe's page comes back to the site", back, back ? "" : "stuck: see qa/shots/pay-stuck.png");
}
if (back) {
  await page.waitForSelector("body.ready", { timeout: 30000 });
  await wait(2500);
  const after = await sf(page, () => ({ thanks: !document.getElementById("thanks").hidden, key: document.getElementById("thanks-key").textContent, saved: localStorage.getItem("snapfort.key"), url: location.href }));
  check("paying brings you back to the Moon with a thank-you and your key", after.thanks && /^SNAP-/.test(after.key) && after.saved === after.key && !after.url.includes("paid="), JSON.stringify(after));
  check("…and building is open at once", await builder(page));
  check("…the key is in Settings with a Copy button", (await page.isVisible("#store-owned")) && (await page.textContent("#store-key")) === after.key);
  await page.screenshot({ path: "qa/shots/pay-thanks.png" });
  boughtKey = after.key;
}
await page.context().close();
// The key for the rest: the one just bought, or one paid through the webhook.
const ownedKey = boughtKey ?? pendingKey;
const owner = await open("/moon", { key: ownedKey });
check("with a paid key saved, the Moon opens for building, and Settings shows the key", (await builder(owner)) && (await owner.isVisible("#store-owned")) && (await owner.textContent("#store-key")) === ownedKey);
await owner.click("#play-free"); await wait(500);
const n0 = await sf(owner, () => window.snapfort.state.size);
await owner.mouse.down(); await owner.mouse.up(); await wait(800);
check("a buyer builds on the Moon, and the world keeps it", (await sf(owner, () => window.snapfort.state.size)) === n0 + 1 && (await sf(owner, () => window.snapfort.synced.inFlight)) === 0);
await owner.reload(); await owner.waitForSelector("body.ready"); await wait(1500);
check("after a reload it is still unlocked", (await builder(owner)) && (await owner.isVisible("#store-owned")));
await owner.context().close();

// Another device: type the key in.
const other = await open("/moon");
await other.click("#store-have-key");
await other.fill("#store-key-input", "snap-0000-0000-0000");
await other.click("#store-enter button[type=submit]"); await wait(800);
check("another device: a wrong key is turned down", (await other.textContent("#store-message")).includes("not") && !(await builder(other)));
await other.fill("#store-key-input", ownedKey.toLowerCase());
await other.click("#store-enter button[type=submit]"); await wait(1500);
check("…the bought key unlocks it, with no reload", (await builder(other)) && (await other.isVisible("#store-owned")), await other.textContent("#store-message"));
await other.context().close();

// The free meadow needs nothing.
const meadow = await open("/");
check("the meadow: everyone builds, no key needed", await builder(meadow));
await meadow.context().close();

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
