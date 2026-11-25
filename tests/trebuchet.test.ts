import { describe, expect, it } from "vitest";
import { BuildState, type BuildOp } from "../src/game/buildState";
import { CELL, LEVEL } from "../src/game/constants";
import type { Piece, PieceSpec } from "../src/game/pieces";
import { findLooseAfterRemoval, findUnsupported } from "../src/game/structure";
import { checkRange, findImpact, launchPoint, maxRange, openAirTarget, planFlight, positionAt, strike, throwVelocity, type Vec } from "../src/game/trebuchet";
import { PLAIN } from "./plain";

const TREBUCHET = PLAIN.siege;

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
      const f = planFlight(from, to, PLAIN);
      const at = positionAt(f, f.time);
      for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
      // A lob: it rises before it falls.
      expect(f.v[1]).toBeGreaterThan(0);
    }
    // As a real trebuchet throws: 300 m takes about 8 s and peaks about 75 m up; 120 m about 5 s and 30 m.
    for (const [d, seconds, peak] of [[300, 7.8, 75], [120, 4.9, 30]] as const) {
      const f = planFlight([0, 0, 0], [d, 0, 0], PLAIN);
      expect(f.time).toBeCloseTo(seconds, 1);
      expect(positionAt(f, f.time / 2)[1]).toBeCloseTo(peak, 0);
    }
  });

  it("has a minimum range, and a maximum that grows with height", () => {
    const ground = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t0");
    const high = piece({ type: "trebuchet", x: 0, y: 8, z: 0, rot: 0 }, "t1");
    expect(maxRange(high, PLAIN) - maxRange(ground, PLAIN)).toBeCloseTo(8 * LEVEL);
    expect(checkRange(ground, [2.5 + 10, 0, 2.5], PLAIN)).toBe("near");
    expect(maxRange(ground, PLAIN)).toBe(300);
    expect(checkRange(ground, [2.5 + 290, 0, 2.5], PLAIN)).toBe("ok");
    expect(checkRange(ground, [2.5 + 320, 0, 2.5], PLAIN)).toBe("far");
    expect(checkRange(high, [2.5 + 320, 0, 2.5], PLAIN)).toBe("ok");
  });
});

describe("aiming at open air", () => {
  const t = piece({ type: "trebuchet", x: 0, y: 2, z: 0, rot: 0 }, "t");
  const from: Vec = [launchPoint(t, PLAIN)[0], launchPoint(t, PLAIN)[1] + 0.8, launchPoint(t, PLAIN)[2]];
  const look = (yaw: number, up: number): Vec => [Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up)];

  it("targets a point on the line of sight, in range, whichever way the builder looks", () => {
    for (const yaw of [0, 1, 2.5, -2]) {
      for (const up of [0, 0.1, 0.5, 1, 1.3]) {
        const dir = look(yaw, up);
        const to = openAirTarget(t, from, dir, PLAIN);
        expect(checkRange(t, to, PLAIN)).toBe("ok");
        // On the line of sight: the same direction from the eye.
        const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        expect(d).toBeLessThanOrEqual(maxRange(t, PLAIN));
        for (let i = 0; i < 3; i++) expect((to[i]! - from[i]!) / d).toBeCloseTo(dir[i]!, 6);
        // And the stone goes through it.
        const f = planFlight(launchPoint(t, PLAIN), to, PLAIN);
        const at = positionAt(f, f.time);
        for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
      }
    }
  });

  it("stops at the ground when looking down", () => {
    const to = openAirTarget(t, from, look(0, -0.2), PLAIN);
    expect(to[1]).toBeCloseTo(0, 6);
    expect(checkRange(t, to, PLAIN)).toBe("ok");
  });

  it("is too close only when looking almost straight up", () => {
    expect(checkRange(t, openAirTarget(t, from, look(0, Math.PI / 2 - 0.01), PLAIN), PLAIN)).toBe("near");
  });
});

