import { Solids } from "../../../game/solids";
import type { PageGame } from "../../pageDoors";
import { sky } from "./air";

/**
 * What is solid to anything that flies on Mars (wings, helicopters): the
 * pieces of the build as they are drawn (a door is a way through, a ramp a
 * slope, a floor overhead a ceiling) and the parts of the Terraformer. The
 * flier's own page moves them, so it is the page that keeps them out of walls,
 * from under floors and down onto roofs. (The shared questions of what is
 * solid: src/game/solids.ts.)
 */

const made = new WeakMap<PageGame, Solids>();
function solidsOf(game: PageGame): Solids {
  let s = made.get(game);
  if (!s) made.set(game, (s = new Solids(game.build, game.env, () => sky.solids)));
  return s;
}

/** The top of whatever is under a spot at or below `feet`: a piece, a part of the Terraformer, or the ground (0). */
export function surfaceUnder(game: PageGame, x: number, feet: number, z: number, r = 0.4): number {
  return solidsOf(game).surfaceUnder(x, z, feet + 0.3, r);
}

/**
 * True when something `tall` metres high and `r` across each way from its
 * middle, with its foot at `foot` here, would be inside anything solid (not
 * standing on its top).
 */
export function inWall(game: PageGame, x: number, foot: number, z: number, tall: number, r = 0.4): boolean {
  const half = Math.max(0, tall / 2 - r);
  return solidOf(game).touch([x, foot + tall / 2, z], r, half, { stepUp: 0.25 }) !== null;
}
const solidOf = solidsOf;

/** The underside of whatever is over a spot's top (`head`), within `r`: Infinity when open sky. */
export function ceilingOver(game: PageGame, x: number, head: number, z: number, r = 0.4): number {
  return solidsOf(game).ceilingOver(x, z, head, r);
}
