import type { BuildOp } from "../game/buildState";
import { MATERIALS, PIECE_TYPES, type Piece, type Rot } from "../game/pieces";
import type { ChatTo } from "./chat";

/**
 * Messages between the game and the shared world (the World Durable Object).
 * Plain JSON over one WebSocket. Pieces and moves travel as short arrays, not
 * objects, so a snapshot of a big world stays small.
 */

/** Bump when the messages change in a way older pages cannot read. */
export const PROTOCOL_VERSION = 3;

declare const __BUILD_ID__: string | undefined;
/**
 * The build this page or server came from (set by Vite at build time). A page
 * from another build than the server's is told to restart: it keeps watching
 * the world but cannot move or build until it reloads.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/**
 * True when build `a` is older than build `b`. Builds are times (YYYYMMDDHHMMSS),
 * so they compare as text. Only an older page is told to restart: for a minute
 * after a deploy a world may still run the old code while pages already have
 * the new one, and those should just wait for it.
 */
export const olderBuild = (a: string, b: string): boolean => /^\d{14}$/.test(a) && /^\d{14}$/.test(b) && a < b;

/** Pieces are grouped in square chunks of this many cells, for saving (and later streaming). */
export const CHUNK_CELLS = 16;

export const chunkOf = (x: number, z: number): string => `${Math.floor(x / CHUNK_CELLS)},${Math.floor(z / CHUNK_CELLS)}`;

/** [id, type index, x, y, z, rot, material index, edit] */
export type WirePiece = [string, number, number, number, number, number, number, number];

/** ["p", piece] place · ["r", id] remove · ["e", id, edit] edit */
export type WireOp = ["p", WirePiece] | ["r", string] | ["e", string, number];

/**
 * Why a player with a good key has no seat on it (in a paid world they visit;
 * in a free one they play free): "full", every seat of the key was already in
 * use when they came; "elsewhere", their seat was taken by another device (or
 * the key was replaced).
 */
export type SeatReason = "elsewhere" | "full";

/** A builder: id, name and colour ("#rrggbb"). */
export interface WirePlayer {
  id: string;
  name: string;
  color: string;
}

/** Where a builder is: [id, x, y, z, yaw, flags]. Positions in centimetres, yaw in milliradians. Flags: 1 = on the ground, 2 = thrown (tumbling), 4 = flying under their own control (a world's rockets, say). */
export type WireMove = [string, number, number, number, number, number];

/** A point in metres. */
export type WireVec = [number, number, number];

/**
 * Something a builder said (already filtered by the server): to builders near
 * them or to everyone, and for nearby messages perhaps pinned to a spot `at`.
 * An empty `text` with a spot is a ping. Name and colour travel with it, so a
 * line still reads right after the speaker has left.
 */
export interface WireSaid {
  by: string;
  name: string;
  color: string;
  text: string;
  to: ChatTo;
  at?: WireVec;
}

export type ClientMessage =
  /** Get on trebuchet `id`, standing at `at`. */
  | { t: "board"; id: string; at: WireVec }
  | { t: "leave" }
  /** Throw from the trebuchet you are on at point `to`. */
  | { t: "fire"; id: string; to: WireVec }
  /** Joins the world; `key` (a SnapFort key) lets its owner build in a paid world. */
  | {
      t: "hello";
      v: number;
      name: string;
      color: string;
      key?: string;
      /** The page's build (BUILD_ID). */
      build?: string;
      /** This browser tab, the same across reloads and world switches: joining again replaces its old connection. */
      tab?: string;
    }
  /**
   * A key bought or typed in while here: asks again whether building is open.
   * `take`: with every seat of the key in use, take the seat of whoever has
   * played longest ("Use it here"). No key (null): it was removed from this
   * device, so its seat is free.
   */
  | { t: "key"; key: string | null; take?: boolean }
  | { t: "act"; seq: number; ops: WireOp[] }
  /** [x, y, z, yaw, flags], encoded like WireMove without the id. */
  | { t: "move"; m: [number, number, number, number, number] }
  | { t: "name"; name: string; color: string }
  /** Asks for the whole world again (after the game lost track of it). */
  | { t: "sync" }
  /** Says something (see WireSaid); an empty text with a spot `at` is a ping. */
  | { t: "say"; text: string; to: ChatTo; at?: WireVec }
  /** A world's own message, from its page half to its server half: the shared code only carries it. */
  | { t: "w"; d: unknown };

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
      /** World-wide lines from the last few seconds, oldest first. */
      chat?: WireSaid[];
      /** Which world this is (its id). */
      env?: string;
      /** May you build here (false: visiting a paid world without the Full Game). */
      builder?: boolean;
      /** No seat because every seat of your key is in use (a paid world: visiting; a free one: playing free); and how many seats it has. */
      full?: boolean;
      seats?: number;
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
  /**
   * Builder `id` is thrown (by a trebuchet hit) or falls (what they stood on
   * went): their body's centre follows `path` (a point every tenth of a
   * second), comes down at `land` after `time` seconds, lies there a moment and
   * gets up. Every page plays it, so it happens even with their tab hidden.
   */
  | { t: "thrown"; id: string; path: WireVec[]; time: number; land: WireVec; /** Flying down under control from this many seconds in (see Fall.glideFrom). */ glide?: number }
  /** A board or fire request was turned down ("locked": building here needs the Full Game). */
  | { t: "denied"; reason: "busy" | "far" | "near" | "range" | "reload" | "gone" | "locked" }
  /** Whether you may build here (the answer to a "key" message; or "elsewhere": your seat went to another device). With a reason, you have no seat on your key, building or not. */
  | { t: "access"; builder: boolean; reason?: SeatReason; seats?: number }
  /** A world's own message, from its server half to its page half: the shared code only carries it. */
  | { t: "w"; d: unknown }
  /** A newer version of SnapFort is live: this page should restart (it can watch, not move or build, until it does). */
  | { t: "update" }
  | { t: "snap"; pieces: WirePiece[] }
  /** Someone else changed the world. */
  | { t: "ops"; by: string; ops: WireOp[] }
  /**
   * The world took your action `seq`: `rejected` lists the indexes of operations
   * it refused, `extra` what it also did (pieces that fell).
   */
  | { t: "ack"; seq: number; rejected: number[]; extra: WireOp[] }
  /** Someone said something (you too: your own message comes back filtered). */
  | ({ t: "said" } & WireSaid)
  /** Your message was not passed on: too many in a few seconds (try again in `wait` seconds). */
  | { t: "hush"; reason: "flood"; wait?: number }
  | { t: "join"; player: WirePlayer }
  | { t: "leave"; id: string }
  | { t: "moves"; m: WireMove[] }
  /** `v`: the server's protocol version (with "version"); older servers did not send it. */
  | { t: "error"; reason: "full" | "version" | "bad"; v?: number };

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
