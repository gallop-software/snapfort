import type { BuildState } from "./buildState";
import { CELL, LEVEL } from "./constants";
import { gridBox, type Piece } from "./pieces";

/** A standing structure: a group of pieces joined together and to the ground. */
export interface Tower {
  /** Height of its top above the ground, in metres. */
  height: number;
  /** Where its top is (centre of the highest piece), metres. */
  top: [number, number, number];
  pieces: number;
}

/** Fewer pieces than this is a hut, not a tower. */
const MIN_PIECES = 3;

/**
 * Every standing structure, tallest first (up to `limit`). Trebuchets do not
 * join structures or count toward height.
 */
export function measureTowers(state: BuildState, limit = 5): Tower[] {
  const done = new Set<string>();
  const towers: Tower[] = [];
  for (const start of state.all()) {
    if (done.has(start.id) || start.type === "trebuchet" || gridBox(start)[1] !== 0) continue;
    let count = 0;
    let best: Piece = start;
    let bestTop = -1;
    const queue: Piece[] = [start];
    done.add(start.id);
    for (let p = queue.pop(); p; p = queue.pop()) {
      count++;
      const top = gridBox(p)[4];
      if (top > bestTop) {
        bestTop = top;
        best = p;
      }
      for (const other of state.touching(p)) {
        if (other.type === "trebuchet" || done.has(other.id)) continue;
        done.add(other.id);
        queue.push(other);
      }
    }
    if (count < MIN_PIECES) continue;
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
