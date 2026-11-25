import type { BuildState } from "../../game/buildState";
import { CELL, LEVEL, THICK } from "../../game/constants";
import type { Piece } from "../../game/pieces";
import { HALF_CELLS } from "./world";

/**
 * Where Mojave's ground units can go. The map is the building grid itself: a
 * unit stands in a cell on a storey (the ground, a floor, or a ramp), and
 * moves to the next cell when nothing is in the way. Walls stand on the edges
 * between cells, so a wall blocks the crossing of its edge and nothing else.
 *
 * - The ground is everywhere, but for buildings, fields, roofs and siege engines.
 * - A floor on storey n is somewhere to stand on storey n.
 * - A ramp is entered from its low side and left from its high side one
 *   storey up (or the other way); its other two sides are closed.
 * - A wall with a door cut in it (a column whose bottom two tiles are cut) lets
 *   infantry through, not vehicles.
 * - Nobody jumps or drops: a storey is reached by a ramp or not at all.
 *
 * Kept up to date from the build as pieces come and go. Paths are flow
 * fields: the distance from every cell to a goal, shared by every unit ordered
 * there together, so two hundred units cost one search.
 */

export const G = HALF_CELLS * 2;
const H = HALF_CELLS;
const FLOOR = 1, BUILDING = 2, RAMP = 4, SOLID = 32;
const SHUT = BUILDING | SOLID;
/** A wall on an edge: present, with a door, and whose it is (a general's slot + 1, shifted). */
const WALL = 1, DOOR = 2;
export const NO_OWNER = 15;

/** Steps to the next cell: 0 toward +z, 1 toward +x, 2 toward -z, 3 toward -x (the way a ramp of that rotation climbs). */
export const DX = [0, 1, 0, -1] as const;
export const DZ = [1, 0, -1, 0] as const;

export const INFANTRY = 0, VEHICLE = 1;
export type MoveClass = typeof INFANTRY | typeof VEHICLE;

const INF = 0x3fffffff;
/** A step costs this; breaking through someone's wall, this much more (so a short way round is taken instead). */
const STEP = 10, BREACH = 450;

class Storey {
  readonly flags = new Uint8Array(G * G);
  /** Walls on each cell's low-z edge (they run along x), and on its low-x edge. */
  readonly wx = new Uint8Array(G * G);
  readonly wz = new Uint8Array(G * G);
}

/** Distances to a goal from everywhere that can reach it. */
export interface Flow {
  /** The distance of each cell on the ground (INF: cannot get there). */
  ground: Int32Array;
  /**
   * And of each cell above it that can be stood on, by storey and place (few
   * of them: kept one by one, so a tall tower does not cost a whole grid for
   * every storey of every path).
   */
  upper: Map<number, number>;
  cls: MoveClass;
  /** Whose walls may be broken through on the way (null: nobody's). */
  breach: ((owner: number) => boolean) | null;
  version: number;
  /** When it was worked out (the caller's clock), so a stale one is not redone too often. */
  at: number;
  /** The goal: the cells it was grown from. */
  seeds: readonly Node[];
}

export interface Node {
  x: number;
  z: number;
  l: number;
}

/** What a crossing came to. */
export const SHUT_WAY = 0, OPEN_WAY = 1, WALL_WAY = 2;

const idx = (x: number, z: number) => (x + H) * G + (z + H);
const inside = (x: number, z: number) => x >= -H && x < H && z >= -H && z < H;

export class Nav {
  /** Goes up whenever anything changes where units can go. */
  version = 1;
  private readonly storeys = new Map<number, Storey>([[0, new Storey()]]);
  private readonly ground: Storey;

  /** After `cross` or `next`: the storey arrived on. */
  toL = 0;
  /** After a WALL_WAY: the wall in the way, as the build knows it (cell, storey, rotation), and whose it is. */
  wallX = 0;
  wallZ = 0;
  wallL = 0;
  wallRot: 0 | 1 = 0;
  wallOwner = NO_OWNER;
  /** After `next`: the cell to go to. */
  nextX = 0;
  nextZ = 0;

  /**
   * `ownerOf`: whose a piece is (a general's slot), or NO_OWNER. Reads the
   * build as it stands and follows every change to it.
   */
  constructor(build: BuildState, private readonly ownerOf: (piece: Piece) => number) {
    this.ground = this.storeys.get(0)!;
    for (const piece of build.all()) this.put(piece, true);
    build.subscribe((op, piece) => {
      if (op.kind === "place") this.put(piece, true);
      else if (op.kind === "remove") this.put(piece, false);
      else this.put(piece, true);
      this.version++;
    });
  }

