import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL, MAX_LEVEL, WORLD_HALF_CELLS } from "../../game/constants";
import { overlaps, piecesIn, type Box } from "../../game/keepOut";
import type { Vec } from "../../game/trebuchet";
import { world } from "./world";

/**
 * The Moon's rail gun: what its page and server halves agree on. A rail gun is
 * a kit of 22 numbered parts that builders put together on the spot, any
 * number of them anywhere on the Moon. It is long, low and slender, like the
 * real designs for throwing things off the Moon: a base and breech with a
 * capacitor bank each side, 160 m of rail (thirteen level 10 m segments, then
 * three rising one storey each, about 20 degrees), a muzzle, and the capsule a
 * builder rides. Assembled right, it powers up, and whoever sits in the capsule
 * is thrown high above the Moon, to fly down on their rockets to anywhere on it:
 * the top of a tower, or the farthest corner.
 *
 * Its parts are not building pieces (the building core knows nothing of them):
 * they are the Moon's own things, like the rovers. A part needs the ground or
 * a floor under it, so the rising end has to be held up with ordinary pieces.
 */

/** How many parts in the kit, numbered from 1. */
export const PARTS = 22;

export type PartKind = "base" | "breech" | "capacitor" | "rail" | "rise" | "muzzle" | "capsule";

export const RAILGUN = {
  /**
   * How near a builder must be to where a part goes to put it on, m: as near
   * as for a wall, in height too (user, 2026-11-24: "I have to be nearby...
   * just like you can't build walls from far away"; it was 22). And how near
   * to take one off.
   */
  placeReach: 12,
  removeReach: 16,
  /** How near to the capsule to get in, m. */
  boardReach: 6,
  /** A shot landing this near a part's middle knocks it out, m. */
  knockWithin: 3.6,
  /** A shot hits a part when it comes this near its middle, m. */
  hitSize: 2.2,
  /** Seconds to charge once it is whole, and again after each launch; less for each builder standing by a capacitor bank. */
  charge: 30,
  chargeHelp: 10,
  /** How near a capacitor bank a builder must stand to help it charge, m. */
  helpReach: 5,
  /** An unfinished gun nobody has added to for this long clears itself, ms. */
  abandonedAfter: 24 * 3600_000,
  /** Most rail guns on the Moon at once (so the world cannot fill up with them). */
  most: 40,
  /**
   * The launch: seconds down the rail, then seconds climbing to `launchUp`
   * metres above the gun, `launchOut` metres on along the way it points. From
   * there the rider flies themselves down on their rockets, wherever they like
   * (user, 2026-11-24: "launch very high into space, and I should be able to
   * fly and get anywhere i want").
   */
  rideRail: 1.2,
  rideClimb: 4,
  launchUp: 650,
  launchOut: 200,
  /**
   * Flying down, kept simple (user, 2026-11-24: "it should just be the arrow
   * controls and the space to slow down. and that's it"): the move keys carry
   * the rider across the Moon at this speed, m/s, as they would walk...
   */
  flySpeed: 50,
  /** ...while they come down at this rate, m/s; slower with the jump key held. */
  sink: 14,
  sinkSlow: 3,
} as const;

/** A rail gun as saved and sent: where its base is (cell x, storey, cell z), which way it points (0: +z, 1: +x, 2: -z, 3: -x), and which parts are on it. */
export interface Gun {
  id: number;
  x: number;
  y: number;
  z: number;
  dir: number;
  /** Numbers of the parts in place, in no particular order. */
  parts: number[];
  /** When a part was last put on (ms). */
  touched: number;
  /** When it can next fire (ms); 0 while it is not whole. */
  readyAt: number;
  /** Who sits in the capsule. */
  rider: string | null;
}

const AHEAD: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** What part number `n` is. */
export function kindOf(n: number): PartKind {
  if (n === 1) return "base";
  if (n === 2) return "breech";
  if (n === 3 || n === 4) return "capacitor";
  if (n >= 5 && n <= 17) return "rail";
  if (n >= 18 && n <= 20) return "rise";
  if (n === 21) return "muzzle";
  return "capsule";
}

export function nameOf(n: number): string {
  const kind = kindOf(n);
  return { base: "Base", breech: "Breech", capacitor: `Capacitor bank ${n === 3 ? "A" : "B"}`, rail: `Rail ${n - 4}`, rise: `Rail ${n - 4} (rising)`, muzzle: "Muzzle", capsule: "Capsule" }[kind];
}

