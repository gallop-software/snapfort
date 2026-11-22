/** Scroll distance (pixels) that counts as one wheel step. */
const WHEEL_STEP = 100;
/** Largest mouse movement accepted from a single event, in pixels. */
const MAX_MOUSE_JUMP = 250;

/**
 * True on a phone or tablet with no mouse: the game is played with on-screen
 * touch controls. `?touch` in the address forces it (for testing on a computer).
 */
export function isTouchOnly(): boolean {
  if (new URLSearchParams(location.search).has("touch")) return true;
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

/** Movement from the on-screen joystick: x to the right, y forward, each -1..1; run when pushed all the way. */
export interface Axis {
  x: number;
  y: number;
  run: boolean;
}

/**
 * Keyboard and mouse, or touch. With a mouse the game only reacts while the
 * pointer is locked to the canvas. On a touch device there is no pointer
 * lock: `locked` simply means playing (no menu open), and the on-screen
 * controls feed in movement (`axis`), looking (`addLook`) and button presses.
 */
export class Input {
  locked = false;
  readonly touch = isTouchOnly();
  readonly axis: Axis = { x: 0, y: 0, run: false };
  onKey: (code: string, event: KeyboardEvent) => void = () => {};
  onMouseDown: (button: number) => void = () => {};
  onMouseUp: (button: number) => void = () => {};
  onWheel: (direction: 1 | -1) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};

  private readonly down = new Set<string>();
  private _typing = false;
  private wheelSum = 0;
  private wheelAt = 0;
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    document.addEventListener("pointerlockchange", () => {
      if (this.touch) return;
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.down.clear();
      this.onLockChange(this.locked);
    });
    window.addEventListener("blur", () => this.down.clear());

    window.addEventListener("keydown", (e) => {
      // Typing a chat message: keys are letters, not moves or build keys.
      if (!this.locked || this._typing) return;
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
      if (this.locked && !this._typing) this.onMouseDown(e.button);
    });
    window.addEventListener("mouseup", (e) => this.onMouseUp(e.button));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!this.locked || e.deltaY === 0) return;
        // A mouse wheel click is one step; a trackpad swipe sends many small
        // deltas, so add them up and step once per wheel-click's worth.
        const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
        if (Math.sign(px) !== Math.sign(this.wheelSum)) this.wheelSum = 0;
        this.wheelSum += px;
        const now = performance.now();
        if (Math.abs(this.wheelSum) >= WHEEL_STEP || (Math.abs(px) >= 50 && now - this.wheelAt > 60)) {
          this.onWheel(this.wheelSum > 0 ? 1 : -1);
          this.wheelSum = 0;
          this.wheelAt = now;
        }
      },
      { passive: false },
    );
  }

  /**
   * True while a chat message is being typed: the keyboard goes to the text
   * line, and clicks do nothing, but the mouse (or a thumb) still looks
   * around, so the crosshair can point at what the message is about.
   */
  get typing(): boolean {
    return this._typing;
  }

  set typing(on: boolean) {
    this._typing = on;
    // Keys held when the line opened would otherwise stay down.
    if (on) this.down.clear();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** An on-screen button held down or let go (touch), as if it were a key. */
  press(code: string, down: boolean): void {
    if (down) this.down.add(code);
    else this.down.delete(code);
  }

  /** Looking around by dragging (touch), in screen pixels like mouse movement. */
  addLook(dx: number, dy: number): void {
    if (!this.locked) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  /** Stops playing (opens the menu): releases the mouse, or on touch just leaves play. */
  unlock(): void {
    if (!this.touch) return void document.exitPointerLock();
    if (!this.locked) return;
    this.locked = false;
    this.down.clear();
    this.axis.x = this.axis.y = 0;
    this.axis.run = false;
    this.onLockChange(false);
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
    if (this.touch) {
      this.locked = true;
      this.onLockChange(true);
      return true;
    }
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
