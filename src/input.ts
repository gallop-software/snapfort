/** Scroll distance (pixels) that counts as one wheel step. */
const WHEEL_STEP = 100;
/** The bits of PointerEvent.buttons, and the MouseEvent.button each is: left, right, middle. */
const BUTTON_BITS = [[1, 0], [2, 2], [4, 1]] as const;
/** Largest mouse movement accepted from a single event, in pixels. */
const MAX_MOUSE_JUMP = 250;
/**
 * A movement this big (pixels) out of stillness or slow movement is held back
 * until the next one says whether it was a hand: a real flick goes on moving,
 * a glitch (trackpads under pointer lock, on a Mac especially) is one event
 * alone. Held at most this long (ms).
 */
const SUSPECT_JUMP = 60;
const SUSPECT_HOLD_MS = 40;
/** For this long after the mouse is captured (ms), movement is ignored: browsers often report where the cursor was as one jump. */
const SETTLE_AFTER_LOCK_MS = 120;

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
  /** The mouse buttons held, as PointerEvent.buttons last said. */
  private buttons = 0;
  private wheelAt = 0;
  private lookX = 0;
  private lookY = 0;
  /** How far the last few movements went (pixels an event, smoothed), and when the last came. */
  private recent = 0;
  private movedAt = 0;
  private lockedAt = 0;
  /** A big movement held back until the next one: x, y, when. */
  private suspect: [number, number, number] | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    document.addEventListener("pointerlockchange", () => {
      if (this.touch) return;
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.down.clear();
      else this.lockedAt = performance.now();
      this.suspect = null;
      this.recent = 0;
      this.onLockChange(this.locked);
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      // (A button let go of in another window is never heard of here.)
      this.buttons = 0;
    });

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
      this.moved(e.movementX, e.movementY, performance.now());
    });
    // Buttons from pointer events, not mouse events: Babylon cancels every pointerdown on the canvas, and a browser that
    // keeps to the standard (Firefox) then sends no mousedown at all, so no click ever built anything there (Chrome
    // still sent one while the mouse was captured). A second button pressed while one is held comes as a pointermove
    // with `buttons` changed, not a pointerdown: every one of them is compared with the buttons held before.
    const sync = (e: PointerEvent, canPress: boolean) => {
      if (e.pointerType === "touch") return;
      const now = e.buttons, was = this.buttons;
      if (now === was) return;
      this.buttons = now;
      for (const [bit, button] of BUTTON_BITS) {
        if (now & bit && !(was & bit) && canPress && this.locked && !this._typing) this.onMouseDown(button);
        else if (!(now & bit) && was & bit) this.onMouseUp(button);
      }
    };
    canvas.addEventListener("pointerdown", (e) => sync(e, true));
    document.addEventListener("pointermove", (e) => sync(e, e.target === canvas || this.locked));
    window.addEventListener("pointerup", (e) => sync(e, false));
    window.addEventListener("pointercancel", (e) => sync(e, false));
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

  /**
   * One movement of the mouse or trackpad under pointer lock. Browsers
   * occasionally report a jump no hand made (a known pointer-lock glitch,
   * common with trackpads): one event far bigger than the movement around it.
   * Such a jump is held back for the next event: kept if the movement goes on
   * (a fast flick builds up over several events), dropped if it was alone.
   */
  moved(dx: number, dy: number, now: number): void {
    if (now - this.lockedAt < SETTLE_AFTER_LOCK_MS) return;
    // No real hand moves this far in a single event.
    if (Math.abs(dx) > MAX_MOUSE_JUMP || Math.abs(dy) > MAX_MOUSE_JUMP) return;
    const size = Math.hypot(dx, dy);
    // Still for a while: what came before says nothing of this.
    if (now - this.movedAt > 100) this.recent = 0;
    this.movedAt = now;
    const held = this.suspect;
    if (held) {
      this.suspect = null;
      // The movement went on: the jump was a hand's, and counts.
      if (now - held[2] <= SUSPECT_HOLD_MS && size >= Math.hypot(held[0], held[1]) / 4) {
        this.lookX += held[0];
        this.lookY += held[1];
        this.recent = this.recent * 0.6 + Math.hypot(held[0], held[1]) * 0.4;
      }
    }
    if (size > SUSPECT_JUMP && size > this.recent * 4) {
      this.suspect = [dx, dy, now];
      return;
    }
    this.recent = this.recent * 0.6 + size * 0.4;
    this.lookX += dx;
    this.lookY += dy;
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
