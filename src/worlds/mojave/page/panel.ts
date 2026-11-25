import { CELL } from "../../../game/constants";
import { SIGHT_GRID } from "../sim";
import { HALF_CELLS } from "../world";

/**
 * Mojave's own things on the screen, over the game: the bank (lithium, plasma,
 * supply), the command card (what is selected and what it can be told, each
 * with its key), the map, and notes from the war. Plain HTML made here: the
 * shared page knows nothing of it.
 */

const CSS = `
#mj { position: absolute; inset: 0; pointer-events: none; font-weight: 700; color: #fff8ea; }
body:not(.playing):not(.away) #mj { display: none; }
body.scoped #mj-card, body.scoped #mj-map { display: none; }
#mj-bank { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: center; padding: 7px 16px; border-radius: 999px; background: rgba(24, 30, 38, 0.82); font-size: 14px; white-space: nowrap; }
#mj-bank b { font-weight: 900; font-variant-numeric: tabular-nums; }
#mj-bank .li b { color: #8fe8e0; }
#mj-bank .pl b { color: #c9a2ff; }
#mj-bank .su.low b { color: #ff9c8a; }
#mj-bank .up { opacity: 0.75; font-size: 12px; }
#mj-bank i { font-style: normal; opacity: 0.7; font-weight: 600; margin-right: 5px; }
#mj-watch { position: absolute; top: 54px; left: 50%; transform: translateX(-50%); padding: 6px 14px; border-radius: 12px; background: rgba(24, 30, 38, 0.82); font-size: 13px; text-align: center; max-width: 80vw; }
#mj-watch[hidden], #mj-card[hidden], #mj-bank[hidden] { display: none; }
#mj-map { position: absolute; right: 12px; top: 54px; width: 172px; height: 172px; border-radius: 10px; background: #000; box-shadow: 0 0 0 2px rgba(255, 248, 234, 0.35); image-rendering: pixelated; }
#mj.big #mj-map { right: auto; top: 50%; left: 50%; width: min(76vh, 76vw); height: min(76vh, 76vw); transform: translate(-50%, -50%); box-shadow: 0 0 0 3px #fff8ea, 0 0 0 100vmax rgba(0, 0, 0, 0.45); }
#mj-maphint { position: absolute; left: 50%; bottom: calc(50% - min(38vh, 38vw) - 34px); transform: translateX(-50%); font-size: 13px; padding: 5px 12px; border-radius: 10px; background: rgba(24, 30, 38, 0.85); white-space: nowrap; }
#mj:not(.big) #mj-maphint { display: none; }
#mj-card { position: absolute; left: 12px; bottom: 62px; width: 318px; padding: 10px 12px 12px; border-radius: 14px; background: rgba(24, 30, 38, 0.84); font-size: 13px; }
#mj-card h4 { margin: 0 0 2px; font-size: 14px; font-weight: 900; }
#mj-card p { margin: 0 0 8px; font-weight: 600; opacity: 0.85; font-size: 12px; line-height: 1.35; }
#mj-card .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#mj-card button { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; min-height: 40px; padding: 5px 7px; border-radius: 9px; background: rgba(255, 248, 234, 0.1); font-size: 12px; line-height: 1.2; pointer-events: auto; cursor: pointer; }
#mj-card button b { display: flex; justify-content: space-between; gap: 4px; font-weight: 800; }
#mj-card button kbd { padding: 0 5px; border-radius: 5px; background: #fff8ea; color: #1f2a37; font: inherit; font-size: 11px; font-weight: 900; }
#mj-card button small { font-weight: 600; opacity: 0.75; font-size: 11px; }
#mj-card button.off { opacity: 0.4; }
#mj-card button.on { background: #ffb347; color: #1f2a37; }
#mj-card button.on kbd { background: #1f2a37; color: #fff8ea; }
#mj-notes { position: absolute; left: 12px; top: 52px; display: grid; gap: 5px; justify-items: start; }
#mj-notes div { padding: 6px 12px; border-radius: 10px; background: rgba(24, 30, 38, 0.82); font-size: 13px; animation: mj-note 7s forwards; }
#mj-notes div.attack { background: rgba(196, 52, 44, 0.9); }
#mj-notes div.ready { background: rgba(34, 120, 84, 0.9); }
@keyframes mj-note { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
/* Phones: the hotbar is along the top, the thumbs' buttons down both sides. The bank goes under the hotbar, the card under that, the map above Place. */
body.touch #mj-bank { top: calc(env(safe-area-inset-top, 0px) + 74px); font-size: 11px; padding: 3px 10px; gap: 9px; }
body.touch #mj-bank .up { display: none; }
body.touch #mj-map { width: min(84px, calc(100vh - 256px)); height: min(84px, calc(100vh - 256px)); top: 84px; bottom: auto; right: calc(env(safe-area-inset-right, 0px) + 12px); }
body.touch #mj.big #mj-map { top: 50%; right: auto; width: min(80vh, 60vw); height: min(80vh, 60vw); }
body.touch #mj-maphint { display: none; }
body.touch #mj-card { left: calc(env(safe-area-inset-left, 0px) + 112px); right: calc(env(safe-area-inset-right, 0px) + 160px); top: 98px; bottom: auto; width: auto; transform: none; padding: 5px 6px 6px; }
body.touch #mj-card h4 { font-size: 11px; margin: 0 0 3px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body.touch #mj-card p { display: none; }
body.touch #mj-card .keys { grid-template-columns: repeat(5, 1fr); gap: 4px; }
body.touch #mj-card button { min-height: 30px; padding: 2px 4px; font-size: 10px; line-height: 1.1; justify-content: center; }
body.touch #mj-card button b { justify-content: center; text-align: center; }
body.touch #mj-card button kbd, body.touch #mj-card button small { display: none; }
@media (max-height: 330px) {
  body.touch #mj-card { top: 96px; padding: 4px 5px; }
  body.touch #mj-card h4 { display: none; }
  body.touch #mj-card .keys { gap: 3px; }
  body.touch #mj-card button { min-height: 26px; font-size: 9.5px; }
  #mj-touch button { height: 34px; }
}
body.touch #mj-notes { top: auto; bottom: 8px; left: 50%; transform: translateX(-50%); justify-items: center; }
body.touch #mj-notes div { font-size: 11px; padding: 4px 10px; }
body.touch #mj-watch { top: 100px; font-size: 11px; }
#mj-touch { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 156px); bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); display: none; gap: 5px; }
body.touch #mj-touch { display: grid; grid-template-columns: repeat(3, 1fr); }
body.touch.scoped #mj-touch { display: none; }
#mj-touch button { all: unset; box-sizing: border-box; width: 58px; height: 38px; border-radius: 12px; background: rgba(24, 30, 38, 0.72); color: #fff8ea; font-size: 12px; font-weight: 800; text-align: center; pointer-events: auto; }
#mj-touch button.main { background: rgba(255, 179, 71, 0.92); color: #1f2a37; }
`;

