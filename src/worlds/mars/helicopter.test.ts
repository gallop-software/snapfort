import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { planFall } from "../../game/fall";
import { planFlight, throwVelocity, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { ceilingIn, climbIn, enduranceIn, HELI, HELI_COUNT, homes, readPose, seatOf, speedIn, type HeliPose, type HeliToPage } from "./helicopterRules";
import { server } from "./server";
import { world as MARS } from "./world";

type Heli = { id: number; pose: HeliPose; riders: [string | null, string | null]; home: boolean; charge: number; lostUntil: number; touched: number };

function fakeRoom(build = new BuildState(), saved = new Map<string, unknown>(), here: string[] = ["a", "b", "c"]) {
  const sent: { to: string; msg: HeliToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  const at = new Map<string, Vec>(here.map((id) => [id, [0, 0.9, 0]]));
  const room: Room = {
    env: MARS,
    build,
    memory: undefined,
    positionOf: (id) => at.get(id) ?? null,
    isDown: () => false,
    send: (to, msg) => void sent.push({ to, msg: msg as HeliToPage }),
    broadcast: (msg, except) => void sent.push({ to: `all${except ? ` but ${except}` : ""}`, msg: msg as HeliToPage }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: (ms, fn) => void timers.push({ ms, fn }),
    players: () => [...at.keys()],
    mayBuild: () => true,
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
    worlds: () => [],
    toWorld: async () => undefined,
  };
  room.memory = server.open!(room);
  const helis = () => (room.memory as { heli: { helis: Heli[] } }).heli.helis;
  const tick = () => timers.splice(0).forEach((t) => t.fn());
  const stand = (id: string, pose: HeliPose) => at.set(id, [pose[0] + 2, pose[1] + 0.9, pose[2]]);
  const say = (id: string, msg: unknown) => server.message!(room, id, msg);
  /** Flies a helicopter to a pose in steps the server believes. */
  const flyTo = (id: string, heli: number, to: HeliPose) => {
    const from = [...helis()[heli]!.pose] as HeliPose;
    for (let i = 1; i <= 40; i++) {
      helis()[heli]!.touched -= 1000;
      say(id, { k: "heli-fly", pose: from.map((v, j) => v + (to[j]! - v) * (i / 40)), charge: 0.5 });
    }
  };
  const heliMsgs = () => sent.filter((m) => typeof m.msg.k === "string" && m.msg.k.startsWith("heli-"));
  return { room, sent, flown, tick, at, helis, stand, say, flyTo, saved, last: () => heliMsgs().at(-1)!.msg };
}

describe("Mars helicopters", () => {
  it("fly a little on red Mars and far better in thick air: faster, higher, longer", () => {
    expect(ceilingIn(0)).toBeLessThan(60);
    expect(ceilingIn(1)).toBeGreaterThan(300);
    expect(enduranceIn(0)).toBeLessThan(60);
    expect(enduranceIn(1)).toBeGreaterThan(enduranceIn(0) * 3);
    expect(speedIn(1)).toBeGreaterThan(speedIn(0) * 2);
    expect(climbIn(1)).toBeGreaterThan(climbIn(0));
    // Their rotors are very long, as thin air needs.
    expect(HELI.rotor).toBeGreaterThanOrEqual(12);
  });

  it("stand on three pads near where builders arrive, each on open ground of its own", () => {
    const build = new BuildState();
    const free = homes(build);
    expect(free.length).toBe(HELI_COUNT);
    expect(new Set(free.map((p) => `${p[0]},${p[2]}`)).size).toBe(HELI_COUNT);
    for (const p of free) expect(Math.hypot(p[0] - 2.5, p[2] + 7.5)).toBeLessThan(45);
    const cx = Math.floor(free[0]![0] / 5), cz = Math.floor(free[0]![2] / 5);
    build.apply({ kind: "place", piece: { id: "f", type: "floor", x: cx, y: 0, z: cz, rot: 0, material: "wood", edit: 0 } });
    expect(`${homes(build)[0]![0]},${homes(build)[0]![2]}`).not.toBe(`${free[0]![0]},${free[0]![2]}`);
  });

  it("seat a pilot on the left and a passenger on the right, side by side, facing the way it points", () => {
    const pose: HeliPose = [10, 5, 20, 0, 0, 0];
    const pilot = seatOf(pose, 0), passenger = seatOf(pose, 1);
    expect(pilot.x).toBeLessThan(10);
    expect(passenger.x).toBeGreaterThan(10);
    expect(pilot.z).toBeCloseTo(passenger.z, 6);
    expect(pilot.y).toBeGreaterThan(5);
    expect(readPose([0, 0, 0, 0, 0])).toBeNull();
    expect(readPose([0, 900, 0, 0, 0, 0])).toBeNull();
  });

  it("are sent to whoever joins; the first in flies it and the second rides; no third", () => {
    const t = fakeRoom();
    server.joined!(t.room, "a");
    expect(t.last().k).toBe("heli-all");
    const pose = t.helis()[1]!.pose;
    t.at.set("a", [pose[0] + 40, 0.9, pose[2]]);
    t.say("a", { k: "heli-board", id: 1 });
    expect(t.last()).toEqual({ k: "heli-no", why: "far" });
    t.stand("a", pose);
    t.say("a", { k: "heli-board", id: 1 });
    expect(t.helis()[1]!.riders).toEqual(["a", null]);
    t.stand("b", pose);
    t.say("b", { k: "heli-board", id: 1 });
    expect(t.helis()[1]!.riders).toEqual(["a", "b"]);
    expect(t.last()).toMatchObject({ k: "heli-riders", id: 1, riders: ["a", "b"] });
    t.stand("c", pose);
    t.say("c", { k: "heli-board", id: 1 });
    expect(t.last()).toEqual({ k: "heli-no", why: "full" });
    // Only the pilot's word moves it.
    const there = [...pose] as HeliPose;
    t.say("b", { k: "heli-fly", pose: [pose[0] + 1, 2, pose[2], 0, 0, 0], charge: 1 });
    expect(t.helis()[1]!.pose).toEqual(there);
  });

  it("go where their pilot says, within what one can do, and everyone else is told", () => {
    const t = fakeRoom();
    const start = t.helis()[0]!.pose;
    t.stand("a", start);
    t.say("a", { k: "heli-board", id: 0 });
    t.sent.length = 0;
    const next: HeliPose = [start[0] + 2, 3, start[2] + 1, 0.5, 0.1, 0];
    t.say("a", { k: "heli-fly", pose: next, charge: 0.9 });
    expect(t.helis()[0]!.pose).toEqual(next);
    expect(t.helis()[0]!.charge).toBe(0.9);
    t.tick();
    expect(t.sent).toEqual([{ to: "all but a", msg: { k: "heli-poses", list: [[0, next]] } }]);
    // Across the canyon in one step: not believed. Nor a battery that fills itself in the air.
    t.say("a", { k: "heli-fly", pose: [start[0] + 220, 3, start[2], 0, 0, 0], charge: 0.9 });
    expect(t.helis()[0]!.pose).toEqual(next);
    t.say("a", { k: "heli-fly", pose: next, charge: 1 });
    expect(t.helis()[0]!.charge).toBeLessThan(0.95);
    for (const junk of [null, { k: "heli-fly", pose: "there" }, { k: "heli-fly", pose: [NaN, 0, 0, 0, 0, 0] }, { k: "heli-board", id: "x" }]) t.say("a", junk);
    expect(t.helis()[0]!.pose).toEqual(next);
  });

  it("stand where they are set down; on the ground the passenger takes over when the pilot gets out", () => {
    const t = fakeRoom();
    const start = t.helis()[2]!.pose;
    t.stand("a", start);
    t.say("a", { k: "heli-board", id: 2 });
    t.stand("b", start);
    t.say("b", { k: "heli-board", id: 2 });
    const left: HeliPose = [start[0] + 3, 0, start[2], 1, 0, 0];
    t.say("a", { k: "heli-leave", pose: left, charge: 0.4 });
    expect(t.helis()[2]!).toMatchObject({ riders: ["b", null], pose: left, home: false });
    t.say("b", { k: "heli-leave", pose: left, charge: 0.4 });
    expect(t.helis()[2]!.riders).toEqual([null, null]);
  });

  it("come down empty when the pilot gets out in the air, onto whatever is built under them, and can be flown again", () => {
    const build = new BuildState();
    const put = (piece: Piece) => expect(build.apply({ kind: "place", piece })).not.toBeNull();
    put({ id: "w", type: "wall", x: 30, y: 0, z: 30, rot: 0, material: "wood", edit: 0 });
    put({ id: "f", type: "floor", x: 30, y: 1, z: 30, rot: 0, material: "wood", edit: 0 });
    const t = fakeRoom(build);
    const start = t.helis()[0]!.pose;
    t.stand("a", start);
    t.say("a", { k: "heli-board", id: 0 });
    t.stand("b", start);
    t.say("b", { k: "heli-board", id: 0 });
    const up: HeliPose = [152.5, 30, 152.5, 0.7, 0, 0];
    t.flyTo("a", 0, up);
    expect(t.helis()[0]!.pose[1]).toBe(30);
    t.say("a", { k: "heli-leave", pose: up, charge: 0.3 });
    // Nobody flying: the passenger is out too, and it sinks.
    expect(t.helis()[0]!.riders).toEqual([null, null]);
    const fall = t.last() as Extract<HeliToPage, { k: "heli-fall" }>;
    expect(fall).toMatchObject({ k: "heli-fall", id: 0, from: up, arc: 0 });
    expect(fall.to[1]).toBeCloseTo(LEVEL + 0.15, 2);
    expect(fall.seconds).toBeGreaterThan(2);
    // Nobody gets in while it is in the air.
    t.at.set("c", [fall.to[0] + 2, fall.to[1] + 0.9, fall.to[2]]);
    t.say("c", { k: "heli-board", id: 0 });
    expect(t.last()).toEqual({ k: "heli-no", why: "full" });
    t.tick();
    t.say("c", { k: "heli-board", id: 0 });
    expect(t.helis()[0]!.riders).toEqual(["c", null]);
  });

  it("are thrown tumbling by a missile landing beside them; whoever was in one leaves in airbags", () => {
    const t = fakeRoom();
    const start = t.helis()[1]!.pose;
    t.stand("a", start);
    t.say("a", { k: "heli-board", id: 1 });
    const point: Vec = [start[0] - 2, 0, start[2]];
    const from: Vec = [start[0], 1.8, start[2]];
    const v = throwVelocity(point, from, MARS, 0)!;
    // As the shared rules do it: the builder is thrown first, then the world hears where the shot landed.
    const flight = server.thrown!({ build: t.room.build, env: MARS, playerId: "a", from, v, fall: planFall(t.room.build, from, v, MARS) }, t.room)!;
    expect(flight.glideFrom).toBe(flight.time);
    expect(t.sent.some((m) => (m.msg as { k: string }).k === "airbag")).toBe(true);
    expect(t.helis()[1]!.riders).toEqual([null, null]);
    server.struck!(t.room, point);
    const toss = t.last() as Extract<HeliToPage, { k: "heli-fall" }>;
    expect(toss).toMatchObject({ k: "heli-fall", id: 1, arc: HELI.tossUp, seconds: HELI.tossFor });
    expect(toss.to[0]).toBeCloseTo(start[0] + HELI.tossOut, 1);
    // The others, further off, are left alone.
    expect(t.sent.filter((m) => m.msg.k === "heli-fall").length).toBe(1);
  });

  it("stop a missile that comes down on them", () => {
    const t = fakeRoom();
    const parked = t.helis()[2]!.pose;
    const flight = planFlight([parked[0], 7, parked[2] - 100], [parked[0], 0, parked[2]], MARS);
    const hit = server.shotHits!(t.room, flight)!;
    expect(hit.point[1]).toBeGreaterThan(1);
    expect(hit.time).toBeLessThan(3);
    expect(server.shotHits!(t.room, planFlight([parked[0], 7, parked[2] - 100], [parked[0] + 60, 0, parked[2]], MARS))).toBeNull();
  });

  it("are still where they were left, with whoever is in them, after Mars's room has slept and woken", () => {
    const saved = new Map<string, unknown>();
    const t = fakeRoom(new BuildState(), saved);
    const start = t.helis()[1]!.pose;
    t.stand("a", start);
    t.say("a", { k: "heli-board", id: 1 });
    const left: HeliPose = [start[0] + 4, 0, start[2] + 2, 1, 0, 0];
    t.say("a", { k: "heli-leave", pose: left, charge: 0.2 });
    t.stand("b", t.helis()[2]!.pose);
    t.say("b", { k: "heli-board", id: 2 });
    const woke = fakeRoom(new BuildState(), saved);
    expect(woke.helis()[1]!).toMatchObject({ pose: left, riders: [null, null], home: false });
    expect(woke.helis()[2]!.riders).toEqual(["b", null]);
    expect(woke.helis()[0]!.home).toBe(true);
    const emptied = fakeRoom(new BuildState(), saved, ["a"]);
    expect(emptied.helis()[2]!.riders).toEqual([null, null]);
  });
});
