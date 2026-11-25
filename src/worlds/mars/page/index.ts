import type { WorldPage } from "../../pageDoors";
import { startAirbags } from "./airbags";
import { together } from "./features";
import { startHelicopters } from "./helicopter";
import { outfit } from "./outfit";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { STARSHIP_TOOL, startStarships } from "./starship";
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
  // The Terraformer, beside the Beacon on the hotbar, and the Starship.
  tools: [TERRAFORMER_TOOL, STARSHIP_TOOL],
  // Airbags round whoever is hit, the Terraformer and the air it makes, wings to fly in it, helicopters, and Starships to other worlds.
  start(game) {
    const airbags = startAirbags(game), terraformer = startTerraformers(game), wings = startWings(game), helicopter = startHelicopters(game), starship = startStarships(game);
    // (Each is kept in reach by name too, for the checks that drive them. In a helicopter, its controls come before the wings'.)
    return Object.assign(together(helicopter, starship, wings, terraformer, airbags), { airbags, terraformer, wings, helicopter, starship });
  },
};
