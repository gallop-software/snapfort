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
  /** A builder comes in; with `slot`, they choose that army to serve at once. Gives back the army they serve (null: none yet). */
  const join = (id: string, slot = -1, tab = `tab-of-${id}`) => {
    at.set(id, [0, 0.9, 0]);
    tabs.set(id, tab);
    server.joined!(room, id);
    if (slot >= 0) server.message!(room, id, { m: "serve", slot });
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
  it("someone who may command chooses a colour and an army is begun for them; a visitor is kept out, and sent nothing of the war", () => {
    const r = fakeRoom({ visitors: ["v"] });
    // No army before anyone comes: there is one only for someone playing.
    expect(r.sim().generals.every((x) => x === null)).toBe(true);
    const buildings = r.sim().buildings.size, units = r.sim().units.length;
    // Arriving: asked to choose, told the eight colours (nobody serving any), and sent nothing else of the war.
    expect(r.join("a")).toBeNull();
    const first = r.to("a").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(first.slot).toBe(-1);
    expect(first.why).toBe("choose");
    const list = r.to("a").find((m) => m.m === "gens") as Extract<ToPage, { m: "gens" }>;
    expect(list.g.map((x) => x.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(list.g.map((x) => x.color)).size).toBe(MAX_GENERALS);
    expect(list.g.every((x) => x.pids.length === 0)).toBe(true);
    r.run(3);
    expect(r.to("a").some((m) => m.m === "tick" || m.m === "res" || m.m === "fields")).toBe(false);
    // Choosing: an army of their own, begun for them (a Core, four Haulers, the first lithium), and they command it at once.
    r.say("a", { m: "serve", slot: 2 });
    const g = r.sim().generalOf("a")!;
    expect(g.slot).toBe(2);
    expect(g.lithium).toBe(START_LITHIUM);
    expect(r.sim().buildings.size).toBe(buildings + 1);
    expect(r.sim().units.length).toBe(units + 4);
    const you = r.to("a").filter((m) => m.m === "you").pop() as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(2);
    // (Where to stand: before the army's Core, on the side toward the middle of the map.)
    expect(Math.hypot(you.start![0] - STARTS[g.start]!.spawn[0], you.start![1] - STARTS[g.start]!.spawn[1])).toBeLessThan(1);
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
    expect(gens.g.find((x) => x.slot === 2)!.pids).toEqual(["a"]);
    // The visitor was told who they are (nobody) once, and nothing else: nobody watches.
    expect(r.to("v").map((m) => m.m)).toEqual(["you"]);
    // Someone who may not command cannot choose an army either.
    r.say("v", { m: "serve", slot: 2 });
    expect(r.sim().generalOf("v")).toBeNull();
  });

  it("any number of generals serve one army, and share all of it: its bank, its units, its sight", () => {
    const r = fakeRoom({ test: true });
    for (let i = 0; i < 11; i++) expect(r.join(`p${i}`, 3)?.slot).toBe(3);
    expect(r.sim().generals[3]!.here).toHaveLength(11);
    r.run(3);
    const banks = ["p0", "p7"].map((id) => (r.to(id).filter((m) => m.m === "res").pop() as Extract<ToPage, { m: "res" }>).l);
    expect(banks[0]).toBe(banks[1]);
    const trooper = r.sim().addUnit("trooper", 3, STARTS[r.sim().generals[3]!.start]!.spawn[0], STARTS[r.sim().generals[3]!.start]!.spawn[1]);
    // Either may order the army's units; what one spends is spent for both.
    r.say("p7", { m: "order", ids: [trooper.id], k: "hold" });
    expect(trooper.order.k).toBe("hold");
    r.say("p0", { m: "dev", do: "rich" });
    r.run(1);
    const rich = (r.to("p7").filter((m) => m.m === "res").pop() as Extract<ToPage, { m: "res" }>).l;
    expect(rich).toBeGreaterThan(10_000);
    expect([...r.knows("p7").values()].filter((o) => o === 3).length).toBe(5);
    const gens = r.to("p2").filter((m) => m.m === "gens").pop() as Extract<ToPage, { m: "gens" }>;
    expect(gens.g.find((x) => x.slot === 3)!.pids).toHaveLength(11);
  });

  it("a general changes sides at any moment: they command the other army from then, and are sent what it sees and nothing of the one they left", () => {
    const r = fakeRoom();
    const a = r.join("a", 0)!;
    r.join("b", 5);
    r.run(3);
    expect([...r.knows("a").values()].filter((o) => o === 0).length).toBe(4);
    const before = r.sent.length;
    r.say("a", { m: "serve", slot: 5 });
    expect(r.sim().generalOf("a")!.slot).toBe(5);
    expect(a.here).toHaveLength(0);
    r.at.set("a", [STARTS[5]!.spawn[0], 0.9, STARTS[5]!.spawn[1]]);
    const you = r.to("a").filter((m) => m.m === "you").pop() as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(5);
    expect(Math.hypot(you.start![0] - STARTS[5]!.spawn[0], you.start![1] - STARTS[5]!.spawn[1])).toBeLessThan(1);
    r.run(3);
    // Everything since: of the army they serve now (and the sentries), never of the one they left.
    for (const { to, msg } of r.sent.slice(before)) {
      if (to !== "a" || msg.m !== "tick") continue;
      for (let i = 0; i < (msg.u?.length ?? 0); i += UNIT_FIELDS) expect(msg.u![i + 1]! & 15).not.toBe(0);
      expect((msg.b ?? []).every((x) => x.o !== 0)).toBe(true);
    }
    // The army they left stands, with nobody: nothing of it was removed, and nobody plays it.
    expect(r.sim().units.filter((u) => u.owner === 0)).toHaveLength(4);
    expect([...r.sim().buildings.values()].filter((x) => x.owner === 0)).toHaveLength(1);
    // And they may go back within the minute: it is theirs, as it stands.
    r.say("a", { m: "serve", slot: 0 });
    expect(r.sim().generalOf("a")).toBe(a);
    // Nonsense is ignored.
    for (const bad of [{ m: "serve" }, { m: "serve", slot: 9 }, { m: "serve", slot: -1 }, { m: "serve", slot: "blue" }, { m: "bots", n: 3 }, { m: "ally", slot: 1 }]) expect(() => r.say("a", bad)).not.toThrow();
    expect(r.sim().generalOf("a")!.slot).toBe(0);
  });

  it("no computer plays any army: alone, a general is alone, however long", () => {
    const r = fakeRoom();
    r.join("a", 0);
    r.run(240);
    for (let slot = 1; slot < MAX_GENERALS; slot++) expect(r.sim().generals[slot]).toBeNull();
    expect(r.sim().units.every((u) => u.owner === 0 || u.owner === MAX_GENERALS)).toBe(true);
    expect([...r.sim().buildings.values()].every((b) => b.owner === 0)).toBe(true);
  });
});

