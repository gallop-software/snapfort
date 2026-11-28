import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { Computer } from "./ai";
import { BUILDINGS, COMPUTER, GUARD_RADIUS, MAX_SUPPLY, ROUTED_WAIT, START_HAULERS, START_LITHIUM, UNITS, UPGRADE_LEVELS } from "./kit";
import { STARTS } from "./map";
import { DT, emptyHappened, Sim, type Host } from "./sim";
import { HALF_CELLS, world } from "./world";

/** A war with the computer on, and a person serving the army at `start`, standing by its Core. */
function setup(start = 0) {
  const build = new BuildState();
  build.halfCells = HALF_CELLS;
  const at = new Map<string, [number, number, number]>();
  const host: Host = { positionOf: (p) => at.get(p) ?? null, wear: () => {}, removePieces: () => {} };
  const sim = new Sim(build, world, host);
  sim.computerOn = true;
  sim.postSentries(true);
  const ai = new Computer(sim);
  const person = sim.serve("p", start, "tab-of-p")!;
  at.set("p", [STARTS[person.start]!.spawn[0], 0.9, STARTS[person.start]!.spawn[1]]);
  let ms = 0, thinks = 0;
  /** Runs the war as the room does: the computer thinks every second. `each`: called every second. */
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      sim.tick();
      if (sim.step % 10 === 7) {
        const t0 = performance.now();
        ai.think();
        ms += performance.now() - t0;
        thinks++;
      }
      if (sim.step % 2 === 0) sim.happened = emptyHappened();
      if (each && sim.step % 10 === 0) each();
    }
  };
  const theirs = (slot: number) => ({
    units: sim.units.filter((u) => u.owner === slot && !u.dead),
    buildings: [...sim.buildings.values()].filter((b) => b.owner === slot && !b.dead),
    fighters: sim.units.filter((u) => u.owner === slot && !u.dead && UNITS[u.kind].weapon && u.kind !== "hauler"),
  });
  const core = (slot: number) => theirs(slot).buildings.find((b) => b.kind === "core");
  return { sim, ai, person, run, theirs, core, thinkMs: () => ms / Math.max(1, thinks) };
}