/** One cell a part stands in: cell x and z, and the storey its foot is on. */
export interface Foot {
  x: number;
  y: number;
  z: number;
}

/**
 * Where part `n` of a gun goes: the cells it stands in (one, or two for a
 * rail segment, nearer the breech first), each with the storey of its foot.
 * Along the gun: the base, the breech (capacitors either side, the capsule on
 * it), sixteen two-cell rail segments, the muzzle. The last three segments
 * and the muzzle step up a storey each.
 */
export function feetOf(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): Foot[] {
  const [ax, az] = AHEAD[gun.dir]!;
  // To the right of the way it points.
  const sx = az, sz = -ax;
  const at = (along: number, side: number, up: number): Foot => ({ x: gun.x + ax * along + sx * side, y: gun.y + up, z: gun.z + az * along + sz * side });
  const kind = kindOf(n);
  if (kind === "base") return [at(0, 0, 0)];
  if (kind === "breech" || kind === "capsule") return [at(1, 0, 0)];
  if (kind === "capacitor") return [at(1, n === 3 ? -1 : 1, 0)];
  if (kind === "muzzle") return [at(34, 0, 3)];
  const k = n - 5;
  const up = Math.max(0, k - 13);
  // A rising segment stands on its low end and carries its high end itself.
  return [at(2 + 2 * k, 0, up), at(3 + 2 * k, 0, up)];
}

/** The middle of part `n`, in metres: for aiming at it, hitting it and drawing it. */
export function middleOf(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): Vec {
  const feet = feetOf(gun, n);
  const kind = kindOf(n);
  const x = feet.reduce((s, f) => s + f.x + 0.5, 0) / feet.length, z = feet.reduce((s, f) => s + f.z + 0.5, 0) / feet.length;
  const rise = kind === "rise" ? LEVEL / 2 : 0;
  const up = kind === "capsule" ? 2.2 : kind === "capacitor" ? 1.2 : 1;
  return [x * CELL, feet[0]!.y * LEVEL + rise + up, z * CELL];
}

/** The parts part `n` joins to: it can be put on once any of these is in place (the base goes down first, on its own). */
export function joinsOf(n: number): number[] {
  const kind = kindOf(n);
  if (kind === "base") return [];
  if (kind === "breech") return [1, 3, 4, 5, 22];
  if (kind === "capacitor" || kind === "capsule") return [2];
  if (kind === "muzzle") return [20];
  return n === 5 ? [2, 6] : [n - 1, n + 1];
}

/** True when a part's foot has the ground or a floor under it. */
export function footed(build: BuildState, foot: Foot): boolean {
  if (foot.y === 0) return true;
  return build.occupant({ type: "floor", x: foot.x, y: foot.y, z: foot.z, rot: 0 })?.type === "floor";
}

/** True when something is built where a part's foot stands (a ramp, a dome, a launcher), so the part cannot be there or cannot work. */
export function crowded(build: BuildState, foot: Foot): boolean {
  return build.occupant({ type: "ramp", x: foot.x, y: foot.y, z: foot.z, rot: 0 }) !== undefined;
}

/** How tall each kind of part is above its foot, m (a rail with its accelerator rings). */
const TALL: Record<PartKind, number> = { base: 2.0, breech: 3.3, capacitor: 3.3, rail: 3.4, rise: 3.4, muzzle: 4.2, capsule: 3.3 };
/** How far a piece may graze a part's space without counting as built into it, m. */
const GRAZE = 0.2;

/**
 * The space part `n` fills, a box for each cell it stands in: nothing can be
 * built into it (user, 2026-11-24). From just above what it stands on to its
 * top; in from the sides of its cells, so walls may stand beside the gun, but
 * all the way through along its length, so none can be put across it. (The
 * breech reaches its cell's sides: the capacitor banks feed it there.)
 */
