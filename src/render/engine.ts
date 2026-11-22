import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export type GraphicsApi = "WebGPU" | "WebGL";

/**
 * WebGPU where the browser has it, WebGL otherwise. Each engine is loaded on
 * demand so the browser only downloads the one it uses. `?gl` forces WebGL.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; api: GraphicsApi }> {
  const forceGl = new URLSearchParams(location.search).has("gl");
  if (!forceGl && "gpu" in navigator) {
    try {
      const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, { antialias: true, stencil: false, powerPreference: "high-performance" });
        await engine.initAsync();
        return { engine, api: "WebGPU" };
      }
    } catch (error) {
      console.warn("WebGPU unavailable, using WebGL", error);
    }
  }
  const { Engine } = await import("@babylonjs/core/Engines/engine");
  const engine = new Engine(canvas, true, { stencil: false, powerPreference: "high-performance" });
  return { engine, api: "WebGL" };
}
