import { describe, expect, it } from "vitest";
import { CHAT_MAX, cleanChat, FLOOD_COUNT, FLOOD_MS, flooding } from "../src/net/chat";

describe("chat filter", () => {
  it("keeps ordinary building talk as it is", () => {
    for (const text of [
      "need a ramp here",
      "Nice tower! 120 m already",
      "metal up to storey 10, brick to 30",
      "my class built a glass castle",
      "the assassin passed the grape cockpit",
      "Scunthorpe and Essex say hi",
      "à bientôt, ça va ?",
      "🏰 gg",
    ]) {
      expect(cleanChat(text)).toBe(text);
    }
  });

  it("masks swear words, also disguised", () => {
    for (const text of ["fuck", "FUCK this", "f.u.c.k", "fuuuuck", "sh1t", "$hit", "you ass", "what a d1ck", "motherfucker"]) {
      expect(cleanChat(text)).toContain("♥");
      expect(cleanChat(text).toLowerCase()).not.toMatch(/fu+ck|sh[i1]t|\$hit|\bass\b|d[i1]ck/);
    }
    expect(cleanChat("go away you ass")).toBe("go away you ♥♥♥");
    expect(cleanChat("ass ass, ass")).toBe("♥♥♥ ♥♥♥, ♥♥♥");
  });

  it("masks links, email addresses and phone numbers", () => {
    expect(cleanChat("join www.example.com now")).toBe("join ♥♥♥ now");
    expect(cleanChat("see https://x.y/z?q=1")).toBe("see ♥♥♥");
    expect(cleanChat("go to coolgame.io")).toBe("go to ♥♥♥");
    expect(cleanChat("mail me at kid@example.org")).toBe("mail me at ♥♥♥");
    expect(cleanChat("call 555 123 4567")).toBe("call ♥♥♥");
    expect(cleanChat("text +1 (555) 123-4567")).toBe("text ♥♥♥");
  });

  it("is plain text on one line, at most CHAT_MAX characters", () => {
    expect(cleanChat("  hello \n\t world  ")).toBe("hello world");
    expect(cleanChat("a\u202Eevil\u200Bb")).toBe("a evil b");
    expect([...cleanChat("x".repeat(200))].length).toBe(CHAT_MAX);
    expect([...cleanChat("🏰".repeat(200))].length).toBe(CHAT_MAX);
    expect(cleanChat("z\u0301\u0302\u0303\u0304\u0305a")).toBe("z\u0301\u0302a".normalize("NFC"));
    expect(cleanChat("Vi\u1EC7t Nam")).toBe("Vi\u1EC7t Nam");
    expect(cleanChat("   ")).toBe("");
    expect(cleanChat(42)).toBe("");
  });
});

describe("flood guard", () => {
  it("lets messages go back to back, and holds back only a flood", () => {
    const times: number[] = [];
    for (let i = 0; i < FLOOD_COUNT; i++) {
      expect(flooding(times, i * 10)).toBe(false);
      times.push(i * 10);
    }
    expect(flooding(times, 100)).toBe(true);
    // A few seconds later, talking again is fine.
    expect(flooding(times, FLOOD_MS + 10)).toBe(false);
  });
});
