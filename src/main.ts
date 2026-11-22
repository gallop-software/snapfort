import { startGame } from "./game";
import { createEngine } from "./render/engine";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const { engine, api } = await createEngine(canvas);
  // Render at up to 1.5x CSS pixels: sharp on high-density screens without quadrupling the work.
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  await startGame(canvas, engine, api);
}

boot().catch((error: unknown) => {
  console.error(error);
  const button = document.getElementById("play-free");
  if (button) button.textContent = "Could not start. Reload to try again.";
});
