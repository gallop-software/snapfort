import { CELL, LEVEL, MAX_LEVEL } from "./constants";
import { normalizeSpec, type Piece, type PieceSpec, type PieceType, type Rot } from "./pieces";
import { buildTarget, facingRot, type Viewer } from "./targeting";

/**
 * Crosshair aiming. A line runs straight out from the crosshair; the target is
 * the first slot for the selected piece that the line passes over:
 *
 * - walls: the vertical panes on the grid lines across the view direction
 *   (panes facing the builder),
 * - floors: the horizontal panes at every storey height (the ground is storey 0),
 * - ramps: the cell where the line meets something solid,
 * - roofs: the highest buildable cell the line passes through (so looking up
 *   past the top of a tall wall caps it), or the cell where the line meets
 *   something solid when that is as high.
 *
 * A piece of the same kind under the crosshair is its own slot ("it is already
 * there"). Anything solid stops the line, so hidden slots cannot be targeted.
 * When no slot is in reach (looking at the sky, say), the piece goes right in
 * front of the builder instead (see buildTarget), which keeps building on the
 * run and ramp rushing working.
 */

/** How far along the crosshair line a wall or floor pane can be targeted, in metres. */
export const PANE_REACH = 12;
/** How far along the crosshair line a ramp or roof spot can be targeted, in metres. */
export const CELL_REACH = 8;
/** How far along the crosshair line a roof can be targeted, in metres (high enough to cap two storeys). */
export const ROOF_REACH = 12;
/** Panes closer than this to the start of the line (the builder's shoulder) are ignored. */
const MIN_DIST = 0.5;
/** A surface lying exactly where the line stops (the ground under a floor pane) still counts. */
const SURFACE_SLACK = 0.06;

export interface AimRay {
  /** Start of the line: on the camera's line of sight, beside the builder's head. */
  ox: number;
  oy: number;
  oz: number;
  /** Unit direction of the crosshair. */
  dx: number;
  dy: number;
  dz: number;
}

/** What the crosshair line first hits, from the physics world. */
export interface AimHit {
  dist: number;
  /** The piece hit, if it was a piece (not the ground). */
  piece?: Piece;
}

export interface AimResult {
  spec: PieceSpec;
  /** "crosshair": the slot under the crosshair. "front": nothing in reach, so right in front. */
  source: "crosshair" | "front";
}

const sameKind = (a: PieceType, b: PieceType) =>
  a === b || ((a === "ramp" || a === "roof") && (b === "ramp" || b === "roof"));

/** The first wall pane the line crosses between `from` and `to` metres along it. */
function firstWallPane(r: AimRay, from: number, to: number): { t: number; spec: PieceSpec } | null {
  let best: { t: number; spec: PieceSpec } | null = null;
  const tryAxis = (o: number, d: number, alongX: boolean) => {
    if (Math.abs(d) < 1e-6) return;
    const step = d > 0 ? 1 : -1;
    // Grid lines from the first one ahead of the start, in the direction of travel.
    let k = d > 0 ? Math.floor(o / CELL) + 1 : Math.ceil(o / CELL) - 1;
    if (Math.abs(o - (k - step) * CELL) < 1e-9) k -= step;
    for (;; k += step) {
      const t = (k * CELL - o) / d;
      if (t > to || (best && t >= best.t)) return;
      if (t < from) continue;
      const y = r.oy + r.dy * t;
      if (y < 0) continue;
      const level = Math.floor(y / LEVEL);
      if (level > MAX_LEVEL) continue;
      const x = r.ox + r.dx * t, z = r.oz + r.dz * t;
      const spec: PieceSpec = alongX
        ? { type: "wall", x: k, y: level, z: Math.floor(z / CELL), rot: 1 }
        : { type: "wall", x: Math.floor(x / CELL), y: level, z: k, rot: 0 };
      best = { t, spec };
      return;
    }
  };
  // Only panes that face the builder: the grid lines across the view direction.
  // Panes seen edge-on are skipped, so pointing past the end of a wall finds
  // the next wall along it rather than a side pane running toward you.
  if (Math.abs(r.dx) > Math.abs(r.dz)) tryAxis(r.ox, r.dx, true);
  else tryAxis(r.oz, r.dz, false);
  return best;
}

/** The first floor pane (storey height) the line crosses between `from` and `to` metres along it. */
function firstFloorPane(r: AimRay, from: number, to: number): { t: number; spec: PieceSpec } | null {
  if (Math.abs(r.dy) < 1e-6) return null;
  const step = r.dy > 0 ? 1 : -1;
  let l = r.dy > 0 ? Math.floor(r.oy / LEVEL) + 1 : Math.ceil(r.oy / LEVEL) - 1;
  if (Math.abs(r.oy - (l - step) * LEVEL) < 1e-9) l -= step;
  for (; l >= 0 && l <= MAX_LEVEL; l += step) {
    const t = (l * LEVEL - r.oy) / r.dy;
    if (t > to) return null;
    if (t < from) continue;
    const x = r.ox + r.dx * t, z = r.oz + r.dz * t;
    return { t, spec: { type: "floor", x: Math.floor(x / CELL), y: l, z: Math.floor(z / CELL), rot: 0 } };
  }
  return null;
}

