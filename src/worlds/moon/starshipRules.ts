import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL, MAX_LEVEL, WORLD_HALF_CELLS } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { overlaps, piecesIn, type Box } from "../../game/keepOut";
import type { Vec } from "../../game/trebuchet";

/**
 * The Moon's Starship: what its page and server halves agree on. Copied from
 * the Meadow's (a ship from either lands in the other); what differs here is
 * how a ship comes in: there is no air to fall through on its belly.
 * A launch
 * site is a kit of 21 numbered parts that builders put together on the spot:
 * the launch tower with its two catch arms ("Mechazilla"), the launch mount
 * beside it, the booster on the mount and the ship on the booster. It is as
 * near full size as the grid allows: a 146 m tower, a 71 m booster and a 52 m
 * ship, 9 m across, the stack standing 123 m on a mount 19 m high.
 *
 * Whole and fuelled, it carries up to seven builders. The booster flies back
 * and is caught by the tower's arms, to be used again; the ship flies on to
 * another world, where it comes down and lets its passengers out. So after
 * every launch the ship (four parts) has to be built again.
 *
 * Anything the rocket hits, and any shot that hits the rocket, blows it up,
 * and whoever is in it is thrown clear.
 *
 * The parts are not building pieces (the building core knows nothing of
 * them): they are this world's own things.
 */

/** How many parts in the kit, numbered from 1. */
export const PARTS = 21;
/** How many can ride. */
export const SEATS = 7;

export type PartKind = "tower" | "top" | "mount" | "armA" | "armB" | "qd" | "engines" | "tank" | "fins" | "shipEngines" | "shipTank" | "cabin" | "nose";

/** Sizes, in metres. */
export const SIZE = {
  /** The tower: eight sections and a top, 146 m in all, 12 m square. */
  section: 17.5,
  top: 6,
  towerWide: 12,
  /** From the middle of the tower to the middle of the mount (and the rocket). */
  ahead: 20,
  /** The mount: how high the rocket stands off the ground, and how wide the table is. */
  deck: 18.75,
  mountWide: 15,
  /** The rocket: how wide, four booster sections of this height, and the ship's four. */
  hull: 9,
  boosterSection: 17.75,
  booster: 71,
  ship: [12, 14, 12, 14] as readonly number[],
  shipTall: 52,
  /** How high the catch arms and the ship's fuelling arm are. */
  armY: 80,
  qdY: 94,
} as const;

export const STARSHIP = {
  /** How near (across the ground) a builder must be to the tower or the mount to put a part on, m. The tower's crane does the lifting. */
  placeReach: 45,
  /** How near to the foot of the tower or the mount to ride the lift up, m. */
  boardReach: 16,
  /** Seconds of fuelling once it is whole. */
  fuel: 20,
  /** An unfinished site nobody has added to for this long clears itself, ms. */
  abandonedAfter: 24 * 3600_000,
  /** Most launch sites in the world at once. */
  most: 6,
  /** Builders this near the middle of the mount at lift-off are blown away, m. */
  blast: 16,
  /** A shot landing this near a part counts as on it, m. */
  near: 1.2,
  /** A ship that has landed stays this long, s. */
  stay: 300,
  /** A ship arrives in the other world this long after it leaves this one, s (time for its passengers' pages to get there). */
  gap: 3,
} as const;

/** A launch site as saved and sent: the cell its tower stands in the middle of, which way the mount is from it (0: +z, 1: +x, 2: -z, 3: -x), and which parts are on it. */
export interface Pad {
  id: number;
  x: number;
  z: number;
  dir: number;
  /** Numbers of the parts in place, in no particular order. */
  parts: number[];
  /** When a part was last put on (ms). */
  touched: number;
  /** When it is fuelled (ms); 0 while it is not whole. */
  readyAt: number;
  /** Who sits in each seat. */
  riders: (string | null)[];
  /** When the countdown began (ms); 0 when there is none. */
  count: number;
  /** Where it is going (a world's id), once a countdown has begun. */
  to: string;
  flight: PadFlight | null;
}

