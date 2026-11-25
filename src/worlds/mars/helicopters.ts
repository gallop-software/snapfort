import { planFall } from "../../game/fall";
import { positionAt, type Flight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { HELI, homes, readCharge, readPose, type HeliPose, type HeliToPage, type WireHeli } from "./helicopterRules";

/** The server's side of Mars's helicopters (see helicopterRules.ts for what they are). */

interface Heli {
  id: number;
  pose: HeliPose;
  /** Who is in it: the pilot, then the passenger. */
  riders: [string | null, string | null];
  /** In the air with nobody at the controls (coming down, or thrown by a shot) until this time (ms); 0 when it is not. */
  lostUntil: number;
  /** When it was last flown or got in or out of (ms). */
  touched: number;
  /** Standing on its pad. */
  home: boolean;
  /** Its battery, 0..1, as of `touched`. */
  charge: number;
}

export interface HeliMemory {
  helis: Heli[];
  moved: Set<number>;
  telling: boolean;
  savedAt: number;
}

const SAVE_MS = 2000, TELL_MS = 100;
const mem = (room: Room) => (room.memory as { heli: HeliMemory }).heli;
const say = (room: Room, msg: HeliToPage, exceptId?: string) => room.broadcast(msg, exceptId);
const wire = (h: Heli): WireHeli => [h.id, h.pose, h.riders, h.charge];
const tellRiders = (room: Room, h: Heli) => say(room, { k: "heli-riders", id: h.id, riders: h.riders, pose: h.pose, charge: h.charge });
const round = (n: number) => Math.round(n * 100) / 100;

/** The helicopters when the room wakes: each where it was left, with whoever is still here in it. */
export function openHelis(room: Room): HeliMemory {
  const now = Date.now();
  const fresh = (): Heli[] => homes(room.build).map((pose, id) => ({ id, pose, riders: [null, null], lostUntil: 0, touched: now, home: true, charge: 1 }));
  const saved = room.load("helicopters");
  const here = new Set(room.players());
  const kept = Array.isArray(saved) && saved.length === fresh().length ? saved.map((r, id): Heli | null => {
    const pose = readPose((r as { pose?: unknown } | null)?.pose);
    if (!pose) return null;
    const { riders, touched, home, charge } = r as { riders?: unknown; touched?: unknown; home?: unknown; charge?: unknown };
    const who = (v: unknown) => (typeof v === "string" && here.has(v) ? v : null);
    const list = Array.isArray(riders) ? riders : [];
    const seated: [string | null, string | null] = [who(list[0]), who(list[1])];
    // (With the pilot gone, the passenger has the controls.)
    if (seated[0] === null) [seated[0], seated[1]] = [seated[1], null];
    return { id, pose, riders: seated, lostUntil: 0, touched: typeof touched === "number" ? touched : now, home: home === true, charge: readCharge(charge, 1) };
  }) : null;
  const helis = kept && kept.every((h) => h !== null) ? (kept as Heli[]) : fresh();
  return { helis, moved: new Set(), telling: false, savedAt: now };
}

function save(room: Room): void {
  const m = mem(room);
  m.savedAt = Date.now();
  room.save("helicopters", m.helis.map(({ pose, riders, touched, home, charge }) => ({ pose, riders, touched, home, charge })));
}

/** What a helicopter rests on under (x, z), coming down from `y`. */
function groundUnder(room: Room, x: number, y: number, z: number): Vec {
  const land = planFall(room.build, [Math.max(-248, Math.min(248, x)), Math.max(y, 2), Math.max(-248, Math.min(248, z))], [0, 0, 0], room.env).land;
  return [land[0], land[1] - 0.9, land[2]];
}

/** Standing with nobody in it, the battery fills: what it has now. */
function chargeNow(h: Heli, now: number): number {
  return h.riders[0] !== null || h.lostUntil > 0 ? h.charge : Math.min(1, h.charge + (now - h.touched) / 1000 / HELI.recharge);
}

function sendHome(room: Room, h: Heli): void {
  h.pose = homes(room.build)[h.id]!;
  h.riders = [null, null];
  h.lostUntil = 0;
  h.home = true;
  h.charge = 1;
  h.touched = Date.now();
  tellRiders(room, h);
  save(room);
}

/** An empty helicopter comes down from `from` to rest on whatever is under (x, z), the right way up. Nobody can get in until it lands. */
function comeDown(room: Room, h: Heli, from: HeliPose, x: number, z: number, arc: number, seconds?: number): void {
  const land = groundUnder(room, x, from[1] + 1 + arc, z);
  const to: HeliPose = [round(land[0]), round(land[1]), round(land[2]), from[3], 0, 0];
  const far = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const time = Math.round((seconds ?? Math.max(1.5, Math.min(12, far / HELI.sinkSpeed))) * 10) / 10;
  const now = Date.now();
  h.pose = to;
  h.riders = [null, null];
  h.home = false;
  h.touched = now;
  h.lostUntil = now + time * 1000;
  const until = h.lostUntil;
  save(room);
  say(room, { k: "heli-fall", id: h.id, from, to, seconds: time, arc });
  room.later(time * 1000, () => {
    // (Unless something else has happened to it since.)
    if (h.lostUntil !== until) return;
    h.lostUntil = 0;
    h.touched = Date.now();
    tellRiders(room, h);
  });
}

/** Ones left lying about go home after a while (looked at whenever anything happens). */
function tidy(room: Room): void {
  const now = Date.now();
  for (const h of mem(room).helis) if (h.riders[0] === null && !h.home && h.lostUntil === 0 && now - h.touched > HELI.idleFor) sendHome(room, h);
}

function tellMoved(room: Room): void {
  const m = mem(room);
  if (m.telling) return;
  m.telling = true;
  room.later(TELL_MS, () => {
    m.telling = false;
    if (m.moved.size === 0) return;
    const list = [...m.moved].map((id): [number, HeliPose] => [id, m.helis[id]!.pose]);
    m.moved.clear();
    // Not to the pilots themselves: they know where their own is.
    const pilots = new Set(list.map(([id]) => m.helis[id]!.riders[0]));
    if (pilots.size === 1 && [...pilots][0] !== null) say(room, { k: "heli-poses", list }, [...pilots][0]!);
    else say(room, { k: "heli-poses", list });
  });
}

export function helisJoined(room: Room, playerId: string): void {
  tidy(room);
  const now = Date.now();
  room.send(playerId, { k: "heli-all", list: mem(room).helis.map((h) => wire({ ...h, charge: chargeNow(h, now) })) } satisfies HeliToPage);
}

/** How high a helicopter stands above whatever is under it, m. */
const heightOf = (room: Room, h: Heli) => h.pose[1] - groundUnder(room, h.pose[0], h.pose[1], h.pose[2])[1];

/**
 * A builder is gone, thrown, or has got out: out of whatever seat they were
 * in. The pilot leaving in the air leaves nobody flying: the passenger is out
 * too (to fall, or fly on their own wings), and the helicopter comes down
 * empty. On the ground the passenger moves over to the controls.
 */
export function helisLetGo(room: Room, playerId: string): void {
  for (const h of mem(room).helis) {
    const seat = h.riders.indexOf(playerId);
    if (seat < 0) continue;
    const now = Date.now();
    h.touched = now;
    if (seat === 1) {
      h.riders[1] = null;
    } else if (heightOf(room, h) > 1.5) {
      comeDown(room, h, h.pose, h.pose[0], h.pose[2], 0);
      continue;
    } else {
      h.riders = [h.riders[1], null];
    }
    tellRiders(room, h);
    save(room);
  }
}

export function helisMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; pose?: unknown; charge?: unknown };
  if (typeof msg.k !== "string" || !msg.k.startsWith("heli-")) return;
  const m = mem(room);
  const now = Date.now();
  const mine = m.helis.find((h) => h.riders.includes(playerId));
  tidy(room);

  if (msg.k === "heli-board") {
    const h = typeof msg.id === "number" ? m.helis[msg.id] : undefined;
    if (!h || mine || room.isDown(playerId)) return;
    if (h.lostUntil > 0 || (h.riders[0] !== null && h.riders[1] !== null)) return room.send(playerId, { k: "heli-no", why: "full" } satisfies HeliToPage);
    const at = room.positionOf(playerId);
    if (!at || Math.hypot(at[0] - h.pose[0], at[2] - h.pose[2]) > HELI.boardReach + 2 || Math.abs(at[1] - 0.9 - h.pose[1]) > 5) return room.send(playerId, { k: "heli-no", why: "far" } satisfies HeliToPage);
    if (h.riders[0] === null) {
      h.charge = chargeNow(h, now);
      h.riders[0] = playerId;
    } else {
      h.riders[1] = playerId;
    }
    h.touched = now;
    h.home = false;
    save(room);
    return tellRiders(room, h);
  }
  if (!mine) return;
  const pose = readPose(msg.pose);

  if (msg.k === "heli-fly" && pose && mine.riders[0] === playerId) {
    const dt = Math.max(0.05, (now - mine.touched) / 1000);
    if (Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) > HELI.believable * dt + 3) return;
    mine.pose = pose;
    // (The battery only ever runs down in the air: a page cannot fill it by saying so.)
    mine.charge = Math.min(readCharge(msg.charge, mine.charge), Math.min(1, mine.charge + dt / HELI.recharge + 0.01));
    mine.touched = now;
    m.moved.add(mine.id);
    if (now - m.savedAt > SAVE_MS) save(room);
    return tellMoved(room);
  }
  if (msg.k === "heli-leave") {
    if (mine.riders[0] === playerId && pose && Math.hypot(pose[0] - mine.pose[0], pose[1] - mine.pose[1], pose[2] - mine.pose[2]) < 30) mine.pose = pose;
    return helisLetGo(room, playerId);
  }
}

