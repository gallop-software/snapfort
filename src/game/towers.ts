import type { BuildState } from "./buildState";
import { CELL, LEVEL } from "./constants";
import { gridBox, type Piece } from "./pieces";

/**
 * A structure, for the race to be tallest: pieces that touch, or stand within
 * one cell of each other, count as one, so a wall standing inside a fort is
 * part of the fort. (What holds what up is stricter: see structure.ts.)
 */
export interface Tower {
  /** Height of its top above the ground, in metres. */
  height: number;
  /** Where its top is (centre of the highest piece), metres. */
  top: [number, number, number];
  pieces: number;
}

/** Fewer pieces than this is a hut, not a tower. */
const MIN_PIECES = 3;

/** Pieces this many grid units apart or less belong to the same structure. */
const JOIN_GAP = 1;

/** True when two pieces are within JOIN_GAP grid units of each other on every axis. */
function near(a: Piece, b: Piece): boolean {
  const A = gridBox(a), B = gridBox(b);
  return A[0] - JOIN_GAP <= B[3] && B[0] - JOIN_GAP <= A[3] && A[1] - JOIN_GAP <= B[4] && B[1] - JOIN_GAP <= A[4] && A[2] - JOIN_GAP <= B[5] && B[2] - JOIN_GAP <= A[5];
}

/**
 * Every structure that reaches the ground, tallest first (up to `limit`).
 * Trebuchets do not join structures or count toward height.
 */
export function measureTowers(state: BuildState, limit = 5): Tower[] {
  const done = new Set<string>();
  const towers: Tower[] = [];
  for (const start of state.all()) {
    if (done.has(start.id) || start.type === "trebuchet") continue;
    let count = 0;
    let best: Piece = start;
    let bestTop = -1;
    let grounded = false;
    const queue: Piece[] = [start];
    done.add(start.id);
    for (let p = queue.pop(); p; p = queue.pop()) {
      count++;
      if (gridBox(p)[1] === 0) grounded = true;
      const top = gridBox(p)[4];
      if (top > bestTop) {
        bestTop = top;
        best = p;
      }
      for (const other of state.around(p, JOIN_GAP + 1)) {
        if (other.type === "trebuchet" || done.has(other.id) || !near(p, other)) continue;
        done.add(other.id);
        queue.push(other);
      }
    }
    if (count < MIN_PIECES || !grounded) continue;
    const b = gridBox(best);
    towers.push({
      height: bestTop * LEVEL,
      top: [((b[0] + b[3]) / 2) * CELL, bestTop * LEVEL, ((b[2] + b[5]) / 2) * CELL],
      pieces: count,
    });
  }
  towers.sort((a, b) => b.height - a.height || b.pieces - a.pieces);
  return towers.slice(0, limit);
}
