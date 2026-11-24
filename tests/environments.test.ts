import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { LEVEL } from "../src/game/constants";
import { environmentOf, MEADOW, MOON } from "../src/game/environments";
import { planFall } from "../src/game/fall";
import type { Piece } from "../src/game/pieces";
import { checkRange, maxRange, planFlight, positionAt, throwVelocity, type Vec } from "../src/game/trebuchet";

const treb: Piece = { id: "t", type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };

describe("the Moon", () => {
  it("throws stones that still pass exactly through the target, slower, along an arc of the same shape", () => {
    const from: Vec = [0, 7, 0], to: Vec = [40, 0, 90];
    const moon = planFlight(from, to, MOON), meadow = planFlight(from, to);
    const at = positionAt(moon, moon.time);
    for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
    expect(moon.time).toBeCloseTo(meadow.time * Math.sqrt(3), 6);
    // Halfway along, both are at the same height: the same arc, flown slower.
    expect(positionAt(moon, moon.time / 2)[1]).toBeCloseTo(positionAt(meadow, meadow.time / 2)[1], 6);
  });

  it("lets trebuchets reach 1.6 times as far", () => {
    expect(maxRange(treb, MOON)).toBeCloseTo(maxRange(treb) * 1.6);
    const far: Vec = [2.5 + 400, 0, 2.5];
    expect(checkRange(treb, far)).toBe("far");
    expect(checkRange(treb, far, MOON)).toBe("ok");
  });

  it("throws builders far and high, but not out of the world", () => {
    const v = throwVelocity([0, 0, 0], [1, 0.9, 0], 0, MOON)!;
    const fall = planFall(new BuildState(), [1, 0.9, 0], v, MOON);
    const meadowFall = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], 0)!);
    expect(fall.land[0]).toBeGreaterThan(meadowFall.land[0] * 1.5);
    expect(fall.time).toBeGreaterThan(meadowFall.time);
    expect(Math.abs(fall.land[0])).toBeLessThan(200);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("makes falls slower: off a storey takes longer than in the meadow", () => {
    const top: Vec = [2.5, LEVEL * 2 + 0.9, 2.5];
    expect(planFall(new BuildState(), top, [0, 0, 0], MOON).time).toBeCloseTo(planFall(new BuildState(), top, [0, 0, 0]).time * Math.sqrt(3), 1);
  });

  it("is a paid world; anything unknown is the free meadow", () => {
    expect(MOON.paid).toBe(true);
    expect(MEADOW.paid).toBe(false);
    expect(environmentOf("moon")).toBe(MOON);
    expect(environmentOf("mars")).toBe(MEADOW);
    expect(environmentOf(undefined)).toBe(MEADOW);
  });
});
