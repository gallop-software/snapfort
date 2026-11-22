import type { Input } from "../input";

/** What the on-screen buttons do (wired up by the game). */
export interface TouchActions {
  /** The big action button, held (place pieces, cut edit tiles). */
  place(down: boolean): void;
  remove(): void;
  /** A key's job (G edit, T material, R turn ramp, Q undo, E redo, H get on/off). */
  key(code: string): void;
  fire(): void;
  zoom(): void;
  settings(): void;
}

/** What the controls are showing: building, editing a piece, or on a trebuchet. */
export type TouchMode = "build" | "edit" | "crew";

/** Joystick reach from its centre to its edge, in CSS pixels. */
const STICK = 56;
/** Touches starting in this share of the screen's width (from the left) move; the rest look. */
const MOVE_ZONE = 0.42;
/** Screen pixels of drag per pixel of mouse movement, for the same look speed setting. */
const LOOK_GAIN = 1.5;

interface Button {
  el: HTMLButtonElement;
  modes: readonly TouchMode[];
}

/**
 * On-screen controls for phones and tablets, laid out like Fortnite's mobile
 * controls: a joystick that appears wherever the left thumb lands (pushed to
 * its edge, the builder runs), dragging anywhere else to look, and buttons on
 * the right. The hotbar (in the HUD) picks pieces as usual.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<string, Button>();
  private readonly boardButton: HTMLButtonElement;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private readonly lookers = new Map<number, { x: number; y: number }>();
  private current: TouchMode = "build";

  constructor(
    private readonly input: Input,
    actions: TouchActions,
  ) {
    document.body.classList.add("touch");
    this.root = div("touch", "");
    const layer = div("touch-layer", "");
    this.base = div("joy-base", "");
    this.knob = div("joy-knob", "");
    this.base.appendChild(this.knob);
    this.base.hidden = true;
    this.root.append(layer, this.base);

    const add = (id: string, label: string, modes: readonly TouchMode[], down: () => void, up?: () => void) => {
      const el = document.createElement("button");
      el.id = id;
      el.type = "button";
      el.className = "touch-button";
      el.innerHTML = label;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        el.classList.add("pressed");
        down();
      });
      const release = (e: PointerEvent) => {
        if (!el.classList.contains("pressed")) return;
        e.stopPropagation();
        el.classList.remove("pressed");
        up?.();
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      this.root.appendChild(el);
      this.buttons.set(id, { el, modes });
      return el;
    };
    const always: TouchMode[] = ["build", "edit", "crew"];
    add("t-settings", gear, always, () => actions.settings());
    add("t-undo", "Undo", ["build"], () => actions.key("KeyQ"));
    add("t-redo", "Redo", ["build"], () => actions.key("KeyE"));
    add("t-jump", "Jump", ["build", "edit"], () => input.press("Space", true), () => input.press("Space", false));
    add("t-place", "Place", ["build", "edit"], () => actions.place(true), () => actions.place(false));
    add("t-remove", "Remove", ["build", "edit"], () => actions.remove());
    add("t-edit", "Edit", ["build", "edit"], () => actions.key("KeyG"));
    add("t-material", `<span class="swatch"></span><span class="name">Wood</span>`, ["build"], () => actions.key("KeyT"));
    add("t-turn", "Turn", ["build"], () => actions.key("KeyR"));
    add("t-fire", "Fire", ["crew"], () => actions.fire());
    add("t-zoom", "Zoom", ["crew"], () => actions.zoom());
    add("t-leave", "Get off", ["crew"], () => actions.key("KeyH"));
    this.boardButton = add("t-board", "Get on", ["build"], () => actions.key("KeyH"));
    this.boardButton.hidden = true;

    // Thumbs on the open screen: the left one moves, the others look.
    layer.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      const moveOk = this.current !== "crew";
      if (moveOk && this.stickId === null && e.clientX < innerWidth * MOVE_ZONE) {
        this.stickId = e.pointerId;
        this.stickX = e.clientX;
        this.stickY = e.clientY;
        this.base.hidden = false;
        this.base.style.left = `${e.clientX}px`;
        this.base.style.top = `${e.clientY}px`;
        this.moveStick(e.clientX, e.clientY);
      } else this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    layer.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickId) return this.moveStick(e.clientX, e.clientY);
      const last = this.lookers.get(e.pointerId);
      if (!last) return;
      this.input.addLook((e.clientX - last.x) * LOOK_GAIN, (e.clientY - last.y) * LOOK_GAIN);
      last.x = e.clientX;
      last.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.releaseStick();
      this.lookers.delete(e.pointerId);
    };
    layer.addEventListener("pointerup", end);
    layer.addEventListener("pointercancel", end);
    document.body.insertBefore(this.root, document.getElementById("hud"));
    this.mode = "build";
    this.visible = false;
  }

  /** Shown while playing, hidden behind the menu. */
  set visible(on: boolean) {
    this.root.hidden = !on;
    if (!on) {
      // A button pressed to open the menu never sees the finger lift: clear its look.
      for (const { el } of this.buttons.values()) el.classList.remove("pressed");
      this.releaseStick();
      this.lookers.clear();
    }
  }

  set mode(mode: TouchMode) {
    if (mode === this.current && this.root.dataset.mode === mode) return;
    this.current = mode;
    this.root.dataset.mode = mode;
    for (const { el, modes } of this.buttons.values()) if (el !== this.boardButton) el.hidden = !modes.includes(mode);
    if (mode !== "build") this.boardButton.hidden = true;
    if (mode === "crew") this.releaseStick();
    // Editing: the action button cuts tiles, Remove puts them all back, Edit confirms.
    this.label("t-place", mode === "edit" ? "Cut" : "Place");
    this.label("t-remove", mode === "edit" ? "Reset" : "Remove");
    this.label("t-edit", mode === "edit" ? "Done" : "Edit");
  }

  /** The Turn button: lit, with the direction, while the next ramp is turned. */
  setTurn(turn: number, name: string): void {
    const el = this.buttons.get("t-turn")!.el;
    el.classList.toggle("on", turn !== 0);
    el.textContent = turn === 0 ? "Turn" : `↻ ${name[0]!.toUpperCase()}${name.slice(1)}`;
  }

  /** The Get on button, shown when a trebuchet is in reach. */
  setBoard(visible: boolean): void {
    this.boardButton.hidden = !visible || this.current !== "build";
  }

  /** The material button's colour and name. */
  setMaterial(label: string, css: string): void {
    const el = this.buttons.get("t-material")!.el;
    (el.querySelector(".swatch") as HTMLElement).style.background = css;
    el.querySelector(".name")!.textContent = label;
  }

  private label(id: string, text: string): void {
    const el = this.buttons.get(id)!.el;
    if (el.textContent !== text) el.textContent = text;
  }

  private moveStick(x: number, y: number): void {
    let dx = x - this.stickX, dy = y - this.stickY;
    const len = Math.hypot(dx, dy);
    if (len > STICK) {
      dx = (dx / len) * STICK;
      dy = (dy / len) * STICK;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone so a resting thumb does not creep.
    const k = len < 6 ? 0 : 1;
    this.input.axis.x = (dx / STICK) * k;
    this.input.axis.y = (-dy / STICK) * k;
    this.input.axis.run = len >= STICK * 0.98;
  }

  private releaseStick(): void {
    this.stickId = null;
    this.base.hidden = true;
    this.knob.style.transform = "";
    this.input.axis.x = this.input.axis.y = 0;
    this.input.axis.run = false;
  }
}

function div(id: string, html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  el.innerHTML = html;
  return el;
}

const gear =
  '<svg viewBox="0 0 24 24" aria-label="Settings"><path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.9 2.3-1.9-.3a7 7 0 0 0-.7-1.7l1.1-1.6-1.6-1.6-1.6 1.1a7 7 0 0 0-1.7-.7L14.2 4h-2.4l-.3 1.9a7 7 0 0 0-1.7.7L8.2 5.5 6.6 7.1l1.1 1.6a7 7 0 0 0-.7 1.7l-1.9.3v2.4l1.9.3c.2.6.4 1.2.7 1.7l-1.1 1.6 1.6 1.6 1.6-1.1c.5.3 1.1.5 1.7.7l.3 1.9h2.4l.3-1.9c.6-.2 1.2-.4 1.7-.7l1.6 1.1 1.6-1.6-1.1-1.6c.3-.5.5-1.1.7-1.7l1.9-.3Z"/></svg>';
