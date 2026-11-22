import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** How often the frame rate is judged, seconds. */
const WINDOW = 2;
/** Below this average, draw fewer pixels. */
const LOW_FPS = 50;
/** At or above this for UPGRADE_AFTER seconds, try a step sharper again. */
const HIGH_FPS = 58;
const UPGRADE_AFTER = 20;

/**
 * Picks how many pixels to draw. Starts sharp (up to 1.25 times CSS pixels on
 * high-density screens) and steps down when the frame rate sags, so slower
 * computers run smoothly and quietly instead of straining to keep up. Steps
 * back up after a long steady stretch, but never to a step it already had to
 * leave twice.
 */
export class ResolutionGovernor {
  private readonly steps: number[];
  private step = 0;
  private frames = 0;
  private elapsed = 0;
  private steady = 0;
  private readonly dropped = new Map<number, number>();
  /** Loading hitches in the first seconds say nothing about the computer either. */
  private warmup = 4;

  constructor(private readonly engine: AbstractEngine) {
    const dpr = window.devicePixelRatio || 1;
    const top = Math.min(dpr, 1.25);
    this.steps = [...new Set([top, Math.min(top, 1), 0.8, 0.65])].sort((a, b) => b - a);
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

    if (fps < LOW_FPS && this.step < this.steps.length - 1) {
      this.dropped.set(this.step, (this.dropped.get(this.step) ?? 0) + 1);
      this.step++;
      this.steady = 0;
      this.apply();
    } else if (fps >= HIGH_FPS) {
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
