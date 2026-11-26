import type { WorldServer } from "../serverDoors";
import { openWar, warBlocks, warJoined, warLeft, warMayChange, warMayPlace, warMessage, warPlaced } from "./armies";

/**
 * What Mojave does on the server beyond the shared rules: the war. There are
 * always eight generals, people or computers (sim.ts is the rules, armies.ts
 * runs them in the room and tells each page what its general can see). Pieces
 * cost lithium here and belong to the place they were built for, nothing is
 * built into a building or a field, and nobody builds a siege engine.
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
};
