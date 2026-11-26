import type { BuildState } from "./buildState";
import { CELL, LEVEL, THICK } from "./constants";
import type { Environment, RoofShape } from "./environments";
import { editGrid, normalizeSpec, type Piece } from "./pieces";
import { roofHeight } from "./roofs";

/**
 * What is solid, and every question about it, in one place: so a thrown
 * builder, a stone, a soldier, a vehicle and the drawing of each all agree
 * with the shapes the game draws and the builder walks on. A wall with a door
 * cut in it has a door; a ramp is a slope, not a box; a roof is its own
 * shape.
 *
 * Everything solid is described as columns: a rectangle on the ground (in
 * metres), and between a bottom and a top surface over it (a top that may
 * slope). A wall is a column per tile left standing, a floor a column per
 * tile, a ramp one sloping slab, a roof one column under its surface. A
 * world's own things (a launcher, a parked rover, a building) are boxes,
 * handed in as `extra`.
 *
 * Bodies are spheres (`half` 0) or upright capsules: a centre, a radius, and
 * `half`, how far the straight middle reaches up and down from the centre
 * (a builder: 0.5, with a radius of 0.4, is 1.8 m tall).
 *
 * Plain logic, no drawing: the server and every page ask the same questions
 * of the same build and get the same answers.
 */

export type Vec = [number, number, number];
/** A box in metres: [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Box = readonly [number, number, number, number, number, number];

export interface Column {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** A flat bottom and top. */
  y0: number;
  y1: number;
  /** A slab that slopes (a ramp): its top is `slope.at + slope.gx * x + slope.gz * z`, and it is `y1 - y0` thick under that. */
  slope?: { at: number; gx: number; gz: number };
  /** A roof: its top is `y0 + LEVEL * roofHeight(shape, u, w)` over its cell. */
  roof?: { shape: RoofShape; cx: number; cz: number };
  /** The piece it is part of (none: a world's own thing). */
  piece?: string;
  /** Something a stone hits but a body passes through (a siege engine's frame, which is mostly open). */
  open?: boolean;
}

/** The top of a column at a point on (or nearest to) its rectangle. */
export function topAt(c: Column, x: number, z: number): number {
  if (c.slope) return c.slope.at + c.slope.gx * x + c.slope.gz * z;
  if (c.roof) return c.y0 + LEVEL * roofHeight(c.roof.shape, x / CELL - c.roof.cx, z / CELL - c.roof.cz);
  return c.y1;
}

/** The bottom of a column at a point on (or nearest to) its rectangle. */
export function bottomAt(c: Column, x: number, z: number): number {
  return c.slope ? topAt(c, x, z) - (c.y1 - c.y0) : c.y0;
}

const boxColumn = (b: Box, piece?: string, open?: boolean): Column => ({ x0: b[0], y0: b[1], z0: b[2], x1: b[3], y1: b[4], z1: b[5], ...(piece ? { piece } : {}), ...(open ? { open } : {}) });

/** How high a siege engine's base is: the slab it turns on. */
const ENGINE_BASE = 0.35;

const cache = new WeakMap<Piece, { roof: RoofShape; launch: number; columns: Column[] }>();

/** The solid columns of a piece, as it is drawn: tiles cut out of it are not there. */
export function columnsOf(p: Piece, env: Environment): Column[] {
  const hit = cache.get(p);
  if (hit && hit.roof === env.roof && hit.launch === env.siege.launchHeight) return hit.columns;
  const columns = makeColumns(p, env);
  cache.set(p, { roof: env.roof, launch: env.siege.launchHeight, columns });
  return columns;
}

