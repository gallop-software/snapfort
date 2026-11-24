import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { engineInTheWay, overlaps, piecesIn, solidOf } from "../src/game/keepOut";
import type { Piece, PieceSpec } from "../src/game/pieces";
import { WORLDS } from "../src/worlds";

const spec = (type: Piece["type"], x: number, y: number, z: number, rot: Piece["rot"] = 0): PieceSpec => ({ type, x, y, z, rot });
const put = (build: BuildState, s: PieceSpec) => expect(build.apply({ kind: "place", piece: { ...s, id: `${s.type}${s.x},${s.y},${s.z},${s.rot}`, material: "wood", edit: 0 } })).not.toBeNull();

describe("nothing is built into a siege engine", () => {
  for (const env of WORLDS) {
    it(`${env.name}: walls may stand round it, but no ceiling one storey up, and nothing in the cell over it`, () => {
      const build = new BuildState();
      put(build, spec("floor", 4, 2, 4));
      put(build, spec("trebuchet", 4, 2, 4));
      // The four walls of its own cell, and the four a storey higher.
      for (const y of [2, 3]) for (const w of [spec("wall", 4, y, 4, 0), spec("wall", 4, y, 5, 0), spec("wall", 4, y, 4, 1), spec("wall", 5, y, 4, 1)]) expect(engineInTheWay(build, w, env), JSON.stringify(w)).toBe(false);
      // A ceiling a storey up would pass through its frame; so would anything standing in the cell above.
      expect(engineInTheWay(build, spec("floor", 4, 3, 4), env)).toBe(true);
      for (const type of ["ramp", "roof", "trebuchet"] as const) expect(engineInTheWay(build, spec(type, 4, 3, 4), env), type).toBe(true);
      // Two storeys up is clear of it; so are the cells beside it.
      expect(engineInTheWay(build, spec("floor", 4, 4, 4), env)).toBe(false);
      for (const type of ["floor", "ramp", "roof", "trebuchet"] as const) expect(engineInTheWay(build, spec(type, 5, 2, 4), env), type).toBe(false);
      expect(engineInTheWay(build, spec("floor", 5, 3, 4), env)).toBe(false);
    });

    it(`${env.name}: an engine cannot go under a ceiling one storey up, or under anything in the cell above`, () => {
      const build = new BuildState();
      put(build, spec("floor", 0, 1, 0));
      expect(engineInTheWay(build, spec("trebuchet", 0, 0, 0), env)).toBe(true);
      expect(engineInTheWay(build, spec("trebuchet", 1, 0, 0), env)).toBe(false);
      const high = new BuildState();
      put(high, spec("floor", 0, 2, 0));
      for (const w of [spec("wall", 0, 0, 0), spec("wall", 0, 1, 0), spec("wall", 0, 0, 0, 1)]) put(high, w);
      // A room two storeys high has room for it.
      expect(engineInTheWay(high, spec("trebuchet", 0, 0, 0), env)).toBe(false);
      const roofed = new BuildState();
      put(roofed, spec("roof", 0, 1, 0));
      expect(engineInTheWay(roofed, spec("trebuchet", 0, 0, 0), env)).toBe(true);
      // On its own floor it stands.
      const floored = new BuildState();
      put(floored, spec("floor", 0, 3, 0));
      expect(engineInTheWay(floored, spec("trebuchet", 0, 3, 0), env)).toBe(false);
    });
  }

  it("finds the pieces in a box, walls on its far edges included, and lets a graze pass", () => {
    const env = WORLDS[0]!;
    const build = new BuildState();
    put(build, spec("wall", 1, 0, 0, 1));
    put(build, spec("floor", 0, 0, 0));
    expect(piecesIn(build, [0, 1, 0, 5, 3, 5], env).map((p) => p.type)).toEqual(["wall"]);
    expect(piecesIn(build, [0, 1, 0, 5, 3, 5], env, 0.2)).toEqual([]);
    expect(overlaps(solidOf(spec("floor", 0, 0, 0), env), [0, -1, 0, 5, 3, 5], 0.2)).toBe(true);
  });
});
