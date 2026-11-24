import type { Environment } from "../src/game/environments";
import { DEFAULT_WORLD, worldAtPath, worldOf, WORLDS } from "../src/worlds";
import { cleanKey } from "../src/net/keys";
import { BUILD_ID } from "../src/net/protocol";
import { overview } from "./admin";
import type { Paid } from "./ledger";
import { cleanSeats, MOST_SEATS } from "./seats";
import { looksLikeEmail, maskEmail, sendKeyEmail, sendReplaceEmail, sendSeatsEmail } from "./mail";
import { stripe, stripeLive, stripeReady, verifyWebhook, type CheckoutSession } from "./stripe";
import type { Env } from "./world";

export { AdminApi } from "./admin";
export { Ledger } from "./ledger";
export { World } from "./world";

/**
 * SnapFort.io on Cloudflare: the game's files are served as static assets; /ws
 * joins a shared world (?env=<world id>; the first world when none is named), each its own
 * World Durable Object; /api/* sells and checks the Full Game (Stripe Checkout
 * and the Ledger of keys); /admin/* lets the owner reset or roll back a world
 * and look up keys, with the ADMIN_SECRET. The owner's admin panel (a project
 * of its own, admin.snapfort.io) calls AdminApi instead, through a service
 * binding: see worker/admin.ts.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return forward(world(env, request), request);
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(url, request, env, ctx);
      } catch (error) {
        console.error(error);
        return Response.json({ error: "Something went wrong. Try again in a moment." }, { status: 502 });
      }
    }
    if (url.pathname.startsWith("/admin/")) {
      if (!(await isAdmin(request, env))) return new Response("Forbidden", { status: 403 });
      // Who is in each world now, who is paid, and the totals (what the admin panel shows).
      if (url.pathname === "/admin/overview") return Response.json(await overview(env), { headers: { "Cache-Control": "no-store" } });
      if (url.pathname === "/admin/keys") {
        const email = url.searchParams.get("email") ?? "";
        return Response.json(await ledger(env).findByEmail(email));
      }
      // A key given away: POST /admin/grant?email=…, and &send=1 to email it to them as well.
      if (url.pathname === "/admin/grant") {
        if (request.method !== "POST") return new Response("Use POST", { status: 405 });
        const email = url.searchParams.get("email")?.trim().toLowerCase();
        if (!looksLikeEmail(email)) return Response.json({ error: "That does not look like an email address." }, { status: 400 });
        // (&seats=3: a key several can build with at once.)
        const seats = cleanSeats(url.searchParams.get("seats") ?? "1");
        if (!seats) return Response.json({ error: "seats must be a number from 1 to 10." }, { status: 400 });
        const key = await ledger(env).grant(email, stripeLive(env), seats);
        const emailed = url.searchParams.get("send") === "1" && (await sendKeyEmail(env.EMAIL, email, [{ key, seats }], "given", siteOf(url)));
        return Response.json({ key, email, seats, emailed });
      }
      // A key's seats set by hand (after refunding some, or as a gift): POST /admin/seats?key=…&seats=…
      if (url.pathname === "/admin/seats") {
        if (request.method !== "POST") return new Response("Use POST", { status: 405 });
        const key = cleanKey(url.searchParams.get("key"));
        const seats = cleanSeats(url.searchParams.get("seats") ?? "");
        if (!key || !seats) return Response.json({ error: "Give a key and seats from 1 to 10." }, { status: 400 });
        const record = await ledger(env).setSeats(key, seats);
        return record ? Response.json(record) : Response.json({ error: "No such key." }, { status: 404 });
      }
      return forward(world(env, request), request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const ledger = (env: Env) => env.LEDGER.get(env.LEDGER.idFromName("keys"));

/** Passes a request on to a world, telling it which environment it is. */
function forward(target: { stub: DurableObjectStub; name: string }, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("x-snapfort-env", worldOf(url.searchParams.get("env")).id);
  // Its own name, so the key ledger can reach it (one player at a time per key).
  headers.set("x-snapfort-world", target.name);
  return target.stub.fetch(new Request(request, { headers }));
}

/**
 * The world to join: the room of the world named by ?env= (see Environment.room),
 * except on a local dev server, where ?world=<name> opens a separate one (the
 * browser QA uses a fresh world per run).
 */
function world(env: Env, request: Request) {
  const url = new URL(request.url);
  const id = roomOf(url, worldOf(url.searchParams.get("env")));
  return { stub: env.WORLD.get(env.WORLD.idFromName(id)), name: id };
}

/** The name of a world's room for this request: its own, or on a dev server with ?world=<name>, that test world's. */
function roomOf(url: URL, place: Environment): string {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const name = url.searchParams.get("world");
  return local && name && /^[a-z0-9-]{1,40}$/.test(name) ? `test-${name}${place === DEFAULT_WORLD ? "" : `-${place.id}`}` : place.room;
}

