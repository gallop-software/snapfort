import type { Environment } from "../../game/environments";

/** Half the width of Mojave's building area, in cells: twice the usual, 960 m across. */
export const HALF_CELLS = 96;

/**
 * Mojave: Earth, about 2080, a proving ground on a dry lakebed. Every builder
 * here is a general: they mine, build an army and command it from the ground,
 * in the same view as everywhere else (see sim.ts for the rules of the war,
 * and PLAN.md for what was decided with the user).
 *
 * The building rules and the pull are the ones every world has; the pull is
 * the Earth's, as in the Meadow. There is one material here, printed
 * concrete: the three slots every world's builds are saved in are all filled
 * with it, so a piece is the same whichever it was saved under. Nobody builds
 * a siege engine here (the server refuses one, and the row has no tile for
 * it): armies do the breaking. The siege rules below are only what the shared
 * shape of a world asks for.
 *
 * Copied from the Meadow (2026-11-25) and changed from there; the two share no code.
 */
export const world: Environment = {
  id: "mojave",
  name: "Mojave",
  said: "Mojave",
  path: "/mojave",
  room: "mojave",
  paid: true,
  card: {
    blurb: "Be the general: mine, build an army and command it from the ground. Up to eight armies, one desert.",
    picture: "https://cdn.snapfort.io/worlds/mojave.jpg",
    perks: ["Mine lithium and plasma, build an army", "Tanks, drones, artillery and Titans", "Up to eight generals: choose your colour, team up or go it alone"],
  },

  // No ship lands here and none leaves: what a general has, they made here.
  apart: true,
  // Twice as wide as the other worlds, so eight bases are not on top of each other.
  halfCells: HALF_CELLS,

  gravity: 26,
  jumpHeight: 4.2,
  stoneGravity: 9.81,
  flightTime: 1,
  range: 1,
  throwPower: 1,
  knockdownDrop: 2,
  rubbleGravity: 9.81,

  materials: {
    // One material, in all three slots: built to any height, four hits.
    wood: { label: "Printcrete", color: [0.82, 0.78, 0.7], maxLevel: Infinity, hits: 4 },
    brick: { label: "Printcrete", color: [0.82, 0.78, 0.7], maxLevel: Infinity, hits: 4 },
    metal: { label: "Printcrete", color: [0.82, 0.78, 0.7], maxLevel: Infinity, hits: 4 },
  },

  // (Never built here: see above.)
  siege: {
    name: "Rail battery",
    minRange: 0,
    baseRange: 260,
    rangePerMetre: 1,
    reload: 5,
    launchHeight: 7,
    shotSeconds: 0.6,
    stoneRadius: 0.5,
    blastRadius: 2.4,
    throwRadius: 7,
    throwOut: 24,
    throwUp: 36,
    boardReach: 6,
    hits: 2,
  },

  roof: "pyramid",
  labels: { roof: "Canopy" },
};
