import type { WorldPage } from "../../pageDoors";
import { outfit } from "./outfit";
import { startRovers } from "./rover";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { sounds } from "./sounds";
import { pieceSkin } from "./textures";

/** Everything the Moon draws and plays. */
export const page: WorldPage = {
  scenery,
  pieceSkin,
  outfit,
  siegeModel,
  sounds,
  // Grey moon dust.
  dust: [0.74, 0.74, 0.78],
  // Rovers to drive.
  start: startRovers,
};
