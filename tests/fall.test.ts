import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { CELL, LEVEL, THICK } from "../src/game/constants";
import { fallPosition, planFall } from "../src/game/fall";
import type { Piece, PieceSpec } from "../src/game/pieces";

const piece = (s: PieceSpec, id: string): Piece => ({ ...s, id, material: "wood", edit: 0 });
const put = (state: BuildState, s: PieceSpec, id: string) => state.apply({ kind: "place", piece: piece(s, id) });

describe("falls", () => {
  it("drops straight down to the ground with nothing below", () => {
    const f = planFall(new BuildState(), [2.5, 40, 2.5], [0, 0, 0]);
    expect(f.land[1]).toBeCloseTo(0.9, 1);
    expect(f.land[0]).toBeCloseTo(2.5);
    // About sqrt(2h/g) seconds.
    expect(f.time).toBeCloseTo(Math.sqrt((2 * 39.1) / 26), 1);
  });

  it("lands on a floor below instead of the ground", () => {
    const state = new BuildState();
    for (let y = 0; y < 3; y++) put(state, { type: "wall", x: 0, y, z: 0, rot: 0 }, `w${y}`);
    put(state, { type: "floor", x: 0, y: 3, z: 0, rot: 0 }, "f");
    const f = planFall(state, [2.5, 30, 2.5], [0, 0, 0]);
    expect(f.land[1]).toBeCloseTo(3 * LEVEL + THICK / 2 + 0.9, 1);
  });

  it("flies an arc and comes down away from where it started", () => {
    const f = planFall(new BuildState(), [0, 0.9, 0], [20, 30, 0]);
    expect(f.land[0]).toBeGreaterThan(40);
    expect(Math.max(...f.path.map((p) => p[1]))).toBeGreaterThan(15);
    // The flight passes through its own points.
    expect(fallPosition(f, 0)[0]).toBeCloseTo(0);
    expect(fallPosition(f, f.time + 1)).toEqual(f.land);
  });

  it("stops sideways at a wall and slides down it", () => {
    const state = new BuildState();
    // A tall wall across the path at x = 10 m (cell line 2), facing along z.
    for (let y = 0; y < 8; y++) put(state, { type: "wall", x: 2, y, z: 0, rot: 1 }, `w${y}`);
    const f = planFall(state, [5, 0.9, 2.5], [25, 20, 0]);
    expect(f.land[0]).toBeLessThan(2 * CELL);
    expect(f.land[1]).toBeCloseTo(0.9, 1);
  });

  it("lands on a ramp's slope at its height there", () => {
    const state = new BuildState();
    put(state, { type: "ramp", x: 0, y: 0, z: 0, rot: 0 }, "r");
    const f = planFall(state, [2.5, 20, 2.5], [0, 0, 0]);
    // Halfway up the ramp.
    expect(f.land[1]).toBeCloseTo(THICK / 2 + LEVEL / 2 + 0.9, 1);
  });
});
