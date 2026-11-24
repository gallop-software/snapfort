import type { WorldPage } from "../../pageDoors";
import { outfit } from "./outfit";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { sounds } from "./sounds";
import { STARSHIP_TOOL, startStarships } from "./starship";
import { pieceSkin } from "./textures";

/** Everything the Meadow draws and plays. */
export const page: WorldPage = {
  scenery,
  pieceSkin,
  outfit,
  siegeModel,
  sounds,
  dust: [0.86, 0.8, 0.7],
  // The Starship, after the trebuchet on the hotbar.
  tools: [STARSHIP_TOOL],
  // Starship launch sites to build and ride.
  start(game) {
    const starship = startStarships(game);
    // (Kept in reach by name too, for the checks that drive it.)
    return Object.assign(starship, { starship });
  },
};
