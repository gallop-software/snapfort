/** Where it is noted that this browser has seen all the tips. */
const KEY = "snapfort.tips";

/** What the game tells the tips each frame. */
export interface TipProgress {
  /** Metres walked since starting. */
  moved: number;
  /** Pieces placed since starting. */
  placed: number;
  /** Kinds of piece placed (wall, floor, ramp, roof, trebuchet). */
  kinds: ReadonlySet<string>;
  /** The chat line has been opened. */
  chatted: boolean;
}

interface Step {
  desk: string;
  touch: string;
  /** Done once this is true (`at` is the progress when the step was first shown). */
  done(now: TipProgress, at: TipProgress, shownFor: number): boolean;
}

const STEPS: Step[] = [
  {
    desk: "Move with <kbd>W A S D</kbd> and look around with the mouse",
    touch: "<b>Left thumb</b> moves · <b>right thumb</b> looks around",
    done: (now) => now.moved > 4,
  },
  {
    desk: "<kbd>Click</kbd> to place a wall where the crosshair points",
    touch: "Tap <b>Place</b> to build a wall where the crosshair points",
    done: (now, at) => now.placed > at.placed,
  },
  {
    desk: "Other pieces: <kbd>F</kbd> floor · <kbd>X</kbd> ramp · <kbd>C</kbd> roof",
    touch: "Pick other pieces from the <b>bar at the top</b>",
    done: (now) => [...now.kinds].some((k) => k !== "wall"),
  },
  {
    desk: "<b>Hold</b> the mouse button to keep placing, and build up!",
    touch: "<b>Hold</b> Place to keep placing, and build up!",
    done: (now, at) => now.placed >= at.placed + 4,
  },
  {
    desk: "Pieces need support: knock out the bottom and what's above falls",
    touch: "Pieces need support: knock out the bottom and what's above falls",
    done: (_now, _at, shownFor) => shownFor > 7000,
  },
  {
    desk: "Press <kbd>Enter</kbd> to chat with other builders",
    touch: "Tap the <b>chat button</b> (top right) to talk to other builders",
    done: (now, _at, shownFor) => now.chatted || shownFor > 9000,
  },
];

/**
 * A few tips for a first game, one at a time near the bottom of the screen,
 * each moving on as soon as it has been done (walk, place, try another piece,
 * hold to keep placing), then never again in this browser. Experienced
 * players see none; anyone can wave them away.
 */
export class Tips {
  private readonly el = document.getElementById("tip")!;
  private step: number;
  private at: TipProgress | null = null;
  private shownAt = 0;
  private shown = "";

  constructor(private readonly touch: boolean) {
    this.step = localStorage.getItem(KEY) === "done" ? STEPS.length : 0;
    this.el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tip-skip")) this.finish();
    });
  }

  /** Moves the tips along; `active` false (menu open, visiting, on a trebuchet) hides them for now. */
  update(progress: TipProgress, active: boolean, now: number): void {
    const step = STEPS[this.step];
    if (!step || !active) return this.paint("");
    if (!this.at) {
      this.at = { ...progress, kinds: new Set(progress.kinds) };
      this.shownAt = now;
    }
    if (step.done(progress, this.at, now - this.shownAt)) {
      this.step++;
      this.at = null;
      if (this.step >= STEPS.length) this.finish();
      return;
    }
    this.paint(`<span class="tip-n">${this.step + 1}/${STEPS.length}</span><span class="tip-text">${this.touch ? step.touch : step.desk}</span><button type="button" class="tip-skip" aria-label="Hide tips">✕</button>`);
  }

  /** No more tips in this browser. */
  finish(): void {
    this.step = STEPS.length;
    localStorage.setItem(KEY, "done");
    this.paint("");
  }

  private paint(html: string): void {
    if (html === this.shown) return;
    this.shown = html;
    this.el.hidden = !html;
    if (html) this.el.innerHTML = html;
  }
}