describe("what a page is told", () => {
  it("its own army and what that sees: never an enemy out of sight", () => {
    const r = fakeRoom({ test: true });
    const a = r.join("a", 0)!, b = r.join("b", 1)!;
    r.run(3);
    const mine = (id: string, slot: number) => [...r.knows(id).values()].filter((o) => o === slot).length;
    expect(mine("a", a.slot)).toBe(4);
    expect(mine("b", b.slot)).toBe(4);
    // Each a long way from every other army: nothing of anyone else's has been sent.
    expect([...r.knows("a").values()].every((o) => o === a.slot || o === 8)).toBe(true);
    expect([...r.knows("b").values()].every((o) => o === b.slot || o === 8)).toBe(true);
    expect([...r.buildings("a").values()]).toEqual([a.slot]);

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
    const whys = r.to("a").flatMap((m) => (m.m === "tick" ? (m.x ?? []) : [])).slice(lostBefore).filter((_, i) => i % 2 === 1);
    expect(whys.filter((w) => w === 0).length).toBeGreaterThanOrEqual(4);
    expect([...r.buildings("a").values()]).toContain(b.slot);
    expect(r.knows("b").has(scout.id)).toBe(false);
  });
});

describe("orders from pages", () => {
  it("move a general's own army's units, and nobody else's; nonsense is ignored", () => {
    const r = fakeRoom({ test: true });
    const a = r.join("a", 0)!, b = r.join("b", 1)!;
    const spawn = STARTS[a.start]!.spawn;
    const mine = [r.sim().addUnit("trooper", a.slot, spawn[0], spawn[1]).id];
    const theirs = [r.sim().addUnit("trooper", b.slot, STARTS[b.start]!.spawn[0], STARTS[b.start]!.spawn[1])];
    const before = theirs.map((u) => u.order.k);
    r.say("a", { m: "order", ids: theirs.map((u) => u.id), k: "hold" });
    expect(theirs.map((u) => u.order.k)).toEqual(before);
    r.say("a", { m: "order", ids: mine, k: "move", at: [100, 0, 100] });
    expect(r.sim().unitById.get(mine[0]!)!.order.k).toBe("move");
    // Its own Haulers take no orders at all: they are at work, and stay at work.
    const haulers = r.sim().units.filter((u) => u.owner === a.slot && u.kind === "hauler");
    r.say("a", { m: "order", ids: haulers.map((u) => u.id), k: "move", at: [100, 0, 100] });
    expect(haulers.every((u) => u.order.k === "gather")).toBe(true);
    for (const bad of [null, 7, "x", {}, { m: "order" }, { m: "order", ids: "all", k: "stop" }, { m: "order", ids: [1.5], k: "stop" }, { m: "order", ids: mine, k: "move", at: [NaN, 0, 0] }, { m: "build", kind: "palace", x: 1, z: 1 }, { m: "make", id: "x", kind: "tank" }]) {
      expect(() => r.say("a", bad)).not.toThrow();
    }
    // A refusal comes back in words.
    r.say("a", { m: "build", kind: "foundry", x: 0, z: 0 });
    expect(r.to("a").some((m) => m.m === "no")).toBe(true);
  });

  it("a building stands finished the moment it is paid for, where the general who ordered it stands near", () => {
    const r = fakeRoom({ test: true });
    const g = r.join("a", 0)!;
    r.say("a", { m: "dev", do: "rich" });
    const s = STARTS[g.start]!;
    const inX = -Math.sign(s.cx) || 1, inZ = -Math.sign(s.cz) || 1;
    r.say("a", { m: "build", kind: "foundry", x: s.cx + inX * 4, z: s.cz + inZ * 4 });
    const foundry = [...r.sim().buildings.values()].find((b) => b.kind === "foundry")!;
    expect(foundry.doneAt).toBe(0);
    r.say("a", { m: "make", id: foundry.id, kind: "trooper" });
    expect(foundry.queue).toHaveLength(1);
    r.run(1);
    const told = r.to("a").flatMap((m) => (m.m === "tick" ? (m.b ?? []) : [])).filter((b) => b.i === foundry.id).pop()!;
    expect(told.d).toBe(0);
    expect(told.q).toHaveLength(1);
  });

  it("what is bought or built is saved within a second or so: a room restarted just after takes the war up with it", () => {
    const r = fakeRoom({ test: true });
    const g = r.join("a", 0)!;
    r.say("a", { m: "dev", do: "rich" });
    // Just after the ten-second save: the next would be ten seconds off.
    r.run(10.5);
    const s = STARTS[g.start]!;
    const inX = -Math.sign(s.cx) || 1, inZ = -Math.sign(s.cz) || 1;
    for (let i = 0; i < 3; i++) r.say("a", { m: "build", kind: "relay", x: s.cx + inX * (5 + i * 2), z: s.cz + inZ * 5 });
    expect([...r.sim().buildings.values()].filter((b) => b.kind === "relay")).toHaveLength(3);
    r.run(1.5);
    // The room is restarted (a new version went out): it wakes with the three masts.
    const again = fakeRoom({ saved: r.saved, test: true });
    expect([...again.sim().buildings.values()].filter((b) => b.kind === "relay")).toHaveLength(3);
  });

  it("what is only for checks is refused outside a test room", () => {
    const live = fakeRoom();
    const g = live.join("a", 0)!;
    live.say("a", { m: "dev", do: "rich" });
    live.say("a", { m: "dev", do: "spawn", kind: "titan", n: 50 });
    expect(g.lithium).toBe(START_LITHIUM);
    expect(live.sim().units.some((u) => u.kind === "titan")).toBe(false);
    const test = fakeRoom({ test: true });
    const t = test.join("a", 0)!;
    test.join("b", 0);
    test.say("a", { m: "dev", do: "rich" });
    expect(t.lithium).toBeGreaterThan(10_000);
    // An army begun afresh for a check: a Core, four Haulers, the first lithium, and the same generals serving it.
    test.sim().addUnit("tank", t.slot, 0, 0);
    test.say("a", { m: "dev", do: "fresh" });
    const again = test.sim().generalOf("a")!;
    expect(again.slot).toBe(t.slot);
    expect(test.sim().generalOf("b")).toBe(again);
    expect(again.lithium).toBe(START_LITHIUM);
    expect(test.sim().units.filter((u) => u.owner === t.slot).map((u) => u.kind)).toEqual(["hauler", "hauler", "hauler", "hauler"]);
  });
});

