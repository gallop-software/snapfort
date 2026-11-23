import { describe, expect, it } from "vitest";
import { keyEmail, looksLikeEmail, sendKeyEmail } from "../worker/mail";

describe("key emails", () => {
  it("after buying: the key, how to use it elsewhere, a link to the Moon, and support", () => {
    const { subject, html, text } = keyEmail(["SNAP-7K2M-Q9XD-4RTW"], "bought", "https://snapfort.io");
    expect(subject).toContain("SnapFort key");
    for (const part of [html, text]) {
      expect(part).toContain("SNAP-7K2M-Q9XD-4RTW");
      expect(part).toContain("https://snapfort.io/moon");
      expect(part).toContain("dev@webplant.media");
      expect(part).toContain("https://snapfort.io/terms");
      expect(part).toContain("Have a key?");
    }
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("when asked for again: every key bought with that email, and a note if it wasn't you", () => {
    const { html, text } = keyEmail(["SNAP-AAAA-BBBB-CCCC", "SNAP-DDDD-EEEE-FFFF"], "asked", "https://snapfort.io");
    expect(text).toContain("SNAP-AAAA-BBBB-CCCC, SNAP-DDDD-EEEE-FFFF");
    expect(html).toContain("Your keys");
    expect(text).toContain("If that wasn't you");
  });

  it("is sent from keys@snapfort.io with replies to support, and a failure does not throw", async () => {
    const sent: Record<string, unknown>[] = [];
    const ok = await sendKeyEmail({ send: async (m) => (sent.push(m), { messageId: "x" }) }, "kid@example.com", ["SNAP-7K2M-Q9XD-4RTW"], "bought", "https://snapfort.io");
    expect(ok).toBe(true);
    expect(sent[0]).toMatchObject({ to: "kid@example.com", from: { email: "keys@snapfort.io", name: "SnapFort" }, replyTo: { email: "dev@webplant.media" } });
    const failing = await sendKeyEmail({ send: async () => { throw Object.assign(new Error("no"), { code: "E_SENDER_DOMAIN_NOT_CONFIGURED" }); } }, "kid@example.com", ["SNAP-7K2M-Q9XD-4RTW"], "bought", "https://snapfort.io");
    expect(failing).toBe(false);
    expect(await sendKeyEmail(undefined, "kid@example.com", ["SNAP-7K2M-Q9XD-4RTW"], "bought", "https://snapfort.io")).toBe(false);
  });

  it("only takes things that look like email addresses", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    for (const bad of ["", "a@b", "a b@c.com", "@b.com", 42, null]) expect(looksLikeEmail(bad)).toBe(false);
  });
});