  private storey(l: number, make: boolean): Storey | undefined {
    let s = this.storeys.get(l);
    if (!s && make) this.storeys.set(l, (s = new Storey()));
    return s;
  }

  private put(p: Piece, on: boolean): void {
    if (!inside(p.x, p.z) && !(p.type === "wall" && inside(p.x - (p.rot === 1 ? 1 : 0), p.z - (p.rot === 0 ? 1 : 0)))) return;
    const s = this.storey(p.y, on);
    if (!s) return;
    if (p.type === "wall") {
      // A wall on the far edge of the last cell is the low edge of a cell outside: nothing crosses it.
      if (!inside(p.x, p.z)) return;
      const walls = p.rot % 2 === 0 ? s.wx : s.wz;
      walls[idx(p.x, p.z)] = on ? WALL | (hasDoor(p.edit) ? DOOR : 0) | (Math.min(NO_OWNER, this.ownerOf(p)) << 2) : 0;
      return;
    }
    const i = idx(p.x, p.z);
    if (p.type === "floor") s.flags[i] = on ? s.flags[i]! | FLOOR : s.flags[i]! & ~FLOOR;
    else if (p.type === "ramp") s.flags[i] = on ? (s.flags[i]! & ~24) | RAMP | (p.rot << 3) : s.flags[i]! & ~(RAMP | 24);
    else s.flags[i] = on ? s.flags[i]! | SOLID : s.flags[i]! & ~SOLID;
  }

  /** A building or a field fills these ground cells (or no longer does). */
  fill(cx: number, cz: number, size: number, on: boolean): void {
    for (let x = cx; x < cx + size; x++) {
      for (let z = cz; z < cz + size; z++) {
        if (!inside(x, z)) continue;
        const i = idx(x, z);
        this.ground.flags[i] = on ? this.ground.flags[i]! | BUILDING : this.ground.flags[i]! & ~BUILDING;
      }
    }
    this.version++;
  }

  private flag(l: number, x: number, z: number): number {
    if (!inside(x, z)) return SHUT;
    const s = l === 0 ? this.ground : this.storeys.get(l);
    return s ? s.flags[idx(x, z)]! : 0;
  }

  /** Whether a unit can be in this cell on this storey. */
  standable(l: number, x: number, z: number): boolean {
    if (l < 0 || !inside(x, z)) return false;
    const f = this.flag(l, x, z);
    if (f & SHUT) return false;
    return l === 0 || (f & (FLOOR | RAMP)) !== 0;
  }

  /** True when this ground cell is free of buildings, fields, ramps, roofs and engines (for putting a building down). */
  clearGround(x: number, z: number): boolean {
    return inside(x, z) && (this.ground.flags[idx(x, z)]! & (SHUT | RAMP)) === 0;
  }

  /** The ramp a unit in this cell on this storey is on: its rotation, or -1. */
  rampAt(l: number, x: number, z: number): number {
    const f = this.flag(l, x, z);
    return f & RAMP ? (f >> 3) & 3 : -1;
  }

  /** The highest storey at or below `l` that can be stood on in this cell (0: the ground), or -1 when the cell is shut. */
  dropTo(l: number, x: number, z: number): number {
    for (let y = l; y >= 0; y--) if (this.standable(y, x, z)) return y;
    return -1;
  }

  /** The wall on the edge crossed leaving cell (x, z) in direction d on storey l: its value, or 0. Notes which wall it was. */
  private wall(l: number, x: number, z: number, d: number): number {
    const s = l === 0 ? this.ground : this.storeys.get(l);
    if (!s) return 0;
    // Toward +z: the low-z edge of the next cell. Toward -z: this cell's own. Likewise for x.
    const wx = d === 0 ? x : d === 2 ? x : d === 1 ? x + 1 : x;
    const wz = d === 0 ? z + 1 : d === 2 ? z : z;
    if (!inside(wx, wz)) return 0;
    const v = (d % 2 === 0 ? s.wx : s.wz)[idx(wx, wz)]!;
    if (v) {
      this.wallX = wx;
      this.wallZ = wz;
      this.wallL = l;
      this.wallRot = d % 2 === 0 ? 0 : 1;
      this.wallOwner = v >> 2;
    }
    return v;
  }

