import type { BuildingKind, UnitKind, UpgradeKind } from "./kit";

/**
 * What Mojave's server half and page half say to each other, over the world
 * message every world has. Numbers are packed flat where there are many of
 * them (units move ten times a second).
 */

/** Numbers sent for each unit, in this order. */
export const UNIT_FIELDS = 9;
/**
 * id, kind × 16 + owner, x, y, z (decimetres), heading (0..255 round the
 * circle; above that, 256 × (aim + 1), where its gun points: a vehicle's
 * turret turns on its own; 0 there means along the hull), health (0..100), flags, and what it carries (a Hauler's load, a
 * transport's passengers).
 */
export const F_MOVING = 1, F_FIRING = 2, F_DEPLOYED = 4, F_STUNNED = 8, F_DOWN = 16, F_LOADED = 32, F_DIGGING = 64, F_HIT = 128;

export interface WireBuilding {
  i: number;
  /** Its kind, by place in BUILDING_KINDS. */
  k: number;
  /** Whose (a general's slot). */
  o: number;
  x: number;
  z: number;
  /** Health, 0..100. */
  h: number;
  /** Seconds until it has printed itself (0: finished), and how long that takes in all. */
  d: number;
  /** What it is making (kinds by place in UNIT_KINDS), and seconds left on the first. */
  q: number[];
  ql: number;
  /** An upgrade under way: its place in UPGRADES + 1 (0: none), and seconds left. */
  r: number;
  rl: number;
  /** Its rally point, when it has one. */
  rx?: number;
  rz?: number;
  /** Stopped by an EMP for this many seconds more. */
  st: number;
}

/** One of the eight armies, and who serves it now. */
export interface WireGeneral {
  slot: number;
  /** The army's name: its colour's ("blue army"). */
  name: string;
  color: string;
  /** The builders serving it now. */
  pids: string[];
}

/** One field: id, kind (0 crystal, 1 vent), cell x, cell z, what is left, what it holds. */
export type WireField = [number, number, number, number, number, number];

export type ToPage =
  /**
   * Who you are here: a general of an army (`slot`), with where to stand on
   * arriving; or of none (-1): you have still to choose one ("choose": the
   * list of armies follows), or commanding here needs the Full Game
   * ("visitor"), and then nothing more of the war is sent.
   */
  | { m: "you"; slot: number; why?: "choose" | "visitor"; start?: [number, number]; /** Every id this army has been built under (pieces carry the id of whoever built them). */ pids?: string[] }
  | { m: "gens"; g: WireGeneral[] }
  | { m: "fields"; f: WireField[] }
  /** Your bank: lithium, plasma, supply in use and the limit, upgrade levels, and seconds until a routed general's free Core (-1: not routed). */
  | { m: "res"; l: number; p: number; used: number; max: number; up: [number, number]; routed: number }
  | {
      m: "tick";
      /** Game time, seconds. */
      t: number;
      /** Units seen or changed: UNIT_FIELDS numbers each. */
      u?: number[];
      /** Units no longer seen: id, why (0 out of sight, 1 destroyed, 2 gone with their general). */
      x?: number[];
      b?: WireBuilding[];
      /** Buildings gone: id, why (1 destroyed, 2 gone with their general). */
      bx?: number[];
      /** Shots: from x y z, to x y z (decimetres), look (+ 8 × (the id of the unit that fired + 1), 0 for a building), tenths of a second in the air, owner, what was hit (a unit's id, minus a building's, or 0). */
      s?: number[];
      /** Units thrown: id, from x y z, to x y z (decimetres), tenths of a second. */
      k?: number[];
      /** Blasts: x y z (decimetres), radius (decimetres). */
      bl?: number[];
      /** EMP pulses: x, z (metres). */
      p?: number[];
      /** Shells shot down: from x y z, to x y z (decimetres). */
      z?: number[];
      /** Fields whose contents changed: id, what is left. */
      f?: number[];
    }
  | { m: "note"; text: string; kind: "attack" | "ready" | "info"; x?: number; z?: number }
  /** An order of yours was refused. */
  | { m: "no"; text: string };

/** A spot on the ground an order is for: x, y, z in metres. */
export type WireSpot = [number, number, number];
/** What an order is aimed at: 1 a unit, 2 a building, 3 a general (by slot), 4 a built piece (by id). */
export type WireTarget = [1 | 2 | 3, number] | [4, string];

export type ToServer =
  | { m: "order"; ids: number[]; k: "stop" | "hold" | "return"; q?: boolean }
  | { m: "order"; ids: number[]; k: "move" | "amove" | "unload" | "emp"; at: WireSpot; q?: boolean }
  | { m: "order"; ids: number[]; k: "patrol"; at: WireSpot; q?: boolean }
  | { m: "order"; ids: number[]; k: "attack"; on: WireTarget; q?: boolean }
  | { m: "order"; ids: number[]; k: "gather"; field: number; q?: boolean }
  | { m: "order"; ids: number[]; k: "load"; into: number; q?: boolean }
  | { m: "build"; kind: BuildingKind; x: number; z: number }
  | { m: "make"; id: number; kind: UnitKind; n?: number }
  | { m: "cancel"; id: number }
  | { m: "research"; id: number; kind: UpgradeKind }
  | { m: "rally"; ids: number[]; at: WireSpot }
  | { m: "scrap"; id: number }
  /** Serve this army: on arriving, or changing sides at any moment. */
  | { m: "serve"; slot: number }
  /** For checks, on a developer's own computer only. */
  | { m: "dev"; do: "rich" | "spawn" | "stress" | "kill" | "speed" | "perf" | "fresh" | "quiet" | "all"; kind?: UnitKind; n?: number; at?: WireSpot; slot?: number; on?: boolean };

export const LOOKS = ["bullet", "shell", "missile", "laser"] as const;
