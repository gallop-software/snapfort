import type { WorldServer } from "../serverDoors";
import { gunsDrop, gunsInTheWay, gunsJoined, gunsLetGo, gunsMessage, gunsStruck, openGuns } from "./railguns";
import { openRovers, roversDrop, roversInTheWay, roversJoined, roversLetGo, roversMessage, roversStruck } from "./rovers";
import { spaceFlight } from "./space";

/**
 * What the Moon does on the server beyond the shared rules: a hit throws you
 * into space and your rockets fly you back (space.ts), there are rovers to
 * drive (rovers.ts), and rail guns to build and ride (railguns.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { ...openRovers(room), guns: openGuns(room) };
  },
  thrown(hit, room) {
    // Thrown off whatever they were driving, and out of any capsule.
    roversLetGo(room, hit.playerId);
    gunsLetGo(room, hit.playerId);
    return spaceFlight(hit);
  },
  joined(room, playerId) {
    roversJoined(room, playerId);
    gunsJoined(room, playerId);
  },
  left(room, playerId) {
    roversLetGo(room, playerId);
    gunsLetGo(room, playerId);
  },
  message(room, playerId, data) {
    // Each of the Moon's things knows its own messages and ignores the rest.
    roversMessage(room, playerId, data);
    gunsMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    // Whichever is in the way first.
    const rover = roversInTheWay(room, flight), part = gunsInTheWay(room, flight);
    return rover && part ? (rover.time <= part.time ? rover : part) : (rover ?? part);
  },
  struck(room, point) {
    roversStruck(room, point);
    gunsStruck(room, point);
  },
  removed(room, pieces) {
    roversDrop(room, pieces);
    gunsDrop(room, pieces);
  },
};
