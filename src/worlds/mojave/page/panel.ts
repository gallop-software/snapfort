import { CELL } from "../../../game/constants";
import { SIGHT_GRID } from "../sim";
import { HALF_CELLS } from "../world";

/**
 * Mojave's own things on the screen, over the game: the map, notes from the
 * war, and on phones the bank, a line of what is selected and the thumbs'
 * buttons. (On a computer the bank is beside the row of tiles, and what is
 * selected is said above it: the shared page shows both.) Plain HTML made
 * here: the shared page knows nothing of it.
 */

const CSS = `
#mj { position: absolute; inset: 0; pointer-events: none; font-weight: 700; color: #fff8ea; }
body:not(.playing):not(.away) #mj { display: none; }
body.scoped #mj-map { display: none; }
#mj-bank { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: none; gap: 9px; align-items: center; padding: 3px 10px; border-radius: 999px; background: rgba(24, 30, 38, 0.82); font-size: 11px; white-space: nowrap; }
#mj-bank[hidden], #mj-status[hidden] { display: none !important; }
.mj-bank b { font-weight: 900; font-variant-numeric: tabular-nums; }
.mj-bank .li b { color: #8fe8e0; }
.mj-bank .pl b { color: #c9a2ff; }
.mj-bank .su.low b { color: #ff9c8a; }
.mj-bank .up { opacity: 0.75; font-size: 12px; }
.mj-bank i { font-style: normal; opacity: 0.7; font-weight: 600; margin-right: 5px; }
#mj-status { position: absolute; display: none; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 10px; background: rgba(24, 30, 38, 0.82); font-size: 11px; white-space: nowrap; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; }
#mj-map { position: absolute; right: 12px; top: 54px; width: 172px; height: 172px; border-radius: 10px; background: #000; box-shadow: 0 0 0 2px rgba(255, 248, 234, 0.35); }
#mj.big #mj-map { right: auto; top: 50%; left: 50%; width: min(76vh, 76vw); height: min(76vh, 76vw); transform: translate(-50%, -50%); box-shadow: 0 0 0 3px #fff8ea, 0 0 0 100vmax rgba(0, 0, 0, 0.45); }
#mj-maphint { position: absolute; left: 50%; bottom: calc(50% + min(38vh, 38vw) + 10px); transform: translateX(-50%); font-size: 13px; padding: 5px 12px; border-radius: 10px; background: rgba(24, 30, 38, 0.85); white-space: nowrap; }
#mj:not(.big) #mj-maphint { display: none; }
#mj-notes { position: absolute; left: 12px; top: 52px; display: grid; gap: 5px; justify-items: start; }
#mj-notes div { padding: 6px 12px; border-radius: 10px; background: rgba(24, 30, 38, 0.82); font-size: 13px; animation: mj-note 7s forwards; }
#mj-notes div.attack { background: rgba(196, 52, 44, 0.9); }
#mj-notes div.ready { background: rgba(34, 120, 84, 0.9); }
@keyframes mj-note { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
/* Phones: the row is along the top, the thumbs' buttons down both sides. The bank goes under the row, what is selected under that, the map above Place. */
body.touch #mj-bank { display: flex; top: calc(env(safe-area-inset-top, 0px) + 74px); }
body.touch .mj-bank .up { display: none; }
body.touch #mj-status { display: block; top: calc(env(safe-area-inset-top, 0px) + 97px); }
body.touch #mj-map { width: min(84px, calc(100vh - 256px)); height: min(84px, calc(100vh - 256px)); top: 84px; bottom: auto; right: calc(env(safe-area-inset-right, 0px) + 12px); }
body.touch #mj.big #mj-map { top: 50%; right: auto; width: min(80vh, 60vw); height: min(80vh, 60vw); }
body.touch #mj-maphint { display: none; }
@media (max-height: 330px) {
  #mj-touch button { height: 34px; }
}
/* (Notes: beside the left thumb's buttons, in the middle of the screen's height, clear of the buttons along the bottom.) */
body.touch #mj-notes { top: 42%; left: calc(env(safe-area-inset-left, 0px) + 112px); max-width: 30vw; }
body.touch #mj-notes div { font-size: 11px; padding: 4px 10px; }
#mj-touch { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 156px); bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); display: none; gap: 5px; }
body.touch #mj-touch { display: grid; grid-template-columns: repeat(3, 1fr); }
body.touch.scoped #mj-touch { display: none; }
#mj-touch button { all: unset; box-sizing: border-box; width: 58px; height: 38px; border-radius: 12px; background: rgba(24, 30, 38, 0.72); color: #fff8ea; font-size: 12px; font-weight: 800; text-align: center; pointer-events: auto; }
#mj-touch button.main { background: rgba(255, 179, 71, 0.92); color: #1f2a37; }
#mj-touch button.wide { grid-column: span 1; }
`;

