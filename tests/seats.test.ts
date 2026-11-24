import { describe, expect, it } from "vitest";
import { cleanSeats, MOST_SEATS, seating, type Seat } from "../worker/seats";

const seat = (player: string, since: number, tab: string | null = null, world = "moon"): Seat => ({ world, player, tab, since });
const who = (player: string, tab: string | null = null, world = "moon") => ({ world, player, tab });

describe("seats on a key", () => {
  it("a free seat is taken without anyone leaving", () => {
    expect(seating([], 1, who("a"), false)).toEqual({ leaves: [] });
    expect(seating([seat("a", 1), seat("b", 2)], 3, who("c"), false)).toEqual({ leaves: [] });
  });

  it("someone already seated stays seated, even when the key is full", () => {
    expect(seating([seat("a", 1), seat("b", 2)], 2, who("b"), false)).toEqual({ leaves: [] });
  });

  it("every seat in use: one more waits", () => {
    expect(seating([seat("a", 1)], 1, who("b"), false)).toBe("full");
    expect(seating([seat("a", 1), seat("b", 2), seat("c", 3)], 3, who("d"), false)).toBe("full");
  });

  it("the same player id in another world is another seat", () => {
    expect(seating([seat("p1", 1, null, "moon")], 1, who("p1", null, "mars"), false)).toBe("full");
  });

  it("taking a seat sends back whoever has played longest, and only them", () => {
    const seated = [seat("b", 20), seat("a", 10), seat("c", 30)];
    expect(seating(seated, 3, who("d"), true)).toEqual({ leaves: [seat("a", 10)] });
  });

  it("the same tab coming back (a reload, another world) keeps its seat: its old connection leaves, nobody else", () => {
    const seated = [seat("a", 10, "tab-one"), seat("b", 20, "tab-two")];
    expect(seating(seated, 2, who("c", "tab-one"), false)).toEqual({ leaves: [seat("a", 10, "tab-one")] });
    expect(seating(seated, 2, who("c", "tab-one", "mars"), false)).toEqual({ leaves: [seat("a", 10, "tab-one")] });
    // Another tab is another player.
    expect(seating(seated, 2, who("c", "tab-three"), false)).toBe("full");
  });

  it("a key that lost seats: taking one sends back enough to fit", () => {
    const seated = [seat("a", 10), seat("b", 20), seat("c", 30)];
    expect(seating(seated, 1, who("d"), true)).toEqual({ leaves: seated });
    expect(seating(seated, 2, who("d"), true)).toEqual({ leaves: [seat("a", 10), seat("b", 20)] });
  });

  it("a number of seats is a whole number from 1 to the most", () => {
    for (const good of [1, 3, MOST_SEATS, "4"]) expect(cleanSeats(good)).toBe(Number(good));
    for (const bad of [0, -1, 1.5, MOST_SEATS + 1, "0", "many", "", null, undefined, {}, "1e1"]) expect(cleanSeats(bad)).toBeNull();
  });
});