/** Where links in emails go: the real site, or this dev server. */
const siteOf = (url: URL) => (url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : "https://snapfort.io");

/**
 * A checkout was paid: its key becomes paid, or its seats go onto the key. The
 * first time, an email goes out (after the response, so neither the page nor
 * Stripe waits for it): the key to the buyer, or a note about the new seats to
 * the key's own address. Null when the checkout is not one of ours.
 */
async function markPaid(env: Env, ctx: ExecutionContext, url: URL, session: CheckoutSession): Promise<Paid | null> {
  const buyer = session.customer_details?.email ?? null;
  const done = await ledger(env).paid(session.id, buyer, session.livemode, cleanKey(session.client_reference_id));
  if (!done) return null;
  if (done.kind === "new" && buyer) ctx.waitUntil(sendKeyEmail(env.EMAIL, buyer, [{ key: done.key, seats: done.seats }], "bought", siteOf(url)));
  if (done.kind === "added" && done.email) ctx.waitUntil(sendSeatsEmail(env.EMAIL, done.email, done.key, done.bought, done.seats, siteOf(url)));
  return done;
}

async function api(url: URL, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const live = stripeLive(env);
  switch (url.pathname) {
    // Whether the Full Game can be bought here now: always on a live site; in
    // Stripe's test mode only for whoever asks with ?testpay (so the public
    // never meets a test checkout).
    case "/api/store":
      return Response.json({ ready: stripeReady(env), live, build: BUILD_ID });

    // How many builders are in each world right now, for the world cards.
    case "/api/worlds": {
      const counts = await ledger(env).builders(WORLDS.map((w) => roomOf(url, w)));
      return Response.json({ worlds: WORLDS.map((w, i) => ({ id: w.id, builders: counts[i] })) }, { headers: { "Cache-Control": "no-store" } });
    }

    case "/api/buy": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = (await request.json().catch(() => ({}))) as { path?: string; testpay?: boolean; seats?: unknown; key?: unknown };
      if (!stripeReady(env)) return Response.json({ error: "Buying is not open yet." }, { status: 503 });
      if (!live && !body.testpay) return Response.json({ error: "Buying opens soon." }, { status: 403 });
      // How many seats: a new key that many can build with at once, or (with a key) that many more on it.
      const seats = cleanSeats(body.seats ?? 1);
      if (!seats) return Response.json({ error: `Choose from 1 to ${MOST_SEATS} players.` }, { status: 400 });
      const book = ledger(env);
      const adds = body.key !== undefined;
      const addTo = adds ? cleanKey(body.key) : null;
      if (adds && (!addTo || (await book.seatsOf(addTo, live)) === 0)) return Response.json({ error: "That key cannot have seats added here." }, { status: 400 });
      // Back to the world they bought from.
      const path = worldAtPath(body.path).path;
      const back = `${url.origin}${path}`;
      const key = addTo ?? (await book.create(live, seats));
      const what = adds
        ? `SnapFort Full Game · ${seats === 1 ? "1 more seat" : `${seats} more seats`} for your key ${key}`
        : `SnapFort Full Game · your key ${key}${seats > 1 ? ` · ${seats} seats` : ""}`;
      const session = await stripe<CheckoutSession>(env, "POST", "checkout/sessions", {
        mode: "payment",
        line_items: { 0: { price: env.STRIPE_PRICE_ID, quantity: seats } },
        client_reference_id: key,
        metadata: { key, seats, adds: adds ? 1 : 0 },
        payment_intent_data: { description: what, metadata: { key } },
        // (No custom text on Stripe's page: Managed Payments, where Stripe is the seller, does not allow it.)
        success_url: `${back}?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: back,
      });
      await book.order(session.id, key, seats, adds);
      return Response.json({ url: session.url });
    }

    // Back from checkout: if Stripe says the session is paid, the key is good (or has its new seats).
    case "/api/claim": {
      const id = url.searchParams.get("session") ?? "";
      if (!/^cs_[A-Za-z0-9_]+$/.test(id) || !stripeReady(env)) return Response.json({ error: "Unknown purchase." }, { status: 400 });
      const session = await stripe<CheckoutSession>(env, "GET", `checkout/sessions/${id}`);
      if (session.payment_status === "unpaid") return Response.json({ status: "unpaid" });
      const done = await markPaid(env, ctx, url, session);
      if (!done) return Response.json({ error: "Unknown purchase." }, { status: 400 });
      // (Seats added: the key was the device's already, and the email goes to the key's own address.)
      return withKeyCookie(Response.json({ status: "paid", key: done.key, seats: done.seats, bought: done.bought, added: done.adds, emailed: done.adds ? !!done.email : !!session.customer_details?.email }), done.key);
    }

    // A key typed in, saved on the page, from an email link, or (none given) this device's cookie:
    // is it good here? A good one is remembered on the device for a year (a cookie the page cannot
    // lose to Safari's 7-day clean-up of what sites store); a bad one is forgotten.
    case "/api/key": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      const fromCookie = body.key === undefined;
      const key = cleanKey(fromCookie ? cookieKey(request) : body.key);
      const seats = key ? await ledger(env).seatsOf(key, live) : 0;
      const valid = seats > 0;
      const response = Response.json({ key: valid ? key : null, valid, seats });
      if (valid) return withKeyCookie(response, key);
      // No longer good (replaced after a leak, or a test key on the live site): this device forgets it.
      return cookieKey(request) && (fromCookie || cleanKey(cookieKey(request)) === key) ? withKeyCookie(response, null) : response;
    }

    // "Remove from this device": the page forgets the key it saved; this forgets the cookie (which
    // the page cannot reach), so the key does not come back on the next visit. The key stays good.
    case "/api/forget": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      return withKeyCookie(Response.json({ ok: true }), null);
    }

    // "Replace my key" (a leaked key): a one-time link goes to the buyer's email; nothing changes
    // until it is used. Whoever knows the key can ask, but only the buyer's inbox can confirm.
    case "/api/replace": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      const key = cleanKey(body.key);
      const book = ledger(env);
      const link = key ? await book.replaceToken(key, live) : null;
      if (!link) return Response.json({ error: "That key cannot be replaced here." }, { status: 400 });
      if (await book.mayMail(`replace:${link.email}`, 2 * 60_000, 5)) ctx.waitUntil(sendReplaceEmail(env.EMAIL, link.email, `${siteOf(url)}/#replace=${link.token}`, siteOf(url)));
      return Response.json({ ok: true, to: maskEmail(link.email) });
    }

    // The link from that email: the old key is retired and the new one is this device's (and emailed).
    case "/api/replace/confirm": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const token = typeof body.token === "string" && /^[0-9a-f]{48}$/.test(body.token) ? body.token : null;
      const done = token ? await ledger(env).replace(token, live) : null;
      if (!done) return Response.json({ error: "That link has already been used or has expired." }, { status: 400 });
      ctx.waitUntil(sendKeyEmail(env.EMAIL, done.email, [{ key: done.key, seats: done.seats }], "replaced", siteOf(url)));
      return withKeyCookie(Response.json({ key: done.key, seats: done.seats }), done.key);
    }

    // "Lost your key?": the keys bought with this email are sent to it. The page never sees them,
    // and the answer is the same either way, so nobody can find out who bought or take a key.
    case "/api/lost": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = (await request.json().catch(() => ({}))) as { email?: string };
      const email = body.email?.trim().toLowerCase();
      if (!looksLikeEmail(email)) return Response.json({ error: "That does not look like an email address." }, { status: 400 });
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const where = local ? null : request.headers.get("cf-connecting-ip");
      const book = ledger(env);
      // At most one email to an address every 5 minutes (5 a day), and 20 requests a day from one
      // connection (on the real site; on a dev server every request comes from this computer).
      if ((!where || (await book.mayMail(`ip:${where}`, 0, 20))) && (await book.mayMail(email, 5 * 60_000, 5))) {
        const keys = await book.paidKeys(email, live);
        if (keys.length > 0) ctx.waitUntil(sendKeyEmail(env.EMAIL, email, keys, "asked", siteOf(url)));
      }
      return Response.json({ ok: true });
    }

    // Stripe telling us a checkout was paid (covers a buyer who closed the tab before coming back).
    case "/api/stripe": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const body = await request.text();
      const event = await verifyWebhook(body, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET ?? "");
      if (!event) return new Response("Bad signature", { status: 400 });
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object;
        if (session.payment_status !== "unpaid") await markPaid(env, ctx, url, session);
      }
      return Response.json({ received: true });
    }
  }
  return new Response("Not found", { status: 404 });
}

/** The key this device was unlocked with (a year-long cookie), if any. */
function cookieKey(request: Request): string | null {
  const match = /(?:^|;\s*)snapfort_key=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Remembers a key on this device for about a year (the most browsers allow), or forgets it. */
function withKeyCookie(response: Response, key: string | null): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", key ? `snapfort_key=${encodeURIComponent(key)}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax` : "snapfort_key=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
  return new Response(response.body, { status: response.status, headers });
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const secret = env.ADMIN_SECRET;
  const given = request.headers.get("x-admin-secret");
  if (!secret || !given) return false;
  // Compare digests in constant time, so the secret cannot be guessed one character at a time.
  const digest = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(secret), digest(given)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
