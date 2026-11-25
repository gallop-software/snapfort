import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { fallPhase, fallPosition, type Fall } from "../../game/fall";
import { checkRange, findImpact, launchPoint, maxRange, planFlight, positionAt, throwVelocity, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { airbagFlight, BOUNCE, DEFLATE, type AirbagMessage } from "./airbags";
import { server } from "./server";
import { DAY_SHARE, daylight, deimosDirection, dusk, earthDirection, phobosDirection, PHOBOS_PASSES, SOL_SECONDS, solsAt, sunDirection, sunHeight } from "./sol";
import { PULL, world as MARS } from "./world";

/** The same world under an ordinary pull (the numbers the game was first tuned with), to compare against. */
const EARTHLY: Environment = { ...MARS, gravity: 26, stoneGravity: 9.81, flightTime: 1, range: 1, throwPower: 1, knockdownDrop: 2, rubbleGravity: 9.81, siege: { ...MARS.siege, shotSeconds: undefined, dive: undefined } };

const engine: Piece = { id: "t", type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };
const length = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe("Mars", () => {
  it("pulls at the real 0.38 of the Earth's, on builders, stones and rubble alike", () => {
    expect(PULL).toBe(0.38);
    expect(MARS.gravity / EARTHLY.gravity).toBeCloseTo(0.38, 6);
    expect(MARS.stoneGravity / 9.81).toBeCloseTo(0.38, 6);
    expect(MARS.rubbleGravity / 9.81).toBeCloseTo(0.38, 6);
  });

  it("makes falls slower by what that pull gives: off two storeys takes 1.62 times as long", () => {
    const top: Vec = [2.5, LEVEL * 2 + 0.9, 2.5];
    expect(planFall(new BuildState(), top, [0, 0, 0], MARS).time).toBeCloseTo(planFall(new BuildState(), top, [0, 0, 0], EARTHLY).time * Math.sqrt(1 / 0.38), 1);
  });

  it("lets a builder jump well over a wall, a little less than on the Moon", () => {
    expect(MARS.jumpHeight).toBeGreaterThan(LEVEL);
    expect(MARS.jumpHeight).toBeLessThan(6.8);
  });

  it("is built in ice, redbrick and iron, under greenhouse roofs, with the limits every world has", () => {
    expect([MARS.materials.wood.label, MARS.materials.brick.label, MARS.materials.metal.label]).toEqual(["Ice", "Redbrick", "Iron"]);
    expect([MARS.materials.wood.maxLevel, MARS.materials.brick.maxLevel, MARS.materials.metal.maxLevel]).toEqual([Infinity, 29, 9]);
    expect([MARS.materials.wood.hits, MARS.materials.brick.hits, MARS.materials.metal.hits]).toEqual([2, 4, 6]);
    expect(MARS.labels.roof).toBe("Greenhouse");
  });

  it("lets its siege engine reach half as far again", () => {
    expect(maxRange(engine, MARS)).toBeCloseTo(maxRange(engine, EARTHLY) * 1.5);
    const far: Vec = [2.5 + 400, 0, 2.5];
    expect(checkRange(engine, far, EARTHLY)).toBe("far");
    expect(checkRange(engine, far, MARS)).toBe("ok");
  });

  it("throws builders further than under an ordinary pull, but not out of the world", () => {
    const fall = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], MARS, 0)!, MARS);
    const earthly = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], EARTHLY, 0)!, EARTHLY);
    expect(fall.land[0]).toBeGreaterThan(earthly.land[0] * 1.4);
    expect(Math.abs(fall.land[0])).toBeLessThan(200);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("is a paid world at /mars, with a room of its own", () => {
    expect(MARS.paid).toBe(true);
    expect(MARS.path).toBe("/mars");
    expect(MARS.room).toBe("mars");
  });
});