function makeColumns(p: Piece, env: Environment): Column[] {
  const s = normalizeSpec(p);
  const base = s.y * LEVEL, t = THICK / 2;
  const x0 = s.x * CELL, z0 = s.z * CELL;
  const grid = editGrid(s.type);
  const cut = (i: number) => grid !== null && (p.edit & (1 << i)) !== 0;
  switch (s.type) {
    case "wall": {
      // Three by three tiles: column i % 3 along the wall from its low end, row i / 3 up from the bottom.
      const out: Column[] = [];
      const w = CELL / 3, h = LEVEL / 3;
      for (let i = 0; i < 9; i++) {
        if (cut(i)) continue;
        const along = (i % 3) * w, up = base + Math.floor(i / 3) * h;
        out.push(
          s.rot === 0
            ? { x0: x0 + along, x1: x0 + along + w, z0: z0 - t, z1: z0 + t, y0: up, y1: up + h, piece: p.id }
            : { x0: x0 - t, x1: x0 + t, z0: z0 + along, z1: z0 + along + w, y0: up, y1: up + h, piece: p.id },
        );
      }
      return out;
    }
    case "floor": {
      const out: Column[] = [];
      const w = CELL / 2;
      for (let i = 0; i < 4; i++) {
        if (cut(i)) continue;
        const ax = x0 + (i % 2) * w, az = z0 + Math.floor(i / 2) * w;
        out.push({ x0: ax, x1: ax + w, z0: az, z1: az + w, y0: base - t, y1: base + t, piece: p.id });
      }
      return out;
    }
    case "ramp": {
      // Climbs one storey across its cell: rot 0 toward +z, 1 toward +x, 2 toward -z, 3 toward -x. Its top is THICK / 2 over the line it climbs along.
      const k = LEVEL / CELL;
      const g = s.rot === 0 ? { gx: 0, gz: k, at: base + t - k * z0 } : s.rot === 1 ? { gx: k, gz: 0, at: base + t - k * x0 } : s.rot === 2 ? { gx: 0, gz: -k, at: base + t + k * (z0 + CELL) } : { gx: -k, gz: 0, at: base + t + k * (x0 + CELL) };
      return [{ x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: 0, y1: THICK, slope: g, piece: p.id }];
    }
    case "roof":
      return [{ x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: base, y1: base + LEVEL, roof: { shape: env.roof, cx: s.x, cz: s.z }, piece: p.id }];
    case "trebuchet":
      // The base it turns on, which is stood on; and its frame, which stones hit and bodies pass through.
      return [
        { x0, x1: x0 + CELL, z0, z1: z0 + CELL, y0: base, y1: base + ENGINE_BASE, piece: p.id },
        boxColumn([x0 + 1.2, base + ENGINE_BASE, z0 + 1.2, x0 + CELL - 1.2, base + env.siege.launchHeight, z0 + CELL - 1.2], p.id, true),
      ];
  }
}

/** How far a body (centre `c`, radius `r`, straight middle `half` up and down) is from a column: below 0 when it cuts in. */
export function gap(col: Column, c: Vec, r: number, half = 0): number {
  const qx = Math.max(col.x0, Math.min(col.x1, c[0])), qz = Math.max(col.z0, Math.min(col.z1, c[2]));
  const top = topAt(col, qx, qz), bottom = bottomAt(col, qx, qz);
  const dh = Math.hypot(c[0] - qx, c[2] - qz);
  const dv = Math.max(bottom - (c[1] + half), 0, c[1] - half - top);
  // Inside the rectangle and between the surfaces: how deep (negative).
  if (dh === 0 && dv === 0) {
    const inX = Math.min(c[0] - col.x0, col.x1 - c[0]), inZ = Math.min(c[2] - col.z0, col.z1 - c[2]);
    const inY = Math.min(c[1] + half - bottom, top - (c[1] - half));
    return -Math.min(inX, inZ, inY) - r;
  }
  return Math.hypot(dh, dv) - r;
}

export interface Touch {
  column: Column;
  /** How deep the body cuts in (positive), m. */
  depth: number;
}

export class Solids {
  /**
   * @param extra each world's own solid things just now (boxes), asked for as
   *   they are needed: the server's or the page's own list.
   */
  constructor(
    readonly state: BuildState,
    readonly env: Environment,
    readonly extra: () => readonly Box[] = () => [],
  ) {}

  /**
   * The columns near a point: of the pieces within a cell of it (and of the
   * storeys from `y0` to `y1`, when given: a whole stretch up or down), and the
   * world's own things within `reach` m across (and anywhere in that stretch).
   */
  near(x: number, y: number, z: number, reach = CELL, y0 = y, y1 = y): Column[] {
    const out: Column[] = [];
    const seen = new Set<Piece>();
    const add = (px: number, py: number, pz: number) => {
      for (const p of this.state.near(px, py, pz)) {
        if (seen.has(p)) continue;
        seen.add(p);
        for (const c of columnsOf(p, this.env)) out.push(c);
      }
    };
    // (The build's lookup covers the cell round the point and the cells either side, a storey up and down.)
    for (let h = Math.min(y0, y); h <= Math.max(y1, y) + 1e-6; h += 2 * LEVEL) {
      add(x, h, z);
      if (reach > CELL) {
        for (const dx of [-reach, reach]) add(x + dx, h, z);
        for (const dz of [-reach, reach]) add(x, h, z + dz);
      }
    }
    const lo = Math.min(y0, y) - reach, hi = Math.max(y1, y) + reach;
    for (const b of this.extra()) {
      if (b[0] - reach > x || b[3] + reach < x || b[2] - reach > z || b[5] + reach < z || b[1] > hi || b[4] < lo) continue;
      out.push(boxColumn(b));
    }
    return out;
  }

