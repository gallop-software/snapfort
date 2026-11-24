import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { checkRange, maxRange, planFlight, positionAt, throwVelocity, type Vec } from "../../game/trebuchet";
import { world as MOON } from "./world";

/** The same world under an ordinary pull (the numbers the game was first tuned with), to compare against. */
const EARTHLY: Environment = { ...MOON, gravity: 26, stoneGravity: 9.81, flightTime: 1, range: 1, throwPower: 1, knockdownDrop: 2, rubbleGravity: 9.81 };

const treb: Piece = { id: "t", type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };

describe("the Moon", () => {
  it("throws stones that still pass exactly through the target, slower, along an arc of the same shape", () => {
    const from: Vec = [0, 7, 0], to: Vec = [40, 0, 90];
    const moon = planFlight(from, to, MOON), earthly = planFlight(from, to, EARTHLY);
    const at = positionAt(moon, moon.time);
    for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
    // Halfway along, both are at the same height: the same arc, flown slower.
    expect(positionAt(moon, moon.time / 2)[1]).toBeCloseTo(positionAt(earthly, earthly.time / 2)[1], 6);
  });

  it("keeps the nearest shots slow lobs too", () => {
    const moon = planFlight([0, 7, 0], [30, 0, 0], MOON), earthly = planFlight([0, 7, 0], [30, 0, 0], EARTHLY);
    expect(earthly.time).toBeCloseTo(Math.max(1.5, Math.sqrt(60 / 9.81)), 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
  });

  it("lets trebuchets reach 1.6 times as far", () => {
    expect(maxRange(treb, MOON)).toBeCloseTo(maxRange(treb, EARTHLY) * 1.6);
    const far: Vec = [2.5 + 400, 0, 2.5];
    expect(checkRange(treb, far, EARTHLY)).toBe("far");
    expect(checkRange(treb, far, MOON)).toBe("ok");
  });

  it("throws builders far and high, but not out of the world", () => {
    const v = throwVelocity([0, 0, 0], [1, 0.9, 0], MOON, 0)!;
    const fall = planFall(new BuildState(), [1, 0.9, 0], v, MOON);
    const earthlyFall = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], EARTHLY, 0)!, EARTHLY);
    expect(fall.land[0]).toBeGreaterThan(earthlyFall.land[0] * 1.5);
    expect(fall.time).toBeGreaterThan(earthlyFall.time);
    expect(Math.abs(fall.land[0])).toBeLessThan(200);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("makes falls slower: off a storey takes longer than under an ordinary pull", () => {
    const top: Vec = [2.5, LEVEL * 2 + 0.9, 2.5];
    expect(planFall(new BuildState(), top, [0, 0, 0], MOON).time).toBeCloseTo(planFall(new BuildState(), top, [0, 0, 0], EARTHLY).time * Math.sqrt(3), 1);
  });

  it("is a paid world at /moon, saved as it always was", () => {
    expect(MOON.paid).toBe(true);
    expect(MOON.path).toBe("/moon");
    expect(MOON.room).toBe("moon");
  });
});
