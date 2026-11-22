import { describe, expect, it } from "vitest";
import { aimTarget, type AimRay } from "../src/game/aim";
import { BuildState } from "../src/game/buildState";
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

describe("crosshair aiming: roofs two storeys up", () => {
  /** A one-cell tower at cell (0, 0): walls on all four sides, two storeys high. */
  function tower(): BuildState {
    const state = new BuildState();
    let n = 0;
    for (const y of [0, 1]) {
      for (const [x, z, rot] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]] as const) {
        state.apply({ kind: "place", piece: piece({ type: "wall", x, y, z, rot }, `w${n++}`) });
      }
    }
    return state;
  }
  const can = (state: BuildState) => (s: PieceSpec) => (state.canPlace(s).ok ? state.touching(s).length : null);

  it("looking up from inside the tower puts the roof on top, two storeys up", () => {
    const state = tower();
    const inside: Viewer = { ...viewer, x: 2.5, z: 2.5 };
    const r = ray(3.4, 1.7, 2.5, 2.8, 9, 3);
    expect(aimTarget("roof", r, null, inside, 0, can(state)).spec).toEqual({ type: "roof", x: 0, y: 2, z: 0, rot: 0 });
  });

  it("looking up past the top of the tower from outside puts the roof on top", () => {
    const state = tower();
    const outside: Viewer = { ...viewer, x: 2.5, z: -4 };
    // From in front of the tower, just over the top edge of its near wall (7.5 m up at z = 0).
    const r = ray(3.6, 1.7, -4, 2.5, 8.3, 2);
    expect(aimTarget("roof", r, null, outside, 0, can(state)).spec).toEqual({ type: "roof", x: 0, y: 2, z: 0, rot: 0 });
  });

  it("among equally high spots, the roof caps the tower rather than hanging off its edge", () => {
    const state = tower();
    const outside: Viewer = { ...viewer, x: 2.5, z: -4 };
    // A steep line that passes through the level-2 cell in front of the tower before the one on top.
    const r = ray(3.6, 1.7, -4, 2.5, 11, 1);
    expect(aimTarget("roof", r, null, outside, 0, can(state)).spec).toEqual({ type: "roof", x: 0, y: 2, z: 0, rot: 0 });
  });

  it("looking at the ground still puts the roof where the crosshair points", () => {
    const state = new BuildState();
    const r = ray(3.6, 1.7, 1, 7, 0, 8);
    expect(aimTarget("roof", r, { dist: distTo(r, 7, 0, 8) }, viewer, 0, can(state)).spec).toMatchObject({ x: 1, y: 0, z: 1 });
  });

  it("looking straight ahead in an open field puts the roof in the next cell, not far away", () => {
    const state = new BuildState();
    const here: Viewer = { ...viewer, x: 2.5, z: 2.5 };
    const r = ray(3.6, 1.7, 2.5, 3.6, 1.7, 40);
    expect(aimTarget("roof", r, null, here, 0, can(state)).spec).toMatchObject({ x: 0, y: 0, z: 1 });
  });
});

describe("crosshair aiming: a roof just placed high up", () => {
  it("looking up at a roof on top of a three-storey tower sees that roof, not the storey below (reported bug)", () => {
    const state = new BuildState();
    let n = 0;
    for (const y of [0, 1, 2]) {
      for (const [x, z, rot] of [[0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1]] as const) {
        state.apply({ kind: "place", piece: piece({ type: "wall", x, y, z, rot }, `w${n++}`) });
      }
    }
    const score = (s: PieceSpec) => (state.canPlace(s).ok ? state.touching(s).length : null);
    const inside: Viewer = { ...viewer, x: 2.5, z: 2.5 };
    const r = ray(3.4, 1.7, 2.5, 2.8, 14, 3);
    // First the roof goes on top, three storeys up.
    const first = aimTarget("roof", r, null, inside, 0, score).spec;
    expect(first).toEqual({ type: "roof", x: 0, y: 3, z: 0, rot: 0 });
    const roof = piece(first, "top-roof");
    state.apply({ kind: "place", piece: roof });
    // Next frame the crosshair hits that roof's underside (11.25 m up, about 9.6 m away).
    const dist = (3 * LEVEL - 1.7) / r.dy;
    expect(dist).toBeGreaterThan(8);
    const next = aimTarget("roof", r, { dist, piece: roof }, inside, 0, score).spec;
    expect(next).toEqual({ type: "roof", x: 0, y: 3, z: 0, rot: 0 });
  });
});
