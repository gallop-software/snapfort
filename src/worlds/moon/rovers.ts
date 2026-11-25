import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { pieceBounds } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { positionAt, type Flight, type Vec } from "../../game/trebuchet";
import { homes, readPose, ROVER, type RoverPose, type ToPage, type WireRover } from "./roverRules";
import { landingUnder, rocketsBack } from "./space";

/** The server's side of the Moon's rovers (see roverRules.ts for what they are). */

interface Rover {
  id: number;
  pose: RoverPose;
  /** Who is driving. */
  rider: string | null;
  /** In the air with nobody on it (sinking back, or thrown by a shot) until this time (ms); 0 when it is not. */
  lostUntil: number;
  /** When it was last driven or got on or off (ms). */
  touched: number;
  /** Standing on its pad. */
  home: boolean;
}

export interface RoverMemory {
  rovers: Rover[];
  /** Rovers that moved since everyone was last told. */
  moved: Set<number>;
  telling: boolean;
  /** When the rovers were last saved (ms). */
  savedAt: number;
}

/** While a rover is driven, where they all are is saved this often, ms (and at once whenever one is got on, left, thrown or lands). */
const SAVE_MS = 2000;

/** Rover positions go out this often while any is driven, ms. */
const TELL_MS = 100;

/**
 * The rovers when the room wakes. It sleeps whenever nobody has sent anything
 * for a few seconds (builders present or not, if they are all standing still),
 * so where each rover stands and who drives it is saved, and found again here:
 * a rover stays where it was left. Drivers who are no longer here are off.
 */
export function openRovers(room: Room): RoverMemory {
  const now = Date.now();
  const fresh = (): Rover[] => homes(room.build).map((pose, id) => ({ id, pose, rider: null, lostUntil: 0, touched: now, home: true }));
  const saved = room.load("rovers");
  const here = new Set(room.players());
  const kept = Array.isArray(saved) && saved.length === fresh().length ? saved.map((r, id): Rover | null => {
    const pose = readPose((r as { pose?: unknown } | null)?.pose);
    if (!pose) return null;
    const { rider, touched, home } = r as { rider?: unknown; touched?: unknown; home?: unknown };
    // (One that was in the air has landed: where it was going is where it is.)
    return { id, pose, rider: typeof rider === "string" && here.has(rider) ? rider : null, lostUntil: 0, touched: typeof touched === "number" ? touched : now, home: home === true };
  }) : null;
  const rovers = kept && kept.every((r) => r !== null) ? (kept as Rover[]) : fresh();
  return { rovers, moved: new Set(), telling: false, savedAt: now };
}

function saveRovers(room: Room): void {
  const m = mem(room);
  m.savedAt = Date.now();
  room.save("rovers", m.rovers.map(({ pose, rider, touched, home }) => ({ pose, rider, touched, home })));
}

const mem = (room: Room) => room.memory as RoverMemory;
const say = (room: Room, msg: ToPage, exceptId?: string) => room.broadcast(msg, exceptId);
const wire = (r: Rover): WireRover => [r.id, r.pose, r.rider];

/** Puts a rover back on its pad (or the nearest open ground to it). */
function sendHome(room: Room, rover: Rover): void {
  rover.pose = homes(room.build)[rover.id]!;
  rover.rider = null;
  rover.lostUntil = 0;
  rover.home = true;
  rover.touched = Date.now();
  say(room, { k: "rider", id: rover.id, by: null, pose: rover.pose });
  saveRovers(room);
}

/**
 * An empty rover comes down from `from` to rest on whatever is under (x, z),
 * the right way up, taking `seconds` (worked out from the height when not
 * given) and rising `arc` metres on the way. Nobody can get on until it lands;
 * then it is free, there, for anyone.
 */