/** A launch under way. */
export interface PadFlight {
  /** When the engines lit (ms). */
  at: number;
  to: string;
  trip: string;
  /** Still flying here: the ship (until it leaves for the other world), and the booster (until it is caught). */
  ship: boolean;
  booster: boolean;
  /** Something is built in its way: seconds after the engines lit when it reaches it. */
  hitAt?: number;
}

/** A ship coming in from another world, or landed. */
export interface Ship {
  trip: string;
  from: string;
  /** When it appears, high up (ms). */
  at: number;
  /** Where it lands, m. */
  x: number;
  z: number;
  seats: number;
  riders: string[];
  /** Landed (its passengers are out). */
  down: boolean;
}

const AHEAD: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
type Site = Pick<Pad, "x" | "z" | "dir">;

export function kindOf(n: number): PartKind {
  if (n <= 8) return "tower";
  return (["top", "mount", "armA", "armB", "qd", "engines", "tank", "tank", "fins", "shipEngines", "shipTank", "cabin", "nose"] as const)[n - 9]!;
}

export function nameOf(n: number): string {
  if (n <= 8) return `Tower section ${n}`;
  return ["Tower top", "Launch mount", "Catch arm A", "Catch arm B", "Fuelling arm", "Booster engines", "Booster oxygen tank", "Booster methane tank", "Booster grid fins", "Ship engines", "Ship tanks", "Ship cabin", "Ship nose"][n - 9]!;
}

export const isBooster = (n: number) => n >= 14 && n <= 17;
export const isShip = (n: number) => n >= 18 && n <= 21;
export const isRocket = (n: number) => n >= 14;

/**
 * The parts part `n` needs in place before it can go on (all of them). The
 * tower goes up from the ground; the arms hang from its top; the booster
 * needs the mount to stand on and both arms to lift it; the ship is stacked
 * on the booster.
 */
export function needsOf(n: number): number[] {
  if (n === 1) return [];
  if (n <= 9) return [n - 1];
  if (n === 10) return [1];
  if (n === 11) return [9];
  if (n === 12) return [11];
  if (n === 13) return [6];
  if (n === 14) return [10, 11, 12];
  return [n - 1];
}

/** Every part that cannot stay without part `n` (what stands on it or hangs from it, and so on up). */
export function heldBy(n: number): number[] {
  const out: number[] = [];
  for (let m = n + 1; m <= PARTS; m++) if (needsOf(m).some((k) => k === n || out.includes(k))) out.push(m);
  return out;
}

/** A point in a site's own space (metres to the right of the way it points, up, and ahead of the tower's middle), in the world. */
export function inWorld(site: Site, right: number, up: number, ahead: number): Vec {
  const [ax, az] = AHEAD[site.dir]!;
  return [(site.x + 0.5) * CELL + az * right + ax * ahead, up, (site.z + 0.5) * CELL - ax * right + az * ahead];
}

/** Which way a site points, radians about the vertical. */
export const yawOf = (site: Site) => (site.dir * Math.PI) / 2;

/** Where each of the ship's four parts starts, above the ship's foot. */
const SHIP_FROM = [0, 12, 26, 38];