describe("the computer", () => {
  it("is begun with the first person's army, as anyone's is, always pink, and nobody may serve it", () => {
    const { sim, theirs } = setup(0);
    const c = sim.generals[COMPUTER]!;
    expect(c.ai).toBe(true);
    expect(c.name).toBe("Computer");
    expect(c.start).toBe(COMPUTER);
    expect(c.lithium).toBe(START_LITHIUM);
    expect(theirs(COMPUTER).buildings.map((b) => b.kind)).toEqual(["core"]);
    expect(theirs(COMPUTER).units.filter((u) => u.kind === "hauler")).toHaveLength(START_HAULERS);
    expect(sim.serve("q", COMPUTER, "tab-of-q")).toBeNull();
    // Nobody else's army is begun for it.
    expect(sim.generals.filter((g) => g).map((g) => g!.slot)).toEqual([0, COMPUTER]);
  });

  it("is never begun on top of what someone built at its start", () => {
    const build = new BuildState();
    build.halfCells = HALF_CELLS;
    const sim = new Sim(build, world, { positionOf: () => null, wear: () => {}, removePieces: () => {} });
    sim.serve("p", 0, "tab-of-p");
    // Someone's Foundry right where the computer's Core would go.
    const s = STARTS[COMPUTER]!;
    const theirs = sim.addBuilding("foundry", 0, s.cx - 1, s.cz - 1, true);
    sim.computerOn = true;
    sim.keepComputer();
    const core = [...sim.buildings.values()].find((b) => b.owner === COMPUTER && b.kind === "core")!;
    expect(core).toBeTruthy();
    const overlap = core.cx < theirs.cx + 2 && theirs.cx < core.cx + 3 && core.cz < theirs.cz + 2 && theirs.cz < core.cz + 3;
    expect(overlap).toBe(false);
  });

  it("mines, builds up in order and raises an army, by the same rules: nothing on top of anything, turrets by its own Core", () => {
    const { sim, run, theirs, thinkMs } = setup(0);
    run(360);
    const mine = theirs(COMPUTER);
    const kinds = new Set(mine.buildings.map((b) => b.kind));
    for (const k of ["foundry", "tap", "relay", "sentry", "armory"] as const) expect(kinds.has(k)).toBe(true);
    expect(mine.units.filter((u) => u.kind === "hauler").length).toBeGreaterThanOrEqual(12);
    expect(mine.fighters.length).toBeGreaterThan(6);
    expect(sim.supplyUsed(COMPUTER)).toBeLessThanOrEqual(sim.supplyMax(COMPUTER));
    // Nothing of its own built over anything.
    const cells = new Set<string>();
    for (const b of sim.buildings.values()) {
      for (let x = b.cx; x < b.cx + BUILDINGS[b.kind].size; x++) {
        for (let z = b.cz; z < b.cz + BUILDINGS[b.kind].size; z++) {
          expect(cells.has(`${x},${z},${b.l}`)).toBe(false);
          cells.add(`${x},${z},${b.l}`);
        }
      }
    }
    const home = mine.buildings.find((b) => b.kind === "core")!;
    for (const t of mine.buildings.filter((b) => BUILDINGS[b.kind].nearCore)) {
      const a = sim.centreOf(t), c = sim.centreOf(home);
      expect(Math.hypot(a[0] - c[0], a[2] - c[2])).toBeLessThanOrEqual(GUARD_RADIUS);
    }
    // Light on the server: a think is a small fraction of a millisecond.
    expect(thinkMs()).toBeLessThan(1);
  }, 60_000);

  it("with money to spare it builds up to a person's limits, no further: 200 supply, Titans, upgrades to the top", () => {
    const { sim, run, theirs } = setup(0);
    sim.generals[COMPUTER]!.lithium = 50_000;
    sim.generals[COMPUTER]!.plasma = 50_000;
    let titans = 0;
    run(600, () => void (titans = Math.max(titans, theirs(COMPUTER).units.filter((u) => u.kind === "titan").length)));
    expect(sim.supplyMax(COMPUTER)).toBe(MAX_SUPPLY);
    expect(sim.supplyUsed(COMPUTER)).toBeLessThanOrEqual(MAX_SUPPLY);
    expect(titans).toBeGreaterThan(0);
    expect(sim.generals[COMPUTER]!.upgrades.weapons).toBe(UPGRADE_LEVELS);
    expect(sim.generals[COMPUTER]!.upgrades.armour).toBe(UPGRADE_LEVELS);
  }, 60_000);

  it("leaves nobody alone: it comes for a new army as soon as it has a few units, and a person who does nothing loses their Core early", () => {
    const { sim, run, theirs, core } = setup(0);
    const home = sim.centreOf(core(0)!);
    let firstNear = Infinity;
    run(9 * 60, () => {
      if (firstNear === Infinity && theirs(COMPUTER).fighters.some((u) => Math.hypot(u.x - home[0], u.z - home[2]) < 120)) firstNear = sim.t;
    });
    // (It was five minutes of peace, and the Core gone within fifteen.)
    expect(firstNear).toBeLessThan(480);
    expect(core(0)).toBeUndefined();
  }, 120_000);

  it("breaks a defended base that the medium computer could not: turrets and an army by the Core, and the Core falls", () => {
    const { sim, run, core, ai } = setup(0);
    // A person who has built up: turrets and an army by their Core, between it and the computer. (Medium's waves broke on
    // this and went home, and the base stood.)
    const c = sim.centreOf(core(0)!);
    const toward = [STARTS[COMPUTER]!.cx * 5 - c[0], STARTS[COMPUTER]!.cz * 5 - c[2]];
    const d = Math.hypot(toward[0]!, toward[1]!);
    const fx = c[0] + (toward[0]! / d) * 25, fz = c[2] + (toward[1]! / d) * 25;
    for (let i = 0; i < 4; i++) sim.addBuilding("sentry", 0, Math.floor(fx / 5) + i * 2 - 3, Math.floor(fz / 5), true);
    for (let i = 0; i < 16; i++) sim.addUnit("trooper", 0, fx + (i % 8) * 2 - 8, fz + Math.floor(i / 8) * 2 + 5);
    for (let i = 0; i < 4; i++) sim.addUnit("tank", 0, fx + i * 4 - 8, fz + 12);
    let fell = Infinity, sent = false;
    run(16 * 60, () => {
      sent ||= ai.attacking;
      if (fell === Infinity && !core(0)) fell = sim.t;
    });
    expect(sent).toBe(true);
    expect(fell).toBeLessThan(16 * 60);
  }, 180_000);

  it("does not throw its army at a fortress far stronger than it has: it waits, growing, rather than attack", () => {
    const { sim, run, theirs, core, ai } = setup(0);
    const c = sim.centreOf(core(0)!);
    const toward = [STARTS[COMPUTER]!.cx * 5 - c[0], STARTS[COMPUTER]!.cz * 5 - c[2]];
    const d = Math.hypot(toward[0]!, toward[1]!);
    const fx = c[0] + (toward[0]! / d) * 25, fz = c[2] + (toward[1]! / d) * 25;
    for (let i = 0; i < 10; i++) sim.addBuilding("sentry", 0, Math.floor(fx / 5) + i * 2 - 10, Math.floor(fz / 5), true);
    for (let i = 0; i < 40; i++) sim.addUnit("tank", 0, fx + (i % 10) * 4 - 20, fz + Math.floor(i / 10) * 5 + 6);
    let wentIn = false;
    run(8 * 60, () => void (wentIn ||= ai.attacking && (ai as unknown as { mind: { phase: string } }).mind.phase === "attack"));
    expect(wentIn).toBe(false);
    expect(theirs(COMPUTER).fighters.length).toBeGreaterThan(40);
    expect(core(0)).toBeTruthy();
  }, 180_000);

  it("a wave all but wiped out turns for home, rather than throw away the last of it", () => {
    const { sim, run, theirs, ai } = setup(0);
    let cut = false;
    run(12 * 60, () => {
      if (cut || !ai.attacking) return;
      // Out, and nearly all of it lost at once.
      const wave = theirs(COMPUTER).fighters.filter((u) => (ai as unknown as { mind: { out: Set<number> } }).mind.out.has(u.id));
      if (wave.length < 10) return;
      for (const u of wave.slice(0, Math.ceil(wave.length * 0.85))) sim.kill(u, false);
      cut = true;
      run(3);
      expect(ai.attacking).toBe(false);
      // (Going home, or there already: not going on.)
      for (const u of wave.filter((u) => !u.dead)) expect(["move", "stop"]).toContain(u.order.k);
    });
    expect(cut).toBe(true);
  }, 180_000);

  it("drives off whoever comes at its base", () => {
    const { sim, run, theirs, core } = setup(0);
    run(300);
    const c = sim.centreOf(core(COMPUTER)!);
    const raiders = [0, 1, 2].map((i) => sim.addUnit("scout", 0, c[0] + 60 + i * 3, c[2] + 20));
    // (Its army may be out by now, gathering at someone's door: it comes back for them.)
    run(75);
    expect(raiders.every((u) => u.dead)).toBe(true);
    expect(theirs(COMPUTER).buildings.length).toBeGreaterThan(3);
  }, 60_000);

  it("routed, it begins again with a new Core where it started", () => {
    const { sim, run, theirs } = setup(0);
    run(10);
    for (const u of [...sim.units]) if (u.owner === COMPUTER) sim.kill(u, false);
    for (const b of theirs(COMPUTER).buildings) sim.scrap(COMPUTER, b.id);
    expect(sim.generals[COMPUTER]!.routedAt).toBeGreaterThan(0);
    run(ROUTED_WAIT + 4);
    const cores = theirs(COMPUTER).buildings.filter((b) => b.kind === "core");
    expect(cores).toHaveLength(1);
    expect(Math.hypot(cores[0]!.cx - (STARTS[COMPUTER]!.cx - 1), cores[0]!.cz - (STARTS[COMPUTER]!.cz - 1))).toBeLessThan(3);
    run(40);
    expect(theirs(COMPUTER).units.filter((u) => u.kind === "hauler").length).toBeGreaterThan(0);
  }, 60_000);

  it("a person routed and beginning again is begun afresh: their army's time starts again", () => {
    const { sim, person, core } = setup(0);
    sim.t = 2000;
    const old = core(0)!;
    sim.scrap(0, old.id);
    expect(person.routedAt).toBeGreaterThan(0);
    sim.t += ROUTED_WAIT + 1;
    const s = STARTS[0]!;
    expect(sim.orderBuilding(0, "core", s.cx - 1, s.cz - 1)).toBe("");
    expect(person.bornAt).toBe(sim.t);
  });

  it("goes when there is no person's army left, and is begun afresh for the next", () => {
    const { sim, run, theirs } = setup(0);
    run(120);
    sim.leave("p");
    sim.wipe(0);
    sim.keepComputer();
    expect(sim.generals[COMPUTER]).toBeNull();
    expect(theirs(COMPUTER).units).toHaveLength(0);
    expect(theirs(COMPUTER).buildings).toHaveLength(0);
    sim.serve("q", 3, "tab-of-q");
    expect(theirs(COMPUTER).buildings).toHaveLength(1);
    expect(sim.generals[COMPUTER]!.lithium).toBe(START_LITHIUM);
  }, 60_000);
});