function comeDown(room: Room, rover: Rover, from: RoverPose, x: number, z: number, arc: number, seconds?: number): void {
  const land = landingUnder(room.build, room.env, x, Math.max(from[1], 0) + 1 + arc, z);
  const to: RoverPose = [Math.round(land[0] * 100) / 100, Math.round((land[1] - 0.9) * 100) / 100, Math.round(land[2] * 100) / 100, from[3], 0, 0];
  const far = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const time = Math.round((seconds ?? Math.max(2, Math.min(9, far / ROVER.sinkSpeed))) * 10) / 10;
  const now = Date.now();
  rover.pose = to;
  rover.rider = null;
  rover.home = false;
  rover.touched = now;
  rover.lostUntil = now + time * 1000;
  const until = rover.lostUntil;
  saveRovers(room);
  say(room, { k: "fall", id: rover.id, from, to, seconds: time, arc });
  room.later(time * 1000, () => {
    // (Unless something else has happened to it since: thrown again, say.)
    if (rover.lostUntil !== until) return;
    rover.lostUntil = 0;
    rover.touched = Date.now();
    say(room, { k: "rider", id: rover.id, by: null, pose: rover.pose });
  });
}

/** Rovers left lying about go home after a while (looked at whenever anything happens). */
function tidy(room: Room): void {
  const now = Date.now();
  for (const rover of mem(room).rovers) {
    if (rover.rider === null && !rover.home && rover.lostUntil === 0 && now - rover.touched > ROVER.idleFor) sendHome(room, rover);
  }
}

function tellMoved(room: Room): void {
  const m = mem(room);
  if (m.telling) return;
  m.telling = true;
  room.later(TELL_MS, () => {
    m.telling = false;
    if (m.moved.size === 0) return;
    const list = [...m.moved].map((id): [number, RoverPose] => [id, m.rovers[id]!.pose]);
    m.moved.clear();
    // Not to the drivers themselves: they know where their own rover is.
    const drivers = new Set(list.map(([id]) => m.rovers[id]!.rider));
    if (drivers.size === 1 && [...drivers][0] !== null) say(room, { k: "poses", list }, [...drivers][0]!);
    else say(room, { k: "poses", list });
  });
}

export function roversJoined(room: Room, playerId: string): void {
  tidy(room);
  room.send(playerId, { k: "all", list: mem(room).rovers.map(wire) } satisfies ToPage);
}

/** A builder is gone, or thrown: whatever they drove stands where it was. */
export function roversLetGo(room: Room, playerId: string): void {
  for (const rover of mem(room).rovers) {
    if (rover.rider !== playerId) continue;
    rover.rider = null;
    rover.touched = Date.now();
    say(room, { k: "rider", id: rover.id, by: null, pose: rover.pose });
    saveRovers(room);
  }
}

export function roversMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; pose?: unknown };
  const m = mem(room);
  const now = Date.now();
  const mine = m.rovers.find((r) => r.rider === playerId);
  tidy(room);

  if (msg.k === "board") {
    const rover = typeof msg.id === "number" ? m.rovers[msg.id] : undefined;
    if (!rover || mine || room.isDown(playerId)) return;
    if (rover.rider !== null || rover.lostUntil > 0) return room.send(playerId, { k: "no", why: "taken" } satisfies ToPage);
    const at = room.positionOf(playerId);
    if (!at || Math.hypot(at[0] - rover.pose[0], at[2] - rover.pose[2]) > ROVER.boardReach + 2 || Math.abs(at[1] - 0.9 - rover.pose[1]) > 5) {
      return room.send(playerId, { k: "no", why: "far" } satisfies ToPage);
    }
    rover.rider = playerId;
    rover.touched = now;
    rover.home = false;
    saveRovers(room);
    return say(room, { k: "rider", id: rover.id, by: playerId, pose: rover.pose });
  }
  if (!mine) return;
  const pose = readPose(msg.pose);

  if (msg.k === "drive" && pose) {
    // No faster than a rover can go (with room for a late message).
    const dt = Math.max(0.05, (now - mine.touched) / 1000);
    if (Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) > ROVER.believable * dt + 3) return;
    mine.pose = pose;
    mine.touched = now;
    m.moved.add(mine.id);
    if (now - m.savedAt > SAVE_MS) saveRovers(room);
    return tellMoved(room);
  }
  if (msg.k === "leave") {
    if (pose && Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) < 30) mine.pose = pose;
    mine.rider = null;
    mine.touched = now;
    saveRovers(room);
    return say(room, { k: "rider", id: mine.id, by: null, pose: mine.pose });
  }
  if (msg.k === "eject") {
    // Thrown clear from wherever the server last believed the rover to be (or, if it is close, where the page says).
    const at = pose && Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) < 60 ? pose : mine.pose;
    room.fly(playerId, rocketsBack(room.build, room.env, [at[0], at[1] + ROVER.seatUp + 0.5, at[2]]));
    // The rover does not go on up: it sinks slowly back to the ground under it, for the next driver.
    return comeDown(room, mine, at, at[0], at[2], 0);
  }
}

