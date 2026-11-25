import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import type { Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { findImpact, planFlight, type Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { server } from "./server";
import { airAt, airToward, AIR_SECONDS, boxOf, canTake, cannotPlace, fits, heldBy, nameOf, needsOf, nextPart, partAt, PARTS, readTerraformer, running, TALL, TERRAFORMER, THIN, type Air, type TerraToPage, type Terraformer } from "./terraformerRules";
import { airNow } from "./terraformers";
import { flapIn, sinkIn, WINGS, wingStep } from "./wingRules";
import { world as MARS } from "./world";

/** A room recording what Mars's server half does. */
function fakeRoom(build = new BuildState(), saved = new Map<string, unknown>(), here: string[] = ["a", "b"]) {
  const sent: { to: string; msg: TerraToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const at = new Map<string, Vec>(here.map((id) => [id, [0, 0.9, 0]]));
  const builders = new Set(here);
  const room: Room = {
    env: MARS,
    build,
    memory: undefined,
    positionOf: (id) => at.get(id) ?? null,
    isDown: () => false,
    send: (to, msg) => void sent.push({ to, msg: msg as TerraToPage }),
    broadcast: (msg, except) => void sent.push({ to: `all${except ? ` but ${except}` : ""}`, msg: msg as TerraToPage }),
    fly: (id, fall) => void flown.push({ id, fall }),
    later: () => undefined,
    players: () => [...at.keys()],
    mayBuild: (id) => builders.has(id),
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
    worlds: () => [],
    toWorld: async () => undefined,
  };
  room.memory = server.open!(room);
  const say = (id: string, msg: unknown) => server.message!(room, id, msg);
  const list = () => (room.memory as { terra: { list: Terraformer[]; air: Air } }).terra.list;
  const air = () => (room.memory as { terra: { air: Air } }).terra.air;
  /** Stands a builder right beside where part `n` goes. */
  const beside = (id: string, site: { x: number; z: number }, n: number) => {
    const b = boxOf(site, n);
    at.set(id, [b[3] + 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
  };
  /** Builds a whole one with its corner at this cell, as a builder must: each part from close by, in order. */
  const whole = (id = "a", site = { x: 4, z: 4 }) => {
    beside(id, site, 1);
    say(id, { k: "terra-new", ...site });
    const t = list().at(-1)!;
    for (let n = 2; n <= PARTS; n++) {
      beside(id, site, n);
      say(id, { k: "terra-part", id: t.id, n });
    }
    return t;
  };
  return { room, sent, at, builders, saved, say, list, air, beside, whole, last: () => sent.at(-1)!.msg };
}

describe("the Terraformer's kit", () => {
  const site = { x: 4, z: 4 };

  it("is 24 named parts on a 40 m square, numbered in the order they go on, a hundred metres tall", () => {
    expect(PARTS).toBe(24);
    for (let n = 1; n <= PARTS; n++) {
      expect(nameOf(n)).not.toBe("");
      // Whatever a part stands on has a lower number: building in order always works.
      for (const m of needsOf(n)) expect(m).toBeLessThan(n);
      const b = boxOf(site, n);
      expect(b[0]).toBeGreaterThanOrEqual(site.x * 5 - 1.01);
      expect(b[3]).toBeLessThanOrEqual(site.x * 5 + 41.01);
      expect(b[4]).toBeGreaterThan(b[1]);
    }
    expect(new Set(Array.from({ length: PARTS }, (_, i) => nameOf(i + 1))).size).toBe(PARTS);
    expect(Math.max(...Array.from({ length: PARTS }, (_, i) => boxOf(site, i + 1)[4]))).toBe(TALL);
    expect(TALL).toBeGreaterThan(100);
    expect(needsOf(1)).toEqual([]);
  });

  it("goes together from the ground up: the next part is the lowest number missing, and nothing goes on before what it stands on", () => {
    const t: Terraformer = { id: 1, ...site, parts: [1], broken: [], touched: 0 };
    const build = new BuildState();
    expect(nextPart(t)).toBe(2);
    expect(cannotPlace(build, t, 2)).toBeNull();
    expect(cannotPlace(build, t, 1)).toBe("have");
    // The stack before the reactor is there: no.
    expect(cannotPlace(build, t, 19)).toBe("needs");
    expect(cannotPlace(build, t, 99)).toBe("room");
    t.parts = Array.from({ length: PARTS }, (_, i) => i + 1);
    expect(nextPart(t)).toBeNull();
    expect(running(t)).toBe(true);
  });

  it("comes apart from the top down", () => {
    const t: Terraformer = { id: 1, ...site, parts: Array.from({ length: PARTS }, (_, i) => i + 1), broken: [], touched: 0 };
    expect(canTake(t, 24)).toBe(true);
    expect(canTake(t, 23)).toBe(false);
    expect(heldBy(23)).toEqual([24]);
    expect(canTake(t, 1)).toBe(false);
    // An intake fan sits on top of its tower with nothing on it.
    expect(canTake(t, 13)).toBe(true);
  });

  it("cannot go where something is built, and must fit inside the building area", () => {
    const build = new BuildState();
    build.apply({ kind: "place", piece: { id: "w", type: "wall", x: 6, y: 0, z: 6, rot: 0, material: "wood", edit: 0 } });
    const t: Terraformer = { id: 1, ...site, parts: [], broken: [], touched: 0 };
    expect(cannotPlace(build, t, 1)).toBe("crowded");
    expect(fits({ x: 40, z: 0 })).toBe(true);
    expect(fits({ x: 41, z: 0 })).toBe(false);
    expect(fits({ x: -49, z: 0 })).toBe(false);
    expect(readTerraformer({ id: 1, x: 44, z: 0, parts: [1] })).toBeNull();
    expect(readTerraformer({ id: 1, x: 4, z: 4, parts: [1, 1, 2, 77, "x"], broken: [2, 9] })).toMatchObject({ parts: [1, 2], broken: [2] });
  });

  it("knows which part is at a spot: the smallest one there", () => {
    const t: Terraformer = { id: 1, ...site, parts: Array.from({ length: PARTS }, (_, i) => i + 1), broken: [], touched: 0 };
    expect(partAt(t, [site.x * 5 + 20, TALL - 1, site.z * 5 + 20])).toBe(24);
    expect(partAt(t, [site.x * 5 + 20, 0.5, site.z * 5 + 1])).toBe(1);
    expect(partAt(t, [site.x * 5 - 30, 1, site.z * 5])).toBeNull();
  });
});

describe("the air", () => {
  it("is thin to begin with, and moves at one pace, up and down: four minutes all the way", () => {
    expect(airAt(THIN, 5_000_000)).toBe(0);
    const up = airToward(THIN, 1, 1000);
    expect(airAt(up, 1000)).toBe(0);
    expect(airAt(up, 1000 + (AIR_SECONDS * 1000) / 2)).toBeCloseTo(0.5, 6);
    expect(airAt(up, 1000 + AIR_SECONDS * 1000)).toBe(1);
    expect(airAt(up, 1000 + AIR_SECONDS * 5000)).toBe(1);
    // Stopped a quarter of the way up: it goes back from there, never jumping.
    const turn = 1000 + (AIR_SECONDS * 1000) / 4;
    const down = airToward(up, 0, turn);
    expect(airAt(down, turn)).toBeCloseTo(0.25, 6);
    expect(airAt(down, turn + (AIR_SECONDS * 1000) / 8)).toBeCloseTo(0.125, 6);
    expect(airAt(down, turn + AIR_SECONDS * 1000)).toBe(0);
  });
});

describe("building a Terraformer", () => {
  it("is started on clear ground from close by, by someone with the Full Game, and Mars has room for one", () => {
    const t = fakeRoom();
    t.builders.delete("b");
    t.say("b", { k: "terra-new", x: 4, z: 4 });
    expect(t.last()).toEqual({ k: "terra-no", why: "locked" });
    t.at.set("a", [200, 0.9, 200]);
    t.say("a", { k: "terra-new", x: 4, z: 4 });
    expect(t.last()).toEqual({ k: "terra-no", why: "far" });
    t.say("a", { k: "terra-new", x: 44, z: 4 });
    expect(t.last()).toEqual({ k: "terra-no", why: "room" });
    t.beside("a", { x: 4, z: 4 }, 1);
    t.say("a", { k: "terra-new", x: 4, z: 4 });
    expect(t.list().length).toBe(1);
    expect(t.last()).toMatchObject({ k: "terra", terra: { x: 4, z: 4, parts: [1], broken: [] } });
    t.beside("a", { x: 20, z: 20 }, 1);
    t.say("a", { k: "terra-new", x: 20, z: 20 });
    expect(t.last()).toEqual({ k: "terra-no", why: "full" });
    // Nonsense is ignored.
    for (const junk of [null, 7, { k: "terra-new", x: 1.5, z: 2 }, { k: "terra-part", id: 1, n: "two" }, { k: "terra-part", id: 99, n: 2 }, { k: "other" }]) t.say("a", junk);
    expect(t.list()[0]!.parts).toEqual([1]);
  });

  it("takes each part from within reach of where it goes: the stack cannot be put on from the ground", () => {
    const t = fakeRoom();
    const site = { x: 4, z: 4 };
    t.beside("a", site, 1);
    t.say("a", { k: "terra-new", ...site });
    const id = t.list()[0]!.id;
    for (let n = 2; n <= 18; n++) {
      t.beside("a", site, n);
      t.say("a", { k: "terra-part", id, n });
    }
    expect(t.list()[0]!.parts.length).toBe(18);
    // Standing on the ground beside it: the first length of the stack is 36 m up.
    t.at.set("a", [site.x * 5 + 42, 0.9, site.z * 5 + 20]);
    t.say("a", { k: "terra-part", id, n: 19 });
    expect(t.last()).toEqual({ k: "terra-no", why: "far" });
    t.beside("a", site, 19);
    t.say("a", { k: "terra-part", id, n: 19 });
    expect(t.list()[0]!.parts).toContain(19);
    // Out of order: refused.
    t.beside("a", site, 24);
    t.say("a", { k: "terra-part", id, n: 24 });
    expect(t.last()).toEqual({ k: "terra-no", why: "needs" });
  });

  it("runs once it is whole: the air of the whole world heads for thick, everyone is told, and it is kept", () => {
    const t = fakeRoom();
    const terra = t.whole();
    expect(running(terra)).toBe(true);
    expect(t.air().to).toBe(1);
    const told = t.sent.filter((m) => m.msg.k === "air");
    expect(told.length).toBe(1);
    expect(told[0]!.to).toBe("all");
    expect(airNow(t.room, t.air().since + AIR_SECONDS * 500)).toBeCloseTo(0.5, 6);
    // The room sleeps and wakes: still there, still running, the air where it had got to.
    const woke = fakeRoom(new BuildState(), t.saved);
    expect(woke.list()[0]!.parts.length).toBe(PARTS);
    expect(woke.air()).toEqual(t.air());
    // And whoever joins is sent it all.
    server.joined!(woke.room, "b");
    expect(woke.last()).toMatchObject({ k: "terras", air: t.air() });
    expect((woke.last() as Extract<TerraToPage, { k: "terras" }>).list.length).toBe(1);
  });
});

describe("stopping a Terraformer, and mending it", () => {
  it("is stopped by one hit: the part struck is broken, the air turns back, and it stays so until mended from close by", () => {
    const t = fakeRoom();
    const terra = t.whole();
    const lamp = boxOf(terra, 24);
    server.struck!(t.room, [(lamp[0] + lamp[3]) / 2, lamp[4] + 1, (lamp[2] + lamp[5]) / 2]);
    expect(terra.broken).toEqual([24]);
    expect(running(terra)).toBe(false);
    expect(t.air().to).toBe(0);
    expect(t.sent.at(-2)!.msg.k).toBe("air");
    expect(t.last()).toMatchObject({ k: "terra", hit: [24] });
    // A second hit on the same part changes nothing more.
    const n = t.sent.length;
    server.struck!(t.room, [(lamp[0] + lamp[3]) / 2, lamp[4] + 1, (lamp[2] + lamp[5]) / 2]);
    expect(t.sent.length).toBe(n);
    // Mending: not from the ground.
    t.at.set("a", [terra.x * 5 + 42, 0.9, terra.z * 5 + 20]);
    t.say("a", { k: "terra-mend", id: terra.id, n: 24 });
    expect(t.last()).toEqual({ k: "terra-no", why: "far" });
    t.beside("a", terra, 24);
    t.say("a", { k: "terra-mend", id: terra.id, n: 24 });
    expect(terra.broken).toEqual([]);
    expect(t.air().to).toBe(1);
  });

  it("is hit by the beacon's missile: marked on its top, the missile dives onto the top; marked on the ground under it, it flies into the stack on the way across", () => {
    const t = fakeRoom();
    const terra = t.whole();
    const middle: Vec = [terra.x * 5 + 20, 0, terra.z * 5 + 20];
    // The crosshair on the lamp at the very top.
    const onTop = planFlight([200, 7, 200], [middle[0], TALL, middle[2]], MARS);
    const hit = server.shotHits!(t.room, onTop)!;
    expect(hit.point[1]).toBeGreaterThan(TALL - 0.5);
    expect(Math.hypot(hit.point[0] - middle[0], hit.point[2] - middle[2])).toBeLessThan(0.5);
    server.struck!(t.room, hit.point);
    expect(terra.broken).toContain(24);
    // The ground beneath it: the missile crosses 67 m up, lower than the stack is tall.
    const under = planFlight([200, 7, 200], middle, MARS);
    const side = server.shotHits!(t.room, under)!;
    expect(side.point[1]).toBeCloseTo(67, 0);
    expect(side.time).toBeLessThan(findImpact(t.room.build, under, "none", MARS).time);
    server.struck!(t.room, side.point);
    expect(terra.broken.some((n) => nameOf(n).startsWith("Stack"))).toBe(true);
    // A shot at open ground well away hits nothing of it.
    expect(server.shotHits!(t.room, planFlight([200, 7, 200], [200, 0, -150], MARS))).toBeNull();
    // A shot landing on the foundation's edge breaks the foundation.
    const before = terra.broken.length;
    server.struck!(t.room, [terra.x * 5 + 1, 1.5, terra.z * 5 + 20]);
    expect(terra.broken).toContain(1);
    expect(terra.broken.length).toBe(before + 1);
  });

  it("can be taken apart with the Remove tool from the top down, and is gone with its last part", () => {
    const t = fakeRoom();
    const terra = t.whole();
    t.beside("a", terra, 23);
    t.say("a", { k: "terra-take", id: terra.id, n: 23 });
    expect(t.last()).toEqual({ k: "terra-no", why: "held" });
    for (let n = PARTS; n >= 2; n--) {
      t.beside("a", terra, n);
      t.say("a", { k: "terra-take", id: terra.id, n });
    }
    expect(terra.parts).toEqual([1]);
    expect(t.air().to).toBe(0);
    t.beside("a", terra, 1);
    t.say("a", { k: "terra-take", id: terra.id, n: 1 });
    expect(t.list().length).toBe(0);
    expect(t.last()).toEqual({ k: "terra-gone", id: terra.id });
  });

  it("lets nothing be built into it", () => {
    const t = fakeRoom();
    const terra = t.whole();
    const piece = (x: number, y: number, z: number): Piece => ({ id: "p", type: "wall", x, y, z, rot: 0, material: "wood", edit: 0 });
    expect(server.blocks!(t.room, piece(terra.x + 4, 0, terra.z + 4))).toBe(true);
    expect(server.blocks!(t.room, piece(terra.x + 4, 5, terra.z + 4))).toBe(true);
    // Beside it is fine: that is where the scaffolding goes.
    expect(server.blocks!(t.room, piece(terra.x - 2, 0, terra.z + 4))).toBe(false);
    expect(server.blocks!(t.room, piece(terra.x + 9, 0, terra.z + 4))).toBe(false);
  });
});

describe("wings", () => {
  const level = (air: number, seconds = 10) => {
    let speed: number = WINGS.open, far = 0, dropped = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const step = wingStep(speed, 0, air, MARS.gravity, 1 / 60, false, false);
      speed = step.speed;
      far += step.forward / 60;
      dropped -= step.up / 60;
    }
    return { far, dropped };
  };

  it("carry nothing in Mars's own air, a little in thin air, and far in thick air", () => {
    expect(sinkIn(0)).toBe(WINGS.sinkThin);
    expect(sinkIn(1)).toBeCloseTo(WINGS.sinkThick, 6);
    for (let a = 0.2; a <= 1; a += 0.1) expect(sinkIn(a)).toBeLessThan(sinkIn(a - 0.1) + 1e-9);
    const thin = level(0.2), thick = level(1);
    // In thick air, ten seconds of level flight costs a few storeys; in thin air, a tower.
    expect(thick.far / thick.dropped).toBeGreaterThan(thin.far / thin.dropped * 3);
    expect(thick.far / thick.dropped).toBeGreaterThan(5);
  });

  it("gain speed in a dive and trade it for height looking up", () => {
    let speed: number = WINGS.open;
    for (let t = 0; t < 4; t += 1 / 60) speed = wingStep(speed, 0.9, 1, MARS.gravity, 1 / 60, false, false).speed;
    expect(speed).toBeGreaterThan(30);
    expect(speed).toBeLessThanOrEqual(WINGS.fastest);
    const pull = wingStep(speed, -0.5, 1, MARS.gravity, 1 / 60, false, false);
    expect(pull.up).toBeGreaterThan(8);
    expect(pull.speed).toBeLessThan(speed);
    // Braking sheds speed faster.
    expect(wingStep(speed, 0, 1, MARS.gravity, 0.5, false, true).speed).toBeLessThan(wingStep(speed, 0, 1, MARS.gravity, 0.5, false, false).speed);
  });

  it("can be flapped to climb, in thick air only", () => {
    expect(flapIn(0.4)).toBe(0);
    expect(flapIn(1)).toBeCloseTo(WINGS.flapLift, 6);
    expect(wingStep(20, 0, 1, MARS.gravity, 1 / 60, true, false).up).toBeGreaterThan(4);
    expect(wingStep(20, 0, 0.4, MARS.gravity, 1 / 60, true, false).up).toBeLessThan(0);
  });

  it("stop carrying when flown too slowly", () => {
    expect(wingStep(4, 0, 1, MARS.gravity, 1 / 60, false, false).up).toBeLessThan(wingStep(20, 0, 1, MARS.gravity, 1 / 60, false, false).up - 4);
  });
});
void TERRAFORMER;
