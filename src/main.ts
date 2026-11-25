import { startGame } from "./game";
import { worldAtPath } from "./worlds";
import { loadPage } from "./worlds/load";
import { paintWorlds } from "./ui/worlds";
import { createEngine } from "./render/engine";

async function boot(): Promise<void> {
  // The address says which world this is; anything unknown is the first one.
  const env = worldAtPath(location.pathname);
  // The menu's world cards and everything else on the page that names worlds, pieces or
  // materials, straight away. On a dev server the links keep the test world (?world=).
  paintWorlds(env, new URLSearchParams(location.search).get("world"));
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const { engine, api } = await createEngine(canvas);
  // Its own drawing code, fetched only now and only for this world.
  const page = await loadPage(env.id);
  await startGame(canvas, engine, api, env, page);
}

boot().catch((error: unknown) => {
  console.error(error);
  document.documentElement.classList.remove("arriving");
  const button = document.getElementById("play-free");
  if (button) button.textContent = "Could not start. Reload to try again.";
});