/** The box part `n` fills in a site's own space: [right, up, ahead] low corner, then high corner. At rest (the arms closed, the rocket on the mount). */
export function localBox(n: number): [number, number, number, number, number, number] {
  const kind = kindOf(n);
  const half = SIZE.hull / 2;
  if (kind === "tower") return [-6, (n - 1) * SIZE.section, -6, 6, n * SIZE.section, 6];
  if (kind === "top") return [-6.5, 8 * SIZE.section, -6.5, 6.5, 8 * SIZE.section + SIZE.top, 6.5];
  if (kind === "mount") return [-7.5, 0, SIZE.ahead - 7.5, 7.5, SIZE.deck, SIZE.ahead + 7.5];
  if (kind === "armA") return [-6.6, SIZE.armY - 1.5, 6, -4.6, SIZE.armY + 1.5, 29];
  if (kind === "armB") return [4.6, SIZE.armY - 1.5, 6, 6.6, SIZE.armY + 1.5, 29];
  if (kind === "qd") return [-1.3, SIZE.qdY - 1.5, 6, 1.3, SIZE.qdY + 1.5, SIZE.ahead - half];
  if (isBooster(n)) return [-half, SIZE.deck + (n - 14) * SIZE.boosterSection, SIZE.ahead - half, half, SIZE.deck + (n - 13) * SIZE.boosterSection, SIZE.ahead + half];
  const from = SIZE.deck + SIZE.booster + SHIP_FROM[n - 18]!;
  return [-half, from, SIZE.ahead - half, half, from + SIZE.ship[n - 18]!, SIZE.ahead + half];
}

/** The same box in the world: [x, y, z] low corner, then high corner. */
export function boxOf(site: Site, n: number): [number, number, number, number, number, number] {
  const b = localBox(n);
  const p = inWorld(site, b[0], b[1], b[2]), q = inWorld(site, b[3], b[4], b[5]);
  return [Math.min(p[0], q[0]), b[1], Math.min(p[2], q[2]), Math.max(p[0], q[0]), b[4], Math.max(p[2], q[2])];
}

/** The middle of part `n`. */
export function middleOf(site: Site, n: number): Vec {
  const b = boxOf(site, n);
  return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
}

/** The middle of the foot of the tower, and of the mount (where the rocket stands), on the ground. */
export const towerFoot = (site: Site) => inWorld(site, 0, 0, 0);
export const mountFoot = (site: Site) => inWorld(site, 0, 0, SIZE.ahead);

/** The cells a site stands in: three by three under the tower, a gap, three by three under the mount. */
export function cellsOf(site: Site): { x: number; z: number }[] {
  const [ax, az] = AHEAD[site.dir]!;
  const out: { x: number; z: number }[] = [];
  for (let along = -1; along <= 5; along++) for (let side = -1; side <= 1; side++) out.push({ x: site.x + ax * along + az * side, z: site.z + az * along - ax * side });
  return out;
}

/** The nine cells under the mount: the column the rocket stands in and rises through. */
export function mountCells(site: Site): { x: number; z: number }[] {
  const [ax, az] = AHEAD[site.dir]!;
  const out: { x: number; z: number }[] = [];
  for (let along = 3; along <= 5; along++) for (let side = -1; side <= 1; side++) out.push({ x: site.x + ax * along + az * side, z: site.z + az * along - ax * side });
  return out;
}

/** True when a whole site here, pointing this way, is inside the building area. */
export function fits(site: Site): boolean {
  return cellsOf(site).every((c) => c.x >= -WORLD_HALF_CELLS && c.x < WORLD_HALF_CELLS && c.z >= -WORLD_HALF_CELLS && c.z < WORLD_HALF_CELLS);
}

/** The lowest storey with a piece in any of these cells, from storey `from` up; null when there is none. */
function lowestPiece(build: BuildState, cells: readonly { x: number; z: number }[], from: number, to: number): number | null {
  for (let y = from; y <= to; y++) for (const c of cells) if (build.around({ type: "floor", x: c.x, y, z: c.z, rot: 0 }, 0).length > 0) return y;
  return null;
}

/** True when nothing is built where a site would stand (as high as its tower). */
export function clear(build: BuildState, site: Site): boolean {
  return lowestPiece(build, cellsOf(site), 0, Math.ceil(150 / LEVEL)) === null;
}

