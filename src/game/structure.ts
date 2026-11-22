import type { BuildState } from "./buildState";
import { gridBox, type Piece } from "./pieces";

/**
 * Pieces that no longer connect to the ground through other pieces.
 * Used in siege mode, where knocking out the bottom of a fort brings the rest down.
 */
export function findUnsupported(state: BuildState): Piece[] {
  const grounded = new Set<string>();
  const queue: Piece[] = [];
  for (const piece of state.all()) {
    if (gridBox(piece)[1] === 0) {
      grounded.add(piece.id);
      queue.push(piece);
    }
  }
  for (let piece = queue.pop(); piece; piece = queue.pop()) {
    for (const other of state.touching(piece)) {
      if (!grounded.has(other.id)) {
        grounded.add(other.id);
        queue.push(other);
      }
    }
  }
  const loose: Piece[] = [];
  for (const piece of state.all()) if (!grounded.has(piece.id)) loose.push(piece);
  return loose;
}
