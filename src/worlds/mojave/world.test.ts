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
  it("someone who may command takes a computer's place over at once, as it stands; a visitor is kept out, and sent nothing of the war", () => {
    const r = fakeRoom({ visitors: ["v"] });
    // Eight generals before anyone comes: all computers.
    expect(r.sim().generals.every((x) => x?.ai)).toBe(true);
    const buildings = r.sim().buildings.size, units = r.sim().units.length;
    const g = r.join("a")!;
    expect(g).not.toBeNull();
    expect(g.ai).toBe(false);
    expect(g.name).toBe("General a");
    // Nothing was begun afresh for them.
    expect(r.sim().buildings.size).toBe(buildings);
    expect(r.sim().units.length).toBe(units);
    const you = r.to("a").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(g.slot);
    expect(you.start).toEqual([...STARTS[g.start]!.spawn]);
    expect(you.pids).toEqual(["a"]);
    expect(r.to("a").some((m) => m.m === "fields")).toBe(true);
    expect(r.join("v")).toBeNull();
    const out = r.to("v").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(out.slot).toBe(-1);
    expect(out.why).toBe("visitor");
    r.run(3);
    const bank = r.to("a").filter((m) => m.m === "res").pop() as Extract<ToPage, { m: "res" }>;
    expect(bank.l).toBeGreaterThanOrEqual(START_LITHIUM);
    expect(bank.used).toBeGreaterThanOrEqual(4);
    const gens = r.to("a").filter((m) => m.m === "gens").pop() as Extract<ToPage, { m: "gens" }>;
    expect(gens.g).toHaveLength(MAX_GENERALS);
    expect(gens.g.some((x) => x.slot === g.slot && x.pid === "a" && !x.ai)).toBe(true);
    // The visitor was told who they are (nobody) once, and nothing else: nobody watches.
    expect(r.to("v").map((m) => m.m)).toEqual(["you"]);
  });

  it("a ninth person waits, and is let in the moment a place opens", () => {
    const r = fakeRoom();
    for (let i = 0; i < MAX_GENERALS; i++) expect(r.join(`p${i}`)).not.toBeNull();
    expect(r.sim().generals.some((g) => g?.ai)).toBe(false);
    expect(r.join("late")).toBeNull();
    expect((r.to("late").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>).why).toBe("full");
    r.run(3);
    // Told once, not every second; and sent nothing of the war.
    expect(r.to("late").map((m) => m.m)).toEqual(["you"]);
    r.leave("p3");
    // The place is kept for the one who left, for the grace period: a computer plays it.
    r.run(LEAVE_GRACE - 10);
    expect(r.sim().generalOf("late")).toBeNull();
    expect(r.sim().generals[3]!.ai).toBe(true);
    r.run(14);
    const g = r.sim().generalOf("late");
    expect(g?.slot).toBe(3);
    const again = r.to("late").filter((m) => m.m === "you").pop() as Extract<ToPage, { m: "you" }>;
    expect(again.slot).toBe(3);
    expect(r.to("late").some((m) => m.m === "tick")).toBe(true);
  });

  it("there are always eight: a computer plays every place no person holds, and nobody can add or remove one", () => {
    const r = fakeRoom();
    r.join("a");
    r.run(2);
    expect(r.sim().generals.filter((g) => g?.ai)).toHaveLength(MAX_GENERALS - 1);
    r.say("a", { m: "bots", n: 0 });
    r.run(2);
    expect(r.sim().generals.filter((g) => g?.ai)).toHaveLength(MAX_GENERALS - 1);
    for (let i = 0; i < 3; i++) expect(r.join(`p${i}`)).not.toBeNull();
    r.run(2);
    expect(r.sim().generals.filter((g) => g?.ai)).toHaveLength(MAX_GENERALS - 4);
    expect(r.sim().generals.every((g) => g !== null)).toBe(true);
  });

  it("there are no alliances: an old page asking for one is ignored", () => {
    const r = fakeRoom();
    const a = r.join("a")!, b = r.join("b")!;
    r.say("a", { m: "ally", slot: b.slot });
    r.say("b", { m: "ally", slot: a.slot });
    r.run(2);
    expect(r.sim().hostile(a.slot, b.slot)).toBe(true);
  });
});

