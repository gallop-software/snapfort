import type { WorldServer } from "../serverDoors";
import { airbagsThrown } from "./airbags";
import { openTerra, terraBlocks, terraJoined, terraMessage, terraShotHits, terraStruck } from "./terraformers";

/**
 * What Mars does on the server beyond the shared rules: a builder who is hit
 * comes down bouncing in airbags (airbags.ts), and there is a Terraformer to
 * build, which thickens the air of the whole world while it runs (terraformers.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { terra: openTerra(room) };
  },
  thrown(hit, room) {
    return airbagsThrown(hit, room);
  },
  joined(room, playerId) {
    terraJoined(room, playerId);
  },
  message(room, playerId, data) {
    // Each of Mars's things knows its own messages and ignores the rest.
    terraMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    return terraShotHits(room, flight);
  },
  struck(room, point) {
    terraStruck(room, point);
  },
  blocks(room, piece) {
    return terraBlocks(room, piece);
  },
};