describe("the sol", () => {
  it("passes in twenty minutes, and is the same hour for everyone: it is read off the clock", () => {
    expect(SOL_SECONDS).toBe(1200);
    expect(solsAt(1_200_000)).toBe(1);
    const now = 1_795_000_000_000;
    expect(sunHeight(solsAt(now))).toBe(sunHeight(solsAt(now)));
    // One sol on, everything in the sky that keeps to the sol is back where it was.
    expect(sunDirection(solsAt(now + 1_200_000))[1]).toBeCloseTo(sunDirection(solsAt(now))[1], 6);
  });

  it("has the sun rise in the east, stand high at midday, and set in the west", () => {
    expect(sunDirection(0)[0]).toBeCloseTo(1, 6);
    expect(sunHeight(0)).toBeCloseTo(0, 6);
    expect(sunHeight(DAY_SHARE / 2)).toBeCloseTo(1, 6);
    expect(sunDirection(DAY_SHARE / 2)[1]).toBeGreaterThan(0.8);
    expect(sunDirection(DAY_SHARE)[0]).toBeCloseTo(-1, 6);
    expect(sunHeight(DAY_SHARE + 0.1)).toBeLessThan(0);
    for (const p of [0, 0.2, 0.5, 0.8, 0.99]) expect(length(sunDirection(p))).toBeCloseTo(1, 6);
  });

  it("is light for most of it: day for 65%, full night in between, twilight either side", () => {
    expect(daylight(DAY_SHARE / 2)).toBe(1);
    expect(daylight(DAY_SHARE + (1 - DAY_SHARE) / 2)).toBe(0);
    const atSunset = daylight(DAY_SHARE);
    expect(atSunset).toBeGreaterThan(0.2);
    expect(atSunset).toBeLessThan(1);
    // It never jumps: no step of a second changes the light by more than a little.
    for (let s = 0; s < SOL_SECONDS; s++) expect(Math.abs(daylight((s + 1) / SOL_SECONDS) - daylight(s / SOL_SECONDS))).toBeLessThan(0.05);
  });

  it("turns the sky round the sun blue only as it rises and sets", () => {
    expect(dusk(0)).toBeCloseTo(1, 6);
    expect(dusk(DAY_SHARE)).toBeCloseTo(1, 6);
    expect(dusk(DAY_SHARE / 2)).toBe(0);
    expect(dusk(DAY_SHARE + (1 - DAY_SHARE) / 2)).toBe(0);
  });

  it("sends Phobos the wrong way: up in the west, down in the east, more than twice a sol", () => {
    const start = phobosDirection(0), soon = phobosDirection(0.02);
    expect(start[0]).toBeCloseTo(-1, 6);
    expect(soon[1]).toBeGreaterThan(0);
    expect(soon[0]).toBeGreaterThan(start[0]);
    expect(phobosDirection(1 / PHOBOS_PASSES / 2)[0]).toBeCloseTo(1, 6);
    let rises = 0;
    for (let i = 0; i < 1000; i++) if (phobosDirection(i / 1000)[1] <= 0 && phobosDirection((i + 1) / 1000)[1] > 0) rises++;
    expect(rises).toBeGreaterThanOrEqual(2);
  });

  it("keeps Deimos nearly still, and the Earth an evening star that follows the sun down", () => {
    expect(length(deimosDirection(0).map((v, i) => v - deimosDirection(0.05)[i]!))).toBeLessThan(0.1);
    // Just after sunset the sun is down and the Earth still up, in the west.
    const after = DAY_SHARE + 0.02;
    expect(sunHeight(after)).toBeLessThan(0);
    expect(earthDirection(after)[1]).toBeGreaterThan(0);
    expect(earthDirection(after)[0]).toBeLessThan(0);
  });
});

