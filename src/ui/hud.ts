import type { Identity } from "../identity";
import type { GraphicsMode } from "../render/graphics";
import type { NetStatus } from "../net/client";
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
  menu(): void;
  /** The mouse speed slider moved. */
  setMouseSpeed(speed: number): void;
  /** Sound was muted or unmuted on the menu. */
  setMuted(muted: boolean): void;
  /** The graphics setting was changed on the menu. */
  setGraphics(mode: GraphicsMode): void;
  /** The name or colour was changed on the menu. */
  setIdentity(identity: Identity): void;
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
  trebuchet: '<path d="M6 33h28M10 33l6-14M24 33l-6-14M17 19 31 7M17 19l-6 5"/><circle cx="10" cy="26" r="3"/><circle cx="31" cy="7" r="2"/>',
  remove: '<path d="M10 12h20l-2 22H12Z"/><path d="M7 12h26M16 12V7h8v5M17 18v10M23 18v10"/>',
};

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The frame-rate readout shows in development, or anywhere with ?stats in the address. */
export function showStats(): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).has("stats");
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type View = "menu" | "paused" | "captured";

/** The plain HTML overlay: hotbar, crosshair, readouts, messages and the menu panel. */
export class Hud {
  private readonly slots: HTMLElement[] = [];
  private readonly stats = el("stats");
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
    // A click beside the settings panel (on the dimmed world) also goes back to building.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && this.view === "paused") actions.resume();
    });
    el("captured-menu").addEventListener("click", () => actions.menu());
    const slider = el<HTMLInputElement>("mouse-speed");
    slider.addEventListener("input", () => {
      const speed = Number(slider.value);
      el("mouse-speed-value").textContent = `${speed.toFixed(2)}×`;
      actions.setMouseSpeed(speed);
    });
    if (!showStats()) this.stats.hidden = true;
    this.actions = actions;
    const name = el<HTMLInputElement>("player-name");
    name.addEventListener("change", () => this.changeIdentity());
    // Typing a name must not steer the builder or pick tools.
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") name.blur();
    });
  }

  private readonly actions: HudActions;
  /** What the overlay shows right now. */
  view: View | "playing" | "away" = "menu";
  private identity: Identity = { name: "", color: "" };

  /** Shows the player's name and colour on the menu, with the colours to choose from. */
  showIdentity(identity: Identity, colors: readonly string[]): void {
    this.identity = { ...identity };
    el<HTMLInputElement>("player-name").value = identity.name;
    const box = el("player-colors");
    box.replaceChildren(
      ...colors.map((color) => {
        const button = document.createElement("button");
        button.type = "button";
        button.style.background = color;
        button.title = color;
        button.dataset.color = color;
        button.classList.toggle("selected", color === identity.color);
        button.addEventListener("click", () => {
          this.identity.color = color;
          for (const b of box.children) b.classList.toggle("selected", b === button);
          this.changeIdentity();
        });
        return button;
      }),
    );
  }

  private changeIdentity(): void {
    const input = el<HTMLInputElement>("player-name");
    const name = input.value.trim();
    if (name) this.identity.name = name;
    input.value = this.identity.name;
    this.actions.setIdentity({ ...this.identity });
  }

  showMuted(muted: boolean): void {
    const box = el<HTMLInputElement>("mute");
    box.checked = muted;
    box.onchange = () => this.actions.setMuted(box.checked);
  }

  /** Fills the graphics setting. `auto` says what Auto picked on this computer. */
  showGraphics(mode: GraphicsMode, auto: Exclude<GraphicsMode, "auto">): void {
    const select = el<HTMLSelectElement>("graphics");
    const label: Record<GraphicsMode, string> = {
      auto: `Auto (${auto === "saver" ? "battery saver" : "sharp"} here)`,
      sharp: "Sharp: 60 fps, shadows",
      saver: "Battery saver: cool and quiet",
    };
    select.replaceChildren(
      ...(Object.keys(label) as GraphicsMode[]).map((m) => {
        const option = document.createElement("option");
        option.value = m;
        option.textContent = label[m];
        return option;
      }),
    );
    select.value = mode;
    select.onchange = () => this.actions.setGraphics(select.value as GraphicsMode);
    select.onkeydown = (e) => e.stopPropagation();
  }

  /** How many builders are in the world, this player included; null hides it. */
  setOnline(count: number | null): void {
    const node = el("online");
    node.hidden = count === null;
    if (count !== null) node.textContent = `${count} ${count === 1 ? "builder" : "builders"} online`;
  }

  /** The tallest towers: [height m, ...] tallest first; empty hides the board. */
  setTowers(heights: readonly number[]): void {
    const node = el("towers");
    node.hidden = heights.length === 0;
    const colors = ["#f2b134", "#c9d2dc", "#d48a52", "#8fa3b8", "#8fa3b8"];
    node.innerHTML = `<b>Tallest towers</b>` + heights.map((h, i) => `<div><i style="background:${colors[i]}"></i>${Math.round(h)} m</div>`).join("");
  }

  /** The trebuchet panel: a status line and the controls; null hides it. */
  setCrew(status: { text: string; ok: boolean } | null): void {
    const node = el("crew");
    node.hidden = status === null;
    if (!status) return;
    const html =
      `<div class="status ${status.ok ? "ok" : "bad"}">${status.text}</div>` +
      `<kbd>Right click</kbd> set target · <kbd>Click</kbd> fire · <kbd>H</kbd> get off`;
    if (node.innerHTML !== html) node.innerHTML = html;
  }

  /** A short hint under the crosshair (HTML); null hides it. */
  setHint(html: string | null): void {
    const node = el("hint");
    node.hidden = html === null;
    if (html !== null && node.innerHTML !== html) node.innerHTML = html;
  }

  /** Shows connection trouble at the top of the screen. */
  setNetStatus(status: NetStatus): void {
    const node = el("net");
    const text: Partial<Record<NetStatus, string>> = {
      offline: "Reconnecting… changes made now may be lost",
      full: "The world is full. Waiting for a spot…",
      outdated: "SnapFort was updated. Reload the page to keep building.",
    };
    node.hidden = !text[status];
    node.textContent = text[status] ?? "";
  }

  /** The game can start. `online` false: the world could not be reached yet (building works, but is not shared). */
  ready(online = true): void {
    document.body.classList.add("ready");
    const free = el<HTMLButtonElement>("play-free");
    free.disabled = false;
    free.textContent = online ? "Start building" : "Build offline for now";
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
    this.view = view;
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
