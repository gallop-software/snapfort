import { LEVEL } from "../../../game/constants";
import { standHeight } from "../../../game/fall";
import type { PageGame } from "../../pageDoors";
import { sky } from "./air";

/**
 * What is solid to anything that flies on Mars (wings, helicopters): the
 * pieces of the build and the parts of the Terraformer. The flier's own page
 * moves them, so it is the page that keeps them out of walls and sets them
 * down on roofs.
 */

/** The top of whatever is under a spot at or below `feet`: a piece, a part of the Terraformer, or the ground (0). */
export function surfaceUnder(game: PageGame, x: number, feet: number, z: number): number {
  let top = 0;
  for (let y = feet; y > -LEVEL; y -= LEVEL) {
    for (const p of game.build.near(x, Math.max(0, y), z)) {
      const h = standHeight(p, x, z, game.env.roof);
      if (h !== null && h <= feet + 0.3 && h > top) top = h;
    }
    if (top > 0) break;
  }
  for (const b of sky.solids) if (x > b[0] - 0.4 && x < b[3] + 0.4 && z > b[2] - 0.4 && z < b[5] + 0.4 && b[4] <= feet + 0.3 && b[4] > top) top = b[4];
  return top;
}

/** True when something `tall` metres high with its foot at `foot` here is inside a wall or a part of the Terraformer. */
export function inWall(game: PageGame, x: number, foot: number, z: number, tall: number): boolean {
  for (const y of [foot + 0.2, foot + tall]) {
    for (const p of game.build.near(x, y, z)) {
      if (p.type !== "wall") continue;
      const top = standHeight(p, x, z);
      if (top !== null && foot < top - 0.25 && foot + tall > p.y * LEVEL) return true;
    }
  }
  for (const b of sky.solids) if (x > b[0] - 0.4 && x < b[3] + 0.4 && z > b[2] - 0.4 && z < b[5] + 0.4 && foot < b[4] - 0.25 && foot + tall > b[1]) return true;
  return false;
}
