import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { CELL, LEVEL, THICK } from "../src/game/constants";
import { flightFrom, planFall, wayCrossed } from "../src/game/fall";
import type { Piece, PieceSpec } from "../src/game/pieces";
import { Solids, type Vec } from "../src/game/solids";
import { findImpact, planFlight } from "../src/game/trebuchet";
import { PLAIN } from "./plain";

const piece = (s: PieceSpec, id: string, edit = 0): Piece => ({ ...s, id, material: "wood", edit });
const put = (state: BuildState, s: PieceSpec, id: string, edit = 0) => expect(state.apply({ kind: "place", piece: piece(s, id, edit) })).not.toBeNull();
/** A door: the middle column of a wall's 3 x 3 tiles, its bottom two rows (tiles 1 and 4). */
const DOOR = (1 << 1) | (1 << 4);
/** A window: the middle tile (4). */
const WINDOW = 1 << 4;
const BUILDER = { r: 0.4, half: 0.5 };

describe("solids are the shapes as drawn", () => {
  it("a body walks through a door cut in a wall, and is stopped by the wall beside it", () => {
    const state = new BuildState();
    // A wall along x at z = 0, cell x 0: a door in its middle third (x 1.67..3.33 m).
    put(state, { type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "w", DOOR);
    const solids = new Solids(state, PLAIN);
    expect(solids.sweep([2.5, 0.95, -3], [2.5, 0.95, 3], BUILDER.r, BUILDER.half)).toBeNull();
    const beside = solids.sweep([0.6, 0.95, -3], [0.6, 0.95, 3], BUILDER.r, BUILDER.half);
    expect(beside).not.toBeNull();
    // Stopped short of the wall's face, not inside it.
    expect(beside!.at[2]).toBeLessThan(-THICK / 2 - BUILDER.r + 0.1);
  });

  it("a body coming down onto a ramp stops on its slope, not on top of a box round it", () => {
    const state = new BuildState();
    put(state, { type: "ramp", x: 0, y: 0, z: 0, rot: 0 }, "r");
    const solids = new Solids(state, PLAIN);
    // A quarter of the way up the ramp (z = 1.25 m), the slope is a quarter of a storey up.
    const hit = solids.sweep([2.5, 6, 1.25], [2.5, -1, 1.25], 0.2);
    expect(hit).not.toBeNull();
    expect(hit!.at[1] - 0.2).toBeLessThan(THICK / 2 + LEVEL / 4 + 0.15);
    expect(hit!.at[1] - 0.2).toBeGreaterThan(THICK / 2 + LEVEL / 4 - 0.2);
    expect(solids.surfaceUnder(2.5, 1.25, 5)).toBeCloseTo(THICK / 2 + LEVEL / 4, 5);
    // Under the high end there is room to stand (it is a slab, not a block).
    expect(solids.touch([2.5, 0.95, 4.5], BUILDER.r, BUILDER.half)).toBeNull();
  });

  it("a floor with a tile cut out has a hole to fall through", () => {
    const state = new BuildState();
    for (let y = 0; y < 2; y++) put(state, { type: "wall", x: 0, y, z: 0, rot: 0 }, `w${y}`);
    // Tile 0 is the floor's low-x, low-z quarter.
    put(state, { type: "floor", x: 0, y: 2, z: 0, rot: 0 }, "f", 1);
    const solids = new Solids(state, PLAIN);
    expect(solids.surfaceUnder(1.2, 1.2, 20)).toBe(0);
    expect(solids.surfaceUnder(3.8, 3.8, 20)).toBeCloseTo(2 * LEVEL + THICK / 2, 5);
    const fall = planFall(state, [1.2, 20, 1.2], [0, 0, 0], PLAIN);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("a stone fired at a roof bursts on its slope; one fired through a window goes on through", () => {
    const state = new BuildState();
    put(state, { type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    put(state, { type: "roof", x: 0, y: 0, z: 12, rot: 0 }, "roof");
    const launch: Vec = [2.5, 6, 2.5];
    // Aimed at the roof's slope a quarter of the way in from its edge, half way up it.
    const roof = findImpact(state, planFlight(launch, [2.5, LEVEL * 0.5, 12 * CELL + 1.25], PLAIN), "t", PLAIN);
    expect(roof.pieceId).toBe("roof");
    expect(roof.point[1]).toBeLessThan(LEVEL * 0.5 + PLAIN.siege.stoneRadius + 0.6);
    // A wall with a window in its middle, and the stone aimed straight through it at a spot beyond.
    const glass = new BuildState();
    put(glass, { type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    put(glass, { type: "wall", x: 0, y: 0, z: 14, rot: 0 }, "w", WINDOW);
    const env = { ...PLAIN, siege: { ...PLAIN.siege, shotSeconds: 0.3 } };
    const through = findImpact(glass, planFlight([2.5, LEVEL / 2, 2.5], [2.5, LEVEL / 2, 20 * CELL], env), "t", env);
    expect(through.pieceId).toBeUndefined();
    const solid = new BuildState();
    put(solid, { type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    put(solid, { type: "wall", x: 0, y: 0, z: 14, rot: 0 }, "w");
    expect(findImpact(solid, planFlight([2.5, LEVEL / 2, 2.5], [2.5, LEVEL / 2, 20 * CELL], env), "t", env).pieceId).toBe("w");
  });

  it("a builder thrown past the end of a wall never cuts into it on the way", () => {
    const state = new BuildState();
    for (let y = 0; y < 3; y++) put(state, { type: "wall", x: 1, y, z: 1, rot: 1 }, `w${y}`);
    const solids = new Solids(state, PLAIN);
    for (const dz of [0.2, 0.5, 1, 1.5]) {
      // Thrown along x, just past the wall's end at z = 10 m.
      const f = planFall(state, [0, 0.95, 2 * CELL + dz], [18, 14, 0], PLAIN);
      for (const p of f.path) expect(solids.touch(p, 0.4, 0.5, { stepUp: 0.3 })?.depth ?? 0).toBeLessThan(0.06);
    }
  });

  it("a wall built across a flight after it began: the rest is planned again, and stops at the wall", () => {
    const state = new BuildState();
    const f = planFall(state, [0, 0.95, 2.5], [14, 12, 0], PLAIN);
    // (It would come down 13 m on, past where the wall will be, at 10 m.)
    expect(f.land[0]).toBeGreaterThan(12);
    put(state, { type: "wall", x: 2, y: 0, z: 0, rot: 1 }, "late");
    // Half a second in, the wall goes up across the rest of the way.
    expect(wayCrossed(f, 0.5, [state.get("late")!], PLAIN)).toBe(true);
    const { at, v } = flightFrom(f, 0.5);
    const again = planFall(state, at, v, PLAIN);
    expect(again.land[0]).toBeLessThan(2 * CELL);
    // A wall nowhere near the way changes nothing.
    put(state, { type: "wall", x: -6, y: 0, z: 6, rot: 1 }, "far");
    expect(wayCrossed(f, 0.5, [state.get("far")!], PLAIN)).toBe(false);
  });

  it("finds the nearest spot clear of everything to put a body down", () => {
    const state = new BuildState();
    // A closed box of walls round cell (0, 0): no way in.
    put(state, { type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "a");
    put(state, { type: "wall", x: 0, y: 0, z: 1, rot: 0 }, "b");
    put(state, { type: "wall", x: 0, y: 0, z: 0, rot: 1 }, "c");
    put(state, { type: "wall", x: 1, y: 0, z: 0, rot: 1 }, "d");
    const solids = new Solids(state, PLAIN);
    // Asked for a spot right on a wall: one beside it, clear, on the ground.
    const c = solids.nearestClear(2.5, 0, 0, BUILDER.r, BUILDER.half)!;
    expect(c).not.toBeNull();
    expect(solids.touch(c, BUILDER.r, BUILDER.half)).toBeNull();
    expect(c[1]).toBeCloseTo(0.92, 1);
    expect(Math.hypot(c[0] - 2.5, c[2])).toBeLessThan(1.6);
  });

  it("a world's own solid things are solid too", () => {
    const solids = new Solids(new BuildState(), PLAIN, () => [[10, 0, 10, 14, 3, 14]]);
    expect(solids.sweep([5, 0.95, 12], [20, 0.95, 12], BUILDER.r, BUILDER.half)).not.toBeNull();
    expect(solids.surfaceUnder(12, 12, 10)).toBe(3);
  });
});