  /** Arriving at storey-l height in cell (x, z) going in direction d: the storey stood on there, or -1. */
  private enter(l: number, x: number, z: number, d: number): number {
    if (!inside(x, z)) return -1;
    const f = this.flag(l, x, z);
    if (f & SHUT) return -1;
    // A ramp there is entered from its low side only, going the way it climbs.
    if (f & RAMP) return ((f >> 3) & 3) === d ? l : -1;
    if (l === 0 || f & FLOOR) return l;
    // The top of a ramp one storey down, walked onto from above.
    const g = this.flag(l - 1, x, z);
    if (g & RAMP && !(g & SHUT) && (((g >> 3) & 3) + 2) % 4 === d) return l - 1;
    return -1;
  }

  /**
   * A unit in cell (x, z) on storey l goes one cell in direction d: SHUT_WAY,
   * OPEN_WAY (`toL` is the storey it arrives on) or WALL_WAY (a wall stands on
   * the edge; `toL` is where it would arrive were it not there, and the wall
   * is noted).
   */
  cross(l: number, x: number, z: number, d: number, cls: MoveClass): number {
    const f = this.flag(l, x, z);
    let height = l;
    if (f & RAMP) {
      const r = (f >> 3) & 3;
      if (d === r) height = l + 1;
      else if (d !== (r + 2) % 4) return SHUT_WAY;
    }
    const to = this.enter(height, x + DX[d]!, z + DZ[d]!, d);
    if (to < 0) return SHUT_WAY;
    this.toL = to;
    const w = this.wall(height, x, z, d);
    if (w && !(w & DOOR && cls === INFANTRY)) return WALL_WAY;
    return OPEN_WAY;
  }

