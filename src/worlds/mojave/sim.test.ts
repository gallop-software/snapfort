import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { CELL, LEVEL } from "../../game/constants";
import type { MaterialId, Piece, PieceType, Rot } from "../../game/pieces";
import type { Vec } from "../../game/trebuchet";
import { BUILDINGS, LEAVE_GRACE, MAX_GENERALS, PIECE_COST, ROUTED_WAIT, START_HAULERS, START_LITHIUM, UNITS } from "./kit";
import { STARTS } from "./map";
import { DT, NEUTRAL, Sim, T_BUILDING, T_UNIT, type Host, type Unit } from "./sim";
import { HALF_CELLS, world } from "./world";

/** A room that remembers what the war asked of it. */
function fakeHost() {
  const at = new Map<string, Vec>();
  const host = {
    at,
    thrown: [] as string[],
    worn: [] as [string, number][],
    removed: [] as string[],
    positionOf: (pid: string) => at.get(pid) ?? null,
    isDown: () => false,
    throwBuilder: (pid: string) => void host.thrown.push(pid),
    wear: (_p: Vec, hits: [string, number][]) => void host.worn.push(...hits),
    removePieces: (ids: string[]) => void host.removed.push(...ids),
  };
  return host satisfies Host & Record<string, unknown>;
}

function setup() {
  const build = new BuildState();
  build.halfCells = HALF_CELLS;
  const host = fakeHost();
  const sim = new Sim(build, world, host);
  let n = 0;
  const piece = (by: string, type: PieceType, x: number, y: number, z: number, rot: Rot = 0, material: MaterialId = "wood", edit = 0): Piece => {
    const p: Piece = { id: `${by}-${(n++).toString(36)}`, type, x, y, z, rot, material, edit };
    expect(build.apply({ kind: "place", piece: p })).not.toBeNull();
    return p;
  };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
  };
  /** A person commanding the place at start `start` (a computer's until now, begun afresh), standing by their Core. */
  let r = 0;
  const general = (pid: string, start: number) => {
    if (!sim.generals[start]) sim.seat(start);
    const g = sim.take(start, pid, pid, `tab${pid}${r++}`.padEnd(8, "x"))!;
    host.at.set(pid, [STARTS[g.start]!.spawn[0], 0.9, STARTS[g.start]!.spawn[1]]);
    return g;
  };
  const mine = (slot: number, kind?: string) => sim.units.filter((u) => u.owner === slot && (!kind || u.kind === kind));
  return { build, host, sim, piece, run, general, mine };
}

/** An open spot well away from every start and field, m. */
const OPEN: [number, number] = [200, 150];

