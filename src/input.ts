/** Largest mouse movement accepted from a single event, in pixels. */
const MAX_MOUSE_JUMP = 250;

/** Keyboard and mouse. The game only reacts while the pointer is locked to the canvas. */
export class Input {
  locked = false;
  onKey: (code: string, event: KeyboardEvent) => void = () => {};
  onMouseDown: (button: number) => void = () => {};
  onMouseUp: (button: number) => void = () => {};
  onWheel: (direction: 1 | -1) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};

  private readonly down = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.down.clear();
      this.onLockChange(this.locked);
    });
    window.addEventListener("blur", () => this.down.clear());

    window.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      // Keep the browser from scrolling, tabbing away or opening menus mid-build.
      // F1 to F4 are build keys; the other function keys keep their browser jobs.
      const browserKey = /^F([5-9]|1[0-2])$/.test(e.code);
      if (e.code !== "Escape" && !browserKey) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.onKey(e.code, e);
      }
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // Browsers occasionally report one huge jump (a known pointer-lock glitch).
      // No real hand moves this far in a single event, so ignore it.
      if (Math.abs(e.movementX) > MAX_MOUSE_JUMP || Math.abs(e.movementY) > MAX_MOUSE_JUMP) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (this.locked) this.onMouseDown(e.button);
    });
    window.addEventListener("mouseup", (e) => this.onMouseUp(e.button));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.locked && e.deltaY !== 0) this.onWheel(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Mouse movement since the last call, in pixels. */
  takeLook(): [number, number] {
    const look: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return look;
  }

  /**
   * Captures the mouse. Browsers refuse for about a second after the player
   * presses Esc, so a refused request is tried once more a moment later (the
   * click that asked still counts as permission for a few seconds).
   */
  async lock(): Promise<boolean> {
    if (this.locked) return true;
    if (await this.tryLock()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return this.locked || (await this.tryLock());
  }

  private async tryLock(): Promise<boolean> {
    try {
      // Raw mouse input (no OS acceleration) where the browser offers it.
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
      return true;
    } catch {
      try {
        await this.canvas.requestPointerLock();
        return true;
      } catch {
        return false;
      }
    }
  }
}
