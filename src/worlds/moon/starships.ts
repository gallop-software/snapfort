import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL, WORLD_HALF_CELLS } from "../../game/constants";
import { planFall, type Fall } from "../../game/fall";
import { overlaps, solidOf, type Box } from "../../game/keepOut";
import { gridBox, type Piece } from "../../game/pieces";
import { positionAt, type Flight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import {
  arrivalPose,
  boxOf,
  CABIN,
  cannotPlace,
  CATCH,
  crowded,
  cutsInto,
  cellsOf,
  clear,
  DESCENT,
  descentClear,
  fits,
  FLIGHT,
  heldBy,
  inTheWay,
  isBooster,
  isRocket,
  isShip,
  landedBox,
  mountFoot,
  onHull,
  onShip,
  overlap,
  partAt,
  PARTS,
  readPad,
  reachTo,
  reachToShip,
  readShip,
  rocketBalls,
  SEATS,
  shipBalls,
  shipPose,
  shipTouches,
  SIZE,
  STARSHIP,
  towerFoot,
  WATCH_FROM,
  whole,
  type Pad,
  type Ship,
  type StarToPage,
} from "./starshipRules";
import { gunsSolid } from "./railguns";
import { roversSolid, roversStruck } from "./rovers";
import { spaceFlight } from "./space";

/** The server's side of the Moon's Starship (see starshipRules.ts for what it is). Copied from the Meadow's; here whoever is thrown clear goes the Moon's way: out into space, and back on their rockets. */

export interface StarMemory {
  pads: Pad[];
  ships: Ship[];
  nextId: number;
  /** When each shot in the air was first seen (ms), to know where a flying rocket will be when it arrives. */
  shots: WeakMap<Flight, number>;
  /** While a ship is coming down: when its way was last looked over (ms), so that is done one at a time. */
  watched?: number;
}

const mem = (room: Room) => (room.memory as { star: StarMemory }).star;
/** What else is on the Moon that a ship coming in could hit: the rail guns, and any rover (parked, or driven under it). */
const others = (room: Room): Box[] => [...gunsSolid(room), ...roversSolid(room)];
/** A ship blew up with its foot at `foot`: rovers by it are thrown as a shot throws them, and their drivers sent flying. */
function blast(room: Room, foot: Vec): void {
  const drivers = roversStruck(room, foot, 9);
  drivers.forEach((id, i) => hurl(room, id, room.positionOf(id) ?? foot, i + 1, drivers.length + 1));
}
const say = (room: Room, msg: StarToPage) => room.broadcast(msg);
const no = (room: Room, playerId: string, why: Extract<StarToPage, { k: "pad-no" }>["why"]) => room.send(playerId, { k: "pad-no", why } satisfies StarToPage);
const save = (room: Room) => room.save("starship", { nextId: mem(room).nextId, pads: mem(room).pads, ships: mem(room).ships });
const tell = (room: Room, pad: Pad) => say(room, { k: "pad", pad, now: Date.now() });
const tellShip = (room: Room, ship: Ship) => say(room, { k: "ship", ship, now: Date.now() });

/**
 * Thrown clear of an explosion (this world's way: up and out into space,
 * flailing, then back down on their rockets). Each of `n` goes a different way.
 */
function hurl(room: Room, playerId: string, from: Vec, i: number, n: number): void {
  const a = ((i + Math.random() * 0.6) / Math.max(1, n)) * Math.PI * 2;
  const out = 16 + Math.random() * 12;
  const v: Vec = [Math.sin(a) * out, 26 + Math.random() * 14, Math.cos(a) * out];
  const fall = planFall(room.build, from, v, room.env);
  room.fly(playerId, spaceFlight({ build: room.build, env: room.env, playerId, from, v, fall }) ?? fall);
}

/** Reads what was saved when the room wakes. Whoever sat in a ship still does, if they are still here. */
export function openStar(room: Room): StarMemory {
  const saved = room.load("starship") as { nextId?: unknown; pads?: unknown; ships?: unknown } | undefined;
  const here = new Set(room.players());
  const pads = (Array.isArray(saved?.pads) ? saved.pads : []).flatMap((p) => {
    const pad = readPad(p);
    if (!pad) return [];
    pad.riders = pad.riders.map((r) => (r !== null && here.has(r) ? r : null));
    return pad;
  });
  const ships = (Array.isArray(saved?.ships) ? saved.ships : []).flatMap((s) => {
    const ship = readShip(s);
    if (!ship) return [];
    ship.riders = ship.riders.filter((r) => here.has(r));
    return ship;
  });
  // Whatever was under way when the room went to sleep is caught up with as soon as it is awake.
  room.later(0, () => settle(room));
  return { pads, ships, nextId: Math.max(typeof saved?.nextId === "number" ? saved.nextId : 1, 1 + Math.max(0, ...pads.map((p) => p.id))), shots: new WeakMap() };
}

/** Looks again in `seconds`. */
const wake = (room: Room, seconds: number) => room.later(Math.max(0, seconds * 1000) + 40, () => settle(room));

/**
 * Everything that happens by the clock: a countdown ends, a rocket reaches
 * something built in its way, the ship leaves this world, the booster is
 * caught; a ship coming in lands, and later goes. Safe to call at any time,
 * any number of times.
 */
export function settle(room: Room): void {
  const m = mem(room);
  const now = Date.now();
  for (const pad of [...m.pads]) {
    if (pad.count && !pad.flight && now >= pad.count + FLIGHT.count * 1000) liftoff(room, pad);
    const f = pad.flight;
    if (!f) continue;
    const t = (now - f.at) / 1000;
    if (f.hitAt !== undefined && t >= f.hitAt) {
      explode(room, pad, "all");
      continue;
    }
    if (f.ship && t >= FLIGHT.handoff) handoff(room, pad);
    if (pad.flight && t >= CATCH) caught(room, pad);
  }
  for (const ship of [...m.ships]) {
    const t = (now - ship.at) / 1000;
    if (!ship.down && t >= DESCENT) touchdown(room, ship);
    else if (!ship.down && t >= WATCH_FROM) {
      // Low enough to meet what is built: anything its hull touches on the way down blows it up, there and then.
      if (shipTouches(ship, t, solids(room, ship))) explodeShip(room, ship);
      else if (now - (m.watched ?? 0) >= 100) {
        m.watched = now;
        room.later(140, () => settle(room));
      }
    }
    if (t >= DESCENT + STARSHIP.stay && m.ships.includes(ship)) {
      m.ships = m.ships.filter((s) => s !== ship);
      say(room, { k: "ship-gone", trip: ship.trip });
      save(room);
    }
  }
}

/** Clears away unfinished sites nobody has added to for a long while. */
function tidy(room: Room): void {
  const m = mem(room);
  const now = Date.now();
  const old = m.pads.filter((p) => p.parts.length < PARTS && !p.flight && p.riders.every((r) => r === null) && now - p.touched >= STARSHIP.abandonedAfter);
  if (old.length === 0) return;
  m.pads = m.pads.filter((p) => !old.includes(p));
  for (const p of old) say(room, { k: "pad-gone", id: p.id });
  save(room);
}

export function starJoined(room: Room, playerId: string): void {
  tidy(room);
  settle(room);
  room.send(playerId, { k: "pads", pads: mem(room).pads, ships: mem(room).ships, now: Date.now() } satisfies StarToPage);
}

/** A builder is gone, or thrown: out of whatever seat they were in. */
export function starLetGo(room: Room, playerId: string): void {
  for (const pad of mem(room).pads) {
    if (!pad.riders.includes(playerId)) continue;
    pad.riders = pad.riders.map((r) => (r === playerId ? null : r));
    tell(room, pad);
    save(room);
  }
  for (const ship of mem(room).ships) {
    if (!ship.riders.includes(playerId)) continue;
    ship.riders = ship.riders.filter((r) => r !== playerId);
    tellShip(room, ship);
    save(room);
  }
}

const across = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * True when a builder is within `reach` metres of where part `n` goes (a
 * little more is allowed for: where they are is known a tenth of a second late).
 */
function within(room: Room, playerId: string, pad: Pad, n: number, reach: number): boolean {
  const p = room.positionOf(playerId);
  return !!p && reachTo(pad, n, p) <= reach + 1.5;
}

/** True when a builder is near the tower or the mount, across the ground. */
function near(room: Room, playerId: string, pad: Pad, reach: number): boolean {
  const p = room.positionOf(playerId);
  return !!p && Math.min(across(p, towerFoot(pad)), across(p, mountFoot(pad))) <= reach;
}

/** Takes parts off a site; the last one gone, so is the site. */
function takeOff(room: Room, pad: Pad, parts: readonly number[]): void {
  if (parts.length === 0) return;
  pad.parts = pad.parts.filter((n) => !parts.includes(n));
  pad.readyAt = 0;
  if (pad.parts.length === 0 && !pad.flight) {
    mem(room).pads = mem(room).pads.filter((p) => p !== pad);
    say(room, { k: "pad-gone", id: pad.id });
  } else tell(room, pad);
  save(room);
}

/** Where a seated builder is now: in the ship, wherever it has got to. */
function riderAt(pad: Pad, now: number): Vec {
  return onHull(pad, shipPose(pad.flight ? (now - pad.flight.at) / 1000 : 0), SIZE.deck + SIZE.booster, CABIN);
}

/**
 * The rocket blows up: all of it, or (once they have parted) just the ship or
 * just the booster. Its parts are gone, and whoever is in the ship is thrown
 * clear, each a different way, to land wherever they come down.
 */
function explode(room: Room, pad: Pad, what: "all" | "ship" | "booster"): void {
  const now = Date.now();
  const gone = pad.parts.filter((n) => (what === "all" ? isRocket(n) : what === "ship" ? isShip(n) : isBooster(n)));
  const balls = rocketBalls(pad, now).filter((b) => what === "all" || b.of === what);
  // (Middle of what blows up, for the fireball.)
  const at: Vec = balls.length > 0 ? [0, 1, 2].map((i) => balls.reduce((s, b) => s + b.c[i]!, 0) / balls.length) as Vec : mountFoot(pad);
  if (what !== "booster") {
    const riders = pad.riders.filter((r): r is string => r !== null);
    const from = riderAt(pad, now);
    pad.riders = pad.riders.map(() => null);
    riders.forEach((id, i) => hurl(room, id, from, i, riders.length));
  }
  const f = pad.flight;
  if (f) {
    if (what !== "booster") f.ship = false;
    if (what !== "ship") f.booster = false;
    delete f.hitAt;
    if (!f.ship && !f.booster) pad.flight = null;
  }
  pad.count = 0;
  say(room, { k: "boom", at, size: what === "all" ? 90 : 60 });
  takeOff(room, pad, gone);
}

/** The countdown is over: the engines light. */
function liftoff(room: Room, pad: Pad): void {
  const now = Date.now();
  const here = new Set(room.players());
  pad.riders = pad.riders.map((r) => (r !== null && here.has(r) ? r : null));
  const riders = pad.riders.filter((r): r is string => r !== null);
  pad.count = 0;
  // Nobody aboard any more, or no longer whole: no launch.
  if (riders.length === 0 || !whole(pad) || !room.worlds().some((w) => w.id === pad.to)) {
    tell(room, pad);
    return save(room);
  }
  const hitAt = inTheWay(room.build, pad);
  pad.flight = { at: now, to: pad.to, trip: `${room.env.id}-${pad.id}-${now.toString(36)}`, ship: true, booster: true, ...(hitAt === null ? {} : { hitAt }) };
  pad.readyAt = 0;
  // Anyone standing by the mount is blown away.
  const foot = mountFoot(pad);
  room.players().forEach((id, i) => {
    const p = room.positionOf(id);
    if (riders.includes(id) || !p || room.isDown(id) || p[1] > SIZE.deck + 6) return;
    const d = across(p, foot);
    if (d > STARSHIP.blast) return;
    const k = d < 0.5 ? [Math.sin(i), Math.cos(i)] : [(p[0] - foot[0]) / d, (p[2] - foot[2]) / d];
    room.fly(id, planFall(room.build, p, [k[0]! * 30, 24, k[1]! * 30], room.env));
  });
  // The world it is going to hears now, so the ship is in its sky when its passengers get there.
  if (hitAt === null || hitAt > FLIGHT.handoff) {
    void room.toWorld(pad.to, { k: "ship", trip: pad.flight.trip, seats: riders.length, at: now + (FLIGHT.handoff + STARSHIP.gap) * 1000 });
  }
  save(room);
  tell(room, pad);
  if (hitAt !== null) wake(room, hitAt);
  wake(room, FLIGHT.handoff);
  wake(room, CATCH);
}

/** The ship leaves this world: its passengers' pages follow it, and its four parts are gone from here. */
function handoff(room: Room, pad: Pad): void {
  const f = pad.flight!;
  const riders = pad.riders.filter((r): r is string => r !== null);
  for (const id of riders) room.send(id, { k: "ship-go", to: f.to, trip: f.trip } satisfies StarToPage);
  pad.riders = pad.riders.map(() => null);
  f.ship = false;
  takeOff(room, pad, pad.parts.filter(isShip));
  // Anyone whose page did not follow (it should have) is set down by the tower.
  room.later(8000, () => {
    const foot = towerFoot(pad);
    for (const id of riders) {
      const p = room.positionOf(id);
      if (!p || !room.players().includes(id) || p[1] < 200) continue;
      const land: Vec = [foot[0] + 12, 0.9, foot[2] + 12];
      room.fly(id, { from: p, v: [0, 0, 0], time: 0.4, land, path: [p, land], glideFrom: 0 } satisfies Fall);
    }
  });
}

/** The booster is back: into the arms, if they and the tower still stand and nothing is built in its way. Otherwise it is lost. */
function caught(room: Room, pad: Pad): void {
  const f = pad.flight!;
  const had = f.booster;
  pad.flight = null;
  pad.touched = Date.now();
  if (had && (![9, 10, 11, 12].every((n) => pad.parts.includes(n)) || inTheWay(room.build, pad) !== null)) return explode(room, pad, "booster");
  save(room);
  tell(room, pad);
}

/**
 * Everything solid a ship coming in could hit: what is built, launch sites
 * (with any rocket standing on one), ships already down, and whatever else
 * this world has standing about.
 */
function solids(room: Room, coming: Ship): Box[] {
  const m = mem(room);
  const boxes: Box[] = [...others(room)];
  for (const piece of room.build.all()) boxes.push(solidOf(piece, room.env));
  for (const pad of m.pads) for (const n of pad.parts) if (!(pad.flight && isRocket(n))) boxes.push(boxOf(pad, n));
  for (const s of m.ships) if (s !== coming && s.down) boxes.push(landedBox(s));
  return boxes;
}

/** A ship from another world is down: its passengers get out. If something has been built where it lands, it blows up instead. */
function touchdown(room: Room, ship: Ship): void {
  if (shipTouches(ship, DESCENT, solids(room, ship))) return explodeShip(room, ship);
  ship.down = true;
  ship.riders = [];
  tellShip(room, ship);
  save(room);
  wake(room, STARSHIP.stay);
}

function explodeShip(room: Room, ship: Ship): void {
  const pose = arrivalPose((Date.now() - ship.at) / 1000);
  const riders = ship.riders;
  ship.riders = [];
  mem(room).ships = mem(room).ships.filter((s) => s !== ship);
  say(room, { k: "boom", at: onShip(ship, pose, 26), size: 60 });
  say(room, { k: "ship-gone", trip: ship.trip });
  riders.forEach((id, i) => hurl(room, id, onShip(ship, pose, CABIN), i, riders.length));
  blast(room, onShip(ship, pose, 0));
  save(room);
}

export function starMessage(room: Room, playerId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const msg = data as { k?: unknown; id?: unknown; n?: unknown; on?: unknown; x?: unknown; z?: unknown; dir?: unknown; to?: unknown; trip?: unknown };
  const m = mem(room);
  const now = Date.now();
  const int = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  settle(room);

  if (msg.k === "pad-new") {
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    if (!int(msg.x) || !int(msg.z) || !int(msg.dir) || msg.dir < 0 || msg.dir > 3) return;
    const pad: Pad = { id: m.nextId, x: msg.x, z: msg.z, dir: msg.dir, parts: [1], touched: now, readyAt: 0, riders: Array.from({ length: SEATS }, () => null), count: 0, to: "", flight: null };
    if (!fits(pad)) return no(room, playerId, "room");
    if (!within(room, playerId, pad, 1, STARSHIP.placeReach)) return no(room, playerId, "far");
    if (!clear(room.build, pad)) return no(room, playerId, "crowded");
    tidy(room);
    if (m.pads.some((p) => overlap(p, pad)) || m.ships.some((s) => cellsOf(pad).some((c) => Math.abs((c.x + 0.5) * CELL - s.x) < 12 && Math.abs((c.z + 0.5) * CELL - s.z) < 12))) return no(room, playerId, "overlap");
    if (m.pads.length >= STARSHIP.most) return no(room, playerId, "full");
    m.nextId++;
    m.pads.push(pad);
    save(room);
    return tell(room, pad);
  }

  if (msg.k === "pad-part") {
    const pad = m.pads.find((p) => p.id === msg.id);
    if (!pad || !int(msg.n)) return;
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    const why = cannotPlace(pad, msg.n) ?? (crowded(room.build, pad, msg.n, room.env) ? "crowded" : null);
    if (why) return no(room, playerId, why);
    if (!within(room, playerId, pad, msg.n, STARSHIP.placeReach)) return no(room, playerId, "far");
    pad.parts.push(msg.n);
    pad.touched = now;
    // Whole: fuelling starts.
    if (whole(pad)) pad.readyAt = now + STARSHIP.fuel * 1000;
    save(room);
    return tell(room, pad);
  }

  if (msg.k === "pad-take") {
    // The Remove tool: a part comes off once nothing stands on it or hangs from it.
    const pad = m.pads.find((p) => p.id === msg.id);
    if (!pad || !int(msg.n) || !pad.parts.includes(msg.n)) return;
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    if (!within(room, playerId, pad, msg.n, STARSHIP.removeReach)) return no(room, playerId, "far");
    if (isRocket(msg.n) && (pad.flight || pad.count)) return no(room, playerId, "counting");
    if (heldBy(msg.n).some((k) => pad.parts.includes(k))) return no(room, playerId, "holds");
    if (isShip(msg.n) && pad.riders.some((r) => r !== null)) return no(room, playerId, "busy");
    return takeOff(room, pad, [msg.n]);
  }

  if (msg.k === "pad-sit") {
    const pad = m.pads.find((p) => p.id === msg.id);
    if (!pad) return;
    if (msg.on !== true) {
      // (Nobody gets out once it has left the ground.)
      if (!pad.riders.includes(playerId) || pad.flight) return;
      pad.riders = pad.riders.map((r) => (r === playerId ? null : r));
      save(room);
      return tell(room, pad);
    }
    // Riding comes with building here.
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    if (!pad.parts.includes(20) || pad.flight || room.isDown(playerId) || m.pads.some((p) => p.riders.includes(playerId))) return;
    const seat = pad.riders.indexOf(null);
    if (seat < 0) return no(room, playerId, "busy");
    if (!near(room, playerId, pad, STARSHIP.boardReach + 3)) return no(room, playerId, "far");
    pad.riders[seat] = playerId;
    save(room);
    return tell(room, pad);
  }

  if (msg.k === "pad-launch") {
    const pad = m.pads.find((p) => p.riders.includes(playerId));
    if (!pad || pad.flight) return;
    if (pad.count) return no(room, playerId, "counting");
    if (!whole(pad)) return no(room, playerId, "broken");
    if (now < pad.readyAt) return no(room, playerId, "fuelling");
    // Where to: the world asked for, when there is such a one; else the first there is.
    const to = room.worlds().find((w) => w.id === msg.to) ?? room.worlds()[0];
    if (!to) return no(room, playerId, "nowhere");
    pad.count = now;
    pad.to = to.id;
    save(room);
    tell(room, pad);
    return wake(room, FLIGHT.count);
  }

  if (msg.k === "ship-take") {
    // The Remove tool on a landed ship: any builder, from close by, takes the whole of it away.
    const ship = m.ships.find((s) => s.trip === msg.trip);
    if (!ship || !ship.down) return;
    if (!room.mayBuild(playerId)) return no(room, playerId, "locked");
    const p = room.positionOf(playerId);
    if (!p || reachToShip(ship, p) > STARSHIP.removeReach + 1.5) return no(room, playerId, "far");
    m.ships = m.ships.filter((s) => s !== ship);
    say(room, { k: "ship-gone", trip: ship.trip });
    return save(room);
  }

  if (msg.k === "ship-aboard") {
    const ship = m.ships.find((s) => s.trip === msg.trip);
    if (!ship || ship.down || ship.riders.includes(playerId) || ship.riders.length >= ship.seats) return;
    ship.riders.push(playerId);
    save(room);
    return tellShip(room, ship);
  }
}

/** A piece cannot be built into any part of a launch site. */
export function starBlocks(room: Room, piece: Piece): boolean {
  const { pads, ships } = mem(room);
  if (pads.length === 0 && ships.length === 0) return false;
  const box = solidOf(piece, room.env);
  // (A landed ship too. One still coming in is not there yet: what is built where it lands blows it up.)
  return pads.some((pad) => cutsInto(pad, box)) || ships.some((ship) => ship.down && overlaps(landedBox(ship), box, 0.2));
}

/**
 * A shot hits a part of a launch site, a rocket (standing or flying) or a
 * ship coming in: the first time it comes within one's size.
 */
export function starShotHits(room: Room, flight: Flight): { time: number; point: Vec } | null {
  const m = mem(room);
  if (m.pads.length === 0 && m.ships.length === 0) return null;
  // (The same shot is asked about again when it arrives: its clock starts the first time.)
  let launched = m.shots.get(flight);
  if (launched === undefined) m.shots.set(flight, (launched = Date.now()));
  const boxes = m.pads.flatMap((pad) => pad.parts.filter((n) => !isRocket(n)).map((n) => boxOf(pad, n)));
  const speed = Math.hypot(...flight.v) + flight.g * flight.time;
  const step = Math.min(0.02, 0.5 / Math.max(speed, 1));
  const moving = m.pads.some((p) => p.flight) || m.ships.some((s) => !s.down);
  let balls = [...m.pads.flatMap((p) => rocketBalls(p, launched!)), ...m.ships.flatMap((s) => shipBalls(s, launched!))];
  for (let t = step, i = 0; t <= flight.time * 1.5; t += step, i++) {
    const p = positionAt(flight, t);
    if (p[1] < -1) return null;
    for (const b of boxes) if (p[0] >= b[0] - 0.4 && p[0] <= b[3] + 0.4 && p[1] >= b[1] - 0.4 && p[1] <= b[4] + 0.4 && p[2] >= b[2] - 0.4 && p[2] <= b[5] + 0.4) return { time: t, point: p };
    // (Where anything flying will be by then, looked up every tenth of a second or so.)
    if (moving && i % 6 === 0) balls = [...m.pads.flatMap((pad) => rocketBalls(pad, launched! + t * 1000)), ...m.ships.flatMap((s) => shipBalls(s, launched! + t * 1000))];
    for (const b of balls) if (Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]) <= b.r) return { time: t, point: p };
  }
  return null;
}

