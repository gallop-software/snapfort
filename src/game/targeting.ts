import { CELL, LEVEL } from "./constants";
import { normalizeSpec, type PieceSpec, type PieceType, type Rot } from "./pieces";

/**
 * Building right in front of the builder, from where they stand and which way
 * they look. Used when the crosshair is not over any slot in reach (see
 * aim.ts), so building on the run and ramp rushing work without aiming.
 */

/** How far ahead of the builder's head the aim point sits, in metres. */
export const BUILD_REACH = CELL * 0.85;
/** Height of the builder's eyes above their feet. */
export const EYE_HEIGHT = 1.6;
/** Looking up far enough that the aim point is this high above the feet builds a storey up. */
const LOOK_UP_RISE = 3.0;

export interface Viewer {
  x: number;
  z: number;
  /** Height of the builder's feet. */
  feetY: number;
  /** View direction, radians; 0 looks toward +z, positive turns toward +x. */
  yaw: number;
  /** View pitch, radians; positive looks down. */
  pitch: number;
  /**
   * How much the ground ahead rises per metre: about +0.75 when running up a
   * ramp, -0.75 running down one, 0 on the flat. Lets a ramp rush continue
   * one storey up.
   */
  slope: number;
}

/** The quarter turn closest to a view yaw (0 = facing +z, 1 = +x, 2 = -z, 3 = -x). */
export function facingRot(yaw: number): Rot {
  const q = Math.round(yaw / (Math.PI / 2));
  return (((q % 4) + 4) % 4) as Rot;
}

/** Avoids -0, which reads oddly and fails strict equality checks. */
const clean = (n: number) => (n === 0 ? 0 : n);

/**
 * - wall: on the first grid line ahead of the builder, facing them.
 * - floor, ramp, roof: in the cell the aim point falls in (yours or the next;
 *   always the next while running up a ramp). Ramps climb away from the
 *   builder, turned by `rotation` quarter turns.
 * - level: where the ground will be when the builder gets there, one storey
 *   higher when looking up.
 */
export function buildTarget(type: PieceType, v: Viewer, rotation = 0): PieceSpec {
  const cp = Math.cos(v.pitch);
  const fx = Math.sin(v.yaw) * cp;
  const fy = -Math.sin(v.pitch);
  const fz = Math.cos(v.yaw) * cp;
  const tx = v.x + fx * BUILD_REACH;
  const ty = v.feetY + EYE_HEIGHT + fy * BUILD_REACH;
  const tz = v.z + fz * BUILD_REACH;

  const q = facingRot(v.yaw);
  const alongX = q === 1 || q === 3;
  const sign = q === 0 || q === 1 ? 1 : -1;
  // Distances along the facing direction, measured with the facing axis pointing forward.
  const along = (alongX ? v.x : v.z) * sign;
  const firstLine = (Math.floor(along / CELL) + 1) * CELL;

  let cx = Math.floor(tx / CELL);
  let cz = Math.floor(tz / CELL);
  // Running up a ramp, the next piece always goes in the cell beyond the one underfoot.
  if (v.slope > 0) {
    if (alongX && cx === Math.floor(v.x / CELL)) cx += sign;
    if (!alongX && cz === Math.floor(v.z / CELL)) cz += sign;
  }
  const targetCell = alongX ? cx : cz;
  const cellNearEdge = sign > 0 ? targetCell * CELL : -(targetCell + 1) * CELL;
  const cellDist = Math.max(0, cellNearEdge - along);

  const up = ty - v.feetY >= LOOK_UP_RISE ? 1 : 0;
  const levelAt = (dist: number) => Math.max(0, Math.floor((v.feetY + v.slope * dist + 0.5) / LEVEL)) + up;

  switch (type) {
    case "wall": {
      const y = levelAt(firstLine - along);
      const line = clean((firstLine * sign) / CELL);
      return alongX ? { type, x: line, y, z: cz, rot: 1 } : { type, x: cx, y, z: line, rot: 0 };
    }
    case "floor":
    case "roof":
      return { type, x: cx, y: levelAt(cellDist), z: cz, rot: 0 };
    case "ramp":
      return normalizeSpec({ type, x: cx, y: levelAt(cellDist), z: cz, rot: ((((q + rotation) % 4) + 4) % 4) as Rot });
    case "trebuchet":
      return { type, x: cx, y: levelAt(cellDist), z: cz, rot: 0 };
  }
}

