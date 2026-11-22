import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { ResolutionGovernor } from "./resolution";
import type { World } from "./world";

/** "auto" picks for this computer; "sharp" is full quality; "saver" keeps old laptops cool and quiet. */
export type GraphicsMode = "auto" | "sharp" | "saver";
export const GRAPHICS_MODES: readonly GraphicsMode[] = ["auto", "sharp", "saver"];

/** Frames a second in battery saver. */
const SAVER_FPS = 30;

/**
 * True for graphics chips that run hot at full quality: integrated laptop
 * chips (Intel), software renderers and phone chips. Apple Silicon is fast
 * enough for full quality.
 */
export function isModestGpu(name: string): boolean {
  if (/intel|iris|uhd|hd graphics|swiftshader|llvmpipe|software|mali|adreno|powervr/i.test(name)) return true;
  return (navigator.hardwareConcurrency || 8) <= 4;
}

/**
 * Applies a graphics mode. Battery saver draws 30 frames a second instead of
 * 60, at no more than one pixel per CSS pixel, without live shadows: well
 * under half the work for the graphics chip, which is what spins up a
 * laptop's fan. (A chip can hold 60 fps while working flat out, so waiting for
 * the frame rate to drop is not enough.)
 */
export class Graphics {
  /** The mode in effect ("auto" resolved). */
  effective: Exclude<GraphicsMode, "auto"> = "sharp";
  private lastFrame = 0;
  private requestId = 0;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly world: World,
    private readonly resolution: ResolutionGovernor,
    private readonly gpuName: string,
  ) {}

  /** What "auto" picks on this computer. */
  get autoMode(): Exclude<GraphicsMode, "auto"> {
    return isModestGpu(this.gpuName) ? "saver" : "sharp";
  }

  apply(mode: GraphicsMode): void {
    this.effective = mode === "auto" ? this.autoMode : mode;
    const saver = this.effective === "saver";
    this.world.setShadows(!saver);
    this.resolution.limit(saver ? 1 : Infinity, saver ? SAVER_FPS : 60);
    this.capFrames(saver ? SAVER_FPS : null);
  }

  /**
   * Runs the render loop at most `fps` times a second (null: every display
   * frame). Babylon's own frame timing then sees the real gap between
   * frames, so movement and physics keep their speed.
   */
  private capFrames(fps: number | null): void {
    const engine = this.engine as AbstractEngine & { customAnimationFrameRequester: unknown };
    if (fps === null) {
      engine.customAnimationFrameRequester = null;
      return;
    }
    const interval = 1000 / fps;
    const requester = {
      requestAnimationFrame: (callback: () => void): number => {
        const tick = (now: number) => {
          // A millisecond of slack so a 60 Hz display reliably gives every other frame.
          if (now - this.lastFrame >= interval - 1) {
            this.lastFrame = now;
            callback();
          } else this.requestId = requestAnimationFrame(tick);
        };
        this.requestId = requestAnimationFrame(tick);
        return this.requestId;
      },
      cancelAnimationFrame: () => cancelAnimationFrame(this.requestId),
    };
    engine.customAnimationFrameRequester = requester;
  }
}