describe("what a page is told", () => {
  it("its own army and what that sees: never an enemy out of sight", () => {
    const r = fakeRoom({ test: true });
    const a = r.join("a")!, b = r.join("b")!;
    r.say("a", { m: "dev", do: "quiet" });
    r.run(3);
    const mine = (id: string, slot: number) => [...r.knows(id).values()].filter((o) => o === slot).length;
    expect(mine("a", a.slot)).toBe(4);
    expect(mine("b", b.slot)).toBe(4);
    // Each a long way from every other general: nothing of anyone else's has been sent.
    expect([...r.knows("a").values()].every((o) => o === a.slot || o === 8)).toBe(true);
    expect([...r.knows("b").values()].every((o) => o === b.slot || o === 8)).toBe(true);
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

    // The scout is gone: B's Haulers are out of A's sight again (told so: out of sight, not destroyed), but the Core is remembered as it was.
    const lostBefore = r.to("a").flatMap((m) => (m.m === "tick" ? (m.x ?? []) : [])).length;
    r.sim().kill(scout, false);
    r.run(2);
    expect(mine("a", b.slot)).toBe(0);
    const lost = r.to("a").flatMap((m) => (m.m === "tick" ? (m.x ?? []) : [])).slice(lostBefore);
    // (id, why) pairs: B's Haulers went out of sight (0), nothing of B's was destroyed.
    const whys = lost.filter((_, i) => i % 2 === 1);
    expect(whys.filter((w) => w === 0).length).toBeGreaterThanOrEqual(4);
    expect([...r.buildings("a").values()]).toContain(b.slot);
    expect(r.knows("b").has(scout.id)).toBe(false);
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
    // A place begun afresh for a check: a Core, four Haulers, the first lithium, and the same general in it.
    test.sim().addUnit("tank", t.slot, 0, 0);
    test.say("a", { m: "dev", do: "fresh" });
    const again = test.sim().generalOf("a")!;
    expect(again.slot).toBe(t.slot);
    expect(again.lithium).toBe(START_LITHIUM);
    expect(test.sim().units.filter((u) => u.owner === t.slot).map((u) => u.kind)).toEqual(["hauler", "hauler", "hauler", "hauler"]);
  });
});

describe("pieces", () => {
  it("cost lithium, and stay with the place they were built for, whoever commands it", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    const wall: Piece = { id: "a-1", type: "wall", x: 60, y: 0, z: 60, rot: 0, material: "wood", edit: 0 };
    expect(server.mayPlace!(r.room, "a", wall)).toBe(true);
    r.build.apply({ kind: "place", piece: wall });
    server.placed!(r.room, "a", [wall]);
    expect(g.lithium).toBe(START_LITHIUM - PIECE_COST);
    expect(server.mayChange!(r.room, "a", wall, "remove")).toBe(true);
    r.join("b");
    expect(server.mayChange!(r.room, "b", wall, "remove")).toBe(false);
    expect(server.mayPlace!(r.room, "nobody", { ...wall, id: "nobody-1", x: 61 })).toBe(false);
    const core = [...r.sim().buildings.values()].find((b) => b.owner === g.slot)!;
    expect(server.blocks!(r.room, { ...wall, id: "a-2", type: "floor", x: core.cx + 1, z: core.cz + 1 })).toBe(true);
    // Nobody builds a siege engine here.
    g.lithium = 10_000;
    expect(server.mayPlace!(r.room, "a", { ...wall, id: "a-3", type: "trebuchet", x: 70 })).toBe(false);
    r.run(1);
    // The builder goes, for good: the wall stands, and is the next commander's.
    r.leave("a");
    r.run(LEAVE_GRACE + 4);
    expect(r.removed).toHaveLength(0);
    expect(r.build.size).toBe(1);
    expect(r.sim().ownerOfPiece("a-1")).toBe(g.slot);
  });

  it("left over from before a war began are cleared; and so is a siege engine left standing from when there were such things", () => {
    const r = fakeRoom();
    r.build.apply({ kind: "place", piece: { id: "old-1", type: "wall", x: 3, y: 0, z: 3, rot: 0, material: "wood", edit: 0 } });
    r.join("a");
    expect(r.removed).toEqual(["old-1"]);
    r.build.apply({ kind: "place", piece: { id: "a-9", type: "trebuchet", x: 30, y: 0, z: 30, rot: 0, material: "wood", edit: 0 } });
    r.build.apply({ kind: "place", piece: { id: "a-8", type: "wall", x: 40, y: 0, z: 40, rot: 0, material: "wood", edit: 0 } });
    r.join("b");
    expect(r.removed).toEqual(["old-1", "a-9"]);
    // (And the general's own gun went with the engines: the war has no say in shots.)
    expect(server.shotHits).toBeUndefined();
    expect(server.struck).toBeUndefined();
  });
});

