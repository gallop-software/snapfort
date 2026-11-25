import type { BuildState } from "./buildState";
import { CELL, LEVEL, THICK } from "./constants";
import type { Environment } from "./environments";
import { gridBox, type Piece } from "./pieces";

/**
 * Siege engines (the trebuchet, or whatever a world has in its place): range,
 * the stone's flight and what a hit does. Shared by the server (which decides
 * every shot) and the game (which draws it). The numbers are the world's
 * (Environment.siege). Distances in metres, times in seconds.
 */

/** Height of the engine's turntable base: low enough to walk straight onto (builders step up 0.4 m). */
export const TREBUCHET_BASE = 0.35;

/** Hits a piece takes before it breaks. */
export const hitPoints = (p: Piece, env: Environment) => (p.type === "trebuchet" ? env.siege.hits : env.materials[p.material].hits);

export type Vec = [number, number, number];

/** Centre of the trebuchet's base, on the floor it stands on. */
export function trebuchetBase(t: Piece): Vec {
  return [(t.x + 0.5) * CELL, t.y * LEVEL, (t.z + 0.5) * CELL];
}

/** Where the stone is released. */
export function launchPoint(t: Piece, env: Environment): Vec {
  const [x, y, z] = trebuchetBase(t);
  return [x, y + env.siege.launchHeight, z];
}

/** Furthest it can throw: higher engines reach further. */
export function maxRange(t: Piece, env: Environment): number {
  return (env.siege.baseRange + t.y * LEVEL * env.siege.rangePerMetre) * env.range;
}

/** Horizontal distance from the trebuchet to a point. */
export function rangeTo(t: Piece, target: Vec): number {
  const [x, , z] = trebuchetBase(t);
  return Math.hypot(target[0] - x, target[2] - z);
}

export type RangeCheck = "ok" | "near" | "far";

export function checkRange(t: Piece, target: Vec, env: Environment): RangeCheck {
  const d = rangeTo(t, target);
  return d < env.siege.minRange ? "near" : d > maxRange(t, env) ? "far" : "ok";
}

/**
 * The target when the crosshair is on nothing (open sky): the point along the
 * line of sight from `from` in direction `dir` (a unit vector) at the edge of
 * the engine's range, so the shot goes the way the builder looks and carries
 * on past it. Never further than the range in a straight line either (looking
 * steeply up), nor under the ground.
 */
export function openAirTarget(t: Piece, from: Vec, dir: Vec, env: Environment): Vec {
  const reach = maxRange(t, env) * 0.98;
  const [bx, , bz] = trebuchetBase(t);
  const ox = from[0] - bx, oz = from[2] - bz;
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  const b = 2 * (ox * dir[0] + oz * dir[2]);
  const c = ox * ox + oz * oz - reach * reach;
  let s = reach;
  const disc = b * b - 4 * a * c;
  if (a > 1e-9 && disc >= 0) s = Math.min(s, (-b + Math.sqrt(disc)) / (2 * a));
  if (dir[1] < -1e-6) s = Math.min(s, -from[1] / dir[1]);
  s = Math.max(0, s);
  return [from[0] + dir[0] * s, Math.max(0, from[1] + dir[1] * s), from[2] + dir[2] * s];
}

/** The stone's flight from `from` that passes exactly through `to`. */
export interface Flight {
  from: Vec;
  /** Initial velocity. */
  v: Vec;
  /** Seconds to reach the target. */
  time: number;
  /** Pull on the stone, m/s². */
  g: number;
  /**
   * Set when the shot climbs, crosses and dives (see SiegeRules.dive) instead
   * of flying an arc: the height it crosses at, where it comes down, when each
   * leg ends, and how fast it falls from there on. `v` and `g` are then only
   * its speed up off the engine and no pull at all.
   */
  dive?: { top: number; to: Vec; climbed: number; crossed: number; speed: number };
}

export function planFlight(from: Vec, to: Vec, env: Environment): Flight {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
  if (env.siege.dive) {
    // Up, across, down: the same speed all the way, so each leg takes its share of the time.
    const time = env.siege.shotSeconds ?? 3;
    const top = Math.max(from[1], to[1]) + env.siege.dive.apex;
    const up = top - from[1], down = top - to[1];
    const speed = (up + d + down) / time;
    return { from, time, g: 0, v: [0, speed, 0], dive: { top, to, climbed: up / speed, crossed: (up + d) / speed, speed } };
  }
  // As a real trebuchet throws: at about 45 degrees, so the stone is in the air
  // for sqrt(2d / g) seconds and peaks a quarter of the distance up (300 m: about
  // 8 s and 75 m, under the real pull of 9.81). Never under 1.5 s (longer where the world
  // says so), so the nearest shots are lobs too. With a weaker pull the flight is
  // slower by the square root, so the arc keeps its shape.
  // (A world's engine may instead shoot fast and flat: every shot the same short time.)
  const time = env.siege.shotSeconds ?? Math.max(1.5 * env.flightTime, Math.sqrt((2 * d) / env.stoneGravity));
  const g = env.stoneGravity;
  return {
    from,
    time,
    g,
    v: [(to[0] - from[0]) / time, (to[1] - from[1] + 0.5 * g * time * time) / time, (to[2] - from[2]) / time],
  };
}

