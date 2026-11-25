import type { WorldServer } from "../serverDoors";
import { airbagsThrown } from "./airbags";
import { helisDrop, helisInTheWay, helisJoined, helisLetGo, helisMessage, helisStruck, openHelis } from "./helicopters";
import { openStar, starBlocks, starFromWorld, starJoined, starLetGo, starMessage, starShotHits, starStruck } from "./starships";
import { openTerra, terraBlocks, terraJoined, terraMessage, terraShotHits, terraStruck } from "./terraformers";

/**
 * What Mars does on the server beyond the shared rules: a builder who is hit
 * comes down bouncing in airbags (airbags.ts), there is a Terraformer to
 * build, which thickens the air of the whole world while it runs
 * (terraformers.ts), there are helicopters to fly (helicopters.ts), and
 * Starship launch sites: to build, to leave from, and where ships from other
 * worlds come down (starships.ts).
 */
export const server: WorldServer = {
  open(room) {
    return { terra: openTerra(room), heli: openHelis(room), star: openStar(room) };
  },
  thrown(hit, room) {
    // Out of whatever they were flying or sitting in.
    helisLetGo(room, hit.playerId);
    starLetGo(room, hit.playerId);
    return airbagsThrown(hit, room);
  },
  joined(room, playerId) {
    terraJoined(room, playerId);
    helisJoined(room, playerId);
    starJoined(room, playerId);
  },
  left(room, playerId) {
    helisLetGo(room, playerId);
    starLetGo(room, playerId);
  },
  message(room, playerId, data) {
    // Each of Mars's things knows its own messages and ignores the rest.
    terraMessage(room, playerId, data);
    helisMessage(room, playerId, data);
    starMessage(room, playerId, data);
  },
  shotHits(room, flight) {
    // Whichever is in the way first.
    const hits = [terraShotHits(room, flight), helisInTheWay(room, flight), starShotHits(room, flight)].filter((h) => h !== null);
    return hits.sort((a, b) => a.time - b.time)[0] ?? null;
  },
  struck(room, point) {
    terraStruck(room, point);
    helisStruck(room, point);
    starStruck(room, point);
  },
  removed(room) {
    helisDrop(room);
  },
  blocks(room, piece) {
    return terraBlocks(room, piece) || starBlocks(room, piece);
  },
  fromWorld(room, from, data) {
    return starFromWorld(room, from, data);
  },
};
