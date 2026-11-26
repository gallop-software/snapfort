import type { BuildState } from "../../game/buildState";
import { CELL, WORLD_HALF_CELLS } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { planFall, type Fall } from "../../game/fall";
import type { Box } from "../../game/keepOut";
import type { Vec } from "../../game/trebuchet";
import type { Thrown } from "../serverDoors";

/**
 * Thrown into space. On the Moon a hit does not drop you a few metres away:
 * with so little pull you sail up and out, tumbling, until you are high above
 * the towers. Then the rocket pack on your suit lights and flies you back down
 * to the surface, feet first, near where you were hit. The same rockets bring
 * back anyone who leaves the Moon another way (see rovers.ts).
 */

/** How far up a throw carries, m, and how far out along the way. */
export const SPACE_RISE = 170;
const SPACE_DRIFT = 45;
/** Seconds going up (tumbling), and coming back on the rockets. */
export const SPACE_OUT = 5;
export const SPACE_BACK = 5.5;
/** Rockets bring you down this far from where you were hit (further out, the way you were thrown), m. */
const SPACE_RETURN = 10;
/** Stay inside the building area. */
export const EDGE = WORLD_HALF_CELLS * CELL - 2;

const clamp = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
/** Starts fast and slows to a stop: 0..1 for 0..1. */
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Where the rockets set someone down who is above (x, z) at height `y`: on the first thing under that spot, inside the building area. */
export function landingUnder(build: BuildState, env: Environment, x: number, y: number, z: number, others: () => readonly Box[] = () => []): Vec {
  // (Also used for a rover coming down: the same first thing under the spot. The first thing may be the Moon's own: a rail gun, a rover, a ship.)
  return planFall(build, [clamp(x), Math.max(y, 2), clamp(z)], [0, 0, 0], env, others).land;
}

/** A point on the rockets' way from `from` down to `land`, `s` (0..1) of the way through: across first, so the last of it is straight down onto the spot, slowing all the way. */
function rocketPoint(from: Vec, land: Vec, s: number): Vec {
  const across = smooth(Math.min(1, s / 0.6));
  const down = easeOut(s);
  return [from[0] + (land[0] - from[0]) * across, from[1] + (land[1] - from[1]) * down, from[2] + (land[2] - from[2]) * across];
}

/** Being thrown by an impact: out into space, then back on the rockets. Null under a roof (no way out: an ordinary fall). */
export function spaceFlight(hit: Thrown, others: () => readonly Box[] = () => []): Fall | null {
  const { from, v, env, build } = hit;
  const freeRise = (v[1] * v[1]) / (2 * env.gravity);
  const rose = Math.max(...hit.fall.path.map((p) => p[1])) - from[1];
  if (rose < freeRise * 0.6) return null;

  const flat = Math.hypot(v[0], v[2]);
  const dx = flat > 0.01 ? v[0] / flat : 1, dz = flat > 0.01 ? v[2] / flat : 0;
  const apex: Vec = [clamp(from[0] + dx * SPACE_DRIFT), from[1] + SPACE_RISE, clamp(from[2] + dz * SPACE_DRIFT)];
  const land = landingUnder(build, env, from[0] + dx * SPACE_RETURN, apex[1], from[2] + dz * SPACE_RETURN, others);

  const time = SPACE_OUT + SPACE_BACK;
  const at = (t: number): Vec => {
    if (t > SPACE_OUT) return rocketPoint(apex, land, (t - SPACE_OUT) / SPACE_BACK);
    const k = easeOut(t / SPACE_OUT);
    return [from[0] + (apex[0] - from[0]) * k, from[1] + (apex[1] - from[1]) * k, from[2] + (apex[2] - from[2]) * k];
  };
  const path: Vec[] = [];
  for (let i = 0; i < time * 10 - 1e-6; i++) path.push(at(i / 10));
  path.push(land);
  return { from, v, time, land, path, glideFrom: SPACE_OUT };
}

/**
 * Rockets all the way: from wherever someone left the Moon (`from`, body
 * centre) back down to the surface under them, or `aside` (metres along x
 * and z) from there.
 */
export function rocketsBack(build: BuildState, env: Environment, from: Vec, others: () => readonly Box[] = () => [], aside: readonly [number, number] = [0, 0]): Fall {
  const land = landingUnder(build, env, from[0] + aside[0], from[1], from[2] + aside[1], others);
  const far = Math.hypot(from[0] - land[0], from[1] - land[1], from[2] - land[2]);
  // Longer from higher up, but never a long wait.
  const time = Math.round(Math.max(2.5, Math.min(7, 2.5 + far / 35)) * 10) / 10;
  const path: Vec[] = [];
  for (let i = 0; i < time * 10 - 1e-6; i++) path.push(rocketPoint(from, land, i / 10 / time));
  path.push(land);
  return { from, v: [0, 0, 0], time, land, path, glideFrom: 0 };
}