/** A room with two builders in it, recording what Mars's server half does. */
function fakeRoom(build = new BuildState(), saved = new Map<string, unknown>(), here: string[] = ["a", "b"]) {
  const sent: { to: string; msg: { k: string } & Record<string, unknown> }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  const at = new Map<string, Vec>(here.map((id) => [id, [0, 0.9, 0]]));
  const down = new Set<string>();
  const builders = new Set(here);
  const room: Room = {
    env: MARS,
    build,
    memory: undefined,
    positionOf: (id) => at.get(id) ?? null,
    isDown: (id) => down.has(id),
    send: (to, msg) => void sent.push({ to, msg: msg as never }),
    broadcast: (msg, except) => void sent.push({ to: `all${except ? ` but ${except}` : ""}`, msg: msg as never }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: (ms, fn) => void timers.push({ ms, fn }),
    players: () => [...at.keys()],
    mayBuild: (id) => builders.has(id),
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
    worlds: () => [{ id: "meadow", name: "Meadow" }, { id: "moon", name: "Moon" }],
    toWorld: async () => undefined,
  };
  room.memory = server.open?.(room);
  /** Runs what was set to happen later. */
  const tick = () => timers.splice(0).forEach((t) => t.fn());
  return { room, sent, flown, timers, tick, at, down, builders, saved, say: (id: string, msg: unknown) => server.message!(room, id, msg) };
}
void fakeRoom;

describe("the beacon", () => {
  const from = launchPoint(engine, MARS);

  it("marks a spot and its missile is there three seconds later, however far", () => {
    for (const to of [[40, 0, 90], [430, 30, 0], [6, 0, 4]] as Vec[]) {
      const shot = planFlight(from, to, MARS);
      expect(shot.time).toBe(3);
      const at = positionAt(shot, shot.time);
      for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
    }
    expect(MARS.siege.reload).toBe(6);
    expect(MARS.siege.minRange).toBe(0);
  });

  it("climbs straight up off the engine, crosses 60 m above the higher of the two, and comes straight down", () => {
    const to: Vec = [120, 30, -80];
    const shot = planFlight(from, to, MARS);
    const top = 30 + 60;
    let highest = 0;
    for (let t = 0; t <= shot.time + 1e-9; t += 0.01) {
      const p = positionAt(shot, t);
      highest = Math.max(highest, p[1]);
      // Never off the three legs: over the engine, level at the top, or over the mark.
      const overEngine = Math.hypot(p[0] - from[0], p[2] - from[2]) < 1e-6, overMark = Math.hypot(p[0] - to[0], p[2] - to[2]) < 1e-6;
      expect(overEngine || overMark || Math.abs(p[1] - top) < 1e-6).toBe(true);
    }
    expect(highest).toBeCloseTo(top, 6);
    // The same speed all the way.
    const step = (t: number) => Math.hypot(...positionAt(shot, t + 0.01).map((v, i) => v - positionAt(shot, t)[i]!));
    expect(step(0.2)).toBeCloseTo(step(1.5), 4);
    expect(step(1.5)).toBeCloseTo(step(2.9), 4);
  });

  it("goes over a wall that would stop a straight shot: walls do not shelter from it", () => {
    const state = new BuildState();
    for (let y = 0; y < 3; y++) state.apply({ kind: "place", piece: { id: `w${y}`, type: "wall", x: 10, y, z: 0, rot: 1, material: "metal", edit: 0 } });
    const beyond: Vec = [100, 0, 2.5];
    const hit = findImpact(state, planFlight(from, beyond, MARS), "t", MARS);
    expect(hit.pieceId).toBeUndefined();
    expect(hit.point[0]).toBeCloseTo(100, 6);
    expect(hit.point[1]).toBe(0);
    expect(hit.time).toBeCloseTo(3, 1);
  });

  it("meets the highest thing over the mark: a roof takes the hit for whoever is under it", () => {
    const state = new BuildState();
    const put = (piece: Piece) => expect(state.apply({ kind: "place", piece })).not.toBeNull();
    for (const [rot, x, z] of [[0, 20, 20], [0, 20, 21], [1, 20, 20], [1, 21, 20]] as const) put({ id: `w${rot}${x}${z}`, type: "wall", x, y: 0, z, rot, material: "brick", edit: 0 });
    put({ id: "lid", type: "floor", x: 20, y: 1, z: 20, rot: 0, material: "brick", edit: 0 });
    put({ id: "roof", type: "roof", x: 20, y: 1, z: 20, rot: 0, material: "brick", edit: 0 });
    // Marked on the ground inside the room (seen through its doorway, say).
    const hit = findImpact(state, planFlight(from, [102.5, 0, 102.5], MARS), "t", MARS);
    expect(hit.pieceId).toBe("roof");
    expect(hit.point[1]).toBeGreaterThan(LEVEL);
    expect(hit.time).toBeLessThan(3);
  });

  it("is stopped by a ceiling over the beacon itself", () => {
    const state = new BuildState();
    const put = (piece: Piece) => expect(state.apply({ kind: "place", piece })).not.toBeNull();
    for (let y = 0; y < 3; y++) put({ id: `p${y}`, type: "wall", x: 0, y, z: 0, rot: 0, material: "metal", edit: 0 });
    put({ id: "lid", type: "floor", x: 0, y: 3, z: 0, rot: 0, material: "metal", edit: 0 });
    const hit = findImpact(state, planFlight(from, [100, 0, 2.5], MARS), "t", MARS);
    expect(hit.pieceId).toBe("lid");
    expect(hit.time).toBeLessThan(0.5);
  });

  it("leaves the other worlds' shots as they were: without a dive a flight is the same arc as ever", () => {
    const arc = planFlight(from, [100, 0, 2.5], EARTHLY);
    expect(arc.dive).toBeUndefined();
    expect(arc.g).toBe(9.81);
    const mid = positionAt(arc, arc.time / 2);
    expect(mid[1]).toBeGreaterThan(from[1]);
    expect(mid[0]).toBeCloseTo((from[0] + 100) / 2, 6);
  });
});

describe("airbags", () => {
  const from: Vec = [12.5, 0.9, 12.5];
  const v = throwVelocity([10, 0, 12.5], from, MARS, 0)!;
  const flight = (build = new BuildState(), at: Vec = from) => airbagFlight(build, MARS, at, v);

  it("bring a thrown builder down bouncing: several bounces, each lower and shorter than the last", () => {
    const { fall, bounces, until } = flight();
    expect(bounces.length).toBeGreaterThanOrEqual(3);
    expect(bounces.length).toBeLessThanOrEqual(BOUNCE.most);
    const ends = [...bounces, until];
    const tops: number[] = [], lasts: number[] = [];
    for (let i = 0; i < ends.length; i++) {
      const start = i === 0 ? 0 : ends[i - 1]!;
      let top = 0;
      for (let t = start; t < ends[i]!; t += 0.02) top = Math.max(top, fallPosition(fall, t)[1]);
      tops.push(top);
      lasts.push(ends[i]! - start);
    }
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]!).toBeLessThan(tops[i - 1]!);
      expect(lasts[i]!).toBeLessThan(lasts[i - 1]!);
    }
    // On the ground at every bounce.
    for (const t of bounces) expect(fallPosition(fall, t)[1]).toBeLessThan(1.6);
  });

  it("carry them the way they were thrown, and set them down on their feet when the bags let go", () => {
    const { fall, until } = flight();
    expect(fall.land[0]).toBeGreaterThan(from[0] + 20);
    expect(Math.abs(fall.land[2] - from[2])).toBeLessThan(1);
    expect(fall.land[1]).toBeCloseTo(0.9, 6);
    expect(fall.time).toBeCloseTo(until + DEFLATE, 1);
    // Tumbling all the way, then up at once: no lying on the ground.
    expect(fallPhase(fall, until)).toBe("tumble");
    expect(fallPhase(fall, fall.time + 0.01)).toBe("done");
    expect(fall.path.length).toBe(Math.round(fall.time * 10) + 1);
    expect(fall.path.at(-1)).toEqual(fall.land);
  });

  it("stay inside the building area, and never go through the ground", () => {
    const { fall } = flight(new BuildState(), [238, 0.9, 12.5]);
    for (const p of fall.path) {
      expect(Math.abs(p[0])).toBeLessThanOrEqual(252.01);
      expect(p[1]).toBeGreaterThanOrEqual(0.9 - 1e-6);
    }
  });

  it("bounce off what is built: onto a roof, and a wall stops them", () => {
    const build = new BuildState();
    for (let y = 0; y < 8; y++) build.apply({ kind: "place", piece: { id: `w${y}`, type: "wall", x: 8, y, z: 2, rot: 1, material: "metal", edit: 0 } });
    const { fall } = flight(build);
    // The wall is at x = 40 m: they never get past it.
    for (const p of fall.path) expect(p[0]).toBeLessThan(40);
  });

  it("are what a hit gives everyone on Mars: the server flies them that way and tells every page", () => {
    const t = fakeRoom();
    const fall = server.thrown!({ build: t.room.build, env: MARS, playerId: "a", from, v, fall: planFall(t.room.build, from, v, MARS) }, t.room)!;
    expect(fall.glideFrom).toBe(fall.time);
    const told = t.sent.at(-1)!;
    expect(told.to).toBe("all");
    const msg = told.msg as unknown as AirbagMessage;
    expect(msg.k).toBe("airbag");
    expect(msg.id).toBe("a");
    expect(msg.fall.path).toEqual(fall.path);
    expect(msg.bounces.length).toBeGreaterThanOrEqual(3);
    expect(msg.until).toBeLessThan(fall.time);
  });
});
