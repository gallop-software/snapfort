import type { BuildOp, BuildState } from "../game/buildState";
import type { OpTarget } from "../game/history";
import { slotKey, type Piece } from "../game/pieces";

/** An operation applied here before the world confirmed it, and what undoes it now. */
interface Entry {
  op: BuildOp;
  inverse: BuildOp | null;
}

interface Action {
  seq: number;
  entries: Entry[];
}

/**
 * The build as this player sees it: the shared world plus their own operations
 * still on the way to the server.
 *
 * Own operations are applied at once (building never waits for the network) and
 * collected into actions to send. The server puts every action from every
 * player in one order. When a change from someone else, or the server's answer
 * to an action, clashes with operations still in flight, those are rolled back,
 * the server's version is applied, and they are applied again on top. That is
 * the order the server used, so everyone ends up with the same build.
 */
export class SyncedState implements OpTarget {
  /** Applied but not yet sent. */
  private outbox: Entry[] = [];
  /** Sent, waiting for the server's answer, oldest first. */
  private pending: Action[] = [];
  private nextSeq = 1;

  constructor(readonly state: BuildState) {}

  /** Operations sent or waiting to be sent. */
  get inFlight(): number {
    return this.outbox.length + this.pending.reduce((n, a) => n + a.entries.length, 0);
  }

  /** A local operation: applied now, and sent with the next action. */
  apply(op: BuildOp): BuildOp | null {
    const inverse = this.state.apply(op);
    if (inverse) this.outbox.push({ op, inverse });
    return inverse;
  }

  /** Bundles the operations applied since the last call into one action to send, or null when there are none. */
  takeAction(): { seq: number; ops: BuildOp[] } | null {
    if (this.outbox.length === 0) return null;
    const action: Action = { seq: this.nextSeq++, entries: this.outbox };
    this.outbox = [];
    this.pending.push(action);
    return { seq: action.seq, ops: action.entries.map((e) => e.op) };
  }

  /** Changes from another player, in the server's order. */
  remote(ops: readonly BuildOp[]): void {
    if (ops.length === 0) return;
    if (!this.clashes(ops)) {
      for (const op of ops) this.state.apply(op);
      return;
    }
    this.rewind();
    for (const op of ops) this.state.apply(op);
    this.replay();
  }

  /**
   * The server's answer to action `seq`: the indexes it refused and what it also
   * did. Returns the refused operations (to tell the player, for example).
   */
  ack(seq: number, rejected: readonly number[], extra: readonly BuildOp[]): BuildOp[] {
    const index = this.pending.findIndex((a) => a.seq === seq);
    if (index < 0) return [];
    const action = this.pending[index]!;
    const refused = action.entries.filter((_, i) => rejected.includes(i)).map((e) => e.op);
    if (refused.length === 0 && extra.length === 0) {
      // Taken as it was: it is part of the shared world now.
      this.pending.splice(0, index + 1);
      return refused;
    }
    this.rewind();
    this.pending.splice(0, index + 1);
    action.entries.forEach((entry, i) => {
      if (!rejected.includes(i)) this.state.apply(entry.op);
    });
    for (const op of extra) this.state.apply(op);
    this.replay();
    return refused;
  }

  /**
   * Replaces the build with the server's (on joining or reconnecting). Only the
   * differences are applied, so pieces that are already right are left alone.
   * Operations not yet confirmed are dropped.
   */
  reset(pieces: readonly Piece[]): void {
    this.outbox = [];
    this.pending = [];
    const wanted = new Map(pieces.map((p) => [p.id, p]));
    for (const piece of [...this.state.all()]) {
      const next = wanted.get(piece.id);
      if (next && samePlace(piece, next) && piece.material === next.material) {
        if (piece.edit !== next.edit) this.state.apply({ kind: "edit", id: piece.id, edit: next.edit });
        wanted.delete(piece.id);
      } else this.state.apply({ kind: "remove", id: piece.id });
    }
    for (const piece of wanted.values()) this.state.apply({ kind: "place", piece });
  }

  /** True when `ops` touch a piece or slot that an operation in flight also touches. */
  private clashes(ops: readonly BuildOp[]): boolean {
    if (this.inFlight === 0) return false;
    const keys = new Set<string>();
    for (const entry of this.entries()) for (const key of this.keysOf(entry.op, entry.inverse)) keys.add(key);
    return ops.some((op) => this.keysOf(op, null).some((key) => keys.has(key)));
  }

  private keysOf(op: BuildOp, inverse: BuildOp | null): string[] {
    if (op.kind === "place") return [`#${op.piece.id}`, slotKey(op.piece)];
    const keys = [`#${op.id}`];
    // A removed piece frees its slot; the inverse (putting it back) says where that is.
    const piece = inverse?.kind === "place" ? inverse.piece : this.state.get(op.id);
    if (piece) keys.push(slotKey(piece));
    return keys;
  }

  private *entries(): Generator<Entry> {
    for (const action of this.pending) yield* action.entries;
    yield* this.outbox;
  }

  /** Takes every operation in flight back out, newest first. */
  private rewind(): void {
    const all = [...this.entries()];
    for (let i = all.length - 1; i >= 0; i--) {
      const inverse = all[i]!.inverse;
      if (inverse) this.state.apply(inverse);
    }
  }

  /** Applies every operation in flight again, oldest first. One that no longer fits stays out until the server answers. */
  private replay(): void {
    for (const entry of this.entries()) entry.inverse = this.state.apply(entry.op);
  }
}

const samePlace = (a: Piece, b: Piece) => a.type === b.type && a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot;
