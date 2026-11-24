import type { BuildState } from "./buildState";
import { CELL, LEVEL } from "./constants";
import type { Environment } from "./environments";
import type { Piece, PieceSpec } from "./pieces";
import { pieceBounds } from "./trebuchet";

/**
 * Space that nothing can be built into. A siege engine is taller than a
 * storey, so a ceiling one storey over it would pass through it: pieces may
 * not be put where they cut into an engine, and an engine may not be put
 * where pieces cut into it (user, 2026-11-24: "it can be built inside a 1
 * story building with ceiling. So let's not make that possible"). A world's
 * own things (see the `blocks` doors) use the same boxes for theirs.
 */

/** A box in metres: [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Box = readonly [number, number, number, number, number, number];

/** True when two boxes cut into each other by more than `slack` metres every way (touching, or a wall's thickness grazing an edge, does not count). */
export function overlaps(a: Box, b: Box, slack = 0.05): boolean {
  return Math.min(a[3], b[3]) - Math.max(a[0], b[0]) > slack && Math.min(a[4], b[4]) - Math.max(a[1], b[1]) > slack && Math.min(a[5], b[5]) - Math.max(a[2], b[2]) > slack;
}

/** The space a piece would fill, in metres. */
export function solidOf(spec: PieceSpec, env: Environment): Box {
  return spec.type === "trebuchet" ? engineSpace(spec, env) : pieceBounds(spec as Piece, env);
}

/**
 * The space a siege engine fills: its cell, in from the walls that may stand
 * on the cell's edges, from just above the floor it stands on to the top of
 * its frame.
 */
export function engineSpace(t: PieceSpec, env: Environment): Box {
  return [t.x * CELL + 0.3, t.y * LEVEL + 0.3, t.z * CELL + 0.3, (t.x + 1) * CELL - 0.3, t.y * LEVEL + env.siege.launchHeight, (t.z + 1) * CELL - 0.3];
}

/** The pieces that cut into a box. */
export function piecesIn(state: BuildState, box: Box, env: Environment, slack = 0.05): Piece[] {
  const found: Piece[] = [];
  const seen = new Set<string>();
  // (A wall on a cell's far edge belongs to the next cell: one cell further each way.)
  for (let x = Math.floor(box[0] / CELL) - 1; x <= Math.floor(box[3] / CELL) + 1; x++) {
    for (let y = Math.max(0, Math.floor(box[1] / LEVEL) - 1); y <= Math.floor(box[4] / LEVEL) + 1; y++) {
      for (let z = Math.floor(box[2] / CELL) - 1; z <= Math.floor(box[5] / CELL) + 1; z++) {
        for (const p of state.around({ type: "floor", x, y, z, rot: 0 }, 0)) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          if (overlaps(box, solidOf(p, env), slack)) found.push(p);
        }
      }
    }
  }
  return found;
}

/**
 * True when a new piece would cut into a siege engine that stands there, or
 * (a new engine) when something that stands there would cut into it.
 */
export function engineInTheWay(state: BuildState, spec: PieceSpec, env: Environment): boolean {
  if (spec.type === "trebuchet") return piecesIn(state, engineSpace(spec, env), env).length > 0;
  const box = solidOf(spec, env);
  return state.around(spec, 2).some((p) => p.type === "trebuchet" && overlaps(engineSpace(p, env), box));
}
