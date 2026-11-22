import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { CELL, LEVEL, WORLD_HALF_CELLS } from "../src/game/constants";
import { editTileAt } from "../src/game/edit";
import { History } from "../src/game/history";
import { createIdSource } from "../src/game/ids";
import { gridBox, inBounds, isValidEdit, normalizeSpec, pieceTransform, slotKey, type Piece, type PieceSpec } from "../src/game/pieces";
import { findUnsupported } from "../src/game/structure";
import { buildTarget, facingRot, type Viewer } from "../src/game/targeting";

const spec = (type: PieceSpec["type"], x: number, y: number, z: number, rot: PieceSpec["rot"] = 0): PieceSpec => ({ type, x, y, z, rot });
const piece = (s: PieceSpec, id: string, extra: Partial<Piece> = {}): Piece => ({ ...s, id, material: "wood", edit: 0, ...extra });

describe("pieces", () => {
  it("folds equivalent rotations", () => {
    expect(normalizeSpec(spec("wall", 0, 0, 0, 2)).rot).toBe(0);
    expect(normalizeSpec(spec("wall", 0, 0, 0, 3)).rot).toBe(1);
    expect(normalizeSpec(spec("floor", 0, 0, 0, 3)).rot).toBe(0);
    expect(normalizeSpec(spec("ramp", 0, 0, 0, 3)).rot).toBe(3);
  });

  it("gives ramps and roofs the same slot, walls and floors their own", () => {
    expect(slotKey(spec("ramp", 1, 0, 1, 2))).toBe(slotKey(spec("roof", 1, 0, 1)));
    expect(slotKey(spec("wall", 1, 0, 1, 0))).not.toBe(slotKey(spec("wall", 1, 0, 1, 1)));
    expect(slotKey(spec("floor", 1, 0, 1))).not.toBe(slotKey(spec("ramp", 1, 0, 1)));
  });

  it("keeps pieces inside the world", () => {
    expect(inBounds(spec("floor", WORLD_HALF_CELLS - 1, 0, 0))).toBe(true);
    expect(inBounds(spec("floor", WORLD_HALF_CELLS, 0, 0))).toBe(false);
    expect(inBounds(spec("wall", WORLD_HALF_CELLS, 0, 0, 1))).toBe(true);
    expect(inBounds(spec("wall", WORLD_HALF_CELLS, 0, 0, 0))).toBe(false);
    expect(inBounds(spec("floor", 0, -1, 0))).toBe(false);
    expect(inBounds(spec("floor", 0.5, 0, 0))).toBe(false);
  });

  it("places walls on cell edges and other pieces at cell centres", () => {
    expect(pieceTransform(spec("wall", 1, 2, 3, 0))).toEqual({ px: 1.5 * CELL, py: 2 * LEVEL, pz: 3 * CELL, yaw: 0 });
    expect(pieceTransform(spec("wall", 1, 0, 3, 1))).toMatchObject({ px: CELL, pz: 3.5 * CELL });
    expect(pieceTransform(spec("ramp", 0, 0, 0, 1))).toMatchObject({ px: CELL / 2, pz: CELL / 2, yaw: Math.PI / 2 });
    expect(gridBox(spec("wall", 0, 0, 0, 1))).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it("allows edits that leave at least one tile, on walls and floors only", () => {
    expect(isValidEdit("wall", 0)).toBe(true);
    expect(isValidEdit("wall", 0b000_010_010)).toBe(true);
    expect(isValidEdit("wall", 0b111_111_111)).toBe(false);
    expect(isValidEdit("floor", 0b0111)).toBe(true);
    expect(isValidEdit("floor", 0b1111)).toBe(false);
    expect(isValidEdit("ramp", 1)).toBe(false);
    expect(isValidEdit("wall", -1)).toBe(false);
    expect(isValidEdit("wall", 1.5)).toBe(false);
  });
});

describe("build state", () => {
  const nextId = createIdSource("t");
  const place = (state: BuildState, s: PieceSpec, extra: Partial<Piece> = {}) =>
    state.apply({ kind: "place", piece: piece(s, nextId(), extra) });

  it("refuses a second piece in the same slot", () => {
    const state = new BuildState();
    expect(place(state, spec("wall", 0, 0, 0))).not.toBeNull();
    expect(place(state, spec("wall", 0, 0, 0, 2))).toBeNull();
    expect(state.canPlace(spec("wall", 0, 0, 0))).toEqual({ ok: false, problem: "occupied" });
    expect(state.canPlace(spec("wall", 0, 0, 0, 1))).toEqual({ ok: true });
    expect(state.size).toBe(1);
  });

  it("refuses unknown materials and invalid edits", () => {
    const state = new BuildState();
    expect(place(state, spec("wall", 0, 0, 0), { material: "cheese" as never })).toBeNull();
    expect(place(state, spec("ramp", 0, 0, 0), { edit: 1 })).toBeNull();
    expect(place(state, spec("wall", 0, 0, 0), { material: "metal", edit: 0b010_010_000 })).not.toBeNull();
  });

  it("needs support above the ground", () => {
    const state = new BuildState();
    expect(state.canPlace(spec("floor", 0, 1, 0))).toEqual({ ok: false, problem: "unsupported" });
    place(state, spec("wall", 0, 0, 0));
    expect(state.canPlace(spec("floor", 0, 1, 0))).toEqual({ ok: true });
    expect(state.canPlace(spec("wall", 0, 1, 0))).toEqual({ ok: true });
    expect(state.canPlace(spec("floor", 0, 1, -1))).toEqual({ ok: true });
    expect(state.canPlace(spec("floor", 3, 1, 0))).toEqual({ ok: false, problem: "unsupported" });
    expect(state.canPlace(spec("floor", 0, 2, 0))).toEqual({ ok: false, problem: "unsupported" });
  });

  it("returns the inverse operation and notifies listeners", () => {
    const state = new BuildState();
    const seen: string[] = [];
    state.subscribe((op, p) => seen.push(`${op.kind}:${p.type}`));
    const inverse = place(state, spec("ramp", 2, 0, 2, 1));
    expect(inverse?.kind).toBe("remove");
    const back = state.apply(inverse!);
    expect(back).toMatchObject({ kind: "place", piece: { type: "ramp", x: 2, rot: 1, material: "wood" } });
    expect(state.size).toBe(0);
    expect(state.apply({ kind: "remove", id: "nope" })).toBeNull();
    expect(seen).toEqual(["place:ramp", "remove:ramp"]);
  });

  it("edits pieces and undoes edits", () => {
    const state = new BuildState();
    state.apply({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "w") });
    const door = 0b000_010_010;
    const inverse = state.apply({ kind: "edit", id: "w", edit: door });
    expect(state.get("w")?.edit).toBe(door);
    expect(inverse).toEqual({ kind: "edit", id: "w", edit: 0 });
    expect(state.apply({ kind: "edit", id: "w", edit: door })).toBeNull();
    expect(state.apply({ kind: "edit", id: "w", edit: 0b111_111_111 })).toBeNull();
    state.apply(inverse!);
    expect(state.get("w")?.edit).toBe(0);
  });
});

describe("history", () => {
  it("undoes and redoes places and removes", () => {
    const state = new BuildState();
    const history = new History(state);
    expect(history.do({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "a") })).toBe(true);
    expect(history.do({ kind: "place", piece: piece(spec("floor", 0, 1, 0), "b") })).toBe(true);
    expect(history.do({ kind: "remove", id: "a" })).toBe(true);
    expect(state.size).toBe(1);
    expect(history.undo()).toBe(true);
    expect(state.get("a")).toBeDefined();
    expect(history.undo()).toBe(true);
    expect(state.get("b")).toBeUndefined();
    expect(history.redo()).toBe(true);
    expect(state.get("b")).toBeDefined();
    expect(history.redo()).toBe(true);
    expect(state.get("a")).toBeUndefined();
    expect(history.redo()).toBe(false);
  });

  it("drops redo after a new operation and rejects invalid ones", () => {
    const state = new BuildState();
    const history = new History(state);
    history.do({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "a") });
    history.undo();
    expect(history.do({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "c") })).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.do({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "d") })).toBe(false);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
  });

  it("undoes a removal and the collapse it caused in one step", () => {
    const state = new BuildState();
    const history = new History(state);
    history.do({ kind: "place", piece: piece(spec("wall", 0, 0, 0), "w") });
    history.do({ kind: "place", piece: piece(spec("floor", 0, 1, 0), "f") });
    history.do({ kind: "place", piece: piece(spec("floor", 1, 1, 0), "g") });
    history.do({ kind: "remove", id: "w" });
    for (const p of findUnsupported(state)) history.extend({ kind: "remove", id: p.id });
    expect(state.size).toBe(0);
    expect(history.undo()).toBe(true);
    expect(state.size).toBe(3);
    expect(history.redo()).toBe(true);
    expect(state.size).toBe(0);
  });
});

