import type { BuildState } from "../../game/buildState";
import type { Environment } from "../../game/environments";
import { fallPosition, planFall, type Fall } from "../../game/fall";
import type { Vec } from "../../game/trebuchet";
import type { Room, Thrown } from "../serverDoors";

/**
 * Airbags. On Mars a builder who is hit is not thrown into space: bags burst
 * out round their suit and they come down bouncing, as the Pathfinder lander
 * and the first rovers did (Pathfinder bounced at least fifteen times, the
 * first of them five storeys high). Each bounce is lower and shorter than the
 * one before; when there is no bounce left the bags let go and the builder is
 * on their feet.
 *
 * The whole way is planned here, on the server, so every page plays the same
 * bounces. No page code in this file.
 */

/** How much of its downward speed a bounce gives back, and how much of its speed across the ground it keeps. */
export const BOUNCE = { up: 0.62, along: 0.78, most: 7, least: 3.2 } as const;
/** Seconds the bags take to let go once the bouncing is done. */
export const DEFLATE = 0.7;

/** What the page is told, to draw the bags and sound each bounce. */
export interface AirbagMessage {
  k: "airbag";
  id: string;
  fall: { time: number; land: Vec; path: Vec[] };
  /** When each bounce happens, seconds in. */
  bounces: number[];
  /** When the bags start to let go. */
  until: number;
}

/**
 * Thrown from `from` at speed `v`: the fall, then bounce after bounce off
 * whatever is underneath (the ground, a floor, a roof), each planned by the
 * shared rules, so walls stop it and ceilings hold it down as they would any
 * fall. Ends on their feet (no lying on the ground: the bags took the knock).
 */
export function airbagFlight(build: BuildState, env: Environment, from: Vec, v: Vec, first?: Fall): { fall: Fall; bounces: number[]; until: number } {
  // Every hop is fitted to a whole number of tenths of a second (stretched or squeezed by a few
  // hundredths), so each touch-down falls exactly on one of the points the flight is sent as:
  // the bags are seen to hit the ground, not to turn back just above it.
  const fitted = (hop: Fall) => Math.max(0.1, Math.round(hop.time * 10) / 10);
  const hops: Fall[] = [first ?? planFall(build, from, v, env)];
  const bounces: number[] = [];
  let at = fitted(hops[0]!);
  for (let i = 0; i < BOUNCE.most; i++) {
    const last = hops[hops.length - 1]!;
    // How fast it was going as it touched down: across, the average of the hop; down, what the pull gave it.
    const along: Vec = [(last.land[0] - last.from[0]) / last.time, 0, (last.land[2] - last.from[2]) / last.time];
    const down = Math.abs(last.v[1] - env.gravity * last.time);
    const up = down * BOUNCE.up;
    if (up < BOUNCE.least) break;
    bounces.push(Math.round(at * 10) / 10);
    const next = planFall(build, last.land, [along[0] * BOUNCE.along, up, along[2] * BOUNCE.along], env);
    hops.push(next);
    at += fitted(next);
  }
  const until = Math.round(at * 10) / 10;
  const time = Math.round((until + DEFLATE) * 10) / 10;
  const land = hops[hops.length - 1]!.land;
  const where = (t: number): Vec => {
    let left = t;
    for (const hop of hops) {
      const lasts = fitted(hop);
      if (left < lasts - 1e-6) return fallPosition(hop, (left * hop.time) / lasts);
      left = Math.max(0, left - lasts);
    }
    return land;
  };
  const path: Vec[] = [];
  for (let i = 0; i < time * 10 - 1e-6; i++) path.push(where(i / 10));
  path.push(land);
  // "Gliding" from the very end: that is what puts a builder down on their feet.
  return { fall: { from, v, time, land, path, glideFrom: time }, bounces, until };
}

/** A builder is thrown by an impact: their way down in the bags, and every page is told to draw them. */
export function airbagsThrown(hit: Thrown, room: Room): Fall {
  return inBags(room, hit.playerId, hit.from, hit.v, hit.fall);
}

/** Sends a builder off in the bags from wherever they are (something of Mars's own threw them: a helicopter coming down, a rocket blowing up). */
export function inBags(room: Room, playerId: string, from: Vec, v: Vec, first?: Fall): Fall {
  const { fall, bounces, until } = airbagFlight(room.build, room.env, from, v, first);
  const msg: AirbagMessage = { k: "airbag", id: playerId, fall: { time: fall.time, land: fall.land, path: fall.path }, bounces, until };
  room.broadcast(msg);
  return fall;
}
