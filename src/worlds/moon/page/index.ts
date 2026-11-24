import type { WorldPage } from "../../pageDoors";
import { outfit } from "./outfit";
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
  dust: [0.86, 0.8, 0.7],
};
