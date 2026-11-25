import type { Piece } from "../../game/pieces";
import { solidOf } from "../../game/keepOut";
import { positionAt, type Flight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { airAt, airToward, boxOf, builtInto, cannotPlace, canTake, cutsInto, fits, gapTo, overlap, partsNear, readAir, readTerraformer, reachTo, running, TERRAFORMER, type Air, type TerraToPage, type Terraformer } from "./terraformerRules";

/** The server's side of Mars's Terraformer and of the air it makes (see terraformerRules.ts for what they are). */

export interface TerraMemory {
  list: Terraformer[];
  nextId: number;
  air: Air;
}

const mem = (room: Room) => (room.memory as { terra: TerraMemory }).terra;
const say = (room: Room, msg: TerraToPage) => room.broadcast(msg);
const no = (room: Room, playerId: string, why: Extract<TerraToPage, { k: "terra-no" }>["why"]) => room.send(playerId, { k: "terra-no", why } satisfies TerraToPage);
const save = (room: Room) => room.save("terraformer", mem(room));
const tell = (room: Room, terra: Terraformer, hit?: number[]) => say(room, { k: "terra", terra, now: Date.now(), ...(hit?.length ? { hit } : {}) });

/** Reads what was saved when the room wakes: the machines, and where the air had got to. */
export function openTerra(room: Room): TerraMemory {
  const saved = room.load("terraformer") as { nextId?: unknown; list?: unknown; air?: unknown } | undefined;
  const list = (Array.isArray(saved?.list) ? saved.list : []).map(readTerraformer).filter((t): t is Terraformer => t !== null);
  const nextId = typeof saved?.nextId === "number" && Number.isInteger(saved.nextId) ? saved.nextId : 1;
  return { list, nextId: Math.max(nextId, ...list.map((t) => t.id + 1)), air: readAir(saved?.air) };
}

/** How thick the air is in this room now, 0..1. */
export function airNow(room: Room, now = Date.now()): number {
  return airAt(mem(room).air, now);
}

/**
 * After anything that may have started or stopped a machine: the air heads
 * for thick while one runs and for thin when none does. Says so to every page
 * only when that has changed.
 */
function breathe(room: Room): void {
  const m = mem(room);
  const to = m.list.some(running) ? 1 : 0;
  if (to === m.air.to) return;
  const now = Date.now();
  m.air = airToward(m.air, to, now);
  say(room, { k: "air", air: m.air, now });
}

/** Clears away unfinished ones nobody has touched for a long while. */
function tidy(room: Room): void {
  const m = mem(room);
  const now = Date.now();
  for (const t of [...m.list]) {
    if (running(t) || now - t.touched < TERRAFORMER.abandonedAfter) continue;
    m.list.splice(m.list.indexOf(t), 1);
    say(room, { k: "terra-gone", id: t.id });
  }
}

export function terraJoined(room: Room, playerId: string): void {
  const m = mem(room);
  room.send(playerId, { k: "terras", list: m.list, air: m.air, now: Date.now() } satisfies TerraToPage);
}

/** True when a builder is within `reach` metres of where part `n` goes (a little more is allowed for: where they are is known a tenth of a second late). */
function within(room: Room, playerId: string, site: Pick<Terraformer, "x" | "z">, n: number, reach: number): boolean {
  const p = room.positionOf(playerId);
  return !!p && reachTo(site, n, p) <= reach + 1.5;
}

export function terraMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; n?: unknown; x?: unknown; z?: unknown };
  if (typeof msg.k !== "string" || !msg.k.startsWith("terra-")) return;
  const m = mem(room);
  const now = Date.now();
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

  if (msg.k === "terra-new") {
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    if (!whole(msg.x) || !whole(msg.z)) return;
    const terra: Terraformer = { id: m.nextId, x: msg.x, z: msg.z, parts: [1], broken: [], touched: now };
    if (!fits(terra)) return no(room, playerId, "room");
    if (!within(room, playerId, terra, 1, TERRAFORMER.placeReach)) return no(room, playerId, "far");
    if (builtInto(room.build, terra, 1)) return no(room, playerId, "crowded");
    tidy(room);
    if (m.list.some((t) => overlap(t, terra))) return no(room, playerId, "overlap");
    if (m.list.length >= TERRAFORMER.most) return no(room, playerId, "full");
    m.nextId++;
    m.list.push(terra);
    save(room);
    return tell(room, terra);
  }

  const terra = m.list.find((t) => t.id === msg.id);
  if (!terra || !whole(msg.n)) return;
  if (!room.mayBuild(playerId)) return no(room, playerId, "locked");

  if (msg.k === "terra-part") {
    const why = cannotPlace(room.build, terra, msg.n);
    if (why) return no(room, playerId, why);
    if (!within(room, playerId, terra, msg.n, TERRAFORMER.placeReach)) return no(room, playerId, "far");
    terra.parts.push(msg.n);
    terra.touched = now;
  } else if (msg.k === "terra-mend") {
    if (!terra.broken.includes(msg.n)) return;
    if (!within(room, playerId, terra, msg.n, TERRAFORMER.placeReach)) return no(room, playerId, "far");
    terra.broken = terra.broken.filter((n) => n !== msg.n);
    terra.touched = now;
  } else if (msg.k === "terra-take") {
    // The Remove tool: any builder may take a part off, from close by, as with pieces; from the top down.
    if (!terra.parts.includes(msg.n)) return;
    if (!canTake(terra, msg.n)) return no(room, playerId, "held");
    if (!within(room, playerId, terra, msg.n, TERRAFORMER.removeReach)) return no(room, playerId, "far");
    terra.parts = terra.parts.filter((n) => n !== msg.n);
    terra.broken = terra.broken.filter((n) => n !== msg.n);
    if (terra.parts.length === 0) {
      m.list.splice(m.list.indexOf(terra), 1);
      breathe(room);
      save(room);
      return say(room, { k: "terra-gone", id: terra.id });
    }
  } else {
    return;
  }
  breathe(room);
  save(room);
  tell(room, terra);
}

