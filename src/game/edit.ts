import { CELL, LEVEL } from "./constants";
import { editGrid, pieceTransform, type Piece } from "./pieces";

/**
 * The edit tile of `piece` a ray passes through, or -1. The ray starts at
 * (ox, oy, oz), runs along the unit vector (dx, dy, dz) and stops after maxDist.
 * Walls are hit on their centre plane, floors on theirs.
 */
export function editTileAt(
  piece: Piece,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): number {
  const grid = editGrid(piece.type);
  if (!grid) return -1;
  const t = pieceTransform(piece);
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  // Into the piece's own frame (inverse of a turn by yaw about the vertical axis).
  const rx = ox - t.px, ry = oy - t.py, rz = oz - t.pz;
  const lox = rx * c - rz * s, loy = ry, loz = rx * s + rz * c;
  const ldx = dx * c - dz * s, ldy = dy, ldz = dx * s + dz * c;
  const h = CELL / 2;

  if (piece.type === "wall") {
    if (Math.abs(ldz) < 1e-6) return -1;
    const d = -loz / ldz;
    if (d < 0 || d > maxDist) return -1;
    const u = lox + ldx * d + h, w = loy + ldy * d;
    if (u < 0 || u >= CELL || w < 0 || w >= LEVEL) return -1;
    return Math.floor(w / (LEVEL / grid.rows)) * grid.cols + Math.floor(u / (CELL / grid.cols));
  }
  if (Math.abs(ldy) < 1e-6) return -1;
  const d = -loy / ldy;
  if (d < 0 || d > maxDist) return -1;
  const u = lox + ldx * d + h, w = loz + ldz * d + h;
  if (u < 0 || u >= CELL || w < 0 || w >= CELL) return -1;
  return Math.floor(w / (CELL / grid.rows)) * grid.cols + Math.floor(u / (CELL / grid.cols));
}
