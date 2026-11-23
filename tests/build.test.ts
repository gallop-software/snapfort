import { describe, expect, it } from "vitest";
import { olderBuild } from "../src/net/protocol";

describe("builds", () => {
  it("only a page from an older build is told to restart", () => {
    expect(olderBuild("20261123120000", "20261123130000")).toBe(true);
    expect(olderBuild("20261123130000", "20261123120000")).toBe(false); // a newer page waits for the world to update
    expect(olderBuild("20261123120000", "20261123120000")).toBe(false);
  });

  it("ignores anything that is not a build time", () => {
    expect(olderBuild("dev", "20261123120000")).toBe(false);
    expect(olderBuild("20261123120000", "dev")).toBe(false);
    expect(olderBuild("old", "new")).toBe(false);
  });
});
