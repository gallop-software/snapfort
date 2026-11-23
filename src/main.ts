import { startGame } from "./game";
import { MEADOW, MOON } from "./game/environments";
import { createEngine } from "./render/engine";

async function boot(): Promise<void> {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const { engine, api } = await createEngine(canvas);
  // snapfort.io/moon is the Moon; everything else is the meadow.
  const env = location.pathname.replace(/\/+$/, "") === "/moon" ? MOON : MEADOW;
  await startGame(canvas, engine, api, env);
}

boot().catch((error: unknown) => {
  console.error(error);
  const button = document.getElementById("play-free");
  if (button) button.textContent = "Could not start. Reload to try again.";
});
