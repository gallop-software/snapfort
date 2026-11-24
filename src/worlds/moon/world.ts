import type { Environment } from "../../game/environments";

/**
 * The Moon: a third of the pull. A jump goes about 1.6 times as high as in the
 * meadow (nearly two storeys) and floats down, stones fly slow, high lobs and
 * reach much further, and anyone hit sails a long way. (A sixth, like the real
 * Moon, made building fiddly and throws leave the world.)
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
    blurb: "Low gravity: jump two storeys, launch further, send rivals flying.",
    picture: "/worlds/moon.jpg",
    perks: ["Jump nearly two storeys in low gravity", "Launchers reach 1.6× further", "Send rivals flying 100 m"],
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

  roof: "dome",
  labels: { roof: "Dome" },
};
