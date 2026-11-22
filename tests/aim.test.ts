import { describe, expect, it } from "vitest";
import { aimTarget, type AimRay } from "../src/game/aim";
import { LEVEL } from "../src/game/constants";
import type { Piece, PieceSpec } from "../src/game/pieces";
import type { Viewer } from "../src/game/targeting";

const piece = (s: PieceSpec, id = "p", edit = 0): Piece => ({ ...s, id, material: "wood", edit });
const viewer: Viewer = { x: 2.5, z: -5, feetY: 0, yaw: 0, pitch: 0, slope: 0 };

/** A crosshair line from (ox, oy, oz) toward the point (tx, ty, tz). */
function ray(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): AimRay {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  return { ox, oy, oz, dx: dx / len, dy: dy / len, dz: dz / len };
}
const distTo = (r: AimRay, tx: number, ty: number, tz: number) => Math.hypot(tx - r.ox, ty - r.oy, tz - r.oz);

describe("crosshair aiming: walls", () => {
  it("targets the empty pane beside an existing wall, not the wall (the reported case)", () => {
    // A wall stands on the line z = 5 from x = 0 to 5. The crosshair is just past its right end.
    const r = ray(3.6, 1.7, 1, 6.5, 1.9, 5);
    expect(aimTarget("wall", r, null, viewer).spec).toEqual({ type: "wall", x: 1, y: 0, z: 1, rot: 0 });
  });

  it("targets an existing wall when the crosshair is on it", () => {
    const wall = piece({ type: "wall", x: 0, y: 0, z: 1, rot: 0 });
    const r = ray(3.6, 1.7, 1, 4.6, 1.9, 5);
    expect(aimTarget("wall", r, { dist: distTo(r, 4.6, 1.9, 4.85), piece: wall }, viewer)).toEqual({
      spec: { type: "wall", x: 0, y: 0, z: 1, rot: 0 },
      source: "crosshair",
    });
  });

  it("still finds a wall through the door cut in it", () => {
    // No physics hit through the doorway, but the line crosses that wall's pane.
    const r = ray(2.5, 1.2, 1, 2.5, 1.0, 5);
    expect(aimTarget("wall", r, null, viewer).spec).toEqual({ type: "wall", x: 0, y: 0, z: 1, rot: 0 });
  });

  it("uses panes facing the builder: looking mostly toward +x, the lines across x", () => {
    const r = ray(2.5, 1.7, 2.5, 7.5, 1.7, 3.5);
    expect(aimTarget("wall", r, null, viewer).spec).toEqual({ type: "wall", x: 1, y: 0, z: 0, rot: 1 });
  });

  it("aims at the storey the crosshair is at", () => {
    const r = ray(2.5, 1.7, 0, 2.5, LEVEL + 1, 5);
    expect(aimTarget("wall", r, null, viewer).spec).toMatchObject({ y: 1, z: 1 });
  });

  it("cannot target a pane hidden behind something solid", () => {
    // A floor slab is in the way 3 m along; the wall line is 5 m along.
    const floor = piece({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }, "f");
    const r = ray(2.5, 1.7, 0, 2.5, 1.7, 10);
    const res = aimTarget("wall", r, { dist: 3, piece: floor }, viewer);
    expect(res.source).toBe("front");
  });
});

describe("crosshair aiming: floors", () => {
  it("targets the ground cell under the crosshair", () => {
    const r = ray(3.6, 1.7, 1, 7, 0, 8);
    expect(aimTarget("floor", r, { dist: distTo(r, 7, 0, 8) }, viewer).spec).toEqual({ type: "floor", x: 1, y: 0, z: 1, rot: 0 });
  });

  it("targets the empty floor pane past the edge of a platform you stand on", () => {
    // Standing on a raised floor in cell (0, 0); the crosshair is past its edge, over the empty cell (0, 1).
    const r = ray(3.6, LEVEL + 1.9, 3, 3, 0, 13);
    const res = aimTarget("floor", r, { dist: distTo(r, 3, 0, 13) }, { ...viewer, feetY: LEVEL + 0.15 });
    expect(res.spec).toEqual({ type: "floor", x: 0, y: 1, z: 1, rot: 0 });
  });

  it("targets your own floor when the crosshair is on it", () => {
    const own = piece({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }, "own");
    const r = ray(3.6, LEVEL + 1.9, -1, 3, LEVEL + 0.15, 3);
    const res = aimTarget("floor", r, { dist: distTo(r, 3, LEVEL + 0.15, 3), piece: own }, viewer);
    expect(res.spec).toEqual({ type: "floor", x: 0, y: 1, z: 0, rot: 0 });
  });

  it("falls back to right in front when no floor pane is in reach", () => {
    const r = ray(3.6, 1.7, -2, 3.6, 1.7, 100);
    expect(aimTarget("floor", r, null, viewer).source).toBe("front");
  });
});

describe("crosshair aiming: ramps and roofs", () => {
  it("targets the cell where the crosshair meets the ground, climbing away", () => {
    const r = ray(3.6, 1.7, 1, 3, 0, 3);
    const res = aimTarget("ramp", r, { dist: distTo(r, 3, 0, 3) }, viewer);
    expect(res).toEqual({ spec: { type: "ramp", x: 0, y: 0, z: 0, rot: 0 }, source: "crosshair" });
  });

  it("targets an existing ramp when the crosshair is on it", () => {
    const ramp = piece({ type: "ramp", x: 1, y: 0, z: 1, rot: 2 }, "r");
    const r = ray(3.6, 1.7, -2, 7, 1, 7);
    expect(aimTarget("roof", r, { dist: 6, piece: ramp }, viewer).spec).toMatchObject({ type: "roof", x: 1, y: 0, z: 1 });
  });

  it("goes right in front when the crosshair meets nothing close (keeps ramp rushing)", () => {
    const r = ray(3.6, 1.7, -2, 3.6, 1.5, 40);
    expect(aimTarget("ramp", r, { dist: 30 }, viewer).source).toBe("front");
  });
});
