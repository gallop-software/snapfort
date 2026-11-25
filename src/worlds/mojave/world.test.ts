import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildState } from "../../game/buildState";
import type { Fall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import type { Vec } from "../../game/trebuchet";
import type { Room } from "../serverDoors";
import { LEAVE_GRACE, MAX_GENERALS, PIECE_COST, START_LITHIUM, UNIT_KINDS } from "./kit";
import { STARTS } from "./map";
import { server } from "./server";
import type { Sim } from "./sim";
import { UNIT_FIELDS, type ToPage } from "./wire";
import { HALF_CELLS, world } from "./world";

/**
 * Mojave's server half, in a stand-in room: who becomes a general, what each
 * page is told (and, above all, what it is not), orders from pages, pieces,
 * leaving, and a room that sleeps.
 */

let now = 1_700_000_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

function fakeRoom(opts: { saved?: Map<string, unknown>; test?: boolean; visitors?: string[] } = {}) {
  const build = new BuildState();
  build.halfCells = HALF_CELLS;
  const saved = opts.saved ?? new Map<string, unknown>();
  const sent: { to: string; msg: ToPage }[] = [];
  const flown: { id: string; fall: Fall }[] = [];
  const removed: string[] = [];
  const worn: [string, number][] = [];
  let timers: { at: number; fn: () => void }[] = [];
  const at = new Map<string, Vec>();
  const tabs = new Map<string, string>();
  const room: Room = {
    env: world,
    build,
    memory: undefined,
    positionOf: (id) => at.get(id) ?? null,
    isDown: () => false,
    send: (to, msg) => void sent.push({ to, msg: msg as ToPage }),
    broadcast: (msg) => {
      for (const to of at.keys()) sent.push({ to, msg: msg as ToPage });
    },
    fly: (id, fall) => void flown.push({ id, fall }),
    later: (ms, fn) => void timers.push({ at: now + ms, fn }),
    players: () => [...at.keys()],
    mayBuild: (id) => !(opts.visitors ?? []).includes(id),
    save: (name, value) => void saved.set(name, JSON.parse(JSON.stringify(value))),
    load: (name) => saved.get(name),
    worlds: () => [],
    toWorld: async () => undefined,
    who: (id) => (at.has(id) ? { name: `General ${id}`, color: "#f07356" } : null),
    tabOf: (id) => tabs.get(id) ?? null,
    remove: (ids) => {
      removed.push(...ids);
      for (const id of ids) build.apply({ kind: "remove", id });
    },
    wear: (_p, hits) => void worn.push(...hits.map(([id, n]) => [id, n] as [string, number])),
    test: () => opts.test === true,
  };
  room.memory = server.open!(room);
  const sim = () => (room.memory as { sim: Sim }).sim;
  /** Lets the clock run: the war steps as it would. */
  const run = (seconds: number) => {
    const end = now + seconds * 1000;
    while (now < end) {
      now += 50;
      vi.setSystemTime(now);
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    }
  };
  const join = (id: string, tab = `tab-of-${id}`) => {
    at.set(id, [0, 0.9, 0]);
    tabs.set(id, tab);
    server.joined!(room, id);
    const g = sim().generalOf(id);
    if (g) at.set(id, [STARTS[g.start]!.spawn[0], 0.9, STARTS[g.start]!.spawn[1]]);
    return g;
  };
  const leave = (id: string) => {
    at.delete(id);
    server.left!(room, id);
  };
  const to = (id: string) => sent.filter((s) => s.to === id).map((s) => s.msg);
  /** Every unit a page has been told of and not told is gone: id → owner. */
  const knows = (id: string) => {
    const units = new Map<number, number>();
    for (const msg of to(id)) {
      if (msg.m !== "tick") continue;
      for (let i = 0; i < (msg.u?.length ?? 0); i += UNIT_FIELDS) units.set(msg.u![i]!, msg.u![i + 1]! & 15);
      for (let i = 0; i < (msg.x?.length ?? 0); i += 2) units.delete(msg.x![i]!);
    }
    return units;
  };
  const buildings = (id: string) => {
    const known = new Map<number, number>();
    for (const msg of to(id)) {
      if (msg.m !== "tick") continue;
      for (const b of msg.b ?? []) known.set(b.i, b.o);
      for (let i = 0; i < (msg.bx?.length ?? 0); i += 2) known.delete(msg.bx![i]!);
    }
    return known;
  };
  return { room, build, sim, sent, flown, removed, worn, saved, at, run, join, leave, to, knows, buildings, say: (id: string, msg: unknown) => server.message!(room, id, msg) };
}

describe("who is a general", () => {
  it("someone who may command gets a place, a start and their bank; a visitor watches", () => {
    const r = fakeRoom({ visitors: ["v"] });
    const g = r.join("a")!;
    expect(g).not.toBeNull();
    const you = r.to("a").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(g.slot);
    expect(you.start).toEqual([...STARTS[g.start]!.spawn]);
    expect(you.pids).toEqual(["a"]);
    expect(r.to("a").some((m) => m.m === "fields")).toBe(true);
    expect(r.join("v")).toBeNull();
    const watching = r.to("v").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(watching.slot).toBe(-1);
    expect(watching.why).toBe("visitor");
    r.run(2);
    const bank = r.to("a").filter((m) => m.m === "res").pop() as Extract<ToPage, { m: "res" }>;
    expect(bank.l).toBeGreaterThanOrEqual(START_LITHIUM);
    expect(bank.used).toBe(4);
    expect(r.to("v").some((m) => m.m === "res")).toBe(false);
    // Everyone is told who the generals are.
    const gens = r.to("v").filter((m) => m.m === "gens").pop() as Extract<ToPage, { m: "gens" }>;
    expect(gens.g.some((x) => x.slot === g.slot && x.pid === "a")).toBe(true);
  });

  it("a ninth waits, and takes the place of the first general to go for good", () => {
    const r = fakeRoom();
    r.say("p0", { m: "bots", n: 0 });
    for (let i = 0; i < MAX_GENERALS; i++) expect(r.join(`p${i}`)).not.toBeNull();
    r.say("p0", { m: "bots", n: 0 });
    expect(r.join("late")).toBeNull();
    expect((r.to("late").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>).why).toBe("full");
    r.run(3);
    r.leave("p3");
    r.run(LEAVE_GRACE + 4);
    const g = r.sim().generalOf("late");
    expect(g).not.toBeNull();
    const again = r.to("late").filter((m) => m.m === "you").pop() as Extract<ToPage, { m: "you" }>;
    expect(again.slot).toBe(g!.slot);
  });

  it("a computer general is there to fight when one person is, and makes way when the places run out", () => {
    const r = fakeRoom();
    r.join("a");
    r.run(2);
    expect(r.sim().generals.filter((g) => g?.ai)).toHaveLength(1);
    for (let i = 0; i < MAX_GENERALS - 1; i++) expect(r.join(`p${i}`)).not.toBeNull();
    r.run(2);
    expect(r.sim().generals.filter((g) => g?.ai)).toHaveLength(0);
    expect(r.sim().generals.every((g) => g !== null)).toBe(true);
  });
});

describe("what a page is told", () => {
  it("its own army and what that sees: never an enemy out of sight", () => {
    const r = fakeRoom();
    const a = r.join("a")!, b = r.join("b")!;
    r.say("a", { m: "bots", n: 0 });
    r.run(3);
    const mine = (id: string, slot: number) => [...r.knows(id).values()].filter((o) => o === slot).length;
    expect(mine("a", a.slot)).toBe(4);
    expect(mine("b", b.slot)).toBe(4);
    // Each a long way from the other: nothing of the other's has been sent.
    expect(mine("a", b.slot)).toBe(0);
    expect(mine("b", a.slot)).toBe(0);
    expect([...r.buildings("a").values()]).toEqual([a.slot]);
    for (const msg of r.to("a")) {
      if (msg.m !== "tick") continue;
      for (let i = 0; i < (msg.u?.length ?? 0); i += UNIT_FIELDS) expect(msg.u![i + 1]! & 15).not.toBe(b.slot);
      expect((msg.b ?? []).every((x) => x.o !== b.slot)).toBe(true);
    }

    // A scout of A's beside B's base: A is told of B's Core and Haulers. B is told of the scout.
    const sb = STARTS[b.start]!;
    const scout = r.sim().addUnit("scout", a.slot, sb.spawn[0], sb.spawn[1]);
    r.run(2);
    expect(mine("a", b.slot)).toBeGreaterThan(0);
    expect([...r.buildings("a").values()]).toContain(b.slot);
    expect(r.knows("b").get(scout.id)).toBe(a.slot);

    // The scout is gone: B's Haulers are out of A's sight again (told so), but the Core is remembered as it was.
    r.sim().kill(scout, false);
    r.run(2);
    expect(mine("a", b.slot)).toBe(0);
    expect([...r.buildings("a").values()]).toContain(b.slot);
    expect(r.knows("b").has(scout.id)).toBe(false);
  });

  it("someone watching sees everything", () => {
    const r = fakeRoom({ visitors: ["v"] });
    const a = r.join("a")!, b = r.join("b")!;
    r.join("v");
    r.run(2);
    const owners = new Set(r.knows("v").values());
    expect(owners.has(a.slot) && owners.has(b.slot)).toBe(true);
    expect(new Set(r.buildings("v").values()).size).toBeGreaterThanOrEqual(2);
  });

  it("allies see what each other sees", () => {
    const r = fakeRoom();
    const a = r.join("a")!, b = r.join("b")!;
    r.say("a", { m: "bots", n: 0 });
    r.say("a", { m: "ally", slot: b.slot });
    r.say("b", { m: "ally", slot: a.slot });
    r.run(2);
    expect(r.sim().hostile(a.slot, b.slot)).toBe(false);
    expect([...r.knows("a").values()].filter((o) => o === b.slot).length).toBe(4);
    expect([...r.buildings("a").values()].sort()).toEqual([a.slot, b.slot].sort());
  });
});

describe("orders from pages", () => {
  it("move a general's own units, and nobody else's; nonsense is ignored", () => {
    const r = fakeRoom({ test: true });
    const a = r.join("a")!, b = r.join("b")!;
    const mine = r.sim().units.filter((u) => u.owner === a.slot).map((u) => u.id);
    const theirs = r.sim().units.filter((u) => u.owner === b.slot);
    const before = theirs.map((u) => u.order.k);
    r.say("a", { m: "order", ids: theirs.map((u) => u.id), k: "stop" });
    expect(theirs.map((u) => u.order.k)).toEqual(before);
    r.say("a", { m: "order", ids: mine, k: "move", at: [100, 0, 100] });
    expect(r.sim().unitById.get(mine[0]!)!.order.k).toBe("move");
    for (const bad of [null, 7, "x", {}, { m: "order" }, { m: "order", ids: "all", k: "stop" }, { m: "order", ids: [1.5], k: "stop" }, { m: "order", ids: mine, k: "move", at: [NaN, 0, 0] }, { m: "build", kind: "palace", x: 1, z: 1 }, { m: "make", id: "core", kind: "hauler" }, { m: "order", ids: mine, k: "attack", on: [9, 1] }]) {
      expect(() => r.say("a", bad)).not.toThrow();
    }
    // A refusal comes back in words.
    r.say("a", { m: "build", kind: "foundry", x: 0, z: 0 });
    expect(r.to("a").some((m) => m.m === "no")).toBe(true);
  });

  it("what is only for checks is refused outside a test room", () => {
    const live = fakeRoom();
    const g = live.join("a")!;
    live.say("a", { m: "dev", do: "rich" });
    live.say("a", { m: "dev", do: "spawn", kind: "titan", n: 50 });
    expect(g.lithium).toBe(START_LITHIUM);
    expect(live.sim().units.some((u) => u.kind === "titan")).toBe(false);
    const test = fakeRoom({ test: true });
    const t = test.join("a")!;
    test.say("a", { m: "dev", do: "rich" });
    expect(t.lithium).toBeGreaterThan(10_000);
  });
});

describe("pieces", () => {
  it("cost lithium, and go with their general", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    const wall: Piece = { id: "a-1", type: "wall", x: 60, y: 0, z: 60, rot: 0, material: "wood", edit: 0 };
    expect(server.mayPlace!(r.room, "a", wall)).toBe(true);
    r.build.apply({ kind: "place", piece: wall });
    server.placed!(r.room, "a", [wall]);
    expect(g.lithium).toBe(START_LITHIUM - PIECE_COST.wood);
    expect(server.mayChange!(r.room, "a", wall, "remove")).toBe(true);
    r.join("b");
    expect(server.mayChange!(r.room, "b", wall, "remove")).toBe(false);
    expect(server.mayPlace!(r.room, "nobody", { ...wall, id: "nobody-1", x: 61 })).toBe(false);
    const core = [...r.sim().buildings.values()].find((b) => b.owner === g.slot)!;
    expect(server.blocks!(r.room, { ...wall, id: "a-2", type: "floor", x: core.cx + 1, z: core.cz + 1 })).toBe(true);
    r.run(1);
    r.leave("a");
    r.run(LEAVE_GRACE + 4);
    expect(r.removed).toContain("a-1");
    expect(r.build.size).toBe(0);
  });

  it("left over from an old war are cleared when a new one begins", () => {
    const r = fakeRoom();
    r.build.apply({ kind: "place", piece: { id: "old-1", type: "wall", x: 3, y: 0, z: 3, rot: 0, material: "wood", edit: 0 } });
    r.join("a");
    expect(r.removed).toEqual(["old-1"]);
  });
});

