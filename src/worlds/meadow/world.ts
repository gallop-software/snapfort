import type { Environment } from "../../game/environments";

/**
 * The Meadow: the free world everyone starts in. Soft sky, green grass, wooden
 * trebuchets. Its numbers are the ones the game was first tuned with.
 */
export const world: Environment = {
  id: "meadow",
  name: "Meadow",
  path: "/",
  // The first world ever saved, from before worlds had names of their own.
  room: "main",
  paid: false,
  card: {
    blurb: "Build castles, fire trebuchets, and fly a Starship to the Moon.",
    picture: "https://cdn.snapfort.io/worlds/meadow.jpg",
    perks: [],
  },

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

  // Heavy metal belongs in a tower's base, brick in its middle, and wood goes
  // all the way up: storeys 1–10 for metal, 1–30 for brick, counting the ground
  // storey as 1. Hits before a piece breaks were doubled from 1, 2, 3 (user, 2026-11-22).
  materials: {
    wood: { label: "Wood", color: [0.86, 0.63, 0.4], maxLevel: Infinity, hits: 2 },
    brick: { label: "Brick", color: [0.8, 0.45, 0.36], maxLevel: 29, hits: 4 },
    metal: { label: "Metal", color: [0.63, 0.69, 0.75], maxLevel: 9, hits: 6 },
  },

  siege: {
    name: "Trebuchet",
    minRange: 25,
    // What the big medieval ones managed with a stone that hurt a wall (user, 2026-11-23).
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
    // A trebuchet breaks with one hit (user, 2026-11-22).
    hits: 1,
  },

  roof: "pyramid",
  labels: {},
};
