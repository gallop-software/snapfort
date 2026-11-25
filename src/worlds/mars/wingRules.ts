/**
 * Wings: how a builder flies on Mars once the air is thick enough (see
 * terraformerRules.ts for the air). Plain numbers, shared by the page's flying
 * and the checks.
 *
 * The science: lift goes with how dense the air is. In Mars's real air, under
 * a hundredth of the Earth's, a wing a person could carry does nothing. In
 * thick air, with only 0.38 of the Earth's pull, a wingsuit glides far, and
 * (the stretch) can be flapped to climb.
 */
export const WINGS = {
  /** Thinner than this and they do not open at all. */
  least: 0.15,
  /** How high above whatever is underneath a builder must be to spread them, m. */
  clearance: 3,
  /** Speed through the air as they open, m/s; the slowest they fly before dropping; and the fastest, in a dive. */
  open: 14,
  stall: 9,
  fastest: 46,
  /** How fast they come down in level flight: in the thinnest air that carries them, and in thick air, m/s. */
  sinkThin: 9.5,
  sinkThick: 0.9,
  /** Flapping (the jump key held): how thick the air must be, and how fast it lifts in thick air, m/s. */
  flapFrom: 0.5,
  flapLift: 6.5,
  /** Never higher than this, m. */
  ceiling: 420,
} as const;

/** How fast a glider comes down in level flight in air this thick, m/s (before any flapping). */
export function sinkIn(air: number): number {
  const k = Math.max(0, Math.min(1, (air - WINGS.least) / (1 - WINGS.least)));
  // Most of the gain comes early: a little air is a lot better than none.
  const eased = 1 - (1 - k) * (1 - k);
  return WINGS.sinkThin + (WINGS.sinkThick - WINGS.sinkThin) * eased;
}

/** How fast flapping lifts in air this thick, m/s (nothing below `flapFrom`). */
export function flapIn(air: number): number {
  return air < WINGS.flapFrom ? 0 : WINGS.flapLift * ((air - WINGS.flapFrom) / (1 - WINGS.flapFrom)) ** 0.6;
}

/**
 * One step of flight. `speed` is through the air (m/s), `pitch` how far down
 * the flier looks (radians; up is negative): looking down dives and gains
 * speed, looking up trades speed for height. Gives the new speed, and how fast
 * they move forward and upward.
 */
export function wingStep(speed: number, pitch: number, air: number, pull: number, dt: number, flap: boolean, brake: boolean): { speed: number; forward: number; up: number } {
  const p = Math.max(-0.7, Math.min(1.25, pitch));
  const drag = (pull * Math.sin(1.1)) / (WINGS.fastest * WINGS.fastest);
  let v = speed + (pull * Math.sin(p) - drag * speed * speed * (brake ? 4 : 1) - (flap ? 1.5 : 0)) * dt;
  v = Math.max(3, Math.min(WINGS.fastest, v));
  // Too slow to fly: the wings stop carrying, and down they go.
  const stalled = Math.max(0, WINGS.stall - v) * 1.1;
  const up = -v * Math.sin(p) - sinkIn(air) - stalled + (flap ? flapIn(air) : 0);
  return { speed: v, forward: v * Math.cos(p), up };
}
