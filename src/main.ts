import { startGame } from "./game";
import { createEngine } from "./render/engine";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const { engine, api } = await createEngine(canvas);
  await startGame(canvas, engine, api);
}

boot().catch((error: unknown) => {
  console.error(error);
  const button = document.getElementById("play-free");
  if (button) button.textContent = "Could not start. Reload to try again.";
});
