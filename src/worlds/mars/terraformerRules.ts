import type { BuildState } from "../../game/buildState";
import { CELL, WORLD_HALF_CELLS } from "../../game/constants";
import { overlaps, piecesIn, type Box } from "../../game/keepOut";
import type { Vec } from "../../game/trebuchet";
import { world } from "./world";

/**
 * Mars's Terraformer: what its page and server halves agree on.
 *
 * The science it stands on: Mars cannot be given a thick sky from what is
 * frozen in its ground alone, but a factory that keeps the air full of
 * engineered dust (tiny rods that trap the planet's heat) could warm it by
 * tens of degrees, and the dust settles out within years, so the warming
 * lasts only as long as the factory runs. Here that is a kit of 24 numbered
 * parts on a 40 m square: four intake towers round a reactor, and a stack a
 * hundred metres tall. While it stands whole and unbroken the air of the
 * whole world thickens (see `Air`); a hit breaks a part and the air thins
 * again until someone mends it. The stretch is time: decades pass in minutes.
 *
 * Its parts are not building pieces (the building core knows nothing of
 * them): they are Mars's own things. Copied in pattern from the Moon's rail gun.
 */

/** How many parts in the kit, numbered from 1 in the order they go on. */
export const PARTS = 24;
/** The square it stands on, in cells. */
export const SIZE = 8;

export const TERRAFORMER = {
  /** How near a builder must be to where a part goes to put it on or mend it, m (as near as for a wall, in height too), and to take one off. */
  placeReach: 12,
  removeReach: 16,
  /** A shot landing this near a part breaks it, m. */
  breakWithin: 3,
  /** A shot hits a part when it comes this near it, m. */
  hitSize: 0.7,
  /** An unfinished one nobody has added to for this long clears itself, ms. */
  abandonedAfter: 24 * 3600_000,
  /** How many Mars has room for. One: the whole world builds, guards or brings down the same machine. */
  most: 1,
} as const;

/** A Terraformer as saved and sent: the cell of its south-west corner, and its parts. It stands on the ground. */
export interface Terraformer {
  id: number;
  x: number;
  z: number;
  /** Numbers of the parts in place, in no particular order. */
  parts: number[];
  /** Those of them that a hit has broken: still standing, but the machine will not run until each is mended. */
  broken: number[];
  /** When a part was last put on or mended (ms). */
  touched: number;
}

type Site = Pick<Terraformer, "x" | "z">;

interface Part {
  name: string;
  /** The space it fills, in metres from the corner: [x0, y0, z0, x1, y1, z1]. */
  box: Box;
  /** The parts it stands on or joins: all must be in place first. */
  needs: number[];
}

const corner = (i: number): [number, number] => [i % 2 === 0 ? 2 : 30, i < 2 ? 2 : 30];
const LETTER = ["A", "B", "C", "D"];

/** The kit. Part n is KIT[n - 1]. */
const KIT: Part[] = (() => {
  const kit: Part[] = [];
  kit.push({ name: "Foundation", box: [0, 0, 0, 40, 1.5, 40], needs: [] });
  for (let i = 0; i < 4; i++) {
    const [x, z] = corner(i);
    kit.push({ name: `Intake tower ${LETTER[i]}`, box: [x, 1.5, z, x + 8, 26, z + 8], needs: [1] });
  }
  kit.push({ name: "Reactor", box: [12, 1.5, 12, 28, 16, 28], needs: [1] });
  kit.push({ name: "Control house", box: [16, 1.5, 2, 24, 7, 9], needs: [1] });
  kit.push({ name: "Feed hopper", box: [16, 1.5, 31, 24, 10, 38], needs: [1] });
  for (let i = 0; i < 4; i++) {
    // From the tower's inner corner to the reactor's.
    const [x, z] = [i % 2 === 0 ? 9 : 27, i < 2 ? 9 : 27];
    kit.push({ name: `Duct ${LETTER[i]}`, box: [x, 9, z, x + 4, 13, z + 4], needs: [2 + i, 6] });
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = corner(i);
    kit.push({ name: `Intake fan ${LETTER[i]}`, box: [x - 1, 26, z - 1, x + 9, 31, z + 9], needs: [2 + i] });
  }
  kit.push({ name: "Reactor dome", box: [12, 16, 12, 28, 30, 28], needs: [6] });
  kit.push({ name: "Furnace collar", box: [10, 30, 10, 30, 36, 30], needs: [17] });
  for (let i = 0; i < 4; i++) kit.push({ name: `Stack ${i + 1}`, box: [15, 36 + 14 * i, 15, 25, 50 + 14 * i, 25], needs: [18 + i] });
  kit.push({ name: "Crown", box: [13, 92, 13, 27, 100, 27], needs: [22] });
  kit.push({ name: "Igniter", box: [18, 100, 18, 22, 106, 22], needs: [23] });
  return kit;
})();