/** Something of the machine in a shot's way: when and where the shot first comes within reach of a part in place. */
export function terraShotHits(room: Room, flight: Flight): { time: number; point: Vec } | null {
  const m = mem(room);
  if (m.list.length === 0) return null;
  const speed = Math.hypot(...flight.v) + flight.g * flight.time;
  const step = Math.min(0.05, 0.3 / Math.max(1, speed));
  for (let t = step; t <= flight.time * 1.5; t += step) {
    const q = positionAt(flight, t);
    if (q[1] < 0) return null;
    for (const terra of m.list) {
      // (Only near it at all: the whole machine fits in one box.)
      if (gapTo([terra.x * 5, 0, terra.z * 5, terra.x * 5 + 40, 110, terra.z * 5 + 40], q) > 2) continue;
      if (partsNear(terra, q, TERRAFORMER.hitSize).length > 0) return { time: t, point: q };
    }
  }
  return null;
}

/** A shot landed at `point`: every part of a machine close by is broken, and the machine stops. */
export function terraStruck(room: Room, point: Vec): void {
  const m = mem(room);
  for (const terra of m.list) {
    const hit = partsNear(terra, point, TERRAFORMER.breakWithin).filter((n) => !terra.broken.includes(n));
    if (hit.length === 0) continue;
    terra.broken.push(...hit);
    breathe(room);
    save(room);
    tell(room, terra, hit);
  }
}

/** Nothing can be built into any part of a Terraformer. */
export function terraBlocks(room: Room, piece: Piece): boolean {
  const m = mem(room);
  if (m.list.length === 0) return false;
  const box = solidOf(piece, room.env);
  return m.list.some((t) => cutsInto(t, box));
}

/** The space every part in place fills (for a ship coming down on the machine). */
export function terraSolid(room: Room): [number, number, number, number, number, number][] {
  return mem(room).list.flatMap((t) => t.parts.map((n) => [...boxOf(t, n)] as [number, number, number, number, number, number]));
}