describe("leaving and sleeping", () => {
  it("the same tab back in time is the same general", () => {
    const r = fakeRoom();
    const g = r.join("a", "tab-one-xyz")!;
    r.run(2);
    r.leave("a");
    r.run(10);
    const back = r.join("a2", "tab-one-xyz")!;
    expect(back).toBe(g);
    const you = r.to("a2").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(g.slot);
    expect(you.pids).toEqual(["a", "a2"]);
    r.run(LEAVE_GRACE + 5);
    expect(r.sim().generals[g.slot]).toBe(g);
    // Everything of theirs is sent to the new page afresh.
    expect([...r.knows("a2").values()].filter((o) => o === g.slot).length).toBeGreaterThanOrEqual(4);
  });

  it("with nobody left the war stops, and nothing of it remains", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    r.run(3);
    expect(r.sim().generals.some((x) => x?.ai)).toBe(true);
    r.leave("a");
    r.run(LEAVE_GRACE + 6);
    expect(r.sim().generals.every((x) => x === null)).toBe(true);
    expect(r.sim().units.every((u) => u.owner === 8)).toBe(true);
    expect(r.sim().buildings.size).toBe(0);
    expect(g.slot).toBeGreaterThanOrEqual(0);
    // The clock is no longer running the war.
    const t = r.sim().t;
    r.run(5);
    expect(r.sim().t).toBe(t);
  });

  it("a room that sleeps and wakes carries the war on; one long asleep starts afresh", () => {
    const first = fakeRoom();
    const g = first.join("a", "tab-keep-1")!;
    g.lithium = 1234;
    first.run(12);
    expect(first.saved.has("war")).toBe(true);
    const units = first.sim().units.length;

    // Woken a moment later, with the same builder still connected.
    const second = fakeRoom({ saved: first.saved });
    second.at.set("a", [0, 0.9, 0]);
    // (The room is opened before anyone is known to be there: the general is taken to have left, and comes back by their tab.)
    expect(second.sim().units.length).toBe(units);
    const back = second.join("a", "tab-keep-1")!;
    expect(back.slot).toBe(g.slot);
    expect(back.lithium).toBeGreaterThanOrEqual(1234);

    now += 10 * 60_000;
    vi.setSystemTime(now);
    const third = fakeRoom({ saved: first.saved });
    expect(third.sim().generals.every((x) => x === null)).toBe(true);
  });
});