describe("leaving and sleeping", () => {
  it("the same tab back in time has their place back", () => {
    const r = fakeRoom();
    const g = r.join("a", "tab-one-xyz")!;
    r.join("other");
    r.run(2);
    r.leave("a");
    r.run(10);
    expect(g.ai).toBe(true);
    const back = r.join("a2", "tab-one-xyz")!;
    expect(back).toBe(g);
    expect(back.ai).toBe(false);
    const you = r.to("a2").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(g.slot);
    expect(you.pids).toEqual(["a", "a2"]);
    r.run(LEAVE_GRACE + 5);
    expect(r.sim().generals[g.slot]).toBe(g);
    // Everything of theirs is sent to the new page afresh.
    expect([...r.knows("a2").values()].filter((o) => o === g.slot).length).toBeGreaterThanOrEqual(4);
  });

  it("with nobody here the war is paused, kept exactly as it stands; the next person starts it again", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    r.run(3);
    const units = r.sim().units.length, buildings = r.sim().buildings.size;
    r.leave("a");
    // The clock stops at once: the computers do not fight on alone.
    r.run(1);
    const t = r.sim().t;
    r.run(LEAVE_GRACE + 30);
    expect(r.sim().t).toBe(t);
    expect(r.sim().generals.every((x) => x?.ai)).toBe(true);
    expect(r.sim().units.length).toBe(units);
    expect(r.sim().buildings.size).toBe(buildings);
    expect(r.saved.has("war")).toBe(true);
    // Someone comes: it carries on from there.
    const b = r.join("b")!;
    expect(b.slot).not.toBe(g.slot);
    r.run(3);
    expect(r.sim().t).toBeGreaterThan(t + 2);
  });

  it("a room that sleeps and wakes carries the war on, however long it slept", () => {
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
    second.run(12);

    // Days later: the same war, all eight generals, nothing begun afresh.
    now += 3 * 24 * 3600_000;
    vi.setSystemTime(now);
    const third = fakeRoom({ saved: second.saved });
    expect(third.sim().generals.every((x) => x?.ai)).toBe(true);
    expect(third.sim().generals[g.slot]!.lithium).toBeGreaterThanOrEqual(1234);
    expect(third.sim().units.length).toBeGreaterThanOrEqual(units);
    expect(third.sim().t).toBeGreaterThan(20);
  });

  it("a war saved before there were always eight is taken up: its generals kept, the empty places filled, no alliances", () => {
    const first = fakeRoom();
    const g = first.join("a", "tab-old-1")!;
    first.run(12);
    // As an old save had it: some places empty, two generals allied, the person not yet handed to a computer.
    const old = JSON.parse(JSON.stringify(first.saved.get("war"))) as { sim: { generals: (Record<string, unknown> | null)[]; units: { owner: number }[]; buildings: { owner: number }[]; truces?: unknown } };
    for (const slot of [5, 6, 7]) {
      old.sim.generals[slot] = null;
      old.sim.units = old.sim.units.filter((u) => u.owner !== slot);
      old.sim.buildings = old.sim.buildings.filter((b) => b.owner !== slot);
    }
    old.sim.generals[g.slot]!.team = 100;
    old.sim.generals[1]!.team = 100;
    old.sim.generals[g.slot]!.asked = [1];
    old.sim.generals[g.slot]!.color = "#123456";
    old.sim.truces = [];
    const saved = new Map<string, unknown>([["war", old]]);
    const second = fakeRoom({ saved });
    const sim = second.sim();
    expect(sim.generals.every((x) => x !== null)).toBe(true);
    expect(sim.generals[g.slot]!.ai).toBe(true);
    expect(sim.hostile(g.slot, 1)).toBe(true);
    expect(new Set(sim.generals.map((x) => x!.color)).size).toBe(MAX_GENERALS);
    expect([...sim.buildings.values()].filter((b) => b.owner === 6 && b.kind === "core")).toHaveLength(1);
    expect(second.join("a2", "tab-old-1")!.slot).toBe(g.slot);
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
    second.say("v", { m: "order", ids: [1], k: "stop" });
    second.run(2);
    // The visitor is told again that there is no place for them, and nothing else; the general has the war again.
    expect(second.to("v").map((m) => m.m)).toEqual(["you"]);
    expect(second.sim().generalOf("a")).not.toBeNull();
    expect(second.to("a").some((m) => m.m === "tick")).toBe(true);
  });
});

