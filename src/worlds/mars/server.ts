import type { WorldServer } from "../serverDoors";
import { airbagsThrown } from "./airbags";

/**
 * What Mars does on the server beyond the shared rules: a builder who is hit
 * comes down bouncing in airbags (airbags.ts).
 */
export const server: WorldServer = {
  thrown(hit, room) {
    return airbagsThrown(hit, room);
  },
};
