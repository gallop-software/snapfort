import type { WorldServer } from "../serverDoors";
import { gunsBlock, gunsDrop, gunsInTheWay, gunsJoined, gunsLetGo, gunsMessage, gunsStruck, openGuns } from "./railguns";
import { openRovers, roversDrop, roversInTheWay, roversJoined, roversLetGo, roversMessage, roversStruck } from "./rovers";
import { spaceFlight } from "./space";
import { openStar, starFromWorld, starJoined, starLetGo, starMessage, starBlocks, starShotHits, starStruck } from "./starships";

/**
 * What the Moon does on the server beyond the shared rules: a hit throws you
 * into space and your rockets fly you back (space.ts), there are rovers to
 * drive (rovers.ts), rail guns to build and ride (railguns.ts), and Starship
 * launch sites: to build, to leave from, and where ships from other worlds
 * come down (starships.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { ...openRovers(room), guns: openGuns(room), star: openStar(room) };
  },
  thrown(hit, room) {
    // Thrown off whatever they were driving, and out of any capsule.
    roversLetGo(room, hit.playerId);
    gunsLetGo(room, hit.playerId);
    starLetGo(room, hit.playerId);
    return spaceFlight(hit);
  },
  joined(room, playerId) {
    roversJoined(room, playerId);
    gunsJoined(room, playerId);
    starJoined(room, playerId);
  },
  left(room, playerId) {
    roversLetGo(room, playerId);
    gunsLetGo(room, playerId);
    starLetGo(room, playerId);
  },
  message(room, playerId, data) {
    // Each of the Moon's things knows its own messages and ignores the rest.
    roversMessage(room, playerId, data);
    gunsMessage(room, playerId, data);
    starMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    // Whichever is in the way first.
    const hits = [roversInTheWay(room, flight), gunsInTheWay(room, flight), starShotHits(room, flight)].filter((h) => h !== null);
    return hits.sort((a, b) => a.time - b.time)[0] ?? null;
  },
  struck(room, point) {
    roversStruck(room, point);
    gunsStruck(room, point);
    starStruck(room, point);
  },
  removed(room, pieces) {
    roversDrop(room, pieces);
    gunsDrop(room, pieces);
  },
  blocks(room, piece) {
    return gunsBlock(room, piece) || starBlocks(room, piece);
  },
  fromWorld(room, from, data) {
    return starFromWorld(room, from, data);
  },
};