describe("pieces", () => {
  it("cost lithium, and are the army's they were built for: whoever serves it may change them", () => {
    const r = fakeRoom();
    const g = r.join("a", 0)!;
    const s = STARTS[g.start]!;
    // By its Core (nowhere else: a wall goes where a turret may).
    const wall: Piece = { id: "a-1", type: "wall", x: s.cx + (-Math.sign(s.cx) || 1) * 5, y: 0, z: s.cz + (-Math.sign(s.cz) || 1) * 5, rot: 0, material: "wood", edit: 0 };
    expect(server.mayPlace!(r.room, "a", { ...wall, id: "a-0", x: 60, z: 60 })).toBe(false);
    expect(server.mayPlace!(r.room, "a", wall)).toBe(true);
    r.build.apply({ kind: "place", piece: wall });
    server.placed!(r.room, "a", [wall]);
    expect(g.lithium).toBe(START_LITHIUM - PIECE_COST);
    expect(server.mayChange!(r.room, "a", wall, "remove")).toBe(true);
    r.join("b", 1);
    r.join("c", 0);
    expect(server.mayChange!(r.room, "b", wall, "remove")).toBe(false);
    expect(server.mayChange!(r.room, "c", wall, "remove")).toBe(true);
    expect(server.mayPlace!(r.room, "nobody", { ...wall, id: "nobody-1", x: 61 })).toBe(false);
    const core = [...r.sim().buildings.values()].find((b) => b.owner === g.slot)!;
    expect(server.blocks!(r.room, { ...wall, id: "a-2", type: "floor", x: core.cx + 1, z: core.cz + 1 })).toBe(true);
    // Nobody builds a siege engine here.
    g.lithium = 10_000;
    expect(server.mayPlace!(r.room, "a", { ...wall, id: "a-3", type: "trebuchet", x: 70 })).toBe(false);
    r.run(1);
    // The builder changes sides: the wall stays the army's they built it for, and is no longer theirs to change.
    r.say("a", { m: "serve", slot: 1 });
    expect(server.mayChange!(r.room, "a", wall, "remove")).toBe(false);
    expect(server.mayChange!(r.room, "c", wall, "remove")).toBe(true);
    r.leave("a");
    r.run(120);
    expect(r.removed).toHaveLength(0);
    expect(r.build.size).toBe(1);
  });

  it("left over from before a war began are cleared; and so is a siege engine left standing from when there were such things", () => {
    const r = fakeRoom();
    r.build.apply({ kind: "place", piece: { id: "old-1", type: "wall", x: 3, y: 0, z: 3, rot: 0, material: "wood", edit: 0 } });
    r.join("a", 0);
    expect(r.removed).toEqual(["old-1"]);
    r.build.apply({ kind: "place", piece: { id: "a-9", type: "trebuchet", x: 30, y: 0, z: 30, rot: 0, material: "wood", edit: 0 } });
    r.build.apply({ kind: "place", piece: { id: "a-8", type: "wall", x: 40, y: 0, z: 40, rot: 0, material: "wood", edit: 0 } });
    r.join("b", 1);
    expect(r.removed).toEqual(["old-1", "a-9"]);
    expect(server.shotHits).toBeUndefined();
    expect(server.struck).toBeUndefined();
  });
});

