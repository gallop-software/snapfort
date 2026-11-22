import { describe, expect, it } from "vitest";
import { BuildState, type BuildOp } from "../src/game/buildState";
import { CELL, LEVEL } from "../src/game/constants";
import type { Piece, PieceSpec } from "../src/game/pieces";
import { findLooseAfterRemoval, findUnsupported } from "../src/game/structure";
import { measureTowers } from "../src/game/towers";
import { checkRange, findImpact, launchPoint, maxRange, planFlight, positionAt, strike, throwVelocity, TREBUCHET, type Vec } from "../src/game/trebuchet";

const piece = (s: PieceSpec, id: string, extra: Partial<Piece> = {}): Piece => ({ ...s, id, material: "wood", edit: 0, ...extra });
const place = (state: BuildState, p: Piece) => expect(state.apply({ kind: "place", piece: p } as BuildOp)).not.toBeNull();
const remove = (state: BuildState, id: string) => state.apply({ kind: "remove", id });

/** A column of walls `levels` storeys high at cell (x, z), facing along x. */
function tower(state: BuildState, prefix: string, x: number, z: number, levels: number, material: Piece["material"] = "wood"): void {
  for (let y = 0; y < levels; y++) place(state, piece({ type: "wall", x, y, z, rot: 0 }, `${prefix}${y}`, { material }));
}

describe("trebuchet aim", () => {
  it("throws a stone that passes exactly through the target", () => {
    const from: Vec = [0, 7, 0];
    for (const to of [[30, 0, 40], [-90, 12.5, 10], [0, 30, 120]] as Vec[]) {
      const f = planFlight(from, to);
      const at = positionAt(f, f.time);
      for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
      // A lob: it rises before it falls.
      expect(f.v[1]).toBeGreaterThan(0);
    }
  });

  it("has a minimum range, and a maximum that grows with height", () => {
    const ground = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t0");
    const high = piece({ type: "trebuchet", x: 0, y: 8, z: 0, rot: 0 }, "t1");
    expect(maxRange(high) - maxRange(ground)).toBeCloseTo(8 * LEVEL);
    expect(checkRange(ground, [2.5 + 10, 0, 2.5])).toBe("near");
    expect(checkRange(ground, [2.5 + 100, 0, 2.5])).toBe("ok");
    expect(checkRange(ground, [2.5 + 140, 0, 2.5])).toBe("far");
    expect(checkRange(high, [2.5 + 140, 0, 2.5])).toBe("ok");
  });
});

describe("what a stone hits", () => {
  it("hits the piece it was aimed at when the way is clear, ignoring its own trebuchet", () => {
    const state = new BuildState();
    const t = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    place(state, t);
    tower(state, "w", 0, 12, 1);
    const target: Vec = [2.5, 1.8, 12 * CELL];
    const impact = findImpact(state, planFlight(launchPoint(t), target), "t");
    expect(impact.pieceId).toBe("w0");
    expect(Math.hypot(impact.point[0] - target[0], impact.point[2] - target[2])).toBeLessThan(1);
  });

  it("hits a shield wall in the way instead", () => {
    const state = new BuildState();
    const t = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    place(state, t);
    tower(state, "w", 0, 12, 1);
    // A tall shield two cells in front of the target.
    tower(state, "s", 0, 10, 6);
    const impact = findImpact(state, planFlight(launchPoint(t), [2.5, 1.8, 12 * CELL]), "t");
    expect(impact.pieceId?.startsWith("s")).toBe(true);
  });

  it("lands on the ground when there is nothing there", () => {
    const state = new BuildState();
    const t = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    place(state, t);
    const impact = findImpact(state, planFlight(launchPoint(t), [40, 0, 40]), "t");
    expect(impact.pieceId).toBeUndefined();
    expect(impact.point[1]).toBe(0);
  });
});

