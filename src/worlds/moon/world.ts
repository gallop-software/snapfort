import type { Environment } from "../../game/environments";

/**
 * The Moon: a third of the pull. A jump goes about 1.6 times as high as in the
 * meadow (nearly two storeys) and floats down, the launcher fires chunks of
 * moon rock fast and straight and reaches much further, and anyone hit is thrown into space and flown back by
 * the rockets on their suit (space.ts). There are rovers to drive (rovers.ts).
 * (A sixth of the pull, like the real Moon, made building fiddly.)
 *
 * Built from what is to hand: a light lattice skinned in gold foil, blocks
 * baked from moon dust, and titanium hull plate. Roofs are domes, the siege
 * engine is a launcher, and builders wear space suits.
 *
 * Copied from the Meadow (2026-11-23) and changed from there; the two share no code.
 */
export const world: Environment = {
  id: "moon",
  name: "Moon",
  path: "/moon",
  room: "moon",
  paid: true,
  card: {
    blurb: "Low gravity, space suits and rovers. Get hit and you are thrown into space.",
    picture: "/worlds/moon.jpg",
    perks: ["Build in lattice, regolith and titanium", "Launchers reach 1.6× further", "Blast rivals into space"],
  },

  gravity: 26 / 3,
  jumpHeight: 6.8,
  stoneGravity: 9.81 / 3,
  flightTime: Math.sqrt(3),
  range: 1.6,
  throwPower: 0.75,
  knockdownDrop: 4,
  rubbleGravity: 9.81 / 3,

  materials: {
    // The same three slots, limits and strengths as everywhere; the Moon's own stuff in them.
    wood: { label: "Lattice", color: [0.9, 0.72, 0.36], maxLevel: Infinity, hits: 2 },
    brick: { label: "Regolith", color: [0.6, 0.58, 0.57], maxLevel: 29, hits: 4 },
    metal: { label: "Titanium", color: [0.7, 0.8, 0.92], maxLevel: 9, hits: 6 },
  },

  siege: {
    name: "Launcher",
    // No minimum: the launcher can hit anything, however near (user, 2026-11-24). The trebuchet keeps its own.
    minRange: 0,
    baseRange: 300,
    rangePerMetre: 1,
    // A shot every 3 seconds (user, 2026-11-23); a trebuchet takes 6.
    reload: 3,
    launchHeight: 7,
    // Big chunks of moon rock, there in under a second, nearly straight (user, 2026-11-23): it hits
    // the first thing in its line, so it cannot be lobbed over a wall as a trebuchet's stone can.
    shotSeconds: 0.8,
    stoneRadius: 0.7,
    blastRadius: 2.2,
    throwRadius: 7,
    throwOut: 26,
    throwUp: 42,
    boardReach: 6,
    hits: 1,
  },

  roof: "dome",
  labels: { roof: "Dome" },
};
