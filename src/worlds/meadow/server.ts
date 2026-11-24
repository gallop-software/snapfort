import type { WorldServer } from "../serverDoors";
import { openStar, starFromWorld, starJoined, starLetGo, starMessage, starBlocks, starShotHits, starStruck } from "./starships";

/**
 * What the Meadow does on the server beyond the shared rules: Starship launch
 * sites to build, ride and shoot at (starships.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { star: openStar(room) };
  },
  thrown(hit, room) {
    // Thrown out of any seat; the flight itself is the ordinary one.
    starLetGo(room, hit.playerId);
    return null;
  },
  joined(room, playerId) {
    starJoined(room, playerId);
  },
  left(room, playerId) {
    starLetGo(room, playerId);
  },
  message(room, playerId, data) {
    starMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    return starShotHits(room, flight);
  },
  struck(room, point) {
    starStruck(room, point);
  },
  blocks(room, piece) {
    return starBlocks(room, piece);
  },
  fromWorld(room, from, data) {
    return starFromWorld(room, from, data);
  },
};