  /**
   * The deepest thing a body cuts into, or null when it is clear. `stepUp`:
   * something whose top is no more than this above the body's feet is stood
   * on, not run into (stairs, a floor's edge, the foot of a ramp). `stones`:
   * a siege engine's open frame counts too.
   */
  touch(c: Vec, r: number, half = 0, opts: { stepUp?: number; stones?: boolean; ignore?: string } = {}): Touch | null {
    let best: Touch | null = null;
    const feet = c[1] - half - r;
    for (const col of this.near(c[0], c[1], c[2], r + half + 1)) {
      if ((col.open && !opts.stones) || (opts.ignore && col.piece === opts.ignore)) continue;
      const g = gap(col, c, r, half);
      if (g >= 0) continue;
      if (opts.stepUp !== undefined) {
        const qx = Math.max(col.x0, Math.min(col.x1, c[0])), qz = Math.max(col.z0, Math.min(col.z1, c[2]));
        if (topAt(col, qx, qz) <= feet + opts.stepUp) continue;
      }
      if (!best || -g > best.depth) best = { column: col, depth: -g };
    }
    return best;
  }

  /**
   * The highest surface a body standing at (x, z) with its feet at or above
   * `feet` would rest on: within `r` of the spot (a body is as wide as it is),
   * no higher than `feet` (plus a little). The ground is 0. `below`: how far
   * down to look (a body falling a step at a time need only look near its feet).
   */
  surfaceUnder(x: number, z: number, feet: number, r = 0, below = Infinity): number {
    let best = 0;
    for (const col of this.near(x, feet, z, r + 1, Math.max(0, feet - below), feet)) {
      if (col.open) continue;
      const qx = Math.max(col.x0, Math.min(col.x1, x)), qz = Math.max(col.z0, Math.min(col.z1, z));
      if (Math.hypot(x - qx, z - qz) > r) continue;
      // (On a slope, its height under the body's middle: where the feet are drawn.)
      const top = topAt(col, qx, qz);
      if (top <= feet + 0.05 && top > best) best = top;
    }
    return best;
  }

  /** The lowest underside over a body's head at (x, z), at or above `head`, within `r` of the spot; Infinity when open sky. */
  ceilingOver(x: number, z: number, head: number, r = 0, above = 2 * LEVEL): number {
    let best = Infinity;
    for (const col of this.near(x, head, z, r + 1, head, head + above)) {
      if (col.open) continue;
      const qx = Math.max(col.x0, Math.min(col.x1, x)), qz = Math.max(col.z0, Math.min(col.z1, z));
      if (Math.hypot(x - qx, z - qz) > r) continue;
      const bottom = bottomAt(col, qx, qz);
      if (bottom >= head - 0.05 && bottom < best) best = bottom;
    }
    return best;
  }

  /**
   * A body moving in a straight line from `a` to `b`: the first point at which
   * it would cut into something (and what), or null when the way is clear.
   * Stepped so it never jumps through anything thinner than its own radius.
   */
  sweep(a: Vec, b: Vec, r: number, half = 0, opts: { stepUp?: number; stones?: boolean; ignore?: string } = {}): { at: Vec; k: number; column: Column } | null {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.05, Math.min(r, 0.25) * 0.8)));
    let last: Vec = a;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const p: Vec = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      const t = this.touch(p, r, half, opts);
      if (t) return { at: last, k: (i - 1) / steps, column: t.column };
      last = p;
    }
    return null;
  }

  /**
   * The nearest spot to (x, z) where a body can stand clear of everything, on
   * whatever is under it there: tried in rings out to `far` metres. Its centre
   * is returned, `half + r` over the surface. Null when there is none.
   */
  nearestClear(x: number, z: number, feet: number, r: number, half: number, far = 12): Vec | null {
    const lift = half + r;
    const at = (px: number, pz: number): Vec | null => {
      const ground = this.surfaceUnder(px, pz, feet + 0.6, r);
      const c: Vec = [px, ground + lift + 0.02, pz];
      return this.touch(c, r, half) ? null : c;
    };
    const here = at(x, z);
    if (here) return here;
    for (let ring = 0.75; ring <= far; ring += 0.75) {
      const n = Math.max(8, Math.round((ring * Math.PI * 2) / 0.75));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const c = at(x + Math.sin(a) * ring, z + Math.cos(a) * ring);
        if (c) return c;
      }
    }
    return null;
  }
}