describe("the general's own gun", () => {
  it("stops at the first building or unit in its line, and its blast hurts whatever is there, anyone's", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    r.say("a", { m: "bots", n: 0 });
    const core = [...r.sim().buildings.values()].find((b) => b.owner === g.slot)!;
    const c = r.sim().centreOf(core);
    // A level shot from 60 m off, straight through the Core, 3 m up.
    const flight = { from: [c[0] - 60, 3, c[2]] as Vec, v: [200, 0, 0] as Vec, time: 0.6, g: 0 };
    const hit = server.shotHits!(r.room, flight)!;
    expect(hit).not.toBeNull();
    expect(hit.point[0]).toBeGreaterThan(c[0] - 9);
    expect(hit.point[0]).toBeLessThan(c[0]);
    // The same shot a long way to one side (toward the middle of the map, over open ground) meets nothing of the war's.
    const aside = c[2] + (c[2] > 0 ? -120 : 120);
    expect(server.shotHits!(r.room, { ...flight, from: [c[0] - 60, 3, aside] })).toBeNull();
    // A unit in the way stops it too.
    const tank = r.sim().addUnit("tank", g.slot, c[0] - 30, aside);
    r.run(0.3);
    const stopped = server.shotHits!(r.room, { ...flight, from: [c[0] - 60, 1.2, tank.z] })!;
    expect(Math.abs(stopped.point[0] - tank.x)).toBeLessThan(2.5);
    const hp = tank.hp;
    server.struck!(r.room, [tank.x + 1, 0.5, tank.z]);
    expect(tank.hp).toBeLessThan(hp);
  });
});

