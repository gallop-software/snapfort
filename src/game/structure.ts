import type { BuildState } from "./buildState";
import { gridBox, type Piece } from "./pieces";

/**
 * Structure: what stays up. A piece stands when it rests on the ground or
 * touches, through other pieces, something that does. Trebuchets are the
 * exception: one stands only on the ground or on the floor in its own cell,
 * and holds nothing else up, so it comes down with its platform.
 */

const isTrebuchet = (p: Piece) => p.type === "trebuchet";

/** The floor a raised trebuchet stands on, if it is there. */
function floorUnder(state: BuildState, t: Piece): Piece | undefined {
  return state.occupant({ type: "floor", x: t.x, y: t.y, z: t.z, rot: 0 });
}

/** Neighbours that pass support along: everything touching except trebuchets. */
function* supporters(state: BuildState, piece: Piece): Generator<Piece> {
  for (const other of state.touching(piece)) if (!isTrebuchet(other)) yield other;
}

/** Whether trebuchet `t` stands, given which other pieces are falling. */
function trebuchetStands(state: BuildState, t: Piece, falling: (id: string) => boolean): boolean {
  if (t.y === 0) return true;
  const floor = floorUnder(state, t);
  return floor !== undefined && !falling(floor.id);
}

/**
 * Pieces that no longer connect to the ground through other pieces.
 * Searches the whole world; findLooseAfterRemoval is the quick version.
 */
export function findUnsupported(state: BuildState): Piece[] {
  const grounded = new Set<string>();
  const queue: Piece[] = [];
  for (const piece of state.all()) {
    if (!isTrebuchet(piece) && gridBox(piece)[1] === 0) {
      grounded.add(piece.id);
      queue.push(piece);
    }
  }
  for (let piece = queue.pop(); piece; piece = queue.pop()) {
    for (const other of supporters(state, piece)) {
      if (!grounded.has(other.id)) {
        grounded.add(other.id);
        queue.push(other);
      }
    }
  }
  const loose: Piece[] = [];
  for (const piece of state.all()) {
    if (isTrebuchet(piece)) {
      if (!trebuchetStands(state, piece, (id) => !grounded.has(id))) loose.push(piece);
    } else if (!grounded.has(piece.id)) loose.push(piece);
  }
  return loose;
}

/**
 * The pieces that fall after `removed` have gone: those around them that no
 * longer connect to the ground. Same answer as findUnsupported when the rest of
 * the world was standing before, but it only explores outward from the removed
 * pieces and stops as soon as a group reaches the ground, so it stays quick in
 * a big shared world.
 */
export function findLooseAfterRemoval(state: BuildState, removed: readonly Piece[]): Piece[] {
  const grounded = new Set<string>();
  const loose = new Map<string, Piece>();
  const trebuchets = new Map<string, Piece>();
  for (const gone of removed) {
    for (const start of state.touching(gone)) {
      if (isTrebuchet(start)) {
        trebuchets.set(start.id, start);
        continue;
      }
      if (grounded.has(start.id) || loose.has(start.id) || !state.get(start.id)) continue;
      // Explore the group this neighbour belongs to until something in it stands on the ground.
      const seen = new Map<string, Piece>([[start.id, start]]);
      const queue: Piece[] = [start];
      let reachesGround = false;
      for (let piece = queue.pop(); piece; piece = queue.pop()) {
        if (gridBox(piece)[1] === 0 || grounded.has(piece.id)) {
          reachesGround = true;
          break;
        }
        for (const other of supporters(state, piece)) {
          if (!seen.has(other.id)) {
            seen.set(other.id, other);
            queue.push(other);
          }
        }
      }
      for (const [id, piece] of seen) {
        if (reachesGround) grounded.add(id);
        else loose.set(id, piece);
      }
    }
  }
  // Trebuchets next to anything that went or is falling: down too if their floor is.
  for (const piece of loose.values()) for (const other of state.touching(piece)) if (isTrebuchet(other)) trebuchets.set(other.id, other);
  for (const t of trebuchets.values()) {
    if (!state.get(t.id)) continue;
    if (!trebuchetStands(state, t, (id) => loose.has(id))) loose.set(t.id, t);
  }
  return [...loose.values()];
}