describe("a war never runs wild", () => {
  it("with no page connected to the room at all, it pauses, even if no general was ever said to have left", () => {
    const r = fakeRoom();
    const g = r.join("a")!;
    r.run(3);
    // The page is gone, and the room was never told (it was moved onto new code, say).
    r.at.delete("a");
    r.run(LEAVE_GRACE + 20);
    expect(r.sim().generals[g.slot]!.pid).toBe("a");
    r.run(20);
    expect(r.sim().generals.every((x) => x?.ai)).toBe(true);
    const t = r.sim().t;
    r.run(5);
    expect(r.sim().t).toBe(t);
  });

  it("a fault in the war begins it afresh, and everyone is told; the room carries on, with its eight generals", () => {
    const r = fakeRoom();
    r.join("a");
    r.run(2);
    const sim = r.sim();
    const tick = sim.tick.bind(sim);
    let broken = true;
    sim.tick = () => {
      if (broken) {
        broken = false;
        throw new Error("a fault, for the test");
      }
      tick();
    };
    sim.addUnit("titan", 2, 0, 0);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    r.run(1);
    quiet.mockRestore();
    expect(r.to("a").some((m) => m.m === "note" && /fault/.test(m.text))).toBe(true);
    // Afresh: eight generals with a Core each and nothing more; the person is a general in it; and it runs.
    expect(sim.generals.every((x) => x !== null)).toBe(true);
    expect(sim.units.some((u) => u.kind === "titan")).toBe(false);
    expect([...sim.buildings.values()].filter((b) => b.kind === "core")).toHaveLength(MAX_GENERALS);
    expect(sim.generalOf("a")).not.toBeNull();
    const t = sim.t;
    r.run(3);
    expect(sim.t).toBeGreaterThan(t + 2);
  });
});

describe("the kit on the wire", () => {
  it("fits: sixteen kinds of unit and nine owners at most in one number", () => {
    expect(UNIT_KINDS.length).toBeLessThanOrEqual(16);
    expect(MAX_GENERALS + 1).toBeLessThanOrEqual(16);
  });
});