describe("leaving and sleeping", () => {
  it("the same tab back within a minute is in the army it last served, without being asked again", () => {
    const r = fakeRoom();
    const g = r.join("a", 4, "tab-one-xyz")!;
    r.join("other", 0);
    r.run(2);
    r.leave("a");
    r.run(LEAVE_GRACE - 10);
    const back = r.join("a2", -1, "tab-one-xyz")!;
    expect(back).toBe(g);
    const you = r.to("a2").find((m) => m.m === "you") as Extract<ToPage, { m: "you" }>;
    expect(you.slot).toBe(4);
    expect(you.why).toBeUndefined();
    r.run(2);
    // Everything of the army is sent to the new page afresh.
    expect([...r.knows("a2").values()].filter((o) => o === g.slot).length).toBeGreaterThanOrEqual(4);
  });

  it("an army nobody serves for a minute disappears, everything of it: whoever comes back later begins again", () => {
    const r = fakeRoom();
    const g = r.join("a", 4, "tab-gone-1")!;
    r.join("other", 0);
    const wall: Piece = { id: "a-1", type: "wall", x: 60, y: 0, z: 60, rot: 0, material: "wood", edit: 0 };
    r.build.apply({ kind: "place", piece: wall });
    server.placed!(r.room, "a", [wall]);
    g.lithium = 5000;
    r.run(2);
    r.leave("a");
    r.run(LEAVE_GRACE + 2);
    // Gone: its Core, its units, what was built for it; the other army is untouched, and is told it went.
    expect(r.sim().generals[4]).toBeNull();
    expect(r.sim().units.some((u) => u.owner === 4)).toBe(false);
    expect([...r.sim().buildings.values()].some((b) => b.owner === 4)).toBe(false);
    expect(r.removed).toEqual(["a-1"]);
    expect(r.sim().generals[0]!.here).toEqual(["other"]);
    const gens = r.to("other").filter((m) => m.m === "gens").pop() as Extract<ToPage, { m: "gens" }>;
    expect(gens.g.find((x) => x.slot === 4)!.pids).toEqual([]);
    // The same tab, back later: asked to choose like anyone; the same colour is begun afresh.
    expect(r.join("a2", -1, "tab-gone-1")).toBeNull();
    r.say("a2", { m: "serve", slot: 4 });
    const fresh = r.sim().generalOf("a2")!;
    expect(fresh).not.toBe(g);
    expect(fresh.lithium).toBe(START_LITHIUM);
    // Someone else taking up an army whose general has just gone (inside the minute) begins it afresh too: nobody inherits one.
    const before = r.sim().generals[0]!;
    before.lithium = 9999;
    r.leave("other");
    r.run(5);
    r.join("newcomer", 0, "tab-newcomer");
    expect(r.sim().generalOf("newcomer")).not.toBe(before);
    expect(r.sim().generalOf("newcomer")!.lithium).toBe(START_LITHIUM);
  });

  it("with nobody serving any army the war is paused; the next general starts it again, and an army left for over a minute is gone by then", () => {
    const r = fakeRoom();
    r.join("a", 0);
    r.run(3);
    const units = r.sim().units.length, buildings = r.sim().buildings.size;
    r.leave("a");
    r.run(1);
    const t = r.sim().t;
    r.run(LEAVE_GRACE + 30);
    expect(r.sim().t).toBe(t);
    expect(r.sim().units.length).toBe(units);
    expect(r.sim().buildings.size).toBe(buildings);
    expect(r.saved.has("war")).toBe(true);
    // Someone comes, and has not chosen yet: still paused. They choose: it carries on from there.
    r.join("b");
    r.run(3);
    expect(r.sim().t).toBe(t);
    expect(r.sim().generals[0]).toBeNull();
    r.say("b", { m: "serve", slot: 6 });
    r.run(3);
    expect(r.sim().t).toBeGreaterThan(t + 2);
  });

  it("a room restarted takes the war up where it was: the same tab back within the minute is in its army; after longer, the army is gone", () => {
    const first = fakeRoom();
    const g = first.join("a", 2, "tab-keep-1")!;
    g.lithium = 1234;
    first.run(12);
    expect(first.saved.has("war")).toBe(true);
    const units = first.sim().units.length;

    // Restarted at once (a new version went out): the same war, and the tab is in its army again without being asked.
    const second = fakeRoom({ saved: first.saved });
    expect(second.sim().units.length).toBe(units);
    expect(second.sim().generals[2]!.here).toHaveLength(0);
    expect(second.sim().generals[2]!.lithium).toBeGreaterThanOrEqual(1234);
    const back = second.join("a", -1, "tab-keep-1")!;
    expect(back.slot).toBe(2);
    expect(back.lithium).toBeGreaterThanOrEqual(1234);
    second.run(3);
    expect(second.sim().t).toBeGreaterThan(12.5);

    // Days later: nothing of it is left, and the tab begins again like anyone.
    now += 3 * 24 * 3600_000;
    vi.setSystemTime(now);
    const third = fakeRoom({ saved: first.saved });
    expect(third.join("a", -1, "tab-keep-1")).toBeNull();
    expect(third.sim().generals.every((x) => x === null)).toBe(true);
    expect(third.sim().units.every((u) => u.owner === MAX_GENERALS)).toBe(true);
  });

  it("a war saved under earlier rules is taken up: its armies kept, buildings that were printing finished, nobody serving until they come", () => {
    const first = fakeRoom();
    const g = first.join("a", 0, "tab-old-1")!;
    first.join("b", 1, "tab-old-2");
    first.run(12);
    const old = JSON.parse(JSON.stringify(first.saved.get("war"))) as { sim: { generals: (Record<string, unknown> | null)[]; units: { owner: number }[]; buildings: { owner: number; doneAt: number }[]; truces?: unknown; owners?: unknown; tabs?: unknown } };
    for (const slot of [5, 6, 7]) {
      old.sim.generals[slot] = null;
      old.sim.units = old.sim.units.filter((u) => u.owner !== slot);
      old.sim.buildings = old.sim.buildings.filter((b) => b.owner !== slot);
    }
    // As older saves had a general: one person, a computer flag, a team, a name of their own.
    Object.assign(old.sim.generals[g.slot]!, { team: 100, asked: [1], color: "#123456", pid: "a", tab: "tab-old-1", ai: false, leftAt: 0, joinedAt: 3, immuneUntil: 0, name: "Ann" });
    delete old.sim.generals[g.slot]!.here;
    Object.assign(old.sim.generals[1]!, { team: 100, ai: true, pid: null, name: "Vega" });
    delete old.sim.generals[1]!.here;
    old.sim.buildings[0]!.doneAt = 99999;
    old.sim.truces = [];
    delete old.sim.owners;
    delete old.sim.tabs;
    const second = fakeRoom({ saved: new Map<string, unknown>([["war", old]]) });
    const sim = second.sim();
    expect(sim.generals.every((x) => x === null || x.here.length === 0)).toBe(true);
    expect(sim.generals.slice(5).every((x) => x === null)).toBe(true);
    expect(sim.hostile(g.slot, 1)).toBe(true);
    expect(sim.generals[g.slot]!.color).not.toBe("#123456");
    expect(sim.generals[1]!.name).toMatch(/army$/);
    expect([...sim.buildings.values()].every((b) => b.doneAt === 0)).toBe(true);
    // The one who was its general is asked to choose, like anyone (their tab was not saved then): their colour is begun afresh.
    expect(second.join("a2", -1, "tab-old-1")).toBeNull();
    second.say("a2", { m: "serve", slot: g.slot });
    expect(sim.generalOf("a2")!.slot).toBe(g.slot);
    expect(sim.generalOf("a2")!.lithium).toBe(START_LITHIUM);
  });
});

