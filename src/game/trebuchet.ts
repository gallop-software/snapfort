import type { BuildState } from "./buildState";
import { CELL, LEVEL, THICK } from "./constants";
import { gridBox, type MaterialId, type Piece } from "./pieces";

/**
 * Trebuchets: range, the stone's flight and what a hit does. Shared by the
 * server (which decides every shot) and the game (which draws it).
 * Distances in metres, times in seconds.
 */
export const TREBUCHET = {
  /** Nearer than this cannot be targeted, so nobody batters their own tower from inside. */
  minRange: 25,
  /** Range from the ground... */
  baseRange: 120,
  /** ...plus this many metres for every metre the trebuchet stands higher. */
  rangePerMetre: 1,
  /** Seconds between shots. */
  reload: 6,
  /** Where the stone leaves the arm, above the trebuchet's base. */
  launchHeight: 7,
  /** Pull of gravity on the stone (a bit stronger than real, for snappy arcs). */
  gravity: 18,
  /** Radius of the stone, for what it touches on the way. */
  stoneRadius: 0.4,
  /** Pieces this close to the impact take a hit. */
  blastRadius: 2.2,
  /** Builders this close to an impact are thrown. */
  throwRadius: 7,
  /** How hard a builder right at the impact is thrown: sideways and upward speed, m/s. */
  throwOut: 26,
  throwUp: 42,
  /** How near a builder must be to get on, from the trebuchet's centre. */
  boardReach: 6,
} as const;

/** Hits a piece takes before it breaks. */
export const MATERIAL_HP: Record<MaterialId, number> = { wood: 1, brick: 2, metal: 3 };
export const TREBUCHET_HP = 2;

export const hitPoints = (p: Piece) => (p.type === "trebuchet" ? TREBUCHET_HP : MATERIAL_HP[p.material]);

export type Vec = [number, number, number];

/** Centre of the trebuchet's base, on the floor it stands on. */
export function trebuchetBase(t: Piece): Vec {
  return [(t.x + 0.5) * CELL, t.y * LEVEL, (t.z + 0.5) * CELL];
}

/** Where the stone is released. */
export function launchPoint(t: Piece): Vec {
  const [x, y, z] = trebuchetBase(t);
  return [x, y + TREBUCHET.launchHeight, z];
}

/** Furthest it can throw: higher trebuchets reach further. */
export function maxRange(t: Piece): number {
  return TREBUCHET.baseRange + t.y * LEVEL * TREBUCHET.rangePerMetre;
}

/** Horizontal distance from the trebuchet to a point. */
export function rangeTo(t: Piece, target: Vec): number {
  const [x, , z] = trebuchetBase(t);
  return Math.hypot(target[0] - x, target[2] - z);
}

export type RangeCheck = "ok" | "near" | "far";

export function checkRange(t: Piece, target: Vec): RangeCheck {
  const d = rangeTo(t, target);
  return d < TREBUCHET.minRange ? "near" : d > maxRange(t) ? "far" : "ok";
}

/** The stone's flight from `from` that passes exactly through `to`. */
export interface Flight {
  from: Vec;
  /** Initial velocity. */
  v: Vec;
  /** Seconds to reach the target. */
  time: number;
}

export function planFlight(from: Vec, to: Vec): Flight {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
  // Further throws fly longer and higher, so every shot reads as a lob.
  const time = 1.5 + d / 45;
  const g = TREBUCHET.gravity;
  return {
    from,
    time,
    v: [(to[0] - from[0]) / time, (to[1] - from[1] + 0.5 * g * time * time) / time, (to[2] - from[2]) / time],
  };
}

export function positionAt(f: Flight, t: number): Vec {
  return [f.from[0] + f.v[0] * t, f.from[1] + f.v[1] * t - 0.5 * TREBUCHET.gravity * t * t, f.from[2] + f.v[2] * t];
}

/**
 * How a builder whose body centre is at `at` is thrown by an impact at
 * `point`: away from it and high into the air, harder the closer they were.
 * null when out of reach.
 */
