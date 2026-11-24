import type { WorldPage } from "../../pageDoors";
import { outfit } from "./outfit";
import { together } from "./features";
import { RAILGUN_TOOL, startRailguns } from "./railgun";
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
  // The Railgun, beside the Launcher on the hotbar.
  tools: [RAILGUN_TOOL],
  // Rovers to drive, and rail guns to build and ride.
  start(game) {
    const rover = startRovers(game), railgun = startRailguns(game);
    // (The two are kept in reach by name too, for the checks that drive them.)
    return Object.assign(together(rover, railgun), { rover, railgun });
  },
};