describe("what a stone hits", () => {
  it("hits the piece it was aimed at when the way is clear, ignoring its own trebuchet", () => {
    const state = new BuildState();
    const t = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    place(state, t);
    tower(state, "w", 0, 12, 1);
    const target: Vec = [2.5, 1.8, 12 * CELL];
    const impact = findImpact(state, planFlight(launchPoint(t, PLAIN), target, PLAIN), "t", PLAIN);
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
    const impact = findImpact(state, planFlight(launchPoint(t, PLAIN), [2.5, 1.8, 12 * CELL], PLAIN), "t", PLAIN);
    expect(impact.pieceId?.startsWith("s")).toBe(true);
  });

  it("lands on the ground when there is nothing there", () => {
    const state = new BuildState();
    const t = piece({ type: "trebuchet", x: 0, y: 0, z: 0, rot: 0 }, "t");
    place(state, t);
    const impact = findImpact(state, planFlight(launchPoint(t, PLAIN), [40, 0, 40], PLAIN), "t", PLAIN);
    expect(impact.pieceId).toBeUndefined();
    expect(impact.point[1]).toBe(0);
  });
});

describe("damage", () => {
  it("breaks wood in two hits, brick in four and metal in six", () => {
    for (const [material, hits] of [["wood", 2], ["brick", 4], ["metal", 6]] as const) {
      const state = new BuildState();
      place(state, piece({ type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "w", { material }));
      const damage = new Map<string, number>();
      for (let i = 1; i <= hits; i++) {
        const { broken, damaged } = strike(state, [2.5, 1.8, 0], damage, PLAIN);
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
    const { broken } = strike(state, [2.5, 2, 2.5], new Map(), PLAIN);
    expect(broken.map((p) => p.id)).toEqual(["t"]);
  });

  it("only reaches pieces within the blast radius", () => {
    const state = new BuildState();
    place(state, piece({ type: "wall", x: 0, y: 0, z: 0, rot: 0 }, "near"));
    place(state, piece({ type: "wall", x: 3, y: 0, z: 0, rot: 0 }, "far"));
    const damage = new Map([["near", 1], ["far", 1]]);
    const { broken } = strike(state, [2.5, 1.8, 0], damage, PLAIN);
    expect(broken.map((p) => p.id)).toEqual(["near"]);
    expect(damage.get("far")).toBe(1);
    expect(TREBUCHET.blastRadius).toBeLessThan(CELL);
  });
});

describe("an engine that shoots fast and flat", () => {
  const FLAT = { ...PLAIN, siege: { ...PLAIN.siege, shotSeconds: 0.5 } };
  it("takes the same short time however far, and still passes exactly through the target", () => {
    for (const d of [30, 150, 290]) {
      const f = planFlight([0, 7, 0], [d, 2, 0], FLAT);
      expect(f.time).toBe(0.5);
      const at = positionAt(f, f.time);
      expect(at[0]).toBeCloseTo(d, 6);
      expect(at[1]).toBeCloseTo(2, 6);
    }
  });
  it("leaves every other engine throwing its high arc", () => {
    expect(planFlight([0, 0, 0], [300, 0, 0], PLAIN).time).toBeCloseTo(7.8, 1);
  });
});

describe("builders near an impact", () => {
  it("are thrown away from it and high up, harder the closer they stood", () => {
    const near = throwVelocity([0, 0, 0], [1, 0.9, 0], PLAIN)!;
    const far = throwVelocity([0, 0, 0], [6, 0.9, 0], PLAIN)!;
    expect(near[0]).toBeGreaterThan(far[0]);
    expect(near[0]).toBeGreaterThan(0);
    expect(near[1]).toBeGreaterThan(25);
    expect(Math.abs(near[2])).toBeLessThan(1e-9);
  });

  it("are left alone out of reach", () => {
    expect(throwVelocity([0, 0, 0], [TREBUCHET.throwRadius + 0.5, 0.9, 0], PLAIN)).toBeNull();
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