describe("build targeting", () => {
  const v = (over: Partial<Viewer> = {}): Viewer => ({ x: 2.5, z: 2.5, feetY: 0, yaw: 0, pitch: 0, slope: 0, ...over });
  const down = (deg: number) => (deg * Math.PI) / 180;

  it("finds the facing quarter", () => {
    expect(facingRot(0)).toBe(0);
    expect(facingRot(Math.PI / 2 + 0.2)).toBe(1);
    expect(facingRot(-Math.PI / 2)).toBe(3);
    expect(facingRot(Math.PI)).toBe(2);
  });

  it("puts walls on the first grid line ahead, facing the builder", () => {
    expect(buildTarget("wall", v())).toEqual({ type: "wall", x: 0, y: 0, z: 1, rot: 0 });
    expect(buildTarget("wall", v({ z: 0.4 }))).toMatchObject({ z: 1 });
    expect(buildTarget("wall", v({ z: 4.9, pitch: down(70) }))).toMatchObject({ z: 1 });
    expect(buildTarget("wall", v({ yaw: Math.PI }))).toEqual({ type: "wall", x: 0, y: 0, z: 0, rot: 0 });
    expect(buildTarget("wall", v({ yaw: Math.PI / 2 }))).toEqual({ type: "wall", x: 1, y: 0, z: 0, rot: 1 });
    expect(buildTarget("wall", v({ yaw: -Math.PI / 2 }))).toEqual({ type: "wall", x: 0, y: 0, z: 0, rot: 1 });
    expect(buildTarget("wall", v({ x: -2.5, z: -2.5, yaw: -Math.PI / 2 }))).toEqual({ type: "wall", x: -1, y: 0, z: -1, rot: 1 });
  });

  it("puts floors ahead, under the builder when looking down, a storey up when looking up", () => {
    expect(buildTarget("floor", v())).toEqual({ type: "floor", x: 0, y: 0, z: 1, rot: 0 });
    expect(buildTarget("floor", v({ pitch: down(65) }))).toMatchObject({ z: 0, y: 0 });
    expect(buildTarget("floor", v({ pitch: down(-30) }))).toMatchObject({ z: 1, y: 1 });
    expect(buildTarget("floor", v({ feetY: LEVEL + 0.15 }))).toMatchObject({ y: 1 });
    expect(buildTarget("wall", v({ feetY: LEVEL + 0.15, pitch: down(-35) }))).toMatchObject({ y: 2 });
  });

  it("points ramps away from the builder and continues a ramp rush a storey up", () => {
    expect(buildTarget("ramp", v())).toEqual({ type: "ramp", x: 0, y: 0, z: 1, rot: 0 });
    expect(buildTarget("ramp", v({ yaw: Math.PI }))).toMatchObject({ z: -1, rot: 2 });
    expect(buildTarget("ramp", v({ yaw: Math.PI }), 1)).toMatchObject({ rot: 3 });
    // Halfway up a ramp, running up it: the next ramp starts where this one ends.
    const climbing = v({ feetY: 2.0, slope: LEVEL / CELL });
    expect(buildTarget("ramp", climbing)).toEqual({ type: "ramp", x: 0, y: 1, z: 1, rot: 0 });
    expect(buildTarget("wall", climbing)).toMatchObject({ y: 1, z: 1 });
    // Just stepped onto the bottom of a ramp.
    expect(buildTarget("ramp", v({ z: 0.3, feetY: 0.2, slope: LEVEL / CELL }))).toMatchObject({ z: 1, y: 1 });
  });
});

