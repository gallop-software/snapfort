/**
 * The worlds SnapFort can be played in. Each is its own shared world with the
 * same building rules; what differs is how things move (gravity, jumping,
 * stones, throws) and how it looks. The meadow is free; the others come with
 * the Full Game.
 *
 * Rules that depend on the world take it as an argument rather than reading a
 * "current" one: on the server, two worlds can run in the same process.
 */

export type EnvironmentId = "meadow" | "moon";

export interface Environment {
  id: EnvironmentId;
  name: string;
  /** Needs the Full Game to build in (anyone may visit). */
  paid: boolean;
  /** Pull on builders, in m/s² (also their falls and throws). */
  gravity: number;
  /** How high a jump lifts the feet, m. */
  jumpHeight: number;
  /** Pull on trebuchet stones, m/s². */
  stoneGravity: number;
  /** Stone flights take this much longer (with weaker pull, the same arc shape). */
  flightTime: number;
  /** Trebuchets reach this much further. */
  range: number;
  /** Builders hit by a stone are thrown this much harder (less, where they would fly out of the world). */
  throwPower: number;
  /** A fall shorter than this does not knock a builder down, m. */
  knockdownDrop: number;
  /** Pull on rubble, m/s². */
  rubbleGravity: number;
}

export const MEADOW: Environment = {
  id: "meadow",
  name: "Meadow",
  paid: false,
  gravity: 26,
  // Over one wall (a storey, 3.75 m) with room to spare (user, 2026-11-23).
  jumpHeight: 4.2,
  // Real gravity: with the 45 degree throw (see planFlight), stones fly as a medieval trebuchet's did.
  stoneGravity: 9.81,
  flightTime: 1,
  range: 1,
  throwPower: 1,
  knockdownDrop: 2,
  rubbleGravity: 9.81,
};

/**
 * The Moon: a third of the pull. A jump goes about 1.6 times as high as in the
 * meadow (nearly two storeys) and floats down,
 * stones fly slow, high lobs and reach much further, and anyone hit sails a
 * long way. (A sixth, like the real Moon, made building fiddly and throws
 * leave the world.)
 */
export const MOON: Environment = {
  id: "moon",
  name: "Moon",
  paid: true,
  gravity: 26 / 3,
  jumpHeight: 6.8,
  stoneGravity: 9.81 / 3,
  flightTime: Math.sqrt(3),
  range: 1.6,
  throwPower: 0.75,
  knockdownDrop: 4,
  rubbleGravity: 9.81 / 3,
};

export const ENVIRONMENTS: Record<EnvironmentId, Environment> = { meadow: MEADOW, moon: MOON };

/** The environment with this id, or the meadow for anything else. */
export function environmentOf(id: unknown): Environment {
  return typeof id === "string" && id in ENVIRONMENTS ? ENVIRONMENTS[id as EnvironmentId] : MEADOW;
}
