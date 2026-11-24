import { CELL, WORLD_HALF_CELLS } from "../../game/constants";
import { planFall, type Fall } from "../../game/fall";
import type { Vec } from "../../game/trebuchet";
import type { Thrown, WorldServer } from "../serverDoors";

/**
 * Thrown into space. On the Moon a hit does not drop you a few metres away:
 * with so little pull you sail up and out, tumbling, until you are high above
 * the towers. Then the rocket pack on your suit lights and flies you back down
 * to the surface, feet first, near where you were hit.
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
const EDGE = WORLD_HALF_CELLS * CELL - 2;

const clamp = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
/** Starts fast and slows to a stop: 0..1 for 0..1. */
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const smooth = (k: number) => k * k * (3 - 2 * k);

export function spaceFlight(hit: Thrown): Fall | null {
  const { from, v, env, build } = hit;
  // Something overhead stopped the throw (a floor above): no way out, an ordinary fall.
  const freeRise = (v[1] * v[1]) / (2 * env.gravity);
  const rose = Math.max(...hit.fall.path.map((p) => p[1])) - from[1];
  if (rose < freeRise * 0.6) return null;

  const flat = Math.hypot(v[0], v[2]);
  const dx = flat > 0.01 ? v[0] / flat : 1, dz = flat > 0.01 ? v[2] / flat : 0;
  const apex: Vec = [clamp(from[0] + dx * SPACE_DRIFT), from[1] + SPACE_RISE, clamp(from[2] + dz * SPACE_DRIFT)];
  // Where the rockets set them down: the first thing under that spot, found by dropping onto it.
  const over: Vec = [clamp(from[0] + dx * SPACE_RETURN), apex[1], clamp(from[2] + dz * SPACE_RETURN)];
  const land = planFall(build, over, [0, 0, 0], env).land;

  const time = SPACE_OUT + SPACE_BACK;
  const at = (t: number): Vec => {
    if (t <= SPACE_OUT) {
      const k = easeOut(t / SPACE_OUT);
      return [from[0] + (apex[0] - from[0]) * k, from[1] + (apex[1] - from[1]) * k, from[2] + (apex[2] - from[2]) * k];
    }
    const s = (t - SPACE_OUT) / SPACE_BACK;
    // Across first, so the last of the way down is straight onto the spot, slowing all the way.
    const across = smooth(Math.min(1, s / 0.6));
    const down = easeOut(s);
    return [apex[0] + (land[0] - apex[0]) * across, apex[1] + (land[1] - apex[1]) * down, apex[2] + (land[2] - apex[2]) * across];
  };
  const path: Vec[] = [];
  for (let i = 0; i < time * 10 - 1e-6; i++) path.push(at(i / 10));
  path.push(land);
  return { from, v, time, land, path, glideFrom: SPACE_OUT };
}

export const server: WorldServer = {
  thrown: spaceFlight,
};