describe("a room that wakes with pages still connected", () => {
  it("knows them again as soon as anyone says anything: each is back in the army their tab served", () => {
    const first = fakeRoom({ visitors: ["v"] });
    first.join("a", 3, "tab-wake-1");
    first.run(12);
    // The room's memory is gone (it slept, or was moved to new code); the two pages are still connected.
    const second = fakeRoom({ saved: first.saved, visitors: ["v"] });
    second.at.set("a", [0, 0.9, 0]);
    second.at.set("v", [0, 0.9, 0]);
    second.say("a", { m: "order", ids: [1], k: "stop" });
    second.run(2);
    expect(second.to("v").map((m) => m.m)).toEqual(["you"]);
    expect(second.sim().generalOf("a")).toBeNull();
  });
});

describe("a war never runs wild", () => {
  it("with no page connected to the room at all, it pauses, even if no general was ever said to have left", () => {
    const r = fakeRoom();
    const g = r.join("a", 0)!;
    r.run(3);
    // The page is gone, and the room was never told (it was moved onto new code, say).
    r.at.delete("a");
    r.run(LEAVE_GRACE + 20);
    expect(g.here).toEqual(["a"]);
    r.run(20);
    expect(r.sim().generals.every((x) => !x || x.here.length === 0)).toBe(true);
    const t = r.sim().t;
    r.run(5);
    expect(r.sim().t).toBe(t);
  });

  it("a fault in the war begins it afresh, and everyone is told; the room carries on, with an army begun again for whoever served one", () => {
    const r = fakeRoom();
    r.join("a", 5);
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
    sim.addUnit("titan", 5, 0, 0);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    r.run(1);
    quiet.mockRestore();
    expect(r.to("a").some((m) => m.m === "note" && /fault/.test(m.text))).toBe(true);
    expect(sim.generals.filter((x) => x !== null).map((x) => x!.slot)).toEqual([5]);
    expect(sim.units.some((u) => u.kind === "titan")).toBe(false);
    expect([...sim.buildings.values()].filter((b) => b.kind === "core")).toHaveLength(1);
    expect(sim.generalOf("a")?.slot).toBe(5);
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