export function positionAt(f: Flight, t: number): Vec {
  if (f.dive) {
    const { top, to, climbed, crossed, speed } = f.dive;
    if (t <= climbed) return [f.from[0], f.from[1] + speed * t, f.from[2]];
    if (t <= crossed) {
      const k = (t - climbed) / Math.max(1e-9, crossed - climbed);
      return [f.from[0] + (to[0] - f.from[0]) * k, top, f.from[2] + (to[2] - f.from[2]) * k];
    }
    // Straight down on the target, and on down past it if nothing is there.
    return [to[0], top - speed * (t - crossed), to[2]];
  }
  return [f.from[0] + f.v[0] * t, f.from[1] + f.v[1] * t - 0.5 * f.g * t * t, f.from[2] + f.v[2] * t];
}

/**
 * How a builder whose body centre is at `at` is thrown by an impact at
 * `point`: away from it and high into the air, harder the closer they were.
 * null when out of reach.
 */
export function throwVelocity(point: Vec, at: Vec, env: Environment, spin = Math.random()): Vec | null {
  const dx = at[0] - point[0], dy = at[1] - point[1], dz = at[2] - point[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > env.siege.throwRadius) return null;
  const k = 0.55 + 0.45 * (1 - d / env.siege.throwRadius);
  const flat = Math.hypot(dx, dz);
  // Right on top of it: thrown in a random direction.
  const a = flat > 0.3 ? Math.atan2(dx, dz) : spin * Math.PI * 2;
  const p = k * env.throwPower;
  return [Math.sin(a) * env.siege.throwOut * p, env.siege.throwUp * p, Math.cos(a) * env.siege.throwOut * p];
}

/** A piece's solid space in metres: [minX, minY, minZ, maxX, maxY, maxZ]. */
export function pieceBounds(p: Piece, env: Environment): [number, number, number, number, number, number] {
  const b = gridBox(p);
  let x0 = b[0] * CELL, y0 = b[1] * LEVEL, z0 = b[2] * CELL, x1 = b[3] * CELL, y1 = b[4] * LEVEL, z1 = b[5] * CELL;
  const t = THICK / 2;
  if (p.type === "wall") {
    if (p.rot % 2 === 0) { z0 -= t; z1 += t; } else { x0 -= t; x1 += t; }
  } else if (p.type === "floor") {
    y0 -= t;
    y1 += t;
  } else if (p.type === "trebuchet") {
    y1 = y0 + env.siege.launchHeight;
  }
  return [x0, y0, z0, x1, y1, z1];
}

/** Distance from a point to a piece's solid space (0 inside). */
export function distanceToPiece(p: Piece, q: Vec, env: Environment): number {
  const [x0, y0, z0, x1, y1, z1] = pieceBounds(p, env);
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
export function findImpact(state: BuildState, f: Flight, ignoreId: string, env: Environment, fromTime = 0): Impact {
  const speed = Math.hypot(...f.v) + f.g * f.time;
  const step = Math.min(0.05, 0.3 / speed);
  const limit = f.time * 2.5;
  for (let t = Math.max(fromTime, step); t <= limit; t += step) {
    const q = positionAt(f, t);
    if (q[1] <= 0) return { time: t, point: [q[0], 0, q[2]] };
    for (const p of state.near(q[0], q[1], q[2])) {
      if (p.id !== ignoreId && distanceToPiece(p, q, env) <= env.siege.stoneRadius) return { time: t, point: q, pieceId: p.id };
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
export function strike(state: BuildState, point: Vec, damage: Map<string, number>, env: Environment): { broken: Piece[]; damaged: [string, number][] } {
  const broken: Piece[] = [];
  const damaged: [string, number][] = [];
  const seen = new Set<string>();
  // Blast radius under a cell, so neighbouring cells cover it.
  for (const p of state.near(point[0], point[1], point[2])) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (distanceToPiece(p, point, env) > env.siege.blastRadius) continue;
    const hits = (damage.get(p.id) ?? 0) + 1;
    if (hits >= hitPoints(p, env)) {
      broken.push(p);
      damage.delete(p.id);
    } else {
      damage.set(p.id, hits);
      damaged.push([p.id, hits]);
    }
  }
  return { broken, damaged };
}