export interface CardButton {
  /** What pressing it does: handed back to whoever listens. */
  id: string;
  /** The key that does the same, as shown ("F"). */
  key: string;
  label: string;
  /** A second line: what it costs, say. */
  sub?: string;
  off?: boolean;
  on?: boolean;
}

export interface MapDot {
  x: number;
  z: number;
  color: string;
  /** Side of the square drawn, in map pixels at the small size. */
  size: number;
}

const HALF = HALF_CELLS * CELL;
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class Panel {
  /** A card button was tapped (phones), or one of the phone's own buttons ("t-select", "t-order", "t-army", "t-map"). */
  onButton: (id: string) => void = () => {};

  private readonly root: HTMLDivElement;
  private readonly bank: HTMLDivElement;
  private readonly watch: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly notes: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private readonly fogImage: ImageData;
  private cardHtml = "";
  private bankHtml = "";
  big = false;

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "mj";
    this.root.innerHTML =
      `<div id="mj-bank" hidden></div><div id="mj-watch" hidden></div><div id="mj-notes"></div><canvas id="mj-map" width="344" height="344"></canvas>` +
      `<div id="mj-maphint">Move the mouse · <b>right click</b> sends the selected there · <b>click</b> turns you to face it · <b>Tab</b> closes</div>` +
      `<div id="mj-card" hidden></div>` +
      `<div id="mj-touch"><button data-id="t-army">Army</button><button data-id="t-menu">Build</button><button data-id="t-map">Map</button><button data-id="t-gens">Allies</button><button data-id="t-select" class="main">Select</button><button data-id="t-order" class="main">Order</button></div>`;
    (document.getElementById("hud") ?? document.body).appendChild(this.root);
    this.bank = this.root.querySelector("#mj-bank")!;
    this.watch = this.root.querySelector("#mj-watch")!;
    this.card = this.root.querySelector("#mj-card")!;
    this.notes = this.root.querySelector("#mj-notes")!;
    this.map = this.root.querySelector("#mj-map")!;
    this.fog = document.createElement("canvas");
    this.fog.width = this.fog.height = SIGHT_GRID;
    this.fogImage = new ImageData(SIGHT_GRID, SIGHT_GRID);
    // Taps (phones; on a computer the mouse is the game's while playing).
    this.root.addEventListener("pointerdown", (e) => {
      const button = (e.target as HTMLElement).closest("button");
      if (!button || button.classList.contains("off")) return;
      e.preventDefault();
      e.stopPropagation();
      const id = (button as HTMLElement).dataset.id;
      if (id) this.onButton(id);
    });
  }

  /** The bank along the top, or nothing (watching). */
  setBank(bank: { lithium: number; plasma: number; used: number; max: number; upkeep: number } | null): void {
    const html = bank
      ? `<span class="li"><i>Lithium</i><b>${bank.lithium}</b></span><span class="pl"><i>Plasma</i><b>${bank.plasma}</b></span>` +
        `<span class="su${bank.used >= bank.max ? " low" : ""}"><i>Supply</i><b>${bank.used} / ${bank.max}</b></span>` +
        (bank.upkeep < 1 ? `<span class="up">upkeep: income ×${bank.upkeep}</span>` : "")
      : "";
    if (html === this.bankHtml) return;
    this.bankHtml = html;
    this.bank.hidden = !bank;
    this.bank.innerHTML = html;
  }

  /** A line for someone who is watching, not commanding (or null). */
  setWatching(text: string | null): void {
    this.watch.hidden = !text;
    if (text && this.watch.textContent !== text) this.watch.textContent = text;
  }

  /** The command card: a title, a line under it, and its buttons. Null takes it away. */
  setCard(card: { title: string; text?: string; buttons: readonly CardButton[] } | null): void {
    const html = card
      ? `<h4>${escape(card.title)}</h4>${card.text ? `<p>${escape(card.text)}</p>` : ""}<div class="keys">` +
        card.buttons
          .map((b) => `<button data-id="${escape(b.id)}" class="${b.off ? "off" : ""}${b.on ? " on" : ""}"><b>${escape(b.label)}<kbd>${escape(b.key)}</kbd></b>${b.sub ? `<small>${escape(b.sub)}</small>` : ""}</button>`)
          .join("") +
        `</div>`
      : "";
    if (html === this.cardHtml) return;
    this.cardHtml = html;
    this.card.hidden = !card;
    this.card.innerHTML = html;
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
   * Draws the map: the dark, then fields, buildings and units as dots, pings,
   * this player (an arrow the way they face), and the pointer when the map is big.
   */
  drawMap(view: {
    visible: Uint8Array | null;
    explored: Uint8Array | null;
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
        const seen = view.visible ? view.visible[i]! : 1, known = view.explored ? view.explored[i]! : 1;
        // Sand where it is in sight, dimmed where it was seen before, black where it never was.
        const k = seen ? 1 : known ? 0.45 : 0;
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
      ctx.fillStyle = d.color;
      const s = Math.max(2, d.size * scale);
      ctx.fillRect(px(d.x) - s / 2, pz(d.z) - s / 2, s, s);
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