describe("edit tiles", () => {
  it("finds the wall tile the view ray crosses", () => {
    const wall = piece(spec("wall", 0, 0, 1, 0), "w");
    // Wall runs along x at z = 5, from x 0 to 5 and y 0 to 3.75. Look straight at it from z = 0.
    expect(editTileAt(wall, 2.5, 1.9, 0, 0, 0, 1, 10)).toBe(4);
    expect(editTileAt(wall, 0.5, 0.5, 0, 0, 0, 1, 10)).toBe(0);
    expect(editTileAt(wall, 4.5, 3.5, 0, 0, 0, 1, 10)).toBe(8);
    expect(editTileAt(wall, 2.5, 1.9, 0, 0, 0, 1, 3)).toBe(-1);
    expect(editTileAt(wall, 2.5, 1.9, 0, 0, 0, -1, 10)).toBe(-1);
    expect(editTileAt(wall, 7, 1.9, 0, 0, 0, 1, 10)).toBe(-1);
  });

  it("finds tiles on a turned wall and on a floor", () => {
    const wall = piece(spec("wall", 1, 0, 0, 1), "w");
    // Wall along z at x = 5. Its own x axis runs toward -z, so world z near 0.5 is its last column.
    expect(editTileAt(wall, 0, 0.5, 0.5, 1, 0, 0, 10)).toBe(2);
    expect(editTileAt(wall, 0, 0.5, 4.5, 1, 0, 0, 10)).toBe(0);
    const floor = piece(spec("floor", 0, 1, 0), "f");
    expect(editTileAt(floor, 1, 6, 1, 0, -1, 0, 10)).toBe(0);
    expect(editTileAt(floor, 4, 6, 4, 0, -1, 0, 10)).toBe(3);
    expect(editTileAt(floor, 4, 6, 1, 0, -1, 0, 10)).toBe(1);
  });
});
