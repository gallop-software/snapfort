import type { Environment } from "../../game/environments";

/** Mars's pull beside the Earth's: the real figure. */
export const PULL = 0.38;

/**
 * Mars: real science first, stretched a little. The pull is the true 0.38 of
 * the Earth's (the Moon here is a third, so the two feel alike underfoot; what
 * sets Mars apart is that it has air, weather, and a day that passes).
 *
 * Its own things, each in a file of its own here: a beacon whose missile dives
 * from above (the siege numbers below), airbags for whoever is hit, the
 * Terraformer and the air it makes, wings and helicopters to fly in it, and
 * Starships to and from the other worlds.
 *
 * Built from what a real base would use: ice cells in an inflatable skin (the
 * light slot: NASA's Mars Ice Home), bricks pressed from the red soil with no
 * binder, and iron smelted from the rust that makes the planet red. Roofs are
 * glass greenhouses.
 *
 * Copied from the Moon (2026-11-24) and changed from there; the two share no code.
 */
export const world: Environment = {
  id: "mars",
  name: "Mars",
  said: "Mars",
  path: "/mars",
  room: "mars",
  paid: true,
  card: {
    blurb: "Build the machine that gives the red planet air, then spread your wings and fly.",
    picture: "https://cdn.snapfort.io/worlds/mars.jpg",
    perks: ["Build in ice, redbrick and iron", "A Terraformer, wings and helicopters", "A day that passes, with a blue sunset"],
  },

  gravity: 26 * PULL,
  // What the real pull would give is over 10 m; like the Moon's, this is set by feel.
  jumpHeight: 6.2,
  stoneGravity: 9.81 * PULL,
  flightTime: Math.sqrt(1 / PULL),
  range: 1.5,
  throwPower: 0.8,
  knockdownDrop: 3.6,
  rubbleGravity: 9.81 * PULL,

  materials: {
    // The same three slots, limits and strengths as everywhere; Mars's own stuff in them.
    wood: { label: "Ice", color: [0.7, 0.88, 1], maxLevel: Infinity, hits: 2 },
    brick: { label: "Redbrick", color: [0.8, 0.4, 0.27], maxLevel: 29, hits: 4 },
    metal: { label: "Iron", color: [0.43, 0.44, 0.5], maxLevel: 9, hits: 6 },
  },

  // The beacon marks a spot with a laser and a guided missile dives on it from above.
  siege: {
    name: "Beacon",
    // No minimum: it can be called down on your own feet.
    minRange: 0,
    baseRange: 300,
    rangePerMetre: 1,
    // Fewer shots than the Moon's launcher, each one an event.
    reload: 6,
    launchHeight: 7,
    // Three seconds from the mark to the hit, however far: the warning everyone gets.
    shotSeconds: 3,
    // Up 60 m above the higher of the beacon and its mark, across, and straight down:
    // it meets the highest thing over the spot, so a roof shelters and a wall does not.
    dive: { apex: 60 },
    stoneRadius: 0.7,
    blastRadius: 3,
    throwRadius: 7,
    throwOut: 20,
    throwUp: 30,
    boardReach: 6,
    hits: 1,
  },

  roof: "dome",
  labels: { roof: "Greenhouse" },
};
