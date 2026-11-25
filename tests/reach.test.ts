import { describe, expect, it } from "vitest";
import { gapTo, outOfReach } from "../src/game/reach";

describe("saying why a part is out of reach", () => {
  const arm = [0, 78, 0, 2, 81, 23];

  it("measures up to it and away on the level, to the nearest box", () => {
    expect(gapTo([arm], [1, 1, -9])).toEqual({ up: 77, flat: 9 });
    expect(gapTo([arm], [1, 90, 10])).toEqual({ up: -9, flat: 0 });
    expect(gapTo([[100, 0, 100, 101, 1, 101], arm], [1, 79, 30])).toEqual({ up: 0, flat: 7 });
  });

  it("says how high and how far, and what to do", () => {
    expect(outOfReach([arm], [1, 1, -9], 12)).toBe("77 m above you and 9 m away: build up beside it, to within 12 m");
    expect(outOfReach([arm], [1, 1, 10], 12)).toBe("77 m above you: build up to it, to within 12 m");
    expect(outOfReach([arm], [1, 79, 53], 12)).toBe("30 m away: get to within 12 m");
    expect(outOfReach([arm], [1, 120, 10], 12)).toBe("39 m below you: get down to within 12 m");
  });
});
