import type { BuildOp, BuildState } from "../game/buildState";
import type { Piece } from "../game/pieces";
import { findLooseAfterRemoval } from "../game/structure";

export interface ActionResult {
  /** Operations taken, with what undoes each, in order. */
  done: { index: number; op: BuildOp; inverse: BuildOp }[];
  /** Indexes of operations refused, ascending. */
  rejected: number[];
  /** Pieces that fell because the action took away what held them up. */
  extra: { op: BuildOp; inverse: BuildOp }[];
}

/**
 * The shared world's rules for one action from a builder, used by the server
 * (and by the tests, to stand in for it). Each operation is applied in order;
 * one that does not fit is refused. Then every new piece must rest on the
 * ground or touch another piece once the whole action is in, so undoing a
 * collapse (which puts the top back first) still works. Last, whatever lost
 * its connection to the ground falls.
 */
export function applyAction(
  state: BuildState,
  ops: readonly (BuildOp | null)[],
  canAdd: (piece: Piece) => boolean = () => true,
  /** Whether this builder may remove or edit that piece (a world may say whose it is). */
  canChange: (piece: Piece, kind: "remove" | "edit") => boolean = () => true,
): ActionResult {
  const done: ActionResult["done"] = [];
  const rejected: number[] = [];
  ops.forEach((op, index) => {
    const mine = !op || op.kind === "place" || (() => {
      const piece = state.get(op.id);
      return !piece || canChange(piece, op.kind);
    })();
    const inverse = op && mine && !(op.kind === "place" && !canAdd(op.piece)) ? state.apply(op) : null;
    if (op && inverse) done.push({ index, op, inverse });
    else rejected.push(index);
  });

  // Taking out one unsupported piece can strand another, so repeat until settled.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = done.length - 1; i >= 0; i--) {
      const { op, inverse, index } = done[i]!;
      if (op.kind !== "place") continue;
      const piece = state.get(op.piece.id);
      if (piece && !state.isSupported(piece)) {
        state.apply(inverse);
        done.splice(i, 1);
        rejected.push(index);
        changed = true;
      }
    }
  }

  const removed = done.flatMap((d) => (d.inverse.kind === "place" ? [d.inverse.piece] : []));
  const extra: ActionResult["extra"] = [];
  if (removed.length > 0) {
    for (const piece of findLooseAfterRemoval(state, removed)) {
      const op: BuildOp = { kind: "remove", id: piece.id };
      const inverse = state.apply(op);
      if (inverse) extra.push({ op, inverse });
    }
  }
  rejected.sort((a, b) => a - b);
  return { done, rejected, extra };
}
