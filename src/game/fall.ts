import type { BuildState } from "./buildState";
import { CELL, LEVEL, THICK, WORLD_HALF_CELLS } from "./constants";
import { MEADOW, type Environment } from "./environments";
import { normalizeSpec, type Piece } from "./pieces";
import { TREBUCHET_BASE, type Vec } from "./trebuchet";

/**
 * A builder thrown by a trebuchet, or left standing on nothing: where they fly
 * and where they come down. Worked out by the server from the build, so every
 * page plays the same flight, even for a builder whose tab is in the
 * background. Positions are the centre of the builder's body, in metres.
 */

/** Same pull as the builder's own physics, in the meadow (see Environment.gravity). */
export const FALL_GRAVITY = MEADOW.gravity;
/** Half the builder's height: the body's centre is this far above the feet. */
const HALF = 0.9;
const RADIUS = 0.4;
const STEP = 1 / 120;
const LIMIT = WORLD_HALF_CELLS * CELL + 12;
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
}

/**
 * The height someone can stand on at (x, z) on piece `p`, or null when that
 * spot is not on it. Matches the shapes the game draws.
 */
export function standHeight(p: Piece, x: number, z: number): number | null {
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
  switch (s.type) {
    case "floor":
      return base + THICK / 2;
    case "trebuchet":
      return base + TREBUCHET_BASE;
    case "roof":
      return base + LEVEL * Math.max(0, 1 - 2 * Math.max(Math.abs(cu - 0.5), Math.abs(cw - 0.5)));
    case "ramp": {
      const k = s.rot === 0 ? cw : s.rot === 1 ? cu : s.rot === 2 ? 1 - cw : 1 - cu;
      return base + THICK / 2 + k * LEVEL;
    }
  }
}

/** True when a body centred at `c` runs into the side of a wall (not standing on its top). */
function hitsWallSide(p: Piece, c: Vec): boolean {
  if (p.type !== "wall") return false;
  const top = standHeight(p, c[0], c[2]);
  if (top === null) return false;
  const feet = c[1] - HALF, head = c[1] + HALF;
  return feet < top - 0.25 && head > p.y * LEVEL;
}

/**
 * Plans a fall from `from` (body centre) with starting velocity `v`: gravity
 * pulls, the side of a wall stops the sideways motion, the underside of
 * something stops a rise, and the first surface met on the way down (or the
 * ground) is where they land.
 */
export function planFall(state: BuildState, from: Vec, v: Vec, env: Environment = MEADOW): Fall {
  let [x, y, z] = from;
  let [vx, vy, vz] = v;
  const path: Vec[] = [[x, y, z]];
  let t = 0;
  // Long enough for the longest throw on the Moon.
  for (; t < 20; t += STEP) {
    const nx = Math.max(-LIMIT, Math.min(LIMIT, x + vx * STEP));
    const nz = Math.max(-LIMIT, Math.min(LIMIT, z + vz * STEP));
    if (nx !== x + vx * STEP) vx = 0;
    if (nz !== z + vz * STEP) vz = 0;
    let ny = y + vy * STEP;
    vy -= env.gravity * STEP;
    const near = state.near(nx, ny - HALF, nz).concat(state.near(nx, ny + HALF, nz));
    // Into a wall: lose the sideways speed and slide down it.
    if (near.some((p) => hitsWallSide(p, [nx, ny, nz]))) {
      vx = vz = 0;
    } else {
      x = nx;
      z = nz;
    }
    // Rising into the underside of a floor or anything above: stop rising.
    if (vy > 0) {
      for (const p of near) {
        if (p.type !== "floor") continue;
        const under = p.y * LEVEL - THICK / 2;
        if (standHeight(p, x, z) !== null && y + HALF <= under && ny + HALF > under) {
          ny = under - HALF;
          vy = 0;
        }
      }
    }
    // Coming down onto something, or the ground.
    if (vy <= 0) {
      let surface = 0;
      for (const p of near) {
        const h = standHeight(p, x, z);
        if (h !== null && h <= y - HALF + 0.05 && h > surface) surface = h;
      }
      if (ny - HALF <= surface) {
        const land: Vec = [x, surface + HALF, z];
        path.push(land);
        return { from, v, time: t + STEP, land, path };
      }
    }
    y = ny;
    if (Math.floor((t + STEP) * 10 + 1e-9) !== Math.floor(t * 10 + 1e-9)) path.push([x, y, z]);
  }
  return { from, v, time: t, land: [x, Math.max(HALF, y), z], path };
}

/** Where a fall puts the body's centre `t` seconds after it starts. */
export function fallPosition(f: Fall, t: number): Vec {
  if (t >= f.time) return f.land;
  // Between the stored points (a tenth of a second apart, the last being the landing).
  const i = Math.min(f.path.length - 2, Math.floor(t * 10));
  const a = f.path[i]!, b = f.path[i + 1]!;
  const t0 = i / 10, t1 = i + 1 === f.path.length - 1 ? f.time : (i + 1) / 10;
  const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
