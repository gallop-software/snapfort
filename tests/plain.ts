import type { Environment } from "../src/game/environments";

/**
 * A plain world for testing the shared rules on their own: the standard
 * numbers, belonging to no real world. Tests of the shared rules use this, so
 * they never depend on (or break with) any one world.
 */
export const PLAIN: Environment = {
  id: "plain",
  name: "Plain",
  path: "/plain",
  room: "plain",
  paid: false,
  card: { blurb: "", picture: "", perks: [] },
  gravity: 26,
  jumpHeight: 4.2,
  stoneGravity: 9.81,
  flightTime: 1,
  range: 1,
  throwPower: 1,
  knockdownDrop: 2,
  rubbleGravity: 9.81,
  materials: {
    wood: { label: "Wood", color: [0.86, 0.63, 0.4], maxLevel: Infinity, hits: 2 },
    brick: { label: "Brick", color: [0.8, 0.45, 0.36], maxLevel: 29, hits: 4 },
    metal: { label: "Metal", color: [0.63, 0.69, 0.75], maxLevel: 9, hits: 6 },
  },
  siege: {
    name: "Trebuchet",
    minRange: 25,
    baseRange: 300,
    rangePerMetre: 1,
    reload: 6,
    launchHeight: 7,
    stoneRadius: 0.4,
    blastRadius: 2.2,
    throwRadius: 7,
    throwOut: 26,
    throwUp: 42,
    boardReach: 6,
    hits: 1,
  },
  roof: "pyramid",
  labels: {},
};