export function partSpace(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): Box[] {
  const kind = kindOf(n);
  const [ax, az] = AHEAD[gun.dir]!;
  const alongX = ax !== 0;
  const side = kind === "breech" || kind === "capsule" ? -GRAZE : 0.5, end = -GRAZE;
  const [ix, iz] = alongX ? [end, side] : [side, end];
  const feet = feetOf(gun, n);
  if (kind !== "rise") return feet.map((f): Box => [f.x * CELL + ix, f.y * LEVEL + 0.3, f.z * CELL + iz, (f.x + 1) * CELL - ix, f.y * LEVEL + TALL[kind], (f.z + 1) * CELL - iz]);
  // A rising segment climbs a storey over its two cells: a run of short steps that follow its slope, so the
  // pillars that hold up the next segment can stand right under where the two meet.
  const low = feet[0]!, forward = ax + az > 0, steps = 8, run = (2 * CELL) / steps;
  const start = ((alongX ? low.x : low.z) + (forward ? 0 : 1)) * CELL;
  return Array.from({ length: steps }, (_, j): Box => {
    const a = start + (forward ? 1 : -1) * j * run, b = start + (forward ? 1 : -1) * (j + 1) * run;
    const [from, to] = [Math.min(a, b) - GRAZE, Math.max(a, b) + GRAZE];
    const y0 = low.y * LEVEL + ((j + 1) / steps) * LEVEL;
    return alongX ? [from, y0 + 0.3, low.z * CELL + side, to, y0 + TALL.rise, (low.z + 1) * CELL - side] : [low.x * CELL + side, y0 + 0.3, from, (low.x + 1) * CELL - side, y0 + TALL.rise, to];
  });
}

/** How far a builder (their body's middle) is from where part `n` goes, m (0 right at it). */
export function reachTo(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number, p: Vec): number {
  return Math.min(...partSpace(gun, n).map((b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[3]), Math.max(b[1] - p[1], 0, p[1] - b[4]), Math.max(b[2] - p[2], 0, p[2] - b[5]))));
}

/** True when a piece filling `box` would cut into a part of this gun. */
export function cutsInto(gun: Gun, box: Box): boolean {
  return gun.parts.some((n) => partSpace(gun, n).some((space) => overlaps(space, box, GRAZE)));
}

/** True when something built cuts into the space part `n` would fill. */
export function builtInto(build: BuildState, gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): boolean {
  return partSpace(gun, n).some((space) => piecesIn(build, space, world, GRAZE).length > 0);
}

/** The feet of a part that must have something under them: all of them, but only the low end of a rising segment. */
export function standingFeet(gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number): Foot[] {
  const feet = feetOf(gun, n);
  return kindOf(n) === "rise" ? feet.slice(0, 1) : feet;
}

export type PlaceProblem = "have" | "join" | "under" | "crowded" | "room";

/** Why part `n` cannot go on this gun now, or null when it can. */
export function cannotPlace(build: BuildState, gun: Gun, n: number): PlaceProblem | null {
  if (!Number.isInteger(n) || n < 1 || n > PARTS) return "room";
  if (gun.parts.includes(n)) return "have";
  if (n !== 1 && !joinsOf(n).some((m) => gun.parts.includes(m))) return "join";
  if (feetOf(gun, n).some((f) => crowded(build, f)) || builtInto(build, gun, n)) return "crowded";
  if (!standingFeet(gun, n).every((f) => footed(build, f))) return "under";
  return null;
}

/** True when a whole gun from this base, pointing this way, fits inside the building area (and under its ceiling). */
export function fits(gun: Pick<Gun, "x" | "y" | "z" | "dir">): boolean {
  if (gun.y < 0 || gun.y + 4 > MAX_LEVEL) return false;
  for (let n = 1; n <= PARTS; n++) {
    for (const f of feetOf(gun, n)) if (f.x < -WORLD_HALF_CELLS || f.x >= WORLD_HALF_CELLS || f.z < -WORLD_HALF_CELLS || f.z >= WORLD_HALF_CELLS) return false;
  }
  return true;
}

/** The parts in place that can no longer stay: nothing under them any more. */
export function fallen(build: BuildState, gun: Gun): number[] {
  return gun.parts.filter((n) => !standingFeet(gun, n).every((f) => footed(build, f)));
}

/** The parts in place that something has been built over (they stay, but the gun will not work until it is cleared). */
export function blocked(build: BuildState, gun: Gun): number[] {
  return gun.parts.filter((n) => feetOf(gun, n).some((f) => crowded(build, f)));
}

/** Whole and clear: every part in place and nothing built over any of them. */
export function operational(build: BuildState, gun: Gun): boolean {
  return gun.parts.length === PARTS && blocked(build, gun).length === 0;
}

