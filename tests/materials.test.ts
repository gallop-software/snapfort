import { describe, expect, it } from "vitest";
import { BuildState } from "../src/game/buildState";
import { materialAllowed, materialFor } from "../src/game/pieces";
import { applyAction } from "../src/net/authority";

describe("materials by height", () => {
  it("allows metal on storeys 1–10, brick on 1–30 and wood anywhere", () => {
    expect(materialAllowed("wall", "metal", 9)).toBe(true);
    expect(materialAllowed("wall", "metal", 10)).toBe(false);
    expect(materialAllowed("floor", "brick", 29)).toBe(true);
    expect(materialAllowed("floor", "brick", 30)).toBe(false);
    expect(materialAllowed("roof", "wood", 80)).toBe(true);
    // Trebuchets are not limited.
    expect(materialAllowed("trebuchet", "metal", 50)).toBe(true);
  });

  it("uses the strongest material allowed, never stronger than chosen", () => {
    expect(materialFor("wall", "metal", 5)).toBe("metal");
    expect(materialFor("wall", "metal", 10)).toBe("brick");
    expect(materialFor("wall", "metal", 30)).toBe("wood");
    expect(materialFor("wall", "brick", 5)).toBe("brick");
    expect(materialFor("wall", "brick", 40)).toBe("wood");
    expect(materialFor("wall", "wood", 0)).toBe("wood");
  });

  it("is enforced by the world's rules for an action, as the server applies them", () => {
    const state = new BuildState();
    const ops = [];
    for (let y = 0; y <= 10; y++) ops.push({ kind: "place" as const, piece: { type: "wall" as const, x: 0, y, z: 0, rot: 0 as const, id: `m${y}`, material: "metal" as const, edit: 0 } });
    const result = applyAction(state, ops, (p) => materialAllowed(p.type, p.material, p.y));
    expect(result.rejected).toEqual([10]);
    expect(state.size).toBe(10);
  });
});
