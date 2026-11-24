import type { WorldServer } from "../serverDoors";
import { openRovers, roversDrop, roversJoined, roversLetGo, roversMessage } from "./rovers";
import { spaceFlight } from "./space";

/**
 * What the Moon does on the server beyond the shared rules: a hit throws you
 * into space and your rockets fly you back (space.ts), and there are rovers to
 * drive (rovers.ts).
 */
export const server: WorldServer = {
  open: openRovers,
  thrown(hit, room) {
    // Thrown off whatever they were driving.
    roversLetGo(room, hit.playerId);
    return spaceFlight(hit);
  },
  joined: roversJoined,
  left: roversLetGo,
  message: roversMessage,
  removed: roversDrop,
};
