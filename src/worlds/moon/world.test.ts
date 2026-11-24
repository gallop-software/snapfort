import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { checkRange, maxRange, planFlight, positionAt, throwVelocity, type Vec } from "../../game/trebuchet";
import { fallPhase, fallPosition } from "../../game/fall";
import { rocketsBack, SPACE_BACK, SPACE_OUT, SPACE_RISE, spaceFlight } from "./space";
import type { Fall } from "../../game/fall";
import type { Room } from "../serverDoors";
import { homes, ROVER, ROVER_COUNT, type RoverPose, type ToPage } from "./roverRules";
import { server } from "./server";
import { world as MOON } from "./world";

/** The same world under an ordinary pull (the numbers the game was first tuned with), to compare against. */
const EARTHLY: Environment = { ...MOON, gravity: 26, stoneGravity: 9.81, flightTime: 1, range: 1, throwPower: 1, knockdownDrop: 2, rubbleGravity: 9.81 };

const treb: Piece = { id: "t", type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };

describe("the Moon", () => {
  it("throws stones that still pass exactly through the target, slower, along an arc of the same shape", () => {
    const from: Vec = [0, 7, 0], to: Vec = [40, 0, 90];
    const moon = planFlight(from, to, MOON), earthly = planFlight(from, to, EARTHLY);
    const at = positionAt(moon, moon.time);
    for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
    // Halfway along, both are at the same height: the same arc, flown slower.
    expect(positionAt(moon, moon.time / 2)[1]).toBeCloseTo(positionAt(earthly, earthly.time / 2)[1], 6);
  });

  it("keeps the nearest shots slow lobs too", () => {
    const moon = planFlight([0, 7, 0], [30, 0, 0], MOON), earthly = planFlight([0, 7, 0], [30, 0, 0], EARTHLY);
    expect(earthly.time).toBeCloseTo(Math.max(1.5, Math.sqrt(60 / 9.81)), 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
  });

  it("lets trebuchets reach 1.6 times as far", () => {
    expect(maxRange(treb, MOON)).toBeCloseTo(maxRange(treb, EARTHLY) * 1.6);
    const far: Vec = [2.5 + 400, 0, 2.5];
    expect(checkRange(treb, far, EARTHLY)).toBe("far");
    expect(checkRange(treb, far, MOON)).toBe("ok");
  });

  it("throws builders far and high, but not out of the world", () => {
    const v = throwVelocity([0, 0, 0], [1, 0.9, 0], MOON, 0)!;
    const fall = planFall(new BuildState(), [1, 0.9, 0], v, MOON);
    const earthlyFall = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], EARTHLY, 0)!, EARTHLY);
    expect(fall.land[0]).toBeGreaterThan(earthlyFall.land[0] * 1.5);
    expect(fall.time).toBeGreaterThan(earthlyFall.time);
    expect(Math.abs(fall.land[0])).toBeLessThan(200);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("makes falls slower: off a storey takes longer than under an ordinary pull", () => {
    const top: Vec = [2.5, LEVEL * 2 + 0.9, 2.5];
    expect(planFall(new BuildState(), top, [0, 0, 0], MOON).time).toBeCloseTo(planFall(new BuildState(), top, [0, 0, 0], EARTHLY).time * Math.sqrt(3), 1);
  });

  it("is a paid world at /moon, saved as it always was", () => {
    expect(MOON.paid).toBe(true);
    expect(MOON.path).toBe("/moon");
    expect(MOON.room).toBe("moon");
  });
});

