import type { WorldPage } from "../../pageDoors";
import { startAirbags } from "./airbags";
import { together } from "./features";
import { outfit } from "./outfit";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { sounds } from "./sounds";
import { startTerraformers, TERRAFORMER_TOOL } from "./terraformer";
import { pieceSkin } from "./textures";
import { startWings } from "./wings";

/** Everything Mars draws and plays. */
export const page: WorldPage = {
  scenery,
  pieceSkin,
  outfit,
  siegeModel,
  sounds,
  // Rust-red dust.
  dust: [0.78, 0.47, 0.33],
  // The Terraformer, beside the Beacon on the hotbar.
  tools: [TERRAFORMER_TOOL],
  // Airbags round whoever is hit, the Terraformer and the air it makes, and wings to fly in it.
  start(game) {
    const airbags = startAirbags(game), terraformer = startTerraformers(game), wings = startWings(game);
    // (Each is kept in reach by name too, for the checks that drive them.)
    return Object.assign(together(wings, terraformer, airbags), { airbags, terraformer, wings });
  },
};
