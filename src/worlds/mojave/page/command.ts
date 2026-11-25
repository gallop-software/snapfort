import { CELL, LEVEL } from "../../../game/constants";
import { gridBox, type Piece, type PieceSpec } from "../../../game/pieces";
import type { PageGame, WorldFeature } from "../../pageDoors";
import {
  BUILDING_KINDS,
  BUILDINGS,
  EMP,
  ENGINE_COST,
  HIGH_GROUND,
  MAKES,
  PIECE_COST,
  UNITS,
  UPGRADE_COST,
  UPGRADE_KEYS,
  UPGRADE_LEVELS,
  UPGRADES,
  upkeep,
  type BuildingKind,
  type UnitKind,
} from "../kit";
import { BUILD_REACH, generalSight } from "../sim";
import type { ToPage, ToServer, WireGeneral, WireSpot, WireTarget } from "../wire";
import { HALF_CELLS } from "../world";
import { ArmyView, type SeenBuilding, type SeenField, type SeenUnit } from "./army";
import { Dark } from "./dark";
import { Panel, type CardButton, type MapDot } from "./panel";

/**
 * Commanding, from the ground. The general keeps the view every world has and
 * gives StarCraft's orders with the crosshair: a click on a unit selects it,
 * a right click sends what is selected (to move, to attack what was clicked,
 * to gather, to rally), and the keys are StarCraft's wherever they do not
 * clash with the keys every world shares (so attack is F and stop is X: A and
 * S walk the general).
 *
 * What the keys mean depends on what is selected, as in StarCraft:
 * nothing (the building keys of every world), units (orders), or a building
 * (what it makes).
 */

type Pending = "move" | "amove" | "patrol" | "gather" | "unload" | "emp" | "rally";
type Mode = null | { k: "target"; what: Pending } | { k: "menu"; page: 0 | 1 } | { k: "place"; kind: BuildingKind } | { k: "gens" };
type Picked = { k: "unit"; u: SeenUnit } | { k: "building"; b: SeenBuilding } | { k: "field"; f: SeenField } | { k: "general"; slot: number } | null;

const HALF = HALF_CELLS * CELL;
const PENDING_TEXT: Record<Pending, string> = {
  move: "Move: click where",
  amove: "Attack: click where, or on what",
  patrol: "Patrol: click the far end",
  gather: "Gather: click on crystals",
  unload: "Unload: click where",
  emp: "EMP: click where",
  rally: "Rally point: click where",
};
const ORDER_KEYS: [string, string, Pending | "stop" | "hold" | "return", string][] = [
  ["KeyM", "M", "move", "Move"],
  ["KeyF", "F", "amove", "Attack"],
  ["KeyX", "X", "stop", "Stop"],
  ["KeyH", "H", "hold", "Hold"],
  ["KeyP", "P", "patrol", "Patrol"],
  ["KeyG", "G", "gather", "Gather"],
  ["KeyC", "C", "return", "Return cargo"],
  ["KeyU", "U", "unload", "Unload"],
  ["KeyE", "E", "emp", "EMP"],
];

