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

/**
 * The pieces that fall after `removed` have gone: those around them that no
 * longer connect to the ground. Same answer as findUnsupported when the rest of
 * the world was grounded before, but it only explores outward from the removed
 * pieces and stops as soon as a group reaches the ground, so it stays quick in
 * a big shared world.
 */
export function findLooseAfterRemoval(state: BuildState, removed: readonly Piece[]): Piece[] {
  const grounded = new Set<string>();
  const loose = new Map<string, Piece>();
  for (const gone of removed) {
    for (const start of state.touching(gone)) {
      if (grounded.has(start.id) || loose.has(start.id) || !state.get(start.id)) continue;
      // Explore the group this neighbour belongs to until something in it stands on the ground.
      const seen = new Map<string, Piece>([[start.id, start]]);
      const queue: Piece[] = [start];
      let reachesGround = false;
      for (let piece = queue.pop(); piece; piece = queue.pop()) {
        if (gridBox(piece)[1] === 0 || grounded.has(piece.id)) {
          reachesGround = true;
          break;
        }
        for (const other of state.touching(piece)) {
          if (!seen.has(other.id)) {
            seen.set(other.id, other);
            queue.push(other);
          }
        }
      }
      for (const [id, piece] of seen) {
        if (reachesGround) grounded.add(id);
        else loose.set(id, piece);
      }
    }
  }
  return [...loose.values()];
}
