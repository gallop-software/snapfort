import type { WorldPage } from "../../pageDoors";
import { startCommand } from "./command";
import { ICONS } from "./icons";
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
  // No siege engine here (armies do the breaking) and one material: in the engine's place on the row is Command,
  // which opens the general's own menu in the same boxes.
  row: { siege: false, material: "brick" },
  tools: [{ id: "command", label: "Command", key: "B", icon: ICONS.command!, press: true }],
  // (And is told how a general plays by Mojave's own first notes, not to try placing walls.)
  ownTips: true,
  controls: {
    keys: [
      ["Click a unit", "Select (twice: all of that kind; hold and sweep: all you pass)"],
      ["Right click", "Send the selected: move, attack, gather, rally"],
      ["M / F / X", "Move · Attack (then click) · Stop"],
      ["H / P", "Hold position · Patrol"],
      ["G / C", "Gather · Return cargo (Haulers)"],
      ["B", "Command: your own menu, on the row (Build, Whole army, Idle Hauler, Map, Change army)"],
      ["1–8", "Choosing an army: the one to serve (with nothing else open they recall groups)"],
      ["N", "Build menu (B with units selected; V for the advanced buildings)"],
      ["Ctrl + 1–9", "Save a group (Alt or Shift work too)"],
      ["1–9", "Recall a group (twice: face it)"],
      ["`", "Select the whole army"],
      ["I", "Next idle Hauler"],
      ["Shift", "Add to the selection · queue orders"],
      ["Tab", "The map: right click sends the selected there"],
      ["Backspace", "Back one step: to the menu before, then to what is selected, then deselect"],
    ],
    touch: ["Select and Order act on what the crosshair is on", "Army picks every fighting unit · Build opens the build menu", "Tap the tiles along the top to give orders"],
    note: "Mojave has eight armies, one of each colour. You choose the one you serve, command all of it with whoever else serves it, and may change sides at any moment (Command, then Change army). Mine lithium with Haulers, build an army, and command it. Buildings stand the moment they are paid for; units take a little time, shown over the row. With nothing selected the keys build, as everywhere; with units selected they are orders; with a building selected they are what it makes. The row shows which.",
  },
  // The war: armies, the dark, the map, and commanding from the ground.
  start(game) {
    const command = startCommand(game);
    // (Kept in reach by name too, for the checks that drive it.)
    return Object.assign(command, { command });
  },
};