/**
 * A shot landed. On a rocket (or a ship coming in): it blows up. On the tower,
 * its arms or the mount: that part comes off, with whatever stands on it or
 * hangs from it; and if that is the rocket, the rocket blows up.
 */
export function starStruck(room: Room, point: Vec): void {
  const m = mem(room);
  const now = Date.now();
  const on = (balls: { c: Vec; r: number }[]) => balls.some((b) => Math.hypot(point[0] - b.c[0], point[1] - b.c[1], point[2] - b.c[2]) <= b.r + STARSHIP.near);
  for (const ship of [...m.ships]) if (on(shipBalls(ship, now))) explodeShip(room, ship);
  for (const pad of [...m.pads]) {
    const balls = rocketBalls(pad, now);
    const parted = pad.flight !== null && (now - pad.flight.at) / 1000 > FLIGHT.stage;
    if (parted) {
      // (The ship and the booster have gone their own ways: each is hit on its own.)
      for (const of of ["ship", "booster"] as const) if (on(balls.filter((b) => b.of === of))) explode(room, pad, of);
    } else if (on(balls)) {
      explode(room, pad, "all");
      continue;
    }
    if (!m.pads.includes(pad)) continue;
    const n = partAt({ ...pad, parts: pad.parts.filter((k) => !isRocket(k)) }, point[0], point[1], point[2], STARSHIP.near);
    if (n === null) continue;
    const down = [n, ...heldBy(n).filter((k) => pad.parts.includes(k))];
    // What held the rocket up is gone: so is the rocket (unless it is away, flying).
    if (down.some(isRocket) && !pad.flight) explode(room, pad, "all");
    if (m.pads.includes(pad)) takeOff(room, pad, down.filter((k) => pad.parts.includes(k) && !(pad.flight && isRocket(k))));
  }
}