/** A shot hits a helicopter in its way: the first time it comes within one's size of its middle. */
export function helisInTheWay(room: Room, flight: Flight): { time: number; point: Vec } | null {
  const helis = mem(room).helis.filter((h) => h.lostUntil === 0);
  if (helis.length === 0) return null;
  const speed = Math.hypot(...flight.v) + flight.g * flight.time;
  const step = Math.min(0.02, 0.5 / Math.max(speed, 1));
  for (let t = step; t <= flight.time * 1.5; t += step) {
    const p = positionAt(flight, t);
    if (p[1] < -1) return null;
    for (const h of helis) if (Math.hypot(p[0] - h.pose[0], p[1] - (h.pose[1] + HELI.middleUp), p[2] - h.pose[2]) <= HELI.hitSize) return { time: t, point: p };
  }
  return null;
}

/**
 * A shot landed: any helicopter close by is thrown through the air, away from
 * it, and comes down a little way off. (Whoever was in it has already been
 * thrown clear, in their airbags, by the shared rules.)
 */
export function helisStruck(room: Room, point: Vec): void {
  for (const h of mem(room).helis) {
    if (h.lostUntil > 0) continue;
    const dx = h.pose[0] - point[0], dz = h.pose[2] - point[2];
    const flat = Math.hypot(dx, dz);
    if (Math.hypot(flat, h.pose[1] + HELI.middleUp - point[1]) > HELI.tossWithin) continue;
    const a = flat > 0.3 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
    comeDown(room, h, h.pose, h.pose[0] + Math.sin(a) * HELI.tossOut, h.pose[2] + Math.cos(a) * HELI.tossOut, HELI.tossUp, HELI.tossFor);
  }
}

/** Pieces went: a helicopter parked on one of them drops to whatever is below. */
export function helisDrop(room: Room): void {
  for (const h of mem(room).helis) {
    if (h.riders[0] !== null || h.lostUntil > 0 || h.pose[1] < 0.1) continue;
    if (heightOf(room, h) > 0.3) comeDown(room, h, h.pose, h.pose[0], h.pose[2], 0);
  }
}
