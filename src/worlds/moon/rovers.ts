import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { pieceBounds } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { homes, readPose, readVec, ROVER, type RoverPose, type ToPage, type WireRover } from "./roverRules";
import { rocketsBack } from "./space";

/** The server's side of the Moon's rovers (see roverRules.ts for what they are). */

interface Rover {
  id: number;
  pose: RoverPose;
  /** Who is driving. */
  rider: string | null;
  /** Drifting in space until this time (ms); 0 when it is not. */
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
}

/** Rover positions go out this often while any is driven, ms. */
const TELL_MS = 100;

export function openRovers(room: Room): RoverMemory {
  return { rovers: homes(room.build).map((pose, id) => ({ id, pose, rider: null, lostUntil: 0, touched: Date.now(), home: true })), moved: new Set(), telling: false };
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
  }
}

export function roversMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; pose?: unknown; v?: unknown };
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
    return tellMoved(room);
  }
  if (msg.k === "leave") {
    if (pose && Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) < 30) mine.pose = pose;
    mine.rider = null;
    mine.touched = now;
    return say(room, { k: "rider", id: mine.id, by: null, pose: mine.pose });
  }
  if (msg.k === "eject") {
    // Thrown clear from wherever the server last believed the rover to be (or, if it is close, where the page says).
    const at = pose && Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) < 60 ? pose : mine.pose;
    const v = readVec(msg.v) ?? [0, 0, 0];
    mine.pose = at;
    mine.rider = null;
    mine.lostUntil = now + ROVER.lostFor;
    mine.touched = now;
    say(room, { k: "lost", id: mine.id, pose: at, v });
    room.fly(playerId, rocketsBack(room.build, room.env, [at[0], at[1] + ROVER.seatUp, at[2]]));
    const rover = mine;
    return room.later(ROVER.lostFor, () => sendHome(room, rover));
  }
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
    rover.pose = [land[0], Math.round((land[1] - 0.9) * 100) / 100, land[2], rover.pose[3], 0];
    rover.touched = Date.now();
    m.moved.add(rover.id);
    tellMoved(room);
  }
}
