import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Scene } from "@babylonjs/core/scene";
import { CHAT_MAX, CHAT_SHOW_MS, FEED_LINES, type ChatTo } from "../net/chat";
import type { WireSaid } from "../net/protocol";

type Vec = [number, number, number];

/** Something said that is shown in the world: a bubble over a builder, or a pin on a spot. */
interface Marker {
  el: HTMLElement;
  by: string;
  /** The speaker's public id, when known (to hide them if they are blocked). */
  uid?: string;
  until: number;
  /** Where it is in the world now, or null while unknown (a builder not seen yet). */
  where: () => Vec | null;
  /** Pins show how far away they are. */
  distance: HTMLElement | null;
  /** Where it was put on screen this frame, when waiting at the edge (for tidying), else null. */
  edgeBox?: [number, number, number, number] | null;
}

/** How long before it goes that a bubble, pin or line starts to fade, ms. */
const FADE_MS = 800;
/** Most bubbles, and most pins, on screen at once (the oldest go first). */
const MOST_SHOWN = 8;
/** A bubble sits this far above a builder's body centre, m. */
const ABOVE_HEAD = 1.75;

/**
 * Chat on screen, with no list and nothing to scroll: what builders say shows
 * as a bubble over their head (at the screen's edge with an arrow when they are
 * off screen), pings and pinned messages as markers on the spot, and messages
 * to everyone as up to three lines at the top that fade away. One text line
 * (Enter, or the Chat button) says something, to builders nearby or to
 * everyone.
 */
export class ChatView {
  /** Says a message; returns why it cannot go yet (the line stays open), or null when sent. */
  onSend: (text: string, to: ChatTo) => string | null = () => null;
  onOpenChange: (open: boolean) => void = () => {};
  /** Esc in the chat line: the game opens its menu. */
  onEscape: () => void = () => {};

  private readonly layer: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly box: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly toButton: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly bubbles: Marker[] = [];
  private readonly pins: Marker[] = [];
  private readonly lines: { el: HTMLElement; until: number; by: string; uid?: string }[] = [];
  /** Who the line talks to: everyone at first, then whichever was picked last, for the rest of the visit. */
  private to: ChatTo = "all";
  private draft = "";
  private readonly screen = new Vector3();
  private readonly world = new Vector3();
  private readonly viewport = new Viewport(0, 0, 1, 1);

