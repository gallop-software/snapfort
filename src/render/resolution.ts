import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** How often the frame rate is judged, seconds. */
const WINDOW = 2;
/** Below this share of the target frame rate, draw fewer pixels. */
const LOW_SHARE = 0.83;
/** At or above this share for UPGRADE_AFTER seconds, try a step sharper again. */
const HIGH_SHARE = 0.96;
const UPGRADE_AFTER = 20;

/**
 * Picks how many pixels to draw. Starts sharp (up to 1.25 times CSS pixels on
 * high-density screens) and steps down when the frame rate sags below the target, so slower
 * computers run smoothly and quietly instead of straining to keep up. Steps
 * back up after a long steady stretch, but never to a step it already had to
 * leave twice.
 */
export class ResolutionGovernor {
  private readonly allSteps: number[];
  private steps: number[];
  private step = 0;
  private frames = 0;
  private elapsed = 0;
  private steady = 0;
  private readonly dropped = new Map<number, number>();
  /** Loading hitches in the first seconds say nothing about the computer either. */
  private warmup = 4;
  /** The frame rate being aimed for (lower in battery saver). */
  private target = 60;

  constructor(private readonly engine: AbstractEngine) {
    const dpr = window.devicePixelRatio || 1;
    const top = Math.min(dpr, 1.25);
    this.allSteps = [...new Set([top, Math.min(top, 1), 0.8, 0.65])].sort((a, b) => b - a);
    this.steps = this.allSteps;
    this.apply();
  }

  /**
   * Never draws more than `max` pixels per CSS pixel (Infinity: no limit beyond
   * the usual), judging smoothness against `targetFps`.
   */
  limit(max: number, targetFps = 60): void {
    this.target = targetFps;
    this.frames = 0;
    this.elapsed = 0;
    this.warmup = 2;
    const scale = this.scale;
    this.steps = this.allSteps.filter((s) => s <= max);
    if (this.steps.length === 0) this.steps = [this.allSteps[this.allSteps.length - 1]!];
    // Stay as close as possible to where we were.
    const at = this.steps.findIndex((s) => s <= scale);
    this.step = at < 0 ? this.steps.length - 1 : at;
    this.dropped.clear();
    this.steady = 0;
    this.apply();
  }

  /** Pixels drawn per CSS pixel right now. */
  get scale(): number {
    return this.steps[this.step]!;
  }

  /** Call once a frame with the frame's duration in seconds. */
  update(dt: number): void {
    // A hidden or background tab is throttled by the browser; that says nothing about the computer.
    if (document.hidden || dt <= 0 || dt > 0.5) return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < WINDOW) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (fps < this.target * LOW_SHARE && this.step < this.steps.length - 1) {
      this.dropped.set(this.step, (this.dropped.get(this.step) ?? 0) + 1);
      this.step++;
      this.steady = 0;
      this.apply();
    } else if (fps >= this.target * HIGH_SHARE) {
      this.steady += WINDOW;
      const up = this.step - 1;
      if (this.steady >= UPGRADE_AFTER && up >= 0 && (this.dropped.get(up) ?? 0) < 2) {
        this.step = up;
        this.steady = 0;
        this.apply();
      }
    } else this.steady = 0;
  }

  private apply(): void {
    this.engine.setHardwareScalingLevel(1 / this.scale);
  }
}