/** True when two guns would stand in any of the same cells. */
export function overlap(a: Pick<Gun, "x" | "y" | "z" | "dir">, b: Pick<Gun, "x" | "y" | "z" | "dir">): boolean {
  const cells = new Set<string>();
  for (let n = 1; n <= PARTS; n++) for (const f of feetOf(a, n)) cells.add(`${f.x},${f.z}`);
  for (let n = 1; n <= PARTS; n++) for (const f of feetOf(b, n)) if (cells.has(`${f.x},${f.z}`)) return true;
  return false;
}

/**
 * The part of a gun at a spot (in metres), if one is in place there: the one
 * whose cell the spot is in. The capsule sits on the breech: high up it is the
 * capsule, low down the breech.
 */
export function partAt(gun: Gun, x: number, y: number, z: number): number | null {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  const here = gun.parts.filter((n) => feetOf(gun, n).some((f) => f.x === cx && f.z === cz));
  if (here.length === 0) return null;
  if (here.includes(22) && (y - gun.y * LEVEL > 1.6 || !here.includes(2))) return 22;
  return here.find((n) => n !== 22) ?? here[0]!;
}

/** Where the capsule's seat is (its surface), and which way it faces (radians about the vertical). */
export function seatOf(gun: Pick<Gun, "x" | "y" | "z" | "dir">): { x: number; y: number; z: number; yaw: number } {
  const [f] = feetOf(gun, 22);
  return { x: (f!.x + 0.5) * CELL, y: f!.y * LEVEL + 2.0, z: (f!.z + 0.5) * CELL, yaw: (gun.dir * Math.PI) / 2 };
}

/** The line the capsule runs: from the breech to the muzzle's mouth, in metres. */
export function railLine(gun: Pick<Gun, "x" | "y" | "z" | "dir">): { from: Vec; bend: Vec; to: Vec } {
  const [ax, az] = AHEAD[gun.dir]!;
  const p = (along: number, up: number): Vec => [(gun.x + 0.5 + ax * along) * CELL, gun.y * LEVEL + up, (gun.z + 0.5 + az * along) * CELL];
  // Level to where the rising segments begin (28 cells on), then up three storeys over the last 30 m.
  return { from: p(1, 2.0), bend: p(27.5, 2.0), to: p(34.5, 3 * LEVEL + 2.0) };
}

/** A gun from a message or from saving, or null when it is not one. */
export function readGun(v: unknown): Gun | null {
  if (typeof v !== "object" || v === null) return null;
  const g = v as Record<string, unknown>;
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!whole(g.id) || !whole(g.x) || !whole(g.y) || !whole(g.z) || !whole(g.dir) || g.dir < 0 || g.dir > 3 || !Array.isArray(g.parts)) return null;
  const parts = [...new Set(g.parts.filter((n): n is number => whole(n) && n >= 1 && n <= PARTS))];
  const gun: Gun = { id: g.id, x: g.x, y: g.y, z: g.z, dir: g.dir, parts, touched: typeof g.touched === "number" ? g.touched : 0, readyAt: typeof g.readyAt === "number" ? g.readyAt : 0, rider: null };
  return fits(gun) ? gun : null;
}

/** From the server's half to the page's. */
export type GunToPage =
  /** Every rail gun, on joining. `now` is the server's clock (ms), to read `readyAt` by. */
  | { k: "guns"; list: Gun[]; now: number }
  /** A gun as it now is (new, or changed). `knocked` lists parts that just came off, for the page to show falling. */
  | { k: "gun"; gun: Gun; now: number; knocked?: number[] }
  /** Gun `id` is gone (its last part came off, or it was cleared away). */
  | { k: "gun-gone"; id: number }
  /** Putting a part on was refused. */
  | { k: "gun-no"; why: PlaceProblem | "far" | "locked" | "full" | "overlap" | "busy" | "charging" | "broken" }
  /** Gun `id` fires: the builder in its capsule is on their way (their flight comes separately, as any flight does). */
  | { k: "gun-fire"; id: number; by: string };

/** From the page's half to the server's. */
export type GunToServer =
  /** Starts a new gun: its base at this cell and storey, pointing this way. */
  | { k: "gun-new"; x: number; y: number; z: number; dir: number }
  /** Puts part `n` on gun `id`. */
  | { k: "gun-part"; id: number; n: number }
  /** Takes part `n` off gun `id` (the Remove tool). */
  | { k: "gun-take"; id: number; n: number }
  /** Gets into (or out of) the capsule of gun `id`. */
  | { k: "gun-sit"; id: number; on: boolean }
  /** Fires the gun whose capsule this builder sits in. */
  | { k: "gun-launch" };
