import { CELL, LEVEL, MAX_LEVEL, WORLD_HALF_CELLS } from "./constants";

/**
 * Piece definitions and grid rules. No rendering in here: this module is shared
 * by the game, the unit tests and (later) a multiplayer server.
 */

/** New types go on the end: the position in this list is how pieces are saved and sent. */
export const PIECE_TYPES = ["wall", "floor", "ramp", "roof", "trebuchet"] as const;
export type PieceType = (typeof PIECE_TYPES)[number];

/** Quarter turns about the vertical axis. */
export type Rot = 0 | 1 | 2 | 3;

/**
 * Where a piece sits. x, y, z are whole grid cells (y is the storey).
 *
 * - wall: stands on an edge of the cell. rot 0 = the edge at the cell's low z side
 *   (the wall runs along x); rot 1 = the edge at the low x side (runs along z).
 * - floor: a slab on the bottom face of the cell.
 * - ramp: fills the cell and climbs one storey. rot 0 climbs toward +z, 1 toward +x,
 *   2 toward -z, 3 toward -x.
 * - roof: a four-sided cone filling the cell.
 * - trebuchet: a siege engine filling the cell, standing on a floor or the
 *   ground. It turns on its base toward whatever it aims at, so it has no rotation.
 */
export interface PieceSpec {
  type: PieceType;
  x: number;
  y: number;
  z: number;
  rot: Rot;
}

export const MATERIALS = ["wood", "brick", "metal"] as const;
export type MaterialId = (typeof MATERIALS)[number];

export interface MaterialDef {
  label: string;
  /** Base colour, RGB 0..1. */
  color: readonly [number, number, number];
}

export const MATERIAL_DEFS: Record<MaterialId, MaterialDef> = {
  wood: { label: "Wood", color: [0.86, 0.63, 0.4] },
  brick: { label: "Brick", color: [0.8, 0.45, 0.36] },
  metal: { label: "Metal", color: [0.63, 0.69, 0.75] },
};

export interface Piece extends PieceSpec {
  id: string;
  material: MaterialId;
  /** Edited-out tiles, one bit per tile (see editGrid). 0 = the whole piece. */
  edit: number;
}

export interface PieceDef {
  type: PieceType;
  label: string;
  /** How many distinct rotations the piece has. */
  rotations: 1 | 2 | 4;
}

export const PIECE_DEFS: Record<PieceType, PieceDef> = {
  wall: { type: "wall", label: "Wall", rotations: 2 },
  floor: { type: "floor", label: "Floor", rotations: 1 },
  ramp: { type: "ramp", label: "Ramp", rotations: 4 },
  roof: { type: "roof", label: "Roof", rotations: 1 },
  trebuchet: { type: "trebuchet", label: "Trebuchet", rotations: 1 },
};

/**
 * Editing splits a piece into tiles that can be cut out: walls into 3 x 3
 * (cut a window or a door), floors into 2 x 2. Tile i is column i % cols,
 * row floor(i / cols), counted from the piece's own low x and low y (walls) or
 * low z (floors).
 */
export function editGrid(type: PieceType): { cols: number; rows: number } | null {
  if (type === "wall") return { cols: 3, rows: 3 };
  if (type === "floor") return { cols: 2, rows: 2 };
  return null;
}

/** An edit is valid when it names existing tiles and leaves at least one. */
export function isValidEdit(type: PieceType, edit: number): boolean {
  if (edit === 0) return true;
  const grid = editGrid(type);
  if (!grid || !Number.isInteger(edit) || edit < 0) return false;
  return edit < (1 << (grid.cols * grid.rows)) - 1;
}

export function isMaterial(value: unknown): value is MaterialId {
  return typeof value === "string" && (MATERIALS as readonly string[]).includes(value);
}

/** Folds equivalent rotations together so the same placement always has the same spec. */
export function normalizeSpec(spec: PieceSpec): PieceSpec {
  const n = PIECE_DEFS[spec.type].rotations;
  const rot = ((((spec.rot % n) + n) % n) as Rot);
  return { type: spec.type, x: spec.x, y: spec.y, z: spec.z, rot };
}

/**
 * The slot a piece occupies. Two pieces may not share a slot.
 * Ramps and roofs share the cell-volume slot; walls own an edge; floors a face.
 */
export function slotKey(spec: PieceSpec): string {
  const s = normalizeSpec(spec);
  const kind = s.type === "wall" ? (s.rot === 0 ? "wx" : "wz") : s.type === "floor" ? "f" : "v";
  return `${kind}|${s.x}|${s.y}|${s.z}`;
}

export function inBounds(spec: PieceSpec): boolean {
  if (!Number.isInteger(spec.x) || !Number.isInteger(spec.y) || !Number.isInteger(spec.z)) return false;
  if (spec.y < 0 || spec.y > MAX_LEVEL) return false;
  // A wall on the far edge of the last cell is addressed as the low edge of cell + 1.
  const s = normalizeSpec(spec);
  const maxX = WORLD_HALF_CELLS - 1 + (s.type === "wall" && s.rot === 1 ? 1 : 0);
  const maxZ = WORLD_HALF_CELLS - 1 + (s.type === "wall" && s.rot === 0 ? 1 : 0);
  return s.x >= -WORLD_HALF_CELLS && s.x <= maxX && s.z >= -WORLD_HALF_CELLS && s.z <= maxZ;
}

/** Extent of a piece in grid units: [minX, minY, minZ, maxX, maxY, maxZ]. */
export type GridBox = readonly [number, number, number, number, number, number];

export function gridBox(spec: PieceSpec): GridBox {
  const s = normalizeSpec(spec);
  const { x, y, z } = s;
  switch (s.type) {
    case "floor":
      return [x, y, z, x + 1, y, z + 1];
    case "wall":
      return s.rot === 0 ? [x, y, z, x + 1, y + 1, z] : [x, y, z, x, y + 1, z + 1];
    default:
      return [x, y, z, x + 1, y + 1, z + 1];
  }
}

/** True when two boxes overlap or share a face, edge or corner. */
export function boxesTouch(a: GridBox, b: GridBox): boolean {
  return a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
}

/** World placement of a piece: the origin of its mesh (bottom centre) and its yaw in radians. */
export interface PieceTransform {
  px: number;
  py: number;
  pz: number;
  yaw: number;
}

export function pieceTransform(spec: PieceSpec): PieceTransform {
  const s = normalizeSpec(spec);
  const py = s.y * LEVEL;
  if (s.type === "wall") {
    return s.rot === 0
      ? { px: (s.x + 0.5) * CELL, py, pz: s.z * CELL, yaw: 0 }
      : { px: s.x * CELL, py, pz: (s.z + 0.5) * CELL, yaw: Math.PI / 2 };
  }
  return { px: (s.x + 0.5) * CELL, py, pz: (s.z + 0.5) * CELL, yaw: (s.rot * Math.PI) / 2 };
}
