import type { BuildOp } from "./buildState";

/** Anything operations can be applied to: the build state, or a wrapper that also sends them to the server. */
export interface OpTarget {
  apply(op: BuildOp): BuildOp | null;
}

/** One player action: the operations it applied and, in the same order, what undoes each. */
interface Entry {
  ops: BuildOp[];
  inverses: BuildOp[];
}

/** Undo and redo for one player's own actions. */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  constructor(
    private readonly state: OpTarget,
    private readonly limit = 1000,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Applies a new operation as a new action. Returns false when the state rejects it. */
  do(op: BuildOp): boolean {
    const inverse = this.state.apply(op);
    if (!inverse) return false;
    this.undoStack.push({ ops: [op], inverses: [inverse] });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  /**
   * Applies an operation as part of the latest action, so one undo reverts both
   * (for example the pieces that fall when their support is removed).
   */
  extend(op: BuildOp): boolean {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return this.do(op);
    const inverse = this.state.apply(op);
    if (!inverse) return false;
    entry.ops.push(op);
    entry.inverses.push(inverse);
    return true;
  }

  /** Undoes the latest action that can still be undone. */
  undo(): boolean {
    for (let entry = this.undoStack.pop(); entry; entry = this.undoStack.pop()) {
      let any = false;
      for (let i = entry.inverses.length - 1; i >= 0; i--) if (this.state.apply(entry.inverses[i]!)) any = true;
      if (any) {
        this.redoStack.push(entry);
        return true;
      }
    }
    return false;
  }

  redo(): boolean {
    for (let entry = this.redoStack.pop(); entry; entry = this.redoStack.pop()) {
      let any = false;
      for (const op of entry.ops) if (this.state.apply(op)) any = true;
      if (any) {
        this.undoStack.push(entry);
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
