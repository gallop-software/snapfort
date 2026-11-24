import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildState } from "../../game/buildState";
import type { Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { planFlight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { server } from "./server";
import { arrivalPose, boosterPose, boxOf, cannotPlace, CATCH, cellsOf, DESCENT, FLIGHT, heldBy, inTheWay, localBox, middleOf, mountFoot, needsOf, PARTS, SEATS, shipPose, SIZE, STARSHIP, towerFoot, type Pad, type Ship, type StarToPage } from "./starshipRules";
import { landingSpot } from "./starships";
import { world as HERE } from "./world";

const piece = (type: Piece["type"], x: number, y: number, z: number, rot: Piece["rot"] = 0): Piece => ({ id: `${type}${x},${y},${z},${rot}`, type, x, y, z, rot, material: "wood", edit: 0 });

/** (Copied from the Meadow's, with the Moon's own way of coming in to land and of being thrown.) A room with builders in it, recording what its server half does, keeping what it saves, and running its timers on the test's clock. */
function fakeRoom(build = new BuildState(), saved = new Map<string, unknown>()) {
  const sent: { to: string; msg: StarToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const toWorld: { to: string; data: unknown }[] = [];
  const at = new Map<string, Vec>(["a", "b", "c", "d", "e", "f", "g", "h", "v"].map((id) => [id, [0, 0.9, 0]]));
  const room: Room = {
    env: HERE,
    build,
    memory: undefined,
    players: () => [...at.keys()],
    positionOf: (id) => at.get(id) ?? null,
    isDown: () => false,
    send: (to, msg) => void sent.push({ to, msg: msg as StarToPage }),
    broadcast: (msg) => void sent.push({ to: "all", msg: msg as StarToPage }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: (ms, fn) => void setTimeout(fn, ms),
    // "v" is visiting.
    mayBuild: (id) => id !== "v",
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
    worlds: () => [{ id: "elsewhere", name: "Elsewhere" }],
    toWorld: async (to, data) => void toWorld.push({ to, data }),
  };
  room.memory = server.open!(room);
  const memory = () => (room.memory as { star: { pads: Pad[]; ships: Ship[] } }).star;
  const say = (id: string, msg: unknown) => server.message!(room, id, msg);
  const last = (k: StarToPage["k"]) => sent.filter((s) => s.msg.k === k).at(-1)?.msg;
  /** Builder `id` starts a site by the origin and puts every part on, in order. */
  const assemble = (id: string, upTo = PARTS) => {
    at.set(id, [-50, 0.9, -15]);
    say(id, { k: "pad-new", x: -12, z: -4, dir: 0 });
    for (let n = 2; n <= upTo; n++) say(id, { k: "pad-part", id: 1, n });
    return memory().pads[0]!;
  };
  const standBy = (id: string, pad: Pad) => at.set(id, [towerFoot(pad)[0] + 9, 0.9, towerFoot(pad)[2]]);
  return { room, sent, flown, toWorld, at, saved, memory, say, last, assemble, standBy };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());
const pass = (seconds: number) => vi.advanceTimersByTime(seconds * 1000);

describe("the Starship kit", () => {
  it("is full size: a 146 m tower, and a 123 m rocket on its mount", () => {
    expect(localBox(9)[4]).toBeCloseTo(146);
    expect(localBox(21)[4] - localBox(14)[1]).toBeCloseTo(123);
    expect(localBox(17)[4] - localBox(14)[1]).toBeCloseTo(71);
    expect(localBox(14)[3] - localBox(14)[0]).toBeCloseTo(9);
    expect(SIZE.ship.reduce((a, b) => a + b, 0)).toBe(SIZE.shipTall);
  });

  it("goes up from the ground: every part needs lower-numbered ones, and the rocket needs the mount and both arms", () => {
    for (let n = 2; n <= PARTS; n++) for (const m of needsOf(n)) expect(m).toBeLessThan(n);
    expect(needsOf(14).sort()).toEqual([10, 11, 12]);
    expect(heldBy(1)).toHaveLength(PARTS - 1);
    expect(heldBy(21)).toEqual([]);
    // The fuelling arm holds nothing up; an arm holds the other arm and the rocket.
    expect(heldBy(13)).toEqual([]);
    expect(heldBy(11)).toEqual([12, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it("stands inside its own cells whichever way it points", () => {
    for (const dir of [0, 1, 2, 3]) {
      const site = { x: 3, z: -7, dir };
      const cells = cellsOf(site);
      expect(cells).toHaveLength(21);
      for (const n of [1, 9, 10, 14, 21]) {
        const m = middleOf(site, n);
        expect(cells.some((c) => c.x === Math.floor(m[0] / 5) && c.z === Math.floor(m[2] / 5)), `part ${n} dir ${dir}`).toBe(true);
      }
      const b = boxOf(site, 10);
      expect(b[3] - b[0]).toBeCloseTo(15);
      expect(Math.hypot(mountFoot(site)[0] - towerFoot(site)[0], mountFoot(site)[2] - towerFoot(site)[2])).toBeCloseTo(20);
    }
  });
});

describe("the flight", () => {
  it("is one smooth trip: no jumps at staging, the booster home at the catch", () => {
    for (let t = 0; t < CATCH + 1; t += 0.05) {
      const a = boosterPose(t), b = boosterPose(t + 0.05);
      expect(Math.abs(b.up - a.up), `booster at ${t}`).toBeLessThan(6);
      expect(Math.abs(b.ahead - a.ahead), `booster at ${t}`).toBeLessThan(2);
    }
    for (let t = 0; t < FLIGHT.handoff; t += 0.05) expect(Math.abs(shipPose(t + 0.05).up - shipPose(t).up), `ship at ${t}`).toBeLessThan(10);
    expect(boosterPose(CATCH)).toMatchObject({ up: 0, ahead: 0, tilt: 0 });
    expect(boosterPose(CATCH - 0.05).up).toBeLessThan(1);
    expect(CATCH).toBeGreaterThan(30);
    expect(CATCH).toBeLessThan(40);
  });

  it("takes the ship high, but not past where builders can be", () => {
    const top = SIZE.deck + SIZE.booster + shipPose(FLIGHT.handoff).up + 40;
    expect(top).toBeGreaterThan(1000);
    expect(top).toBeLessThan(1490);
  });

  it("brings an arriving ship straight down, tail first, onto the ground", () => {
    expect(arrivalPose(0).up).toBeGreaterThan(1200);
    for (const t of [0, 2, 8, DESCENT - 1, DESCENT]) expect(arrivalPose(t).tilt).toBe(0);
    expect(arrivalPose(DESCENT - 0.05).up).toBeLessThan(4);
    expect(arrivalPose(DESCENT - 1).burn).toBeGreaterThan(0);
  });
});

describe("building a launch site", () => {
  it("is built in order, by builders, from nearby", () => {
    const r = fakeRoom();
    r.at.set("v", [-50, 0.9, -15]);
    r.say("v", { k: "pad-new", x: -12, z: -4, dir: 0 });
    expect(r.memory().pads).toHaveLength(0);
    expect(r.last("pad-no")).toMatchObject({ why: "locked" });
    r.say("a", { k: "pad-new", x: -12, z: -4, dir: 0 });
    expect(r.last("pad-no")).toMatchObject({ why: "far" });
    const pad = r.assemble("a", 3);
    expect(pad.parts).toEqual([1, 2, 3]);
    r.say("a", { k: "pad-part", id: 1, n: 14 });
    expect(r.last("pad-no")).toMatchObject({ why: "needs" });
    expect(cannotPlace(pad, 10)).toBeNull();
    r.say("a", { k: "pad-part", id: 1, n: 3 });
    expect(r.last("pad-no")).toMatchObject({ why: "have" });
    for (let n = 4; n <= PARTS; n++) r.say("a", { k: "pad-part", id: 1, n });
    expect(pad.parts).toHaveLength(PARTS);
    expect(pad.readyAt).toBe(Date.now() + STARSHIP.fuel * 1000);
  });

  it("cannot stand on what is built, or on another site", () => {
    const build = new BuildState();
    build.apply({ kind: "place", piece: piece("floor", -12, 0, 0) });
    const r = fakeRoom(build);
    r.at.set("a", [-50, 0.9, -15]);
    r.say("a", { k: "pad-new", x: -12, z: -4, dir: 0 });
    expect(r.last("pad-no")).toMatchObject({ why: "crowded" });
    r.say("a", { k: "pad-new", x: -12, z: -4, dir: 2 });
    expect(r.memory().pads).toHaveLength(1);
    r.say("a", { k: "pad-new", x: -10, z: -6, dir: 2 });
    expect(r.last("pad-no")).toMatchObject({ why: "overlap" });
  });

  it("comes apart from the top with the Remove tool", () => {
    const r = fakeRoom();
    const pad = r.assemble("a");
    r.say("a", { k: "pad-take", id: 1, n: 14 });
    expect(r.last("pad-no")).toMatchObject({ why: "holds" });
    r.say("a", { k: "pad-take", id: 1, n: 21 });
    expect(pad.parts).not.toContain(21);
    expect(pad.readyAt).toBe(0);
    r.say("a", { k: "pad-take", id: 1, n: 13 });
    expect(pad.parts).not.toContain(13);
  });

  it("is still there after the room has slept", () => {
    const r = fakeRoom();
    r.assemble("a");
    r.standBy("b", r.memory().pads[0]!);
    r.say("b", { k: "pad-sit", id: 1, on: true });
    const again = fakeRoom(new BuildState(), r.saved);
    expect(again.memory().pads[0]!.parts).toHaveLength(PARTS);
    expect(again.memory().pads[0]!.riders[0]).toBe("b");
  });
});

/** A whole, fuelled site with these builders seated. */
function crewed(riders: string[], build = new BuildState()) {
  const r = fakeRoom(build);
  const pad = r.assemble("a");
  pass(STARSHIP.fuel + 1);
  for (const id of riders) {
    r.standBy(id, pad);
    r.say(id, { k: "pad-sit", id: 1, on: true });
  }
  return { ...r, pad };
}

describe("nothing is built into a launch site", () => {
  const blocks = (r: ReturnType<typeof fakeRoom>, p: Piece) => server.blocks!(r.room, p);
  const cell = (v: Vec) => [Math.floor(v[0] / 5), Math.floor(v[2] / 5)] as const;

  it("refuses every kind of piece in the tower, the mount and the rocket, and lets pieces stand against them", () => {
    const r = fakeRoom();
    const pad = r.assemble("a");
    const [tx, tz] = cell(towerFoot(pad)), [mx, mz] = cell(mountFoot(pad));
    for (const type of ["wall", "floor", "ramp", "roof", "trebuchet"] as const) {
      // In the tower (at its foot and high up), under and in the mount, and in the rocket standing on it.
      for (const y of [0, 1, 20, 38]) expect(blocks(r, piece(type, tx, y, tz)), `${type} in the tower, storey ${y}`).toBe(true);
      for (const y of [0, 2, 4]) expect(blocks(r, piece(type, mx, y, mz)), `${type} in the mount, storey ${y}`).toBe(true);
      for (const y of [6, 20, 30, 36]) expect(blocks(r, piece(type, mx, y, mz)), `${type} in the rocket, storey ${y}`).toBe(true);
    }
    // Across a catch arm, 80 m up.
    expect(blocks(r, piece("wall", tx - 1, 21, tz + 3))).toBe(true);
    // A wall flat against the side of the mount, and pieces a cell clear of everything, are fine.
    expect(blocks(r, piece("wall", mx + 2, 0, mz, 1))).toBe(false);
    expect(blocks(r, piece("floor", mx + 2, 0, mz))).toBe(false);
    expect(blocks(r, piece("floor", tx + 2, 0, tz - 3))).toBe(false);
    // Over the top of the rocket is not in it (it will hit that on the way up).
    expect(blocks(r, piece("floor", mx, 39, mz))).toBe(false);
  });

  it("only what stands counts: parts not on yet block nothing, but cannot go on where something is built", () => {
    const build = new BuildState();
    const r = fakeRoom(build);
    const pad = r.assemble("a", 9);
    const [mx, mz] = cell(mountFoot(pad));
    const wall = piece("wall", mx, 0, mz);
    expect(blocks(r, wall)).toBe(false);
    build.apply({ kind: "place", piece: wall });
    r.say("a", { k: "pad-part", id: 1, n: 10 });
    expect(r.last("pad-no")).toMatchObject({ why: "crowded" });
    expect(pad.parts).not.toContain(10);
    build.apply({ kind: "remove", id: wall.id });
    r.say("a", { k: "pad-part", id: 1, n: 10 });
    expect(pad.parts).toContain(10);
    expect(blocks(r, wall)).toBe(true);
  });
});

describe("riding", () => {
  it("seats seven builders, and no visitor", () => {
    const r = crewed(["a", "b", "c", "d", "e", "f", "g"]);
    expect(r.pad.riders.filter((x) => x !== null)).toHaveLength(SEATS);
    r.standBy("h", r.pad);
    r.say("h", { k: "pad-sit", id: 1, on: true });
    expect(r.last("pad-no")).toMatchObject({ why: "busy" });
    r.say("g", { k: "pad-sit", id: 1, on: false });
    r.standBy("v", r.pad);
    r.say("v", { k: "pad-sit", id: 1, on: true });
    expect(r.last("pad-no")).toMatchObject({ why: "locked" });
    expect(r.pad.riders).not.toContain("v");
  });

  it("counts down, lifts off, sends the ship and its passengers to the other world, and catches the booster", () => {
    const r = crewed(["a", "b"]);
    r.say("b", { k: "pad-launch", to: "elsewhere" });
    expect(r.pad.count).toBeGreaterThan(0);
    expect(r.pad.flight).toBeNull();
    pass(FLIGHT.count + 0.2);
    expect(r.pad.flight).toMatchObject({ to: "elsewhere", ship: true, booster: true });
    expect(r.toWorld).toHaveLength(1);
    expect(r.toWorld[0]).toMatchObject({ to: "elsewhere", data: { k: "ship", seats: 2, trip: r.pad.flight!.trip } });
    // Nobody gets out, and nothing goes on or comes off, once it has left the ground.
    r.say("a", { k: "pad-sit", id: 1, on: false });
    expect(r.pad.riders).toContain("a");
    const trip = r.pad.flight!.trip;
    pass(FLIGHT.handoff);
    expect(r.sent.filter((s) => s.msg.k === "ship-go").map((s) => s.to).sort()).toEqual(["a", "b"]);
    expect(r.last("ship-go")).toMatchObject({ to: "elsewhere", trip });
    expect(r.pad.riders.every((x) => x === null)).toBe(true);
    expect(r.pad.parts.filter((n) => n >= 18)).toEqual([]);
    expect(r.pad.flight).toMatchObject({ ship: false, booster: true });
    r.say("a", { k: "pad-part", id: 1, n: 18 });
    expect(r.last("pad-no")).toMatchObject({ why: "away" });
    pass(CATCH - FLIGHT.handoff + 0.2);
    // Caught: the booster is back on the mount, and only the ship has to be built again.
    expect(r.pad.flight).toBeNull();
    expect(r.pad.parts.filter((n) => n >= 14)).toEqual([14, 15, 16, 17]);
    expect(r.flown).toHaveLength(0);
    for (const n of [18, 19, 20, 21]) r.say("a", { k: "pad-part", id: 1, n });
    expect(r.pad.parts).toHaveLength(PARTS);
    expect(r.pad.readyAt).toBeGreaterThan(Date.now());
  });

  it("does not launch with nobody aboard", () => {
    const r = crewed(["a"]);
    r.say("a", { k: "pad-launch", to: "elsewhere" });
    r.say("a", { k: "pad-sit", id: 1, on: false });
    pass(FLIGHT.count + 0.2);
    expect(r.pad.flight).toBeNull();
    expect(r.pad.count).toBe(0);
    expect(r.pad.parts).toHaveLength(PARTS);
  });

  it("blows away anyone standing by the mount at lift-off", () => {
    const r = crewed(["a"]);
    const foot = mountFoot(r.pad);
    r.at.set("c", [foot[0] + 10, 0.9, foot[2]]);
    r.say("a", { k: "pad-launch", to: "elsewhere" });
    pass(FLIGHT.count + 0.2);
    expect(r.flown.map((f) => f.id)).toEqual(["c"]);
    expect(r.flown[0]!.fall.land[0]).toBeGreaterThan(foot[0] + 20);
  });
});

describe("blowing up", () => {
  it("a shot that hits the rocket blows it up, and throws everyone in it a different way", () => {
    const r = crewed(["a", "b", "c"]);
    const target = middleOf(r.pad, 15);
    // (The launcher shoots straight: from 120 m off, along a line through the middle of the booster.)
    const flight = planFlight([target[0] + 120, 8, target[2]], [target[0] - 60, 8 + 1.5 * (target[1] - 8), target[2]], HERE);
    const hit = server.shotHits!(r.room, flight);
    expect(hit).not.toBeNull();
    expect(hit!.point[1]).toBeGreaterThan(SIZE.deck);
    server.struck!(r.room, hit!.point);
    expect(r.pad.parts.filter((n) => n >= 14)).toEqual([]);
    expect(r.pad.parts).toHaveLength(13);
    expect(r.last("boom")).toBeDefined();
    expect(r.flown.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    const ways = r.flown.map((f) => Math.atan2(f.fall.v[0], f.fall.v[2]));
    expect(new Set(ways.map((w) => Math.round(w * 2))).size).toBe(3);
    // They land, on the ground.
    for (const f of r.flown) expect(f.fall.land[1]).toBeCloseTo(0.9);
    expect(r.pad.riders.every((x) => x === null)).toBe(true);
  });

  it("a shot on the tower takes off what it hits and what that holds; under the rocket, the rocket goes too", () => {
    const r = crewed(["a"]);
    server.struck!(r.room, middleOf(r.pad, 13));
    expect(r.pad.parts).not.toContain(13);
    expect(r.pad.parts).toHaveLength(PARTS - 1);
    expect(r.flown).toHaveLength(0);
    const m = middleOf(r.pad, 11);
    server.struck!(r.room, m);
    // Arm A, arm B and the whole rocket.
    expect([...r.pad.parts].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.flown.map((f) => f.id)).toEqual(["a"]);
  });

  it("a rocket that hits something built in its way blows up there", () => {
    const build = new BuildState();
    const r = crewed(["a", "b"], build);
    // A floor high over the mount, put there after the site was built.
    const foot = mountFoot(r.pad);
    build.apply({ kind: "place", piece: piece("floor", Math.floor(foot[0] / 5), 60, Math.floor(foot[2] / 5)) });
    const when = inTheWay(build, r.pad)!;
    expect(when).toBeGreaterThan(FLIGHT.hold + 3);
    r.say("a", { k: "pad-launch", to: "elsewhere" });
    pass(FLIGHT.count + 0.2);
    expect(r.pad.flight).toMatchObject({ hitAt: when });
    // (The other world is not told a ship is coming that will never arrive.)
    expect(r.toWorld).toHaveLength(0);
    pass(when + 0.2);
    expect(r.pad.flight).toBeNull();
    expect(r.pad.parts.filter((n) => n >= 14)).toEqual([]);
    expect(r.flown.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(r.flown[0]!.fall.from[1]).toBeGreaterThan(150);
    expect(r.sent.some((s) => s.msg.k === "ship-go")).toBe(false);
  });

  it("the booster is lost when the arms are shot away while it is up", () => {
    const r = crewed(["a"]);
    r.say("a", { k: "pad-launch", to: "elsewhere" });
    pass(FLIGHT.count + FLIGHT.handoff + 1);
    server.struck!(r.room, middleOf(r.pad, 12));
    expect(r.pad.parts).not.toContain(12);
    expect(r.pad.parts).toContain(14);
    pass(CATCH);
    expect(r.pad.flight).toBeNull();
    expect(r.pad.parts.filter((n) => n >= 14)).toEqual([]);
    expect(r.last("boom")).toBeDefined();
  });

  it("a shot can hit the rocket in the air", () => {
    const r = crewed(["a"]);
    r.say("a", { k: "pad-launch", to: "elsewhere" });
    pass(FLIGHT.count + 6);
    // Six seconds in it has climbed about 37 m: a shot at where the booster's middle now is.
    const up = boosterPose(6).up;
    const foot = mountFoot(r.pad);
    server.struck!(r.room, [foot[0], SIZE.deck + up + 30, foot[2]]);
    expect(r.pad.flight).toBeNull();
    expect(r.flown.map((f) => f.id)).toEqual(["a"]);
    expect(r.flown[0]!.fall.from[1]).toBeGreaterThan(SIZE.deck + SIZE.booster + up);
  });
});

describe("a ship from another world", () => {
  const coming = (r: ReturnType<typeof fakeRoom>, seats = 2) => server.fromWorld!(r.room, "elsewhere", { k: "ship", trip: "t1", seats, at: Date.now() + 3000 });

  it("comes down on open ground, with the passengers who followed it, and lets them out", () => {
    const r = fakeRoom();
    expect(coming(r)).toBe(true);
    const ship = r.memory().ships[0]!;
    expect(Math.hypot(ship.x, ship.z)).toBeGreaterThan(40);
    r.say("a", { k: "ship-aboard", trip: "t1" });
    r.say("b", { k: "ship-aboard", trip: "t1" });
    r.say("c", { k: "ship-aboard", trip: "t1" });
    expect(ship.riders).toEqual(["a", "b"]);
    pass(3 + DESCENT + 0.2);
    expect(ship.down).toBe(true);
    expect(ship.riders).toEqual([]);
    expect(r.flown).toHaveLength(0);
    pass(STARSHIP.stay + 1);
    expect(r.memory().ships).toHaveLength(0);
    expect(r.last("ship-gone")).toMatchObject({ trip: "t1" });
  });

  it("blows up when shot, throwing its passengers clear", () => {
    const r = fakeRoom();
    coming(r);
    const ship = r.memory().ships[0]!;
    r.say("a", { k: "ship-aboard", trip: "t1" });
    pass(3 + 5);
    const pose = arrivalPose(5);
    server.struck!(r.room, [ship.x, pose.up + 20, ship.z]);
    expect(r.memory().ships).toHaveLength(0);
    expect(r.flown.map((f) => f.id)).toEqual(["a"]);
  });

  it("blows up when something has been built where it lands", () => {
    const build = new BuildState();
    const r = fakeRoom(build);
    coming(r);
    const ship = r.memory().ships[0]!;
    r.say("a", { k: "ship-aboard", trip: "t1" });
    build.apply({ kind: "place", piece: piece("floor", Math.floor(ship.x / 5), 0, Math.floor(ship.z / 5)) });
    pass(3 + DESCENT + 0.2);
    expect(r.memory().ships).toHaveLength(0);
    expect(r.flown.map((f) => f.id)).toEqual(["a"]);
  });

  it("is given somewhere clear of what is built and of launch sites", () => {
    const build = new BuildState();
    for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) build.apply({ kind: "place", piece: piece("floor", x, 0, z) });
    const spot = landingSpot(build, [], [], 0);
    expect(Math.max(Math.abs(spot.x), Math.abs(spot.z))).toBeGreaterThan(155);
  });
});
