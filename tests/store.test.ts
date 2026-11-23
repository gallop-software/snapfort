import { describe, expect, it } from "vitest";
import { cleanKey, newKey } from "../src/net/keys";
import { formEncode, signWebhook, stripeLive, verifyWebhook } from "../worker/stripe";

describe("SnapFort keys", () => {
  it("are SNAP- and three groups of four, without look-alike letters, and all different", () => {
    const keys = new Set(Array.from({ length: 500 }, newKey));
    expect(keys.size).toBe(500);
    for (const k of keys) expect(k).toMatch(/^SNAP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){2}$/);
  });

  it("are read however they are typed, and nonsense is refused", () => {
    const k = "SNAP-7K2M-Q9XD-4RTW";
    for (const typed of [k, k.toLowerCase(), " snap 7k2m q9xd 4rtw ", "7K2MQ9XD4RTW", "snap-7k2m-q9xd-4rtw\n"]) expect(cleanKey(typed)).toBe(k);
    for (const bad of ["", "SNAP-7K2M-Q9XD", "SNAP-7K2M-Q9XD-4RTW-AAAA", "SNAP-0000-1111-OOOO", 42, null]) expect(cleanKey(bad)).toBeNull();
  });
});

describe("Stripe", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_1" } } });

  it("takes a genuine webhook", async () => {
    const event = await verifyWebhook(body, await signWebhook(body, secret), secret);
    expect(event?.type).toBe("checkout.session.completed");
  });

  it("refuses a webhook that was changed, signed with another secret, too old, or unsigned", async () => {
    const header = await signWebhook(body, secret);
    expect(await verifyWebhook(body.replace("cs_test_1", "cs_test_2"), header, secret)).toBeNull();
    expect(await verifyWebhook(body, await signWebhook(body, "whsec_other"), secret)).toBeNull();
    expect(await verifyWebhook(body, await signWebhook(body, secret, Math.floor(Date.now() / 1000) - 3600), secret)).toBeNull();
    expect(await verifyWebhook(body, null, secret)).toBeNull();
    expect(await verifyWebhook(body, header, "")).toBeNull();
  });

  it("knows live keys from test keys", () => {
    expect(stripeLive({ STRIPE_SECRET_KEY: "sk_live_abc" })).toBe(true);
    expect(stripeLive({ STRIPE_SECRET_KEY: "rk_live_abc" })).toBe(true);
    expect(stripeLive({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBe(false);
    expect(stripeLive({})).toBe(false);
  });

  it("encodes nested parameters the way Stripe reads them", () => {
    expect(formEncode({ mode: "payment", line_items: { 0: { price: "price_1", quantity: 1 } }, metadata: { key: "SNAP-A B" } }).join("&")).toBe(
      "mode=payment&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bkey%5D=SNAP-A%20B",
    );
  });
});
