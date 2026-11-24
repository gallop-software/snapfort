/**
 * Buying the Full Game, in Stripe's test mode: a real checkout in a real
 * browser (test card 4242…), the key coming back and unlocking the Moon, the
 * key on another device, and the server's checks (keys, claims, webhooks).
 * Needs the Gallop dev server with STRIPE_SECRET_KEY (a test key) and
 * STRIPE_WEBHOOK_SECRET in .dev.vars
 * (both read from .dev.vars, the same test key the dev server uses). Run: npm run qa:pay
 */
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] ?? (process.env.QA_BASE ?? (process.env.QA_BASE ?? "http://localhost:5173")) + "/");
const world = `pay-${Date.now().toString(36)}`;
/** A fresh buyer address each run (one email per address every 5 minutes). */
const buyerEmail = `qa-buyer-${Date.now().toString(36)}@example.com`;
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, body) => fetch(new URL(path, base), body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const stripeGet = (path) => fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((r) => r.json());
const sign = (body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
/** Emails the local dev server "sent" (Cloudflare's simulator writes each one to a file), newest last. */
function sentEmails() {
  const root = ".wrangler/tmp/email";
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((d) => {
    const dir = join(root, d, "email-text");
    return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  }).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).map((f) => readFileSync(f, "utf8"));
}
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
const event = JSON.stringify({ id: "evt_qa", type: "checkout.session.completed", livemode: false, data: { object: { id: sessionId, client_reference_id: pendingKey, payment_status: "paid", livemode: false, customer_details: { email: buyerEmail } } } });
check("a webhook with a wrong signature is refused", (await webhook(event, sign(event).replace(/v1=(.)/, (_, c) => `v1=${c === "0" ? "1" : "0"}`))).status === 400);
check("…so is an old one (a replay)", (await webhook(event, sign(event, Math.floor(Date.now() / 1000) - 3600))).status === 400);
check("…and one with no signature", (await webhook(event, "")).status === 400);
check("a genuine 'paid' webhook makes the key valid (a buyer who closed the tab still gets it)", (await webhook(event, sign(event))).status === 200 && (await api("/api/key", { key: pendingKey })).valid === true);
const mailed = sentEmails().filter((m) => m.includes(pendingKey));
check("…and the buyer is emailed the key, once, branded SnapFort with how to use it elsewhere", mailed.length === 1 && mailed[0].includes("Thanks! The Full Game is yours.") && mailed[0].includes("Have a key?") && mailed[0].includes("/moon"), `${mailed.length} emails with the key`);
await webhook(event, sign(event));
check("Stripe sending the same webhook again does not email again", sentEmails().filter((m) => m.includes(pendingKey)).length === 1);
// Seats: several players on one key, bought together or added later.
{
  const paidEvent = (id, key, by) => JSON.stringify({ id: `evt_${id.slice(-8)}`, type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: key, payment_status: "paid", livemode: false, customer_details: { email: by } } } });
  check("the key bought for one player has 1 seat", (await api("/api/key", { key: pendingKey })).seats === 1);
  const three = await api("/api/buy", { path: "/moon", testpay: true, seats: 3 });
  const threeId = three.url?.match(/cs_test_[A-Za-z0-9]+/)?.[0];
  const threeSession = threeId ? await stripeGet(`checkout/sessions/${threeId}`) : {};
  const familyKey = threeSession.client_reference_id;
  check("buying for 3 players opens one Stripe checkout for 3 × $7 = $21, for one new key", threeSession.amount_total === 2100 && /^SNAP-/.test(familyKey ?? "") && familyKey !== pendingKey, `${threeSession.amount_total} ${familyKey}`);
  const familyBuyer = `family-${buyerEmail}`;
  await webhook(paidEvent(threeId, familyKey, familyBuyer), sign(paidEvent(threeId, familyKey, familyBuyer)));
  check("…paid, the key has 3 seats", (await api("/api/key", { key: familyKey })).seats === 3);
  const familyMail = sentEmails().filter((m) => m.includes(familyKey));
  check("…and its email says 3 can play with the one key", familyMail.length === 1 && familyMail[0].includes("3 players at a time"), `${familyMail.length} emails`);
  const more = await api("/api/buy", { path: "/moon", testpay: true, seats: 2, key: familyKey });
  const moreId = more.url?.match(/cs_test_[A-Za-z0-9]+/)?.[0];
  const moreSession = moreId ? await stripeGet(`checkout/sessions/${moreId}`) : {};
  check("adding 2 seats to that key opens a checkout for $14, for the same key (no new one)", moreSession.amount_total === 1400 && moreSession.client_reference_id === familyKey, `${moreSession.amount_total} ${moreSession.client_reference_id}`);
  check("…the seats are not there before paying", (await api("/api/key", { key: familyKey })).seats === 3 && (await api(`/api/claim?session=${moreId}`)).status === "unpaid");
  const addEvent = paidEvent(moreId, familyKey, "grandma@example.com");
  await webhook(addEvent, sign(addEvent));
  check("…paid, the key has 5 seats", (await api("/api/key", { key: familyKey })).seats === 5);
  await webhook(addEvent, sign(addEvent));
  await webhook(paidEvent(threeId, familyKey, familyBuyer), sign(paidEvent(threeId, familyKey, familyBuyer)));
  check("…Stripe saying so again (either purchase) adds nothing more", (await api("/api/key", { key: familyKey })).seats === 5);
  await wait(600);
  const seatMail = sentEmails().filter((m) => m.includes("Your key now has 5 seats") && m.includes(familyKey));
  check("…and one email says the key now has 5 seats", seatMail.length === 1, `${seatMail.length} emails`);
  check("seats cannot be added to a key that was never paid for, or is made up", (await api("/api/buy", { path: "/moon", testpay: true, seats: 1, key: "SNAP-2345-6789-ABCD" })).status === 400);
  check("a purchase is for 1 to 10 players", (await api("/api/buy", { path: "/moon", testpay: true, seats: 11 })).status === 400 && (await api("/api/buy", { path: "/moon", testpay: true, seats: 0 })).status === 400 && (await api("/api/buy", { path: "/moon", testpay: true, seats: "lots" })).status === 400);
}
// "Lost your key?"
check("'Lost your key?' turns down something that is not an email", (await api("/api/lost", { email: "nope" })).status === 400);
const before = sentEmails().length;
const lost = await api("/api/lost", { email: ` ${buyerEmail.toUpperCase()} ` });
await wait(800);
const resent = sentEmails().slice(before);
check("…for the email that bought it, the key is emailed again (any capitals or spaces)", lost.ok === true && resent.length === 1 && resent[0].includes(pendingKey) && resent[0].includes("You asked for"), `${resent.length} emails`);
const again = await api("/api/lost", { email: buyerEmail });
await wait(500);
check("…asking again at once answers the same, but sends nothing more (no inbox flooding)", again.ok === true && sentEmails().length === before + 1);
const stranger = await api("/api/lost", { email: `nobody-${Date.now()}@example.com` });
await wait(500);
check("…an email that bought nothing gets the same answer, and no email (nobody can find out who bought)", stranger.ok === true && sentEmails().length === before + 1);
check("keys can be typed loosely (lower case, spaces, no SNAP-)", (await api("/api/key", { key: ` ${pendingKey.slice(5).toLowerCase().replace(/-/g, " ")} ` })).valid === true);
check("finding keys by email is for the admin only", (await fetch(new URL(`/admin/keys?email=${buyerEmail}`, base))).status === 403);

