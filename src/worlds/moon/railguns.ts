import type { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import type { Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { positionAt, type Flight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import {
  cannotPlace,
  crowded,
  fallen,
  feetOf,
  fits,
  footed,
  middleOf,
  operational,
  overlap,
  PARTS,
  railLine,
  RAILGUN,
  readGun,
  seatOf,
  type Gun,
  type GunToPage,
} from "./railgunRules";
import { EDGE } from "./space";

/** The server's side of the Moon's rail guns (see railgunRules.ts for what they are). */

export interface GunMemory {
  list: Gun[];
  nextId: number;
}

const mem = (room: Room) => (room.memory as { guns: GunMemory }).guns;
const say = (room: Room, msg: GunToPage) => room.broadcast(msg);
const no = (room: Room, playerId: string, why: Extract<GunToPage, { k: "gun-no" }>["why"]) => room.send(playerId, { k: "gun-no", why } satisfies GunToPage);
// (Riders are saved too: a room with everyone sitting still goes to sleep, and must wake knowing who is in which capsule.)
const save = (room: Room) => room.save("railguns", { nextId: mem(room).nextId, list: mem(room).list });
const tell = (room: Room, gun: Gun, knocked?: number[]) => say(room, { k: "gun", gun, now: Date.now(), ...(knocked?.length ? { knocked } : {}) });

/**
 * Reads the saved guns when the room wakes (it sleeps whenever nobody has sent
 * anything for a few seconds, builders present or not); unfinished ones nobody
 * has touched for a long while are cleared away. Whoever sat in a capsule
 * still does, if they are still here.
 */
export function openGuns(room: Room): GunMemory {
  const saved = room.load("railguns") as { nextId?: unknown; list?: unknown } | undefined;
  const here = new Set(room.players());
  const list = (Array.isArray(saved?.list) ? saved.list : []).flatMap((g) => {
    const gun = readGun(g);
    if (!gun) return [];
    const rider = (g as { rider?: unknown }).rider;
    gun.rider = typeof rider === "string" && here.has(rider) ? rider : null;
    return gun;
  });
  const now = Date.now();
  const kept = list.filter((g) => g.parts.length === PARTS || now - g.touched < RAILGUN.abandonedAfter);
  return { list: kept, nextId: Math.max(typeof saved?.nextId === "number" ? saved.nextId : 1, 1 + Math.max(0, ...kept.map((g) => g.id))) };
}

/** Clears away unfinished guns nobody has added to for a long while (looked at when someone arrives or starts a new one). */
function tidy(room: Room): void {
  const m = mem(room);
  const now = Date.now();
  const old = m.list.filter((g) => g.parts.length < PARTS && g.rider === null && now - g.touched >= RAILGUN.abandonedAfter);
  if (old.length === 0) return;
  m.list = m.list.filter((g) => !old.includes(g));
  for (const g of old) say(room, { k: "gun-gone", id: g.id });
  save(room);
}

export function gunsJoined(room: Room, playerId: string): void {
  tidy(room);
  room.send(playerId, { k: "guns", list: mem(room).list, now: Date.now() } satisfies GunToPage);
}

/** A builder is gone, or thrown: out of whatever capsule they sat in. */
export function gunsLetGo(room: Room, playerId: string): void {
  for (const gun of mem(room).list) {
    if (gun.rider !== playerId) continue;
    gun.rider = null;
    tell(room, gun);
    save(room);
  }
}

/** Takes parts off a gun (shot off, or nothing under them any more); the last one gone, so is the gun. */
function knockOff(room: Room, gun: Gun, parts: number[]): void {
  if (parts.length === 0) return;
  gun.parts = gun.parts.filter((n) => !parts.includes(n));
  gun.readyAt = 0;
  if (parts.includes(22) || parts.includes(2)) gun.rider = null;
  if (gun.parts.length === 0) {
    mem(room).list = mem(room).list.filter((g) => g !== gun);
    say(room, { k: "gun-gone", id: gun.id });
  } else tell(room, gun, parts);
  save(room);
}

const near = (room: Room, playerId: string, at: Vec, reach: number): boolean => {
  const p = room.positionOf(playerId);
  return !!p && Math.hypot(p[0] - at[0], p[2] - at[2]) <= reach && Math.abs(p[1] - at[1]) <= reach;
};

export function gunsMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; n?: unknown; on?: unknown; x?: unknown; y?: unknown; z?: unknown; dir?: unknown };
  const m = mem(room);
  const now = Date.now();
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

  if (msg.k === "gun-new") {
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    if (!whole(msg.x) || !whole(msg.y) || !whole(msg.z) || !whole(msg.dir) || msg.dir < 0 || msg.dir > 3) return;
    const gun: Gun = { id: m.nextId, x: msg.x, y: msg.y, z: msg.z, dir: msg.dir, parts: [1], touched: now, readyAt: 0, rider: null };
    if (!fits(gun)) return no(room, playerId, "room");
    if (!near(room, playerId, middleOf(gun, 1), RAILGUN.placeReach)) return no(room, playerId, "far");
    const [foot] = feetOf(gun, 1);
    if (crowded(room.build, foot!)) return no(room, playerId, "crowded");
    if (!footed(room.build, foot!)) return no(room, playerId, "under");
    tidy(room);
    if (m.list.some((g) => overlap(g, gun))) return no(room, playerId, "overlap");
    if (m.list.length >= RAILGUN.most) return no(room, playerId, "full");
    m.nextId++;
    m.list.push(gun);
    save(room);
    return tell(room, gun);
  }

  if (msg.k === "gun-part") {
    const gun = m.list.find((g) => g.id === msg.id);
    if (!gun || !whole(msg.n)) return;
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    const why = cannotPlace(room.build, gun, msg.n);
    if (why) return no(room, playerId, why);
    if (!near(room, playerId, middleOf(gun, msg.n), RAILGUN.placeReach)) return no(room, playerId, "far");
    gun.parts.push(msg.n);
    gun.touched = now;
    // Whole: it starts to charge.
    if (gun.parts.length === PARTS) gun.readyAt = now + RAILGUN.charge * 1000;
    save(room);
    return tell(room, gun);
  }

  if (msg.k === "gun-sit") {
    const gun = m.list.find((g) => g.id === msg.id);
    if (!gun) return;
    if (msg.on !== true) {
      if (gun.rider !== playerId) return;
      gun.rider = null;
      save(room);
      return tell(room, gun);
    }
    if (!gun.parts.includes(22) || room.isDown(playerId) || m.list.some((g) => g.rider === playerId)) return;
    if (gun.rider !== null) return no(room, playerId, "busy");
    const seat = seatOf(gun);
    if (!near(room, playerId, [seat.x, seat.y, seat.z], RAILGUN.boardReach + 2)) return no(room, playerId, "far");
    gun.rider = playerId;
    save(room);
    return tell(room, gun);
  }

  if (msg.k === "gun-launch") {
    const gun = m.list.find((g) => g.rider === playerId);
    if (!gun) return;
    if (!operational(room.build, gun)) return no(room, playerId, "broken");
    if (now < gun.readyAt) return no(room, playerId, "charging");
    // Builders standing by the capacitor banks (not the rider) help the next charge along.
    const helpers = [3, 4].filter((n) => room.players().some((id) => id !== playerId && near(room, id, middleOf(gun, n), RAILGUN.helpReach))).length;
    gun.rider = null;
    gun.readyAt = now + (RAILGUN.charge - RAILGUN.chargeHelp * helpers) * 1000;
    save(room);
    say(room, { k: "gun-fire", id: gun.id, by: playerId });
    tell(room, gun);
    return room.fly(playerId, rideFlight(room.build, room.env, gun));
  }
}

/** Pieces went: any part that stood on one of them comes off. */
export function gunsDrop(room: Room, _pieces: readonly Piece[]): void {
  for (const gun of [...mem(room).list]) knockOff(room, gun, fallen(room.build, gun));
}

/** A shot landed: the parts beside it are knocked out, and have to be put on again. */
export function gunsStruck(room: Room, point: Vec): void {
  for (const gun of [...mem(room).list]) {
    knockOff(room, gun, gun.parts.filter((n) => {
      const at = middleOf(gun, n);
      return Math.hypot(at[0] - point[0], at[1] - point[1], at[2] - point[2]) <= RAILGUN.knockWithin;
    }));
  }
}

/** A shot hits a rail gun part standing in its way: the first time the rock comes within a part's size of one's middle. */
export function gunsInTheWay(room: Room, flight: Flight): { time: number; point: Vec } | null {
  const parts = mem(room).list.flatMap((gun) => gun.parts.map((n) => middleOf(gun, n)));
  if (parts.length === 0) return null;
  const speed = Math.hypot(...flight.v) + flight.g * flight.time;
  const step = Math.min(0.02, 0.5 / Math.max(speed, 1));
  for (let t = step; t <= flight.time * 1.5; t += step) {
    const p = positionAt(flight, t);
    if (p[1] < -1) return null;
    for (const at of parts) if (Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) <= RAILGUN.hitSize) return { time: t, point: p };
  }
  return null;
}

