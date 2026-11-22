import { normalizeSpec, type PieceSpec } from "./pieces";

/**
 * Where pieces really meet. Two pieces hold each other up only when they share
 * a stretch of edge (or one's edge lies flat against a wall): stacked walls,
 * a floor on a wall, a ramp's top edge on the next ramp's bottom edge, a ramp
 * running along a wall. Touching at a single corner point does not count.
 *
 * Ramps join other ramps only when both climb the same way (one continuing
 * the other, or side by side). To turn, a staircase needs a floor: a floor
 * takes ramps from all four sides.
 *
 * Grid units: x and z in cells, y in storeys.
 */

type P = readonly [number, number, number];
interface Seg {
  a: P;
  b: P;
}

const EPS = 1e-6;

/** The edges of a piece's shape. */
export function edgesOf(spec: PieceSpec): Seg[] {
  const s = normalizeSpec(spec);
  const { x, y, z } = s;
  const square = (h: number): Seg[] => [
    { a: [x, h, z], b: [x + 1, h, z] },
    { a: [x + 1, h, z], b: [x + 1, h, z + 1] },
    { a: [x + 1, h, z + 1], b: [x, h, z + 1] },
    { a: [x, h, z + 1], b: [x, h, z] },
  ];
  switch (s.type) {
    case "floor":
    case "trebuchet":
      return square(y);
    case "wall": {
      const [p0, p1]: [P, P] = s.rot === 0 ? [[x, y, z], [x + 1, y, z]] : [[x, y, z], [x, y, z + 1]];
      const up = (p: P): P => [p[0], p[1] + 1, p[2]];
      return [
        { a: p0, b: p1 },
        { a: up(p0), b: up(p1) },
        { a: p0, b: up(p0) },
        { a: p1, b: up(p1) },
      ];
    }
    case "roof": {
      const apex: P = [x + 0.5, y + 1, z + 0.5];
      const base = square(y);
      return [...base, ...base.map((e) => ({ a: e.a, b: apex }))];
    }
    case "ramp": {
      // Corners of the cell's floor, then which side is low and which high.
      const c00: P = [x, y, z], c10: P = [x + 1, y, z], c01: P = [x, y, z + 1], c11: P = [x + 1, y, z + 1];
      const up = (p: P): P => [p[0], p[1] + 1, p[2]];
      // rot 0 climbs toward +z, 1 toward +x, 2 toward -z, 3 toward -x.
      const [lowA, lowB, highA, highB] =
        s.rot === 0 ? [c00, c10, c01, c11] : s.rot === 1 ? [c00, c01, c10, c11] : s.rot === 2 ? [c01, c11, c00, c10] : [c10, c11, c00, c01];
      return [
        { a: lowA, b: lowB },
        { a: up(highA), b: up(highB) },
        { a: lowA, b: up(highA) },
        { a: lowB, b: up(highB) },
      ];
    }
  }
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isZero = (v: P) => Math.abs(v[0]) < EPS && Math.abs(v[1]) < EPS && Math.abs(v[2]) < EPS;

/** True when two edges lie on one line and overlap for more than a point. */
function overlap(s: Seg, t: Seg): boolean {
  const d = sub(s.b, s.a);
  if (!isZero(cross(d, sub(t.b, t.a))) || !isZero(cross(d, sub(t.a, s.a)))) return false;
  const len2 = dot(d, d);
  const u = dot(sub(t.a, s.a), d) / len2;
  const v = dot(sub(t.b, s.a), d) / len2;
  return Math.min(Math.max(u, v), 1) - Math.max(Math.min(u, v), 0) > EPS;
}

/** True when an edge lies flat against a wall (both ends on the wall's face). */
function onWall(wall: PieceSpec, e: Seg): boolean {
  const w = normalizeSpec(wall);
  const inside = (p: P) =>
    w.rot === 0
      ? Math.abs(p[2] - w.z) < EPS && p[0] > w.x - EPS && p[0] < w.x + 1 + EPS && p[1] > w.y - EPS && p[1] < w.y + 1 + EPS
      : Math.abs(p[0] - w.x) < EPS && p[2] > w.z - EPS && p[2] < w.z + 1 + EPS && p[1] > w.y - EPS && p[1] < w.y + 1 + EPS;
  return inside(e.a) && inside(e.b) && !isZero(sub(e.b, e.a));
}

/** Whether two pieces really meet (see the top of this file). */
export function piecesMeet(a: PieceSpec, b: PieceSpec): boolean {
  if (a.type === "ramp" && b.type === "ramp" && normalizeSpec(a).rot !== normalizeSpec(b).rot) return false;
  const ea = edgesOf(a), eb = edgesOf(b);
  for (const s of ea) for (const t of eb) if (overlap(s, t)) return true;
  if (a.type === "wall" && eb.some((e) => onWall(a, e))) return true;
  if (b.type === "wall" && ea.some((e) => onWall(b, e))) return true;
  return false;
}