export function startCommand(game: PageGame): WorldFeature & Record<string, unknown> {
  const army = new ArmyView(game);
  const dark = new Dark(game.scene);
  const panel = new Panel();

  /** Who this player is here: a general's slot, or -1 (watching), and why. */
  let slot = -1;
  let why: "full" | "visitor" | undefined;
  let start: [number, number] | null = null;
  let placed = false;
  const myPids = new Set<string>();
  let generals: WireGeneral[] = [];
  let bank = { l: 0, p: 0, used: 0, max: 0, up: [0, 0] as [number, number], routed: -1 };
  let bots = 1;

  const selected = new Set<number>();
  const selectedBuildings = new Set<number>();
  army.selected = selected;
  army.selectedBuildings = selectedBuildings;
  const groups = new Map<number, { units: number[]; buildings: number[] }>();
  let mode: Mode = null;
  let mapOn = false;
  const cursor = { x: 0, z: 0 };
  let painting = false;
  let tookLeft = false, tookRight = false;
  let lastClick = { id: 0, at: 0 };
  let lastDigit = { n: -1, at: 0 };
  let idleAt = 0;
  const pings: { x: number; z: number; at: number; color: string }[] = [];
  let cardDirty = true;
  let lookAt = 0, mapAt = 0, cardAt = 0, shotAt = 0, boomAt = 0;
  let lastHint: string | null = null;
  /** Frames left in which a general who has just arrived is turned to face their base. */
  let faceHome = 0;
  /** What a hint says, without its markup. */
  const plain = (html: string | null) => (html ?? "").replace(/<[^>]+>/g, "");

  const general = (s: number) => generals.find((g) => g.slot === s);
  const teamOf = (s: number) => general(s)?.team ?? -1 - s;
  const myTeam = () => teamOf(slot);
  const mine = (owner: number) => slot >= 0 && owner === slot;
  const friendly = (owner: number) => slot >= 0 && owner < 8 && teamOf(owner) === myTeam();
  army.colorOf = (owner) => general(owner)?.color ?? "#8a8f98";
  army.inSight = (x, z) => dark.sees(x, z);

  const send = (msg: ToServer) => game.send(msg);
  const shift = () => game.held("ShiftLeft") || game.held("ShiftRight");
  const setMode = (next: Mode) => {
    mode = next;
    cardDirty = true;
  };
  const deselect = () => {
    selected.clear();
    selectedBuildings.clear();
    cardDirty = true;
  };

  // ── What the crosshair is on ───────────────────────────────────────────

  /** The spot under the crosshair, on the ground or anything solid. */
  const aimSpot = (): WireSpot | null => game.aim(600);

  /** What the crosshair is on: the nearest unit along it, else the building, field or general at the spot it lands on. */
  function pick(): Picked {
    const { from, dir } = game.sight();
    const spot = aimSpot();
    const reach = spot ? Math.hypot(spot[0] - from[0], spot[1] - from[1], spot[2] - from[2]) + 1.5 : 600;
    let best: Picked = null, bestAlong = reach;
    for (const u of army.units.values()) {
      const def = UNITS[u.kind];
      const cx = u.x - from[0], cy = u.y + def.height * 0.5 - from[1], cz = u.z - from[2];
      const along = cx * dir[0] + cy * dir[1] + cz * dir[2];
      if (along < 0.5 || along > bestAlong) continue;
      const off = Math.hypot(cx - dir[0] * along, cy - dir[1] * along, cz - dir[2] * along);
      // Generous far away: a Trooper at 150 m is a few pixels.
      if (off > Math.max(def.radius * 1.15, def.height * 0.6, along * 0.013)) continue;
      best = { k: "unit", u };
      bestAlong = along;
    }
    if (best) return best;
    for (const o of game.others()) {
      const g = generals.find((x) => x.pid === o.id);
      if (!g || !o.position || !dark.sees(o.position[0], o.position[2])) continue;
      const cx = o.position[0] - from[0], cy = o.position[1] - from[1], cz = o.position[2] - from[2];
      const along = cx * dir[0] + cy * dir[1] + cz * dir[2];
      if (along < 0.5 || along > reach) continue;
      if (Math.hypot(cx - dir[0] * along, cy - dir[1] * along, cz - dir[2] * along) < Math.max(1, along * 0.012)) return { k: "general", slot: g.slot };
    }
    if (!spot) return null;
    for (const b of army.buildings.values()) {
      const size = BUILDINGS[b.kind].size * CELL;
      if (spot[0] > b.x * CELL - 0.6 && spot[0] < b.x * CELL + size + 0.6 && spot[2] > b.z * CELL - 0.6 && spot[2] < b.z * CELL + size + 0.6 && spot[1] < BUILDINGS[b.kind].height + 1) return { k: "building", b };
    }
    if (spot[1] < 3) {
      for (const f of army.fields.values()) if (Math.abs(spot[0] - (f.cx + 0.5) * CELL) < CELL * 0.75 && Math.abs(spot[2] - (f.cz + 0.5) * CELL) < CELL * 0.75) return { k: "field", f };
    }
    return null;
  }

  // ── Selecting ──────────────────────────────────────────────────────────

  function selectUnits(ids: Iterable<number>, add: boolean): void {
    if (!add) selected.clear();
    selectedBuildings.clear();
    for (const id of ids) selected.add(id);
    cardDirty = true;
  }

  function selectArmy(): void {
    const ids = [...army.units.values()].filter((u) => mine(u.owner) && u.kind !== "hauler").map((u) => u.id);
    if (ids.length === 0) return game.toast("You have no army yet");
    selectUnits(ids, false);
    game.play("select");
  }

  /** The next Hauler standing idle: selected, and the view turned to it. */
  function idleHauler(): void {
    const idle = [...army.units.values()].filter((u) => mine(u.owner) && u.kind === "hauler" && !(u.flags & 97));
    if (idle.length === 0) return game.toast("No idle Haulers");
    const u = idle[idleAt++ % idle.length]!;
    selectUnits([u.id], false);
    faceSpot(u.x, u.z);
  }

  function faceSpot(x: number, z: number): void {
    const p = game.player.position;
    if (Math.hypot(x - p.x, z - p.z) > 2) game.face(Math.atan2(x - p.x, z - p.z));
    pings.push({ x, z, at: performance.now(), color: "#ffffff" });
  }

  function saveGroup(n: number): void {
    if (selected.size === 0 && selectedBuildings.size === 0) return;
    groups.set(n, { units: [...selected], buildings: [...selectedBuildings] });
    game.toast(`Group ${n} saved`, 1200);
  }

  function recallGroup(n: number): void {
    const g = groups.get(n);
    const now = performance.now();
    const units = g ? g.units.filter((id) => army.units.has(id)) : [];
    const buildings = g ? g.buildings.filter((id) => army.buildings.has(id)) : [];
    if (units.length === 0 && buildings.length === 0) return game.toast(`Group ${n} is empty: Ctrl + ${n} saves what is selected`, 2200);
    selected.clear();
    selectedBuildings.clear();
    for (const id of units) selected.add(id);
    for (const id of buildings) selectedBuildings.add(id);
    cardDirty = true;
    // Twice: the view turns to face them.
    if (lastDigit.n === n && now - lastDigit.at < 450) {
      let x = 0, z = 0, c = 0;
      for (const id of units) {
        const u = army.units.get(id)!;
        x += u.x;
        z += u.z;
        c++;
      }
      for (const id of buildings) {
        const b = army.buildings.get(id)!;
        x += (b.x + BUILDINGS[b.kind].size / 2) * CELL;
        z += (b.z + BUILDINGS[b.kind].size / 2) * CELL;
        c++;
      }
      faceSpot(x / c, z / c);
    }
    lastDigit = { n, at: now };
    game.play("select");
  }

  /** A click on something of this general's: selected (with Shift, added or taken out; twice on a unit, all of its kind nearby). */
  function clickOn(p: Picked): boolean {
    const now = performance.now();
    if (p?.k === "unit" && mine(p.u.owner)) {
      const twice = lastClick.id === p.u.id && now - lastClick.at < 380;
      lastClick = { id: p.u.id, at: now };
      if (twice) {
        const near = [...army.units.values()].filter((u) => mine(u.owner) && u.kind === p.u.kind && Math.hypot(u.x - p.u.x, u.z - p.u.z) < 90);
        selectUnits(near.map((u) => u.id), shift());
      } else if (shift() && selected.has(p.u.id)) {
        selected.delete(p.u.id);
        cardDirty = true;
      } else selectUnits([p.u.id], shift());
      painting = true;
      game.play("select");
      return true;
    }
    if (p?.k === "building" && mine(p.b.o)) {
      const twice = lastClick.id === -p.b.i && now - lastClick.at < 380;
      lastClick = { id: -p.b.i, at: now };
      if (!shift()) selectedBuildings.clear();
      selected.clear();
      if (twice) for (const b of army.buildings.values()) if (mine(b.o) && b.kind === p.b.kind) selectedBuildings.add(b.i);
      selectedBuildings.add(p.b.i);
      cardDirty = true;
      game.play("select");
      return true;
    }
    return false;
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  function mark(spot: WireSpot, color: [number, number, number]): void {
    army.ping(spot[0], spot[1], spot[2], color, performance.now());
    pings.push({ x: spot[0], z: spot[2], at: performance.now(), color: `rgb(${color.map((c) => Math.round(c * 255)).join(",")})` });
  }

  function order(k: Pending | "stop" | "hold" | "return", spot: WireSpot | null, queue: boolean): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (k === "stop" || k === "hold" || k === "return") return send({ m: "order", ids, k, q: queue });
    if (!spot) return void game.toast("Aim at the ground");
    if (k === "rally") return;
    if (k === "gather") {
      const f = [...army.fields.values()].find((x) => !x.vent && Math.abs(spot[0] - (x.cx + 0.5) * CELL) < CELL && Math.abs(spot[2] - (x.cz + 0.5) * CELL) < CELL);
      if (!f) return void game.toast("Aim at crystals to gather");
      send({ m: "order", ids, k: "gather", field: f.id, q: queue });
      return mark(spot, [0.5, 1, 0.95]);
    }
    send({ m: "order", ids, k, at: spot, q: queue });
    mark(spot, k === "amove" ? [1, 0.4, 0.3] : k === "emp" ? [0.5, 0.9, 1] : [0.5, 1, 0.5]);
  }

  /** A right click with units selected: what it means depends on what it is on. */
  function smartOrder(): void {
    const p = pick();
    const spot = aimSpot();
    const queue = shift();
    const ids = [...selected];
    const attack = (on: WireTarget, at: WireSpot | null) => {
      send({ m: "order", ids, k: "attack", on, q: queue });
      if (at) mark(at, [1, 0.3, 0.25]);
    };
    if (p?.k === "unit" && !friendly(p.u.owner)) return attack([1, p.u.id], [p.u.x, p.u.y, p.u.z]);
    if (p?.k === "building" && !friendly(p.b.o)) return attack([2, p.b.i], spot);
    if (p?.k === "general" && !friendly(p.slot)) return attack([3, p.slot], spot);
    if (p?.k === "unit" && p.u.kind === "transport" && friendly(p.u.owner) && !selected.has(p.u.id)) {
      send({ m: "order", ids, k: "load", into: p.u.id, q: queue });
      return mark([p.u.x, 0, p.u.z], [0.6, 0.8, 1]);
    }
    if (p?.k === "field" && !p.f.vent && ids.some((id) => army.units.get(id)?.kind === "hauler")) {
      send({ m: "order", ids, k: "gather", field: p.f.id, q: queue });
      return mark([(p.f.cx + 0.5) * CELL, 0, (p.f.cz + 0.5) * CELL], [0.5, 1, 0.95]);
    }
    if (p?.k === "building" && p.b.kind === "core" && mine(p.b.o) && ids.some((id) => (army.units.get(id)?.extra ?? 0) > 0 && army.units.get(id)?.kind === "hauler")) {
      return send({ m: "order", ids, k: "return", q: queue });
    }
    // An enemy's wall or floor: shot down.
    if (spot && spot[1] > 0.3) {
      const piece = pieceAt(spot);
      if (piece && !myPids.has(ownerPid(piece.id))) return attack([4, piece.id], spot);
    }
    order("move", spot, queue);
  }

  /** The built piece a spot is on, if any. */
  function pieceAt(spot: WireSpot): Piece | null {
    let best: Piece | null = null, bestD = 0.8;
    for (const p of game.build.near(spot[0], spot[1], spot[2])) {
      const [x0, y0, z0, x1, y1, z1] = gridBox(p);
      const dx = Math.max(x0 * CELL - spot[0], 0, spot[0] - x1 * CELL), dy = Math.max(y0 * LEVEL - spot[1], 0, spot[1] - Math.max(y1, y0 + 0.1) * LEVEL), dz = Math.max(z0 * CELL - spot[2], 0, spot[2] - z1 * CELL);
      const d = Math.hypot(dx, dy, dz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
  const ownerPid = (pieceId: string) => pieceId.slice(0, Math.max(0, pieceId.lastIndexOf("-")));

  // ── Buildings: where they go, what they make ───────────────────────────

  /** The cell a building of this kind would go at, from the spot under the crosshair, and why it cannot (or ""). */
  function placing(kind: BuildingKind): { cx: number; cz: number; why: string } | null {
    const spot = aimSpot();
    if (!spot) return null;
    const def = BUILDINGS[kind];
    const cx = Math.round(spot[0] / CELL - def.size / 2), cz = Math.round(spot[2] / CELL - def.size / 2);
    return { cx, cz, why: cannotBuild(kind, cx, cz) };
  }

  function cannotBuild(kind: BuildingKind, cx: number, cz: number): string {
    const def = BUILDINGS[kind];
    const free = kind === "core" && bank.routed === 0;
    if (!free) {
      for (const need of def.needs ?? []) if (![...army.buildings.values()].some((b) => mine(b.o) && b.kind === need && b.d === 0)) return `Needs ${BUILDINGS[need].label} first`;
      if (bank.l < def.lithium) return "Not enough lithium";
      if (bank.p < def.plasma) return "Not enough plasma";
    }
    const p = game.player.position;
    if (Math.hypot(p.x - (cx + def.size / 2) * CELL, p.z - (cz + def.size / 2) * CELL) > BUILD_REACH + (def.size * CELL) / 2) return "Too far away: go closer";
    if (Math.abs(cx) > HALF_CELLS - def.size - 1 || Math.abs(cz) > HALF_CELLS - def.size - 1) return "Outside the building area";
    if (kind === "tap") {
      const vent = [...army.fields.values()].find((f) => f.vent && f.cx === cx && f.cz === cz);
      if (!vent) return "A Tap goes on a plasma vent";
      return taken(cx, cz, true) ? "That vent already has a Tap" : "";
    }
    for (let x = cx; x < cx + def.size; x++) {
      for (let z = cz; z < cz + def.size; z++) {
        if (taken(x, z, false)) return "Something is in the way";
        if (game.build.occupant({ type: "floor", x, y: 0, z, rot: 0 }) || game.build.occupant({ type: "ramp", x, y: 0, z, rot: 0 })) return "Something is built there";
        if (x > cx && game.build.occupant({ type: "wall", x, y: 0, z, rot: 1 })) return "Something is built there";
        if (z > cz && game.build.occupant({ type: "wall", x, y: 0, z, rot: 0 })) return "Something is built there";
      }
    }
    return "";
  }

  /** Whether a ground cell is taken by a building (or, unless `buildingsOnly`, a field). */
  function taken(x: number, z: number, buildingsOnly: boolean): boolean {
    for (const b of army.buildings.values()) {
      const s = BUILDINGS[b.kind].size;
      if (x >= b.x && x < b.x + s && z >= b.z && z < b.z + s) return true;
    }
    if (buildingsOnly) return false;
    for (const f of army.fields.values()) if (f.cx === x && f.cz === z) return true;
    return false;
  }

  function placeBuilding(kind: BuildingKind): void {
    const at = placing(kind);
    if (!at) return void game.toast("Aim at the ground");
    if (at.why) {
      game.toast(at.why);
      return game.play("deny");
    }
    send({ m: "build", kind, x: at.cx, z: at.cz });
    game.play("place");
    if (!shift()) setMode(null);
  }

  // ── Everything a key or a button can do ────────────────────────────────

  function act(id: string, many = false): void {
    const [what, arg] = id.split(":") as [string, string | undefined];
    switch (what) {
      case "o": {
        const k = arg as Pending | "stop" | "hold" | "return";
        if (k === "stop" || k === "hold" || k === "return") return order(k, null, many);
        return setMode({ k: "target", what: k });
      }
      case "menu":
        return setMode(mode?.k === "menu" && mode.page === Number(arg) ? null : { k: "menu", page: arg === "1" ? 1 : 0 });
      case "b":
        if (BUILDING_KINDS.includes(arg as BuildingKind)) setMode({ k: "place", kind: arg as BuildingKind });
        return;
      case "make":
        for (const b of selectedBuildings) {
          const s = army.buildings.get(b);
          if (s && UNITS[arg as UnitKind]?.madeAt === s.kind) send({ m: "make", id: b, kind: arg as UnitKind, n: many ? 5 : 1 });
        }
        return;
      case "up":
        for (const b of selectedBuildings) if (army.buildings.get(b)?.kind === "armory") return send({ m: "research", id: b, kind: arg as (typeof UPGRADES)[number] });
        return;
      case "rally":
        return setMode({ k: "target", what: "rally" });
      case "cancel":
        for (const b of selectedBuildings) send({ m: "cancel", id: b });
        return;
      case "army":
        return selectArmy();
      case "idle":
        return idleHauler();
      case "desel":
        setMode(null);
        return deselect();
      case "map":
        return toggleMap();
      case "gens":
        return setMode(mode?.k === "gens" ? null : { k: "gens" });
      case "ally":
        return send({ m: "ally", slot: Number(arg) });
      case "unally":
        return send({ m: "unally" });
      case "bots":
        bots = Math.max(0, Math.min(3, bots + (arg === "+" ? 1 : -1)));
        cardDirty = true;
        return send({ m: "bots", n: bots });
    }
  }

  function toggleMap(): void {
    mapOn = !mapOn;
    panel.setBig(mapOn);
    if (mapOn) {
      cursor.x = game.player.position.x;
      cursor.z = game.player.position.z;
    }
  }

  /** The command card for what is selected, or for the menu that is open. */
  function card(): { title: string; text?: string; buttons: CardButton[] } | null {
    if (slot < 0) return null;
    const cost = (lithium: number, plasma: number) => (plasma > 0 ? `${lithium} · ${plasma} plasma` : `${lithium}`);
    const has = (kind: BuildingKind) => [...army.buildings.values()].some((b) => mine(b.o) && b.kind === kind && b.d === 0);
    if (mode?.k === "place") {
      const def = BUILDINGS[mode.kind];
      if (game.touch) return { title: plain(lastHint) || `Place ${def.label}`, buttons: [{ id: "desel", key: "⌫", label: "Cancel" }] };
      return { title: `Place ${def.label}`, text: `${def.blurb}. Click to put it down (Shift for more), right click to cancel.`, buttons: [{ id: "desel", key: "⌫", label: "Cancel" }] };
    }
    if (mode?.k === "target") return { title: PENDING_TEXT[mode.what].replace("click", game.touch ? "aim and tap Go" : "click"), text: "Right click cancels.", buttons: [{ id: "desel", key: "⌫", label: "Cancel" }] };
    if (mode?.k === "menu") {
      const page = mode.page;
      const kinds = BUILDING_KINDS.filter((k) => !!BUILDINGS[k].advanced === (page === 1));
      return {
        title: page === 1 ? "Build: advanced" : "Build",
        text: bank.routed >= 0 ? (bank.routed === 0 ? "You are routed: your new Core is free." : `You are routed: a free Core in ${bank.routed} s.`) : "Pick one, then click where it goes.",
        buttons: [
          ...kinds.map((k) => {
            const def = BUILDINGS[k];
            const free = k === "core" && bank.routed === 0;
            const lacks = (def.needs ?? []).find((n) => !has(n));
            return { id: `b:${k}`, key: def.key, label: def.label, sub: free ? "free" : lacks ? `needs ${BUILDINGS[lacks].label}` : cost(def.lithium, def.plasma), off: !free && (!!lacks || bank.l < def.lithium || bank.p < def.plasma) };
          }),
          { id: `menu:${page === 1 ? 0 : 1}`, key: page === 1 ? "B" : "V", label: page === 1 ? "Basic" : "Advanced" },
        ],
      };
    }
    if (mode?.k === "gens") {
      const mates = generals.filter((g) => g.slot !== slot);
      const me = general(slot);
      return {
        title: "Generals",
        text: mates.length === 0 ? "You are alone here." : "Press a number to ask for an alliance (or to accept one). 0 leaves your alliance.",
        buttons: [
          ...mates.map((g) => {
            const ally = g.team === myTeam();
            const asked = me?.asked.includes(g.slot), asks = g.asked.includes(slot);
            return { id: `ally:${g.slot}`, key: `${g.slot + 1}`, label: g.name + (g.ai ? " (computer)" : ""), sub: ally ? "your ally" : asks ? "asks to ally: accept" : asked ? "asked" : "ask to ally", on: ally, off: ally || g.ai };
          }),
          { id: "unally", key: "0", label: "Leave alliance", off: !mates.some((g) => g.team === myTeam()) },
          { id: "bots:+", key: "+", label: "More computers", sub: `${bots} now`, off: bots >= 3 },
          { id: "bots:-", key: "−", label: "Fewer computers", off: bots <= 0 },
        ],
      };
    }
    if (selected.size > 0) {
      const counts = new Map<UnitKind, number>();
      for (const id of selected) {
        const u = army.units.get(id);
        if (u) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
      }
      const kinds = [...counts.keys()];
      const only = selected.size === 1 ? army.units.get([...selected][0]!) : undefined;
      const title = only ? `${UNITS[only.kind].label} · ${only.hp}%` : `${selected.size} selected`;
      const text = only ? UNITS[only.kind].blurb : [...counts].map(([k, n]) => `${n} ${UNITS[k].label}`).join(", ");
      const buttons: CardButton[] = ORDER_KEYS.filter(([, , k]) => {
        if (k === "gather" || k === "return") return kinds.includes("hauler");
        if (k === "unload") return kinds.includes("transport");
        if (k === "emp") return kinds.includes("emp");
        // (Phones have room for the orders that matter most.)
        if (k === "patrol" && game.touch) return false;
        return true;
      }).map(([, key, k, label]) => ({ id: `o:${k}`, key, label }));
      buttons.push({ id: "menu:0", key: "B", label: "Build" }, { id: "desel", key: "⌫", label: "Deselect" });
      return { title, text, buttons };
    }
    if (selectedBuildings.size > 0) {
      const list = [...selectedBuildings].flatMap((id) => army.buildings.get(id) ?? []);
      const first = list[0];
      if (!first) return null;
      const def = BUILDINGS[first.kind];
      const now = performance.now();
      const left = (s: number) => Math.max(0, Math.ceil(s - (now - first.at) / 1000));
      const text =
        first.d > 0 ? `Printing: ${left(first.d)} s` : first.r > 0 ? `Working on ${UPGRADES[first.r - 1]}: ${left(first.rl)} s` : first.q.length > 0 ? `Making ${first.q.map((k) => UNITS[UNIT_KIND_AT(k)].label).join(", ")} · ${left(first.ql)} s` : def.blurb;
      const kinds = new Set(list.map((b) => b.kind));
      const buttons: CardButton[] = [];
      for (const kind of kinds) {
        for (const unit of MAKES[kind]) {
          const u = UNITS[unit];
          const lacks = (u.needs ?? []).find((n) => !has(n));
          buttons.push({ id: `make:${unit}`, key: u.key, label: u.label, sub: lacks ? `needs ${BUILDINGS[lacks].label}` : `${cost(u.lithium, u.plasma)} · ${u.supply} supply`, off: !!lacks || bank.l < u.lithium || bank.p < u.plasma || bank.used + u.supply > bank.max });
        }
        if (kind === "armory") {
          UPGRADES.forEach((up, i) => {
            const level = bank.up[i]!;
            const price = UPGRADE_COST[level];
            buttons.push({ id: `up:${up}`, key: UPGRADE_KEYS[up], label: `${up === "weapons" ? "Weapons" : "Armour"} ${Math.min(UPGRADE_LEVELS, level + 1)}`, sub: price === undefined ? "done" : `${price} · ${price} plasma`, off: price === undefined || bank.l < price || bank.p < price });
          });
        }
      }
      if ([...kinds].some((k) => MAKES[k].length > 0)) buttons.push({ id: "rally", key: kinds.has("armory") ? "Y" : "R", label: "Rally point" }, { id: "cancel", key: "Z", label: "Cancel last" });
      else if (first.r > 0) buttons.push({ id: "cancel", key: "Z", label: "Cancel" });
      buttons.push({ id: "desel", key: "⌫", label: "Deselect" });
      return { title: list.length > 1 ? `${list.length} ${def.label}s` : `${def.label} · ${first.h}%`, text, buttons };
    }
    // (A phone has its own buttons for these, and no room to spare.)
    if (game.touch) return null;
    return {
      title: general(slot)?.name ?? "General",
      text: "Click a unit or building of yours to select it; right click sends what is selected.",
      buttons: [
        { id: "menu:0", key: "N", label: "Build" },
        { id: "army", key: "`", label: "Whole army" },
        { id: "idle", key: "I", label: "Idle Hauler" },
        { id: "map", key: "Tab", label: "Map" },
        { id: "gens", key: "J", label: "Generals" },
      ],
    };
  }
  const UNIT_KIND_AT = (i: number): UnitKind => (Object.keys(UNITS) as UnitKind[])[i] ?? "trooper";

  /** A new general's first notes, once in each browser: what they have, and the first keys. */
  function intro(): void {
    try {
      if (localStorage.getItem("snapfort.mojave.intro") === "seen") return;
      localStorage.setItem("snapfort.mojave.intro", "seen");
    } catch {
      return;
    }
    const lines = game.touch
      ? ["You are a general. Your Haulers are mining lithium for you.", "Aim at your Core and tap Select, then tap Hauler for more of them.", "Build opens the build menu: a Foundry makes your first Troopers.", "Army picks every fighting unit; aim at the ground and tap Order to send them."]
      : ["You are a general. Your Haulers are mining lithium for you.", "Click your Core, then press H for more Haulers.", "N opens the build menu: a Foundry makes your first Troopers.", "Click a unit to select it (twice for all of its kind); right click sends them. Tab is the map."];
    lines.forEach((text, i) => setTimeout(() => panel.note(text, "info"), 1500 + i * 6500));
  }

  // ── From the server ────────────────────────────────────────────────────

  function onMessage(data: unknown): void {
    const msg = data as ToPage;
    if (!msg || typeof msg !== "object") return;
    const now = performance.now();
    switch (msg.m) {
      case "you": {
        const was = slot;
        slot = msg.slot;
        why = msg.why;
        bots = msg.bots;
        for (const pid of msg.pids ?? []) myPids.add(pid);
        start = msg.start ?? null;
        if (was !== slot) {
          // Another side now (a watcher become a general): what was seen as a watcher is forgotten.
          army.clear();
          deselect();
          setMode(null);
          dark.forget();
          dark.off = slot < 0;
          if (slot >= 0) intro();
          // Playing already: straight to the base.
          if (slot >= 0 && start && game.playing() && !placed) {
            placed = true;
            game.player.teleport(start[0], 0.95, start[1]);
            faceHome = 3;
          }
        }
        cardDirty = true;
        return;
      }
      case "gens":
        generals = msg.g;
        cardDirty = true;
        return;
      case "fields":
        return army.setFields(msg.f);
      case "res":
        bank = msg;
        cardDirty = true;
        return;
      case "note":
        panel.note(msg.text, msg.kind);
        if (msg.x !== undefined && msg.z !== undefined) pings.push({ x: msg.x, z: msg.z, at: now, color: msg.kind === "attack" ? "#ff5a4a" : "#7ee2a0" });
        if (msg.kind === "attack") game.play("horn");
        return;
      case "no":
        game.toast(msg.text);
        return game.play("deny");
      case "tick": {
        if (msg.u) army.seeUnits(msg.u, now);
        if (msg.k) army.tumbles(msg.k, now);
        if (msg.x) {
          army.loseUnits(msg.x, now);
          for (let i = 0; i < msg.x.length; i += 2) selected.delete(msg.x[i]!) && (cardDirty = true);
        }
        if (msg.b) {
          army.seeBuildings(msg.b, now);
          if (msg.b.some((b) => selectedBuildings.has(b.i))) cardDirty = true;
        }
        if (msg.bx) {
          army.loseBuildings(msg.bx, now);
          for (let i = 0; i < msg.bx.length; i += 2) selectedBuildings.delete(msg.bx[i]!) && (cardDirty = true);
        }
        if (msg.s) {
          army.shots(msg.s, now);
          shotSound(msg.s, now);
        }
        if (msg.bl) {
          army.blasts(msg.bl, now);
          blastSound(msg.bl, now);
        }
        if (msg.p) army.pulses(msg.p, now, EMP.radius);
        if (msg.z) army.zaps(msg.z, now);
        if (msg.f) {
          for (let i = 0; i + 1 < msg.f.length; i += 2) {
            const f = army.fields.get(msg.f[i]!);
            if (f) f.amount = msg.f[i + 1]!;
          }
        }
        return;
      }
    }
  }

  /** How near something is, for how loud it sounds: 1 right here, 0 from 140 m. */
  const nearness = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - game.player.position.x, z - game.player.position.z) / 140);
  function shotSound(s: readonly number[], now: number): void {
    if (now - shotAt < 70) return;
    let near = 0, big = false;
    for (let i = 0; i + 10 <= s.length; i += 10) {
      const n = nearness(s[i]! / 10, s[i + 2]! / 10);
      if (n > near) {
        near = n;
        big = s[i + 6] !== 0;
      }
    }
    if (near <= 0.05) return;
    shotAt = now;
    if (big) game.sound.tone("sawtooth", 220, 70, 0.16, 0.07 * near);
    else game.sound.noise(0.045, 0.05 * near, 2600);
  }
  function blastSound(bl: readonly number[], now: number): void {
    if (now - boomAt < 140) return;
    let near = 0;
    for (let i = 0; i + 4 <= bl.length; i += 4) near = Math.max(near, nearness(bl[i]! / 10, bl[i + 2]! / 10));
    if (near <= 0.05) return;
    boomAt = now;
    game.sound.noise(0.32, 0.16 * near, 700);
    game.sound.tone("sine", 110, 40, 0.3, 0.12 * near);
  }

  // ── Keys and the mouse ─────────────────────────────────────────────────

  function onKey(code: string, event: KeyboardEvent): boolean {
    if (code === "Tab") {
      toggleMap();
      return true;
    }
    if (slot < 0) return false;
    const digit = code.startsWith("Digit") ? Number(code.slice(5)) : -1;
    if (mode?.k === "gens") {
      if (digit >= 1 && digit <= 8) act(`ally:${digit - 1}`);
      else if (digit === 0) act("unally");
      else if (code === "Equal" || code === "NumpadAdd") act("bots:+");
      else if (code === "Minus" || code === "NumpadSubtract") act("bots:-");
      else setMode(null);
      return true;
    }
    if (digit >= 0) {
      // (Ctrl, Alt or Shift saves: some browsers keep Ctrl + number for themselves.)
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) saveGroup(digit);
      else recallGroup(digit);
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (code === "Backquote") return act("army"), true;
    if (code === "Backspace") return act("desel"), true;
    if (code === "KeyJ") return act("gens"), true;
    if (code === "KeyI") return act("idle"), true;
    if (mode?.k === "menu") {
      const key = code.replace("Key", "");
      const page = mode.page;
      const kind = BUILDING_KINDS.find((k) => !!BUILDINGS[k].advanced === (page === 1) && BUILDINGS[k].key === key);
      if (kind) act(`b:${kind}`);
      else if (code === "KeyB") act("menu:0");
      else if (code === "KeyV") act("menu:1");
      else setMode(null);
      return true;
    }
    if (code === "KeyN") return act("menu:0"), true;
    if (mode?.k === "place" || mode?.k === "target") {
      // Any other key lets go of it.
      setMode(null);
    }
    if (selected.size > 0) {
      const found = ORDER_KEYS.find(([c]) => c === code);
      if (found) return act(`o:${found[2]}`, event.shiftKey), true;
      if (code === "KeyB") return act("menu:0"), true;
      if (code === "KeyV") return act("menu:1"), true;
      // The building keys of every world would only confuse while commanding.
      return /^Key[A-Z]$/.test(code) || /^F[1-4]$/.test(code);
    }
    if (selectedBuildings.size > 0) {
      const kinds = new Set([...selectedBuildings].flatMap((id) => army.buildings.get(id)?.kind ?? []));
      const key = code.replace("Key", "");
      if (kinds.has("armory")) {
        const up = UPGRADES.find((u) => UPGRADE_KEYS[u] === key);
        if (up) return act(`up:${up}`), true;
      }
      for (const kind of kinds) {
        const unit = MAKES[kind].find((u) => UNITS[u].key === key);
        if (unit) return act(`make:${unit}`, event.shiftKey), true;
      }
      if (code === "KeyR" || code === "KeyY") return act("rally"), true;
      if (code === "KeyZ") return act("cancel"), true;
      if (code === "KeyB") return act("menu:0"), true;
      if (code === "KeyV") return act("menu:1"), true;
      return /^Key[A-Z]$/.test(code) || /^F[1-4]$/.test(code);
    }
    return false;
  }

  function onMouse(button: number, down: boolean): boolean {
    if (!down) {
      if (button === 0) {
        painting = false;
        const took = tookLeft;
        tookLeft = false;
        return took;
      }
      const took = tookRight;
      tookRight = false;
      return took;
    }
    const take = () => {
      if (button === 0) tookLeft = true;
      else tookRight = true;
      return true;
    };
    if (mapOn) {
      const spot: WireSpot = [cursor.x, 0, cursor.z];
      if (button === 0) {
        faceSpot(cursor.x, cursor.z);
        toggleMap();
      } else if (slot >= 0 && selected.size > 0) order(mode?.k === "target" && mode.what !== "rally" ? mode.what : "move", spot, shift());
      else if (slot >= 0 && selectedBuildings.size > 0) send({ m: "rally", ids: [...selectedBuildings], at: spot });
      return take();
    }
    if (slot < 0) return false;
    if (mode?.k === "place") {
      if (button === 0) placeBuilding(mode.kind);
      else setMode(null);
      return take();
    }
    if (mode?.k === "target") {
      if (button === 0) {
        const what = mode.what;
        const spot = aimSpot();
        if (what === "rally") {
          if (spot) {
            send({ m: "rally", ids: [...selectedBuildings], at: spot });
            mark(spot, [1, 0.9, 0.4]);
          }
        } else if (what === "amove") {
          // On an enemy: that one. On the ground: there, fighting on the way.
          const p = pick();
          if (p?.k === "unit" && !friendly(p.u.owner)) send({ m: "order", ids: [...selected], k: "attack", on: [1, p.u.id], q: shift() });
          else if (p?.k === "building" && !friendly(p.b.o)) send({ m: "order", ids: [...selected], k: "attack", on: [2, p.b.i], q: shift() });
          else if (p?.k === "general" && !friendly(p.slot)) send({ m: "order", ids: [...selected], k: "attack", on: [3, p.slot], q: shift() });
          else order("amove", spot, shift());
        } else order(what, spot, shift());
        if (!shift()) setMode(null);
      } else setMode(null);
      return take();
    }
    if (mode) {
      setMode(null);
      return take();
    }
    if (button === 0) {
      if (clickOn(pick())) return take();
      if (selected.size > 0 || selectedBuildings.size > 0) {
        deselect();
        return take();
      }
      return false;
    }
    if (button === 2) {
      if (selected.size > 0) {
        smartOrder();
        return take();
      }
      if (selectedBuildings.size > 0) {
        const spot = aimSpot();
        if (spot) {
          send({ m: "rally", ids: [...selectedBuildings], at: spot });
          mark(spot, [1, 0.9, 0.4]);
        }
        return take();
      }
    }
    return false;
  }

  panel.onButton = (id) => {
    if (id === "t-select") {
      onMouse(0, true);
      onMouse(0, false);
    } else if (id === "t-order") {
      onMouse(2, true);
      onMouse(2, false);
    } else if (id === "t-army") act("army");
    else if (id === "t-menu") act("menu:0");
    else if (id === "t-map") act("map");
    else if (id === "t-gens") act("gens");
    else act(id);
  };

  // ── Every frame ────────────────────────────────────────────────────────

  function update(): void {
    const now = performance.now();
    if (faceHome > 0 && start && game.playing()) {
      faceHome--;
      game.face(Math.atan2(start[0], start[1]));
      // (Looking level, so the crosshair is on the Core and not on the ground before it: a click selects it.)
      game.look(0.04);
    }
    // Whoever is selected and has gone is let go of.
    for (const id of selected) if (!army.units.has(id) || !mine(army.units.get(id)!.owner)) selected.delete(id) && (cardDirty = true);
    for (const id of selectedBuildings) if (!army.buildings.has(id)) selectedBuildings.delete(id) && (cardDirty = true);

    // Holding the button and sweeping the crosshair: everything of mine it passes over.
    if (painting && game.playing()) {
      const p = pick();
      if (p?.k === "unit" && mine(p.u.owner) && !selected.has(p.u.id)) {
        selected.add(p.u.id);
        cardDirty = true;
      }
    }

    if (now - lookAt > 250) {
      lookAt = now;
      dark.off = slot < 0;
      // (Not before the general has arrived at their base: where they stood on the menu is not seen.)
      if (slot >= 0 && placed) {
        const sources: [number, number, number][] = [];
        for (const u of army.units.values()) {
          if (!friendly(u.owner)) continue;
          const def = UNITS[u.kind];
          sources.push([u.x, u.z, def.sight * (!def.air && u.y > 1.5 ? HIGH_GROUND : 1)]);
        }
        for (const b of army.buildings.values()) if (friendly(b.o)) sources.push([(b.x + BUILDINGS[b.kind].size / 2) * CELL, (b.z + BUILDINGS[b.kind].size / 2) * CELL, BUILDINGS[b.kind].sight * (b.d > 0 ? 0.4 : 1)]);
        const p = game.player.position;
        sources.push([p.x, p.z, generalSight(p.y)]);
        for (const o of game.others()) {
          const g = generals.find((x) => x.pid === o.id);
          if (g && o.position && g.team === myTeam()) sources.push([o.position[0], o.position[2], generalSight(o.position[1])]);
        }
        dark.look(sources);
      }
      // Other generals out of sight are not drawn (their place is not this side's to know).
      for (const o of game.others()) game.conceal(o.id, slot >= 0 && !!o.position && !dark.sees(o.position[0], o.position[2]));
    }
    dark.update();

    let hint: string | null = null;
    if (mode?.k === "place" && game.playing()) {
      const at = placing(mode.kind);
      if (at) {
        const size = BUILDINGS[mode.kind].size * CELL;
        const c: [number, number, number] = at.why ? [1, 0.3, 0.25] : [0.4, 1, 0.5];
        const x = at.cx * CELL + size / 2, z = at.cz * CELL + size / 2;
        army.mark(x, 0, z, size * 0.72, c);
        // Its corners, so the square it takes is plain.
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) army.mark(at.cx * CELL + dx * size, 0, at.cz * CELL + dz * size, 0.6, c);
        hint = at.why ? `<span class="bad">${at.why}</span>` : `<span class="ok">${BUILDINGS[mode.kind].label}: ${game.touch ? "tap Place" : "click"} to put it here</span>`;
      } else hint = `<span class="bad">Aim at the ground</span>`;
    } else if (mode?.k === "target") hint = `<b>${PENDING_TEXT[mode.what]}</b>`;
    if (hint !== lastHint) {
      lastHint = hint;
      cardDirty = true;
    }
    // (On a phone the hint is the card's title: there is no room above the hotbar, which is at the top there.)
    game.panel(game.touch ? null : hint);
    panel.setTouch(mode?.k === "place" ? "Place" : mode?.k === "target" ? "Go" : mapOn ? "Face" : "Select", mode || mapOn ? (mapOn ? "Send" : "Cancel") : "Order");

    // Rally points of what is selected.
    for (const id of selectedBuildings) {
      const b = army.buildings.get(id);
      if (b?.rx !== undefined && b.rz !== undefined) army.mark(b.rx, 0, b.rz, 1.2, [1, 0.9, 0.4]);
    }

    army.update(now);

    if (now - mapAt > (mapOn ? 60 : 220)) {
      mapAt = now;
      const dots: MapDot[] = [];
      for (const f of army.fields.values()) if (dark.knows((f.cx + 0.5) * CELL, (f.cz + 0.5) * CELL)) dots.push({ x: (f.cx + 0.5) * CELL, z: (f.cz + 0.5) * CELL, color: f.vent ? "#b98cff" : f.amount > 0 ? "#6fe0d6" : "#52605f", size: 2 });
      for (const b of army.buildings.values()) dots.push({ x: (b.x + BUILDINGS[b.kind].size / 2) * CELL, z: (b.z + BUILDINGS[b.kind].size / 2) * CELL, color: army.colorOf(b.o), size: 2 + BUILDINGS[b.kind].size * 1.6 });
      for (const u of army.units.values()) dots.push({ x: u.x, z: u.z, color: selected.has(u.id) ? "#ffffff" : army.colorOf(u.owner), size: UNITS[u.kind].radius > 1.9 ? 3 : 2 });
      for (const o of game.others()) {
        const g = generals.find((x) => x.pid === o.id);
        if (g && o.position && dark.sees(o.position[0], o.position[2])) dots.push({ x: o.position[0], z: o.position[2], color: g.color, size: 4 });
      }
      while (pings.length > 0 && now - pings[0]!.at > 2500) pings.shift();
      const p = game.player.position;
      panel.drawMap({
        visible: slot >= 0 ? dark.visible : null,
        explored: slot >= 0 ? dark.explored : null,
        dots,
        me: { x: p.x, z: p.z, yaw: game.viewYaw() },
        pings: pings.map((q) => ({ x: q.x, z: q.z, age: ((now - q.at) % 1250) / 1250, color: q.color })),
        cursor: mapOn ? cursor : null,
      });
    }

    if (cardDirty || now - cardAt > 500) {
      cardDirty = false;
      cardAt = now;
      panel.setCard(card());
      panel.setBank(slot >= 0 ? { lithium: bank.l, plasma: bank.p, used: bank.used, max: bank.max, upkeep: upkeep(bank.used) } : null);
      panel.setWatching(slot >= 0 ? null : why === "full" ? "All eight generals' places are taken: you are watching, and take the next one that comes free" : why === "visitor" ? "You are watching: commanding an army here comes with the Full Game" : null);
    }
  }

  // ── Pieces: whose they are, and what is in their way ───────────────────

  /** A piece cut into a building or a field, as the server judges it (see Sim.blocks). */
  function cutsIn(spec: PieceSpec): boolean {
    const [x0, y0, z0] = gridBox(spec);
    const full = (x: number, z: number) => {
      for (const b of army.buildings.values()) {
        const s = BUILDINGS[b.kind].size;
        if (x >= b.x && x < b.x + s && z >= b.z && z < b.z + s && y0 < Math.ceil(BUILDINGS[b.kind].height / LEVEL)) return true;
      }
      if (y0 < 1) for (const f of army.fields.values()) if (f.cx === x && f.cz === z) return true;
      return false;
    };
    if (spec.type === "wall") return spec.rot % 2 === 0 ? full(x0, z0 - 1) && full(x0, z0) : full(x0 - 1, z0) && full(x0, z0);
    return full(x0, z0);
  }
  const priceOf = (spec: PieceSpec) => (spec.type === "trebuchet" ? ENGINE_COST : PIECE_COST.wood);

  return {
    message: onMessage,
    joined() {
      // Joined again (a dropped connection): the server sends everything afresh. What was seen stays seen.
      army.clear();
      deselect();
      mode = null;
    },
    update,
    key: onKey,
    mouse: onMouse,
    look(dx, dy) {
      if (!mapOn) return false;
      const k = panel.metresPerPixel();
      cursor.x = Math.max(-HALF, Math.min(HALF, cursor.x + dx * k));
      cursor.z = Math.max(-HALF, Math.min(HALF, cursor.z - dy * k));
      return true;
    },
    busy: () => slot >= 0 && (selected.size > 0 || selectedBuildings.size > 0 || mode !== null || mapOn),
    spawn() {
      if (slot >= 0 && start) {
        placed = true;
        // (They arrive looking at their own Core, which stands a few cells further from the middle of the map.)
        faceHome = 3;
        return [start[0], 0.95, start[1]];
      }
      // Watching: from the middle of the map.
      return [2.5, 0.95, -62.5];
    },
    blocks: (spec) => slot < 0 || cutsIn(spec) || bank.l < priceOf(spec),
    whyBlocked(spec) {
      if (slot < 0) return why === "full" ? "All eight places are taken: you are watching" : "You are watching";
      if (cutsIn(spec)) return "A building or a field is in the way";
      return `Not enough lithium: that costs ${priceOf(spec)}${spec.type === "trebuchet" ? "" : " or more"}`;
    },
    keeps(piece) {
      if (slot < 0) return "You are watching";
      return myPids.has(ownerPid(piece.id)) || ownerPid(piece.id) === game.myId() ? null : "That is another general's: your army can shoot it down";
    },
    aimRemove() {
      const p = pick();
      if (p?.k === "building" && mine(p.b.o)) {
        const size = BUILDINGS[p.b.kind].size * CELL;
        army.mark(p.b.x * CELL + size / 2, 0, p.b.z * CELL + size / 2, size * 0.74, [1, 0.3, 0.25]);
        game.panel(`<span class="bad">${BUILDINGS[p.b.kind].label}: click to take it down (half its price back)</span>`);
      }
    },
    remove() {
      const p = pick();
      if (p?.k !== "building" || !mine(p.b.o)) return false;
      send({ m: "scrap", id: p.b.i });
      game.play("remove");
      return true;
    },
    // (Kept in reach for the checks that drive the game.)
    army,
    dark,
    panel,
    get slot() {
      return slot;
    },
    get bank() {
      return bank;
    },
    get generals() {
      return generals;
    },
    get mode() {
      return mode;
    },
    selected,
    selectedBuildings,
    run: act,
    pick,
  };
}