/**
 * A shot hits a rover standing in its way (one with nobody on it too): the
 * first time the rock comes within a rover's size of one's middle.
 */
export function roversInTheWay(room: Room, flight: Flight): { time: number; point: Vec } | null {
  const rovers = mem(room).rovers.filter((r) => r.lostUntil === 0);
  if (rovers.length === 0) return null;
  const speed = Math.hypot(...flight.v) + flight.g * flight.time;
  // Steps of half a metre at most, to a little past the target.
  const step = Math.min(0.02, 0.5 / Math.max(speed, 1));
  for (let t = step; t <= flight.time * 1.5; t += step) {
    const p = positionAt(flight, t);
    if (p[1] < -1) return null;
    for (const r of rovers) {
      if (Math.hypot(p[0] - r.pose[0], p[1] - (r.pose[1] + ROVER.middleUp), p[2] - r.pose[2]) <= ROVER.hitSize) return { time: t, point: p };
    }
  }
  return null;
}

/**
 * A shot landed: any rover close by is thrown through the air, away from it,
 * turning over, and comes down a little way off. (Whoever was driving has
 * already been thrown into space by the shared rules.)
 */
export function roversStruck(room: Room, point: Vec, within: number = ROVER.tossWithin): string[] {
  const drivers: string[] = [];
  for (const rover of mem(room).rovers) {
    if (rover.lostUntil > 0) continue;
    const dx = rover.pose[0] - point[0], dz = rover.pose[2] - point[2];
    const flat = Math.hypot(dx, dz);
    if (Math.hypot(flat, rover.pose[1] + ROVER.middleUp - point[1]) > within) continue;
    // Right on top of it: any way at all.
    const a = flat > 0.3 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
    if (rover.rider !== null) {
      drivers.push(rover.rider);
      roversLetGo(room, rover.rider);
    }
    comeDown(room, rover, rover.pose, rover.pose[0] + Math.sin(a) * ROVER.tossOut, rover.pose[2] + Math.cos(a) * ROVER.tossOut, ROVER.tossUp, ROVER.tossFor);
  }
  return drivers;
}

/** The space every rover on the ground fills, about (for a ship coming down on one). */
export function roversSolid(room: Room): [number, number, number, number, number, number][] {
  return mem(room).rovers.filter((r) => r.lostUntil === 0).map((r) => [r.pose[0] - 1.5, r.pose[1], r.pose[2] - 1.5, r.pose[0] + 1.5, r.pose[1] + 1.6, r.pose[2] + 1.5]);
}

/** Pieces went: a rover parked on one of them drops to whatever is below. */
export function roversDrop(room: Room, pieces: readonly Piece[]): void {
  const m = mem(room);
  for (const rover of m.rovers) {
    if (rover.rider !== null || rover.lostUntil > 0 || rover.pose[1] < 0.1) continue;
    const [x, y, z] = rover.pose;
    const under = pieces.some((p) => {
      const [x0, y0, z0, x1, y1, z1] = pieceBounds(p, room.env);
      return x > x0 - 1.2 && x < x1 + 1.2 && z > z0 - 1.2 && z < z1 + 1.2 && y > y0 - 0.5 && y < y1 + 1.5;
    });
    if (!under) continue;
    const land = planFall(room.build, [x, y + 0.9, z], [0, 0, 0], room.env).land;
    if (y - (land[1] - 0.9) < 0.05) continue;
    rover.pose = [land[0], Math.round((land[1] - 0.9) * 100) / 100, land[2], rover.pose[3], 0, 0];
    rover.touched = Date.now();
    m.moved.add(rover.id);
    tellMoved(room);
    saveRovers(room);
  }
}
