import type { WorldServer } from "../serverDoors";
import { openWar, warBlocks, warJoined, warLeft, warMayChange, warMayPlace, warMessage, warPlaced, warShotHits, warStruck } from "./armies";

/**
 * What Mojave does on the server beyond the shared rules: the war. Every
 * builder who may command is a general with an army (sim.ts is the rules,
 * armies.ts runs them in the room and tells each page what its side can see).
 * Pieces cost lithium here and belong to whoever built them, and nothing is
 * built into a building or a field.
 */
export const server: WorldServer = {
  open(room) {
    return openWar(room);
  },
  joined(room, playerId) {
    warJoined(room, playerId);
  },
  left(room, playerId) {
    warLeft(room, playerId);
  },
  message(room, playerId, data) {
    warMessage(room, playerId, data);
  },
  mayPlace(room, playerId, piece) {
    return warMayPlace(room, playerId, piece);
  },
  placed(room, playerId, pieces) {
    warPlaced(room, playerId, pieces);
  },
  mayChange(room, playerId, piece) {
    return warMayChange(room, playerId, piece);
  },
  blocks(room, piece) {
    return warBlocks(room, piece);
  },
  shotHits(room, flight) {
    return warShotHits(room, flight);
  },
  struck(room, point) {
    warStruck(room, point);
  },
};
