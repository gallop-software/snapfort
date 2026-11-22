import type { BuildOp } from "../game/buildState";
import { MATERIALS, PIECE_TYPES, type Piece, type Rot } from "../game/pieces";

/**
 * Messages between the game and the shared world (the World Durable Object).
 * Plain JSON over one WebSocket. Pieces and moves travel as short arrays, not
 * objects, so a snapshot of a big world stays small.
 */

/** Bump when the messages change in a way older pages cannot read. */
export const PROTOCOL_VERSION = 2;

/** Pieces are grouped in square chunks of this many cells, for saving (and later streaming). */
export const CHUNK_CELLS = 16;

export const chunkOf = (x: number, z: number): string => `${Math.floor(x / CHUNK_CELLS)},${Math.floor(z / CHUNK_CELLS)}`;

/** [id, type index, x, y, z, rot, material index, edit] */
export type WirePiece = [string, number, number, number, number, number, number, number];

/** ["p", piece] place · ["r", id] remove · ["e", id, edit] edit */
export type WireOp = ["p", WirePiece] | ["r", string] | ["e", string, number];

/** A builder: id, name and colour ("#rrggbb"). */
export interface WirePlayer {
  id: string;
  name: string;
  color: string;
}

/** Where a builder is: [id, x, y, z, yaw, flags]. Positions in centimetres, yaw in milliradians. Flags: 1 = on the ground, 2 = thrown (tumbling). */
export type WireMove = [string, number, number, number, number, number];

/** A point in metres. */
export type WireVec = [number, number, number];

/** A standing structure: [height m, top x, top y, top z, pieces]. */
export type WireTower = [number, number, number, number, number];

export type ClientMessage =
  /** Get on trebuchet `id`, standing at `at`. */
  | { t: "board"; id: string; at: WireVec }
  | { t: "leave" }
  /** Throw from the trebuchet you are on at point `to`. */
  | { t: "fire"; id: string; to: WireVec }
  | { t: "hello"; v: number; name: string; color: string }
  | { t: "act"; seq: number; ops: WireOp[] }
  /** [x, y, z, yaw, flags], encoded like WireMove without the id. */
  | { t: "move"; m: [number, number, number, number, number] }
  | { t: "name"; name: string; color: string }
  /** Asks for the whole world again (after the game lost track of it). */
  | { t: "sync" };

export type ServerMessage =
  /** You joined: your id (also the prefix for ids of pieces you make), the whole world and who is here. */
  | {
      t: "welcome";
      you: string;
      pieces: WirePiece[];
      players: WirePlayer[];
      moves: WireMove[];
      /** Who is on which trebuchet: [trebuchet id, builder id]. */
      crews: [string, string][];
      /** Hits taken by damaged pieces: [piece id, hits]. */
      damage: [string, number][];
      towers: WireTower[];
    }
  /** Trebuchet `id` now has builder `by` on it (null: nobody). */
  | { t: "crew"; id: string; by: string | null }
  /** A stone is thrown: it flies from `from` through `to` (see planFlight). */
  | { t: "shot"; shot: number; id: string; by: string; from: WireVec; to: WireVec }
  /**
   * Stone `shot` landed at `point`. `ops` removes what broke and what fell;
   * `fallen` lists the pieces that fell (rather than broke); `damage` the new
   * hits of pieces that held.
   */
  | { t: "impact"; shot: number; point: WireVec; ops: WireOp[]; fallen: string[]; damage: [string, number][] }
  /** The tallest standing structures, tallest first. */
  | { t: "towers"; list: WireTower[] }
  /** A board or fire request was turned down. */
  | { t: "denied"; reason: "busy" | "far" | "near" | "range" | "reload" | "gone" }
  | { t: "snap"; pieces: WirePiece[] }
  /** Someone else changed the world. */
  | { t: "ops"; by: string; ops: WireOp[] }
  /**
   * The world took your action `seq`: `rejected` lists the indexes of operations
   * it refused, `extra` what it also did (pieces that fell).
   */
  | { t: "ack"; seq: number; rejected: number[]; extra: WireOp[] }
  | { t: "join"; player: WirePlayer }
  | { t: "leave"; id: string }
  | { t: "moves"; m: WireMove[] }
  | { t: "error"; reason: "full" | "version" | "bad" };

export function encodePiece(p: Piece): WirePiece {
  return [p.id, PIECE_TYPES.indexOf(p.type), p.x, p.y, p.z, p.rot, MATERIALS.indexOf(p.material), p.edit];
}

const ID = /^[a-z0-9-]{1,24}$/;
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Reads a piece, or null when it is malformed. (Grid rules are checked by BuildState.) */
export function decodePiece(w: unknown): Piece | null {
  if (!Array.isArray(w) || w.length !== 8) return null;
  const [id, t, x, y, z, rot, m, edit] = w as unknown[];
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (![t, x, y, z, rot, m, edit].every(isInt)) return null;
  const type = PIECE_TYPES[t as number];
  const material = MATERIALS[m as number];
  if (!type || !material || (rot as number) < 0 || (rot as number) > 3) return null;
  return { id, type, x: x as number, y: y as number, z: z as number, rot: rot as Rot, material, edit: edit as number };
}

export function encodeOp(op: BuildOp): WireOp {
  if (op.kind === "place") return ["p", encodePiece(op.piece)];
  if (op.kind === "remove") return ["r", op.id];
  return ["e", op.id, op.edit];
}

export function decodeOp(w: unknown): BuildOp | null {
  if (!Array.isArray(w)) return null;
  const [kind, a, b] = w as unknown[];
  if (kind === "p" && w.length === 2) {
    const piece = decodePiece(a);
    return piece ? { kind: "place", piece } : null;
  }
  if (typeof a !== "string" || !ID.test(a)) return null;
  if (kind === "r" && w.length === 2) return { kind: "remove", id: a };
  if (kind === "e" && w.length === 3 && isInt(b)) return { kind: "edit", id: a, edit: b };
  return null;
}

/** Decodes a list of operations, dropping malformed ones. */
export const decodeOps = (list: readonly WireOp[]): BuildOp[] => list.map(decodeOp).filter((op): op is BuildOp => op !== null);

export const decodePieces = (list: readonly WirePiece[]): Piece[] => list.map(decodePiece).filter((p): p is Piece => p !== null);

export const NAME_MAX = 20;

/** A display name made safe: letters, digits, spaces and a little punctuation, at most NAME_MAX characters. */
export function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^\p{L}\p{N} _.'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

export function cleanColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#f07356";
}