describe("a general arrives", () => {
  it("in a place with a Core and Haulers that go to work by themselves", () => {
    const { sim, general, run, mine } = setup();
    const g = general("p1", 2);
    expect(g.start).toBe(2);
    expect(g.lithium).toBe(START_LITHIUM);
    const cores = [...sim.buildings.values()].filter((b) => b.owner === g.slot && b.kind === "core");
    expect(cores).toHaveLength(1);
    expect(cores[0]!.doneAt).toBe(0);
    expect(mine(g.slot, "hauler")).toHaveLength(START_HAULERS);
    expect(sim.supplyUsed(g.slot)).toBe(START_HAULERS);
    expect(sim.supplyMax(g.slot)).toBe(BUILDINGS.core.supply);
    run(60);
    // A minute of four Haulers: well over a hundred lithium.
    expect(g.lithium).toBeGreaterThan(START_LITHIUM + 100);
  });

  it("there are always eight, each at a start of their own; a person takes a computer's place as it stands, in turn; a ninth person has none", () => {
    const { sim } = setup();
    sim.fill();
    expect(sim.generals.every((g) => g?.ai)).toBe(true);
    expect(new Set(sim.generals.map((g) => g!.start)).size).toBe(MAX_GENERALS);
    expect(new Set(sim.generals.map((g) => g!.color)).size).toBe(MAX_GENERALS);
    // What a computer had is the newcomer's: nothing is taken away, nothing begun afresh.
    const first = sim.generals[0]!;
    first.lithium = 4321;
    const tank = sim.addUnit("tank", 0, STARTS[first.start]!.spawn[0], STARTS[first.start]!.spawn[1]);
    const cores = sim.buildings.size, units = sim.units.length;
    const taken: number[] = [];
    for (let i = 0; i < MAX_GENERALS; i++) taken.push(sim.join(`p${i}`, `G${i}`, `tabtab0${i}`)!.slot);
    expect(taken).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(first.pid).toBe("p0");
    expect(first.ai).toBe(false);
    expect(first.name).toBe("G0");
    expect(first.lithium).toBe(4321);
    expect(tank.owner).toBe(0);
    expect(sim.buildings.size).toBe(cores);
    expect(sim.units.length).toBe(units);
    expect(sim.join("p9", "Late", "tabtab99")).toBeNull();
  });

  it("makes units at a building: paid for, there after their time; one there is no supply for waits, made, until there is", () => {
    const { sim, general, run, mine } = setup();
    const g = general("p1", 0);
    g.lithium = 1000;
    const core = [...sim.buildings.values()].find((b) => b.owner === g.slot)!;
    expect(sim.make(g.slot, core.id, "hauler", 3)).toBe("");
    expect(g.lithium).toBe(1000 - 3 * UNITS.hauler.lithium);
    // What is queued takes no supply yet.
    expect(sim.supplyUsed(g.slot)).toBe(START_HAULERS);
    expect(sim.make(g.slot, core.id, "trooper")).toBe("Not made here");
    run(UNITS.hauler.time * 3 + 2);
    expect(mine(g.slot, "hauler")).toHaveLength(START_HAULERS + 3);
    expect(sim.supplyUsed(g.slot)).toBe(START_HAULERS + 3);
    // Supply is no bar to queueing: the queue takes eight, though the Core's 12 has room for five more.
    g.lithium = 5000;
    expect(sim.make(g.slot, core.id, "hauler", 10)).toBe("");
    expect(core.queue).toHaveLength(8);
    expect(sim.make(g.slot, core.id, "hauler")).toBe("Its queue is full");
    run(UNITS.hauler.time * 8 + 5);
    // Five came out; the sixth is made and waits at the door.
    expect(sim.supplyUsed(g.slot)).toBe(BUILDINGS.core.supply);
    expect(core.queue).toHaveLength(3);
    expect(core.queue[0]!.left).toBe(0);
    // Room is made (a Hauler is lost): the next comes out at once.
    sim.kill(mine(g.slot, "hauler")[0]!, false);
    run(1);
    expect(core.queue).toHaveLength(2);
    expect(sim.supplyUsed(g.slot)).toBe(BUILDINGS.core.supply);
    // Cancelling gives the money back.
    const before = g.lithium;
    expect(sim.cancel(g.slot, core.id)).toBe("");
    expect(g.lithium).toBe(before + UNITS.hauler.lithium);
  });

  it("puts buildings down within reach, on clear ground, with what they need first", () => {
    const { sim, general, run, host } = setup();
    const g = general("p1", 0);
    const s = STARTS[g.start]!;
    const at = (dx: number, dz: number): [number, number] => [s.cx + dx, s.cz + dz];
    // Away from the middle of the map is where the crystals are: build toward the middle.
    const inX = -Math.sign(s.cx) || 1, inZ = -Math.sign(s.cz) || 1;
    expect(sim.orderBuilding(g.slot, "foundry", ...at(inX * 4, inZ * 4))).toBe("Not enough lithium");
    g.lithium = 2000;
    g.plasma = 2000;
    expect(sim.orderBuilding(g.slot, "armory", ...at(inX * 4, inZ * 4))).toMatch(/Foundry first/);
    expect(sim.orderBuilding(g.slot, "foundry", s.cx, s.cz)).toBe("Something is in the way");
    expect(sim.orderBuilding(g.slot, "foundry", ...at(inX * 4, inZ * 4))).toBe("");
    expect(sim.orderBuilding(g.slot, "foundry", ...at(inX * 5, inZ * 5))).toBe("Something is in the way");
    const foundry = [...sim.buildings.values()].find((b) => b.kind === "foundry")!;
    expect(foundry.doneAt).toBeGreaterThan(0);
    expect(sim.make(g.slot, foundry.id, "trooper")).toBe("Still printing");
    run(BUILDINGS.foundry.time + 1);
    expect(foundry.doneAt).toBe(0);
    expect(foundry.hp).toBeCloseTo(BUILDINGS.foundry.hp, 0);
    expect(sim.make(g.slot, foundry.id, "trooper")).toBe("");
    // Too far from where the general stands.
    host.at.set("p1", [0, 0.9, 0]);
    expect(sim.orderBuilding(g.slot, "relay", ...at(inX * 8, inZ * 8))).toMatch(/Too far/);
  });
});