describe("thrown into space", () => {
  const from: Vec = [12.5, 0.9, 12.5];
  const v = throwVelocity([10, 0, 12.5], from, MOON, 0)!;
  const thrown = (build: BuildState, at: Vec = from) => spaceFlight({ build, env: MOON, playerId: "p1", from: at, v, fall: planFall(build, at, v, MOON) });

  it("carries a builder high above the towers, tumbling, then the rockets fly them back down", () => {
    const flight = thrown(new BuildState())!;
    expect(flight.time).toBeCloseTo(SPACE_OUT + SPACE_BACK, 6);
    expect(flight.glideFrom).toBe(SPACE_OUT);
    expect(fallPhase(flight, 1)).toBe("tumble");
    expect(fallPhase(flight, SPACE_OUT + 1)).toBe("glide");
    // No lying on the ground afterwards: on their feet the moment they land.
    expect(fallPhase(flight, flight.time + 0.01)).toBe("done");
    expect(fallPosition(flight, SPACE_OUT)[1]).toBeCloseTo(from[1] + SPACE_RISE, 1);
    // Up all the way out, down all the way back.
    for (let t = 0.1; t < flight.time; t += 0.1) {
      const dy = fallPosition(flight, t)[1] - fallPosition(flight, t - 0.1)[1];
      if (t <= SPACE_OUT) expect(dy).toBeGreaterThanOrEqual(-1e-9);
      else expect(dy).toBeLessThanOrEqual(1e-9);
    }
  });

  it("sets them down on the ground near where they were hit, the way they were thrown", () => {
    const flight = thrown(new BuildState())!;
    expect(flight.land[1]).toBeCloseTo(0.9, 6);
    expect(flight.land[0]).toBeGreaterThan(from[0] + 5);
    expect(Math.hypot(flight.land[0] - from[0], flight.land[2] - from[2])).toBeLessThan(15);
    // The last stretch is straight down onto the spot, slowly.
    const late = fallPosition(flight, flight.time - 0.5);
    expect(Math.hypot(late[0] - flight.land[0], late[2] - flight.land[2])).toBeLessThan(0.01);
    expect(late[1] - flight.land[1]).toBeLessThan(3);
  });

  it("lands on whatever is built under the spot, not inside it", () => {
    const build = new BuildState();
    for (let x = 3; x <= 5; x++) for (let z = 1; z <= 3; z++) build.apply({ kind: "place", piece: { id: `f${x}${z}`, type: "floor", x, y: 0, z, rot: 0, material: "wood", edit: 0 } });
    build.apply({ kind: "place", piece: { id: "w", type: "wall", x: 4, y: 0, z: 2, rot: 0, material: "wood", edit: 0 } });
    build.apply({ kind: "place", piece: { id: "top", type: "floor", x: 4, y: 1, z: 2, rot: 0, material: "wood", edit: 0 } });
    const flight = thrown(build)!;
    expect(flight.land[1]).toBeCloseTo(LEVEL + 0.15 + 0.9, 1);
  });

  it("stays inside the building area however near the edge", () => {
    const edge: Vec = [238, 0.9, 12.5];
    const flight = thrown(new BuildState(), edge)!;
    for (const p of flight.path) expect(Math.abs(p[0])).toBeLessThanOrEqual(240);
  });

  it("leaves a builder under a roof to an ordinary fall", () => {
    const build = new BuildState();
    for (let y = 0; y < 2; y++) build.apply({ kind: "place", piece: { id: `w${y}`, type: "wall", x: 2, y, z: 2, rot: 0, material: "wood", edit: 0 } });
    // A wide ceiling two storeys up (laid outward from the wall, so every slab has a neighbour), so there is no getting out from under it.
    let slabs = 0;
    for (let ring = 0; ring <= 5; ring++) {
      for (let x = 2 - ring; x <= 2 + ring; x++) {
        for (let z = 2 - ring; z <= 2 + ring; z++) {
          if (Math.max(Math.abs(x - 2), Math.abs(z - 2)) !== ring) continue;
          if (build.apply({ kind: "place", piece: { id: `lid${x},${z}`, type: "floor", x, y: 2, z, rot: 0, material: "wood", edit: 0 } })) slabs++;
        }
      }
    }
    expect(slabs).toBe(121);
    expect(thrown(build)).toBeNull();
  });
});

describe("coming back from anywhere on the rockets", () => {
  it("flies straight back down under control, from high up or just over the edge", () => {
    const high = rocketsBack(new BuildState(), MOON, [300, 160, 40]);
    expect(high.glideFrom).toBe(0);
    expect(fallPhase(high, 0.1)).toBe("glide");
    expect(high.land[1]).toBeCloseTo(0.9, 6);
    // Set down inside the building area.
    expect(Math.abs(high.land[0])).toBeLessThanOrEqual(240);
    expect(high.time).toBeGreaterThan(5);
    expect(high.time).toBeLessThanOrEqual(7);
    const low = rocketsBack(new BuildState(), MOON, [250, 1.7, 0]);
    expect(low.time).toBeLessThan(3.5);
    expect(low.path.length).toBe(Math.round(low.time * 10) + 1);
  });
});

