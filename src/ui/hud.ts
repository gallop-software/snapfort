import "./style.css";

export interface HotbarItem {
  id: string;
  label: string;
  key: string;
}

export interface HudActions {
  selectTool(index: number): void;
  play(mode: "siege" | "free"): void;
  resume(): void;
  /** Clears the build (after asking) and starts again. */
  startOver(): void;
  menu(): void;
  /** The mouse speed slider moved. */
  setMouseSpeed(speed: number): void;
}

export interface CapturedStats {
  seconds: number;
  waves: number;
  placed: number;
}

const ICONS: Record<string, string> = {
  wall: '<rect x="5" y="8" width="30" height="24" rx="2"/><path d="M5 20h30M20 8v12M12 20v12M28 20v12"/>',
  floor: '<path d="M20 12 36 20 20 28 4 20Z"/><path d="M12 16l16 8M28 16 12 24"/>',
  ramp: '<path d="M5 32h30V10Z"/><path d="M15 32v-7M25 32V17"/>',
  roof: '<path d="M20 6 36 32H4Z"/><path d="M20 6v26"/>',
  remove: '<path d="M10 12h20l-2 22H12Z"/><path d="M7 12h26M16 12V7h8v5M17 18v10M23 18v10"/>',
};

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type View = "menu" | "paused" | "captured";

/** The plain HTML overlay: hotbar, crosshair, readouts, messages and the menu panel. */
export class Hud {
  private readonly slots: HTMLElement[] = [];
  private readonly stats = el("stats");
  private readonly count = el("count");
  private readonly siege = el("siege");
  private readonly bannerEl = el("banner");
  private readonly toastEl = el("toast");
  private readonly overlay = el("overlay");
  private readonly views: Record<View, HTMLElement> = {
    menu: el("view-menu"),
    paused: el("view-paused"),
    captured: el("view-captured"),
  };
  private toastTimer = 0;
  private bannerTimer = 0;

  constructor(items: readonly HotbarItem[], actions: HudActions) {
    const bar = el("hotbar");
    items.forEach((item, index) => {
      const slot = document.createElement("button");
      slot.className = "slot";
      slot.type = "button";
      slot.innerHTML =
        `<span class="key">${item.key}</span>` +
        `<svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[item.id] ?? ""}</svg>` +
        `<span class="label">${item.label}</span>`;
      slot.addEventListener("click", () => actions.selectTool(index));
      bar.appendChild(slot);
      this.slots.push(slot);
    });
    el("play-siege").addEventListener("click", () => actions.play("siege"));
    el("play-free").addEventListener("click", () => actions.play("free"));
    el("retry").addEventListener("click", () => actions.play("siege"));
    el("resume").addEventListener("click", () => actions.resume());
    el("start-over").addEventListener("click", () => actions.startOver());
    el("captured-menu").addEventListener("click", () => actions.menu());
    const slider = el<HTMLInputElement>("mouse-speed");
    slider.addEventListener("input", () => {
      const speed = Number(slider.value);
      el("mouse-speed-value").textContent = `${speed.toFixed(2)}×`;
      actions.setMouseSpeed(speed);
    });
    if (!import.meta.env.DEV) this.stats.hidden = true;
  }

  ready(): void {
    document.body.classList.add("ready");
    const free = el<HTMLButtonElement>("play-free");
    free.disabled = false;
    free.textContent = "Start building";
    el<HTMLButtonElement>("play-siege").disabled = false;
  }

  /** Shows the material new pieces are made of. `color` is RGB 0..1. */
  setMaterial(label: string, color: readonly [number, number, number], key: string): void {
    const css = `rgb(${color.map((c) => Math.round(c * 255)).join(", ")})`;
    el("material").innerHTML = `<span class="swatch" style="background:${css}"></span>${label}<kbd>${key}</kbd>`;
  }

  setEditing(editing: boolean): void {
    el("edit-hint").hidden = !editing;
  }

  select(index: number): void {
    this.slots.forEach((slot, i) => slot.classList.toggle("selected", i === index));
  }

  /** Puts the mouse speed slider at a saved value. */
  showMouseSpeed(speed: number): void {
    el<HTMLInputElement>("mouse-speed").value = String(speed);
    el("mouse-speed-value").textContent = `${speed.toFixed(2)}×`;
  }

  /**
   * Hides the panel while playing, or shows one of its views. "away" (the
   * player switched to another window) shows no panel, only a small note that
   * a click picks up where they left off.
   */
  show(view: View | "playing" | "away"): void {
    const playing = view === "playing";
    const away = view === "away";
    el("settings").hidden = view === "captured";
    el("resume-hint").hidden = !away;
    document.body.classList.toggle("playing", playing);
    this.overlay.hidden = playing || away;
    for (const [name, node] of Object.entries(this.views)) node.hidden = name !== view;
  }

  showCaptured(stats: CapturedStats): void {
    el("captured-stats").innerHTML =
      `<div><b>${clock(stats.seconds)}</b>held out</div>` +
      `<div><b>${stats.waves}</b>${stats.waves === 1 ? "wave" : "waves"}</div>` +
      `<div><b>${stats.placed}</b>pieces placed</div>`;
    this.show("captured");
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  setCount(pieces: number): void {
    this.count.textContent = `${pieces} ${pieces === 1 ? "piece" : "pieces"}`;
  }

  /** The siege readout at the top; null hides it. `urgent` turns it red. */
  setSiege(text: string | null, urgent = false): void {
    this.siege.hidden = text === null;
    if (text !== null && this.siege.textContent !== text) this.siege.textContent = text;
    this.siege.classList.toggle("soon", urgent);
  }

  banner(message: string): void {
    this.bannerEl.textContent = message;
    this.bannerEl.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), 2600);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 1100);
  }
}
