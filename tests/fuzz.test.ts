import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { History } from "../src/game/history";
import { MATERIALS, PIECE_TYPES, editGrid, slotKey, type Piece, type Rot } from "../src/game/pieces";
import { findUnsupported } from "../src/game/structure";

/** Deterministic random numbers so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const snapshot = (state: BuildState) =>
  [...state.all()].map((p) => `${p.id}:${p.type}:${p.x},${p.y},${p.z},${p.rot}:${p.material}:${p.edit}`).sort().join("\n");

/** Every piece owns its slot, and no slot points at a missing piece. */
function checkInvariants(state: BuildState): void {
  const slots = new Set<string>();
  for (const p of state.all()) {
    const key = slotKey(p);
    expect(slots.has(key), `two pieces in ${key}`).toBe(false);
    slots.add(key);
    expect(state.occupant(p)?.id).toBe(p.id);
  }
}

describe("random build sessions", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`keeps the build consistent through random actions (seed ${seed})`, () => {
      const r = rng(seed);
      const state = new BuildState();
      const history = new History(state, 100000);
      let n = 0;
      const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;

      for (let step = 0; step < 3000; step++) {
        const roll = r();
        const pieces = [...state.all()];
        if (roll < 0.5) {
          const type = pick(PIECE_TYPES);
          const spec = { type, x: Math.floor(r() * 6) - 3, y: Math.floor(r() * 3), z: Math.floor(r() * 6) - 3, rot: Math.floor(r() * 4) as Rot };
          if (state.canPlace(spec).ok) {
            const piece: Piece = { ...spec, id: `p${n++}`, material: pick(MATERIALS), edit: 0 };
            expect(history.do({ kind: "place", piece })).toBe(true);
          }
        } else if (roll < 0.65 && pieces.length) {
          const victim = pick(pieces);
          expect(history.do({ kind: "remove", id: victim.id })).toBe(true);
          for (const loose of findUnsupported(state)) expect(history.extend({ kind: "remove", id: loose.id })).toBe(true);
          expect(findUnsupported(state)).toEqual([]);
        } else if (roll < 0.75 && pieces.length) {
          const target = pick(pieces);
          const grid = editGrid(target.type);
          if (grid) {
            const all = (1 << (grid.cols * grid.rows)) - 1;
            const edit = Math.floor(r() * all);
            history.do({ kind: "edit", id: target.id, edit });
          }
        } else if (roll < 0.9) {
          history.undo();
        } else {
          history.redo();
        }
        checkInvariants(state);
      }

      // Undoing everything empties the world; redoing as many steps brings back exactly the same build.
      const final = snapshot(state);
      let undone = 0;
      while (history.undo()) undone++;
      expect(state.size).toBe(0);
      for (let i = 0; i < undone; i++) expect(history.redo()).toBe(true);
      expect(snapshot(state)).toBe(final);
      checkInvariants(state);
    });
  }
});