export function throwVelocity(point: Vec, at: Vec, spin = Math.random()): Vec | null {
  const dx = at[0] - point[0], dy = at[1] - point[1], dz = at[2] - point[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > TREBUCHET.throwRadius) return null;
  const k = 0.55 + 0.45 * (1 - d / TREBUCHET.throwRadius);
  const flat = Math.hypot(dx, dz);
  // Right on top of it: thrown in a random direction.
  const a = flat > 0.3 ? Math.atan2(dx, dz) : spin * Math.PI * 2;
  return [Math.sin(a) * TREBUCHET.throwOut * k, TREBUCHET.throwUp * k, Math.cos(a) * TREBUCHET.throwOut * k];
}

/** A piece's solid space in metres: [minX, minY, minZ, maxX, maxY, maxZ]. */
export function pieceBounds(p: Piece): [number, number, number, number, number, number] {
  const b = gridBox(p);
  let x0 = b[0] * CELL, y0 = b[1] * LEVEL, z0 = b[2] * CELL, x1 = b[3] * CELL, y1 = b[4] * LEVEL, z1 = b[5] * CELL;
  const t = THICK / 2;
  if (p.type === "wall") {
    if (p.rot % 2 === 0) { z0 -= t; z1 += t; } else { x0 -= t; x1 += t; }
  } else if (p.type === "floor") {
    y0 -= t;
    y1 += t;
  } else if (p.type === "trebuchet") {
    y1 = y0 + TREBUCHET.launchHeight;
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Distance from a point to a piece's solid space (0 inside). */
export function distanceToPiece(p: Piece, q: Vec): number {
  const [x0, y0, z0, x1, y1, z1] = pieceBounds(p);
  const dx = Math.max(x0 - q[0], 0, q[0] - x1);
  const dy = Math.max(y0 - q[1], 0, q[1] - y1);
  const dz = Math.max(z0 - q[2], 0, q[2] - z1);
  return Math.hypot(dx, dy, dz);
}

export interface Impact {
  /** Seconds after the throw. */
  time: number;
  point: Vec;
  /** The piece hit, or none for the ground (or open air past the target). */
  pieceId?: string;
}

/**
 * Where the stone lands: the first piece (other than the trebuchet throwing it)
 * that it touches on its way, else the ground. Starting `fromTime` seconds in.
 */
export function findImpact(state: BuildState, f: Flight, ignoreId: string, fromTime = 0): Impact {
  const speed = Math.hypot(...f.v) + TREBUCHET.gravity * f.time;
  const step = Math.min(0.05, 0.3 / speed);
  const limit = f.time * 2.5;
  for (let t = Math.max(fromTime, step); t <= limit; t += step) {
    const q = positionAt(f, t);
    if (q[1] <= 0) return { time: t, point: [q[0], 0, q[2]] };
    for (const p of state.near(q[0], q[1], q[2])) {
      if (p.id !== ignoreId && distanceToPiece(p, q) <= TREBUCHET.stoneRadius) return { time: t, point: q, pieceId: p.id };
    }
  }
  const q = positionAt(f, limit);
  return { time: limit, point: q };
}

/**
 * What a hit at `point` does: every piece within the blast radius takes one
 * hit; those out of hit points break. `damage` holds hits taken so far by
 * piece id and is updated. Returns the pieces that break and the new damage
 * of the ones that hold.
 */
export function strike(state: BuildState, point: Vec, damage: Map<string, number>): { broken: Piece[]; damaged: [string, number][] } {
  const broken: Piece[] = [];
  const damaged: [string, number][] = [];
  const seen = new Set<string>();
  // Blast radius under a cell, so neighbouring cells cover it.
  for (const p of state.near(point[0], point[1], point[2])) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (distanceToPiece(p, point) > TREBUCHET.blastRadius) continue;
    const hits = (damage.get(p.id) ?? 0) + 1;
    if (hits >= hitPoints(p)) {
      broken.push(p);
      damage.delete(p.id);
    } else {
      damage.set(p.id, hits);
      damaged.push([p.id, hits]);
    }
  }
  return { broken, damaged };
}
