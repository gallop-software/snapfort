import { describe, expect, it } from "vitest";
import { cleanEnoughName } from "../src/net/chat";
import { cleanDevice, cleanReason, cleanUid, REPORT_LABELS, REPORT_REASONS, uidOf } from "../src/net/moderation";

describe("public ids", () => {
  it("are 12 hex digits, the same for the same device, different for another", async () => {
    const a = await uidOf("abcdefghij0123456789xyz0");
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await uidOf("abcdefghij0123456789xyz0")).toBe(a);
    expect(await uidOf("abcdefghij0123456789xyz1")).not.toBe(a);
    expect(cleanUid(a)).toBe(a);
  });

  it("take only well-formed device ids, public ids and reasons", () => {
    expect(cleanDevice("abcdefghij0123456789")).toBe("abcdefghij0123456789");
    for (const bad of ["short", "UPPERCASEUPPERCASE12", "has spaces in it 1234", 42, null, "x".repeat(41)]) expect(cleanDevice(bad)).toBeNull();
    for (const bad of ["abc", "0123456789AB", "0123456789abc", "zzzzzzzzzzzz", undefined]) expect(cleanUid(bad)).toBeNull();
    for (const why of REPORT_REASONS) {
      expect(cleanReason(why)).toBe(why);
      expect(REPORT_LABELS[why]).toBeTruthy();
    }
    expect(cleanReason("spam")).toBeNull();
    expect(cleanReason(3)).toBeNull();
  });
});

describe("names", () => {
  it("keeps ordinary names", () => {
    for (const name of ["Brave Beaver", "Zippy Yak", "Grape Cockpit", "Scunthorpe", "Amélie", "Builder 42"]) expect(cleanEnoughName(name)).toBe(name);
  });

  it("refuses a name the chat filter would mask", () => {
    for (const name of ["Fuck Face", "sh1t lord", "ass", "www.spam.com", "Call 5551234567"]) expect(cleanEnoughName(name)).toBe("");
    expect(cleanEnoughName("")).toBe("");
  });
});
