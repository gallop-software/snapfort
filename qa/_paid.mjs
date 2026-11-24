/**
 * A Full Game key for QA, paid for through the same webhook Stripe uses (no
 * browser checkout). Needs the Gallop dev server with Stripe test keys in .dev.vars.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export async function paidKey(base = (process.env.QA_BASE ?? "http://localhost:5173"), path = "/", seats = 1) {
  const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const r = await fetch(`${base}/api/buy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, testpay: true, seats }) }).then((x) => x.json());
  const id = r.url.match(/cs_test_[A-Za-z0-9]+/)[0];
  const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${vars.STRIPE_SECRET_KEY}` } }).then((x) => x.json());
  const body = JSON.stringify({ id: `evt_qa_${Date.now()}`, type: "checkout.session.completed", livemode: false, data: { object: { id, client_reference_id: session.client_reference_id, payment_status: "paid", livemode: false, customer_details: { email: "qa@example.com" } } } });
  const t = Math.floor(Date.now() / 1000);
  await fetch(`${base}/api/stripe`, { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", vars.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}` }, body });
  return session.client_reference_id;
}