/**
 * The launch: down the rail faster and faster, then up and away off the muzzle
 * to a point high above the Moon, slowing as it gets there. Every page plays
 * it, as any flight. It ends in the air on purpose: from there the rider flies
 * down themselves (their own page moves them, as it does a builder on foot).
 */
export function rideFlight(_build: BuildState, _env: Environment, gun: Gun): Fall {
  const { from, bend, to } = railLine(gun);
  const flat = Math.hypot(bend[0] - from[0], bend[2] - from[2]);
  const slope = Math.hypot(to[0] - bend[0], to[1] - bend[1], to[2] - bend[2]);
  const mix = (a: Vec, b: Vec, k: number): Vec => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  // On along the way the gun points (but not out past the edge of the Moon as far as building goes), and a long way up.
  const ahead = Math.hypot(to[0] - bend[0], to[2] - bend[2]);
  const top: Vec = [edge(to[0] + ((to[0] - bend[0]) / ahead) * RAILGUN.launchOut), gun.y * LEVEL + RAILGUN.launchUp, edge(to[2] + ((to[2] - bend[2]) / ahead) * RAILGUN.launchOut)];
  const t1 = RAILGUN.rideRail, time = t1 + RAILGUN.rideClimb;
  const at = (t: number): Vec => {
    if (t <= t1) {
      // Gathering speed all the way down the rail.
      const d = (t / t1) ** 2 * (flat + slope);
      return d <= flat ? mix(from, bend, d / flat) : mix(bend, to, (d - flat) / slope);
    }
    // Fast off the muzzle, easing to a stop at the top.
    const k = (t - t1) / RAILGUN.rideClimb;
    return mix(to, top, 1 - (1 - k) * (1 - k));
  };
  const path: Vec[] = [];
  for (let i = 0; i < time * 10 - 1e-6; i++) path.push(at(i / 10));
  path.push(top);
  return { from, v: [0, 0, 0], time, land: top, path, glideFrom: 0, aloft: true };
}

const edge = (v: number) => Math.max(-EDGE, Math.min(EDGE, v));
