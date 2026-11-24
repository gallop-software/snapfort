import type { RoofShape } from "./environments";

/**
 * The shapes a roof can have. Every one sits on the same square base and is
 * one storey tall at its highest, so roofs attach, stand and fall the same in
 * every world; only the surface between differs. A world picks one by name
 * (Environment.roof). The drawing of each is in render/geometry.ts and must
 * match the heights here.
 */

/** How many straight steps a dome's curve is drawn with, from its base to its top. */
export const DOME_STEPS = 4;
/** The top of a dome is a flat square this wide (as a part of the cell). */
export const DOME_TOP = 0.16;

/**
 * A dome's outline: how far up (0..1 of a storey) its surface is at each
 * step, and how far in from the edge of the cell (0 at the edge, 0.5 at the
 * centre) that ring sits. A quarter circle, ending in the small flat top.
 */
export function domeRings(): { inset: number; height: number }[] {
  const reach = 0.5 - DOME_TOP / 2;
  return Array.from({ length: DOME_STEPS + 1 }, (_, i) => {
    const a = (i / DOME_STEPS) * (Math.PI / 2);
    return { inset: reach * (1 - Math.cos(a)), height: Math.sin(a) };
  });
}

/**
 * How high a roof's surface is at (u, w) in its cell (each 0..1), as a part
 * of a storey: 0 at the edge, 1 at the top.
 */
export function roofHeight(shape: RoofShape, u: number, w: number): number {
  // How far in from the nearest edge: 0 at the edge, 0.5 in the middle.
  const inset = 0.5 - Math.max(Math.abs(u - 0.5), Math.abs(w - 0.5));
  if (shape === "pyramid") return Math.max(0, 2 * inset);
  const rings = domeRings();
  if (inset <= 0) return 0;
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]!, b = rings[i]!;
    if (inset <= b.inset) return a.height + ((b.height - a.height) * (inset - a.inset)) / (b.inset - a.inset);
  }
  return 1;
}
