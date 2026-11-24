import { describe, expect, it } from "vitest";
import type { Piece } from "../../game/pieces";
import { materialAllowed, materialFor } from "../../game/pieces";
import { hitPoints, maxRange } from "../../game/trebuchet";
import { world as MEADOW } from "./world";

const piece = (type: Piece["type"], material: Piece["material"]): Piece => ({ id: "p", type, x: 0, y: 0, z: 0, rot: 0, material, edit: 0 });

describe("the Meadow", () => {
  it("is the free world at the front door, saved as it always was", () => {
    expect(MEADOW.paid).toBe(false);
    expect(MEADOW.path).toBe("/");
    expect(MEADOW.room).toBe("main");
  });

  it("builds metal on storeys 1 to 10, brick on 1 to 30 and wood anywhere", () => {
    expect(materialAllowed("wall", "metal", 9, MEADOW)).toBe(true);
    expect(materialAllowed("wall", "metal", 10, MEADOW)).toBe(false);
    expect(materialAllowed("floor", "brick", 29, MEADOW)).toBe(true);
    expect(materialAllowed("floor", "brick", 30, MEADOW)).toBe(false);
    expect(materialAllowed("roof", "wood", 80, MEADOW)).toBe(true);
    expect(materialFor("wall", "metal", 10, MEADOW)).toBe("brick");
    expect(materialFor("wall", "metal", 30, MEADOW)).toBe("wood");
  });

  it("breaks wood in two hits, brick in four, metal in six and a trebuchet in one", () => {
    expect(hitPoints(piece("wall", "wood"), MEADOW)).toBe(2);
    expect(hitPoints(piece("wall", "brick"), MEADOW)).toBe(4);
    expect(hitPoints(piece("wall", "metal"), MEADOW)).toBe(6);
    expect(hitPoints(piece("trebuchet", "wood"), MEADOW)).toBe(1);
  });

  it("has trebuchets that reach 300 m from the ground", () => {
    expect(maxRange(piece("trebuchet", "wood"), MEADOW)).toBe(300);
  });
});