/** How tall the whole machine stands, m. */
export const TALL = 106;

export function nameOf(n: number): string {
  return KIT[n - 1]?.name ?? "";
}

export function needsOf(n: number): number[] {
  return KIT[n - 1]?.needs ?? [];
}

/** The parts that stand on or join to part `n`: it cannot be taken off while any of them is in place. */
export function heldBy(n: number): number[] {
  return KIT.flatMap((p, i) => (p.needs.includes(n) ? [i + 1] : []));
}

/** The space part `n` fills in the world, in metres. */
export function boxOf(site: Site, n: number): Box {
  const b = KIT[n - 1]!.box, ox = site.x * CELL, oz = site.z * CELL;
  return [ox + b[0], b[1], oz + b[2], ox + b[3], b[4], oz + b[5]];
}

/** The same space from its own corner (for drawing a part where its site is not yet known). */
export function localBox(n: number): Box {
  return KIT[n - 1]!.box;
}

/** How far a point is from a box, m (0 inside). */
export function gapTo(box: Box, p: Vec): number {
  return Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]));
}

/** How far a builder (their body's middle) is from where part `n` goes, m. */
export function reachTo(site: Site, n: number, p: Vec): number {
  return gapTo(boxOf(site, n), p);
}

/** How far a piece may graze a part's space without counting as built into it, m. */
const GRAZE = 0.2;

/** True when a piece filling `box` would cut into a part that is in place. */
export function cutsInto(t: Terraformer, box: Box): boolean {
  return t.parts.some((n) => overlaps(boxOf(t, n), box, GRAZE));
}

/** True when something built cuts into the space part `n` would fill. */
export function builtInto(build: BuildState, site: Site, n: number): boolean {
  return piecesIn(build, boxOf(site, n), world, GRAZE).length > 0;
}

/** True when a whole Terraformer with its corner here stands inside the building area. */
export function fits(site: Site): boolean {
  return Number.isInteger(site.x) && Number.isInteger(site.z) && site.x >= -WORLD_HALF_CELLS && site.z >= -WORLD_HALF_CELLS && site.x + SIZE <= WORLD_HALF_CELLS && site.z + SIZE <= WORLD_HALF_CELLS;
}

/** True when two would stand on any of the same ground. */
export function overlap(a: Site, b: Site): boolean {
  return Math.abs(a.x - b.x) < SIZE && Math.abs(a.z - b.z) < SIZE;
}

export type PlaceProblem = "have" | "needs" | "crowded" | "room";

/** Why part `n` cannot go on now, or null when it can. */
export function cannotPlace(build: BuildState, t: Terraformer, n: number): PlaceProblem | null {
  if (!Number.isInteger(n) || n < 1 || n > PARTS) return "room";
  if (t.parts.includes(n)) return "have";
  if (!needsOf(n).every((m) => t.parts.includes(m))) return "needs";
  if (builtInto(build, t, n)) return "crowded";
  return null;
}

/** The next part to go on: the lowest number not yet in place (the kit is numbered in building order). Null when it is whole. */
export function nextPart(t: Terraformer): number | null {
  for (let n = 1; n <= PARTS; n++) if (!t.parts.includes(n)) return n;
  return null;
}

/** True when part `n` can be taken off: it is in place and nothing in place stands on it. */
export function canTake(t: Terraformer, n: number): boolean {
  return t.parts.includes(n) && !heldBy(n).some((m) => t.parts.includes(m));
}

