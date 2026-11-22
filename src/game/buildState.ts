import { CELL, LEVEL } from "./constants";
import { piecesMeet } from "./contact";
import { boxesTouch, gridBox, inBounds, isMaterial, isValidEdit, normalizeSpec, slotKey, type Piece, type PieceSpec } from "./pieces";

/**
 * The build is a set of pieces changed only through operations. Everything that
 * edits the world (the player, undo, a loaded save, later another player over the
 * network) goes through `apply`, so the state can be replayed or mirrored.
 */
export type BuildOp =
  | { kind: "place"; piece: Piece }
  | { kind: "remove"; id: string }
  /** Cuts tiles out of a piece, or puts them back (see editGrid). */
  | { kind: "edit"; id: string; edit: number };

export type PlaceProblem = "bounds" | "occupied" | "unsupported";
export type PlaceCheck = { ok: true } | { ok: false; problem: PlaceProblem };

export type BuildListener = (op: BuildOp, piece: Piece) => void;

const cellKey = (x: number, y: number, z: number) => `${x}|${y}|${z}`;

export class BuildState {
  private readonly pieces = new Map<string, Piece>();
  private readonly slots = new Map<string, string>();
  /** Piece ids bucketed by cell, for neighbour lookups. */
  private readonly cells = new Map<string, Set<string>>();
  private readonly listeners = new Set<BuildListener>();

  get size(): number {
    return this.pieces.size;
  }

  get(id: string): Piece | undefined {
    return this.pieces.get(id);
  }

  all(): IterableIterator<Piece> {
    return this.pieces.values();
  }

  /** The piece occupying the same slot as `spec`, if any. */
  occupant(spec: PieceSpec): Piece | undefined {
    const id = this.slots.get(slotKey(spec));
    return id === undefined ? undefined : this.pieces.get(id);
  }

  /** Called after every applied operation, with the piece placed, removed or edited (as it is now). */
  subscribe(listener: BuildListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Rules for a player placing a new piece: inside the world, slot free, and
   * resting on the ground or touching a piece that is already there.
   */
  canPlace(spec: PieceSpec): PlaceCheck {
    if (!inBounds(spec)) return { ok: false, problem: "bounds" };
    if (this.slots.has(slotKey(spec))) return { ok: false, problem: "occupied" };
    if (!this.isSupported(spec)) return { ok: false, problem: "unsupported" };
    return { ok: true };
  }

  /**
   * Resting on the ground or touching another piece. A trebuchet must stand on
   * the ground or on a floor in its own cell, and holds nothing else up.
   */
  isSupported(spec: PieceSpec): boolean {
    if (spec.type === "trebuchet") return spec.y === 0 || this.occupant({ type: "floor", x: spec.x, y: spec.y, z: spec.z, rot: 0 }) !== undefined;
    return gridBox(spec)[1] === 0 || this.touching(spec).some((p) => p.type !== "trebuchet");
  }

  /** Every piece that really meets `spec` along an edge (see contact.ts), not counting itself. */
  touching(spec: PieceSpec & { id?: string }): Piece[] {
    const box = gridBox(spec);
    const found: Piece[] = [];
    for (let x = spec.x - 1; x <= spec.x + 1; x++) {
      for (let y = spec.y - 1; y <= spec.y + 1; y++) {
        for (let z = spec.z - 1; z <= spec.z + 1; z++) {
          const bucket = this.cells.get(cellKey(x, y, z));
          if (!bucket) continue;
          for (const id of bucket) {
            if (id === spec.id) continue;
            const other = this.pieces.get(id);
            // The boxes test is a quick first filter; piecesMeet decides.
            if (other && boxesTouch(box, gridBox(other)) && piecesMeet(spec, other)) found.push(other);
          }
        }
      }
    }
    return found;
  }

  /** Pieces whose own cell is within `reach` cells of `spec`'s cell (every axis). */
  around(spec: PieceSpec, reach: number): Piece[] {
    const found: Piece[] = [];
    for (let x = spec.x - reach; x <= spec.x + reach; x++) {
      for (let y = spec.y - reach; y <= spec.y + reach; y++) {
        for (let z = spec.z - reach; z <= spec.z + reach; z++) {
          const bucket = this.cells.get(cellKey(x, y, z));
          if (bucket) for (const id of bucket) found.push(this.pieces.get(id)!);
        }
      }
    }
    return found;
  }

  /** Pieces whose own cell is within one cell of the cell holding point (x, y, z) in metres. */
  near(x: number, y: number, z: number): Piece[] {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / LEVEL), gz = Math.floor(z / CELL);
    const found: Piece[] = [];
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      for (let cy = gy - 1; cy <= gy + 1; cy++) {
        for (let cz = gz - 1; cz <= gz + 1; cz++) {
          const bucket = this.cells.get(cellKey(cx, cy, cz));
          if (bucket) for (const id of bucket) found.push(this.pieces.get(id)!);
        }
      }
    }
    return found;
  }

  /**
   * Applies an operation. Returns the operation that undoes it, or null when it
   * cannot be applied (slot taken, out of bounds, unknown or duplicate id,
   * invalid material or edit, or an edit that changes nothing).
   * Support is a placement rule for players, not a hard rule: undo may put a
   * piece back after its neighbours have gone.
   */
  apply(op: BuildOp): BuildOp | null {
    if (op.kind === "edit") {
      const piece = this.pieces.get(op.id);
      if (!piece || piece.edit === op.edit || !isValidEdit(piece.type, op.edit)) return null;
      const next: Piece = { ...piece, edit: op.edit };
      this.pieces.set(piece.id, next);
      this.emit(op, next);
      return { kind: "edit", id: piece.id, edit: piece.edit };
    }
    if (op.kind === "place") {
      const src = op.piece;
      const piece: Piece = { ...normalizeSpec(src), id: src.id, material: src.material, edit: src.edit };
      const slot = slotKey(piece);
      if (!piece.id || this.pieces.has(piece.id) || this.slots.has(slot) || !inBounds(piece)) return null;
      if (!isMaterial(piece.material) || !isValidEdit(piece.type, piece.edit)) return null;
      this.pieces.set(piece.id, piece);
      this.slots.set(slot, piece.id);
      const key = cellKey(piece.x, piece.y, piece.z);
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = new Set()));
      bucket.add(piece.id);
      this.emit({ kind: "place", piece }, piece);
      return { kind: "remove", id: piece.id };
    }
    const piece = this.pieces.get(op.id);
    if (!piece) return null;
    this.pieces.delete(piece.id);
    this.slots.delete(slotKey(piece));
    const key = cellKey(piece.x, piece.y, piece.z);
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.delete(piece.id);
      if (bucket.size === 0) this.cells.delete(key);
    }
    this.emit(op, piece);
    return { kind: "place", piece };
  }

  private emit(op: BuildOp, piece: Piece): void {
    for (const listener of this.listeners) listener(op, piece);
  }
}