export interface MapDot {
  x: number;
  z: number;
  color: string;
  /** Side of the square drawn, in map pixels at the small size. */
  size: number;
  /** A report, not a sighting: how much of it is left (1 just seen, fading with age). Drawn as an outline. */
  report?: number;
}

const HALF = HALF_CELLS * CELL;

export class Panel {
  /** One of the phone's own buttons was tapped ("t-select", "t-order", "t-army", "t-menu", "t-map"). */
  onButton: (id: string) => void = () => {};
  /** Where the bank goes on a computer: beside the row (the shared page's badge). */
  badge: (html: string | null) => void = () => {};

  private readonly root: HTMLDivElement;
  private readonly bank: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly notes: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private readonly fogImage: ImageData;
  private bankHtml = "\u0000";
  big = false;

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mj";
    this.root.innerHTML =
      `<div id="mj-bank" class="mj-bank" hidden></div><div id="mj-status" hidden></div><div id="mj-notes"></div><canvas id="mj-map" width="344" height="344"></canvas>` +
      `<div id="mj-maphint">Move the mouse · <b>right click</b> sends the selected there · <b>click</b> turns you to face it · <b>Tab</b> closes</div>` +
      `<div id="mj-touch"><button data-id="t-army">Army</button><button data-id="t-menu">Build</button><button data-id="t-map">Map</button><button data-id="t-select" class="main">Select</button><button data-id="t-order" class="main">Order</button></div>`;
    (document.getElementById("hud") ?? document.body).appendChild(this.root);
    this.bank = this.root.querySelector("#mj-bank")!;
    this.status = this.root.querySelector("#mj-status")!;
    this.notes = this.root.querySelector("#mj-notes")!;
    this.map = this.root.querySelector("#mj-map")!;
    this.fog = document.createElement("canvas");
    this.fog.width = this.fog.height = SIGHT_GRID;
    this.fogImage = new ImageData(SIGHT_GRID, SIGHT_GRID);
    // Taps (phones; on a computer the mouse is the game's while playing).
    this.root.addEventListener("pointerdown", (e) => {
      const button = (e.target as HTMLElement).closest("button");
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      const id = (button as HTMLElement).dataset.id;
      if (id) this.onButton(id);
    });
  }

  /** The bank: beside the row on a computer, under it on a phone. Null: none (not a general). */
  setBank(bank: { lithium: number; plasma: number; used: number; max: number; upkeep: number } | null): void {
    const html = bank
      ? `<span class="li"><i>Lithium</i><b>${bank.lithium}</b></span><span class="pl"><i>Plasma</i><b>${bank.plasma}</b></span>` +
        `<span class="su${bank.used >= bank.max ? " low" : ""}"><i>Supply</i><b>${bank.used} / ${bank.max}</b></span>` +
        (bank.upkeep < 1 ? `<span class="up">income ×${bank.upkeep}</span>` : "")
      : "";
    if (html === this.bankHtml) return;
    this.bankHtml = html;
    this.bank.hidden = !bank;
    this.bank.innerHTML = html;
    this.badge(bank ? `<span class="mj-bank" id="mj-bank-row" style="display:flex;gap:14px;align-items:center">${html}</span>` : null);
  }

  /** A line of what is selected or being done, on phones (a computer has it above the row). Null: none. */
  setStatus(text: string | null): void {
    this.status.hidden = !text;
    if (text && this.status.textContent !== text) this.status.textContent = text;
  }

  /** What the phone's two main buttons say now ("Select" and "Order", or "Place" and "Cancel"). */
  setTouch(select: string, order: string): void {
    const a = this.root.querySelector<HTMLElement>('[data-id="t-select"]')!, b = this.root.querySelector<HTMLElement>('[data-id="t-order"]')!;
    if (a.textContent !== select) a.textContent = select;
    if (b.textContent !== order) b.textContent = order;
  }

  /** A note from the war: it shows for a few seconds. */
  note(text: string, kind: "attack" | "ready" | "info"): void {
    const line = document.createElement("div");
    line.className = kind;
    line.textContent = text;
    this.notes.appendChild(line);
    while (this.notes.children.length > 4) this.notes.firstElementChild!.remove();
    setTimeout(() => line.remove(), 7000);
  }

  /** The map at the size of most of the screen, with a pointer on it (or back to the corner). */
  setBig(on: boolean): void {
    this.big = on;
    this.root.classList.toggle("big", on);
  }

  /**
   * Draws the map: the land (all of it, always: brighter where this general
   * sees now), then fields, buildings and units as dots, reports of what was
   * last seen as fading outlines, pings, this player (an arrow the way they
   * face), and the pointer when the map is big.
   */
  drawMap(view: {
    visible: Uint8Array | null;
    dots: readonly MapDot[];
    me: { x: number; z: number; yaw: number } | null;
    pings: readonly { x: number; z: number; age: number; color: string }[];
    cursor: { x: number; z: number } | null;
  }): void {
    const ctx = this.map.getContext("2d");
    if (!ctx) return;
    const S = this.map.width;
    const N = SIGHT_GRID;
    const data = this.fogImage.data;
    for (let gx = 0; gx < N; gx++) {
      for (let gz = 0; gz < N; gz++) {
        const i = gx * N + gz, o = ((N - 1 - gz) * N + gx) * 4;
        // Sand: bright where it is in sight now, a little shaded everywhere else.
        const k = view.visible && !view.visible[i] ? 0.78 : 1;
        data[o] = 205 * k;
        data[o + 1] = 190 * k;
        data[o + 2] = 160 * k;
        data[o + 3] = 255;
      }
    }
    this.fog.getContext("2d")!.putImageData(this.fogImage, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, S, S);
    const px = (x: number) => ((x + HALF) / (HALF * 2)) * S, pz = (z: number) => (1 - (z + HALF) / (HALF * 2)) * S;
    const scale = S / 172;
    for (const d of view.dots) {
      const s = Math.max(2, d.size * scale);
      if (d.report === undefined) {
        ctx.fillStyle = d.color;
        ctx.fillRect(px(d.x) - s / 2, pz(d.z) - s / 2, s, s);
        continue;
      }
      // A report: an outline with a faint fill, fainter the older it is.
      ctx.globalAlpha = 0.25 + 0.6 * d.report;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeRect(px(d.x) - s / 2, pz(d.z) - s / 2, s, s);
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = d.color;
      ctx.fillRect(px(d.x) - s / 2, pz(d.z) - s / 2, s, s);
      ctx.globalAlpha = 1;
    }
    for (const p of view.pings) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 * scale;
      ctx.globalAlpha = Math.max(0, 1 - p.age);
      ctx.beginPath();
      ctx.arc(px(p.x), pz(p.z), (4 + p.age * 14) * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (view.me) {
      ctx.save();
      ctx.translate(px(view.me.x), pz(view.me.z));
      ctx.rotate(view.me.yaw);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#1f2a37";
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(0, -7 * scale);
      ctx.lineTo(5 * scale, 6 * scale);
      ctx.lineTo(0, 3 * scale);
      ctx.lineTo(-5 * scale, 6 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (view.cursor) {
      const x = px(view.cursor.x), z = pz(view.cursor.z);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 9, z);
      ctx.lineTo(x + 9, z);
      ctx.moveTo(x, z - 9);
      ctx.lineTo(x, z + 9);
      ctx.stroke();
    }
  }

  /** How far the map's pointer moves for a pixel of mouse, in metres (the big map is this many pixels across). */
  metresPerPixel(): number {
    return (HALF * 2) / Math.max(200, this.map.getBoundingClientRect().width);
  }
}