/** A room with two builders in it, recording what the Moon's server half does. */
function fakeRoom(build = new BuildState()) {
  const sent: { to: string; msg: ToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  const at = new Map<string, Vec>([["a", [0, 0.9, 0]], ["b", [0, 0.9, 0]]]);
  const down = new Set<string>();
  const room: Room = {
    env: MOON,
    build,
    memory: undefined,
    positionOf: (id) => at.get(id) ?? null,
    isDown: (id) => down.has(id),
    send: (to, msg) => void sent.push({ to, msg: msg as ToPage }),
    broadcast: (msg, except) => void sent.push({ to: `all${except ? ` but ${except}` : ""}`, msg: msg as ToPage }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: (ms, fn) => void timers.push({ ms, fn }),
  };
  room.memory = server.open!(room);
  const rovers = () => (room.memory as { rovers: { id: number; pose: RoverPose; rider: string | null; home: boolean }[] }).rovers;
  /** Runs what was set to happen later. */
  const tick = () => timers.splice(0).forEach((t) => t.fn());
  const stand = (id: string, pose: RoverPose) => at.set(id, [pose[0] + 2, pose[1] + 0.9, pose[2]]);
  return { room, sent, flown, tick, at, down, rovers, stand, say: (id: string, msg: unknown) => server.message!(room, id, msg) };
}

describe("rovers", () => {
  it("stand on six pads near where builders arrive, each on open ground of its own", () => {
    const build = new BuildState();
    const free = homes(build);
    expect(free.length).toBe(ROVER_COUNT);
    expect(new Set(free.map((p) => `${p[0]},${p[2]}`)).size).toBe(ROVER_COUNT);
    for (const p of free) expect(Math.hypot(p[0] - 2.5, p[2] + 7.5)).toBeLessThan(30);
    // Someone builds on a pad: that rover parks beside it instead.
    const cx = Math.floor(free[0]![0] / 5), cz = Math.floor(free[0]![2] / 5);
    build.apply({ kind: "place", piece: { id: "f", type: "floor", x: cx, y: 0, z: cz, rot: 0, material: "wood", edit: 0 } });
    const moved = homes(build);
    expect(`${moved[0]![0]},${moved[0]![2]}`).not.toBe(`${free[0]![0]},${free[0]![2]}`);
    // (Clear of the piece by a cell, so never against a wall.)
    expect(Math.hypot(moved[0]![0] - free[0]![0], moved[0]![2] - free[0]![2])).toBeLessThan(16);
    expect(new Set(moved.map((p) => `${p[0]},${p[2]}`)).size).toBe(ROVER_COUNT);
  });

  it("are sent to whoever joins, and one builder drives one at a time", () => {
    const t = fakeRoom();
    server.joined!(t.room, "a");
    expect(t.sent[0]!.to).toBe("a");
    expect(t.sent[0]!.msg.k).toBe("all");
    const pose = t.rovers()[2]!.pose;
    // Too far away to get on.
    t.at.set("a", [pose[0] + 40, 0.9, pose[2]]);
    t.say("a", { k: "board", id: 2 });
    expect(t.sent.at(-1)!.msg).toEqual({ k: "no", why: "far" });
    t.stand("a", pose);
    t.say("a", { k: "board", id: 2 });
    expect(t.rovers()[2]!.rider).toBe("a");
    expect(t.sent.at(-1)!.msg).toMatchObject({ k: "rider", id: 2, by: "a" });
    // Taken: nobody else gets on, and its driver cannot take a second.
    t.stand("b", pose);
    t.say("b", { k: "board", id: 2 });
    expect(t.sent.at(-1)!).toEqual({ to: "b", msg: { k: "no", why: "taken" } });
    t.stand("a", t.rovers()[3]!.pose);
    t.say("a", { k: "board", id: 3 });
    expect(t.rovers()[3]!.rider).toBeNull();
  });

  it("go where their driver says, within what a rover can do, and everyone else is told", () => {
    const t = fakeRoom();
    const start = t.rovers()[0]!.pose;
    t.stand("a", start);
    t.say("a", { k: "board", id: 0 });
    t.sent.length = 0;
    const next: RoverPose = [start[0] + 2, 0, start[2] + 1, 0.5, 0.1];
    t.say("a", { k: "drive", pose: next });
    expect(t.rovers()[0]!.pose).toEqual(next);
    t.tick();
    expect(t.sent).toEqual([{ to: "all but a", msg: { k: "poses", list: [[0, next]] } }]);
    // Half the Moon away in one step: not believed.
    t.say("a", { k: "drive", pose: [start[0] + 200, 0, start[2], 0, 0] });
    expect(t.rovers()[0]!.pose).toEqual(next);
    // Nonsense, and someone who is not driving: ignored.
    t.say("a", { k: "drive", pose: [NaN, 0, 0, 0, 0] });
    t.say("a", { k: "drive", pose: "there" });
    t.say("b", { k: "drive", pose: [0, 0, 0, 0, 0] });
    t.say("a", null);
    expect(t.rovers()[0]!.pose).toEqual(next);
  });

  it("stand where they are left", () => {
    const t = fakeRoom();
    const start = t.rovers()[1]!.pose;
    t.stand("a", start);
    t.say("a", { k: "board", id: 1 });
    const left: RoverPose = [start[0] + 3, 0, start[2], 1, 0];
    t.say("a", { k: "leave", pose: left });
    expect(t.rovers()[1]!).toMatchObject({ rider: null, pose: left, home: false });
    expect(t.sent.at(-1)!.msg).toEqual({ k: "rider", id: 1, by: null, pose: left });
    // And when their driver leaves the world.
    t.stand("b", left);
    t.say("b", { k: "board", id: 1 });
    server.left!(t.room, "b");
    expect(t.rovers()[1]!.rider).toBeNull();
  });

  it("throw their driver clear when they leave the Moon: rockets back for the driver, home for the rover", () => {
    const t = fakeRoom();
    const start = t.rovers()[4]!.pose;
    t.stand("a", start);
    t.say("a", { k: "board", id: 4 });
    const up: RoverPose = [start[0] + 5, 3, start[2], 0, 0.5];
    t.say("a", { k: "drive", pose: up });
    t.say("a", { k: "eject", pose: up, v: [20, 15, 0] });
    expect(t.rovers()[4]!.rider).toBeNull();
    expect(t.sent.at(-1)!.msg).toEqual({ k: "lost", id: 4, pose: up, v: [20, 15, 0] });
    expect(t.flown.length).toBe(1);
    expect(t.flown[0]!.id).toBe("a");
    expect(t.flown[0]!.fall.glideFrom).toBe(0);
    expect(t.flown[0]!.fall.from[1]).toBeCloseTo(3 + ROVER.seatUp, 6);
    expect(t.flown[0]!.fall.land[1]).toBeCloseTo(0.9, 6);
    // Nobody gets on a rover that is drifting away.
    t.stand("b", up);
    t.say("b", { k: "board", id: 4 });
    expect(t.rovers()[4]!.rider).toBeNull();
    t.tick();
    expect(t.rovers()[4]!).toMatchObject({ rider: null, pose: start, home: true });
    expect(t.sent.at(-1)!.msg).toEqual({ k: "rider", id: 4, by: null, pose: start });
  });

  it("lose their driver to a stone, who goes into space like anyone else", () => {
    const t = fakeRoom();
    const start = t.rovers()[5]!.pose;
    t.stand("a", start);
    t.say("a", { k: "board", id: 5 });
    const from: Vec = [start[0], 0.9 + ROVER.seatUp, start[2]];
    const v = throwVelocity([start[0] - 2, 0, start[2]], from, MOON, 0)!;
    const flight = server.thrown!({ build: t.room.build, env: MOON, playerId: "a", from, v, fall: planFall(t.room.build, from, v, MOON) }, t.room);
    expect(flight?.glideFrom).toBe(SPACE_OUT);
    expect(t.rovers()[5]!.rider).toBeNull();
  });

  it("drop to what is below when the floor they are parked on goes", () => {
    const build = new BuildState();
    const put = (piece: Piece) => expect(build.apply({ kind: "place", piece })).not.toBeNull();
    put({ id: "w", type: "wall", x: 20, y: 0, z: 20, rot: 0, material: "wood", edit: 0 });
    const floor: Piece = { id: "f", type: "floor", x: 20, y: 1, z: 20, rot: 0, material: "wood", edit: 0 };
    put(floor);
    const t = fakeRoom(build);
    const parked: RoverPose = [102.5, LEVEL + 0.15, 102.5, 0, 0];
    t.rovers()[0]!.pose = parked;
    build.apply({ kind: "remove", id: "f" });
    t.sent.length = 0;
    server.removed!(t.room, [floor]);
    t.tick();
    expect(t.rovers()[0]!.pose[1]).toBeCloseTo(0, 2);
    expect(t.sent[0]!.msg.k).toBe("poses");
    // A rover somewhere else is left alone.
    expect(t.rovers()[1]!.pose[1]).toBe(0);
  });
});
