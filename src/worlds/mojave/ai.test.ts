import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { Computer } from "./ai";
import { BUILDINGS, COMPUTER, GUARD_RADIUS, MAX_SUPPLY, ROUTED_WAIT, START_HAULERS, START_LITHIUM, UNITS, UPGRADE_LEVELS } from "./kit";
import { SITES, STARTS } from "./map";
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

  it("booms first: a new base as fast as it can save for one, every base its turrets at once, by the same rules (nothing on top of anything, turrets by its own Cores)", () => {
    const { sim, run, theirs, thinkMs } = setup(0);
    const coreAt = new Map<number, number>(), guardedAt = new Map<number, number>(), fullAt = new Map<number, number>();
    run(9 * 60, () => {
      const mine = theirs(COMPUTER).buildings;
      for (const c of mine.filter((b) => b.kind === "core")) {
        if (!coreAt.has(c.id)) coreAt.set(c.id, sim.t);
        const cc = sim.centreOf(c);
        const near = mine.filter((b) => BUILDINGS[b.kind].nearCore && Math.hypot(sim.centreOf(b)[0] - cc[0], sim.centreOf(b)[2] - cc[2]) <= GUARD_RADIUS);
        const sentries = near.filter((b) => b.kind === "sentry").length, flak = near.filter((b) => b.kind === "flak").length;
        if (sentries >= 2 && !guardedAt.has(c.id)) guardedAt.set(c.id, sim.t);
        if (sentries >= 4 && flak >= 2 && !fullAt.has(c.id)) fullAt.set(c.id, sim.t);
      }
    });
    const founded = [...coreAt.values()].sort((a, b) => a - b);
    // Its natural within four minutes, three bases within six, and more after.
    expect(founded[1]).toBeLessThan(4 * 60);
    expect(founded[2]).toBeLessThan(6 * 60);
    expect(founded.length).toBeGreaterThanOrEqual(5);
    // Every base its first two Sentries within a minute and a half of it (the first, within four minutes: it needs a
    // Foundry first), and its full defence (four, and two Flak) in the end.
    for (const [id, at] of coreAt) {
      if (at > 8 * 60) continue;
      expect((guardedAt.get(id) ?? Infinity) - at).toBeLessThan(at === founded[0] ? 240 : 90);
      expect(fullAt.has(id)).toBe(true);
    }
    const mine = theirs(COMPUTER);
    expect(mine.units.filter((u) => u.kind === "hauler").length).toBeGreaterThanOrEqual(40);
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
    // Every turret by one of its own Cores.
    const cores = mine.buildings.filter((b) => b.kind === "core");
    for (const t of mine.buildings.filter((b) => BUILDINGS[b.kind].nearCore)) {
      const a = sim.centreOf(t);
      expect(cores.some((c) => Math.hypot(a[0] - sim.centreOf(c)[0], a[2] - sim.centreOf(c)[2]) <= GUARD_RADIUS)).toBe(true);
    }
    // Light on the server: a think is a small fraction of a millisecond.
    expect(thinkMs()).toBeLessThan(1);
  }, 120_000);

  it("never builds on a start a colour in play holds; with the middle taken, it takes the starts of colours nobody plays; and a newcomer is never begun beside it", () => {
    const { sim, run, theirs } = setup(0);
    // A second person, on the start beside the computer's; and the person's Cores on every rich field in the middle.
    sim.serve("q", 6, "tab-of-q");
    for (const site of SITES.filter((x) => x.kind === "rich")) sim.addBuilding("core", 0, site.cx - 1, site.cz - 1, true);
    run(9 * 60);
    const cores = theirs(COMPUTER).buildings.filter((b) => b.kind === "core").map((b) => sim.centreOf(b));
    const nearStart = (i: number) => cores.some((c) => Math.hypot(c[0] - (STARTS[i]!.cx + 0.5) * 5, c[2] - (STARTS[i]!.cz + 0.5) * 5) < 120);
    // On someone's start (or its natural): never.
    expect(nearStart(0) || nearStart(6)).toBe(false);
    // On a start nobody plays: yes, at least one.
    const free = [1, 2, 3, 4, 5].filter(nearStart);
    expect(free.length).toBeGreaterThan(0);
    // Someone taking up that colour is begun on another start, not beside the computer's turrets.
    const colour = free[0]!;
    const g = sim.serve("r", colour, "tab-of-r")!;
    expect(g.start).not.toBe(colour);
    const theirCore = theirs(colour).buildings.find((b) => b.kind === "core")!;
    for (const c of cores) expect(Math.hypot(sim.centreOf(theirCore)[0] - c[0], sim.centreOf(theirCore)[2] - c[2])).toBeGreaterThan(120);
  }, 120_000);

  it("with every start held, it takes the rich fields in the middle (nobody guards them)", () => {
    const { sim, run, theirs } = setup(0);
    // An army on every other start (nobody serving them: they do nothing), so the only free sites are the middle's.
    sim.fill();
    run(16 * 60);
    const cores = theirs(COMPUTER).buildings.filter((b) => b.kind === "core").map((b) => sim.centreOf(b));
    const rich = cores.filter((c) => Math.hypot(c[0], c[2]) < 200);
    expect(rich.length).toBeGreaterThan(0);
  }, 180_000);

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

  it("attacks only once booming (three guarded bases), with Titans, Tanks or gunships; then a person who does nothing loses their Core", () => {
    const { sim, run, theirs, core, ai } = setup(0);
    let firstWave = Infinity, coresThen = 0, advanced = false;
    run(13 * 60, () => {
      if (firstWave === Infinity && ai.attacking) {
        firstWave = sim.t;
        coresThen = theirs(COMPUTER).buildings.filter((b) => b.kind === "core").length;
        advanced = theirs(COMPUTER).fighters.some((u) => u.kind === "titan" || u.kind === "tank" || u.kind === "gunship");
      }
    });
    expect(firstWave).toBeLessThan(13 * 60);
    expect(coresThen).toBeGreaterThanOrEqual(3);
    expect(advanced).toBe(true);
    expect(core(0)).toBeUndefined();
  }, 180_000);

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
    run(12 * 60, () => void (wentIn ||= ai.attacking && (ai as unknown as { mind: { phase: string } }).mind.phase === "attack"));
    expect(wentIn).toBe(false);
    // (Growing meanwhile: Titans among it.)
    expect(theirs(COMPUTER).fighters.reduce((s, u) => s + UNITS[u.kind].supply, 0)).toBeGreaterThanOrEqual(50);
    expect(theirs(COMPUTER).fighters.some((u) => u.kind === "titan")).toBe(true);
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