describe("damage", () => {
  it("breaks wood in one hit, brick in two and metal in three", () => {
    for (const [material, hits] of [["wood", 1], ["brick", 2], ["metal", 3]] as const) {
      const state = new BuildState();
      place(state, piece({ type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "w", { material }));
      const damage = new Map<string, number>();
      for (let i = 1; i <= hits; i++) {
        const { broken, damaged } = strike(state, [2.5, 1.8, 0], damage);
        if (i < hits) {
          expect(broken).toHaveLength(0);
          expect(damaged).toEqual([["w", i]]);
        } else expect(broken.map((p) => p.id)).toEqual(["w"]);
      }
    }
  });

  it("breaks a trebuchet with one hit, whatever it is made of", () => {
    const state = new BuildState();
    place(state, piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t", { material: "metal" }));
    const { broken } = strike(state, [2.5, 2, 2.5], new Map());
    expect(broken.map((p) => p.id)).toEqual(["t"]);
  });

  it("only reaches pieces within the blast radius", () => {
    const state = new BuildState();
    place(state, piece({ type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "near"));
    place(state, piece({ type: "wall", x: 3, y: 0, z: 0, rot: 0 }, "far"));
    const { broken } = strike(state, [2.5, 1.8, 0], new Map());
    expect(broken.map((p) => p.id)).toEqual(["near"]);
    expect(TREBUCHET.blastRadius).toBeLessThan(CELL);
  });
});

describe("builders near an impact", () => {
  it("are thrown away from it and high up, harder the closer they stood", () => {
    const near = throwVelocity([0, 0, 0], [1, 0.9, 0])!;
    const far = throwVelocity([0, 0, 0], [6, 0.9, 0])!;
    expect(near[0]).toBeGreaterThan(far[0]);
    expect(near[0]).toBeGreaterThan(0);
    expect(near[1]).toBeGreaterThan(25);
    expect(Math.abs(near[2])).toBeLessThan(1e-9);
  });

  it("are left alone out of reach", () => {
    expect(throwVelocity([0, 0, 0], [TREBUCHET.throwRadius + 0.5, 0.9, 0])).toBeNull();
  });
});

describe("trebuchets and collapse", () => {
  it("needs a floor or the ground under it", () => {
    const state = new BuildState();
    expect(state.canPlace({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }).ok).toBe(true);
    tower(state, "w", 0, 0, 2);
    // Touching a wall is not enough up high.
    expect(state.canPlace({ type: "trebuchet", x: 0, y: 1, z: 0, rot: 0 }).ok).toBe(false);
    place(state, piece({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }, "f"));
    expect(state.canPlace({ type: "trebuchet", x: 0, y: 1, z: 0, rot: 0 }).ok).toBe(true);
  });

  it("falls with its platform", () => {
    const state = new BuildState();
    tower(state, "w", 0, 0, 1);
    place(state, piece({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }, "f"));
    place(state, piece({ type: "trebuchet", x: 0, y: 1, z: 0, rot: 0 }, "t"));
    const base = state.get("w0")!;
    remove(state, "w0");
    const loose = findLooseAfterRemoval(state, [base]).map((p) => p.id).sort();
    expect(loose).toEqual(["f", "t"]);
    expect(findUnsupported(state).map((p) => p.id).sort()).toEqual(["f", "t"]);
  });

  it("falls when the floor under it is knocked out directly", () => {
    const state = new BuildState();
    tower(state, "w", 0, 0, 2);
    place(state, piece({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }, "f"));
    place(state, piece({ type: "trebuchet", x: 0, y: 1, z: 0, rot: 0 }, "t"));
    const floor = state.get("f")!;
    remove(state, "f");
    // The wall beside it still stands; the trebuchet does not.
    expect(findLooseAfterRemoval(state, [floor]).map((p) => p.id)).toEqual(["t"]);
  });

  it("holds nothing up itself", () => {
    const state = new BuildState();
    place(state, piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t"));
    // A floor a storey up, touching only the trebuchet's space: not supported.
    expect(state.canPlace({ type: "floor", x: 0, y: 1, z: 0, rot: 0 }).ok).toBe(false);
  });

  it("stands on the ground whatever goes around it", () => {
    const state = new BuildState();
    place(state, piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t"));
    tower(state, "w", 0, 0, 1);
    const wall = state.get("w0")!;
    remove(state, "w0");
    expect(findLooseAfterRemoval(state, [wall])).toHaveLength(0);
  });
});

describe("tallest towers", () => {
  it("counts walls standing inside a fort, a cell from its walls, as part of it", () => {
    const state = new BuildState();
    // A fort: a ring of walls around cells 0..3, roofed on one side.
    for (let i = 0; i < 4; i++) {
      for (const [x, z, rot] of [[i, 0, 0], [i, 4, 0], [0, i, 1], [4, i, 1]] as const) place(state, piece({ type: "wall", x, y: 0, z, rot }, `f${x},${z},${rot}`));
    }
    place(state, piece({ type: "roof", x: 0, y: 1, z: 0, rot: 0 }, "roof"));
    // Two storeys of walls in the middle, touching nothing of the fort.
    tower(state, "inner", 2, 2, 2);
    const towers = measureTowers(state);
    expect(towers).toHaveLength(1);
    expect(towers[0]!.pieces).toBe(16 + 1 + 2);
    expect(towers[0]!.height).toBe(2 * LEVEL);
  });

  it("keeps towers two cells apart separate", () => {
    const state = new BuildState();
    tower(state, "a", 0, 0, 4);
    tower(state, "b", 2, 2, 3);
    expect(measureTowers(state).map((t) => t.pieces)).toEqual([4, 3]);
  });

  it("measures each standing structure, tallest first, without trebuchets or huts", () => {
    const state = new BuildState();
    tower(state, "a", 0, 0, 6);
    tower(state, "b", 10, 10, 3);
    tower(state, "c", -10, -10, 2);
    place(state, piece({ type: "trebuchet", x: 20, y: 0, z: 20, rot: 0 }, "t"));
    const towers = measureTowers(state);
    expect(towers.map((t) => t.height)).toEqual([6 * LEVEL, 3 * LEVEL]);
    expect(towers[0]!.top[1]).toBe(6 * LEVEL);
    expect(towers[0]!.pieces).toBe(6);
  });
});