/**
 * Somewhere clear to land: open ground a little way from where builders
 * arrive, with nothing built in it and no launch site on it, and nothing
 * (however tall, and whatever `others` this world has standing) in the ship's
 * way as it comes down. Failing that, the open ground nearest the middle.
 */
export function landingSpot(build: BuildState, pads: readonly Pad[], ships: readonly Ship[], turn = Math.random(), others: readonly Box[] = []): { x: number; z: number } {
  const taken = new Set<string>();
  const boxes: Box[] = [...others];
  for (const pad of pads) for (const n of pad.parts) boxes.push(boxOf(pad, n));
  for (const s of ships) boxes.push(landedBox(s));
  for (const piece of build.all()) {
    const b = gridBox(piece);
    boxes.push([b[0] * CELL, b[1] * LEVEL, b[2] * CELL, b[3] * CELL, b[4] * LEVEL, b[5] * CELL]);
    for (let x = Math.floor(b[0] - 0.01); x <= Math.floor(b[3] + 0.01); x++) for (let z = Math.floor(b[2] - 0.01); z <= Math.floor(b[5] + 0.01); z++) taken.add(`${x},${z}`);
  }
  for (const pad of pads) for (const c of cellsOf(pad)) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) taken.add(`${c.x + dx},${c.z + dz}`);
  for (const s of ships) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) taken.add(`${Math.floor(s.x / CELL) + dx},${Math.floor(s.z / CELL) + dz}`);
  const free = (cx: number, cz: number) => {
    if (Math.abs(cx) > WORLD_HALF_CELLS - 4 || Math.abs(cz) > WORLD_HALF_CELLS - 4) return false;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (taken.has(`${cx + dx},${cz + dz}`)) return false;
    return descentClear({ x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL }, boxes);
  };
  for (let ring = 60; ring <= 220; ring += 20) {
    for (let i = 0; i < 16; i++) {
      const a = (turn + i / 16) * Math.PI * 2;
      const cx = Math.floor((Math.sin(a) * ring) / CELL), cz = Math.floor((Math.cos(a) * ring) / CELL);
      if (free(cx, cz)) return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
    }
  }
  // Crowded: any open ground at all, the nearest to the middle first.
  const cells: [number, number][] = [];
  for (let cx = -WORLD_HALF_CELLS + 4; cx <= WORLD_HALF_CELLS - 4; cx++) for (let cz = -WORLD_HALF_CELLS + 4; cz <= WORLD_HALF_CELLS - 4; cz++) cells.push([cx, cz]);
  cells.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const [cx, cz] of cells) if (free(cx, cz)) return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
  return { x: 62.5, z: 2.5 };
}

/** Another world says a ship is on its way here. */
export function starFromWorld(room: Room, from: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const msg = data as { k?: unknown; trip?: unknown; seats?: unknown; at?: unknown };
  if (msg.k !== "ship" || typeof msg.trip !== "string" || msg.trip.length > 60 || typeof msg.seats !== "number" || typeof msg.at !== "number") return undefined;
  const m = mem(room);
  if (m.ships.some((s) => s.trip === msg.trip)) return true;
  const now = Date.now();
  const spot = landingSpot(room.build, m.pads, m.ships, Math.random(), others(room));
  const ship: Ship = { trip: msg.trip, from, at: Math.max(now, Math.min(now + 120_000, msg.at)), ...spot, seats: Math.max(1, Math.min(SEATS, Math.round(msg.seats))), riders: [], down: false };
  m.ships.push(ship);
  save(room);
  tellShip(room, ship);
  wake(room, (ship.at - now) / 1000 + WATCH_FROM);
  wake(room, (ship.at - now) / 1000 + DESCENT);
  return true;
}
