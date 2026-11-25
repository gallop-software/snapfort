/**
 * The Martian day, the sol. A real one lasts 24 h 37 min; here one passes in
 * twenty minutes (the one liberty Mars takes with time), and it is the same
 * hour for everyone, since it is read off the clock.
 *
 * Plain numbers only: the scenery draws from these, and they can be checked
 * without a page.
 */

type Vec = readonly [number, number, number];

/** Seconds a sol takes. */
export const SOL_SECONDS = 20 * 60;
/** How much of a sol the sun is up. More than the real half: nights are for looking at, days for building. */
export const DAY_SHARE = 0.65;
/** How often Phobos comes round in a sol. (Really a little over twice: it outruns the planet's turning.) */
export const PHOBOS_PASSES = 2.2;

const smooth = (lo: number, hi: number, v: number) => {
  const k = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return k * k * (3 - 2 * k);
};
const fraction = (v: number) => v - Math.floor(v);

/** Sols since the clock's start at this time (ms): the whole part counts sols, the rest is how far through this one, from sunrise. */
export function solsAt(ms: number): number {
  return ms / 1000 / SOL_SECONDS;
}

/** The sun's angle along its path at this point in a sol (0..1 from sunrise): 0 rising, π setting, on round to 2π under the ground. */
export function sunAngle(phase: number): number {
  const p = fraction(phase);
  return p < DAY_SHARE ? (Math.PI * p) / DAY_SHARE : Math.PI + (Math.PI * (p - DAY_SHARE)) / (1 - DAY_SHARE);
}

/** A point on a tilted circle across the sky: up in the east (+x) at 0, overhead-ish at π/2, down in the west at π. */
function onPath(angle: number, tilt: number): Vec {
  return [Math.cos(angle), Math.sin(angle) * Math.cos(tilt), Math.sin(angle) * Math.sin(tilt)];
}

/** Which way the sun is (a unit vector toward it). It rises in the east and crosses a little to the south. */
export function sunDirection(phase: number): Vec {
  return onPath(sunAngle(phase), -0.5);
}

/** How high the sun stands: 1 overhead, 0 on the horizon, negative below it. */
export function sunHeight(phase: number): number {
  return Math.sin(sunAngle(phase));
}

/** How light it is: 1 in full day, 0 in full night, easing through twilight. */
export function daylight(phase: number): number {
  return smooth(-0.2, 0.12, sunHeight(phase));
}

/** How much of the sunset there is: 1 with the sun on the horizon, 0 well clear of it either way. On Mars this is when the sky round the sun turns blue. */
export function dusk(phase: number): number {
  return Math.max(0, 1 - Math.abs(sunHeight(phase)) / 0.34);
}

/** Phobos: it rises in the west and sets in the east, more than twice a sol. `sols` is the running count (see solsAt). */
export function phobosDirection(sols: number): Vec {
  const [x, y, z] = onPath(Math.PI * 2 * fraction(sols * PHOBOS_PASSES), 0.3);
  return [-x, y, z];
}

/** Deimos: a bright dot that barely moves, taking more than five sols to come round. */
export function deimosDirection(sols: number): Vec {
  return onPath(Math.PI * 2 * fraction(sols / 5.4 + 0.12), 0.75);
}

/** The Earth: an evening star, following the sun down. */
export function earthDirection(phase: number): Vec {
  return onPath(sunAngle(phase) - 0.42, -0.42);
}
