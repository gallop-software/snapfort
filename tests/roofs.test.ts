import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { LEVEL } from "../src/game/constants";
import { ROOF_SHAPES } from "../src/game/environments";
import { planFall, standHeight } from "../src/game/fall";
import type { Piece } from "../src/game/pieces";
import { domeRings, roofHeight } from "../src/game/roofs";
import { PLAIN } from "./plain";

const roof: Piece = { id: "r", type: "roof", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };

describe("roof shapes", () => {
  it("all sit on the same square base and are one storey tall", () => {
    for (const shape of ROOF_SHAPES) {
      for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.3]]) expect(roofHeight(shape, u!, w!), shape).toBeCloseTo(0, 9);
      expect(roofHeight(shape, 0.5, 0.5), shape).toBeCloseTo(1, 9);
      // Never above a storey, never below the base, and rising toward the middle.
      for (let i = 0; i <= 20; i++) {
        const h = roofHeight(shape, i / 20, 0.5);
        expect(h >= 0 && h <= 1, shape).toBe(true);
        if (i < 10) expect(roofHeight(shape, (i + 1) / 20, 0.5) + 1e-9, shape).toBeGreaterThanOrEqual(h);
      }
    }
  });

  it("keeps the pyramid as it always was: straight sides to a point", () => {
    expect(roofHeight("pyramid", 0.25, 0.5)).toBeCloseTo(0.5, 9);
    expect(roofHeight("pyramid", 0.5, 0.1)).toBeCloseTo(0.2, 9);
    expect(standHeight(roof, 1.25, 2.5)).toBeCloseTo(LEVEL * 0.5, 9);
  });

  it("makes a dome fuller than a pyramid, with a flat top to stand on", () => {
    for (const u of [0.05, 0.15, 0.25, 0.35]) expect(roofHeight("dome", u, 0.5)).toBeGreaterThan(roofHeight("pyramid", u, 0.5));
    expect(roofHeight("dome", 0.45, 0.52)).toBeCloseTo(1, 9);
    // The surface passes through every ring the drawing uses.
    for (const ring of domeRings()) expect(roofHeight("dome", ring.inset, 0.5)).toBeCloseTo(ring.height, 9);
  });

  it("lands a falling builder on the shape the world has", () => {
    const state = new BuildState();
    state.apply({ kind: "place", piece: roof });
    const from: [number, number, number] = [1, 20, 2.5];
    const pyramid = planFall(state, from, [0, 0, 0], PLAIN);
    const dome = planFall(state, from, [0, 0, 0], { ...PLAIN, roof: "dome" });
    expect(pyramid.land[1]).toBeCloseTo(LEVEL * 0.4 + 0.9, 1);
    expect(dome.land[1]).toBeGreaterThan(pyramid.land[1] + 0.5);
  });
});
