import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { piecesMeet } from "../src/game/contact";
import type { Piece, PieceSpec, Rot } from "../src/game/pieces";
import { findUnsupported } from "../src/game/structure";

const s = (type: PieceSpec["type"], x: number, y: number, z: number, rot: Rot = 0): PieceSpec => ({ type, x, y, z, rot });
const piece = (spec: PieceSpec, id: string): Piece => ({ ...spec, id, material: "wood", edit: 0 });

describe("where pieces meet", () => {
  it("joins walls, floors and roofs along shared edges", () => {
    expect(piecesMeet(s("wall", 0, 0, 0, 0), s("wall", 0, 1, 0, 0))).toBe(true); // stacked
    expect(piecesMeet(s("wall", 0, 0, 0, 0), s("wall", 1, 0, 0, 0))).toBe(true); // in a line
    expect(piecesMeet(s("wall", 0, 0, 0, 0), s("wall", 0, 0, 0, 1))).toBe(true); // corner
    expect(piecesMeet(s("wall", 0, 0, 0, 0), s("floor", 0, 1, 0))).toBe(true); // floor on a wall
    expect(piecesMeet(s("roof", 0, 1, 0), s("wall", 0, 0, 0, 0))).toBe(true); // roof on a wall
  });

  it("does not join pieces that meet only at a corner point", () => {
    expect(piecesMeet(s("floor", 0, 1, 0), s("floor", 1, 1, 1))).toBe(false);
    expect(piecesMeet(s("wall", 0, 0, 0, 0), s("wall", 1, 1, 0, 0))).toBe(false);
  });

  it("joins ramps climbing the same way, end to end or side by side", () => {
    expect(piecesMeet(s("ramp", 0, 0, 0, 0), s("ramp", 0, 1, 1, 0))).toBe(true);
    expect(piecesMeet(s("ramp", 0, 0, 0, 1), s("ramp", 1, 1, 0, 1))).toBe(true);
    expect(piecesMeet(s("ramp", 0, 0, 0, 0), s("ramp", 1, 0, 0, 0))).toBe(true);
  });

  it("does not join ramps that turn or face each other (a V, a peak or a switchback)", () => {
    // V: bottoms meet.
    expect(piecesMeet(s("ramp", 0, 3, 0, 3), s("ramp", 1, 3, 0, 1))).toBe(false);
    // Switchback: one's top on the other's bottom, climbing back.
    expect(piecesMeet(s("ramp", 0, 0, 0, 0), s("ramp", 0, 1, 0, 2))).toBe(false);
    // A quarter turn with no landing.
    expect(piecesMeet(s("ramp", 0, 0, 0, 0), s("ramp", 0, 1, 1, 1))).toBe(false);
  });

  it("turns a staircase on a floor, in any direction", () => {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const state = new BuildState();
      state.apply({ kind: "place", piece: piece(s("ramp", 0, 0, 0, 0), "r0") });
      state.apply({ kind: "place", piece: piece(s("floor", 0, 1, 1), "landing") });
      // The next flight leaves the landing on the side it climbs away from.
      const next = rot === 0 ? s("ramp", 0, 1, 2, 0) : rot === 1 ? s("ramp", 1, 1, 1, 1) : rot === 2 ? s("ramp", 0, 1, 0, 2) : s("ramp", -1, 1, 1, 3);
      expect(state.canPlace(next).ok, `rot ${rot}`).toBe(true);
    }
  });

  it("brings down a ramp hanging off another in a V", () => {
    const state = new BuildState();
    for (let y = 0; y < 3; y++) state.apply({ kind: "place", piece: piece(s("ramp", 0, y, y, 0), `up${y}`) });
    // A ramp climbing back the other way off the top: nothing holds it.
    state.apply({ kind: "place", piece: piece(s("ramp", 0, 3, 2, 2), "back") });
    expect(findUnsupported(state).map((p) => p.id)).toEqual(["back"]);
  });
});
