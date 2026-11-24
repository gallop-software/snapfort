import { describe, expect, it } from "vitest";
import { BuildState } from "../../game/buildState";
import { LEVEL } from "../../game/constants";
import type { Environment } from "../../game/environments";
import { planFall } from "../../game/fall";
import type { Piece } from "../../game/pieces";
import { checkRange, maxRange, planFlight, positionAt, throwVelocity, type Vec } from "../../game/trebuchet";
import { fallPhase, fallPosition } from "../../game/fall";
import { SPACE_BACK, SPACE_OUT, SPACE_RISE, spaceFlight } from "./server";
import { world as MOON } from "./world";

/** The same world under an ordinary pull (the numbers the game was first tuned with), to compare against. */
const EARTHLY: Environment = { ...MOON, gravity: 26, stoneGravity: 9.81, flightTime: 1, range: 1, throwPower: 1, knockdownDrop: 2, rubbleGravity: 9.81 };

const treb: Piece = { id: "t", type: "trebuchet", x: 0, y: 0, z: 0, rot: 0, material: "wood", edit: 0 };

describe("the Moon", () => {
  it("throws stones that still pass exactly through the target, slower, along an arc of the same shape", () => {
    const from: Vec = [0, 7, 0], to: Vec = [40, 0, 90];
    const moon = planFlight(from, to, MOON), earthly = planFlight(from, to, EARTHLY);
    const at = positionAt(moon, moon.time);
    for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(to[i]!, 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
    // Halfway along, both are at the same height: the same arc, flown slower.
    expect(positionAt(moon, moon.time / 2)[1]).toBeCloseTo(positionAt(earthly, earthly.time / 2)[1], 6);
  });

  it("keeps the nearest shots slow lobs too", () => {
    const moon = planFlight([0, 7, 0], [30, 0, 0], MOON), earthly = planFlight([0, 7, 0], [30, 0, 0], EARTHLY);
    expect(earthly.time).toBeCloseTo(Math.max(1.5, Math.sqrt(60 / 9.81)), 6);
    expect(moon.time).toBeCloseTo(earthly.time * Math.sqrt(3), 6);
  });

  it("lets trebuchets reach 1.6 times as far", () => {
    expect(maxRange(treb, MOON)).toBeCloseTo(maxRange(treb, EARTHLY) * 1.6);
    const far: Vec = [2.5 + 400, 0, 2.5];
    expect(checkRange(treb, far, EARTHLY)).toBe("far");
    expect(checkRange(treb, far, MOON)).toBe("ok");
  });

  it("throws builders far and high, but not out of the world", () => {
    const v = throwVelocity([0, 0, 0], [1, 0.9, 0], MOON, 0)!;
    const fall = planFall(new BuildState(), [1, 0.9, 0], v, MOON);
    const earthlyFall = planFall(new BuildState(), [1, 0.9, 0], throwVelocity([0, 0, 0], [1, 0.9, 0], EARTHLY, 0)!, EARTHLY);
    expect(fall.land[0]).toBeGreaterThan(earthlyFall.land[0] * 1.5);
    expect(fall.time).toBeGreaterThan(earthlyFall.time);
    expect(Math.abs(fall.land[0])).toBeLessThan(200);
    expect(fall.land[1]).toBeCloseTo(0.9, 1);
  });

  it("makes falls slower: off a storey takes longer than under an ordinary pull", () => {
    const top: Vec = [2.5, LEVEL * 2 + 0.9, 2.5];
    expect(planFall(new BuildState(), top, [0, 0, 0], MOON).time).toBeCloseTo(planFall(new BuildState(), top, [0, 0, 0], EARTHLY).time * Math.sqrt(3), 1);
  });

  it("is a paid world at /moon, saved as it always was", () => {
    expect(MOON.paid).toBe(true);
    expect(MOON.path).toBe("/moon");
    expect(MOON.room).toBe("moon");
  });
});

describe("thrown into space", () => {
  const from: Vec = [12.5, 0.9, 12.5];
  const v = throwVelocity([10, 0, 12.5], from, MOON, 0)!;
  const thrown = (build: BuildState, at: Vec = from) => spaceFlight({ build, env: MOON, from: at, v, fall: planFall(build, at, v, MOON) });

  it("carries a builder high above the towers, tumbling, then the rockets fly them back down", () => {
    const flight = thrown(new BuildState())!;
    expect(flight.time).toBeCloseTo(SPACE_OUT + SPACE_BACK, 6);
    expect(flight.glideFrom).toBe(SPACE_OUT);
    expect(fallPhase(flight, 1)).toBe("tumble");
    expect(fallPhase(flight, SPACE_OUT + 1)).toBe("glide");
    // No lying on the ground afterwards: on their feet the moment they land.
    expect(fallPhase(flight, flight.time + 0.01)).toBe("done");
    expect(fallPosition(flight, SPACE_OUT)[1]).toBeCloseTo(from[1] + SPACE_RISE, 1);
    // Up all the way out, down all the way back.
    for (let t = 0.1; t < flight.time; t += 0.1) {
      const dy = fallPosition(flight, t)[1] - fallPosition(flight, t - 0.1)[1];
      if (t <= SPACE_OUT) expect(dy).toBeGreaterThanOrEqual(-1e-9);
      else expect(dy).toBeLessThanOrEqual(1e-9);
    }
  });

  it("sets them down on the ground near where they were hit, the way they were thrown", () => {
    const flight = thrown(new BuildState())!;
    expect(flight.land[1]).toBeCloseTo(0.9, 6);
    expect(flight.land[0]).toBeGreaterThan(from[0] + 5);
    expect(Math.hypot(flight.land[0] - from[0], flight.land[2] - from[2])).toBeLessThan(15);
    // The last stretch is straight down onto the spot, slowly.
    const late = fallPosition(flight, flight.time - 0.5);
    expect(Math.hypot(late[0] - flight.land[0], late[2] - flight.land[2])).toBeLessThan(0.01);
    expect(late[1] - flight.land[1]).toBeLessThan(3);
  });

  it("lands on whatever is built under the spot, not inside it", () => {
    const build = new BuildState();
    for (let x = 3; x <= 5; x++) for (let z = 1; z <= 3; z++) build.apply({ kind: "place", piece: { id: `f${x}${z}`, type: "floor", x, y: 0, z, rot: 0, material: "wood", edit: 0 } });
    build.apply({ kind: "place", piece: { id: "w", type: "wall", x: 4, y: 0, z: 2, rot: 0, material: "wood", edit: 0 } });
    build.apply({ kind: "place", piece: { id: "top", type: "floor", x: 4, y: 1, z: 2, rot: 0, material: "wood", edit: 0 } });
    const flight = thrown(build)!;
    expect(flight.land[1]).toBeCloseTo(LEVEL + 0.15 + 0.9, 1);
  });

  it("stays inside the building area however near the edge", () => {
    const edge: Vec = [238, 0.9, 12.5];
    const flight = thrown(new BuildState(), edge)!;
    for (const p of flight.path) expect(Math.abs(p[0])).toBeLessThanOrEqual(240);
  });

  it("leaves a builder under a roof to an ordinary fall", () => {
    const build = new BuildState();
    for (let y = 0; y < 2; y++) build.apply({ kind: "place", piece: { id: `w${y}`, type: "wall", x: 2, y, z: 2, rot: 0, material: "wood", edit: 0 } });
    // A wide ceiling two storeys up (laid outward from the wall, so every slab has a neighbour), so there is no getting out from under it.
    let slabs = 0;
    for (let ring = 0; ring <= 5; ring++) {
      for (let x = 2 - ring; x <= 2 + ring; x++) {
        for (let z = 2 - ring; z <= 2 + ring; z++) {
          if (Math.max(Math.abs(x - 2), Math.abs(z - 2)) !== ring) continue;
          if (build.apply({ kind: "place", piece: { id: `lid${x},${z}`, type: "floor", x, y: 2, z, rot: 0, material: "wood", edit: 0 } })) slabs++;
        }
      }
    }
    expect(slabs).toBe(121);
    expect(thrown(build)).toBeNull();
  });
});