// ── Visiting and buying in the browser ───────────────────────────────────
const plain = await open("/moon");
check("on the Moon without the Full Game, you visit: no building", (await builder(plain)) === false && (await plain.textContent("#play-free")) === "Visit the Moon");
check("…and while Stripe is in test mode the public sees 'Unlocks open soon', and cannot buy", await sf(plain, () => { const b = document.getElementById("offer-buy"); return b.disabled && b.textContent === "Unlocks open soon"; }));
await plain.context().close();

const page = await open("/moon?testpay");
check("with ?testpay, the Moon's menu has a big Unlock the Moon · $7 button", (await page.isVisible("#offer-buy")) && (await page.textContent("#offer-buy")) === "Unlock the Moon · $7" && !(await sf(page, () => document.getElementById("offer-buy").disabled)));
// Playing together: the unlock panel counts the players.
await page.click("#offer-more"); await wait(400);
check("'Playing together?' opens the unlock panel, with Players − 1 +", (await page.isVisible("#view-unlock")) && (await page.textContent("#seats-count")) === "1" && (await page.textContent("#unlock-buy")) === "Unlock · $7" && (await sf(page, () => document.getElementById("seats-less").disabled)));
await page.click("#seats-more"); await page.click("#seats-more");
check("…+ twice: 'Unlock for 3 players · $21'", (await page.textContent("#unlock-buy")) === "Unlock for 3 players · $21" && (await page.textContent("#seats-count")) === "3");
await page.screenshot({ path: "qa/shots/pay-players.png" });
await page.click("#unlock-buy");
await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
check("Unlock opens Stripe's checkout", true, new URL(page.url()).host);
const checkoutId = page.url().match(/cs_test_[A-Za-z0-9]+/)?.[0];
await page.waitForFunction(() => document.body.innerText.includes("$21.00"), null, { timeout: 30000 }).catch(() => {});
check("…Stripe's page asks for $21.00, for 3", await page.evaluate(() => document.body.innerText.includes("$21.00")), (await page.evaluate(() => document.body.innerText)).slice(0, 160).replace(/\n+/g, " | "));
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
  const said = await sf(page, () => ({ title: document.getElementById("thanks-title").textContent, seats: document.getElementById("thanks-seats").textContent, store: document.getElementById("store-seats").textContent }));
  check("…the thank-you says it is for 3 players, all on this one key; Settings shows 3 seats", said.title === "Thanks! The Full Game is yours, for 3 players." && said.seats.includes("same key") && said.store === "3 seats" && (await api("/api/key", { key: after.key })).seats === 3, JSON.stringify(said));
  // Stripe's webhook for the same purchase (it arrives as well as the page coming back): counted once.
  const late = JSON.stringify({ id: "evt_late", type: "checkout.session.completed", livemode: false, data: { object: { id: checkoutId, client_reference_id: after.key, payment_status: "paid", livemode: false, customer_details: { email: "qa-late@example.com" } } } });
  await webhook(late, sign(late));
  check("…Stripe's webhook for the same purchase changes nothing: still 3 seats", (await api("/api/key", { key: after.key })).seats === 3);
  check("…and building is open at once", await builder(page));
  check("…the key is in Settings with a Copy button", (await sf(page, () => !document.getElementById("store-owned").hidden)) && (await page.textContent("#store-key")) === after.key);
  await page.screenshot({ path: "qa/shots/pay-thanks.png" });
  boughtKey = after.key;
}
await page.context().close();
// The key for the rest: the one just bought, or one paid through the webhook.
const ownedKey = boughtKey ?? pendingKey;
const owner = await open("/moon", { key: ownedKey });
check("with a paid key saved, the Moon opens for building, and Settings shows the key", (await builder(owner)) && (await sf(owner, () => !document.getElementById("store-owned").hidden)) && (await owner.textContent("#store-key")) === ownedKey);
await owner.click("#play-free"); await wait(500);
const n0 = await sf(owner, () => window.snapfort.state.size);
await owner.mouse.down(); await owner.mouse.up(); await wait(800);
check("a buyer builds on the Moon, and the world keeps it", (await sf(owner, () => window.snapfort.state.size)) === n0 + 1 && (await sf(owner, () => window.snapfort.synced.inFlight)) === 0);
await owner.reload(); await owner.waitForSelector("body.ready"); await wait(1500);
check("after a reload it is still unlocked, and the menu no longer offers to buy", (await builder(owner)) && (await sf(owner, () => !document.getElementById("store-owned").hidden)) && !(await owner.isVisible("#offer-buy")));
await owner.context().close();

// Another device: type the key in.
const other = await open("/moon");
await other.click("#offer-key");
await other.fill("#store-key-input", "snap-0000-0000-0000");
await other.click("#store-enter button[type=submit]"); await wait(800);
check("another device: a wrong key is turned down", (await other.textContent("#store-message")).includes("not") && !(await builder(other)));
await other.fill("#store-key-input", ownedKey.toLowerCase());
await other.click("#store-enter button[type=submit]"); await wait(1500);
check("…the bought key unlocks it, with no reload", (await builder(other)) && (await sf(other, () => !document.getElementById("store-owned").hidden)), await other.textContent("#store-message"));
await other.context().close();

// "Lost your key?" in Settings.
const asker = await open("/moon");
await asker.click("#offer-key");
await asker.click("#store-lost-open");
await asker.fill("#store-lost-email", "someone@example.com");
await asker.click("#store-lost button[type=submit]"); await wait(800);
check("Settings: 'Lost your key?' takes an email and says the key is on its way, without showing it", (await asker.textContent("#store-message")).includes("on its way") && !(await builder(asker)));
await asker.context().close();

// The free meadow needs nothing.
const meadow = await open("/");
check("the meadow: everyone builds, no key needed", await builder(meadow));
await meadow.context().close();

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
