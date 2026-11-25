import type { WorldPage } from "../../pageDoors";
import { startAirbags } from "./airbags";
import { together } from "./features";
import { outfit } from "./outfit";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { sounds } from "./sounds";
import { pieceSkin } from "./textures";

/** Everything Mars draws and plays. */
export const page: WorldPage = {
  scenery,
  pieceSkin,
  outfit,
  siegeModel,
  sounds,
  // Rust-red dust.
  dust: [0.78, 0.47, 0.33],
  // Airbags round whoever is hit.
  start(game) {
    const airbags = startAirbags(game);
    // (Each is kept in reach by name too, for the checks that drive them.)
    return Object.assign(together(airbags), { airbags });
  },
};
