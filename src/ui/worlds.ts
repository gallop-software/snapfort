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
      `<span class="info"><b>${escape(w.name)}</b><small>${escape(w.card.blurb)}</small></span></a>`,
  ).join("");

  document.getElementById("mini-worlds")!.innerHTML =
    `<span class="mini-title">Switch world</span>` +
    WORLDS.map(
      (w) =>
        `<a class="mini-world${w === env ? " current" : ""}" data-env="${w.id}" href="${escape(href(w))}"><span class="pic" style="background-image: url(${escape(w.card.picture)})"></span><b>${escape(w.name)}</b></a>`,
    ).join("");

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
