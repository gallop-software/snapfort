import type { BuildState } from "./buildState";
import { CELL, LEVEL, THICK } from "./constants";
import { halfCellsOf, type Environment, type RoofShape } from "./environments";
import { normalizeSpec, type Piece } from "./pieces";
import { roofHeight } from "./roofs";
import { Solids, type Box } from "./solids";
import { TREBUCHET_BASE, type Vec } from "./trebuchet";

/**
 * A builder thrown by a trebuchet, or left standing on nothing: where they fly
 * and where they come down. Worked out by the server from the build, so every
 * page plays the same flight, even for a builder whose tab is in the
 * background. Positions are the centre of the builder's body, in metres.
 */

/** Half the builder's height: the body's centre is this far above the feet. */
const HALF = 0.9;
const RADIUS = 0.4;
const STEP = 1 / 120;
/** Lying flat after coming down, then getting up (seconds). */
export const DOWN_TIME = 1.5;
export const RISE_TIME = 0.7;

export interface Fall {
  from: Vec;
  /** Starting velocity. */
  v: Vec;
  /** Seconds in the air. */
  time: number;
  /** Where the body's centre comes to rest. */
  land: Vec;
  /** Points along the way at every tenth of a second (for drawing the flight). */
  path: Vec[];
  /**
   * From this many seconds in, the builder is no longer tumbling but flying
   * down under control (a world's own way back: rockets, say), and lands on
   * their feet. Left out for an ordinary fall, which ends flat on the ground.
   */
  glideFrom?: number;
  /**
   * The flight ends in the air on purpose (a world's own launch): the builder
   * is not brought down from there, but carries on under their own control.
   * For the server only; not sent.
   */
  aloft?: boolean;
}

/** What a builder on a planned flight is doing `t` seconds in. */
export type FallPhase = "tumble" | "glide" | "down" | "done";

export function fallPhase(f: Fall, t: number): FallPhase {
  if (t < (f.glideFrom ?? f.time)) return "tumble";
  if (t < f.time) return "glide";
  return t < fallEnd(f) ? "down" : "done";
}

/** Seconds until a builder on this flight is back on their feet. */
export function fallEnd(f: Fall): number {
  return f.glideFrom === undefined ? f.time + DOWN_TIME + RISE_TIME : f.time;
}

/**
 * The height someone can stand on at (x, z) on piece `p`, or null when that
 * spot is not on it. Matches the shapes the game draws.
 */
export function standHeight(p: Piece, x: number, z: number, roof: RoofShape = "pyramid"): number | null {
  const s = normalizeSpec(p);
  const base = s.y * LEVEL;
  const u = x / CELL - s.x, w = z / CELL - s.z;
  const r = RADIUS / CELL;
  if (s.type === "wall") {
    const t = THICK / 2 / CELL + r;
    const on = s.rot === 0 ? u >= 0 && u <= 1 && Math.abs(w) <= t : w >= 0 && w <= 1 && Math.abs(u) <= t;
    return on ? base + LEVEL : null;
  }
  if (u < -r || u > 1 + r || w < -r || w > 1 + r) return null;
  const cu = Math.min(1, Math.max(0, u)), cw = Math.min(1, Math.max(0, w));
  // A floor with a tile cut out has a hole there.
  if (s.type === "floor" && p.edit && (p.edit & (1 << ((cu >= 0.5 ? 1 : 0) + (cw >= 0.5 ? 2 : 0)))) !== 0) return null;
  switch (s.type) {
    case "floor":
      return base + THICK / 2;
    case "trebuchet":
      return base + TREBUCHET_BASE;
    case "roof":
      return base + LEVEL * roofHeight(roof, cu, cw);
    case "ramp": {
      const k = s.rot === 0 ? cw : s.rot === 1 ? cu : s.rot === 2 ? 1 - cw : 1 - cu;
      return base + THICK / 2 + k * LEVEL;
    }
  }
}

/** How the straight middle of the builder's body reaches up and down from its centre: with the radius, 1.8 m tall. */
const MIDDLE = HALF - RADIUS;
/** Stored points of a flight are this many a second: close enough that a straight line between two never cuts a corner. */
export const PATH_RATE = 30;

/**
 * Plans a fall from `from` (body centre) with starting velocity `v`, against
 * the build as it is drawn (a door cut in a wall is a way through, a ramp is
 * a slope, a roof its own shape), and a world's own solid things (`extra`):
 * gravity pulls, running into the side of anything stops the sideways
 * motion, the underside of anything stops a rise, and the first surface met
 * on the way down (or the ground) is where they land.
 */
export function planFall(state: BuildState, from: Vec, v: Vec, env: Environment, extra: () => readonly Box[] = () => []): Fall {
  const solids = new Solids(state, env, extra);
  let [x, y, z] = from;
  let [vx, vy, vz] = v;
  const path: Vec[] = [[x, y, z]];
  let t = 0;
  // The edge of the world: nobody is thrown past it.
  const LIMIT = halfCellsOf(env) * CELL + 12;
  // Long enough for the longest throw on the Moon.
  for (; t < 20; t += STEP) {
    const nx = Math.max(-LIMIT, Math.min(LIMIT, x + vx * STEP));
    const nz = Math.max(-LIMIT, Math.min(LIMIT, z + vz * STEP));
    if (nx !== x + vx * STEP) vx = 0;
    if (nz !== z + vz * STEP) vz = 0;
    let ny = y + vy * STEP;
    vy -= env.gravity * STEP;
    // Into the side of something (not just onto its top): lose the sideways speed and slide down it.
    if ((nx !== x || nz !== z) && solids.touch([nx, y, nz], RADIUS, MIDDLE, { stepUp: 0.25 })) {
      vx = vz = 0;
    } else {
      x = nx;
      z = nz;
    }
    // Rising into the underside of anything: stop rising.
    if (vy > 0) {
      const under = solids.ceilingOver(x, z, y + HALF, RADIUS * 0.7);
      if (ny + HALF > under) {
        ny = Math.min(y, under - HALF);
        vy = 0;
      }
    }
    // Coming down onto something, or the ground.
    if (vy <= 0) {
      const surface = solids.surfaceUnder(x, z, y - HALF, RADIUS * 0.7, 2 * LEVEL);
      if (ny - HALF <= surface) {
        const land: Vec = [x, surface + HALF, z];
        path.push(land);
        return { from, v, time: t + STEP, land, path };
      }
    }
    y = ny;
    if (Math.floor((t + STEP) * PATH_RATE + 1e-9) !== Math.floor(t * PATH_RATE + 1e-9)) path.push([x, y, z]);
  }
  return { from, v, time: t, land: [x, Math.max(HALF, y), z], path };
}

/** Where a fall puts the body's centre `t` seconds after it starts. */
export function fallPosition(f: Fall, t: number): Vec {
  if (t >= f.time) return f.land;
  // Between the stored points (PATH_RATE a second, the last being the landing). A flight sent by a server from before
  // the points were closer has them a tenth of a second apart: told by how many there are for its time.
  const rate = f.path.length - 2 > f.time * 12 ? PATH_RATE : 10;
  const i = Math.min(f.path.length - 2, Math.floor(t * rate));
  const a = f.path[i]!, b = f.path[i + 1]!;
  const t0 = i / rate, t1 = i + 1 === f.path.length - 1 ? f.time : (i + 1) / rate;
  const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