/** True when two sites would stand in the same cells, or right against each other. */
export function overlap(a: Site, b: Site): boolean {
  const cells = cellsOf(a);
  return cellsOf(b).some((c) => cells.some((d) => Math.abs(c.x - d.x) <= 1 && Math.abs(c.z - d.z) <= 1));
}

/** How far a piece may graze a part's space without counting as built into it, m (a wall against the side of the mount). */
const GRAZE = 0.2;

/** True when something built cuts into the space part `n` of a site would fill. */
export function crowded(build: BuildState, site: Site, n: number, env: Environment): boolean {
  return piecesIn(build, spaceOf(site, n), env, GRAZE).length > 0;
}

/** The space part `n` fills. What stands on the ground goes a little into it, so not even a floor can be laid under it. */
function spaceOf(site: Site, n: number): Box {
  const b = boxOf(site, n);
  return b[1] === 0 ? [b[0], -1, b[2], b[3], b[4], b[5]] : b;
}

/**
 * True when a piece filling `box` would cut into a part of this site: nothing
 * can be built into the tower, its arms, the mount or the rocket. (While the
 * booster is away, its place on the mount is still its own.)
 */
export function cutsInto(pad: Pad, box: Box): boolean {
  return pad.parts.some((n) => overlaps(spaceOf(pad, n), box, GRAZE));
}

export type PlaceProblem = "have" | "needs" | "away" | "room" | "crowded";

/** Why part `n` cannot go on this site now, or null when it can (but for anything built where it goes: see `crowded`). */
export function cannotPlace(pad: Pad, n: number): PlaceProblem | null {
  if (!Number.isInteger(n) || n < 1 || n > PARTS) return "room";
  if (pad.parts.includes(n)) return "have";
  // While the booster is away, or the countdown runs, nothing goes on the rocket.
  if (isRocket(n) && (pad.flight || pad.count)) return "away";
  if (!needsOf(n).every((m) => pad.parts.includes(m))) return "needs";
  return null;
}

/** Whole: every part in place, and standing on the pad (not flying). */
export const whole = (pad: Pad) => pad.parts.length === PARTS && !pad.flight;

