import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { CELL, LEVEL } from "../../game/constants";
import { fallPhase, fallPosition, type Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { planFlight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { cannotPlace, feetOf, fits, joinsOf, kindOf, middleOf, operational, partAt, PARTS, RAILGUN, seatOf, type Gun, type GunToPage } from "./railgunRules";
import { inTheWay, rideFlight } from "./railguns";
import { server } from "./server";
import { world as MOON } from "./world";

const piece = (type: Piece["type"], x: number, y: number, z: number, rot: Piece["rot"] = 0): Piece => ({ id: `${type}${x},${y},${z},${rot}`, type, x, y, z, rot, material: "wood", edit: 0 });
const put = (build: BuildState, p: Piece) => expect(build.apply({ kind: "place", piece: p }), p.id).not.toBeNull();

/** The pillars and floors that hold up a gun's rising end: a floor under the low end of rails 19 and 20 and under the muzzle. */
function scaffold(build: BuildState, gun: Pick<Gun, "x" | "y" | "z" | "dir">): Piece[] {
  const floors: Piece[] = [];
  for (const n of [19, 20, 21]) {
    const f = feetOf(gun, n)[0]!;
    for (let y = 0; y < f.y; y++) if (!build.get(piece("wall", f.x, y, f.z).id)) put(build, piece("wall", f.x, y, f.z));
    const floor = piece("floor", f.x, f.y, f.z);
    put(build, floor);
    floors.push(floor);
  }
  return floors;
}

/** A room on the Moon with builders in it, recording what its server half does, and keeping what it saves. */
function fakeRoom(build = new BuildState(), saved = new Map<string, unknown>()) {
  const sent: { to: string; msg: GunToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const at = new Map<string, Vec>([["a", [0, 0.9, 0]], ["b", [0, 0.9, 0]], ["v", [0, 0.9, 0]]]);
  const room: Room = {
    env: MOON,
    build,
    memory: undefined,
    players: () => [...at.keys()],
    positionOf: (id) => at.get(id) ?? null,
    isDown: () => false,
    send: (to, msg) => void sent.push({ to, msg: msg as GunToPage }),
    broadcast: (msg) => void sent.push({ to: "all", msg: msg as GunToPage }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: () => {},
    // "v" is visiting: no Full Game.
    mayBuild: (id) => id !== "v",
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
  };
  room.memory = server.open!(room);
  const guns = () => (room.memory as { guns: { list: Gun[] } }).guns.list;
  const say = (id: string, msg: unknown) => server.message!(room, id, msg);
  /** Stands a builder by part `n` of a gun. */
  const by = (id: string, gun: Pick<Gun, "x" | "y" | "z" | "dir">, n: number) => { const m = middleOf(gun, n); at.set(id, [m[0] + 2, m[1], m[2]]); };
  /** Builder `id` puts every part on gun 1 that is not on yet, in an order that always joins. */
  const assemble = (id: string, skip: number[] = []) => {
    const gun = guns()[0]!;
    for (const n of [2, 3, 4, 22, ...Array.from({ length: 17 }, (_, i) => 5 + i)]) {
      if (gun.parts.includes(n) || skip.includes(n)) continue;
      by(id, gun, n);
      say(id, { k: "gun-part", id: gun.id, n });
    }
  };
  const last = () => sent.at(-1)!.msg;
  return { room, sent, flown, at, guns, say, by, assemble, last, saved, gunKind: (k: GunToPage["k"]) => sent.filter((m) => m.msg.k === k) };
}
const BASE = { x: 2, y: 0, z: 2, dir: 0 };
const start = (t: ReturnType<typeof fakeRoom>, base = BASE) => { t.by("a", { ...base }, 1); t.say("a", { k: "gun-new", ...base }); return t.guns().at(-1)!; };

describe("a rail gun's kit", () => {
  it("is 22 numbered parts: a base, a breech, two capacitor banks, sixteen rail segments, a muzzle and a capsule", () => {
    expect(PARTS).toBe(22);
    const kinds = Array.from({ length: PARTS }, (_, i) => kindOf(i + 1));
    expect(kinds.filter((k) => k === "rail").length + kinds.filter((k) => k === "rise").length).toBe(16);
    expect(kinds.filter((k) => k === "capacitor").length).toBe(2);
    expect([kinds[0], kinds[1], kinds[20], kinds[21]]).toEqual(["base", "breech", "muzzle", "capsule"]);
  });

  it("lays out long, low and slender: 160 m of rail in a straight line, level and then rising gently", () => {
    const gun = { x: 0, y: 0, z: 0, dir: 1 };
    const rail = Array.from({ length: 16 }, (_, i) => feetOf(gun, 5 + i)).flat();
    expect(rail.length * CELL).toBe(160);
    // One cell wide, every cell the next one along.
    expect(rail.every((f) => f.z === 0)).toBe(true);
    expect(rail.map((f) => f.x)).toEqual(Array.from({ length: 32 }, (_, i) => 2 + i));
    // Thirteen segments on the level, three stepping up a storey each, the muzzle on top: 11 m up over the last 30 m (about 20 degrees).
    expect(rail.slice(0, 26).every((f) => f.y === 0)).toBe(true);
    expect([18, 19, 20, 21].map((n) => feetOf(gun, n)[0]!.y)).toEqual([0, 1, 2, 3]);
    expect((Math.atan2(3 * LEVEL, 6 * CELL) * 180) / Math.PI).toBeCloseTo(20.6, 0);
    // The capacitor banks sit either side of the breech, the capsule on it.
    expect([3, 4].map((n) => feetOf(gun, n)[0]!.z).sort()).toEqual([-1, 1]);
    expect(feetOf(gun, 22)).toEqual(feetOf(gun, 2));
  });

  it("points any of four ways, and only goes where the whole of it fits", () => {
    for (let dir = 0; dir < 4; dir++) {
      const end = feetOf({ x: 0, y: 0, z: 0, dir }, 21)[0]!;
      expect(Math.abs(end.x) + Math.abs(end.z)).toBe(34);
      expect(fits({ x: 0, y: 0, z: 0, dir })).toBe(true);
    }
    // Too near the edge to run its length that way; fine the other way.
    expect(fits({ x: 30, y: 0, z: 0, dir: 1 })).toBe(false);
    expect(fits({ x: 30, y: 0, z: 0, dir: 3 })).toBe(true);
  });

  it("joins up: every part can be reached from the base, each through one already on", () => {
    const on = new Set([1]);
    for (let grew = true; grew; ) {
      grew = false;
      for (let n = 2; n <= PARTS; n++) if (!on.has(n) && joinsOf(n).some((m) => on.has(m))) { on.add(n); grew = true; }
    }
    expect(on.size).toBe(PARTS);
  });
});

describe("building a rail gun", () => {
  it("starts with a base on open ground, pointing the way it is laid; visitors cannot", () => {
    const t = fakeRoom();
    t.by("v", BASE, 1);
    t.say("v", { k: "gun-new", ...BASE });
    expect(t.last()).toEqual({ k: "gun-no", why: "locked" });
    const gun = start(t);
    expect(gun).toMatchObject({ ...BASE, parts: [1], readyAt: 0 });
    expect(t.last()).toMatchObject({ k: "gun", gun: { id: gun.id, parts: [1] } });
    // Not from far away, not off the edge, not on top of another gun.
    t.at.set("a", [200, 0.9, 200]);
    t.say("a", { k: "gun-new", x: 10, y: 0, z: 10, dir: 0 });
    expect(t.last()).toEqual({ k: "gun-no", why: "far" });
    t.by("a", { x: 30, y: 0, z: 0, dir: 1 }, 1);
    t.say("a", { k: "gun-new", x: 30, y: 0, z: 0, dir: 1 });
    expect(t.last()).toEqual({ k: "gun-no", why: "room" });
    t.by("a", { x: 2, y: 0, z: 10, dir: 0 }, 1);
    t.say("a", { k: "gun-new", x: 2, y: 0, z: 10, dir: 0 });
    expect(t.last()).toEqual({ k: "gun-no", why: "overlap" });
    expect(t.guns().length).toBe(1);
  });

  it("any number of them, side by side", () => {
    const t = fakeRoom();
    for (let i = 0; i < 5; i++) start(t, { x: -20 + i * 4, y: 0, z: -10, dir: 0 });
    expect(t.guns().length).toBe(5);
    expect(new Set(t.guns().map((g) => g.id)).size).toBe(5);
  });

  it("takes parts in any order that joins on, from close by", () => {
    const t = fakeRoom();
    const gun = start(t);
    // Rail 3 has nothing to join to yet; the breech does.
    t.by("a", gun, 7);
    t.say("a", { k: "gun-part", id: gun.id, n: 7 });
    expect(t.last()).toEqual({ k: "gun-no", why: "join" });
    t.by("a", gun, 2);
    t.say("a", { k: "gun-part", id: gun.id, n: 2 });
    t.say("a", { k: "gun-part", id: gun.id, n: 2 });
    expect(t.last()).toEqual({ k: "gun-no", why: "have" });
    // Two builders at once, on different ends of what is there.
    t.by("b", gun, 22);
    t.say("b", { k: "gun-part", id: gun.id, n: 22 });
    t.by("a", gun, 5);
    t.say("a", { k: "gun-part", id: gun.id, n: 5 });
    expect([...gun.parts].sort((x, y) => x - y)).toEqual([1, 2, 5, 22]);
    // From the other end of the Moon: no.
    t.at.set("a", [-200, 0.9, -200]);
    t.say("a", { k: "gun-part", id: gun.id, n: 6 });
    expect(t.last()).toEqual({ k: "gun-no", why: "far" });
    // Nonsense is ignored.
    t.say("a", { k: "gun-part", id: gun.id, n: 99 });
    t.say("a", { k: "gun-part", id: 12345, n: 3 });
    t.say("a", null);
    expect(gun.parts.length).toBe(4);
  });

  it("needs the rising end held up: a floor under rails 15 and 16 and the muzzle, built from ordinary pieces", () => {
    const build = new BuildState();
    const t = fakeRoom(build);
    const gun = start(t);
    t.assemble("a");
    // Everything on the ground went on; the three parts in the air did not.
    expect([...gun.parts].sort((x, y) => x - y)).toEqual([...Array.from({ length: 18 }, (_, i) => i + 1), 22]);
    expect(cannotPlace(build, gun, 19)).toBe("under");
    scaffold(build, gun);
    t.assemble("a");
    expect(gun.parts.length).toBe(PARTS);
    expect(operational(build, gun)).toBe(true);
  });

  it("cannot go where something is built in the way, and stops working if something is built over it later", () => {
    const build = new BuildState();
    const t = fakeRoom(build);
    const gun = start(t);
    const spot = feetOf(gun, 6)[1]!;
    put(build, piece("floor", spot.x, 0, spot.z));
    put(build, piece("ramp", spot.x, 0, spot.z));
    t.assemble("a", [19, 20, 21]);
    expect(gun.parts.includes(6)).toBe(false);
    expect(cannotPlace(build, gun, 6)).toBe("crowded");
    build.apply({ kind: "remove", id: piece("ramp", spot.x, 0, spot.z).id });
    scaffold(build, gun);
    t.assemble("a");
    expect(operational(build, gun)).toBe(true);
    // A rival builds a dome on the rail: every part is still there, but it will not work until that is cleared.
    const jam = feetOf(gun, 10)[0]!;
    put(build, piece("floor", jam.x, 0, jam.z));
    put(build, piece("roof", jam.x, 0, jam.z));
    expect(gun.parts.length).toBe(PARTS);
    expect(operational(build, gun)).toBe(false);
  });

  it("powers up when the last part goes on: it charges for half a minute", () => {
    const build = new BuildState();
    const t = fakeRoom(build);
    const gun = start(t);
    scaffold(build, gun);
    const before = Date.now();
    t.assemble("a");
    expect(gun.readyAt).toBeGreaterThanOrEqual(before + RAILGUN.charge * 1000);
    expect(gun.readyAt).toBeLessThanOrEqual(Date.now() + RAILGUN.charge * 1000);
  });

  it("is kept when the Moon goes quiet, and found again as it was", () => {
    const build = new BuildState();
    const saved = new Map<string, unknown>();
    const t = fakeRoom(build, saved);
    const gun = start(t);
    t.assemble("a", [19, 20, 21]);
    start(t, { x: 0, y: 0, z: -20, dir: 3 });
    const again = fakeRoom(build, saved);
    expect(again.guns().map((g) => ({ ...g, rider: null }))).toEqual(t.guns().map((g) => ({ ...g, rider: null })));
    expect(again.guns()[0]!.parts.length).toBe(gun.parts.length);
    // A new one after that gets a number nobody has had.
    const next = start(again, { x: 20, y: 0, z: -20, dir: 0 });
    expect(t.guns().some((g) => g.id === next.id)).toBe(false);
    // Whoever arrives is sent them all.
    server.joined!(again.room, "b");
    expect(again.gunKind("guns").at(-1)!.msg).toMatchObject({ k: "guns", list: [{ id: 1 }, { id: 2 }, { id: next.id }] });
  });

  it("clears itself away if nobody adds to it for a day; a finished one stays", () => {
    const build = new BuildState();
    const saved = new Map<string, unknown>();
    const t = fakeRoom(build, saved);
    const whole = start(t);
    scaffold(build, whole);
    t.assemble("a");
    start(t, { x: 0, y: 0, z: -20, dir: 3 });
    const stale = saved.get("railguns") as { list: { touched: number }[] };
    for (const g of stale.list) g.touched = Date.now() - RAILGUN.abandonedAfter - 1000;
    const later = fakeRoom(build, saved);
    expect(later.guns().map((g) => g.id)).toEqual([whole.id]);
  });
});

describe("a rail gun under fire", () => {
  const whole = () => {
    const build = new BuildState();
    const t = fakeRoom(build);
    const gun = start(t);
    const floors = scaffold(build, gun);
    t.assemble("a");
    return { build, t, gun, floors };
  };

  it("loses the parts a shot lands beside, and has to charge again once they are back on", () => {
    const { t, gun, build } = whole();
    const at = middleOf(gun, 9);
    server.struck!(t.room, [at[0], 0, at[2]]);
    expect(gun.parts.includes(9)).toBe(false);
    // The ones a little way along are untouched.
    expect(gun.parts.includes(12)).toBe(true);
    expect(gun.readyAt).toBe(0);
    expect(operational(build, gun)).toBe(false);
    const told = t.last() as Extract<GunToPage, { k: "gun" }>;
    expect(told.knocked).toContain(9);
    t.assemble("a");
    expect(gun.parts.length).toBe(PARTS);
    expect(gun.readyAt).toBeGreaterThan(Date.now() + (RAILGUN.charge - 1) * 1000);
  });

  it("stops a shot aimed at it, so the rock lands on the part and not far behind", () => {
    const { t, gun } = whole();
    const at = middleOf(gun, 8);
    const flight = planFlight([at[0] + 120, 7, at[2]], at, MOON);
    const hit = server.shotHits!(t.room, flight)!;
    expect(Math.hypot(hit.point[0] - at[0], hit.point[1] - at[1], hit.point[2] - at[2])).toBeLessThanOrEqual(RAILGUN.hitSize + 1e-6);
    // A shot along its side, 40 m off, hits nothing of it.
    expect(server.shotHits!(t.room, planFlight([at[0] + 40, 7, at[2] + 120], [at[0] + 40, 0, at[2]], MOON))).toBeNull();
  });

  it("drops the parts whose floor is taken away", () => {
    const { t, gun, build, floors } = whole();
    build.apply({ kind: "remove", id: floors[2]!.id });
    server.removed!(t.room, [floors[2]!]);
    expect(gun.parts.includes(21)).toBe(false);
    expect(gun.parts.includes(20)).toBe(true);
    expect(gun.parts.length).toBe(PARTS - 1);
  });

  it("throws whoever sits in its capsule up into space, flailing, when any part of it is hit, however far along", () => {
    const { t, gun } = whole();
    const seat = seatOf(gun);
    t.at.set("b", [seat.x + 2, seat.y, seat.z]);
    t.say("b", { k: "gun-sit", id: gun.id, on: true });
    expect(gun.rider).toBe("b");
    // A shot on the muzzle, 165 m from the capsule.
    server.struck!(t.room, middleOf(gun, 21));
    expect(gun.parts.includes(21)).toBe(false);
    expect(gun.rider).toBeNull();
    expect(t.flown.length).toBe(1);
    expect(t.flown[0]!.id).toBe("b");
    const thrown = t.flown[0]!.fall;
    // Tumbling up from the seat, far above the Moon, then back on their rockets: as anyone hit on the Moon.
    expect(fallPhase(thrown, 1)).toBe("tumble");
    expect(thrown.from[1]).toBeCloseTo(seat.y + 0.6, 6);
    expect(Math.max(...thrown.path.map((p) => p[1]))).toBeGreaterThan(150);
    expect(thrown.glideFrom).toBeGreaterThan(1);
    // A shot that hits no part of it throws nobody.
    t.say("a", { k: "gun-sit", id: gun.id, on: true });
    t.by("a", gun, 22);
    t.say("a", { k: "gun-sit", id: gun.id, on: true });
    server.struck!(t.room, [middleOf(gun, 10)[0] + 60, 0, middleOf(gun, 10)[2]]);
    expect(t.flown.length).toBe(1);
  });

  it("throws a rider who is still running down the rail when it is hit; one already off the muzzle finishes their flight", () => {
    const { t, gun } = whole();
    const seat = seatOf(gun);
    t.at.set("b", [seat.x + 2, seat.y, seat.z]);
    t.say("b", { k: "gun-sit", id: gun.id, on: true });
    gun.readyAt = Date.now() - 1;
    t.say("b", { k: "gun-launch" });
    expect(t.flown.length).toBe(1);
    // Hit at once: they are on the rail still.
    server.struck!(t.room, middleOf(gun, 12));
    expect(t.flown.length).toBe(2);
    expect(t.flown[1]!.id).toBe("b");
    expect(fallPhase(t.flown[1]!.fall, 1)).toBe("tumble");
    // Put back together, fired again, and hit only after they have left the muzzle: nothing more happens to them.
    t.assemble("a");
    t.at.set("b", [seat.x + 2, seat.y, seat.z]);
    t.say("b", { k: "gun-sit", id: gun.id, on: true });
    gun.readyAt = Date.now() - 1;
    t.say("b", { k: "gun-launch" });
    expect(t.flown.length).toBe(3);
    const running = (t.room.memory as { guns: { onRail: Map<number, { by: string; at: number }> } }).guns.onRail.get(gun.id)!;
    running.at -= (RAILGUN.rideRail + 0.5) * 1000;
    server.struck!(t.room, middleOf(gun, 12));
    expect(gun.parts.includes(12)).toBe(false);
    expect(t.flown.length).toBe(3);
  });

  it("gives up a part to the Remove tool: any builder, from close by, and it no longer works", () => {
    const { t, gun, build } = whole();
    // A visitor cannot, nor anyone from far away.
    t.by("v", gun, 10);
    t.say("v", { k: "gun-take", id: gun.id, n: 10 });
    expect(t.last()).toEqual({ k: "gun-no", why: "locked" });
    t.at.set("b", [-200, 0.9, -200]);
    t.say("b", { k: "gun-take", id: gun.id, n: 10 });
    expect(t.last()).toEqual({ k: "gun-no", why: "far" });
    expect(gun.parts.length).toBe(PARTS);
    // Another builder (not the one who built it) walks up and takes rail 6 off.
    t.by("b", gun, 10);
    t.say("b", { k: "gun-take", id: gun.id, n: 10 });
    expect(gun.parts.includes(10)).toBe(false);
    expect(gun.parts.length).toBe(PARTS - 1);
    expect(gun.readyAt).toBe(0);
    expect(operational(build, gun)).toBe(false);
    expect((t.last() as Extract<GunToPage, { k: "gun" }>).knocked).toEqual([10]);
    // A part that is not there, or nonsense, changes nothing.
    t.say("b", { k: "gun-take", id: gun.id, n: 10 });
    t.say("b", { k: "gun-take", id: gun.id, n: "ten" });
    expect(gun.parts.length).toBe(PARTS - 1);
  });

  it("knows which part is where: by the cell a spot is in, the capsule above the breech", () => {
    const gun: Gun = { id: 1, x: 0, y: 0, z: 0, dir: 1, parts: Array.from({ length: PARTS }, (_, i) => i + 1), touched: 0, readyAt: 0, rider: null };
    expect(partAt(gun, 2.5, 0.5, 2.5)).toBe(1);
    expect(partAt(gun, 7.5, 0.6, 2.5)).toBe(2);
    expect(partAt(gun, 7.5, 2.4, 2.5)).toBe(22);
    expect(partAt(gun, 7.5, 1.5, 7.5)).toBe(3);
    expect(partAt(gun, 7.5, 1.5, -2.5)).toBe(4);
    // Both cells of a rail segment are that segment.
    expect(partAt(gun, 12.5, 0.7, 2.5)).toBe(5);
    expect(partAt(gun, 17.5, 0.7, 2.5)).toBe(5);
    expect(partAt(gun, 22.5, 0.7, 2.5)).toBe(6);
    expect(partAt(gun, 172.5, 12, 2.5)).toBe(21);
    // Off the gun, nothing; and nothing where a part has come off.
    expect(partAt(gun, 22.5, 0.7, 12.5)).toBeNull();
    expect(partAt({ ...gun, parts: gun.parts.filter((n) => n !== 6) }, 22.5, 0.7, 2.5)).toBeNull();
  });

  it("is gone when its last part is", () => {
    const t = fakeRoom();
    const gun = start(t);
    server.struck!(t.room, middleOf(gun, 1));
    expect(t.guns().length).toBe(0);
    expect(t.last()).toEqual({ k: "gun-gone", id: gun.id });
  });
});

describe("riding a rail gun", () => {
  const ready = () => {
    const build = new BuildState();
    const t = fakeRoom(build);
    const gun = start(t);
    scaffold(build, gun);
    t.assemble("a");
    return { build, t, gun };
  };
  const sit = (t: ReturnType<typeof fakeRoom>, id: string, gun: Gun) => { const s = seatOf(gun); t.at.set(id, [s.x + 2, s.y, s.z]); t.say(id, { k: "gun-sit", id: gun.id, on: true }); };

  it("one at a time in the capsule, from beside it; not visitors (riding comes with the Full Game)", () => {
    const { t, gun } = ready();
    sit(t, "v", gun);
    expect(t.last()).toEqual({ k: "gun-no", why: "locked" });
    expect(gun.rider).toBeNull();
    t.at.set("a", [-150, 0.9, -150]);
    t.say("a", { k: "gun-sit", id: gun.id, on: true });
    expect(t.last()).toEqual({ k: "gun-no", why: "far" });
    sit(t, "a", gun);
    expect(gun.rider).toBe("a");
    sit(t, "b", gun);
    expect(t.last()).toEqual({ k: "gun-no", why: "busy" });
    t.say("a", { k: "gun-sit", id: gun.id, on: false });
    expect(gun.rider).toBeNull();
    sit(t, "b", gun);
    expect(gun.rider).toBe("b");
    // Leaving the Moon, or being thrown, empties the seat.
    server.left!(t.room, "b");
    expect(gun.rider).toBeNull();
  });

  it("keeps whoever is in the capsule while the Moon's room sleeps (everyone sitting still), and can still fire when it wakes", () => {
    const build = new BuildState();
    const saved = new Map<string, unknown>();
    const t = fakeRoom(build, saved);
    const gun = start(t);
    scaffold(build, gun);
    t.assemble("a");
    sit(t, "a", gun);
    const woke = fakeRoom(build, saved);
    const again = woke.guns()[0]!;
    expect(again.rider).toBe("a");
    again.readyAt = Date.now() - 1;
    woke.say("a", { k: "gun-launch" });
    expect(woke.flown.length).toBe(1);
  });

  it("will not fire until it has charged, or while it is broken or blocked", () => {
    const { t, gun, build } = ready();
    sit(t, "a", gun);
    t.say("a", { k: "gun-launch" });
    expect(t.last()).toEqual({ k: "gun-no", why: "charging" });
    gun.readyAt = Date.now() - 1;
    const jam = feetOf(gun, 10)[0]!;
    put(build, piece("floor", jam.x, 0, jam.z));
    put(build, piece("roof", jam.x, 0, jam.z));
    t.say("a", { k: "gun-launch" });
    expect(t.last()).toEqual({ k: "gun-no", why: "broken" });
    expect(t.flown.length).toBe(0);
    // Someone not in the capsule cannot fire it at all.
    t.say("b", { k: "gun-launch" });
    expect(t.flown.length).toBe(0);
  });

  it("fires with one builder: down the rail and very high above the Moon, where it lets them go to fly down themselves", () => {
    const { t, gun } = ready();
    sit(t, "a", gun);
    gun.readyAt = Date.now() - 1;
    t.say("a", { k: "gun-launch" });
    expect(t.gunKind("gun-fire").length).toBe(1);
    expect(t.flown.length).toBe(1);
    expect(gun.rider).toBeNull();
    const ride = t.flown[0]!.fall;
    const total = RAILGUN.rideRail + RAILGUN.rideClimb;
    expect(ride.time).toBeCloseTo(total, 6);
    expect(ride.path.length).toBe(Math.round(total * 10) + 1);
    // On their rockets all the way up: no tumbling.
    expect(fallPhase(ride, 0.5)).toBe("glide");
    expect(fallPhase(ride, total + 0.01)).toBe("done");
    // Faster and faster down the rail (it points along +z), to the muzzle three storeys up.
    const half = fallPosition(ride, RAILGUN.rideRail / 2), end = fallPosition(ride, RAILGUN.rideRail);
    expect(half[2] - ride.from[2]).toBeLessThan((end[2] - ride.from[2]) * 0.35);
    expect(end[2] - ride.from[2]).toBeCloseTo(33.5 * CELL, 0);
    expect(end[1] - ride.from[1]).toBeCloseTo(3 * LEVEL, 0);
    // Then up, always up, to 650 m above the gun and up to 200 m on the way it points, slowing as it gets there.
    for (let k = 1; k <= 40; k++) expect(fallPosition(ride, RAILGUN.rideRail + (k / 40) * RAILGUN.rideClimb)[1]).toBeGreaterThanOrEqual(fallPosition(ride, RAILGUN.rideRail + ((k - 1) / 40) * RAILGUN.rideClimb)[1]);
    expect(ride.land[1]).toBeCloseTo(RAILGUN.launchUp, 6);
    // (This gun points at the edge from 55 m short of it: it goes on that far, not the whole 200 m.)
    expect(ride.land[2]).toBeCloseTo(Math.min(end[2] + RAILGUN.launchOut, 238), 0);
    expect(ride.land[0]).toBeCloseTo(ride.from[0], 6);
    const late = fallPosition(ride, total - 0.5), earlier = fallPosition(ride, total - 1);
    expect(ride.land[1] - late[1]).toBeLessThan(late[1] - earlier[1]);
    // It ends in the air on purpose: the server does not bring them down from there.
    expect(ride.aloft).toBe(true);
    // And the gun has to charge again before the next.
    expect(gun.readyAt).toBeGreaterThan(Date.now() + (RAILGUN.charge - 1) * 1000);
  });

  it("never throws its rider out past the edge of the Moon", () => {
    const near: Gun = { id: 1, x: 10, y: 0, z: 0, dir: 1, parts: [], touched: 0, readyAt: 0, rider: null };
    const ride = rideFlight(new BuildState(), MOON, near);
    for (const p of ride.path) expect(Math.abs(p[0])).toBeLessThanOrEqual(240);
  });

  it("stops a rider at anything built in the way of the launch, and throws them up from it, flailing", () => {
    const { t, gun, build } = ready();
    const ride = rideFlight(build, MOON, gun);
    expect(inTheWay(build, MOON, ride, gun)).toBeNull();
    // A wall across the way, just beyond the muzzle, as high as the path is there (it climbs steeply).
    const top = fallPosition(ride, RAILGUN.rideRail);
    const cx = Math.floor(top[0] / CELL), cz = Math.floor(top[2] / CELL) + 1;
    // (How high the rider is when they cross that line, 5 m on from the muzzle.)
    const crossing = top[1] + ((cz * CELL - top[2]) / (ride.land[2] - top[2])) * (ride.land[1] - top[1]);
    for (let y = 0; y <= Math.floor(crossing / LEVEL) + 2; y++) put(build, piece("wall", cx, y, cz, 0));
    const hit = inTheWay(build, MOON, ride, gun)!;
    expect(hit.time).toBeGreaterThan(RAILGUN.rideRail);
    expect(hit.time).toBeLessThan(RAILGUN.rideRail + 0.5);
    expect(Math.abs(hit.point[2] - cz * CELL)).toBeLessThanOrEqual(0.8);
    // Fired: the flight ends there (not 650 m up), and a moment later they are thrown up from that spot.
    const later: (() => void)[] = [];
    t.room.later = (_ms, fn) => void later.push(fn);
    sit(t, "a", gun);
    gun.readyAt = Date.now() - 1;
    t.say("a", { k: "gun-launch" });
    expect(t.flown.length).toBe(1);
    const cut = t.flown[0]!.fall;
    expect(cut.time).toBeCloseTo(hit.time, 6);
    expect(cut.land).toEqual(hit.point);
    expect(Math.max(...cut.path.map((p) => p[1]))).toBeLessThan(crossing + 1);
    t.room.isDown = () => true;
    later.forEach((fn) => fn());
    expect(t.flown.length).toBe(2);
    expect(t.flown[1]!.fall.from).toEqual(hit.point);
    expect(fallPhase(t.flown[1]!.fall, 0.5)).toBe("tumble");
  });

  it("is not stopped by what holds its own rising end up", () => {
    const { gun, build } = ready();
    expect(inTheWay(build, MOON, rideFlight(build, MOON, gun), gun)).toBeNull();
  });

  it("charges sooner next time with builders standing by the capacitor banks", () => {
    const { t, gun } = ready();
    // (Anyone standing there helps, visitors too.)
    t.by("b", gun, 3);
    t.at.set("v", [...middleOf(gun, 4)] as Vec);
    sit(t, "a", gun);
    gun.readyAt = Date.now() - 1;
    t.say("a", { k: "gun-launch" });
    const wait = (gun.readyAt - Date.now()) / 1000;
    expect(wait).toBeLessThanOrEqual(RAILGUN.charge - 2 * RAILGUN.chargeHelp);
    expect(wait).toBeGreaterThan(RAILGUN.charge - 2 * RAILGUN.chargeHelp - 1);
  });

});
