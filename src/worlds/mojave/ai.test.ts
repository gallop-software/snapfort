import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { Bots } from "./ai";
import { UNITS } from "./kit";
import { DT, emptyHappened, Sim, type Host } from "./sim";
import { HALF_CELLS, world } from "./world";

const host: Host = { positionOf: () => null, isDown: () => false, throwBuilder: () => {}, wear: () => {}, removePieces: () => {} };

function setup(count: number) {
  const build = new BuildState();
  build.halfCells = HALF_CELLS;
  const sim = new Sim(build, world, host);
  sim.postSentries(true);
  const bots = new Bots(sim);
  bots.setCount(count);
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
    const { sim, bots, run } = setup(1);
    expect(bots.count).toBe(1);
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
    const { sim, run, tally } = setup(3);
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
  }, 120_000);

  it("makes way: the count can be set down to none", () => {
    const { sim, bots, run } = setup(3);
    run(30);
    bots.setCount(1);
    expect(bots.count).toBe(1);
    bots.setCount(0);
    expect(sim.generals.every((g) => g === null)).toBe(true);
    expect(sim.units.every((u) => u.owner === 8)).toBe(true);
    expect(sim.buildings.size).toBe(0);
  });
});