  /** True when nothing stands on any edge a straight line from one spot to another crosses, on that storey (a line of fire). */
  clearLine(x0: number, z0: number, x1: number, z1: number, l: number): boolean {
    const s = l === 0 ? this.ground : this.storeys.get(l);
    if (!s) return true;
    let cx = Math.floor(x0 / CELL), cz = Math.floor(z0 / CELL);
    const ex = Math.floor(x1 / CELL), ez = Math.floor(z1 / CELL);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    // How far along the line (0..1) the next x and z grid lines are, and between lines.
    const tdx = dx === 0 ? Infinity : Math.abs(CELL / dx), tdz = dz === 0 ? Infinity : Math.abs(CELL / dz);
    let tx = dx === 0 ? Infinity : ((dx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx));
    let tz = dz === 0 ? Infinity : ((dz > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / Math.abs(dz));
    for (let n = 0; n < 4 * G && (cx !== ex || cz !== ez); n++) {
      if (tx < tz) {
        // Crossing an x line: the wall on the low-x edge of whichever cell is further along x.
        const wx = sx > 0 ? cx + 1 : cx;
        if (inside(wx, cz) && s.wz[idx(wx, cz)]) return false;
        cx += sx;
        tx += tdx;
      } else {
        const wz = sz > 0 ? cz + 1 : cz;
        if (inside(cx, wz) && s.wx[idx(cx, wz)]) return false;
        cz += sz;
        tz += tdz;
      }
      if (!inside(cx, cz)) return true;
      if (s.flags[idx(cx, cz)]! & SOLID) return false;
    }
    return true;
  }

  /**
   * Distances to a goal from everywhere: grown outward from the `seeds` (the
   * goal's own cell, or the cells round something that cannot be entered).
   * With `breach`, a wall whose owner it accepts can be gone through at a
   * price (the unit breaks it down when it gets there).
   */
  flow(seeds: readonly Node[], cls: MoveClass, breach: ((owner: number) => boolean) | null, at = 0): Flow {
    // Cells are named by one number: storey, then place on the storey.
    const AREA = G * G;
    const ground = new Int32Array(AREA).fill(INF);
    const upper = new Map<number, number>();
    const get = (node: number) => (node < AREA ? ground[node]! : (upper.get(node) ?? INF));
    const set = (node: number, d: number) => {
      if (node < AREA) ground[node] = d;
      else upper.set(node, d);
    };
    const visit = (d: number, node: number): void => {
      const l = Math.floor(node / AREA), i = node - l * AREA;
      const x = Math.floor(i / G) - H, z = (i % G) - H;
      for (let dir = 0; dir < 4; dir++) {
        const way = this.cross(l, x, z, dir, cls);
        if (way === SHUT_WAY) continue;
        if (way === WALL_WAY && !(breach && breach(this.wallOwner))) continue;
        const next = this.toL * AREA + idx(x + DX[dir]!, z + DZ[dir]!);
        const nd = d + STEP + (way === WALL_WAY ? BREACH : 0);
        if (nd < get(next)) {
          set(next, nd);
          push(nd, next);
        }
      }
    };
    // A binary heap of distances and the cells they belong to, in two flat arrays.
    let keys = new Int32Array(4096), cells = new Int32Array(4096), size = 0;
    const push = (d: number, node: number): void => {
      if (size === keys.length) {
        const k = new Int32Array(size * 2), c = new Int32Array(size * 2);
        k.set(keys);
        c.set(cells);
        keys = k;
        cells = c;
      }
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p]! <= d) break;
        keys[i] = keys[p]!;
        cells[i] = cells[p]!;
        i = p;
      }
      keys[i] = d;
      cells[i] = node;
    };
    for (const s of seeds) {
      if (!this.standable(s.l, s.x, s.z)) continue;
      set(s.l * AREA + idx(s.x, s.z), 0);
      push(0, s.l * AREA + idx(s.x, s.z));
    }
    while (size > 0) {
      const d = keys[0]!, node = cells[0]!;
      // The last one takes the top's place and sinks to where it belongs.
      size--;
      const kd = keys[size]!, kc = cells[size]!;
      let i = 0;
      for (;;) {
        let m = i * 2 + 1;
        if (m >= size) break;
        if (m + 1 < size && keys[m + 1]! < keys[m]!) m++;
        if (keys[m]! >= kd) break;
        keys[i] = keys[m]!;
        cells[i] = cells[m]!;
        i = m;
      }
      keys[i] = kd;
      cells[i] = kc;
      if (d > get(node)) continue;
      visit(d, node);
    }
    return { ground, upper, cls, breach, version: this.version, at, seeds };
  }

  /** How far a cell is from a flow's goal (INF: it cannot be reached from there). */
  distance(flow: Flow, l: number, x: number, z: number): number {
    if (!inside(x, z)) return INF;
    return l === 0 ? flow.ground[idx(x, z)]! : (flow.upper.get(l * G * G + idx(x, z)) ?? INF);
  }

  /**
   * The next cell on the way to a flow's goal from cell (x, z) on storey l:
   * SHUT_WAY (already there, or no way), OPEN_WAY (`nextX`, `nextZ`, `toL`) or
   * WALL_WAY (a wall to break through first; noted as for `cross`). Goes
   * diagonally where all four ways round the corner are open and level.
   */
  next(flow: Flow, l: number, x: number, z: number): number {
    const here = this.distance(flow, l, x, z);
    let best = here, bestWay = SHUT_WAY, bx = 0, bz = 0, bl = 0;
    let wall: [number, number, number, 0 | 1, number] | null = null;
    const open = [false, false, false, false];
    for (let dir = 0; dir < 4; dir++) {
      const way = this.cross(l, x, z, dir, flow.cls);
      if (way === SHUT_WAY) continue;
      const nl = this.toL, nx = x + DX[dir]!, nz = z + DZ[dir]!;
      open[dir] = way === OPEN_WAY && nl === l && this.rampAt(nl, nx, nz) < 0;
      if (way === WALL_WAY && !(flow.breach && flow.breach(this.wallOwner))) continue;
      const d = this.distance(flow, nl, nx, nz) + (way === WALL_WAY ? BREACH : 0);
      if (d < best) {
        best = d;
        bestWay = way;
        bx = nx;
        bz = nz;
        bl = nl;
        wall = way === WALL_WAY ? [this.wallX, this.wallZ, this.wallL, this.wallRot, this.wallOwner] : null;
      }
    }
    // Diagonals, on the flat: both ways round the corner must be open.
    if (this.rampAt(l, x, z) < 0) {
      for (let dir = 0; dir < 4; dir++) {
        const other = (dir + 1) % 4;
        if (!open[dir] || !open[other]) continue;
        const nx = x + DX[dir]! + DX[other]!, nz = z + DZ[dir]! + DZ[other]!;
        const d = this.distance(flow, l, nx, nz);
        if (d >= best - STEP / 2) continue;
        // From each neighbour on into the corner cell.
        if (this.cross(l, x + DX[dir]!, z + DZ[dir]!, other, flow.cls) !== OPEN_WAY || this.toL !== l) continue;
        if (this.cross(l, x + DX[other]!, z + DZ[other]!, dir, flow.cls) !== OPEN_WAY || this.toL !== l) continue;
        if (this.rampAt(l, nx, nz) >= 0) continue;
        best = d;
        bestWay = OPEN_WAY;
        bx = nx;
        bz = nz;
        bl = l;
        wall = null;
      }
    }
    if (bestWay === SHUT_WAY) return SHUT_WAY;
    this.nextX = bx;
    this.nextZ = bz;
    this.toL = bl;
    if (wall) [this.wallX, this.wallZ, this.wallL, this.wallRot, this.wallOwner] = wall;
    return bestWay;
  }

  /**
   * The next cell for a unit that is following a flow but has a spot of its
   * own to reach (its place in the formation): of the open ways that lead on
   * toward the flow's goal, the one pointing most nearly along (dx, dz), a
   * unit vector toward that spot. So units ordered somewhere together march
   * side by side, each in its own lane, and still go round what is in the way.
   * `free`: close to the goal, any open way that heads for the spot will do.
   * SHUT_WAY when there is none (then `next` says whether a wall is to be
   * broken through); else OPEN_WAY with `nextX`, `nextZ`, `toL`.
   */
  toward(flow: Flow, l: number, x: number, z: number, dx: number, dz: number, free: boolean): number {
    const here = this.distance(flow, l, x, z);
    let best = -2, bx = 0, bz = 0, bl = 0;
    const open = [false, false, false, false];
    const flat = this.rampAt(l, x, z) < 0;
    for (let dir = 0; dir < 4; dir++) {
      if (this.cross(l, x, z, dir, flow.cls) !== OPEN_WAY) continue;
      const nl = this.toL, nx = x + DX[dir]!, nz = z + DZ[dir]!;
      open[dir] = nl === l && this.rampAt(nl, nx, nz) < 0;
      const score = DX[dir]! * dx + DZ[dir]! * dz;
      if (free ? score <= 0.05 : this.distance(flow, nl, nx, nz) >= here) continue;
      if (score > best) {
        best = score;
        bx = nx;
        bz = nz;
        bl = nl;
      }
    }
    if (flat) {
      for (let dir = 0; dir < 4; dir++) {
        const other = (dir + 1) % 4;
        if (!open[dir] || !open[other]) continue;
        const sx = DX[dir]! + DX[other]!, sz = DZ[dir]! + DZ[other]!;
        const score = (sx * dx + sz * dz) * Math.SQRT1_2;
        if (score <= best || (free && score <= 0.05)) continue;
        const nx = x + sx, nz = z + sz;
        if (!free && this.distance(flow, l, nx, nz) >= here) continue;
        // Both ways round the corner must be open, and the corner cell level ground.
        if (this.cross(l, x + DX[dir]!, z + DZ[dir]!, other, flow.cls) !== OPEN_WAY || this.toL !== l) continue;
        if (this.cross(l, x + DX[other]!, z + DZ[other]!, dir, flow.cls) !== OPEN_WAY || this.toL !== l) continue;
        if (this.rampAt(l, nx, nz) >= 0) continue;
        best = score;
        bx = nx;
        bz = nz;
        bl = l;
      }
    }
    if (best <= -2) return SHUT_WAY;
    this.nextX = bx;
    this.nextZ = bz;
    this.toL = bl;
    return OPEN_WAY;
  }

  /** The open cells round a square of cells on the ground (a building, a field): somewhere to stand beside it. */
  around(cx: number, cz: number, size: number): Node[] {
    const out: Node[] = [];
    for (let x = cx - 1; x <= cx + size; x++) {
      for (let z = cz - 1; z <= cz + size; z++) {
        const edge = x < cx || x >= cx + size || z < cz || z >= cz + size;
        if (edge && this.standable(0, x, z) && this.rampAt(0, x, z) < 0) out.push({ x, z, l: 0 });
      }
    }
    return out;
  }

  /** How high a unit's feet are at a spot in its cell: the storey's height, or part way up its ramp. */
  heightAt(l: number, x: number, z: number): number {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const r = this.rampAt(l, cx, cz);
    if (r < 0) return l === 0 ? 0 : l * LEVEL + THICK / 2;
    const u = x / CELL - cx, w = z / CELL - cz;
    const along = r === 0 ? w : r === 1 ? u : r === 2 ? 1 - w : 1 - u;
    return (l + Math.max(0, Math.min(1, along))) * LEVEL;
  }
}

/** True when a wall's cut tiles leave a way through for someone on foot: a column with its bottom two tiles gone. */
export function hasDoor(edit: number): boolean {
  for (let c = 0; c < 3; c++) if (edit & (1 << c) && edit & (1 << (3 + c))) return true;
  return false;
}

export { INF };