  constructor(
    private readonly scene: Scene,
    private readonly touch: boolean,
    /** Where builder `id` is (body centre), or null when unknown. */
    private readonly positionOf: (id: string) => Vec | null,
  ) {
    const hud = document.getElementById("hud")!;
    this.layer = el("div", "chat-layer");
    this.feed = el("div", "chat-feed");
    this.box = el("form", "chat-box") as HTMLFormElement;
    this.box.hidden = true;
    this.box.autocomplete = "off";
    this.toButton = el("button", "chat-to") as HTMLButtonElement;
    this.toButton.type = "button";
    this.input = el("input", "chat-input") as HTMLInputElement;
    Object.assign(this.input, { type: "text", maxLength: CHAT_MAX, spellcheck: false, enterKeyHint: "send" });
    this.input.setAttribute("autocapitalize", "sentences");
    this.input.setAttribute("aria-label", "Message");
    const sendButton = el("button", "chat-send") as HTMLButtonElement;
    sendButton.type = "submit";
    sendButton.textContent = "Send";
    const closeButton = el("button", "chat-close") as HTMLButtonElement;
    closeButton.type = "button";
    closeButton.textContent = "✕";
    closeButton.setAttribute("aria-label", "Close");
    this.note = el("div", "chat-note");
    this.box.append(this.toButton, this.input, sendButton, closeButton, this.note);
    hud.append(this.layer, this.feed, this.box);

    // Tapping the box's buttons must not take the focus (and the phone's keyboard) away from the line.
    for (const b of [this.toButton, sendButton, closeButton]) b.addEventListener("pointerdown", (e) => e.preventDefault());
    this.toButton.addEventListener("click", () => this.setTo(this.to === "near" ? "all" : "near"));
    closeButton.addEventListener("click", () => this.cancel());
    this.box.addEventListener("submit", (e) => {
      e.preventDefault();
      this.send();
    });
    this.input.addEventListener("keydown", (e) => {
      // The game's keys stay out of it while typing.
      e.stopPropagation();
      if (e.key === "Tab") {
        e.preventDefault();
        this.setTo(this.to === "near" ? "all" : "near");
      } else if (e.key === "Backspace" && this.input.value === "") {
        // Backspace on an empty line closes it, like Enter on an empty line.
        e.preventDefault();
        this.cancel();
      } else if (e.key === "Escape") {
        // Esc opens the menu, as everywhere in the game; what was typed waits for next time.
        e.preventDefault();
        this.close();
        this.onEscape();
      }
    });
    this.input.addEventListener("input", () => this.showNote(null));
    // Clicking the game, switching windows, or the phone's keyboard closing ends typing (what was typed is kept).
    this.input.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== this.input) this.close();
      }, 0);
    });
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  /** Opens the text line, to whoever it talked to last; a message typed and not sent is still there. */
  open(): void {
    if (this.isOpen) return;
    this.box.hidden = false;
    this.setTo(this.to);
    this.input.value = this.draft;
    this.showNote(null);
    document.body.classList.add("chatting");
    this.input.focus();
    this.onOpenChange(true);
  }

  /** Closes the text line, keeping what was typed for next time. */
  close(): void {
    if (!this.isOpen) return;
    this.draft = this.input.value;
    this.box.hidden = true;
    document.body.classList.remove("chatting");
    if (document.activeElement === this.input) this.input.blur();
    // A phone's keyboard can leave the page nudged up.
    if (scrollX || scrollY) scrollTo(0, 0);
    this.onOpenChange(false);
  }

  /** Puts a message back in the line (it could not go), to send again later. */
  restore(text: string, to: ChatTo): void {
    this.draft = text;
    if (this.isOpen) this.input.value = text;
    this.setTo(to);
  }

  /** Shows something said: nearby as a bubble over the speaker (and a pin), to everyone as a line at the top. */
  show(said: WireSaid, me: string, now: number): void {
    if (said.at) this.pin(said, now);
    if (!said.text) return;
    if (said.to === "all") this.line(said, now);
    else this.bubble(said, me, now);
  }

  /** Moves bubbles and pins to where their builders and spots are on screen, and lets old things go. */
  update(now: number, viewer: Vec): void {
    for (const list of [this.bubbles, this.pins]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]!;
        if (now >= m.until) {
          m.el.remove();
          list.splice(i, 1);
          continue;
        }
        m.el.classList.toggle("fading", m.until - now < FADE_MS);
        this.place(m, viewer);
      }
    }
    this.tidyEdges();
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i]!;
      if (now >= line.until) {
        line.el.remove();
        this.lines.splice(i, 1);
      } else line.el.classList.toggle("fading", line.until - now < FADE_MS);
    }
  }

  /** Takes away whatever is on screen from builders `blocked` says to hide (someone was just blocked). */
  hide(blocked: (by: string, uid: string | undefined) => boolean): void {
    for (const list of [this.bubbles, this.pins, this.lines]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]!;
        if (!blocked(m.by, m.uid)) continue;
        m.el.remove();
        list.splice(i, 1);
      }
    }
  }

  /** Clears everything shown (joining the world again). */
  clear(): void {
    for (const m of [...this.bubbles, ...this.pins, ...this.lines]) m.el.remove();
    this.bubbles.length = this.pins.length = this.lines.length = 0;
  }

  /** Off-screen bubbles and pins that would sit on top of each other at the edge: the newest shows, older ones wait. */
  private tidyEdges(): void {
    const shown: [number, number, number, number][] = [];
    const markers = [...this.bubbles, ...this.pins].sort((a, b) => b.until - a.until);
    for (const m of markers) {
      const box = m.edgeBox;
      if (!box) continue;
      if (shown.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3])) m.el.style.visibility = "hidden";
      else shown.push(box);
    }
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text) return this.cancel();
    const problem = this.onSend(text, this.to);
    if (problem) return this.showNote(problem);
    this.input.value = "";
    this.close();
  }

  /** Closes without sending, and forgets what was typed. */
  private cancel(): void {
    this.input.value = "";
    this.close();
  }

  private setTo(to: ChatTo): void {
    this.to = to;
    this.toButton.textContent = to === "near" ? "Nearby" : "Everyone";
    this.toButton.classList.toggle("all", to === "all");
    this.input.placeholder = to === "near" ? "Say something to builders nearby" : "Say something to everyone";
    this.showNote(null);
  }

  private showNote(problem: string | null): void {
    this.note.classList.toggle("bad", !!problem);
    this.note.hidden = !problem && this.touch;
    this.note.innerHTML = problem
      ? escape(problem)
      : `<kbd>Enter</kbd> send · <kbd>Enter</kbd> or <kbd>⌫</kbd> on empty closes · <kbd>Tab</kbd> ${this.to === "near" ? "everyone" : "nearby"} · <kbd>Esc</kbd> menu`;
  }

  private bubble(said: WireSaid, me: string, now: number): void {
    // One bubble per builder: a new message replaces the last.
    const old = this.bubbles.findIndex((b) => b.by === said.by);
    if (old >= 0) this.bubbles.splice(old, 1)[0]!.el.remove();
    const node = el("div", "");
    node.className = `chat-bubble${said.by === me ? " mine" : ""}`;
    node.innerHTML = `<i class="arrow"></i><div><b></b><span></span></div>`;
    const name = node.querySelector("b")!;
    name.textContent = said.name;
    name.style.color = readable(said.color);
    node.querySelector("span")!.textContent = said.text;
    this.layer.appendChild(node);
    const by = said.by;
    this.bubbles.push({
      el: node,
      by,
      ...(said.uid ? { uid: said.uid } : {}),
      until: now + CHAT_SHOW_MS,
      where: () => {
        const p = by === me ? this.mePosition : this.positionOf(by);
        return p ? [p[0], p[1] + ABOVE_HEAD, p[2]] : null;
      },
      distance: null,
    });
    if (this.bubbles.length > MOST_SHOWN) this.bubbles.shift()!.el.remove();
    this.place(this.bubbles[this.bubbles.length - 1]!, this.mePosition);
  }

  private pin(said: WireSaid, now: number): void {
    // One pin per builder, as in big shooters: a new ping moves it.
    const old = this.pins.findIndex((p) => p.by === said.by);
    if (old >= 0) this.pins.splice(old, 1)[0]!.el.remove();
    const node = el("div", "");
    node.className = "chat-pin";
    node.innerHTML = `<span class="tag"><i class="arrow"></i><b></b><em></em></span><i class="dot"></i>`;
    const name = node.querySelector("b")!;
    name.textContent = said.name;
    name.style.color = readable(said.color);
    node.style.setProperty("--who", said.color);
    this.layer.appendChild(node);
    const at = said.at!;
    this.pins.push({ el: node, by: said.by, ...(said.uid ? { uid: said.uid } : {}), until: now + CHAT_SHOW_MS, where: () => at, distance: node.querySelector("em") });
    if (this.pins.length > MOST_SHOWN) this.pins.shift()!.el.remove();
    this.place(this.pins[this.pins.length - 1]!, this.mePosition);
  }

  private line(said: WireSaid, now: number): void {
    const node = el("div", "");
    node.className = "chat-line";
    node.innerHTML = `<b></b><span></span>`;
    (node.firstChild as HTMLElement).textContent = said.name;
    (node.firstChild as HTMLElement).style.color = readable(said.color);
    node.lastChild!.textContent = said.text;
    this.feed.appendChild(node);
    this.lines.push({ el: node, until: now + CHAT_SHOW_MS, by: said.by, ...(said.uid ? { uid: said.uid } : {}) });
    while (this.lines.length > FEED_LINES) this.lines.shift()!.el.remove();
  }

  /** The viewer's own position, as last given to update(). */
  private mePosition: Vec = [0, 0, 0];

  /**
   * Puts a bubble or pin where its spot is on screen. Off screen (or behind the
   * camera) it waits at the edge, in the direction of the spot, with an arrow
   * pointing that way.
   */
  private place(m: Marker, viewer: Vec): void {
    this.mePosition = viewer;
    m.edgeBox = null;
    const where = m.where();
    if (!where) {
      m.el.style.visibility = "hidden";
      return;
    }
    m.el.style.visibility = "";
    if (m.distance) m.distance.textContent = `${Math.round(dist(where, viewer))} m`;
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const w = innerWidth, h = innerHeight;
    this.viewport.width = w;
    this.viewport.height = h;
    this.world.set(where[0], where[1], where[2]);
    const inView = Vector3.TransformCoordinates(this.world, camera.getViewMatrix());
    const behind = inView.z < 0.1;
    Vector3.ProjectToRef(this.world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.viewport, this.screen);
    let x = this.screen.x, y = this.screen.y;
    // Keep clear of the hotbar, buttons and readouts round the edges.
    const left = this.touch ? 70 : 24, right = w - left, top = this.touch ? 84 : 60, bottom = h - (this.touch ? 70 : 124);
    const inside = !behind && x >= left && x <= right && y >= top && y <= bottom;
    m.el.classList.toggle("edge", !inside);
    // Never past the screen's edge, however wide the bubble.
    const halfW = m.el.offsetWidth / 2 + 4, height = m.el.offsetHeight;
    const fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (inside) {
      x = fit(x, halfW, w - halfW);
      // Below the hotbar on phones (it runs along the top there).
      y = fit(y, (this.touch ? 80 : 8) + height, h);
      m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      return;
    }
    // Off screen: from the centre toward the spot (away from it when behind), out to the edge.
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    let dx = x - cx, dy = y - cy;
    if (behind) {
      // Behind: along the bottom, leaning to the side it is on (straight behind is bottom centre).
      dx = inView.x;
      dy = Math.max(Math.abs(inView.z), 0.5);
    }
    const k = Math.min((right - cx) / Math.max(Math.abs(dx), 1e-6), (bottom - cy) / Math.max(Math.abs(dy), 1e-6));
    x = fit(cx + dx * k, halfW, w - halfW);
    y = fit(cy + dy * k, top + height / 2, bottom - height / 2);
    m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    m.edgeBox = [x - halfW, y - height / 2, x + halfW, y + height / 2];
    m.el.style.setProperty("--angle", `${Math.atan2(dy, dx).toFixed(3)}rad`);
  }
}

function el(tag: string, id: string): HTMLElement {
  const node = document.createElement(tag);
  if (id) node.id = id;
  return node;
}

const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A builder's colour, lightened if needed so a name stays readable on the dark bubbles. */
function readable(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (light >= 150) return color;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.6);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
