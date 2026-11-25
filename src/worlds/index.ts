import type { Environment } from "../game/environments";
import { server as marsServer } from "./mars/server";
import { world as mars } from "./mars/world";
import { server as meadowServer } from "./meadow/server";
import { world as meadow } from "./meadow/world";
import { server as mojaveServer } from "./mojave/server";
import { world as mojave } from "./mojave/world";
import { server as moonServer } from "./moon/server";
import { world as moon } from "./moon/world";
import type { WorldServer } from "./serverDoors";

/**
 * The list of worlds. This is the one shared file that names them: everything
 * else asks this list. Safe for the server to import (no drawing code): each
 * world's page half is loaded separately, and only in that world (see load.ts).
 *
 * Adding a world: copy the folder of the closest one, change it freely, and
 * add it here. Worlds never import from each other (tests/worlds.test.ts fails
 * the build if one does).
 */
export const WORLDS: readonly Environment[] = [meadow, moon, mars, mojave];

/** Each world's own rules on the server, by world id. */
const SERVERS: Readonly<Record<string, WorldServer>> = { [meadow.id]: meadowServer, [moon.id]: moonServer, [mars.id]: marsServer, [mojave.id]: mojaveServer };

/** The server half of a world (nothing of its own, for a world without one). */
export function serverOf(env: Environment): WorldServer {
  return SERVERS[env.id] ?? {};
}

/** Where anything unknown ends up: the first world, at the site's front door. */
export const DEFAULT_WORLD: Environment = WORLDS[0]!;

/** The world with this id, or the default one for anything else. */
export function worldOf(id: unknown): Environment {
  return WORLDS.find((w) => w.id === id) ?? DEFAULT_WORLD;
}

/** The world at this address ("/moon"), or the default one for anything else. */
export function worldAtPath(path: unknown): Environment {
  const clean = typeof path === "string" ? path.replace(/\/+$/, "") || "/" : "/";
  return WORLDS.find((w) => w.path === clean) ?? DEFAULT_WORLD;
}

/** The first world that needs the Full Game: what buying it is shown to unlock. */
export const FIRST_PAID_WORLD: Environment | undefined = WORLDS.find((w) => w.paid);
