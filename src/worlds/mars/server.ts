import type { WorldServer } from "../serverDoors";
import { airbagsThrown } from "./airbags";
import { helisDrop, helisInTheWay, helisJoined, helisLetGo, helisMessage, helisStruck, openHelis } from "./helicopters";
import { openTerra, terraBlocks, terraJoined, terraMessage, terraShotHits, terraStruck } from "./terraformers";

/**
 * What Mars does on the server beyond the shared rules: a builder who is hit
 * comes down bouncing in airbags (airbags.ts), there is a Terraformer to
 * build, which thickens the air of the whole world while it runs
 * (terraformers.ts), and there are helicopters to fly (helicopters.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { terra: openTerra(room), heli: openHelis(room) };
  },
  thrown(hit, room) {
    // Out of whatever they were flying.
    helisLetGo(room, hit.playerId);
    return airbagsThrown(hit, room);
  },
  joined(room, playerId) {
    terraJoined(room, playerId);
    helisJoined(room, playerId);
  },
  left(room, playerId) {
    helisLetGo(room, playerId);
  },
  message(room, playerId, data) {
    // Each of Mars's things knows its own messages and ignores the rest.
    terraMessage(room, playerId, data);
    helisMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    // Whichever is in the way first.
    const hits = [terraShotHits(room, flight), helisInTheWay(room, flight)].filter((h) => h !== null);
    return hits.sort((a, b) => a.time - b.time)[0] ?? null;
  },
  struck(room, point) {
    terraStruck(room, point);
    helisStruck(room, point);
  },
  removed(room) {
    helisDrop(room);
  },
  blocks(room, piece) {
    return terraBlocks(room, piece);
  },
};
