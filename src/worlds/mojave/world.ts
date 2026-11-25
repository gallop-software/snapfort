import type { Environment } from "../../game/environments";

/** Half the width of Mojave's building area, in cells: twice the usual, 960 m across. */
export const HALF_CELLS = 96;

/**
 * Mojave: Earth, about 2080, a proving ground on a dry lakebed. Every builder
 * here is a general: they mine, build an army and command it from the ground,
 * in the same view as everywhere else (see sim.ts for the rules of the war,
 * and PLAN.md for what was decided with the user).
 *
 * The building rules, the pull and the three material slots are the ones every
 * world has; the pull is the Earth's, as in the Meadow. Built from what a
 * forward base of that time would be made of: carbon lattice, printed concrete
 * and stainless steel. The siege slot is a rail battery, worked by the general.
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
    blurb: "Be the general: mine, build an army and command it from the ground. Eight generals, one desert.",
    picture: "https://cdn.snapfort.io/worlds/mojave.jpg",
    perks: ["Mine lithium and plasma, build an army", "Tanks, drones, artillery and Titans", "Ally with other generals, or go alone"],
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
    // The same three slots, limits and strengths as everywhere; Mojave's own stuff in them.
    wood: { label: "Lattice", color: [0.3, 0.33, 0.37], maxLevel: Infinity, hits: 2 },
    brick: { label: "Printcrete", color: [0.82, 0.78, 0.7], maxLevel: 29, hits: 4 },
    metal: { label: "Steel", color: [0.74, 0.78, 0.82], maxLevel: 9, hits: 6 },
  },

  // The rail battery: the general's own gun. Fast and nearly straight, so it hits the first thing in its line.
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