describe("getting about", () => {
  it("goes where it is told, and a group stops together round the spot", () => {
    const { sim, general, run } = setup();
    const g = general("p1", 0);
    const units = Array.from({ length: 12 }, (_, i) => sim.addUnit("trooper", g.slot, OPEN[0] + i, OPEN[1]));
    sim.command(g.slot, units.map((u) => u.id), { k: "move", x: OPEN[0] + 60, z: OPEN[1] + 40, l: 0 });
    run(20);
    for (const u of units) {
      expect(Math.hypot(u.x - (OPEN[0] + 60), u.z - (OPEN[1] + 40))).toBeLessThan(9);
      expect(u.order.k).toBe("stop");
    }
    // Nobody is standing in anybody else.
    for (const a of units) for (const b of units) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.7);
  });

  it("a group marches side by side, each keeping its place, straight along the grid or across it", () => {
    for (const [dx, dz] of [[0, 1], [1, 0], [0.707, 0.707], [-0.9, 0.44]] as const) {
      const { sim, general } = setup();
      const g = general("p1", 0);
      // Twelve Troopers in a block four wide, and four tanks beside them.
      const units = Array.from({ length: 12 }, (_, i) => sim.addUnit("trooper", g.slot, OPEN[0] + (i % 4) * 3, OPEN[1] + Math.floor(i / 4) * 3));
      for (let i = 0; i < 4; i++) units.push(sim.addUnit("tank", g.slot, OPEN[0] + 16 + (i % 2) * 5, OPEN[1] + Math.floor(i / 2) * 6));
      const from = units.map((u) => [u.x, u.z] as const);
      const mid = [from.reduce((n, p) => n + p[0], 0) / 16, from.reduce((n, p) => n + p[1], 0) / 16];
      const to = [mid[0] + dx * 36, mid[1] + dz * 36];
      sim.command(g.slot, units.map((u) => u.id), { k: "move", x: to[0]!, z: to[1]!, l: 0 });
      // 36 m at a Trooper's 7 m/s is a little over five seconds: all are there well inside nine.
      let done = 0;
      for (let i = 0; i < 90; i++) {
        sim.tick();
        if (!done && units.every((u) => u.arrived)) done = (i + 1) / 10;
      }
      expect(done, `toward ${dx},${dz}`).toBeGreaterThan(0);
      expect(done, `toward ${dx},${dz}`).toBeLessThan(8);
      units.forEach((u, i) => {
        // Where each stood from the middle of the group is where it stands now, to within a few metres (a tank is four across).
        const wantX = to[0]! + from[i]![0] - mid[0]!, wantZ = to[1]! + from[i]![1] - mid[1]!;
        expect(Math.hypot(u.x - wantX, u.z - wantZ), `unit ${i} toward ${dx},${dz}`).toBeLessThan(3.5);
      });
    }
  });

  it("goes round a wall, through a door on foot, and up a ramp onto a floor", () => {
    const { sim, general, run, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    // A long wall along x at z = cz + 4, with a door in the middle panel.
    for (let x = cx - 6; x <= cx + 6; x++) piece("p1", "wall", x, 0, cz + 4, 0, "wood", x === cx ? 0b010010 : 0);
    const trooper = sim.addUnit("trooper", g.slot, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
    const tank = sim.addUnit("tank", g.slot, (cx + 0.5) * CELL, (cz + 1.5) * CELL);
    const to = { x: (cx + 0.5) * CELL, z: (cz + 8.5) * CELL };
    sim.command(g.slot, [trooper.id, tank.id], { k: "move", ...to, l: 0 });
    let throughDoor = false, tankThroughWall = false;
    for (let i = 0; i < 400; i++) {
      sim.tick();
      if (trooper.cz === cz + 4 && trooper.cx === cx) throughDoor = true;
      if (tank.cz >= cz + 4 && Math.abs(tank.cx - cx) <= 5 && tank.cz === cz + 4 && tank.z < (cz + 4) * CELL + 0.2) tankThroughWall = tankThroughWall || false;
    }
    expect(throughDoor).toBe(true);
    expect(Math.hypot(trooper.x - to.x, trooper.z - to.z)).toBeLessThan(6);
    // The tank had to go round the end of the wall, and got there too.
    expect(Math.hypot(tank.x - to.x, tank.z - to.z)).toBeLessThan(8);

    // A ramp climbing toward +x onto a floor one storey up.
    const rx = cx + 20;
    piece("p1", "ramp", rx, 0, cz, 1);
    piece("p1", "floor", rx + 1, 1, cz);
    piece("p1", "floor", rx + 2, 1, cz);
    const climber = sim.addUnit("trooper", g.slot, (rx - 2) * CELL, (cz + 0.5) * CELL);
    sim.command(g.slot, [climber.id], { k: "move", x: (rx + 2.5) * CELL, z: (cz + 0.5) * CELL, l: 1 });
    run(15);
    expect(climber.level).toBe(1);
    expect(climber.cx).toBe(rx + 2);
    expect(climber.y).toBeGreaterThan(LEVEL - 0.1);
  });

  it("cannot walk into a walled box, and stops", () => {
    const { sim, general, run, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL) + 30, cz = Math.floor(OPEN[1] / CELL);
    piece("p1", "wall", cx, 0, cz, 0);
    piece("p1", "wall", cx, 0, cz + 1, 0);
    piece("p1", "wall", cx, 0, cz, 1);
    piece("p1", "wall", cx + 1, 0, cz, 1);
    const u = sim.addUnit("tank", g.slot, (cx - 3) * CELL, (cz + 0.5) * CELL);
    sim.command(g.slot, [u.id], { k: "move", x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, l: 0 });
    run(12);
    expect(u.cx === cx && u.cz === cz).toBe(false);
    expect(u.order.k).toBe("stop");
  });
});

describe("fighting", () => {
  function twoSides() {
    const s = setup();
    const a = s.general("pa", 0), b = s.general("pb", 4);
    return { ...s, a, b };
  }

  it("enemies in range shoot each other until one side is gone; nobody shoots their own", () => {
    const { sim, a, b, run, mine } = twoSides();
    for (let i = 0; i < 6; i++) sim.addUnit("trooper", a.slot, OPEN[0] + i * 2, OPEN[1]);
    for (let i = 0; i < 3; i++) sim.addUnit("trooper", b.slot, OPEN[0] + i * 2, OPEN[1] + 20);
    run(30);
    expect(mine(b.slot, "trooper")).toHaveLength(0);
    expect(mine(a.slot, "trooper").length).toBeGreaterThan(2);
    expect(sim.happened.shots.length).toBeGreaterThan(10);
    expect(sim.happened.gone.filter((g) => g.unit && !g.left).length).toBeGreaterThanOrEqual(3);
  });

  it("a plain move ignores the enemy; an attack-move stops to fight", () => {
    const { sim, a, b, run } = twoSides();
    const mover = sim.addUnit("tank", a.slot, OPEN[0], OPEN[1]);
    const fighter = sim.addUnit("tank", a.slot, OPEN[0] + 60, OPEN[1]);
    const t1 = sim.addUnit("hauler", b.slot, OPEN[0], OPEN[1] + 30);
    const t2 = sim.addUnit("hauler", b.slot, OPEN[0] + 60, OPEN[1] + 30);
    sim.command(a.slot, [mover.id], { k: "move", x: OPEN[0], z: OPEN[1] + 90, l: 0 });
    sim.command(a.slot, [fighter.id], { k: "amove", x: OPEN[0] + 60, z: OPEN[1] + 90, l: 0 });
    run(14);
    expect(t1.dead).toBe(false);
    expect(t2.dead).toBe(true);
    expect(mover.z).toBeGreaterThan(OPEN[1] + 80);
  });

  it("a blast throws units: they tumble away, lie a moment, and get up", () => {
    const { sim, a, b, run } = twoSides();
    const tank = sim.addUnit("tank", a.slot, OPEN[0], OPEN[1]);
    const victims = Array.from({ length: 4 }, (_, i) => sim.addUnit("scout", b.slot, OPEN[0] + (i % 2) * 3, OPEN[1] + 30 + Math.floor(i / 2) * 3));
    const before = victims.map((v) => [v.x, v.z]);
    sim.command(a.slot, [tank.id], { k: "hold" });
    sim.command(b.slot, victims.map((v) => v.id), { k: "hold" });
    run(1.2);
    expect(sim.happened.tumbles.length).toBeGreaterThan(0);
    const thrown = sim.happened.tumbles[0]!;
    const v = victims.find((u) => u.id === thrown.id)!;
    const i = victims.indexOf(v);
    expect(Math.hypot(v.x - before[i]![0]!, v.z - before[i]![1]!)).toBeGreaterThan(1);
    expect(v.downUntil).toBeGreaterThan(sim.t);
    expect(tank.id).toBeGreaterThan(0);
  });

  it("a wall shelters from a straight shot; an attack-move breaks through it; artillery lobs over it", () => {
    const { sim, a, b, run, piece, host } = twoSides();
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    // A closed square of walls, 3 cells a side, round a Hauler.
    for (let i = 0; i < 3; i++) {
      piece("pb", "wall", cx + i, 0, cz, 0);
      piece("pb", "wall", cx + i, 0, cz + 3, 0);
      piece("pb", "wall", cx, 0, cz + i, 1);
      piece("pb", "wall", cx + 3, 0, cz + i, 1);
    }
    const inside = sim.addUnit("hauler", b.slot, (cx + 1.5) * CELL, (cz + 1.5) * CELL);
    const trooper = sim.addUnit("trooper", a.slot, (cx + 1.5) * CELL, (cz - 3) * CELL);
    sim.command(a.slot, [trooper.id], { k: "hold" });
    run(5);
    expect(inside.dead).toBe(false);
    expect(host.worn).toHaveLength(0);
    // Told to attack what is inside, it shoots its way in: the wall is worn.
    sim.command(a.slot, [trooper.id], { k: "amove", x: (cx + 1.5) * CELL, z: (cz + 1.5) * CELL, l: 0 });
    run(6);
    expect(host.worn.length).toBeGreaterThan(0);
    expect(host.worn.every(([id]) => id.startsWith("pb-"))).toBe(true);
    // Artillery, set up out of sight behind the wall, lands a shell inside.
    sim.kill(trooper, false);
    const gun = sim.addUnit("artillery", a.slot, (cx + 1.5) * CELL, (cz - 9) * CELL);
    sim.command(a.slot, [gun.id], { k: "attack", tk: T_UNIT, id: inside.id });
    run(12);
    expect(inside.dead).toBe(true);
  });

  it("a laser shoots a shell out of the sky; an EMP stops what it hits", () => {
    const { sim, a, b, run } = twoSides();
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    const target = sim.addUnit("hauler", b.slot, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
    sim.addBuilding("laser", b.slot, cx + 2, cz, true);
    const gun = sim.addUnit("artillery", a.slot, (cx + 0.5) * CELL, (cz - 12) * CELL);
    sim.command(a.slot, [gun.id], { k: "attack", tk: T_UNIT, id: target.id });
    run(6);
    expect(sim.happened.zaps.length).toBeGreaterThan(0);
    expect(target.dead).toBe(false);

    const drone = sim.addUnit("emp", a.slot, (cx + 0.5) * CELL, (cz - 20) * CELL);
    sim.command(a.slot, [drone.id], { k: "emp", x: target.x, z: target.z });
    run(6);
    expect(sim.happened.pulses).toHaveLength(1);
    expect(target.stunUntil).toBeGreaterThan(sim.t);
  });

  it("turrets guard, buildings are destroyed, and a general with no Core left is routed and may drop a new one", () => {
    const { sim, a, b, run } = twoSides();
    const core = [...sim.buildings.values()].find((x) => x.owner === b.slot && x.kind === "core")!;
    const c = sim.centreOf(core);
    const tanks = Array.from({ length: 10 }, (_, i) => sim.addUnit("tank", a.slot, c[0] + 40 + (i % 5) * 5, c[2] + Math.floor(i / 5) * 5));
    sim.command(a.slot, tanks.map((t) => t.id), { k: "attack", tk: T_BUILDING, id: core.id });
    for (let i = 0; i < 600 && !core.dead; i++) sim.tick();
    expect(core.dead).toBe(true);
    expect(b.routedAt).toBeGreaterThan(0);
    expect(sim.cannotBuild(b.slot, "core", 40, 40)).toBe("Not enough lithium");
    run(ROUTED_WAIT + 1);
    expect(sim.cannotBuild(b.slot, "core", 40, 40)).toBe("");
  });

  it("generals are thrown by blasts, never anything worse, and not twice in a row", () => {
    const { sim, a, b, run, host } = twoSides();
    host.at.set("pb", [OPEN[0], 0.9, OPEN[1] + 30]);
    const tank = sim.addUnit("tank", a.slot, OPEN[0], OPEN[1]);
    sim.addUnit("hauler", b.slot, OPEN[0] + 1, OPEN[1] + 30);
    sim.command(a.slot, [tank.id], { k: "hold" });
    run(8);
    expect(host.thrown).toEqual(["pb"]);
    expect(sim.generals[b.slot]).not.toBeNull();
  });
});

describe("pieces", () => {
  it("cost lithium, belong to who built them, and cannot be built into a building or a field", () => {
    const { sim, general, build } = setup();
    const g = general("p1", 0), other = general("p2", 4);
    const s = STARTS[g.start]!;
    const wall: Piece = { id: "p1-a", type: "wall", x: 10, y: 0, z: 10, rot: 0, material: "metal", edit: 0 };
    // One price, whatever slot a piece is saved under; and nobody builds a siege engine.
    expect(sim.priceOf(wall)).toBe(sim.priceOf({ ...wall, material: "wood" }));
    g.lithium = 10_000;
    expect(sim.mayPlace("p1", { ...wall, id: "p1-t", type: "trebuchet" })).toBe(false);
    g.pending = 0;
    g.lithium = PIECE_COST * 2 - 1;
    expect(sim.mayPlace("p1", wall)).toBe(true);
    // A second in the same action: the first is already promised.
    expect(sim.mayPlace("p1", { ...wall, id: "p1-b", x: 11 })).toBe(false);
    sim.placed("p1", [wall]);
    expect(g.lithium).toBe(PIECE_COST - 1);
    // Someone else's id, or someone who is not a general.
    expect(sim.mayPlace("p1", { ...wall, id: "p2-a" })).toBe(false);
    expect(sim.mayPlace("nobody", { ...wall, id: "nobody-a" })).toBe(false);
    build.apply({ kind: "place", piece: wall });
    expect(sim.mayChange("p1", wall)).toBe(true);
    expect(sim.mayChange("p2", wall)).toBe(false);
    expect(other.slot).not.toBe(g.slot);
    // Into the Core: no. Flat against its side: yes.
    g.lithium = 1000;
    expect(sim.blocks({ id: "p1-c", type: "floor", x: s.cx, y: 0, z: s.cz, rot: 0, material: "wood", edit: 0 })).toBe(true);
    expect(sim.blocks({ id: "p1-d", type: "wall", x: s.cx, y: 0, z: s.cz, rot: 0, material: "wood", edit: 0 })).toBe(true);
    expect(sim.blocks({ id: "p1-e", type: "wall", x: s.cx - 1, y: 0, z: s.cz - 1, rot: 0, material: "wood", edit: 0 })).toBe(false);
    expect(sim.blocks({ id: "p1-f", type: "roof", x: s.cx, y: 6, z: s.cz, rot: 0, material: "wood", edit: 0 })).toBe(false);
    const f = sim.fields[0]!;
    expect(sim.blocks({ id: "p1-g", type: "ramp", x: f.cx, y: 0, z: f.cz, rot: 0, material: "wood", edit: 0 })).toBe(true);
  });
});

describe("leaving, and coming back", () => {
  it("a computer takes over at once and plays on: nothing built is removed, pieces neither", () => {
    const { sim, general, run, piece, host } = setup();
    const g = general("p1", 0);
    const wall = piece("p1", "wall", 10, 0, 10);
    const slot = g.slot;
    g.lithium = 600;
    const tank = sim.addUnit("tank", slot, OPEN[0], OPEN[1]);
    sim.leave("p1");
    expect(g.ai).toBe(true);
    expect(g.pid).toBeNull();
    expect(g.name).not.toBe("p1");
    run(LEAVE_GRACE + 10);
    expect(sim.generals[slot]).toBe(g);
    expect(tank.dead).toBe(false);
    expect([...sim.buildings.values()].filter((b) => b.owner === slot && b.kind === "core")).toHaveLength(1);
    expect(host.removed).toHaveLength(0);
    // The wall is still that place's: whoever commands it next may change it, and nobody else.
    expect(sim.ownerOfPiece(wall.id)).toBe(slot);
    const next = sim.join("p2", "Bea", "tab-of-bea")!;
    expect(next).toBe(g);
    expect(sim.mayChange("p2", wall)).toBe(true);
  });

  it("the place is kept for the same tab for the grace period, and is anyone's after it", () => {
    const { sim, run } = setup();
    sim.fill();
    const g = sim.join("p1", "Ann", "tabtabtab")!;
    g.lithium = 777;
    sim.leave("p1");
    run(20);
    // Someone else in the meantime is given another place, not the one being kept.
    const other = sim.join("p5", "Cy", "tab-of-cy")!;
    expect(other).not.toBe(g);
    const back = sim.join("p7", "Ann", "tabtabtab")!;
    expect(back).toBe(g);
    expect(back.pid).toBe("p7");
    expect(back.ai).toBe(false);
    expect(back.lithium).toBeGreaterThanOrEqual(777);
    // Pieces built under the old id are still theirs.
    expect(sim.ownerOfPiece("p1-zz")).toBe(g.slot);
    expect(sim.ownerOfPiece("p7-zz")).toBe(g.slot);
    // Gone for longer than the grace period: the place is no longer kept, and the next person may be given it.
    sim.leave("p7");
    for (let i = 0; i < MAX_GENERALS - 2; i++) sim.join(`q${i}`, `Q${i}`, `tab-q-${i}`);
    expect(sim.join("late", "Late", "tab-late")).toBeNull();
    run(LEAVE_GRACE + 2);
    expect(sim.join("late", "Late", "tab-late")).toBe(g);
    // And the one who left it comes back to whatever is open, like anyone: nothing is.
    expect(sim.join("p8", "Ann", "tabtabtab")).toBeNull();
  });
});

describe("sides", () => {
  it("every general is against every other, and against the sentries: there are no alliances", () => {
    const { sim, general, run } = setup();
    const a = general("pa", 0), b = general("pb", 4);
    const ua = sim.addUnit("trooper", a.slot, OPEN[0], OPEN[1]);
    const ub = sim.addUnit("trooper", b.slot, OPEN[0], OPEN[1] + 10);
    sim.command(a.slot, [ua.id], { k: "hold" });
    sim.command(b.slot, [ub.id], { k: "hold" });
    expect(sim.hostile(a.slot, b.slot)).toBe(true);
    expect(sim.hostile(a.slot, a.slot)).toBe(false);
    expect(sim.hostile(a.slot, NEUTRAL)).toBe(true);
    const hp = ua.hp + ub.hp;
    run(5);
    expect(ua.hp + ub.hp).toBeLessThan(hp);
  });
});

describe("being thrown", () => {
  it("bullets throw nobody; a shell throws a Trooper, further the bigger the hit", () => {
    const { sim, general, run } = setup();
    const a = general("pa", 0), b = general("pb", 4);
    // Rifles: hurt, never thrown.
    const shooter = sim.addUnit("trooper", a.slot, OPEN[0], OPEN[1]);
    const shot = sim.addUnit("trooper", b.slot, OPEN[0], OPEN[1] + 12);
    sim.command(a.slot, [shooter.id], { k: "hold" });
    sim.command(b.slot, [shot.id], { k: "hold" });
    sim.happened.tumbles.length = 0;
    run(4);
    expect(shot.hp).toBeLessThan(UNITS.trooper.hp);
    expect(sim.happened.tumbles).toHaveLength(0);
    // Blasts: thrown, and the heavier shell throws further.
    const far = (damage: number) => {
      const u = sim.addUnit("trooper", b.slot, OPEN[0] + 60, OPEN[1] + 60);
      u.hp = 10_000;
      // (A step, so the war knows where it stands.)
      sim.tick();
      const from = u.x;
      sim.happened.tumbles.length = 0;
      sim.blast([u.x - 1, 0.5, u.z], 5, damage, a.slot, { air: false, ground: true, wear: 0 });
      expect(sim.happened.tumbles).toHaveLength(1);
      const d = u.x - from;
      sim.kill(u, false);
      return d;
    };
    const tank = far(UNITS.tank.weapon!.damage), shell = far(UNITS.artillery.weapon!.damage);
    expect(tank).toBeGreaterThan(5);
    expect(shell).toBeGreaterThan(tank * 1.3);
  });
});

describe("sight", () => {
  it("a team sees round its own things, and no further", () => {
    const { sim, general, run } = setup();
    const a = general("pa", 0);
    const scout = sim.addUnit("scout", a.slot, OPEN[0], OPEN[1]);
    run(1);
    expect(sim.sees(a.team, scout.x + 40, scout.z)).toBe(true);
    expect(sim.sees(a.team, scout.x + 200, scout.z)).toBe(false);
    expect(sim.sees(a.team, STARTS[a.start]!.cx * CELL, STARTS[a.start]!.cz * CELL)).toBe(true);
  });
});

describe("through a sleep", () => {
  it("a snapshot carries the whole war on", () => {
    const first = setup();
    const g = first.general("p1", 0);
    g.lithium = 500;
    const core = [...first.sim.buildings.values()][0]!;
    first.sim.make(g.slot, core.id, "hauler", 2);
    const far = first.sim.addUnit("tank", g.slot, OPEN[0], OPEN[1]);
    first.sim.command(g.slot, [far.id], { k: "move", x: OPEN[0] + 50, z: OPEN[1], l: 0 });
    first.run(3);
    const saved = JSON.parse(JSON.stringify(first.sim.snapshot()));

    const second = setup();
    expect(second.sim.restore(saved)).toBe(true);
    expect(second.sim.t).toBeCloseTo(first.sim.t, 5);
    expect(second.sim.units.length).toBe(first.sim.units.length);
    expect(second.sim.generals[g.slot]!.lithium).toBeCloseTo(first.sim.generals[g.slot]!.lithium, 3);
    second.run(UNITS.hauler.time * 2 + 15);
    expect(second.sim.units.filter((u) => u.owner === g.slot && u.kind === "hauler")).toHaveLength(START_HAULERS + 2);
    const tank = second.sim.units.find((u) => u.kind === "tank")!;
    expect(Math.hypot(tank.x - (OPEN[0] + 50), tank.z - OPEN[1])).toBeLessThan(4);
    expect(second.sim.restore({ nonsense: true })).toBe(false);
  });
});

describe("transports", () => {
  it("carry ground units over a wall and set them down", () => {
    const { sim, general, run } = setup();
    const g = general("p1", 0);
    const lifter = sim.addUnit("transport", g.slot, OPEN[0], OPEN[1]);
    const squad = Array.from({ length: 4 }, (_, i) => sim.addUnit("trooper", g.slot, OPEN[0] + 6 + i, OPEN[1] + 6));
    sim.command(g.slot, squad.map((u) => u.id), { k: "load", into: lifter.id });
    run(6);
    expect(lifter.cargo).toHaveLength(4);
    expect(squad.every((u: Unit) => u.inside === lifter.id)).toBe(true);
    sim.command(g.slot, [lifter.id], { k: "unload", x: OPEN[0] + 120, z: OPEN[1] });
    run(12);
    expect(lifter.cargo).toHaveLength(0);
    for (const u of squad) {
      expect(u.inside).toBe(0);
      expect(Math.hypot(u.x - (OPEN[0] + 120), u.z - OPEN[1])).toBeLessThan(12);
    }
  });
});

describe("at full size", () => {
  it("1,700 units fighting take a few milliseconds a step", () => {
    const { sim } = setup();
    sim.fill();
    const gens = sim.generals.map((g) => g!);
    const kinds = ["trooper", "trooper", "trooper", "tank", "scout", "gunship", "artillery", "missile"] as const;
    for (const g of gens) {
      const s = STARTS[g.start]!;
      const ids: number[] = [];
      for (let i = 0; i < 205 && sim.units.length < 1700; i++) {
        const u = sim.addUnit(kinds[i % kinds.length]!, g.slot, s.spawn[0] + (i % 15) * 3 - 20, s.spawn[1] + Math.floor(i / 15) * 3 - 20);
        ids.push(u.id);
      }
      // Everyone to the middle.
      sim.command(g.slot, ids, { k: "amove", x: (g.slot - 4) * 6, z: (g.slot % 3) * 6, l: 0 });
    }
    expect(sim.units.length).toBeGreaterThan(1600);
    const times: number[] = [];
    for (let i = 0; i < 900; i++) {
      const at = performance.now();
      sim.tick();
      times.push(performance.now() - at);
      if (i % 50 === 0) sim.happened = { shots: [], tumbles: [], blasts: [], gone: [], pulses: [], zaps: [], notes: [] };
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`1,700 units: mean ${mean.toFixed(2)} ms a step, p95 ${p95.toFixed(2)} ms, worst ${times[times.length - 1]!.toFixed(1)} ms; ${sim.units.length} left`);
    // A step is 100 ms of game: it must take a small part of that.
    expect(mean).toBeLessThan(25);
    expect(p95).toBeLessThan(60);
    // They met and fought.
    expect(sim.units.length).toBeLessThan(1650);
  }, 120_000);
});