/** Whole and unbroken: it runs, and the air thickens. */
export function running(t: Terraformer): boolean {
  return t.parts.length === PARTS && t.broken.length === 0;
}

/** The parts in place within `within` metres of a point. */
export function partsNear(t: Terraformer, point: Vec, within: number): number[] {
  return t.parts.filter((n) => gapTo(boxOf(t, n), point) <= within);
}

/** The part in place at a spot (the smallest whose space, grown a little, holds it), or null. */
export function partAt(t: Terraformer, point: Vec): number | null {
  const size = (n: number) => { const b = boxOf(t, n); return (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]); };
  return partsNear(t, point, 0.5).sort((a, b) => size(a) - size(b))[0] ?? null;
}

/** A Terraformer from a message or from saving, or null when it is not one. */
export function readTerraformer(v: unknown): Terraformer | null {
  if (typeof v !== "object" || v === null) return null;
  const g = v as Record<string, unknown>;
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!whole(g.id) || !whole(g.x) || !whole(g.z) || !Array.isArray(g.parts)) return null;
  const parts = [...new Set(g.parts.filter((n): n is number => whole(n) && n >= 1 && n <= PARTS))];
  const broken = Array.isArray(g.broken) ? [...new Set(g.broken.filter((n): n is number => whole(n) && parts.includes(n)))] : [];
  const t: Terraformer = { id: g.id, x: g.x, z: g.z, parts, broken, touched: typeof g.touched === "number" ? g.touched : 0 };
  return fits(t) ? t : null;
}

// ── The air ──────────────────────────────────────────────────────────────

/**
 * How thick the air of the whole world is, from 0 (Mars as it is: under a
 * hundredth of the Earth's) to 1 (thick enough to fly in, and to rain). It
 * never jumps: it moves toward `to` from what it was (`from`) at `since` (ms),
 * taking `AIR_SECONDS` to go all the way, the same pace up and down. So it is
 * three numbers that every page can work the present out from.
 */
export interface Air {
  from: number;
  to: number;
  since: number;
}

/** Seconds from thin to thick, or back. */
export const AIR_SECONDS = 240;
export const THIN: Air = { from: 0, to: 0, since: 0 };

export function airAt(air: Air, now: number): number {
  const moved = Math.max(0, now - air.since) / 1000 / AIR_SECONDS;
  return air.to >= air.from ? Math.min(air.to, air.from + moved) : Math.max(air.to, air.from - moved);
}

/** The air heading for `to` from now on, from wherever it has got to. */
export function airToward(air: Air, to: number, now: number): Air {
  return { from: airAt(air, now), to, since: now };
}

export function readAir(v: unknown): Air {
  const a = v as Partial<Air> | null | undefined;
  const unit = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1;
  return a && unit(a.from) && unit(a.to) && typeof a.since === "number" && Number.isFinite(a.since) ? { from: a.from, to: a.to, since: a.since } : { ...THIN };
}

// ── Messages ─────────────────────────────────────────────────────────────

/** From the server's half to the page's. `now` is the server's clock (ms), to read the air by. */
export type TerraToPage =
  /** Every Terraformer and the air, on joining. */
  | { k: "terras"; list: Terraformer[]; air: Air; now: number }
  /** One as it now is (new, or changed). `hit` lists parts a shot has just broken. */
  | { k: "terra"; terra: Terraformer; now: number; hit?: number[] }
  /** One is gone (its last part came off, or it was cleared away). */
  | { k: "terra-gone"; id: number }
  /** Something asked for was refused. */
  | { k: "terra-no"; why: PlaceProblem | "far" | "locked" | "full" | "overlap" | "held" }
  /** The air has turned: heading somewhere new. */
  | { k: "air"; air: Air; now: number };

/** From the page's half to the server's. */
export type TerraToServer =
  /** Starts a new one: its corner at this cell. */
  | { k: "terra-new"; x: number; z: number }
  /** Puts part `n` on. */
  | { k: "terra-part"; id: number; n: number }
  /** Mends broken part `n`. */
  | { k: "terra-mend"; id: number; n: number }
  /** Takes part `n` off (the Remove tool). */
  | { k: "terra-take"; id: number; n: number };
