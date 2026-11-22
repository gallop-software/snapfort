import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type GraphicsApi = "WebGPU" | "WebGL";

/**
 * WebGPU where the browser has it, WebGL otherwise. Each engine is loaded on
 * demand so the browser only downloads the one it uses. `?gl` forces WebGL.
 * Both ask for the low-power graphics chip, so laptops with two chips keep
 * using the cooler built-in one. (Asking for nothing is not enough: Babylon's
 * WebGL engine then asks for "high-performance".)
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; api: GraphicsApi }> {
  const forceGl = new URLSearchParams(location.search).has("gl");
  if (!forceGl && "gpu" in navigator) {
    try {
      const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, { antialias: true, stencil: false, powerPreference: "low-power" });
        await engine.initAsync();
        return { engine, api: "WebGPU" };
      }
    } catch (error) {
      console.warn("WebGPU unavailable, using WebGL", error);
    }
  }
  const { Engine } = await import("@babylonjs/core/Engines/engine");
  const engine = new Engine(canvas, true, { stencil: false, powerPreference: "low-power" });
  return { engine, api: "WebGL" };
}
