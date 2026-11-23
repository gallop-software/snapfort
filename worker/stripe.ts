/**
 * The little of Stripe the Worker needs, with plain fetch (no Stripe library):
 * creating a Checkout session, reading one back, and checking that a webhook
 * really came from Stripe.
 */

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}

/** True when the Worker takes real money (a live key), false in Stripe's test mode. */
export const stripeLive = (env: StripeEnv): boolean => /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");

/** True when buying is set up at all. */
export const stripeReady = (env: StripeEnv): boolean => !!env.STRIPE_SECRET_KEY && !!env.STRIPE_PRICE_ID;

/** Flattens nested parameters into Stripe's form encoding: a[b][0][c]=d. */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, name));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

/** Calls the Stripe API; throws with Stripe's message when it refuses. */
export async function stripe<T>(env: StripeEnv, method: "GET" | "POST", path: string, params: Record<string, unknown> = {}): Promise<T> {
  const body = formEncode(params).join("&");
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body ? `?${body}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? body : undefined,
  });
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Stripe answered ${response.status}`);
  return data;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  livemode: boolean;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  client_reference_id: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string>;
}

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: CheckoutSession };
}

/** Webhooks older than this are refused (a replayed old message), seconds. */
const TOLERANCE = 300;

/**
 * Checks a webhook's Stripe-Signature header (t=…,v1=…): an HMAC-SHA256 of
 * "t.body" with the endpoint's signing secret. Returns the event, or null when
 * it is not genuine or too old.
 */
export async function verifyWebhook(body: string, header: string | null, secret: string, now = Date.now() / 1000): Promise<StripeEvent | null> {
  if (!header || !secret) return null;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0 || Math.abs(now - t) > TOLERANCE) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!signatures.some((s) => sameText(s, expected))) return null;
  try {
    return JSON.parse(body) as StripeEvent;
  } catch {
    return null;
  }
}

/** Compares two strings in time that does not depend on where they first differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signs a body the way Stripe does (for tests and local checks). */
export async function signWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