describe("a room that wakes with pages still connected", () => {
  it("knows them again as soon as anyone says anything", () => {
    const first = fakeRoom({ visitors: ["v"] });
    first.join("a", "tab-wake-1");
    first.run(12);
    // The room's memory is gone (it slept, or was moved to new code); the two pages are still connected.
    const second = fakeRoom({ saved: first.saved, visitors: ["v"] });
    second.at.set("a", [0, 0.9, 0]);
    second.at.set("v", [0, 0.9, 0]);
    second.say("v", { m: "bots", n: 0 });
    second.run(2);
    // The watcher is watching again, and is sent the war.
    expect(second.to("v").some((m) => m.m === "you")).toBe(true);
    expect(second.knows("v").size).toBeGreaterThan(0);
    expect(second.to("a").some((m) => m.m === "tick")).toBe(true);
  });
});

describe("a war never runs wild", () => {
  it("with no page connected to the room at all, it ends, even if no general was ever said to have left", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    r.run(3);
    // The page is gone, and the room was never told (it was moved onto new code, say).
    r.at.delete("a");
    r.run(LEAVE_GRACE + 20);
    expect(r.sim().generals[g.slot]).not.toBeNull();
    r.run(20);
    expect(r.sim().generals.every((x) => x === null)).toBe(true);
    const t = r.sim().t;
    r.run(5);
    expect(r.sim().t).toBe(t);
  });

  it("a fault in the war ends it and clears it, and everyone is told; the room carries on", () => {
    const r = fakeRoom();
    r.join("a");
    r.run(2);
    const sim = r.sim();
    const tick = sim.tick.bind(sim);
    let broken = true;
    sim.tick = () => {
      if (broken) throw new Error("a fault, for the test");
      tick();
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    r.run(1);
    quiet.mockRestore();
    expect(sim.generals.every((x) => x === null)).toBe(true);
    expect(r.to("a").some((m) => m.m === "note" && /fault/.test(m.text))).toBe(true);
    // Nothing is left running; and joining again starts a new war.
    const t = sim.t;
    r.run(3);
    expect(sim.t).toBe(t);
    broken = false;
    r.leave("a");
    expect(r.join("a2")).not.toBeNull();
    r.run(2);
    expect(sim.t).toBeGreaterThan(t);
  });
});

describe("the kit on the wire", () => {
  it("fits: sixteen kinds of unit and nine owners at most in one number", () => {
    expect(UNIT_KINDS.length).toBeLessThanOrEqual(16);
    expect(MAX_GENERALS + 1).toBeLessThanOrEqual(16);
  });
});
