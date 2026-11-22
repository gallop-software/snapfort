import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import type { Piece, PieceSpec } from "../src/game/pieces";
import { PIECE_HITS, SIEGE, Siege, waveSize } from "../src/game/siege";
import { findUnsupported } from "../src/game/structure";

let n = 0;
const put = (state: BuildState, type: PieceSpec["type"], x: number, y: number, z: number, rot: PieceSpec["rot"] = 0) => {
  const id = `s${n++}`;
  state.apply({ kind: "place", piece: { type, x, y, z, rot, id, material: "wood", edit: 0 } });
  return id;
};

/** A fixed "random" source so runs repeat exactly. */
const steady = () => 0.5;

function run(siege: Siege, seconds: number, px: number, feetY: number, pz: number): void {
  for (let t = 0; t < seconds && !siege.captured; t += 1 / 30) siege.update(1 / 30, px, feetY, pz);
}

describe("structure", () => {
  it("finds pieces that lost their link to the ground", () => {
    const state = new BuildState();
    const wall = put(state, "wall", 0, 0, 0);
    const floor = put(state, "floor", 0, 1, 0);
    const far = put(state, "floor", 1, 1, 0);
    expect(findUnsupported(state)).toEqual([]);
    state.apply({ kind: "remove", id: wall });
    expect(findUnsupported(state).map((p) => p.id).sort()).toEqual([floor, far].sort());
  });
});

describe("siege", () => {
  it("does nothing until it is active and sends the first wave after the build time", () => {
    const state = new BuildState();
    const siege = new Siege(state, {}, steady);
    run(siege, 5, 0, 0, 0);
    expect(siege.elapsed).toBe(0);
    siege.reset(true);
    run(siege, SIEGE.firstWaveDelay - 1, 0, 0, 0);
    expect(siege.soldiers.length).toBe(0);
    run(siege, 2, 0, 0, 0);
    expect(siege.wave).toBe(1);
    expect(siege.soldiers.length).toBe(waveSize(1));
  });

  it("captures a builder standing in the open", () => {
    const siege = new Siege(new BuildState(), {}, steady);
    siege.reset(true);
    run(siege, SIEGE.firstWaveDelay + 60, 2.5, 0, 2.5);
    expect(siege.captured).toBe(true);
  });

  it("is held up by walls, batters them down, then captures", () => {
    const state = new BuildState();
    // A closed one-cell box around the builder in the middle of cell (0, 0).
    put(state, "wall", 0, 0, 0, 0); put(state, "wall", 0, 0, 1, 0);
    put(state, "wall", 0, 0, 0, 1); put(state, "wall", 1, 0, 0, 1);
    const broken: Piece[] = [];
    let hits = 0;
    const siege = new Siege(state, { hit: () => hits++, destroyed: (p) => broken.push(p) }, steady);
    siege.reset(true);
    run(siege, SIEGE.firstWaveDelay + 29.5, 2.5, 0, 2.5);
    // The wave has arrived (about 95 m at 3.4 m/s) and started on the walls, but only a few
    // soldiers can hit one wall at a time, so the box holds for a few seconds.
    expect(siege.captured).toBe(false);
    expect(hits).toBeGreaterThan(0);
    run(siege, 60, 2.5, 0, 2.5);
    expect(broken.length).toBeGreaterThan(0);
    expect(siege.captured).toBe(true);
  });

  it("cannot reach a builder up high until the supports are gone", () => {
    const state = new BuildState();
    const wall = put(state, "wall", 0, 0, 0, 0);
    const floor = put(state, "floor", 0, 1, 0);
    const fell: string[] = [];
    const siege = new Siege(state, { destroyed: (p, f) => f && fell.push(p.id) }, steady);
    siege.reset(true);
    // The builder stands on the upper floor (feet 3.9 m up). The army goes for the wall.
    run(siege, SIEGE.firstWaveDelay + 34, 2.5, 3.9, 2.5);
    expect(siege.captured).toBe(false);
    run(siege, 30, 2.5, 3.9, 2.5);
    expect(state.get(wall)).toBeUndefined();
    expect(fell).toEqual([floor]);
    expect(state.size).toBe(0);
    // Back on the ground among the soldiers.
    run(siege, 10, 2.5, 0, 2.5);
    expect(siege.captured).toBe(true);
  });

  it("gives each piece the hits it is meant to take", () => {
    const state = new BuildState();
    const id = put(state, "wall", 0, 0, 0, 0);
    const siege = new Siege(state, {}, steady);
    expect(siege.damage(state.get(id)!)).toBe(0);
    expect(PIECE_HITS.wall).toBeGreaterThan(PIECE_HITS.ramp);
  });
});
