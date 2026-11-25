/**
 * Saying why something is out of reach, in words a builder can act on: how
 * far up it is and how far away, and what to do about it. Used by the kits a
 * world has of its own (a rocket, a rail gun), whose parts go on only from
 * close by.
 */

/** A box in metres: [x, y, z] low corner, then high corner. */
type Box = readonly number[];
type Point = readonly [number, number, number];

/** From a point to the nearest of some boxes: metres up to it (negative: it is below), and metres away on the level. */
export function gapTo(boxes: readonly Box[], p: Point): { up: number; flat: number } {
  let best = { up: 0, flat: 0 }, bestDist = Infinity;
  for (const b of boxes) {
    const up = p[1] < b[1]! ? b[1]! - p[1] : p[1] > b[4]! ? b[4]! - p[1] : 0;
    const flat = Math.hypot(Math.max(b[0]! - p[0], 0, p[0] - b[3]!), Math.max(b[2]! - p[2], 0, p[2] - b[5]!));
    const d = Math.hypot(up, flat);
    if (d < bestDist) [best, bestDist] = [{ up, flat }, d];
  }
  return best;
}

/**
 * Why a part is out of reach and what to do: "66 m above you and 9 m away:
 * build up beside it, to within 12 m". `reach` is how near a builder must be.
 */
export function outOfReach(boxes: readonly Box[], p: Point, reach: number): string {
  const { up, flat } = gapTo(boxes, p);
  const high = Math.abs(up) > 3, wide = flat > 3 || !high;
  const where = [high ? `${Math.round(Math.abs(up))} m ${up > 0 ? "above" : "below"} you` : "", wide ? `${Math.round(flat)} m away` : ""].filter(Boolean).join(" and ");
  const what = !high ? "get" : up > 0 ? (wide ? "build up beside it," : "build up to it,") : "get down";
  return `${where}: ${what} to within ${reach} m`;
}