/** Height of the builder's body, for keeping roofs out of the cells they stand in. */
const BODY_HEIGHT = 1.8;

/**
 * How firmly a piece would sit at a spot: null when it cannot be built there,
 * otherwise a number that grows with what holds it up (the game passes how many
 * pieces it would touch).
 */
export type PlaceScore = (spec: PieceSpec) => number | null;

/**
 * The highest cell along the line where a roof could go; among equally high
 * cells the best supported (on top of a tower rather than hanging off one wall
 * edge), then the nearest. Skips the cells the builder's body is in.
 */
function highestRoofCell(r: AimRay, stop: number, viewer: Viewer, score: PlaceScore): PieceSpec | null {
  const bodyX = Math.floor(viewer.x / CELL), bodyZ = Math.floor(viewer.z / CELL);
  const bodyLow = Math.floor(viewer.feetY / LEVEL), bodyHigh = Math.floor((viewer.feetY + BODY_HEIGHT) / LEVEL);
  let best: PieceSpec | null = null;
  let bestScore = -Infinity;
  let last = "";
  for (let t = MIN_DIST; t <= stop; t += 0.2) {
    const y = r.oy + r.dy * t;
    if (y < 0) break;
    const spec: PieceSpec = { type: "roof", x: Math.floor((r.ox + r.dx * t) / CELL), y: Math.floor(y / LEVEL), z: Math.floor((r.oz + r.dz * t) / CELL), rot: 0 };
    const key = `${spec.x}|${spec.y}|${spec.z}`;
    if (key === last) continue;
    last = key;
    if (spec.x === bodyX && spec.z === bodyZ && spec.y >= bodyLow && spec.y <= bodyHigh) continue;
    if (best && spec.y < best.y) continue;
    const sc = score(spec);
    if (sc === null) continue;
    if (!best || spec.y > best.y || sc > bestScore) {
      best = spec;
      bestScore = sc;
    }
  }
  return best;
}

export function aimTarget(
  type: PieceType,
  r: AimRay,
  hit: AimHit | null,
  viewer: Viewer,
  rotation = 0,
  score: PlaceScore = () => 0,
): AimResult {
  const front = (): AimResult => ({ spec: buildTarget(type, viewer, rotation), source: "front" });
  // A piece of the same kind under the crosshair is the target: it is already there.
  if (hit?.piece && sameKind(hit.piece.type, type)) {
    // Roofs: an existing roof (or ramp) under the crosshair counts at any distance,
    // so a roof just built high up is never mistaken for room to build beneath it.
    const reach = type === "wall" || type === "floor" ? PANE_REACH : type === "roof" ? Infinity : CELL_REACH;
    if (hit.dist <= reach) {
      const p = hit.piece;
      return { spec: { type, x: p.x, y: p.y, z: p.z, rot: type === "wall" ? p.rot : type === "ramp" ? rampRot(viewer.yaw, rotation) : 0 }, source: "crosshair" };
    }
  }

  if (type === "wall" || type === "floor") {
    const stop = Math.min(PANE_REACH, hit ? hit.dist + SURFACE_SLACK : Infinity);
    const pane = type === "wall" ? firstWallPane(r, MIN_DIST, stop) : firstFloorPane(r, MIN_DIST, stop);
    return pane ? { spec: normalizeSpec(pane.spec), source: "crosshair" } : front();
  }

  // Ramps and roofs fill a cell: the cell just in front of whatever the crosshair touches.
  const reach = type === "roof" ? ROOF_REACH : CELL_REACH;
  let touched: PieceSpec | null = null;
  if (hit && hit.dist <= reach) {
    const t = Math.max(0, hit.dist - 0.05);
    const x = r.ox + r.dx * t, y = r.oy + r.dy * t, z = r.oz + r.dz * t;
    touched = normalizeSpec({ type, x: Math.floor(x / CELL), y: Math.max(0, Math.floor(y / LEVEL)), z: Math.floor(z / CELL), rot: type === "ramp" ? rampRot(viewer.yaw, rotation) : 0 });
  }
  if (type === "roof") {
    // A roof caps things: prefer the highest buildable cell the crosshair passes
    // through, unless the spot the crosshair touches is just as high.
    const high = highestRoofCell(r, Math.min(reach, hit ? hit.dist : Infinity), viewer, score);
    if (high && (!touched || high.y > touched.y || score(touched) === null)) return { spec: high, source: "crosshair" };
  }
  return touched ? { spec: touched, source: "crosshair" } : front();
}

function rampRot(yaw: number, rotation: number): Rot {
  return ((((facingRot(yaw) + rotation) % 4) + 4) % 4) as Rot;
}
