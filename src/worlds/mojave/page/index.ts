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
  // Walls, floors and ramps (a platform to command from); no canopies. A wall is all that shelters from fire here.
  row: { siege: false, material: "brick", pieces: ["wall", "floor", "ramp"] },
  tools: [
    { id: "build", label: "Build", key: "B", icon: ICONS.build!, press: true },
    { id: "select", label: "Select", key: "`", icon: ICONS.army!, press: true },
  ],
  // (And is told how a general plays by Mojave's own first notes, not to try placing walls.)
  ownTips: true,
  controls: {
    keys: [
      ["Click a unit", "Select (twice: all of that kind near it; hold and sweep: all you pass)"],
      ["Hold on the ground", "Look away and let go: every unit of yours in the ring is selected (Shift adds)"],
      ["Right click", "Send the selected: move, attack, rally"],
      ["M / F / X", "Move (never stops, shoots as it goes) · Attack (fights all it sees on the way, until there) · Stop"],
      ["H / P", "Hold position · Patrol"],
      ["1–8", "Choosing an army: the one to serve (with nothing else open they recall groups)"],
      ["B", "Build menu, whatever is selected (V for the advanced buildings)"],
      ["Walls · floors", "Shields, whoever built them: shots never pass one. Fire over a wall from a floor above it; a turret aimed onto a floor goes up on it, and reaches 1.3 times as far"],
      ["J", "Change army (also in the Esc menu)"],
      ["Ctrl + 1–9", "Save a group (Alt or Shift work too)"],
      ["1–9", "Recall a group (twice: face it)"],
      ["`", "Select: ` again for the whole army, or a kind's key (T Troopers, K Tanks, C Scouts, R artillery, M Missile trucks, G gunships, U transports, E EMP drones, I Titans)"],
      ["Shift", "Add to the selection · queue orders"],
      ["Tab", "The map: right click sends the selected there"],
      ["Backspace", "Up one level: placing → its buildings → (advanced → basic) → what is selected → nothing"],
    ],
    touch: ["Select and Order act on what the crosshair is on", "Army picks every fighting unit · Build opens the build menu", "Tap the tiles along the top to give orders"],
    note: "Mojave has seven colours for people, and one computer army (pink) that plays whenever someone is here: hard, but fair (it has what you have, and sees what you would). It booms first: new bases fast, each with turrets up on towers and a ring of walls with four gates, then Titans, Tanks and drones. Once it has three guarded bases it comes for you: its waves gather out of reach until they outnumber what they have seen of you, then come in together. Hit it early, before it is booming. You choose a colour: one nobody serves begins a new army of your own, and one with generals you command with them. An army nobody serves for a minute disappears, everything of it: come back later and you begin again. Haulers mine lithium by themselves, always, for the nearest Command Core (and the next nearest when it falls): they are never selected or ordered, and never idle. Build an army, and command it: units do only what they are told. They shoot whatever of the enemy's comes within range (walls too), on the move as well, and never go after anything; a patrol stops to destroy what it meets; told to attack, they stop as far off as they can shoot from to destroy whatever they meet, the target first, then go on, and end standing where it was; a group marches at the pace of its slowest. Buildings stand the moment they are paid for; units take a little time, shown over the row. With nothing selected the keys build, as everywhere; with units selected they are orders; with a building selected they are what it makes. The row shows which. Walls, floors and ramps are the pieces: build a platform anywhere to command from above. No shot gets through another army's wall (shells and drones included), so an enemy has to break it down first. A general is never hit. A turret reaches as far as anything with the same range reaches it. Walls and the sentry, flak and point-defence turrets go up only within 75 m of a Command Core of your own army, and never within 75 m of another army's: guard your base, not someone else's. Z, when it means nothing else, lets go and picks the Wall (F2 the floor, F3 the ramp); a click with it in hand builds where its preview is green. With units selected, a ring on the ground shows where an order would send them.",
  },
  // The war: armies, the dark, the map, and commanding from the ground.
  start(game) {
    const command = startCommand(game);
    // (Kept in reach by name too, for the checks that drive it.)
    return Object.assign(command, { command });
  },
};