/** The part of a site at a spot (in metres), if one is in place there: the smallest whose box the spot is in (or right by). */
export function partAt(pad: Pad, x: number, y: number, z: number, slack = 0.8): number | null {
  let best: number | null = null;
  let size = Infinity;
  for (const n of pad.parts) {
    const b = boxOf(pad, n);
    if (x < b[0] - slack || x > b[3] + slack || y < b[1] - slack || y > b[4] + slack || z < b[2] - slack || z > b[5] + slack) continue;
    const volume = (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
    if (volume < size) [best, size] = [n, volume];
  }
  return best;
}

// ── The flight ───────────────────────────────────────────────────────────

/** Seconds: every time here counts from the moment the engines light. */
export const FLIGHT = {
  /** The countdown before the engines light. */
  count: 10,
  /** Held down on the mount, engines running. */
  hold: 2.5,
  /** How hard the stack climbs, m/s² (slow off the pad, as the real one is). */
  accel: 6,
  /** The ship lights its own engines and leaves the booster. */
  stage: 16,
  shipAccel: 14,
  /** The ship is gone from this world (its passengers with it). */
  handoff: 22,
  /** After staging the booster coasts up this long, then falls, then lights again this high above the mount. */
  coast: 3.5,
  fall: 9,
  burnFrom: 220,
} as const;

const STAGE_UP = 0.5 * FLIGHT.accel * (FLIGHT.stage - FLIGHT.hold) ** 2;
const STAGE_SPEED = FLIGHT.accel * (FLIGHT.stage - FLIGHT.hold);
const PEAK = STAGE_UP + (STAGE_SPEED * FLIGHT.coast) / 2;
const FALL_TIME = Math.sqrt((2 * (PEAK - FLIGHT.burnFrom)) / FLIGHT.fall);
const FALL_SPEED = FLIGHT.fall * FALL_TIME;
const BURN_TIME = (2 * FLIGHT.burnFrom) / FALL_SPEED;
/** When the booster is back in the tower's arms. */
export const CATCH = FLIGHT.stage + FLIGHT.coast + FALL_TIME + BURN_TIME;

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
/** The stack leans gently over the way the site points from 8 s, and drifts that way. */
const lean = (t: number) => (t < 8 ? 0 : Math.min(0.16, 0.02 * (t - 8)));
const drift = (t: number) => (t < 8 ? 0 : 0.35 * (t - 8) ** 2);

/** Where a flying thing is: metres ahead of the middle of the mount, its foot's height above where it stands at rest on the pad, how far it leans ahead (radians), and how hard its engines burn (0 to 1). */
export interface Pose {
  ahead: number;
  up: number;
  tilt: number;
  burn: number;
}

/** The booster, `t` seconds after the engines lit: up with the ship, then back down into the arms. */
export function boosterPose(t: number): Pose {
  if (t <= 0) return { ahead: 0, up: 0, tilt: 0, burn: 0 };
  if (t <= FLIGHT.stage) return { ahead: drift(t), up: t < FLIGHT.hold ? 0 : 0.5 * FLIGHT.accel * (t - FLIGHT.hold) ** 2, tilt: lean(t), burn: 1 };
  if (t >= CATCH) return { ahead: 0, up: 0, tilt: 0, burn: 0 };
  const a = t - FLIGHT.stage, b = a - FLIGHT.coast, c = b - FALL_TIME;
  const k = a / (CATCH - FLIGHT.stage);
  const up = a < FLIGHT.coast ? STAGE_UP + STAGE_SPEED * a - 0.5 * (STAGE_SPEED / FLIGHT.coast) * a * a : c < 0 ? PEAK - 0.5 * FLIGHT.fall * b * b : Math.max(0, FLIGHT.burnFrom - FALL_SPEED * c + 0.5 * (FALL_SPEED / BURN_TIME) * c * c);
  return {
    ahead: drift(FLIGHT.stage) * (1 - smooth(k)) + 25 * Math.sin(Math.PI * k),
    up,
    tilt: lean(FLIGHT.stage) * (1 - smooth(clamp01(3 * k))) + 0.22 * Math.sin(2 * Math.PI * k) * (1 - k),
    // The boostback burn, then nothing until the landing burn.
    burn: a < 1.2 ? 0.5 : c >= 0 ? 0.6 : 0,
  };
}

/** The ship: on the booster until staging, then on and up, faster and faster, out of this world. `up` is its own foot above where it rests (on top of the booster). */
export function shipPose(t: number): Pose {
  const at = (s: number) => {
    const b = boosterPose(s);
    return { ahead: b.ahead + SIZE.booster * Math.sin(b.tilt), up: b.up + SIZE.booster * (Math.cos(b.tilt) - 1), tilt: b.tilt };
  };
  if (t <= FLIGHT.stage) return { ...at(t), burn: 0 };
  const from = at(FLIGHT.stage), a = t - FLIGHT.stage;
  return { ahead: from.ahead + 5.6 * a + a * a, up: from.up + STAGE_SPEED * a + 0.5 * FLIGHT.shipAccel * a * a, tilt: from.tilt + 0.03 * a, burn: 1 };
}

/** A point on a flying thing: `along` metres up its own length from its foot, given where its foot rests (metres above the ground). */
export function onHull(site: Site, pose: Pose, restUp: number, along: number): Vec {
  return inWorld(site, 0, restUp + pose.up + along * Math.cos(pose.tilt), SIZE.ahead + pose.ahead + along * Math.sin(pose.tilt));
}

/** How far up the ship (from its foot) its passengers sit. */
export const CABIN = 31;

// ── Arriving from another world ──────────────────────────────────────────

/**
 * A ship coming in: it appears high up and comes straight down tail first
 * (there is no air to slow it), lighting its engines near the ground.
 */
export const ARRIVE = { top: 1300, speed: 90, flipAt: 185, stand: 2.4 } as const;
const FLOP_TIME = (ARRIVE.top - ARRIVE.flipAt) / ARRIVE.speed;
const LAND_TIME = (2 * ARRIVE.flipAt) / ARRIVE.speed;
/** Seconds from appearing to standing on the ground. */
export const DESCENT = FLOP_TIME + LAND_TIME;

/** A ship coming in, `t` seconds after it appears: its foot's height above the ground, and how far over it lies. */
export function arrivalPose(t: number): Pose {
  // (Landed, it stands on its skirt: its foot a little off the ground, its engine bells just clear of it.)
  if (t >= DESCENT) return { ahead: 0, up: ARRIVE.stand, tilt: 0, burn: 0 };
  const s = Math.max(0, t), c = s - FLOP_TIME;
  const up = ARRIVE.stand + (c < 0 ? ARRIVE.top - ARRIVE.speed * s : Math.max(0, ARRIVE.flipAt - ARRIVE.speed * c + 0.5 * (ARRIVE.speed / LAND_TIME) * c * c));
  // Upright all the way: a touch of the engines now and then to steer, then the landing burn.
  return { ahead: 0, up, tilt: 0, burn: c >= -0.4 ? 0.7 : s % 4 < 0.5 ? 0.25 : 0 };
}

/** A point on a ship coming in (it lies over toward +z). */
export function onShip(ship: Pick<Ship, "x" | "z">, pose: Pose, along: number): Vec {
  return [ship.x, pose.up + along * Math.cos(pose.tilt), ship.z + along * Math.sin(pose.tilt)];
}

// ── What a shot can hit ──────────────────────────────────────────────────

/** A ball a shot can hit: its middle and how big, and what it is part of. */
export interface Ball {
  c: Vec;
  r: number;
  of: "booster" | "ship";
}

/** The rocket of a site as balls down its length, where it is `now` (ms): on the mount, or wherever its flight has it. */
export function rocketBalls(pad: Pad, now: number): Ball[] {
  const t = pad.flight ? (now - pad.flight.at) / 1000 : 0;
  const balls: Ball[] = [];
  const r = SIZE.hull / 2 + 0.6;
  if (pad.parts.some(isBooster) && (!pad.flight || pad.flight.booster)) {
    const pose = boosterPose(t);
    for (const n of pad.parts.filter(isBooster)) for (const k of [0.25, 0.75]) balls.push({ c: onHull(pad, pose, SIZE.deck, (n - 14 + k) * SIZE.boosterSection), r, of: "booster" });
  }
  if (pad.parts.some(isShip) && (!pad.flight || pad.flight.ship)) {
    const pose = shipPose(t);
    for (const n of pad.parts.filter(isShip)) for (const k of [0.25, 0.75]) balls.push({ c: onHull(pad, pose, SIZE.deck + SIZE.booster, SHIP_FROM[n - 18]! + k * SIZE.ship[n - 18]!), r, of: "ship" });
  }
  return balls;
}

/** A ship coming in (or landed) as balls down its length, where it is `now`. */
export function shipBalls(ship: Ship, now: number): Ball[] {
  const pose = arrivalPose((now - ship.at) / 1000);
  return [4, 12, 20, 28, 36, 44].map((along) => ({ c: onShip(ship, pose, along), r: SIZE.hull / 2 + 0.6, of: "ship" as const }));
}

/**
 * Something built in the rocket's way: any piece in the nine cells under the
 * mount, from the ground to the top of the sky. Returns how many seconds
 * after the engines light the rocket reaches it (the moment it starts to
 * rise, for anything built against the rocket itself), or null when its way
 * is clear.
 */
export function inTheWay(build: BuildState, pad: Pad): number | null {
  const storey = lowestPiece(build, mountCells(pad), 0, MAX_LEVEL + 4);
  if (storey === null) return null;
  const rise = Math.max(0, storey * LEVEL - (SIZE.deck + SIZE.booster + SIZE.shipTall));
  return FLIGHT.hold + Math.sqrt((2 * rise) / FLIGHT.accel) + 0.05;
}

// ── Reading what is saved and sent ───────────────────────────────────────

const int = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

export function readPad(v: unknown): Pad | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  if (!int(p.id) || !int(p.x) || !int(p.z) || !int(p.dir) || p.dir < 0 || p.dir > 3 || !Array.isArray(p.parts)) return null;
  const parts = [...new Set(p.parts.filter((n): n is number => int(n) && n >= 1 && n <= PARTS))];
  const riders = Array.from({ length: SEATS }, (_, i) => (Array.isArray(p.riders) && typeof p.riders[i] === "string" ? (p.riders[i] as string) : null));
  const f = p.flight as Partial<PadFlight> | null | undefined;
  const flight: PadFlight | null =
    f && typeof f.at === "number" && typeof f.to === "string" && typeof f.trip === "string"
      ? { at: f.at, to: f.to, trip: f.trip, ship: f.ship === true, booster: f.booster === true, ...(typeof f.hitAt === "number" ? { hitAt: f.hitAt } : {}) }
      : null;
  const pad: Pad = { id: p.id, x: p.x, z: p.z, dir: p.dir, parts, touched: typeof p.touched === "number" ? p.touched : 0, readyAt: typeof p.readyAt === "number" ? p.readyAt : 0, riders, count: typeof p.count === "number" ? p.count : 0, to: typeof p.to === "string" ? p.to : "", flight };
  return fits(pad) ? pad : null;
}

