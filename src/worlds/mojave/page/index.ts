import type { WorldPage } from "../../pageDoors";
import { startCommand } from "./command";
import { outfit } from "./outfit";
import { scenery } from "./scenery";
import { siegeModel } from "./siege";
import { sounds } from "./sounds";
import { pieceSkin } from "./textures";

/** Everything Mojave draws and plays. */
export const page: WorldPage = {
  scenery,
  pieceSkin,
  outfit,
  siegeModel,
  sounds,
  // Pale lakebed dust.
  dust: [0.9, 0.86, 0.76],
  // A general starts with nothing picked: pieces cost lithium here, and the first clicks are on the army.
  emptyHanded: true,
  // (And is told how a general plays by Mojave's own first notes, not to try placing walls.)
  ownTips: true,
  controls: {
    keys: [
      ["Click a unit", "Select (twice: all of that kind; hold and sweep: all you pass)"],
      ["Right click", "Send the selected: move, attack, gather, rally"],
      ["M / F / X", "Move · Attack (then click) · Stop"],
      ["H / P", "Hold position · Patrol"],
      ["G / C", "Gather · Return cargo (Haulers)"],
      ["N", "Build menu (B and V with units selected)"],
      ["Ctrl + 1–9", "Save a group (Alt or Shift work too)"],
      ["1–9", "Recall a group (twice: face it)"],
      ["`", "Select the whole army"],
      ["I", "Next idle Hauler"],
      ["Shift", "Add to the selection · queue orders"],
      ["Tab", "The map: right click sends the selected there"],
      ["J", "Generals: alliances, computer generals"],
      ["Backspace", "Deselect"],
    ],
    touch: ["Select and Order act on what the crosshair is on", "Army picks every fighting unit · Build opens the build menu", "Tap the buttons on the card to give orders"],
    note: "In Mojave you are a general: mine lithium with Haulers, build an army, and command it. With nothing selected the keys build, as everywhere; with units selected they are orders; with a building selected they are what it makes.",
  },
  // The war: armies, the dark, the map, and commanding from the ground.
  start(game) {
    const command = startCommand(game);
    // (Kept in reach by name too, for the checks that drive it.)
    return Object.assign(command, { command });
  },
};
