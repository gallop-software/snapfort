import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { CELL, LEVEL, THICK } from "../../game/constants";
import type { MaterialId, Piece, PieceType, Rot } from "../../game/pieces";
import type { Vec } from "../../game/trebuchet";
import { buildingBox, BUILDINGS, MAX_GENERALS, PIECE_COST, ROUTED_WAIT, START_HAULERS, START_LITHIUM, UNITS } from "./kit";
import { STARTS } from "./map";
import { DT, emptyHappened, NEUTRAL, Sim, T_BUILDING, T_UNIT, type Host, type Unit } from "./sim";
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
  /** A person serving the army at start `start` (begun afresh if it was not there), standing by its Core. */
  let r = 0;
  const general = (pid: string, start: number) => {
    if (!sim.generals[start]) sim.seat(start);
    const g = sim.serve(pid, start, `tab${pid}${r++}`.padEnd(8, "x"))!;
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

  it("there are always eight armies, each at a start of its own in a colour of its own; any number of generals serve one, and each may change sides at any moment", () => {
    const { sim } = setup();
    sim.fill();
    expect(sim.generals.every((g) => g && g.here.length === 0)).toBe(true);
    expect(new Set(sim.generals.map((g) => g!.start)).size).toBe(MAX_GENERALS);
    expect(new Set(sim.generals.map((g) => g!.color)).size).toBe(MAX_GENERALS);
    // An army stands whether anyone serves it or not: joining it begins nothing afresh, and takes nothing away.
    const blue = sim.generals[1]!;
    blue.lithium = 4321;
    const tank = sim.addUnit("tank", 1, STARTS[blue.start]!.spawn[0], STARTS[blue.start]!.spawn[1]);
    const buildings = sim.buildings.size, units = sim.units.length;
    // Twelve people, all serving blue: more than there are armies.
    for (let i = 0; i < 12; i++) expect(sim.serve(`p${i}`, 1, `tabtab${i}`)).toBe(blue);
    expect(blue.here).toHaveLength(12);
    expect(sim.generalOf("p7")).toBe(blue);
    expect(blue.lithium).toBe(4321);
    expect(tank.owner).toBe(1);
    expect(sim.buildings.size).toBe(buildings);
    expect(sim.units.length).toBe(units);
    // Each commands all of it: any of them may order its units, and its bank is the one bank.
    expect(sim.command(1, [tank.id], { k: "hold" })).toBe("");
    // One changes sides: they serve red now, and blue stands as it was, with the other eleven.
    const red = sim.serve("p3", 0, "tabtab3")!;
    expect(red.slot).toBe(0);
    expect(sim.generalOf("p3")).toBe(red);
    expect(blue.here).toHaveLength(11);
    expect(blue.here).not.toContain("p3");
    expect(red.here).toEqual(["p3"]);
    expect(sim.units.length).toBe(units);
    // Their tab is remembered: a reload comes back to the army they last served.
    expect(sim.lastServed("tabtab3")).toBe(0);
    expect(sim.lastServed("tabtab5")).toBe(1);
    expect(sim.lastServed("never-seen")).toBe(-1);
    expect(sim.serve("px", 99)).toBeNull();
  });

  it("makes units at a building: paid for, counted against supply, there after their time", () => {
    const { sim, general, run, mine } = setup();
    const g = general("p1", 0);
    g.lithium = 1000;
    const core = [...sim.buildings.values()].find((b) => b.owner === g.slot)!;
    expect(sim.make(g.slot, core.id, "hauler", 3)).toBe("");
    expect(g.lithium).toBe(1000 - 3 * UNITS.hauler.lithium);
    expect(sim.supplyUsed(g.slot)).toBe(START_HAULERS + 3);
    expect(sim.make(g.slot, core.id, "trooper")).toBe("Not made here");
    run(UNITS.hauler.time * 3 + 2);
    expect(mine(g.slot, "hauler")).toHaveLength(START_HAULERS + 3);
    // Supply runs out at the Core's 12.
    g.lithium = 5000;
    expect(sim.make(g.slot, core.id, "hauler", 10)).toBe("");
    expect(sim.supplyUsed(g.slot)).toBe(BUILDINGS.core.supply);
    expect(sim.make(g.slot, core.id, "hauler")).toMatch(/Relay mast/);
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
    // Paid for, it stands there finished at once: at full strength, and making units straight away.
    const foundry = [...sim.buildings.values()].find((b) => b.kind === "foundry")!;
    expect(g.lithium).toBe(2000 - BUILDINGS.foundry.lithium);
    expect(foundry.doneAt).toBe(0);
    expect(foundry.hp).toBe(BUILDINGS.foundry.hp);
    expect(sim.make(g.slot, foundry.id, "trooper")).toBe("");
    // A Relay mast raises supply the moment it is put down.
    const supply = sim.supplyMax(g.slot);
    expect(sim.orderBuilding(g.slot, "relay", ...at(inX * 8, inZ * 2), "p1")).toBe("");
    expect(sim.supplyMax(g.slot)).toBe(supply + BUILDINGS.relay.supply!);
    // Units still take their time.
    run(1);
    expect(foundry.queue).toHaveLength(1);
    // Too far from where the general who orders it stands.
    host.at.set("p1", [0, 0.9, 0]);
    expect(sim.orderBuilding(g.slot, "relay", ...at(inX * 8, inZ * 8), "p1")).toMatch(/Too far/);
    void run;
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

describe("nothing passes through anything", () => {
  it("Haulers at work keep out of each other, the crystals and the Core, and still bring lithium in", () => {
    const { sim, general, mine } = setup();
    const g = general("p1", 0);
    const core = [...sim.buildings.values()].find((b) => b.owner === g.slot && b.kind === "core")!;
    // A busy base: twelve Haulers on the round.
    for (let i = 0; i < 8; i++) (sim as unknown as { spawnBeside(b: typeof core, kind: "hauler"): Unit | null }).spawnBeside(core, "hauler");
    const haulers = mine(g.slot, "hauler");
    const before = g.lithium;
    const r = UNITS.hauler.radius;
    let worstEach = 0, worstCrystal = 0, worstCore = 0;
    const deepIn = (u: Unit, x0: number, z0: number, x1: number, z1: number) => r - Math.hypot(u.x - Math.max(x0, Math.min(x1, u.x)), u.z - Math.max(z0, Math.min(z1, u.z)));
    for (let i = 0; i < Math.round(120 / DT); i++) {
      sim.tick();
      if (i < Math.round(10 / DT)) continue;
      for (const u of haulers) {
        for (const o of haulers) if (o.id < u.id) worstEach = Math.max(worstEach, 2 * r - Math.hypot(u.x - o.x, u.z - o.z));
        for (const f of sim.fields) if (f.kind === "crystal" && Math.abs(f.cx * CELL - u.x) < 12 && Math.abs(f.cz * CELL - u.z) < 12) worstCrystal = Math.max(worstCrystal, deepIn(u, f.cx * CELL, f.cz * CELL, (f.cx + 1) * CELL, (f.cz + 1) * CELL));
        const [x0, , z0, x1, , z1] = buildingBox("core", core.cx, core.cz);
        worstCore = Math.max(worstCore, deepIn(u, x0, z0, x1, z1));
      }
    }
    expect(worstEach).toBeLessThan(0.1);
    expect(worstCrystal).toBeLessThan(0.1);
    expect(worstCore).toBeLessThan(0.1);
    // Out of each other's way, they bring in as much as when they drove through each other (about 500 in this time).
    expect(g.lithium - before).toBeGreaterThan(450);
  });

  it("a crowd marching past a building and the end of a wall keeps every body out of both", () => {
    const { sim, general, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    // A Foundry (two cells square) and, beside it, a wall ending in the open: the way on is between them and round them.
    sim.addBuilding("foundry", g.slot, cx + 4, cz + 3, true);
    for (let z = cz - 2; z <= cz + 1; z++) piece("p1", "wall", cx + 8, 0, z, 1);
    const units = [
      ...Array.from({ length: 16 }, (_, i) => sim.addUnit("trooper", g.slot, (cx - 2) * CELL + (i % 4) * 2.2, (cz + 0.5) * CELL + Math.floor(i / 4) * 2.2)),
      ...Array.from({ length: 6 }, (_, i) => sim.addUnit("tank", g.slot, (cx - 4) * CELL + (i % 2) * 5, (cz - 1) * CELL + Math.floor(i / 2) * 5)),
    ];
    sim.command(g.slot, units.map((u) => u.id), { k: "move", x: (cx + 14.5) * CELL, z: (cz + 2) * CELL, l: 0 });
    const fx0 = (cx + 4) * CELL, fx1 = (cx + 6) * CELL, fz0 = (cz + 3) * CELL, fz1 = (cz + 5) * CELL;
    const wx = (cx + 8) * CELL, wz0 = (cz - 2) * CELL, wz1 = (cz + 2) * CELL;
    let worst = 0;
    for (let i = 0; i < 250; i++) {
      sim.tick();
      for (const u of units) {
        const r = UNITS[u.kind].radius;
        // How deep its body is in the building: the distance from its middle to the nearest point of the building, short of its radius.
        const qx = Math.max(fx0, Math.min(fx1, u.x)), qz = Math.max(fz0, Math.min(fz1, u.z));
        worst = Math.max(worst, r - Math.hypot(u.x - qx, u.z - qz));
        // And in the wall (0.3 m thick, along z).
        const wqx = Math.max(wx - THICK / 2, Math.min(wx + THICK / 2, u.x)), wqz = Math.max(wz0, Math.min(wz1, u.z));
        worst = Math.max(worst, r - Math.hypot(u.x - wqx, u.z - wqz));
      }
    }
    expect(worst).toBeLessThan(0.1);
    // And they got there.
    expect(units.filter((u) => u.x > (cx + 9) * CELL).length).toBeGreaterThan(units.length * 0.8);
  });

  it("a tank in the middle of its own army standing packed round it drives out: they make way, and nobody is driven into", () => {
    const { sim, general } = setup();
    const g = general("p1", 0);
    const [x0, z0] = OPEN;
    // Troopers standing in a tight block, a tank in the middle of them.
    const crowd = [];
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (Math.abs(i) > 1 || Math.abs(j) > 1) crowd.push(sim.addUnit("trooper", g.slot, x0 + i * 1.6, z0 + j * 1.6));
    const tank = sim.addUnit("tank", g.slot, x0, z0);
    for (let i = 0; i < 20; i++) sim.tick();
    sim.command(g.slot, [tank.id], { k: "move", x: x0 + 30, z: z0, l: 0 });
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      sim.tick();
      for (const c of crowd) worst = Math.max(worst, UNITS.tank.radius + UNITS.trooper.radius - Math.hypot(c.x - tank.x, c.z - tank.z));
    }
    // Six seconds: out, and most of the way there.
    expect(tank.x).toBeGreaterThan(x0 + 20);
    expect(worst).toBeLessThan(0.5);
  });

  it("a Titan goes round a floor too low to walk under; a tank goes under it", () => {
    const { sim, general, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    // A floor one storey up across cells cx..cx+2 on row cz, held up by walls at its ends: a low bridge over the way.
    piece("p1", "wall", cx, 0, cz, 1);
    piece("p1", "wall", cx + 3, 0, cz, 1);
    for (let x = cx; x <= cx + 2; x++) piece("p1", "floor", x, 1, cz);
    const titan = sim.addUnit("titan", g.slot, (cx + 1.5) * CELL, (cz - 3.5) * CELL);
    const tank = sim.addUnit("tank", g.slot, (cx + 1.5) * CELL, (cz - 3.5) * CELL + 0.1);
    sim.command(g.slot, [titan.id, tank.id], { k: "move", x: (cx + 1.5) * CELL, z: (cz + 3.5) * CELL, l: 0 });
    let titanUnder = false, tankUnder = false;
    for (let i = 0; i < 500; i++) {
      sim.tick();
      if (titan.cz === cz && titan.cx >= cx && titan.cx <= cx + 2 && titan.level === 0) titanUnder = true;
      if (tank.cz === cz && tank.cx >= cx && tank.cx <= cx + 2 && tank.level === 0) tankUnder = true;
    }
    expect(titanUnder).toBe(false);
    expect(tankUnder).toBe(true);
    // The Titan went round, and got there too.
    expect(Math.hypot(titan.x - (cx + 1.5) * CELL, titan.z - (cz + 3.5) * CELL)).toBeLessThan(10);
  });

  it("drones rise over a Core and a tower of pieces, and come back down past them", () => {
    const { sim, general, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    sim.addBuilding("core", g.slot, cx + 6, cz - 1, true);
    for (let y = 0; y < 6; y++) piece("p1", "wall", cx + 14, y, cz, 1);
    const drone = sim.addUnit("gunship", g.slot, cx * CELL, (cz + 0.5) * CELL);
    sim.command(g.slot, [drone.id], { k: "move", x: (cx + 20) * CELL, z: (cz + 0.5) * CELL, l: 0 });
    let lowest = Infinity;
    for (let i = 0; i < 120; i++) {
      sim.tick();
      const overCore = drone.x > (cx + 6) * CELL - 1.8 && drone.x < (cx + 9) * CELL + 1.8;
      const overTower = Math.abs(drone.x - (cx + 14) * CELL) < 1.8 + 0.2;
      if (overCore) lowest = Math.min(lowest, drone.y - UNITS.gunship.height / 2 - BUILDINGS.core.height);
      if (overTower) lowest = Math.min(lowest, drone.y - UNITS.gunship.height / 2 - 6 * LEVEL);
    }
    expect(lowest).toBeGreaterThan(0.3);
    // Past them, it settles back to its usual height.
    for (let i = 0; i < 60; i++) sim.tick();
    expect(drone.y).toBeCloseTo(14, 0);
  });

  it("a building between stops a straight shot; the building aimed at does not", () => {
    const { sim, general } = setup();
    const g = general("p1", 0), h = general("p2", 1);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    const shooter = sim.addUnit("tank", g.slot, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
    const behind = sim.addUnit("trooper", h.slot, (cx + 6.5) * CELL, (cz + 0.5) * CELL);
    expect(sim.nav.clearLine(shooter.x, shooter.z, behind.x, behind.z, 0)).toBe(true);
    // A relay mast goes up between them.
    sim.addBuilding("relay", g.slot, cx + 3, cz, true);
    expect(sim.nav.clearLine(shooter.x, shooter.z, behind.x, behind.z, 0)).toBe(false);
    // An enemy Foundry beyond: aimed at, its own cells do not get in the way.
    const foundry = sim.addBuilding("foundry", h.slot, cx, cz + 4, true);
    const c = [(cx + 1) * CELL, (cz + 5) * CELL];
    expect(sim.nav.clearLine(shooter.x, shooter.z, c[0]!, c[1]!, 0, (BUILDINGS[foundry.kind].size * CELL) / 2)).toBe(true);
    // A field of crystals is low: shots go over it.
    const f = sim.fields[0]!;
    expect(sim.nav.clearLine((f.cx - 3.5) * CELL, (f.cz + 0.5) * CELL, (f.cx + 4.5) * CELL, (f.cz + 0.5) * CELL, 0)).toBe(true);
  });

  it("stands on a floor's top on the ground, and on a ramp's slope", () => {
    const { sim, general, piece } = setup();
    const g = general("p1", 0);
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    piece("p1", "floor", cx + 2, 0, cz);
    const u = sim.addUnit("trooper", g.slot, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
    sim.command(g.slot, [u.id], { k: "move", x: (cx + 2.5) * CELL, z: (cz + 0.5) * CELL, l: 0 });
    for (let i = 0; i < 40; i++) sim.tick();
    expect(u.cx).toBe(cx + 2);
    expect(u.y).toBeCloseTo(THICK / 2, 5);
  });

  it("a building is not put down on a general, or under a floor over its ground", () => {
    const { sim, general, piece, host } = setup();
    const g = general("p1", 0);
    g.lithium = 5000;
    g.plasma = 5000;
    const s = STARTS[g.start]!;
    const inX = -Math.sign(s.cx) || 1, inZ = -Math.sign(s.cz) || 1;
    const [bx, bz] = [s.cx + inX * 4, s.cz + inZ * 4];
    // The general stands right where the Foundry would go.
    host.at.set("p1", [(bx + 1) * CELL, 0.9, (bz + 1) * CELL]);
    expect(sim.cannotBuild(g.slot, "foundry", bx, bz)).toBe("A general is standing there");
    host.at.set("p1", [(bx - 3) * CELL, 0.9, bz * CELL]);
    expect(sim.cannotBuild(g.slot, "foundry", bx, bz)).toBe("");
    // A floor one storey up over one of its cells (held by walls beyond it): no.
    piece("p1", "wall", bx + 2, 0, bz, 1);
    piece("p1", "floor", bx + 1, 1, bz);
    expect(sim.cannotBuild(g.slot, "foundry", bx, bz)).toBe("Something is built there");
  });
});

describe("each soldier thinks for itself", () => {
  function twoSides() {
    const s = setup();
    const a = s.general("pa", 0), b = s.general("pb", 4);
    return { ...s, a, b };
  }
  /** A block of Troopers, `n` of them, `rows` deep, with its middle at (x, z), facing along z. */
  function squad(sim: Sim, slot: number, n: number, x: number, z: number) {
    const per = Math.ceil(Math.sqrt(n * 2));
    return Array.from({ length: n }, (_, i) => sim.addUnit("trooper", slot, x + ((i % per) - per / 2) * 2.2, z + Math.floor(i / per) * 2.2));
  }
  /** Who fired, and at whom, over the steps run. */
  function watchShots(sim: Sim, run: (s: number) => void) {
    const shooters = new Set<number>(), hits = new Map<number, number>();
    return (seconds: number) => {
      for (let i = 0; i < seconds * 10; i++) {
        run(0.1);
        for (const shot of sim.happened.shots) {
          if (shot.by) shooters.add(shot.by);
          if (shot.hit > 0) hits.set(shot.hit, (hits.get(shot.hit) ?? 0) + 1);
        }
        sim.happened = emptyHappened();
      }
      return { shooters, hits };
    };
  }

  it("twenty attack-moving into twenty: nearly every soldier fires, at targets of its own, not all at one", () => {
    const { sim, a, b, run } = twoSides();
    const red = squad(sim, a.slot, 20, OPEN[0], OPEN[1]);
    const blue = squad(sim, b.slot, 20, OPEN[0], OPEN[1] + 45);
    sim.command(a.slot, red.map((u) => u.id), { k: "amove", x: OPEN[0], z: OPEN[1] + 45, l: 0 });
    sim.command(b.slot, blue.map((u) => u.id), { k: "amove", x: OPEN[0], z: OPEN[1], l: 0 });
    const { shooters, hits } = watchShots(sim, run)(15);
    const redFired = red.filter((u) => shooters.has(u.id)).length, blueFired = blue.filter((u) => shooters.has(u.id)).length;
    expect(redFired).toBeGreaterThanOrEqual(18);
    expect(blueFired).toBeGreaterThanOrEqual(18);
    const total = [...hits.values()].reduce((x, y) => x + y, 0);
    expect(Math.max(...hits.values())).toBeLessThan(total / 3);
    // Many targets were shot at, not a few.
    expect(hits.size).toBeGreaterThan(12);
  });

  it("a plain move goes past enemies without a shot", () => {
    const { sim, a, b, run } = twoSides();
    const red = squad(sim, a.slot, 6, OPEN[0], OPEN[1]);
    squad(sim, b.slot, 4, OPEN[0] + 30, OPEN[1] + 20);
    for (const u of [...sim.units]) if (u.owner === b.slot) sim.command(b.slot, [u.id], { k: "hold" });
    sim.command(a.slot, red.map((u) => u.id), { k: "move", x: OPEN[0], z: OPEN[1] + 45, l: 0 });
    const { shooters } = watchShots(sim, run)(5);
    expect(red.some((u) => shooters.has(u.id))).toBe(false);
  });

  it("standing soldiers go after an enemy they see, fight, and come back to where they stood; held ones never move", () => {
    const { sim, a, b, run } = twoSides();
    const guards = squad(sim, a.slot, 4, OPEN[0], OPEN[1]);
    const holders = squad(sim, a.slot, 3, OPEN[0] - 30, OPEN[1]);
    sim.command(a.slot, holders.map((u) => u.id), { k: "hold" });
    run(0.5);
    const stood = guards.map((u) => [u.x, u.z]), held = holders.map((u) => [u.x, u.z]);
    // An enemy 40 m off: out of a rifle's 28, inside its 45 of sight.
    const enemy = sim.addUnit("hauler", b.slot, OPEN[0], OPEN[1] + 40);
    sim.command(b.slot, [enemy.id], { k: "hold" });
    const { shooters } = watchShots(sim, run)(12);
    expect(enemy.dead).toBe(true);
    expect(guards.filter((u) => shooters.has(u.id)).length).toBeGreaterThanOrEqual(2);
    run(15);
    guards.forEach((u, i) => expect(Math.hypot(u.x - stood[i]![0]!, u.z - stood[i]![1]!)).toBeLessThan(3.5));
    holders.forEach((u, i) => expect(Math.hypot(u.x - held[i]![0]!, u.z - held[i]![1]!)).toBeLessThan(0.5));
  });

  it("an enemy that keeps going is let go: a guard does not follow it across the map", () => {
    const { sim, a, b, run } = twoSides();
    const [guard] = squad(sim, a.slot, 1, OPEN[0], OPEN[1]);
    run(0.5);
    const runner = sim.addUnit("tank", b.slot, OPEN[0], OPEN[1] + 40);
    runner.hp = 100_000;
    sim.command(b.slot, [runner.id], { k: "move", x: OPEN[0], z: OPEN[1] + 200, l: 0 });
    run(30);
    expect(Math.hypot(guard!.x - OPEN[0], guard!.z - OPEN[1])).toBeLessThan(5);
  });

  it("a group told to attack one building spreads round it, each to a firing spot of its own", () => {
    const { sim, a, b, run } = twoSides();
    const cx = Math.floor(OPEN[0] / CELL), cz = Math.floor(OPEN[1] / CELL);
    const target = sim.addBuilding("foundry", b.slot, cx, cz + 14, true);
    target.hp = 1e9;
    const red = squad(sim, a.slot, 12, OPEN[0], OPEN[1] - 10);
    sim.command(a.slot, red.map((u) => u.id), { k: "attack", tk: T_BUILDING, id: target.id });
    run(25);
    const c = sim.centreOf(target);
    const angles = red.map((u) => Math.atan2(u.x - c[0], u.z - c[2])).sort((x, y) => x - y);
    expect(((angles[angles.length - 1]! - angles[0]!) * 180) / Math.PI).toBeGreaterThan(120);
    // And they all fire.
    const { shooters } = watchShots(sim, run)(4);
    expect(red.filter((u) => shooters.has(u.id)).length).toBeGreaterThanOrEqual(11);
  });

  it("a patrol keeps its shape, leg after leg: no pile", () => {
    const { sim, a, run } = twoSides();
    const red = squad(sim, a.slot, 12, OPEN[0], OPEN[1]);
    const spacing = (list: Unit[]) => {
      let sum = 0, n = 0, min = Infinity;
      for (const p of list) for (const q of list) {
        if (p === q) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        sum += d;
        n++;
        min = Math.min(min, d);
      }
      return { mean: sum / n, min };
    };
    const start = spacing(red);
    sim.command(a.slot, red.map((u) => u.id), { k: "patrol", x: OPEN[0] + 60, z: OPEN[1], l: 0, bx: OPEN[0], bz: OPEN[1], bl: 0 });
    run(45);
    const later = spacing(red);
    expect(later.min).toBeGreaterThan(1);
    expect(later.mean).toBeGreaterThan(start.mean * 0.8);
    expect(red.every((u) => u.order.k === "patrol" && u.order.px !== undefined)).toBe(true);
  });

  it("soldiers step round a general standing in their way", () => {
    const { sim, a, run, host } = twoSides();
    host.at.set("pa", [OPEN[0], 0.95, OPEN[1] + 15]);
    const red = squad(sim, a.slot, 6, OPEN[0], OPEN[1]);
    sim.command(a.slot, red.map((u) => u.id), { k: "move", x: OPEN[0], z: OPEN[1] + 30, l: 0 });
    let nearest = Infinity;
    for (let i = 0; i < 100; i++) {
      run(0.1);
      for (const u of red) nearest = Math.min(nearest, Math.hypot(u.x - OPEN[0], u.z - (OPEN[1] + 15)) - UNITS.trooper.radius);
    }
    expect(nearest).toBeGreaterThan(0.45);
    expect(red.filter((u) => u.z > OPEN[1] + 25).length).toBeGreaterThanOrEqual(5);
  });

  it("a tank's gun turns to its target while its hull keeps to the way it drives", () => {
    const { sim, a, b, run } = twoSides();
    const tank = sim.addUnit("tank", a.slot, OPEN[0], OPEN[1]);
    const target = sim.addUnit("tank", b.slot, OPEN[0] + 25, OPEN[1] + 25);
    target.hp = 1e9;
    sim.command(b.slot, [target.id], { k: "hold" });
    sim.command(a.slot, [tank.id], { k: "amove", x: OPEN[0], z: OPEN[1] + 60, l: 0 });
    let apart = 0;
    for (let i = 0; i < 40; i++) {
      run(0.1);
      if (tank.tk && Math.abs(Math.atan2(Math.sin(tank.aim - tank.heading), Math.cos(tank.aim - tank.heading))) > 0.4) apart++;
    }
    expect(apart).toBeGreaterThan(5);
    // (On it, near enough: each shell throws the target a few metres, after the gun was laid.)
    expect(Math.abs(Math.atan2(Math.sin(tank.aim - Math.atan2(target.x - tank.x, target.z - tank.z)), Math.cos(tank.aim - Math.atan2(target.x - tank.x, target.z - tank.z))))).toBeLessThan(0.35);
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

describe("leaving, and changing sides", () => {
  it("a general who leaves takes nothing with them: the army stands as it is, pieces too, for whoever serves it next", () => {
    const { sim, general, run, piece, host } = setup();
    const g = general("p1", 0);
    const wall = piece("p1", "wall", 10, 0, 10);
    sim.placed("p1", [wall]);
    g.lithium = 600;
    const tank = sim.addUnit("tank", 0, OPEN[0], OPEN[1]);
    sim.leave("p1");
    expect(g.here).toHaveLength(0);
    expect(sim.generalOf("p1")).toBeNull();
    run(120);
    expect(sim.generals[0]).toBe(g);
    expect(tank.dead).toBe(false);
    expect([...sim.buildings.values()].filter((b) => b.owner === 0 && b.kind === "core")).toHaveLength(1);
    expect(host.removed).toHaveLength(0);
    // Nobody plays an army nobody serves: it has built nothing more (its Haulers have gone on mining).
    expect([...sim.buildings.values()].filter((b) => b.owner === 0)).toHaveLength(1);
    expect(g.lithium).toBeGreaterThan(600);
    // The wall is the army's: whoever serves it may change it, and nobody else.
    expect(sim.ownerOfPiece(wall.id)).toBe(0);
    general("p2", 0);
    general("p3", 4);
    expect(sim.mayChange("p2", wall)).toBe(true);
    expect(sim.mayChange("p3", wall)).toBe(false);
  });

  it("what a general built stays with the army they built it for when they change sides", () => {
    const { sim, general, piece } = setup();
    general("p1", 0);
    general("p9", 4);
    const before = piece("p1", "wall", 10, 0, 10);
    sim.placed("p1", [before]);
    // The same builder, the same id: now serving the army at start 4.
    sim.serve("p1", 4, "tab-p1");
    const after = piece("p1", "wall", 12, 0, 10);
    sim.placed("p1", [after]);
    expect(sim.ownerOfPiece(before.id)).toBe(0);
    expect(sim.ownerOfPiece(after.id)).toBe(4);
    expect(sim.mayChange("p1", before)).toBe(false);
    expect(sim.mayChange("p1", after)).toBe(true);
    expect(sim.mayChange("p9", after)).toBe(true);
    // And it is so again after a sleep.
    const saved = JSON.parse(JSON.stringify(sim.snapshot()));
    const again = setup();
    again.build.apply({ kind: "place", piece: before });
    again.build.apply({ kind: "place", piece: after });
    expect(again.sim.restore(saved)).toBe(true);
    expect(again.sim.ownerOfPiece(before.id)).toBe(0);
    expect(again.sim.ownerOfPiece(after.id)).toBe(4);
    expect(again.sim.lastServed("tab-p1")).toBe(4);
    expect(again.sim.generals.every((g) => !g || g.here.length === 0)).toBe(true);
  });

  it("each general is thrown for themselves: two serving one army, the one by the blast flies, and has a moment's grace after", () => {
    const { sim, general, host } = setup();
    general("pa", 0);
    general("pb", 4);
    general("pc", 4);
    host.at.set("pb", [OPEN[0], 0.9, OPEN[1]]);
    host.at.set("pc", [OPEN[0] + 60, 0.9, OPEN[1]]);
    sim.tick();
    sim.blast([OPEN[0] + 1, 0.5, OPEN[1]], 4, 30, 0, { air: false, ground: true, wear: 0 });
    expect(host.thrown).toEqual(["pb"]);
    sim.blast([OPEN[0] + 1, 0.5, OPEN[1]], 4, 30, 0, { air: false, ground: true, wear: 0 });
    expect(host.thrown).toEqual(["pb"]);
    sim.blast([OPEN[0] + 61, 0.5, OPEN[1]], 4, 30, 0, { air: false, ground: true, wear: 0 });
    expect(host.thrown).toEqual(["pb", "pc"]);
    // Their own army's blasts throw neither.
    sim.blast([OPEN[0] + 61, 0.5, OPEN[1]], 4, 30, 4, { air: false, ground: true, wear: 0 });
    expect(host.thrown).toEqual(["pb", "pc"]);
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