export function readShip(v: unknown): Ship | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.trip !== "string" || typeof s.from !== "string" || typeof s.at !== "number" || typeof s.x !== "number" || typeof s.z !== "number" || !int(s.seats)) return null;
  return { trip: s.trip, from: s.from, at: s.at, x: s.x, z: s.z, seats: s.seats, riders: Array.isArray(s.riders) ? s.riders.filter((r): r is string => typeof r === "string") : [], down: s.down === true };
}

/** From the server's half to the page's. `now` is the server's clock (ms), to read times by. */
export type StarToPage =
  /** Every launch site and every ship coming in or landed, on joining. */
  | { k: "pads"; pads: Pad[]; ships: Ship[]; now: number }
  /** A site as it now is (new, or changed). */
  | { k: "pad"; pad: Pad; now: number }
  | { k: "pad-gone"; id: number }
  /** Something asked for was refused. */
  | { k: "pad-no"; why: PlaceProblem | "far" | "locked" | "full" | "overlap" | "holds" | "busy" | "fuelling" | "broken" | "counting" | "nowhere" }
  /** Something blew up there: `size` metres across. */
  | { k: "boom"; at: Vec; size: number }
  /** A ship coming in, as it now is. */
  | { k: "ship"; ship: Ship; now: number }
  | { k: "ship-gone"; trip: string }
  /** To a passenger: the ship is leaving this world. Go to that one, and find this trip there. */
  | { k: "ship-go"; to: string; trip: string };

/** From the page's half to the server's. */
export type StarToServer =
  /** Starts a new site: its tower in this cell, the mount this way from it. */
  | { k: "pad-new"; x: number; z: number; dir: number }
  | { k: "pad-part"; id: number; n: number }
  /** Takes part `n` off (the Remove tool). */
  | { k: "pad-take"; id: number; n: number }
  /** Rides the lift up to a seat in the ship (or comes back down). */
  | { k: "pad-sit"; id: number; on: boolean }
  /** From a seat: starts the countdown, for that world. */
  | { k: "pad-launch"; to: string }
  /** Just arrived from another world, as a passenger of this trip. */
  | { k: "ship-aboard"; trip: string };
