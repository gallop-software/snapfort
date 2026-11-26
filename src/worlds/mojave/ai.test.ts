import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { Bots } from "./ai";
import { NEWCOMER_PEACE, ROUTED_WAIT, UNITS } from "./kit";
import { DT, emptyHappened, Sim, type Host } from "./sim";
import { HALF_CELLS, world } from "./world";

const host: Host = { positionOf: () => null, isDown: () => false, throwBuilder: () => {}, wear: () => {}, removePieces: () => {} };

/** A war with computers on the first `count` places (eight: every place, as a war always has). */
function setup(count: number) {
  const build = new BuildState();
  build.halfCells = HALF_CELLS;
  const sim = new Sim(build, world, host);
  sim.postSentries(true);
  const bots = new Bots(sim);
  for (let slot = 0; slot < count; slot++) sim.seat(slot);
  let shots = 0, lost = 0, razed = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      sim.tick();
      if (sim.step % 20 === 5) bots.think();
      if (sim.step % 2 === 0) {
        shots += sim.happened.shots.length;
        lost += sim.happened.gone.filter((g) => g.unit && g.owner < 8).length;
        razed += sim.happened.gone.filter((g) => !g.unit).length;
        sim.happened = emptyHappened();
      }
    }
  };
  return { sim, bots, run, tally: () => ({ shots, lost, razed }) };
}

describe("a computer general", () => {
  it("mines, builds up in order, and raises an army", () => {
    const { sim, run } = setup(1);
    const g = sim.generals.find((x) => x?.ai)!;
    run(240);
    const mine = [...sim.buildings.values()].filter((b) => b.owner === g.slot);
    const kinds = new Set(mine.map((b) => b.kind));
    expect(kinds.has("foundry")).toBe(true);
    expect(kinds.has("tap")).toBe(true);
    expect(sim.units.filter((u) => u.owner === g.slot && u.kind === "hauler").length).toBeGreaterThanOrEqual(10);
    expect(sim.units.filter((u) => u.owner === g.slot && UNITS[u.kind].weapon).length).toBeGreaterThan(4);
    expect(sim.supplyMax(g.slot)).toBeGreaterThan(12);
    run(360);
    const later = new Set([...sim.buildings.values()].filter((b) => b.owner === g.slot).map((b) => b.kind));
    expect(later.has("armory")).toBe(true);
    expect(g.plasma + g.lithium).toBeGreaterThan(0);
    // Nothing of theirs is built on top of anything else.
    const cells = new Set<string>();
    for (const b of sim.buildings.values()) {
      const size = b.kind === "core" || b.kind === "titanbay" ? 3 : b.kind === "foundry" || b.kind === "armory" || b.kind === "skyport" ? 2 : 1;
      for (let x = b.cx; x < b.cx + size; x++) for (let z = b.cz; z < b.cz + size; z++) {
        expect(cells.has(`${x},${z}`)).toBe(false);
        cells.add(`${x},${z}`);
      }
    }
  }, 60_000);

  it("goes to war with the others: armies meet, units are lost, and nobody is ever stuck for good", () => {
    const { sim, run, tally } = setup(4);
    run(900);
    const t = tally();
    expect(t.shots).toBeGreaterThan(200);
    expect(t.lost).toBeGreaterThan(10);
    // Every general is still playing: with a Core, or routed and about to have one.
    for (const g of sim.generals) {
      if (!g) continue;
      const cores = [...sim.buildings.values()].filter((b) => b.owner === g.slot && b.kind === "core").length;
      expect(cores > 0 || g.routedAt > 0).toBe(true);
    }
    expect(sim.units.length).toBeLessThanOrEqual(1700);
  }, 240_000);

  it("plays a place a person has left from where it stands, and leaves alone one a person has taken", () => {
    const { sim, run } = setup(2);
    const g = sim.take(0, "p1", "Ann", "tab-of-ann")!;
    run(150);
    // The person did nothing: the computer did not play for them.
    expect([...sim.buildings.values()].filter((b) => b.owner === 0)).toHaveLength(1);
    expect([...sim.buildings.values()].filter((b) => b.owner === 1).length).toBeGreaterThan(1);
    g.lithium = 2000;
    sim.leave("p1");
    run(120);
    // Now it plays on, with what they left.
    expect([...sim.buildings.values()].filter((b) => b.owner === 0).length).toBeGreaterThan(2);
  }, 60_000);

  it("wiped out, it begins again with a new Core where it started", () => {
    const { sim, run } = setup(1);
    const g = sim.generals[0]!;
    run(20);
    for (const u of [...sim.units]) if (u.owner === 0) sim.kill(u, false);
    for (const b of [...sim.buildings.values()]) if (b.owner === 0) sim.scrap(0, b.id);
    g.lithium = 0;
    expect([...sim.buildings.values()].filter((b) => b.owner === 0)).toHaveLength(0);
    expect(g.routedAt).toBeGreaterThan(0);
    run(ROUTED_WAIT + 8);
    const cores = [...sim.buildings.values()].filter((b) => b.owner === 0 && b.kind === "core");
    expect(cores).toHaveLength(1);
    // Printed, and Haulers at work again.
    run(120);
    expect(cores[0]!.doneAt).toBe(0);
    expect(sim.units.filter((u) => u.owner === 0 && u.kind === "hauler").length).toBeGreaterThan(1);
  }, 60_000);

  it("leaves a person who has only just taken a place alone for a while", () => {
    const { sim, bots } = setup(2);
    const person = sim.take(1, "p1", "Ann", "tab-of-ann")!;
    person.joinedAt = sim.t;
    const target = (bots as unknown as { nearestEnemy(g: unknown, x: number, z: number): { owner: number } | null }).nearestEnemy.bind(bots);
    expect(target(sim.generals[0]!, 0, 0)).toBeNull();
    sim.t += NEWCOMER_PEACE + 1;
    expect(target(sim.generals[0]!, 0, 0)?.owner).toBe(1);
  });
});
