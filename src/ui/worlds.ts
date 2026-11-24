import type { Environment } from "../game/environments";
import { MATERIALS, type MaterialId } from "../game/pieces";
import { pieceLabel } from "../game/environments";
import { FIRST_PAID_WORLD, WORLDS } from "../worlds";

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "storeys 1–10", or "any storey": where a material can be built. */
export function reachOf(env: Environment, material: MaterialId): string {
  const top = env.materials[material].maxLevel;
  return top === Infinity ? "any storey" : `storeys 1–${top + 1}`;
}

/**
 * Everything on the page that depends on which worlds there are and which one
 * this is, written from the list of worlds: the menu's cards, the switcher,
 * the unlock panel, and the names of this world's pieces and materials in the
 * controls. `testWorld` (a dev server's ?world=) is kept on every link.
 */
export function paintWorlds(env: Environment, testWorld: string | null): void {
  const href = (w: Environment) => (testWorld ? `${w.path}?world=${encodeURIComponent(testWorld)}` : w.path);
  document.body.dataset.env = env.id;
  document.body.classList.toggle("paid-world", env.paid);

  document.getElementById("worlds")!.innerHTML = WORLDS.map(
    (w) =>
      `<a class="world${w.paid ? " paid" : ""}${w === env ? " current" : ""}" data-env="${w.id}" href="${escape(href(w))}">` +
      `<span class="pic" style="background-image: url(${escape(w.card.picture)})"><span class="badge${w.paid ? " paid" : ""}">${w.paid ? "Full Game" : "Free"}</span></span>` +
      `<span class="info"><span class="name"><b>${escape(w.name)}</b><i class="builders" data-builders="${w.id}"></i></span><small>${escape(w.card.blurb)}</small></span></a>`,
  ).join("");

  document.getElementById("mini-worlds")!.innerHTML =
    `<span class="mini-title">Switch world</span>` +
    WORLDS.map(
      (w) =>
        `<a class="mini-world${w === env ? " current" : ""}" data-env="${w.id}" href="${escape(href(w))}"><span class="pic" style="background-image: url(${escape(w.card.picture)})"></span><b>${escape(w.name)}</b><i class="builders" data-builders="${w.id}" data-short></i></a>`,
    ).join("");

  // The world you are in is not a link: clicking it again would only load the page again.
  for (const here of document.querySelectorAll<HTMLAnchorElement>(".world.current, .mini-world.current")) {
    here.removeAttribute("href");
    here.setAttribute("aria-current", "page");
  }
  watchBuilders(testWorld);

  // What buying shows: this world when it is a paid one, else the first paid world.
  const shown = env.paid ? env : FIRST_PAID_WORLD;
  if (shown) {
    (document.getElementById("unlock-pic") as HTMLElement).style.backgroundImage = `url(${shown.card.picture})`;
    document.getElementById("unlock-title")!.textContent = `Build on the ${shown.name}`;
    document.getElementById("unlock-perks")!.innerHTML = [...shown.card.perks, "Every paid world we add, included"].map((p) => `<li>${escape(p)}</li>`).join("");
    const go = document.getElementById("thanks-go") as HTMLAnchorElement;
    go.href = href(shown);
    go.textContent = `Go to the ${shown.name}`;
    go.hidden = env.paid;
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-piece]")) {
    const label = pieceLabel(el.dataset.piece as "roof" | "trebuchet", env);
    el.textContent = el.dataset.verb ? `${el.dataset.verb} ${label.toLowerCase()}` : label;
  }
  // "Metal builds up to storey 10, brick to 30, wood all the way up."
  const limited = MATERIALS.filter((m) => env.materials[m].maxLevel !== Infinity).sort((a, b) => env.materials[a].maxLevel - env.materials[b].maxLevel);
  const free = MATERIALS.filter((m) => env.materials[m].maxLevel === Infinity);
  const parts = [
    ...limited.map((m, i) => `${env.materials[m].label.toLowerCase()} ${i === 0 ? "builds up to storey" : "to"} ${env.materials[m].maxLevel + 1}`),
    ...free.map((m) => `${env.materials[m].label.toLowerCase()} all the way up`),
  ].join(", ");
  document.getElementById("materials-note")!.textContent = parts ? `${parts[0]!.toUpperCase()}${parts.slice(1)}.` : "";
}

/** Asks for the numbers on the world cards again now (after joining a world: the count then includes this builder). */
export let askBuilders: () => void = () => {};

/** How often the numbers on the world cards are asked for while a panel with them is showing, ms. */
const BUILDERS_EVERY = 12_000;

/**
 * Keeps "3 builders" on every world's card and switch button: asked from the
 * server now, and again every few seconds while the cards are on screen.
 */
function watchBuilders(testWorld: string | null): void {
  const showing = () => [...document.querySelectorAll<HTMLElement>("[data-builders]")].some((el) => el.offsetParent !== null);
  let asking = false;
  const ask = async () => {
    if (asking || document.hidden) return;
    asking = true;
    try {
      const response = await fetch(`/api/worlds${testWorld ? `?world=${encodeURIComponent(testWorld)}` : ""}`, { cache: "no-store" });
      const { worlds } = (await response.json()) as { worlds?: { id: string; builders: number }[] };
      for (const w of worlds ?? []) {
        for (const el of document.querySelectorAll<HTMLElement>(`[data-builders="${w.id}"]`)) {
          el.textContent = el.dataset.short !== undefined ? String(w.builders) : `${w.builders} ${w.builders === 1 ? "builder" : "builders"}`;
          el.title = `${w.builders} ${w.builders === 1 ? "builder" : "builders"} there now`;
          el.classList.toggle("none", w.builders === 0);
        }
      }
    } catch {
      // Offline: the next time, then.
    } finally {
      asking = false;
    }
  };
  void ask();
  askBuilders = () => void ask();
  setInterval(() => showing() && void ask(), BUILDERS_EVERY);
  // Straight away when a panel with the cards opens (the menu, the settings).
  let shown = showing();
  new MutationObserver(() => {
    const now = showing();
    if (now && !shown) void ask();
    shown = now;
  }).observe(document.getElementById("overlay")!, { attributes: true, subtree: true, attributeFilter: ["hidden", "class", "style"] });
}
